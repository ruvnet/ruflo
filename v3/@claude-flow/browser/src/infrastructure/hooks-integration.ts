/**
 * @claude-flow/browser - Hooks Integration
 * pre-browse and post-browse hooks for claude-flow
 */

import { getReasoningBank } from './reasoningbank-adapter.js';
import type { BrowserTrajectory, ActionResult } from '../domain/types.js';

// ============================================================================
// Hook Handlers
// ============================================================================

export interface PreBrowseInput {
  goal: string;
  url?: string;
  context?: string;
}

export interface PreBrowseResult {
  recommendedSteps: Array<{
    action: string;
    selector?: string;
    value?: string;
  }>;
  similarPatterns: number;
  suggestedModel: 'haiku' | 'sonnet' | 'opus';
  estimatedDuration: number;
  warnings: string[];
}

export interface PostBrowseInput {
  trajectoryId: string;
  success: boolean;
  verdict?: string;
  duration: number;
  stepsCompleted: number;
  errors?: string[];
}

export interface PostBrowseResult {
  patternStored: boolean;
  patternId?: string;
  learnedFrom: boolean;
  statsUpdated: boolean;
}

// ============================================================================
// Pre-Browse Hook
// ============================================================================

/**
 * Pre-browse hook - called before starting browser automation
 * Returns recommendations based on learned patterns
 */
export async function preBrowseHook(input: PreBrowseInput): Promise<PreBrowseResult> {
  const reasoningBank = getReasoningBank();
  const warnings: string[] = [];

  // Find similar patterns
  const similarPatterns = await reasoningBank.findSimilarPatterns(input.goal);

  // Get recommended steps
  const recommendedSteps = await reasoningBank.getRecommendedSteps(input.goal);

  // Suggest model based on complexity
  let suggestedModel: 'haiku' | 'sonnet' | 'opus' = 'sonnet';
  if (recommendedSteps.length <= 3) {
    suggestedModel = 'haiku';
  } else if (recommendedSteps.length > 10 || input.goal.toLowerCase().includes('complex')) {
    suggestedModel = 'opus';
  }

  // Estimate duration based on patterns
  let estimatedDuration = 5000; // Default 5s
  if (similarPatterns.length > 0) {
    estimatedDuration = Math.round(
      similarPatterns.reduce((sum, p) => sum + p.avgDuration * p.steps.length, 0) / similarPatterns.length
    );
  }

  // Generate warnings
  if (input.url && !input.url.startsWith('https://')) {
    warnings.push('URL is not HTTPS - authentication data may be at risk');
  }

  if (input.goal.toLowerCase().includes('login') && !input.goal.toLowerCase().includes('test')) {
    warnings.push('Login detected - consider using state-save/state-load for session persistence');
  }

  if (similarPatterns.length === 0) {
    warnings.push('No similar patterns found - this is a new workflow');
  }

  return {
    recommendedSteps,
    similarPatterns: similarPatterns.length,
    suggestedModel,
    estimatedDuration,
    warnings,
  };
}

// ============================================================================
// Post-Browse Hook
// ============================================================================

/**
 * Post-browse hook - called after browser automation completes
 * Stores patterns and records learning feedback
 */
export async function postBrowseHook(input: PostBrowseInput): Promise<PostBrowseResult> {
  const reasoningBank = getReasoningBank();

  // Record verdict for learning
  await reasoningBank.recordVerdict(input.trajectoryId, input.success, input.verdict);

  // If there were errors, analyze them
  if (input.errors && input.errors.length > 0) {
    console.log(`[post-browse] Errors to learn from: ${input.errors.join(', ')}`);
  }

  const stats = reasoningBank.getStats();

  return {
    patternStored: input.success,
    patternId: input.success ? `pattern-${input.trajectoryId}` : undefined,
    learnedFrom: true,
    statsUpdated: true,
  };
}

// ============================================================================
// Hook Registration for CLI
// ============================================================================

export const browserHooks = {
  'pre-browse': {
    name: 'pre-browse',
    description: 'Get recommendations before browser automation',
    handler: preBrowseHook,
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'What you want to accomplish' },
        url: { type: 'string', description: 'Target URL (optional)' },
        context: { type: 'string', description: 'Additional context' },
      },
      required: ['goal'],
    },
  },
  'post-browse': {
    name: 'post-browse',
    description: 'Record browser automation outcome for learning',
    handler: postBrowseHook,
    inputSchema: {
      type: 'object',
      properties: {
        trajectoryId: { type: 'string', description: 'Trajectory ID from browser service' },
        success: { type: 'boolean', description: 'Whether the automation succeeded' },
        verdict: { type: 'string', description: 'Human feedback on quality' },
        duration: { type: 'number', description: 'Total duration in ms' },
        stepsCompleted: { type: 'number', description: 'Number of steps completed' },
        errors: { type: 'array', items: { type: 'string' }, description: 'Error messages if any' },
      },
      required: ['trajectoryId', 'success', 'duration', 'stepsCompleted'],
    },
  },
};

export default browserHooks;
