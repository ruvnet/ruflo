/**
 * Beads CLI Wrapper
 *
 * Wraps the `bd` command-line tool for programmatic access to Beads issue tracking.
 * Provides type-safe methods for all bd commands with JSON output parsing.
 *
 * @see https://github.com/steveyegge/beads
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import type {
  BeadsConfig,
  BeadsIssue,
  BeadsCreateParams,
  BeadsListParams,
  BeadsReadyParams,
  BeadsShowParams,
  BeadsUpdateParams,
  BeadsCloseParams,
  BeadsDepAddParams,
  BeadsDepTreeParams,
  BeadsBlockedParams,
  BeadsStats,
  BeadsCommandResult,
} from './types.js';
import { DEFAULT_BEADS_CONFIG, BeadsError, BeadsErrorCodes } from './types.js';

/**
 * Wrapper for the Beads CLI (bd command)
 * Provides type-safe programmatic access to all bd commands
 */
export class BeadsCliWrapper {
  private config: BeadsConfig;

  constructor(config?: Partial<BeadsConfig>) {
    this.config = {
      ...DEFAULT_BEADS_CONFIG,
      ...config,
    };
  }

  /**
   * Check if bd binary is installed and accessible
   */
  async isInstalled(): Promise<boolean> {
    try {
      await this.runBd(['--version']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if beads is initialized in a directory
   * @param dir - Directory to check (defaults to cwd or configured workingDir)
   */
  async isInitialized(dir?: string): Promise<boolean> {
    const targetDir = dir || this.config.workingDir || process.cwd();
    const beadsPath = join(targetDir, '.beads', 'beads.jsonl');
    return existsSync(beadsPath);
  }

  /**
   * Initialize beads in the current directory
   * @param quiet - Suppress output
   * @param stealth - Initialize without creating visible files
   */
  async init(quiet?: boolean, stealth?: boolean): Promise<BeadsCommandResult> {
    const args = ['init'];
    if (quiet) args.push('--quiet');
    if (stealth) args.push('--stealth');

    try {
      await this.runBd(args);
      return { success: true, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Create a new issue
   */
  async create(params: BeadsCreateParams): Promise<BeadsCommandResult<BeadsIssue>> {
    const args = ['create'];

    // Required: title
    args.push('--title', this.escapeArg(params.title));

    // Optional parameters
    if (params.description !== undefined) {
      args.push('--description', this.escapeArg(params.description));
    }
    if (params.priority !== undefined) {
      args.push('--priority', String(params.priority));
    }
    if (params.type !== undefined) {
      args.push('--type', params.type);
    }
    if (params.assignee !== undefined) {
      args.push('--assignee', this.escapeArg(params.assignee));
    }
    if (params.labels && params.labels.length > 0) {
      args.push('--labels', params.labels.join(','));
    }
    if (params.parent_id !== undefined) {
      args.push('--parent', params.parent_id);
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * List issues with optional filters
   */
  async list(params?: BeadsListParams): Promise<BeadsCommandResult<BeadsIssue[]>> {
    const args = ['list'];

    if (params) {
      if (params.status !== undefined) {
        args.push('--status', params.status);
      }
      if (params.priority !== undefined) {
        args.push('--priority', String(params.priority));
      }
      if (params.assignee !== undefined) {
        args.push('--assignee', this.escapeArg(params.assignee));
      }
      if (params.labels && params.labels.length > 0) {
        args.push('--labels', params.labels.join(','));
      }
      if (params.label_any && params.label_any.length > 0) {
        args.push('--label-any', params.label_any.join(','));
      }
      if (params.title_contains !== undefined) {
        args.push('--title-contains', this.escapeArg(params.title_contains));
      }
      if (params.desc_contains !== undefined) {
        args.push('--desc-contains', this.escapeArg(params.desc_contains));
      }
      if (params.created_after !== undefined) {
        args.push('--created-after', params.created_after);
      }
      if (params.created_before !== undefined) {
        args.push('--created-before', params.created_before);
      }
      if (params.limit !== undefined) {
        args.push('--limit', String(params.limit));
      }
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue[]>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get ready-to-work issues (no blocking dependencies)
   */
  async ready(params?: BeadsReadyParams): Promise<BeadsCommandResult<BeadsIssue[]>> {
    const args = ['ready'];

    if (params) {
      if (params.limit !== undefined) {
        args.push('--limit', String(params.limit));
      }
      if (params.priority !== undefined) {
        args.push('--priority', String(params.priority));
      }
      if (params.assignee !== undefined) {
        args.push('--assignee', this.escapeArg(params.assignee));
      }
      if (params.sort !== undefined) {
        args.push('--sort', params.sort);
      }
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue[]>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Show details for a specific issue
   */
  async show(params: BeadsShowParams): Promise<BeadsCommandResult<BeadsIssue>> {
    const args = ['show', params.id, '--json'];

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Update an existing issue
   */
  async update(params: BeadsUpdateParams): Promise<BeadsCommandResult<BeadsIssue>> {
    const args = ['update', params.id];

    if (params.status !== undefined) {
      args.push('--status', params.status);
    }
    if (params.priority !== undefined) {
      args.push('--priority', String(params.priority));
    }
    if (params.assignee !== undefined) {
      args.push('--assignee', this.escapeArg(params.assignee));
    }
    if (params.labels !== undefined) {
      args.push('--labels', params.labels.join(','));
    }
    if (params.notes !== undefined) {
      args.push('--notes', this.escapeArg(params.notes));
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Close an issue
   */
  async close(params: BeadsCloseParams): Promise<BeadsCommandResult<BeadsIssue>> {
    const args = ['close', params.id];

    if (params.reason !== undefined) {
      args.push('--reason', this.escapeArg(params.reason));
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Add a dependency between issues
   */
  async depAdd(params: BeadsDepAddParams): Promise<BeadsCommandResult> {
    const args = ['dep', 'add', params.from_id, params.to_id];

    if (params.type !== undefined) {
      args.push('--type', params.type);
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<unknown>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Show dependency tree
   */
  async depTree(params: BeadsDepTreeParams): Promise<BeadsCommandResult> {
    const args = ['dep', 'tree'];

    if (params.id) {
      args.push(params.id);
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<unknown>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get blocked issues
   */
  async blocked(params?: BeadsBlockedParams): Promise<BeadsCommandResult<BeadsIssue[]>> {
    const args = ['blocked'];

    if (params?.limit !== undefined) {
      args.push('--limit', String(params.limit));
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsIssue[]>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get issue statistics
   */
  async stats(): Promise<BeadsCommandResult<BeadsStats>> {
    const args = ['stats', '--json'];

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<BeadsStats>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Sync with git
   */
  async sync(force?: boolean): Promise<BeadsCommandResult> {
    const args = ['sync'];

    if (force) {
      args.push('--force');
    }

    // Always use JSON output
    args.push('--json');

    try {
      const result = await this.runBd(args);
      const data = this.parseOutput<unknown>(result);
      return { success: true, data, exitCode: 0 };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Run a bd command
   * @param args - Command arguments
   * @returns Command stdout
   */
  private runBd(args: string[]): Promise<string> {
    const command = this.buildCommand(args);

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
  }

  /**
   * Build command string with proper escaping
   */
  private buildCommand(args: string[]): string {
    const binary = this.config.binary;
    const escapedArgs = args.map((arg) => {
      // If arg already contains quotes or needs escaping
      if (arg.includes(' ') || arg.includes('"') || arg.includes("'")) {
        // Double-quote and escape internal quotes
        return `"${arg.replace(/"/g, '\\"')}"`;
      }
      return arg;
    });

    return `${binary} ${escapedArgs.join(' ')}`;
  }

  /**
   * Escape a command argument to prevent injection
   */
  private escapeArg(arg: string): string {
    // Remove potential command injection characters
    return arg
      .replace(/[;&|`$(){}[\]\\]/g, '')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');
  }

  /**
   * Parse JSON output from bd command
   */
  private parseOutput<T>(stdout: string): T {
    try {
      return JSON.parse(stdout.trim()) as T;
    } catch (error) {
      throw new BeadsError(
        `Failed to parse bd output: ${error instanceof Error ? error.message : 'Unknown error'}`,
        BeadsErrorCodes.PARSE_ERROR,
        { stdout }
      );
    }
  }

  /**
   * Handle command execution errors
   */
  private handleError<T>(error: unknown): BeadsCommandResult<T> {
    const errorObj = error as Error & { code?: number };
    const message = errorObj.message || 'Unknown error';
    const exitCode = errorObj.code ?? 1;

    return {
      success: false,
      error: message,
      exitCode,
    } as BeadsCommandResult<T>;
  }
}

/**
 * Export types for external use (re-exported from types.ts)
 */
export type {
  BeadsConfig,
  BeadsIssue,
  BeadsCreateParams,
  BeadsListParams,
  BeadsReadyParams,
  BeadsShowParams,
  BeadsUpdateParams,
  BeadsCloseParams,
  BeadsDepAddParams,
  BeadsDepTreeParams,
  BeadsBlockedParams,
  BeadsStats,
  BeadsCommandResult,
};

/**
 * Export a result type for convenience
 */
export type BeadsResult<T = unknown> = BeadsCommandResult<T>;

/**
 * Create a default wrapper instance
 */
export function createBeadsWrapper(config?: Partial<BeadsConfig>): BeadsCliWrapper {
  return new BeadsCliWrapper(config);
}
