import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';

export const routerReloadCommand: Command = {
  name: 'reload',
  description: 'Force-reload the neural router (clears in-process backend cache; next call re-reads artifact/corpus)',
  options: [],
  examples: [
    { command: 'claude-flow neural router reload', description: 'Refresh backend caches after retraining an artifact' },
  ],
  action: async (): Promise<CommandResult> => {
    const { __resetNeuralRouterForTests, neuralRouterStatus } = await import('../../ruvector/neural-router.js');
    __resetNeuralRouterForTests();
    output.writeln(output.success('Neural router backend cache cleared.'));
    const status = await neuralRouterStatus();
    output.writeln(output.dim(`  Active backend now: ${status.routedBy ?? '—'}  (${status.reason})`));
    return { success: true, data: status };
  },
};
