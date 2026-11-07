import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 43 — show the canonical price table that drives cost
// computations, blended-price routing, and counterfactual baselines.
// Operators ask "what does the router think gpt-4.1 costs?" frequently;
// previously the answer required reading src/ruvector/model-prices.ts.
export const routerPricesCommand: Command = {
  name: 'prices',
  description: 'Show the per-model price table that drives blended cost + counterfactual computations (ADR-149 iter 43)',
  options: [
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
    { name: 'sort', type: 'string', description: 'Sort by: blended (default), input, output, name', default: 'blended' },
  ],
  examples: [
    { command: 'claude-flow neural router prices', description: 'Show all models sorted by blended price' },
    { command: 'claude-flow neural router prices --sort name', description: 'Sort alphabetically' },
    { command: 'claude-flow neural router prices --format json | jq \'.[] | select(.id | contains("opus"))\'', description: 'Filter via jq' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { MODEL_PRICES, blendedPrice } = await import('../../ruvector/model-prices.js');
    const fmt = (ctx.flags.format as string) || 'table';
    const sortKey = ((ctx.flags.sort as string) || 'blended').toLowerCase();

    const rows = Object.entries(MODEL_PRICES).map(([id, p]) => ({
      id,
      inPerMtok: p.in,
      outPerMtok: p.out,
      blendedPerMtok: blendedPrice(id),
    }));

    switch (sortKey) {
      case 'input':   rows.sort((a, b) => a.inPerMtok - b.inPerMtok); break;
      case 'output':  rows.sort((a, b) => a.outPerMtok - b.outPerMtok); break;
      case 'name':    rows.sort((a, b) => a.id.localeCompare(b.id)); break;
      case 'blended':
      default:        rows.sort((a, b) => a.blendedPerMtok - b.blendedPerMtok);
    }

    if (fmt === 'json') {
      output.writeln(JSON.stringify(rows, null, 2));
      return { success: true, data: rows };
    }

    output.writeln();
    output.writeln(output.bold('Model price table (ADR-149 iter 31/43 — single source of truth)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  ${rows.length} entries, sorted by ${sortKey}`);
    output.writeln('');
    output.writeln('    model id                                      $/Mtok in   $/Mtok out   blended ($/Mtok)');
    for (const r of rows) {
      output.writeln(`    ${r.id.padEnd(44)}  ${('$' + r.inPerMtok.toFixed(2)).padStart(9)}  ${('$' + r.outPerMtok.toFixed(2)).padStart(11)}  ${('$' + r.blendedPerMtok.toFixed(2)).padStart(15)}`);
    }
    output.writeln('');
    output.writeln(output.dim('  Blended = $/Mtok_in + 3 × $/Mtok_out (1 input : 3 output ratio for code tasks).'));
    output.writeln(output.dim('  Unknown model ids fall back to $1/Mtok blended (1×in + 1×out).'));
    output.writeln('');
    return { success: true, data: rows };
  },
};
