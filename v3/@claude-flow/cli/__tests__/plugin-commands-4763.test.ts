import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogCommand } from '../src/commands/catalog.js';
import { pathsCommand } from '../src/commands/plugins-paths.js';
import { verifyCommand } from '../src/commands/plugins-verify.js';
import { output } from '../src/output.js';
import type { Command, CommandContext } from '../src/types.js';

let root: string;
let lines: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-plugin-commands-'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(root, 'config'));
  lines = [];
  vi.spyOn(output, 'writeln').mockImplementation((line = '') => { lines.push(line); });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function run(command: Command, args: string[], flags: CommandContext['flags']) {
  return command.action!({ args, flags, cwd: root, interactive: false });
}

function printedJson(): unknown {
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!);
}

describe('plugins verify', () => {
  let clone: string;
  const unsigned = 'Plugin_1.0-beta';

  beforeEach(() => {
    clone = join(root, 'clone');
    writeJson(join(clone, '.claude-plugin', 'marketplace.json'), {
      name: 'ruflo',
      plugins: [{ name: unsigned }, { name: 'broken' }],
    });
    writeJson(join(clone, 'plugins', unsigned, '.claude-plugin', 'plugin.json'), { name: unsigned });
    writeJson(join(clone, 'plugins', 'broken', '.claude-plugin', 'plugin.json'), { name: 'broken' });
    writeJson(join(clone, 'plugins', 'broken', '.claude-plugin', 'signature.json'), {});
  });

  it.each([
    { strict: false, success: true, exitCode: undefined },
    { strict: true, success: false, exitCode: 1 },
  ])('reports an unsigned selection with strict=$strict', async ({ strict, success, exitCode }) => {
    const result = await run(verifyCommand, [unsigned, '../broken'], { _: [], clone, strict, json: true });
    expect(result).toMatchObject({ success });
    expect(result?.exitCode).toBe(exitCode);
    const row = {
      plugin: unsigned,
      dir: join(clone, 'plugins', unsigned),
      result: 'unsigned',
      changed: [],
      missing: [],
      extra: [],
    };
    expect(printedJson()).toEqual({ clone, clonePlugins: [row], installCache: [] });
    expect(result?.data).toEqual([row]);
  });

  it('falls back to all plugins when every argument is filtered out', async () => {
    const result = await run(verifyCommand, ['../broken', 'bad name', 'a'.repeat(101)], {
      _: [], clone, json: true,
    });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(printedJson()).toMatchObject({
      clonePlugins: [
        { plugin: unsigned, result: 'unsigned' },
        { plugin: 'broken', result: 'bad-signature' },
      ],
    });
  });

  it('reports a valid but unknown name and omits invalid arguments from the diagnostic', async () => {
    const printError = vi.spyOn(output, 'printError').mockImplementation(() => {});
    const result = await run(verifyCommand, ['unknown', '../broken'], { _: [], clone });
    expect(result).toEqual({ success: false, exitCode: 1 });
    expect(printError).toHaveBeenCalledExactlyOnceWith('unknown: not in the marketplace at ' + clone);
  });
});

describe('plugins paths', () => {
  it('resolves trimmed, qualified names and reports missing plugins with exit code 0', async () => {
    const path = join(root, 'config', 'plugins', 'marketplaces', 'ruflo', 'plugins', 'available');
    writeJson(join(path, '.claude-plugin', 'plugin.json'), { name: 'available' });

    const result = await run(pathsCommand, [], { _: [], names: ' available@ruflo, , missing ', json: true });
    expect(result).toMatchObject({ success: true, exitCode: 0 });
    expect(printedJson()).toEqual({
      resolved: [{ name: 'available', path, source: 'clone' }],
      missing: [{ name: 'missing', reason: expect.stringContaining('plugin.json') }],
    });
    expect(result?.data).toEqual(printedJson());
  });

  it('rejects invalid names and emits a JSON error with exit code 1', async () => {
    const result = await run(pathsCommand, [], { _: [], names: 'available, ../escape, -invalid', json: true });
    const message = 'invalid plugin name: "../escape", "-invalid"';
    expect(result).toEqual({ success: false, exitCode: 1, message });
    expect(printedJson()).toEqual({ resolved: [], missing: [], error: message });
  });
});

describe('catalog', () => {
  it.each([
    { valid: true, exitCode: 0, errors: [] },
    { valid: false, exitCode: 1, errors: ['sourceDigest does not match entries'] },
  ])('verifies an explicit catalog file with valid=$valid', async ({ valid, exitCode, errors }) => {
    const file = join(root, 'catalog.json');
    const digest = createHash('sha256').update('[]').digest('hex');
    writeJson(file, {
      contractVersion: 'ruflo.command-catalog/1',
      sourceCommit: 'uncommitted',
      sourceDigest: 'sha256:' + (valid ? digest : '0'.repeat(64)),
      entries: [],
    });

    const result = await run(catalogCommand, ['verify'], { _: [], file, json: true });
    const data = { file, valid, errors };
    expect(result).toEqual({ success: valid, exitCode, data });
    expect(printedJson()).toEqual(data);
  });

  it('returns a JSON error and exit code 1 for an unknown operation', async () => {
    const result = await run(catalogCommand, ['unknown'], { _: [], json: true });
    const data = { error: 'unknown operation unknown' };
    expect(result).toEqual({ success: false, exitCode: 1, data });
    expect(printedJson()).toEqual(data);
  });
});
