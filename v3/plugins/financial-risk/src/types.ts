/**
 * Financial Risk Plugin - Type Definitions
 *
 * Core types for financial risk analysis including portfolio risk,
 * anomaly detection, market regime classification, compliance checking,
 * and stress testing.
 */

import { z } from 'zod';

// ============================================================================
// MCP Tool Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  category: string;
  version: string;
  tags: string[];
  cacheable: boolean;
  cacheTTL: number;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  handler: (input: Record<string, unknown>, context?: ToolContext) => Promise<MCPToolResult>;
}

/**
 * MCP Tool result
 */
export interface MCPToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: {
    durationMs?: number;
    cached?: boolean;
    wasmUsed?: boolean;
  };
}

/**
 * Tool execution context
 */
export interface ToolContext {
  logger?: Logger;
  config?: FinancialConfig;
  bridge?: FinancialBridge;
  userId?: string;
  userRoles?: FinancialRole[];
  auditLogger?: FinancialAuditLogger;
}

/**
 * Simple logger interface
 */
export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Portfolio Types
// ============================================================================

/**
 * Portfolio holding
 */
export interface PortfolioHolding {
  symbol: string;
  quantity: number;
  assetClass?: string;
  sector?: string;
  currency?: string;
  marketValue?: number;
  costBasis?: number;
}

/**
 * Portfolio
 */
export interface Portfolio {
  id: string;
  name?: string;
  holdings: PortfolioHolding[];
  totalValue?: number;
  currency?: string;
  asOfDate?: string;
}

/**
 * Risk metric types
 */
export type RiskMetricType = 'var' | 'cvar' | 'sharpe' | 'sortino' | 'max_drawdown' | 'beta' | 'volatility';

/**
 * Time horizon for risk calculations
 */
export type TimeHorizon = '1d' | '1w' | '1m' | '3m' | '1y';

/**
 * Risk metrics result
 */
export interface RiskMetrics {
  var?: number;
  cvar?: number;
  sharpe?: number;
  sortino?: number;
  maxDrawdown?: number;
  beta?: number;
  volatility?: number;
  confidenceLevel: number;
  horizon: TimeHorizon;
}

/**
 * Portfolio risk result
 */
export interface PortfolioRiskResult {
  portfolio: Portfolio;
  metrics: RiskMetrics;
  concentrationRisk: {
    topHoldings: Array<{ symbol: string; weight: number }>;
    sectorExposure: Record<string, number>;
    geographicExposure?: Record<string, number>;
  };
  recommendations: string[];
  analysisTime: number;
  modelVersion: string;
}

// ============================================================================
// Anomaly Detection Types
// ============================================================================

/**
 * Financial transaction
 */
export interface FinancialTransaction {
  id: string;
  amount: number;
  timestamp: string;
  parties: string[];
  type?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Anomaly context types
 */
export type AnomalyContext = 'fraud' | 'aml' | 'market_manipulation' | 'all';

/**
 * Anomaly severity
 */
export type AnomalySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Detected anomaly
 */
export interface DetectedAnomaly {
  transactionId: string;
  score: number;
  severity: AnomalySeverity;
  type: string;
  description: string;
  indicators: string[];
  relatedTransactions?: string[];
  recommendedAction: string;
}

/**
 * Anomaly detection result
 */
export interface AnomalyDetectionResult {
  transactions: FinancialTransaction[];
  anomalies: DetectedAnomaly[];
  riskScore: number;
  patterns: Array<{
    type: string;
    frequency: number;
    description: string;
  }>;
  networkAnalysis?: {
    clusters: number;
    suspiciousNodes: string[];
    graphDensity: number;
  };
  analysisTime: number;
}

// ============================================================================
// Market Regime Types
// ============================================================================

/**
 * Market regime types
 */
export type MarketRegimeType = 'bull' | 'bear' | 'sideways' | 'high_vol' | 'crisis' | 'recovery';

/**
 * Market data for regime classification
 */
export interface MarketData {
  prices: number[];
  volumes?: number[];
  volatility?: number[];
  timestamps?: string[];
}

/**
 * Regime classification
 */
export interface RegimeClassification {
  regime: MarketRegimeType;
  confidence: number;
  probability: number;
  duration?: number;
  characteristics: string[];
}

/**
 * Market regime result
 */
export interface MarketRegimeResult {
  currentRegime: RegimeClassification;
  historicalRegimes: RegimeClassification[];
  transitionProbabilities: Record<MarketRegimeType, Record<MarketRegimeType, number>>;
  similarHistoricalPeriods: Array<{
    startDate: string;
    endDate: string;
    regime: MarketRegimeType;
    similarity: number;
  }>;
  outlook: {
    shortTerm: MarketRegimeType;
    mediumTerm: MarketRegimeType;
    confidence: number;
  };
  analysisTime: number;
}

// ============================================================================
// Compliance Types
// ============================================================================

/**
 * Regulation types
 */
export type RegulationType = 'basel3' | 'mifid2' | 'dodd_frank' | 'aml' | 'kyc' | 'fatca' | 'gdpr';

/**
 * Compliance scope
 */
export type ComplianceScope = 'positions' | 'transactions' | 'capital' | 'reporting' | 'all';

/**
 * Compliance violation
 */
export interface ComplianceViolation {
  id: string;
  regulation: RegulationType;
  severity: 'critical' | 'major' | 'minor' | 'warning';
  description: string;
  affectedItems: string[];
  remediation: string;
  deadline?: string;
}

/**
 * Capital adequacy metrics (Basel III)
 */
export interface CapitalAdequacy {
  cet1Ratio: number;
  tier1Ratio: number;
  totalCapitalRatio: number;
  leverageRatio: number;
  liquidity: {
    lcr: number;
    nsfr: number;
  };
  rwa: number;
}

/**
 * Compliance check result
 */
export interface ComplianceCheckResult {
  entity: string;
  regulations: RegulationType[];
  scope: ComplianceScope;
  compliant: boolean;
  violations: ComplianceViolation[];
  warnings: ComplianceViolation[];
  capitalAdequacy?: CapitalAdequacy;
  recommendations: string[];
  asOfDate: string;
  analysisTime: number;
}

// ============================================================================
// Stress Test Types
// ============================================================================

/**
 * Stress test scenario type
 */
export type ScenarioType = 'historical' | 'hypothetical' | 'reverse';

/**
 * Market shocks for stress testing
 */
export interface MarketShocks {
  equityShock?: number;
  interestRateShock?: number;
  creditSpreadShock?: number;
  fxShock?: Record<string, number>;
  commodityShock?: Record<string, number>;
  volatilityShock?: number;
}

/**
 * Stress test scenario
 */
export interface StressScenario {
  name: string;
  type: ScenarioType;
  description?: string;
  shocks: MarketShocks;
  historicalReference?: string;
}

/**
 * Scenario impact result
 */
export interface ScenarioImpact {
  scenario: StressScenario;
  portfolioImpact: {
    pnl: number;
    percentChange: number;
    worstHolding: { symbol: string; loss: number };
    bestHolding: { symbol: string; gain: number };
  };
  riskMetrics: {
    varBreach: boolean;
    capitalImpact: number;
    liquidityImpact: number;
  };
  breaches: string[];
}

/**
 * Stress test result
 */
export interface StressTestResult {
  portfolio: Portfolio;
  scenarios: ScenarioImpact[];
  aggregateImpact: {
    worstCase: { scenario: string; pnl: number };
    expectedLoss: number;
    tailRisk: number;
  };
  capitalRecommendation: number;
  recommendations: string[];
  analysisTime: number;
}

// ============================================================================
// Security & Compliance Types
// ============================================================================

/**
 * Financial roles for RBAC
 */
export type FinancialRole = 'TRADER' | 'RISK_MANAGER' | 'COMPLIANCE_OFFICER' | 'AUDITOR' | 'QUANT' | 'ADMIN';

/**
 * Financial audit log entry (SOX/MiFID II compliant)
 */
export interface FinancialAuditLogEntry {
  timestamp: string;
  userId: string;
  toolName: string;
  transactionIds: string[];
  portfolioHash: string;
  riskMetricsComputed: string[];
  modelVersion: string;
  inputHash: string;
  outputHash: string;
  executionTimeMs: number;
  regulatoryFlags: string[];
}

/**
 * Financial audit logger interface
 */
export interface FinancialAuditLogger {
  log: (entry: FinancialAuditLogEntry) => Promise<void>;
  query: (filter: Partial<FinancialAuditLogEntry>) => Promise<FinancialAuditLogEntry[]>;
}

/**
 * Role-based access control mapping
 */
export const FinancialRolePermissions: Record<FinancialRole, string[]> = {
  TRADER: ['portfolio-risk', 'market-regime'],
  RISK_MANAGER: ['portfolio-risk', 'anomaly-detect', 'stress-test', 'market-regime'],
  COMPLIANCE_OFFICER: ['compliance-check', 'anomaly-detect'],
  AUDITOR: ['compliance-check'],
  QUANT: ['portfolio-risk', 'market-regime', 'stress-test'],
  ADMIN: ['portfolio-risk', 'anomaly-detect', 'market-regime', 'compliance-check', 'stress-test'],
};

/**
 * Rate limits per tool
 */
export const FinancialRateLimits: Record<string, { requestsPerMinute: number; maxConcurrent: number }> = {
  'portfolio-risk': { requestsPerMinute: 60, maxConcurrent: 5 },
  'anomaly-detect': { requestsPerMinute: 100, maxConcurrent: 10 },
  'stress-test': { requestsPerMinute: 10, maxConcurrent: 2 },
  'market-regime': { requestsPerMinute: 120, maxConcurrent: 10 },
  'compliance-check': { requestsPerMinute: 30, maxConcurrent: 3 },
};

// ============================================================================
// Bridge Types (WASM Integration)
// ============================================================================

/**
 * Economy Bridge interface for token economics
 */
export interface EconomyBridge {
  initialized: boolean;
  calculateVar: (returns: Float32Array, confidence: number) => Promise<number>;
  calculateCvar: (returns: Float32Array, confidence: number) => Promise<number>;
  optimizePortfolio: (returns: Float32Array[], constraints: Record<string, number>) => Promise<Float32Array>;
  simulateMonteCarlo: (portfolio: Float32Array, scenarios: number, horizon: number) => Promise<Float32Array>;
  initialize: (config?: EconomyConfig) => Promise<void>;
}

/**
 * Economy bridge configuration
 */
export interface EconomyConfig {
  precision?: number;
  randomSeed?: number;
  defaultScenarios?: number;
}

/**
 * Sparse Bridge interface for efficient risk calculations
 */
export interface SparseBridge {
  initialized: boolean;
  sparseInference: (features: Float32Array, indices: Uint32Array) => Promise<Float32Array>;
  detectAnomalies: (transactions: Float32Array[], threshold: number) => Promise<Uint32Array>;
  classifyRegime: (marketData: Float32Array) => Promise<{ regime: number; confidence: number }>;
  initialize: (config?: SparseConfig) => Promise<void>;
}

/**
 * Sparse bridge configuration
 */
export interface SparseConfig {
  sparsityThreshold?: number;
  maxFeatures?: number;
  compressionLevel?: number;
}

/**
 * Combined financial bridge interface
 */
export interface FinancialBridge {
  economy?: EconomyBridge;
  sparse?: SparseBridge;
  initialized: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Financial plugin configuration
 */
export interface FinancialConfig {
  compliance: {
    auditEnabled: boolean;
    retentionYears: number;
    realTimeMonitoring: boolean;
  };
  risk: {
    defaultConfidenceLevel: number;
    defaultHorizon: TimeHorizon;
    maxPositions: number;
    varMethod: 'historical' | 'parametric' | 'monte_carlo';
  };
  anomaly: {
    defaultThreshold: number;
    maxTransactions: number;
    windowSize: number;
  };
  stressTest: {
    maxScenarios: number;
    defaultSimulations: number;
  };
  cache: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
}

/**
 * Default configuration
 */
export const DEFAULT_FINANCIAL_CONFIG: FinancialConfig = {
  compliance: {
    auditEnabled: true,
    retentionYears: 7,
    realTimeMonitoring: true,
  },
  risk: {
    defaultConfidenceLevel: 0.95,
    defaultHorizon: '1d',
    maxPositions: 10000,
    varMethod: 'historical',
  },
  anomaly: {
    defaultThreshold: 0.8,
    maxTransactions: 100000,
    windowSize: 30,
  },
  stressTest: {
    maxScenarios: 20,
    defaultSimulations: 10000,
  },
  cache: {
    enabled: true,
    ttl: 60000,
    maxSize: 500,
  },
};

// ============================================================================
// Zod Schemas for Input Validation
// ============================================================================

/**
 * Stock symbol validation
 */
const StockSymbolSchema = z.string().regex(/^[A-Z0-9.]{1,10}$/, 'Invalid stock symbol format').max(10);

/**
 * Portfolio risk input schema
 */
export const PortfolioRiskInputSchema = z.object({
  holdings: z.array(z.object({
    symbol: StockSymbolSchema,
    quantity: z.number().finite().min(-1e9).max(1e9),
    assetClass: z.string().max(50).optional(),
    sector: z.string().max(50).optional(),
    currency: z.string().max(3).optional(),
  })).min(1).max(10000),
  riskMetrics: z.array(z.enum(['var', 'cvar', 'sharpe', 'sortino', 'max_drawdown', 'beta', 'volatility'])).optional(),
  confidenceLevel: z.number().min(0.9).max(0.999).default(0.95),
  horizon: z.enum(['1d', '1w', '1m', '3m', '1y']).default('1d'),
});

/**
 * Anomaly detection input schema
 */
export const AnomalyDetectInputSchema = z.object({
  transactions: z.array(z.object({
    id: z.string().uuid(),
    amount: z.number().finite().min(-1e12).max(1e12),
    timestamp: z.string().datetime(),
    parties: z.array(z.string().max(200)).max(10),
    type: z.string().max(50).optional(),
    currency: z.string().max(3).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(100000),
  sensitivity: z.number().min(0).max(1).default(0.8),
  context: z.enum(['fraud', 'aml', 'market_manipulation', 'all']).default('all'),
});

/**
 * Market regime input schema
 */
export const MarketRegimeInputSchema = z.object({
  marketData: z.object({
    prices: z.array(z.number().finite()).min(10).max(10000),
    volumes: z.array(z.number().finite().min(0)).optional(),
    volatility: z.array(z.number().finite().min(0)).optional(),
    timestamps: z.array(z.string()).optional(),
  }),
  lookbackPeriod: z.number().int().min(10).max(1000).default(252),
  regimeTypes: z.array(z.enum(['bull', 'bear', 'sideways', 'high_vol', 'crisis', 'recovery'])).optional(),
});

/**
 * Compliance check input schema
 */
export const ComplianceCheckInputSchema = z.object({
  entity: z.string().max(200),
  regulations: z.array(z.enum(['basel3', 'mifid2', 'dodd_frank', 'aml', 'kyc', 'fatca', 'gdpr'])).min(1),
  scope: z.enum(['positions', 'transactions', 'capital', 'reporting', 'all']).default('all'),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Stress test input schema
 */
export const StressTestInputSchema = z.object({
  portfolio: z.object({
    id: z.string().optional(),
    holdings: z.array(z.object({
      symbol: StockSymbolSchema,
      quantity: z.number().finite(),
      assetClass: z.string().optional(),
    })).min(1).max(10000),
  }),
  scenarios: z.array(z.object({
    name: z.string().max(100),
    type: z.enum(['historical', 'hypothetical', 'reverse']),
    description: z.string().max(500).optional(),
    shocks: z.object({
      equityShock: z.number().min(-1).max(1).optional(),
      interestRateShock: z.number().min(-0.1).max(0.1).optional(),
      creditSpreadShock: z.number().min(-0.1).max(0.1).optional(),
      fxShock: z.record(z.string(), z.number().min(-1).max(1)).optional(),
      commodityShock: z.record(z.string(), z.number().min(-1).max(1)).optional(),
      volatilityShock: z.number().min(-1).max(5).optional(),
    }),
    historicalReference: z.string().optional(),
  })).min(1).max(20),
  metrics: z.array(z.string().max(50)).optional(),
});

// ============================================================================
// Result Helpers
// ============================================================================

/**
 * Create a success result
 */
export function successResult<T>(data: T, metadata?: MCPToolResult['metadata']): MCPToolResult {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Create an error result
 */
export function errorResult(error: string | Error, metadata?: MCPToolResult['metadata']): MCPToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : error,
    metadata,
  };
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Financial plugin error codes
 */
export const FinancialErrorCodes = {
  UNAUTHORIZED_ACCESS: 'FIN_UNAUTHORIZED_ACCESS',
  INVALID_PORTFOLIO: 'FIN_INVALID_PORTFOLIO',
  INVALID_TRANSACTION: 'FIN_INVALID_TRANSACTION',
  COMPLIANCE_VIOLATION: 'FIN_COMPLIANCE_VIOLATION',
  RATE_LIMIT_EXCEEDED: 'FIN_RATE_LIMIT_EXCEEDED',
  WASM_NOT_INITIALIZED: 'FIN_WASM_NOT_INITIALIZED',
  CALCULATION_FAILED: 'FIN_CALCULATION_FAILED',
  MARKET_DATA_UNAVAILABLE: 'FIN_MARKET_DATA_UNAVAILABLE',
  AUDIT_FAILED: 'FIN_AUDIT_FAILED',
  SCENARIO_INVALID: 'FIN_SCENARIO_INVALID',
} as const;

export type FinancialErrorCode = (typeof FinancialErrorCodes)[keyof typeof FinancialErrorCodes];

// ============================================================================
// Risk Calculation Proof (for audit reproducibility)
// ============================================================================

/**
 * Risk calculation proof for regulatory audits
 */
export interface RiskCalculationProof {
  inputHash: string;
  modelChecksum: string;
  randomSeed: string;
  outputHash: string;
  signature: string;
  timestamp: string;
}
