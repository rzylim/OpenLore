import { describe, it, expect } from 'vitest';
import { parseArchitectureRules, parseInvariantMarkers, rulesAreInert } from './rules.js';

describe('parseArchitectureRules', () => {
  it('parses layers, forbidden, and allowedOnly', () => {
    const { rules, warnings } = parseArchitectureRules(
      {
        layers: { cli: ['src/cli'], core: ['src/core'], utils: ['src/utils'] },
        forbidden: [{ from: 'src/core', to: 'src/cli', reason: 'core stays UI-agnostic' }],
        allowedOnly: [{ module: 'src/api', mayDependOn: ['src/core', 'src/types'] }],
      },
      'config',
    );
    expect(warnings).toEqual([]);
    expect(rules).toHaveLength(3);
    const layers = rules.find(r => r.kind === 'layers');
    expect(layers).toBeTruthy();
    const forbidden = rules.find(r => r.kind === 'forbidden');
    expect(forbidden).toMatchObject({ from: 'src/core', to: 'src/cli', reason: 'core stays UI-agnostic', source: 'config' });
  });

  it('warns and skips malformed entries — never throws', () => {
    const { rules, warnings } = parseArchitectureRules(
      {
        layers: { onlyOne: ['src/x'] }, // <2 layers → no direction
        forbidden: [{ from: 'src/core' }, { from: 'a', to: 'b' }], // first missing "to"
        allowedOnly: [{ module: 'src/api', mayDependOn: 'not-an-array' }],
      },
      'config',
    );
    // Only the valid forbidden rule survives.
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'forbidden', from: 'a', to: 'b' });
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('returns a warning (not a throw) on non-object input', () => {
    expect(() => parseArchitectureRules(null, 'config')).not.toThrow();
    expect(parseArchitectureRules(42, 'config').warnings).toHaveLength(1);
  });

  it('rulesAreInert reflects an empty rule set', () => {
    expect(rulesAreInert({ rules: [], warnings: [] })).toBe(true);
    expect(rulesAreInert(parseArchitectureRules({ forbidden: [{ from: 'a', to: 'b' }] }, 'config'))).toBe(false);
  });
});

describe('parseInvariantMarkers', () => {
  it('parses forbidden and allowedOnly markers from ADR text', () => {
    const text = [
      '# ADR 0001',
      'Some prose.',
      '- Invariant: forbidden src/core -> src/cli (core stays UI-agnostic)',
      '> Invariant: allowedOnly src/api -> src/core, src/types',
      'Invariant: nonsense that does not parse',
    ].join('\n');
    const rules = parseInvariantMarkers(text);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ kind: 'forbidden', from: 'src/core', to: 'src/cli', reason: 'core stays UI-agnostic', source: 'decision' });
    expect(rules[1]).toMatchObject({ kind: 'allowedOnly', module: 'src/api', mayDependOn: ['src/core', 'src/types'], source: 'decision' });
  });

  it('returns nothing when there are no markers', () => {
    expect(parseInvariantMarkers('no markers here\njust text')).toEqual([]);
  });
});
