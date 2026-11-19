/**
 * Input Validation for MCP Tools — re-export shim (ADR-100, alpha.5).
 *
 * Authoritative source: @claude-flow/cli-core/mcp-tools/validate-input.
 * Was a 256-line byte-identical copy. Loads @claude-flow/security validators
 * when available, with lightweight fallback otherwise.
 */

import {
  validateIdentifier as coreValidateIdentifier,
  type ValidationResult,
} from '@claude-flow/cli-core/mcp-tools/validate-input';

export * from '@claude-flow/cli-core/mcp-tools/validate-input';

/**
 * Names that resolve to Object.prototype or a built-in when used as a key on a
 * plain object. Identifiers key the JSON record stores, so they are refused.
 * Move this check into cli-core on its next release.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function validateIdentifier(value: unknown, label: string): ValidationResult {
  const result = coreValidateIdentifier(value, label);
  if (result.valid && RESERVED_KEYS.has(result.sanitized)) {
    return { valid: false, sanitized: '', error: `${label} must not be a reserved name (${result.sanitized})` };
  }
  return result;
}
