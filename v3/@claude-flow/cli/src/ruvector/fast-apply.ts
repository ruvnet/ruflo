/**
 * Fast-apply: merge an edit snippet into existing code with agent-booster.
 *
 * agent-booster is a Morph/Cursor-style *applier*: `apply({ code, edit })`
 * expects `edit` to be the target code (e.g. the rewritten function), and it
 * locates and splices it into `code` in a few milliseconds with no LLM call.
 * It cannot turn a natural-language instruction into an edit — given one it
 * returns `success: false, strategy: "failed"` (see ADR-143). So this is the
 * path for callers that already hold a snippet (an agent's proposed rewrite),
 * not a Tier-1 intent engine; deterministic intents stay in hooks_codemod.
 */

export interface FastApplyRequest {
  code: string;
  edit: string;
  language?: string;
  /** Results below this confidence are reported as not applied. Default 0.5. */
  minConfidence?: number;
}

export interface FastApplyResult {
  success: boolean;
  output: string;
  confidence: number;
  strategy: string;
  latencyMs: number;
  backend: 'agent-booster' | 'unavailable';
  reason?: string;
}

interface BoosterLike {
  apply(req: { code: string; edit: string; language?: string }): Promise<{
    output: string; success: boolean; confidence: number; strategy: string;
  }>;
}

let boosterPromise: Promise<BoosterLike | null> | null = null;

/** Lazily construct one AgentBooster. Resolves null when it is not installed. */
export function loadAgentBooster(): Promise<BoosterLike | null> {
  if (!boosterPromise) {
    boosterPromise = (async () => {
      try {
        const specifier: string = 'agent-booster';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional dep
        const mod: any = await import(specifier);
        const Ctor = mod?.AgentBooster ?? mod?.default?.AgentBooster ?? mod?.default;
        if (typeof Ctor !== 'function') return null;
        // Our own threshold is applied below; let the engine report everything.
        return new Ctor({ confidenceThreshold: 0 }) as BoosterLike;
      } catch {
        return null;
      }
    })();
  }
  return boosterPromise;
}

/** Test hook: forget the memoised AgentBooster. */
export function resetAgentBoosterLoader(): void {
  boosterPromise = null;
}

export async function fastApply(req: FastApplyRequest): Promise<FastApplyResult> {
  const start = performance.now();
  const minConfidence = req.minConfidence ?? 0.5;
  const booster = await loadAgentBooster();
  if (!booster) {
    return {
      success: false, output: req.code, confidence: 0, strategy: 'none',
      latencyMs: performance.now() - start, backend: 'unavailable',
      reason: 'agent-booster is not installed (npm i agent-booster); apply the edit with the Edit tool instead',
    };
  }
  try {
    const r = await booster.apply({ code: req.code, edit: req.edit, language: req.language });
    const applied = r.success && r.confidence >= minConfidence && r.output !== req.code;
    return {
      success: applied,
      output: applied ? r.output : req.code,
      confidence: r.confidence,
      strategy: r.strategy,
      latencyMs: performance.now() - start,
      backend: 'agent-booster',
      reason: applied ? undefined
        : !r.success ? 'agent-booster could not place the snippet (it must be code, not an instruction)'
        : r.output === req.code ? 'snippet is already present; nothing to change'
        : `confidence ${r.confidence.toFixed(2)} below minConfidence ${minConfidence}`,
    };
  } catch (err) {
    return {
      success: false, output: req.code, confidence: 0, strategy: 'error',
      latencyMs: performance.now() - start, backend: 'agent-booster',
      reason: `agent-booster threw: ${(err as Error).message}`,
    };
  }
}
