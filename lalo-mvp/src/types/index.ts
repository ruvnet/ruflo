import { z } from 'zod';

// Core LALO Types
export interface LALOConfig {
  langgraph: LangGraphConfig;
  governance: GovernanceConfig;
  mcp: MCPConfig;
  rag: RAGConfig;
  nl2sql: NL2SQLConfig;
}

// LangGraph Types
export interface LangGraphConfig {
  maxRetries: number;
  timeout: number;
  enableLogging: boolean;
}

export interface WorkflowNode {
  id: string;
  type: 'start' | 'end' | 'task' | 'decision' | 'parallel';
  name: string;
  function?: string;
  next?: string | string[];
  condition?: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata?: Record<string, any>;
}

// Governance Types
export interface GovernanceConfig {
  votingPeriod: number;
  quorumThreshold: number;
  proposalThreshold: number;
  executionDelay: number;
  supermajorityThreshold: number;
  multiSigThreshold: number;
  delegationEnabled: boolean;
  maxDelegationDepth: number;
  enableMCPIntegration: boolean;
}

export interface Proposal {
  id: string;
  title: string;
  description: string;
  proposer: string;
  type: 'workflow' | 'config' | 'governance' | 'emergency' | 'upgrade';
  category: 'standard' | 'critical' | 'constitutional';
  status: 'draft' | 'active' | 'passed' | 'rejected' | 'executed' | 'queued' | 'expired';
  votes: Vote[];
  signatures: MultiSigSignature[];
  createdAt: Date;
  votingEndsAt: Date;
  executionData?: any;
  metadata: ProposalMetadata;
  dependencies?: string[];
  requiredApprovals: string[];
}

export interface ProposalMetadata {
  tags: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedImpact: 'minimal' | 'moderate' | 'significant' | 'major';
  riskLevel: 'low' | 'medium' | 'high';
  reviewers?: string[];
  externalReferences?: string[];
}

export interface Vote {
  voter: string;
  choice: 'for' | 'against' | 'abstain';
  weight: number;
  timestamp: Date;
  reason?: string;
  delegatedFrom?: string;
  signature?: string;
}

export interface VotingPower {
  address: string;
  power: number;
  lastUpdated: Date;
  delegatedTo?: string;
  delegatedFrom: string[];
  source: 'direct' | 'delegated' | 'earned';
  restrictions?: string[];
}

export interface Delegation {
  delegator: string;
  delegate: string;
  power: number;
  scope: 'all' | 'category' | 'specific';
  restrictions?: string[];
  expiresAt?: Date;
  createdAt: Date;
  isActive: boolean;
}

export interface MultiSigSignature {
  signer: string;
  signature: string;
  timestamp: Date;
  proposalHash: string;
}

export interface ConsensusRule {
  id: string;
  name: string;
  type: 'majority' | 'supermajority' | 'unanimous' | 'quorum' | 'weighted';
  threshold: number;
  applicableTypes: Proposal['type'][];
  applicableCategories: Proposal['category'][];
  requiredRoles?: string[];
  conditions?: Record<string, any>;
}

export interface GovernanceRole {
  id: string;
  name: string;
  permissions: string[];
  votingPowerMultiplier: number;
  canPropose: boolean;
  canDelegate: boolean;
  canExecute: boolean;
  restrictions?: string[];
}

// MCP Types
export interface MCPConfig {
  port: number;
  host: string;
  enableAuth: boolean;
  maxConnections: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: z.ZodSchema;
  handler: (params: any) => Promise<any>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
  handler: () => Promise<any>;
}

// RAG Types
export interface RAGConfig {
  vectorStore: 'chroma' | 'pinecone' | 'memory';
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}

export interface Document {
  id: string;
  content: string;
  metadata: Record<string, any>;
  embedding?: number[];
  source?: string;
  createdAt: Date;
}

export interface SearchResult {
  document: Document;
  score: number;
  relevance: number;
}

export interface RAGQuery {
  query: string;
  filters?: Record<string, any>;
  topK?: number;
  threshold?: number;
}

// NL2SQL Types
export interface NL2SQLConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  enableValidation: boolean;
}

export interface SQLQuery {
  id: string;
  naturalLanguage: string;
  sql: string;
  confidence: number;
  tables: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface TableSchema {
  name: string;
  columns: ColumnInfo[];
  relationships: Relationship[];
  description?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey?: string;
  description?: string;
}

export interface Relationship {
  table: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

// Zod Schemas for Validation
export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodes: z.array(z.object({
    id: z.string(),
    type: z.enum(['start', 'end', 'task', 'decision', 'parallel']),
    name: z.string(),
    function: z.string().optional(),
    next: z.union([z.string(), z.array(z.string())]).optional(),
    condition: z.string().optional()
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    condition: z.string().optional()
  })),
  metadata: z.record(z.any()).optional()
});

export const ProposalSchema = z.object({
  id: z.string(),
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(5000),
  proposer: z.string(),
  type: z.enum(['workflow', 'config', 'governance', 'emergency', 'upgrade']),
  category: z.enum(['standard', 'critical', 'constitutional']),
  executionData: z.any().optional(),
  metadata: z.object({
    tags: z.array(z.string()),
    priority: z.enum(['low', 'medium', 'high', 'critical']),
    estimatedImpact: z.enum(['minimal', 'moderate', 'significant', 'major']),
    riskLevel: z.enum(['low', 'medium', 'high']),
    reviewers: z.array(z.string()).optional(),
    externalReferences: z.array(z.string()).optional()
  }),
  dependencies: z.array(z.string()).optional(),
  requiredApprovals: z.array(z.string())
});

export const DelegationSchema = z.object({
  delegator: z.string(),
  delegate: z.string(),
  power: z.number().positive(),
  scope: z.enum(['all', 'category', 'specific']),
  restrictions: z.array(z.string()).optional(),
  expiresAt: z.date().optional()
});

export const MultiSigSchema = z.object({
  signer: z.string(),
  signature: z.string(),
  proposalHash: z.string()
});

export const VoteSchema = z.object({
  voter: z.string(),
  choice: z.enum(['for', 'against', 'abstain']),
  weight: z.number().positive(),
  reason: z.string().optional()
});

export const RAGQuerySchema = z.object({
  query: z.string(),
  filters: z.record(z.any()).optional(),
  topK: z.number().positive().optional(),
  threshold: z.number().min(0).max(1).optional()
});

export const NL2SQLRequestSchema = z.object({
  query: z.string(),
  context: z.record(z.any()).optional(),
  validate: z.boolean().optional()
});

// Error Types
export class LALOError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: any
  ) {
    super(message);
    this.name = 'LALOError';
  }
}

export class WorkflowError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'WORKFLOW_ERROR', details);
    this.name = 'WorkflowError';
  }
}

export class GovernanceError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'GOVERNANCE_ERROR', details);
    this.name = 'GovernanceError';
  }
}

export class DelegationError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'DELEGATION_ERROR', details);
    this.name = 'DelegationError';
  }
}

export class ConsensusError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'CONSENSUS_ERROR', details);
    this.name = 'ConsensusError';
  }
}

export class MultiSigError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'MULTISIG_ERROR', details);
    this.name = 'MultiSigError';
  }
}

export class RAGError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'RAG_ERROR', details);
    this.name = 'RAGError';
  }
}

export class NL2SQLError extends LALOError {
  constructor(message: string, details?: any) {
    super(message, 'NL2SQL_ERROR', details);
    this.name = 'NL2SQLError';
  }
}