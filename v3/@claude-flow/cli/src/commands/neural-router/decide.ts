import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 30 — forward-direction observability. Pairs with iter 28's
// backward-direction `decisions` query. Lets operators inspect what the
// router would pick for a hypothetical task WITHOUT actually dispatching.
export const routerDecideCommand: Command = {
  name: 'decide',
  description: 'Show what the router would pick for a given task — no dispatch, just inspection (ADR-149 iter 30)',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task text (alternatively pass as positional arg)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router decide "fix typo in cache.ts"', description: 'See the routing decision for a small task' },
    { command: 'claude-flow neural router decide -t "design distributed consensus" -f json', description: 'JSON output for the routing decision' },
    { command: 'CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK=5 claude-flow neural router decide -t "..."', description: 'See iter 29 cost-ceiling mode in action' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = (ctx.flags.task as string | undefined) ?? (ctx.args && ctx.args[0]) ?? null;
    const fmt = (ctx.flags.format as string) || 'table';
    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      output.printError('Provide a task: --task "..." or as a positional argument');
      return { success: false, exitCode: 1 };
    }

    const { analyzeTaskComplexity, routeToModelFull } = await import('../../ruvector/model-router.js');
    const { embedTaskWithCache } = await import('../../ruvector/task-embedder.js');
    const { neuralRouterStatus, tryCostOptimalRoute } = await import('../../ruvector/neural-router.js');

    const t0 = performance.now();
    const complexity = analyzeTaskComplexity(task);
    let embedding: number[] | undefined;
    try { embedding = await embedTaskWithCache(task); } catch { /* embedder may be absent */ }
    const result = await routeToModelFull(task, embedding);
    const status = await neuralRouterStatus();
    // iter 45 — also fetch the neural-layer result so we can surface the
    // ensemble-disagreement diagnostic. Extra inference but `decide` is an
    // operator inspection tool, not the hot path.
    let neuralResult: Awaited<ReturnType<typeof tryCostOptimalRoute>> = null;
    if (embedding) {
      const bucket = complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high';
      try {
        neuralResult = await tryCostOptimalRoute(embedding, { complexityBucket: bucket });
      } catch { /* gated off or backend absent */ }
    }
    const ms = performance.now() - t0;

    const payload = {
      task: task.length > 200 ? task.slice(0, 200) + '…' : task,
      taskLength: task.length,
      hasEmbedding: !!embedding,
      embeddingDim: embedding?.length ?? null,
      complexity: {
        score: complexity.score,
        bucket: complexity.score < 0.34 ? 'low' : complexity.score < 0.67 ? 'med' : 'high',
        features: complexity.features,
        indicators: complexity.indicators,
      },
      decision: {
        model: result.model,
        modelId: result.modelId,
        provider: result.provider,
        openrouterModel: result.openrouterModel,
        confidence: result.confidence,
        uncertainty: result.uncertainty,
        routedBy: result.routedBy,
        neuralBackend: result.neuralBackend,
        costMultiplier: result.costMultiplier,
        reasoning: result.reasoning,
        // iter 45 — ensemble disagreement diagnostic (always set when both
        // unified KRR + bucket specialist are loaded; observable signal for
        // tuning iter 44's threshold). null when not applicable.
        ensembleDisagreement: neuralResult?.ensembleDisagreement ?? null,
      },
      alternatives: result.alternatives,
      backend: {
        enabled: status.enabled,
        available: status.available,
        routedBy: status.routedBy,
        reason: status.reason,
      },
      activeEnv: {
        CLAUDE_FLOW_ROUTER_NEURAL: process.env.CLAUDE_FLOW_ROUTER_NEURAL ?? null,
        CLAUDE_FLOW_ROUTER_CALIBRATE: process.env.CLAUDE_FLOW_ROUTER_CALIBRATE ?? null,
        CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK: process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK ?? null,
        CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS: process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS ?? null,
        CLAUDE_FLOW_ROUTER_QUALITY_BAR: process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR ?? null,
        CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL: process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL ?? null,
        CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD: process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD ?? null,
      },
      elapsedMs: Math.round(ms * 100) / 100,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Routing decision preview (ADR-149 iter 30 — no dispatch)'));
    output.writeln(output.dim('─'.repeat(72)));
    output.writeln(`  Task:        "${payload.task}"`);
    output.writeln(`  Length:      ${payload.taskLength} chars`);
    output.writeln(`  Embedding:   ${payload.hasEmbedding ? `${payload.embeddingDim} dims` : output.warning('not available (embedder absent / disabled)')}`);
    output.writeln('');
    output.writeln(output.bold('  Complexity:'));
    output.writeln(`    score:   ${complexity.score.toFixed(3)}`);
    output.writeln(`    bucket:  ${payload.complexity.bucket}`);
    output.writeln(`    features: ${Object.entries(complexity.features).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(', ')}`);
    if (complexity.indicators.high.length + complexity.indicators.medium.length + complexity.indicators.low.length > 0) {
      output.writeln(`    indicators: high=[${complexity.indicators.high.slice(0,4).join(',')}] medium=[${complexity.indicators.medium.slice(0,4).join(',')}] low=[${complexity.indicators.low.slice(0,4).join(',')}]`);
    }
    output.writeln('');
    output.writeln(output.bold('  Decision:'));
    output.writeln(`    model:        ${output.success(result.model)}${result.modelId ? `  (id=${result.modelId})` : ''}`);
    output.writeln(`    routed_by:    ${result.routedBy}${result.neuralBackend ? `  via ${result.neuralBackend}` : ''}`);
    output.writeln(`    confidence:   ${result.confidence.toFixed(3)}    uncertainty: ${result.uncertainty.toFixed(3)}`);
    output.writeln(`    cost mult:    ${result.costMultiplier.toFixed(2)}×`);
    if (result.provider === 'openrouter' && result.openrouterModel) {
      output.writeln(`    via:          openrouter → ${result.openrouterModel}`);
    }
    output.writeln(`    reasoning:    ${result.reasoning}`);
    if (neuralResult?.ensembleDisagreement !== undefined) {
      const d = neuralResult.ensembleDisagreement;
      const annotation = d > 0.20 ? output.warning(' ⚠ high — consider tuning iter 44 threshold')
        : d > 0.10 ? output.dim(' (moderate)')
        : output.dim(' (low — predictions agree)');
      output.writeln(`    ensemble disagreement: ${d.toFixed(4)}${annotation}`);
    }
    output.writeln('');
    if (result.alternatives.length > 0) {
      output.writeln(output.bold('  Alternatives (model: score):'));
      for (const a of result.alternatives) {
        output.writeln(`    ${a.model.padEnd(8)}  ${a.score.toFixed(4)}`);
      }
      output.writeln('');
    }
    output.writeln(output.bold('  Backend state:'));
    output.writeln(`    enabled:    ${status.enabled}`);
    output.writeln(`    available:  ${status.available}`);
    output.writeln(`    routedBy:   ${status.routedBy ?? '—'}`);
    output.writeln(`    reason:     ${status.reason}`);
    output.writeln('');
    const activeEnvKeys = Object.entries(payload.activeEnv).filter(([, v]) => v !== null);
    if (activeEnvKeys.length > 0) {
      output.writeln(output.bold('  Active env overrides:'));
      for (const [k, v] of activeEnvKeys) output.writeln(`    ${k}=${v}`);
      output.writeln('');
    }
    output.writeln(output.dim(`  Total decision time: ${ms.toFixed(1)}ms`));
    output.writeln('');
    return { success: true, data: payload };
  },
};
