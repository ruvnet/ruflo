/**
 * `embeddings search`, `collections`, `index`, `chunk`, `cache` and
 * `benchmark` read kebab-case keys (`ctx.flags['db-path']`,
 * `['ef-construction']`, `['max-size']`, `['batch-size']`), but the parser
 * stores every long flag under its camelCase key (`dbPath`, `maxSize`, ...).
 * The flags, and the documented `chunk -s 256` short form, were silently
 * ignored and the hard-coded defaults were used instead.
 *
 * Runs the real parser and the real subcommand actions. The optional
 * `@claude-flow/embeddings` package is not installed in this workspace, so
 * `chunk` prints its preview box, which shows the max size it read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { embeddingsCommand } from '../src/commands/embeddings.js';
import { CommandParser } from '../src/parser.js';
import type { CommandContext, CommandResult } from '../src/types.js';

let written = '';
let dir: string;

async function run(argv: string[]): Promise<CommandResult> {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(embeddingsCommand);
  const { flags } = parser.parse(['embeddings', ...argv]);
  const sub = embeddingsCommand.subcommands!.find((c) => c.name === argv[0])!;
  return (await sub.action!({ args: [], flags, cwd: process.cwd(), interactive: false } as unknown as CommandContext))!;
}

describe('embeddings subcommands read the parser\'s camelCase flag keys', () => {
  beforeEach(() => {
    written = '';
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-flags-'));
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((s) => { written += String(s); return true; });
    }
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { written += a.join(' ') + '\n'; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('chunk honours --max-size', async () => {
    const result = await run(['chunk', '-t', 'x'.repeat(1000), '--max-size', '150']);
    expect(result).toMatchObject({ success: true });
    expect(written).toContain('Max Size: 150 chars');
    expect(written).not.toContain('Max Size: 512 chars');
  });

  it('chunk honours the documented -s short form', async () => {
    await run(['chunk', '-t', 'x'.repeat(1000), '-s', '256']);
    expect(written).toContain('Max Size: 256 chars');
  });

  it('chunk keeps the 512 default when --max-size is omitted', async () => {
    await run(['chunk', '-t', 'x'.repeat(1000)]);
    expect(written).toContain('Max Size: 512 chars');
  });

  it('cache reads the SQLite file named by --db-path', async () => {
    const dbFile = path.join(dir, 'custom.db');
    fs.writeFileSync(dbFile, Buffer.alloc(123));
    const result = await run(['cache', '--db-path', dbFile]);
    expect(result).toMatchObject({ success: true });
    expect(written).toContain('123 B');
  });
});
