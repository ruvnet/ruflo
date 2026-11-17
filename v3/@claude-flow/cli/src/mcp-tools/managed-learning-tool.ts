/** Learning MCP boundary, kept separate from provider transport and native workers. */
import { getProjectCwd, type MCPTool } from './types.js';

export const managedLearningTool: Pick<MCPTool, 'inputSchema' | 'handler'> = {
  inputSchema: { type: 'object', properties: {
    action: { type: 'string', enum: ['status', 'record', 'recommend', 'evaluate', 'index', 'recall', 'cycle'] },
    evidence: { type: 'object', description: 'Closed version1 observation and optional host signature; caller trust labels rejected' },
    scope: { type: 'object', description: 'Exact taskType, policyHash and evaluatorHash cohort' },
    manifest: { type: 'object', description: 'Frozen unique heldout taskHashes and at least three trials' },
    cycle: { type: 'object', description: 'Closed scope/evidence batch, optional index, maxP95Ms and evaluation; no commands, keys or promotion flags' },
    baselineId: { type: 'string' }, candidateId: { type: 'string' }, id: { type: 'string' }, maxP95Ms: { type: 'number' },
  }, required: ['action'] },
  handler: async input => {
    if (input.action !== 'status' && process.env.RUFLO_MANAGED_LEARNING !== '1') return { success: false, error: 'Managed learning writes require host RUFLO_MANAGED_LEARNING=1' };
    const root = getProjectCwd(), key = process.env.RUFLO_MANAGED_VERIFIER_PUBLIC_KEY;
    const authorize = () => process.env.RUFLO_MANAGED_LEARNING === '1' && process.env.RUFLO_MANAGED_VERIFIER_PUBLIC_KEY === key && getProjectCwd() === root;
    try {
      const learning = await import('../services/managed-learning-store.js');
      if (input.action !== 'status' && !authorize()) throw new Error('Host learning policy changed');
      if (input.action === 'cycle') {
        if (Object.keys(input).some(k => !['action', 'cycle'].includes(k))) throw new Error('Invalid cycle envelope');
        const { cycleLearning } = await import('../services/managed-learning-loop.js');
        return { success: true, ...await cycleLearning(root, input.cycle, key, authorize) };
      }
      if (input.action === 'status') return { success: true, ...learning.learningStatus(root, key) };
      if (input.action === 'record') return { success: true, ...learning.recordLearning(root, input.evidence, key) };
      if (input.action === 'recommend') return { success: true, ...learning.recommendLearning(root, input.scope, key, input.maxP95Ms as number | undefined) };
      if (input.action === 'evaluate') return { success: true, ...learning.evaluateLearning(root, { scope: input.scope, manifest: input.manifest, baselineId: String(input.baselineId ?? ''), candidateId: String(input.candidateId ?? '') }, key) };
      if (input.action === 'recall') return { success: true, ...await learning.recallLearning(root, input.scope, key, authorize) };
      if (input.action === 'index') return { success: true, ...await learning.indexLearning(root, String(input.id ?? ''), key, authorize) };
      return { success: false, error: 'Unknown managed learning action' };
    } catch { return { success: false, error: 'Managed learning failed: validate metadata, verifier and store; state may persist, inspect status before retrying; no default changed' }; }
  },
};
