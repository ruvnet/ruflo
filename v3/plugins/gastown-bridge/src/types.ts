/**
 * Gas Town Bridge Plugin - Type Definitions
 *
 * Core types for Gas Town integration including:
 * - Beads: Git-backed issue tracking with graph semantics
 * - Formulas: TOML-defined workflows (convoy, workflow, expansion, aspect)
 * - Convoys: Work-order tracking for slung work
 * - Steps/Legs: Workflow components
 * - Variables: Template substitution
 *
 * @module gastown-bridge/types
 * @version 0.1.0
 */

import { z } from 'zod';

// ============================================================================
// Bead Types (matching Gas Town's beads.db schema)
// ============================================================================

/**
 * Bead status enumeration
 */
export type BeadStatus = 'open' | 'in_progress' | 'closed';

/**
 * Bead - Git-backed issue with graph semantics
 */
export interface Bead {
  /** Unique identifier (e.g., "gt-abc12") */
  readonly id: string;
  /** Issue title */
  readonly title: string;
  /** Issue description */
  readonly description: string;
  /** Current status */
  readonly status: BeadStatus;
  /** Priority (0 = highest) */
  readonly priority: number;
  /** Issue labels */
  readonly labels: string[];
  /** Parent bead ID (for epics) */
  readonly parentId?: string;
  /** Creation timestamp */
  readonly createdAt: Date;
  /** Last update timestamp */
  readonly updatedAt: Date;
  /** Assigned agent/user */
  readonly assignee?: string;
  /** Gas Town rig name */
  readonly rig?: string;
  /** Blocking beads (dependencies) */
  readonly blockedBy?: string[];
  /** Beads this blocks */
  readonly blocks?: string[];
}

/**
 * Options for creating a new bead
 */
export interface CreateBeadOptions {
  readonly title: string;
  readonly description?: string;
  readonly priority?: number;
  readonly labels?: string[];
  readonly parent?: string;
  readonly rig?: string;
  readonly assignee?: string;
}

/**
 * Bead dependency relationship
 */
export interface BeadDependency {
  readonly child: string;
  readonly parent: string;
  readonly type: 'blocks' | 'relates' | 'duplicates';
}

// ============================================================================
// Formula Types (matching Gas Town's formula/types.go)
// ============================================================================

/**
 * Formula type enumeration
 */
export type FormulaType = 'convoy' | 'workflow' | 'expansion' | 'aspect';

/**
 * Workflow step definition
 */
export interface Step {
  /** Step identifier */
  readonly id: string;
  /** Step title */
  readonly title: string;
  /** Step description */
  readonly description: string;
  /** Dependencies - step IDs that must complete first */
  readonly needs?: string[];
  /** Estimated duration in minutes */
  readonly duration?: number;
  /** Required capabilities */
  readonly requires?: string[];
  /** Step metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Convoy leg definition
 */
export interface Leg {
  /** Leg identifier */
  readonly id: string;
  /** Leg title */
  readonly title: string;
  /** Focus area */
  readonly focus: string;
  /** Leg description */
  readonly description: string;
  /** Assigned agent type */
  readonly agent?: string;
  /** Leg sequence order */
  readonly order?: number;
}

/**
 * Formula variable definition
 */
export interface Var {
  /** Variable name */
  readonly name: string;
  /** Variable description */
  readonly description?: string;
  /** Default value */
  readonly default?: string;
  /** Whether the variable is required */
  readonly required?: boolean;
  /** Validation pattern (regex) */
  readonly pattern?: string;
  /** Allowed values */
  readonly enum?: string[];
}

/**
 * Synthesis definition (convoy result combination)
 */
export interface Synthesis {
  /** Synthesis strategy */
  readonly strategy: 'merge' | 'sequential' | 'parallel';
  /** Output format */
  readonly format?: string;
  /** Synthesis description */
  readonly description?: string;
}

/**
 * Template for expansion formulas
 */
export interface Template {
  /** Template name */
  readonly name: string;
  /** Template content with variable placeholders */
  readonly content: string;
  /** Output path pattern */
  readonly outputPath?: string;
}

/**
 * Aspect definition for cross-cutting concerns
 */
export interface Aspect {
  /** Aspect name */
  readonly name: string;
  /** Pointcut expression */
  readonly pointcut: string;
  /** Advice to apply */
  readonly advice: string;
  /** Aspect type */
  readonly type: 'before' | 'after' | 'around';
}

/**
 * Formula - TOML-defined workflow specification
 */
export interface Formula {
  /** Formula name */
  readonly name: string;
  /** Formula description */
  readonly description: string;
  /** Formula type */
  readonly type: FormulaType;
  /** Formula version */
  readonly version: number;

  // Convoy-specific fields
  /** Convoy legs */
  readonly legs?: Leg[];
  /** Synthesis configuration */
  readonly synthesis?: Synthesis;

  // Workflow-specific fields
  /** Workflow steps */
  readonly steps?: Step[];
  /** Variable definitions */
  readonly vars?: Record<string, Var>;

  // Expansion-specific fields
  /** Expansion templates */
  readonly templates?: Template[];

  // Aspect-specific fields
  /** Cross-cutting aspects */
  readonly aspects?: Aspect[];

  /** Formula metadata */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Cooked formula with variables substituted
 */
export interface CookedFormula extends Formula {
  /** When the formula was cooked */
  readonly cookedAt: Date;
  /** Variables used for cooking */
  readonly cookedVars: Record<string, string>;
  /** Original (uncooked) formula name */
  readonly originalName: string;
}

// ============================================================================
// Convoy Types
// ============================================================================

/**
 * Convoy status enumeration
 */
export type ConvoyStatus = 'active' | 'landed' | 'failed' | 'paused';

/**
 * Convoy progress tracking
 */
export interface ConvoyProgress {
  /** Total issues tracked */
  readonly total: number;
  /** Closed issues */
  readonly closed: number;
  /** In-progress issues */
  readonly inProgress: number;
  /** Blocked issues */
  readonly blocked: number;
}

/**
 * Convoy - Work order tracking for slung work
 */
export interface Convoy {
  /** Convoy identifier */
  readonly id: string;
  /** Convoy name */
  readonly name: string;
  /** Tracked issue IDs */
  readonly trackedIssues: string[];
  /** Convoy status */
  readonly status: ConvoyStatus;
  /** Start timestamp */
  readonly startedAt: Date;
  /** Completion timestamp */
  readonly completedAt?: Date;
  /** Progress tracking */
  readonly progress: ConvoyProgress;
  /** Formula used to create convoy */
  readonly formula?: string;
  /** Description */
  readonly description?: string;
}

/**
 * Options for creating a convoy
 */
export interface CreateConvoyOptions {
  readonly name: string;
  readonly issues: string[];
  readonly description?: string;
  readonly formula?: string;
}

// ============================================================================
// Agent Types (Gas Town specific)
// ============================================================================

/**
 * Gas Town agent role
 */
export type GasTownAgentRole =
  | 'mayor'
  | 'polecat'
  | 'refinery'
  | 'witness'
  | 'deacon'
  | 'dog'
  | 'crew';

/**
 * Gas Town agent
 */
export interface GasTownAgent {
  /** Agent name */
  readonly name: string;
  /** Agent role */
  readonly role: GasTownAgentRole;
  /** Rig assignment */
  readonly rig?: string;
  /** Current status */
  readonly status: 'active' | 'idle' | 'busy';
  /** Agent capabilities */
  readonly capabilities?: string[];
}

// ============================================================================
// Sling Types
// ============================================================================

/**
 * Sling target type
 */
export type SlingTarget = 'polecat' | 'crew' | 'mayor';

/**
 * Sling operation options
 */
export interface SlingOptions {
  readonly beadId: string;
  readonly target: SlingTarget;
  readonly formula?: string;
  readonly priority?: number;
}

// ============================================================================
// Mail Types
// ============================================================================

/**
 * Gas Town mail message
 */
export interface GasTownMail {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly sentAt: Date;
  readonly read: boolean;
}

// ============================================================================
// Sync Types
// ============================================================================

/**
 * Sync direction
 */
export type SyncDirection = 'pull' | 'push' | 'both';

/**
 * Sync result
 */
export interface SyncResult {
  readonly direction: SyncDirection;
  readonly pulled: number;
  readonly pushed: number;
  readonly errors: string[];
  readonly timestamp: Date;
}

// ============================================================================
// Graph Types (for dependency resolution)
// ============================================================================

/**
 * Dependency graph for beads
 */
export interface BeadGraph {
  readonly nodes: string[];
  readonly edges: Array<[string, string]>;
}

/**
 * Topological sort result
 */
export interface TopoSortResult {
  readonly sorted: string[];
  readonly hasCycle: boolean;
  readonly cycleNodes?: string[];
}

/**
 * Critical path result
 */
export interface CriticalPathResult {
  readonly path: string[];
  readonly totalDuration: number;
  readonly slack: Map<string, number>;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Gas Town Bridge plugin configuration
 */
export interface GasTownConfig {
  /** Path to Gas Town installation */
  readonly townRoot: string;

  /** Enable Beads sync with AgentDB */
  readonly enableBeadsSync: boolean;
  /** Sync interval in milliseconds */
  readonly syncInterval: number;

  /** Enable native formula parsing (WASM) */
  readonly nativeFormulas: boolean;

  /** Enable convoy tracking */
  readonly enableConvoys: boolean;

  /** Auto-create beads from Claude Flow tasks */
  readonly autoCreateBeads: boolean;

  /** Enable GUPP integration */
  readonly enableGUPP: boolean;
  /** GUPP check interval in milliseconds */
  readonly guppCheckInterval: number;

  /** CLI timeout in milliseconds */
  readonly cliTimeout: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: GasTownConfig = {
  townRoot: '~/gt',
  enableBeadsSync: true,
  syncInterval: 60000,
  nativeFormulas: true,
  enableConvoys: true,
  autoCreateBeads: false,
  enableGUPP: false,
  guppCheckInterval: 5000,
  cliTimeout: 30000,
};

// ============================================================================
// Error Types
// ============================================================================

/**
 * Gas Town Bridge error codes
 */
export const GasTownErrorCodes = {
  CLI_NOT_FOUND: 'GT_CLI_NOT_FOUND',
  CLI_TIMEOUT: 'GT_CLI_TIMEOUT',
  CLI_ERROR: 'GT_CLI_ERROR',
  BEAD_NOT_FOUND: 'GT_BEAD_NOT_FOUND',
  CONVOY_NOT_FOUND: 'GT_CONVOY_NOT_FOUND',
  FORMULA_NOT_FOUND: 'GT_FORMULA_NOT_FOUND',
  FORMULA_PARSE_ERROR: 'GT_FORMULA_PARSE_ERROR',
  WASM_NOT_INITIALIZED: 'GT_WASM_NOT_INITIALIZED',
  SYNC_ERROR: 'GT_SYNC_ERROR',
  DEPENDENCY_CYCLE: 'GT_DEPENDENCY_CYCLE',
  INVALID_SLING_TARGET: 'GT_INVALID_SLING_TARGET',
} as const;

export type GasTownErrorCode = (typeof GasTownErrorCodes)[keyof typeof GasTownErrorCodes];

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Bead status schema
 */
export const BeadStatusSchema = z.enum(['open', 'in_progress', 'closed']);

/**
 * Bead schema
 */
export const BeadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: BeadStatusSchema,
  priority: z.number().int().min(0),
  labels: z.array(z.string()),
  parentId: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  assignee: z.string().optional(),
  rig: z.string().optional(),
  blockedBy: z.array(z.string()).optional(),
  blocks: z.array(z.string()).optional(),
});

/**
 * Create bead options schema
 */
export const CreateBeadOptionsSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.number().int().min(0).optional(),
  labels: z.array(z.string()).optional(),
  parent: z.string().optional(),
  rig: z.string().optional(),
  assignee: z.string().optional(),
});

/**
 * Formula type schema
 */
export const FormulaTypeSchema = z.enum(['convoy', 'workflow', 'expansion', 'aspect']);

/**
 * Step schema
 */
export const StepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  needs: z.array(z.string()).optional(),
  duration: z.number().optional(),
  requires: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Leg schema
 */
export const LegSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  focus: z.string(),
  description: z.string(),
  agent: z.string().optional(),
  order: z.number().optional(),
});

/**
 * Variable schema
 */
export const VarSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

/**
 * Synthesis schema
 */
export const SynthesisSchema = z.object({
  strategy: z.enum(['merge', 'sequential', 'parallel']),
  format: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Template schema
 */
export const TemplateSchema = z.object({
  name: z.string().min(1),
  content: z.string(),
  outputPath: z.string().optional(),
});

/**
 * Aspect schema
 */
export const AspectSchema = z.object({
  name: z.string().min(1),
  pointcut: z.string(),
  advice: z.string(),
  type: z.enum(['before', 'after', 'around']),
});

/**
 * Formula schema
 */
export const FormulaSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: FormulaTypeSchema,
  version: z.number().int().min(1),
  legs: z.array(LegSchema).optional(),
  synthesis: SynthesisSchema.optional(),
  steps: z.array(StepSchema).optional(),
  vars: z.record(VarSchema).optional(),
  templates: z.array(TemplateSchema).optional(),
  aspects: z.array(AspectSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Convoy status schema
 */
export const ConvoyStatusSchema = z.enum(['active', 'landed', 'failed', 'paused']);

/**
 * Convoy progress schema
 */
export const ConvoyProgressSchema = z.object({
  total: z.number().int().min(0),
  closed: z.number().int().min(0),
  inProgress: z.number().int().min(0),
  blocked: z.number().int().min(0),
});

/**
 * Convoy schema
 */
export const ConvoySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  trackedIssues: z.array(z.string()),
  status: ConvoyStatusSchema,
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().optional(),
  progress: ConvoyProgressSchema,
  formula: z.string().optional(),
  description: z.string().optional(),
});

/**
 * Create convoy options schema
 */
export const CreateConvoyOptionsSchema = z.object({
  name: z.string().min(1),
  issues: z.array(z.string()).min(1),
  description: z.string().optional(),
  formula: z.string().optional(),
});

/**
 * Gas Town agent role schema
 */
export const GasTownAgentRoleSchema = z.enum([
  'mayor',
  'polecat',
  'refinery',
  'witness',
  'deacon',
  'dog',
  'crew',
]);

/**
 * Sling target schema
 */
export const SlingTargetSchema = z.enum(['polecat', 'crew', 'mayor']);

/**
 * Sling options schema
 */
export const SlingOptionsSchema = z.object({
  beadId: z.string().min(1),
  target: SlingTargetSchema,
  formula: z.string().optional(),
  priority: z.number().int().min(0).optional(),
});

/**
 * Sync direction schema
 */
export const SyncDirectionSchema = z.enum(['pull', 'push', 'both']);

/**
 * Configuration schema
 */
export const GasTownConfigSchema = z.object({
  townRoot: z.string().default('~/gt'),
  enableBeadsSync: z.boolean().default(true),
  syncInterval: z.number().int().positive().default(60000),
  nativeFormulas: z.boolean().default(true),
  enableConvoys: z.boolean().default(true),
  autoCreateBeads: z.boolean().default(false),
  enableGUPP: z.boolean().default(false),
  guppCheckInterval: z.number().int().positive().default(5000),
  cliTimeout: z.number().int().positive().default(30000),
});

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate bead
 */
export function validateBead(input: unknown): Bead {
  return BeadSchema.parse(input) as Bead;
}

/**
 * Validate create bead options
 */
export function validateCreateBeadOptions(input: unknown): CreateBeadOptions {
  return CreateBeadOptionsSchema.parse(input);
}

/**
 * Validate formula
 */
export function validateFormula(input: unknown): Formula {
  return FormulaSchema.parse(input) as Formula;
}

/**
 * Validate convoy
 */
export function validateConvoy(input: unknown): Convoy {
  return ConvoySchema.parse(input) as Convoy;
}

/**
 * Validate create convoy options
 */
export function validateCreateConvoyOptions(input: unknown): CreateConvoyOptions {
  return CreateConvoyOptionsSchema.parse(input);
}

/**
 * Validate sling options
 */
export function validateSlingOptions(input: unknown): SlingOptions {
  return SlingOptionsSchema.parse(input);
}

/**
 * Validate configuration
 */
export function validateConfig(input: unknown): GasTownConfig {
  return GasTownConfigSchema.parse(input);
}

// ============================================================================
// Additional Types for MCP Tools
// ============================================================================

/**
 * Dependency action type
 */
export type DepAction = 'add' | 'remove';

/**
 * Convoy action type
 */
export type ConvoyAction = 'create' | 'track' | 'land' | 'pause' | 'resume';

/**
 * Mail action type
 */
export type MailAction = 'send' | 'read' | 'list';

/**
 * Agent role type (alias for GasTownAgentRole)
 */
export type AgentRole = GasTownAgentRole;

/**
 * Target agent type (alias for SlingTarget)
 */
export type TargetAgent = SlingTarget;

/**
 * Convoy strategy type
 */
export type ConvoyStrategy = 'fastest' | 'balanced' | 'throughput' | 'minimal_context_switches';

/**
 * Dependency action type (for graph operations)
 */
export type DependencyAction = 'topo_sort' | 'cycle_detect' | 'critical_path';

/**
 * Formula AST (Abstract Syntax Tree) - alias for Formula
 */
export type FormulaAST = Formula;

/**
 * Dependency resolution result
 */
export interface DependencyResolution {
  readonly action: DependencyAction;
  readonly sorted?: string[];
  readonly hasCycle?: boolean;
  readonly cycleNodes?: string[];
  readonly criticalPath?: string[];
  readonly totalDuration?: number;
}

/**
 * Pattern match result
 */
export interface PatternMatch {
  readonly index: number;
  readonly candidate: string;
  readonly similarity: number;
}

/**
 * Convoy optimization result
 */
export interface ConvoyOptimization {
  readonly convoyId: string;
  readonly strategy: string;
  readonly executionOrder: string[];
  readonly parallelGroups: string[][];
  readonly estimatedDuration: number;
}

// ============================================================================
// Interface Types for MCP Tools
// ============================================================================

/**
 * Gas Town Bridge interface
 */
export interface IGasTownBridge {
  createBead(opts: CreateBeadOptions): Promise<Bead>;
  getReady(limit?: number, rig?: string, labels?: string[]): Promise<Bead[]>;
  showBead(beadId: string): Promise<{ bead: Bead; dependencies: string[]; dependents: string[] }>;
  manageDependency(action: DepAction, child: string, parent: string): Promise<void>;
  createConvoy(opts: CreateConvoyOptions): Promise<Convoy>;
  getConvoyStatus(convoyId: string, detailed?: boolean): Promise<ConvoyStatus>;
  trackConvoy(convoyId: string, action: 'add' | 'remove', issues: string[]): Promise<void>;
  listFormulas(type?: FormulaType, includeBuiltin?: boolean): Promise<Formula[]>;
  cookFormula(formula: Formula | string, vars: Record<string, string>): Promise<CookedFormula>;
  executeFormula(formula: Formula | string, vars: Record<string, string>, targetAgent?: string, dryRun?: boolean): Promise<unknown>;
  createFormula(opts: { name: string; type: FormulaType; content: string }): Promise<Formula>;
  sling(beadId: string, target: SlingTarget, formula?: string, priority?: number): Promise<void>;
  listAgents(rig?: string, role?: AgentRole, includeInactive?: boolean): Promise<GasTownAgent[]>;
  sendMail(to: string, subject: string, body: string): Promise<{ messageId: string; status: string }>;
  readMail(mailId: string): Promise<GasTownMail>;
  listMail(limit?: number): Promise<GasTownMail[]>;
}

/**
 * Beads sync service interface
 */
export interface IBeadsSyncService {
  pullBeads(rig?: string, namespace?: string): Promise<{ synced: number; conflicts: number }>;
  pushTasks(namespace?: string): Promise<{ pushed: number; conflicts: number }>;
}

/**
 * Formula WASM interface
 */
export interface IFormulaWasm {
  isInitialized(): boolean;
  initialize(): Promise<void>;
  parseFormula(content: string, validate?: boolean): Promise<{ type: FormulaType; name: string; steps: Step[] }>;
  cookFormula(formula: Formula | string, vars: Record<string, string>, isContent?: boolean): Promise<CookedFormula>;
  cookBatch(formulas: Array<{ name: string; content: string }>, vars: Record<string, string>[], continueOnError?: boolean): Promise<{ cooked: CookedFormula[]; errors: string[] }>;
}

/**
 * Dependency WASM interface
 */
export interface IDependencyWasm {
  isInitialized(): boolean;
  initialize(): Promise<void>;
  resolveDependencies(beads: Array<{ id: string; dependencies?: string[] }>, action: DependencyAction): Promise<DependencyResolution>;
  matchPatterns(query: string, candidates: string[], k: number, threshold: number): Promise<PatternMatch[]>;
  optimizeConvoy(convoy: { id: string; trackedIssues: string[] }, strategy: ConvoyStrategy, constraints?: unknown): Promise<ConvoyOptimization>;
}
