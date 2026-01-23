/**
 * calculate-risk.ts - Quality risk calculation MCP tool handler
 *
 * Calculates quality risk scores based on code complexity, test coverage,
 * change frequency, defect history, and other factors.
 */

import { z } from 'zod';

// Input schema for calculate-risk tool
export const CalculateRiskInputSchema = z.object({
  targetPath: z.string().describe('Path to file/directory to analyze'),
  factors: z
    .array(
      z.enum([
        'complexity',
        'coverage',
        'change-frequency',
        'defect-density',
        'age',
        'coupling',
        'size',
        'team-experience',
        'documentation',
      ])
    )
    .default(['complexity', 'coverage', 'change-frequency', 'defect-density'])
    .describe('Risk factors to consider'),
  weights: z
    .object({
      complexity: z.number().min(0).max(1).default(0.2),
      coverage: z.number().min(0).max(1).default(0.25),
      changeFrequency: z.number().min(0).max(1).default(0.2),
      defectDensity: z.number().min(0).max(1).default(0.15),
      age: z.number().min(0).max(1).default(0.05),
      coupling: z.number().min(0).max(1).default(0.05),
      size: z.number().min(0).max(1).default(0.05),
      teamExperience: z.number().min(0).max(1).default(0.025),
      documentation: z.number().min(0).max(1).default(0.025),
    })
    .optional()
    .describe('Custom weights for risk factors'),
  granularity: z
    .enum(['file', 'module', 'function', 'project'])
    .default('file')
    .describe('Level of granularity for analysis'),
  riskThresholds: z
    .object({
      low: z.number().default(30),
      medium: z.number().default(60),
      high: z.number().default(80),
    })
    .optional()
    .describe('Thresholds for risk categorization'),
  includeRecommendations: z.boolean().default(true).describe('Include mitigation recommendations'),
});

export type CalculateRiskInput = z.infer<typeof CalculateRiskInputSchema>;

// Output structures
export interface CalculateRiskOutput {
  success: boolean;
  overallRisk: RiskScore;
  componentRisks: ComponentRisk[];
  factorContributions: FactorContribution[];
  hotspots: RiskHotspot[];
  recommendations: RiskRecommendation[];
  trendAnalysis: RiskTrend;
  metadata: RiskMetadata;
}

export interface RiskScore {
  score: number;
  level: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  breakdown: Record<string, number>;
}

export interface ComponentRisk {
  path: string;
  type: 'file' | 'module' | 'function';
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  factors: Record<string, number>;
  topIssues: string[];
}

export interface FactorContribution {
  factor: string;
  weight: number;
  rawScore: number;
  weightedScore: number;
  percentageContribution: number;
  details: string;
}

export interface RiskHotspot {
  path: string;
  riskScore: number;
  primaryFactor: string;
  description: string;
  urgency: 'immediate' | 'short-term' | 'long-term';
}

export interface RiskRecommendation {
  priority: number;
  factor: string;
  action: string;
  expectedImpact: string;
  effort: 'low' | 'medium' | 'high';
  affectedComponents: string[];
}

export interface RiskTrend {
  direction: 'improving' | 'stable' | 'worsening';
  changePercent: number;
  historicalScores: Array<{ date: string; score: number }>;
  projection: number;
}

export interface RiskMetadata {
  calculatedAt: string;
  durationMs: number;
  targetPath: string;
  componentsAnalyzed: number;
  factorsUsed: string[];
}

// Tool context interface
export interface ToolContext {
  get<T>(key: string): T | undefined;
}

// Default weights
const DEFAULT_WEIGHTS = {
  complexity: 0.2,
  coverage: 0.25,
  changeFrequency: 0.2,
  defectDensity: 0.15,
  age: 0.05,
  coupling: 0.05,
  size: 0.05,
  teamExperience: 0.025,
  documentation: 0.025,
};

// Default thresholds
const DEFAULT_THRESHOLDS = { low: 30, medium: 60, high: 80 };

/**
 * MCP Tool Handler for calculate-risk
 */
export async function handler(
  input: CalculateRiskInput,
  context: ToolContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const startTime = Date.now();

  try {
    // Validate input
    const validatedInput = CalculateRiskInputSchema.parse(input);

    // Get memory bridge for historical data
    const bridge = context.get<{
      searchSimilarPatterns: (q: string, k: number) => Promise<unknown[]>;
    }>('aqe.bridge');

    // Merge weights
    const weights = { ...DEFAULT_WEIGHTS, ...validatedInput.weights };
    const thresholds = { ...DEFAULT_THRESHOLDS, ...validatedInput.riskThresholds };

    // Analyze components
    const componentRisks = await analyzeComponents(
      validatedInput.targetPath,
      validatedInput.granularity,
      validatedInput.factors,
      weights
    );

    // Calculate factor contributions
    const factorContributions = calculateFactorContributions(
      componentRisks,
      validatedInput.factors,
      weights
    );

    // Calculate overall risk
    const overallRisk = calculateOverallRisk(componentRisks, thresholds);

    // Identify hotspots
    const hotspots = identifyHotspots(componentRisks, thresholds);

    // Generate recommendations
    const recommendations = validatedInput.includeRecommendations
      ? generateRecommendations(factorContributions, hotspots)
      : [];

    // Analyze trends
    const trendAnalysis = await analyzeTrends(validatedInput.targetPath, bridge);

    // Build result
    const result: CalculateRiskOutput = {
      success: true,
      overallRisk,
      componentRisks,
      factorContributions,
      hotspots,
      recommendations,
      trendAnalysis,
      metadata: {
        calculatedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        targetPath: validatedInput.targetPath,
        componentsAnalyzed: componentRisks.length,
        factorsUsed: validatedInput.factors,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: false,
              error: errorMessage,
              metadata: {
                calculatedAt: new Date().toISOString(),
                durationMs: Date.now() - startTime,
              },
            },
            null,
            2
          ),
        },
      ],
    };
  }
}

async function analyzeComponents(
  targetPath: string,
  granularity: string,
  factors: string[],
  weights: Record<string, number>
): Promise<ComponentRisk[]> {
  // Simulated component analysis
  // In real implementation, would parse code and calculate metrics

  const components = generateSimulatedComponents(targetPath, granularity);

  return components.map((component) => {
    const factorScores: Record<string, number> = {};
    let weightedSum = 0;
    let totalWeight = 0;

    for (const factor of factors) {
      const score = calculateFactorScore(factor, component);
      factorScores[factor] = score;
      const weightKey = factor.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const weight = weights[weightKey] || 0.1;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    const riskScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : 0;
    const riskLevel = scoreToLevel(riskScore * 100);

    return {
      path: component.path,
      type: granularity as 'file' | 'module' | 'function',
      riskScore,
      riskLevel,
      factors: factorScores,
      topIssues: identifyTopIssues(factorScores),
    };
  });
}

interface SimulatedComponent {
  path: string;
  lines: number;
  complexity: number;
  coverage: number;
  changes: number;
  defects: number;
  age: number;
}

function generateSimulatedComponents(targetPath: string, granularity: string): SimulatedComponent[] {
  const basePath = targetPath.replace(/\.[^.]+$/, '');

  if (granularity === 'function') {
    return [
      { path: `${basePath}::processInput`, lines: 25, complexity: 8, coverage: 85, changes: 5, defects: 1, age: 90 },
      { path: `${basePath}::validateConfig`, lines: 40, complexity: 12, coverage: 60, changes: 8, defects: 3, age: 180 },
      { path: `${basePath}::handleError`, lines: 15, complexity: 4, coverage: 45, changes: 2, defects: 0, age: 120 },
    ];
  }

  return [
    { path: `${basePath}/core.ts`, lines: 350, complexity: 45, coverage: 78, changes: 15, defects: 4, age: 365 },
    { path: `${basePath}/utils.ts`, lines: 150, complexity: 18, coverage: 92, changes: 8, defects: 1, age: 180 },
    { path: `${basePath}/handlers.ts`, lines: 280, complexity: 32, coverage: 65, changes: 22, defects: 6, age: 90 },
    { path: `${basePath}/validators.ts`, lines: 120, complexity: 15, coverage: 88, changes: 5, defects: 0, age: 120 },
  ];
}

function calculateFactorScore(factor: string, component: SimulatedComponent): number {
  switch (factor) {
    case 'complexity':
      // Higher complexity = higher risk
      return Math.min(component.complexity / 50, 1);

    case 'coverage':
      // Lower coverage = higher risk
      return Math.max(0, 1 - component.coverage / 100);

    case 'change-frequency':
      // More changes = higher risk
      return Math.min(component.changes / 20, 1);

    case 'defect-density':
      // More defects per line = higher risk
      const density = component.defects / (component.lines / 100);
      return Math.min(density / 5, 1);

    case 'age':
      // Older code = higher risk (if not maintained)
      return Math.min(component.age / 365, 1);

    case 'coupling':
      // Simulated coupling score
      return Math.random() * 0.5 + 0.2;

    case 'size':
      // Larger files = higher risk
      return Math.min(component.lines / 500, 1);

    case 'team-experience':
      // Simulated team experience
      return 1 - (Math.random() * 0.3 + 0.5);

    case 'documentation':
      // Simulated documentation score
      return 1 - (Math.random() * 0.4 + 0.4);

    default:
      return 0.5;
  }
}

function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function identifyTopIssues(factors: Record<string, number>): string[] {
  const issues: string[] = [];

  const sortedFactors = Object.entries(factors).sort(([, a], [, b]) => b - a);

  for (const [factor, score] of sortedFactors.slice(0, 3)) {
    if (score > 0.5) {
      const issueMap: Record<string, string> = {
        complexity: 'High cyclomatic complexity',
        coverage: 'Insufficient test coverage',
        'change-frequency': 'Frequently modified code',
        'defect-density': 'High defect density',
        age: 'Legacy code requiring attention',
        coupling: 'High coupling to other modules',
        size: 'Large component size',
        'team-experience': 'Limited team familiarity',
        documentation: 'Inadequate documentation',
      };
      issues.push(issueMap[factor] || `High ${factor} risk`);
    }
  }

  return issues;
}

function calculateFactorContributions(
  componentRisks: ComponentRisk[],
  factors: string[],
  weights: Record<string, number>
): FactorContribution[] {
  const contributions: FactorContribution[] = [];

  for (const factor of factors) {
    const avgRawScore = componentRisks.reduce((sum, c) => sum + (c.factors[factor] || 0), 0) / componentRisks.length;
    const weightKey = factor.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const weight = weights[weightKey] || 0.1;
    const weightedScore = avgRawScore * weight;

    contributions.push({
      factor,
      weight,
      rawScore: Math.round(avgRawScore * 100) / 100,
      weightedScore: Math.round(weightedScore * 100) / 100,
      percentageContribution: 0, // Will be calculated after
      details: generateFactorDetails(factor, avgRawScore),
    });
  }

  // Calculate percentage contributions
  const totalWeighted = contributions.reduce((sum, c) => sum + c.weightedScore, 0);
  for (const contrib of contributions) {
    contrib.percentageContribution = totalWeighted > 0
      ? Math.round((contrib.weightedScore / totalWeighted) * 100)
      : 0;
  }

  return contributions.sort((a, b) => b.weightedScore - a.weightedScore);
}

function generateFactorDetails(factor: string, score: number): string {
  const detailsMap: Record<string, string> = {
    complexity: `Average complexity score: ${Math.round(score * 50)}`,
    coverage: `Coverage gap: ${Math.round(score * 100)}%`,
    'change-frequency': `Change rate: ${Math.round(score * 20)} changes/quarter`,
    'defect-density': `Defect density: ${Math.round(score * 5)} per 100 LOC`,
    age: `Average age: ${Math.round(score * 365)} days`,
    coupling: `Coupling factor: ${Math.round(score * 100)}%`,
    size: `Average size: ${Math.round(score * 500)} lines`,
    'team-experience': `Team familiarity: ${Math.round((1 - score) * 100)}%`,
    documentation: `Documentation coverage: ${Math.round((1 - score) * 100)}%`,
  };
  return detailsMap[factor] || `Score: ${Math.round(score * 100)}%`;
}

function calculateOverallRisk(
  componentRisks: ComponentRisk[],
  thresholds: { low: number; medium: number; high: number }
): RiskScore {
  if (componentRisks.length === 0) {
    return {
      score: 0,
      level: 'low',
      confidence: 0,
      breakdown: {},
    };
  }

  // Weighted average based on component risk
  const totalScore = componentRisks.reduce((sum, c) => sum + c.riskScore, 0);
  const avgScore = (totalScore / componentRisks.length) * 100;

  // Calculate breakdown by risk level
  const breakdown: Record<string, number> = {
    low: componentRisks.filter((c) => c.riskLevel === 'low').length,
    medium: componentRisks.filter((c) => c.riskLevel === 'medium').length,
    high: componentRisks.filter((c) => c.riskLevel === 'high').length,
    critical: componentRisks.filter((c) => c.riskLevel === 'critical').length,
  };

  // Confidence based on number of components analyzed
  const confidence = Math.min(componentRisks.length / 10, 1);

  return {
    score: Math.round(avgScore * 10) / 10,
    level: scoreToLevel(avgScore),
    confidence: Math.round(confidence * 100) / 100,
    breakdown,
  };
}

function identifyHotspots(
  componentRisks: ComponentRisk[],
  thresholds: { low: number; medium: number; high: number }
): RiskHotspot[] {
  return componentRisks
    .filter((c) => c.riskScore * 100 >= thresholds.medium)
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 5)
    .map((c) => {
      const topFactor = Object.entries(c.factors).sort(([, a], [, b]) => b - a)[0];
      return {
        path: c.path,
        riskScore: Math.round(c.riskScore * 100),
        primaryFactor: topFactor[0],
        description: c.topIssues[0] || 'Multiple risk factors',
        urgency: c.riskLevel === 'critical' ? 'immediate' : c.riskLevel === 'high' ? 'short-term' : 'long-term',
      };
    });
}

function generateRecommendations(
  factorContributions: FactorContribution[],
  hotspots: RiskHotspot[]
): RiskRecommendation[] {
  const recommendations: RiskRecommendation[] = [];
  let priority = 1;

  // Recommendations based on top contributing factors
  for (const contrib of factorContributions.slice(0, 3)) {
    const recommendationMap: Record<string, { action: string; impact: string; effort: 'low' | 'medium' | 'high' }> = {
      complexity: {
        action: 'Refactor complex functions into smaller, more manageable units',
        impact: 'Reduced cognitive load and easier testing',
        effort: 'medium',
      },
      coverage: {
        action: 'Add unit tests targeting uncovered code paths',
        impact: 'Improved defect detection and regression prevention',
        effort: 'medium',
      },
      'change-frequency': {
        action: 'Stabilize frequently changing components with better abstractions',
        impact: 'Reduced change risk and improved maintainability',
        effort: 'high',
      },
      'defect-density': {
        action: 'Conduct focused code review and add defensive coding practices',
        impact: 'Lower defect rate and improved reliability',
        effort: 'medium',
      },
      age: {
        action: 'Modernize legacy code with incremental refactoring',
        impact: 'Improved maintainability and reduced technical debt',
        effort: 'high',
      },
    };

    const rec = recommendationMap[contrib.factor];
    if (rec && contrib.rawScore > 0.4) {
      recommendations.push({
        priority: priority++,
        factor: contrib.factor,
        action: rec.action,
        expectedImpact: rec.impact,
        effort: rec.effort,
        affectedComponents: hotspots
          .filter((h) => h.primaryFactor === contrib.factor)
          .map((h) => h.path),
      });
    }
  }

  return recommendations;
}

async function analyzeTrends(
  targetPath: string,
  bridge?: { searchSimilarPatterns: (q: string, k: number) => Promise<unknown[]> }
): Promise<RiskTrend> {
  // Simulated historical data
  const historicalScores = [
    { date: '2026-01-01', score: 55 },
    { date: '2026-01-08', score: 52 },
    { date: '2026-01-15', score: 48 },
    { date: '2026-01-22', score: 45 },
  ];

  const first = historicalScores[0].score;
  const last = historicalScores[historicalScores.length - 1].score;
  const change = last - first;
  const changePercent = (change / first) * 100;

  // Project future score
  const trend = (last - first) / historicalScores.length;
  const projection = Math.max(0, Math.min(100, last + trend * 4));

  return {
    direction: changePercent < -5 ? 'improving' : changePercent > 5 ? 'worsening' : 'stable',
    changePercent: Math.round(changePercent * 10) / 10,
    historicalScores,
    projection: Math.round(projection),
  };
}

// Export tool definition for MCP registration
export const toolDefinition = {
  name: 'aqe/calculate-risk',
  description: 'Calculate quality risk scores based on multiple weighted factors',
  category: 'quality-assessment',
  version: '3.2.3',
  inputSchema: CalculateRiskInputSchema,
  handler,
};

export default toolDefinition;
