/**
 * Spec-09 — summary report. A tool×repo matrix of pass/fail/skip with output
 * sizes, printed as a compact table and written as a JSON artifact to the
 * gitignored cache dir so a regression is diagnosable after the fact.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cacheDir } from './repo-cache.js';

export type RowStatus = 'pass' | 'fail' | 'skip';

export interface ReportRow {
  tool: string;
  repo: string;
  status: RowStatus;
  bytes: number;
  tokens: number;
  /** Failure reason (fail) or skip reason (skip). */
  detail?: string;
}

export interface ReportSummary {
  rows: ReportRow[];
  totals: { pass: number; fail: number; skip: number };
  generatedFromRepos: string[];
}

export function summarize(rows: ReportRow[], repos: string[]): ReportSummary {
  const totals = { pass: 0, fail: 0, skip: 0 };
  for (const r of rows) totals[r.status]++;
  return { rows, totals, generatedFromRepos: repos };
}

function fmtBytes(n: number): string {
  if (n <= 0) return '-';
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / (1024 * 1024)).toFixed(1)}M`;
}

const MARK: Record<RowStatus, string> = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };

/** Print a compact, human-readable matrix. */
export function printReport(summary: ReportSummary): void {
  const lines: string[] = [];
  lines.push('');
  lines.push('live-data: tool × repo result matrix');
  lines.push(
    `  ${'tool'.padEnd(30)} │ ${'repo'.padEnd(16)} │ ${'status'.padEnd(6)} │ ${'bytes'.padStart(7)} │ ${'tokens'.padStart(7)} │ detail`,
  );
  lines.push(`  ${'-'.repeat(30)}-┼-${'-'.repeat(16)}-┼-${'-'.repeat(6)}-┼-${'-'.repeat(7)}-┼-${'-'.repeat(7)}-┼------`);
  for (const r of summary.rows) {
    lines.push(
      `  ${r.tool.padEnd(30)} │ ${r.repo.padEnd(16)} │ ${MARK[r.status].padEnd(6)} │ ${fmtBytes(r.bytes).padStart(7)} │ ${String(r.tokens || '-').padStart(7)} │ ${r.detail ?? ''}`,
    );
  }
  lines.push('');
  lines.push(
    `  totals: ${summary.totals.pass} pass · ${summary.totals.fail} fail · ${summary.totals.skip} skip ` +
      `(repos: ${summary.generatedFromRepos.join(', ') || 'none'})`,
  );
  lines.push('');
   
  console.log(lines.join('\n'));
}

/** Write the JSON report to the gitignored cache dir; returns the file path. */
export async function writeReport(summary: ReportSummary): Promise<string> {
  const path = join(cacheDir(), 'live-data-report.json');
  await writeFile(path, JSON.stringify(summary, null, 2));
  return path;
}
