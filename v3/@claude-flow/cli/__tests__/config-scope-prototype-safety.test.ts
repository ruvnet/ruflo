import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configTools } from '../src/mcp-tools/config-tools.js';

let root: string;
const invoke = async (name: string, input: Record<string, unknown>): Promise<any> =>
  configTools.find(tool => tool.name === name)!.handler(input);
const originalToString = Object.prototype.toString;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-config-scope-proto-'));
  mkdirSync(join(root, '.claude-flow'));
  writeFileSync(join(root, '.claude-flow', 'config.json'), '{}');
  vi.stubEnv('CLAUDE_FLOW_CWD', root);
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
});
afterEach(() => {
  delete (Object.prototype as any).scopePolluted;
  delete (Object.prototype.toString as any).scopePolluted;
  Object.prototype.toString = originalToString;
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

it.each(['__proto__', 'constructor', 'prototype'])('config_set rejects reserved scope %s without polluting prototypes', async (scope) => {
  const result = await invoke('config_set', { key: 'scopePolluted', value: true, scope });
  expect(result.success).toBe(false);
  expect(({} as any).scopePolluted).toBeUndefined();
});

it.each(['__proto__', 'constructor', 'prototype'])('config_import rejects reserved scope %s without polluting prototypes', async (scope) => {
  const result = await invoke('config_import', { config: { scopePolluted: true }, scope });
  expect(result.success).toBe(false);
  expect(({} as any).scopePolluted).toBeUndefined();
});

it('treats inherited names such as toString as ordinary own scopes', async () => {
  await invoke('config_set', { key: 'scopePolluted', value: true, scope: 'toString' });
  await invoke('config_import', { config: { other: 1 }, scope: 'hasOwnProperty' });
  expect((Object.prototype.toString as any).scopePolluted).toBeUndefined();
  expect((Object.prototype.hasOwnProperty as any).other).toBeUndefined();
  const stored = JSON.parse(readFileSync(join(root, '.claude-flow', 'config.json'), 'utf8'));
  expect(stored.scopes.toString).toEqual({ scopePolluted: true });
  expect((await invoke('config_get', { key: 'scopePolluted', scope: 'toString' })).value).toBe(true);
  expect((await invoke('config_get', { key: 'scopePolluted', scope: 'valueOf' })).value).toBeUndefined();
});

it('does not write onto the prototype through a reserved key inside a scope', async () => {
  await invoke('config_set', { key: '__proto__', value: { scopePolluted: true }, scope: 'project' });
  const exported = await invoke('config_export', { scope: 'project', includeDefaults: false });
  expect(exported.config.scopePolluted).toBeUndefined();
  expect(({} as any).scopePolluted).toBeUndefined();
});

it('keeps ordinary scoped writes working', async () => {
  await invoke('config_set', { key: 'swarm.maxAgents', value: 4, scope: 'project' });
  await invoke('config_import', { config: { 'logging.level': 'debug' }, scope: 'project' });
  const got = await invoke('config_get', { key: 'swarm.maxAgents', scope: 'project' });
  const exported = await invoke('config_export', { scope: 'project', includeDefaults: false });
  expect(got.value).toBe(4);
  expect(exported.config['logging.level']).toBe('debug');
});
