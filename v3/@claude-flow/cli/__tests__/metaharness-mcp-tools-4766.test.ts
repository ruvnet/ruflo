import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { metaharnessTools } from '../src/mcp-tools/metaharness-tools.js';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, existsSync: vi.fn(fs.existsSync) };
});
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => { throw new Error('Unexpected MetaHarness subprocess'); }),
}));

const harnessMissing = 'metaharness-not-available';
const darwinMissing = 'metaharness-darwin-not-available';

interface ScriptCase {
  name: string;
  script: string;
  input?: Record<string, unknown>;
  reason?: string;
  exitCode?: number;
}

// audit-list, audit-trend, and file-based similarity do not require MetaHarness.
// They share the missing-plugin fallback but need no synthetic package error.
const cases: ScriptCase[] = [
  { name: 'metaharness_score', script: 'score.mjs', reason: harnessMissing },
  { name: 'metaharness_genome', script: 'genome.mjs', reason: harnessMissing },
  { name: 'metaharness_mcp_scan', script: 'mcp-scan.mjs', reason: harnessMissing },
  { name: 'metaharness_threat_model', script: 'threat-model.mjs', reason: harnessMissing },
  { name: 'metaharness_oia_audit', script: 'oia-audit.mjs', input: { dryRun: true }, reason: harnessMissing },
  { name: 'metaharness_audit_list', script: 'audit-list.mjs' },
  { name: 'metaharness_similarity', script: 'similarity.mjs', input: { aFile: 'a.json', bFile: 'b.json' } },
  {
    name: 'metaharness_drift_from_history', script: 'drift-from-history.mjs',
    input: { baselineFile: 'baseline.json', dryRun: true }, reason: harnessMissing, exitCode: 3,
  },
  { name: 'metaharness_audit_trend', script: 'audit-trend.mjs', input: { baselineFile: 'a.json', currentFile: 'b.json' } },
  { name: 'metaharness_evolve', script: 'evolve.mjs', input: { repo: '.', sandbox: 'mock', confirm: true }, reason: darwinMissing },
  { name: 'metaharness_security_bench', script: 'security-bench.mjs', reason: darwinMissing },
  { name: 'metaharness_bench', script: 'bench.mjs', input: { op: 'verify', suite: 'suite.json' }, reason: darwinMissing },
  { name: 'metaharness_redblue', script: 'redblue.mjs', input: { subcommand: 'run', mockJudge: true }, reason: 'metaharness-redblue-not-available' },
  { name: 'metaharness_learn', script: 'learn.mjs', input: { run: true }, reason: harnessMissing },
  { name: 'metaharness_gepa', script: 'gepa.mjs', input: { op: 'validate', path: 'genome.json' }, reason: darwinMissing },
];

const mockExists = vi.mocked(existsSync);
const mockSpawn = vi.mocked(spawn);

afterEach(() => {
  mockExists.mockReset();
  mockSpawn.mockReset();
});

it('covers every script-backed MetaHarness tool', () => {
  const scriptTools = metaharnessTools.filter(({ name }) => name !== 'metaharness_flywheel');
  expect(scriptTools.map(({ name }) => name).sort()).toEqual(cases.map(({ name }) => name).sort());
});

describe.each(cases)('$name', ({ name, script, input = {}, reason, exitCode = 0 }) => {
  async function invoke() {
    const tool = metaharnessTools.find((entry) => entry.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    return tool.handler(input);
  }

  it('returns a successful degraded response without spawning when the plugin is missing', async () => {
    mockExists.mockReturnValue(false);

    expect(await invoke()).toEqual({
      success: true,
      data: { degraded: true, reason: 'plugin-not-found' },
      degraded: true,
      exitCode: 0,
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  if (reason) {
    it('preserves the reason and exit status when the script reports a missing dependency', async () => {
      mockExists.mockReturnValue(true);
      const payload = { degraded: true, reason };
      const stdout = new PassThrough();
      const child = Object.assign(new EventEmitter(), { stdout, stderr: new PassThrough() });
      mockSpawn.mockImplementationOnce(() => {
        queueMicrotask(() => {
          stdout.end(JSON.stringify(payload));
          child.emit('close', exitCode);
        });
        return child as ReturnType<typeof spawn>;
      });

      expect(await invoke()).toEqual({ success: exitCode === 0, data: payload, degraded: true, exitCode });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [command, args] = mockSpawn.mock.calls[0];
      expect(command).toBe('node');
      expect(basename(args[0])).toBe(script);
      expect(args.slice(-2)).toEqual(['--format', 'json']);
    });
  }
});

const similarityModule = new URL('../../../../plugins/ruflo-metaharness/scripts/_similarity.mjs', import.meta.url);

// The pure implementation is tracked at the repo root and can be absent in sparse checkouts.
describe.skipIf(!existsSync(similarityModule))('pure MetaHarness similarity', () => {
  const a = {
    score: { harnessFit: 100 },
    genome: { repo_type: 'library', archetype: 'code', template: 'node', recommendedMode: 'local', agent_topology: ['build'] },
  };
  const b = {
    score: { compileConfidence: 100 },
    genome: { repo_type: 'service', archetype: 'ops', template: 'python', recommendedMode: 'remote', agent_topology: ['deploy'] },
  };

  it('scores identical fingerprints as 1 and disjoint fingerprints as 0', async () => {
    const { similarity } = await import(/* @vite-ignore */ similarityModule.href);
    expect(similarity(a, a)).toMatchObject({
      overall: 1, verdict: 'near-identical', components: { cosine: 1, categorical: 1, jaccard: 1 },
    });
    const disjoint = { overall: 0, verdict: 'major-drift', components: { cosine: 0, categorical: 0, jaccard: 0 } };
    expect(similarity(a, b)).toMatchObject(disjoint);
    expect(similarity(b, a)).toMatchObject(disjoint);
  });

  it('returns a finite major-drift score for an empty fingerprint', async () => {
    const { similarity } = await import(/* @vite-ignore */ similarityModule.href);
    expect(similarity(a, {}, { perDimension: true })).toMatchObject({
      overall: 0,
      verdict: 'major-drift',
      perDimension: { 'numeric.harnessFit': { a: 100, b: null, contribution: 0 } },
    });
  });
});
