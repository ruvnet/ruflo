/** Native memory runs behind a bounded child boundary, never in the MCP process. */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MANAGED_MEMORY_NAMESPACE = 'managed-workflow-evidence';
export const MANAGED_MEMORY_LIMITS = { workers: 1, requestBytes: 80_000, resultBytes: 200_000, rows: 20, rowBytes: 8192, timeoutMs: 15_000, idleMs: 5000 } as const;
const HASH = /^[a-f0-9]{64}$/;
const TYPES = ['code-review', 'migration', 'research', 'test-generation', 'implementation', 'other'];
export type MemoryRequest = { operation: 'index'; id: string; value: string; taskType: string } | { operation: 'recall'; taskType: string; allowedIds: string[] };
export type MemoryRow = { key: string; namespace: typeof MANAGED_MEMORY_NAMESPACE; score: number; content: string };
export type MemoryResult = { operation: 'index'; durable: true; hasEmbedding: boolean } | { operation: 'recall'; available: boolean; rows: MemoryRow[] };
type Slot = { child: ChildProcess; root: string; busy: boolean; lastUsed: number; timer?: ReturnType<typeof setTimeout>; fail?: () => void };

function requestOf(value: unknown): MemoryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid managed memory request');
  const r = value as Record<string, unknown>;
  const keys = r.operation === 'index' ? ['operation', 'id', 'value', 'taskType'] : ['operation', 'taskType', 'allowedIds'];
  if (!['index', 'recall'].includes(String(r.operation)) || Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k)) || !TYPES.includes(String(r.taskType))) throw new Error('Invalid managed memory request');
  if (r.operation === 'index' && (typeof r.id !== 'string' || !HASH.test(r.id) || typeof r.value !== 'string' || Buffer.byteLength(r.value) > MANAGED_MEMORY_LIMITS.rowBytes)) throw new Error('Invalid managed index request');
  if (r.operation === 'recall' && (!Array.isArray(r.allowedIds) || r.allowedIds.length > 500 || r.allowedIds.some(id => typeof id !== 'string' || !HASH.test(id)))) throw new Error('Invalid managed recall request');
  if (Buffer.byteLength(JSON.stringify(r)) > MANAGED_MEMORY_LIMITS.requestBytes) throw new Error('Managed memory request limit exceeded');
  return JSON.parse(JSON.stringify(r)) as MemoryRequest;
}

function resultOf(value: unknown, operation: MemoryRequest['operation'], requestId: string): MemoryResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > MANAGED_MEMORY_LIMITS.resultBytes) throw new Error('Invalid managed memory worker response');
  const r = value as Record<string, unknown>;
  if (r.v !== 1 || r.ok !== true || r.operation !== operation || r.requestId !== requestId) throw new Error('Managed native memory worker did not complete');
  if (operation === 'index') {
    if (Object.keys(r).some(k => !['v', 'ok', 'requestId', 'operation', 'durable', 'hasEmbedding'].includes(k)) || r.durable !== true || typeof r.hasEmbedding !== 'boolean') throw new Error('Unconfirmed managed memory persistence');
    return { operation, durable: true, hasEmbedding: r.hasEmbedding };
  }
  if (Object.keys(r).some(k => !['v', 'ok', 'requestId', 'operation', 'available', 'rows'].includes(k)) || typeof r.available !== 'boolean' || !Array.isArray(r.rows) || r.rows.length > MANAGED_MEMORY_LIMITS.rows) throw new Error('Invalid managed recall response');
  for (const raw of r.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid managed recall row');
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).length !== 4 || Object.keys(row).some(k => !['key', 'namespace', 'score', 'content'].includes(k)) || typeof row.key !== 'string' || !HASH.test(row.key) || row.namespace !== MANAGED_MEMORY_NAMESPACE || typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < -1 || row.score > 1 || typeof row.content !== 'string' || Buffer.byteLength(row.content) > MANAGED_MEMORY_LIMITS.rowBytes) throw new Error('Invalid managed recall row');
  }
  return { operation, available: r.available, rows: r.rows as MemoryRow[] };
}

function sourceLoader(): string {
  try { return createRequire(import.meta.url).resolve('tsx'); } catch { /* npx tsx can live outside project node_modules */ }
  for (let i = 0; i < process.execArgv.length; i++) {
    const arg = process.execArgv[i]!;
    const path = arg === '--import' ? process.execArgv[i + 1] : arg.startsWith('--import=') ? arg.slice(9) : undefined;
    if (!path) continue;
    const file = path.startsWith('file:') ? fileURLToPath(path) : path;
    if (/[/\\]node_modules[/\\]tsx[/\\]dist[/\\](?:loader\.mjs|esm[/\\]index\.mjs)$/.test(file) && existsSync(file)) return file;
  }
  throw new Error('Source managed memory worker requires tsx');
}

function launch(root: string): ChildProcess {
  const js = new URL('./managed-memory-worker.js', import.meta.url), ts = new URL('./managed-memory-worker.ts', import.meta.url);
  const compiled = existsSync(fileURLToPath(js));
  const entry = compiled ? js : ts;
  if (!existsSync(fileURLToPath(entry))) throw new Error('Managed memory worker is not installed');
  // Production uses emitted JS. Source development uses the project's declared
  // tsx dependency so internal .js imports resolve to TypeScript sources.
  const args = compiled ? [] : ['--import', sourceLoader()];
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CLAUDE_FLOW_DISABLE_BRIDGE', 'CLAUDE_FLOW_ENABLE_NATIVE_BRIDGE_ON_WINDOWS']) if (process.env[key] !== undefined) env[key] = process.env[key];
  // No provider credentials or startup hooks are inherited. Existing local
  // models may be used; indexing never initiates a model download.
  env.CLAUDE_FLOW_CWD = root; env.HF_HUB_OFFLINE = '1'; env.TRANSFORMERS_OFFLINE = '1';
  return fork(entry, [], { cwd: root, env, execArgv: args, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' });
}

/** The optional fork callback is an in-process host test seam, not a serialized tool argument. */
export class ManagedMemoryClient {
  private readonly slots = new Map<string, Slot>();
  private readonly timeoutMs: number;
  private readonly idleMs: number;
  private readonly forkWorker: (root: string) => ChildProcess;
  constructor(options: { timeoutMs?: number; idleMs?: number; forkWorker?: (root: string) => ChildProcess } = {}) {
    this.timeoutMs = options.timeoutMs ?? MANAGED_MEMORY_LIMITS.timeoutMs;
    this.idleMs = options.idleMs ?? MANAGED_MEMORY_LIMITS.idleMs;
    this.forkWorker = options.forkWorker ?? launch;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 20 || this.timeoutMs > 60_000 || !Number.isFinite(this.idleMs) || this.idleMs < 20 || this.idleMs > 30_000) throw new Error('Invalid managed memory worker limits');
  }

  run(root: string, raw: unknown, authorize: () => boolean = () => true): Promise<MemoryResult> {
    let input: MemoryRequest, cwd: string;
    try {
      input = requestOf(raw); cwd = realpathSync(root);
      if (!statSync(cwd).isDirectory()) throw new Error('Invalid learning project root');
    } catch { return Promise.reject(new Error('Invalid managed memory operation or project root')); }
    try { if (!authorize()) return Promise.reject(new Error('Managed memory policy denied')); } catch { return Promise.reject(new Error('Managed memory policy denied')); }
    let slot = this.slots.get(cwd);
    if (slot?.busy) return Promise.reject(new Error('Managed memory worker is busy; retry later'));
    if (!slot) {
      if (this.slots.size >= MANAGED_MEMORY_LIMITS.workers) {
        const idle = [...this.slots.values()].filter(s => !s.busy).sort((a, b) => a.lastUsed - b.lastUsed)[0];
        if (!idle) return Promise.reject(new Error('Managed memory worker limit reached; retry later'));
        this.remove(idle);
      }
      try {
        slot = { child: this.forkWorker(cwd), root: cwd, busy: false, lastUsed: Date.now() };
        this.slots.set(cwd, slot);
        const owned = slot;
        slot.child.once('error', () => { owned.fail?.(); this.remove(owned); });
        slot.child.once('exit', () => { owned.fail?.(); this.remove(owned); });
      } catch { return Promise.reject(new Error('Managed native memory worker unavailable')); }
    }
    const owned = slot;
    const requestId = randomUUID();
    if (owned.timer) clearTimeout(owned.timer);
    owned.busy = true;
    return new Promise<MemoryResult>((resolve, reject) => {
      let settled = false, policyDenied = false, ready = false, writeGranted = false;
      const complete = (result?: MemoryResult) => {
        if (settled) return; settled = true; clearTimeout(timeout);
        owned.child.off('message', onMessage); owned.fail = undefined; owned.busy = false; owned.lastUsed = Date.now();
        if (result) {
          owned.timer = setTimeout(() => this.remove(owned), this.idleMs); owned.timer.unref();
          owned.child.unref(); owned.child.channel?.unref();
          resolve(result);
        } else { this.remove(owned); reject(new Error(policyDenied ? (writeGranted ? 'Managed memory policy changed; admitted write may have completed' : 'Managed memory policy denied before dispatch') : 'Managed native memory operation failed or timed out; parent remains available')); }
      };
      const onMessage = (value: unknown) => {
        try {
          if (!authorize()) { policyDenied = true; complete(); return; }
          const message = value as Record<string, unknown> | null;
          if (message?.phase !== undefined) {
            if (Object.keys(message).length !== 3 || message.v !== 1 || message.requestId !== requestId || !['ready', 'before-write'].includes(String(message.phase))) throw new Error('Invalid worker grant request');
            if (message.phase === 'ready') { if (ready) throw new Error('Repeated worker ready'); ready = true; }
            else { if (!ready || writeGranted || input.operation !== 'index') throw new Error('Invalid worker write grant'); writeGranted = true; }
            owned.child.send({ v: 1, requestId, grant: message.phase === 'ready' ? 'execute' : 'write' }, error => { if (error) complete(); });
            return;
          }
          if (!ready) throw new Error('Worker was not ready');
          complete(resultOf(value, input.operation, requestId));
        } catch { complete(); }
      };
      const timeout = setTimeout(() => complete(), this.timeoutMs);
      owned.fail = () => complete(); owned.child.on('message', onMessage);
      try {
        if (!authorize()) { policyDenied = true; complete(); return; }
        owned.child.send({ v: 1, requestId, ...input }, error => { if (error) complete(); });
      } catch { policyDenied = true; complete(); }
    });
  }

  stats(): { workers: number; busy: number } { return { workers: this.slots.size, busy: [...this.slots.values()].filter(s => s.busy).length }; }
  close(): void { for (const slot of [...this.slots.values()]) { slot.fail?.(); this.remove(slot); } }
  private remove(slot: Slot): void {
    if (slot.timer) clearTimeout(slot.timer);
    if (this.slots.get(slot.root) === slot) this.slots.delete(slot.root);
    if (!slot.child.killed) slot.child.kill('SIGKILL');
  }
}

export const managedMemoryClient = new ManagedMemoryClient();
export async function nativeMemoryIndex(root: string, input: Omit<Extract<MemoryRequest, { operation: 'index' }>, 'operation'>, authorize?: () => boolean) {
  return await managedMemoryClient.run(root, { operation: 'index', ...input }, authorize) as Extract<MemoryResult, { operation: 'index' }>;
}
export async function nativeMemoryRecall(root: string, input: Omit<Extract<MemoryRequest, { operation: 'recall' }>, 'operation'>, authorize?: () => boolean) {
  return await managedMemoryClient.run(root, { operation: 'recall', ...input }, authorize) as Extract<MemoryResult, { operation: 'recall' }>;
}
