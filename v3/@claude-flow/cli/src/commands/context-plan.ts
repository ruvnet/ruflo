import type { Command } from '../types.js';
import { planContextRead, type ContextIntent, type ContextMode } from '../services/context-delegation.js';

/** Metadata-only planning surface. Does not read files or launch a model. */
export const contextPlanCommand: Command = {
  name: 'context-plan',
  description: 'Plan bounded bulk-read delegation from metadata (no file reads or model calls)',
  options: [
    { name: 'bytes', type: 'number', required: true, description: 'Total source UTF-8 bytes' },
    { name: 'files', type: 'number', default: 1, description: 'Source file count' },
    { name: 'mode', type: 'string', default: 'legacy', choices: ['legacy', 'observe', 'enforce'], description: 'Routing mode' },
    { name: 'intent', type: 'string', default: 'analysis', choices: ['analysis', 'edit', 'debug', 'architecture'], description: 'Read purpose' },
    { name: 'worker-available', type: 'boolean', default: false, description: 'Host has a governed worker adapter' },
    { name: 'offset', type: 'number', description: 'Targeted read offset' },
    { name: 'limit', type: 'number', description: 'Targeted read limit' },
    { name: 'depth', type: 'number', default: 0, description: 'Current delegation depth' },
  ],
  action: async ctx => {
    try {
      const f = ctx.flags;
      const plan = planContextRead({
        inputBytes: Number(f.bytes), fileCount: Number(f.files ?? 1),
        mode: (f.mode ?? 'legacy') as ContextMode, intent: (f.intent ?? 'analysis') as ContextIntent,
        // The parser camelCases flag names; accept both spellings like the other hooks commands.
        workerAvailable: f['worker-available'] === true || f.workerAvailable === true, depth: Number(f.depth ?? 0),
        ...(f.offset === undefined ? {} : { offset: Number(f.offset) }),
        ...(f.limit === undefined ? {} : { limit: Number(f.limit) }),
      });
      console.log(JSON.stringify(plan));
      return { success: true, data: plan };
    } catch {
      console.error('Invalid context planning metadata');
      return { success: false, message: 'Invalid context planning metadata', exitCode: 1 };
    }
  },
};
