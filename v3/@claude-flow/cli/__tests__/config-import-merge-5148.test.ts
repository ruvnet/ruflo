import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configCommand } from '../src/commands/config.js';
import { CommandParser } from '../src/parser.js';
import { configManager } from '../src/services/config-file-manager.js';

let cwd: string;
const importConfig = configCommand.subcommands!.find(command => command.name === 'import')!;
const configFile = () => join(cwd, 'claude-flow.config.json');
const importFile = () => join(cwd, 'import.json');
const readConfig = () => JSON.parse(readFileSync(configFile(), 'utf8'));

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'config-import-merge-'));
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(cwd, { recursive: true, force: true });
});

async function run(...args: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(configCommand);
  const parsed = parser.parse(['config', 'import', ...args]);
  const errors = parser.validateFlags(parsed.flags, importConfig);
  if (errors.length) return { success: false, errors };
  return importConfig.action!({ cwd, args: parsed.positional, flags: parsed.flags, interactive: false });
}

describe('config import merge', () => {
  it('keeps absent top-level keys and takes imported values with --merge', async () => {
    writeFileSync(configFile(), JSON.stringify({
      version: 'existing',
      swarm: { maxAgents: 8, topology: 'mesh' },
      custom: { keep: true },
    }));
    writeFileSync(importFile(), JSON.stringify({
      swarm: { maxAgents: 12 },
      added: { enabled: true },
    }));

    expect((await run('--file', 'import.json', '--merge'))?.success).toBe(true);
    expect(existsSync(configFile())).toBe(true);
    expect(readConfig()).toEqual({
      version: 'existing',
      swarm: { maxAgents: 12 },
      custom: { keep: true },
      added: { enabled: true },
    });
  });

  it('replaces the file exactly without --merge', async () => {
    writeFileSync(configFile(), JSON.stringify({ existing: true, custom: { keep: true } }));
    const imported = { replacement: true, custom: { imported: true } };
    writeFileSync(importFile(), JSON.stringify(imported));

    expect((await run('--file', 'import.json'))?.success).toBe(true);
    expect(existsSync(configFile())).toBe(true);
    expect(readConfig()).toEqual(imported);
  });

  it('writes only the imported object when merging without an existing config', async () => {
    const imported = { custom: { imported: true } };
    writeFileSync(importFile(), JSON.stringify(imported));

    expect((await run('--file', 'import.json', '--merge'))?.success).toBe(true);
    expect(existsSync(configFile())).toBe(true);
    expect(readConfig()).toEqual(imported);
  });

  it('removes conflicting literal dotted keys for imported sections', async () => {
    writeFileSync(configFile(), JSON.stringify({
      'swarm.maxAgents': 8,
      custom: { keep: true },
    }));
    writeFileSync(importFile(), JSON.stringify({ swarm: { maxAgents: 12 } }));

    expect((await run('--file', 'import.json', '--merge'))?.success).toBe(true);
    expect(readConfig()).toEqual({
      custom: { keep: true },
      swarm: { maxAgents: 12 },
    });
    expect(configManager.get(cwd, 'swarm.maxAgents')).toBe(12);
  });

  it('reloads the existing config before merging', async () => {
    writeFileSync(configFile(), JSON.stringify({ cached: true }));
    configManager.load(cwd);
    writeFileSync(configFile(), JSON.stringify({ cached: true, addedOnDisk: true }));
    writeFileSync(importFile(), JSON.stringify({ imported: true }));

    expect((await run('--file', 'import.json', '--merge'))?.success).toBe(true);
    expect(readConfig()).toEqual({ cached: true, addedOnDisk: true, imported: true });
  });

  it('does not overwrite a malformed existing config when merging', async () => {
    const malformed = '{"existing":';
    writeFileSync(configFile(), JSON.stringify({ cached: true }));
    configManager.load(cwd);
    writeFileSync(configFile(), malformed);
    writeFileSync(importFile(), JSON.stringify({ imported: true }));

    expect((await run('--file', 'import.json', '--merge'))?.success).toBe(false);
    expect(readFileSync(configFile(), 'utf8')).toBe(malformed);
  });
});
