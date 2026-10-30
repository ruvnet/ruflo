/**
 * Contract 1 (ADR-504 §2.3): with every boolean option on, the REAL Claude Code loader accepts ruflo-mods.
 *
 * #4485 shipped because the harness only imitated the loader. A module the real loader refuses gives no error anywhere
 * a test would look: exit 0, empty stderr, `result: success`, and the plugin still listed in `init.plugins`. What
 * changes is behaviour, so this contract asserts behaviour: the mod's session-start heartbeat is written, its
 * `/ruflo-mods` command is registered, and that command is answered by the mod without a single model request.
 *
 * The negative control rebuilds the #4485 shape in a throwaway copy (a second `session.start` with no matcher) and
 * shows the same assertions fail on it, so the contract cannot pass vacuously.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { allBooleanOptions, claudeVersion, describeRun, RUFLO_MODS_DIR, runClaude, type RunResult } from './run';

const HEARTBEAT = '.claude-flow/mods/session.json';
const runs: RunResult[] = [];
const temps: string[] = [];
afterEach(() => {
  for (const run of runs.splice(0)) run.cleanup();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What the real engine shows when the mod's hooks module was accepted. */
function loadedSignals(run: RunResult) {
  const init = run.events.find((e) => e.type === 'system' && e.subtype === 'init');
  const reply = run.events.find((e) => e.type === 'assistant')?.message;
  const heartbeat = run.file(HEARTBEAT);
  return {
    heartbeat: heartbeat !== undefined,
    events: heartbeat ? (JSON.parse(heartbeat).events as string[] | undefined) : undefined,
    command: Array.isArray(init?.slash_commands) && init.slash_commands.includes('ruflo-mods'),
    modelRequests: run.scripted.length,
    reply: reply?.content?.map((b: any) => b.text ?? '').join('') ?? '',
  };
}

describe('real binary: ruflo-mods loads with every option on (contract 1)', () => {
  beforeAll(() => {
    // Fail, never skip, when the binary is missing (ADR-504 §2.4).
    expect(claudeVersion(), 'the claude binary could not be started').toBeTruthy();
  });

  it('the loader accepts the module: heartbeat written, /ruflo-mods registered and answered by the mod', async () => {
    const run = await runClaude({ prompt: '/ruflo-mods', options: allBooleanOptions(true) });
    runs.push(run);
    expect(run.exitCode, describeRun(run)).toBe(0);
    const s = loadedSignals(run);
    expect(s.heartbeat, describeRun(run)).toBe(true);
    // With capabilityProbe on, the heartbeat names the events the engine actually exposes; session.start must be one.
    expect(s.events).toContain('session.start');
    expect(s.command).toBe(true);
    expect(s.reply).toMatch(/^ruflo-mods: ruflo mods/);
    expect(s.modelRequests).toBe(0);
  });

  it('negative control: a #4485-shaped copy (second bare session.start) is refused by the real loader', async () => {
    const copy = mkdtempSync(join(tmpdir(), 'ruflo-mods-4485-'));
    temps.push(copy);
    cpSync(RUFLO_MODS_DIR, copy, { recursive: true, dereference: true });
    const register = join(copy, 'hooks/register.ts');
    const source = readFileSync(register, 'utf8');
    const end = source.lastIndexOf('}');
    writeFileSync(register, `${source.slice(0, end)}  on('session.start', async ($, e, next) => next(e)) // #4485 shape\n${source.slice(end)}`);

    const run = await runClaude({
      prompt: '/ruflo-mods',
      options: allBooleanOptions(true, copy),
      pluginDir: copy,
      script: [{ content: [{ type: 'text', text: 'the model answered' }] }],
    });
    runs.push(run);
    const s = loadedSignals(run);
    // Nothing reports the refusal: the run "succeeds". Only behaviour shows the hooks never ran.
    expect(run.exitCode, describeRun(run)).toBe(0);
    expect(s.heartbeat).toBe(false);
    expect(s.command).toBe(false);
    expect(s.modelRequests).toBe(1);
    expect(s.reply).toBe('the model answered');
  });
});
