/**
 * Task Definition Interfaces
 * Standardized task definitions for abstract agent coordination
 */

import type { AgentId, AgentType } from '../../swarm/types.js';

// ===== CORE TASK INTERFACES =====

export interface AbstractTask {
  id: string;
  type: TaskType;
  name: string;
  description: string;
  
  // Task metadata
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  
  // Assignment
  assignedTo?: AgentId;
  assignedAt?: Date;
  deadline?: Date;
  
  // Execution
  startedAt?: Date;
  completedAt?: Date;
  result?: TaskResult;
  error?: TaskError;
  
  // Dependencies
  dependencies: TaskDependency[];
  dependents: string[];
  
  // Context
  context: TaskContext;
  requirements: TaskRequirements;
  constraints: TaskConstraints;
}

// ===== TASK TYPES =====

export type TaskType = 
  // Core coding tasks
  | 'code-generation'
  | 'code-review'
  | 'debugging'
  | 'refactoring'
  | 'testing'
  | 'documentation'
  | 'optimization'
  | 'migration'
  
  // Analysis tasks
  | 'static-analysis'
  | 'dynamic-analysis'
  | 'security-analysis'
  | 'performance-analysis'
  | 'quality-analysis'
  
  // Integration tasks
  | 'api-integration'
  | 'database-integration'
  | 'service-integration'
  | 'deployment'
  | 'configuration'
  
  // Coordination tasks
  | 'task-coordination'
  | 'resource-allocation'
  | 'conflict-resolution'
  | 'consensus-building'
  
  // Custom tasks
  | 'custom';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskStatus = 
  | 'created'
  | 'queued'
  | 'assigned'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'
  | 'retrying'
  | 'blocked';

// ===== TASK CONTEXT =====

export interface TaskContext {
  // Project context
  project: ProjectContext;
  
  // Code context
  code: CodeContext;
  
  // Environment context
  environment: EnvironmentContext;
  
  // Business context
  business: BusinessContext;
  
  // Technical context
  technical: TechnicalContext;
}

export interface ProjectContext {
  id: string;
  name: string;
  type: string;
  description?: string;
  repository?: string;
  branch?: string;
  commit?: string;
  structure: ProjectStructure;
}

export interface ProjectStructure {
  root: string;
  directories: DirectoryInfo[];
  files: FileInfo[];
  configFiles: ConfigFileInfo[];
  dependencies: DependencyInfo[];
}

export interface DirectoryInfo {
  path: string;
  type: 'source' | 'test' | 'docs' | 'config' | 'assets' | 'build' | 'other';
  description?: string;
  size?: number;
}

export interface FileInfo {
  path: string;
  name: string;
  extension: string;
  size: number;
  language?: string;
  lastModified: Date;
  checksum?: string;
}

export interface ConfigFileInfo {
  path: string;
  type: 'package' | 'build' | 'deployment' | 'environment' | 'linting' | 'testing' | 'other';
  format: 'json' | 'yaml' | 'toml' | 'ini' | 'env' | 'other';
  content?: string;
}

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'runtime' | 'dev' | 'peer' | 'optional';
  purpose?: string;
  license?: string;
  vulnerabilities?: VulnerabilityInfo[];
}

export interface VulnerabilityInfo {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  cve?: string;
  fixed?: boolean;
}

export interface CodeContext {
  // Current code state
  currentCode?: string;
  modifiedFiles?: string[];
  addedFiles?: string[];
  deletedFiles?: string[];
  
  // Related code
  relatedFiles?: RelatedFile[];
  imports?: ImportInfo[];
  exports?: ExportInfo[];
  
  // Code analysis
  complexity?: ComplexityMetrics;
  coverage?: CoverageMetrics;
  quality?: QualityMetrics;
}

export interface RelatedFile {
  path: string;
  relationship: 'imports' | 'imported-by' | 'extends' | 'implements' | 'uses' | 'related';
  relevance: number; // 0-1
  content?: string;
}

export interface ImportInfo {
  module: string;
  imports: string[];
  type: 'default' | 'named' | 'namespace' | 'side-effect';
  source: 'local' | 'npm' | 'cdn' | 'other';
}

export interface ExportInfo {
  name: string;
  type: 'function' | 'class' | 'interface' | 'type' | 'constant' | 'variable';
  visibility: 'public' | 'private' | 'protected';
  description?: string;
}

export interface ComplexityMetrics {
  cyclomatic: number;
  cognitive: number;
  maintainability: number;
  linesOfCode: number;
  functions: number;
  classes: number;
}

export interface CoverageMetrics {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
  uncoveredLines?: number[];
}

export interface QualityMetrics {
  overall: number; // 0-1
  codeQuality: number; // 0-1
  testCoverage: number; // 0-1
  documentation: number; // 0-1
  performance: number; // 0-1
  security: number; // 0-1
}

export interface EnvironmentContext {
  // Runtime environment
  runtime: RuntimeInfo;
  
  // Operating system
  os: OperatingSystemInfo;
  
  // Development tools
  tools: ToolInfo[];
  
  // External services
  services: ServiceInfo[];
}

export interface RuntimeInfo {
  name: string; // 'node' | 'deno' | 'browser' | 'python' | 'java' | 'other'
  version: string;
  architecture: string;
  features: string[];
}

export interface OperatingSystemInfo {
  name: string;
  version: string;
  architecture: string;
  distribution?: string;
}

export interface ToolInfo {
  name: string;
  type: 'compiler' | 'interpreter' | 'linter' | 'formatter' | 'bundler' | 'test-runner' | 'other';
  version: string;
  configuration?: any;
}

export interface ServiceInfo {
  name: string;
  type: 'database' | 'api' | 'cache' | 'queue' | 'storage' | 'monitoring' | 'other';
  endpoint?: string;
  configuration?: any;
}

export interface BusinessContext {
  // Business requirements
  requirements: BusinessRequirement[];
  
  // User stories
  userStories: UserStory[];
  
  // Acceptance criteria
  acceptanceCriteria: AcceptanceCriteria[];
  
  // Business rules
  businessRules: BusinessRule[];
}

export interface BusinessRequirement {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'functional' | 'non-functional' | 'constraint';
  stakeholders: string[];
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  storyPoints?: number;
  epic?: string;
}

export interface AcceptanceCriteria {
  id: string;
  description: string;
  type: 'functional' | 'non-functional' | 'constraint';
  testable: boolean;
  verified: boolean;
}

export interface BusinessRule {
  id: string;
  description: string;
  category: 'validation' | 'calculation' | 'authorization' | 'workflow' | 'other';
  enforcement: 'strict' | 'warning' | 'suggestion';
}

export interface TechnicalContext {
  // Architecture
  architecture: ArchitectureInfo;
  
  // Design patterns
  patterns: DesignPattern[];
  
  // Standards and conventions
  standards: StandardInfo[];
  
  // Performance requirements
  performance: PerformanceRequirements;
  
  // Security requirements
  security: SecurityRequirements;
}

export interface ArchitectureInfo {
  style: 'monolithic' | 'microservices' | 'serverless' | 'event-driven' | 'layered' | 'other';
  patterns: string[];
  components: ComponentInfo[];
  interactions: InteractionInfo[];
}

export interface ComponentInfo {
  name: string;
  type: 'service' | 'module' | 'library' | 'database' | 'api' | 'other';
  responsibility: string;
  dependencies: string[];
  interfaces: string[];
}

export interface InteractionInfo {
  from: string;
  to: string;
  type: 'http' | 'grpc' | 'message-queue' | 'database' | 'file' | 'other';
  protocol?: string;
  frequency?: 'low' | 'medium' | 'high';
}

export interface DesignPattern {
  name: string;
  category: 'creational' | 'structural' | 'behavioral' | 'architectural';
  description: string;
  implementation?: string;
}

export interface StandardInfo {
  name: string;
  type: 'coding' | 'api' | 'security' | 'performance' | 'accessibility' | 'other';
  version: string;
  compliance: 'required' | 'recommended' | 'optional';
}

export interface PerformanceRequirements {
  responseTime?: number;
  throughput?: number;
  concurrency?: number;
  scalability?: ScalabilityRequirement;
  resourceUsage?: ResourceUsageRequirement;
}

export interface ScalabilityRequirement {
  users: number;
  data: number;
  requests: number;
  growth: 'linear' | 'exponential' | 'logarithmic';
}

export interface ResourceUsageRequirement {
  cpu: number;
  memory: number;
  storage: number;
  network: number;
}

export interface SecurityRequirements {
  authentication: AuthenticationRequirement;
  authorization: AuthorizationRequirement;
  dataProtection: DataProtectionRequirement;
  compliance: ComplianceRequirement[];
}

export interface AuthenticationRequirement {
  methods: string[];
  strength: 'basic' | 'strong' | 'multi-factor';
  sessionManagement: boolean;
}

export interface AuthorizationRequirement {
  model: 'rbac' | 'abac' | 'dac' | 'mac';
  granularity: 'coarse' | 'fine';
  inheritance: boolean;
}

export interface DataProtectionRequirement {
  encryption: 'at-rest' | 'in-transit' | 'both';
  keyManagement: string;
  dataClassification: string[];
}

export interface ComplianceRequirement {
  standard: string; // 'GDPR' | 'HIPAA' | 'SOX' | 'PCI-DSS' | 'other'
  level: 'required' | 'recommended';
  controls: string[];
}

// ===== TASK REQUIREMENTS =====

export interface TaskRequirements {
  // Agent requirements
  agentType?: AgentType;
  capabilities: string[];
  minReliability?: number;
  maxConcurrency?: number;
  
  // Resource requirements
  estimatedDuration?: number;
  maxDuration?: number;
  memoryRequired?: number;
  cpuRequired?: number;
  storageRequired?: number;
  networkRequired?: number;
  
  // Quality requirements
  minQuality?: number;
  testCoverage?: number;
  documentationRequired?: boolean;
  reviewRequired?: boolean;
  
  // Environment requirements
  tools: string[];
  permissions: string[];
  environment?: Record<string, any>;
  
  // Dependencies
  dependencies: DependencyRequirement[];
}

export interface DependencyRequirement {
  name: string;
  type: 'package' | 'service' | 'data' | 'resource' | 'other';
  version?: string;
  optional: boolean;
  purpose: string;
}

// ===== TASK CONSTRAINTS =====

export interface TaskConstraints {
  // Time constraints
  deadline?: Date;
  startAfter?: Date;
  maxRetries?: number;
  timeoutAfter?: number;
  
  // Resource constraints
  maxCost?: number;
  maxTokens?: number;
  maxMemory?: number;
  maxCpu?: number;
  
  // Quality constraints
  minQuality?: number;
  maxComplexity?: number;
  requiredApprovals?: string[];
  
  // Security constraints
  securityLevel?: 'low' | 'medium' | 'high' | 'critical';
  encryptionRequired?: boolean;
  auditRequired?: boolean;
  
  // Compliance constraints
  complianceStandards?: string[];
  dataClassification?: string[];
  
  // Technical constraints
  language?: string;
  framework?: string;
  platform?: string;
  architecture?: string;
}

// ===== TASK DEPENDENCIES =====

export interface TaskDependency {
  taskId: string;
  type: DependencyType;
  constraint?: string;
  optional: boolean;
}

export type DependencyType = 
  | 'finish-start' // Must finish before next starts
  | 'start-start' // Must start before next starts
  | 'finish-finish' // Must finish before next finishes
  | 'start-finish' // Must start before next finishes
  | 'resource' // Shares a resource
  | 'data' // Data dependency
  | 'approval'; // Requires approval

// ===== TASK RESULTS =====

export interface TaskResult {
  // Success indicator
  success: boolean;
  
  // Output data
  output: any;
  artifacts: TaskArtifact[];
  
  // Quality metrics
  quality: number; // 0-1
  completeness: number; // 0-1
  accuracy: number; // 0-1
  
  // Performance metrics
  executionTime: number;
  resourcesUsed: ResourceUsage;
  
  // Validation
  validated: boolean;
  validationResults?: ValidationResult;
  
  // Recommendations
  recommendations?: Recommendation[];
  nextSteps?: NextStep[];
  
  // Metadata
  metadata: TaskMetadata;
}

export interface TaskArtifact {
  type: 'code' | 'documentation' | 'test' | 'config' | 'data' | 'report' | 'other';
  name: string;
  content: string;
  format: string;
  size: number;
  checksum?: string;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  storage: number;
  network: number;
  tokens?: number;
  cost?: number;
}

export interface ValidationResult {
  passed: boolean;
  score: number; // 0-1
  checks: ValidationCheck[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationCheck {
  name: string;
  passed: boolean;
  score: number; // 0-1
  message: string;
  details?: any;
}

export interface ValidationError {
  type: string;
  message: string;
  location?: CodeLocation;
  severity: 'low' | 'medium' | 'high' | 'critical';
  fixable: boolean;
}

export interface ValidationWarning {
  type: string;
  message: string;
  location?: CodeLocation;
  severity: 'low' | 'medium' | 'high';
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

export interface Recommendation {
  type: 'improvement' | 'optimization' | 'security' | 'best-practice' | 'refactoring';
  priority: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  implementation?: string;
  impact?: string;
  effort?: 'low' | 'medium' | 'high';
}

export interface NextStep {
  action: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedTime?: number;
  dependencies?: string[];
  resources?: string[];
}

export interface TaskMetadata {
  version: string;
  timestamp: Date;
  agentId: AgentId;
  executionId: string;
  environment: string;
  tags: string[];
}

// ===== TASK ERRORS =====

export interface TaskError {
  type: string;
  message: string;
  code?: string;
  stack?: string;
  context: Record<string, any>;
  recoverable: boolean;
  retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

// ===== TASK COORDINATION =====

export interface TaskCoordination {
  // Coordination strategy
  strategy: CoordinationStrategy;
  
  // Participants
  coordinator: AgentId;
  participants: AgentId[];
  
  // Communication
  communication: CommunicationProtocol;
  
  // Synchronization
  synchronization: SynchronizationProtocol;
  
  // Conflict resolution
  conflictResolution: ConflictResolutionProtocol;
}

export type CoordinationStrategy = 
  | 'sequential'
  | 'parallel'
  | 'pipeline'
  | 'consensus'
  | 'voting'
  | 'hierarchical'
  | 'peer-to-peer';

export interface CommunicationProtocol {
  type: 'direct' | 'broadcast' | 'multicast' | 'pub-sub';
  channels: CommunicationChannel[];
  messageFormat: string;
  encryption: boolean;
}

export interface CommunicationChannel {
  name: string;
  type: 'task-updates' | 'status-changes' | 'error-reports' | 'coordination';
  participants: AgentId[];
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface SynchronizationProtocol {
  type: 'eventual' | 'strong' | 'weak' | 'session';
  checkpoints: Checkpoint[];
  rollbackStrategy: 'automatic' | 'manual' | 'none';
}

export interface Checkpoint {
  id: string;
  timestamp: Date;
  state: any;
  participants: AgentId[];
}

export interface ConflictResolutionProtocol {
  strategy: 'first-wins' | 'last-wins' | 'consensus' | 'arbitration' | 'manual';
  timeout: number;
  escalation: EscalationPolicy;
}

export interface EscalationPolicy {
  levels: EscalationLevel[];
  maxLevel: number;
  timeout: number;
}

export interface EscalationLevel {
  level: number;
  authority: AgentId[];
  timeout: number;
  criteria: string[];
}

// ===== EXPORTS =====

export default {
  AbstractTask,
  TaskType,
  TaskPriority,
  TaskStatus,
  TaskContext,
  TaskRequirements,
  TaskConstraints,
  TaskDependency,
  TaskResult,
  TaskError,
  TaskCoordination,
};