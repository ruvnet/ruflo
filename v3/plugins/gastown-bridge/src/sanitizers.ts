/**
 * Gas Town Bridge Plugin - Output Sanitizers
 *
 * Provides output sanitization for the Gas Town Bridge Plugin:
 * - sanitizeBeadOutput: Parse and sanitize bead CLI output
 * - sanitizeFormulaOutput: Parse and sanitize formula CLI output
 * - Remove sensitive data from outputs
 *
 * Security Features:
 * - JSON parsing with validation
 * - Sensitive field redaction (tokens, keys, passwords)
 * - Output size limits to prevent DoS
 * - Type coercion and validation
 *
 * All sanitizers follow OWASP guidelines for output encoding.
 *
 * @module gastown-bridge/sanitizers
 * @version 0.1.0
 */

import { z } from 'zod';
import type { Bead, Formula, Convoy, BeadStatus, FormulaType, ConvoyStatus } from './types.js';
import { BeadsError, FormulaError, GasTownErrorCode, ConvoyError } from './errors.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Maximum output sizes to prevent DoS
 */
const MAX_OUTPUT_SIZE = {
  single: 1024 * 1024,      // 1MB for single item
  list: 10 * 1024 * 1024,   // 10MB for lists
  field: 65536,             // 64KB for individual fields
} as const;

/**
 * Sensitive field patterns that should be redacted
 */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /auth[_-]?key/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /credential/i,
  /bearer/i,
  /jwt/i,
  /session[_-]?id/i,
];

/**
 * Fields that should always be removed from output
 */
const REDACTED_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'authKey',
  'auth_key',
  'privateKey',
  'private_key',
  'accessKey',
  'access_key',
  'credential',
  'credentials',
  'bearer',
  'jwt',
  'sessionId',
  'session_id',
]);

// ============================================================================
// Internal Zod Schemas for Parsing
// ============================================================================

/**
 * Schema for parsing raw bead output
 */
const RawBeadSchema = z.object({
  id: z.string(),
  title: z.string().default(''),
  description: z.string().default(''),
  status: z.enum(['open', 'in_progress', 'closed']).default('open'),
  priority: z.number().int().min(0).default(50),
  labels: z.array(z.string()).default([]),
  parentId: z.string().optional(),
  parent_id: z.string().optional(),  // Alternative casing
  createdAt: z.union([z.string(), z.date()]).optional(),
  created_at: z.union([z.string(), z.date()]).optional(),  // Alternative casing
  updatedAt: z.union([z.string(), z.date()]).optional(),
  updated_at: z.union([z.string(), z.date()]).optional(),  // Alternative casing
  assignee: z.string().optional(),
  rig: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocked_by: z.array(z.string()).optional(),  // Alternative casing
  blocks: z.array(z.string()).optional(),
}).passthrough();  // Allow extra fields for flexibility

/**
 * Schema for parsing raw formula output
 */
const RawFormulaSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  type: z.enum(['convoy', 'workflow', 'expansion', 'aspect']).default('workflow'),
  version: z.number().int().min(1).default(1),
  legs: z.array(z.object({
    id: z.string(),
    title: z.string().default(''),
    focus: z.string().default(''),
    description: z.string().default(''),
    agent: z.string().optional(),
    order: z.number().optional(),
  })).optional(),
  steps: z.array(z.object({
    id: z.string(),
    title: z.string().default(''),
    description: z.string().default(''),
    needs: z.array(z.string()).optional(),
    duration: z.number().optional(),
    requires: z.array(z.string()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  vars: z.record(z.string(), z.object({
    name: z.string().default(''),
    description: z.string().optional(),
    default: z.string().optional(),
    required: z.boolean().optional(),
    pattern: z.string().optional(),
    enum: z.array(z.string()).optional(),
  })).optional(),
  synthesis: z.object({
    strategy: z.enum(['merge', 'sequential', 'parallel']).default('merge'),
    format: z.string().optional(),
    description: z.string().optional(),
  }).optional(),
  templates: z.array(z.object({
    name: z.string(),
    content: z.string(),
    outputPath: z.string().optional(),
  })).optional(),
  aspects: z.array(z.object({
    name: z.string().default(''),
    pointcut: z.string().default(''),
    advice: z.string().default(''),
    type: z.enum(['before', 'after', 'around']).default('after'),
  })).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

/**
 * Schema for parsing raw convoy output
 */
const RawConvoySchema = z.object({
  id: z.string(),
  name: z.string(),
  trackedIssues: z.array(z.string()).default([]),
  tracked_issues: z.array(z.string()).optional(),  // Alternative casing
  status: z.enum(['active', 'landed', 'failed', 'paused']).default('active'),
  startedAt: z.union([z.string(), z.date()]).optional(),
  started_at: z.union([z.string(), z.date()]).optional(),
  completedAt: z.union([z.string(), z.date()]).optional(),
  completed_at: z.union([z.string(), z.date()]).optional(),
  progress: z.object({
    total: z.number().int().min(0).default(0),
    closed: z.number().int().min(0).default(0),
    inProgress: z.number().int().min(0).default(0),
    in_progress: z.number().int().min(0).optional(),
    blocked: z.number().int().min(0).default(0),
  }).default({ total: 0, closed: 0, inProgress: 0, blocked: 0 }),
  formula: z.string().optional(),
  description: z.string().optional(),
}).passthrough();

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Sanitize raw bead output from CLI
 *
 * Parses JSON output, validates structure, redacts sensitive fields,
 * and normalizes the data to the Bead interface.
 *
 * @param raw - Raw string output from CLI
 * @returns Sanitized Bead object
 * @throws {BeadsError} If parsing or validation fails
 *
 * @example
 * ```typescript
 * const bead = sanitizeBeadOutput('{"id":"gt-abc12","title":"Test"}');
 * console.log(bead.id);  // 'gt-abc12'
 * ```
 */
export function sanitizeBeadOutput(raw: string): Bead {
  // Check size limit
  if (raw.length > MAX_OUTPUT_SIZE.single) {
    throw BeadsError.parseFailed(
      raw.slice(0, 100) + '...',
      new Error(`Output exceeds maximum size of ${MAX_OUTPUT_SIZE.single} bytes`)
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw BeadsError.parseFailed(raw, error instanceof Error ? error : undefined);
  }

  // Redact sensitive fields before validation
  if (typeof parsed === 'object' && parsed !== null) {
    redactSensitiveFields(parsed as Record<string, unknown>);
  }

  // Validate structure
  const result = RawBeadSchema.safeParse(parsed);
  if (!result.success) {
    throw BeadsError.parseFailed(
      raw,
      new Error(result.error.issues.map(e => e.message).join('; '))
    );
  }

  const data = result.data;

  // Normalize to Bead interface
  const bead: Bead = {
    id: sanitizeString(data.id, MAX_OUTPUT_SIZE.field),
    title: sanitizeString(data.title, MAX_OUTPUT_SIZE.field),
    description: sanitizeString(data.description, MAX_OUTPUT_SIZE.field),
    status: data.status as BeadStatus,
    priority: Math.max(0, Math.min(100, data.priority)),
    labels: data.labels.map(l => sanitizeString(l, 50)).slice(0, 20),
    parentId: data.parentId ?? data.parent_id,
    createdAt: parseDate(data.createdAt ?? data.created_at) ?? new Date(),
    updatedAt: parseDate(data.updatedAt ?? data.updated_at) ?? new Date(),
    assignee: data.assignee ? sanitizeString(data.assignee, 64) : undefined,
    rig: data.rig ? sanitizeString(data.rig, 32) : undefined,
    blockedBy: (data.blockedBy ?? data.blocked_by)?.map(b => sanitizeString(b, 32)),
    blocks: data.blocks?.map(b => sanitizeString(b, 32)),
  };

  return bead;
}

/**
 * Sanitize raw formula output from CLI
 *
 * Parses JSON/TOML output, validates structure, redacts sensitive fields,
 * and normalizes the data to the Formula interface.
 *
 * @param raw - Raw string output from CLI
 * @returns Sanitized Formula object
 * @throws {FormulaError} If parsing or validation fails
 *
 * @example
 * ```typescript
 * const formula = sanitizeFormulaOutput('{"name":"test","type":"workflow"}');
 * console.log(formula.name);  // 'test'
 * ```
 */
export function sanitizeFormulaOutput(raw: string): Formula {
  // Check size limit
  if (raw.length > MAX_OUTPUT_SIZE.single) {
    throw FormulaError.parseFailed(
      'output',
      `Output exceeds maximum size of ${MAX_OUTPUT_SIZE.single} bytes`
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw FormulaError.parseFailed(
      'output',
      'Invalid JSON',
      error instanceof Error ? error : undefined
    );
  }

  // Redact sensitive fields before validation
  if (typeof parsed === 'object' && parsed !== null) {
    redactSensitiveFields(parsed as Record<string, unknown>);
  }

  // Validate structure
  const result = RawFormulaSchema.safeParse(parsed);
  if (!result.success) {
    throw FormulaError.parseFailed(
      'output',
      result.error.issues.map(e => e.message).join('; ')
    );
  }

  const data = result.data;

  // Normalize to Formula interface
  const formula: Formula = {
    name: sanitizeString(data.name, 64),
    description: sanitizeString(data.description, MAX_OUTPUT_SIZE.field),
    type: data.type as FormulaType,
    version: Math.max(1, data.version),
    legs: data.legs?.map(leg => ({
      id: sanitizeString(leg.id, 64),
      title: sanitizeString(leg.title, 256),
      focus: sanitizeString(leg.focus, 256),
      description: sanitizeString(leg.description, MAX_OUTPUT_SIZE.field),
      agent: leg.agent ? sanitizeString(leg.agent, 64) : undefined,
      order: leg.order,
    })),
    steps: data.steps?.map(step => ({
      id: sanitizeString(step.id, 64),
      title: sanitizeString(step.title, 256),
      description: sanitizeString(step.description, MAX_OUTPUT_SIZE.field),
      needs: step.needs?.map(n => sanitizeString(n, 64)),
      duration: step.duration,
      requires: step.requires?.map(r => sanitizeString(r, 64)),
      metadata: step.metadata ? sanitizeMetadata(step.metadata) : undefined,
    })),
    vars: data.vars ? sanitizeVarsFromRaw(data.vars) : undefined,
    synthesis: data.synthesis ? {
      strategy: data.synthesis.strategy ?? 'merge',
      format: data.synthesis.format,
      description: data.synthesis.description,
    } : undefined,
    templates: data.templates?.map(t => ({
      name: sanitizeString(t.name, 64),
      content: sanitizeString(t.content, MAX_OUTPUT_SIZE.field),
      outputPath: t.outputPath ? sanitizePath(t.outputPath) : undefined,
    })),
    aspects: data.aspects?.map(a => ({
      name: sanitizeString(a.name ?? '', 64),
      pointcut: sanitizeString(a.pointcut ?? '', 256),
      advice: sanitizeString(a.advice ?? '', MAX_OUTPUT_SIZE.field),
      type: (a.type ?? 'after') as 'before' | 'after' | 'around',
    })),
    metadata: data.metadata ? sanitizeMetadata(data.metadata) : undefined,
  };

  return formula;
}

/**
 * Sanitize raw convoy output from CLI
 *
 * @param raw - Raw string output from CLI
 * @returns Sanitized Convoy object
 * @throws {ConvoyError} If parsing or validation fails
 */
export function sanitizeConvoyOutput(raw: string): Convoy {
  // Check size limit
  if (raw.length > MAX_OUTPUT_SIZE.single) {
    throw ConvoyError.createFailed(
      `Output exceeds maximum size of ${MAX_OUTPUT_SIZE.single} bytes`
    );
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw ConvoyError.createFailed(
      'Invalid JSON',
      error instanceof Error ? error : undefined
    );
  }

  // Redact sensitive fields
  if (typeof parsed === 'object' && parsed !== null) {
    redactSensitiveFields(parsed as Record<string, unknown>);
  }

  // Validate structure
  const result = RawConvoySchema.safeParse(parsed);
  if (!result.success) {
    throw ConvoyError.createFailed(
      result.error.issues.map(e => e.message).join('; ')
    );
  }

  const data = result.data;

  // Normalize to Convoy interface
  const convoy: Convoy = {
    id: sanitizeString(data.id, 36),
    name: sanitizeString(data.name, 128),
    trackedIssues: (data.trackedIssues ?? data.tracked_issues ?? [])
      .map(i => sanitizeString(i, 32))
      .slice(0, 100),
    status: data.status as ConvoyStatus,
    startedAt: parseDate(data.startedAt ?? data.started_at) ?? new Date(),
    completedAt: parseDate(data.completedAt ?? data.completed_at),
    progress: {
      total: Math.max(0, data.progress.total),
      closed: Math.max(0, data.progress.closed),
      inProgress: Math.max(0, data.progress.inProgress ?? data.progress.in_progress ?? 0),
      blocked: Math.max(0, data.progress.blocked),
    },
    formula: data.formula ? sanitizeString(data.formula, 64) : undefined,
    description: data.description ? sanitizeString(data.description, MAX_OUTPUT_SIZE.field) : undefined,
  };

  return convoy;
}

/**
 * Sanitize a list of beads from JSONL output
 *
 * @param raw - Raw JSONL string (one JSON object per line)
 * @returns Array of sanitized Bead objects
 */
export function sanitizeBeadsListOutput(raw: string): Bead[] {
  // Check size limit
  if (raw.length > MAX_OUTPUT_SIZE.list) {
    throw BeadsError.parseFailed(
      raw.slice(0, 100) + '...',
      new Error(`Output exceeds maximum size of ${MAX_OUTPUT_SIZE.list} bytes`)
    );
  }

  const lines = raw.trim().split('\n');
  const beads: Bead[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    try {
      const bead = sanitizeBeadOutput(line);
      beads.push(bead);
    } catch (error) {
      // Collect errors but continue processing
      errors.push(`Line ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Log errors if any
  if (errors.length > 0) {
    console.warn(`[sanitizers] ${errors.length} bead(s) failed to parse:`, errors.slice(0, 3));
  }

  return beads;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively redact sensitive fields from an object
 */
function redactSensitiveFields(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {
    // Check if field name is sensitive
    if (REDACTED_FIELDS.has(key) || SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) {
      obj[key] = '[REDACTED]';
      continue;
    }

    const value = obj[key];

    // Recursively process nested objects
    if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'object' && item !== null) {
            redactSensitiveFields(item as Record<string, unknown>);
          }
        }
      } else {
        redactSensitiveFields(value as Record<string, unknown>);
      }
    }
  }
}

/**
 * Sanitize a string value with length limit
 */
function sanitizeString(value: string | undefined | null, maxLength: number): string {
  if (value === undefined || value === null) {
    return '';
  }

  // Truncate to max length
  let result = String(value);
  if (result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  // Remove null bytes
  result = result.replace(/\0/g, '');

  // Normalize whitespace
  result = result.replace(/[\r\n]+/g, '\n').trim();

  return result;
}

/**
 * Sanitize a path value (remove traversal sequences)
 */
function sanitizePath(value: string): string {
  let result = sanitizeString(value, 256);

  // Remove path traversal sequences
  result = result.replace(/\.\.\//g, '');
  result = result.replace(/\.\.\\/g, '');

  // Remove leading slashes that could be absolute paths
  result = result.replace(/^[\/\\]+/, '');

  return result;
}

/**
 * Parse a date value
 */
function parseDate(value: string | Date | undefined | null): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? undefined : value;
  }

  try {
    const date = new Date(value);
    return isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
}

/**
 * Sanitize metadata object
 */
function sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    // Skip sensitive fields
    if (REDACTED_FIELDS.has(key) || SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) {
      continue;
    }

    // Limit key length
    const sanitizedKey = sanitizeString(key, 64);

    // Sanitize value based on type
    if (typeof value === 'string') {
      result[sanitizedKey] = sanitizeString(value, MAX_OUTPUT_SIZE.field);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[sanitizedKey] = value;
    } else if (Array.isArray(value)) {
      result[sanitizedKey] = value.slice(0, 100).map(v =>
        typeof v === 'string' ? sanitizeString(v, 256) : v
      );
    } else if (typeof value === 'object' && value !== null) {
      result[sanitizedKey] = sanitizeMetadata(value as Record<string, unknown>);
    }
  }

  return result;
}

/**
 * Type for Var from types.ts
 */
interface VarType {
  name: string;
  description?: string;
  default?: string;
  required?: boolean;
  pattern?: string;
  enum?: string[];
}

/**
 * Sanitize vars object from raw zod output (may have optional name)
 */
function sanitizeVarsFromRaw(vars: Record<string, {
  name?: string;
  description?: string;
  default?: string;
  required?: boolean;
  pattern?: string;
  enum?: string[];
}>): Record<string, VarType> {
  const result: Record<string, VarType> = {};

  for (const [key, value] of Object.entries(vars)) {
    // Skip sensitive fields
    if (REDACTED_FIELDS.has(key) || SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) {
      continue;
    }

    const sanitizedKey = sanitizeString(key, 64);
    result[sanitizedKey] = {
      name: sanitizeString(value.name ?? key, 64),
      description: value.description ? sanitizeString(value.description, 256) : undefined,
      default: value.default ? sanitizeString(value.default, 256) : undefined,
      required: value.required,
      pattern: value.pattern ? sanitizeString(value.pattern, 256) : undefined,
      enum: value.enum?.map(e => sanitizeString(e, 64)).slice(0, 20),
    };
  }

  return result;
}

/**
 * Sanitize vars object (typed version)
 */
function sanitizeVars(vars: Record<string, VarType>): Record<string, VarType> {
  const result: Record<string, VarType> = {};

  for (const [key, value] of Object.entries(vars)) {
    // Skip sensitive fields
    if (REDACTED_FIELDS.has(key) || SENSITIVE_FIELD_PATTERNS.some(p => p.test(key))) {
      continue;
    }

    const sanitizedKey = sanitizeString(key, 64);
    result[sanitizedKey] = {
      name: sanitizeString(value.name, 64),
      description: value.description ? sanitizeString(value.description, 256) : undefined,
      default: value.default ? sanitizeString(value.default, 256) : undefined,
      required: value.required,
      pattern: value.pattern ? sanitizeString(value.pattern, 256) : undefined,
      enum: value.enum?.map(e => sanitizeString(e, 64)).slice(0, 20),
    };
  }

  return result;
}

// ============================================================================
// Exports
// ============================================================================

export {
  MAX_OUTPUT_SIZE,
  SENSITIVE_FIELD_PATTERNS,
  REDACTED_FIELDS,
  RawBeadSchema,
  RawFormulaSchema,
  RawConvoySchema,
  redactSensitiveFields,
  sanitizeString,
  sanitizePath,
  parseDate,
  sanitizeMetadata,
};
