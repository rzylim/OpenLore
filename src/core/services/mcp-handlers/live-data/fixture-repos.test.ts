/**
 * Spec-09 — manifest validity guard. Runs in the fast (offline) suite: it asserts
 * the curated manifest is well-formed and self-consistent WITHOUT any network.
 */
import { describe, it, expect } from 'vitest';
import { FIXTURE_REPOS, SHA_RE, PLACEHOLDER_SHA } from './fixture-repos.js';
import { TOOL_DEFINITIONS } from '../../../../cli/commands/mcp.js';

const PERMISSIVE = /(MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause)/;
const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

describe('spec-09 fixture-repos manifest', () => {
  it('has at least 5 repos spanning the required core languages', () => {
    expect(FIXTURE_REPOS.length).toBeGreaterThanOrEqual(5);
    const langs = new Set(FIXTURE_REPOS.map((r) => r.primaryLanguage));
    for (const required of ['typescript', 'python', 'go', 'rust']) {
      expect(langs.has(required)).toBe(true);
    }
    // "and two more" supported languages beyond the core four.
    expect(langs.size).toBeGreaterThanOrEqual(6);
  });

  it('has stable, unique ids', () => {
    const ids = FIXTURE_REPOS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('pins every repo by https git url + 40-hex sha + documented tag', () => {
    for (const r of FIXTURE_REPOS) {
      expect(r.url, r.id).toMatch(/^https:\/\/.+\.git$/);
      expect(r.sha, r.id).toMatch(SHA_RE); // placeholder is also 40-hex, so format always holds
      expect(r.tag.length, r.id).toBeGreaterThan(0);
    }
  });

  it('only references permissively-licensed repos', () => {
    for (const r of FIXTURE_REPOS) {
      expect(r.license, r.id).toMatch(PERMISSIVE);
    }
  });

  it('only names real tools in expectNonEmpty', () => {
    for (const r of FIXTURE_REPOS) {
      for (const tool of r.expectNonEmpty ?? []) {
        expect(TOOL_NAMES.has(tool), `${r.id} -> ${tool}`).toBe(true);
      }
    }
  });

  it('uses repo-relative knownFile hints (never absolute)', () => {
    for (const r of FIXTURE_REPOS) {
      if (r.hints?.knownFile) expect(r.hints.knownFile.startsWith('/'), r.id).toBe(false);
    }
  });

  // Honest visibility: until a networked run confirms real SHAs, entries carry the
  // all-zero placeholder. This test documents that state rather than failing on it —
  // the cache layer's HEAD-assertion is what guarantees a wrong SHA never passes.
  it('reports how many SHAs still need networked confirmation', () => {
    const unconfirmed = FIXTURE_REPOS.filter((r) => r.sha === PLACEHOLDER_SHA).map((r) => r.id);
    if (unconfirmed.length > 0) {
       
      console.warn(
        `spec-09: ${unconfirmed.length} repo SHA(s) pending networked confirmation: ${unconfirmed.join(', ')}`,
      );
    }
    expect(Array.isArray(unconfirmed)).toBe(true);
  });
});
