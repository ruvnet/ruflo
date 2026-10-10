import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ root: '' }));
vi.mock('node:os', async importOriginal => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, userInfo: () => ({ ...actual.userInfo(), homedir: state.root }) };
});
// Exercise the actual policy and caller-identity exports without loading
// unrelated password-hashing/native security dependencies in this fixture.
vi.mock('@claude-flow/security', async () => ({
  ...await import('../../security/src/policy/index.js'),
  ...await import('../../security/src/mcp-caller-identity.js'),
}));
import { policyTools } from '../src/mcp-tools/policy-tools.js';
import { setPolicyMode, upsertPolicyRule, verifyPolicyLedger } from '../src/services/policy-runtime.js';
const evaluate = policyTools.find(t => t.name === 'policy_evaluate')!;
beforeEach(() => { state.root = mkdtempSync(join(tmpdir(), 'ruflo-envelope-meter-')); });
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
for (const mode of ['legacy', 'observe', 'enforce'] as const) {
  describe(`${mode} public policy evaluation`, () => {
    it.each(['maxCostUsd', 'maxTokens', 'maxConcurrency'])('does not bypass %s by omitting metering', async ceiling => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['*'] }, state.root);
      await setPolicyMode(mode, state.root);
      const result = await evaluate.handler({ request: {
        identity: { id: 'agent:fixture', type: 'agent' },
        action: { type: 'memory.read', namespace: 'notes' },
        context: { envelope: { [ceiling]: 1 } },
      } }, { projectRoot: state.root });
      expect(result).toMatchObject({ outcome: 'denied', enforcedOutcome: 'denied' });
      expect(await verifyPolicyLedger(state.root)).toMatchObject({ valid: true });
    });
    it('permits explicitly metered zero-cost reads within zero ceilings', async () => {
      await upsertPolicyRule({ id: 'allow-fixture', effect: 'allow', actions: ['*'] }, state.root);
      await setPolicyMode(mode, state.root);
      expect(await evaluate.handler({ request: {
        identity: { id: 'agent:fixture', type: 'agent' },
        action: { type: 'memory.read', namespace: 'notes', costUsd: 0, tokens: 0, concurrency: 0 },
        context: { envelope: { maxCostUsd: 0, maxTokens: 0, maxConcurrency: 0 } },
      } }, { projectRoot: state.root })).toMatchObject({ enforcedOutcome: 'allowed' });
    });
  });
}
