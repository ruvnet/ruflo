/**
 * Policy presets - pre-configured policies for common use cases
 *
 * Presets integrate with claude-flow's Claims system:
 * - permissive: Trust-based, minimal restrictions
 * - standard: Balanced security with agent autonomy
 * - strict: Maximum control, explicit approval required
 */

import type { PolicyConfig, PolicyRule } from './types.js';

/** Available preset names */
export type PresetName = 'permissive' | 'standard' | 'strict';

/** Preset metadata */
export interface PresetInfo {
  name: PresetName;
  description: string;
  trustFloor: number;
  defaultDecision: string;
}

/**
 * Permissive preset: Trust-based governance
 *
 * Best for: Development, exploration, high-trust environments
 * - Allows most operations if trust score is adequate
 * - Only blocks explicitly dangerous patterns
 * - Focuses on audit logging over prevention
 */
export const permissivePreset: PolicyConfig = {
  name: 'permissive',
  version: '1.0.0',
  enforce: false,
  defaultPolicy: 'allow',
  rules: [
    {
      id: 'block-secrets',
      name: 'Block secret file access',
      priority: 10,
      match: {
        targetPatterns: ['**/.env', '**/*.pem', '**/*.key', '**/credentials*'],
      },
      decision: 'deny',
      reason: 'Sensitive file access blocked by policy',
    },
    {
      id: 'log-writes',
      name: 'Log all file writes',
      priority: 100,
      match: {
        categories: ['file_write'],
      },
      decision: 'log_only',
      reason: 'File write logged for audit',
    },
    {
      id: 'log-executions',
      name: 'Log all command executions',
      priority: 100,
      match: {
        categories: ['execute'],
      },
      decision: 'log_only',
      reason: 'Command execution logged for audit',
    },
  ],
};

/**
 * Standard preset: Balanced governance
 *
 * Best for: Production, team environments, moderate security
 * - Requires minimum trust for sensitive operations
 * - Rate limits on high-impact actions
 * - Asks user for risky but not blocked actions
 */
export const standardPreset: PolicyConfig = {
  name: 'standard',
  version: '1.0.0',
  enforce: true,
  defaultPolicy: 'allow',
  rules: [
    {
      id: 'block-secrets',
      name: 'Block secret file access',
      priority: 10,
      match: {
        targetPatterns: ['**/.env', '**/*.pem', '**/*.key', '**/credentials*', '**/secrets*'],
      },
      decision: 'deny',
      reason: 'Sensitive file access blocked',
    },
    {
      id: 'block-system-files',
      name: 'Block system file modification',
      priority: 10,
      match: {
        categories: ['file_write'],
        targetPatterns: ['/etc/**', '/usr/**', '/bin/**', '/sbin/**'],
      },
      decision: 'deny',
      reason: 'System file modification blocked',
    },
    {
      id: 'require-trust-execute',
      name: 'Require trust for execution',
      priority: 50,
      match: {
        categories: ['execute'],
        minTrust: 0.4,
      },
      decision: 'allow',
      reason: 'Execution allowed with sufficient trust',
    },
    {
      id: 'ask-low-trust-execute',
      name: 'Ask for low-trust execution',
      priority: 51,
      match: {
        categories: ['execute'],
      },
      decision: 'ask_user',
      reason: 'Low trust execution requires approval',
    },
    {
      id: 'rate-limit-agents',
      name: 'Rate limit agent spawning',
      priority: 60,
      match: {
        categories: ['agent'],
        rateLimit: {
          maxCount: 10,
          windowMs: 60000,
        },
      },
      decision: 'deny',
      reason: 'Agent spawn rate limit exceeded',
    },
    {
      id: 'rate-limit-network',
      name: 'Rate limit network calls',
      priority: 60,
      match: {
        categories: ['network'],
        rateLimit: {
          maxCount: 30,
          windowMs: 60000,
        },
      },
      decision: 'deny',
      reason: 'Network call rate limit exceeded',
    },
  ],
};

/**
 * Strict preset: Maximum control
 *
 * Best for: Sensitive operations, compliance, high-security environments
 * - Deny by default
 * - Explicit allowlists required
 * - High trust requirements
 */
export const strictPreset: PolicyConfig = {
  name: 'strict',
  version: '1.0.0',
  enforce: true,
  defaultPolicy: 'deny',
  rules: [
    {
      id: 'allow-reads',
      name: 'Allow file reads',
      priority: 50,
      match: {
        categories: ['file_read'],
      },
      decision: 'allow',
      reason: 'File reads are allowed',
    },
    {
      id: 'allow-high-trust-writes',
      name: 'Allow high-trust writes',
      priority: 50,
      match: {
        categories: ['file_write'],
        minTrust: 0.7,
      },
      decision: 'allow',
      reason: 'High-trust file writes allowed',
    },
    {
      id: 'ask-writes',
      name: 'Ask for file writes',
      priority: 51,
      match: {
        categories: ['file_write'],
      },
      decision: 'ask_user',
      reason: 'File write requires approval',
    },
    {
      id: 'allow-safe-commands',
      name: 'Allow safe commands',
      priority: 50,
      match: {
        tools: ['Bash'],
        targetPatterns: ['git *', 'npm *', 'node *', 'ls *', 'cat *', 'echo *'],
        minTrust: 0.5,
      },
      decision: 'allow',
      reason: 'Safe command with sufficient trust',
    },
    {
      id: 'ask-commands',
      name: 'Ask for command execution',
      priority: 51,
      match: {
        categories: ['execute'],
      },
      decision: 'ask_user',
      reason: 'Command execution requires approval',
    },
    {
      id: 'block-all-network',
      name: 'Block network by default',
      priority: 40,
      match: {
        categories: ['network'],
      },
      decision: 'deny',
      reason: 'Network access blocked in strict mode',
    },
  ],
};

/** All available presets */
export const presets: Record<PresetName, PolicyConfig> = {
  permissive: permissivePreset,
  standard: standardPreset,
  strict: strictPreset,
};

/** Preset info for display */
export const presetInfo: Record<PresetName, PresetInfo> = {
  permissive: {
    name: 'permissive',
    description: 'Trust-based governance for development and exploration',
    trustFloor: 0.0,
    defaultDecision: 'allow',
  },
  standard: {
    name: 'standard',
    description: 'Balanced security with agent autonomy',
    trustFloor: 0.4,
    defaultDecision: 'allow',
  },
  strict: {
    name: 'strict',
    description: 'Maximum control requiring explicit approval',
    trustFloor: 0.7,
    defaultDecision: 'deny',
  },
};

/**
 * Get a preset by name
 */
export function getPreset(name: PresetName): PolicyConfig {
  const preset = presets[name];
  if (!preset) {
    throw new Error(`Unknown preset: ${name}. Available: ${Object.keys(presets).join(', ')}`);
  }
  return { ...preset };
}

/**
 * List all available presets
 */
export function listPresets(): PresetInfo[] {
  return Object.values(presetInfo);
}

/**
 * Create a custom policy based on a preset
 */
export function extendPreset(
  base: PresetName,
  overrides: Partial<PolicyConfig>,
  additionalRules?: PolicyRule[]
): PolicyConfig {
  const preset = getPreset(base);

  return {
    ...preset,
    ...overrides,
    rules: [...preset.rules, ...(additionalRules ?? [])],
  };
}
