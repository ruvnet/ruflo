/**
 * Per-Project Isolated MCP Router
 *
 * Multiplexes a single stdio MCP client connection onto isolated per-project
 * `mcp start` child worker processes. Each project workspace runs in its own
 * OS process with `cwd` and `CLAUDE_FLOW_CWD` pinned to the resolved workspace
 * root, preventing memory, agent registry, task store, swarm topology, and
 * learning state from leaking across concurrent workspaces.
 *
 * @module @claude-flow/cli/mcp-project-router
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_IDLE_EVICT_MS = 20 * 60 * 1000;
const DEFAULT_BOOT_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_ID_INDEX_ENTRIES = 10_000;

export const ROUTER_HINT_KEYS = ['projectPath', 'projectRoot', 'workspacePath', 'workspace'] as const;

const PATH_HINT_KEYS = [
  ...ROUTER_HINT_KEYS,
  'cwd',
  'dbPath',
  'filePath',
  'file_path',
  'path',
  'targetPath',
  'workingDir',
  'rootDir',
  'target',
  'source',
  'destination',
  'dir',
] as const;

const TEXT_SCAN_KEYS = [
  'description',
  'query',
  'prompt',
  'key',
  'value',
  'notes',
  'reason',
  'message',
  'command',
] as const;

const ID_KEYS = [
  'swarmId',
  'agentId',
  'taskId',
  'sessionId',
  'missionId',
  'workflowId',
  'issueId',
  'proposalId',
] as const;

const ID_ARRAY_KEYS = ['agentIds', 'assignTo', 'assignedTo', 'taskIds'] as const;

const PROJECT_MARKERS = [
  '.claude-flow',
  '.swarm',
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'pom.xml',
  'CLAUDE.md',
  'AGENTS.md',
  'Makefile',
] as const;

export interface ProjectRouterOptions {
  /** Global fallback cwd used for bootstrap (`initialize`, `tools/list`) and un-scoped calls. */
  globalCwd?: string;
  /** Directory storing `known-projects.json` and `router-id-index.json`. */
  stateDir?: string;
  /** Path to CLI entrypoint spawned for each isolated worker. */
  cliEntryPath?: string;
  /** Optional tool filter forwarded to workers (`--tools <filter>`). */
  tools?: string;
  /** Additional parent directories whose immediate subdirectories represent distinct projects. */
  projectParentRoots?: string[];
  /** Additional directories that contain projects and must never be treated as workspaces themselves. */
  containerDirs?: string[];
  /** Idle timeout in ms before reaping non-global workers. */
  idleEvictMs?: number;
  /** Timeout in ms waiting for worker `initialize`. */
  bootTimeoutMs?: number;
  /** Maximum cached ID -> projectRoot mappings persisted to disk. */
  maxIdIndexEntries?: number;
  /** Disable disk persistence (primarily for unit tests). */
  disablePersistence?: boolean;
  /** Optional custom logger callback (writes to stderr by default). */
  logger?: (level: string, msg: string) => void;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (msg: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerEntry {
  projectRoot: string;
  label: string;
  child: ChildProcess;
  pending: Map<number, PendingRequest>;
  inFlight: number;
  lastUsedMs: number;
  readyPromise: Promise<JsonRpcResponse>;
  disposed: boolean;
  sendRequest: (method: string, params?: Record<string, unknown>, timeoutMs?: number) => Promise<JsonRpcResponse>;
}

function defaultLogger(level: string, msg: string): void {
  process.stderr.write(`[${new Date().toISOString()}] ${level} [ruflo-project-router] ${msg}\n`);
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Safely resolve realpath of a path, handling non-existent leaf or intermediate
 * paths by resolving the deepest existing ancestor on disk and re-joining remaining segments.
 */
export function resolveRealPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  if (existsSync(resolved)) {
    try {
      return (realpathSync.native ?? realpathSync)(resolved);
    } catch {
      return resolved;
    }
  }

  let probe = resolved;
  const missingParts: string[] = [];
  while (probe && !existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    missingParts.unshift(path.basename(probe));
    probe = parent;
  }

  try {
    const realBase = existsSync(probe)
      ? (realpathSync.native ?? realpathSync)(probe)
      : probe;
    return path.join(realBase, ...missingParts);
  } catch {
    return resolved;
  }
}

function splitEnvPaths(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
}

/** Resolve default container directories that hold workspaces rather than being workspaces themselves. */
export function buildDefaultContainerDirs(homeDir = os.homedir(), stateDir = path.join(homeDir, '.claude-flow')): Set<string> {
  const rootDir = path.parse(homeDir).root || '/';
  const raw: string[] = [
    rootDir,
    '/home',
    '/Users',
    '/tmp',
    '/var',
    '/usr',
    '/opt',
    '/etc',
    '/run',
    '/run/media',
    '/mnt',
    '/Volumes',
    os.tmpdir(),
    homeDir,
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Pictures'),
    path.join(homeDir, 'Videos'),
    path.join(homeDir, 'Music'),
    path.join(homeDir, 'Public'),
    path.join(homeDir, 'Templates'),
    path.join(homeDir, '.config'),
    path.join(homeDir, '.cache'),
    path.join(homeDir, '.local'),
    path.join(homeDir, '.claude'),
    stateDir,
    path.join(homeDir, '.swarm'),
    ...splitEnvPaths(process.env.RUFLO_ROUTER_CONTAINER_DIRS),
  ];
  try {
    const username = os.userInfo().username;
    if (username) {
      raw.push(`/run/media/${username}`, `/media/${username}`);
    }
  } catch {
    // Containerized environments may not resolve userInfo(); continue without it.
  }
  const result = new Set<string>();
  for (const entry of raw) {
    const resolved = path.resolve(entry);
    result.add(resolved);
    result.add(resolveRealPath(resolved));
  }
  return result;
}

/** Resolve the CLI script entrypoint used to spawn child stdio workers. */
export function resolveCliEntryPath(explicitPath?: string): string {
  if (explicitPath && existsSync(explicitPath)) return explicitPath;

  const candidates = [
    fileURLToPath(new URL('../../bin/cli.js', import.meta.url)),
    fileURLToPath(new URL('../bin/cli.js', import.meta.url)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  if (process.argv[1] && existsSync(process.argv[1])) {
    return path.resolve(process.argv[1]);
  }
  return candidates[0];
}

/**
 * Coordinates workspace root detection, persistent ID ownership mapping, schema
 * augmentation, and per-project stdio MCP worker lifecycle.
 */
export class ProjectIsolationRouter {
  readonly globalCwd: string;
  readonly stateDir: string;
  readonly knownProjectsFile: string;
  readonly idIndexFile: string;
  readonly cliEntryPath: string;
  readonly toolsFilter?: string;
  readonly idleEvictMs: number;
  readonly bootTimeoutMs: number;
  readonly maxIdIndexEntries: number;
  readonly disablePersistence: boolean;
  readonly containerDirs: Set<string>;
  readonly projectParentRoots: string[];
  readonly log: (level: string, msg: string) => void;

  readonly knownProjects = new Set<string>();
  readonly idIndex = new Map<string, string>();
  readonly nativeHintProperties = new Map<string, Set<string>>();
  readonly workers = new Map<string, WorkerEntry>();

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private routerToolsCache: ToolDefinition[] | null = null;
  private clientInitParams: Record<string, unknown> = {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ruflo-project-router', version: '1.0.0' },
  };
  private globalReqSeq = 1;

  constructor(options: ProjectRouterOptions = {}) {
    const homeDir = os.homedir();
    this.globalCwd = resolveRealPath(options.globalCwd ?? homeDir);
    this.stateDir = path.resolve(options.stateDir ?? path.join(homeDir, '.claude-flow'));
    this.knownProjectsFile = path.join(this.stateDir, 'known-projects.json');
    this.idIndexFile = path.join(this.stateDir, 'router-id-index.json');
    this.cliEntryPath = resolveCliEntryPath(options.cliEntryPath);
    this.toolsFilter = options.tools;
    this.idleEvictMs = options.idleEvictMs ?? (Number(process.env.RUFLO_ROUTER_IDLE_MS) || DEFAULT_IDLE_EVICT_MS);
    this.bootTimeoutMs = options.bootTimeoutMs ?? DEFAULT_BOOT_TIMEOUT_MS;
    this.maxIdIndexEntries = options.maxIdIndexEntries ?? DEFAULT_MAX_ID_INDEX_ENTRIES;
    this.disablePersistence = options.disablePersistence ?? false;
    this.log = options.logger ?? defaultLogger;

    this.containerDirs = buildDefaultContainerDirs(homeDir, this.stateDir);
    this.containerDirs.add(this.globalCwd);
    this.containerDirs.add(resolveRealPath(this.globalCwd));
    for (const extra of options.containerDirs ?? []) {
      const resolved = path.resolve(extra);
      this.containerDirs.add(resolved);
      this.containerDirs.add(resolveRealPath(resolved));
    }

    const parentRoots = [
      ...(options.projectParentRoots ?? []),
      ...splitEnvPaths(process.env.RUFLO_PROJECT_PARENT_ROOTS),
    ].map((entry) => path.resolve(entry));
    this.projectParentRoots = [...new Set(parentRoots.flatMap((entry) => [entry, resolveRealPath(entry)]))];
    for (const parent of this.projectParentRoots) {
      this.containerDirs.add(parent);
      this.containerDirs.add(resolveRealPath(parent));
    }
  }

  /**
   * Resolve a directory or file candidate to its canonical project root directory.
   * Returns null for system, home, or container directories.
   */
  normalizeProjectRoot(candidate: unknown, allowUnmarked = true): string | null {
    if (typeof candidate !== 'string') return null;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.includes('\0') || !path.isAbsolute(trimmed)) return null;

    let abs = resolveRealPath(trimmed);
    if (isFile(abs)) {
      abs = path.dirname(abs);
    } else if (!isDir(abs)) {
      let probe = abs;
      for (let i = 0; i < 6; i++) {
        const parent = path.dirname(probe);
        if (parent === probe) break;
        probe = parent;
        if (isDir(probe)) {
          abs = probe;
          break;
        }
      }
      if (!isDir(abs)) return null;
    }

    abs = resolveRealPath(abs);

    if (this.containerDirs.has(abs)) return null;

    const chain: string[] = [];
    let cur = abs;
    for (let i = 0; i < 16; i++) {
      const canonicalCur = resolveRealPath(cur);
      if (this.containerDirs.has(cur) || this.containerDirs.has(canonicalCur)) break;
      chain.push(canonicalCur);
      const parent = path.dirname(canonicalCur);
      if (parent === canonicalCur) break;
      cur = parent;
    }
    if (chain.length === 0) return null;

    for (let i = chain.length - 1; i >= 0; i--) {
      if (this.knownProjects.has(chain[i])) return chain[i];
    }

    for (const dir of chain) {
      if (this.projectParentRoots.includes(path.dirname(dir))) {
        return dir;
      }
    }

    for (const dir of chain) {
      if (existsSync(path.join(dir, '.claude-flow')) || existsSync(path.join(dir, '.swarm'))) {
        return dir;
      }
    }
    for (let i = chain.length - 1; i >= 0; i--) {
      const dir = chain[i];
      if (PROJECT_MARKERS.some((marker) => existsSync(path.join(dir, marker)))) {
        return dir;
      }
    }

    return allowUnmarked ? abs : null;
  }

  loadPersistentState(): void {
    if (this.disablePersistence) return;
    try {
      if (existsSync(this.knownProjectsFile)) {
        const parsed = JSON.parse(readFileSync(this.knownProjectsFile, 'utf8'));
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (typeof entry === 'string' && isDir(entry)) {
              const resolved = resolveRealPath(entry);
              if (!this.containerDirs.has(resolved)) {
                this.knownProjects.add(resolved);
              }
            }
          }
        }
      }
    } catch {
      // Ignore corrupt cache and rebuild from live calls.
    }

    try {
      if (existsSync(this.idIndexFile)) {
        const parsed = JSON.parse(readFileSync(this.idIndexFile, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const [id, proj] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof id === 'string' && typeof proj === 'string' && isDir(proj)) {
              this.idIndex.set(id, resolveRealPath(proj));
            }
          }
        }
      }
    } catch {
      // Ignore corrupt cache.
    }

    for (const projectRoot of this.knownProjects) {
      this.indexProjectIdsFromDisk(projectRoot);
    }
  }

  flushStateSync(): void {
    if (this.disablePersistence) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    try {
      if (!existsSync(this.stateDir)) {
        mkdirSync(this.stateDir, { recursive: true });
      }
      writeFileSync(this.knownProjectsFile, JSON.stringify([...this.knownProjects], null, 2), 'utf8');
      if (this.idIndex.size > this.maxIdIndexEntries) {
        const excess = this.idIndex.size - this.maxIdIndexEntries;
        let removed = 0;
        for (const key of this.idIndex.keys()) {
          this.idIndex.delete(key);
          if (++removed >= excess) break;
        }
      }
      writeFileSync(this.idIndexFile, JSON.stringify(Object.fromEntries(this.idIndex), null, 2), 'utf8');
    } catch (err) {
      this.log('WARN', `Failed persisting router state: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private schedulePersist(): void {
    if (this.disablePersistence || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushStateSync();
    }, 500);
    this.persistTimer.unref?.();
  }

  registerProject(projectRoot: string): void {
    const canonical = resolveRealPath(projectRoot);
    if (!canonical || canonical === this.globalCwd || this.containerDirs.has(canonical)) return;
    if (!this.knownProjects.has(canonical)) {
      this.knownProjects.add(canonical);
      this.indexProjectIdsFromDisk(canonical);
      this.schedulePersist();
    }
  }

  recordIdOwnership(id: string, projectRoot: string): void {
    if (!id || !projectRoot || projectRoot === this.globalCwd) return;
    if (this.idIndex.get(id) !== projectRoot) {
      this.idIndex.set(id, projectRoot);
      this.schedulePersist();
    }
  }

  indexProjectIdsFromDisk(projectRoot: string): void {
    const cfDir = path.join(projectRoot, '.claude-flow');
    const files: Array<[string, string]> = [
      [path.join(cfDir, 'swarm', 'swarm-state.json'), 'swarms'],
      [path.join(cfDir, 'agents', 'store.json'), 'agents'],
      [path.join(cfDir, 'tasks', 'store.json'), 'tasks'],
    ];
    for (const [file, key] of files) {
      try {
        if (!existsSync(file)) continue;
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        const rec = parsed?.[key];
        if (rec && typeof rec === 'object') {
          for (const id of Object.keys(rec as Record<string, unknown>)) {
            this.idIndex.set(id, projectRoot);
          }
        }
      } catch {
        // Best-effort disk indexing.
      }
    }
  }

  /** Determine which isolated workspace root should handle a given `tools/call` invocation. */
  resolveProjectRoot(args: unknown): string {
    const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};

    for (const key of ROUTER_HINT_KEYS) {
      const val = input[key];
      if (typeof val === 'string' && val.trim()) {
        const root = this.normalizeProjectRoot(val, true);
        if (root) {
          this.registerProject(root);
          return root;
        }
      }
    }

    for (const key of PATH_HINT_KEYS) {
      const val = input[key];
      if (typeof val === 'string' && val.trim()) {
        const root = this.normalizeProjectRoot(val, false);
        if (root) {
          this.registerProject(root);
          return root;
        }
      }
    }

    for (const key of ID_KEYS) {
      const val = input[key];
      if (typeof val === 'string') {
        const owner = this.idIndex.get(val);
        if (owner) return owner;
      }
    }

    for (const key of ID_ARRAY_KEYS) {
      const arr = input[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === 'string') {
            const owner = this.idIndex.get(item);
            if (owner) return owner;
          }
        }
      }
    }

    for (const key of TEXT_SCAN_KEYS) {
      const val = input[key];
      if (typeof val !== 'string' || (!val.includes('/') && !val.includes('\\'))) continue;

      const sortedKnown = [...this.knownProjects].sort((a, b) => b.length - a.length);
      for (const proj of sortedKnown) {
        if (val.includes(proj)) return proj;
      }

      for (const parent of this.projectParentRoots) {
        const prefix = parent + path.sep;
        const idx = val.indexOf(prefix);
        if (idx !== -1) {
          const rest = val.slice(idx + prefix.length);
          const seg = rest.split(/[/\\'"`\n\r,;]/)[0]?.trim();
          if (seg) {
            const root = this.normalizeProjectRoot(path.join(parent, seg), false);
            if (root) {
              this.registerProject(root);
              return root;
            }
          }
        }
      }
    }

    return this.globalCwd;
  }

  /** Inspect tool response payloads and index newly minted IDs to their owning project root. */
  learnIdsFromResult(result: unknown, projectRoot: string): void {
    if (!result || typeof result !== 'object' || !projectRoot || projectRoot === this.globalCwd) return;
    const obj = result as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      for (const item of obj.content) {
        const part = item as Record<string, unknown> | undefined;
        if (part?.type === 'text' && typeof part.text === 'string') {
          try {
            const parsed = JSON.parse(part.text) as unknown;
            this.extractIdsRecursive(parsed, projectRoot, 0);
          } catch {
            // Non-JSON text payload.
          }
        }
      }
    } else {
      this.extractIdsRecursive(obj, projectRoot, 0);
    }
  }

  private extractIdsRecursive(obj: unknown, projectRoot: string, depth: number): void {
    if (!obj || typeof obj !== 'object' || depth > 4) return;
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 50)) {
        this.extractIdsRecursive(item, projectRoot, depth + 1);
      }
      return;
    }

    const rec = obj as Record<string, unknown>;
    for (const key of ID_KEYS) {
      const val = rec[key];
      if (typeof val === 'string') {
        this.recordIdOwnership(val, projectRoot);
      }
    }
    for (const key of ID_ARRAY_KEYS) {
      const arr = rec[key];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === 'string') this.recordIdOwnership(item, projectRoot);
        }
      }
    }
    for (const sub of ['agents', 'tasks', 'swarms', 'agent', 'swarm', 'task']) {
      if (rec[sub] && typeof rec[sub] === 'object') {
        this.extractIdsRecursive(rec[sub], projectRoot, depth + 1);
      }
    }
  }

  /** Add optional `projectPath` routing hint to advertised tool schemas and track native declarations. */
  augmentToolSchemas(rawTools: ToolDefinition[]): ToolDefinition[] {
    return rawTools.map((tool) => {
      const schema = tool.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema
        : { type: 'object', properties: {} };
      const props: Record<string, unknown> = schema.properties && typeof schema.properties === 'object'
        ? { ...schema.properties }
        : {};

      const nativeSet = new Set<string>();
      for (const key of ROUTER_HINT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(props, key)) nativeSet.add(key);
      }
      this.nativeHintProperties.set(tool.name, nativeSet);

      if (!Object.prototype.hasOwnProperty.call(props, 'projectPath')) {
        props.projectPath = {
          type: 'string',
          description:
            'Optional workspace root directory path for per-project isolation; omit when operating outside a workspace.',
        };
      }

      return {
        ...tool,
        inputSchema: {
          ...schema,
          properties: props,
        },
      };
    });
  }

  /** Strip router-injected hint keys unless the target tool natively declares them. */
  stripRouterOnlyHints(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
    const nativeSet = this.nativeHintProperties.get(toolName);
    const forwarded = { ...args };
    for (const key of ROUTER_HINT_KEYS) {
      if (!nativeSet?.has(key) && Object.prototype.hasOwnProperty.call(forwarded, key)) {
        delete forwarded[key];
      }
    }
    return forwarded;
  }

  private getOrSpawnWorker(projectRoot: string): WorkerEntry {
    const existing = this.workers.get(projectRoot);
    if (existing && !existing.disposed) {
      existing.lastUsedMs = Date.now();
      return existing;
    }
    return this.createWorker(projectRoot);
  }

  private createWorker(projectRoot: string): WorkerEntry {
    const isGlobal = projectRoot === this.globalCwd;
    const label = isGlobal ? 'global' : path.basename(projectRoot) || projectRoot;
    this.log('INFO', `Spawning isolated MCP worker [${label}] cwd=${projectRoot}`);

    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      // Prevent child workers from recursively launching another isolation router.
      RUFLO_MCP_ISOLATE_PROJECTS: '0',
      ...(isGlobal ? {} : { CLAUDE_FLOW_CWD: projectRoot, RUFLO_PROJECT_ROOT: projectRoot }),
    };

    const spawnArgs = [this.cliEntryPath, 'mcp', 'start'];
    if (this.toolsFilter && this.toolsFilter !== 'all') {
      spawnArgs.push('--tools', this.toolsFilter);
    }

    const child = spawn(process.execPath, spawnArgs, {
      cwd: projectRoot,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const entry: WorkerEntry = {
      projectRoot,
      label,
      child,
      pending: new Map<number, PendingRequest>(),
      inFlight: 0,
      lastUsedMs: Date.now(),
      disposed: false,
      readyPromise: Promise.resolve({ jsonrpc: '2.0', result: {} }),
      sendRequest: async () => ({ jsonrpc: '2.0', result: {} }),
    };

    let stdoutBuf = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: JsonRpcResponse & { method?: string };
        try {
          msg = JSON.parse(trimmed) as JsonRpcResponse & { method?: string };
        } catch {
          this.log('WARN', `[worker:${label}] non-JSON stdout ignored: ${trimmed.slice(0, 120)}`);
          continue;
        }
        if (msg.method === 'server.initialized' && msg.id === undefined) {
          continue;
        }
        if (typeof msg.id === 'number' && entry.pending.has(msg.id)) {
          const wait = entry.pending.get(msg.id)!;
          entry.pending.delete(msg.id);
          clearTimeout(wait.timer);
          wait.resolve(msg);
        }
      }
    });

    let stderrBuf = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) {
          process.stderr.write(`[worker:${label}] ${line}\n`);
        }
      }
    });

    child.on('exit', (code, signal) => {
      entry.disposed = true;
      if (this.workers.get(projectRoot) === entry) {
        this.workers.delete(projectRoot);
      }
      for (const wait of entry.pending.values()) {
        clearTimeout(wait.timer);
        wait.reject(new Error(`Worker [${label}] exited (code=${code}, signal=${signal})`));
      }
      entry.pending.clear();
      this.log('INFO', `Worker [${label}] stopped (code=${code}, signal=${signal})`);
    });

    child.on('error', (err) => {
      this.log('ERROR', `Worker [${label}] process error: ${err.message}`);
    });

    const sendRaw = (
      method: string,
      params: Record<string, unknown> | undefined,
      timeoutMs: number,
    ): Promise<JsonRpcResponse> => {
      return new Promise((resolve, reject) => {
        if (entry.disposed || child.killed || !child.stdin) {
          reject(new Error(`Worker [${label}] is not active`));
          return;
        }
        const workerReqId = this.globalReqSeq++;
        const frame = { jsonrpc: '2.0', id: workerReqId, method, ...(params !== undefined ? { params } : {}) };
        const timer = setTimeout(() => {
          if (entry.pending.has(workerReqId)) {
            entry.pending.delete(workerReqId);
            reject(new Error(`Worker [${label}] request timed out after ${timeoutMs}ms (${method})`));
          }
        }, timeoutMs);
        entry.pending.set(workerReqId, { resolve, reject, timer });
        child.stdin.write(JSON.stringify(frame) + '\n');
      });
    };

    entry.sendRequest = async (method, params, timeoutMs = DEFAULT_TOOL_TIMEOUT_MS) => {
      await entry.readyPromise;
      entry.inFlight++;
      entry.lastUsedMs = Date.now();
      try {
        return await sendRaw(method, params, timeoutMs);
      } finally {
        entry.inFlight--;
        entry.lastUsedMs = Date.now();
      }
    };

    entry.readyPromise = (async () => {
      const initResp = await sendRaw('initialize', this.clientInitParams, this.bootTimeoutMs);
      if (initResp.error) {
        throw new Error(`Worker [${label}] initialize failed: ${initResp.error.message}`);
      }
      if (!entry.disposed && !child.killed && child.stdin) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      }
      return initResp;
    })();

    this.workers.set(projectRoot, entry);
    return entry;
  }

  startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(() => {
      const now = Date.now();
      for (const [proj, entry] of this.workers) {
        if (proj === this.globalCwd) continue;
        if (entry.inFlight === 0 && now - entry.lastUsedMs > this.idleEvictMs) {
          this.log('INFO', `Evicting idle worker [${entry.label}]`);
          this.workers.delete(proj);
          try { entry.child.stdin?.end(); } catch { /* ignore */ }
          setTimeout(() => {
            if (!entry.disposed) {
              try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
            }
          }, 500).unref?.();
        }
      }
    }, 60_000);
    this.reaperTimer.unref?.();
  }

  shutdownAllWorkers(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    this.flushStateSync();
    for (const entry of this.workers.values()) {
      try { entry.child.stdin?.end(); } catch { /* ignore */ }
      try { entry.child.kill('SIGTERM'); } catch { /* ignore */ }
    }
    this.workers.clear();
  }

  async handleIncomingMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (!message || !message.method) {
      if (message?.id !== undefined && message.id !== null) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32600, message: 'Invalid Request: missing method' },
        };
      }
      return null;
    }

    const { id, method, params = {} } = message;
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') {
        this.log('INFO', 'Upstream MCP client initialized');
      }
      return null;
    }

    try {
      if (method === 'initialize') {
        if (params && typeof params === 'object') {
          this.clientInitParams = params;
        }
        const bootstrap = this.getOrSpawnWorker(this.globalCwd);
        const resp = await bootstrap.readyPromise;
        return { jsonrpc: '2.0', id, result: resp.result };
      }

      if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
      }

      if (method === 'tools/list') {
        if (this.routerToolsCache) {
          return { jsonrpc: '2.0', id, result: { tools: this.routerToolsCache } };
        }
        const bootstrap = this.getOrSpawnWorker(this.globalCwd);
        const resp = await bootstrap.sendRequest('tools/list', params);
        if (resp.error) {
          return { jsonrpc: '2.0', id, error: resp.error };
        }
        const rawTools = Array.isArray(resp.result?.tools) ? (resp.result.tools as ToolDefinition[]) : [];
        this.routerToolsCache = this.augmentToolSchemas(rawTools);
        return { jsonrpc: '2.0', id, result: { ...resp.result, tools: this.routerToolsCache } };
      }

      if (method === 'tools/call') {
        const toolName = typeof params.name === 'string' ? params.name : '';
        const rawArgs = params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
        const targetRoot = this.resolveProjectRoot(rawArgs);
        const forwardedArgs = this.stripRouterOnlyHints(toolName, rawArgs);

        const worker = this.getOrSpawnWorker(targetRoot);
        const resp = await worker.sendRequest('tools/call', { name: toolName, arguments: forwardedArgs });
        if (resp.result && !resp.result.isError) {
          this.learnIdsFromResult(resp.result, targetRoot);
        }
        return resp.error
          ? { jsonrpc: '2.0', id, error: resp.error }
          : { jsonrpc: '2.0', id, result: resp.result };
      }

      const bootstrap = this.getOrSpawnWorker(this.globalCwd);
      const resp = await bootstrap.sendRequest(method, params);
      return resp.error
        ? { jsonrpc: '2.0', id, error: resp.error }
        : { jsonrpc: '2.0', id, result: resp.result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

/**
 * Start the multi-project isolated stdio MCP router and block until stdin closes or
 * a termination signal is received.
 */
export async function startIsolatedProjectMcpRouter(options: ProjectRouterOptions = {}): Promise<never> {
  const router = new ProjectIsolationRouter(options);
  router.loadPersistentState();
  router.startReaper();
  router.log(
    'INFO',
    `Starting Per-Project Isolated MCP Router (knownProjects=${router.knownProjects.size}, indexedIds=${router.idIndex.size})`,
  );

  const writeFrame = (frame: JsonRpcResponse): void => {
    process.stdout.write(JSON.stringify(frame) + '\n');
  };

  let stdinBuf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    stdinBuf += chunk;
    const lines = stdinBuf.split('\n');
    stdinBuf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcRequest;
        void router.handleIncomingMessage(msg).then((resp) => {
          if (resp) writeFrame(resp);
        });
      } catch (err) {
        router.log('ERROR', `Invalid incoming JSON frame: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  });

  const shutdown = (): never => {
    router.shutdownAllWorkers();
    process.exit(0);
  };

  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise<void>(() => {});
  return undefined as never;
}
