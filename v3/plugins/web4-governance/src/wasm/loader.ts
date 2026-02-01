/**
 * WASM module loader
 *
 * Loads the Rust-compiled WASM module for high-performance
 * policy evaluation and trust calculations.
 */

/** WASM module interface */
export interface GovernanceWasm {
  /** Evaluate policy (returns JSON) */
  evaluate_policy: (
    policyJson: string,
    toolName: string,
    target: string | undefined,
    entityTrustJson: string
  ) => string;

  /** Update trust (returns JSON) */
  update_trust: (
    entityJson: string,
    toolName: string,
    success: boolean,
    weight: number
  ) => string;

  /** Record witness (returns JSON) */
  record_witness: (
    witnessId: string,
    witnessedId: string,
    trustScore: number
  ) => string;

  /** Append to audit chain (returns JSON) */
  append_audit: (chainJson: string, actionJson: string) => string;

  /** Check rate limit (returns JSON) */
  check_rate_limit: (
    stateJson: string,
    key: string,
    maxCount: number,
    windowMs: number
  ) => string;

  /** Compute policy hash */
  compute_policy_hash: (policyJson: string) => string;

  /** Get metrics */
  get_metrics: () => unknown;
}

let wasmInstance: GovernanceWasm | null = null;

/**
 * Load the governance WASM module
 *
 * Uses dynamic import to load the compiled WASM package.
 * Falls back to pure TypeScript implementation if WASM unavailable.
 */
export async function loadGovernanceWasm(): Promise<GovernanceWasm> {
  if (wasmInstance) {
    return wasmInstance;
  }

  try {
    // Try to load the WASM module
    const wasm = await import('../../wasm/governance-wasm/pkg/governance_wasm.js');
    await wasm.default();

    wasmInstance = {
      evaluate_policy: wasm.evaluate_policy,
      update_trust: wasm.update_trust,
      record_witness: wasm.record_witness,
      append_audit: wasm.append_audit,
      check_rate_limit: wasm.check_rate_limit,
      compute_policy_hash: wasm.compute_policy_hash,
      get_metrics: wasm.get_metrics,
    };

    return wasmInstance;
  } catch (error) {
    console.warn(
      'WASM module not available, using pure TypeScript implementation:',
      error
    );

    // Return stub that throws - caller should use TS implementation
    wasmInstance = createStubWasm();
    return wasmInstance;
  }
}

/**
 * Check if WASM is available
 */
export function isWasmAvailable(): boolean {
  return wasmInstance !== null && !isStub(wasmInstance);
}

/**
 * Get the loaded WASM instance (or null if not loaded)
 */
export function getWasmInstance(): GovernanceWasm | null {
  return wasmInstance;
}

function createStubWasm(): GovernanceWasm {
  const notAvailable = () => {
    throw new Error('WASM module not available. Use TypeScript implementation.');
  };

  return {
    evaluate_policy: notAvailable,
    update_trust: notAvailable,
    record_witness: notAvailable,
    append_audit: notAvailable,
    check_rate_limit: notAvailable,
    compute_policy_hash: notAvailable,
    get_metrics: () => ({ wasm_available: false }),
  };
}

function isStub(wasm: GovernanceWasm): boolean {
  const metrics = wasm.get_metrics() as { wasm_available?: boolean };
  return metrics?.wasm_available === false;
}
