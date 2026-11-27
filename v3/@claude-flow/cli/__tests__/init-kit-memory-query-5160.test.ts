import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, { get: () => (value: unknown) => value }),
}));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ resolveDbPath: (path: string) => path }));

import { memoryCommand } from '../src/commands/memory.js';

const kitDir = fileURLToPath(new URL('../.claude/commands', import.meta.url));

function readMarkdownFiles(dir: string): Array<{ path: string; lines: string[] }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return readMarkdownFiles(path);
    if (!entry.isFile() || !entry.name.endsWith('.md')) return [];
    return [{ path, lines: readFileSync(path, 'utf8').split(/\r?\n/) }];
  });
}

describe('init command kit memory queries (#5160)', () => {
  it('contains a readable command kit with no nonexistent memory query invocations', () => {
    expect(existsSync(kitDir), `command kit not found: ${kitDir}`).toBe(true);
    const files = readMarkdownFiles(kitDir);
    expect(files.length, `expected at least 20 Markdown files under ${kitDir}`).toBeGreaterThanOrEqual(20);

    const offenders = files.flatMap((file) => file.lines.flatMap((line, index) =>
      /\bmemory\s+query\b/.test(line) ? [`${file.path}:${index + 1}: ${line}`] : [],
    ));
    expect(offenders, `nonexistent memory query invocations:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('uses the real search subcommand and only its declared long options', () => {
    const subcommands = memoryCommand.subcommands ?? [];
    const verbs = new Set(subcommands.flatMap((command) => [command.name, ...(command.aliases ?? [])]));
    expect(verbs.has('query')).toBe(false);
    expect(subcommands.some((command) => command.name === 'search')).toBe(true);

    const search = subcommands.find((command) => command.name === 'search')!;
    const optionNames = new Set((search.options ?? []).map((option) => option.name));
    const invalidFlags = readMarkdownFiles(kitDir).flatMap((file) => file.lines.flatMap((line, index) => {
      if (!/\bmemory\s+search\s+--query\b/.test(line)) return [];
      return [...line.matchAll(/--([a-z][a-z0-9-]*)\b/g)]
        .map((match) => match[1])
        .filter((flag) => !optionNames.has(flag))
        .map((flag) => `${file.path}:${index + 1}: --${flag}`);
    }));
    expect(invalidFlags, `memory search flags not declared by the command:\n${invalidFlags.join('\n')}`).toEqual([]);
  });
});
