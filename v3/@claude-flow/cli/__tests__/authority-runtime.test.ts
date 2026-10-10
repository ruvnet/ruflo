import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { authorizeMcpTool, invokeAuthorizedMcpTool } from '../src/services/policy-runtime.js';

const initialCwd = process.cwd();
const roots: string[] = [];
afterEach(() => {
  process.chdir(initialCwd);
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, {recursive:true, force:true});
});
function worker(envelope: object): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-authority-'));
  roots.push(root);
  execFileSync('git', ['init', '-q', root]);
  process.chdir(root);
  vi.stubEnv('CLAUDE_FLOW_CAPABILITY_ENVELOPE', JSON.stringify(envelope));
  return root;
}
describe('MCP delegated authority composition', () => {
  it('does not let a tool ceiling replace inherited authority in legacy mode', async () => {
    worker({tools:['memory_search']});
    const decision = await authorizeMcpTool('memory_store', {}, {}, {envelope:{tools:['*']}});
    expect(decision.enforcedOutcome).toBe('denied');
    expect(decision.reason).toBe('tool-outside-envelope');
  });
  it('enforces a disjoint intersection as deny all', async () => {
    worker({tools:['memory_search']});
    const decision = await authorizeMcpTool('memory_store', {}, {}, {envelope:{tools:['memory_store']}});
    expect(decision.enforcedOutcome).toBe('denied');
  });
  it('allows a tool inside both envelopes', async () => {
    worker({tools:['memory_*']});
    expect((await authorizeMcpTool('memory_search', {}, {}, {
      envelope:{tools:['memory_search']},
    })).enforcedOutcome).toBe('allowed');
  });
  it('requires an explicit namespace rather than guessing a handler default', async () => {
    worker({tools:['memory_search'],readNamespaces:['tenant-a']});
    await expect(authorizeMcpTool('memory_search', {}, {}, {
      actionType:'memory.read', namespaceAccess:'read',
    })).rejects.toThrow('namespace-required-by-capability-envelope');
    expect((await authorizeMcpTool('memory_search', {namespace:'tenant-b'}, {}, {
      actionType:'memory.read', namespaceAccess:'read',
    })).enforcedOutcome).toBe('denied');
    expect((await authorizeMcpTool('memory_search', {namespace:'tenant-a'}, {}, {
      actionType:'memory.read', namespaceAccess:'read',
    })).enforcedOutcome).toBe('allowed');
  });
  it('denies malformed worker authority', async () => {
    worker({tools:'*'});
    await expect(authorizeMcpTool('memory_search', {})).rejects.toThrow('invalid-capability-envelope');
  });
});

describe('authority execution invariants', () => {
  it('does not invoke a forbidden handler', async () => {
    worker({tools:[]});
    const handler = vi.fn(async () => 'side effect');
    await expect(invokeAuthorizedMcpTool('memory_store', {}, {}, handler)).rejects.toThrow('tool-outside-envelope');
    expect(handler).not.toHaveBeenCalled();
  });
  it('uses the authorized arguments despite mutation during policy IO', async () => {
    worker({tools:['memory_store'],writeNamespaces:['tenant-a']});
    const input = {namespace:'tenant-a',value:{text:'original'}};
    const handler = vi.fn(async args => args);
    const pending = invokeAuthorizedMcpTool('memory_store', input, {}, handler);
    input.namespace = 'tenant-b';
    input.value.text = 'modified';
    await expect(pending).resolves.toEqual({namespace:'tenant-a',value:{text:'original'}});
  });
  it('snapshots a single tool envelope before policy IO', async () => {
    const root = worker({});
    delete process.env.CLAUDE_FLOW_CAPABILITY_ENVELOPE;
    const envelope = {tools:[] as string[]};
    const pending = authorizeMcpTool('memory_store', {}, {projectRoot:root}, {envelope});
    envelope.tools.push('*');
    expect((await pending).enforcedOutcome).toBe('denied');
  });
  it.each(['memory_stats','memory_export','agentdb_pattern-store'])('blocks unqualified namespace operations: %s', async name => {
    worker({tools:['*'],readNamespaces:['tenant-a']});
    await expect(authorizeMcpTool(name, {namespace:'tenant-a'})).rejects.toThrow('global-memory-operation-outside-envelope');
  });
});

it('rejects the backend all-namespace sentinel even when a prefix matches it', async () => {
  worker({tools:['memory_search'],readNamespaces:['a*']});
  const handler = vi.fn(async () => 'leak');
  await expect(invokeAuthorizedMcpTool('memory_search', {namespace:'all'}, {}, handler))
    .rejects.toThrow('namespace-required-by-capability-envelope');
  expect(handler).not.toHaveBeenCalled();
});
