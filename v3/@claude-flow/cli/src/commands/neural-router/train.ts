import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

export const routerTrainCommand: Command = {
  name: 'train',
  description: 'Train a KRR router artifact from a DRACO-shaped JSON corpus (or the bundled seed) — pure TS, no native deps',
  options: [
    { name: 'corpus', short: 'c', type: 'string', description: 'Path to DRACO rows JSON ({embedding, scores}). Defaults to the bundled seed corpus.' },
    { name: 'out', short: 'o', type: 'string', description: 'Output path for the trained KRR JSON.' },
    { name: 'quality-bar', short: 'q', type: 'number', description: 'qualityBar for cost-optimal selection (default 0.8)', default: '0.8' },
  ],
  examples: [
    { command: 'claude-flow neural router train', description: 'Train from the bundled seed and write to ./router.krr.json' },
    { command: 'claude-flow neural router train -c ./my-corpus.json -o ./my-router.krr.json', description: 'Train from a custom corpus' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const corpusPath = ctx.flags.corpus as string | undefined;
    const outPath = (ctx.flags.out as string) || './router.krr.json';
    const requestedQualityBar = parseFloat(String(ctx.flags.qualityBar ?? ctx.flags['quality-bar'] ?? 0.8));
    const qualityBar = Number.isNaN(requestedQualityBar) ? 0.8 : requestedQualityBar;
    // Indirect the optional-dep specifier through a string variable so tsc
    // doesn't statically resolve `@metaharness/router` at build time (TS2307
    // when it isn't installed — #2586 pattern). The dep is optional at
    // runtime; the catch below emits a clear operator message.
    const metaharnessRouterPkg: string = '@metaharness/router';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic import of optional dep; call surface is fluid across upstream versions
    let mh: any;
    try {
      mh = await import(metaharnessRouterPkg);
    } catch {
      output.printError('@metaharness/router is not installed. `npm install @metaharness/router@^0.4.0` then re-run.');
      return { success: false, exitCode: 1 };
    }
    const { neuralRouterStatus } = await import('../../ruvector/neural-router.js');
    const status = await neuralRouterStatus();
    const fs = await import('node:fs');
    const seedPath = corpusPath ?? status.config.seedCorpusPath;
    if (!fs.existsSync(seedPath)) {
      output.printError(`Corpus not found at ${seedPath}`);
      return { success: false, exitCode: 1 };
    }
    const rows = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    output.writeln();
    output.writeln(output.bold('Training KRR router (ADR-148)'));
    output.writeln(output.dim('─'.repeat(60)));
    output.writeln(`  Corpus: ${seedPath}  (${rows.length} rows, dim=${rows[0]?.embedding?.length ?? '?'})`);
    output.writeln(`  Output: ${outPath}`);
    output.writeln(`  qualityBar: ${qualityBar}`);
    output.writeln();
    const spinner = output.createSpinner({ text: 'Fitting Beta-Bernoulli KRR with leave-one-out CV…', spinner: 'dots' });
    spinner.start();
    const t0 = performance.now();
    const { router, lambda, looQuality } = mh.trainRouter(rows, { haiku: 1, sonnet: 3, opus: 15 }, {
      qualityBar,
      lambdas: [1e-4, 1e-3, 1e-2, 1e-1, 1e0],
    });
    const ms = performance.now() - t0;
    spinner.succeed(`Trained in ${ms.toFixed(0)}ms (λ=${lambda.toExponential(3)}, looQuality=${looQuality.toFixed(4)})`);
    fs.writeFileSync(outPath, JSON.stringify(router.toJSON()));
    const bytes = fs.statSync(outPath).size;
    output.writeln(`Wrote ${bytes} bytes → ${outPath}`);
    output.writeln();
    output.writeln(output.dim('Use: CLAUDE_FLOW_ROUTER_NEURAL=1 CLAUDE_FLOW_ROUTER_MODEL_PATH=' + outPath + ' …'));
    output.writeln();
    return { success: true, data: { lambda, looQuality, trainMs: ms, modelPath: outPath, modelBytes: bytes } };
  },
};
