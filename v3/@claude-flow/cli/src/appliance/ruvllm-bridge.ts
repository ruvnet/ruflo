/**
 * ruvLLM Bridge -- Local Language Model Inference from RuVector
 *
 * Extends @ruvector/core with on-device GGUF model inference.
 * Provides 3-tier routing:
 *   Tier 1: Agent Booster (WASM, <1ms) -- simple transforms
 *   Tier 2: Local model via ruvLLM (~200ms) -- routing, classification
 *   Tier 3: Cloud API (2-5s) -- complex reasoning
 *
 * All @ruvector/* packages are optional peer dependencies.
 * The bridge degrades gracefully when they are absent.
 *
 * @module @claude-flow/cli/appliance/ruvllm-bridge
 */

import { readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { GgufEngine as GgufEngineType } from './gguf-engine.js';

// ── Configuration ───────────────────────────────────────────

export interface RuvllmConfig {
  modelsDir: string;         // Path to GGUF model files
  defaultModel?: string;     // Default model name
  maxTokens?: number;        // Default max tokens
  temperature?: number;      // Default temperature
  contextSize?: number;      // KV-cache context size (default 4096)
  kvCachePath?: string;      // Path to persist KV-cache as RVF
  verbose?: boolean;
}

const DEFAULT_CONFIG: Required<RuvllmConfig> = {
  modelsDir: './models', defaultModel: '', maxTokens: 512,
  temperature: 0.7, contextSize: 4096, kvCachePath: '', verbose: false,
};

// ── Request / Response ──────────────────────────────────────

export interface GenerateRequest {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  stopSequences?: string[];
}

export interface GenerateResponse {
  text: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  tier: 1 | 2 | 3;
  cached: boolean;
}

export interface ModelInfo {
  name: string;
  path: string;
  format: string;       // 'gguf'
  quantization: string;  // 'q4_k_m', 'q8_0', etc.
  size: number;          // bytes
  parameters: string;    // '3B', '7B', etc.
  loaded: boolean;
}

export interface TierRouting {
  tier: 1 | 2 | 3;
  model: string;
  confidence: number;
}

export interface BridgeStatus {
  available: boolean;
  ruvectorCore: boolean;
  ruvectorRouter: boolean;
  ruvectorSona: boolean;
  modelsLoaded: string[];
  kvCacheSize: number;
}

// ── Quantization / parameter heuristics ─────────────────────

const QUANT_PATTERNS: Array<[RegExp, string]> = [
  [/q4_k_m/i, 'q4_k_m'], [/q4_k_s/i, 'q4_k_s'], [/q4_0/i, 'q4_0'],
  [/q5_k_m/i, 'q5_k_m'], [/q5_0/i, 'q5_0'], [/q8_0/i, 'q8_0'],
  [/f16/i, 'f16'], [/f32/i, 'f32'],
];

function inferQuantization(filename: string): string {
  for (const [re, label] of QUANT_PATTERNS) if (re.test(filename)) return label;
  return 'unknown';
}

function inferParameters(filename: string): string {
  const m = filename.match(/(\d+)[._-]?b/i);
  return m ? m[0].toUpperCase().replace(/[._-]/g, '') : 'unknown';
}

// ── Complexity heuristic ────────────────────────────────────

const HIGH = new Set([
  'architect', 'design', 'refactor', 'security', 'audit', 'complex',
  'analyze', 'distributed', 'concurrent', 'algorithm', 'investigate',
  'optimize', 'debug', 'system', 'integration',
]);
const LOW = new Set([
  'rename', 'typo', 'format', 'comment', 'version', 'bump',
  'move', 'copy', 'delete', 'simple', 'config',
]);

function estimateComplexity(desc: string): number {
  const words = desc.toLowerCase().split(/\s+/);
  let score = 0.3;
  for (const w of words) {
    if (HIGH.has(w)) score += 0.15;
    if (LOW.has(w)) score -= 0.1;
  }
  return Math.max(0, Math.min(1, score + Math.min(0.2, words.length / 200)));
}

// ── Bridge ──────────────────────────────────────────────────

export class RuvllmBridge {
  private config: Required<RuvllmConfig>;
  private models: Map<string, ModelInfo> = new Map();
  private activeModel: string | null = null;
  private kvCacheEntries = 0;
  private ruvectorCore: any = null;
  private ruvectorRouter: any = null;
  private ruvectorSona: any = null;
  private ggufEngine: GgufEngineType | null = null;

  constructor(config: RuvllmConfig) {
    if (!config.modelsDir) throw new Error('RuvllmConfig.modelsDir is required');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Probe optional @ruvector packages, initialize GGUF engine, and scan modelsDir. */
  async initialize(): Promise<void> {
    this.ruvectorCore = await this.tryImport('@ruvector/core');
    this.ruvectorRouter = await this.tryImport('@ruvector/router');
    this.ruvectorSona = await this.tryImport('@ruvector/sona');

    // Initialize GGUF engine for local model inference
    try {
      const { GgufEngine } = await import('./gguf-engine.js');
      this.ggufEngine = new GgufEngine({
        contextSize: this.config.contextSize,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        kvCachePath: this.config.kvCachePath,
        verbose: this.config.verbose,
      });
      await this.ggufEngine.initialize();
    } catch {
      // GGUF engine is optional
    }

    await this.scanModelsDir();

    if (this.config.verbose) {
      const pkgs = [
        this.ruvectorCore && '@ruvector/core',
        this.ruvectorRouter && '@ruvector/router',
        this.ruvectorSona && '@ruvector/sona',
        this.ggufEngine && 'gguf-engine',
      ].filter(Boolean);
      if (pkgs.length) console.log(`[ruvLLM] Loaded: ${pkgs.join(', ')}`);
      console.log(`[ruvLLM] ${this.models.size} model(s) in ${this.config.modelsDir}`);
    }
  }

  /** Return all discovered GGUF models. */
  async listModels(): Promise<ModelInfo[]> {
    return Array.from(this.models.values());
  }

  /** Load a model into memory (delegates to GGUF engine or @ruvector/core). */
  async loadModel(name: string): Promise<void> {
    const info = this.models.get(name);
    if (!info) throw new Error(`Model "${name}" not found. Available: ${[...this.models.keys()].join(', ')}`);

    // Prefer GGUF engine (parses header, loads via node-llama-cpp if available)
    if (this.ggufEngine) {
      const meta = await this.ggufEngine.loadModel(info.path);
      if (meta.architecture) info.parameters = meta.architecture;
      if (meta.quantization) info.quantization = meta.quantization;
    } else if (this.ruvectorCore?.loadModel) {
      await this.ruvectorCore.loadModel(info.path, { contextSize: this.config.contextSize });
    }
    info.loaded = true;
    this.activeModel = name;
  }

  /**
   * Generate text from a prompt. Routes through tiers:
   * 1. Agent Booster (trivial transforms, no LLM).
   * 2. Local GGUF model via @ruvector/core.
   * 3. Cloud fallback (empty response -- caller handles upstream).
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const start = performance.now();
    const modelName = request.model ?? this.config.defaultModel ?? this.activeModel ?? '';

    // Tier 1: deterministic codemod hint (ADR-143). The prompt carries no code,
    // so nothing can be applied here; this points the caller at hooks_codemod.
    const booster = this.tryCodemodHint(request.prompt);
    if (booster !== null) {
      return { text: booster, model: 'codemod', tokensUsed: 0, latencyMs: performance.now() - start, tier: 1, cached: false };
    }

    // Tier 2: Local model (GGUF engine preferred, then @ruvector/core)
    const info = this.models.get(modelName);
    if (info?.loaded) {
      try {
        if (this.ggufEngine) {
          const r = await this.ggufEngine.generate({
            prompt: request.prompt,
            maxTokens: request.maxTokens ?? this.config.maxTokens,
            temperature: request.temperature ?? this.config.temperature,
            stopSequences: request.stopSequences,
          });
          return { text: r.text, model: modelName, tokensUsed: r.tokensUsed, latencyMs: performance.now() - start, tier: 2, cached: false };
        } else if (this.ruvectorCore?.generate) {
          const r = await this.ruvectorCore.generate({
            model: info.path, prompt: request.prompt,
            maxTokens: request.maxTokens ?? this.config.maxTokens,
            temperature: request.temperature ?? this.config.temperature,
            stopSequences: request.stopSequences,
          });
          return { text: r.text ?? '', model: modelName, tokensUsed: r.tokensUsed ?? 0, latencyMs: performance.now() - start, tier: 2, cached: false };
        }
      } catch (err) {
        if (this.config.verbose) console.warn('[ruvLLM] Local generation failed, tier 3 fallback:', err);
      }
    }

    // Tier 3: Cloud fallback
    return { text: '', model: 'cloud-fallback', tokensUsed: 0, latencyMs: performance.now() - start, tier: 3, cached: false };
  }

  /** Route a task description to the optimal tier. Uses @ruvector/router when available. */
  async routeTask(description: string): Promise<TierRouting> {
    if (this.ruvectorRouter?.route) {
      try {
        const r = await this.ruvectorRouter.route(description);
        return { tier: r.tier ?? 3, model: r.model ?? 'cloud', confidence: r.confidence ?? 0.5 };
      } catch { /* fall through */ }
    }

    const complexity = estimateComplexity(description);
    const words = description.split(/\s+/).length;

    if (words < 15 && complexity < 0.25) return { tier: 1, model: 'codemod', confidence: 0.9 };
    if (complexity < 0.55 && this.activeModel) return { tier: 2, model: this.activeModel, confidence: 0.7 };
    return { tier: 3, model: 'cloud', confidence: 0.6 };
  }

  /** Return current bridge status. */
  async getStatus(): Promise<BridgeStatus> {
    return {
      available: this.models.size > 0 || this.ruvectorCore !== null,
      ruvectorCore: this.ruvectorCore !== null,
      ruvectorRouter: this.ruvectorRouter !== null,
      ruvectorSona: this.ruvectorSona !== null,
      modelsLoaded: [...this.models.values()].filter((m) => m.loaded).map((m) => m.name),
      kvCacheSize: this.kvCacheEntries,
    };
  }

  /** Persist KV-cache, unload models, and clean up. */
  async shutdown(): Promise<void> {
    if (this.ggufEngine) {
      await this.ggufEngine.shutdown();
      this.ggufEngine = null;
    }
    if (this.config.kvCachePath && this.ruvectorCore?.persistKvCache) {
      try { await this.ruvectorCore.persistKvCache(this.config.kvCachePath); }
      catch (e) { if (this.config.verbose) console.warn('[ruvLLM] KV-cache persist failed:', e); }
    }
    if (this.ruvectorCore?.unloadAll) await this.ruvectorCore.unloadAll();
    for (const info of this.models.values()) info.loaded = false;
    this.activeModel = null;
    this.kvCacheEntries = 0;
  }

  // ── Private ───────────────────────────────────────────────

  private async scanModelsDir(): Promise<void> {
    try {
      const entries = await readdir(this.config.modelsDir);
      for (const entry of entries) {
        if (extname(entry).toLowerCase() !== '.gguf') continue;
        const fullPath = join(this.config.modelsDir, entry);
        const s = await stat(fullPath);
        if (!s.isFile()) continue;
        const name = basename(entry, '.gguf');
        this.models.set(name, {
          name, path: fullPath, format: 'gguf',
          quantization: inferQuantization(entry), size: s.size,
          parameters: inferParameters(entry), loaded: false,
        });
      }
    } catch {
      // modelsDir may not exist -- tier 1 and tier 3 still work
    }
  }

  private async tryImport(pkg: string): Promise<any> {
    try { return await import(pkg); } catch { return null; }
  }

  /**
   * Tier-1 codemod hint for trivial transforms, no LLM. Not agent-booster:
   * that engine merges a code snippet into code (hooks_fast-apply) and cannot
   * act on an instruction alone.
   */
  private tryCodemodHint(prompt: string): string | null {
    const t = prompt.trim();
    if (t.length > 200) return null;
    if (/^(convert|change)\s+(var|let)\s+to\s+const$/i.test(t)) {
      return 'Call hooks_codemod with intent="var-to-const" (deterministic, $0), or use the Edit tool.';
    }
    if (/^remove\s+console\.(log|warn|error|debug|info)$/i.test(t)) {
      const m = t.toLowerCase().match(/console\.(\w+)/)?.[1] ?? 'log';
      return `Call hooks_codemod with intent="remove-console" (deterministic, $0), or use the Edit tool to remove all \`console.${m}\` calls.`;
    }
    return null;
  }
}

// ── Singleton accessor ──────────────────────────────────────

let instance: RuvllmBridge | null = null;

/** Get or create the singleton RuvllmBridge. Config required on first call. */
export function getRuvllmBridge(config?: RuvllmConfig): RuvllmBridge {
  if (!instance && config) instance = new RuvllmBridge(config);
  if (!instance) throw new Error('ruvLLM bridge not initialized. Call with config first.');
  return instance;
}

/** Reset the singleton (useful for tests). */
export function resetRuvllmBridge(): void { instance = null; }

/** Check whether @ruvector/core is importable without loading the bridge. */
export async function isRuvllmAvailable(): Promise<boolean> {
  try { await import('@ruvector/core'); return true; } catch { return false; }
}
