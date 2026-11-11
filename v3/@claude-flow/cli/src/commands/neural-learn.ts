/**
 * `neural learn` — governed self-improvement for the centroid agent router (ADR-529).
 *
 *   harvest   learn from this project's Claude Code transcripts (Agent/Task delegations)
 *   correct   record one explicit correction: "<task>" belonged to <agent>
 *   propose   build a candidate from the ledger, evaluate it, gate it, write a receipt
 *   list      show candidate receipts
 *   promote   copy an accepted candidate to .claude-flow/router/centroids.json (--confirm)
 *
 * Nothing here changes routing on its own. A promoted file is used only when
 * CLAUDE_FLOW_ROUTER_CENTROID=1 and CLAUDE_FLOW_ROUTER_CENTROID_PATH points at it.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

type Flags = CommandContext['flags'];
const str = (f: Flags, n: string): string | undefined => (typeof f[n] === 'string' && (f[n] as string).length > 0 ? (f[n] as string) : undefined);
const isJson = (f: Flags) => str(f, 'format') === 'json';
const formatOpt = { name: 'format', short: 'f', type: 'string' as const, description: 'Output format: table, json', default: 'table' };

function fail(message: string, json: boolean, exitCode = 1): CommandResult {
  if (json) output.writeln(JSON.stringify({ ok: false, error: message }, null, 2));
  else output.printError(message);
  return { success: false, exitCode, message };
}
function emit(json: boolean, data: unknown, lines: () => void): void {
  if (json) output.writeln(JSON.stringify(data, null, 2));
  else lines();
}

async function baseArtifact() {
  const { loadCentroidArtifact } = await import('../ruvector/centroid-router.js');
  // Always learn on top of the shipped artifact, never on a previously promoted one.
  const r = loadCentroidArtifact({ ...process.env, CLAUDE_FLOW_ROUTER_CENTROID_PATH: '' });
  if (!r.artifact) throw new Error(`shipped centroid artifact unavailable: ${r.error}`);
  return r.artifact;
}

/** Embed and add labelled texts to the ledger. Refuses unless MiniLM is available. */
async function addToLedger(root: string, items: Array<{ label: string; text: string; src: 'transcript' | 'feedback'; group: string }>) {
  const L = await import('../ruvector/router-learning.js');
  const { embedForRouter } = await import('../ruvector/router-embedder.js');
  const base = await baseArtifact();
  const known = items.filter((i) => base.labels.includes(i.label) && i.label !== 'none');
  const emb = await embedForRouter(known.map((i) => i.text), 'minilm');
  if (emb.embedder !== 'minilm') throw new Error(`MiniLM unavailable (${emb.reason ?? 'unknown'}); the ledger needs the router's embedder`);
  const now = Date.now();
  const rows = known.map((i, k) => ({ h: L.textHash(i.text), g: L.textHash(i.group), label: i.label, src: i.src, q: L.encodeVec(emb.vectors[k]), t: now }));
  const ledger = L.loadLedger(root, base.model, base.dim);
  const merged = L.mergeLedger(ledger, rows);
  L.saveLedger(root, merged.ledger);
  return { added: merged.added, total: merged.ledger.rows.length, skippedLabels: items.length - known.length };
}

const harvestCommand: Command = {
  name: 'harvest',
  description: "Add labelled rows from this project's Claude Code transcripts (agent delegations) to the local ledger",
  options: [
    { name: 'dir', type: 'string', description: 'Transcript directory (default: ~/.claude/projects/<this project>)' },
    { name: 'dry-run', type: 'boolean', description: 'Count only; write nothing' },
    formatOpt,
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    try {
      const L = await import('../ruvector/router-learning.js');
      const dir = str(ctx.flags, 'dir') ?? L.projectTranscriptDir(ctx.cwd);
      const h = L.harvestTranscripts(dir);
      const byLabel: Record<string, number> = {};
      for (const i of h.items) byLabel[i.label] = (byLabel[i.label] ?? 0) + 1;
      const res = ctx.flags['dry-run'] ? null : await addToLedger(ctx.cwd, h.items);
      const data = { dir, files: h.files, agentCalls: h.calls, unlabelled: h.skipped, labelled: h.items.length, byLabel, ledger: res };
      emit(json, data, () => {
        output.writeln(output.bold(`Harvested ${dir}`));
        output.writeln(`  ${h.files} transcripts, ${h.calls} agent calls, ${h.items.length} with a routing label (${h.skipped} unlabelled skipped)`);
        output.writeln(`  ${Object.entries(byLabel).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`);
        if (res) output.writeln(`  Ledger: +${res.added} new, ${res.total} rows (${L.ledgerPath(ctx.cwd)}). Text is not stored (vectors are; the ledger is local, 0600).`);
      });
      return { success: true, data };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const correctCommand: Command = {
  name: 'correct',
  description: 'Record that a task belonged to an agent (one explicit correction)',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task description', required: true },
    { name: 'agent', short: 'a', type: 'string', description: 'The router label it belonged to', required: true },
    formatOpt,
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const task = str(ctx.flags, 'task')?.trim().slice(0, 200), agent = str(ctx.flags, 'agent');
    if (!task || task.length < 3 || !agent) return fail('--task (3+ characters) and --agent are required', json);
    try {
      const base = await baseArtifact();
      if (!base.labels.includes(agent) || agent === 'none') return fail(`'${agent}' is not a router label (${base.labels.filter((l) => l !== 'none').join(', ')})`, json);
      const res = await addToLedger(ctx.cwd, [{ label: agent, text: task, src: 'feedback', group: `feedback:${task}` }]);
      emit(json, res, () => output.writeln(`Recorded. Ledger: ${res.total} rows (+${res.added}).`));
      return { success: true, data: res };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const proposeCommand: Command = {
  name: 'propose',
  description: 'Build a candidate router from the ledger, evaluate it on local holdout + the shipped guard set, gate it, write a receipt',
  options: [formatOpt],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    try {
      const L = await import('../ruvector/router-learning.js');
      const G = await import('../ruvector/router-learning-gate.js');
      const base = await baseArtifact();
      const ledger = L.loadLedger(ctx.cwd, base.model, base.dim);
      const rule = await G.loadPromotionRule();
      const invariants: import('../ruvector/router-learning-gate.js').InvariantCheck = async (a) => {
        const { loadWsp, checkCentroidSelfRouting } = await import('../ruvector/ruv-fann-wsp.js');
        const w = await loadWsp();
        if (!w.available) return { status: 'skipped', detail: `ruv-FANN WSP unavailable: ${w.reason}` };
        const r = await checkCentroidSelfRouting(w.modules, a);
        return { status: r.accepted ? 'passed' : 'failed', detail: `${r.checks} checks, ${r.violations.length} violations` };
      };
      const testIndex = G.countReceipts(ctx.cwd) + 1;
      const r = await G.proposeCandidate({ base, ledger, guard: L.loadGuard(), invariants, rule, testIndex });
      if ('refused' in r) return fail(r.refused, json, 3);
      const path = G.writeReceipt(ctx.cwd, r);
      const { artifact: _a, ...summary } = r;
      emit(json, { ...summary, path }, () => {
        output.writeln(output.bold(`Candidate ${r.id}: ${r.decision.promote ? output.success('ACCEPTED by gate') : output.warning('rejected')}`));
        output.writeln(`  Local holdout: ${r.holdout.baselineCorrect}/${r.holdout.rows} → ${r.holdout.candidateCorrect}/${r.holdout.rows}`);
        output.writeln(`  Guard set:     ${r.guard.baselineCorrect}/${r.guard.rows} → ${r.guard.candidateCorrect}/${r.guard.rows} (must not drop)`);
        output.writeln(`  Invariants:    ${r.invariants.status} (${r.invariants.detail})`);
        output.writeln(`  Evidence:      ${r.sequential.candidateWins} wins / ${r.sequential.baselineWins} losses on holdout, e=${r.sequential.eValue.toFixed(2)} (needs ${r.sequential.threshold.toFixed(1)}, proposal #${r.sequential.testIndex})`);
        output.writeln(`  Gate:          ${r.gate.rule}${r.decision.reasons.length ? ' — ' + r.decision.reasons.join(', ') : ''}`);
        output.writeln(output.dim(`  Receipt: ${path}. Routing is unchanged.${r.decision.promote ? ` Promote with: neural learn promote ${r.id} --confirm` : ''}`));
      });
      return { success: true, data: { ...summary, path } };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const listCommand: Command = {
  name: 'list',
  description: 'List candidate receipts',
  options: [formatOpt],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const G = await import('../ruvector/router-learning-gate.js');
    const dir = join(ctx.cwd, '.claude-flow', 'router', 'candidates');
    const ids = existsSync(dir) ? readdirSync(dir).filter((n) => /^rc-\d{14}-[0-9a-f]{8}\.json$/.test(n)).map((n) => n.slice(0, -5)).sort() : [];
    const rows = ids.map((id) => { const r = G.readReceipt(ctx.cwd, id); return { id, promote: r.decision.promote, holdout: `${r.holdout.baselineCorrect}→${r.holdout.candidateCorrect}/${r.holdout.rows}`, guard: `${r.guard.baselineCorrect}→${r.guard.candidateCorrect}/${r.guard.rows}`, reasons: r.decision.reasons }; });
    emit(json, rows, () => {
      if (!rows.length) output.writeln('No candidates. Run: neural learn harvest, then neural learn propose');
      for (const r of rows) output.writeln(`${r.id}  ${r.promote ? 'accepted' : 'rejected'}  holdout ${r.holdout}  guard ${r.guard}  ${r.reasons.join(', ')}`);
    });
    return { success: true, data: rows };
  },
};

const promoteCommand: Command = {
  name: 'promote',
  description: 'Copy an accepted candidate to .claude-flow/router/centroids.json (requires --confirm)',
  options: [{ name: 'confirm', type: 'boolean', description: 'Required: write the promoted file' }, formatOpt],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const id = ctx.args[0];
    if (!id) return fail('usage: neural learn promote <candidate-id> --confirm', json);
    try {
      const G = await import('../ruvector/router-learning-gate.js');
      const r = G.promoteCandidate(ctx.cwd, id, { confirm: ctx.flags.confirm === true });
      emit(json, r, () => {
        output.writeln(output.success(`Promoted ${id} → ${r.path}`));
        output.writeln(output.dim(`  Use it: CLAUDE_FLOW_ROUTER_CENTROID=1 CLAUDE_FLOW_ROUTER_CENTROID_PATH=${r.path}`));
        if (r.previous) output.writeln(output.dim(`  Previous kept at ${r.previous}`));
      });
      return { success: true, data: r };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

export const learnCommand: Command = {
  name: 'learn',
  description: 'Governed self-improvement for the centroid agent router (ADR-529): harvest, correct, propose, list, promote',
  subcommands: [harvestCommand, correctCommand, proposeCommand, listCommand, promoteCommand],
  examples: [
    { command: 'claude-flow neural learn harvest', description: "Learn from this project's agent delegations" },
    { command: 'claude-flow neural learn propose', description: 'Build, evaluate and gate a candidate (routing unchanged)' },
    { command: 'claude-flow neural learn promote rc-… --confirm', description: 'Make an accepted candidate available' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Usage: neural learn <harvest|correct|propose|list|promote>');
    return { success: true };
  },
};
