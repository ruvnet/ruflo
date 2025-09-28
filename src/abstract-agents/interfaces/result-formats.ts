/**
 * Result Format Interfaces
 * Standardized result formats for abstract agent outputs
 */

import type { AgentId } from '../../swarm/types.js';

// ===== CORE RESULT INTERFACES =====

export interface AbstractResult {
  // Basic information
  id: string;
  taskId: string;
  agentId: AgentId;
  timestamp: Date;
  
  // Success indicator
  success: boolean;
  
  // Execution metadata
  executionTime: number;
  tokensUsed?: number;
  cost?: number;
  
  // Quality assessment
  quality: QualityAssessment;
  
  // Output data
  output: ResultOutput;
  
  // Additional artifacts
  artifacts: ResultArtifact[];
  
  // Errors and warnings
  errors?: ResultError[];
  warnings?: ResultWarning[];
  
  // Recommendations and next steps
  recommendations?: ResultRecommendation[];
  nextSteps?: ResultNextStep[];
  
  // Validation
  validated: boolean;
  validationResults?: ResultValidation;
  
  // Metadata
  metadata: ResultMetadata;
}

// ===== QUALITY ASSESSMENT =====

export interface QualityAssessment {
  overall: number; // 0-1
  dimensions: QualityDimension[];
  score: QualityScore;
  trends: QualityTrend[];
}

export interface QualityDimension {
  name: string;
  score: number; // 0-1
  weight: number; // 0-1
  description: string;
  metrics: QualityMetric[];
}

export interface QualityMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
  status: 'pass' | 'fail' | 'warning' | 'unknown';
}

export interface QualityScore {
  total: number; // 0-100
  breakdown: Record<string, number>;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  percentile: number;
}

export interface QualityTrend {
  dimension: string;
  direction: 'improving' | 'declining' | 'stable';
  change: number; // percentage change
  period: string;
}

// ===== RESULT OUTPUT =====

export interface ResultOutput {
  // Primary output type
  type: OutputType;
  
  // Content
  content: OutputContent;
  
  // Format information
  format: OutputFormat;
  
  // Structure
  structure?: OutputStructure;
  
  // Size and complexity
  size: OutputSize;
  complexity: OutputComplexity;
}

export type OutputType = 
  | 'code'
  | 'documentation'
  | 'test'
  | 'analysis'
  | 'report'
  | 'configuration'
  | 'data'
  | 'visualization'
  | 'other';

export interface OutputContent {
  // Text content
  text?: string;
  
  // Structured data
  data?: any;
  
  // Binary content
  binary?: BinaryContent;
  
  // References
  references?: ContentReference[];
}

export interface BinaryContent {
  type: string;
  data: string; // base64 encoded
  size: number;
  checksum: string;
}

export interface ContentReference {
  type: 'file' | 'url' | 'database' | 'api' | 'other';
  location: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface OutputFormat {
  primary: string; // 'typescript' | 'markdown' | 'json' | 'yaml' | 'html' | 'other'
  encoding: string; // 'utf-8' | 'ascii' | 'base64' | 'other'
  compression?: string; // 'gzip' | 'deflate' | 'brotli' | 'other'
  mimeType?: string;
}

export interface OutputStructure {
  type: 'hierarchical' | 'tabular' | 'graph' | 'list' | 'tree' | 'other';
  schema?: any;
  elements: StructureElement[];
}

export interface StructureElement {
  name: string;
  type: string;
  path: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface OutputSize {
  lines: number;
  characters: number;
  bytes: number;
  files?: number;
  functions?: number;
  classes?: number;
}

export interface OutputComplexity {
  cyclomatic: number;
  cognitive: number;
  maintainability: number;
  readability: number;
  testability: number;
}

// ===== RESULT ARTIFACTS =====

export interface ResultArtifact {
  // Basic information
  id: string;
  name: string;
  type: ArtifactType;
  
  // Content
  content: ArtifactContent;
  
  // Metadata
  metadata: ArtifactMetadata;
  
  // Dependencies
  dependencies?: ArtifactDependency[];
  
  // Validation
  validated: boolean;
  validationResults?: ArtifactValidation;
}

export type ArtifactType = 
  | 'source-code'
  | 'test-code'
  | 'documentation'
  | 'configuration'
  | 'data'
  | 'diagram'
  | 'report'
  | 'script'
  | 'template'
  | 'other';

export interface ArtifactContent {
  // Text content
  text?: string;
  
  // Binary content
  binary?: BinaryContent;
  
  // Structured content
  structured?: StructuredContent;
  
  // References
  references?: ContentReference[];
}

export interface StructuredContent {
  format: string;
  schema?: any;
  data: any;
  validation?: ValidationInfo;
}

export interface ValidationInfo {
  schemaValid: boolean;
  errors?: ValidationError[];
  warnings?: ValidationWarning[];
}

export interface ValidationError {
  path: string;
  message: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationWarning {
  path: string;
  message: string;
  suggestion?: string;
}

export interface ArtifactMetadata {
  // File information
  path?: string;
  size: number;
  checksum: string;
  lastModified: Date;
  
  // Content information
  language?: string;
  encoding: string;
  mimeType?: string;
  
  // Quality information
  quality: number; // 0-1
  complexity: number; // 0-1
  maintainability: number; // 0-1
  
  // Tags and categories
  tags: string[];
  categories: string[];
  
  // Custom metadata
  custom: Record<string, any>;
}

export interface ArtifactDependency {
  name: string;
  type: 'import' | 'require' | 'include' | 'reference' | 'other';
  version?: string;
  optional: boolean;
  resolved: boolean;
}

export interface ArtifactValidation {
  passed: boolean;
  score: number; // 0-1
  checks: ArtifactCheck[];
  errors: ArtifactError[];
  warnings: ArtifactWarning[];
}

export interface ArtifactCheck {
  name: string;
  type: 'syntax' | 'semantic' | 'style' | 'security' | 'performance' | 'other';
  passed: boolean;
  score: number; // 0-1
  message: string;
  details?: any;
}

export interface ArtifactError {
  type: string;
  message: string;
  location?: ErrorLocation;
  severity: 'low' | 'medium' | 'high' | 'critical';
  fixable: boolean;
  suggestion?: string;
}

export interface ArtifactWarning {
  type: string;
  message: string;
  location?: ErrorLocation;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

export interface ErrorLocation {
  file?: string;
  line?: number;
  column?: number;
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  path?: string;
}

// ===== ERRORS AND WARNINGS =====

export interface ResultError {
  // Error identification
  id: string;
  type: string;
  code?: string;
  
  // Error details
  message: string;
  description?: string;
  stack?: string;
  
  // Context
  context: ErrorContext;
  
  // Severity and handling
  severity: 'low' | 'medium' | 'high' | 'critical';
  recoverable: boolean;
  retryable: boolean;
  
  // Resolution
  resolution?: ErrorResolution;
  
  // Metadata
  timestamp: Date;
  agentId: AgentId;
}

export interface ErrorContext {
  // Location information
  location?: ErrorLocation;
  
  // Execution context
  executionId?: string;
  taskId?: string;
  step?: string;
  
  // Environment context
  environment?: string;
  version?: string;
  
  // Custom context
  custom: Record<string, any>;
}

export interface ErrorResolution {
  type: 'automatic' | 'manual' | 'retry' | 'skip' | 'abort';
  description: string;
  steps?: string[];
  estimatedTime?: number;
  resources?: string[];
}

export interface ResultWarning {
  // Warning identification
  id: string;
  type: string;
  
  // Warning details
  message: string;
  description?: string;
  
  // Context
  context: ErrorContext;
  
  // Severity
  severity: 'low' | 'medium' | 'high';
  
  // Suggestions
  suggestions?: WarningSuggestion[];
  
  // Metadata
  timestamp: Date;
  agentId: AgentId;
}

export interface WarningSuggestion {
  type: 'improvement' | 'optimization' | 'best-practice' | 'security' | 'other';
  title: string;
  description: string;
  implementation?: string;
  impact?: string;
  effort?: 'low' | 'medium' | 'high';
}

// ===== RECOMMENDATIONS =====

export interface ResultRecommendation {
  // Recommendation identification
  id: string;
  type: RecommendationType;
  
  // Recommendation details
  title: string;
  description: string;
  
  // Priority and impact
  priority: 'low' | 'medium' | 'high' | 'critical';
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  
  // Implementation
  implementation?: RecommendationImplementation;
  
  // Validation
  validated: boolean;
  validationResults?: RecommendationValidation;
  
  // Metadata
  timestamp: Date;
  agentId: AgentId;
}

export type RecommendationType = 
  | 'improvement'
  | 'optimization'
  | 'security'
  | 'best-practice'
  | 'refactoring'
  | 'testing'
  | 'documentation'
  | 'performance'
  | 'accessibility'
  | 'other';

export interface RecommendationImplementation {
  steps: ImplementationStep[];
  resources: ImplementationResource[];
  dependencies: string[];
  estimatedTime?: number;
  risks?: ImplementationRisk[];
}

export interface ImplementationStep {
  order: number;
  title: string;
  description: string;
  estimatedTime?: number;
  dependencies?: number[];
}

export interface ImplementationResource {
  type: 'human' | 'tool' | 'service' | 'data' | 'other';
  name: string;
  description: string;
  required: boolean;
}

export interface ImplementationRisk {
  type: string;
  description: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation?: string;
}

export interface RecommendationValidation {
  passed: boolean;
  score: number; // 0-1
  checks: RecommendationCheck[];
  feedback?: string;
}

export interface RecommendationCheck {
  name: string;
  passed: boolean;
  score: number; // 0-1
  message: string;
  details?: any;
}

// ===== NEXT STEPS =====

export interface ResultNextStep {
  // Step identification
  id: string;
  type: NextStepType;
  
  // Step details
  action: string;
  description: string;
  
  // Priority and timing
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedTime?: number;
  deadline?: Date;
  
  // Dependencies and resources
  dependencies: string[];
  resources: string[];
  
  // Validation
  validated: boolean;
  validationResults?: NextStepValidation;
  
  // Metadata
  timestamp: Date;
  agentId: AgentId;
}

export type NextStepType = 
  | 'implementation'
  | 'testing'
  | 'review'
  | 'deployment'
  | 'monitoring'
  | 'optimization'
  | 'documentation'
  | 'training'
  | 'other';

export interface NextStepValidation {
  passed: boolean;
  score: number; // 0-1
  checks: NextStepCheck[];
  feedback?: string;
}

export interface NextStepCheck {
  name: string;
  passed: boolean;
  score: number; // 0-1
  message: string;
  details?: any;
}

// ===== VALIDATION =====

export interface ResultValidation {
  // Validation status
  passed: boolean;
  score: number; // 0-1
  
  // Validation details
  checks: ValidationCheck[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
  
  // Validation metadata
  validator: string;
  version: string;
  timestamp: Date;
  duration: number;
}

export interface ValidationCheck {
  name: string;
  type: ValidationCheckType;
  passed: boolean;
  score: number; // 0-1
  message: string;
  details?: any;
  location?: ErrorLocation;
}

export type ValidationCheckType = 
  | 'syntax'
  | 'semantic'
  | 'style'
  | 'security'
  | 'performance'
  | 'accessibility'
  | 'compatibility'
  | 'best-practice'
  | 'other';

// ===== METADATA =====

export interface ResultMetadata {
  // Version information
  version: string;
  schemaVersion: string;
  
  // Execution information
  executionId: string;
  sessionId?: string;
  correlationId?: string;
  
  // Agent information
  agentId: AgentId;
  agentVersion: string;
  agentCapabilities: string[];
  
  // Environment information
  environment: string;
  runtime: string;
  platform: string;
  
  // Timing information
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  
  // Quality information
  quality: number; // 0-1
  confidence: number; // 0-1
  
  // Tags and categories
  tags: string[];
  categories: string[];
  
  // Custom metadata
  custom: Record<string, any>;
}

// ===== SPECIALIZED RESULT TYPES =====

export interface CodeGenerationResult extends AbstractResult {
  output: {
    type: 'code';
    content: {
      code: string;
      language: string;
      files?: GeneratedFile[];
    };
  };
  artifacts: CodeArtifact[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  purpose: string;
  size: number;
  checksum: string;
}

export interface CodeArtifact extends ResultArtifact {
  type: 'source-code' | 'test-code' | 'configuration';
  content: {
    text: string;
    language: string;
    syntax: SyntaxInfo;
  };
}

export interface SyntaxInfo {
  valid: boolean;
  errors?: SyntaxError[];
  warnings?: SyntaxWarning[];
  ast?: any;
}

export interface SyntaxError {
  type: string;
  message: string;
  line: number;
  column: number;
  length?: number;
}

export interface SyntaxWarning {
  type: string;
  message: string;
  line: number;
  column: number;
  suggestion?: string;
}

export interface AnalysisResult extends AbstractResult {
  output: {
    type: 'analysis';
    content: {
      analysis: AnalysisData;
      findings: AnalysisFinding[];
      summary: string;
    };
  };
}

export interface AnalysisData {
  type: 'static' | 'dynamic' | 'security' | 'performance' | 'quality';
  scope: string;
  metrics: AnalysisMetric[];
  trends: AnalysisTrend[];
}

export interface AnalysisMetric {
  name: string;
  value: number;
  unit: string;
  threshold?: number;
  status: 'pass' | 'fail' | 'warning';
  description?: string;
}

export interface AnalysisTrend {
  metric: string;
  direction: 'improving' | 'declining' | 'stable';
  change: number;
  period: string;
  confidence: number;
}

export interface AnalysisFinding {
  type: 'issue' | 'improvement' | 'suggestion' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  location?: ErrorLocation;
  suggestion?: string;
  impact?: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface TestResult extends AbstractResult {
  output: {
    type: 'test';
    content: {
      tests: TestCase[];
      coverage: TestCoverage;
      summary: TestSummary;
    };
  };
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'error';
  duration: number;
  message?: string;
  stack?: string;
  assertions: TestAssertion[];
}

export interface TestAssertion {
  name: string;
  status: 'passed' | 'failed';
  message?: string;
  expected?: any;
  actual?: any;
}

export interface TestCoverage {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncoveredLines?: number[];
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  duration: number;
  coverage: number;
}

// ===== EXPORTS =====

export default {
  AbstractResult,
  QualityAssessment,
  ResultOutput,
  ResultArtifact,
  ResultError,
  ResultWarning,
  ResultRecommendation,
  ResultNextStep,
  ResultValidation,
  ResultMetadata,
  CodeGenerationResult,
  AnalysisResult,
  TestResult,
};