import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

// ADR-149 iter 36 — operational observability for the trajectory JSONL itself.
// Iter 17 added the recorder with rotation. Iter 28/30/32 consume the data.
// Nothing previously surfaced "is logging healthy?" — size vs cap, rotation
// count, parse success rate, pair-join rate, time range. SREs need this view.
export const routerTrajectoryHealthCommand: Command = {
  name: 'trajectory-health',
  description: 'Show health of the routing-decision JSONL log: size, rotations, parse rate, pair-join rate (ADR-149 iter 36)',
  options: [
    { name: 'in', short: 'i', type: 'string', description: 'Trajectory JSONL path (default: $CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH or .swarm/...)' },
    { name: 'format', short: 'f', type: 'string', description: 'Output format: table, json', default: 'table' },
  ],
  examples: [
    { command: 'claude-flow neural router trajectory-health', description: 'Snapshot of trajectory log health' },
    { command: 'claude-flow neural router trajectory-health --format json | jq .pairJoinRatePct', description: 'Pipe-friendly pair-join rate for dashboards' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const inPath = (ctx.flags.in as string | undefined)
      ?? process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? path.resolve(process.cwd(), '.swarm', 'model-router-trajectories.jsonl');
    const fmt = (ctx.flags.format as string) || 'table';

    // Recorder config (mirrors router-trajectory.ts defaults).
    const recorderEnabled = process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY === '1';
    const maxSizeBytes = parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE ?? `${10 * 1024 * 1024}`, 10) | 0;
    const maxRotations = Math.max(0, parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS ?? '3', 10) || 3);

    if (!fs.existsSync(inPath)) {
      const payload = {
        recorderEnabled,
        input: inPath,
        exists: false,
        message: 'No trajectory file at the configured path.',
        hint: recorderEnabled
          ? 'Recorder is enabled — file should appear after the next routing decision.'
          : 'Recorder is OFF. Set CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable.',
      };
      if (fmt === 'json') output.writeln(JSON.stringify(payload, null, 2));
      else {
        output.writeln('');
        output.writeln(output.bold('Trajectory health'));
        output.writeln(output.dim('─'.repeat(60)));
        output.writeln(`  Path:           ${inPath}`);
        output.writeln(`  Recorder gate:  ${recorderEnabled ? output.success('ON') : output.warning('OFF (CLAUDE_FLOW_ROUTER_TRAJECTORY=1 to enable)')}`);
        output.writeln(`  Status:         ${output.warning('file does not exist')}`);
        output.writeln(`  Hint:           ${payload.hint}`);
        output.writeln('');
      }
      return { success: true, data: payload };
    }

    const stat = fs.statSync(inPath);
    const sizeBytes = stat.size;
    const sizePct = maxSizeBytes > 0 ? Math.round((sizeBytes / maxSizeBytes) * 1000) / 10 : 0;

    // Count .bak rotation files.
    const rotationFiles: Array<{ index: number; path: string; bytes: number; mtime: string }> = [];
    for (let i = 1; i <= maxRotations; i++) {
      const p = `${inPath}.${i}`;
      if (fs.existsSync(p)) {
        const s = fs.statSync(p);
        rotationFiles.push({ index: i, path: p, bytes: s.size, mtime: s.mtime.toISOString() });
      }
    }

    // Parse JSONL — count rows by type, malformed lines, time range.
    interface MinimalRow { type?: string; ts?: string; task_hash?: string }
    const lines = fs.readFileSync(inPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
    let decisions = 0, outcomes = 0, malformed = 0, otherType = 0;
    let oldestTs: string | null = null;
    let newestTs: string | null = null;
    const decisionHashes = new Set<string>();
    const outcomeHashes = new Set<string>();
    for (const l of lines) {
      try {
        const r = JSON.parse(l) as MinimalRow;
        if (r.type === 'decision') {
          decisions++;
          if (r.task_hash) decisionHashes.add(r.task_hash);
        } else if (r.type === 'outcome') {
          outcomes++;
          if (r.task_hash) outcomeHashes.add(r.task_hash);
        } else {
          otherType++;
        }
        if (r.ts) {
          if (oldestTs === null || r.ts < oldestTs) oldestTs = r.ts;
          if (newestTs === null || r.ts > newestTs) newestTs = r.ts;
        }
      } catch { malformed++; }
    }

    // Pair-join rate: % of decisions that have a matching outcome.
    let pairedHashes = 0;
    for (const h of decisionHashes) if (outcomeHashes.has(h)) pairedHashes++;
    const pairJoinRatePct = decisionHashes.size > 0
      ? Math.round((pairedHashes / decisionHashes.size) * 10000) / 100
      : 0;
    const parseSuccessPct = lines.length > 0
      ? Math.round(((lines.length - malformed) / lines.length) * 10000) / 100
      : 100;

    const payload = {
      recorderEnabled,
      input: inPath,
      exists: true,
      file: {
        sizeBytes,
        sizePct,
        maxSizeBytes,
        maxRotations,
        rotationsOnDisk: rotationFiles.length,
        rotations: rotationFiles,
        mtime: stat.mtime.toISOString(),
      },
      rows: {
        total: lines.length,
        decisions, outcomes, otherType, malformed,
      },
      pairing: {
        uniqueDecisionHashes: decisionHashes.size,
        uniqueOutcomeHashes: outcomeHashes.size,
        pairedHashes,
        pairJoinRatePct,
        parseSuccessPct,
      },
      timeRange: {
        oldestTs, newestTs,
        spanHours: oldestTs && newestTs ? Math.round(((Date.parse(newestTs) - Date.parse(oldestTs)) / 3600_000) * 10) / 10 : 0,
      },
    };

    if (fmt === 'json') {
      output.writeln(JSON.stringify(payload, null, 2));
      return { success: true, data: payload };
    }

    output.writeln();
    output.writeln(output.bold('Trajectory health (ADR-149 iter 36)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Path:           ${inPath}`);
    output.writeln(`  Recorder gate:  ${recorderEnabled ? output.success('ON') : output.warning('OFF')}`);
    output.writeln('');
    output.writeln(output.bold('  File:'));
    const sizeMb = (sizeBytes / 1_048_576).toFixed(3);
    const capMb = (maxSizeBytes / 1_048_576).toFixed(1);
    const sizeWarn = sizePct >= 80 ? output.warning(`(${sizePct}% of cap)`) : output.dim(`(${sizePct}% of cap)`);
    output.writeln(`    size:         ${sizeBytes} bytes (${sizeMb} MB) of ${capMb} MB max  ${sizeWarn}`);
    output.writeln(`    last write:   ${stat.mtime.toISOString()}`);
    output.writeln(`    rotations:    ${rotationFiles.length} of ${maxRotations} max .bak files on disk`);
    for (const r of rotationFiles) {
      output.writeln(`      .${r.index}:  ${r.bytes} bytes  ${r.mtime}`);
    }
    output.writeln('');
    output.writeln(output.bold('  Rows:'));
    output.writeln(`    total:        ${lines.length}`);
    output.writeln(`    decisions:    ${decisions}`);
    output.writeln(`    outcomes:     ${outcomes}`);
    if (otherType > 0) output.writeln(`    other type:   ${otherType}`);
    output.writeln(`    malformed:    ${malformed}  (parse success ${parseSuccessPct}%)`);
    output.writeln('');
    output.writeln(output.bold('  Pairing (decision ↔ outcome join by task_hash):'));
    output.writeln(`    unique decision hashes:  ${decisionHashes.size}`);
    output.writeln(`    unique outcome hashes:   ${outcomeHashes.size}`);
    output.writeln(`    paired:                  ${pairedHashes} (${pairJoinRatePct}%)`);
    if (pairJoinRatePct < 50 && decisionHashes.size > 5) {
      output.writeln(output.warning(`    ⚠ pair-join rate < 50% — outcome rows may not be wired through (iter 17/31).`));
    }
    output.writeln('');
    if (oldestTs && newestTs) {
      output.writeln(output.bold('  Time range:'));
      output.writeln(`    oldest:       ${oldestTs}`);
      output.writeln(`    newest:       ${newestTs}`);
      output.writeln(`    span:         ${payload.timeRange.spanHours} hours`);
      output.writeln('');
    }
    return { success: true, data: payload };
  },
};
