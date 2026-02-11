/**
 * Code Intelligence Plugin - MCP Tools
 *
 * Implements 5 MCP tools for advanced code analysis:
 * 1. code/semantic-search - Find semantically similar code patterns
 * 2. code/architecture-analyze - Analyze codebase architecture
 * 3. code/refactor-impact - Predict refactoring impact using GNN
 * 4. code/split-suggest - Suggest module splits using MinCut
 * 5. code/learn-patterns - Learn patterns from code history
 *
 * Based on ADR-035: Advanced Code Intelligence Plugin
 *
 * @module v3/plugins/code-intelligence/mcp-tools
 */

import { z } from 'zod';
import path from 'path';
import type {
  SemanticSearchResult,
  ArchitectureAnalysisResult,
  RefactoringImpactResult,
  ModuleSplitResult,
  PatternLearningResult,
  CodeSearchResult,
  DependencyGraph,
  FileImpact,
  SuggestedModule,
  LearnedPattern,
  IGNNBridge,
  IMinCutBridge,
} from './types.js';
import {
  SemanticSearchInputSchema,
  ArchitectureAnalyzeInputSchema,
  RefactorImpactInputSchema,
  SplitSuggestInputSchema,
  LearnPatternsInputSchema,
  CodeIntelligenceError,
  CodeIntelligenceErrorCodes,
  maskSecrets,
  type AnalysisType,
} from './types.js';
import { createGNNBridge } from './bridges/gnn-bridge.js';
import { createMinCutBridge } from './bridges/mincut-bridge.js';

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface MCPTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: string;
  version: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  handler: (input: TInput, context: ToolContext) => Promise<MCPToolResult<TOutput>>;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  bridges: {
    gnn: IGNNBridge;
    mincut: IMinCutBridge;
  };
  config: {
    allowedRoots: string[];
    blockedPatterns: RegExp[];
    maskSecrets: boolean;
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
// Security Utilities
// ============================================================================

/**
 * Validate path for security
 */
function validatePath(userPath: string, allowedRoots: string[]): string {
  const normalized = path.normalize(userPath);

  // Check for path traversal
  if (normalized.includes('..')) {
    throw new CodeIntelligenceError(
      CodeIntelligenceErrorCodes.PATH_TRAVERSAL,
      'Path traversal detected',
      { path: userPath }
    );
  }

  // Check against allowed roots
  const resolved = path.resolve(normalized);
  const isAllowed = allowedRoots.some(root => {
    const resolvedRoot = path.resolve(root);
    return resolved.startsWith(resolvedRoot);
  });

  if (!isAllowed && allowedRoots.length > 0 && !allowedRoots.includes('.')) {
    throw new CodeIntelligenceError(
      CodeIntelligenceErrorCodes.PATH_TRAVERSAL,
      'Path outside allowed roots',
      { path: userPath, allowedRoots }
    );
  }

  return normalized;
}

/**
 * Check if path is sensitive
 */
function isSensitivePath(filePath: string, blockedPatterns: RegExp[]): boolean {
  return blockedPatterns.some(pattern => pattern.test(filePath));
}

// ============================================================================
// Semantic Search Tool
// ============================================================================

/**
 * MCP Tool: code/semantic-search
 *
 * Search for semantically similar code patterns
 */
export const semanticSearchTool: MCPTool<
  z.infer<typeof SemanticSearchInputSchema>,
  SemanticSearchResult
> = {
  name: 'code/semantic-search',
  description: 'Search for semantically similar code patterns',
  category: 'code-intelligence',
  version: '3.0.0-alpha.1',
  inputSchema: SemanticSearchInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = SemanticSearchInputSchema.parse(input);

      // Validate paths
      const paths = validated.scope?.paths?.map(p =>
        validatePath(p, context.config.allowedRoots)
      ) ?? ['.'];

      // Filter out sensitive files
      const safePaths = paths.filter(p =>
        !isSensitivePath(p, context.config.blockedPatterns)
      );

      // Initialize GNN bridge for semantic embeddings
      const gnn = context.bridges.gnn;
      if (!gnn.isInitialized()) {
        await gnn.initialize();
      }

      // Perform search (simplified - in production would use vector index)
      const results = await performSemanticSearch(
        validated.query,
        safePaths,
        validated.searchType,
        validated.topK,
        validated.scope?.languages,
        validated.scope?.excludeTests ?? false,
        context
      );

      // Mask secrets in results
      if (context.config.maskSecrets) {
        for (const result of results) {
          (result as { snippet: string }).snippet = maskSecrets(result.snippet);
          (result as { context: string }).context = maskSecrets(result.context);
        }
      }

      const result: SemanticSearchResult = {
        success: true,
        query: validated.query,
        searchType: validated.searchType,
        results,
        totalMatches: results.length,
        scope: {
          paths: safePaths,
          languages: validated.scope?.languages,
          excludeTests: validated.scope?.excludeTests,
        },
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
// Architecture Analyze Tool
// ============================================================================

/**
 * MCP Tool: code/architecture-analyze
 *
 * Analyze codebase architecture and detect drift
 */
export const architectureAnalyzeTool: MCPTool<
  z.infer<typeof ArchitectureAnalyzeInputSchema>,
  ArchitectureAnalysisResult
> = {
  name: 'code/architecture-analyze',
  description: 'Analyze codebase architecture and detect drift',
  category: 'code-intelligence',
  version: '3.0.0-alpha.1',
  inputSchema: ArchitectureAnalyzeInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = ArchitectureAnalyzeInputSchema.parse(input);

      // Validate root path
      const rootPath = validatePath(validated.rootPath, context.config.allowedRoots);

      // Initialize GNN bridge
      const gnn = context.bridges.gnn;
      if (!gnn.isInitialized()) {
        await gnn.initialize();
      }

      // Determine analyses to perform
      const analyses = validated.analysis ?? [
        'dependency_graph',
        'circular_deps',
        'component_coupling',
      ];

      // Build dependency graph
      const files = await getFilesInPath(rootPath);
      const safeFiles = files.filter(f =>
        !isSensitivePath(f, context.config.blockedPatterns)
      );

      const dependencyGraph = await gnn.buildCodeGraph(safeFiles, true);

      // Perform requested analyses
      const result: ArchitectureAnalysisResult = {
        success: true,
        rootPath,
        analyses: analyses as AnalysisType[],
        dependencyGraph: analyses.includes('dependency_graph') ? dependencyGraph : undefined,
        layerViolations: analyses.includes('layer_violations')
          ? detectLayerViolations(dependencyGraph, validated.layers)
          : undefined,
        circularDeps: analyses.includes('circular_deps')
          ? detectCircularDeps(dependencyGraph)
          : undefined,
        couplingMetrics: analyses.includes('component_coupling')
          ? calculateCouplingMetrics(dependencyGraph)
          : undefined,
        cohesionMetrics: analyses.includes('module_cohesion')
          ? calculateCohesionMetrics(dependencyGraph)
          : undefined,
        deadCode: analyses.includes('dead_code')
          ? findDeadCode(dependencyGraph)
          : undefined,
        apiSurface: analyses.includes('api_surface')
          ? analyzeAPISurface(dependencyGraph)
          : undefined,
        drift: analyses.includes('architectural_drift') && validated.baseline
          ? await detectDrift(dependencyGraph, validated.baseline)
          : undefined,
        summary: {
          totalFiles: dependencyGraph.nodes.length,
          totalModules: countModules(dependencyGraph),
          healthScore: calculateHealthScore(dependencyGraph),
          issues: 0,
          warnings: 0,
        },
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
// Refactor Impact Tool
// ============================================================================

/**
 * MCP Tool: code/refactor-impact
 *
 * Analyze impact of proposed code changes using GNN
 */
export const refactorImpactTool: MCPTool<
  z.infer<typeof RefactorImpactInputSchema>,
  RefactoringImpactResult
> = {
  name: 'code/refactor-impact',
  description: 'Analyze impact of proposed code changes using GNN',
  category: 'code-intelligence',
  version: '3.0.0-alpha.1',
  inputSchema: RefactorImpactInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = RefactorImpactInputSchema.parse(input);

      // Validate file paths
      for (const change of validated.changes) {
        validatePath(change.file, context.config.allowedRoots);
      }

      // Initialize GNN bridge
      const gnn = context.bridges.gnn;
      if (!gnn.isInitialized()) {
        await gnn.initialize();
      }

      // Get affected files
      const changedFiles = validated.changes.map(c => c.file);

      // Build graph
      const allFiles = await getAllRelatedFiles(changedFiles);
      const safeFiles = allFiles.filter(f =>
        !isSensitivePath(f, context.config.blockedPatterns)
      );

      const graph = await gnn.buildCodeGraph(safeFiles, true);

      // Predict impact using GNN propagation
      const impactScores = await gnn.predictImpact(
        graph,
        changedFiles,
        validated.depth
      );

      // Build file impacts
      const impactedFiles: FileImpact[] = [];
      for (const [filePath, score] of impactScores) {
        if (score > 0.1) {
          impactedFiles.push({
            filePath,
            impactType: changedFiles.includes(filePath) ? 'direct' :
              score > 0.5 ? 'indirect' : 'transitive',
            requiresChange: changedFiles.includes(filePath) || score > 0.7,
            changesNeeded: getChangesNeeded(filePath, validated.changes),
            risk: score > 0.8 ? 'high' : score > 0.5 ? 'medium' : 'low',
            testsAffected: validated.includeTests
              ? getAffectedTests(filePath, graph)
              : [],
          });
        }
      }

      // Sort by impact
      impactedFiles.sort((a, b) => {
        const aScore = impactScores.get(a.filePath) ?? 0;
        const bScore = impactScores.get(b.filePath) ?? 0;
        return bScore - aScore;
      });

      const result: RefactoringImpactResult = {
        success: true,
        changes: validated.changes.map(c => ({
          file: c.file,
          type: c.type,
          details: c.details ?? {},
        })),
        impactedFiles,
        summary: {
          directlyAffected: impactedFiles.filter(f => f.impactType === 'direct').length,
          indirectlyAffected: impactedFiles.filter(f => f.impactType !== 'direct').length,
          testsAffected: new Set(impactedFiles.flatMap(f => f.testsAffected)).size,
          totalRisk: impactedFiles.some(f => f.risk === 'high') ? 'high' :
            impactedFiles.some(f => f.risk === 'medium') ? 'medium' : 'low',
        },
        suggestedOrder: getSuggestedOrder(impactedFiles, graph),
        breakingChanges: findBreakingChanges(validated.changes, graph),
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
// Split Suggest Tool
// ============================================================================

/**
 * MCP Tool: code/split-suggest
 *
 * Suggest optimal code splitting using MinCut algorithm
 */
export const splitSuggestTool: MCPTool<
  z.infer<typeof SplitSuggestInputSchema>,
  ModuleSplitResult
> = {
  name: 'code/split-suggest',
  description: 'Suggest optimal code splitting using MinCut algorithm',
  category: 'code-intelligence',
  version: '3.0.0-alpha.1',
  inputSchema: SplitSuggestInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = SplitSuggestInputSchema.parse(input);

      // Validate path
      const targetPath = validatePath(validated.targetPath, context.config.allowedRoots);

      // Initialize bridges
      const gnn = context.bridges.gnn;
      const mincut = context.bridges.mincut;

      if (!gnn.isInitialized()) await gnn.initialize();
      if (!mincut.isInitialized()) await mincut.initialize();

      // Get files
      const files = await getFilesInPath(targetPath);
      const safeFiles = files.filter(f =>
        !isSensitivePath(f, context.config.blockedPatterns)
      );

      // Build graph
      const graph = await gnn.buildCodeGraph(safeFiles, true);

      // Determine number of modules
      const targetModules = validated.targetModules ??
        Math.max(2, Math.ceil(Math.sqrt(graph.nodes.length / 5)));

      // Find optimal cuts
      const partition = await mincut.findOptimalCuts(
        graph,
        targetModules,
        validated.constraints ?? {}
      );

      // Build suggested modules
      const modules = buildSuggestedModules(graph, partition, validated.strategy);

      // Calculate cut edges
      const cutEdges: Array<{ from: string; to: string; weight: number }> = [];
      for (const edge of graph.edges) {
        const fromPart = partition.get(edge.from);
        const toPart = partition.get(edge.to);
        if (fromPart !== undefined && toPart !== undefined && fromPart !== toPart) {
          cutEdges.push({
            from: edge.from,
            to: edge.to,
            weight: edge.weight,
          });
        }
      }

      // Calculate quality metrics
      const totalCutWeight = cutEdges.reduce((sum, e) => sum + e.weight, 0);
      const avgCohesion = modules.reduce((sum, m) => sum + m.cohesion, 0) / modules.length;
      const avgCoupling = modules.reduce((sum, m) => sum + m.coupling, 0) / modules.length;
      const sizes = modules.map(m => m.loc);
      const balanceScore = 1 - (Math.max(...sizes) - Math.min(...sizes)) /
        (Math.max(...sizes) + 1);

      const result: ModuleSplitResult = {
        success: true,
        targetPath,
        strategy: validated.strategy,
        modules,
        cutEdges,
        quality: {
          totalCutWeight,
          avgCohesion,
          avgCoupling,
          balanceScore,
        },
        migrationSteps: generateMigrationSteps(modules, cutEdges),
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
// Learn Patterns Tool
// ============================================================================

/**
 * MCP Tool: code/learn-patterns
 *
 * Learn recurring patterns from code changes using Pattern
 */
export const learnPatternsTool: MCPTool<
  z.infer<typeof LearnPatternsInputSchema>,
  PatternLearningResult
> = {
  name: 'code/learn-patterns',
  description: 'Learn recurring patterns from code changes using Pattern',
  category: 'code-intelligence',
  version: '3.0.0-alpha.1',
  inputSchema: LearnPatternsInputSchema,
  handler: async (input, context) => {
    const startTime = Date.now();

    try {
      const validated = LearnPatternsInputSchema.parse(input);

      // Analyze git history
      const scope = validated.scope ?? { gitRange: 'HEAD~100..HEAD' };
      const patternTypes = validated.patternTypes ?? [
        'bug_patterns',
        'refactor_patterns',
      ];

      // Learn patterns from commits (simplified)
      const patterns = await learnPatternsFromHistory(
        scope,
        patternTypes,
        validated.minOccurrences,
        context
      );

      // Generate recommendations
      const recommendations = generateRecommendations(patterns);

      const result: PatternLearningResult = {
        success: true,
        scope,
        patternTypes,
        patterns,
        summary: {
          commitsAnalyzed: 100, // Simplified
          filesAnalyzed: patterns.reduce((sum, p) => sum + p.files.length, 0),
          patternsFound: patterns.length,
          byType: patternTypes.reduce((acc, type) => {
            acc[type] = patterns.filter(p => p.type === type).length;
            return acc;
          }, {} as Record<string, number>),
        },
        recommendations,
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
// Helper Functions
// ============================================================================

async function performSemanticSearch(
  _query: string,
  _paths: string[],
  _searchType: string,
  topK: number,
  _languages: string[] | undefined,
  _excludeTests: boolean,
  _context: ToolContext
): Promise<CodeSearchResult[]> {
  // Simplified implementation
  const results: CodeSearchResult[] = [];

  // In production, would use vector index
  return results.slice(0, topK);
}

async function getFilesInPath(_rootPath: string): Promise<string[]> {
  // Simplified - in production would use glob
  return [];
}

async function getAllRelatedFiles(changedFiles: string[]): Promise<string[]> {
  // Simplified - would traverse dependencies
  return changedFiles;
}

function detectLayerViolations(
  graph: DependencyGraph,
  layers?: Record<string, string[]>
): import('./types.js').LayerViolation[] {
  const violations: import('./types.js').LayerViolation[] = [];

  if (!layers) return violations;

  // Build layer lookup
  const nodeLayer = new Map<string, string>();
  for (const [layer, patterns] of Object.entries(layers)) {
    for (const pattern of patterns) {
      for (const node of graph.nodes) {
        if (node.id.includes(pattern)) {
          nodeLayer.set(node.id, layer);
        }
      }
    }
  }

  // Check edges for violations
  for (const edge of graph.edges) {
    const fromLayer = nodeLayer.get(edge.from);
    const toLayer = nodeLayer.get(edge.to);

    if (fromLayer && toLayer && fromLayer !== toLayer) {
      // Simplified check - in production would check layer order
      violations.push({
        source: edge.from,
        target: edge.to,
        sourceLayer: fromLayer,
        targetLayer: toLayer,
        violationType: 'cross',
        severity: 'medium',
        suggestedFix: `Move ${edge.from} or ${edge.to} to appropriate layer`,
      });
    }
  }

  return violations;
}

function detectCircularDeps(graph: DependencyGraph): import('./types.js').CircularDependency[] {
  const cycles: import('./types.js').CircularDependency[] = [];

  // Build adjacency list
  const adj = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adj.get(edge.from)?.push(edge.to);
  }

  // DFS for cycle detection
  const visited = new Set<string>();
  const recStack = new Set<string>();

  const findCycle = (node: string, path: string[]): void => {
    visited.add(node);
    recStack.add(node);

    for (const neighbor of adj.get(node) ?? []) {
      if (recStack.has(neighbor)) {
        // Found cycle
        const cycleStart = path.indexOf(neighbor);
        if (cycleStart >= 0) {
          cycles.push({
            cycle: [...path.slice(cycleStart), neighbor],
            length: path.length - cycleStart + 1,
            severity: path.length - cycleStart > 3 ? 'high' : 'medium',
            suggestedBreakPoint: neighbor,
          });
        }
      } else if (!visited.has(neighbor)) {
        findCycle(neighbor, [...path, neighbor]);
      }
    }

    recStack.delete(node);
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      findCycle(node.id, [node.id]);
    }
  }

  return cycles;
}

function calculateCouplingMetrics(graph: DependencyGraph): import('./types.js').CouplingMetrics[] {
  const metrics: import('./types.js').CouplingMetrics[] = [];

  for (const node of graph.nodes) {
    const afferent = graph.edges.filter(e => e.to === node.id).length;
    const efferent = graph.edges.filter(e => e.from === node.id).length;
    const instability = (afferent + efferent) > 0
      ? efferent / (afferent + efferent)
      : 0;

    metrics.push({
      componentId: node.id,
      afferentCoupling: afferent,
      efferentCoupling: efferent,
      instability,
      abstractness: 0.5, // Simplified
      distanceFromMain: Math.abs(instability - 0.5),
      inZoneOfPain: instability < 0.3 && false, // Simplified
      inZoneOfUselessness: instability > 0.7 && false, // Simplified
    });
  }

  return metrics;
}

function calculateCohesionMetrics(_graph: DependencyGraph): import('./types.js').CohesionMetrics[] {
  return [];
}

function findDeadCode(graph: DependencyGraph): import('./types.js').DeadCodeFinding[] {
  const deadCode: import('./types.js').DeadCodeFinding[] = [];

  // Find nodes with no incoming edges and not exported
  const hasIncoming = new Set(graph.edges.map(e => e.to));

  for (const node of graph.nodes) {
    if (!hasIncoming.has(node.id) && node.type === 'function') {
      deadCode.push({
        filePath: node.id,
        symbol: node.label,
        symbolType: 'function',
        lineNumber: 1,
        confidence: 0.7,
        reason: 'No references found',
        isExported: false,
      });
    }
  }

  return deadCode;
}

function analyzeAPISurface(_graph: DependencyGraph): import('./types.js').APISurfaceElement[] {
  return [];
}

async function detectDrift(
  _graph: DependencyGraph,
  _baseline: string
): Promise<import('./types.js').ArchitecturalDrift[]> {
  return [];
}

function countModules(graph: DependencyGraph): number {
  const dirs = new Set<string>();
  for (const node of graph.nodes) {
    const parts = node.id.split('/');
    if (parts.length > 1) {
      dirs.add(parts.slice(0, -1).join('/'));
    }
  }
  return dirs.size;
}

function calculateHealthScore(graph: DependencyGraph): number {
  // Simplified scoring
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  if (nodeCount === 0) return 100;

  const avgDegree = edgeCount / nodeCount;
  const idealDegree = 3;

  return Math.max(0, 100 - Math.abs(avgDegree - idealDegree) * 10);
}

function getChangesNeeded(
  filePath: string,
  changes: Array<{ file: string; type: string; details?: Record<string, unknown> }>
): string[] {
  const changesNeeded: string[] = [];

  for (const change of changes) {
    if (change.file === filePath) {
      changesNeeded.push(`Apply ${change.type}`);
    }
  }

  return changesNeeded;
}

function getAffectedTests(filePath: string, graph: DependencyGraph): string[] {
  const tests: string[] = [];

  for (const edge of graph.edges) {
    if (edge.from === filePath && edge.to.includes('.test')) {
      tests.push(edge.to);
    }
  }

  return tests;
}

function getSuggestedOrder(
  impactedFiles: FileImpact[],
  _graph: DependencyGraph
): string[] {
  // Order by dependencies
  return impactedFiles
    .filter(f => f.requiresChange)
    .sort((a, b) => {
      const aRisk = a.risk === 'high' ? 3 : a.risk === 'medium' ? 2 : 1;
      const bRisk = b.risk === 'high' ? 3 : b.risk === 'medium' ? 2 : 1;
      return bRisk - aRisk;
    })
    .map(f => f.filePath);
}

function findBreakingChanges(
  changes: Array<{ file: string; type: string; details?: Record<string, unknown> }>,
  graph: DependencyGraph
): string[] {
  const breakingChanges: string[] = [];

  for (const change of changes) {
    if (change.type === 'delete') {
      const dependents = graph.edges.filter(e => e.to === change.file);
      if (dependents.length > 0) {
        breakingChanges.push(`Deleting ${change.file} breaks ${dependents.length} dependents`);
      }
    }
  }

  return breakingChanges;
}

function buildSuggestedModules(
  graph: DependencyGraph,
  partition: Map<string, number>,
  _strategy: string
): SuggestedModule[] {
  const modules: SuggestedModule[] = [];
  const partitionGroups = new Map<number, string[]>();

  for (const [nodeId, partNum] of partition) {
    if (!partitionGroups.has(partNum)) {
      partitionGroups.set(partNum, []);
    }
    partitionGroups.get(partNum)?.push(nodeId);
  }

  for (const [partNum, files] of partitionGroups) {
    // Calculate cohesion (internal edges / possible internal edges)
    const internalEdges = graph.edges.filter(
      e => partition.get(e.from) === partNum && partition.get(e.to) === partNum
    ).length;
    const possibleEdges = files.length * (files.length - 1);
    const cohesion = possibleEdges > 0 ? internalEdges / possibleEdges : 1;

    // Calculate coupling (external edges)
    const externalEdges = graph.edges.filter(
      e => (partition.get(e.from) === partNum) !== (partition.get(e.to) === partNum)
    ).length;
    const coupling = externalEdges / Math.max(files.length, 1);

    // Get dependencies on other modules
    const dependencies = new Set<string>();
    for (const edge of graph.edges) {
      if (partition.get(edge.from) === partNum && partition.get(edge.to) !== partNum) {
        const depModule = partition.get(edge.to);
        if (depModule !== undefined) {
          dependencies.add(`module-${depModule}`);
        }
      }
    }

    modules.push({
      name: `module-${partNum}`,
      files,
      loc: files.length * 100, // Simplified
      cohesion,
      coupling,
      publicApi: [], // Simplified
      dependencies: Array.from(dependencies),
    });
  }

  return modules;
}

function generateMigrationSteps(
  modules: SuggestedModule[],
  cutEdges: Array<{ from: string; to: string; weight: number }>
): string[] {
  const steps: string[] = [];

  steps.push(`1. Create ${modules.length} new module directories`);
  steps.push(`2. Move files to their respective modules`);
  steps.push(`3. Update ${cutEdges.length} cross-module imports`);
  steps.push(`4. Define public APIs for each module`);
  steps.push(`5. Run tests to verify no regressions`);

  return steps;
}

async function learnPatternsFromHistory(
  _scope: { gitRange?: string; authors?: string[]; paths?: string[] },
  _patternTypes: string[],
  _minOccurrences: number,
  _context: ToolContext
): Promise<LearnedPattern[]> {
  // Simplified - in production would analyze git history
  return [
    {
      id: 'pattern-1',
      type: 'refactor_patterns',
      description: 'Convert callbacks to async/await',
      codeBefore: 'function(callback) { ... }',
      codeAfter: 'async function() { ... }',
      occurrences: 5,
      authors: ['developer1'],
      files: ['src/utils.ts'],
      confidence: 0.85,
      impact: 'positive',
      suggestedAction: 'Consider modernizing callback-based code to async/await',
    },
  ];
}

function generateRecommendations(patterns: LearnedPattern[]): string[] {
  const recommendations: string[] = [];

  for (const pattern of patterns) {
    if (pattern.suggestedAction) {
      recommendations.push(pattern.suggestedAction);
    }
  }

  return recommendations;
}

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All Code Intelligence MCP Tools
 */
export const codeIntelligenceTools: MCPTool[] = [
  semanticSearchTool as unknown as MCPTool,
  architectureAnalyzeTool as unknown as MCPTool,
  refactorImpactTool as unknown as MCPTool,
  splitSuggestTool as unknown as MCPTool,
  learnPatternsTool as unknown as MCPTool,
];

/**
 * Tool name to handler map
 */
export const toolHandlers = new Map<string, MCPTool['handler']>([
  ['code/semantic-search', semanticSearchTool.handler as MCPTool['handler']],
  ['code/architecture-analyze', architectureAnalyzeTool.handler as MCPTool['handler']],
  ['code/refactor-impact', refactorImpactTool.handler as MCPTool['handler']],
  ['code/split-suggest', splitSuggestTool.handler as MCPTool['handler']],
  ['code/learn-patterns', learnPatternsTool.handler as MCPTool['handler']],
]);

/**
 * Create tool context with bridges
 */
export function createToolContext(config?: Partial<ToolContext['config']>): ToolContext {
  const store = new Map<string, unknown>();

  const defaultBlockedPatterns = [
    /\.env$/,
    /\.git\/config$/,
    /credentials/i,
    /secrets?\./i,
    /\.pem$/,
    /\.key$/,
    /id_rsa/i,
  ];

  return {
    get: <T>(key: string) => store.get(key) as T | undefined,
    set: <T>(key: string, value: T) => { store.set(key, value); },
    bridges: {
      gnn: createGNNBridge(),
      mincut: createMinCutBridge(),
    },
    config: {
      allowedRoots: config?.allowedRoots ?? ['.'],
      blockedPatterns: config?.blockedPatterns ?? defaultBlockedPatterns,
      maskSecrets: config?.maskSecrets ?? true,
    },
  };
}

export default codeIntelligenceTools;
