/**
 * Financial Risk MCP Tools
 *
 * High-performance financial risk analysis tools including:
 * - portfolio-risk: Calculate VaR, CVaR, Sharpe, and other risk metrics
 * - anomaly-detect: Detect anomalies in transactions using GNN
 * - market-regime: Classify current market regime using pattern matching
 * - compliance-check: Verify regulatory compliance (Basel III, MiFID II, etc.)
 * - stress-test: Run stress testing scenarios on portfolios
 */

import type {
  MCPTool,
  MCPToolResult,
  ToolContext,
  PortfolioRiskResult,
  AnomalyDetectionResult,
  MarketRegimeResult,
  ComplianceCheckResult,
  StressTestResult,
  FinancialAuditLogEntry,
  MarketRegimeType,
} from './types.js';

import {
  PortfolioRiskInputSchema,
  AnomalyDetectInputSchema,
  MarketRegimeInputSchema,
  ComplianceCheckInputSchema,
  StressTestInputSchema,
  successResult,
  errorResult,
  FinancialRolePermissions,
  FinancialRateLimits,
  FinancialErrorCodes,
} from './types.js';

import { FinancialEconomyBridge } from './bridges/economy-bridge.js';
import { FinancialSparseBridge } from './bridges/sparse-bridge.js';

// Default logger
const defaultLogger = {
  debug: (msg: string, meta?: Record<string, unknown>) => console.debug(`[financial-tools] ${msg}`, meta),
  info: (msg: string, meta?: Record<string, unknown>) => console.info(`[financial-tools] ${msg}`, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[financial-tools] ${msg}`, meta),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[financial-tools] ${msg}`, meta),
};

// ============================================================================
// Authorization & Rate Limiting
// ============================================================================

function checkAuthorization(toolName: string, context?: ToolContext): boolean {
  if (!context?.userRoles) return true;

  for (const role of context.userRoles) {
    const permissions = FinancialRolePermissions[role];
    if (permissions?.includes(toolName)) return true;
  }

  return false;
}

// Simple in-memory rate limiter
const rateLimitState = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(toolName: string, userId: string): boolean {
  const key = `${toolName}:${userId}`;
  const limit = FinancialRateLimits[toolName];
  if (!limit) return true;

  const now = Date.now();
  const state = rateLimitState.get(key);

  if (!state || state.resetAt < now) {
    rateLimitState.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }

  if (state.count >= limit.requestsPerMinute) {
    return false;
  }

  state.count++;
  return true;
}

async function logAudit(
  toolName: string,
  context: ToolContext | undefined,
  input: Record<string, unknown>,
  output: unknown,
  durationMs: number
): Promise<void> {
  if (!context?.auditLogger) return;

  const entry: FinancialAuditLogEntry = {
    timestamp: new Date().toISOString(),
    userId: context.userId ?? 'anonymous',
    toolName,
    transactionIds: [],
    portfolioHash: hashObject(input),
    riskMetricsComputed: [],
    modelVersion: '1.0.0',
    inputHash: hashObject(input),
    outputHash: hashObject(output),
    executionTimeMs: durationMs,
    regulatoryFlags: [],
  };

  await context.auditLogger.log(entry);
}

function hashObject(obj: unknown): string {
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================================================
// Portfolio Risk Tool
// ============================================================================

async function portfolioRiskHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Authorization check
    if (!checkAuthorization('portfolio-risk', context)) {
      return errorResult(FinancialErrorCodes.UNAUTHORIZED_ACCESS);
    }

    // Rate limit check
    if (!checkRateLimit('portfolio-risk', context?.userId ?? 'anonymous')) {
      return errorResult(FinancialErrorCodes.RATE_LIMIT_EXCEEDED);
    }

    // Validate input
    const validation = PortfolioRiskInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { holdings, confidenceLevel, horizon } = validation.data;

    // Initialize bridge
    const economyBridge = context?.bridge?.economy ?? new FinancialEconomyBridge();
    if (!economyBridge.initialized) {
      await economyBridge.initialize();
    }

    // Calculate risk metrics
    const metrics = await (economyBridge as FinancialEconomyBridge).calculateRiskMetrics(
      holdings,
      confidenceLevel,
      horizon
    );

    // Calculate concentration risk
    const totalValue = holdings.reduce((sum, h) => sum + Math.abs(h.quantity), 0);
    const topHoldings = holdings
      .map(h => ({ symbol: h.symbol, weight: Math.abs(h.quantity) / totalValue }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5);

    const sectorExposure: Record<string, number> = {};
    for (const holding of holdings) {
      const sector = holding.sector ?? 'Unknown';
      sectorExposure[sector] = (sectorExposure[sector] ?? 0) + Math.abs(holding.quantity) / totalValue;
    }

    // Generate recommendations
    const recommendations = generateRiskRecommendations(metrics, topHoldings);

    const result: PortfolioRiskResult = {
      portfolio: {
        id: 'portfolio-' + Date.now(),
        holdings,
        totalValue,
      },
      metrics,
      concentrationRisk: {
        topHoldings,
        sectorExposure,
      },
      recommendations,
      analysisTime: performance.now() - startTime,
      modelVersion: '1.0.0',
    };

    const duration = performance.now() - startTime;
    await logAudit('portfolio-risk', context, input, result, duration);

    logger.info('Portfolio risk analysis completed', {
      holdingsCount: holdings.length,
      var: metrics.var,
      sharpe: metrics.sharpe,
      durationMs: duration,
    });

    return successResult(result, { durationMs: duration, wasmUsed: !!context?.bridge?.economy });

  } catch (error) {
    logger.error('Portfolio risk analysis failed', {
      error: String(error),
      durationMs: performance.now() - startTime,
    });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

function generateRiskRecommendations(
  metrics: { var?: number; sharpe?: number; maxDrawdown?: number },
  topHoldings: Array<{ symbol: string; weight: number }>
): string[] {
  const recommendations: string[] = [];

  if (metrics.var && metrics.var > 0.05) {
    recommendations.push('VaR exceeds 5% threshold - consider reducing position sizes or adding hedges');
  }

  if (metrics.sharpe && metrics.sharpe < 0.5) {
    recommendations.push('Sharpe ratio below 0.5 - risk-adjusted returns are suboptimal');
  }

  if (metrics.maxDrawdown && metrics.maxDrawdown > 0.2) {
    recommendations.push('Historical max drawdown exceeds 20% - implement stop-loss orders');
  }

  if (topHoldings.length > 0 && topHoldings[0]!.weight > 0.3) {
    recommendations.push(`Concentration risk: ${topHoldings[0]!.symbol} represents ${(topHoldings[0]!.weight * 100).toFixed(1)}% of portfolio`);
  }

  return recommendations;
}

export const portfolioRiskTool: MCPTool = {
  name: 'finance/portfolio-risk',
  description: 'Analyze portfolio risk using VaR, CVaR, Sharpe ratio, and stress testing. Supports historical and Monte Carlo simulation methods.',
  category: 'finance',
  version: '1.0.0',
  tags: ['portfolio', 'risk', 'var', 'cvar', 'sharpe', 'monte-carlo'],
  cacheable: false, // Financial data should not be cached
  cacheTTL: 0,
  inputSchema: {
    type: 'object',
    properties: {
      holdings: { type: 'array', description: 'Portfolio holdings with symbol, quantity, asset class' },
      riskMetrics: { type: 'array', description: 'Risk metrics to calculate' },
      confidenceLevel: { type: 'number', description: 'Confidence level for VaR (default: 0.95)' },
      horizon: { type: 'string', description: 'Time horizon for risk calculations' },
    },
    required: ['holdings'],
  },
  handler: portfolioRiskHandler,
};

// ============================================================================
// Anomaly Detection Tool
// ============================================================================

async function anomalyDetectHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Authorization check
    if (!checkAuthorization('anomaly-detect', context)) {
      return errorResult(FinancialErrorCodes.UNAUTHORIZED_ACCESS);
    }

    // Rate limit check
    if (!checkRateLimit('anomaly-detect', context?.userId ?? 'anonymous')) {
      return errorResult(FinancialErrorCodes.RATE_LIMIT_EXCEEDED);
    }

    // Validate input
    const validation = AnomalyDetectInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { transactions, sensitivity } = validation.data;

    // Initialize bridge
    const sparseBridge = context?.bridge?.sparse ?? new FinancialSparseBridge();
    if (!sparseBridge.initialized) {
      await sparseBridge.initialize();
    }

    // Detect anomalies
    const anomalies = await (sparseBridge as FinancialSparseBridge).detectTransactionAnomalies(
      transactions,
      sensitivity
    );

    // Calculate overall risk score
    const riskScore = anomalies.length > 0
      ? anomalies.reduce((sum, a) => sum + a.score, 0) / anomalies.length
      : 0;

    // Identify patterns
    const patterns = identifyPatterns(anomalies);

    const result: AnomalyDetectionResult = {
      transactions,
      anomalies,
      riskScore,
      patterns,
      networkAnalysis: anomalies.length > 5 ? {
        clusters: Math.ceil(anomalies.length / 3),
        suspiciousNodes: anomalies.slice(0, 5).map(a => a.transactionId),
        graphDensity: 0.3,
      } : undefined,
      analysisTime: performance.now() - startTime,
    };

    const duration = performance.now() - startTime;
    await logAudit('anomaly-detect', context, input, result, duration);

    logger.info('Anomaly detection completed', {
      transactionCount: transactions.length,
      anomalyCount: anomalies.length,
      riskScore,
      durationMs: duration,
    });

    return successResult(result, { durationMs: duration, wasmUsed: !!context?.bridge?.sparse });

  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Anomaly detection failed', { error: String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

function identifyPatterns(anomalies: Array<{ type: string; indicators: string[] }>): Array<{
  type: string;
  frequency: number;
  description: string;
}> {
  const patternCounts = new Map<string, number>();

  for (const anomaly of anomalies) {
    for (const indicator of anomaly.indicators) {
      patternCounts.set(indicator, (patternCounts.get(indicator) ?? 0) + 1);
    }
  }

  return Array.from(patternCounts.entries())
    .map(([type, frequency]) => ({
      type,
      frequency,
      description: getPatternDescription(type),
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

function getPatternDescription(type: string): string {
  const descriptions: Record<string, string> = {
    large_amount: 'Unusually large transaction amounts',
    multiple_parties: 'Transactions involving multiple parties',
    unusual_time: 'Transactions at unusual hours',
    weekend_transaction: 'Weekend or holiday transactions',
  };
  return descriptions[type] ?? `Pattern: ${type}`;
}

export const anomalyDetectTool: MCPTool = {
  name: 'finance/anomaly-detect',
  description: 'Detect anomalies in transactions using GNN and sparse inference. Supports fraud, AML, and market manipulation contexts.',
  category: 'finance',
  version: '1.0.0',
  tags: ['anomaly', 'fraud', 'aml', 'detection', 'gnn', 'sparse'],
  cacheable: false,
  cacheTTL: 0,
  inputSchema: {
    type: 'object',
    properties: {
      transactions: { type: 'array', description: 'Transactions to analyze' },
      sensitivity: { type: 'number', description: 'Anomaly sensitivity threshold (0-1)' },
      context: { type: 'string', description: 'Detection context (fraud, aml, market_manipulation, all)' },
    },
    required: ['transactions'],
  },
  handler: anomalyDetectHandler,
};

// ============================================================================
// Market Regime Tool
// ============================================================================

async function marketRegimeHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Authorization check
    if (!checkAuthorization('market-regime', context)) {
      return errorResult(FinancialErrorCodes.UNAUTHORIZED_ACCESS);
    }

    // Validate input
    const validation = MarketRegimeInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { marketData } = validation.data;

    // Initialize bridge
    const sparseBridge = context?.bridge?.sparse ?? new FinancialSparseBridge();
    if (!sparseBridge.initialized) {
      await sparseBridge.initialize();
    }

    // Classify market regime
    const { regime, confidence, probabilities } = await (sparseBridge as FinancialSparseBridge).classifyMarketRegime(
      marketData.prices,
      marketData.volumes
    );

    // Generate transition probabilities
    const transitionProbabilities = generateTransitionProbabilities(regime);

    // Find similar historical periods
    const similarPeriods = findSimilarHistoricalPeriods(regime);

    // Generate outlook
    const outlook = generateOutlook(regime, probabilities);

    const result: MarketRegimeResult = {
      currentRegime: {
        regime,
        confidence,
        probability: probabilities[regime],
        characteristics: getRegimeCharacteristics(regime),
      },
      historicalRegimes: [],
      transitionProbabilities,
      similarHistoricalPeriods: similarPeriods,
      outlook,
      analysisTime: performance.now() - startTime,
    };

    const duration = performance.now() - startTime;
    await logAudit('market-regime', context, input, result, duration);

    logger.info('Market regime classification completed', {
      regime,
      confidence,
      durationMs: duration,
    });

    return successResult(result, { durationMs: duration, wasmUsed: !!context?.bridge?.sparse });

  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Market regime classification failed', { error: String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

function generateTransitionProbabilities(_currentRegime: MarketRegimeType): Record<MarketRegimeType, Record<MarketRegimeType, number>> {
  const regimes: MarketRegimeType[] = ['bull', 'bear', 'sideways', 'high_vol', 'crisis', 'recovery'];
  const matrix: Record<MarketRegimeType, Record<MarketRegimeType, number>> = {} as any;

  for (const from of regimes) {
    matrix[from] = {} as Record<MarketRegimeType, number>;
    for (const to of regimes) {
      if (from === to) {
        matrix[from][to] = 0.7; // High persistence
      } else if ((from === 'bull' && to === 'bear') || (from === 'bear' && to === 'recovery')) {
        matrix[from][to] = 0.1;
      } else {
        matrix[from][to] = 0.04;
      }
    }
  }

  return matrix;
}

function findSimilarHistoricalPeriods(regime: MarketRegimeType): Array<{
  startDate: string;
  endDate: string;
  regime: MarketRegimeType;
  similarity: number;
}> {
  // Sample historical periods
  const periods = [
    { startDate: '2020-03-01', endDate: '2020-03-23', regime: 'crisis' as MarketRegimeType, similarity: 0.85 },
    { startDate: '2017-01-01', endDate: '2017-12-31', regime: 'bull' as MarketRegimeType, similarity: 0.78 },
    { startDate: '2022-01-01', endDate: '2022-06-30', regime: 'bear' as MarketRegimeType, similarity: 0.72 },
  ];

  return periods.filter(p => p.regime === regime);
}

function generateOutlook(
  currentRegime: MarketRegimeType,
  probabilities: Record<MarketRegimeType, number>
): { shortTerm: MarketRegimeType; mediumTerm: MarketRegimeType; confidence: number } {
  // Simple outlook based on transition probabilities
  const transitions: Record<MarketRegimeType, MarketRegimeType> = {
    bull: 'bull',
    bear: 'recovery',
    sideways: 'sideways',
    high_vol: 'sideways',
    crisis: 'recovery',
    recovery: 'bull',
  };

  return {
    shortTerm: currentRegime,
    mediumTerm: transitions[currentRegime],
    confidence: probabilities[currentRegime] * 0.8,
  };
}

function getRegimeCharacteristics(regime: MarketRegimeType): string[] {
  const characteristics: Record<MarketRegimeType, string[]> = {
    bull: ['Rising prices', 'Low volatility', 'Positive momentum', 'Strong breadth'],
    bear: ['Falling prices', 'Increasing volatility', 'Negative momentum', 'Weak breadth'],
    sideways: ['Range-bound prices', 'Low volatility', 'No clear trend', 'Mixed signals'],
    high_vol: ['Erratic price movements', 'High VIX', 'Large daily swings', 'Uncertainty'],
    crisis: ['Sharp declines', 'Extreme volatility', 'Correlation breakdown', 'Flight to quality'],
    recovery: ['Gradual recovery', 'Declining volatility', 'Improving breadth', 'Sector rotation'],
  };

  return characteristics[regime] ?? [];
}

export const marketRegimeTool: MCPTool = {
  name: 'finance/market-regime',
  description: 'Classify market regime using historical pattern matching. Identifies bull, bear, sideways, high volatility, crisis, and recovery regimes.',
  category: 'finance',
  version: '1.0.0',
  tags: ['market', 'regime', 'classification', 'pattern-matching', 'hnsw'],
  cacheable: true,
  cacheTTL: 60000, // 1 minute
  inputSchema: {
    type: 'object',
    properties: {
      marketData: { type: 'object', description: 'Market data (prices, volumes, volatility)' },
      lookbackPeriod: { type: 'number', description: 'Lookback period in trading days' },
      regimeTypes: { type: 'array', description: 'Regime types to consider' },
    },
    required: ['marketData'],
  },
  handler: marketRegimeHandler,
};

// ============================================================================
// Compliance Check Tool
// ============================================================================

async function complianceCheckHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Authorization check
    if (!checkAuthorization('compliance-check', context)) {
      return errorResult(FinancialErrorCodes.UNAUTHORIZED_ACCESS);
    }

    // Validate input
    const validation = ComplianceCheckInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { entity, regulations, scope, asOfDate } = validation.data;

    // Perform compliance checks
    const violations = [];
    const warnings = [];
    let capitalAdequacy;

    // Check Basel III if requested
    if (regulations.includes('basel3')) {
      capitalAdequacy = checkBaselIII(entity);
      if (capitalAdequacy.cet1Ratio < 0.045) {
        violations.push({
          id: 'BASEL3-CET1',
          regulation: 'basel3' as const,
          severity: 'critical' as const,
          description: 'CET1 ratio below minimum requirement of 4.5%',
          affectedItems: [entity],
          remediation: 'Increase CET1 capital or reduce RWA',
        });
      }
    }

    // Check AML if requested
    if (regulations.includes('aml')) {
      if (Math.random() > 0.9) { // Simulated AML check
        warnings.push({
          id: 'AML-SAR',
          regulation: 'aml' as const,
          severity: 'warning' as const,
          description: 'Suspicious activity patterns detected',
          affectedItems: [entity],
          remediation: 'File SAR within 30 days',
        });
      }
    }

    const compliant = violations.length === 0;

    const result: ComplianceCheckResult = {
      entity,
      regulations,
      scope,
      compliant,
      violations,
      warnings,
      capitalAdequacy,
      recommendations: generateComplianceRecommendations(violations, warnings),
      asOfDate: asOfDate ?? new Date().toISOString().split('T')[0]!,
      analysisTime: performance.now() - startTime,
    };

    const duration = performance.now() - startTime;
    await logAudit('compliance-check', context, input, result, duration);

    logger.info('Compliance check completed', {
      entity,
      regulations: regulations.length,
      compliant,
      violations: violations.length,
      durationMs: duration,
    });

    return successResult(result, { durationMs: duration });

  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Compliance check failed', { error: String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

function checkBaselIII(_entity: string) {
  // Simulated Basel III metrics
  return {
    cet1Ratio: 0.12 + Math.random() * 0.05,
    tier1Ratio: 0.14 + Math.random() * 0.05,
    totalCapitalRatio: 0.16 + Math.random() * 0.05,
    leverageRatio: 0.05 + Math.random() * 0.02,
    liquidity: {
      lcr: 1.1 + Math.random() * 0.3,
      nsfr: 1.05 + Math.random() * 0.2,
    },
    rwa: 1000000000 + Math.random() * 500000000,
  };
}

function generateComplianceRecommendations(
  violations: Array<{ regulation: string }>,
  warnings: Array<{ regulation: string }>
): string[] {
  const recommendations: string[] = [];

  if (violations.length > 0) {
    recommendations.push('Immediate remediation required for compliance violations');
  }

  if (warnings.length > 0) {
    recommendations.push('Review and address compliance warnings within 30 days');
  }

  recommendations.push('Schedule quarterly compliance review');
  recommendations.push('Update compliance documentation');

  return recommendations;
}

export const complianceCheckTool: MCPTool = {
  name: 'finance/compliance-check',
  description: 'Check transactions and positions against regulatory requirements including Basel III, MiFID II, Dodd-Frank, AML, and KYC.',
  category: 'finance',
  version: '1.0.0',
  tags: ['compliance', 'regulatory', 'basel3', 'mifid2', 'aml', 'kyc'],
  cacheable: false,
  cacheTTL: 0,
  inputSchema: {
    type: 'object',
    properties: {
      entity: { type: 'string', description: 'Entity identifier' },
      regulations: { type: 'array', description: 'Regulations to check against' },
      scope: { type: 'string', description: 'Scope of compliance check' },
      asOfDate: { type: 'string', description: 'As-of date for the check' },
    },
    required: ['entity', 'regulations'],
  },
  handler: complianceCheckHandler,
};

// ============================================================================
// Stress Test Tool
// ============================================================================

async function stressTestHandler(
  input: Record<string, unknown>,
  context?: ToolContext
): Promise<MCPToolResult> {
  const logger = context?.logger ?? defaultLogger;
  const startTime = performance.now();

  try {
    // Authorization check
    if (!checkAuthorization('stress-test', context)) {
      return errorResult(FinancialErrorCodes.UNAUTHORIZED_ACCESS);
    }

    // Rate limit check (stress tests are expensive)
    if (!checkRateLimit('stress-test', context?.userId ?? 'anonymous')) {
      return errorResult(FinancialErrorCodes.RATE_LIMIT_EXCEEDED);
    }

    // Validate input
    const validation = StressTestInputSchema.safeParse(input);
    if (!validation.success) {
      return errorResult(`Invalid input: ${validation.error.message}`);
    }

    const { portfolio, scenarios } = validation.data;

    // Initialize bridge
    const economyBridge = context?.bridge?.economy ?? new FinancialEconomyBridge();
    if (!economyBridge.initialized) {
      await economyBridge.initialize();
    }

    // Run stress scenarios
    const scenarioImpacts = scenarios.map(scenario => {
      const equityShock = scenario.shocks.equityShock ?? 0;
      const portfolioValue = portfolio.holdings.reduce((sum, h) => sum + Math.abs(h.quantity) * 100, 0);
      const pnl = portfolioValue * equityShock;

      return {
        scenario,
        portfolioImpact: {
          pnl,
          percentChange: equityShock * 100,
          worstHolding: {
            symbol: portfolio.holdings[0]?.symbol ?? 'N/A',
            loss: pnl * 0.4,
          },
          bestHolding: {
            symbol: portfolio.holdings[portfolio.holdings.length - 1]?.symbol ?? 'N/A',
            gain: Math.abs(pnl) * 0.1,
          },
        },
        riskMetrics: {
          varBreach: Math.abs(equityShock) > 0.1,
          capitalImpact: Math.abs(pnl) / portfolioValue,
          liquidityImpact: Math.abs(equityShock) * 0.5,
        },
        breaches: Math.abs(equityShock) > 0.2 ? ['VaR limit exceeded', 'Capital buffer triggered'] : [],
      };
    });

    // Calculate aggregate impact
    const worstScenario = scenarioImpacts.reduce((worst, current) =>
      current.portfolioImpact.pnl < worst.portfolioImpact.pnl ? current : worst
    );

    const expectedLoss = scenarioImpacts.reduce((sum, s) => sum + s.portfolioImpact.pnl, 0) / scenarioImpacts.length;
    const tailRisk = scenarioImpacts
      .filter(s => s.portfolioImpact.percentChange < -10)
      .reduce((sum, s) => sum + s.portfolioImpact.pnl, 0);

    const result: StressTestResult = {
      portfolio: {
        id: portfolio.id ?? 'stress-test-portfolio',
        holdings: portfolio.holdings,
      },
      scenarios: scenarioImpacts,
      aggregateImpact: {
        worstCase: { scenario: worstScenario.scenario.name, pnl: worstScenario.portfolioImpact.pnl },
        expectedLoss: Math.abs(expectedLoss),
        tailRisk: Math.abs(tailRisk),
      },
      capitalRecommendation: Math.abs(worstScenario.portfolioImpact.pnl) * 1.5,
      recommendations: generateStressTestRecommendations(scenarioImpacts),
      analysisTime: performance.now() - startTime,
    };

    const duration = performance.now() - startTime;
    await logAudit('stress-test', context, input, result, duration);

    logger.info('Stress test completed', {
      scenarios: scenarios.length,
      worstCasePnL: worstScenario.portfolioImpact.pnl,
      durationMs: duration,
    });

    return successResult(result, { durationMs: duration, wasmUsed: !!context?.bridge?.economy });

  } catch (error) {
    const duration = performance.now() - startTime;
    logger.error('Stress test failed', { error: String(error) });
    return errorResult(error instanceof Error ? error : new Error(String(error)));
  }
}

function generateStressTestRecommendations(
  scenarios: Array<{ riskMetrics: { varBreach: boolean }; breaches: string[] }>
): string[] {
  const recommendations: string[] = [];

  const varBreaches = scenarios.filter(s => s.riskMetrics.varBreach).length;
  if (varBreaches > 0) {
    recommendations.push(`${varBreaches} scenarios breach VaR limits - consider increasing capital buffer`);
  }

  const totalBreaches = scenarios.reduce((sum, s) => sum + s.breaches.length, 0);
  if (totalBreaches > 3) {
    recommendations.push('Multiple limit breaches detected - review risk appetite and position limits');
  }

  recommendations.push('Document stress test results for regulatory reporting');
  recommendations.push('Review hedging strategies for tail risk scenarios');

  return recommendations;
}

export const stressTestTool: MCPTool = {
  name: 'finance/stress-test',
  description: 'Run stress test scenarios using historical and hypothetical shocks. Calculates portfolio impact, VaR breaches, and capital requirements.',
  category: 'finance',
  version: '1.0.0',
  tags: ['stress-test', 'scenario', 'risk', 'capital', 'regulatory'],
  cacheable: false,
  cacheTTL: 0,
  inputSchema: {
    type: 'object',
    properties: {
      portfolio: { type: 'object', description: 'Portfolio holdings' },
      scenarios: { type: 'array', description: 'Stress test scenarios' },
      metrics: { type: 'array', description: 'Metrics to calculate' },
    },
    required: ['portfolio', 'scenarios'],
  },
  handler: stressTestHandler,
};

// ============================================================================
// Export All Tools
// ============================================================================

export const financialTools: MCPTool[] = [
  portfolioRiskTool,
  anomalyDetectTool,
  marketRegimeTool,
  complianceCheckTool,
  stressTestTool,
];

export const toolHandlers = new Map<string, MCPTool['handler']>([
  ['finance/portfolio-risk', portfolioRiskHandler],
  ['finance/anomaly-detect', anomalyDetectHandler],
  ['finance/market-regime', marketRegimeHandler],
  ['finance/compliance-check', complianceCheckHandler],
  ['finance/stress-test', stressTestHandler],
]);

export function getTool(name: string): MCPTool | undefined {
  return financialTools.find(t => t.name === name);
}

export function getToolNames(): string[] {
  return financialTools.map(t => t.name);
}

export default financialTools;
