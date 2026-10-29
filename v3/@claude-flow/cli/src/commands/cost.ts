/**
 * `ruflo cost` — the budget file and gateway export (ADR-508).
 *
 *   ruflo cost budget set --daily 10 --monthly 100 [--hard-stop] [--fallback-model haiku]
 *   ruflo cost budget get
 *   ruflo cost budget export --gateway litellm [--format json] [--model <gateway model>]   (YAML unless the global --format is json)
 *   ruflo cost budget export --gateway litellm --apply --url https://proxy --key-env LITELLM_MASTER_KEY
 *   ruflo cost report [--days 30] [--json]
 *
 * Attribution stays in the ruflo-mods cost ledger; enforcement across
 * sessions and machines belongs to the gateway. The budget file holds no
 * credential, and the gateway's master key is only ever read from the
 * environment variable `--key-env` names.
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { BUDGET_PATH, budgetFromFlags, ladderWindow, readBudget, writeBudget, type BudgetFile } from '../cost/budget-file.js';
import { applyToLiteLLM, formatBody, gatewayRefusal, keyFromEnv, keyGenerateUrl, maskKey, toLiteLLMKeyBody } from '../cost/litellm.js';
import { ATTRIBUTION_PATH, readAttribution } from '../cost/attribution.js';

/** A flag by its camelCase name (the parser's) or its kebab-case spelling. */
function flag(ctx: CommandContext, name: string): unknown {
  const camel = name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return ctx.flags[camel] ?? ctx.flags[name];
}

const describe = (b: BudgetFile) =>
  `${b.windows.map((w) => `$${w.usd} per ${w.period}`).join(', ')}; hard stop ${b.hardStop ? 'on' : 'off'}${b.fallbackModel ? `; fallback ${b.fallbackModel}` : ''}`;

function loadOrFail(cwd: string): { budget?: BudgetFile; result?: CommandResult } {
  const read = readBudget(cwd);
  if (read.kind === 'ok') return { budget: read.budget };
  const message = read.kind === 'absent' ? `no budget file at ${BUDGET_PATH}; write one with: ruflo cost budget set --daily 10 --monthly 100` : read.reason;
  output.printError(message);
  return { result: { success: false, message, exitCode: 1 } };
}

const setSub: Command = {
  name: 'set',
  description: 'Write .claude-flow/cost/budget.json (read by the ruflo-mods cost ladder and by export)',
  options: [
    { name: 'daily', description: 'USD per 24h window', type: 'string' },
    { name: 'weekly', description: 'USD per 7d window', type: 'string' },
    { name: 'monthly', description: 'USD per 30d window', type: 'string' },
    { name: 'hard-stop', description: 'At 100% of the smallest window, the mod refuses new subagents', type: 'boolean', default: false },
    { name: 'fallback-model', description: 'Model a gateway falls back to when a per-model budget runs out', type: 'string' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { budget, error } = budgetFromFlags({
      daily: flag(ctx, 'daily'), weekly: flag(ctx, 'weekly'), monthly: flag(ctx, 'monthly'),
      hardStop: flag(ctx, 'hard-stop'), fallbackModel: flag(ctx, 'fallback-model'),
    });
    if (!budget) {
      output.printError(error ?? 'invalid budget');
      return { success: false, message: error, exitCode: 2 };
    }
    const file = writeBudget(ctx.cwd, budget);
    output.printSuccess(`Budget written to ${file}: ${describe(budget)}`);
    output.writeln(`The ruflo-mods ladder uses the $${ladderWindow(budget).usd} ${ladderWindow(budget).period} window per session when costBudgetUsd is 0.`);
    output.writeln('Enforce it across sessions at a gateway: ruflo cost budget export --gateway litellm');
    return { success: true, data: budget };
  },
};

const getSub: Command = {
  name: 'get',
  description: 'Show the budget file',
  options: [{ name: 'json', description: 'Print JSON', type: 'boolean', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { budget, result } = loadOrFail(ctx.cwd);
    if (!budget) return result!;
    if (flag(ctx, 'json')) output.printJson(budget);
    else output.writeln(`${BUDGET_PATH}: ${describe(budget)}`);
    return { success: true, data: budget };
  },
};

const exportSub: Command = {
  name: 'export',
  description: 'Print the budget as gateway key settings (LiteLLM), or --apply it to a proxy',
  options: [
    { name: 'gateway', description: 'Gateway: litellm (meta-llm has no documented budget API yet)', type: 'string', required: true },
    { name: 'model', description: 'Gateway model name for model_max_budget / budget_fallbacks', type: 'string' },
    { name: 'apply', description: 'POST the budget fields to <url>/key/generate', type: 'boolean', default: false },
    { name: 'url', description: 'Proxy base URL (https, or http to a loopback host only)', type: 'string' },
    { name: 'key-env', description: 'Name of the environment variable holding the proxy master key', type: 'string' },
    { name: 'print-key', description: 'Print the generated virtual key in full (masked by default)', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const refusal = gatewayRefusal(flag(ctx, 'gateway'));
    if (refusal) {
      output.printError(refusal);
      return { success: false, message: refusal, exitCode: 2 };
    }
    const { budget, result } = loadOrFail(ctx.cwd);
    if (!budget) return result!;
    const model = flag(ctx, 'model');
    let body;
    try {
      body = toLiteLLMKeyBody(budget, model === undefined ? undefined : String(model));
    } catch (error) {
      const message = String((error as Error).message);
      output.printError(message);
      return { success: false, message, exitCode: 2 };
    }

    if (!flag(ctx, 'apply')) {
      // The global --format (text|json|table): json prints the /key/generate body, anything else the YAML key settings.
      const format = flag(ctx, 'format') === 'json' ? 'json' : 'yaml';
      output.write(formatBody(body, format));
      if (model === undefined && budget.fallbackModel) {
        output.writeErrorln(`note: pass --model <gateway model> to add model_max_budget and budget_fallbacks (-> ${budget.fallbackModel})`);
      }
      return { success: true, data: body };
    }

    // --apply: every check before anything is sent.
    const target = keyGenerateUrl(flag(ctx, 'url'));
    if (!target.url) {
      output.printError(target.error!);
      return { success: false, message: target.error, exitCode: 2 };
    }
    const master = keyFromEnv(flag(ctx, 'key-env'));
    if (!master.key) {
      output.printError(master.error!);
      return { success: false, message: master.error, exitCode: 2 };
    }
    const applied = await applyToLiteLLM(target.url, master.key, body);
    if (!applied.ok) {
      const message = `LiteLLM refused /key/generate (${applied.status || 'no response'}): ${applied.error ?? ''}`;
      output.printError(message);
      return { success: false, message, exitCode: 1 };
    }
    output.printSuccess(`Budget applied at ${target.url.origin}: a virtual key with ${body.budget_limits.length} budget window(s).`);
    if (applied.generatedKey) {
      output.writeln(`Virtual key: ${flag(ctx, 'print-key') ? applied.generatedKey : maskKey(applied.generatedKey)}`);
      if (!flag(ctx, 'print-key')) output.writeln('(masked; it is shown once by LiteLLM; use --print-key to see it, or look it up in the LiteLLM UI)');
    }
    return { success: true, data: { status: applied.status } };
  },
};

const budgetCommand: Command = {
  name: 'budget',
  description: 'The shared budget file and its export to a gateway (ADR-508)',
  subcommands: [setSub, getSub, exportSub],
  action: getSub.action,
};

const reportSub: Command = {
  name: 'report',
  description: 'Which subagent types and tools spent the money (from the ruflo-mods cost ledger)',
  options: [
    { name: 'days', description: 'Only sessions that ended in the last N days (0: all)', type: 'string', default: '0' },
    { name: 'json', description: 'Print JSON', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const days = Number(flag(ctx, 'days') ?? 0);
    const since = Number.isFinite(days) && days > 0 ? Date.now() - days * 86_400_000 : 0;
    const { report, error } = readAttribution(ctx.cwd, since);
    if (!report) {
      output.printError(error ?? 'cannot read the attribution file');
      return { success: false, message: error, exitCode: 1 };
    }
    if (flag(ctx, 'json')) {
      output.printJson(report);
      return { success: true, data: report };
    }
    if (report.sessions === 0) {
      output.writeln(`No attributed sessions in ${ATTRIBUTION_PATH}. The ruflo-mods costLedger option (default on) writes one line per session.`);
      return { success: true, data: report };
    }
    const pct = (v: number) => (report.totalUsd > 0 ? `${((v / report.totalUsd) * 100).toFixed(1)}%` : '-');
    output.writeln(`${report.sessions} session(s), $${report.totalUsd.toFixed(4)} attributed${report.refusals ? `, ${report.refusals} gateway budget refusal(s)` : ''}${report.skipped ? ` (${report.skipped} unreadable line(s) skipped)` : ''}`);
    output.writeln('Estimate: each turn\'s cost is split evenly across the tool calls made in it (a turn without tool calls goes to main / (model)).');
    for (const [title, rows] of [['By agent', report.byAgent], ['By tool', report.byTool]] as const) {
      output.writeln('');
      output.writeln(output.bold(title));
      output.printTable({
        columns: [{ key: 'name', header: 'Name', width: 28 }, { key: 'usd', header: 'USD', width: 12, align: 'right' }, { key: 'share', header: 'Share', width: 8, align: 'right' }],
        data: rows.slice(0, 20).map(([name, usd]) => ({ name, usd: usd.toFixed(4), share: pct(usd) })),
      });
    }
    return { success: true, data: report };
  },
};

export const costCommand: Command = {
  name: 'cost',
  description: 'Cost budgets, gateway budget export and per-agent/tool attribution (ADR-508)',
  subcommands: [budgetCommand, reportSub],
  examples: [
    { command: 'ruflo cost budget set --daily 10 --monthly 100', description: 'Write the shared budget file' },
    { command: 'ruflo cost budget export --gateway litellm', description: 'Print LiteLLM key budget settings (YAML)' },
    { command: 'ruflo cost budget export --gateway litellm --apply --url https://proxy.example --key-env LITELLM_MASTER_KEY', description: 'Create a budgeted LiteLLM virtual key' },
    { command: 'ruflo cost report', description: 'Spend by subagent type and by tool' },
  ],
  action: reportSub.action,
};

export default costCommand;
