/**
 * A subcommand that declares its own `--format` (with its own choices) was also
 * validated against the global `--format` choices (text, json, table), so every
 * subcommand-specific value failed: `process monitor` exited 1 on its own default
 * `dashboard`, and `session export --format yaml` could never be selected.
 */
import { describe, it, expect } from 'vitest';
import { CommandParser } from '../src/parser.js';
import { processCommand } from '../src/commands/process.js';
import { sessionCommand } from '../src/commands/session.js';
import type { Command } from '../src/types.js';

function parseAndValidate(root: Command, argv: string[]): string[] {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(root);
  const parsed = parser.parse(argv);
  let target: Command = root;
  for (const name of parsed.command.slice(1)) {
    target = target.subcommands!.find((c) => c.name === name)!;
  }
  return parser.validateFlags(parsed.flags, target);
}

describe('subcommand --format choices shadow the global ones', () => {
  it('process monitor accepts its own default (dashboard) with no flags', () => {
    expect(parseAndValidate(processCommand, ['process', 'monitor'])).toEqual([]);
  });

  it('process monitor accepts --format compact', () => {
    expect(parseAndValidate(processCommand, ['process', 'monitor', '--format', 'compact'])).toEqual([]);
  });

  it('session export accepts --format yaml', () => {
    expect(parseAndValidate(sessionCommand, ['session', 'export', '--format', 'yaml'])).toEqual([]);
  });

  it('still rejects a value outside the subcommand choices', () => {
    const errors = parseAndValidate(processCommand, ['process', 'monitor', '--format', 'text']);
    expect(errors).toEqual(['Invalid value for --format: text. Must be one of: dashboard, compact, json']);
  });

  it('still applies the global choices to a command without its own --format', () => {
    const cmd: Command = { name: 'plain', description: 'p', options: [] };
    const parser = new CommandParser({ allowUnknownFlags: true });
    expect(parser.validateFlags({ _: [], format: 'json' }, cmd)).toEqual([]);
    expect(parser.validateFlags({ _: [], format: 'xml' }, cmd)).toEqual([
      'Invalid value for --format: xml. Must be one of: text, json, table',
    ]);
  });
});
