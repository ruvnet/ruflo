/**
 * Beads Integration Types
 * TypeScript interfaces for Steve Yegge's Beads issue tracking system integration
 *
 * Beads is a lightweight, AI-friendly issue tracking system designed for
 * agentic workflows. This module provides the type definitions for integrating
 * Beads with Claude Flow V3.
 *
 * @see https://github.com/steveyegge/beads
 */

// ============================================
// Core Issue Types
// ============================================

/**
 * Issue status values
 */
export type BeadsIssueStatus = 'open' | 'in_progress' | 'closed';

/**
 * Issue priority levels (0 = highest, 4 = lowest)
 */
export type BeadsIssuePriority = 0 | 1 | 2 | 3 | 4;

/**
 * Issue type classification
 */
export type BeadsIssueType = 'bug' | 'feature' | 'task' | 'epic' | 'chore';

/**
 * Dependency relationship types between issues
 */
export type BeadsDependencyType = 'blocks' | 'related' | 'parent-child' | 'discovered-from';

/**
 * Represents a single Beads issue
 */
export interface BeadsIssue {
  /** Unique issue identifier (e.g., "bd-a1b2" or "bd-a1b2.1" for sub-issues) */
  id: string;
  /** Issue title/summary */
  title: string;
  /** Detailed description of the issue */
  description?: string;
  /** Current issue status */
  status: BeadsIssueStatus;
  /** Priority level (0 = highest/critical, 4 = lowest/nice-to-have) */
  priority: BeadsIssuePriority;
  /** Issue type classification */
  type: BeadsIssueType;
  /** Assigned agent or user */
  assignee?: string;
  /** Labels/tags for categorization */
  labels: string[];
  /** ISO 8601 timestamp of creation */
  created_at: string;
  /** ISO 8601 timestamp of last update */
  updated_at: string;
  /** ISO 8601 timestamp when issue was closed */
  closed_at?: string;
  /** Reason for closing (e.g., "fixed", "duplicate", "wontfix") */
  close_reason?: string;
  /** Dependencies this issue has on other issues */
  dependencies: BeadsDependency[];
  /** Additional notes or comments */
  notes?: string;
}

/**
 * Represents a dependency relationship between two issues
 */
export interface BeadsDependency {
  /** Source issue ID (the issue that depends on another) */
  from_id: string;
  /** Target issue ID (the issue being depended upon) */
  to_id: string;
  /** Type of dependency relationship */
  type: BeadsDependencyType;
  /** ISO 8601 timestamp when dependency was created */
  created_at: string;
}

// ============================================
// MCP Tool Parameter Types
// ============================================

/**
 * Parameters for creating a new issue
 */
export interface BeadsCreateParams {
  /** Issue title (required) */
  title: string;
  /** Detailed description */
  description?: string;
  /** Priority level (0-4, default: 2) */
  priority?: number;
  /** Issue type (default: "task") */
  type?: string;
  /** Assignee identifier */
  assignee?: string;
  /** Labels to apply */
  labels?: string[];
  /** Parent issue ID for creating sub-issues */
  parent_id?: string;
}

/**
 * Parameters for listing/filtering issues
 */
export interface BeadsListParams {
  /** Filter by status */
  status?: string;
  /** Filter by exact priority */
  priority?: number;
  /** Filter by assignee */
  assignee?: string;
  /** Filter by labels (all must match) */
  labels?: string[];
  /** Filter by labels (any can match) */
  label_any?: string[];
  /** Filter by title substring */
  title_contains?: string;
  /** Filter by description substring */
  desc_contains?: string;
  /** Filter by creation date (after) */
  created_after?: string;
  /** Filter by creation date (before) */
  created_before?: string;
  /** Maximum number of results */
  limit?: number;
}

/**
 * Parameters for getting ready-to-work issues
 * (issues with no blocking dependencies)
 */
export interface BeadsReadyParams {
  /** Maximum number of results */
  limit?: number;
  /** Filter by maximum priority (0 = only critical) */
  priority?: number;
  /** Filter by assignee */
  assignee?: string;
  /** Sort order: priority-first, oldest-first, or hybrid */
  sort?: 'priority' | 'oldest' | 'hybrid';
}

/**
 * Parameters for showing a single issue
 */
export interface BeadsShowParams {
  /** Issue ID to retrieve */
  id: string;
}

/**
 * Parameters for updating an existing issue
 */
export interface BeadsUpdateParams {
  /** Issue ID to update */
  id: string;
  /** New status */
  status?: string;
  /** New priority */
  priority?: number;
  /** New assignee */
  assignee?: string;
  /** New labels (replaces existing) */
  labels?: string[];
  /** Additional notes to append */
  notes?: string;
}

/**
 * Parameters for closing an issue
 */
export interface BeadsCloseParams {
  /** Issue ID to close */
  id: string;
  /** Reason for closing */
  reason?: string;
}

/**
 * Parameters for adding a dependency
 */
export interface BeadsDepAddParams {
  /** Source issue ID */
  from_id: string;
  /** Target issue ID */
  to_id: string;
  /** Dependency type (default: "blocks") */
  type?: BeadsDependencyType;
}

/**
 * Parameters for viewing dependency tree
 */
export interface BeadsDepTreeParams {
  /** Root issue ID for the tree */
  id: string;
}

/**
 * Parameters for listing blocked issues
 */
export interface BeadsBlockedParams {
  /** Maximum number of results */
  limit?: number;
}

/**
 * Parameters for syncing with external systems
 */
export interface BeadsSyncParams {
  /** Force sync even if no changes detected */
  force?: boolean;
}

// ============================================
// Configuration Types
// ============================================

/**
 * Configuration for the Beads CLI wrapper
 */
export interface BeadsConfig {
  /** Path to the bd binary (default: "bd") */
  binary: string;
  /** Auto-initialize beads if .beads directory not present */
  autoInit: boolean;
  /** Sync interval in milliseconds */
  syncInterval: number;
  /** Always use --json flag for machine-readable output */
  jsonOutput: boolean;
  /** Working directory for beads commands */
  workingDir?: string;
}

/**
 * Default Beads configuration
 */
export const DEFAULT_BEADS_CONFIG: BeadsConfig = {
  binary: 'bd',
  autoInit: true,
  syncInterval: 30000,
  jsonOutput: true,
  workingDir: undefined,
};

// ============================================
// Result Types
// ============================================

/**
 * Generic result type for Beads command execution
 */
export interface BeadsCommandResult<T = unknown> {
  /** Whether the command succeeded */
  success: boolean;
  /** Parsed data from command output */
  data?: T;
  /** Error message if command failed */
  error?: string;
  /** Process exit code */
  exitCode: number;
}

/**
 * Statistics about the current Beads database
 */
export interface BeadsStats {
  /** Total number of issues */
  total: number;
  /** Number of open issues */
  open: number;
  /** Number of in-progress issues */
  in_progress: number;
  /** Number of closed issues */
  closed: number;
  /** Issue count by priority level */
  by_priority: Record<number, number>;
  /** Issue count by issue type */
  by_type: Record<string, number>;
}

// ============================================
// Hook Integration Types
// ============================================

/**
 * Extended hook context with Beads integration
 */
export interface BeadsHookContext {
  /** Currently active issue ID being worked on */
  active_issue?: string;
  /** Current session identifier */
  session_id?: string;
  /** Pre-fetched ready work items */
  ready_work?: BeadsIssue[];
}

/**
 * Link between Claude Flow memory and Beads issues
 */
export interface BeadsMemoryLink {
  /** Memory namespace and key */
  memory_key: string;
  /** Associated Beads issue ID */
  issue_id: string;
  /** ISO 8601 timestamp when link was created */
  linked_at: string;
  /** Type of link relationship */
  link_type: 'learned-from' | 'referenced' | 'auto';
}

// ============================================
// MCP Tool Types
// ============================================

/**
 * MCP tool definition for Beads integration
 */
export interface BeadsMCPTool {
  /** Tool name (e.g., "beads_create", "beads_list") */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Tool category for organization */
  category: 'beads';
  /** Searchable tags */
  tags: string[];
}

/**
 * Result type for MCP tool execution
 */
export interface BeadsMCPToolResult {
  /** Content array following MCP spec */
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  /** Whether the operation resulted in an error */
  isError?: boolean;
}

// ============================================
// Event Types
// ============================================

/**
 * Event types emitted by the Beads integration
 */
export type BeadsEventType =
  | 'issue:created'
  | 'issue:updated'
  | 'issue:closed'
  | 'issue:assigned'
  | 'dependency:added'
  | 'dependency:removed'
  | 'sync:started'
  | 'sync:completed'
  | 'sync:failed';

/**
 * Beads event payload
 */
export interface BeadsEvent {
  /** Event type */
  type: BeadsEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Issue ID if applicable */
  issue_id?: string;
  /** Event-specific data */
  data?: unknown;
}

// ============================================
// Agent Integration Types
// ============================================

/**
 * Agent work assignment from Beads
 */
export interface BeadsWorkAssignment {
  /** Assigned issue */
  issue: BeadsIssue;
  /** Agent ID assigned to work on this */
  agent_id: string;
  /** Assignment timestamp */
  assigned_at: string;
  /** Priority score for work ordering */
  priority_score: number;
  /** Estimated complexity (1-10) */
  estimated_complexity?: number;
}

/**
 * Agent work completion report
 */
export interface BeadsWorkCompletion {
  /** Issue that was worked on */
  issue_id: string;
  /** Agent that completed the work */
  agent_id: string;
  /** Whether work was successful */
  success: boolean;
  /** Completion timestamp */
  completed_at: string;
  /** Time spent in milliseconds */
  duration_ms: number;
  /** Summary of work done */
  summary?: string;
  /** Files modified during work */
  files_modified?: string[];
  /** Patterns learned during work (for memory storage) */
  patterns_learned?: string[];
}

// ============================================
// Error Types
// ============================================

/**
 * Beads-specific error class
 */
export class BeadsError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'BeadsError';
  }
}

/**
 * Error codes for Beads operations
 */
export const BeadsErrorCodes = {
  /** Beads binary not found */
  BINARY_NOT_FOUND: 'BEADS_BINARY_NOT_FOUND',
  /** .beads directory not initialized */
  NOT_INITIALIZED: 'BEADS_NOT_INITIALIZED',
  /** Issue not found */
  ISSUE_NOT_FOUND: 'BEADS_ISSUE_NOT_FOUND',
  /** Invalid issue ID format */
  INVALID_ID: 'BEADS_INVALID_ID',
  /** Dependency cycle detected */
  DEPENDENCY_CYCLE: 'BEADS_DEPENDENCY_CYCLE',
  /** Command execution failed */
  COMMAND_FAILED: 'BEADS_COMMAND_FAILED',
  /** JSON parsing failed */
  PARSE_ERROR: 'BEADS_PARSE_ERROR',
  /** Sync operation failed */
  SYNC_FAILED: 'BEADS_SYNC_FAILED',
} as const;

export type BeadsErrorCode = typeof BeadsErrorCodes[keyof typeof BeadsErrorCodes];
