/**
 * Gas Town Bridge Plugin - MCP Tools
 *
 * Implements 20 MCP tools for Gas Town orchestrator integration:
 *
 * Beads Integration (5 tools) - CLI Bridge:
 *   1. gt_beads_create - Create a bead/issue in Beads
 *   2. gt_beads_ready - List ready beads (no blockers)
 *   3. gt_beads_show - Show bead details
 *   4. gt_beads_dep - Manage bead dependencies
 *   5. gt_beads_sync - Sync beads with AgentDB
 *
 * Convoy Operations (3 tools) - CLI Bridge:
 *   6. gt_convoy_create - Create a convoy (work order)
 *   7. gt_convoy_status - Check convoy status
 *   8. gt_convoy_track - Add/remove issues from convoy
 *
 * Formula Engine (4 tools) - WASM Accelerated:
 *   9. gt_formula_list - List available formulas
 *   10. gt_formula_cook - Cook formula into protomolecule (352x faster)
 *   11. gt_formula_execute - Execute a formula
 *   12. gt_formula_create - Create custom formula
 *
 * Orchestration (3 tools) - CLI Bridge:
 *   13. gt_sling - Sling work to an agent
 *   14. gt_agents - List Gas Town agents
 *   15. gt_mail - Send/receive Gas Town mail
 *
 * WASM Computation (5 tools) - Pure WASM:
 *   16. gt_wasm_parse_formula - Parse TOML formula to AST
 *   17. gt_wasm_resolve_deps - Resolve dependency graph
 *   18. gt_wasm_cook_batch - Batch cook multiple formulas
 *   19. gt_wasm_match_pattern - Find similar formulas/beads
 *   20. gt_wasm_optimize_convoy - Optimize convoy execution order
 *
 * Based on ADR-043: Gas Town Bridge Plugin for Claude Flow V3
 *
 * @module v3/plugins/gastown-bridge/mcp-tools
 */

import { z } from 'zod';
import type {
  Bead,
  Convoy,
  Formula,
  FormulaType,
  CookedFormula,
  Step,
  Leg,
  Var,
  GasTownAgent,
  GasTownMail,
  DepAction,
  SyncDirection,
  ConvoyAction,
  MailAction,
  AgentRole,
  TargetAgent,
  ConvoyStrategy,
  DependencyAction,
  FormulaAST,
  DependencyResolution,
  PatternMatch,
  ConvoyOptimization,
  IGasTownBridge,
  IBeadsSyncService,
  IFormulaWasm,
  IDependencyWasm,
} from './types.js';

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface MCPTool<TInput = unknown, TOutput = unknown> {
  /** Tool name (e.g., "gt_beads_create") */
  name: string;
  /** Tool description */
  description: string;
  /** Tool category */
  category: string;
  /** Tool version */
  version: string;
  /** Execution layer (cli, wasm, hybrid) */
  layer: 'cli' | 'wasm' | 'hybrid';
  /** Input schema */
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  /** Handler function */
  handler: (input: TInput, context: ToolContext) => Promise<MCPToolResult<TOutput>>;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  /** Key-value store for cross-tool state */
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  /** Bridge instances */
  bridges: {
    gastown: IGasTownBridge;
    beadsSync: IBeadsSyncService;
    formulaWasm: IFormulaWasm;
    dependencyWasm: IDependencyWasm;
  };
  /** Configuration */
  config: {
    townRoot: string;
    allowedRigs: string[];
    maxBeadsLimit: number;
    maskSecrets: boolean;
    enableWasm: boolean;
  };
}

/**
 * MCP Tool result format
 */
export interface MCPToolResult<T = unknown> {
  content: Array<{ type: 'text'; text: string }>;
  data?: T;
}

// ============================================================================
// Zod Input Schemas
// ============================================================================

// --- Beads Schemas ---

/**
 * Schema for gt_beads_create
 */
export const BeadsCreateInputSchema = z.object({
  /** Bead title */
  title: z.string().min(1).max(500).describe('Bead title'),
  /** Bead description */
  description: z.string().max(10000).optional().describe('Bead description'),
  /** Priority (0 = highest) */
  priority: z.number().int().min(0).max(10).default(2).describe('Priority (0 = highest)'),
  /** Labels for categorization */
  labels: z.array(z.string().max(50)).max(20).optional().describe('Labels for categorization'),
  /** Parent bead ID for epics */
  parent: z.string().max(50).optional().describe('Parent bead ID for epics'),
  /** Rig (repository) to create in */
  rig: z.string().max(100).optional().describe('Rig (repository) to create in'),
});

export type BeadsCreateInput = z.infer<typeof BeadsCreateInputSchema>;

/**
 * Schema for gt_beads_ready
 */
export const BeadsReadyInputSchema = z.object({
  /** Filter by rig */
  rig: z.string().max(100).optional().describe('Filter by rig (repository)'),
  /** Maximum beads to return */
  limit: z.number().int().min(1).max(100).default(10).describe('Maximum beads to return'),
  /** Filter by labels */
  labels: z.array(z.string().max(50)).max(10).optional().describe('Filter by labels'),
});

export type BeadsReadyInput = z.infer<typeof BeadsReadyInputSchema>;

/**
 * Schema for gt_beads_show
 */
export const BeadsShowInputSchema = z.object({
  /** Bead ID to show */
  bead_id: z.string().min(1).max(50).describe('Bead ID to show (e.g., "gt-abc12")'),
});

export type BeadsShowInput = z.infer<typeof BeadsShowInputSchema>;

/**
 * Schema for gt_beads_dep
 */
export const BeadsDepInputSchema = z.object({
  /** Action to perform */
  action: z.enum(['add', 'remove']).describe('Action to perform on dependency'),
  /** Child bead ID (the one that depends) */
  child: z.string().min(1).max(50).describe('Child bead ID (the one that depends)'),
  /** Parent bead ID (the dependency) */
  parent: z.string().min(1).max(50).describe('Parent bead ID (the dependency)'),
});

export type BeadsDepInput = z.infer<typeof BeadsDepInputSchema>;

/**
 * Schema for gt_beads_sync
 */
export const BeadsSyncInputSchema = z.object({
  /** Sync direction */
  direction: z.enum(['pull', 'push', 'both']).default('both').describe('Sync direction'),
  /** Filter by rig */
  rig: z.string().max(100).optional().describe('Filter by rig (repository)'),
  /** AgentDB namespace for sync */
  namespace: z.string().max(100).default('gastown:beads').describe('AgentDB namespace'),
});

export type BeadsSyncInput = z.infer<typeof BeadsSyncInputSchema>;

// --- Convoy Schemas ---

/**
 * Schema for gt_convoy_create
 */
export const ConvoyCreateInputSchema = z.object({
  /** Convoy name */
  name: z.string().min(1).max(200).describe('Convoy name'),
  /** Issue IDs to track */
  issues: z.array(z.string().max(50)).min(1).max(100).describe('Issue IDs to track'),
  /** Convoy description */
  description: z.string().max(5000).optional().describe('Convoy description'),
});

export type ConvoyCreateInput = z.infer<typeof ConvoyCreateInputSchema>;

/**
 * Schema for gt_convoy_status
 */
export const ConvoyStatusInputSchema = z.object({
  /** Convoy ID (optional - shows all if omitted) */
  convoy_id: z.string().max(50).optional().describe('Convoy ID (shows all if omitted)'),
  /** Include detailed progress */
  detailed: z.boolean().default(false).describe('Include detailed progress'),
});

export type ConvoyStatusInput = z.infer<typeof ConvoyStatusInputSchema>;

/**
 * Schema for gt_convoy_track
 */
export const ConvoyTrackInputSchema = z.object({
  /** Convoy ID */
  convoy_id: z.string().min(1).max(50).describe('Convoy ID'),
  /** Action to perform */
  action: z.enum(['add', 'remove']).describe('Action to perform'),
  /** Issue IDs to add/remove */
  issues: z.array(z.string().max(50)).min(1).max(50).describe('Issue IDs to add/remove'),
});

export type ConvoyTrackInput = z.infer<typeof ConvoyTrackInputSchema>;

// --- Formula Schemas ---

/**
 * Schema for gt_formula_list
 */
export const FormulaListInputSchema = z.object({
  /** Filter by formula type */
  type: z.enum(['convoy', 'workflow', 'expansion', 'aspect']).optional()
    .describe('Filter by formula type'),
  /** Include built-in formulas */
  include_builtin: z.boolean().default(true).describe('Include built-in formulas'),
});

export type FormulaListInput = z.infer<typeof FormulaListInputSchema>;

/**
 * Schema for gt_formula_cook
 */
export const FormulaCookInputSchema = z.object({
  /** Formula name or TOML content */
  formula: z.string().min(1).max(50000).describe('Formula name or TOML content'),
  /** Variables for substitution */
  vars: z.record(z.string().max(50), z.string().max(5000)).describe('Variables for substitution'),
  /** Whether formula is TOML content (vs name) */
  is_content: z.boolean().default(false).describe('Whether formula is TOML content (vs name)'),
});

export type FormulaCookInput = z.infer<typeof FormulaCookInputSchema>;

/**
 * Schema for gt_formula_execute
 */
export const FormulaExecuteInputSchema = z.object({
  /** Formula name */
  formula: z.string().min(1).max(200).describe('Formula name'),
  /** Variables for substitution */
  vars: z.record(z.string().max(50), z.string().max(5000)).describe('Variables for substitution'),
  /** Target agent for execution */
  target_agent: z.enum(['polecat', 'crew', 'mayor', 'refinery']).optional()
    .describe('Target agent for execution'),
  /** Dry run (don\'t actually execute) */
  dry_run: z.boolean().default(false).describe('Dry run (don\'t actually execute)'),
});

export type FormulaExecuteInput = z.infer<typeof FormulaExecuteInputSchema>;

/**
 * Schema for gt_formula_create
 */
export const FormulaCreateInputSchema = z.object({
  /** Formula name */
  name: z.string().min(1).max(100).describe('Formula name'),
  /** Formula type */
  type: z.enum(['convoy', 'workflow', 'expansion', 'aspect']).describe('Formula type'),
  /** Workflow steps */
  steps: z.array(z.object({
    id: z.string().min(1).max(50),
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    needs: z.array(z.string().max(50)).optional(),
  })).max(100).optional().describe('Workflow steps'),
  /** Variable definitions */
  vars: z.record(z.string().max(50), z.object({
    default: z.string().max(1000).optional(),
    description: z.string().max(500).optional(),
    required: z.boolean().optional(),
  })).optional().describe('Variable definitions'),
  /** Formula description */
  description: z.string().max(2000).optional().describe('Formula description'),
});

export type FormulaCreateInput = z.infer<typeof FormulaCreateInputSchema>;

// --- Orchestration Schemas ---

/**
 * Schema for gt_sling
 */
export const SlingInputSchema = z.object({
  /** Bead ID to sling */
  bead_id: z.string().min(1).max(50).describe('Bead ID to sling'),
  /** Target agent type */
  target: z.enum(['polecat', 'crew', 'mayor']).describe('Target agent type'),
  /** Optional formula to use */
  formula: z.string().max(200).optional().describe('Optional formula to use'),
  /** Priority override */
  priority: z.number().int().min(0).max(10).optional().describe('Priority override'),
});

export type SlingInput = z.infer<typeof SlingInputSchema>;

/**
 * Schema for gt_agents
 */
export const AgentsInputSchema = z.object({
  /** Filter by rig */
  rig: z.string().max(100).optional().describe('Filter by rig'),
  /** Filter by role */
  role: z.enum(['mayor', 'polecat', 'refinery', 'witness', 'deacon', 'dog', 'crew']).optional()
    .describe('Filter by agent role'),
  /** Include inactive agents */
  include_inactive: z.boolean().default(false).describe('Include inactive agents'),
});

export type AgentsInput = z.infer<typeof AgentsInputSchema>;

/**
 * Schema for gt_mail
 */
export const MailInputSchema = z.object({
  /** Mail action */
  action: z.enum(['send', 'read', 'list']).describe('Mail action'),
  /** Recipient (for send) */
  to: z.string().max(100).optional().describe('Recipient (for send)'),
  /** Subject (for send) */
  subject: z.string().max(500).optional().describe('Subject (for send)'),
  /** Body (for send) */
  body: z.string().max(10000).optional().describe('Body (for send)'),
  /** Mail ID (for read) */
  mail_id: z.string().max(50).optional().describe('Mail ID (for read)'),
  /** Maximum messages to list */
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum messages to list'),
});

export type MailInput = z.infer<typeof MailInputSchema>;

// --- WASM Schemas ---

/**
 * Schema for gt_wasm_parse_formula
 */
export const WasmParseFormulaInputSchema = z.object({
  /** TOML content to parse */
  content: z.string().min(1).max(100000).describe('TOML content to parse'),
  /** Validate against schema */
  validate: z.boolean().default(true).describe('Validate against formula schema'),
});

export type WasmParseFormulaInput = z.infer<typeof WasmParseFormulaInputSchema>;

/**
 * Schema for gt_wasm_resolve_deps
 */
export const WasmResolveDepsInputSchema = z.object({
  /** Beads to analyze */
  beads: z.array(z.object({
    id: z.string().min(1).max(50),
    dependencies: z.array(z.string().max(50)).optional(),
  })).min(1).max(1000).describe('Beads to analyze'),
  /** Analysis action */
  action: z.enum(['topo_sort', 'critical_path', 'cycle_detect']).default('topo_sort')
    .describe('Analysis action'),
});

export type WasmResolveDepsInput = z.infer<typeof WasmResolveDepsInputSchema>;

/**
 * Schema for gt_wasm_cook_batch
 */
export const WasmCookBatchInputSchema = z.object({
  /** Formulas to cook */
  formulas: z.array(z.object({
    name: z.string().min(1).max(100),
    content: z.string().min(1).max(50000),
  })).min(1).max(50).describe('Formulas to cook'),
  /** Variables for each formula */
  vars: z.array(z.record(z.string().max(50), z.string().max(5000))).describe('Variables for each formula'),
  /** Continue on error */
  continue_on_error: z.boolean().default(false).describe('Continue on error'),
});

export type WasmCookBatchInput = z.infer<typeof WasmCookBatchInputSchema>;

/**
 * Schema for gt_wasm_match_pattern
 */
export const WasmMatchPatternInputSchema = z.object({
  /** Search query */
  query: z.string().min(1).max(5000).describe('Search query'),
  /** Candidate patterns to match against */
  candidates: z.array(z.string().max(50000)).min(1).max(1000).describe('Candidate patterns'),
  /** Number of results to return */
  k: z.number().int().min(1).max(100).default(10).describe('Number of results to return'),
  /** Minimum similarity threshold (0-1) */
  threshold: z.number().min(0).max(1).default(0.5).describe('Minimum similarity threshold'),
});

export type WasmMatchPatternInput = z.infer<typeof WasmMatchPatternInputSchema>;

/**
 * Schema for gt_wasm_optimize_convoy
 */
export const WasmOptimizeConvoyInputSchema = z.object({
  /** Convoy ID to optimize */
  convoy_id: z.string().min(1).max(50).describe('Convoy ID to optimize'),
  /** Optimization strategy */
  strategy: z.enum(['parallel', 'serial', 'hybrid']).default('hybrid')
    .describe('Optimization strategy'),
  /** Consider resource constraints */
  resource_constraints: z.object({
    max_parallel: z.number().int().min(1).max(100).optional(),
    agent_capacity: z.record(z.string(), z.number().int().min(1)).optional(),
  }).optional().describe('Resource constraints'),
});

export type WasmOptimizeConvoyInput = z.infer<typeof WasmOptimizeConvoyInputSchema>;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result for bead creation
 */
export interface BeadCreateResult {
  success: boolean;
  bead: Bead;
  durationMs: number;
}

/**
 * Result for beads ready list
 */
export interface BeadsReadyResult {
  success: boolean;
  beads: Bead[];
  total: number;
  durationMs: number;
}

/**
 * Result for bead show
 */
export interface BeadShowResult {
  success: boolean;
  bead: Bead;
  dependencies: string[];
  dependents: string[];
  durationMs: number;
}

/**
 * Result for bead dependency operation
 */
export interface BeadDepResult {
  success: boolean;
  action: DepAction;
  child: string;
  parent: string;
  durationMs: number;
}

/**
 * Result for beads sync
 */
export interface BeadsSyncResult {
  success: boolean;
  direction: SyncDirection;
  pulled: number;
  pushed: number;
  conflicts: number;
  durationMs: number;
}

/**
 * Result for convoy creation
 */
export interface ConvoyCreateResult {
  success: boolean;
  convoy: Convoy;
  durationMs: number;
}

/**
 * Result for convoy status
 */
export interface ConvoyStatusResult {
  success: boolean;
  convoys: Convoy[];
  durationMs: number;
}

/**
 * Result for convoy track
 */
export interface ConvoyTrackResult {
  success: boolean;
  convoy_id: string;
  action: 'add' | 'remove';
  issues_modified: string[];
  durationMs: number;
}

/**
 * Result for formula list
 */
export interface FormulaListResult {
  success: boolean;
  formulas: Array<{
    name: string;
    type: FormulaType;
    description: string;
    builtin: boolean;
  }>;
  durationMs: number;
}

/**
 * Result for formula cook
 */
export interface FormulaCookResult {
  success: boolean;
  cooked: CookedFormula;
  wasmUsed: boolean;
  durationMs: number;
}

/**
 * Result for formula execute
 */
export interface FormulaExecuteResult {
  success: boolean;
  formula: string;
  beads_created: string[];
  target_agent?: string;
  dry_run: boolean;
  durationMs: number;
}

/**
 * Result for formula create
 */
export interface FormulaCreateResult {
  success: boolean;
  name: string;
  path: string;
  durationMs: number;
}

/**
 * Result for sling
 */
export interface SlingResult {
  success: boolean;
  bead_id: string;
  target: TargetAgent;
  formula_used?: string;
  durationMs: number;
}

/**
 * Result for agents list
 */
export interface AgentsResult {
  success: boolean;
  agents: GasTownAgent[];
  durationMs: number;
}

/**
 * Result for mail
 */
export interface MailResult {
  success: boolean;
  action: MailAction;
  messages?: GasTownMail[];
  sent_id?: string;
  durationMs: number;
}

/**
 * Result for WASM formula parse
 */
export interface WasmParseFormulaResult {
  success: boolean;
  ast: FormulaAST;
  wasmPerformanceMs: number;
  durationMs: number;
}

/**
 * Result for WASM dependency resolution
 */
export interface WasmResolveDepsResult {
  success: boolean;
  action: DependencyAction;
  result: DependencyResolution;
  wasmPerformanceMs: number;
  durationMs: number;
}

/**
 * Result for WASM batch cook
 */
export interface WasmCookBatchResult {
  success: boolean;
  cooked: CookedFormula[];
  errors: Array<{ index: number; error: string }>;
  wasmPerformanceMs: number;
  durationMs: number;
}

/**
 * Result for WASM pattern match
 */
export interface WasmMatchPatternResult {
  success: boolean;
  matches: PatternMatch[];
  wasmPerformanceMs: number;
  durationMs: number;
}

/**
 * Result for WASM convoy optimization
 */
export interface WasmOptimizeConvoyResult {
  success: boolean;
  optimization: ConvoyOptimization;
  wasmPerformanceMs: number;
  durationMs: number;
}

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * MCP Tool: gt_beads_create
 *
 * Create a bead/issue in the Beads system
 */
export const beadsCreateTool: MCPTool<BeadsCreateInput, BeadCreateResult> = {
  name: 'gt_beads_create',
  description: 'Create a bead (issue/task) in the Gas Town Beads system with priority and labels',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: BeadsCreateInputSchema,
  handler: async (input, context): Promise<MCPToolResult<BeadCreateResult>> => {
    const startTime = Date.now();

    try {
      const validated = BeadsCreateInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const bead = await bridge.createBead({
        title: validated.title,
        description: validated.description,
        priority: validated.priority,
        labels: validated.labels,
        parent: validated.parent,
        rig: validated.rig,
      });

      const result: BeadCreateResult = {
        success: true,
        bead,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_beads_ready
 *
 * List beads that are ready to work on (no blockers)
 */
export const beadsReadyTool: MCPTool<BeadsReadyInput, BeadsReadyResult> = {
  name: 'gt_beads_ready',
  description: 'List beads that are ready to work on (no unresolved dependencies)',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: BeadsReadyInputSchema,
  handler: async (input, context): Promise<MCPToolResult<BeadsReadyResult>> => {
    const startTime = Date.now();

    try {
      const validated = BeadsReadyInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const limit = Math.min(validated.limit, context.config.maxBeadsLimit);
      const beads = await bridge.getReady(limit, validated.rig, validated.labels);

      const result: BeadsReadyResult = {
        success: true,
        beads,
        total: beads.length,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_beads_show
 *
 * Show detailed information about a specific bead
 */
export const beadsShowTool: MCPTool<BeadsShowInput, BeadShowResult> = {
  name: 'gt_beads_show',
  description: 'Show detailed information about a specific bead including dependencies',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: BeadsShowInputSchema,
  handler: async (input, context): Promise<MCPToolResult<BeadShowResult>> => {
    const startTime = Date.now();

    try {
      const validated = BeadsShowInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const { bead, dependencies, dependents } = await bridge.showBead(validated.bead_id);

      const result: BeadShowResult = {
        success: true,
        bead,
        dependencies,
        dependents,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_beads_dep
 *
 * Manage bead dependencies (add/remove)
 */
export const beadsDepTool: MCPTool<BeadsDepInput, BeadDepResult> = {
  name: 'gt_beads_dep',
  description: 'Add or remove dependencies between beads',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: BeadsDepInputSchema,
  handler: async (input, context): Promise<MCPToolResult<BeadDepResult>> => {
    const startTime = Date.now();

    try {
      const validated = BeadsDepInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      await bridge.manageDependency(validated.action, validated.child, validated.parent);

      const result: BeadDepResult = {
        success: true,
        action: validated.action,
        child: validated.child,
        parent: validated.parent,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_beads_sync
 *
 * Sync beads with AgentDB (bidirectional)
 */
export const beadsSyncTool: MCPTool<BeadsSyncInput, BeadsSyncResult> = {
  name: 'gt_beads_sync',
  description: 'Synchronize beads between Gas Town and Claude Flow AgentDB',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'hybrid',
  inputSchema: BeadsSyncInputSchema,
  handler: async (input, context): Promise<MCPToolResult<BeadsSyncResult>> => {
    const startTime = Date.now();

    try {
      const validated = BeadsSyncInputSchema.parse(input);
      const syncService = context.bridges.beadsSync;

      let pulled = 0;
      let pushed = 0;
      let conflicts = 0;

      if (validated.direction === 'pull' || validated.direction === 'both') {
        const pullResult = await syncService.pullBeads(validated.rig, validated.namespace);
        pulled = pullResult.synced;
        conflicts += pullResult.conflicts;
      }

      if (validated.direction === 'push' || validated.direction === 'both') {
        const pushResult = await syncService.pushTasks(validated.namespace);
        pushed = pushResult.pushed;
        conflicts += pushResult.conflicts;
      }

      const result: BeadsSyncResult = {
        success: true,
        direction: validated.direction,
        pulled,
        pushed,
        conflicts,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_convoy_create
 *
 * Create a convoy (work order) for tracking multiple issues
 */
export const convoyCreateTool: MCPTool<ConvoyCreateInput, ConvoyCreateResult> = {
  name: 'gt_convoy_create',
  description: 'Create a convoy (work order) for tracking and coordinating multiple beads',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: ConvoyCreateInputSchema,
  handler: async (input, context): Promise<MCPToolResult<ConvoyCreateResult>> => {
    const startTime = Date.now();

    try {
      const validated = ConvoyCreateInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const convoy = await bridge.createConvoy({
        name: validated.name,
        issues: validated.issues,
        description: validated.description,
      });

      const result: ConvoyCreateResult = {
        success: true,
        convoy,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_convoy_status
 *
 * Check convoy status (single or all)
 */
export const convoyStatusTool: MCPTool<ConvoyStatusInput, ConvoyStatusResult> = {
  name: 'gt_convoy_status',
  description: 'Check the status of one or all convoys including progress metrics',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: ConvoyStatusInputSchema,
  handler: async (input, context): Promise<MCPToolResult<ConvoyStatusResult>> => {
    const startTime = Date.now();

    try {
      const validated = ConvoyStatusInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const convoys = await bridge.getConvoyStatus(validated.convoy_id, validated.detailed);

      const result: ConvoyStatusResult = {
        success: true,
        convoys,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_convoy_track
 *
 * Add or remove issues from a convoy
 */
export const convoyTrackTool: MCPTool<ConvoyTrackInput, ConvoyTrackResult> = {
  name: 'gt_convoy_track',
  description: 'Add or remove issues from an existing convoy',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: ConvoyTrackInputSchema,
  handler: async (input, context): Promise<MCPToolResult<ConvoyTrackResult>> => {
    const startTime = Date.now();

    try {
      const validated = ConvoyTrackInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      await bridge.trackConvoy(validated.convoy_id, validated.action, validated.issues);

      const result: ConvoyTrackResult = {
        success: true,
        convoy_id: validated.convoy_id,
        action: validated.action,
        issues_modified: validated.issues,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_formula_list
 *
 * List available formulas
 */
export const formulaListTool: MCPTool<FormulaListInput, FormulaListResult> = {
  name: 'gt_formula_list',
  description: 'List available Gas Town formulas with optional type filter',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: FormulaListInputSchema,
  handler: async (input, context): Promise<MCPToolResult<FormulaListResult>> => {
    const startTime = Date.now();

    try {
      const validated = FormulaListInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const formulas = await bridge.listFormulas(validated.type, validated.include_builtin);

      const result: FormulaListResult = {
        success: true,
        formulas,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_formula_cook
 *
 * Cook a formula with variable substitution (352x faster with WASM)
 */
export const formulaCookTool: MCPTool<FormulaCookInput, FormulaCookResult> = {
  name: 'gt_formula_cook',
  description: 'Cook a formula into a protomolecule with variable substitution (WASM accelerated)',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: FormulaCookInputSchema,
  handler: async (input, context): Promise<MCPToolResult<FormulaCookResult>> => {
    const startTime = Date.now();

    try {
      const validated = FormulaCookInputSchema.parse(input);
      let wasmUsed = false;
      let cooked: CookedFormula;

      // Try WASM first if enabled
      if (context.config.enableWasm) {
        try {
          const formulaWasm = context.bridges.formulaWasm;
          if (formulaWasm.isInitialized()) {
            cooked = await formulaWasm.cookFormula(validated.formula, validated.vars, validated.is_content);
            wasmUsed = true;
          } else {
            // Fallback to CLI
            const bridge = context.bridges.gastown;
            cooked = await bridge.cookFormula(validated.formula, validated.vars);
          }
        } catch {
          // Fallback to CLI on WASM error
          const bridge = context.bridges.gastown;
          cooked = await bridge.cookFormula(validated.formula, validated.vars);
        }
      } else {
        const bridge = context.bridges.gastown;
        cooked = await bridge.cookFormula(validated.formula, validated.vars);
      }

      const result: FormulaCookResult = {
        success: true,
        cooked,
        wasmUsed,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_formula_execute
 *
 * Execute a formula (creates beads/molecules)
 */
export const formulaExecuteTool: MCPTool<FormulaExecuteInput, FormulaExecuteResult> = {
  name: 'gt_formula_execute',
  description: 'Execute a formula to create beads/molecules in Gas Town',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'hybrid',
  inputSchema: FormulaExecuteInputSchema,
  handler: async (input, context): Promise<MCPToolResult<FormulaExecuteResult>> => {
    const startTime = Date.now();

    try {
      const validated = FormulaExecuteInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const { beads_created } = await bridge.executeFormula(
        validated.formula,
        validated.vars,
        validated.target_agent,
        validated.dry_run
      );

      const result: FormulaExecuteResult = {
        success: true,
        formula: validated.formula,
        beads_created,
        target_agent: validated.target_agent,
        dry_run: validated.dry_run,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_formula_create
 *
 * Create a custom formula
 */
export const formulaCreateTool: MCPTool<FormulaCreateInput, FormulaCreateResult> = {
  name: 'gt_formula_create',
  description: 'Create a custom formula definition',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: FormulaCreateInputSchema,
  handler: async (input, context): Promise<MCPToolResult<FormulaCreateResult>> => {
    const startTime = Date.now();

    try {
      const validated = FormulaCreateInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      // Map steps to ensure description is always a string (Step type requires it)
      const mappedSteps = validated.steps?.map(s => ({
        id: s.id,
        title: s.title,
        description: s.description ?? '', // Provide default empty string
        needs: s.needs,
      }));

      const { path } = await bridge.createFormula({
        name: validated.name,
        type: validated.type,
        steps: mappedSteps,
        vars: validated.vars,
        description: validated.description,
      });

      const result: FormulaCreateResult = {
        success: true,
        name: validated.name,
        path,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_sling
 *
 * Sling work to a Gas Town agent
 */
export const slingTool: MCPTool<SlingInput, SlingResult> = {
  name: 'gt_sling',
  description: 'Sling (assign) a bead to a Gas Town agent for processing',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: SlingInputSchema,
  handler: async (input, context): Promise<MCPToolResult<SlingResult>> => {
    const startTime = Date.now();

    try {
      const validated = SlingInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      await bridge.sling(validated.bead_id, validated.target, validated.formula, validated.priority);

      const result: SlingResult = {
        success: true,
        bead_id: validated.bead_id,
        target: validated.target,
        formula_used: validated.formula,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_agents
 *
 * List Gas Town agents
 */
export const agentsTool: MCPTool<AgentsInput, AgentsResult> = {
  name: 'gt_agents',
  description: 'List Gas Town agents with optional role and rig filters',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: AgentsInputSchema,
  handler: async (input, context): Promise<MCPToolResult<AgentsResult>> => {
    const startTime = Date.now();

    try {
      const validated = AgentsInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      const agents = await bridge.listAgents(validated.rig, validated.role, validated.include_inactive);

      const result: AgentsResult = {
        success: true,
        agents,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_mail
 *
 * Send/receive Gas Town mail
 */
export const mailTool: MCPTool<MailInput, MailResult> = {
  name: 'gt_mail',
  description: 'Send, read, or list Gas Town internal mail messages',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'cli',
  inputSchema: MailInputSchema,
  handler: async (input, context): Promise<MCPToolResult<MailResult>> => {
    const startTime = Date.now();

    try {
      const validated = MailInputSchema.parse(input);
      const bridge = context.bridges.gastown;

      let messages: GasTownMail[] | undefined;
      let sent_id: string | undefined;

      switch (validated.action) {
        case 'send':
          if (!validated.to || !validated.subject || !validated.body) {
            throw new Error('send action requires to, subject, and body');
          }
          sent_id = await bridge.sendMail(validated.to, validated.subject, validated.body);
          break;
        case 'read':
          if (!validated.mail_id) {
            throw new Error('read action requires mail_id');
          }
          messages = [await bridge.readMail(validated.mail_id)];
          break;
        case 'list':
          messages = await bridge.listMail(validated.limit);
          break;
      }

      const result: MailResult = {
        success: true,
        action: validated.action,
        messages,
        sent_id,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_wasm_parse_formula
 *
 * Parse TOML formula to AST (352x faster than JS)
 */
export const wasmParseFormulaTool: MCPTool<WasmParseFormulaInput, WasmParseFormulaResult> = {
  name: 'gt_wasm_parse_formula',
  description: 'Parse TOML formula content to AST using WASM (352x faster than JavaScript)',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: WasmParseFormulaInputSchema,
  handler: async (input, context): Promise<MCPToolResult<WasmParseFormulaResult>> => {
    const startTime = Date.now();

    try {
      const validated = WasmParseFormulaInputSchema.parse(input);
      const formulaWasm = context.bridges.formulaWasm;

      if (!formulaWasm.isInitialized()) {
        await formulaWasm.initialize();
      }

      const wasmStart = Date.now();
      const ast = await formulaWasm.parseFormula(validated.content, validated.validate);
      const wasmDuration = Date.now() - wasmStart;

      const result: WasmParseFormulaResult = {
        success: true,
        ast,
        wasmPerformanceMs: wasmDuration,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_wasm_resolve_deps
 *
 * Resolve dependency graph using WASM (150x faster than JS)
 */
export const wasmResolveDepsTool: MCPTool<WasmResolveDepsInput, WasmResolveDepsResult> = {
  name: 'gt_wasm_resolve_deps',
  description: 'Resolve bead dependencies using WASM (topological sort, cycle detection, critical path)',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: WasmResolveDepsInputSchema,
  handler: async (input, context): Promise<MCPToolResult<WasmResolveDepsResult>> => {
    const startTime = Date.now();

    try {
      const validated = WasmResolveDepsInputSchema.parse(input);
      const depWasm = context.bridges.dependencyWasm;

      if (!depWasm.isInitialized()) {
        await depWasm.initialize();
      }

      const wasmStart = Date.now();
      const resolution = await depWasm.resolveDependencies(validated.beads, validated.action);
      const wasmDuration = Date.now() - wasmStart;

      const result: WasmResolveDepsResult = {
        success: true,
        action: validated.action,
        result: resolution,
        wasmPerformanceMs: wasmDuration,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_wasm_cook_batch
 *
 * Batch cook multiple formulas using WASM (352x faster than JS)
 */
export const wasmCookBatchTool: MCPTool<WasmCookBatchInput, WasmCookBatchResult> = {
  name: 'gt_wasm_cook_batch',
  description: 'Batch cook multiple formulas using WASM for maximum performance',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: WasmCookBatchInputSchema,
  handler: async (input, context): Promise<MCPToolResult<WasmCookBatchResult>> => {
    const startTime = Date.now();

    try {
      const validated = WasmCookBatchInputSchema.parse(input);
      const formulaWasm = context.bridges.formulaWasm;

      if (!formulaWasm.isInitialized()) {
        await formulaWasm.initialize();
      }

      const wasmStart = Date.now();
      const { cooked, errors } = await formulaWasm.cookBatch(
        validated.formulas,
        validated.vars,
        validated.continue_on_error
      );
      const wasmDuration = Date.now() - wasmStart;

      const result: WasmCookBatchResult = {
        success: errors.length === 0 || validated.continue_on_error,
        cooked,
        errors,
        wasmPerformanceMs: wasmDuration,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_wasm_match_pattern
 *
 * Find similar formulas/beads using WASM (150x-12500x faster with HNSW)
 */
export const wasmMatchPatternTool: MCPTool<WasmMatchPatternInput, WasmMatchPatternResult> = {
  name: 'gt_wasm_match_pattern',
  description: 'Find similar formulas or beads using HNSW pattern matching (150x-12500x faster)',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: WasmMatchPatternInputSchema,
  handler: async (input, context): Promise<MCPToolResult<WasmMatchPatternResult>> => {
    const startTime = Date.now();

    try {
      const validated = WasmMatchPatternInputSchema.parse(input);
      const depWasm = context.bridges.dependencyWasm;

      if (!depWasm.isInitialized()) {
        await depWasm.initialize();
      }

      const wasmStart = Date.now();
      const matches = await depWasm.matchPatterns(
        validated.query,
        validated.candidates,
        validated.k,
        validated.threshold
      );
      const wasmDuration = Date.now() - wasmStart;

      const result: WasmMatchPatternResult = {
        success: true,
        matches,
        wasmPerformanceMs: wasmDuration,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

/**
 * MCP Tool: gt_wasm_optimize_convoy
 *
 * Optimize convoy execution order using WASM (150x faster than JS)
 */
export const wasmOptimizeConvoyTool: MCPTool<WasmOptimizeConvoyInput, WasmOptimizeConvoyResult> = {
  name: 'gt_wasm_optimize_convoy',
  description: 'Optimize convoy execution order using WASM graph algorithms',
  category: 'gastown-bridge',
  version: '0.1.0',
  layer: 'wasm',
  inputSchema: WasmOptimizeConvoyInputSchema,
  handler: async (input, context): Promise<MCPToolResult<WasmOptimizeConvoyResult>> => {
    const startTime = Date.now();

    try {
      const validated = WasmOptimizeConvoyInputSchema.parse(input);
      const depWasm = context.bridges.dependencyWasm;
      const bridge = context.bridges.gastown;

      if (!depWasm.isInitialized()) {
        await depWasm.initialize();
      }

      // Get convoy details
      const convoys = await bridge.getConvoyStatus(validated.convoy_id, true);
      if (convoys.length === 0) {
        throw new Error(`Convoy not found: ${validated.convoy_id}`);
      }

      const convoy = convoys[0];

      const wasmStart = Date.now();
      const optimization = await depWasm.optimizeConvoy(
        convoy,
        validated.strategy,
        validated.resource_constraints
      );
      const wasmDuration = Date.now() - wasmStart;

      const result: WasmOptimizeConvoyResult = {
        success: true,
        optimization,
        wasmPerformanceMs: wasmDuration,
        durationMs: Date.now() - startTime,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: errorMessage,
            durationMs: Date.now() - startTime,
          }, null, 2),
        }],
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All Gas Town Bridge MCP Tools (20 total)
 */
export const gasTownBridgeTools: MCPTool[] = [
  // Beads Integration (5 tools) - CLI Bridge
  beadsCreateTool as unknown as MCPTool,
  beadsReadyTool as unknown as MCPTool,
  beadsShowTool as unknown as MCPTool,
  beadsDepTool as unknown as MCPTool,
  beadsSyncTool as unknown as MCPTool,

  // Convoy Operations (3 tools) - CLI Bridge
  convoyCreateTool as unknown as MCPTool,
  convoyStatusTool as unknown as MCPTool,
  convoyTrackTool as unknown as MCPTool,

  // Formula Engine (4 tools) - WASM Accelerated
  formulaListTool as unknown as MCPTool,
  formulaCookTool as unknown as MCPTool,
  formulaExecuteTool as unknown as MCPTool,
  formulaCreateTool as unknown as MCPTool,

  // Orchestration (3 tools) - CLI Bridge
  slingTool as unknown as MCPTool,
  agentsTool as unknown as MCPTool,
  mailTool as unknown as MCPTool,

  // WASM Computation (5 tools) - Pure WASM
  wasmParseFormulaTool as unknown as MCPTool,
  wasmResolveDepsTool as unknown as MCPTool,
  wasmCookBatchTool as unknown as MCPTool,
  wasmMatchPatternTool as unknown as MCPTool,
  wasmOptimizeConvoyTool as unknown as MCPTool,
];

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>([
  // Beads tools
  ['gt_beads_create', beadsCreateTool.handler as MCPTool['handler']],
  ['gt_beads_ready', beadsReadyTool.handler as MCPTool['handler']],
  ['gt_beads_show', beadsShowTool.handler as MCPTool['handler']],
  ['gt_beads_dep', beadsDepTool.handler as MCPTool['handler']],
  ['gt_beads_sync', beadsSyncTool.handler as MCPTool['handler']],

  // Convoy tools
  ['gt_convoy_create', convoyCreateTool.handler as MCPTool['handler']],
  ['gt_convoy_status', convoyStatusTool.handler as MCPTool['handler']],
  ['gt_convoy_track', convoyTrackTool.handler as MCPTool['handler']],

  // Formula tools
  ['gt_formula_list', formulaListTool.handler as MCPTool['handler']],
  ['gt_formula_cook', formulaCookTool.handler as MCPTool['handler']],
  ['gt_formula_execute', formulaExecuteTool.handler as MCPTool['handler']],
  ['gt_formula_create', formulaCreateTool.handler as MCPTool['handler']],

  // Orchestration tools
  ['gt_sling', slingTool.handler as MCPTool['handler']],
  ['gt_agents', agentsTool.handler as MCPTool['handler']],
  ['gt_mail', mailTool.handler as MCPTool['handler']],

  // WASM tools
  ['gt_wasm_parse_formula', wasmParseFormulaTool.handler as MCPTool['handler']],
  ['gt_wasm_resolve_deps', wasmResolveDepsTool.handler as MCPTool['handler']],
  ['gt_wasm_cook_batch', wasmCookBatchTool.handler as MCPTool['handler']],
  ['gt_wasm_match_pattern', wasmMatchPatternTool.handler as MCPTool['handler']],
  ['gt_wasm_optimize_convoy', wasmOptimizeConvoyTool.handler as MCPTool['handler']],
]);

/**
 * Tool categories for documentation
 */
export const toolCategories = {
  beads: ['gt_beads_create', 'gt_beads_ready', 'gt_beads_show', 'gt_beads_dep', 'gt_beads_sync'],
  convoy: ['gt_convoy_create', 'gt_convoy_status', 'gt_convoy_track'],
  formula: ['gt_formula_list', 'gt_formula_cook', 'gt_formula_execute', 'gt_formula_create'],
  orchestration: ['gt_sling', 'gt_agents', 'gt_mail'],
  wasm: ['gt_wasm_parse_formula', 'gt_wasm_resolve_deps', 'gt_wasm_cook_batch', 'gt_wasm_match_pattern', 'gt_wasm_optimize_convoy'],
};

/**
 * Get tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return gasTownBridgeTools.find(t => t.name === name);
}

/**
 * Get tools by layer
 */
export function getToolsByLayer(layer: 'cli' | 'wasm' | 'hybrid'): MCPTool[] {
  return gasTownBridgeTools.filter(t => t.layer === layer);
}

export default gasTownBridgeTools;
