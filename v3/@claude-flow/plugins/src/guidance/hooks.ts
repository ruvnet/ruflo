/**
 * Guidance Hook Integration Layer
 *
 * Wires the EnforcementGates and ShardRetriever into the Claude Flow V3
 * hook lifecycle. Each guidance concern is registered as a hook that
 * participates in the standard HookRegistry event flow.
 *
 * Hook mappings:
 *   PreCommand  -> EnforcementGates.evaluateCommand()  (destructive ops + secrets)
 *   PreToolUse  -> EnforcementGates.evaluateToolUse()   (tool allowlist + secrets)
 *   PreEdit     -> EnforcementGates.evaluateEdit()      (diff size + secrets)
 *   PreTask     -> ShardRetriever.retrieve()            (inject relevant shards)
 *   PostTask    -> RunLedger.finalizeEvent()             (record run completion)
 *
 * @module @claude-flow/guidance/hooks
 */

import type {
  HookContext,
  HookResult,
  HookRegistrationOptions,
} from '@claude-flow/agents/hooks';

import {
  HookEvent,
  HookPriority,
} from '@claude-flow/agents/hooks';

import type { HookRegistry } from '@claude-flow/agents/hooks';

import type { EnforcementGates } from './gates.js';
import type { ShardRetriever } from './retriever.js';
import type { RunLedger } from './ledger.js';
import type {
  GateResult,
  GateDecision,
  RunEvent,
  RetrievalResult,
} from './types.js';

// ============================================================================
// Gate-Result -> Hook-Result Mapping
// ============================================================================

/**
 * Convert an array of GateResults into a single HookResult.
 *
 * Severity ordering: block > require-confirmation > warn > allow.
 * The most restrictive decision drives the hook outcome.
 */
function gateResultsToHookResult(gateResults: GateResult[]): HookResult {
  if (gateResults.length === 0) {
    return { success: true };
  }

  const severityOrder: Record<GateDecision, number> = {
    block: 3,
    'require-confirmation': 2,
    warn: 1,
    allow: 0,
  };

  // Sort by severity descending to find the most restrictive
  const sorted = [...gateResults].sort(
    (a, b) => severityOrder[b.decision] - severityOrder[a.decision],
  );

  const worst = sorted[0];

  // Collect all warnings and reasons
  const allWarnings: string[] = [];
  const allReasons: string[] = [];

  for (const result of gateResults) {
    allReasons.push(`[${result.gateName}] ${result.reason}`);
    if (result.remediation) {
      allWarnings.push(`[${result.gateName}] ${result.remediation}`);
    }
  }

  switch (worst.decision) {
    case 'block':
      return {
        success: false,
        abort: true,
        error: allReasons.join(' | '),
        message: allReasons.join('\n'),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        data: {
          gateDecision: 'block',
          gateResults: gateResults.map(r => ({
            gate: r.gateName,
            decision: r.decision,
            reason: r.reason,
          })),
        },
      };

    case 'require-confirmation':
      return {
        success: false,
        abort: true,
        message: allReasons.join('\n'),
        warnings: allWarnings.length > 0 ? allWarnings : undefined,
        data: {
          gateDecision: 'require-confirmation',
          gateResults: gateResults.map(r => ({
            gate: r.gateName,
            decision: r.decision,
            reason: r.reason,
          })),
        },
      };

    case 'warn':
      return {
        success: true,
        message: allReasons.join('\n'),
        warnings: allWarnings.length > 0 ? allWarnings : allReasons,
        data: {
          gateDecision: 'warn',
          gateResults: gateResults.map(r => ({
            gate: r.gateName,
            decision: r.decision,
            reason: r.reason,
          })),
        },
      };

    default:
      return { success: true };
  }
}

// ============================================================================
// Guidance Hook Provider
// ============================================================================

/**
 * Provides guidance enforcement hooks for the V3 hook system.
 *
 * Registers hooks on a HookRegistry that wire each lifecycle event
 * (PreCommand, PreToolUse, PreEdit, PreTask, PostTask) to the
 * appropriate guidance subsystem (gates, retriever, ledger).
 */
export class GuidanceHookProvider {
  private gates: EnforcementGates;
  private retriever: ShardRetriever;
  private ledger: RunLedger;

  /** IDs of hooks registered by this provider, for cleanup */
  private hookIds: string[] = [];

  /** Active run events keyed by task ID, for PostTask finalization */
  private activeRuns = new Map<string, RunEvent>();

  constructor(
    gates: EnforcementGates,
    retriever: ShardRetriever,
    ledger: RunLedger,
  ) {
    this.gates = gates;
    this.retriever = retriever;
    this.ledger = ledger;
  }

  /**
   * Register all guidance hooks on the given registry.
   *
   * Returns the array of generated hook IDs for tracking.
   */
  registerAll(registry: HookRegistry): string[] {
    this.hookIds = [];

    // 1. PreCommand -> gate enforcement (Critical priority)
    this.hookIds.push(
      registry.register(
        HookEvent.PreCommand,
        (ctx: HookContext) => this.handlePreCommand(ctx),
        HookPriority.Critical,
        {
          name: 'guidance-gate-pre-command',
          description: 'Evaluates commands for destructive ops and secrets',
        },
      ),
    );

    // 2. PreToolUse -> gate enforcement (Critical priority)
    this.hookIds.push(
      registry.register(
        HookEvent.PreToolUse,
        (ctx: HookContext) => this.handlePreToolUse(ctx),
        HookPriority.Critical,
        {
          name: 'guidance-gate-pre-tool-use',
          description: 'Evaluates tool usage against allowlist and checks for secrets',
        },
      ),
    );

    // 3. PreEdit -> gate enforcement (High priority)
    this.hookIds.push(
      registry.register(
        HookEvent.PreEdit,
        (ctx: HookContext) => this.handlePreEdit(ctx),
        HookPriority.High,
        {
          name: 'guidance-gate-pre-edit',
          description: 'Evaluates file edits for diff size and secrets',
        },
      ),
    );

    // 4. PreTask -> shard retrieval (Normal priority)
    this.hookIds.push(
      registry.register(
        HookEvent.PreTask,
        (ctx: HookContext) => this.handlePreTask(ctx),
        HookPriority.Normal,
        {
          name: 'guidance-retriever-pre-task',
          description: 'Retrieves relevant guidance shards at task start',
        },
      ),
    );

    // 5. PostTask -> ledger finalization (Normal priority)
    this.hookIds.push(
      registry.register(
        HookEvent.PostTask,
        (ctx: HookContext) => this.handlePostTask(ctx),
        HookPriority.Normal,
        {
          name: 'guidance-ledger-post-task',
          description: 'Finalizes the run event in the ledger on task completion',
        },
      ),
    );

    return [...this.hookIds];
  }

  /**
   * Unregister all hooks previously registered by this provider.
   */
  unregisterAll(registry: HookRegistry): void {
    for (const id of this.hookIds) {
      registry.unregister(id);
    }
    this.hookIds = [];
  }

  /**
   * Get the IDs of all registered hooks.
   */
  getHookIds(): string[] {
    return [...this.hookIds];
  }

  /**
   * Get the active run event for a given task ID (if any).
   */
  getActiveRun(taskId: string): RunEvent | undefined {
    return this.activeRuns.get(taskId);
  }

  // ==========================================================================
  // Hook Handlers
  // ==========================================================================

  /**
   * PreCommand handler: evaluate command through destructive ops and secrets gates.
   */
  private handlePreCommand(ctx: HookContext): HookResult {
    const command = ctx.command?.raw;
    if (!command) {
      return { success: true };
    }

    const gateResults = this.gates.evaluateCommand(command);
    return gateResultsToHookResult(gateResults);
  }

  /**
   * PreToolUse handler: evaluate tool usage against allowlist and check params for secrets.
   */
  private handlePreToolUse(ctx: HookContext): HookResult {
    const toolName = ctx.tool?.name;
    if (!toolName) {
      return { success: true };
    }

    const params = ctx.tool?.parameters ?? {};
    const gateResults = this.gates.evaluateToolUse(toolName, params);
    return gateResultsToHookResult(gateResults);
  }

  /**
   * PreEdit handler: evaluate file edit for diff size and secrets.
   *
   * Extracts the file path from context. The content to scan comes from
   * metadata.content or is synthesized from available context. The diff
   * line count defaults to metadata.diffLines or 0.
   */
  private handlePreEdit(ctx: HookContext): HookResult {
    const filePath = ctx.file?.path;
    if (!filePath) {
      return { success: true };
    }

    const content = (ctx.metadata?.content as string) ?? '';
    const diffLines = (ctx.metadata?.diffLines as number) ?? 0;

    const gateResults = this.gates.evaluateEdit(filePath, content, diffLines);
    return gateResultsToHookResult(gateResults);
  }

  /**
   * PreTask handler: classify intent and retrieve relevant guidance shards.
   *
   * Creates a new RunEvent in the active runs map for PostTask finalization.
   * Returns the retrieved policy text and shards as hook data.
   */
  private async handlePreTask(ctx: HookContext): Promise<HookResult> {
    const taskId = ctx.task?.id;
    const taskDescription = ctx.task?.description;

    if (!taskId || !taskDescription) {
      return { success: true };
    }

    try {
      // Classify intent
      const { intent, confidence } = this.retriever.classifyIntent(taskDescription);

      // Retrieve relevant shards
      let retrievalResult: RetrievalResult | null = null;
      try {
        retrievalResult = await this.retriever.retrieve({
          taskDescription,
          intent,
        });
      } catch {
        // Retriever may not have a loaded bundle -- degrade gracefully
      }

      // Create a run event for ledger tracking
      const guidanceHash = retrievalResult?.constitution?.hash ?? 'unknown';
      const runEvent = this.ledger.createEvent(taskId, intent, guidanceHash);

      if (retrievalResult) {
        runEvent.retrievedRuleIds = retrievalResult.shards.map(
          s => s.shard.rule.id,
        );
      }

      this.activeRuns.set(taskId, runEvent);

      return {
        success: true,
        message: retrievalResult
          ? `Retrieved ${retrievalResult.shards.length} guidance shard(s) for intent "${intent}" (confidence: ${(confidence * 100).toFixed(0)}%)`
          : `Classified intent as "${intent}" (confidence: ${(confidence * 100).toFixed(0)}%). No policy bundle loaded.`,
        data: {
          intent,
          confidence,
          policyText: retrievalResult?.policyText ?? null,
          shardCount: retrievalResult?.shards.length ?? 0,
          contradictionsResolved: retrievalResult?.contradictionsResolved ?? 0,
          retrievalLatencyMs: retrievalResult?.latencyMs ?? 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Failed to retrieve guidance shards for task',
      };
    }
  }

  /**
   * PostTask handler: finalize the run event in the ledger.
   *
   * Looks up the active run by task ID, populates completion metadata,
   * and calls ledger.finalizeEvent().
   */
  private handlePostTask(ctx: HookContext): HookResult {
    const taskId = ctx.task?.id;
    if (!taskId) {
      return { success: true };
    }

    const runEvent = this.activeRuns.get(taskId);
    if (!runEvent) {
      return {
        success: true,
        message: `No active run event found for task "${taskId}". Skipping finalization.`,
      };
    }

    try {
      // Populate additional metadata from context if available
      if (ctx.task?.status) {
        runEvent.outcomeAccepted = ctx.task.status === 'completed';
      }

      if (ctx.metadata?.toolsUsed && Array.isArray(ctx.metadata.toolsUsed)) {
        runEvent.toolsUsed = ctx.metadata.toolsUsed as string[];
      }

      if (ctx.metadata?.filesTouched && Array.isArray(ctx.metadata.filesTouched)) {
        runEvent.filesTouched = ctx.metadata.filesTouched as string[];
      }

      // Finalize the event in the ledger
      this.ledger.finalizeEvent(runEvent);
      this.activeRuns.delete(taskId);

      return {
        success: true,
        message: `Run event finalized for task "${taskId}" (duration: ${runEvent.durationMs}ms)`,
        data: {
          eventId: runEvent.eventId,
          taskId: runEvent.taskId,
          intent: runEvent.intent,
          durationMs: runEvent.durationMs,
          violationCount: runEvent.violations.length,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: `Failed to finalize run event for task "${taskId}"`,
      };
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a GuidanceHookProvider and optionally register it on a registry.
 *
 * @param gates - The enforcement gates instance
 * @param retriever - The shard retriever instance
 * @param ledger - The run ledger instance
 * @param registry - Optional registry to auto-register on
 * @returns The provider and (if registry was given) the hook IDs
 */
export function createGuidanceHooks(
  gates: EnforcementGates,
  retriever: ShardRetriever,
  ledger: RunLedger,
  registry?: HookRegistry,
): { provider: GuidanceHookProvider; hookIds: string[] } {
  const provider = new GuidanceHookProvider(gates, retriever, ledger);
  const hookIds = registry ? provider.registerAll(registry) : [];
  return { provider, hookIds };
}

export { gateResultsToHookResult };
