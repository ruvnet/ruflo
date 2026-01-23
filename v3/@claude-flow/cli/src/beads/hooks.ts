/**
 * Beads Hooks Integration
 *
 * Lifecycle hooks for Beads issue tracking integration with Claude Flow V3.
 * Provides session-aware context injection and automatic issue management.
 */

import type { BeadsCliWrapper, BeadsIssue } from './cli-wrapper.js';

/**
 * Context for a task execution
 */
export interface TaskContext {
  /** Task completion status */
  status?: string;
  /** Associated Beads issue ID */
  beads_issue_id?: string;
  /** Keywords for finding related issues */
  keywords?: string;
}

/**
 * Result of task execution
 */
export interface TaskResult {
  /** Summary of what was accomplished */
  summary?: string;
  /** Patterns learned during task execution */
  patterns_learned?: string[];
}

/**
 * BeadsHooks provides lifecycle hooks for integrating Beads issue tracking
 * with Claude Flow sessions and tasks.
 *
 * Follows the London School TDD approach with dependency injection for
 * the BeadsCliWrapper, enabling easy mocking and behavior verification.
 */
export class BeadsHooks {
  private wrapper: BeadsCliWrapper;

  constructor(wrapper: BeadsCliWrapper) {
    this.wrapper = wrapper;
  }

  /**
   * Session start hook - retrieves and formats ready work items.
   *
   * Called at the beginning of a session to provide context about
   * unblocked issues that are ready to be worked on.
   *
   * @returns Formatted string with ready work context for injection
   */
  async sessionStart(): Promise<string> {
    const result = await this.wrapper.ready({ limit: 5 });

    if (!result.success || !result.data?.length) {
      return '📋 No ready work found. Use beads_create to file new issues.';
    }

    const issues = result.data;
    const formatted = issues
      .map((i) => `  - [${i.id}] P${i.priority} ${i.title}`)
      .join('\n');

    return `📋 Ready Work (${issues.length} unblocked):\n${formatted}\n\nUse beads_show <id> for details.`;
  }

  /**
   * Session end hook - provides cleanup guidance.
   *
   * Called at the end of a session to remind about issue management
   * and synchronization.
   *
   * @returns Formatted string with session cleanup instructions
   */
  async sessionEnd(): Promise<string> {
    return `
Before ending session:
1. File any discovered issues with beads_create
2. Update in-progress issues with beads_update
3. Close completed issues with beads_close
4. Run beads_sync to push changes to git
    `.trim();
  }

  /**
   * Pre-task hook - finds and injects related issues context.
   *
   * Called before starting a task to provide context about related
   * issues that may be relevant to the current work.
   *
   * @param context - Task context with keywords for searching
   * @returns Formatted string with related issues or empty string
   */
  async preTask(context: TaskContext): Promise<string> {
    if (!context.keywords) {
      return '';
    }

    const result = await this.wrapper.list({
      status: 'open',
      limit: 5,
    });

    if (!result.success || !result.data?.length) {
      return '';
    }

    // Filter issues that contain the keywords (case-insensitive)
    const keywords = context.keywords.toLowerCase();
    const matchingIssues = result.data.filter(
      (i) => i.title.toLowerCase().includes(keywords) ||
             i.description?.toLowerCase().includes(keywords)
    );

    if (matchingIssues.length === 0) {
      return '';
    }

    const formatted = matchingIssues
      .map((i) => `  - [${i.id}] ${i.title}`)
      .join('\n');

    return `📋 Related Beads issues found:\n${formatted}`;
  }

  /**
   * Post-task hook - closes issues on successful task completion.
   *
   * Called after task execution to automatically close associated
   * issues when the task completes successfully.
   *
   * @param context - Task context with status and optional issue ID
   * @param result - Task result with summary and patterns learned
   */
  async postTask(context: TaskContext, result: TaskResult): Promise<void> {
    if (context.status !== 'completed' || !context.beads_issue_id) {
      return;
    }

    // Build resolution message
    let resolution = result.summary;

    // Include patterns learned if any
    if (result.patterns_learned && result.patterns_learned.length > 0) {
      const patternsText = result.patterns_learned
        .map((p) => `- ${p}`)
        .join('\n');
      resolution = resolution
        ? `${resolution}\n\nPatterns learned:\n${patternsText}`
        : `Patterns learned:\n${patternsText}`;
    }

    await this.wrapper.close({ id: context.beads_issue_id, reason: resolution });
  }
}
