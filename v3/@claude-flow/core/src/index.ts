/**
 * @claude-flow/core
 *
 * Core module consolidating shared types, security, authorization,
 * AI providers, and AI defence capabilities.
 *
 * Consolidated from:
 * - @claude-flow/shared (types, events, utilities)
 * - @claude-flow/claims (issue claiming, work coordination)
 * - @claude-flow/security (input validation, CVE fixes)
 * - @claude-flow/providers (multi-LLM provider management)
 * - @claude-flow/aidefence (threat detection, learning)
 * - @claude-flow/performance (benchmarks, attention)
 *
 * @module @claude-flow/core
 */

// ===== Shared (types, events, utilities, config) =====
export * from './shared/index.js';

// ===== Claims (issue claiming, work coordination) =====
// Re-exported under claims/ subpath
export { claimsTools, registerClaimsTools } from './claims/index.js';

// ===== Security (validation, CVE fixes) =====
export {
  PasswordHasher,
  CredentialGenerator,
  SafeExecutor,
  PathValidator,
  TokenGenerator,
  InputValidator,
  createSecurityModule,
  auditSecurityConfig,
  type SecurityModuleConfig,
  type SecurityModule,
} from './security/index.js';

// ===== Providers (multi-LLM) =====
export {
  ProviderManager,
  createProviderManager,
  AnthropicProvider,
  OpenAIProvider,
  GoogleProvider,
  CohereProvider,
  OllamaProvider,
  RuVectorProvider,
  BaseProvider,
} from './providers/index.js';

// ===== AI Defence (threat detection, learning) =====
export {
  createAIDefence,
  getAIDefence,
  isSafe,
  checkThreats,
  calculateSecurityConsensus,
  ThreatDetectionService,
  ThreatLearningService,
  type AIDefence,
  type AIDefenceConfig,
} from './defence/index.js';
