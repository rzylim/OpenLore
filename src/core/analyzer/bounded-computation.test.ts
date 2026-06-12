/**
 * Bounded Computation Against Hostile Repositories (spec: openspec/specs/mcp-security/spec.md).
 *
 * Asserts that analyzing an adversarial repository cannot hang or exhaust the
 * server: per-file parsing is size-capped, content regexes run without
 * catastrophic backtracking (ReDoS), and oversized files are skipped WITH
 * disclosure (no silent capping). These are real-execution smoke tests against
 * the actual parsers plus regression guards on the documented caps.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractSignatures } from './signature-extractor.js';
import { normalizeUrl } from './http-route-parser.js';

const ANALYZER_DIR = fileURLToPath(new URL('.', import.meta.url));

/** Run `fn` and assert it completes within `budgetMs` — a ReDoS would blow past it. */
function withinTimeBudget(label: string, budgetMs: number, fn: () => void): void {
  const start = performance.now();
  fn();
  const elapsed = performance.now() - start;
  expect(elapsed, `${label} took ${elapsed.toFixed(0)}ms (budget ${budgetMs}ms) — possible ReDoS`).toBeLessThan(budgetMs);
}

describe('Bounded Computation — ReDoS resilience of content parsers (mcp-security)', () => {
  // Inputs engineered to trigger worst-case backtracking: long unbroken runs,
  // unbalanced brackets, huge whitespace gaps, repeated near-matches. Sized below
  // the 10MB read cap so they exercise the regex path, not the skip path.
  const PATHOLOGICAL = [
    'a'.repeat(200_000),
    '('.repeat(100_000),
    ' '.repeat(200_000) + 'x',
    'function '.repeat(40_000),
    ('import {' + 'a,'.repeat(20_000) + '} from "x"\n'),
    '/* ' + '*'.repeat(200_000), // unterminated block comment
    'def f(' + 'x,'.repeat(20_000) + '):\n',
    ('\t'.repeat(50_000) + 'def g(): pass\n'),
  ].map((s, i) => ({ s, i }));

  const LANGS = ['hostile.ts', 'hostile.py', 'hostile.go', 'hostile.java', 'hostile.rb', 'hostile.rs'];

  for (const file of LANGS) {
    it(`extractSignatures stays linear on adversarial ${extname(file)} content`, () => {
      for (const { s, i } of PATHOLOGICAL) {
        withinTimeBudget(`${file} case#${i}`, 2_000, () => {
          // Must not throw and must return a (possibly empty) signature map.
          const out = extractSignatures(file, s);
          expect(out).toBeTruthy();
        });
      }
    });
  }

  it('normalizeUrl stays linear on adversarial URL strings', () => {
    const urls = [
      '/' + 'a/'.repeat(100_000),
      ':'.repeat(200_000),
      '/{' + 'x'.repeat(200_000) + '}',
      '/' + '%'.repeat(100_000),
    ];
    for (const u of urls) {
      withinTimeBudget('normalizeUrl', 1_000, () => { normalizeUrl(u); });
    }
  });
});

describe('Bounded Computation — documented caps are present (regression guards)', () => {
  it('the file-walker enforces a maximum read size and discloses skips', () => {
    const src = readFileSync(join(ANALYZER_DIR, 'file-walker.ts'), 'utf-8');
    // A per-file size ceiling exists and gates reads.
    expect(src).toMatch(/MAX_READ_SIZE\s*=\s*[\d_]+/);
    expect(src).toMatch(/s\.size\s*>\s*MAX_READ_SIZE/);
    // Skips are counted and surfaced (no silent capping).
    expect(src).toMatch(/skippedCount/);
    expect(src).toMatch(/recordSkip/);
  });

  it('analyze_impact clamps its depth argument to the documented maximum', () => {
    const src = readFileSync(join(ANALYZER_DIR, '..', 'services', 'mcp-handlers', 'graph.ts'), 'utf-8');
    // depth is clamped against SUBGRAPH_MAX_DEPTH_LIMIT before driving BFS.
    expect(src).toMatch(/depth\s*=\s*Math\.max\(\s*1,\s*Math\.min\(\s*depth,\s*SUBGRAPH_MAX_DEPTH_LIMIT/);
  });
});
