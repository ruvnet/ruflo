import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, digest, observationOf } from '../src/services/managed-learning.js';
import { learningStatus } from '../src/services/managed-learning-store.js';
import { cycleLearning } from '../src/services/managed-learning-loop.js';
import { managedLearningTool } from '../src/mcp-tools/managed-learning-tool.js';

const pair = generateKeyPairSync('ed25519'), key = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const scope = { taskType: 'implementation', policyHash: digest('policy'), evaluatorHash: digest('evaluator') };
const roots: string[] = [];
function root() { const p = mkdtempSync(join(tmpdir(), 'managed-cycle-')); roots.push(p); return p; }
function rows() {
  return ['baseline', 'candidate'].flatMap(id => [0, 1, 2].map(trial => {
    const observation = observationOf({ v: 1, ...scope, attemptId: digest(`${id}-${trial}`), taskHash: digest(`task-${trial}`), sourceHash: digest('source'), artifactHash: digest('artifact'), corpusHash: digest('train'), split: 'train', trial,
      strategy: { id, model: 'fixture', workers: 1, template: 'test' }, budgetCents: 100, costCents: id === 'candidate' ? 1 : 2, durationMs: 1,
      checks: { acceptance: true, safety: true, replay: true, adversarial: true, drift: 0, driftThreshold: .1, rollbackRate: 0 } });
    return { observation, signature: sign(null, Buffer.from(canonical(observation)), pair.privateKey).toString('base64') };
  }));
}
afterEach(() => { roots.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })); vi.unstubAllEnvs(); });

describe('bounded managed improvement cycles', () => {
  it('records measured receipts, recommends, and replays without duplicate learning', async () => {
    const p = root(), input = { scope, evidence: rows() };
    const first = await cycleLearning(p, input, key, () => true);
    expect(first).toMatchObject({ phases: ['admitted', 'recorded', 'recommended'], recommendation: { selected: { strategy: { id: 'candidate' } } }, defaultsChanged: false, promotionRequested: false });
    const next = await cycleLearning(p, input, key, () => true);
    expect(next.cycleId).toBe(first.cycleId);
    expect(next.recorded).toHaveLength(0); expect(next.duplicates).toHaveLength(6);
    expect(learningStatus(p, key).verified).toBe(6);
  });
  it('validates the entire batch before mutation and refuses caller capabilities', async () => {
    const p = root(), evidence = rows(); evidence[5]!.signature = evidence[0]!.signature;
    await expect(cycleLearning(p, { scope, evidence }, key, () => true)).rejects.toThrow('Every cycle');
    expect(existsSync(join(p, '.claude-flow'))).toBe(false);
    for (const extra of [{ promote: true }, { commands: ['echo unsafe'] }, { publicKey: key }]) {
      await expect(cycleLearning(p, { scope, evidence: [], ...extra }, key, () => true)).rejects.toThrow();
    }
  });
  it('refuses unsigned, cross-cohort, unmeasured and oversized batches', async () => {
    const p = root(), evidence = rows();
    await expect(cycleLearning(p, { scope, evidence: [{ observation: evidence[0]!.observation }] }, key, () => true)).rejects.toThrow('authenticated');
    await expect(cycleLearning(p, { scope: { ...scope, policyHash: digest('other') }, evidence }, key, () => true)).rejects.toThrow('in scope');
    await expect(cycleLearning(p, { scope, evidence: Array(25).fill(evidence[0]) }, key, () => true)).rejects.toThrow('24');
    expect(learningStatus(p, key).observations).toBe(0);
  });
  it('bounds native admission before writes and supports observation-free advisory cycles', async () => {
    const p = root(), evidence = rows();
    const more = [...evidence, ...evidence.map(e => {
      const observation = { ...e.observation, attemptId: digest(e.observation.attemptId), taskHash: digest(e.observation.taskHash) };
      return { observation, signature: sign(null, Buffer.from(canonical(observation)), pair.privateKey).toString('base64') };
    })];
    await expect(cycleLearning(p, { scope, evidence: more, index: true }, key, () => true)).rejects.toThrow('six training');
    expect(existsSync(join(p, '.claude-flow'))).toBe(false);
    const empty = await cycleLearning(p, { scope, evidence: [] }, key, () => true);
    expect(empty).toMatchObject({ recorded: [], recommendation: { abstained: true }, defaultsChanged: false });
    const first = await cycleLearning(p, { scope, evidence }, key, () => true);
    const reverse = await cycleLearning(p, { scope, evidence: [...evidence].reverse() }, key, () => true);
    expect(reverse.cycleId).toBe(first.cycleId);
  });
  it('rechecks policy between phases and preserves a resumable atomic batch', async () => {
    const p = root(); let checks = 0;
    await expect(cycleLearning(p, { scope, evidence: rows() }, key, () => ++checks <= 2)).rejects.toThrow('policy');
    expect(learningStatus(p, key).verified).toBe(6);
    const retry = await cycleLearning(p, { scope, evidence: rows() }, key, () => true);
    expect(retry.duplicates).toHaveLength(6); expect(retry.recorded).toHaveLength(0);
  });
  it('keeps the MCP host flag and verifier boundary even for cycle input', async () => {
    vi.stubEnv('CLAUDE_FLOW_CWD', root()); vi.stubEnv('RUFLO_MANAGED_LEARNING', '0');
    expect(await managedLearningTool.handler({ action: 'cycle', cycle: { scope, evidence: rows() } })).toMatchObject({ success: false });
    vi.stubEnv('RUFLO_MANAGED_LEARNING', '1'); vi.stubEnv('RUFLO_MANAGED_VERIFIER_PUBLIC_KEY', key);
    expect(await managedLearningTool.handler({ action: 'cycle', cycle: { scope, evidence: rows() }, approved: true })).toMatchObject({ success: false });
    expect(await managedLearningTool.handler({ action: 'cycle', cycle: { scope, evidence: rows() } })).toMatchObject({ success: true, defaultsChanged: false });
  });
});
