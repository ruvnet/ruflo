/**
 * Every educational statusline tip that names a `ruflo ...` command must name
 * one that exists, with flags the command declares.
 *
 * Several seed tips had drifted from the CLI: `ruflo status watch` (watch is
 * the `--watch` flag; the positional was silently ignored and status printed
 * once), `doctor --fix` described as auto-repair (it prints suggested
 * commands), and `hooks route` described as 3-tier model routing (it routes a
 * task to an agent type; model tiers are `hooks model-route`).
 *
 * This resolves each tip's command against the real Command objects.
 */
import { describe, it, expect } from 'vitest';
import { MESSAGES } from '../src/funnel/messages.js';
import { getCommandAsync } from '../src/commands/index.js';
import { CommandParser } from '../src/parser.js';
import type { Command, CommandOption } from '../src/types.js';

/**
 * Tips that name something other than a CLI subcommand. Each entry must still
 * fail resolution, so the exemption goes away once the tip is fixed.
 * - local.edu.adr-index: there is no `adr` CLI command; ADR indexing ships as
 *   the ruflo-adr plugin's skills.
 */
const NOT_A_CLI_COMMAND = new Set(['local.edu.adr-index']);

const globalOptions: CommandOption[] = new CommandParser().getGlobalOptions();

/** The command part of a tip: after the emoji, before the " — " description. */
function tipCommand(text: string): string[] | null {
  const head = text.split(' — ')[0];
  const tokens = head.trim().split(/\s+/);
  const at = tokens.indexOf('ruflo');
  return at === -1 ? null : tokens.slice(at + 1);
}

async function resolveTip(args: string[]): Promise<string | null> {
  const top = await getCommandAsync(args[0]);
  if (!top) return `unknown command: ${args[0]}`;
  const chain: Command[] = [top];
  let i = 1;
  while (i < args.length && !args[i].startsWith('-')) {
    const sub = chain[chain.length - 1].subcommands?.find((s) => s.name === args[i] || s.aliases?.includes(args[i]));
    if (!sub) return `"${args[i]}" is not a subcommand of ${chain.map((c) => c.name).join(' ')}`;
    chain.push(sub);
    i++;
  }
  const options = [...globalOptions, ...chain.flatMap((c) => c.options ?? [])];
  for (; i < args.length; i++) {
    const token = args[i];
    const opt = token.startsWith('--')
      ? options.find((o) => o.name === token.slice(2))
      : [...chain.flatMap((c) => c.options ?? []), ...globalOptions].find((o) => o.short === token.slice(1));
    if (!opt) return `${token} is not declared on ${chain.map((c) => c.name).join(' ')}`;
    if (opt.type !== 'boolean') {
      const value = args[++i];
      if (value === undefined) return `${token} needs a value`;
      if (opt.choices && !opt.choices.includes(value)) return `${value} is not a valid ${token}`;
    }
  }
  return null;
}

const tips = MESSAGES.filter((m) => m.class === 'educational')
  .map((m) => ({ id: m.id, args: tipCommand(m.text) }))
  .filter((t): t is { id: string; args: string[] } => t.args !== null);

describe('funnel seed tips name real CLI commands', () => {
  it('covers the educational tips', () => {
    expect(tips.length).toBeGreaterThanOrEqual(7);
  });

  for (const tip of tips) {
    it(`${tip.id}: ruflo ${tip.args.join(' ')}`, async () => {
      const problem = await resolveTip(tip.args);
      if (NOT_A_CLI_COMMAND.has(tip.id)) expect(problem).not.toBeNull();
      else expect(problem).toBeNull();
    });
  }

  it('rejects the old drifted forms', async () => {
    expect(await resolveTip(['status', 'watch'])).toMatch(/not a subcommand/);
    expect(await resolveTip(['doctor', '--auto-repair'])).toMatch(/not declared/);
  });
});
