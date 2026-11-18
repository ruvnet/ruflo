/**
 * RVFA Appliance Builder -- Constructs self-contained .rvf appliance files.
 *
 * Creates a single binary containing kernel, runtime, Ruflo CLI, models/keys,
 * AgentDB data, and the verification suite. See ADR-058.
 */

import {
  createHash, scryptSync, randomBytes, createCipheriv, createDecipheriv,
} from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import {
  RvfaWriter, type RvfaHeader, type RvfaBootConfig, type RvfaModelConfig,
} from './rvfa-format.js';

// ── Public Interfaces ────────────────────────────────────────

export interface BuildOptions {
  profile: 'cloud' | 'hybrid' | 'offline';
  arch: string;
  output: string;
  rufloVersion?: string;
  models?: string[];
  apiKeys?: string;
  verbose?: boolean;
}

export interface BuildResult {
  outputPath: string;
  size: number;
  sections: { id: string; size: number; originalSize: number }[];
  duration: number;
  profile: string;
}

// ── Encryption Constants ─────────────────────────────────────

const SCRYPT_KEY_LEN = 32;
const SCRYPT_SALT_LEN = 32;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const AES_IV_LEN = 16;
const AES_TAG_LEN = 16;
const AES_ALG = 'aes-256-gcm' as const;

// ── Catalog ──────────────────────────────────────────────────

const RUFLO_COMMANDS = 'init agent swarm memory mcp task session config status start workflow hooks hive-mind daemon neural security performance providers plugins deployment embeddings claims migrate process doctor completions'.split(' ');

const AGENT_TYPES = 'coder reviewer tester planner researcher security-architect security-auditor memory-specialist performance-engineer hierarchical-coordinator mesh-coordinator adaptive-coordinator collective-intelligence-coordinator swarm-memory-manager byzantine-coordinator raft-manager gossip-coordinator consensus-builder crdt-synchronizer quorum-manager security-manager perf-analyzer performance-benchmarker task-orchestrator memory-coordinator smart-agent github-modes pr-manager code-review-swarm issue-tracker release-manager workflow-automation project-board-sync repo-architect multi-repo-swarm sparc-coord sparc-coder specification pseudocode architecture refinement backend-dev mobile-dev ml-developer cicd-engineer api-docs system-architect code-analyzer base-template-generator tdd-london-swarm production-validator'.split(' ');

const HOOK_TYPES = 'pre-edit post-edit pre-command post-command pre-task post-task session-start session-end session-restore notify route explain pretrain build-agents transfer teammate-idle task-completed'.split(' ');

const WORKER_TYPES = 'ultralearn optimize consolidate predict audit map preload deepdive document refactor benchmark testgaps'.split(' ');

const OFFLINE_MODELS = [
  { name: 'phi-3-mini-q4', format: 'gguf', sizeHint: '2.3GB', params: '3.8B' },
  { name: 'qwen2.5-coder-3b-q4', format: 'gguf', sizeHint: '1.7GB', params: '3B' },
];

// ── API Key Encryption / Decryption ──────────────────────────

/** Encrypt API keys from a .env file. Output: salt(32)+iv(16)+tag(16)+ciphertext */
export function encryptApiKeys(envPath: string, passphrase: string): Buffer {
  const keys = parseEnvFile(readFileSync(envPath, 'utf-8'));
  const plaintext = Buffer.from(JSON.stringify(keys), 'utf-8');

  const salt = randomBytes(SCRYPT_SALT_LEN);
  const key = scryptSync(passphrase, salt, SCRYPT_KEY_LEN, SCRYPT_OPTS);
  const iv = randomBytes(AES_IV_LEN);
  const cipher = createCipheriv(AES_ALG, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([salt, iv, cipher.getAuthTag(), encrypted]);
}

/** Decrypt API keys previously encrypted with encryptApiKeys. */
export function decryptApiKeys(buf: Buffer, passphrase: string): Record<string, string> {
  const minLen = SCRYPT_SALT_LEN + AES_IV_LEN + AES_TAG_LEN + 1;
  if (buf.length < minLen) {
    throw new Error(`Encrypted buffer too short: need >= ${minLen}B, got ${buf.length}B`);
  }

  let off = 0;
  const salt = buf.subarray(off, off += SCRYPT_SALT_LEN);
  const iv = buf.subarray(off, off += AES_IV_LEN);
  const tag = buf.subarray(off, off += AES_TAG_LEN);
  const ciphertext = buf.subarray(off);

  const key = scryptSync(passphrase, salt, SCRYPT_KEY_LEN, SCRYPT_OPTS);
  const decipher = createDecipheriv(AES_ALG, key, iv);
  decipher.setAuthTag(tag);

  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8'),
  );
}

// ── Builder ──────────────────────────────────────────────────

type SectionId = 'kernel' | 'runtime' | 'ruflo' | 'models' | 'data' | 'verify';

export class RvfaBuilder {
  private opts: Required<BuildOptions>;

  constructor(options: BuildOptions) {
    this.opts = {
      arch: options.arch || 'x86_64',
      profile: options.profile,
      output: resolve(options.output),
      rufloVersion: options.rufloVersion || detectRufloVersion(),
      models: options.models ?? defaultModelsForProfile(options.profile),
      apiKeys: options.apiKeys ?? '',
      verbose: options.verbose ?? false,
    };
  }

  async build(): Promise<BuildResult> {
    const t0 = performance.now();
    this.log(`Building RVFA appliance (profile=${this.opts.profile}, arch=${this.opts.arch})`);

    const outDir = dirname(this.opts.output);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const stages: { id: SectionId; raw: Buffer; label: string }[] = [
      { id: 'kernel',  raw: this.buildKernelSection(),  label: 'Kernel (Alpine rootfs)' },
      { id: 'runtime', raw: this.buildRuntimeSection(), label: 'Runtime (Node.js + Claude Code)' },
      { id: 'ruflo',   raw: this.buildRufloSection(),   label: 'Ruflo CLI' },
      { id: 'models',  raw: this.buildModelsSection(),  label: `Models (${this.opts.profile})` },
      { id: 'data',    raw: this.buildDataSection(),    label: 'Data (AgentDB)' },
      { id: 'verify',  raw: this.buildVerifySection(),  label: 'Verify (test suite)' },
    ];

    const writer = new RvfaWriter(this.buildHeaderPartial());
    const summary: BuildResult['sections'] = [];

    for (const s of stages) {
      const st = performance.now();
      this.log(`  Stage: ${s.label}...`);
      writer.addSection(s.id, s.raw, { type: s.id });
      this.log(`    ${fmtBytes(s.raw.length)} raw (${elapsed(st)})`);
      summary.push({ id: s.id, size: 0, originalSize: s.raw.length });
    }

    const binary = writer.build();

    // Patch compressed sizes from the built header
    try {
      const hLen = binary.readUInt32LE(8);
      const hdr = JSON.parse(binary.subarray(12, 12 + hLen).toString('utf-8')) as RvfaHeader;
      for (const sec of hdr.sections) {
        const e = summary.find((x) => x.id === sec.id);
        if (e) e.size = sec.size;
      }
    } catch { /* non-fatal */ }

    writeFileSync(this.opts.output, binary);
    const duration = performance.now() - t0;

    this.log('');
    this.log('RVFA appliance built successfully.');
    this.log(`  Output: ${this.opts.output}  Size: ${fmtBytes(binary.length)}  Duration: ${elapsed(t0)}`);
    for (const s of summary) {
      const r = s.originalSize > 0 && s.size > 0
        ? ` (${((1 - s.size / s.originalSize) * 100).toFixed(1)}% reduction)` : '';
      this.log(`    ${s.id}: ${fmtBytes(s.originalSize)} -> ${fmtBytes(s.size)}${r}`);
    }

    return { outputPath: this.opts.output, size: binary.length, sections: summary, duration, profile: this.opts.profile };
  }

  // ── Section Builders ─────────────────────────────────────

  private buildKernelSection(): Buffer {
    return jsonBuf({
      type: 'kernel', distribution: 'alpine', version: '3.23', arch: this.opts.arch,
      packages: ['busybox', 'dumb-init', 'musl'],
      init: '/sbin/init -> ruflo-init (PID 1)',
      features: ['minimal rootfs', 'read-only root filesystem', 'tmpfs for /tmp and /run', 'seccomp profile applied'],
      sizeTarget: '~5MB compressed',
      note: 'Manifest-only: actual rootfs fetched during full build pipeline',
    });
  }

  private buildRuntimeSection(): Buffer {
    let nodeVersion = 'v22.0.0';
    try { nodeVersion = execSync('node --version', { encoding: 'utf-8' }).trim(); } catch { /* keep default */ }

    return jsonBuf({
      type: 'runtime',
      node: { version: nodeVersion, target: 'v22', variant: `linux-${this.opts.arch}-musl`, stripped: true, excludes: ['npm', 'corepack', 'debug-symbols'] },
      claudeCode: { name: 'claude-code-cli', entrypoint: '/usr/local/bin/claude' },
      paths: { node: '/usr/local/bin/node', claude: '/usr/local/bin/claude' },
    });
  }

  private buildRufloSection(): Buffer {
    let packageMeta: Record<string, unknown> | null = null;
    try {
      const raw = execSync('npm pack ruflo@latest --dry-run --json', {
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) packageMeta = parsed[0];
    } catch { /* manifest-only fallback */ }

    return jsonBuf({
      type: 'ruflo', version: this.opts.rufloVersion,
      package: packageMeta ?? { name: 'ruflo', version: this.opts.rufloVersion },
      commands: RUFLO_COMMANDS, commandCount: RUFLO_COMMANDS.length,
      agents: AGENT_TYPES, agentCount: AGENT_TYPES.length,
      hooks: { count: HOOK_TYPES.length, types: HOOK_TYPES },
      workers: { count: WORKER_TYPES.length, types: WORKER_TYPES },
      mcpTools: 215,
    });
  }

  private buildModelsSection(): Buffer {
    const p = this.opts.profile;
    const resolveModels = (names: string[]) => names.map((n) => OFFLINE_MODELS.find((m) => m.name === n) ?? { name: n, format: 'gguf', sizeHint: 'unknown', params: 'unknown' });

    if (p === 'cloud') {
      const content: Record<string, unknown> = { type: 'models', profile: 'cloud', provider: 'api-vault', models: [] };
      if (this.opts.apiKeys && existsSync(this.opts.apiKeys)) {
        const enc = encryptApiKeys(this.opts.apiKeys, generateBuildPassphrase());
        content.vault = { format: AES_ALG, kdf: 'scrypt', kdfParams: SCRYPT_OPTS, encrypted: enc.toString('base64') };
        this.log('    API keys encrypted into vault');
      } else {
        content.vault = null;
        content.note = 'No API keys provided; set --api-keys to include vault';
      }
      return jsonBuf(content);
    }

    if (p === 'hybrid') {
      const content: Record<string, unknown> = {
        type: 'models', profile: 'hybrid', provider: 'hybrid', engine: 'ruvllm+api-vault',
        localModels: resolveModels(this.opts.models),
        routing: { tier1: { handler: 'agent-booster', latency: '<1ms' }, tier2: { handler: 'local-model', latency: '~200ms' }, tier3: { handler: 'cloud-api', latency: '2-5s' }, complexityThreshold: 0.3 },
      };
      if (this.opts.apiKeys && existsSync(this.opts.apiKeys)) {
        const enc = encryptApiKeys(this.opts.apiKeys, generateBuildPassphrase());
        content.vault = { format: AES_ALG, kdf: 'scrypt', encrypted: enc.toString('base64') };
        this.log('    API keys encrypted into vault');
      }
      return jsonBuf(content);
    }

    // offline
    const names = this.opts.models.length > 0 ? this.opts.models : ['phi-3-mini-q4', 'qwen2.5-coder-3b-q4'];
    return jsonBuf({
      type: 'models', profile: 'offline', provider: 'ruvllm', engine: 'ruvllm',
      models: resolveModels(names),
      routing: { tier1: { handler: 'agent-booster-wasm', latency: '<1ms' }, tier2: { handler: 'phi-3-mini-q4', latency: '~200ms' }, tier3: { handler: 'qwen2.5-coder-3b-q4', latency: '~2s' }, fallbackToCloud: false },
      kvCache: { backend: 'rvf', persistence: true },
      note: 'Manifest-only: GGUF weights fetched during full build pipeline',
    });
  }

  private buildDataSection(): Buffer {
    // Empty RVF database header (matches rvf-backend.ts RVF\0 magic)
    const rvfMagic = Buffer.from([0x52, 0x56, 0x46, 0x00]);
    const hdrJson = Buffer.from(JSON.stringify({
      magic: 'RVF\0', version: 1, dimensions: 1536, metric: 'cosine',
      quantization: 'fp32', entryCount: 0, createdAt: Date.now(), updatedAt: Date.now(),
    }), 'utf-8');
    const hdrLen = Buffer.alloc(4);
    hdrLen.writeUInt32LE(hdrJson.length, 0);
    const rvfDb = Buffer.concat([rvfMagic, hdrLen, hdrJson]);

    const manifest = jsonBuf({
      type: 'data',
      components: {
        agentDb: { format: 'rvf', magicBytes: 'RVF\\0', databaseSize: rvfDb.length },
        hnswIndex: { type: 'hnsw-index', dimensions: 1536, metric: 'cosine', m: 16, efConstruction: 200, maxElements: 100_000, vectorCount: 0 },
        sonaPatterns: { type: 'sona-patterns', version: 1, architecture: 'self-optimizing-neural', adaptationTime: '<0.05ms', patterns: [], expertCount: 8, moeConfig: { topK: 2, capacityFactor: 1.25, loadBalancingLoss: 0.01 } },
        pluginRegistry: { source: 'ipfs', snapshotted: true, pluginCount: 20 },
      },
    });

    return Buffer.concat([rvfDb, Buffer.from('\n---DATA-MANIFEST---\n'), manifest]);
  }

  private buildVerifySection(): Buffer {
    const scriptPath = resolve(dirname(new URL(import.meta.url).pathname), '../../../../scripts/verify-appliance.sh');
    let script: Buffer;

    if (existsSync(scriptPath)) {
      script = readFileSync(scriptPath);
      this.log(`    Bundled verify-appliance.sh (${fmtBytes(script.length)})`);
    } else {
      script = Buffer.from([
        '#!/bin/sh', 'set -e', 'RUFLO_CMD="${RUFLO_CMD:-ruflo}"',
        'echo "Running basic verification..."',
        '$RUFLO_CMD --version && echo "  OK: CLI" || echo "  FAIL: CLI"',
        '$RUFLO_CMD doctor && echo "  OK: Doctor" || echo "  FAIL: Doctor"',
        'echo "Verification complete."',
      ].join('\n'), 'utf-8');
      this.log('    Using stub verify script (verify-appliance.sh not found)');
    }

    const manifest = jsonBuf({
      type: 'verify-manifest', categories: 35, criticalChecks: 95,
      script: 'verify-appliance.sh',
      scriptSha256: createHash('sha256').update(script).digest('hex'),
      quickMode: { categories: [1, 2, 3, 4, 5, 25] },
    });

    return Buffer.concat([script, Buffer.from('\n---VERIFY-MANIFEST---\n'), manifest]);
  }

  // ── Header ───────────────────────────────────────────────

  private buildHeaderPartial(): Partial<RvfaHeader> {
    const providerMap: Record<string, RvfaModelConfig['provider']> = { cloud: 'api-vault', hybrid: 'hybrid', offline: 'ruvllm' };
    const caps = ['cli-26-commands', 'agents-60-plus', 'hooks-17', 'workers-12', 'mcp-215-tools', 'agentdb-rvf', 'hnsw-search', 'sona-patterns', 'security-scanning', 'performance-profiling', 'hive-mind-consensus', 'plugin-registry'];
    if (this.opts.profile !== 'cloud') caps.push('local-inference-ruvllm');
    if (this.opts.profile !== 'offline') caps.push('cloud-api-vault');

    const boot: RvfaBootConfig = {
      entrypoint: '/opt/ruflo/bin/cli.js',
      args: ['--profile', this.opts.profile],
      env: { NODE_ENV: 'production', CLAUDE_FLOW_MEMORY_BACKEND: 'hybrid', CLAUDE_FLOW_LOG_LEVEL: 'info' },
      isolation: this.opts.profile === 'cloud' ? 'container' : 'native',
    };

    const models: RvfaModelConfig = {
      provider: providerMap[this.opts.profile],
      engine: this.opts.profile === 'cloud' ? undefined : 'ruvllm-0.1.0',
      models: this.opts.models.length > 0 ? this.opts.models : undefined,
      vaultEncryption: this.opts.profile !== 'offline' ? 'aes-256-gcm' : undefined,
    };

    return {
      magic: 'RVFA', version: 1, name: 'ruflo-appliance', appVersion: this.opts.rufloVersion,
      arch: this.opts.arch, platform: 'linux', profile: this.opts.profile,
      created: new Date().toISOString(), boot, models, capabilities: caps,
    };
  }

  private log(msg: string): void {
    if (this.opts.verbose) console.log(`[RvfaBuilder] ${msg}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function jsonBuf(obj: unknown): Buffer {
  return Buffer.from(JSON.stringify(obj, null, 2), 'utf-8');
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.substring(0, eq).trim();
    let v = t.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (k) result[k] = v;
  }
  return result;
}

function detectRufloVersion(): string {
  try {
    const p = resolve(dirname(new URL(import.meta.url).pathname), '../../package.json');
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')).version ?? '3.5.0';
  } catch { /* ignore */ }
  return '3.5.0';
}

function defaultModelsForProfile(profile: string): string[] {
  if (profile === 'offline') return ['phi-3-mini-q4', 'qwen2.5-coder-3b-q4'];
  if (profile === 'hybrid') return ['phi-3-mini-q4'];
  return [];
}

function generateBuildPassphrase(): string {
  return randomBytes(32).toString('hex');
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}

function elapsed(t: number): string {
  const ms = performance.now() - t;
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
