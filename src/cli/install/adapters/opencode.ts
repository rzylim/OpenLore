/**
 * opencode adapter — writes an OpenCode plugin (agent-guard.ts) to
 * `.opencode/plugins/` that calls `npx --yes openlore orient --json`
 * on every session start via the `experimental.chat.system.transform`
 * hook, injecting structural context into the system prompt.
 *
 * The file carries a `@generated openlore-install` marker so uninstall
 * only removes files written by install, never hand-written plugins.
 */

import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { previewCreate, previewDiff } from '../diff.js';
import type { Adapter, ApplyContext, ApplyResult, PlannedChange } from './types.js';

const PLUGIN_DIR = '.opencode/plugins';
const PLUGIN_FILE = 'agent-guard.ts';

const GENERATED_MARKER = '// @generated openlore-install';

function renderPlugin(): string {
  return [
    GENERATED_MARKER,
    '/**',
    ' * OpenLore Agent Guard — OpenCode plugin.',
    ' * Re-run `openlore install --agent opencode` to update.',
    ' */',
    'import { spawn } from "node:child_process"',
    'import type { Plugin } from "@opencode-ai/plugin"',
    '',
    'export const AgentGuard: Plugin = async ({ directory }) => {',
    '  return {',
    '    "experimental.chat.system.transform": async (_input, output) => {',
    '      try {',
    '        const child = spawn("npx", ["--yes", "openlore", "orient", "--json"], {',
    '          cwd: directory,',
    '          stdio: ["ignore", "pipe", "pipe"],',
    '          timeout: 15000,',
    '        });',
    '        let result = "";',
    '        for await (const chunk of child.stdout) {',
    '          result += chunk.toString();',
    '        }',
    '        const orient = JSON.parse(result);',
    '        output.system.push(',
    '          "OpenLore context: " + JSON.stringify(orient),',
    '        );',
    '      } catch {',
    '        // orient not available — no context to inject',
    '      }',
    '    },',
    '  };',
    '};',
    '',
  ].join('\n');
}

async function isOurs(filePath: string): Promise<boolean> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return raw.includes(GENERATED_MARKER);
  } catch {
    return false;
  }
}

export const opencodeAdapter: Adapter = {
  name: 'opencode',
  async apply(ctx: ApplyContext): Promise<ApplyResult> {
    const filePath = join(ctx.root, PLUGIN_DIR, PLUGIN_FILE);
    const desired = renderPlugin();
    let existing: string | null = null;
    try {
      existing = await readFile(filePath, 'utf8');
    } catch {
      existing = null;
    }

    if (existing !== null) {
      const ours = existing.includes(GENERATED_MARKER);
      if (!ours && !ctx.force) {
        return {
          changes: [
            {
              path: filePath,
              kind: 'noop',
              summary: `${PLUGIN_FILE}: refused to overwrite non-OpenLore plugin (use --force)`,
            },
          ],
          warnings: [
            `${PLUGIN_FILE} exists but was not written by OpenLore — pass --force to overwrite`,
          ],
          conflict: true,
        };
      }
      if (existing === desired) {
        return {
          changes: [
            {
              path: filePath,
              kind: 'noop',
              summary: `${PLUGIN_FILE}: already up to date`,
            },
          ],
          warnings: [],
          conflict: false,
        };
      }
    }

    const change: PlannedChange = {
      path: filePath,
      kind: existing === null ? 'create' : 'update',
      summary:
        existing === null
          ? `create ${PLUGIN_FILE}`
          : `update ${PLUGIN_FILE}`,
      preview:
        existing === null
          ? previewCreate(filePath, desired)
          : previewDiff(filePath, existing!, desired),
    };

    if (!ctx.dryRun) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, desired, 'utf8');
    }

    return { changes: [change], warnings: [], conflict: false };
  },

  async uninstall(ctx: ApplyContext): Promise<ApplyResult> {
    const filePath = join(ctx.root, PLUGIN_DIR, PLUGIN_FILE);
    if (!(await isOurs(filePath))) {
      return { changes: [], warnings: [], conflict: false };
    }

    if (!ctx.dryRun) {
      await unlink(filePath);
    }

    return {
      changes: [
        {
          path: filePath,
          kind: 'delete',
          summary: `remove ${PLUGIN_FILE}`,
        },
      ],
      warnings: [],
      conflict: false,
    };
  },
};
