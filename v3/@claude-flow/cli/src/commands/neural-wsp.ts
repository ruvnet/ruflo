/**
 * `neural wsp` — ruv-FANN weight-space tooling (ADR-528).
 *
 * Read-only evidence over dense models: fingerprint, inspect, invariant
 * checks and bounded-patch regression gates. Nothing here promotes a model,
 * writes routing state or changes what `hooks route` does. The only write is
 * `export-centroid`, which writes the file the user names.
 *
 * Backed by the optional dependencies ruv-fann-wsp, ruv-fann-wsp-invariants
 * and ruv-fann-wsp-lifecycle; every subcommand reports cleanly when they are
 * missing.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

type Flags = CommandContext['flags'];

function str(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function isJson(flags: Flags): boolean {
  return str(flags, 'format') === 'json';
}

function fail(message: string, json: boolean, exitCode = 1): CommandResult {
  if (json) output.writeln(JSON.stringify({ ok: false, error: message }, null, 2));
  else output.printError(message);
  return { success: false, exitCode, message };
}

async function requireWsp(json: boolean) {
  const { loadWsp } = await import('../ruvector/ruv-fann-wsp.js');
  const load = await loadWsp();
  if (!load.available) return { error: fail(`ruv-FANN WSP unavailable: ${load.reason}`, json, 2) };
  return { mods: load.modules };
}

/** The shipped (or CLAUDE_FLOW_ROUTER_CENTROID_PATH) centroid artifact. */
async function loadCentroid() {
  const { loadCentroidArtifact } = await import('../ruvector/centroid-router.js');
  return loadCentroidArtifact();
}

/** `--model <file>` when given, else the centroid router as a dense model. */
async function resolveModel(flags: Flags) {
  const w = await import('../ruvector/ruv-fann-wsp.js');
  const file = str(flags, 'model');
  if (file) return { model: w.assertDenseModel(w.readJsonInput(file, 'model')), source: resolvePath(file), artifact: null };
  const c = await loadCentroid();
  if (!c.artifact) throw new Error(`centroid router artifact unavailable: ${c.error}`);
  return { model: w.centroidToDenseModel(c.artifact), source: `centroid router (${c.path})`, artifact: c.artifact };
}

const formatOpt = { name: 'format', short: 'f', type: 'string' as const, description: 'Output format: table, json', default: 'table' };
const modelOpt = { name: 'model', short: 'm', type: 'string' as const, description: 'ruv-fann.dense-layers/1 JSON file (default: the centroid router)' };

const statusCommand: Command = {
  name: 'status',
  description: 'Show whether the ruv-FANN WSP packages are installed, their versions and limits',
  options: [formatOpt],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const { loadWsp, wspVersions } = await import('../ruvector/ruv-fann-wsp.js');
    const load = await loadWsp();
    const versions = wspVersions();
    const limits = load.available
      ? { wsp: load.modules.wsp.WSP_LIMITS, invariants: load.modules.invariants.INVARIANT_LIMITS, lifecycle: load.modules.lifecycle.LIFECYCLE_LIMITS }
      : null;
    const data = { available: load.available, reason: load.available ? null : load.reason, versions, limits };
    if (json) output.writeln(JSON.stringify(data, null, 2));
    else {
      output.writeln(output.bold('ruv-FANN weight-space programming'));
      output.writeln(`  Available: ${load.available ? output.success('yes') : output.warning('no — ' + data.reason)}`);
      for (const [k, v] of Object.entries(versions)) output.writeln(`  ${k.padEnd(24)} ${v ?? output.dim('not installed')}`);
      if (limits) output.writeln(output.dim(`  Patch limit: ${limits.wsp.maxEdits} edits · rows ≤ ${limits.wsp.maxRows} · params ≤ ${limits.wsp.maxParameters} · invariant cases ≤ ${limits.invariants.maxCases}`));
    }
    return { success: true, data };
  },
};

const inspectCommand: Command = {
  name: 'inspect',
  description: 'Fingerprint and describe a dense model (default: the centroid router)',
  options: [modelOpt, formatOpt],
  examples: [
    { command: 'claude-flow neural wsp inspect', description: 'Hash and shape of the shipped centroid router' },
    { command: 'claude-flow neural wsp inspect -m model.json -f json', description: 'Inspect your own ruv-FANN model' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const w = await requireWsp(json);
    if ('error' in w) return w.error!;
    try {
      const { model, source } = await resolveModel(ctx.flags);
      const inspection = await w.mods.wsp.inspectWeightModel(model);
      const data = { source, ...inspection };
      if (json) output.writeln(JSON.stringify(data, null, 2));
      else {
        output.writeln(output.bold(`Model: ${source}`));
        output.writeln(`  Hash:       ${inspection.baseHash}`);
        output.writeln(`  Shape:      ${inspection.inputSize} → ${inspection.outputSize}  (${inspection.parameterCount} parameters)`);
        for (const l of inspection.layers) {
          output.writeln(output.dim(`  layer ${l.layer}: ${l.inputs}→${l.outputs} ${l.activation} (${l.parameterCount} params)`));
        }
      }
      return { success: true, data };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const checkCommand: Command = {
  name: 'check',
  description: 'Run invariant checks: the built-in centroid self-routing suite, or --suite on --model',
  options: [
    modelOpt,
    { name: 'suite', short: 's', type: 'string', description: 'ruv-fann.invariants/1 JSON file (required with --model)' },
    { name: 'min-gap', type: 'number', description: 'Self-routing: required gap between a label and any other label on its own centroid', default: '0.05' },
    formatOpt,
  ],
  examples: [
    { command: 'claude-flow neural wsp check', description: 'Each centroid must route to its own label by a clear gap' },
    { command: 'claude-flow neural wsp check -m model.json -s invariants.json', description: 'Your own model and suite' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const w = await requireWsp(json);
    if ('error' in w) return w.error!;
    const mod = await import('../ruvector/ruv-fann-wsp.js');
    try {
      const modelFile = str(ctx.flags, 'model');
      const suiteFile = str(ctx.flags, 'suite');
      let data: Record<string, unknown>, accepted: boolean;
      if (!modelFile) {
        if (suiteFile) return fail('--suite needs --model; without --model the built-in self-routing suite runs', json);
        const c = await loadCentroid();
        if (!c.artifact) return fail(`centroid router artifact unavailable: ${c.error}`, json);
        const gapRaw = ctx.flags.minGap ?? ctx.flags['min-gap'];
        const minGap = gapRaw === undefined ? undefined : Number(gapRaw);
        if (minGap !== undefined && !(minGap > 0 && minGap < 1)) return fail('--min-gap must be in (0, 1)', json);
        const r = await mod.checkCentroidSelfRouting(w.mods, c.artifact, { minGap });
        accepted = r.accepted;
        data = { suite: 'centroid-self-routing', source: c.path, ...r };
      } else {
        if (!suiteFile) return fail('--model needs --suite (a ruv-fann.invariants/1 file)', json);
        const model = mod.assertDenseModel(mod.readJsonInput(modelFile, 'model'));
        const suite = mod.readJsonInput(suiteFile, 'suite');
        const r = await w.mods.invariants.checkModelInvariants(model, suite);
        accepted = r.accepted === true;
        data = { suite: resolvePath(suiteFile), source: resolvePath(modelFile), ...r };
      }
      if (json) output.writeln(JSON.stringify(data, null, 2));
      else {
        output.writeln(accepted ? output.success(`Invariants hold (${data.checks} checks, ${data.backend})`) : output.warning(`Invariants FAILED (${data.checks} checks)`));
        const v = (data.violations as Array<Record<string, unknown>>) ?? [];
        for (const x of v.slice(0, 20)) output.writeln(output.dim(`  ${x.case}: output ${x.output} ${x.constraint} — actual ${x.actual}, bound ${x.bound}`));
        if (v.length > 20) output.writeln(output.dim(`  … ${v.length - 20} more`));
      }
      return { success: accepted, exitCode: accepted ? 0 : 1, data };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const gateCommand: Command = {
  name: 'gate',
  description: 'Regression-gate a bounded weight patch against one or more datasets (evidence only; never promotes)',
  options: [
    { name: 'model', short: 'm', type: 'string', description: 'ruv-fann.dense-layers/1 JSON file', required: true },
    { name: 'patch', short: 'p', type: 'string', description: 'ruv-fann.weight-patch/1 JSON file (≤128 edits)', required: true },
    { name: 'suites', short: 's', type: 'string', description: 'JSON array of {name, dataset:{inputs,targets,rows}, policy:{maxMSE,maxRegressionMSE}}', required: true },
    formatOpt,
  ],
  examples: [
    { command: 'claude-flow neural wsp gate -m model.json -p patch.json -s suites.json', description: 'Accept or reject a patch on every suite' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const json = isJson(ctx.flags);
    const w = await requireWsp(json);
    if ('error' in w) return w.error!;
    const mod = await import('../ruvector/ruv-fann-wsp.js');
    try {
      const m = str(ctx.flags, 'model'), p = str(ctx.flags, 'patch'), s = str(ctx.flags, 'suites');
      if (!m || !p || !s) return fail('--model, --patch and --suites are all required', json);
      const model = mod.assertDenseModel(mod.readJsonInput(m, 'model'));
      const patch = mod.readJsonInput(p, 'patch');
      const suites = mod.readJsonInput(s, 'suites');
      if (!Array.isArray(suites)) return fail('suites: expected a JSON array', json);
      const r = await w.mods.lifecycle.runRegressionGate({ model, patch, suites });
      if (json) output.writeln(JSON.stringify(r, null, 2));
      else {
        output.writeln(r.accepted ? output.success('Patch ACCEPTED on every suite') : output.warning('Patch REJECTED'));
        output.writeln(output.dim(`  base ${r.baseHash.slice(0, 16)}… → candidate ${r.candidateHash.slice(0, 16)}…`));
        for (const x of r.suites) {
          const e = x.evaluation;
          output.writeln(`  ${x.name}: ${e.accepted ? 'pass' : 'fail'}  mse ${e.baseline.mse.toFixed(6)} → ${e.candidate.mse.toFixed(6)}${e.reasons.length ? '  (' + e.reasons.join('; ') + ')' : ''}`);
        }
        output.writeln(output.dim('  Evidence only: nothing was promoted or written.'));
      }
      return { success: r.accepted, exitCode: r.accepted ? 0 : 1, data: r };
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), json);
    }
  },
};

const exportCentroidCommand: Command = {
  name: 'export-centroid',
  description: 'Write the centroid router as a ruv-fann.dense-layers/1 model (one Linear layer)',
  options: [
    { name: 'output', short: 'o', type: 'string', description: 'Destination JSON file', required: true },
    { name: 'force', type: 'boolean', description: 'Overwrite an existing file', default: 'false' },
  ],
  examples: [
    { command: 'claude-flow neural wsp export-centroid -o centroid-router.json', description: 'Export for use with other ruv-FANN tooling' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const out = str(ctx.flags, 'output');
    if (!out) return fail('--output is required', false);
    const dest = resolvePath(out);
    if (existsSync(dest) && ctx.flags.force !== true) return fail(`${dest} exists; pass --force to overwrite`, false);
    const c = await loadCentroid();
    if (!c.artifact) return fail(`centroid router artifact unavailable: ${c.error}`, false);
    const { centroidToDenseModel } = await import('../ruvector/ruv-fann-wsp.js');
    const model = centroidToDenseModel(c.artifact);
    writeFileSync(dest, JSON.stringify(model) + '\n', { mode: 0o644 });
    output.writeln(output.success(`Wrote ${dest}`));
    output.writeln(output.dim(`  ${c.artifact.labels.length} outputs (labels, in order): ${c.artifact.labels.join(', ')}`));
    return { success: true, data: { path: dest, labels: c.artifact.labels } };
  },
};

export const wspCommand: Command = {
  name: 'wsp',
  description: 'ruv-FANN weight-space tooling: inspect, invariant checks, regression gates (ADR-528)',
  subcommands: [statusCommand, inspectCommand, checkCommand, gateCommand, exportCentroidCommand],
  examples: [
    { command: 'claude-flow neural wsp status', description: 'Are the optional ruv-FANN packages installed?' },
    { command: 'claude-flow neural wsp check', description: 'Self-routing invariants on the shipped centroid router' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln('Use a subcommand: status | inspect | check | gate | export-centroid');
    return { success: true };
  },
};
