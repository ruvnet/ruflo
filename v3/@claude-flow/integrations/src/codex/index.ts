/**
 * @claude-flow/codex
 *
 * OpenAI Codex platform adapter for Claude Flow
 * First step in the coflow rebranding initiative
 *
 * @packageDocumentation
 */

// Re-export all types
export * from './types.js';

// Re-export generators
export {
  generateAgentsMd,
  generateSkillMd,
  generateConfigToml,
} from './generators/index.js';

// Re-export skill generator helper
export { generateBuiltInSkill } from './generators/skill-md.js';

// Re-export config generator helpers
export { generateMinimalConfigToml, generateCIConfigToml } from './generators/config-toml.js';

// Re-export migrations
export {
  migrateFromClaudeCode,
  analyzeClaudeMd,
  generateMigrationReport,
  convertSkillSyntax,
  convertSettingsToToml,
  FEATURE_MAPPINGS,
} from './migrations/index.js';

// Re-export validators
export {
  validateAgentsMd,
  validateSkillMd,
  validateConfigToml,
} from './validators/index.js';

// Main initializer class and helper function
export { CodexInitializer, initializeCodexProject } from './initializer.js';

// Dual-mode collaborative execution
export { DualModeOrchestrator, CollaborationTemplates, createDualModeCommand } from './dual-mode/index.js';
export type { DualModeConfig, WorkerConfig, WorkerResult, CollaborationResult } from './dual-mode/index.js';

// Template utilities
export {
  getTemplate,
  listTemplates,
  BUILT_IN_SKILLS,
  TEMPLATES,
  DEFAULT_SKILLS_BY_TEMPLATE,
  DIRECTORY_STRUCTURE,
  PLATFORM_MAPPING,
  GITIGNORE_ENTRIES,
  AGENTS_OVERRIDE_TEMPLATE,
} from './templates/index.js';

/**
 * Package version
 */
export const VERSION = '3.0.0-alpha.8';

/**
 * Package metadata
 */
export const PACKAGE_INFO = {
  name: '@claude-flow/integrations/codex',
  version: VERSION,
  description: 'Codex CLI integration for Claude Flow',
  futureUmbrella: 'coflow',
  repository: 'https://github.com/ruvnet/claude-flow',
} as const;

/**
 * Default export for convenient imports
 */
export default {
  VERSION,
  PACKAGE_INFO,
};
