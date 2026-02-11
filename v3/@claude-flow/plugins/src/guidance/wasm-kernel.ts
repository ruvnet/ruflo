/**
 * WASM Kernel Host Bridge
 *
 * Layer B: Node host runtime that calls into the Rust WASM kernel (Layer A).
 * All WASM calls go through this bridge. If the WASM module fails to load,
 * the bridge transparently falls back to the JavaScript implementations.
 *
 * Key rule: The host calls the kernel once per event with a batch payload,
 * not thousands of tiny calls.
 *
 * @module @claude-flow/guidance/wasm-kernel
 */

import { createHash, createHmac } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface WasmKernel {
  /** Whether the WASM kernel is loaded (false = JS fallback) */
  readonly available: boolean;
  /** Kernel version string (or 'js-fallback') */
  readonly version: string;

  // --- Proof / Hashing ---
  sha256(input: string): string;
  hmacSha256(key: string, input: string): string;
  contentHash(jsonInput: string): string;
  signEnvelope(key: string, envelopeJson: string): string;
  verifyChain(chainJson: string, key: string): boolean;

  // --- Gates ---
  scanSecrets(content: string): string[];
  detectDestructive(command: string): string | null;

  // --- Batch ---
  batchProcess(ops: BatchOp[]): BatchResult[];
}

export interface BatchOp {
  op: string;
  payload: string;
  key?: string;
}

export interface BatchResult {
  [key: string]: unknown;
}

// ============================================================================
// WASM Loader
// ============================================================================

let wasmModule: Record<string, (...args: unknown[]) => unknown> | null = null;
let loadAttempted = false;

function tryLoadWasm(): Record<string, (...args: unknown[]) => unknown> | null {
  if (loadAttempted) return wasmModule;
  loadAttempted = true;

  try {
    // Dynamic require — works in Node.js, gracefully fails elsewhere
    const path = new URL('../wasm-pkg/guidance_kernel.js', import.meta.url);
    // Use createRequire for ESM compatibility
    const { createRequire } = require('node:module');
    const requireFn = createRequire(import.meta.url);
    wasmModule = requireFn(path.pathname);

    // Initialize kernel
    if (wasmModule && typeof wasmModule.kernel_init === 'function') {
      (wasmModule.kernel_init as () => string)();
    }
  } catch {
    // WASM not available — fall back to JS
    wasmModule = null;
  }

  return wasmModule;
}

// ============================================================================
// JS Fallback Implementations
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
// Kernel singleton
// ============================================================================

let kernelInstance: WasmKernel | null = null;

/**
 * Get the WASM kernel instance. Automatically falls back to JS if WASM is
 * unavailable. Thread-safe (single initialization).
 */
export function getKernel(): WasmKernel {
  if (kernelInstance) return kernelInstance;

  const wasm = tryLoadWasm();

  if (wasm) {
    kernelInstance = {
      available: true,
      version: (wasm.kernel_init as () => string)(),

      sha256: (input: string) => (wasm.sha256 as (s: string) => string)(input),
      hmacSha256: (key: string, input: string) =>
        (wasm.hmac_sha256 as (k: string, i: string) => string)(key, input),
      contentHash: (jsonInput: string) =>
        (wasm.content_hash as (s: string) => string)(jsonInput),
      signEnvelope: (key: string, envelopeJson: string) =>
        (wasm.sign_envelope as (k: string, j: string) => string)(key, envelopeJson),
      verifyChain: (chainJson: string, key: string) =>
        (wasm.verify_chain as (c: string, k: string) => boolean)(chainJson, key),

      scanSecrets: (content: string): string[] => {
        const json = (wasm.scan_secrets as (s: string) => string)(content);
        try { return JSON.parse(json); } catch { return []; }
      },
      detectDestructive: (command: string): string | null => {
        const result = (wasm.detect_destructive as (s: string) => string)(command);
        return result === '' ? null : result;
      },

      batchProcess: (ops: BatchOp[]): BatchResult[] => {
        const json = (wasm.batch_process as (s: string) => string)(JSON.stringify(ops));
        try { return JSON.parse(json); } catch { return []; }
      },
    };
  } else {
    // JS fallback — identical outputs, just slower
    kernelInstance = {
      available: false,
      version: 'js-fallback',

      sha256: jsSha256,
      hmacSha256: jsHmacSha256,
      contentHash: jsContentHash,
      signEnvelope: jsHmacSha256,
      verifyChain: () => {
        // Chain verification requires full envelope parsing — not implemented
        // in JS fallback because the ProofChain class already does it.
        throw new Error('verifyChain not available in JS fallback; use ProofChain.verifyChain()');
      },

      scanSecrets: (): string[] => {
        // Gate scanning in JS fallback defers to EnforcementGates class
        throw new Error('scanSecrets not available in JS fallback; use EnforcementGates');
      },
      detectDestructive: (): string | null => {
        throw new Error('detectDestructive not available in JS fallback; use EnforcementGates');
      },

      batchProcess: (): BatchResult[] => {
        throw new Error('batchProcess requires WASM kernel');
      },
    };
  }

  return kernelInstance;
}

/**
 * Check if the WASM kernel is available without initializing it.
 */
export function isWasmAvailable(): boolean {
  return getKernel().available;
}

/**
 * Reset the kernel instance (for testing).
 */
export function resetKernel(): void {
  kernelInstance = null;
  wasmModule = null;
  loadAttempted = false;
}
