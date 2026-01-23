/**
 * agentic-qe MCP Tools Registry
 *
 * Exports all 16 MCP tool handlers for the agentic-qe plugin:
 *
 * Test Generation (3):
 *   - generate-tests: AI-powered test generation
 *   - tdd-cycle: TDD red-green-refactor orchestration
 *   - suggest-tests: Coverage gap test suggestions
 *
 * Coverage Analysis (3):
 *   - analyze-coverage: O(log n) Johnson-Lindenstrauss coverage analysis
 *   - prioritize-gaps: Risk-based gap prioritization
 *   - track-trends: Coverage trend tracking
 *
 * Quality Assessment (3):
 *   - evaluate-quality-gate: Quality gate evaluation
 *   - assess-readiness: Release readiness assessment
 *   - calculate-risk: Quality risk calculation
 *
 * Defect Intelligence (3):
 *   - predict-defects: ML-based defect prediction
 *   - analyze-root-cause: Root cause analysis
 *   - find-similar-defects: Similar defect search
 *
 * Security Compliance (3):
 *   - security-scan: SAST/DAST scanning
 *   - audit-compliance: Compliance auditing
 *   - detect-secrets: Secret detection
 *
 * Chaos Resilience (1):
 *   - chaos-inject: Chaos failure injection (with dryRun safety)
 */

// Test Generation Tools
import generateTests, { GenerateTestsInputSchema } from './test-generation/generate-tests';
import tddCycle, { TDDCycleInputSchema } from './test-generation/tdd-cycle';
import suggestTests, { SuggestTestsInputSchema } from './test-generation/suggest-tests';

// Coverage Analysis Tools
import analyzeCoverage, { AnalyzeCoverageInputSchema } from './coverage-analysis/analyze-coverage';
import prioritizeGaps, { PrioritizeGapsInputSchema } from './coverage-analysis/prioritize-gaps';
import trackTrends, { TrackTrendsInputSchema } from './coverage-analysis/track-trends';

// Quality Assessment Tools
import evaluateQualityGate, { EvaluateQualityGateInputSchema } from './quality-assessment/evaluate-quality-gate';
import assessReadiness, { AssessReadinessInputSchema } from './quality-assessment/assess-readiness';
import calculateRisk, { CalculateRiskInputSchema } from './quality-assessment/calculate-risk';

// Defect Intelligence Tools
import predictDefects, { PredictDefectsInputSchema } from './defect-intelligence/predict-defects';
import analyzeRootCause, { AnalyzeRootCauseInputSchema } from './defect-intelligence/analyze-root-cause';
import findSimilarDefects, { FindSimilarDefectsInputSchema } from './defect-intelligence/find-similar-defects';

// Security Compliance Tools
import securityScan, { SecurityScanInputSchema } from './security-compliance/security-scan';
import auditCompliance, { AuditComplianceInputSchema } from './security-compliance/audit-compliance';
import detectSecrets, { DetectSecretsInputSchema } from './security-compliance/detect-secrets';

// Chaos Resilience Tools
import chaosInject, { ChaosInjectInputSchema } from './chaos-resilience/chaos-inject';

/**
 * MCP Tool interface
 */
export interface MCPTool {
  name: string;
  description: string;
  category: string;
  version: string;
  inputSchema: unknown;
  handler: (input: unknown, context: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;
}

/**
 * All MCP tools exported as array for bulk registration
 */
export const mcpTools: MCPTool[] = [
  // Test Generation
  {
    name: 'aqe/generate-tests',
    description: 'Generate tests for code using AI-powered test generation',
    category: 'test-generation',
    version: '3.2.3',
    inputSchema: GenerateTestsInputSchema,
    handler: generateTests.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/tdd-cycle',
    description: 'Execute TDD red-green-refactor cycle with 7 specialized subagents',
    category: 'test-generation',
    version: '3.2.3',
    inputSchema: TDDCycleInputSchema,
    handler: tddCycle.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/suggest-tests',
    description: 'Suggest tests based on coverage gaps with risk-based prioritization',
    category: 'test-generation',
    version: '3.2.3',
    inputSchema: SuggestTestsInputSchema,
    handler: suggestTests.handler as MCPTool['handler'],
  },

  // Coverage Analysis
  {
    name: 'aqe/analyze-coverage',
    description: 'Analyze code coverage with O(log n) Johnson-Lindenstrauss gap detection',
    category: 'coverage-analysis',
    version: '3.2.3',
    inputSchema: AnalyzeCoverageInputSchema,
    handler: analyzeCoverage.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/prioritize-gaps',
    description: 'Prioritize coverage gaps by risk score using multiple weighted factors',
    category: 'coverage-analysis',
    version: '3.2.3',
    inputSchema: PrioritizeGapsInputSchema,
    handler: prioritizeGaps.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/track-trends',
    description: 'Track coverage trends over time with regression detection and projections',
    category: 'coverage-analysis',
    version: '3.2.3',
    inputSchema: TrackTrendsInputSchema,
    handler: trackTrends.handler as MCPTool['handler'],
  },

  // Quality Assessment
  {
    name: 'aqe/evaluate-quality-gate',
    description: 'Evaluate quality gates for release readiness with configurable thresholds',
    category: 'quality-assessment',
    version: '3.2.3',
    inputSchema: EvaluateQualityGateInputSchema,
    handler: evaluateQualityGate.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/assess-readiness',
    description: 'Comprehensive release readiness assessment with risk analysis and sign-off tracking',
    category: 'quality-assessment',
    version: '3.2.3',
    inputSchema: AssessReadinessInputSchema,
    handler: assessReadiness.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/calculate-risk',
    description: 'Calculate quality risk scores based on multiple weighted factors',
    category: 'quality-assessment',
    version: '3.2.3',
    inputSchema: CalculateRiskInputSchema,
    handler: calculateRisk.handler as MCPTool['handler'],
  },

  // Defect Intelligence
  {
    name: 'aqe/predict-defects',
    description: 'Predict potential defects using ML-based analysis with root cause identification',
    category: 'defect-intelligence',
    version: '3.2.3',
    inputSchema: PredictDefectsInputSchema,
    handler: predictDefects.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/analyze-root-cause',
    description: 'Deep root cause analysis with causal chain identification and remediation planning',
    category: 'defect-intelligence',
    version: '3.2.3',
    inputSchema: AnalyzeRootCauseInputSchema,
    handler: analyzeRootCause.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/find-similar-defects',
    description: 'Search for similar defects using semantic and structural analysis',
    category: 'defect-intelligence',
    version: '3.2.3',
    inputSchema: FindSimilarDefectsInputSchema,
    handler: findSimilarDefects.handler as MCPTool['handler'],
  },

  // Security Compliance
  {
    name: 'aqe/security-scan',
    description: 'SAST/DAST security scanning with compliance checking and remediation guidance',
    category: 'security-compliance',
    version: '3.2.3',
    inputSchema: SecurityScanInputSchema,
    handler: securityScan.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/audit-compliance',
    description: 'Comprehensive compliance auditing for security frameworks',
    category: 'security-compliance',
    version: '3.2.3',
    inputSchema: AuditComplianceInputSchema,
    handler: auditCompliance.handler as MCPTool['handler'],
  },
  {
    name: 'aqe/detect-secrets',
    description: 'Detect secrets, API keys, and sensitive data in code',
    category: 'security-compliance',
    version: '3.2.3',
    inputSchema: DetectSecretsInputSchema,
    handler: detectSecrets.handler as MCPTool['handler'],
  },

  // Chaos Resilience
  {
    name: 'aqe/chaos-inject',
    description: 'Inject chaos failures for resilience testing with dryRun safety mode',
    category: 'chaos-resilience',
    version: '3.2.3',
    inputSchema: ChaosInjectInputSchema,
    handler: chaosInject.handler as MCPTool['handler'],
  },
];

/**
 * Tool lookup by name
 */
export const toolsByName: Map<string, MCPTool> = new Map(
  mcpTools.map((tool) => [tool.name, tool])
);

/**
 * Tools grouped by category
 */
export const toolsByCategory: Map<string, MCPTool[]> = new Map();
for (const tool of mcpTools) {
  const category = tool.category;
  if (!toolsByCategory.has(category)) {
    toolsByCategory.set(category, []);
  }
  toolsByCategory.get(category)!.push(tool);
}

/**
 * Get tool by name
 */
export function getTool(name: string): MCPTool | undefined {
  return toolsByName.get(name);
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): MCPTool[] {
  return toolsByCategory.get(category) || [];
}

/**
 * Get all tool names
 */
export function getToolNames(): string[] {
  return mcpTools.map((t) => t.name);
}

/**
 * Get all categories
 */
export function getCategories(): string[] {
  return Array.from(toolsByCategory.keys());
}

// Export individual tools for direct import
export {
  generateTests,
  tddCycle,
  suggestTests,
  analyzeCoverage,
  prioritizeGaps,
  trackTrends,
  evaluateQualityGate,
  assessReadiness,
  calculateRisk,
  predictDefects,
  analyzeRootCause,
  findSimilarDefects,
  securityScan,
  auditCompliance,
  detectSecrets,
  chaosInject,
};

// Export schemas for external use
export {
  GenerateTestsInputSchema,
  TDDCycleInputSchema,
  SuggestTestsInputSchema,
  AnalyzeCoverageInputSchema,
  PrioritizeGapsInputSchema,
  TrackTrendsInputSchema,
  EvaluateQualityGateInputSchema,
  AssessReadinessInputSchema,
  CalculateRiskInputSchema,
  PredictDefectsInputSchema,
  AnalyzeRootCauseInputSchema,
  FindSimilarDefectsInputSchema,
  SecurityScanInputSchema,
  AuditComplianceInputSchema,
  DetectSecretsInputSchema,
  ChaosInjectInputSchema,
};

export default mcpTools;
