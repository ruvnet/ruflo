/**
 * Hook-based Enforcement Gates
 *
 * Uses Claude Flow hooks to enforce non-negotiable rules.
 * The model can forget. The hook does not.
 *
 * Gates:
 * 1. Destructive ops gate - requires confirmation + rollback plan
 * 2. Tool allowlist gate - blocks non-allowlisted tools
 * 3. Diff size gate - requires plan + staged commits for large diffs
 * 4. Secrets gate - redacts and warns on secret patterns
 *
 * @module @claude-flow/guidance/gates
 */

import type {
  GateConfig,
  GateResult,
  GateDecision,
  GuidanceRule,
} from './types.js';

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_GATE_CONFIG: GateConfig = {
  destructiveOps: true,
  toolAllowlist: false,
  diffSize: true,
  secrets: true,
  diffSizeThreshold: 300,
  allowedTools: [],
  secretPatterns: [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
    /(?:token|bearer)\s*[:=]\s*['"][^'"]{10,}['"]/gi,
    /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    /sk-[a-zA-Z0-9]{20,}/g,
    /ghp_[a-zA-Z0-9]{36}/g,
    /npm_[a-zA-Z0-9]{36}/g,
    /AKIA[0-9A-Z]{16}/g,
  ],
  destructivePatterns: [
    /\brm\s+-rf?\b/i,
    /\bdrop\s+(database|table|schema|index)\b/i,
    /\btruncate\s+table\b/i,
    /\bgit\s+push\s+.*--force\b/i,
    /\bgit\s+reset\s+--hard\b/i,
    /\bgit\s+clean\s+-fd?\b/i,
    /\bformat\s+[a-z]:/i,
    /\bdel\s+\/[sf]\b/i,
    /\b(?:kubectl|helm)\s+delete\s+(?:--all|namespace)\b/i,
    /\bDROP\s+(?:DATABASE|TABLE|SCHEMA)\b/i,
    /\bDELETE\s+FROM\s+\w+\s*$/i,
    /\bALTER\s+TABLE\s+\w+\s+DROP\b/i,
  ],
};

/** Severity ranking for gate decisions (module-level constant to avoid per-call allocation). */
const GATE_DECISION_SEVERITY: Record<GateDecision, number> = {
  'block': 3,
  'require-confirmation': 2,
  'warn': 1,
  'allow': 0,
};

// ============================================================================
// Enforcement Gates
// ============================================================================

export class EnforcementGates {
  private config: GateConfig;
  private activeRules: GuidanceRule[] = [];

  constructor(config: Partial<GateConfig> = {}) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
  }

  /**
   * Update active rules from retrieval
   */
  setActiveRules(rules: GuidanceRule[]): void {
    this.activeRules = rules;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<GateConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Evaluate all gates for a command
   */
  evaluateCommand(command: string): GateResult[] {
    const results: GateResult[] = [];

    if (this.config.destructiveOps) {
      const result = this.evaluateDestructiveOps(command);
      if (result) results.push(result);
    }

    if (this.config.secrets) {
      const result = this.evaluateSecrets(command);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Evaluate all gates for a tool use
   */
  evaluateToolUse(toolName: string, params: Record<string, unknown>): GateResult[] {
    const results: GateResult[] = [];

    if (this.config.toolAllowlist && this.config.allowedTools.length > 0) {
      const result = this.evaluateToolAllowlist(toolName);
      if (result) results.push(result);
    }

    // Check tool params for secrets
    if (this.config.secrets) {
      const serialized = JSON.stringify(params);
      const result = this.evaluateSecrets(serialized);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Evaluate all gates for a file edit
   */
  evaluateEdit(filePath: string, content: string, diffLines: number): GateResult[] {
    const results: GateResult[] = [];

    if (this.config.diffSize) {
      const result = this.evaluateDiffSize(filePath, diffLines);
      if (result) results.push(result);
    }

    if (this.config.secrets) {
      const result = this.evaluateSecrets(content);
      if (result) results.push(result);
    }

    return results;
  }

  // ===== Individual Gate Implementations =====

  /**
   * Gate 1: Destructive Operations
   *
   * If command includes delete, drop, rm, force, migration,
   * require explicit confirmation and a rollback plan.
   */
  evaluateDestructiveOps(command: string): GateResult | null {
    for (const pattern of this.config.destructivePatterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const match = pattern.exec(command);
      if (match) {
        const triggeredRules = this.findTriggeredRules('security', 'critical');

        return {
          decision: 'require-confirmation',
          gateName: 'destructive-ops',
          reason: `Destructive operation detected: "${match[0]}". Requires explicit confirmation and a rollback plan before proceeding.`,
          triggeredRules: triggeredRules.map(r => r.id),
          remediation: [
            '1. Confirm this operation is intentional',
            '2. Document the rollback plan (e.g., git ref, backup, undo command)',
            '3. If this is a migration, ensure it has a down/rollback step',
          ].join('\n'),
          metadata: {
            matchedPattern: match[0],
            fullCommand: command,
          },
        };
      }
    }

    return null;
  }

  /**
   * Gate 2: Tool Allowlist
   *
   * If tool not in allowlist, block and ask for permission.
   */
  evaluateToolAllowlist(toolName: string): GateResult | null {
    if (this.config.allowedTools.length === 0) return null;

    const allowed = this.config.allowedTools.some(t =>
      t === toolName || t === '*' || (t.endsWith('*') && toolName.startsWith(t.slice(0, -1)))
    );

    if (!allowed) {
      return {
        decision: 'block',
        gateName: 'tool-allowlist',
        reason: `Tool "${toolName}" is not in the allowlist. Request permission before using this tool.`,
        triggeredRules: this.findTriggeredRules('security').map(r => r.id),
        remediation: `Add "${toolName}" to the tool allowlist in gate configuration, or get explicit user approval.`,
        metadata: {
          blockedTool: toolName,
          allowedTools: this.config.allowedTools,
        },
      };
    }

    return null;
  }

  /**
   * Gate 3: Diff Size
   *
   * If patch exceeds threshold, require a plan and staged commits.
   */
  evaluateDiffSize(filePath: string, diffLines: number): GateResult | null {
    if (diffLines <= this.config.diffSizeThreshold) return null;

    return {
      decision: 'warn',
      gateName: 'diff-size',
      reason: `Diff for "${filePath}" is ${diffLines} lines (threshold: ${this.config.diffSizeThreshold}). Large changes should be planned and staged.`,
      triggeredRules: this.findTriggeredRules('architecture').map(r => r.id),
      remediation: [
        '1. Create a plan breaking this change into logical commits',
        '2. Stage changes incrementally (one concern per commit)',
        '3. Run tests after each staged commit',
        '4. Consider if this change should be split into multiple PRs',
      ].join('\n'),
      metadata: {
        filePath,
        diffLines,
        threshold: this.config.diffSizeThreshold,
      },
    };
  }

  /**
   * Gate 4: Secrets Detection
   *
   * If output matches secret patterns, redact and warn.
   */
  evaluateSecrets(content: string): GateResult | null {
    const detectedSecrets: string[] = [];

    for (const pattern of this.config.secretPatterns) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Redact the secret (show first 4 and last 4 chars)
          const redacted = match.length > 12
            ? `${match.slice(0, 4)}${'*'.repeat(match.length - 8)}${match.slice(-4)}`
            : '*'.repeat(match.length);
          detectedSecrets.push(redacted);
        }
      }
    }

    if (detectedSecrets.length === 0) return null;

    return {
      decision: 'block',
      gateName: 'secrets',
      reason: `Detected ${detectedSecrets.length} potential secret(s) in content. Secrets must not be committed or exposed.`,
      triggeredRules: this.findTriggeredRules('security', 'critical').map(r => r.id),
      remediation: [
        '1. Move secrets to environment variables',
        '2. Use .env files (ensure they are in .gitignore)',
        '3. Use a secret management service for production',
        `Detected patterns: ${detectedSecrets.join(', ')}`,
      ].join('\n'),
      metadata: {
        secretCount: detectedSecrets.length,
        redactedSecrets: detectedSecrets,
      },
    };
  }

  // ===== Aggregate Evaluation =====

  /**
   * Get the most restrictive decision from multiple gate results
   */
  aggregateDecision(results: GateResult[]): GateDecision {
    if (results.length === 0) return 'allow';

    let maxSeverity = 0;
    let worstDecision: GateDecision = 'allow';

    for (const result of results) {
      const s = GATE_DECISION_SEVERITY[result.decision];
      if (s > maxSeverity) {
        maxSeverity = s;
        worstDecision = result.decision;
      }
    }

    return worstDecision;
  }

  /**
   * Get gate statistics
   */
  getActiveGateCount(): number {
    let count = 0;
    if (this.config.destructiveOps) count++;
    if (this.config.toolAllowlist && this.config.allowedTools.length > 0) count++;
    if (this.config.diffSize) count++;
    if (this.config.secrets) count++;
    return count;
  }

  // ===== Helpers =====

  private findTriggeredRules(domain: string, riskClass?: string): GuidanceRule[] {
    return this.activeRules.filter(r => {
      const domainMatch = r.domains.includes(domain);
      const riskMatch = !riskClass || r.riskClass === riskClass;
      return domainMatch && riskMatch;
    });
  }
}

/**
 * Create enforcement gates
 */
export function createGates(config?: Partial<GateConfig>): EnforcementGates {
  return new EnforcementGates(config);
}
