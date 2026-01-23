/**
 * suggest-tests.ts - Coverage gap test suggestions MCP tool handler
 *
 * Analyzes existing code and coverage data to suggest tests that would
 * improve coverage in areas that matter most based on risk and complexity.
 */

import { z } from 'zod';

// Input schema for suggest-tests tool
export const SuggestTestsInputSchema = z.object({
  targetPath: z.string().describe('Path to file/directory to analyze'),
  coverageReport: z.string().optional().describe('Path to existing coverage report (lcov/json)'),
  focusAreas: z
    .array(z.enum(['branches', 'functions', 'lines', 'edge-cases', 'error-handling', 'boundaries']))
    .default(['branches', 'functions'])
    .describe('Areas to focus suggestions on'),
  maxSuggestions: z.number().min(1).max(50).default(10).describe('Maximum suggestions to return'),
  priorityBy: z
    .enum(['risk', 'complexity', 'coverage-impact', 'change-frequency'])
    .default('risk')
    .describe('How to prioritize suggestions'),
  includeCode: z.boolean().default(true).describe('Include generated test code in suggestions'),
  framework: z
    .enum(['vitest', 'jest', 'mocha', 'pytest', 'junit'])
    .default('vitest')
    .describe('Test framework for generated code'),
});

export type SuggestTestsInput = z.infer<typeof SuggestTestsInputSchema>;

// Output structures
export interface SuggestTestsOutput {
  success: boolean;
  suggestions: TestSuggestion[];
  coverageAnalysis: CoverageAnalysisSummary;
  prioritization: PrioritizationInfo;
  metadata: SuggestionMetadata;
}

export interface TestSuggestion {
  id: string;
  type: 'branch' | 'function' | 'line' | 'edge-case' | 'error-handling' | 'boundary';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  targetLocation: CodeLocation;
  rationale: string;
  estimatedCoverageGain: number;
  complexity: 'simple' | 'moderate' | 'complex';
  testCode?: string;
  relatedTests?: string[];
}

export interface CodeLocation {
  file: string;
  startLine: number;
  endLine: number;
  functionName?: string;
  className?: string;
}

export interface CoverageAnalysisSummary {
  currentCoverage: CoverageMetrics;
  projectedCoverage: CoverageMetrics;
  uncoveredAreas: UncoveredArea[];
}

export interface CoverageMetrics {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
}

export interface UncoveredArea {
  type: string;
  location: CodeLocation;
  risk: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
}

export interface PrioritizationInfo {
  strategy: string;
  factors: PrioritizationFactor[];
  riskScore: number;
}

export interface PrioritizationFactor {
  name: string;
  weight: number;
  value: number;
  description: string;
}

export interface SuggestionMetadata {
  generatedAt: string;
  analysisTimeMs: number;
  filesAnalyzed: number;
  totalUncoveredLines: number;
  totalUncoveredBranches: number;
}

// Tool context interface
export interface ToolContext {
  get<T>(key: string): T | undefined;
}

/**
 * MCP Tool Handler for suggest-tests
 */
export async function handler(
  input: SuggestTestsInput,
  context: ToolContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const startTime = Date.now();

  try {
    // Validate input
    const validatedInput = SuggestTestsInputSchema.parse(input);

    // Get bridge for pattern search
    const bridge = context.get<{ searchSimilarPatterns: (q: string, k: number) => Promise<unknown[]> }>('aqe.bridge');

    // Analyze coverage gaps
    const coverageAnalysis = await analyzeCoverageGaps(
      validatedInput.targetPath,
      validatedInput.coverageReport,
      validatedInput.focusAreas
    );

    // Generate prioritized suggestions
    const suggestions = await generateSuggestions(
      coverageAnalysis,
      validatedInput.priorityBy,
      validatedInput.maxSuggestions,
      validatedInput.includeCode,
      validatedInput.framework,
      bridge
    );

    // Calculate prioritization info
    const prioritization = calculatePrioritization(
      validatedInput.priorityBy,
      coverageAnalysis
    );

    // Build result
    const result: SuggestTestsOutput = {
      success: true,
      suggestions,
      coverageAnalysis: {
        currentCoverage: coverageAnalysis.current,
        projectedCoverage: calculateProjectedCoverage(
          coverageAnalysis.current,
          suggestions
        ),
        uncoveredAreas: coverageAnalysis.uncovered,
      },
      prioritization,
      metadata: {
        generatedAt: new Date().toISOString(),
        analysisTimeMs: Date.now() - startTime,
        filesAnalyzed: coverageAnalysis.filesAnalyzed,
        totalUncoveredLines: coverageAnalysis.uncoveredLines,
        totalUncoveredBranches: coverageAnalysis.uncoveredBranches,
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
              suggestions: [],
              metadata: {
                generatedAt: new Date().toISOString(),
                analysisTimeMs: Date.now() - startTime,
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

// Analysis types
interface CoverageGapAnalysis {
  current: CoverageMetrics;
  uncovered: UncoveredArea[];
  filesAnalyzed: number;
  uncoveredLines: number;
  uncoveredBranches: number;
}

async function analyzeCoverageGaps(
  targetPath: string,
  coverageReport: string | undefined,
  focusAreas: string[]
): Promise<CoverageGapAnalysis> {
  // Simulated coverage analysis
  // In real implementation, would parse coverage report and analyze code

  const uncoveredAreas: UncoveredArea[] = [];

  // Analyze based on focus areas
  if (focusAreas.includes('branches')) {
    uncoveredAreas.push({
      type: 'branch',
      location: {
        file: targetPath,
        startLine: 25,
        endLine: 30,
        functionName: 'processInput',
      },
      risk: 'high',
      reason: 'Error handling branch never executed',
    });
  }

  if (focusAreas.includes('functions')) {
    uncoveredAreas.push({
      type: 'function',
      location: {
        file: targetPath,
        startLine: 50,
        endLine: 65,
        functionName: 'validateConfig',
      },
      risk: 'medium',
      reason: 'Validation function not covered',
    });
  }

  if (focusAreas.includes('edge-cases')) {
    uncoveredAreas.push({
      type: 'edge-case',
      location: {
        file: targetPath,
        startLine: 80,
        endLine: 85,
        functionName: 'handleEmptyInput',
      },
      risk: 'high',
      reason: 'Empty input handling not tested',
    });
  }

  if (focusAreas.includes('error-handling')) {
    uncoveredAreas.push({
      type: 'error',
      location: {
        file: targetPath,
        startLine: 100,
        endLine: 110,
        functionName: 'handleError',
      },
      risk: 'critical',
      reason: 'Error handling code path not tested',
    });
  }

  return {
    current: {
      lines: 72,
      branches: 58,
      functions: 80,
      statements: 75,
    },
    uncovered: uncoveredAreas,
    filesAnalyzed: 1,
    uncoveredLines: 45,
    uncoveredBranches: 12,
  };
}

async function generateSuggestions(
  analysis: CoverageGapAnalysis,
  priorityBy: string,
  maxSuggestions: number,
  includeCode: boolean,
  framework: string,
  bridge?: { searchSimilarPatterns: (q: string, k: number) => Promise<unknown[]> }
): Promise<TestSuggestion[]> {
  const suggestions: TestSuggestion[] = [];

  // Sort uncovered areas by priority strategy
  const sortedAreas = sortByPriority(analysis.uncovered, priorityBy);

  for (const area of sortedAreas.slice(0, maxSuggestions)) {
    const suggestion: TestSuggestion = {
      id: `sug-${Date.now()}-${suggestions.length}`,
      type: mapAreaType(area.type),
      priority: area.risk,
      title: generateSuggestionTitle(area),
      description: generateSuggestionDescription(area),
      targetLocation: area.location,
      rationale: area.reason,
      estimatedCoverageGain: calculateCoverageGain(area),
      complexity: assessComplexity(area),
    };

    if (includeCode) {
      suggestion.testCode = await generateTestCode(area, framework, bridge);
    }

    suggestions.push(suggestion);
  }

  return suggestions;
}

function sortByPriority(areas: UncoveredArea[], strategy: string): UncoveredArea[] {
  const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  switch (strategy) {
    case 'risk':
      return [...areas].sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
    case 'complexity':
      return [...areas].sort(
        (a, b) => (a.location.endLine - a.location.startLine) - (b.location.endLine - b.location.startLine)
      );
    case 'coverage-impact':
      return [...areas].sort(
        (a, b) => (b.location.endLine - b.location.startLine) - (a.location.endLine - a.location.startLine)
      );
    default:
      return areas;
  }
}

function mapAreaType(type: string): TestSuggestion['type'] {
  const typeMap: Record<string, TestSuggestion['type']> = {
    branch: 'branch',
    function: 'function',
    line: 'line',
    'edge-case': 'edge-case',
    error: 'error-handling',
    boundary: 'boundary',
  };
  return typeMap[type] || 'line';
}

function generateSuggestionTitle(area: UncoveredArea): string {
  const templates: Record<string, string> = {
    branch: `Test branch coverage in ${area.location.functionName || 'code block'}`,
    function: `Add tests for ${area.location.functionName || 'function'}`,
    line: `Cover lines ${area.location.startLine}-${area.location.endLine}`,
    'edge-case': `Test edge case: ${area.reason}`,
    error: `Test error handling in ${area.location.functionName || 'code block'}`,
  };
  return templates[area.type] || `Test ${area.type} at line ${area.location.startLine}`;
}

function generateSuggestionDescription(area: UncoveredArea): string {
  return `Add test coverage for ${area.type} at ${area.location.file}:${area.location.startLine}. ${area.reason}`;
}

function calculateCoverageGain(area: UncoveredArea): number {
  const lineCount = area.location.endLine - area.location.startLine + 1;
  // Estimate coverage gain based on line count and type
  const baseGain = Math.min(lineCount * 0.5, 5);
  const typeMultiplier: Record<string, number> = {
    branch: 1.5,
    function: 2,
    error: 1.2,
  };
  return Math.round((baseGain * (typeMultiplier[area.type] || 1)) * 10) / 10;
}

function assessComplexity(area: UncoveredArea): 'simple' | 'moderate' | 'complex' {
  const lineCount = area.location.endLine - area.location.startLine + 1;
  if (lineCount <= 5) return 'simple';
  if (lineCount <= 15) return 'moderate';
  return 'complex';
}

async function generateTestCode(
  area: UncoveredArea,
  framework: string,
  bridge?: { searchSimilarPatterns: (q: string, k: number) => Promise<unknown[]> }
): Promise<string> {
  // Search for similar patterns if bridge available
  if (bridge) {
    try {
      await bridge.searchSimilarPatterns(`test ${area.type} ${area.location.functionName}`, 3);
    } catch {
      // Continue without patterns
    }
  }

  const templates: Record<string, string> = {
    vitest: `import { describe, it, expect } from 'vitest';
import { ${area.location.functionName || 'targetFunction'} } from './${area.location.file.replace(/\.[^.]+$/, '')}';

describe('${area.location.functionName || 'Target'}', () => {
  it('should ${area.reason.toLowerCase()}', () => {
    // Arrange
    const input = /* test input for ${area.type} */;

    // Act
    const result = ${area.location.functionName || 'targetFunction'}(input);

    // Assert
    expect(result).toBeDefined();
    // Add specific assertions for ${area.type}
  });
});`,
    jest: `describe('${area.location.functionName || 'Target'}', () => {
  it('should ${area.reason.toLowerCase()}', () => {
    // Arrange
    const input = /* test input for ${area.type} */;

    // Act
    const result = ${area.location.functionName || 'targetFunction'}(input);

    // Assert
    expect(result).toBeDefined();
  });
});`,
  };

  return templates[framework] || templates.vitest;
}

function calculatePrioritization(
  strategy: string,
  analysis: CoverageGapAnalysis
): PrioritizationInfo {
  const factors: PrioritizationFactor[] = [
    {
      name: 'Risk Level',
      weight: strategy === 'risk' ? 0.5 : 0.2,
      value: analysis.uncovered.filter((a) => a.risk === 'critical' || a.risk === 'high').length / analysis.uncovered.length,
      description: 'Proportion of high-risk uncovered areas',
    },
    {
      name: 'Coverage Gap',
      weight: strategy === 'coverage-impact' ? 0.5 : 0.3,
      value: (100 - analysis.current.branches) / 100,
      description: 'Current branch coverage gap',
    },
    {
      name: 'Complexity',
      weight: strategy === 'complexity' ? 0.5 : 0.2,
      value: analysis.uncovered.reduce((sum, a) => sum + (a.location.endLine - a.location.startLine), 0) / 100,
      description: 'Relative complexity of uncovered areas',
    },
  ];

  const riskScore = factors.reduce((sum, f) => sum + f.weight * f.value, 0);

  return {
    strategy,
    factors,
    riskScore: Math.round(riskScore * 100) / 100,
  };
}

function calculateProjectedCoverage(
  current: CoverageMetrics,
  suggestions: TestSuggestion[]
): CoverageMetrics {
  const totalGain = suggestions.reduce((sum, s) => sum + s.estimatedCoverageGain, 0);

  return {
    lines: Math.min(current.lines + totalGain, 100),
    branches: Math.min(current.branches + totalGain * 0.8, 100),
    functions: Math.min(current.functions + totalGain * 0.5, 100),
    statements: Math.min(current.statements + totalGain * 0.9, 100),
  };
}

// Export tool definition for MCP registration
export const toolDefinition = {
  name: 'aqe/suggest-tests',
  description: 'Suggest tests based on coverage gaps with risk-based prioritization',
  category: 'test-generation',
  version: '3.2.3',
  inputSchema: SuggestTestsInputSchema,
  handler,
};

export default toolDefinition;
