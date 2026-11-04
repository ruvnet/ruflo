import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stands in for the `pg` driver: answers the migration status queries and
// records every statement the commands send.
const db = vi.hoisted(() => {
  const state = { queries: [] as string[], applied: [] as string[] };
  class Client {
    async connect(): Promise<void> {}
    async end(): Promise<void> {}
    async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
      state.queries.push(sql.trim());
      if (sql.includes('information_schema.schemata')) return { rows: [{ schema_name: 'claude_flow' }] };
      if (sql.includes('SELECT version')) {
        return { rows: state.applied.map((version) => ({ version, name: version, applied_at: '2026-01-01T00:00:00Z' })) };
      }
      return { rows: [] };
    }
  }
  return { state, Client };
});

vi.mock('pg', () => ({ Client: db.Client, default: { Client: db.Client } }));
vi.mock('../src/output.js', () => ({ output: new Proxy({}, {
  get: (_target, name) => name === 'createSpinner'
    ? () => ({ start() {}, stop() {}, succeed() {}, fail() {}, setText() {} })
    : (value: unknown) => value,
}) }));

import { CommandParser } from '../src/parser.js';
import { ruvectorCommand } from '../src/commands/ruvector/index.js';
import { deploymentCommand } from '../src/commands/deployment.js';
import type { Command, CommandResult } from '../src/types.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dry-run-flag-keys-'));
  db.state.queries.length = 0;
  db.state.applied = ['1.0.0'];
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function run(command: Command, path: string[], argv: string[]): Promise<CommandResult | void> {
  const parser = new CommandParser();
  parser.registerCommand(command);
  const { flags } = parser.parse([command.name, ...path, ...argv]);
  const target = path.reduce((parent, name) => parent.subcommands!.find((sub) => sub.name === name)!, command);
  return target.action!({ args: [], flags, cwd: root, interactive: false });
}

const writes = () => db.state.queries.filter((sql) => !sql.startsWith('SELECT'));

describe('ruvector migrate --dry-run through the real command parser', () => {
  const migrate = (...argv: string[]) => run(ruvectorCommand, ['migrate'], [...argv, '--database', 'testdb']);

  it('shows the pending migrations without running them', async () => {
    const result = await migrate('--dry-run');
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({
      success: true,
      data: { dryRun: true, migrations: ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0'] },
    });
  });

  it('shows the rollback without running it', async () => {
    db.state.applied = ['1.0.0', '1.1.0', '1.2.0'];
    const result = await migrate('--dry-run', '--down');
    expect(writes()).toEqual([]);
    expect(result).toMatchObject({ success: true, data: { dryRun: true, migrations: ['1.2.0'] } });
  });

  it('still runs the migrations without the flag', async () => {
    const result = await migrate();
    expect(result?.success).toBe(true);
    expect(writes().filter((sql) => sql === 'COMMIT')).toHaveLength(5);
  });
});

describe('ruvector backup restore --dry-run through the real command parser', () => {
  const restore = (...argv: string[]) => {
    const file = join(root, 'backup.json');
    writeFileSync(file, JSON.stringify({ tables: [{ name: 'embeddings', rows: [{ id: 'a', content: 'x' }] }] }));
    return run(ruvectorCommand, ['backup', 'restore'], ['-i', file, '--clean', ...argv, '--database', 'testdb']);
  };

  it('sends nothing to the database, even with --clean', async () => {
    const result = await restore('--dry-run');
    expect(db.state.queries).toEqual([]);
    expect(result).toMatchObject({ success: true, data: { dryRun: true } });
  });

  it('still drops the schema and restores without the flag', async () => {
    const result = await restore();
    expect(result?.success).toBe(true);
    expect(db.state.queries.slice(0, 2)).toEqual(['DROP SCHEMA IF EXISTS claude_flow CASCADE', 'CREATE SCHEMA claude_flow']);
  });
});

describe('deployment deploy --dry-run through the real command parser', () => {
  const deploy = (...argv: string[]) => run(deploymentCommand, ['deploy'], ['-e', 'prod', ...argv]);
  const statePath = () => join(root, '.claude-flow', 'deployments.json');
  beforeEach(() => {
    writeFileSync(join(root, 'package.json'), '{"version":"1.2.3"}\n');
  });

  it.each(['--dry-run', '-d'])('%s records no deployment', async (flag) => {
    const result = await deploy(flag);
    expect(result?.success).toBe(true);
    expect(existsSync(statePath())).toBe(false);
  });

  it('still records the deployment without the flag', async () => {
    const result = await deploy();
    expect(result?.success).toBe(true);
    const state = JSON.parse(readFileSync(statePath(), 'utf-8'));
    expect(state.history).toMatchObject([{ environment: 'prod', version: '1.2.3', status: 'deployed' }]);
    expect(state.activeDeployment).toBe(state.history[0].id);
  });
});
