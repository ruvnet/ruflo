import { afterEach, describe, expect, it, vi } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ManagedMemoryClient, MANAGED_MEMORY_LIMITS } from '../src/services/managed-memory-client.js';
import { executeManagedMemory, type NativeMemoryAdapter } from '../src/services/managed-memory-worker.js';

const id = 'a'.repeat(64), other = 'b'.repeat(64), namespace = 'managed-workflow-evidence';
const roots: string[] = [], clients: ManagedMemoryClient[] = [];
const root = () => { const value = mkdtempSync(join(tmpdir(), 'managed-native-child-')); roots.push(value); return value; };
const request = { operation: 'index', id, value: '{"receipt":"bounded"}', taskType: 'code-review' } as const;
const wire = () => ({ v: 1, requestId: randomUUID(), ...request });
afterEach(() => { for (const c of clients.splice(0)) c.close(); for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); });

function sourceFixture(source: string, timeoutMs = 1000, idleMs = 5000) {
  const cwd = root(), file = join(cwd, 'fixed-host-fixture.mjs');
  writeFileSync(file, source);
  const children: ChildProcess[] = [];
  const launch = vi.fn(() => { const child = fork(file, [], { cwd, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(child); return child; });
  const client = new ManagedMemoryClient({ forkWorker: launch, timeoutMs, idleMs }); clients.push(client);
  return { client, launch, children, cwd };
}
function fixture(code: string, timeoutMs = 1000, idleMs = 5000) {
  return sourceFixture(`let pending; process.on('disconnect', () => process.exit(0)); process.on('message', async input => { if (input.grant === 'execute') { const m = pending; ${code} } else { pending = input; process.send({v:1,requestId:input.requestId,phase:'ready'}); } });`, timeoutMs, idleMs);
}
const goodReply = `process.send({v:1,requestId:m.requestId,ok:true,operation:'index',durable:true,hasEmbedding:true});`;

describe('actual child lifecycle containment', () => {
  it.each([`process.exit(134);`, `process.kill(process.pid, 'SIGKILL');`])('contains a child crash while the parent remains live', async code => {
    const { client, cwd } = fixture(code);
    await expect(client.run(cwd, request)).rejects.toThrow('parent remains available');
    expect(client.stats()).toEqual({ workers: 0, busy: 0 });
    expect(1 + 1).toBe(2);
  });
  it('kills an unresponsive child at a bounded deadline and releases its slot', async () => {
    const { client, cwd, children } = fixture('/* hang */', 100);
    const started = Date.now();
    await expect(client.run(cwd, request)).rejects.toThrow('timed out');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(children[0]?.killed).toBe(true); expect(client.stats().workers).toBe(0);
  });
  it('reuses the same worker for sequential operations instead of reinitializing native modules', async () => {
    const { client, cwd, launch } = fixture(goodReply);
    await expect(client.run(cwd, request)).resolves.toMatchObject({ durable: true, hasEmbedding: true });
    await expect(client.run(cwd, request)).resolves.toMatchObject({ durable: true });
    expect(launch).toHaveBeenCalledTimes(1); expect(client.stats()).toEqual({ workers: 1, busy: 0 });
  });
  it('limits active native work to one global worker and has no unbounded queue', async () => {
    expect(MANAGED_MEMORY_LIMITS.workers).toBe(1);
    const { client, cwd, launch } = fixture('/* hang */', 100);
    const pending = client.run(cwd, request);
    await expect(client.run(cwd, request)).rejects.toThrow('busy');
    await expect(client.run(root(), request)).rejects.toThrow('limit');
    expect(launch).toHaveBeenCalledTimes(1); await expect(pending).rejects.toThrow();
  });
  it('cleans up idle workers and can restart after cleanup', async () => {
    const { client, cwd, launch } = fixture(goodReply, 1000, 20);
    await client.run(cwd, request); await new Promise(r => setTimeout(r, 50));
    expect(client.stats().workers).toBe(0);
    await client.run(cwd, request); expect(launch).toHaveBeenCalledTimes(2);
  });
  it.each([
    `process.send({v:1,requestId:'wrong',ok:true,operation:'index',durable:true,hasEmbedding:true});`,
    `process.send({v:1,requestId:m.requestId,ok:false,error:'secret upstream value'});`,
    `process.send({v:1,requestId:m.requestId,ok:true,operation:'index',durable:true,hasEmbedding:true,unexpected:'credential'});`,
  ])('rejects malformed or uncorrelated child output without leaking raw errors', async code => {
    const { client, cwd } = fixture(code);
    const error = await client.run(cwd, request).catch(e => String(e));
    expect(error).toContain('parent remains available'); expect(error).not.toContain('credential'); expect(error).not.toContain('secret upstream');
  });
  it('does not accept arbitrary commands, module paths or database paths from callers', async () => {
    const { client, cwd, launch } = fixture(goodReply);
    for (const extra of [{ command: 'node' }, { module: './evil.js' }, { dbPath: '/tmp/other.db' }, { root: '/tmp' }]) await expect(client.run(cwd, { ...request, ...extra })).rejects.toThrow('Invalid');
    expect(launch).not.toHaveBeenCalled();
  });
  it('checks payload bounds before spawning native work', async () => {
    const { client, cwd, launch } = fixture(goodReply);
    await expect(client.run(cwd, { ...request, value: 'x'.repeat(8193) })).rejects.toThrow('Invalid');
    await expect(client.run(cwd, { operation: 'recall', taskType: 'code-review', allowedIds: Array(501).fill(id) })).rejects.toThrow('Invalid');
    expect(launch).not.toHaveBeenCalled();
  });
  it('rechecks host authority after worker initialization and before admitting native writes', async () => {
    const source = `import {writeFileSync} from 'node:fs'; let pending; process.on('disconnect',()=>process.exit(0)); process.on('message', input=>{ if(input.operation){pending=input;process.send({v:1,requestId:input.requestId,phase:'ready'});} else if(input.grant==='execute'){process.send({v:1,requestId:pending.requestId,phase:'before-write'});} else if(input.grant==='write'){writeFileSync('write-admitted','yes');process.send({v:1,requestId:pending.requestId,ok:true,operation:'index',durable:true,hasEmbedding:true});}});`;
    for (const deniedAt of [3, 4]) {
      const { client, cwd } = sourceFixture(source); let calls = 0;
      await expect(client.run(cwd, request, () => ++calls < deniedAt)).rejects.toThrow('policy denied');
      expect(existsSync(join(cwd, 'write-admitted'))).toBe(false);
    }
  });
  it('reports in-flight revocation as an ambiguous admitted write, never verified success', async () => {
    const source = `import {writeFileSync} from 'node:fs'; let pending; process.on('disconnect',()=>process.exit(0)); process.on('message', input=>{ if(input.operation){pending=input;process.send({v:1,requestId:input.requestId,phase:'ready'});} else if(input.grant==='execute'){process.send({v:1,requestId:pending.requestId,phase:'before-write'});} else if(input.grant==='write'){writeFileSync('write-admitted','yes');process.send({v:1,requestId:pending.requestId,ok:true,operation:'index',durable:true,hasEmbedding:true});}});`;
    const { client, cwd } = sourceFixture(source); let calls = 0;
    await expect(client.run(cwd, request, () => ++calls < 5)).rejects.toThrow('admitted write may have completed');
    expect(existsSync(join(cwd, 'write-admitted'))).toBe(true);
  });
  it('denies a revoked operation before spawning a child', async () => {
    const { client, cwd, launch } = fixture(goodReply);
    await expect(client.run(cwd, request, () => false)).rejects.toThrow('policy denied');
    expect(launch).not.toHaveBeenCalled();
  });
  it('runs the emitted fixed worker on supported Node versions without loading native code for invalid input', async () => {
    const cwd = root(), entry = join(cwd, 'fixed-worker.mjs');
    const source = readFileSync(new URL('../src/services/managed-memory-worker.ts', import.meta.url), 'utf8');
    writeFileSync(entry, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
    const child = fork(entry, [], { cwd, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    try {
      const response = new Promise<any>((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', () => reject(new Error('Fixed worker exited before response'))); });
      child.send({ operation: 'eval', command: 'ignored' });
      await expect(response).resolves.toEqual({ v: 1, ok: false, error: 'invalid-request' });
    } finally { child.kill('SIGKILL'); }
  });
});

describe('fixed native operations and full hydration', () => {
  function adapter() {
    return { getEntry: vi.fn(), storeEntry: vi.fn(), searchEntries: vi.fn() } satisfies NativeMemoryAdapter;
  }
  it('keeps requireNative append-only writes and confirms the exact row after persistence', async () => {
    const a = adapter(); a.getEntry.mockResolvedValueOnce({ success: true, found: false }).mockResolvedValueOnce({ success: true, found: true, entry: { key: id, namespace, content: request.value, hasEmbedding: true } });
    a.storeEntry.mockResolvedValue({ success: true });
    expect(await executeManagedMemory(wire(), a, '/project/.swarm/memory.db')).toMatchObject({ durable: true, hasEmbedding: true });
    expect(a.storeEntry).toHaveBeenCalledWith(expect.objectContaining({ requireNative: true, appendOnly: true, upsert: false, namespace, dbPath: '/project/.swarm/memory.db' }));
  });
  it('recognizes an existing exact native row without rewriting or claiming missing vectors', async () => {
    const a = adapter(); a.getEntry.mockResolvedValue({ success: true, found: true, entry: { key: id, namespace, content: request.value, hasEmbedding: false } });
    expect(await executeManagedMemory(wire(), a, '/project/.swarm/memory.db')).toMatchObject({ durable: true, hasEmbedding: false });
    expect(a.storeEntry).not.toHaveBeenCalled();
  });
  it('refuses a conflicting native row and uncertain persistence', async () => {
    const a = adapter(); a.getEntry.mockResolvedValue({ success: true, found: true, entry: { key: id, namespace, content: 'different' } });
    await expect(executeManagedMemory(wire(), a, '/project/.swarm/memory.db')).rejects.toThrow('conflicting');
    a.getEntry.mockResolvedValue({ success: true, found: false }); a.storeEntry.mockResolvedValue({ success: true, persistWarning: 'uncertain' });
    await expect(executeManagedMemory(wire(), a, '/project/.swarm/memory.db')).rejects.toThrow('persistence');
  });
  it('never calls the native append after a denied host write grant', async () => {
    const a = adapter(); a.getEntry.mockResolvedValue({ success: true, found: false });
    await expect(executeManagedMemory(wire(), a, '/project/.swarm/memory.db', async () => { throw Error('revoked'); })).rejects.toThrow('revoked');
    expect(a.storeEntry).not.toHaveBeenCalled();
  });
  it('hydrates full rows instead of forwarding search display previews', async () => {
    const a = adapter(), content = JSON.stringify({ signed: 'receipt'.repeat(100) });
    a.searchEntries.mockResolvedValue({ success: true, results: [{ key: id, namespace, score: .8, content: content.slice(0, 60) + '...' }, { key: other, namespace, score: .9 }] });
    a.getEntry.mockResolvedValue({ success: true, found: true, entry: { key: id, namespace, content } });
    const result = await executeManagedMemory({ v: 1, requestId: randomUUID(), operation: 'recall', taskType: 'code-review', allowedIds: [id] }, a, '/project/.swarm/memory.db');
    expect(result).toMatchObject({ available: true, rows: [{ key: id, namespace, score: .8, content }] });
    expect(a.getEntry).toHaveBeenCalledTimes(1);
  });
  it('rejects wrong scoped or oversized hydrated rows', async () => {
    const a = adapter(); a.searchEntries.mockResolvedValue({ success: true, results: [{ key: id, namespace, score: .8 }] });
    for (const entry of [{ key: id, namespace: 'other', content: '{}' }, { key: id, namespace, content: 'x'.repeat(8193) }]) {
      a.getEntry.mockResolvedValue({ success: true, found: true, entry });
      expect(await executeManagedMemory({ v: 1, requestId: randomUUID(), operation: 'recall', taskType: 'code-review', allowedIds: [id] }, a, '/project/.swarm/memory.db')).toMatchObject({ rows: [] });
    }
  });
});
