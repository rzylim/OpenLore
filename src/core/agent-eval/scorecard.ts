/**
 * Personal token-value scorecard (Spec 25 Q2). Turns paired WITH/WITHOUT cells
 * into the honest "does it help on YOUR repo?" verdict — the same metrics the
 * README Value Scorecard publishes (cost + round-trips at equal correctness),
 * measured locally. Pure + deterministic.
 */

import type { Cell } from './measure.js';

export type Verdict = 'helps' | 'break-even' | "doesn't help here";

export interface Scorecard {
  costWithout: number;
  costWith: number;
  costDeltaPct: number;
  turnsWithout: number;
  turnsWith: number;
  turnsDeltaPct: number;
  correctWithout: number;
  correctWith: number;
  freshWithout: number;
  freshWith: number;
  runsPerArm: number;
  verdict: Verdict;
}

const pctDelta = (without: number, withv: number): number =>
  without === 0 ? 0 : Math.round(((withv - without) / without) * 100);

/**
 * Verdict rule, deliberately conservative and honest:
 * - if WITH is less correct than WITHOUT → "doesn't help here" (never trade accuracy)
 * - else if cost AND round-trips both improve by >5% → "helps"
 * - else if either regresses by >5% → "doesn't help here"
 * - otherwise → "break-even"
 */
export function verdict(sc: Omit<Scorecard, 'verdict'>): Verdict {
  if (sc.correctWith + 1e-9 < sc.correctWithout) return "doesn't help here";
  const cost = sc.costDeltaPct;
  const turns = sc.turnsDeltaPct;
  if (cost <= -5 && turns <= -5) return 'helps';
  if (cost >= 5 || turns >= 5) return "doesn't help here";
  return 'break-even';
}

export function computeScorecard(without: Cell, withCell: Cell): Scorecard {
  const base: Omit<Scorecard, 'verdict'> = {
    costWithout: without.costUsd,
    costWith: withCell.costUsd,
    costDeltaPct: pctDelta(without.costUsd, withCell.costUsd),
    turnsWithout: without.numTurns,
    turnsWith: withCell.numTurns,
    turnsDeltaPct: pctDelta(without.numTurns, withCell.numTurns),
    correctWithout: without.correctRate,
    correctWith: withCell.correctRate,
    freshWithout: without.freshInputTokens,
    freshWith: withCell.freshInputTokens,
    runsPerArm: Math.min(without.runs, withCell.runs),
  };
  return { ...base, verdict: verdict(base) };
}

const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const pct = (r: number): string => `${Math.round(r * 100)}%`;

/** Render the scorecard as a human-readable block for the terminal. */
export function renderScorecard(sc: Scorecard, opts: { tasks: number; mock?: boolean }): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  OpenLore — personal token-value scorecard');
  lines.push('  ' + '─'.repeat(48));
  if (opts.mock) {
    lines.push('  ⚠ DRY RUN — synthetic numbers, no agent was called. Run without --dry-run for real measurement.');
  }
  lines.push(`  Tasks: ${opts.tasks}   Runs/arm: ${sc.runsPerArm}   (WITHOUT vs WITH openlore)`);
  lines.push('');
  lines.push(`  Cost          $${sc.costWithout.toFixed(3)}  →  $${sc.costWith.toFixed(3)}   (${sign(sc.costDeltaPct)}%)`);
  lines.push(`  Round-trips   ${sc.turnsWithout.toFixed(0)}  →  ${sc.turnsWith.toFixed(0)}   (${sign(sc.turnsDeltaPct)}%)`);
  lines.push(`  Fresh tokens  ${sc.freshWithout.toFixed(0)}  →  ${sc.freshWith.toFixed(0)}`);
  lines.push(`  Correctness   ${pct(sc.correctWithout)}  →  ${pct(sc.correctWith)}`);
  lines.push('');
  const verdictLabel =
    sc.verdict === 'helps' ? '✅ OpenLore helps on this repo'
      : sc.verdict === 'break-even' ? '➖ Break-even on this repo'
        : "❌ OpenLore doesn't help here";
  lines.push(`  Verdict: ${verdictLabel}`);
  if (sc.runsPerArm < 3) {
    lines.push('  (sample is small — LLM runs are noisy; use --runs 4+ for a firmer number)');
  }
  lines.push('');
  return lines.join('\n');
}
