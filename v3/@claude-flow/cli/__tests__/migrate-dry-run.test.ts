import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  restoreRemovedAgents: vi.fn(async (..._args: unknown[]) => []),
}));

vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'writeln' ? () => {} : (value: unknown) => value,
}) }));
vi.mock('../src/commands/migrate-agent-detection.js', () => ({
  detectRemovedAgentGaps: () => [{ agent: 'coder.md', plugin: 'ruflo-core', installCommand: '/plugin install ruflo-core@ruflo' }],
}));
vi.mock('../src/commands/migrate-agent-restore.js', () => ({
  restoreRemovedAgents: mocks.restoreRemovedAgents,
}));
import { migrateCommand } from '../src/commands/migrate.js';
import { CommandParser } from '../src/parser.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'migrate-dry-run-'));
  writeFileSync(join(root, 'claude-flow.config.json'), '{"version":"2","swarm":{"mode":"mesh"}}\n');
  mkdirSync(join(root, 'data', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'data', 'sessions', 'session-1.json'), '{}\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

async function migrate(argv: string[]): Promise<void> {
  const parser = new CommandParser();
  parser.registerCommand(migrateCommand);
  const { flags } = parser.parse(['migrate', ...argv]);
  const subcommand = migrateCommand.subcommands!.find((command) => command.name === argv[0])!;
  const result = await subcommand.action!({ args: [], flags, cwd: root, interactive: false });
  expect(result?.success).toBe(true);
}

describe('migrate --dry-run through the real command parser', () => {
  it('migrate run --dry-run writes nothing', async () => {
    await migrate(['run', '--dry-run']);
    expect(existsSync(join(root, '.claude-flow'))).toBe(false);
  });

  it('migrate run still migrates without the flag', async () => {
    await migrate(['run']);
    expect(existsSync(join(root, '.claude-flow', 'config.json'))).toBe(true);
    expect(existsSync(join(root, '.claude-flow', 'sessions', 'session-1.json'))).toBe(true);
  });

  it.each(['--dry-run', '-d'])('migrate fix --agents %s restores as a dry run', async (flag) => {
    await migrate(['fix', '--agents', flag]);
    expect(mocks.restoreRemovedAgents).toHaveBeenCalledWith(root, expect.any(Array), { dryRun: true });
  });

  it('migrate fix --agents still restores without the flag', async () => {
    await migrate(['fix', '--agents']);
    expect(mocks.restoreRemovedAgents).toHaveBeenCalledWith(root, expect.any(Array), { dryRun: false });
  });
});
