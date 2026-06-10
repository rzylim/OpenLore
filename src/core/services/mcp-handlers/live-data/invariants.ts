/**
 * Spec-09 — invariant assertions over tool output.
 *
 * Pure, dependency-light checks that must hold for ANY tool run against ANY real
 * repo. They OBSERVE current behavior — they impose no new limits (that is
 * spec-10). Budgets are deliberately generous: the point is to catch pathological
 * blowups and leaks, not to enforce spec-10's tighter caps.
 *
 * Everything here is pure and unit-tested offline; the integration suite feeds it
 * real tool output.
 */

import { estimateTokens } from '../../llm-service.js';

/** Generous ceilings — only pathological output trips these. Tunable per spec-10. */
export const BYTE_BUDGET = 2_000_000; // 2 MB serialized
export const TOKEN_BUDGET = 200_000; // estimated tokens

/** High-precision secret signatures. Kept conservative to avoid false positives on
 * structural metadata (function names, paths, counts) — the normal tool output. */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private-key-block', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'slack-token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: 'github-token', re: /gh[pousr]_[0-9A-Za-z]{30,}/ },
  {
    name: 'env-assigned-secret',
    re: /\b(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
  },
];

/** Serialize any handler result deterministically for scanning/budgeting. */
export function serializeResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    // circular or otherwise non-serializable — fall back to a best-effort string
    return String(result);
  }
}

/** Returns the names of any secret patterns detected in `text` (empty = clean). */
export function scanForSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

/**
 * Returns any machine-specific absolute path prefixes leaked into `text`. Tool
 * output should be repo-relative; the runner's home dir or the cache dir's
 * absolute prefix appearing verbatim is a leak (a finding for spec-10).
 */
export function scanForPathLeaks(text: string, forbiddenAbsPaths: string[]): string[] {
  const hits: string[] = [];
  for (const abs of forbiddenAbsPaths) {
    if (abs && abs.length > 1 && text.includes(abs)) hits.push(abs);
  }
  return hits;
}

export interface BudgetReport {
  bytes: number;
  tokens: number;
  withinBudget: boolean;
}

/** Measure serialized size against the generous byte + token budgets. */
export function checkBudget(serialized: string): BudgetReport {
  const bytes = Buffer.byteLength(serialized, 'utf8');
  const tokens = estimateTokens(serialized);
  return { bytes, tokens, withinBudget: bytes <= BYTE_BUDGET && tokens <= TOKEN_BUDGET };
}

/** A structured result is well-formed if it is present and not a bare primitive
 * other than a non-empty string. null/undefined where structure is required fails. */
export function hasValidShape(result: unknown): boolean {
  if (result === null || result === undefined) return false;
  if (typeof result === 'string') return result.length > 0;
  if (typeof result === 'number' || typeof result === 'boolean') return false;
  return typeof result === 'object';
}

/**
 * Minimal per-tool documented-shape contract. Only tools with a clear, stable
 * public shape are listed; everything else is covered by the generic invariants.
 * Each predicate receives the raw handler result. Keep these to the DOCUMENTED
 * shape — do not invent stricter contracts (spec-09 §5.5).
 */
export const REQUIRED_FIELDS: Record<string, (r: unknown) => boolean> = {
  orient: (r) => isObj(r) && hasAnyKey(r, ['functions', 'files', 'specs', 'relevantFunctions']),
  get_subgraph: (r) => isObj(r) && hasAnyKey(r, ['nodes', 'edges']),
  get_architecture_overview: (r) => isObj(r),
};

function isObj(r: unknown): r is Record<string, unknown> {
  return typeof r === 'object' && r !== null && !Array.isArray(r);
}
function hasAnyKey(r: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((k) => k in r);
}

export interface InvariantContext {
  /** Absolute paths that must NOT appear in output (home dir, cache dir, repo dir). */
  forbiddenAbsPaths: string[];
  /** When true, the tool is listed in this repo's expectNonEmpty. */
  expectNonEmpty: boolean;
}

export interface InvariantResult {
  ok: boolean;
  bytes: number;
  tokens: number;
  /** Human-readable failure reasons; empty when ok. */
  failures: string[];
}

/**
 * Run all invariants for one tool×repo result. Does not throw — returns a
 * structured verdict the runner turns into a test assertion + report row.
 * (A handler that itself throws is caught by the runner before this is called.)
 */
export function checkInvariants(
  toolName: string,
  result: unknown,
  ctx: InvariantContext,
): InvariantResult {
  const failures: string[] = [];

  if (!hasValidShape(result)) {
    failures.push('invalid result shape (null/undefined or bare primitive)');
  }

  const serialized = serializeResult(result);

  const secrets = scanForSecrets(serialized);
  if (secrets.length) failures.push(`secret leak: ${secrets.join(', ')}`);

  const leaks = scanForPathLeaks(serialized, ctx.forbiddenAbsPaths);
  if (leaks.length) failures.push(`absolute-path leak: ${leaks.join(', ')}`);

  const budget = checkBudget(serialized);
  if (!budget.withinBudget) {
    failures.push(`over budget: ${budget.bytes}B / ${budget.tokens}tok`);
  }

  const contract = REQUIRED_FIELDS[toolName];
  if (contract && !contract(result)) {
    failures.push(`missing required fields for ${toolName}`);
  }

  if (ctx.expectNonEmpty && !isNonTrivial(result)) {
    failures.push(`expected non-empty data but result was trivial`);
  }

  return { ok: failures.length === 0, bytes: budget.bytes, tokens: budget.tokens, failures };
}

/** Non-trivial = has some content: non-empty string, non-empty array, or an object
 * with at least one non-empty array/string/number field. */
export function isNonTrivial(result: unknown): boolean {
  if (typeof result === 'string') return result.trim().length > 0;
  if (Array.isArray(result)) return result.length > 0;
  if (isObj(result)) {
    return Object.values(result).some((v) => {
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'string') return v.trim().length > 0;
      if (typeof v === 'number') return true;
      if (v && typeof v === 'object') return Object.keys(v).length > 0;
      return false;
    });
  }
  return false;
}
