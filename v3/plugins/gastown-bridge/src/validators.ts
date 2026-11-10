/**
 * Gas Town Bridge Plugin - Input Validators
 *
 * Provides comprehensive input validation for the Gas Town Bridge Plugin:
 * - validateBeadId: Validate bead IDs (alphanumeric only)
 * - validateFormulaName: Validate formula names (safe path characters)
 * - validateConvoyId: Validate convoy IDs (UUID format)
 * - validateGtArgs: Validate and escape CLI arguments
 *
 * Security Features:
 * - Allowlist-based validation (only permit known-safe patterns)
 * - Command injection prevention
 * - Path traversal prevention
 * - Null byte injection prevention
 * - Shell metacharacter blocking
 *
 * All validators follow OWASP guidelines for input validation.
 *
 * @module gastown-bridge/validators
 * @version 0.1.0
 */

import { z } from 'zod';
import { ValidationError, GasTownErrorCode } from './errors.js';

// ============================================================================
// Constants - Allowlists
// ============================================================================

/**
 * Shell metacharacters that are never allowed in any input
 */
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\n\r\0\\'"]/;

/**
 * Path traversal patterns
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,              // Unix parent directory
  /\.\.\\/,              // Windows parent directory
  /%2e%2e%2f/i,          // URL-encoded ../
  /%2e%2e%5c/i,          // URL-encoded ..\
  /\x2e\x2e\x2f/,        // Hex-encoded ../
  /\x2e\x2e\x5c/,        // Hex-encoded ..\
  /~\//,                 // Home directory
  /^\/etc\//,            // Absolute /etc path
  /^\/proc\//,           // Absolute /proc path
  /^\/dev\//,            // Absolute /dev path
  /^C:\\/i,              // Windows absolute path
];

/**
 * Allowed bead ID formats
 * - gt-{4-16 alphanumeric chars}
 * - Numeric IDs (1-10 digits)
 */
const BEAD_ID_PATTERN = /^(gt-[a-zA-Z0-9]{4,16}|\d{1,10})$/;

/**
 * Allowed formula name format
 * - Starts with letter
 * - Contains only alphanumeric, dash, underscore
 * - 1-64 characters
 */
const FORMULA_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/**
 * UUID v4 pattern for convoy IDs
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Alternative convoy ID format (conv-{hash})
 */
const CONVOY_HASH_PATTERN = /^conv-[a-zA-Z0-9]{4,16}$/;

/**
 * Maximum lengths for inputs
 */
const MAX_LENGTHS = {
  beadId: 32,
  formulaName: 64,
  convoyId: 36,
  argument: 512,
  stringValue: 4096,
  arrayLength: 100,
} as const;

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Schema for bead ID validation
 */
export const BeadIdSchema = z.string()
  .min(1, 'Bead ID cannot be empty')
  .max(MAX_LENGTHS.beadId, `Bead ID exceeds maximum length of ${MAX_LENGTHS.beadId}`)
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'Bead ID contains invalid characters'
  )
  .refine(
    (val) => !PATH_TRAVERSAL_PATTERNS.some(p => p.test(val)),
    'Bead ID contains path traversal sequence'
  )
  .refine(
    (val) => BEAD_ID_PATTERN.test(val.trim()),
    'Bead ID must be in format gt-{hash} or numeric'
  )
  .transform(val => val.trim());

/**
 * Schema for formula name validation
 */
export const FormulaNameSchema = z.string()
  .min(1, 'Formula name cannot be empty')
  .max(MAX_LENGTHS.formulaName, `Formula name exceeds maximum length of ${MAX_LENGTHS.formulaName}`)
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'Formula name contains invalid characters'
  )
  .refine(
    (val) => !PATH_TRAVERSAL_PATTERNS.some(p => p.test(val)),
    'Formula name contains path traversal sequence'
  )
  .refine(
    (val) => FORMULA_NAME_PATTERN.test(val.trim()),
    'Formula name must start with letter and contain only alphanumeric, dash, or underscore'
  )
  .transform(val => val.trim());

/**
 * Schema for convoy ID validation (UUID format)
 */
export const ConvoyIdSchema = z.string()
  .min(1, 'Convoy ID cannot be empty')
  .max(MAX_LENGTHS.convoyId, `Convoy ID exceeds maximum length of ${MAX_LENGTHS.convoyId}`)
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'Convoy ID contains invalid characters'
  )
  .refine(
    (val) => UUID_PATTERN.test(val.trim()) || CONVOY_HASH_PATTERN.test(val.trim()),
    'Convoy ID must be a valid UUID or conv-{hash} format'
  )
  .transform(val => val.trim().toLowerCase());

/**
 * Schema for a single CLI argument
 */
export const GtArgumentSchema = z.string()
  .max(MAX_LENGTHS.argument, `Argument exceeds maximum length of ${MAX_LENGTHS.argument}`)
  .refine(
    (val) => !val.includes('\0'),
    'Argument contains null byte'
  )
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'Argument contains shell metacharacters'
  )
  .refine(
    (val) => !PATH_TRAVERSAL_PATTERNS.some(p => p.test(val)),
    'Argument contains path traversal sequence'
  );

/**
 * Schema for CLI arguments array
 */
export const GtArgsSchema = z.array(GtArgumentSchema)
  .max(MAX_LENGTHS.arrayLength, `Too many arguments (max ${MAX_LENGTHS.arrayLength})`);

/**
 * Schema for safe string values
 */
export const SafeStringSchema = z.string()
  .max(MAX_LENGTHS.stringValue, `String exceeds maximum length of ${MAX_LENGTHS.stringValue}`)
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'String contains shell metacharacters'
  );

/**
 * Schema for formula type
 */
export const FormulaTypeSchema = z.enum(['convoy', 'workflow', 'expansion', 'aspect']);

/**
 * Schema for bead status
 */
export const BeadStatusSchema = z.enum(['open', 'in_progress', 'closed']);

/**
 * Schema for convoy status
 */
export const ConvoyStatusSchema = z.enum(['active', 'landed', 'failed', 'paused']);

/**
 * Schema for sling target
 */
export const SlingTargetSchema = z.enum(['polecat', 'crew', 'mayor']);

/**
 * Schema for rig name
 */
export const RigNameSchema = z.string()
  .min(1, 'Rig name cannot be empty')
  .max(32, 'Rig name exceeds maximum length')
  .refine(
    (val) => !SHELL_METACHARACTERS.test(val),
    'Rig name contains invalid characters'
  )
  .refine(
    (val) => /^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(val.trim()),
    'Rig name must start with letter and contain only alphanumeric or dash'
  )
  .transform(val => val.trim().toLowerCase());

/**
 * Schema for priority
 */
export const PrioritySchema = z.number()
  .int('Priority must be an integer')
  .min(0, 'Priority cannot be negative')
  .max(100, 'Priority cannot exceed 100');

/**
 * Schema for labels array
 */
export const LabelsSchema = z.array(
  z.string()
    .max(50, 'Label exceeds maximum length')
    .refine(
      (val) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(val),
      'Label must start with letter and contain only alphanumeric, dash, or underscore'
    )
)
  .max(20, 'Too many labels (max 20)');

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a bead ID
 *
 * Accepts:
 * - gt-{4-16 alphanumeric chars} (e.g., "gt-abc12", "gt-a1b2c3d4")
 * - Numeric IDs (e.g., "123", "9999999999")
 *
 * Rejects:
 * - Empty strings
 * - Shell metacharacters
 * - Path traversal sequences
 * - Invalid formats
 *
 * @param id - The bead ID to validate
 * @returns The validated and trimmed bead ID
 * @throws {ValidationError} If validation fails
 *
 * @example
 * ```typescript
 * const validId = validateBeadId('gt-abc12');  // Returns 'gt-abc12'
 * validateBeadId('gt-abc; rm -rf /');          // Throws ValidationError
 * ```
 */
export function validateBeadId(id: string): string {
  const result = BeadIdSchema.safeParse(id);
  if (!result.success) {
    const errors = result.error.issues.map(e => e.message).join('; ');
    throw ValidationError.invalidBeadId(id);
  }
  return result.data;
}

/**
 * Validate a formula name
 *
 * Accepts:
 * - Starts with letter
 * - Contains only alphanumeric, dash, underscore
 * - 1-64 characters
 *
 * Rejects:
 * - Starting with number
 * - Shell metacharacters
 * - Path traversal sequences
 *
 * @param name - The formula name to validate
 * @returns The validated and trimmed formula name
 * @throws {ValidationError} If validation fails
 *
 * @example
 * ```typescript
 * const validName = validateFormulaName('my-formula');  // Returns 'my-formula'
 * validateFormulaName('../etc/passwd');                  // Throws ValidationError
 * ```
 */
export function validateFormulaName(name: string): string {
  const result = FormulaNameSchema.safeParse(name);
  if (!result.success) {
    throw ValidationError.invalidFormulaName(name);
  }
  return result.data;
}

/**
 * Validate a convoy ID
 *
 * Accepts:
 * - UUID v4 format (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * - conv-{hash} format (e.g., "conv-abc123def")
 *
 * Rejects:
 * - Invalid UUID format
 * - Shell metacharacters
 * - Path traversal sequences
 *
 * @param id - The convoy ID to validate
 * @returns The validated and normalized convoy ID (lowercase)
 * @throws {ValidationError} If validation fails
 *
 * @example
 * ```typescript
 * const validId = validateConvoyId('550e8400-e29b-41d4-a716-446655440000');
 * validateConvoyId('not-a-uuid');  // Throws ValidationError
 * ```
 */
export function validateConvoyId(id: string): string {
  const result = ConvoyIdSchema.safeParse(id);
  if (!result.success) {
    throw ValidationError.invalidConvoyId(id);
  }
  return result.data;
}

/**
 * Validate and escape CLI arguments
 *
 * Validates each argument in the array:
 * - No null bytes
 * - No shell metacharacters
 * - No path traversal sequences
 * - Maximum length enforced
 *
 * @param args - Array of CLI arguments to validate
 * @returns Array of validated arguments
 * @throws {ValidationError} If any argument fails validation
 *
 * @example
 * ```typescript
 * const validArgs = validateGtArgs(['beads', 'list', '--limit', '10']);
 * validateGtArgs(['rm', '-rf', '/']);  // Throws ValidationError
 * ```
 */
export function validateGtArgs(args: string[]): string[] {
  if (!Array.isArray(args)) {
    throw new ValidationError(
      'Arguments must be an array',
      GasTownErrorCode.INVALID_ARGUMENTS,
      [{ field: 'args', constraint: 'array', actual: typeof args }]
    );
  }

  const result = GtArgsSchema.safeParse(args);
  if (!result.success) {
    const errors = result.error.issues;
    const constraints = errors.map((e, idx) => ({
      field: `args[${String(e.path[0] ?? idx)}]`,
      constraint: 'safe CLI argument',
      actual: args[Number(e.path[0])]?.slice(0, 20) + '...',
    }));
    throw new ValidationError(
      'Invalid CLI arguments',
      GasTownErrorCode.INVALID_ARGUMENTS,
      constraints
    );
  }

  return result.data;
}

// ============================================================================
// Compound Validators
// ============================================================================

/**
 * Schema for CreateBeadOptions
 */
export const CreateBeadOptionsSchema = z.object({
  title: z.string()
    .min(1, 'Title cannot be empty')
    .max(256, 'Title exceeds maximum length')
    .refine(
      (val) => !SHELL_METACHARACTERS.test(val),
      'Title contains invalid characters'
    ),
  description: z.string()
    .max(4096, 'Description exceeds maximum length')
    .optional(),
  priority: PrioritySchema.optional().default(50),
  labels: LabelsSchema.optional().default([]),
  parent: BeadIdSchema.optional(),
  rig: RigNameSchema.optional(),
  assignee: z.string()
    .max(64, 'Assignee name exceeds maximum length')
    .refine(
      (val) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(val),
      'Invalid assignee name format'
    )
    .optional(),
});

/**
 * Schema for CreateConvoyOptions
 */
export const CreateConvoyOptionsSchema = z.object({
  name: z.string()
    .min(1, 'Convoy name cannot be empty')
    .max(128, 'Convoy name exceeds maximum length')
    .refine(
      (val) => !SHELL_METACHARACTERS.test(val),
      'Convoy name contains invalid characters'
    ),
  issues: z.array(BeadIdSchema)
    .min(1, 'At least one issue is required')
    .max(100, 'Too many issues (max 100)'),
  description: z.string()
    .max(4096, 'Description exceeds maximum length')
    .optional(),
  formula: FormulaNameSchema.optional(),
});

/**
 * Schema for SlingOptions
 */
export const SlingOptionsSchema = z.object({
  beadId: BeadIdSchema,
  target: SlingTargetSchema,
  formula: FormulaNameSchema.optional(),
  priority: PrioritySchema.optional(),
});

/**
 * Validate CreateBeadOptions
 */
export function validateCreateBeadOptions(options: unknown): z.infer<typeof CreateBeadOptionsSchema> {
  const result = CreateBeadOptionsSchema.safeParse(options);
  if (!result.success) {
    const errors = result.error.issues;
    const constraints = errors.map(e => ({
      field: e.path.join('.'),
      constraint: e.message,
    }));
    throw new ValidationError(
      'Invalid bead creation options',
      GasTownErrorCode.VALIDATION_FAILED,
      constraints
    );
  }
  return result.data;
}

/**
 * Validate CreateConvoyOptions
 */
export function validateCreateConvoyOptions(options: unknown): z.infer<typeof CreateConvoyOptionsSchema> {
  const result = CreateConvoyOptionsSchema.safeParse(options);
  if (!result.success) {
    const errors = result.error.issues;
    const constraints = errors.map(e => ({
      field: e.path.join('.'),
      constraint: e.message,
    }));
    throw new ValidationError(
      'Invalid convoy creation options',
      GasTownErrorCode.VALIDATION_FAILED,
      constraints
    );
  }
  return result.data;
}

/**
 * Validate SlingOptions
 */
export function validateSlingOptions(options: unknown): z.infer<typeof SlingOptionsSchema> {
  const result = SlingOptionsSchema.safeParse(options);
  if (!result.success) {
    const errors = result.error.issues;
    const constraints = errors.map(e => ({
      field: e.path.join('.'),
      constraint: e.message,
    }));
    throw new ValidationError(
      'Invalid sling options',
      GasTownErrorCode.VALIDATION_FAILED,
      constraints
    );
  }
  return result.data;
}

// ============================================================================
// Security Utilities
// ============================================================================

/**
 * Check if a string contains shell metacharacters
 */
export function containsShellMetacharacters(input: string): boolean {
  return SHELL_METACHARACTERS.test(input);
}

/**
 * Check if a string contains path traversal sequences
 */
export function containsPathTraversal(input: string): boolean {
  return PATH_TRAVERSAL_PATTERNS.some(p => p.test(input));
}

/**
 * Check if a string is safe for use in CLI arguments
 */
export function isSafeArgument(input: string): boolean {
  return GtArgumentSchema.safeParse(input).success;
}

/**
 * Check if a bead ID is valid
 */
export function isValidBeadId(id: string): boolean {
  return BeadIdSchema.safeParse(id).success;
}

/**
 * Check if a formula name is valid
 */
export function isValidFormulaName(name: string): boolean {
  return FormulaNameSchema.safeParse(name).success;
}

/**
 * Check if a convoy ID is valid
 */
export function isValidConvoyId(id: string): boolean {
  return ConvoyIdSchema.safeParse(id).success;
}

// ============================================================================
// Exports
// ============================================================================

export {
  MAX_LENGTHS,
  SHELL_METACHARACTERS,
  PATH_TRAVERSAL_PATTERNS,
  BEAD_ID_PATTERN,
  FORMULA_NAME_PATTERN,
  UUID_PATTERN,
  CONVOY_HASH_PATTERN,
};
