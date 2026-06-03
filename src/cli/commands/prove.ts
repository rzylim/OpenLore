/**
 * `openlore prove` (Spec 25 Q2) — measure OpenLore's token value on the user's
 * OWN repo and print a personal scorecard. Runs a WITH/WITHOUT agent pass over
 * a few graph-derived orientation tasks, isolated with --strict-mcp-config, and
 * reports cost / round-trips / correctness deltas + an honest verdict.
 *
 * The substrate needs no API key; this command's agent arm does (it shells out
 * to `claude`). When `claude` is absent it fails fast with guidance; `--dry-run`
 * exercises the whole pipeline with clearly-labelled synthetic numbers.
 */

import { Command } from 'commander';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';
import { readCachedContext } from '../../core/services/mcp-handlers/utils.js';
import { deriveTasks, scoreAnswer, type GraphFact, type ProveTask } from '../../core/agent-eval/tasks.js';
import {
  claudeRunner, writeProveMcpConfigs, summarize, parseAgentJson,
  type AgentRunner, type Condition, type Metrics, type Cell,
} from '../../core/agent-eval/measure.js';
import { computeScorecard, renderScorecard } from '../../core/agent-eval/scorecard.js';

interface ProveOptions {
  directory?: string;
  runs?: string;
  model?: string;
  maxBudgetUsd?: string;
  dryRun?: boolean;
}

/** Locate this CLI's own entry so the spawned MCP server is the same build. */
function localCliEntry(): string {
  // dist/cli/commands/prove.js → dist/cli/index.js
  return resolve(fileURLToPath(import.meta.url), '..', '..', 'index.js');
}

/** Build GraphFacts from the analysis EdgeStore (the call graph). */
async function loadGraphFacts(absDir: string): Promise<GraphFact[] | null> {
  const ctx = await readCachedContext(absDir);
  const store = ctx?.edgeStore;
  if (!store) return null;
  const nodes = store.getAllInternalNodes();
  return nodes.map(n => {
    const callerNames = store.getCallers(n.id)
      .map(e => store.getNode(e.callerId)).filter(x => x && !x.isExternal).map(x => x!.name);
    const calleeNames = store.getCallees(n.id)
      .map(e => store.getNode(e.calleeId)).filter(x => x && !x.isExternal).map(x => x!.name);
    // Entry point = no internal callers (matches the analyzer's definition).
    return { name: n.name, filePath: n.filePath, isEntryPoint: callerNames.length === 0, callerNames, calleeNames };
  });
}

function claudeAvailable(): boolean {
  try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Synthetic metrics for --dry-run: WITH is cheaper + fewer turns, both correct. */
function mockRun(task: ProveTask, condition: Condition, runIdx: number): Metrics {
  const withCond = condition === 'with';
  const base = (task.id.length + runIdx) % 4;
  const answer = `[mock] ${task.mustIncludeAny[0] ?? 'answer'}`;
  return {
    freshInputTokens: withCond ? 4000 + base * 100 : 13000 + base * 400,
    cacheReadTokens: withCond ? 30000 : 6000,
    outputTokens: withCond ? 300 : 800,
    costUsd: withCond ? 0.040 + base * 0.001 : 0.052 + base * 0.003,
    numTurns: withCond ? 3 + (base % 2) : 7 + base,
    durationMs: withCond ? 9000 : 24000,
    answer,
    correct: scoreAnswer(task, answer),
  };
}

function runOne(
  task: ProveTask, condition: Condition, runIdx: number,
  cfg: { withPath: string; withoutPath: string; systemPrompt: string },
  opts: { cwd: string; model: string; maxBudgetUsd: number; dryRun: boolean; runner: AgentRunner },
): Metrics {
  if (opts.dryRun) return mockRun(task, condition, runIdx);
  try {
    const raw = opts.runner({
      prompt: task.prompt,
      mcpConfigPath: condition === 'with' ? cfg.withPath : cfg.withoutPath,
      cwd: opts.cwd,
      model: opts.model,
      maxBudgetUsd: opts.maxBudgetUsd,
      systemPrompt: condition === 'with' ? cfg.systemPrompt : undefined,
    });
    const parsed = parseAgentJson(raw);
    return { ...parsed, correct: scoreAnswer(task, parsed.answer) };
  } catch (err) {
    return {
      freshInputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costUsd: 0, numTurns: 0,
      durationMs: 0, answer: '', correct: false, error: (err as Error).message,
    };
  }
}

/**
 * Core (testable) prove run: derive tasks, run both arms N times, return the
 * scorecard text. `runner` is injectable so tests never call a real agent.
 */
export async function runProve(opts: {
  directory: string;
  runs: number;
  model: string;
  maxBudgetUsd: number;
  dryRun: boolean;
  runner?: AgentRunner;
}): Promise<{ ok: boolean; message: string }> {
  const absDir = resolve(opts.directory);
  const facts = await loadGraphFacts(absDir);
  if (!facts) {
    return { ok: false, message: 'No analysis graph found. Run "openlore analyze" first, then "openlore prove".' };
  }
  const tasks = deriveTasks(facts);
  if (tasks.length === 0) {
    return { ok: false, message: 'Could not derive orientation tasks — the call graph is too sparse (need functions with ≥2 callers). Try a larger repo.' };
  }

  const work = mkdtempSync(join(tmpdir(), 'openlore-prove-'));
  const cfg = writeProveMcpConfigs(work, localCliEntry());
  const runner = opts.runner ?? claudeRunner;

  const withRuns: Metrics[] = [];
  const withoutRuns: Metrics[] = [];
  for (const task of tasks) {
    for (let i = 0; i < opts.runs; i++) {
      withoutRuns.push(runOne(task, 'without', i, cfg, { cwd: absDir, ...opts, runner }));
      withRuns.push(runOne(task, 'with', i, cfg, { cwd: absDir, ...opts, runner }));
    }
  }

  const withoutCell: Cell = summarize(withoutRuns);
  const withCell: Cell = summarize(withRuns);
  const sc = computeScorecard(withoutCell, withCell);
  return { ok: true, message: renderScorecard(sc, { tasks: tasks.length, mock: opts.dryRun }) };
}

export const proveCommand = new Command('prove')
  .description("Measure OpenLore's token value on YOUR repo (WITH vs WITHOUT, personal scorecard)")
  .option('--directory <path>', 'Repo to measure (default: current directory)')
  .option('--runs <n>', 'Runs per arm per task — more = less noise (default: 2)')
  .option('--model <name>', 'Agent model (default: sonnet)')
  .option('--max-budget-usd <n>', 'Per-agent-call USD ceiling (default: 0.5)')
  .option('--dry-run', 'Exercise the pipeline with synthetic numbers (no agent, no API key)', false)
  .addHelpText('after', `
Measures fewer-round-trips / lower-cost at equal correctness over a few tasks
auto-derived from your call graph. The agent arm shells out to \`claude\` (needs
an API key); the openlore substrate itself needs none.

Examples:
  $ openlore prove --dry-run         See the scorecard shape with synthetic data
  $ openlore prove --runs 4          Real measurement (needs claude + API key)
`)
  .action(async (opts: ProveOptions) => {
    const directory = opts.directory ?? process.cwd();
    const runs = opts.runs ? Math.max(1, parseInt(opts.runs, 10)) : 2;
    const model = opts.model ?? 'sonnet';
    const maxBudgetUsd = opts.maxBudgetUsd ? parseFloat(opts.maxBudgetUsd) : 0.5;
    const dryRun = opts.dryRun ?? false;

    if (!dryRun && !claudeAvailable()) {
      logger.error('`claude` CLI not found on PATH — the prove agent arm needs it (plus an API key).');
      logger.info('Try', 'Install the Claude CLI, or run `openlore prove --dry-run` to preview the scorecard shape.');
      process.exitCode = 1;
      return;
    }

    logger.section('openlore prove');
    if (!dryRun) {
      logger.discovery(`Running ${runs} run(s)/arm over graph-derived tasks (this calls \`claude\` and costs money)…`);
    }
    const result = await runProve({ directory, runs, model, maxBudgetUsd, dryRun });
    if (!result.ok) {
      logger.error(result.message);
      process.exitCode = 1;
      return;
    }
    console.log(result.message);
  });
