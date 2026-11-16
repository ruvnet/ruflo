/** ADR-532: opt-in, observe-only, read-only adaptive execution tooling. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { compilePlan, chooseStrategy } from '../services/adaptive-execution.js';
import { runAdaptiveBenchmark } from '../services/adaptive-bench.js';

const planCommand: Command = {
  name: 'plan',
  description: 'Validate a declarative task graph without executing handlers',
  options: [
    { name: 'path', type: 'string', description: 'JSON manifest path under current project (required)' },
    { name: 'concurrency', type: 'number', description: 'Planned max parallelism 1..8', default: '2' },
    { name: 'strategy', type: 'string', description: 'serial, parallel or auto', default: 'auto' },
    { name: 'json', type: 'boolean', description: 'Machine-readable JSON report', default: false },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    try {
      const name = ctx.flags.path;
      if (typeof name !== 'string' || !name) throw new Error('--path is required');
      const target = resolve(ctx.cwd, name);
      const rel = relative(resolve(ctx.cwd), target);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('manifest must be inside project');
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error('manifest must be regular <=32KB file');
      const plan = compilePlan(JSON.parse(readFileSync(target, 'utf8')));
      if (plan.steps.some(s => !['read', 'compute'].includes(s.effect))) throw new Error('P0 refuses privileged effects');
      const chosen = chooseStrategy(plan, String(ctx.flags.strategy ?? 'auto') as 'auto'|'serial'|'parallel',
        Number(ctx.flags.concurrency ?? 2));
      const receipt = {
        ready: true, executed: false, planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
        nodes: plan.steps.length, effects: [...new Set(plan.steps.map(s => s.effect))], ...chosen,
        warning: 'Planning is not authorization. Each operation requires a trusted runtime policy and registered handler.',
      };
      if (ctx.flags.json) output.printJson(receipt);
      else output.writeln(JSON.stringify(receipt, null, 2));
      return {success:true,data:receipt};
    } catch (err) {
      output.printError(err instanceof Error ? err.message : 'invalid plan');
      return {success:false,exitCode:1};
    }
  }
};

const benchCommand: Command = {
  name: 'bench',
  description: 'Paired deterministic scheduler benchmark, no model calls or file writes',
  options: [
    { name:'dev',type:'number',description:'DEV tuning cases 5..100',default:'20' },
    { name:'holdout',type:'number',description:'Frozen holdout cases 30..100',default:'30' },
    { name:'json',type:'boolean',description:'Emit detailed JSON report',default:false },
  ],
  async action(ctx: CommandContext): Promise<CommandResult> {
    try {
      const result = await runAdaptiveBenchmark(Number(ctx.flags.dev ?? 20), Number(ctx.flags.holdout ?? 30));
      if (ctx.flags.json) output.printJson(result);
      else {
        output.writeln(`Synthetic holdout: ${result.holdout.correctness}/${result.holdout.samples} paired results identical`);
        output.writeln(`DEV-selected concurrency: ${result.selectedConcurrency}`);
        output.writeln(`Median: ${result.holdout.serialMedianMs} -> ${result.holdout.adaptiveMedianMs} ms (${result.holdout.medianSpeedup}x)`);
        output.writeln(`p95: ${result.holdout.serialP95Ms} -> ${result.holdout.adaptiveP95Ms} ms (${result.holdout.p95Speedup}x)`);
        output.writeln('Synthetic scheduling only; no evidence about LLM task success or real API costs.');
      }
      return {success:true,data:result};
    } catch (err) {
      output.printError(err instanceof Error ? err.message : 'benchmark failed');
      return {success:false,exitCode:1};
    }
  }
};

export const adaptiveCommand: Command = {
  name: 'adaptive',
  description: 'Opt-in ADR-532 capability checked execution planning and benchmarks',
  subcommands: [planCommand,benchCommand],
  options: [{name:'json',type:'boolean',description:'Emit JSON',default:false}],
  examples: [
    {command:'ruflo adaptive plan --path tests/fixtures/plan.json --json',description:'Validate without execution'},
    {command:'ruflo adaptive bench --dev 20 --holdout 30 --json',description:'Benchmark the deterministic scheduler'},
  ],
  action: async () => {
    output.writeln('Use ruflo adaptive plan --path <manifest.json> or ruflo adaptive bench');
    return {success:true};
  }
};
export default adaptiveCommand;
