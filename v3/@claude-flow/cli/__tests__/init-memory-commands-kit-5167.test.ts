import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('../src/output.js', () => ({
  output: new Proxy({}, { get: () => (value: unknown) => value }),
}));
vi.mock('../src/prompt.js', () => ({ select: vi.fn(), confirm: vi.fn(), input: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), MCPClientError: class extends Error {} }));
vi.mock('../src/mcp-tools/path-containment.js', () => ({ localCliContext: () => ({}) }));
vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
}));
vi.mock('../src/mcp-tools/memory-tools.js', () => ({
  memoryKeyError: () => null,
  MEMORY_SCOPES: ['project', 'local', 'user'],
  resolveScopedNamespace: ({ namespace }: { namespace: string }) => ({ ok: true, namespace }),
}));
vi.mock('../src/commands/memory-distill.js', () => ({ distillCommand: {} }));
vi.mock('../src/commands/memory-backup.js', () => ({ backupCommand: {} }));
vi.mock('../src/memory/memory-initializer.js', () => ({ resolveDbPath: (path?: string) => path ?? 'memory.db' }));

import { memoryCommand } from '../src/commands/memory.js';
import { extractInvocations, loadCommandTree, resolveCommand } from '../../../../scripts/audit-skill-cli-commands.mjs';

const MEMORY_COMMANDS_ROOT = join(
  fileURLToPath(new URL('..', import.meta.url)),
  '.claude',
  'commands',
  'memory',
);
const PAGES = ['memory-usage.md', 'memory-persist.md', 'memory-search.md'];

function commandFlags(subcommand: string): Set<string> {
  const command = memoryCommand.subcommands?.find(
    (candidate) => candidate.name === subcommand || candidate.aliases?.includes(subcommand),
  );
  expect(command, `memory ${subcommand} must be registered`).toBeDefined();

  const flags = new Set<string>();
  for (const option of command?.options ?? []) {
    flags.add(`--${option.name}`);
    if (option.short) flags.add(`-${option.short}`);
  }
  return flags;
}

function flagsOnLine(line: string): string[] {
  return [...line.matchAll(/(^|[\s\[])(--?[a-z][a-z0-9-]*)\b/g)].map((match) => match[2]);
}

function declaredFlag(subcommand: string, flag: string): string {
  if (!flag.startsWith('--no-')) return flag;

  const baseName = flag.slice('--no-'.length);
  const command = memoryCommand.subcommands?.find(
    (candidate) => candidate.name === subcommand || candidate.aliases?.includes(subcommand),
  );
  const option = command?.options?.find((candidate) => candidate.name === baseName);
  return option?.type === 'boolean' ? `--${baseName}` : flag;
}

function optionsSection(markdown: string): string[] {
  const section = markdown.match(/## Options\s*\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? '';
  return [...section.matchAll(/`(--[a-z][a-z0-9-]*)\b/g)].map((match) => match[1]);
}

describe('default init memory command pages use the CLI that v3 ships', () => {
  it('ships the default memory command directory', () => {
    expect(existsSync(MEMORY_COMMANDS_ROOT)).toBe(true);
  });

  it.each(PAGES)('%s references only registered memory subcommands and their declared options', async (page) => {
    const tree = await loadCommandTree();

    const file = join(MEMORY_COMMANDS_ROOT, page);
    expect(existsSync(file), `${page} must remain in the init command kit`).toBe(true);

    const markdown = readFileSync(file, 'utf8');
    const lines = markdown.split('\n');
    const invocations = extractInvocations(markdown);
    expect(invocations.length, `${page} must contain at least one CLI invocation`).toBeGreaterThan(0);

    const pageSubcommands = new Set<string>();
    for (const invocation of invocations) {
      const command = resolveCommand(tree, invocation.command);
      expect(command, `${page}:${invocation.line} must use a registered command`).toBe('memory');

      const subcommands = tree.get(command!)?.subcommands;
      const subcommand = invocation.subcommand;
      const resolvedSubcommand = subcommand && subcommands
        ? (subcommands.has(subcommand)
          ? subcommand
          : [...subcommands].find(([, aliases]) => aliases.includes(subcommand))?.[0])
        : null;
      expect(
        resolvedSubcommand,
        `${page}:${invocation.line} must use a registered memory subcommand`,
      ).toBeTruthy();

      pageSubcommands.add(resolvedSubcommand!);
      const declared = commandFlags(resolvedSubcommand!);
      for (const flag of flagsOnLine(lines[invocation.line - 1])) {
        expect(
          declared.has(declaredFlag(resolvedSubcommand!, flag)),
          `${page}:${invocation.line} memory ${resolvedSubcommand} does not declare ${flag}`,
        ).toBe(true);
      }
    }

    const listedOptions = optionsSection(markdown);
    expect(listedOptions.length, `${page} must document at least one option`).toBeGreaterThan(0);
    for (const option of listedOptions) {
      expect(
        [...pageSubcommands].some((subcommand) => (
          commandFlags(subcommand).has(declaredFlag(subcommand, option))
        )),
        `${page} lists ${option}, but none of its example subcommands declare it`,
      ).toBe(true);
    }
  }, 120_000);
});
