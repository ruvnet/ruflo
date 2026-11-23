/**
 * `embeddings search` loaded candidate vectors with `LIMIT 1000` and no
 * `ORDER BY`, so on a store with more than 1000 embedded rows SQLite handed back
 * the oldest-inserted 1000 and the newest entries were never scored (the #2982
 * root cause, fixed in the memory bridge but not in this command). It now reads
 * the newest rows first, with the same 10000-row window as the bridge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async () => ({ embedding: [1, 0, 0, 0], dimensions: 4, model: 'mock' })),
}));

const { embeddingsCommand } = await import('../src/commands/embeddings.js');
import type { CommandContext, CommandResult } from '../src/types.js';

let dir: string;
let originalCwd: string;

async function seed(fillers: number): Promise<void> {
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT NOT NULL, namespace TEXT DEFAULT 'default',
    content TEXT NOT NULL, embedding TEXT, embedding_dimensions INTEGER,
    status TEXT DEFAULT 'active', updated_at INTEGER NOT NULL)`);
  const insert = db.prepare('INSERT INTO memory_entries VALUES (?, ?, ?, ?, ?, 4, ?, ?)');
  for (let i = 0; i < fillers; i++) {
    insert.run([`filler-${i}`, `filler-${i}`, 'default', 'unrelated note', '[0,1,0,0]', 'active', 1000 + i]);
  }
  // The newest row, inserted last: the only one similar to the query.
  insert.run(['newest', 'newest-decision', 'default', 'kubernetes ingress tls certificate rotation runbook',
    '[1,0,0,0]', 'active', 1000 + fillers]);
  insert.free();
  fs.mkdirSync(path.join(dir, '.swarm'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.swarm', 'memory.db'), Buffer.from(db.export()));
  db.close();
}

async function search(flags: Record<string, unknown>): Promise<CommandResult> {
  const sub = embeddingsCommand.subcommands!.find((c) => c.name === 'search')!;
  return (await sub.action!({
    args: [], flags: { _: [], threshold: '0.5', limit: '10', ...flags }, cwd: dir, interactive: false,
  } as unknown as CommandContext))!;
}

describe('embeddings search scores the newest rows', () => {
  beforeEach(() => {
    originalCwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-search-newest-'));
    process.chdir(dir);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds the newest entry behind 1100 older embedded rows', async () => {
    await seed(1100);
    const result = await search({ query: 'rotate TLS certs for k8s ingress' });
    expect(result.success).toBe(true);
    expect((result.data as Array<{ key: string }>).map((r) => r.key)).toContain('newest-decision');
  });

  it('finds it across all namespaces too', async () => {
    await seed(1100);
    const result = await search({ query: 'rotate TLS certs for k8s ingress', collection: 'all' });
    expect((result.data as Array<{ key: string }>).map((r) => r.key)).toContain('newest-decision');
  });

  it('still finds it on a store under 1000 rows', async () => {
    await seed(900);
    const result = await search({ query: 'rotate TLS certs for k8s ingress' });
    expect((result.data as Array<{ key: string }>).map((r) => r.key)).toEqual(['newest-decision']);
  });
});
