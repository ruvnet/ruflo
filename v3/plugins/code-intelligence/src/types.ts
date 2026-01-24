/**
 * Code Intelligence Plugin - Type Definitions
 *
 * Core types for advanced code analysis including semantic search,
 * architecture analysis, refactoring impact prediction, module splitting,
 * and pattern learning.
 *
 * Based on ADR-035: Advanced Code Intelligence Plugin
 *
 * @module v3/plugins/code-intelligence/types
 */

import { z } from 'zod';

// ============================================================================
// Language & Search Types
// ============================================================================

/**
 * Supported programming languages
 */
export const Language = z.enum([
  'typescript',
  'javascript',
  'python',
  'java',
  'go',
  'rust',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'scala',
]);

export type Language = z.infer<typeof Language>;

/**
 * Language tiers for support level
 */
export const LanguageTier: Record<Language, 'tier1' | 'tier2' | 'tier3'> = {
  typescript: 'tier1',
  javascript: 'tier1',
  python: 'tier2',
  java: 'tier2',
  go: 'tier3',
  rust: 'tier3',
  cpp: 'tier3',
  csharp: 'tier2',
  ruby: 'tier2',
  php: 'tier2',
  swift: 'tier3',
  kotlin: 'tier3',
  scala: 'tier2',
};

/**
 * Search type for semantic code search
 */
export const SearchType = z.enum([
  'semantic',    // Meaning-based search
  'structural',  // AST pattern matching
  'clone',       // Code clone detection
  'api_usage',   // API usage pattern search
]);

export type SearchType = z.infer<typeof SearchType>;

/**
 * Code search result
 */
export interface CodeSearchResult {
  /** File path */
  readonly filePath: string;
  /** Line number */
  readonly lineNumber: number;
  /** Code snippet */
  readonly snippet: string;
  /** Match type */
  readonly matchType: SearchType;
  /** Relevance score (0-1) */
  readonly score: number;
  /** Context (surrounding lines) */
  readonly context: string;
  /** Symbol name if applicable */
  readonly symbol?: string;
  /** Language of the file */
  readonly language: Language;
  /** Explanation of why this matched */
  readonly explanation: string;
}

/**
 * Semantic search result
 */
export interface SemanticSearchResult {
  /** Success status */
  readonly success: boolean;
  /** Search query */
  readonly query: string;
  /** Search type used */
  readonly searchType: SearchType;
  /** Results */
  readonly results: CodeSearchResult[];
  /** Total matches (before limit) */
  readonly totalMatches: number;
  /** Search scope used */
  readonly scope: SearchScope;
  /** Execution time in ms */
  readonly durationMs: number;
}

/**
 * Search scope configuration
 */
export interface SearchScope {
  /** Paths to include */
  readonly paths?: string[];
  /** Languages to search */
  readonly languages?: Language[];
  /** Exclude test files */
  readonly excludeTests?: boolean;
  /** Exclude node_modules and similar */
  readonly excludeVendor?: boolean;
  /** File patterns to exclude */
  readonly excludePatterns?: string[];
}

// ============================================================================
// Architecture Analysis Types
// ============================================================================

/**
 * Analysis types for architecture
 */
export const AnalysisType = z.enum([
  'dependency_graph',
  'layer_violations',
  'circular_deps',
  'component_coupling',
  'module_cohesion',
  'dead_code',
  'api_surface',
  'architectural_drift',
]);

export type AnalysisType = z.infer<typeof AnalysisType>;

/**
 * Output format for architecture analysis
 */
export const OutputFormat = z.enum([
  'json',
  'graphviz',
  'mermaid',
]);

export type OutputFormat = z.infer<typeof OutputFormat>;

/**
 * Dependency node
 */
export interface DependencyNode {
  /** Node ID (file path or module name) */
  readonly id: string;
  /** Node label */
  readonly label: string;
  /** Node type */
  readonly type: 'file' | 'module' | 'package' | 'class' | 'function';
  /** Language */
  readonly language?: Language;
  /** Lines of code */
  readonly loc?: number;
  /** Complexity score */
  readonly complexity?: number;
  /** Layer (if applicable) */
  readonly layer?: string;
}

/**
 * Dependency edge
 */
export interface DependencyEdge {
  /** Source node ID */
  readonly from: string;
  /** Target node ID */
  readonly to: string;
  /** Edge type */
  readonly type: 'import' | 'extends' | 'implements' | 'uses' | 'calls';
  /** Weight (import count or call frequency) */
  readonly weight: number;
  /** Is dynamic import */
  readonly dynamic?: boolean;
}

/**
 * Dependency graph
 */
export interface DependencyGraph {
  /** All nodes */
  readonly nodes: DependencyNode[];
  /** All edges */
  readonly edges: DependencyEdge[];
  /** Graph metadata */
  readonly metadata: {
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;
    maxDepth: number;
  };
}

/**
 * Layer violation
 */
export interface LayerViolation {
  /** Source module */
  readonly source: string;
  /** Target module */
  readonly target: string;
  /** Source layer */
  readonly sourceLayer: string;
  /** Target layer */
  readonly targetLayer: string;
  /** Violation type */
  readonly violationType: 'upward' | 'skip' | 'cross';
  /** Severity */
  readonly severity: 'low' | 'medium' | 'high';
  /** Suggested fix */
  readonly suggestedFix: string;
}

/**
 * Circular dependency
 */
export interface CircularDependency {
  /** Cycle path (node IDs) */
  readonly cycle: string[];
  /** Cycle length */
  readonly length: number;
  /** Severity */
  readonly severity: 'low' | 'medium' | 'high';
  /** Suggested break point */
  readonly suggestedBreakPoint: string;
}

/**
 * Component coupling metrics
 */
export interface CouplingMetrics {
  /** Component ID */
  readonly componentId: string;
  /** Afferent coupling (incoming dependencies) */
  readonly afferentCoupling: number;
  /** Efferent coupling (outgoing dependencies) */
  readonly efferentCoupling: number;
  /** Instability (Ce / (Ca + Ce)) */
  readonly instability: number;
  /** Abstractness */
  readonly abstractness: number;
  /** Distance from main sequence */
  readonly distanceFromMain: number;
  /** Is in zone of pain (high stability, low abstractness) */
  readonly inZoneOfPain: boolean;
  /** Is in zone of uselessness (low stability, high abstractness) */
  readonly inZoneOfUselessness: boolean;
}

/**
 * Module cohesion metrics
 */
export interface CohesionMetrics {
  /** Module ID */
  readonly moduleId: string;
  /** Lack of Cohesion in Methods (LCOM) */
  readonly lcom: number;
  /** Tight Class Cohesion (TCC) */
  readonly tcc: number;
  /** Loose Class Cohesion (LCC) */
  readonly lcc: number;
  /** Cohesion level */
  readonly level: 'high' | 'medium' | 'low';
  /** Suggestions for improvement */
  readonly suggestions: string[];
}

/**
 * Dead code finding
 */
export interface DeadCodeFinding {
  /** File path */
  readonly filePath: string;
  /** Symbol name */
  readonly symbol: string;
  /** Symbol type */
  readonly symbolType: 'function' | 'class' | 'variable' | 'import' | 'export';
  /** Line number */
  readonly lineNumber: number;
  /** Confidence (0-1) */
  readonly confidence: number;
  /** Reason */
  readonly reason: string;
  /** Is exported */
  readonly isExported: boolean;
}

/**
 * API surface element
 */
export interface APISurfaceElement {
  /** Symbol name */
  readonly name: string;
  /** Symbol type */
  readonly type: 'function' | 'class' | 'interface' | 'type' | 'constant';
  /** File path */
  readonly filePath: string;
  /** Export type */
  readonly exportType: 'named' | 'default' | 're-export';
  /** Usage count */
  readonly usageCount: number;
  /** Is deprecated */
  readonly deprecated: boolean;
  /** Documentation coverage */
  readonly documented: boolean;
}

/**
 * Architectural drift
 */
export interface ArchitecturalDrift {
  /** Component */
  readonly component: string;
  /** Baseline hash */
  readonly baselineRef: string;
  /** Current hash */
  readonly currentRef: string;
  /** Drift type */
  readonly driftType: 'dependency_added' | 'dependency_removed' | 'layer_change' | 'coupling_increase';
  /** Description */
  readonly description: string;
  /** Severity */
  readonly severity: 'low' | 'medium' | 'high';
}

/**
 * Architecture analysis result
 */
export interface ArchitectureAnalysisResult {
  /** Success status */
  readonly success: boolean;
  /** Root path analyzed */
  readonly rootPath: string;
  /** Analyses performed */
  readonly analyses: AnalysisType[];
  /** Dependency graph */
  readonly dependencyGraph?: DependencyGraph;
  /** Layer violations */
  readonly layerViolations?: LayerViolation[];
  /** Circular dependencies */
  readonly circularDeps?: CircularDependency[];
  /** Coupling metrics */
  readonly couplingMetrics?: CouplingMetrics[];
  /** Cohesion metrics */
  readonly cohesionMetrics?: CohesionMetrics[];
  /** Dead code findings */
  readonly deadCode?: DeadCodeFinding[];
  /** API surface */
  readonly apiSurface?: APISurfaceElement[];
  /** Architectural drift */
  readonly drift?: ArchitecturalDrift[];
  /** Summary */
  readonly summary: {
    totalFiles: number;
    totalModules: number;
    healthScore: number;
    issues: number;
    warnings: number;
  };
  /** Execution time in ms */
  readonly durationMs: number;
}

// ============================================================================
// Refactoring Impact Types
// ============================================================================

/**
 * Change type for refactoring
 */
export const ChangeType = z.enum([
  'rename',
  'move',
  'delete',
  'extract',
  'inline',
]);

export type ChangeType = z.infer<typeof ChangeType>;

/**
 * Proposed change
 */
export interface ProposedChange {
  /** File to change */
  readonly file: string;
  /** Change type */
  readonly type: ChangeType;
  /** Change details */
  readonly details: {
    /** Original name (for rename) */
    oldName?: string;
    /** New name (for rename) */
    newName?: string;
    /** New location (for move) */
    newPath?: string;
    /** Symbol to extract (for extract) */
    symbol?: string;
    /** Target file (for extract) */
    targetFile?: string;
  };
}

/**
 * Impact on a file
 */
export interface FileImpact {
  /** File path */
  readonly filePath: string;
  /** Impact type */
  readonly impactType: 'direct' | 'indirect' | 'transitive';
  /** Requires modification */
  readonly requiresChange: boolean;
  /** Changes needed */
  readonly changesNeeded: string[];
  /** Risk level */
  readonly risk: 'low' | 'medium' | 'high';
  /** Tests affected */
  readonly testsAffected: string[];
}

/**
 * Refactoring impact result
 */
export interface RefactoringImpactResult {
  /** Success status */
  readonly success: boolean;
  /** Proposed changes */
  readonly changes: ProposedChange[];
  /** Impacted files */
  readonly impactedFiles: FileImpact[];
  /** Impact summary */
  readonly summary: {
    directlyAffected: number;
    indirectlyAffected: number;
    testsAffected: number;
    totalRisk: 'low' | 'medium' | 'high';
  };
  /** Suggested order of changes */
  readonly suggestedOrder: string[];
  /** Potential breaking changes */
  readonly breakingChanges: string[];
  /** Execution time in ms */
  readonly durationMs: number;
}

// ============================================================================
// Module Splitting Types
// ============================================================================

/**
 * Splitting strategy
 */
export const SplitStrategy = z.enum([
  'minimize_coupling',
  'balance_size',
  'feature_isolation',
]);

export type SplitStrategy = z.infer<typeof SplitStrategy>;

/**
 * Split constraints
 */
export interface SplitConstraints {
  /** Maximum module size (lines) */
  readonly maxModuleSize?: number;
  /** Minimum module size (lines) */
  readonly minModuleSize?: number;
  /** Boundaries to preserve */
  readonly preserveBoundaries?: string[];
  /** Files that must stay together */
  readonly keepTogether?: string[][];
}

/**
 * Suggested module
 */
export interface SuggestedModule {
  /** Module name */
  readonly name: string;
  /** Files included */
  readonly files: string[];
  /** Total lines of code */
  readonly loc: number;
  /** Internal cohesion score */
  readonly cohesion: number;
  /** External coupling score */
  readonly coupling: number;
  /** Public API */
  readonly publicApi: string[];
  /** Dependencies on other suggested modules */
  readonly dependencies: string[];
}

/**
 * Module split suggestion result
 */
export interface ModuleSplitResult {
  /** Success status */
  readonly success: boolean;
  /** Target path analyzed */
  readonly targetPath: string;
  /** Strategy used */
  readonly strategy: SplitStrategy;
  /** Suggested modules */
  readonly modules: SuggestedModule[];
  /** Cut edges (dependencies that cross module boundaries) */
  readonly cutEdges: Array<{
    from: string;
    to: string;
    weight: number;
  }>;
  /** Quality metrics */
  readonly quality: {
    totalCutWeight: number;
    avgCohesion: number;
    avgCoupling: number;
    balanceScore: number;
  };
  /** Migration steps */
  readonly migrationSteps: string[];
  /** Execution time in ms */
  readonly durationMs: number;
}

// ============================================================================
// Pattern Learning Types
// ============================================================================

/**
 * Pattern types to learn
 */
export const PatternType = z.enum([
  'bug_patterns',
  'refactor_patterns',
  'api_patterns',
  'test_patterns',
]);

export type PatternType = z.infer<typeof PatternType>;

/**
 * Learned pattern
 */
export interface LearnedPattern {
  /** Pattern ID */
  readonly id: string;
  /** Pattern type */
  readonly type: PatternType;
  /** Pattern description */
  readonly description: string;
  /** Code before (for refactoring patterns) */
  readonly codeBefore?: string;
  /** Code after (for refactoring patterns) */
  readonly codeAfter?: string;
  /** Occurrence count */
  readonly occurrences: number;
  /** Authors who used this pattern */
  readonly authors: string[];
  /** Files where pattern appears */
  readonly files: string[];
  /** Confidence score */
  readonly confidence: number;
  /** Impact (positive/negative/neutral) */
  readonly impact: 'positive' | 'negative' | 'neutral';
  /** Suggested action */
  readonly suggestedAction?: string;
}

/**
 * Pattern learning scope
 */
export interface LearningScope {
  /** Git range to analyze */
  readonly gitRange?: string;
  /** Authors to filter */
  readonly authors?: string[];
  /** Paths to include */
  readonly paths?: string[];
  /** Since date */
  readonly since?: Date;
  /** Until date */
  readonly until?: Date;
}

/**
 * Pattern learning result
 */
export interface PatternLearningResult {
  /** Success status */
  readonly success: boolean;
  /** Scope used */
  readonly scope: LearningScope;
  /** Pattern types analyzed */
  readonly patternTypes: PatternType[];
  /** Learned patterns */
  readonly patterns: LearnedPattern[];
  /** Summary */
  readonly summary: {
    commitsAnalyzed: number;
    filesAnalyzed: number;
    patternsFound: number;
    byType: Record<PatternType, number>;
  };
  /** Recommendations based on patterns */
  readonly recommendations: string[];
  /** Execution time in ms */
  readonly durationMs: number;
}

// ============================================================================
// MCP Tool Input Schemas
// ============================================================================

/**
 * Input schema for code/semantic-search
 */
export const SemanticSearchInputSchema = z.object({
  query: z.string().min(1).max(5000),
  scope: z.object({
    paths: z.array(z.string().max(500)).max(100).optional(),
    languages: z.array(Language).max(20).optional(),
    excludeTests: z.boolean().default(false),
  }).optional(),
  searchType: SearchType.default('semantic'),
  topK: z.number().int().min(1).max(1000).default(10),
});

export type SemanticSearchInput = z.infer<typeof SemanticSearchInputSchema>;

/**
 * Input schema for code/architecture-analyze
 */
export const ArchitectureAnalyzeInputSchema = z.object({
  rootPath: z.string().max(500).default('.'),
  analysis: z.array(AnalysisType).optional(),
  baseline: z.string().max(100).optional(),
  outputFormat: OutputFormat.optional(),
  layers: z.record(z.string(), z.array(z.string())).optional(),
});

export type ArchitectureAnalyzeInput = z.infer<typeof ArchitectureAnalyzeInputSchema>;

/**
 * Input schema for code/refactor-impact
 */
export const RefactorImpactInputSchema = z.object({
  changes: z.array(z.object({
    file: z.string().max(500),
    type: ChangeType,
    details: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(100),
  depth: z.number().int().min(1).max(10).default(3),
  includeTests: z.boolean().default(true),
});

export type RefactorImpactInput = z.infer<typeof RefactorImpactInputSchema>;

/**
 * Input schema for code/split-suggest
 */
export const SplitSuggestInputSchema = z.object({
  targetPath: z.string().max(500),
  strategy: SplitStrategy.default('minimize_coupling'),
  constraints: z.object({
    maxModuleSize: z.number().optional(),
    minModuleSize: z.number().optional(),
    preserveBoundaries: z.array(z.string()).optional(),
  }).optional(),
  targetModules: z.number().int().min(2).max(50).optional(),
});

export type SplitSuggestInput = z.infer<typeof SplitSuggestInputSchema>;

/**
 * Input schema for code/learn-patterns
 */
export const LearnPatternsInputSchema = z.object({
  scope: z.object({
    gitRange: z.string().default('HEAD~100..HEAD'),
    authors: z.array(z.string()).optional(),
    paths: z.array(z.string()).optional(),
  }).optional(),
  patternTypes: z.array(PatternType).optional(),
  minOccurrences: z.number().int().min(1).max(100).default(3),
});

export type LearnPatternsInput = z.infer<typeof LearnPatternsInputSchema>;

// ============================================================================
// Bridge Interfaces
// ============================================================================

/**
 * GNN Bridge for code graph analysis
 */
export interface IGNNBridge {
  /**
   * Build code graph from files
   */
  buildCodeGraph(
    files: string[],
    includeCallGraph: boolean
  ): Promise<DependencyGraph>;

  /**
   * Compute node embeddings using GNN
   */
  computeNodeEmbeddings(
    graph: DependencyGraph,
    embeddingDim: number
  ): Promise<Map<string, Float32Array>>;

  /**
   * Predict impact of changes using GNN
   */
  predictImpact(
    graph: DependencyGraph,
    changedNodes: string[],
    depth: number
  ): Promise<Map<string, number>>;

  /**
   * Detect communities in code graph
   */
  detectCommunities(
    graph: DependencyGraph
  ): Promise<Map<string, number>>;

  /**
   * Find similar code patterns
   */
  findSimilarPatterns(
    graph: DependencyGraph,
    patternGraph: DependencyGraph,
    threshold: number
  ): Promise<Array<{ matchId: string; score: number }>>;

  /**
   * Initialize the WASM module
   */
  initialize(): Promise<void>;

  /**
   * Check if initialized
   */
  isInitialized(): boolean;
}

/**
 * MinCut Bridge for module splitting
 */
export interface IMinCutBridge {
  /**
   * Find optimal module boundaries using MinCut
   */
  findOptimalCuts(
    graph: DependencyGraph,
    numModules: number,
    constraints: SplitConstraints
  ): Promise<Map<string, number>>;

  /**
   * Calculate cut weight for a given partition
   */
  calculateCutWeight(
    graph: DependencyGraph,
    partition: Map<string, number>
  ): Promise<number>;

  /**
   * Find minimum s-t cut
   */
  minSTCut(
    graph: DependencyGraph,
    source: string,
    sink: string
  ): Promise<{
    cutValue: number;
    cutEdges: Array<{ from: string; to: string }>;
    sourceSet: string[];
    sinkSet: string[];
  }>;

  /**
   * Multi-way cut for module splitting
   */
  multiWayCut(
    graph: DependencyGraph,
    terminals: string[],
    weights: Map<string, number>
  ): Promise<{
    cutValue: number;
    partitions: Map<string, number>;
  }>;

  /**
   * Initialize the WASM module
   */
  initialize(): Promise<void>;

  /**
   * Check if initialized
   */
  isInitialized(): boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Plugin configuration
 */
export interface CodeIntelligenceConfig {
  /** Semantic search settings */
  search: {
    /** Embedding dimension */
    embeddingDimension: number;
    /** Default top-K results */
    defaultTopK: number;
    /** Similarity threshold */
    similarityThreshold: number;
  };
  /** Architecture analysis settings */
  architecture: {
    /** Layer definitions */
    layers?: Record<string, string[]>;
    /** Maximum graph depth */
    maxGraphDepth: number;
    /** Include vendor/node_modules */
    includeVendor: boolean;
  };
  /** Refactoring settings */
  refactoring: {
    /** Default impact depth */
    defaultDepth: number;
    /** Include test files */
    includeTests: boolean;
  };
  /** Security settings */
  security: {
    /** Allowed root paths */
    allowedRoots: string[];
    /** Block sensitive file patterns */
    blockedPatterns: string[];
    /** Mask secrets in output */
    maskSecrets: boolean;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: CodeIntelligenceConfig = {
  search: {
    embeddingDimension: 384,
    defaultTopK: 10,
    similarityThreshold: 0.7,
  },
  architecture: {
    maxGraphDepth: 10,
    includeVendor: false,
  },
  refactoring: {
    defaultDepth: 3,
    includeTests: true,
  },
  security: {
    allowedRoots: ['.'],
    blockedPatterns: [
      '\\.env$',
      '\\.git/config$',
      'credentials',
      'secrets?\\.',
      '\\.pem$',
      '\\.key$',
      'id_rsa',
    ],
    maskSecrets: true,
  },
};

// ============================================================================
// Error Types
// ============================================================================

/**
 * Code intelligence plugin error codes
 */
export const CodeIntelligenceErrorCodes = {
  PATH_TRAVERSAL: 'CODE_PATH_TRAVERSAL',
  SENSITIVE_FILE: 'CODE_SENSITIVE_FILE',
  GRAPH_TOO_LARGE: 'CODE_GRAPH_TOO_LARGE',
  ANALYSIS_FAILED: 'CODE_ANALYSIS_FAILED',
  PARSER_ERROR: 'CODE_PARSER_ERROR',
  WASM_NOT_INITIALIZED: 'CODE_WASM_NOT_INITIALIZED',
  LANGUAGE_NOT_SUPPORTED: 'CODE_LANGUAGE_NOT_SUPPORTED',
  GIT_ERROR: 'CODE_GIT_ERROR',
} as const;

export type CodeIntelligenceErrorCode = (typeof CodeIntelligenceErrorCodes)[keyof typeof CodeIntelligenceErrorCodes];

/**
 * Code intelligence plugin error
 */
export class CodeIntelligenceError extends Error {
  public readonly code: CodeIntelligenceErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: CodeIntelligenceErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CodeIntelligenceError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================================
// Security Utilities
// ============================================================================

/**
 * Secret patterns for masking
 */
export const SECRET_PATTERNS = [
  /(['"])(?:api[_-]?key|apikey|secret|password|token|auth)['"]\s*[:=]\s*['"][^'"]+['"]/gi,
  /(?:sk|pk)[-_](?:live|test)[-_][a-zA-Z0-9]{24,}/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
];

/**
 * Mask secrets in code snippet
 */
export function maskSecrets(code: string): string {
  let masked = code;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, '[REDACTED]');
  }
  return masked;
}
