/**
 * Deterministic Tool Gateway
 *
 * Extends EnforcementGates with idempotency, schema validation,
 * and budget metering. Every tool call passes through a deterministic
 * pipeline: idempotency check -> schema validation -> budget check ->
 * enforcement gates -> allow/deny.
 *
 * @module @claude-flow/guidance/gateway
 */

import { createHash } from 'node:crypto';
import { EnforcementGates } from './gates.js';
import type { GateConfig } from './types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Schema definition for a tool's parameters
 */
export interface ToolSchema {
  /** Tool name this schema applies to */
  toolName: string;
  /** Parameters that must be present */
  requiredParams: string[];
  /** Parameters that may be present */
  optionalParams: string[];
  /** Expected type for each parameter */
  paramTypes: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
  /** Maximum total serialized size of all parameters in bytes */
  maxParamSize: number;
  /** Optional whitelist of allowed values per parameter */
  allowedValues?: Record<string, unknown[]>;
}

/**
 * Multi-dimensional budget tracking
 */
export interface Budget {
  tokenBudget: { used: number; limit: number };
  toolCallBudget: { used: number; limit: number };
  storageBudget: { usedBytes: number; limitBytes: number };
  timeBudget: { usedMs: number; limitMs: number };
  costBudget: { usedUsd: number; limitUsd: number };
}

/**
 * Record of a previous tool call for idempotency
 */
export interface IdempotencyRecord {
  /** SHA-256 of tool name + sorted params */
  key: string;
  /** Tool that was called */
  toolName: string;
  /** Hash of the parameters */
  paramsHash: string;
  /** Cached result from the call */
  result: unknown;
  /** When the call was recorded */
  timestamp: number;
  /** Time-to-live in milliseconds */
  ttlMs: number;
}

/**
 * Decision returned by the gateway for each tool call evaluation
 */
export interface GatewayDecision {
  /** Whether the call is allowed */
  allowed: boolean;
  /** Human-readable reason for the decision */
  reason: string;
  /** Which gate produced the decision (or 'none' if allowed) */
  gate: string;
  /** Evidence of what was checked */
  evidence: Record<string, unknown>;
  /** Whether an idempotency cache hit occurred */
  idempotencyHit: boolean;
  /** Cached result if idempotency hit */
  cachedResult?: unknown;
  /** Remaining budget after this decision */
  budgetRemaining?: Budget;
}

// ============================================================================
// Default Budget
// ============================================================================

const DEFAULT_BUDGET: Budget = {
  tokenBudget: { used: 0, limit: Infinity },
  toolCallBudget: { used: 0, limit: Infinity },
  storageBudget: { usedBytes: 0, limitBytes: Infinity },
  timeBudget: { usedMs: 0, limitMs: Infinity },
  costBudget: { usedUsd: 0, limitUsd: Infinity },
};

// ============================================================================
// Gateway Configuration
// ============================================================================

export interface ToolGatewayConfig {
  /** Tool schemas for validation */
  schemas?: ToolSchema[];
  /** Budget limits (partial; defaults to Infinity for unset dimensions) */
  budget?: Partial<Budget>;
  /** Default TTL for idempotency records in milliseconds */
  idempotencyTtlMs?: number;
  /** Maximum idempotency cache entries (default 10000) */
  maxCacheSize?: number;
  /** If true, evidence must be non-empty for allow decisions */
  requireEvidence?: boolean;
  /** Gate configuration passed through to EnforcementGates */
  gateConfig?: Partial<GateConfig>;
}

// ============================================================================
// Deterministic Tool Gateway
// ============================================================================

export class DeterministicToolGateway {
  private readonly gates: EnforcementGates;
  private readonly schemas: Map<string, ToolSchema>;
  private budget: Budget;
  private readonly idempotencyTtlMs: number;
  private readonly maxCacheSize: number;
  private readonly requireEvidence: boolean;
  private readonly idempotencyCache: Map<string, IdempotencyRecord> = new Map();
  private lastCleanupTime = 0;
  private static readonly CLEANUP_INTERVAL_MS = 30_000; // batch cleanup every 30s

  constructor(config: ToolGatewayConfig = {}) {
    this.gates = new EnforcementGates(config.gateConfig);

    // Index schemas by tool name
    this.schemas = new Map();
    if (config.schemas) {
      for (const schema of config.schemas) {
        this.schemas.set(schema.toolName, schema);
      }
    }

    // Merge partial budget with defaults
    this.budget = this.mergeBudget(config.budget);
    this.idempotencyTtlMs = config.idempotencyTtlMs ?? 300_000; // 5 minutes default
    this.maxCacheSize = config.maxCacheSize ?? 10_000;
    this.requireEvidence = config.requireEvidence ?? false;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  /**
   * Evaluate whether a tool call should be allowed.
   *
   * Pipeline:
   * 1. Check idempotency cache
   * 2. Validate params against schema
   * 3. Check budget
   * 4. Run EnforcementGates checks
   * 5. Return decision with remaining budget
   */
  evaluate(
    toolName: string,
    params: Record<string, unknown>,
    context?: Record<string, unknown>,
  ): GatewayDecision {
    const evidence: Record<string, unknown> = {};

    // Step 1: Idempotency check (batch cleanup on interval, not every call)
    this.maybeCleanExpiredIdempotency();
    const idempotencyKey = this.getIdempotencyKey(toolName, params);
    const cached = this.idempotencyCache.get(idempotencyKey);

    if (cached) {
      return {
        allowed: true,
        reason: 'Idempotency cache hit; returning cached result',
        gate: 'idempotency',
        evidence: { idempotencyKey, cachedAt: cached.timestamp },
        idempotencyHit: true,
        cachedResult: cached.result,
        budgetRemaining: this.cloneBudget(),
      };
    }

    evidence.idempotencyKey = idempotencyKey;
    evidence.idempotencyHit = false;

    // Step 2: Schema validation
    const schemaResult = this.validateSchema(toolName, params);
    evidence.schemaValidation = schemaResult;

    if (!schemaResult.valid) {
      return {
        allowed: false,
        reason: `Schema validation failed: ${schemaResult.errors.join('; ')}`,
        gate: 'schema-validation',
        evidence,
        idempotencyHit: false,
      };
    }

    // Step 3: Budget check
    const budgetStatus = this.checkBudget();
    evidence.budgetStatus = budgetStatus;

    if (!budgetStatus.withinBudget) {
      const exceeded = this.findExceededBudgets();
      return {
        allowed: false,
        reason: `Budget exceeded: ${exceeded.join(', ')}`,
        gate: 'budget',
        evidence,
        idempotencyHit: false,
        budgetRemaining: this.cloneBudget(),
      };
    }

    // Step 4: EnforcementGates checks
    const gateResults = this.gates.evaluateToolUse(toolName, params);
    evidence.gateResults = gateResults;

    if (gateResults.length > 0) {
      const aggregated = this.gates.aggregateDecision(gateResults);

      if (aggregated === 'block') {
        const blockResult = gateResults.find(r => r.decision === 'block')!;
        return {
          allowed: false,
          reason: blockResult.reason,
          gate: `enforcement:${blockResult.gateName}`,
          evidence,
          idempotencyHit: false,
          budgetRemaining: this.cloneBudget(),
        };
      }

      if (aggregated === 'require-confirmation') {
        const confirmResult = gateResults.find(r => r.decision === 'require-confirmation')!;
        return {
          allowed: false,
          reason: confirmResult.reason,
          gate: `enforcement:${confirmResult.gateName}`,
          evidence,
          idempotencyHit: false,
          budgetRemaining: this.cloneBudget(),
        };
      }

      // 'warn' still allows, but note it in evidence
      evidence.warnings = gateResults
        .filter(r => r.decision === 'warn')
        .map(r => r.reason);
    }

    // Also run command-level checks if context provides a command string
    if (context?.command && typeof context.command === 'string') {
      const commandResults = this.gates.evaluateCommand(context.command);
      evidence.commandGateResults = commandResults;

      if (commandResults.length > 0) {
        const aggregated = this.gates.aggregateDecision(commandResults);
        if (aggregated === 'block' || aggregated === 'require-confirmation') {
          const worst = commandResults.find(
            r => r.decision === aggregated,
          )!;
          return {
            allowed: false,
            reason: worst.reason,
            gate: `enforcement:${worst.gateName}`,
            evidence,
            idempotencyHit: false,
            budgetRemaining: this.cloneBudget(),
          };
        }
      }
    }

    // Step 5: Allow
    return {
      allowed: true,
      reason: 'All gates passed',
      gate: 'none',
      evidence,
      idempotencyHit: false,
      budgetRemaining: this.cloneBudget(),
    };
  }

  /**
   * Record a completed tool call.
   * Updates budgets and stores the result in the idempotency cache.
   */
  recordCall(
    toolName: string,
    params: Record<string, unknown>,
    result: unknown,
    durationMs: number,
    tokenCount?: number,
  ): void {
    // Update budgets
    this.budget.toolCallBudget.used += 1;
    this.budget.timeBudget.usedMs += durationMs;

    if (tokenCount !== undefined) {
      this.budget.tokenBudget.used += tokenCount;
    }

    // Estimate storage from serialized result
    const serialized = JSON.stringify(result) ?? '';
    this.budget.storageBudget.usedBytes += Buffer.byteLength(serialized, 'utf-8');

    // Estimate cost: simple heuristic based on tokens
    if (tokenCount !== undefined) {
      // Rough estimate: $0.003 per 1K tokens (configurable in production)
      this.budget.costBudget.usedUsd += (tokenCount / 1000) * 0.003;
    }

    // Store in idempotency cache with size-based eviction
    const key = this.getIdempotencyKey(toolName, params);
    const paramsHash = this.computeParamsHash(params);

    this.idempotencyCache.set(key, {
      key,
      toolName,
      paramsHash,
      result,
      timestamp: Date.now(),
      ttlMs: this.idempotencyTtlMs,
    });

    // Evict oldest entries if cache exceeds max size
    if (this.idempotencyCache.size > this.maxCacheSize) {
      // Map iterates in insertion order; delete the first (oldest) entries
      const excess = this.idempotencyCache.size - this.maxCacheSize;
      let removed = 0;
      for (const [k] of this.idempotencyCache) {
        if (removed >= excess) break;
        this.idempotencyCache.delete(k);
        removed++;
      }
    }
  }

  /**
   * Validate tool parameters against the registered schema.
   * Returns valid:true if no schema is registered for the tool.
   */
  validateSchema(
    toolName: string,
    params: Record<string, unknown>,
  ): { valid: boolean; errors: string[] } {
    const schema = this.schemas.get(toolName);

    if (!schema) {
      // No schema registered; pass through
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    // Check required params
    for (const required of schema.requiredParams) {
      if (!(required in params) || params[required] === undefined) {
        errors.push(`Missing required parameter: "${required}"`);
      }
    }

    // Check for unknown params
    const knownParams = new Set([...schema.requiredParams, ...schema.optionalParams]);
    for (const key of Object.keys(params)) {
      if (!knownParams.has(key)) {
        errors.push(`Unknown parameter: "${key}"`);
      }
    }

    // Check param types
    for (const [key, expectedType] of Object.entries(schema.paramTypes)) {
      if (!(key in params) || params[key] === undefined) continue;

      const value = params[key];
      const actualType = this.getParamType(value);

      if (actualType !== expectedType) {
        errors.push(
          `Parameter "${key}" expected type "${expectedType}" but got "${actualType}"`,
        );
      }
    }

    // Check param size
    const serialized = JSON.stringify(params);
    const sizeBytes = Buffer.byteLength(serialized, 'utf-8');
    if (sizeBytes > schema.maxParamSize) {
      errors.push(
        `Parameters size ${sizeBytes} bytes exceeds limit of ${schema.maxParamSize} bytes`,
      );
    }

    // Check allowed values
    if (schema.allowedValues) {
      for (const [key, allowed] of Object.entries(schema.allowedValues)) {
        if (!(key in params) || params[key] === undefined) continue;

        const value = params[key];
        const isAllowed = allowed.some(
          a => JSON.stringify(a) === JSON.stringify(value),
        );

        if (!isAllowed) {
          errors.push(
            `Parameter "${key}" value ${JSON.stringify(value)} is not in the allowed values list`,
          );
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Check whether all budget dimensions are within limits.
   */
  checkBudget(): { withinBudget: boolean; budgetStatus: Budget } {
    const b = this.budget;

    const withinBudget =
      b.tokenBudget.used <= b.tokenBudget.limit &&
      b.toolCallBudget.used <= b.toolCallBudget.limit &&
      b.storageBudget.usedBytes <= b.storageBudget.limitBytes &&
      b.timeBudget.usedMs <= b.timeBudget.limitMs &&
      b.costBudget.usedUsd <= b.costBudget.limitUsd;

    return { withinBudget, budgetStatus: this.cloneBudget() };
  }

  /**
   * Compute a deterministic idempotency key from tool name and params.
   * Uses SHA-256 of `toolName:sortedParamsJSON`.
   */
  getIdempotencyKey(toolName: string, params: Record<string, unknown>): string {
    return this.computeIdempotencyKey(toolName, params);
  }

  /**
   * Reset all budget counters to zero.
   */
  resetBudget(): void {
    this.budget.tokenBudget.used = 0;
    this.budget.toolCallBudget.used = 0;
    this.budget.storageBudget.usedBytes = 0;
    this.budget.timeBudget.usedMs = 0;
    this.budget.costBudget.usedUsd = 0;
  }

  /**
   * Get a snapshot of the current budget.
   */
  getBudget(): Budget {
    return this.cloneBudget();
  }

  /**
   * Get all idempotency records (including expired ones not yet cleaned).
   */
  getCallHistory(): IdempotencyRecord[] {
    return Array.from(this.idempotencyCache.values());
  }

  /**
   * Access the underlying EnforcementGates instance.
   */
  getGates(): EnforcementGates {
    return this.gates;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /**
   * Remove expired idempotency records (batched on interval to avoid per-call overhead).
   */
  private maybeCleanExpiredIdempotency(): void {
    const now = Date.now();
    if (now - this.lastCleanupTime < DeterministicToolGateway.CLEANUP_INTERVAL_MS) {
      return; // Skip cleanup until interval has passed
    }
    this.lastCleanupTime = now;

    for (const [key, record] of this.idempotencyCache) {
      if (now - record.timestamp > record.ttlMs) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  /**
   * Compute a deterministic SHA-256 key from tool name and sorted params.
   */
  private computeIdempotencyKey(
    toolName: string,
    params: Record<string, unknown>,
  ): string {
    const sortedParams = this.sortObject(params);
    const input = `${toolName}:${JSON.stringify(sortedParams)}`;
    return createHash('sha256').update(input).digest('hex');
  }

  /**
   * Compute a SHA-256 hash of params only (for the IdempotencyRecord).
   */
  private computeParamsHash(params: Record<string, unknown>): string {
    const sortedParams = this.sortObject(params);
    return createHash('sha256').update(JSON.stringify(sortedParams)).digest('hex');
  }

  /**
   * Recursively sort object keys for deterministic serialization.
   */
  private sortObject(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sortObject(item));
    if (typeof obj === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
        sorted[key] = this.sortObject((obj as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return obj;
  }

  /**
   * Determine the type string for a parameter value.
   */
  private getParamType(value: unknown): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'object';
    return typeof value;
  }

  /**
   * Create a deep clone of the current budget.
   */
  private cloneBudget(): Budget {
    return {
      tokenBudget: { ...this.budget.tokenBudget },
      toolCallBudget: { ...this.budget.toolCallBudget },
      storageBudget: { ...this.budget.storageBudget },
      timeBudget: { ...this.budget.timeBudget },
      costBudget: { ...this.budget.costBudget },
    };
  }

  /**
   * Merge a partial budget config with defaults.
   */
  private mergeBudget(partial?: Partial<Budget>): Budget {
    if (!partial) return this.cloneDefaultBudget();

    return {
      tokenBudget: partial.tokenBudget
        ? { ...DEFAULT_BUDGET.tokenBudget, ...partial.tokenBudget }
        : { ...DEFAULT_BUDGET.tokenBudget },
      toolCallBudget: partial.toolCallBudget
        ? { ...DEFAULT_BUDGET.toolCallBudget, ...partial.toolCallBudget }
        : { ...DEFAULT_BUDGET.toolCallBudget },
      storageBudget: partial.storageBudget
        ? { ...DEFAULT_BUDGET.storageBudget, ...partial.storageBudget }
        : { ...DEFAULT_BUDGET.storageBudget },
      timeBudget: partial.timeBudget
        ? { ...DEFAULT_BUDGET.timeBudget, ...partial.timeBudget }
        : { ...DEFAULT_BUDGET.timeBudget },
      costBudget: partial.costBudget
        ? { ...DEFAULT_BUDGET.costBudget, ...partial.costBudget }
        : { ...DEFAULT_BUDGET.costBudget },
    };
  }

  private cloneDefaultBudget(): Budget {
    return {
      tokenBudget: { ...DEFAULT_BUDGET.tokenBudget },
      toolCallBudget: { ...DEFAULT_BUDGET.toolCallBudget },
      storageBudget: { ...DEFAULT_BUDGET.storageBudget },
      timeBudget: { ...DEFAULT_BUDGET.timeBudget },
      costBudget: { ...DEFAULT_BUDGET.costBudget },
    };
  }

  /**
   * Find which budget dimensions have been exceeded.
   */
  private findExceededBudgets(): string[] {
    const exceeded: string[] = [];
    const b = this.budget;

    if (b.tokenBudget.used > b.tokenBudget.limit) {
      exceeded.push(`tokens (${b.tokenBudget.used}/${b.tokenBudget.limit})`);
    }
    if (b.toolCallBudget.used > b.toolCallBudget.limit) {
      exceeded.push(`tool calls (${b.toolCallBudget.used}/${b.toolCallBudget.limit})`);
    }
    if (b.storageBudget.usedBytes > b.storageBudget.limitBytes) {
      exceeded.push(`storage (${b.storageBudget.usedBytes}/${b.storageBudget.limitBytes} bytes)`);
    }
    if (b.timeBudget.usedMs > b.timeBudget.limitMs) {
      exceeded.push(`time (${b.timeBudget.usedMs}/${b.timeBudget.limitMs} ms)`);
    }
    if (b.costBudget.usedUsd > b.costBudget.limitUsd) {
      exceeded.push(`cost ($${b.costBudget.usedUsd.toFixed(4)}/$${b.costBudget.limitUsd.toFixed(4)})`);
    }

    return exceeded;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a DeterministicToolGateway instance
 */
export function createToolGateway(config?: ToolGatewayConfig): DeterministicToolGateway {
  return new DeterministicToolGateway(config);
}
