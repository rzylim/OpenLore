/**
 * Dynamic-dispatch edge synthesis (spec: add-synthesized-dynamic-dispatch-edges).
 * Tests the event-channel and route-handler rules + provenance through the real
 * CallGraphBuilder.build(). Route tests use on-disk fixtures because route
 * detection reads from disk by path (as the existing HTTP edge pass does).
 * Plain .test.ts so CI runs it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CallGraphBuilder, EVENT_CHANNEL_FANOUT_CAP } from './call-graph.js';
import type { CallEdge, FunctionNode } from './call-graph.js';

type Built = Awaited<ReturnType<CallGraphBuilder['build']>>;
const idByName = (b: Built, name: string): string | undefined =>
  [...b.nodes.values()].find((n: FunctionNode) => n.name === name)?.id;
const synthEdges = (b: Built): CallEdge[] => b.edges.filter(e => e.confidence === 'synthesized');
const edgeBetween = (b: Built, fromName: string, toName: string): CallEdge | undefined => {
  const from = idByName(b, fromName), to = idByName(b, toName);
  return b.edges.find(e => e.callerId === from && e.calleeId === to);
};

describe('event-channel synthesis', () => {
  const build = (content: string): Promise<Built> =>
    new CallGraphBuilder().build([{ path: 'src/app.ts', content, language: 'TypeScript' }]);

  it('Event handler is reachable through a synthesized edge', async () => {
    const b = await build(`
      function onMount() { return 1; }
      function register(emitter: any) { emitter.on('mount', onMount); }
      function trigger(emitter: any) { emitter.emit('mount'); }
    `);
    const edge = edgeBetween(b, 'trigger', 'onMount');
    expect(edge).toBeDefined();
    expect(edge!.confidence).toBe('synthesized');
    expect(edge!.synthesizedBy).toBe('event-channel');
    expect(edge!.kind).toBe('calls');
  });

  it('Mismatched channel keys produce no edge', async () => {
    const b = await build(`
      function handler() { return 1; }
      function register(e: any) { e.on('open', handler); }
      function trigger(e: any) { e.emit('close'); }
    `);
    expect(edgeBetween(b, 'trigger', 'handler')).toBeUndefined();
    expect(synthEdges(b)).toHaveLength(0);
  });

  it('Unpaired dispatch emits nothing', async () => {
    const b = await build(`
      function trigger(e: any) { e.emit('change'); }
    `);
    expect(synthEdges(b)).toHaveLength(0);
  });

  it('addEventListener registration is recognized', async () => {
    const b = await build(`
      function onClick() { return 1; }
      function wire(el: any) { el.addEventListener('click', onClick); }
      function fire(el: any) { el.dispatch('click'); }
    `);
    const edge = edgeBetween(b, 'fire', 'onClick');
    expect(edge?.synthesizedBy).toBe('event-channel');
  });

  it('Over-cap channel is dropped, not guessed', async () => {
    const handlers = Array.from({ length: EVENT_CHANNEL_FANOUT_CAP + 1 }, (_, i) => `function h${i}() { return ${i}; }`).join('\n');
    const regs = Array.from({ length: EVENT_CHANNEL_FANOUT_CAP + 1 }, (_, i) => `e.on('busy', h${i});`).join('\n');
    const b = await build(`
      ${handlers}
      function register(e: any) { ${regs} }
      function trigger(e: any) { e.emit('busy'); }
    `);
    // Over the cap → channel dropped entirely, no synthesized edges for it.
    expect(synthEdges(b).filter(e => e.synthesizedBy === 'event-channel')).toHaveLength(0);
  });

  it('At-cap channel still wires (boundary)', async () => {
    const handlers = Array.from({ length: EVENT_CHANNEL_FANOUT_CAP }, (_, i) => `function g${i}() { return ${i}; }`).join('\n');
    const regs = Array.from({ length: EVENT_CHANNEL_FANOUT_CAP }, (_, i) => `e.on('ok', g${i});`).join('\n');
    const b = await build(`
      ${handlers}
      function register(e: any) { ${regs} }
      function trigger(e: any) { e.emit('ok'); }
    `);
    expect(synthEdges(b).length).toBe(EVENT_CHANNEL_FANOUT_CAP);
  });

  it('Synthesized edge carries provenance; direct edges do not', async () => {
    const b = await build(`
      function onMount() { return 1; }
      function helper() { return onMount(); }
      function register(e: any) { e.on('mount', onMount); }
      function trigger(e: any) { e.emit('mount'); }
    `);
    for (const e of b.edges) {
      if (e.confidence === 'synthesized') expect(e.synthesizedBy).toBeTruthy();
      else expect(e.synthesizedBy).toBeUndefined();
    }
    // The direct call helper → onMount stays directly-resolved.
    const direct = edgeBetween(b, 'helper', 'onMount');
    expect(direct?.confidence).not.toBe('synthesized');
    expect(direct?.synthesizedBy).toBeUndefined();
  });

  it('Cross-file registration and dispatch pair by key', async () => {
    const b = await new CallGraphBuilder().build([
      { path: 'src/handlers.ts', content: 'export function onSave() { return 1; }', language: 'TypeScript' },
      { path: 'src/wire.ts', content: `import { onSave } from './handlers';\nfunction reg(e: any) { e.on('save', onSave); }`, language: 'TypeScript' },
      { path: 'src/fire.ts', content: `function go(e: any) { e.emit('save'); }`, language: 'TypeScript' },
    ]);
    const edge = edgeBetween(b, 'go', 'onSave');
    expect(edge?.synthesizedBy).toBe('event-channel');
  });

  it('Direct edges are unchanged by synthesis (only added edges differ)', async () => {
    const content = `
      function onMount() { return 1; }
      function helper() { return onMount(); }
      function register(e: any) { e.on('mount', onMount); }
      function trigger(e: any) { e.emit('mount'); }
    `;
    const b = await build(content);
    const directEdges = b.edges.filter(e => e.confidence !== 'synthesized');
    // Every directly-resolved edge is a real call-resolution edge (no synthesized leakage).
    expect(directEdges.every(e => e.synthesizedBy === undefined)).toBe(true);
    // The synthesis added at least one edge on top of the direct graph.
    expect(synthEdges(b).length).toBeGreaterThan(0);
    expect(b.edges.length).toBe(directEdges.length + synthEdges(b).length);
  });
});

describe('route-handler synthesis (on-disk fixtures)', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'ol-route-')); await mkdir(join(root, 'src'), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('Route is wired to its handler as a synthesized calls edge', async () => {
    const file = join(root, 'src', 'server.ts');
    const content = [
      'function listUsers(req, res) { res.send([]); }',
      'function setup(app) {',
      "  app.get('/users', listUsers);",
      '}',
    ].join('\n');
    await writeFile(file, content, 'utf-8');
    const b = await new CallGraphBuilder().build([{ path: file, content, language: 'TypeScript' }]);
    const setup = idByName(b, 'setup'), handler = idByName(b, 'listUsers');
    const edge = b.edges.find(e => e.callerId === setup && e.calleeId === handler && e.confidence === 'synthesized');
    expect(edge).toBeDefined();
    expect(edge!.synthesizedBy).toBe('route-handler');
    expect(edge!.kind).toBe('calls');
  });
});
