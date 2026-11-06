import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 19 — CLI surface for the iter 18 trajectory consumer. Pairs
// decision+outcome rows from the JSONL recorder into seed-rows-compatible
// training rows that `neural router train` (above) can consume.
export const routerTrainFromTrajectoriesCommand: Command = {
  name: 'train-from-trajectories',
  description: 'Pair production decision+outcome JSONL rows into seed-corpus-shaped training rows (ADR-149 iter 18/19)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/model-router-trajectories.jsonl)' },
    { name: 'write', short: 'w', type: 'string', description: 'Write paired rows to this path (seed-rows.json-compatible JSON array)' },
    { name: 'union', short: 'u', type: 'string', description: 'Union paired rows with an existing seed-rows.json — production rows win on task-text collision' },
    { name: 'filter-source', type: 'string', description: 'Only keep outcomes whose source matches (e.g. llm-judge, agent-execute)' },
    { name: 'min-quality', type: 'number', description: 'Drop pairs whose MAX outcome score is below this threshold (default 0 — keep failures, they are training signal)', default: '0' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router train-from-trajectories', description: 'Show pairing stats from default trajectory path' },
    { command: 'claude-flow neural router train-from-trajectories -w production-rows.json', description: 'Emit a corpus to feed `router train`' },
    { command: 'claude-flow neural router train-from-trajectories -u assets/model-router/seed-rows.json -w merged.json', description: 'Union production rows with the bundled seed corpus' },
    { command: 'claude-flow neural router train-from-trajectories --filter-source llm-judge -w high-signal.json', description: 'Keep only judge-graded rows (drop coarse agent-execute baseline)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { pairTrajectoryRows } = await import('../../ruvector/router-trajectory.js');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const writePath = ctx.flags.write as string | undefined;
    const unionPath = ctx.flags.union as string | undefined;
    // Argv parser may camelCase hyphenated flags — accept both spellings.
    const filterSource = (ctx.flags['filter-source'] ?? ctx.flags.filterSource) as string | undefined;
    const minQuality = parseFloat((ctx.flags['min-quality'] ?? ctx.flags.minQuality) as string || '0') || 0;
    const fmt = (ctx.flags.format as string) || 'table';

    if (!fs.existsSync(inPath)) {
      const msg = `Trajectory file not found at ${inPath}`;
      if (fmt === 'json') {
        output.writeln(JSON.stringify({ error: msg, hint: 'Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 and run any agent_spawn → executeAgentTask flow to accumulate rows.' }, null, 2));
      } else {
        output.printError(msg);
        output.writeln(output.dim('  Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable trajectory recording.'));
      }
      return { success: false, exitCode: 1 };
    }

    const text = fs.readFileSync(inPath, 'utf8');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const allRows: unknown[] = [];
    let malformed = 0;
    for (const l of lines) {
      try { allRows.push(JSON.parse(l)); } catch { malformed++; }
    }

    type TrajectoryRow = Parameters<typeof pairTrajectoryRows>[0][number];
    const { pairs: rawPairs, stats } = pairTrajectoryRows(allRows as TrajectoryRow[]);

    let pairs = rawPairs;
    let filteredCount = pairs.length;
    if (filterSource) pairs = pairs.filter(p => p.source === filterSource);
    if (minQuality > 0) pairs = pairs.filter(p => Math.max(...Object.values(p.scores)) >= minQuality);
    filteredCount = pairs.length;

    const corpusRows = pairs.map(p => ({
      task: p.task,
      embedding: p.embedding,
      scores: p.scores,
      tier: p.tier,
    }));

    let unionRows = corpusRows;
    let unioned = false;
    let seedKept = 0;
    if (unionPath) {
      if (!fs.existsSync(unionPath)) {
        output.printError(`--union path ${unionPath} not found`);
        return { success: false, exitCode: 1 };
      }
      const seedRows = JSON.parse(fs.readFileSync(unionPath, 'utf8')) as Array<{ task: string; embedding: number[]; scores: Record<string, number>; tier: 'cheap' | 'mid' | 'strong' }>;
      const productionTasks = new Set(corpusRows.map(r => r.task));
      const kept = seedRows.filter(r => !productionTasks.has(r.task));
      seedKept = kept.length;
      unionRows = [...kept, ...corpusRows];
      unioned = true;
    }

    if (writePath) {
      fs.writeFileSync(writePath, JSON.stringify(unionRows));
    }

    const data = {
      input: inPath,
      malformed,
      stats,
      afterFilters: filteredCount,
      unioned,
      seedKept: unioned ? seedKept : undefined,
      finalRows: unionRows.length,
      written: writePath,
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(data, null, 2));
      return { success: true, data };
    }

    output.writeln();
    output.writeln(output.bold('Trajectory → Training-row pairing (ADR-149 iter 18/19)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Input file:        ${inPath}`);
    output.writeln(`  Total rows:        ${stats.totalRows} (${stats.decisions} decision, ${stats.outcomes} outcome${malformed > 0 ? `, ${malformed} malformed` : ''})`);
    output.writeln(`  Paired:            ${stats.paired}`);
    output.writeln(`  Dropped (no embed): ${stats.droppedNoEmbedding}`);
    output.writeln(`  Dropped (no match): ${stats.droppedNoMatch}`);
    if (Object.keys(stats.bySource).length > 0) output.writeln(`  By source:         ${JSON.stringify(stats.bySource)}`);
    if (Object.keys(stats.byTier).length > 0) output.writeln(`  By tier:           ${JSON.stringify(stats.byTier)}`);
    output.writeln(`  After filters:     ${filteredCount}`);
    if (unioned) output.writeln(`  Final (unioned):   ${unionRows.length}  (seed kept=${seedKept}, production=${corpusRows.length})`);
    if (writePath) output.writeln(`  Written:           ${writePath}`);
    output.writeln();
    if (stats.totalRows === 0) {
      output.writeln(output.dim('  Empty trajectory file. Enable recording with `export CLAUDE_FLOW_ROUTER_TRAJECTORY=1` and run agent_spawn flows.'));
    } else if (pairs.length > 0 && writePath) {
      output.writeln(output.dim(`  Next: claude-flow neural router train -c ${writePath} -o router.krr.json`));
    }
    output.writeln();
    return { success: true, data };
  },
};
