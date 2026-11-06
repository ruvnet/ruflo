import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 55 — side-by-side comparison of the two selector modes.
// Iter 29 added quality-best-under-budget; iter 30 added `decide` for the
// default cost-optimal mode. This subcommand runs BOTH on the same task
// so operators can see which mode is right for their workload BEFORE
// flipping CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK on for production.
export const routerCompareModesCommand: Command = {
  name: 'compare-modes',
  description: 'Compare selector modes side-by-side for a hypothetical task (cost-optimal vs cost-ceiling) — ADR-149 iter 55',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task text (or positional arg)' },
    { name: 'ceiling', type: 'number', description: 'Cost-ceiling $/Mtok for iter 29 mode (default 20)', default: '20' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router compare-modes "refactor strategy pattern"', description: 'Compare both modes for a task' },
    { command: 'claude-flow neural router compare-modes -t "..." --ceiling 5', description: 'Cost-ceiling at $5 blended' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = (ctx.flags.task as string | undefined) ?? (ctx.args && ctx.args[0]) ?? null;
    if (!task) {
      output.printError('Provide a task: --task "..." or as positional arg');
      return { success: false, exitCode: 1 };
    }
    const ceiling = parseFloat(ctx.flags.ceiling as string || '20') || 20;
    const fmt = (ctx.flags.format as string) || 'table';

    const { embedTaskWithCache } = await import('../../ruvector/task-embedder.js');
    const { tryCostOptimalRoute, __resetNeuralRouterForTests } = await import('../../ruvector/neural-router.js');
    const { analyzeTaskComplexity } = await import('../../ruvector/model-router.js');

    const complexity = analyzeTaskComplexity(task);
    const bucket = complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high';
    let embedding: number[] | undefined;
    try { embedding = await embedTaskWithCache(task); } catch { /* */ }

    if (!embedding) {
      output.printError('Embedder unavailable — cannot run neural routing for comparison');
      return { success: false, exitCode: 1 };
    }

    // Mode 1: cost-optimal (default — no ceiling)
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    delete process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK;
    __resetNeuralRouterForTests();
    const costOptimal = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });

    // Mode 2: cost-ceiling
    process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK = String(ceiling);
    __resetNeuralRouterForTests();
    const costCeiling = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });

    // Clean up
    delete process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK;
    __resetNeuralRouterForTests();

    const payload = {
      task: task.length > 200 ? task.slice(0, 200) + '…' : task,
      complexity: complexity.score,
      bucket,
      modes: {
        costOptimal: costOptimal ? {
          modelId: costOptimal.modelId,
          predictedQuality: costOptimal.predictedQuality,
          costPerMTok: costOptimal.alternatives.find(a => a.modelId === costOptimal.modelId)?.costPerMTok ?? null,
          metBar: costOptimal.metBar,
        } : null,
        costCeiling: costCeiling ? {
          ceilingUsd: ceiling,
          modelId: costCeiling.modelId,
          predictedQuality: costCeiling.predictedQuality,
          costPerMTok: costCeiling.alternatives.find(a => a.modelId === costCeiling.modelId)?.costPerMTok ?? null,
          metBar: costCeiling.metBar,
        } : null,
      },
      sameModel: costOptimal?.modelId === costCeiling?.modelId,
      deltaQuality: (costCeiling && costOptimal) ? costCeiling.predictedQuality - costOptimal.predictedQuality : null,
      deltaCost: (costCeiling && costOptimal)
        ? ((costCeiling.alternatives.find(a => a.modelId === costCeiling.modelId)?.costPerMTok ?? 0) - (costOptimal.alternatives.find(a => a.modelId === costOptimal.modelId)?.costPerMTok ?? 0))
        : null,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Selector mode comparison (ADR-149 iter 55)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Task:        "${payload.task}"`);
    output.writeln(`  Complexity:  ${complexity.score.toFixed(3)} (bucket: ${bucket})`);
    output.writeln('');
    output.writeln(output.bold('  Cost-optimal mode (default — cheapest above qualityBar):'));
    if (costOptimal) {
      const co = payload.modes.costOptimal!;
      output.writeln(`    picked:           ${output.success(co.modelId)}`);
      output.writeln(`    predicted Q:      ${co.predictedQuality.toFixed(4)}`);
      output.writeln(`    cost ($/Mtok):    $${co.costPerMTok?.toFixed(2)}`);
      output.writeln(`    met quality bar:  ${co.metBar ? '✓' : '✗'}`);
    } else {
      output.writeln(`    ${output.warning('null (neural backend declined — would fall back to bandit)')}`);
    }
    output.writeln('');
    output.writeln(output.bold(`  Cost-ceiling mode (iter 29 — best quality ≤ $${ceiling}/Mtok):`));
    if (costCeiling) {
      const cc = payload.modes.costCeiling!;
      output.writeln(`    picked:           ${output.success(cc.modelId)}`);
      output.writeln(`    predicted Q:      ${cc.predictedQuality.toFixed(4)}`);
      output.writeln(`    cost ($/Mtok):    $${cc.costPerMTok?.toFixed(2)}`);
      output.writeln(`    met quality bar:  ${cc.metBar ? '✓' : '✗'}`);
    } else {
      output.writeln(`    ${output.warning('null')}`);
    }
    output.writeln('');
    if (costOptimal && costCeiling) {
      if (payload.sameModel) {
        output.writeln(output.dim('  Both modes picked the same model — selector choice irrelevant for this task.'));
      } else {
        const dq = payload.deltaQuality!;
        const dc = payload.deltaCost!;
        const qSign = dq > 0 ? '+' : '';
        const cSign = dc > 0 ? '+' : '';
        const qColor = dq > 0 ? output.success(`${qSign}${dq.toFixed(4)}`) : output.warning(`${dq.toFixed(4)}`);
        const cColor = dc > 0 ? output.warning(`${cSign}$${dc.toFixed(2)}`) : output.success(`$${dc.toFixed(2)}`);
        output.writeln(`  Δ (ceiling − optimal):  predicted Q: ${qColor}    cost: ${cColor}`);
        output.writeln('');
        output.writeln(output.dim(`    Cost-ceiling pays extra cost for higher quality (or is forced cheap if ceiling is tight).`));
        output.writeln(output.dim(`    Cost-optimal accepts qualityBar threshold but minimizes spend.`));
      }
    }
    output.writeln('');
    return { success: true, data: payload };
  },
};
