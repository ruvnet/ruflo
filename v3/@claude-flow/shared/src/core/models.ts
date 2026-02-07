/**
 * Centralized Claude Model Configuration
 *
 * Single source of truth for all model IDs used across claude-flow packages.
 * Supports environment variable overrides for runtime flexibility.
 *
 * Environment variables:
 *   CLAUDE_FLOW_MODEL_OPUS   - Override the Opus model ID
 *   CLAUDE_FLOW_MODEL_SONNET - Override the Sonnet model ID
 *   CLAUDE_FLOW_MODEL_HAIKU  - Override the Haiku model ID
 */

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

/**
 * Default model IDs — update these when new model versions are released.
 */
export const CLAUDE_MODELS: Record<ModelTier, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

/**
 * Default model used when no tier is specified.
 */
export const DEFAULT_MODEL = CLAUDE_MODELS.opus;

/**
 * Display names for model tiers (for UI/statusline/co-author labels).
 */
export const MODEL_DISPLAY_NAMES: Record<ModelTier, string> = {
  opus: 'Claude Opus',
  sonnet: 'Claude Sonnet',
  haiku: 'Claude Haiku',
};

/**
 * Resolve a model ID for the given tier, checking environment variable
 * overrides first, then falling back to the built-in defaults.
 *
 * @example
 *   getModelId('opus')   // 'claude-opus-4-6' (or CLAUDE_FLOW_MODEL_OPUS if set)
 *   getModelId('haiku')  // 'claude-haiku-4-5-20251001' (or CLAUDE_FLOW_MODEL_HAIKU if set)
 */
export function getModelId(tier: ModelTier): string {
  const envKey = `CLAUDE_FLOW_MODEL_${tier.toUpperCase()}`;
  return process.env[envKey] || CLAUDE_MODELS[tier];
}

/**
 * Get all model IDs as an array, respecting environment overrides.
 * Ordered: opus, sonnet, haiku (most capable first).
 */
export function getAllModelIds(): string[] {
  return (['opus', 'sonnet', 'haiku'] as const).map(getModelId);
}
