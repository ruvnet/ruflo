/**
 * Beads GitHub Integration
 *
 * Provides bidirectional synchronization between Beads tasks and GitHub issues.
 * Supports creating, updating, and closing issues from beads tasks,
 * as well as importing GitHub issues into beads.
 *
 * @see https://github.com/steveyegge/beads
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { BeadsCliWrapper, BeadsIssue } from './cli-wrapper.js';
import type {
  BeadsIssueStatus,
  BeadsIssuePriority,
  BeadsIssueType,
  BeadsCommandResult,
} from './types.js';
import { BeadsError, BeadsErrorCodes } from './types.js';

const execAsync = promisify(exec);

// ============================================
// GitHub Types
// ============================================

/**
 * GitHub issue state
 */
export type GitHubIssueState = 'open' | 'closed';

/**
 * GitHub issue representation
 */
export interface GitHubIssue {
  /** GitHub issue number */
  number: number;
  /** Issue title */
  title: string;
  /** Issue body/description */
  body: string | null;
  /** Issue state (open/closed) */
  state: GitHubIssueState;
  /** Labels applied to the issue */
  labels: GitHubLabel[];
  /** Assignees on the issue */
  assignees: GitHubUser[];
  /** Milestone if assigned */
  milestone: GitHubMilestone | null;
  /** Issue URL */
  html_url: string;
  /** API URL */
  url: string;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at: string;
  /** Close timestamp if closed */
  closed_at: string | null;
}

/**
 * GitHub label
 */
export interface GitHubLabel {
  name: string;
  color: string;
  description?: string;
}

/**
 * GitHub user
 */
export interface GitHubUser {
  login: string;
  id: number;
}

/**
 * GitHub milestone
 */
export interface GitHubMilestone {
  number: number;
  title: string;
  state: 'open' | 'closed';
}

/**
 * Parameters for creating a GitHub issue
 */
export interface GitHubCreateParams {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

/**
 * Parameters for updating a GitHub issue
 */
export interface GitHubUpdateParams {
  title?: string;
  body?: string;
  state?: GitHubIssueState;
  labels?: string[];
  assignees?: string[];
  milestone?: number | null;
}

/**
 * Sync direction
 */
export type SyncDirection = 'to-github' | 'from-github' | 'bidirectional';

/**
 * Sync result
 */
export interface SyncResult {
  /** Whether sync completed successfully */
  success: boolean;
  /** Number of tasks synced to GitHub */
  pushedToGitHub: number;
  /** Number of issues pulled from GitHub */
  pulledFromGitHub: number;
  /** Tasks that were created in GitHub */
  created: string[];
  /** Tasks that were updated */
  updated: string[];
  /** Issues that were imported */
  imported: string[];
  /** Any errors encountered */
  errors: Array<{ taskId?: string; issueNumber?: number; error: string }>;
}

/**
 * Link record between beads task and GitHub issue
 */
export interface GitHubLink {
  /** Beads task ID */
  taskId: string;
  /** GitHub issue number */
  issueNumber: number;
  /** Repository in owner/repo format */
  repo: string;
  /** Full issue URL */
  issueUrl: string;
  /** When the link was created */
  linkedAt: string;
  /** Last sync timestamp */
  lastSyncAt?: string;
}

/**
 * Configuration for GitHub sync
 */
export interface GitHubSyncConfig {
  /** Repository in owner/repo format (auto-detected if not provided) */
  repo?: string;
  /** Whether to create labels for priority */
  syncPriorityAsLabels: boolean;
  /** Whether to create labels for type */
  syncTypeAsLabels: boolean;
  /** Whether to map epics to milestones */
  mapEpicsToMilestones: boolean;
  /** Label prefix for beads-managed issues */
  beadsLabelPrefix: string;
  /** Whether to sync closed issues */
  syncClosed: boolean;
}

/**
 * Default sync configuration
 */
export const DEFAULT_GITHUB_SYNC_CONFIG: GitHubSyncConfig = {
  syncPriorityAsLabels: true,
  syncTypeAsLabels: true,
  mapEpicsToMilestones: true,
  beadsLabelPrefix: 'beads:',
  syncClosed: false,
};

// ============================================
// Field Mapping Utilities
// ============================================

/**
 * Maps beads status to GitHub issue state
 */
export function mapStatusToGitHub(status: BeadsIssueStatus): GitHubIssueState {
  return status === 'closed' ? 'closed' : 'open';
}

/**
 * Maps GitHub issue state to beads status
 */
export function mapStatusFromGitHub(state: GitHubIssueState): BeadsIssueStatus {
  return state === 'closed' ? 'closed' : 'open';
}

/**
 * Maps beads priority to GitHub label
 */
export function mapPriorityToLabel(priority: BeadsIssuePriority, prefix = 'priority:'): string {
  const priorityMap: Record<BeadsIssuePriority, string> = {
    0: 'critical',
    1: 'high',
    2: 'medium',
    3: 'low',
    4: 'trivial',
  };
  return `${prefix}${priorityMap[priority]}`;
}

/**
 * Maps GitHub priority label to beads priority
 */
export function mapPriorityFromLabel(labels: GitHubLabel[], prefix = 'priority:'): BeadsIssuePriority {
  const priorityLabels = labels.filter((l) => l.name.startsWith(prefix));
  if (priorityLabels.length === 0) return 2; // Default medium

  const labelValue = priorityLabels[0].name.replace(prefix, '');
  const priorityMap: Record<string, BeadsIssuePriority> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    trivial: 4,
  };
  return priorityMap[labelValue] ?? 2;
}

/**
 * Maps beads type to GitHub label
 */
export function mapTypeToLabel(type: BeadsIssueType, prefix = 'type:'): string {
  return `${prefix}${type}`;
}

/**
 * Maps GitHub type label to beads type
 */
export function mapTypeFromLabel(labels: GitHubLabel[], prefix = 'type:'): BeadsIssueType {
  const typeLabels = labels.filter((l) => l.name.startsWith(prefix));
  if (typeLabels.length === 0) return 'task'; // Default task

  const labelValue = typeLabels[0].name.replace(prefix, '');
  const validTypes: BeadsIssueType[] = ['bug', 'feature', 'task', 'epic', 'chore'];
  return validTypes.includes(labelValue as BeadsIssueType)
    ? (labelValue as BeadsIssueType)
    : 'task';
}

/**
 * Extracts beads task ID from GitHub issue body
 */
export function extractBeadsIdFromBody(body: string | null): string | null {
  if (!body) return null;
  const match = body.match(/<!-- beads-id: (bd-[a-z0-9.]+) -->/);
  return match ? match[1] : null;
}

/**
 * Adds beads task ID to GitHub issue body
 */
export function addBeadsIdToBody(body: string, taskId: string): string {
  const marker = `<!-- beads-id: ${taskId} -->`;
  if (body.includes('<!-- beads-id:')) {
    return body.replace(/<!-- beads-id: bd-[a-z0-9.]+ -->/, marker);
  }
  return `${body}\n\n${marker}`;
}

// ============================================
// GitHubSync Class
// ============================================

/**
 * Manages synchronization between Beads and GitHub Issues
 */
export class GitHubSync {
  private beadsWrapper: BeadsCliWrapper;
  private config: GitHubSyncConfig;
  private links: Map<string, GitHubLink> = new Map();

  constructor(
    beadsWrapper: BeadsCliWrapper,
    config?: Partial<GitHubSyncConfig>
  ) {
    this.beadsWrapper = beadsWrapper;
    this.config = {
      ...DEFAULT_GITHUB_SYNC_CONFIG,
      ...config,
    };
  }

  /**
   * Check if gh CLI is installed and authenticated
   */
  async isGhCliAvailable(): Promise<boolean> {
    try {
      await execAsync('gh auth status');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current repository from git remote
   */
  async getRepo(): Promise<string> {
    if (this.config.repo) {
      return this.config.repo;
    }

    try {
      const { stdout } = await execAsync('gh repo view --json nameWithOwner -q .nameWithOwner');
      return stdout.trim();
    } catch (error) {
      throw new BeadsError(
        'Could not determine repository. Please provide repo in config or run from a git repository.',
        BeadsErrorCodes.COMMAND_FAILED,
        { error }
      );
    }
  }

  /**
   * Sync a beads task to GitHub
   * Creates a new issue if no link exists, updates if it does
   */
  async syncToGitHub(taskId: string): Promise<BeadsCommandResult<GitHubIssue>> {
    const taskResult = await this.beadsWrapper.show({ id: taskId });
    if (!taskResult.success || !taskResult.data) {
      return {
        success: false,
        error: `Task not found: ${taskId}`,
        exitCode: 1,
      };
    }

    const task = taskResult.data;
    const existingLink = this.links.get(taskId);

    try {
      const repo = await this.getRepo();
      let issue: GitHubIssue;

      if (existingLink) {
        // Update existing issue
        issue = await this.updateGitHubIssue(repo, existingLink.issueNumber, task);
        this.updateLink(taskId, {
          ...existingLink,
          lastSyncAt: new Date().toISOString(),
        });
      } else {
        // Create new issue
        issue = await this.createGitHubIssue(repo, task);
        this.createLink(taskId, issue.number, repo, issue.html_url);
      }

      return { success: true, data: issue, exitCode: 0 };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync to GitHub',
        exitCode: 1,
      };
    }
  }

  /**
   * Sync from GitHub to beads
   * Creates or updates beads task from GitHub issue
   */
  async syncFromGitHub(issueNumber: number): Promise<BeadsCommandResult<BeadsIssue>> {
    try {
      const repo = await this.getRepo();
      const issue = await this.fetchGitHubIssue(repo, issueNumber);

      // Check if we have an existing link
      const existingTaskId = this.findTaskByIssue(issueNumber);
      const beadsIdInBody = extractBeadsIdFromBody(issue.body);
      const taskId = existingTaskId || beadsIdInBody;

      if (taskId) {
        // Update existing task
        const result = await this.beadsWrapper.update({
          id: taskId,
          status: mapStatusFromGitHub(issue.state),
          notes: `Synced from GitHub #${issueNumber}`,
        });

        if (result.success) {
          this.updateLink(taskId, {
            taskId,
            issueNumber,
            repo,
            issueUrl: issue.html_url,
            linkedAt: this.links.get(taskId)?.linkedAt || new Date().toISOString(),
            lastSyncAt: new Date().toISOString(),
          });
        }

        return result;
      } else {
        // Create new task
        const result = await this.beadsWrapper.create({
          title: issue.title,
          description: issue.body || undefined,
          priority: mapPriorityFromLabel(issue.labels),
          type: mapTypeFromLabel(issue.labels),
          labels: issue.labels
            .map((l) => l.name)
            .filter((n) => !n.startsWith('priority:') && !n.startsWith('type:')),
          assignee: issue.assignees[0]?.login,
        });

        if (result.success && result.data) {
          this.createLink(result.data.id, issueNumber, repo, issue.html_url);

          // Update issue body with beads ID
          await this.updateGitHubIssueBody(
            repo,
            issueNumber,
            addBeadsIdToBody(issue.body || '', result.data.id)
          );
        }

        return result;
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to sync from GitHub',
        exitCode: 1,
      };
    }
  }

  /**
   * Full bidirectional sync
   */
  async sync(direction: SyncDirection = 'bidirectional'): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      pushedToGitHub: 0,
      pulledFromGitHub: 0,
      created: [],
      updated: [],
      imported: [],
      errors: [],
    };

    try {
      const repo = await this.getRepo();

      // Sync to GitHub
      if (direction === 'to-github' || direction === 'bidirectional') {
        const tasksResult = await this.beadsWrapper.list(
          this.config.syncClosed ? {} : { status: 'open' }
        );

        if (tasksResult.success && tasksResult.data) {
          for (const task of tasksResult.data) {
            try {
              const syncResult = await this.syncToGitHub(task.id);
              if (syncResult.success) {
                result.pushedToGitHub++;
                if (!this.links.has(task.id)) {
                  result.created.push(task.id);
                } else {
                  result.updated.push(task.id);
                }
              }
            } catch (error) {
              result.errors.push({
                taskId: task.id,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
      }

      // Sync from GitHub
      if (direction === 'from-github' || direction === 'bidirectional') {
        const issues = await this.listGitHubIssues(repo);

        for (const issue of issues) {
          // Skip issues without beads marker unless they're new
          const beadsId = extractBeadsIdFromBody(issue.body);
          const existingLink = this.findTaskByIssue(issue.number);

          if (!beadsId && !existingLink && direction === 'bidirectional') {
            // In bidirectional mode, only sync issues that were created from beads
            continue;
          }

          try {
            const syncResult = await this.syncFromGitHub(issue.number);
            if (syncResult.success) {
              result.pulledFromGitHub++;
              if (!beadsId && !existingLink) {
                result.imported.push(`#${issue.number}`);
              }
            }
          } catch (error) {
            result.errors.push({
              issueNumber: issue.number,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.success = false;
      result.errors.push({
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    }

    return result;
  }

  /**
   * Link a beads task to an existing GitHub issue
   */
  async linkIssue(taskId: string, issueUrl: string): Promise<BeadsCommandResult<GitHubLink>> {
    // Parse issue URL
    const urlMatch = issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
    if (!urlMatch) {
      return {
        success: false,
        error: 'Invalid GitHub issue URL format. Expected: https://github.com/owner/repo/issues/123',
        exitCode: 1,
      };
    }

    const [, repo, issueNumberStr] = urlMatch;
    const issueNumber = parseInt(issueNumberStr, 10);

    // Verify task exists
    const taskResult = await this.beadsWrapper.show({ id: taskId });
    if (!taskResult.success) {
      return {
        success: false,
        error: `Task not found: ${taskId}`,
        exitCode: 1,
      };
    }

    // Verify issue exists
    try {
      await this.fetchGitHubIssue(repo, issueNumber);
    } catch {
      return {
        success: false,
        error: `GitHub issue not found: ${issueUrl}`,
        exitCode: 1,
      };
    }

    const link = this.createLink(taskId, issueNumber, repo, issueUrl);

    // Update task with note about the link
    await this.beadsWrapper.update({
      id: taskId,
      notes: `Linked to GitHub: ${issueUrl}`,
    });

    return { success: true, data: link, exitCode: 0 };
  }

  /**
   * Unlink a beads task from GitHub issue
   */
  async unlinkIssue(taskId: string): Promise<BeadsCommandResult> {
    if (!this.links.has(taskId)) {
      return {
        success: false,
        error: `No GitHub link found for task: ${taskId}`,
        exitCode: 1,
      };
    }

    this.links.delete(taskId);

    // Update task with note about unlink
    await this.beadsWrapper.update({
      id: taskId,
      notes: 'Unlinked from GitHub',
    });

    return { success: true, exitCode: 0 };
  }

  /**
   * Get the link for a task
   */
  getLink(taskId: string): GitHubLink | undefined {
    return this.links.get(taskId);
  }

  /**
   * Get all links
   */
  getAllLinks(): GitHubLink[] {
    return Array.from(this.links.values());
  }

  /**
   * Import all links from stored data
   */
  importLinks(links: GitHubLink[]): void {
    for (const link of links) {
      this.links.set(link.taskId, link);
    }
  }

  /**
   * Export all links
   */
  exportLinks(): GitHubLink[] {
    return Array.from(this.links.values());
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private createLink(
    taskId: string,
    issueNumber: number,
    repo: string,
    issueUrl: string
  ): GitHubLink {
    const link: GitHubLink = {
      taskId,
      issueNumber,
      repo,
      issueUrl,
      linkedAt: new Date().toISOString(),
    };
    this.links.set(taskId, link);
    return link;
  }

  private updateLink(taskId: string, link: GitHubLink): void {
    this.links.set(taskId, link);
  }

  private findTaskByIssue(issueNumber: number): string | null {
    for (const [taskId, link] of this.links) {
      if (link.issueNumber === issueNumber) {
        return taskId;
      }
    }
    return null;
  }

  private async createGitHubIssue(repo: string, task: BeadsIssue): Promise<GitHubIssue> {
    const labels = this.buildLabelsForTask(task);
    const body = addBeadsIdToBody(task.description || '', task.id);

    const args = [
      'gh', 'issue', 'create',
      '--repo', repo,
      '--title', this.escapeShellArg(task.title),
      '--body', this.escapeShellArg(body),
    ];

    if (labels.length > 0) {
      args.push('--label', labels.join(','));
    }

    if (task.assignee) {
      args.push('--assignee', task.assignee);
    }

    const { stdout } = await execAsync(args.join(' '));

    // gh issue create returns the issue URL
    const urlMatch = stdout.trim().match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (!urlMatch) {
      throw new BeadsError(
        'Failed to parse created issue URL',
        BeadsErrorCodes.PARSE_ERROR,
        { stdout }
      );
    }

    const issueNumber = parseInt(urlMatch[1], 10);
    return this.fetchGitHubIssue(repo, issueNumber);
  }

  private async updateGitHubIssue(
    repo: string,
    issueNumber: number,
    task: BeadsIssue
  ): Promise<GitHubIssue> {
    const labels = this.buildLabelsForTask(task);
    const state = mapStatusToGitHub(task.status);

    const args = [
      'gh', 'issue', 'edit',
      String(issueNumber),
      '--repo', repo,
      '--title', this.escapeShellArg(task.title),
    ];

    if (task.description) {
      args.push('--body', this.escapeShellArg(addBeadsIdToBody(task.description, task.id)));
    }

    if (labels.length > 0) {
      args.push('--add-label', labels.join(','));
    }

    await execAsync(args.join(' '));

    // Handle state change separately
    if (state === 'closed' && task.status === 'closed') {
      await execAsync(`gh issue close ${issueNumber} --repo ${repo}`);
    } else if (state === 'open' && task.status !== 'closed') {
      await execAsync(`gh issue reopen ${issueNumber} --repo ${repo}`).catch(() => {
        // Issue might already be open
      });
    }

    return this.fetchGitHubIssue(repo, issueNumber);
  }

  private async updateGitHubIssueBody(
    repo: string,
    issueNumber: number,
    body: string
  ): Promise<void> {
    await execAsync(
      `gh issue edit ${issueNumber} --repo ${repo} --body ${this.escapeShellArg(body)}`
    );
  }

  private async fetchGitHubIssue(repo: string, issueNumber: number): Promise<GitHubIssue> {
    const { stdout } = await execAsync(
      `gh issue view ${issueNumber} --repo ${repo} --json number,title,body,state,labels,assignees,milestone,url,createdAt,updatedAt,closedAt`
    );

    const data = JSON.parse(stdout);
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state.toLowerCase() as GitHubIssueState,
      labels: data.labels || [],
      assignees: data.assignees || [],
      milestone: data.milestone,
      html_url: data.url,
      url: data.url,
      created_at: data.createdAt,
      updated_at: data.updatedAt,
      closed_at: data.closedAt,
    };
  }

  private async listGitHubIssues(repo: string): Promise<GitHubIssue[]> {
    const stateArg = this.config.syncClosed ? '--state all' : '--state open';
    const { stdout } = await execAsync(
      `gh issue list --repo ${repo} ${stateArg} --json number,title,body,state,labels,assignees,milestone,url,createdAt,updatedAt,closedAt --limit 100`
    );

    const data = JSON.parse(stdout);
    return data.map((d: Record<string, unknown>) => ({
      number: d.number,
      title: d.title,
      body: d.body,
      state: (d.state as string).toLowerCase() as GitHubIssueState,
      labels: d.labels || [],
      assignees: d.assignees || [],
      milestone: d.milestone,
      html_url: d.url,
      url: d.url,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
      closed_at: d.closedAt,
    }));
  }

  private buildLabelsForTask(task: BeadsIssue): string[] {
    const labels: string[] = [...task.labels];

    if (this.config.syncPriorityAsLabels) {
      labels.push(mapPriorityToLabel(task.priority));
    }

    if (this.config.syncTypeAsLabels) {
      labels.push(mapTypeToLabel(task.type));
    }

    // Add beads marker label
    labels.push(`${this.config.beadsLabelPrefix}managed`);

    return labels;
  }

  private escapeShellArg(arg: string): string {
    // Escape for shell
    return `"${arg
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/\n/g, '\\n')}"`;
  }
}

/**
 * Factory function to create a GitHubSync instance
 */
export function createGitHubSync(
  beadsWrapper: BeadsCliWrapper,
  config?: Partial<GitHubSyncConfig>
): GitHubSync {
  return new GitHubSync(beadsWrapper, config);
}
