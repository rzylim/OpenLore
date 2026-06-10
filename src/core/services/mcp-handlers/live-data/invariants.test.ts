/**
 * Spec-09 — invariant helper unit tests. Pure, offline, fast-path. These are the
 * real guards for the secret/path/budget/shape logic the integration suite relies on.
 */
import { describe, it, expect } from 'vitest';
import {
  scanForSecrets,
  scanForPathLeaks,
  checkBudget,
  hasValidShape,
  isNonTrivial,
  serializeResult,
  checkInvariants,
  BYTE_BUDGET,
} from './invariants.js';

describe('scanForSecrets', () => {
  it('detects high-precision secret signatures', () => {
    expect(scanForSecrets('id=AKIAIOSFODNN7EXAMPLE here')).toContain('aws-access-key');
    expect(scanForSecrets('-----BEGIN RSA PRIVATE KEY-----')).toContain('private-key-block');
    expect(scanForSecrets('xoxb-123456789012-abcdefABCDEF')).toContain('slack-token');
    expect(scanForSecrets('PASSWORD=hunter2hunter2')).toContain('env-assigned-secret');
  });

  it('does not flag ordinary structural metadata', () => {
    const text = JSON.stringify({
      functions: ['handleOrient', 'parseConfig'],
      files: ['src/core/analyzer/call-graph.ts'],
      counts: { functions: 3582, edges: 7716 },
    });
    expect(scanForSecrets(text)).toEqual([]);
  });
});

describe('scanForPathLeaks', () => {
  it('flags forbidden absolute prefixes present in output', () => {
    const text = 'file at /Users/alice/.openlore-live-cache/x@sha/src/a.ts';
    expect(scanForPathLeaks(text, ['/Users/alice/.openlore-live-cache'])).toEqual([
      '/Users/alice/.openlore-live-cache',
    ]);
  });
  it('passes repo-relative output', () => {
    expect(scanForPathLeaks('src/a.ts:42', ['/Users/alice', '/tmp/cache'])).toEqual([]);
  });
  it('ignores empty / root forbidden entries', () => {
    expect(scanForPathLeaks('anything', ['', '/'])).toEqual([]);
  });
});

describe('checkBudget', () => {
  it('passes normal output and flags pathological blowups', () => {
    expect(checkBudget('small output').withinBudget).toBe(true);
    const huge = 'x'.repeat(BYTE_BUDGET + 1);
    expect(checkBudget(huge).withinBudget).toBe(false);
  });
});

describe('hasValidShape', () => {
  it('accepts objects, arrays, and non-empty strings', () => {
    expect(hasValidShape({})).toBe(true);
    expect(hasValidShape([])).toBe(true);
    expect(hasValidShape('content')).toBe(true);
  });
  it('rejects null/undefined and bare primitives', () => {
    expect(hasValidShape(null)).toBe(false);
    expect(hasValidShape(undefined)).toBe(false);
    expect(hasValidShape('')).toBe(false);
    expect(hasValidShape(42)).toBe(false);
    expect(hasValidShape(true)).toBe(false);
  });
});

describe('isNonTrivial', () => {
  it('treats populated structures as non-trivial', () => {
    expect(isNonTrivial({ functions: ['a'] })).toBe(true);
    expect(isNonTrivial(['x'])).toBe(true);
    expect(isNonTrivial('hello')).toBe(true);
    expect(isNonTrivial({ count: 5 })).toBe(true);
  });
  it('treats empty structures as trivial', () => {
    expect(isNonTrivial({})).toBe(false);
    expect(isNonTrivial([])).toBe(false);
    expect(isNonTrivial({ functions: [], files: [] })).toBe(false);
    expect(isNonTrivial('')).toBe(false);
  });
});

describe('serializeResult', () => {
  it('returns strings as-is and json-encodes objects', () => {
    expect(serializeResult('raw')).toBe('raw');
    expect(serializeResult({ a: 1 })).toBe('{"a":1}');
  });
  it('survives circular structures without throwing', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => serializeResult(a)).not.toThrow();
  });
});

describe('checkInvariants', () => {
  const ctx = { forbiddenAbsPaths: ['/Users/alice'], expectNonEmpty: false };

  it('passes clean structural output', () => {
    const r = checkInvariants('get_architecture_overview', { functions: 10, edges: 20 }, ctx);
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('fails on a null result', () => {
    const r = checkInvariants('some_tool', null, ctx);
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/invalid result shape/);
  });

  it('enforces documented required fields', () => {
    expect(checkInvariants('orient', { functions: [] }, ctx).ok).toBe(true);
    const bad = checkInvariants('orient', { unrelated: 1 }, ctx);
    expect(bad.failures.join(' ')).toMatch(/missing required fields/);
  });

  it('enforces expectNonEmpty when requested', () => {
    const r = checkInvariants('search_code', { results: [] }, { ...ctx, expectNonEmpty: true });
    expect(r.ok).toBe(false);
    expect(r.failures.join(' ')).toMatch(/expected non-empty/);
  });
});
