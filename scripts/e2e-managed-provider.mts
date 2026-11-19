/** Opt-in real provider canary. No key or entitlement is inferred from a Claude login.
 * RUFLO_MANAGED_E2E_LIVE=1 RUFLO_MANAGED_E2E_AGENT_IDS=agent_... tsx scripts/e2e-managed-provider.mts
 * Uses a $1 provider budget (in-flight overshoot remains possible), limited networking,
 * fixed harmless work, existing predefined workers and cleanup of only new owned resources.
 */
import { managedAgentTools } from '../v3/@claude-flow/cli/src/mcp-tools/managed-agent-tools.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const agents = (process.env.RUFLO_MANAGED_E2E_AGENT_IDS ?? '').split(',').filter(Boolean);
const key = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const blockers = [process.env.RUFLO_MANAGED_E2E_LIVE !== '1' && 'explicit live opt-in', !key && 'executor API key',
  (!agents.length || agents.length > 2 || agents.some(id => !/^agent_[A-Za-z0-9]+$/.test(id))) && 'one or two predefined agent IDs',
  process.env.RUFLO_MANAGED_AGENTS_BASE_URL && process.env.RUFLO_MANAGED_AGENTS_BASE_URL !== 'https://api.anthropic.com' && 'official provider origin'].filter(Boolean);
if (blockers.length) {
  console.log(JSON.stringify({ passed: false, blocked: true, blockers, providerCalls: 0 }));
  process.exit(3);
}
const previous = { cwd: process.env.CLAUDE_FLOW_CWD, control: process.env.RUFLO_MANAGED_CONTROL, sessions: process.env.RUFLO_MANAGED_CONTROL_SESSIONS };
const root = mkdtempSync(join(tmpdir(), 'managed-provider-canary-'));
process.env.CLAUDE_FLOW_CWD = root;
const call = async (name: string, input: Record<string, unknown>) => {
  const result = await managedAgentTools.find(t => t.name === name)!.handler(input);
  return result as Record<string, any>;
};
const report: Record<string, unknown> = { passed: false, liveProvider: true, budgetCents: 100, maxWaitMs: 45_000, verification: 'unverified', acceptancePassed: false, root };
let owned: Record<string, any> = {};
try {
  owned = await call('managed_agent_create', { name: 'ruflo-e2e-canary', title: 'Bounded managed workflow canary', dynamicWorkflows: true, budgetCents: '100', predefinedAgents: agents, allowedHosts: [], networking: 'limited',
    system: 'Run only this harmless arithmetic workflow. Use at most two predefined workers. Do not use network or modify external data.' });
  assert.equal(owned.success, true, 'Provider creation did not succeed; inspect owned IDs and cleanup report');
  report.sessionId = owned.sessionId;
  process.env.RUFLO_MANAGED_CONTROL = '1'; process.env.RUFLO_MANAGED_CONTROL_SESSIONS = owned.sessionId;
  const prompt = await call('managed_agent_prompt', { sessionId: owned.sessionId, message: 'Run a small workflow with at most two predefined workers to independently calculate 2+2, combine the results, and return RUFLO_E2E_OK=4. No other work.', maxWaitMs: 45_000 });
  report.observedStatus = prompt.status ?? 'unknown';
  const inspected = await call('managed_agent_control', { sessionId: owned.sessionId, action: 'inspect', threadOffset: 0 });
  assert.equal(inspected.success, true, 'Fresh worker inspection failed');
  assert.equal(inspected.snapshot?.verification, 'unverified');
  report.workerCount = inspected.snapshot?.threadCount ?? null;
  report.providerFinished = inspected.snapshot?.providerFinished ?? false;
  report.listCostCents = inspected.snapshot?.listCostCents ?? null;
  report.budgetPauseObserved = inspected.snapshot?.stopReason === 'budget_reached';
  assert.equal(prompt.success, true, 'Prompt failed');
  assert.equal(typeof prompt.messageId, 'string', 'Prompt was not acknowledged');
  assert.equal(inspected.snapshot?.providerFinished, true, 'Provider has not finished; this canary is incomplete');
  assert(inspected.snapshot?.runs?.length > 0 && inspected.snapshot?.threadCount > 0, 'No dynamic workflow and child worker were observed');
  assert(typeof prompt.assistantText === 'string' && prompt.assistantText.includes('RUFLO_E2E_OK=4'), 'Expected response marker was not observed');
  process.env.RUFLO_MANAGED_CONTROL = '0';
  const refused = await call('managed_agent_control', { sessionId: owned.sessionId, action: 'interrupt' });
  assert.equal(refused.success, false, 'Revoked host policy authorized an action');
  report.revokedPolicyDenied = true;
  process.env.RUFLO_MANAGED_CONTROL = '1';
  const ended = await call('managed_agent_control', { sessionId: owned.sessionId, action: 'terminate' });
  assert.equal(ended.cancellationConfirmed, true, 'Remote termination not confirmed');
  report.remoteTerminationConfirmed = true;
  report.passed = true;
} catch { report.error = 'Live canary failed; inspect provider status and resource cleanup before retrying'; process.exitCode = 1; }
finally {
  const cleanup: Record<string, unknown> = {};
  report.ownedResourceIds = { sessionId: owned.sessionId, environmentId: owned.environmentId, agentId: owned.agentId };
  report.creationCleanupRequired = owned.cleanupRequired ?? false;
  if (!owned.cleanupRequired) {
    for (const [kind, id, pattern] of [
      ['sessions', owned.sessionId, /^sesn_[A-Za-z0-9]+$/],
      ['environments', owned.environmentId, /^env_[A-Za-z0-9]+$/],
      ['agents', owned.agentId, /^agent_[A-Za-z0-9]+$/],
    ] as const) {
      if (!pattern.test(id ?? '')) continue;
      if (kind === 'sessions' && report.remoteTerminationConfirmed) { cleanup[kind] = true; continue; }
      try {
        const result = await fetch(`https://api.anthropic.com/v1/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'x-api-key': key!, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'managed-agents-2026-04-01' } });
        cleanup[kind] = [200, 204, 404].includes(result.status); await result.body?.cancel();
      } catch { cleanup[kind] = false; }
      if (kind === 'sessions' && cleanup[kind] !== true) { report.creationCleanupRequired = true; break; }
    }
  }
  report.cleanup = cleanup;
  if (Object.values(cleanup).some(v => v === false) || report.creationCleanupRequired) { report.passed = false; process.exitCode = 1; }
  for (const [name, value] of Object.entries({ CLAUDE_FLOW_CWD: previous.cwd, RUFLO_MANAGED_CONTROL: previous.control, RUFLO_MANAGED_CONTROL_SESSIONS: previous.sessions })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  console.log(JSON.stringify(report));
}
