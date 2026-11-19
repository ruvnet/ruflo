import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandParser } from '../src/parser.js';
import { ruvectorCommand } from '../src/commands/ruvector/index.js';
import type { ParsedFlags } from '../src/types.js';

const { queries, files, Client } = vi.hoisted(() => {
  const queries: string[] = [];
  const files = new Map<string, string>();
  class Client {
    async connect() {}
    async end() {}
    async query(sql: string) {
      queries.push(sql.trim());
      if (sql.includes('pg_extension')) return { rows: [{ extversion: '1.0' }] };
      if (sql.includes('pg_get_indexdef')) return { rows: [{ indexdef: 'CREATE INDEX test_index ON embeddings (key)' }] };
      if (sql.includes('pg_relation_size')) return { rows: [{ table_size: '10', total_size: '15', index_size: '5' }] };
      return { rows: [] };
    }
  }
  return { queries, files, Client };
});

vi.mock('pg', () => ({ Client }));
vi.mock('fs', () => ({
  existsSync: (file: string) => files.has(file),
  readFileSync: (file: string) => files.get(file),
  writeFileSync: (file: string, content: string) => files.set(file, content),
  statSync: (file: string) => ({ size: files.get(file)!.length }),
}));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_target, name) => name === 'createSpinner'
      ? () => ({ start() {}, stop() {}, succeed() {}, fail() {}, setText() {} })
      : (value: unknown) => value,
  }),
}));

const parser = new CommandParser({ allowUnknownFlags: true });
parser.registerCommand(ruvectorCommand);

async function run(path: string[], argv: string[] = [], legacyFlags?: Omit<ParsedFlags, '_'>) {
  const { command, flags, positional } = parser.parse(['ruvector', ...path, ...argv]);
  expect(command).toEqual(['ruvector', ...path]);
  const target = path.reduce((parent, name) => parent.subcommands!.find((sub) => sub.name === name)!, ruvectorCommand);
  expect(parser.validateFlags(flags, target)).toEqual([]);
  return target.action!({
    args: positional,
    flags: legacyFlags ? { _: [], ...legacyFlags } : flags,
    cwd: process.cwd(),
    interactive: false,
  });
}

beforeEach(() => {
  queries.length = 0;
  files.clear();
});

describe('ruvector flags (#4720)', () => {
  it.each([
    { argv: ['--index-type', 'ivfflat'], indexType: 'ivfflat' },
    { argv: [], indexType: 'hnsw' },
  ])('creates the selected $indexType vector index', async ({ argv, indexType }) => {
    const result = await run(['init'], ['--database', 'testdb', ...argv]);
    expect(result).toMatchObject({ success: true, data: { indexType } });
    expect(queries).toEqual(expect.arrayContaining([expect.stringContaining(`USING ${indexType} (`)]));
  });

  it('keeps the legacy init key for direct callers', async () => {
    const result = await run(['init'], ['--database', 'testdb'], { database: 'testdb', 'index-type': 'ivfflat' });
    expect(result).toMatchObject({ success: true, data: { indexType: 'ivfflat' } });
  });

  it.each([
    { argv: ['--from-memory'], message: 'Use explicit JSON export first' },
    { argv: ['--no-from-memory'], message: 'Missing input source' },
    { argv: [], message: 'Missing input source' },
  ])('selects the import source for $argv', async ({ argv, message }) => {
    expect(await run(['import'], argv)).toMatchObject({ success: false, message });
  });

  it('keeps the legacy import source key and respects explicit false', async () => {
    expect(await run(['import'], [], { 'from-memory': true })).toMatchObject({
      message: 'Use explicit JSON export first',
    });
    expect(await run(['import'], [], { fromMemory: false, 'from-memory': true })).toMatchObject({
      message: 'Missing input source',
    });
  });

  it.each([
    { argv: ['--batch-size', '2'], batchCounts: [2, 1] },
    { argv: ['-b', '1'], batchCounts: [1, 1, 1] },
    { argv: [], batchCounts: [3] },
    { argv: [], batchCounts: [2, 1], legacySize: 2 },
  ])('writes import batches of $batchCounts', async ({ argv, batchCounts, legacySize }) => {
    files.set('memory.json', JSON.stringify([
      { key: 'same-key', value: "first $ruvector_batch$ user's value" },
      { key: 'same-key', value: 'second value' },
      { key: 'other-key', value: 'third value' },
    ]));
    const result = await run(['import'], ['--input', 'memory.json', '--output', 'import.sql', ...argv],
      legacySize === undefined ? undefined : { input: 'memory.json', output: 'import.sql', 'batch-size': legacySize });
    expect(result).toMatchObject({ success: true });
    const sql = files.get('import.sql')!;
    const batchPattern = /^DO (\$\w+\$)\nBEGIN\n([\s\S]*?)\nEND;\n\1;$/gm;
    const batches = [...sql.matchAll(batchPattern)];
    expect(batches.map(([, , body]) => (body.match(/INSERT INTO /g) ?? []).length)).toEqual(batchCounts);
    expect(batches[0][1]).not.toBe('$ruvector_batch$');
    expect(sql).toMatch(/'same-key',[\s\S]*'first \$ruvector_batch\$ user''s value'[\s\S]*'same-key',[\s\S]*'second value'[\s\S]*'other-key',[\s\S]*'third value'/);
    expect(sql.replace(batchPattern, '').match(/^(BEGIN|COMMIT);$/gm)).toEqual(['BEGIN;', 'COMMIT;']);
  });

  it.each([
    { argv: ['--format', 'json', '--no-include-indexes'], includeIndexes: false, json: true },
    { argv: ['--format', 'json', '--include-indexes=false'], includeIndexes: false, json: true },
    { argv: ['--no-include-indexes'], includeIndexes: false },
    { argv: [], includeIndexes: true },
    { argv: ['--no-include-indexes', '--include-indexes'], includeIndexes: true },
    { argv: [], includeIndexes: false, legacy: true },
  ])('exports indexes=$includeIndexes for $argv (legacy=$legacy)', async ({ argv, includeIndexes, json, legacy }) => {
    const baseFlags = { database: 'testdb', output: 'backup.sql', format: 'sql' };
    const result = await run(['backup', 'create'], ['--database', 'testdb', '--output', 'backup.sql', ...argv],
      legacy ? { ...baseFlags, 'include-indexes': false } : undefined);
    expect(result).toMatchObject({ success: true, data: { format: json ? 'json' : 'sql', indexes: Number(includeIndexes) } });
    expect(queries.some((sql) => sql.includes('pg_get_indexdef'))).toBe(includeIndexes);
    expect(files.get('backup.sql')?.includes('CREATE INDEX test_index')).toBe(includeIndexes);
  });

  const benchmarkArgs = ['--database', 'testdb', '--vectors', '5', '--dimensions', '2', '--queries', '1', '--index', 'none'];

  it.each([
    { argv: ['--batch-size=2'], inserts: [2, 2, 1] },
    { argv: [], inserts: [5] },
    { argv: [], inserts: [3, 2], legacySize: '3' },
  ])('sends benchmark inserts in batches of $inserts', async ({ argv, inserts, legacySize }) => {
    const result = await run(['benchmark'], [...benchmarkArgs, ...argv], legacySize === undefined ? undefined : {
      database: 'testdb', vectors: 5, dimensions: 2, queries: 1, index: 'none', 'batch-size': legacySize,
    });
    expect(result).toMatchObject({ success: true });
    expect(queries.filter((sql) => sql.startsWith('INSERT INTO')).map((sql) => (sql.match(/\('\[/g) ?? []).length))
      .toEqual(inserts);
  });

  it.each(['import', 'benchmark'])('rejects a zero batch size in %s before I/O', async (command) => {
    const argv = command === 'import' ? ['--input', 'memory.json'] : benchmarkArgs;
    const result = await run([command], [...argv, '--batch-size=0']);
    if (command === 'import') expect(result).toMatchObject({ message: '--batch-size must be a positive integer' });
    expect(result).toMatchObject({ success: false });
    expect(queries).toEqual([]);
    expect(files.size).toBe(0);
  });
});
