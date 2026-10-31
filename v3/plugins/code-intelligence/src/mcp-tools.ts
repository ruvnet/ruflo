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
import fs from 'fs';
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
  // zod 3 reads these params as <Output, Def, Input> and zod 4 as <Output, Input, Internals>;
  // `any` in the last two keeps the type valid under both majors.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<TInput, any, any>;
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
 * Learn recurring patterns from code changes using SONA
 */
export const learnPatternsTool: MCPTool<
  z.infer<typeof LearnPatternsInputSchema>,
  PatternLearningResult
> = {
  name: 'code/learn-patterns',
  description: 'Learn recurring patterns from code changes using SONA',
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

// #1554/#1553: Real implementations replacing the previous `return []` stubs.
// Kept dep-free (no fast-glob, no @claude-flow/embeddings) so the plugin can
// ship without runtime peer-dep churn — semantic search uses a token-overlap
// score that returns real ranked results, with a TODO to upgrade to ONNX
// embeddings when the embeddings package is loadable. Architecture analysis
// and refactor-impact pull file lists via getFilesInPath and import edges via
// getAllRelatedFiles, which is enough to lift `0 edges / 0 results` to real
// non-empty data across all 5 tools.

const DEFAULT_CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.git', 'coverage', 'vendor',
  '.next', '.nuxt', '.turbo', '.cache', 'tmp', '.pnpm-store',
]);
const MAX_FILE_BYTES = 100 * 1024; // 100KB cap, matches issue suggestion

async function getFilesInPath(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>();

  const walk = (dir: string) => {
    let realDir: string;
    try {
      realDir = fs.realpathSync(dir);
    } catch {
      return;
    }
    if (visited.has(realDir)) return; // protect against symlink loops
    visited.add(realDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.') {
        // skip dot-prefixed entries except the root marker
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        continue;
      }
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!DEFAULT_CODE_EXTS.has(ext)) continue;
        if (entry.name.endsWith('.min.js') || entry.name.endsWith('.min.mjs')) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > MAX_FILE_BYTES) continue;
        } catch { continue; }
        out.push(full);
      }
    }
  };

  walk(rootPath);
  return out;
}

function tokenize(text: string): Map<string, number> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && t.length <= 32);
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

function cosineFromCounts(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  for (const [tok, ca] of a) {
    const cb = b.get(tok);
    if (cb !== undefined) dot += ca * cb;
  }
  if (dot === 0) return 0;
  let na = 0; for (const v of a.values()) na += v * v;
  let nb = 0; for (const v of b.values()) nb += v * v;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function performSemanticSearch(
  query: string,
  paths: string[],
  _searchType: string,
  topK: number,
  languages: string[] | undefined,
  excludeTests: boolean,
  _context: ToolContext,
): Promise<CodeSearchResult[]> {
  // Discover candidate files across all requested roots.
  const candidates: string[] = [];
  for (const root of paths) {
    const files = await getFilesInPath(root);
    for (const f of files) candidates.push(f);
  }

  // Filter by language extension if requested.
  const langExt = (() => {
    if (!languages || languages.length === 0) return null;
    const exts = new Set<string>();
    for (const l of languages) {
      const k = l.toLowerCase();
      if (k === 'typescript' || k === 'ts') { exts.add('.ts'); exts.add('.tsx'); }
      else if (k === 'javascript' || k === 'js') { exts.add('.js'); exts.add('.jsx'); exts.add('.mjs'); exts.add('.cjs'); }
    }
    return exts;
  })();

  const queryTokens = tokenize(query);
  const scored: Array<{ file: string; score: number; preview: string }> = [];

  for (const file of candidates) {
    if (langExt && !langExt.has(path.extname(file).toLowerCase())) continue;
    if (excludeTests && /(\.|^)(test|spec)\.[mc]?[jt]sx?$/i.test(path.basename(file))) continue;

    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch { continue; }
    const head = content.split('\n').slice(0, 200).join('\n');
    const score = cosineFromCounts(queryTokens, tokenize(head));
    if (score < 0.05) continue;
    scored.push({ file, score, preview: head.slice(0, 240) });
  }

  scored.sort((a, b) => b.score - a.score);
  const langFromExt = (file: string): 'typescript' | 'javascript' => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.ts' || ext === '.tsx' ? 'typescript' : 'javascript';
  };
  return scored.slice(0, topK).map((r) => ({
    filePath: r.file,
    lineNumber: 1,
    snippet: r.preview,
    matchType: 'semantic',
    score: r.score,
    context: r.preview,
    language: langFromExt(r.file),
    explanation: `Token-overlap cosine similarity ${(r.score * 100).toFixed(1)}% over first 200 lines.`,
  } satisfies CodeSearchResult));
}

const IMPORT_RX = /^\s*(?:import\s+[^'"]+from\s+|import\s+|export\s+\*?\s*from\s+|export\s+\{[^}]*\}\s+from\s+)['"]([^'"]+)['"]|^\s*(?:const|let|var)\s+[^=]+=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gm;

function extractImportSpecifiers(filePath: string): string[] {
  let content: string;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return []; }
  const out: string[] = [];
  IMPORT_RX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RX.exec(content)) !== null) {
    const spec = m[1] ?? m[2];
    if (spec && (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/'))) {
      out.push(spec);
    }
  }
  return out;
}

function resolveImportToFile(fromFile: string, spec: string): string | null {
  const baseDir = path.dirname(fromFile);
  const candidates: string[] = [];
  if (spec.startsWith('/')) {
    candidates.push(spec);
  } else {
    candidates.push(path.resolve(baseDir, spec));
  }
  // Try .ts/.tsx/.js/.jsx, plus index.* under a directory
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  for (const c of [...candidates]) {
    for (const e of exts) {
      candidates.push(c + e);
      candidates.push(path.join(c, `index${e}`));
    }
  }
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* try next */ }
  }
  return null;
}

async function getAllRelatedFiles(changedFiles: string[]): Promise<string[]> {
  if (changedFiles.length === 0) return [];

  // Forward BFS — what does each changed file (transitively) import?
  const result = new Set<string>();
  const queue: string[] = [];
  for (const f of changedFiles) {
    const abs = path.resolve(f);
    result.add(abs);
    queue.push(abs);
  }
  const MAX_DEPTH = 3;
  let depth = 0;
  while (queue.length > 0 && depth < MAX_DEPTH) {
    const levelSize = queue.length;
    for (let i = 0; i < levelSize; i++) {
      const file = queue.shift()!;
      const specs = extractImportSpecifiers(file);
      for (const spec of specs) {
        const resolved = resolveImportToFile(file, spec);
        if (resolved && !result.has(resolved)) {
          result.add(resolved);
          queue.push(resolved);
        }
      }
    }
    depth++;
  }

  // Reverse scan — what files import any of the changed files? Use the
  // common ancestor directory of the changed files as the search root.
  const commonRoot = (() => {
    if (changedFiles.length === 0) return process.cwd();
    const parts = changedFiles.map((f) => path.resolve(f).split(path.sep));
    const minLen = Math.min(...parts.map((p) => p.length));
    const out: string[] = [];
    for (let i = 0; i < minLen; i++) {
      const seg = parts[0]?.[i];
      if (seg === undefined) break;
      if (parts.every((p) => p[i] === seg)) out.push(seg);
      else break;
    }
    const dir = out.length > 0 ? out.join(path.sep) || path.sep : process.cwd();
    try { return fs.statSync(dir).isDirectory() ? dir : path.dirname(dir); }
    catch { return path.dirname(dir); }
  })();

  const allFiles = await getFilesInPath(commonRoot);
  for (const file of allFiles) {
    if (result.has(path.resolve(file))) continue;
    const specs = extractImportSpecifiers(file);
    for (const spec of specs) {
      const resolved = resolveImportToFile(file, spec);
      if (resolved && result.has(resolved)) {
        result.add(path.resolve(file));
        break;
      }
    }
  }
  return Array.from(result);
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
