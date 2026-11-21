import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCodeMode } from '../scripts/claude-code-mode-preflight.mjs';

const version = '2.1.325 (Claude Code)';
const userOptIn = { env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '1' } };

test('no opt-in leaves default path intact', () => {
  const r = assessCodeMode({ version });
  assert.equal(r.status, 'not-enabled');
});
test('manual trial is not automatic enabling', () => {
  const r = assessCodeMode({ version, userSettings: userOptIn });
  assert.equal(r.status, 'manual-trial-only');
  assert.ok(r.checks.some(c => c.id === 'unverified'));
});
test('project-only opt-in is ignored', () => {
  const r = assessCodeMode({ version, projectSettings: userOptIn });
  assert.equal(r.status, 'not-enabled');
  assert.ok(r.checks.some(c => c.id === 'project-opt-in'));
});
test('explicit zero wins over a one in another source', () => {
  const r = assessCodeMode({ version, userSettings: userOptIn, env: { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '0' } });
  assert.equal(r.status, 'not-enabled');
});
test('Ruflo project agent teams are a hard conflict', () => {
  const r = assessCodeMode({ version, userSettings: userOptIn,
    projectSettings: { env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } } });
  assert.equal(r.status, 'blocked');
  assert.ok(r.checks.some(c => c.id === 'agent-teams' && c.severity === 'block'));
});
test('old and unverified versions fail closed', () => {
  for (const v of ['', '2.1.322']) {
    assert.equal(assessCodeMode({ version: v, userSettings: userOptIn }).status, 'blocked');
  }
  assert.equal(assessCodeMode({ version: '2.1.323', userSettings: userOptIn }).status, 'manual-trial-only');
});
test('mod presence is a warning, not assumed safe or unsupported', () => {
  const r = assessCodeMode({ version, userSettings: userOptIn,
    projectSettings: { enabledPlugins: { 'ruflo-mods@ruflo': true } } });
  assert.equal(r.status, 'manual-trial-only');
  assert.ok(r.checks.some(c => c.id === 'mods' && c.severity === 'warn'));
});
test('malformed settings block rather than produce a green result', () => {
  const r = assessCodeMode({ version, userSettings: userOptIn, configErrors: ['project'] });
  assert.equal(r.status, 'blocked');
});
test('telemetry, credential helpers and custom gateways block', () => {
  for (const env of [
    { CLAUDE_CODE_ENABLE_TELEMETRY: '1' },
    { DISABLE_TELEMETRY: '1' },
    { ANTHROPIC_AUTH_TOKEN: 'not-displayed' },
    { ANTHROPIC_BASE_URL: 'https://example.test' }
  ]) {
    const r = assessCodeMode({ version, userSettings: userOptIn, env });
    assert.equal(r.status, 'blocked');
    assert.ok(!JSON.stringify(r).includes('not-displayed'));
    assert.ok(!JSON.stringify(r).includes('example.test'));
  }
});
