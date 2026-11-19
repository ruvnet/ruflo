/**
 * Real-binary contract for the external agentdb and agentic-flow plugins (ADR-518, on top of ADR-484 and ADR-504).
 *
 * ruflo's marketplace lists these two plugins by a git-subdir source pinned to a commit in their own repositories.
 * This tier checks out exactly that pinned commit and runs the REAL `claude` binary against it with the scripted mock
 * model (no API key, isolated HOME and config), asserting behaviour rather than exit codes. A hooks module the loader
 * refuses gives exit 0 and no error anywhere; what changes is that the mod's own command is not answered. So:
 *
 *  - loads: the mod registers its command at session start and answers it itself, with zero model requests;
 *  - negative control: a copy with a second bare `on('session.start')` (the #4485 shape) is refused by the real
 *    loader, and the same assertions fail on it, so the contract cannot pass vacuously.
 *
 * The plugins' MCP servers are not started here (`--strict-mcp-config`, as the rest of this tier); their tool
 * surface is covered by each plugin's own `claude plugin test` and smoke.sh, which ruflo's validate-marketplace and
 * smoke-all-plugins jobs run against the same pinned commit.
 *
 * Local runs can point at a working copy instead of the pin: RUFLO_EXTERNAL_PLUGIN_DIR_AGENTDB /
 * RUFLO_EXTERNAL_PLUGIN_DIR_AGENTIC_FLOW (a plugin directory).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { claudeVersion, describeRun, REPO_ROOT, runClaude, type RunResult } from './run';

interface External {
  name: string;
  /** The slash command the mod registers and answers itself. */
  command: string;
  /** Text the mod's answer must contain. */
  answer: RegExp;
  envDir: string;
}

const PLUGINS: External[] = [
  { name: 'agentdb', command: 'agentdb-guard', answer: /\/agentdb-guard status/, envDir: 'RUFLO_EXTERNAL_PLUGIN_DIR_AGENTDB' },
  { name: 'agentic-flow', command: 'agentic-flow-guard', answer: /agentic-flow: guard (enforce|notify|off)/, envDir: 'RUFLO_EXTERNAL_PLUGIN_DIR_AGENTIC_FLOW' },
];

const marketplace = JSON.parse(readFileSync(join(REPO_ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const temps: string[] = [];
const runs: RunResult[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
});
afterAll(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The plugin directory at the marketplace's pinned commit (or the env override). */
function pluginDirFor(p: External): string {
  const override = process.env[p.envDir];
  if (override) return override;
  const entry = marketplace.plugins.find((x: any) => x.name === p.name);
  expect(entry, `${p.name} is not listed in .claude-plugin/marketplace.json`).toBeTruthy();
  const s = entry.source;
  expect(s?.source).toBe('git-subdir');
  const dir = mkdtempSync(join(tmpdir(), `ruflo-ext-${p.name}-`));
  temps.push(dir);
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, GIT_TERMINAL_PROMPT: '0' };
  for (const args of [['init', '-q'], ['remote', 'add', 'origin', s.url], ['fetch', '-q', '--depth', '1', 'origin', s.sha], ['checkout', '-q', 'FETCH_HEAD']]) {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env, timeout: 120_000 });
    expect(r.status, `git ${args[0]} for ${p.name}: ${r.stderr}`).toBe(0);
  }
  return join(dir, s.path);
}

/** What the run shows when the mod's hooks module was accepted: its own answer, with no model turn. Commands a mod
 * registers at session.start are not listed in the init event's slash_commands, so the answer is the signal. */
function signals(run: RunResult) {
  const result = run.events.find((e) => e.type === 'result');
  return {
    reply: typeof result?.result === 'string' ? result.result : '',
    modelRequests: run.scripted.length,
  };
}

describe('real binary: external agentdb and agentic-flow plugins load at their pinned commits (ADR-518)', () => {
  beforeAll(() => {
    expect(claudeVersion(), 'the claude binary could not be started').toBeTruthy();
  });

  for (const p of PLUGINS) {
    it(`${p.name}: the loader accepts the mod, which answers /${p.command} itself`, async () => {
      const run = await runClaude({ prompt: `/${p.command}`, pluginDir: pluginDirFor(p) });
      runs.push(run);
      expect(run.exitCode, describeRun(run)).toBe(0);
      const s = signals(run);
      expect(s.reply, describeRun(run)).toMatch(p.answer);
      expect(s.modelRequests).toBe(0);
    }, 180_000);

    it(`${p.name}: negative control: a copy with a second bare session.start is refused`, async () => {
      const copy = mkdtempSync(join(tmpdir(), `ruflo-ext-neg-${p.name}-`));
      temps.push(copy);
      cpSync(pluginDirFor(p), copy, { recursive: true });
      // Inject a second bare session.start into register(): the #4485 shape the real loader refuses.
      const reg = join(copy, 'hooks/register.ts');
      const before = readFileSync(reg, 'utf8');
      const src = before.replace(
        /(export const register: Register = \(on(?:, [a-zA-Z_]+)?\) => \{)/,
        "$1\n  on('session.start', async ($, e, next) => next(e))",
      );
      expect(src, 'register() signature not found; update the negative control').not.toBe(before);
      writeFileSync(reg, src);
      const run = await runClaude({ prompt: `/${p.command}`, pluginDir: copy });
      runs.push(run);
      const s = signals(run);
      expect(p.answer.test(s.reply) && s.modelRequests === 0, describeRun(run)).toBe(false);
    }, 180_000);
  }
});
