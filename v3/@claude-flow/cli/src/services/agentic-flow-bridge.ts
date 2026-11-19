/**
 * agentic-flow v3 integration bridge
 *
 * Provides a single lazy-loading entry point for all agentic-flow v3
 * subpath exports. Every accessor returns `null` when agentic-flow is
 * not installed — callers never throw on missing optional dependency.
 *
 * @module agentic-flow-bridge
 */

// ---------------------------------------------------------------------------
// Cached module handles (Promise-based to prevent TOCTOU races)
// ---------------------------------------------------------------------------

let _reasoningBankP: Promise<typeof import('agentic-flow/reasoningbank') | null> | null = null;
let _routerP: Promise<typeof import('agentic-flow/router') | null> | null = null;
let _orchestrationP: Promise<typeof import('agentic-flow/orchestration') | null> | null = null;

// ---------------------------------------------------------------------------
// Public loaders
// ---------------------------------------------------------------------------

/**
 * Load the ReasoningBank module (4-step learning pipeline).
 * Returns null if agentic-flow is not installed.
 * Race-safe: concurrent callers share the same import Promise.
 */
export function getReasoningBank() {
  if (_reasoningBankP === null) {
    _reasoningBankP = import('agentic-flow/reasoningbank').catch(() => null);
  }
  return _reasoningBankP;
}

/**
 * Load the ModelRouter module (multi-provider LLM routing).
 * Returns null if agentic-flow is not installed.
 */
export function getRouter() {
  if (_routerP === null) {
    _routerP = import('agentic-flow/router').catch(() => null);
  }
  return _routerP;
}

/**
 * Load the Orchestration module (workflow engine).
 * Returns null if agentic-flow is not installed.
 */
export function getOrchestration() {
  if (_orchestrationP === null) {
    _orchestrationP = import('agentic-flow/orchestration').catch(() => null);
  }
  return _orchestrationP;
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Compute an embedding vector via ReasoningBank, falling back to null.
 */
export async function computeEmbedding(text: string): Promise<Float32Array | null> {
  const rb = await getReasoningBank();
  if (!rb?.computeEmbedding) return null;
  return rb.computeEmbedding(text);
}

/**
 * Retrieve memories matching a query via ReasoningBank.
 */
export async function retrieveMemories(query: string, opts?: { k?: number }): Promise<any[]> {
  const rb = await getReasoningBank();
  if (!rb?.retrieveMemories) return [];
  return rb.retrieveMemories(query, opts);
}

/**
 * Check whether agentic-flow v3 is available at runtime.
 */
export async function isAvailable(): Promise<boolean> {
  const rb = await getReasoningBank();
  return rb !== null;
}

/**
 * Return a summary of available agentic-flow v3 capabilities.
 */
export async function capabilities(): Promise<{
  available: boolean;
  reasoningBank: boolean;
  router: boolean;
  orchestration: boolean;
  version: string | null;
}> {
  const [rb, router, orch] = await Promise.all([
    getReasoningBank(),
    getRouter(),
    getOrchestration(),
  ]);
  return {
    available: rb !== null || router !== null || orch !== null,
    reasoningBank: rb !== null,
    router: router !== null,
    orchestration: orch !== null,
    version: (rb as any)?.VERSION ?? null,
  };
}
