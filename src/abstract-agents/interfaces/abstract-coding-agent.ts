/**
 * Abstract Coding Agent Interface
 * Defines the standard interface for all coding agents regardless of provider
 */

import type { AgentId, AgentType, AgentStatus, AgentError } from '../../swarm/types.js';

// ===== CORE AGENT INTERFACES =====

export interface AbstractCodingAgent {
  readonly id: string;
  readonly type: AgentType;
  readonly provider: AgentProvider;
  
  // Core capabilities
  getCapabilities(): Promise<AgentCapabilities>;
  executeTask(task: CodingTask): Promise<CodingResult>;
  healthCheck(): Promise<AgentHealth>;
  
  // Configuration and lifecycle
  configure(config: AgentConfiguration): Promise<void>;
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  
  // Status and monitoring
  getStatus(): Promise<AgentStatus>;
  getMetrics(): Promise<AgentMetrics>;
  
  // Communication
  sendMessage(to: AgentId, message: AgentMessage): Promise<void>;
  broadcastMessage(message: AgentMessage): Promise<void>;
  
  // Event handling
  onEvent(eventType: EventType, handler: EventHandler): void;
  offEvent(eventType: EventType, handler: EventHandler): void;
}

// ===== AGENT PROVIDER TYPES =====

export type AgentProvider = 
  | 'openai-codex'
  | 'anthropic-claude-code'
  | 'google-gemini'
  | 'cursor-ai'
  | 'github-copilot'
  | 'custom';

// ===== CAPABILITY DEFINITIONS =====

export interface AgentCapabilities {
  // Core coding capabilities
  codeGeneration: boolean;
  codeReview: boolean;
  debugging: boolean;
  refactoring: boolean;
  testing: boolean;
  documentation: boolean;
  
  // Language support
  languages: ProgrammingLanguage[];
  
  // Framework support
  frameworks: Framework[];
  
  // Domain expertise
  domains: Domain[];
  
  // Tool integration
  tools: Tool[];
  
  // Resource limits
  maxConcurrentTasks: number;
  maxTokensPerRequest: number;
  maxExecutionTime: number;
  
  // Performance characteristics
  reliability: number; // 0-1
  speed: number; // 0-1
  quality: number; // 0-1
}

export interface ProgrammingLanguage {
  name: string;
  version?: string;
  proficiency: number; // 0-1
  features: string[];
}

export interface Framework {
  name: string;
  version?: string;
  proficiency: number; // 0-1
  capabilities: string[];
}

export interface Domain {
  name: string;
  expertise: number; // 0-1
  subdomains: string[];
}

export interface Tool {
  name: string;
  type: 'cli' | 'api' | 'library' | 'service';
  capabilities: string[];
  configuration?: Record<string, any>;
}

// ===== TASK DEFINITIONS =====

export interface CodingTask {
  id: string;
  type: TaskType;
  name: string;
  description: string;
  
  // Task specification
  context: CodeContext;
  requirements: TaskRequirements;
  constraints: TaskConstraints;
  
  // Input/Output
  input: TaskInput;
  expectedOutput?: TaskOutput;
  
  // Execution details
  instructions: string;
  examples?: CodeExample[];
  parameters?: Record<string, any>;
  
  // Metadata
  priority: TaskPriority;
  deadline?: Date;
  tags: string[];
}

export type TaskType = 
  | 'code-generation'
  | 'code-review'
  | 'debugging'
  | 'refactoring'
  | 'testing'
  | 'documentation'
  | 'optimization'
  | 'migration'
  | 'integration'
  | 'custom';

export interface CodeContext {
  // Project context
  projectType?: string;
  projectStructure?: ProjectStructure;
  
  // Code context
  currentCode?: string;
  relatedFiles?: CodeFile[];
  dependencies?: Dependency[];
  
  // Environment context
  runtime?: string;
  framework?: string;
  database?: string;
  
  // Business context
  requirements?: string[];
  constraints?: string[];
  goals?: string[];
}

export interface ProjectStructure {
  root: string;
  directories: DirectoryInfo[];
  files: CodeFile[];
  configFiles: ConfigFile[];
}

export interface DirectoryInfo {
  path: string;
  type: 'source' | 'test' | 'docs' | 'config' | 'assets' | 'other';
  description?: string;
}

export interface CodeFile {
  path: string;
  content: string;
  language: string;
  size: number;
  lastModified: Date;
  dependencies?: string[];
}

export interface ConfigFile {
  path: string;
  type: 'package' | 'build' | 'deployment' | 'environment' | 'other';
  content: string;
}

export interface Dependency {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer' | 'optional';
  purpose?: string;
}

export interface TaskRequirements {
  // Functional requirements
  functionality: string[];
  performance?: PerformanceRequirement[];
  security?: SecurityRequirement[];
  
  // Quality requirements
  codeQuality: QualityRequirement[];
  testCoverage?: number;
  documentation?: DocumentationRequirement[];
  
  // Technical requirements
  compatibility?: CompatibilityRequirement[];
  scalability?: ScalabilityRequirement[];
}

export interface PerformanceRequirement {
  metric: string;
  target: number;
  unit: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecurityRequirement {
  type: string;
  description: string;
  level: 'low' | 'medium' | 'high' | 'critical';
}

export interface QualityRequirement {
  aspect: string;
  standard: string;
  level: 'basic' | 'good' | 'excellent';
}

export interface DocumentationRequirement {
  type: 'inline' | 'api' | 'user' | 'technical';
  format: 'markdown' | 'html' | 'pdf' | 'other';
  coverage: number;
}

export interface CompatibilityRequirement {
  platform: string;
  version: string;
  requirement: 'must' | 'should' | 'could';
}

export interface ScalabilityRequirement {
  dimension: 'users' | 'data' | 'requests' | 'other';
  target: number;
  unit: string;
}

export interface TaskConstraints {
  // Time constraints
  deadline?: Date;
  maxDuration?: number;
  
  // Resource constraints
  maxTokens?: number;
  maxMemory?: number;
  maxCpu?: number;
  
  // Quality constraints
  minQuality?: number;
  maxComplexity?: number;
  
  // Technical constraints
  language?: string;
  framework?: string;
  platform?: string;
  
  // Business constraints
  budget?: number;
  compliance?: string[];
}

export interface TaskInput {
  // Code input
  code?: string;
  files?: CodeFile[];
  
  // Data input
  data?: any;
  schema?: any;
  
  // Configuration input
  config?: Record<string, any>;
  environment?: Record<string, string>;
  
  // Context input
  context?: string;
  history?: TaskHistory[];
}

export interface TaskOutput {
  // Expected output format
  format: 'code' | 'data' | 'documentation' | 'report' | 'other';
  
  // Output structure
  structure?: any;
  schema?: any;
  
  // Quality expectations
  quality?: QualityExpectation[];
  
  // Delivery format
  delivery: 'file' | 'stream' | 'api' | 'database';
}

export interface QualityExpectation {
  metric: string;
  threshold: number;
  weight: number;
}

export interface TaskHistory {
  taskId: string;
  timestamp: Date;
  result: CodingResult;
  feedback?: string;
}

export interface CodeExample {
  name: string;
  description: string;
  input: string;
  output: string;
  explanation?: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

// ===== RESULT DEFINITIONS =====

export interface CodingResult {
  success: boolean;
  taskId: string;
  timestamp: Date;
  
  // Primary output
  output: CodeOutput;
  
  // Additional artifacts
  artifacts: CodeArtifact[];
  
  // Execution metadata
  executionTime: number;
  tokensUsed: number;
  cost?: number;
  
  // Quality metrics
  quality: QualityMetrics;
  
  // Errors and warnings
  errors?: AgentError[];
  warnings?: AgentWarning[];
  
  // Recommendations
  recommendations?: Recommendation[];
  
  // Follow-up actions
  nextSteps?: NextStep[];
}

export interface CodeOutput {
  // Generated code
  code?: string;
  files?: GeneratedFile[];
  
  // Analysis results
  analysis?: AnalysisResult;
  
  // Documentation
  documentation?: DocumentationOutput;
  
  // Test results
  tests?: TestResult[];
  
  // Reports
  reports?: Report[];
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  purpose: string;
  size: number;
}

export interface AnalysisResult {
  type: 'static' | 'dynamic' | 'security' | 'performance' | 'quality';
  findings: Finding[];
  summary: string;
  score?: number;
}

export interface Finding {
  type: 'issue' | 'improvement' | 'suggestion' | 'warning';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  location?: CodeLocation;
  suggestion?: string;
}

export interface CodeLocation {
  file: string;
  line?: number;
  column?: number;
  range?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface DocumentationOutput {
  type: 'api' | 'user' | 'technical' | 'inline';
  format: 'markdown' | 'html' | 'pdf' | 'other';
  content: string;
  sections: DocumentationSection[];
}

export interface DocumentationSection {
  title: string;
  content: string;
  level: number;
  order: number;
}

export interface TestResult {
  type: 'unit' | 'integration' | 'e2e' | 'performance' | 'security';
  status: 'passed' | 'failed' | 'skipped' | 'error';
  coverage?: number;
  duration: number;
  details: TestDetail[];
}

export interface TestDetail {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  message?: string;
  stack?: string;
}

export interface Report {
  type: 'summary' | 'detailed' | 'executive';
  format: 'text' | 'html' | 'json' | 'pdf';
  content: string;
  metrics: Record<string, any>;
}

export interface CodeArtifact {
  type: 'config' | 'script' | 'data' | 'diagram' | 'other';
  name: string;
  content: string;
  format: string;
  purpose: string;
}

export interface QualityMetrics {
  overall: number; // 0-1
  codeQuality: number; // 0-1
  testCoverage: number; // 0-1
  documentation: number; // 0-1
  performance: number; // 0-1
  security: number; // 0-1
  maintainability: number; // 0-1
}

export interface AgentWarning {
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  location?: CodeLocation;
  suggestion?: string;
}

export interface Recommendation {
  type: 'improvement' | 'optimization' | 'security' | 'best-practice';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  implementation?: string;
  impact?: string;
}

export interface NextStep {
  action: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedTime?: number;
  dependencies?: string[];
}

// ===== CONFIGURATION =====

export interface AgentConfiguration {
  // Provider settings
  provider: AgentProvider;
  apiKey?: string;
  endpoint?: string;
  model?: string;
  
  // Capability settings
  capabilities: Partial<AgentCapabilities>;
  
  // Resource limits
  limits: ResourceLimits;
  
  // Preferences
  preferences: AgentPreferences;
  
  // Security settings
  security: SecuritySettings;
  
  // Performance settings
  performance: PerformanceSettings;
}

export interface ResourceLimits {
  maxConcurrentTasks: number;
  maxTokensPerRequest: number;
  maxExecutionTime: number;
  maxMemoryUsage: number;
  maxCpuUsage: number;
  rateLimitPerMinute: number;
  dailyTokenLimit?: number;
  dailyCostLimit?: number;
}

export interface AgentPreferences {
  // Code style preferences
  codeStyle: CodeStylePreferences;
  
  // Language preferences
  languagePreferences: LanguagePreferences;
  
  // Framework preferences
  frameworkPreferences: FrameworkPreferences;
  
  // Quality preferences
  qualityPreferences: QualityPreferences;
  
  // Output preferences
  outputPreferences: OutputPreferences;
}

export interface CodeStylePreferences {
  indentation: 'spaces' | 'tabs';
  indentSize: number;
  lineLength: number;
  quoteStyle: 'single' | 'double';
  semicolons: boolean;
  trailingCommas: boolean;
}

export interface LanguagePreferences {
  primary: string[];
  secondary: string[];
  avoid: string[];
  versions: Record<string, string>;
}

export interface FrameworkPreferences {
  preferred: string[];
  avoid: string[];
  versions: Record<string, string>;
}

export interface QualityPreferences {
  minQuality: number;
  testCoverage: number;
  documentationLevel: 'minimal' | 'standard' | 'comprehensive';
  codeReview: boolean;
  linting: boolean;
}

export interface OutputPreferences {
  format: 'compact' | 'detailed' | 'verbose';
  includeComments: boolean;
  includeTests: boolean;
  includeDocumentation: boolean;
  includeExamples: boolean;
}

export interface SecuritySettings {
  encryption: boolean;
  authentication: AuthenticationSettings;
  authorization: AuthorizationSettings;
  audit: AuditSettings;
}

export interface AuthenticationSettings {
  method: 'api-key' | 'oauth' | 'jwt' | 'custom';
  credentials: Record<string, string>;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface AuthorizationSettings {
  permissions: string[];
  roles: string[];
  restrictions: string[];
}

export interface AuditSettings {
  enabled: boolean;
  level: 'basic' | 'detailed' | 'comprehensive';
  retention: number; // days
}

export interface PerformanceSettings {
  timeout: number;
  retries: number;
  caching: CachingSettings;
  optimization: OptimizationSettings;
}

export interface CachingSettings {
  enabled: boolean;
  ttl: number; // seconds
  maxSize: number; // bytes
  strategy: 'lru' | 'lfu' | 'fifo';
}

export interface OptimizationSettings {
  enabled: boolean;
  strategies: string[];
  thresholds: Record<string, number>;
}

// ===== HEALTH AND MONITORING =====

export interface AgentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  score: number; // 0-1
  components: HealthComponents;
  lastCheck: Date;
  issues: HealthIssue[];
}

export interface HealthComponents {
  connectivity: number; // 0-1
  performance: number; // 0-1
  reliability: number; // 0-1
  resources: number; // 0-1
}

export interface HealthIssue {
  type: 'connectivity' | 'performance' | 'reliability' | 'resource' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
  recommendation?: string;
}

export interface AgentMetrics {
  // Performance metrics
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  successRate: number;
  
  // Resource usage
  tokensUsed: number;
  costIncurred: number;
  memoryUsage: number;
  cpuUsage: number;
  
  // Quality metrics
  averageQuality: number;
  codeQualityScore: number;
  testCoverage: number;
  
  // Time tracking
  uptime: number;
  lastActivity: Date;
  responseTime: number;
}

// ===== COMMUNICATION =====

export interface AgentMessage {
  id: string;
  from: AgentId;
  to: AgentId;
  type: MessageType;
  content: any;
  timestamp: Date;
  priority: MessagePriority;
  correlationId?: string;
}

export type MessageType = 
  | 'task-request'
  | 'task-response'
  | 'status-update'
  | 'error-report'
  | 'coordination'
  | 'heartbeat'
  | 'custom';

export type MessagePriority = 'low' | 'medium' | 'high' | 'critical';

export type EventType = 
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'status-changed'
  | 'error-occurred'
  | 'health-changed'
  | 'custom';

export type EventHandler = (event: AgentEvent) => void;

export interface AgentEvent {
  id: string;
  type: EventType;
  source: AgentId;
  data: any;
  timestamp: Date;
  correlationId?: string;
}

// ===== EXPORTS =====

export default {
  AbstractCodingAgent,
  AgentProvider,
  AgentCapabilities,
  CodingTask,
  CodingResult,
  AgentConfiguration,
  AgentHealth,
  AgentMetrics,
  AgentMessage,
  AgentEvent,
};