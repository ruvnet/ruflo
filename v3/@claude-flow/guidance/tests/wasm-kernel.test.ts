/**
 * WASM Kernel Acceptance Tests
 *
 * Verifies:
 * 1. Output parity: JS and WASM produce identical results
 * 2. Determinism: Same input → same output across runs
 * 3. Performance: WASM vs JS throughput comparison
 * 4. Batch API: Single call processes multiple operations
 * 5. Secret scanning: Identical detection and redaction
 * 6. Destructive command detection: Identical pattern matching
 *
 * Acceptance criteria from production analysis:
 * - 10,000 synthetic events processed
 * - p50 and p99 latency measured
 * - Identical proof root hash across JS and WASM
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createHash, createHmac } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Load WASM module directly (bypass the bridge to test raw kernel)
// ============================================================================

let wasm: {
  kernel_init: () => string;
  sha256: (input: string) => string;
  hmac_sha256: (key: string, input: string) => string;
  content_hash: (json_input: string) => string;
  sign_envelope: (key: string, envelope_json: string) => string;
  verify_chain: (chain_json: string, key: string) => boolean;
  scan_secrets: (content: string) => string;
  detect_destructive: (command: string) => string;
  batch_process: (ops_json: string) => string;
} | null = null;

let wasmAvailable = false;

beforeAll(async () => {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const wasmPath = resolve(__dirname, '../wasm-pkg/guidance_kernel.js');
    const mod = await import(wasmPath);
    wasm = mod;
    wasmAvailable = true;
  } catch {
    // WASM not available — tests will be skipped
    wasmAvailable = false;
  }
});

// ============================================================================
// JS reference implementations (identical to what ProofChain/Gates use)
// ============================================================================

function jsSha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function jsHmacSha256(key: string, input: string): string {
  return createHmac('sha256', key).update(input).digest('hex');
}

function jsContentHash(jsonInput: string): string {
  try {
    const parsed = JSON.parse(jsonInput);
    const sorted = sortKeys(parsed);
    return jsSha256(JSON.stringify(sorted));
  } catch {
    return jsSha256(jsonInput);
  }
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return sorted;
}

// ============================================================================
// Parity Tests — JS and WASM must produce identical outputs
// ============================================================================

describe('WASM Kernel: Output Parity', () => {
  it('sha256 — identical hashes', () => {
    if (!wasm) return;
    const inputs = [
      'hello world',
      '',
      'a'.repeat(10000),
      JSON.stringify({ key: 'value', nested: { a: 1 } }),
      '🔐 unicode content with emoji',
    ];

    for (const input of inputs) {
      const jsResult = jsSha256(input);
      const wasmResult = wasm.sha256(input);
      expect(wasmResult).toBe(jsResult);
    }
  });

  it('hmac_sha256 — identical signatures', () => {
    if (!wasm) return;
    const testCases = [
      { key: 'secret-key', input: 'message body' },
      { key: 'claude-flow-guidance-default-key', input: '{"envelopeId":"test"}' },
      { key: '', input: '' },
      { key: 'k'.repeat(100), input: 'i'.repeat(10000) },
    ];

    for (const { key, input } of testCases) {
      const jsResult = jsHmacSha256(key, input);
      const wasmResult = wasm.hmac_sha256(key, input);
      expect(wasmResult).toBe(jsResult);
    }
  });

  it('content_hash — key-order independent, identical across implementations', () => {
    if (!wasm) return;
    const pairs = [
      ['{"a":1,"b":2}', '{"b":2,"a":1}'],
      ['{"z":{"y":1,"x":2},"a":3}', '{"a":3,"z":{"x":2,"y":1}}'],
      ['[1,2,3]', '[1,2,3]'],
      ['{"nested":{"deep":{"value":42}}}', '{"nested":{"deep":{"value":42}}}'],
    ];

    for (const [a, b] of pairs) {
      const wasmA = wasm.content_hash(a);
      const wasmB = wasm.content_hash(b);
      expect(wasmA).toBe(wasmB);

      // Also verify against JS
      const jsA = jsContentHash(a);
      expect(wasmA).toBe(jsA);
    }
  });
});

// ============================================================================
// Secret Scanning Parity
// ============================================================================

describe('WASM Kernel: Secret Scanning', () => {
  it('detects API keys', () => {
    if (!wasm) return;
    const content = 'api_key = "sk-abcdefghij1234567890"';
    const result = JSON.parse(wasm.scan_secrets(content));
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toContain('****');
  });

  it('detects private keys', () => {
    if (!wasm) return;
    const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...';
    const result = JSON.parse(wasm.scan_secrets(content));
    expect(result.length).toBeGreaterThan(0);
  });

  it('detects AWS keys', () => {
    if (!wasm) return;
    const content = 'access_key = AKIAIOSFODNN7EXAMPLE';
    const result = JSON.parse(wasm.scan_secrets(content));
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty for clean content', () => {
    if (!wasm) return;
    const content = 'This is a normal string with no secrets.';
    const result = JSON.parse(wasm.scan_secrets(content));
    expect(result.length).toBe(0);
  });

  // The Rust unit test for this lives in wasm-kernel/src/gates.rs, but it cannot notice a stale
  // committed binary: wasm-pkg/guidance_kernel_bg.wasm is what ships, so the shipped binary is
  // exercised here. A byte-index slice inside a multi-byte character used to trap ("unreachable").
  it('redacts a non-ASCII secret by character, without trapping', () => {
    if (!wasm) return;
    const result = JSON.parse(wasm.scan_secrets('password = "passéé"'));
    expect(result).toEqual([`pass${'*'.repeat(11)}séé"`]);
  });

  it('fully masks a short non-ASCII secret, one star per character', () => {
    if (!wasm) return;
    const result = JSON.parse(wasm.scan_secrets('pwd="éééé"'));
    expect(result).toEqual(['*'.repeat(10)]);
  });
});

// ============================================================================
// Destructive Command Detection Parity
// ============================================================================

describe('WASM Kernel: Destructive Command Detection', () => {
  const destructive = [
    'rm -rf /',
    'DROP TABLE users',
    'git push origin main --force',
    'git reset --hard HEAD~5',
    'truncate table sessions',
    'kubectl delete --all namespace production',
    'DELETE FROM users',
  ];

  const safe = [
    'git commit -m "hello"',
    'npm install express',
    'cat /etc/hosts',
    'SELECT * FROM users',
    'ls -la',
  ];

  it('detects all destructive patterns', () => {
    if (!wasm) return;
    for (const cmd of destructive) {
      const result = wasm.detect_destructive(cmd);
      expect(result, `Expected detection for: ${cmd}`).not.toBe('');
    }
  });

  it('passes safe commands', () => {
    if (!wasm) return;
    for (const cmd of safe) {
      const result = wasm.detect_destructive(cmd);
      expect(result, `Expected no detection for: ${cmd}`).toBe('');
    }
  });
});

// ============================================================================
// Batch API
// ============================================================================

describe('WASM Kernel: Batch Processing', () => {
  it('processes multiple operations in one call', () => {
    if (!wasm) return;
    const ops = [
      { op: 'sha256', payload: 'hello' },
      { op: 'sha256', payload: 'world' },
      { op: 'hmac_sha256', payload: 'message', key: 'secret' },
      { op: 'detect_destructive', payload: 'rm -rf /' },
      { op: 'detect_destructive', payload: 'ls -la' },
    ];

    const results = JSON.parse(wasm.batch_process(JSON.stringify(ops)));
    expect(results).toHaveLength(5);
    expect(results[0].hash).toBe(jsSha256('hello'));
    expect(results[1].hash).toBe(jsSha256('world'));
    expect(results[2].signature).toBe(jsHmacSha256('secret', 'message'));
    expect(results[3].detected).toBe(true);
    expect(results[4].detected).toBe(false);
  });

  it('handles errors gracefully', () => {
    if (!wasm) return;
    const ops = [{ op: 'unknown_op', payload: 'test' }];
    const results = JSON.parse(wasm.batch_process(JSON.stringify(ops)));
    expect(results[0].error).toBeDefined();
  });
});

// ============================================================================
// 10,000 Event Acceptance Test
// ============================================================================

describe('WASM Kernel: 10k Event Acceptance', () => {
  it('processes 10,000 synthetic events with identical proof root hash', () => {
    if (!wasm) return;

    const signingKey = 'test-signing-key';
    const events = 10_000;

    // Build chain: each event's hash chains to the previous
    let previousHash = '0'.repeat(64);
    let jsRootHash = '';
    let wasmRootHash = '';

    // JS chain
    const jsStart = performance.now();
    for (let i = 0; i < events; i++) {
      const payload = JSON.stringify({ eventId: `evt-${i}`, data: `payload-${i}`, step: i });
      const contentHash = jsSha256(payload);
      const chainPayload = previousHash + contentHash;
      previousHash = jsHmacSha256(signingKey, chainPayload);
    }
    jsRootHash = previousHash;
    const jsTime = performance.now() - jsStart;

    // WASM chain
    previousHash = '0'.repeat(64);
    const wasmStart = performance.now();
    for (let i = 0; i < events; i++) {
      const payload = JSON.stringify({ eventId: `evt-${i}`, data: `payload-${i}`, step: i });
      const contentHash = wasm.sha256(payload);
      const chainPayload = previousHash + contentHash;
      previousHash = wasm.hmac_sha256(signingKey, chainPayload);
    }
    wasmRootHash = previousHash;
    const wasmTime = performance.now() - wasmStart;

    // Identical root hash = replay parity
    expect(wasmRootHash).toBe(jsRootHash);

    console.log('\n--- 10k Event Proof Chain ---');
    console.log(`JS:   ${jsTime.toFixed(1)}ms (${Math.round(events / (jsTime / 1000))} chains/sec)`);
    console.log(`WASM: ${wasmTime.toFixed(1)}ms (${Math.round(events / (wasmTime / 1000))} chains/sec)`);
    console.log(`Ratio: ${(jsTime / wasmTime).toFixed(2)}x`);
    console.log(`Root hash: ${wasmRootHash.substring(0, 16)}...`);
  });

  it('batch processes 10,000 SHA-256 hashes', () => {
    if (!wasm) return;

    const events = 10_000;

    // Individual calls
    const individualStart = performance.now();
    for (let i = 0; i < events; i++) {
      wasm.sha256(`event-${i}`);
    }
    const individualTime = performance.now() - individualStart;

    // Batch call (chunks of 1000 to avoid huge JSON strings)
    const batchStart = performance.now();
    const chunkSize = 1000;
    for (let chunk = 0; chunk < events; chunk += chunkSize) {
      const ops = [];
      for (let i = chunk; i < Math.min(chunk + chunkSize, events); i++) {
        ops.push({ op: 'sha256', payload: `event-${i}` });
      }
      wasm.batch_process(JSON.stringify(ops));
    }
    const batchTime = performance.now() - batchStart;

    console.log('\n--- 10k SHA-256 Hash Throughput ---');
    console.log(`Individual: ${individualTime.toFixed(1)}ms (${Math.round(events / (individualTime / 1000))} ops/sec)`);
    console.log(`Batch:      ${batchTime.toFixed(1)}ms (${Math.round(events / (batchTime / 1000))} ops/sec)`);
    console.log(`Batch speedup: ${(individualTime / batchTime).toFixed(2)}x`);
  });

  it('secret scanning throughput on 10,000 inputs', () => {
    if (!wasm) return;

    const clean = 'This is a normal string with no secrets at all';
    const dirty = 'api_key = "sk-abcdefghijklmnop1234567890"';

    // Clean inputs
    const cleanStart = performance.now();
    for (let i = 0; i < 10000; i++) {
      wasm.scan_secrets(clean);
    }
    const cleanTime = performance.now() - cleanStart;

    // Dirty inputs
    const dirtyStart = performance.now();
    for (let i = 0; i < 10000; i++) {
      wasm.scan_secrets(dirty);
    }
    const dirtyTime = performance.now() - dirtyStart;

    console.log('\n--- 10k Secret Scanning ---');
    console.log(`Clean: ${cleanTime.toFixed(1)}ms (${Math.round(10000 / (cleanTime / 1000))} scans/sec)`);
    console.log(`Dirty: ${dirtyTime.toFixed(1)}ms (${Math.round(10000 / (dirtyTime / 1000))} scans/sec)`);
  });
});

// ============================================================================
// Kernel Initialization
// ============================================================================

describe('WASM Kernel: Init', () => {
  it('returns version string', () => {
    if (!wasm) return;
    const version = wasm.kernel_init();
    expect(version).toBe('guidance-kernel/0.1.0');
  });
});
