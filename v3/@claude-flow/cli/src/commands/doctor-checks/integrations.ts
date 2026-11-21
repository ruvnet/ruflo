/**
 * Doctor checks for optional integrations: AIDefence, federation, agentic-flow, encryption, typesafe router, mods.
 * Split out of commands/doctor.ts (#4773).
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { decodeKey, isEncryptionEnabled } from '../../encryption/vault.js';
import { isEncryptedBlob } from '../../encryption/vault.js';
import type { HealthCheck } from './shared.js';

// Check AIDefence package availability (#1807)
//
// `aidefence_*` MCP tools (scan, analyze, has_pii, stats, learn) require
// `@claude-flow/aidefence` to be installed and loadable. The package is an
// optional dependency — present in some installs (project-local) but
// missing in others (npm-global of `claude-flow`). Without it, every
// aidefence MCP call fails at runtime with "Cannot find module".
//
// Surface that state in `doctor` so operators know BEFORE they rely on
// AI-defence scanning. The probe is the same dynamic `import()` the MCP
// tool's handler uses, so a `pass` here means the actual tools will work.
export async function checkAIDefence(): Promise<HealthCheck> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await import('@claude-flow/aidefence');
    return {
      name: 'AIDefence',
      status: 'pass',
      message: '@claude-flow/aidefence loadable — aidefence_* MCP tools functional',
    };
  } catch {
    return {
      name: 'AIDefence',
      status: 'warn',
      message: '@claude-flow/aidefence not loadable — aidefence_* MCP tools will fail (optional package)',
      fix: 'npm install --save @claude-flow/aidefence  (in your project), or run `claude-flow mcp start` from a directory that has it installed',
    };
  }
}

/**
 * ADR-097 Phase 4: federation peer-state surface for doctor.
 *
 * Probes the federation plugin loadability + asserts the breaker entity
 * layer is present in the installed version. Without the plugin
 * installed this is a "not configured" pass — federation is opt-in.
 *
 * Live coordinator state (per-peer counts) requires a running MCP server
 * with `federation_init` called; operators inspect that via the
 * `federation_breaker_status` MCP tool, not the doctor (which is a
 * one-shot CLI process with no coordinator session).
 */
export async function checkFederationBreaker(): Promise<HealthCheck> {
  try {
    // Optional plugin — not a hard dep of @claude-flow/cli. Build the
    // module specifier dynamically so TypeScript cannot statically
    // resolve it (which would emit TS2307); at runtime the import
    // either resolves (plugin installed) or throws (handled below).
    const specifier = ['@claude-flow', 'plugin-agent-federation'].join('/');
    const mod: { FederationNodeState?: unknown } = await import(specifier);
    if (!mod.FederationNodeState) {
      return {
        name: 'Federation Breaker',
        status: 'warn',
        message:
          '@claude-flow/plugin-agent-federation loaded but FederationNodeState export missing — version older than ADR-097 Phase 2',
        fix: 'Upgrade: npm install @claude-flow/plugin-agent-federation@alpha',
      };
    }
    return {
      name: 'Federation Breaker',
      status: 'pass',
      message:
        'ADR-097 breaker loadable — federation_breaker_status / federation_evict / federation_reactivate MCP tools available',
    };
  } catch {
    return {
      name: 'Federation Breaker',
      status: 'pass',
      message:
        'Federation plugin not installed (optional) — install only if you need cross-installation peering',
      fix: 'npm install --save @claude-flow/plugin-agent-federation@alpha',
    };
  }
}

// ADR-404 — ruflo as a Claude Code mod (function hooks, early access). One
// line in a bare `doctor`: whether the mod is enabled, can load (function
// hooks on, not refused by allowManagedModsOnly) and has started. Only an
// opted-in project whose plugin Claude Code cannot resolve (stale ruflo
// marketplace clone, nothing installed) fails: the classic hooks still run,
// but the opt-in silently does nothing. `ruflo mods doctor` prints every finding.
export async function checkMods(): Promise<HealthCheck> {
  const { probeMods } = await import('../../mods/probe.js');
  const findings = probeMods({ projectRoot: process.cwd() });
  const enabled = findings.find((f) => f.name === 'ruflo-mods plugin')?.status === 'pass';
  if (!enabled) return { name: 'ruflo mods (ADR-404)', status: 'pass', message: 'not enabled; classic hooks handle every event' };
  const failures = findings.filter((f) => f.status === 'fail');
  if (failures.length > 0) {
    return { name: 'ruflo mods (ADR-404)', status: 'fail', message: failures.map((f) => `${f.name}: ${f.message}`).join('; '), fix: failures[0]!.fix ?? 'ruflo mods doctor' };
  }
  const warnings = findings.filter((f) => f.status !== 'pass');
  return warnings.length === 0
    ? { name: 'ruflo mods (ADR-404)', status: 'pass', message: findings.find((f) => f.name === 'last mod start')?.message ?? 'enabled' }
    : { name: 'ruflo mods (ADR-404)', status: 'warn', message: warnings.map((f) => `${f.name}: ${f.message}`).join('; '), fix: 'ruflo mods doctor' };
}

// ADR-510: do ruflo mods run under `claude -p --plugin-dir` here? Spawns a
// real (cheap) model call, so `--component headless-plugins` only.
export async function checkHeadlessPlugins(): Promise<HealthCheck> {
  const { checkHeadlessPlugins: run } = await import('../../mods/headless-check.js');
  return run();
}

// #4581 / ADR-502: ruflo-mods learning loop — is it recording, and do its verified outcomes reach SONA? Warn-only.
export async function checkLearningLoop(): Promise<HealthCheck> {
  const { learningLoopHealth } = await import('../../memory/verified-outcomes.js');
  return { name: 'Learning loop (#4581)', ...learningLoopHealth(process.cwd()) };
}

// ADR-505: ruflo-mods compaction snapshots hold conversation text; warn when they exist and git does not ignore them.
export async function checkCompactSnapshots(): Promise<HealthCheck> {
  const { compactSnapshotHealth } = await import('../../mods/compact-snapshots.js');
  return { name: 'Compaction snapshots (ADR-505)', ...compactSnapshotHealth(process.cwd()) };
}

// Opt-in @ruvector/typesafe task router (optional peer). `--component typesafe` only.
export async function checkTypesafeRouter(): Promise<HealthCheck> {
  const name = '@ruvector/typesafe router';
  const { readTypesafeConfig } = await import('../../ruvector/typesafe-router.js');
  const cfg = readTypesafeConfig();
  const gate = cfg.enabled ? `enabled (${cfg.embedder === 'hash' ? 'hash embedder, uncalibrated' : 'onnx embedder'})` : 'disabled (set CLAUDE_FLOW_ROUTER_TYPESAFE=1)';
  try {
    const { createRequire } = await import('module');
    const pj = createRequire(import.meta.url)('@ruvector/typesafe/package.json') as { version?: string };
    return { name, status: 'pass', message: `v${pj.version ?? '?'} installed; ${gate}` };
  } catch {
    return {
      name,
      status: cfg.enabled ? 'warn' : 'pass',
      message: `Not installed; ${gate} — hooks_route uses the built-in router`,
      ...(cfg.enabled ? { fix: 'npm install @ruvector/typesafe  # optional peer' } : {}),
    };
  }
}

// Check agentic-flow v3 integration (filesystem-based to avoid slow WASM/DB init)
export async function checkAgenticFlow(): Promise<HealthCheck> {
  try {
    // Walk common node_modules paths to find agentic-flow/package.json
    const candidates = [
      join(process.cwd(), 'node_modules', 'agentic-flow', 'package.json'),
      join(process.cwd(), '..', 'node_modules', 'agentic-flow', 'package.json'),
    ];
    let pkgJsonPath: string | null = null;
    for (const p of candidates) {
      if (existsSync(p)) { pkgJsonPath = p; break; }
    }
    if (!pkgJsonPath) {
      return {
        name: 'agentic-flow',
        status: 'warn',
        message: 'Not installed (optional — embeddings/routing will use fallbacks)',
        fix: 'npm install agentic-flow@latest'
      };
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const version = pkg.version || 'unknown';
    const exports = pkg.exports || {};
    const features = [
      exports['./reasoningbank'] ? 'ReasoningBank' : null,
      exports['./router'] ? 'Router' : null,
      exports['./transport/quic'] ? 'QUIC' : null,
    ].filter(Boolean);
    return {
      name: 'agentic-flow',
      status: 'pass',
      message: `v${version} (${features.join(', ')})`
    };
  } catch {
    return { name: 'agentic-flow', status: 'warn', message: 'Check failed' };
  }
}

// Check encryption-at-rest status (ADR-096 Phase 5)
//
// Reports four facets without disclosing the key itself:
//   1. Gate status — is CLAUDE_FLOW_ENCRYPT_AT_REST set?
//   2. Key resolution — does CLAUDE_FLOW_ENCRYPTION_KEY resolve to a valid
//      32-byte key (env-var path only; keychain/passphrase are deferred)?
//   3. Key fingerprint — first 16 hex chars of sha256(key) so users can
//      sanity-check across machines without ever logging the key bytes.
//   4. High-tier store presence — for sessions/, terminals/, .swarm/memory.db
//      report whether on-disk bytes carry the RFE1 magic (encrypted) or not.
export async function checkEncryptionAtRest(): Promise<HealthCheck> {
  if (!isEncryptionEnabled()) {
    return {
      name: 'Encryption at Rest',
      status: 'warn',
      message: 'Off — session/terminal/memory stores are plaintext (mode 0600 only)',
      fix: 'export CLAUDE_FLOW_ENCRYPT_AT_REST=1 && export CLAUDE_FLOW_ENCRYPTION_KEY=<64-char-hex>',
    };
  }

  // Gate is on — try to resolve the key. Fail-closed if missing or malformed.
  const rawKey = process.env.CLAUDE_FLOW_ENCRYPTION_KEY;
  if (!rawKey) {
    return {
      name: 'Encryption at Rest',
      status: 'fail',
      message: 'Gate is on but CLAUDE_FLOW_ENCRYPTION_KEY is unset (fail-closed)',
      fix: 'Generate a key: openssl rand -hex 32 → export CLAUDE_FLOW_ENCRYPTION_KEY=<value>',
    };
  }
  let keyFingerprint: string;
  try {
    const key = decodeKey(rawKey);
    keyFingerprint = createHash('sha256').update(key).digest('hex').slice(0, 16);
  } catch (err) {
    return {
      name: 'Encryption at Rest',
      status: 'fail',
      message: `CLAUDE_FLOW_ENCRYPTION_KEY invalid: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Provide a 64-char hex or 44-char base64 key (32 bytes)',
    };
  }

  // Check the three high-tier store paths for RFE1 magic
  const cwd = process.cwd();
  const stores: Array<{ label: string; path: string }> = [
    { label: 'sessions/', path: join(cwd, '.claude-flow', 'sessions') },
    { label: 'terminals', path: join(cwd, '.claude-flow', 'terminals', 'store.json') },
    { label: 'memory.db', path: join(cwd, '.swarm', 'memory.db') },
  ];
  const status: string[] = [];
  for (const s of stores) {
    if (!existsSync(s.path)) {
      status.push(`${s.label}=∅`);
      continue;
    }
    try {
      const stat = statSync(s.path);
      if (stat.isDirectory()) {
        // Sessions: probe the first .json file
        const { readdirSync } = await import('fs');
        const files = readdirSync(s.path).filter(f => f.endsWith('.json'));
        if (files.length === 0) { status.push(`${s.label}=∅`); continue; }
        const first = readFileSync(join(s.path, files[0]));
        status.push(`${s.label}=${isEncryptedBlob(first) ? 'enc' : 'plain'}`);
      } else {
        const buf = readFileSync(s.path);
        status.push(`${s.label}=${isEncryptedBlob(buf) ? 'enc' : 'plain'}`);
      }
    } catch {
      status.push(`${s.label}=err`);
    }
  }

  return {
    name: 'Encryption at Rest',
    status: 'pass',
    message: `On — key fp:${keyFingerprint}… (${status.join(' ')})`,
  };
}
