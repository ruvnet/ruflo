/**
 * Beads Memory Link
 * Links Claude-Flow memory entries to Beads issues for traceability
 *
 * This module provides bidirectional linking between:
 * - Learned patterns stored in Claude-Flow memory
 * - Beads issues tracking work items
 *
 * @see https://github.com/steveyegge/beads
 */

import type { BeadsCliWrapper } from './cli-wrapper.js';
import type { BeadsMemoryLink as BeadsMemoryLinkType, BeadsHookContext } from './types.js';

/**
 * Memory store interface for storing and querying links
 */
export interface MemoryStore {
  store(params: { namespace: string; key: string; value: unknown }): Promise<void>;
  retrieve(key: string): Promise<unknown>;
  query(params: { filter: Record<string, unknown> }): Promise<Array<{ key: string; value: unknown }>>;
  update(key: string, value: unknown): Promise<void>;
}

/**
 * Pattern interface for memory entries
 */
export interface Pattern {
  id: string;
  data: unknown;
  metadata: Record<string, unknown>;
}

/**
 * Link type for memory-to-issue relationships
 */
export type LinkType = 'learned-from' | 'referenced' | 'auto';

/**
 * Full link data structure
 */
interface LinkData {
  memory_key: string;
  issue_id: string;
  link_type: LinkType;
  linked_at: string;
  session_id?: string;
  deleted?: boolean;
}

/**
 * BeadsMemoryLink manages bidirectional links between
 * Claude-Flow memory entries and Beads issues
 */
export class BeadsMemoryLink {
  private memoryStore: MemoryStore;
  private beadsWrapper: BeadsCliWrapper;
  private readonly namespace = 'beads/links';

  constructor(memoryStore: MemoryStore, beadsWrapper: BeadsCliWrapper) {
    this.memoryStore = memoryStore;
    this.beadsWrapper = beadsWrapper;
  }

  /**
   * Create a link between a memory entry and a Beads issue
   *
   * @param memoryKey - The key identifying the memory entry
   * @param issueId - The Beads issue ID (e.g., "bd-a1b2")
   * @param linkType - Type of link relationship (default: 'auto')
   */
  async linkMemory(
    memoryKey: string,
    issueId: string,
    linkType: LinkType = 'auto'
  ): Promise<void> {
    const linkData: LinkData = {
      memory_key: memoryKey,
      issue_id: issueId,
      link_type: linkType,
      linked_at: new Date().toISOString(),
    };

    // Generate unique link key
    const linkKey = `link-${memoryKey}-${issueId}-${Date.now()}`;

    // Store the link in memory
    await this.memoryStore.store({
      namespace: this.namespace,
      key: linkKey,
      value: linkData,
    });

    // Update the Beads issue with a note about the linked memory
    await this.beadsWrapper.update({
      id: issueId,
      notes: `Linked memory: ${memoryKey} (${linkType})`,
    });
  }

  /**
   * Query memory keys linked to a specific issue
   *
   * @param issueId - The Beads issue ID to query
   * @returns Array of linked memory keys
   */
  async queryByIssue(issueId: string): Promise<string[]> {
    const results = await this.memoryStore.query({
      filter: {
        namespace: this.namespace,
        issue_id: issueId,
      },
    });

    return results
      .map((r) => (r.value as LinkData)?.memory_key)
      .filter((key): key is string => key != null);
  }

  /**
   * Query issue IDs linked to a specific memory key
   *
   * @param memoryKey - The memory key to query
   * @returns Array of linked issue IDs
   */
  async queryByMemory(memoryKey: string): Promise<string[]> {
    const results = await this.memoryStore.query({
      filter: {
        namespace: this.namespace,
        memory_key: memoryKey,
      },
    });

    return results
      .map((r) => (r.value as LinkData)?.issue_id)
      .filter((id): id is string => id != null);
  }

  /**
   * Automatically link a pattern to the active issue in context
   *
   * @param pattern - The pattern to potentially link
   * @param context - Hook context containing active issue info
   * @returns The pattern with updated metadata if linked
   */
  async autoLink(pattern: Pattern, context: BeadsHookContext): Promise<Pattern> {
    if (!context.active_issue) {
      return pattern;
    }

    const linkData: LinkData = {
      memory_key: pattern.id,
      issue_id: context.active_issue,
      link_type: 'auto',
      linked_at: new Date().toISOString(),
    };

    if (context.session_id) {
      linkData.session_id = context.session_id;
    }

    const linkKey = `link-${pattern.id}-${context.active_issue}-${Date.now()}`;

    await this.memoryStore.store({
      namespace: this.namespace,
      key: linkKey,
      value: linkData,
    });

    // Return new pattern with updated metadata
    return {
      ...pattern,
      metadata: {
        ...pattern.metadata,
        beads_issue: context.active_issue,
      },
    };
  }

  /**
   * Remove a link between memory and issue
   *
   * @param memoryKey - The memory key
   * @param issueId - The issue ID
   */
  async unlinkMemory(memoryKey: string, issueId: string): Promise<void> {
    const results = await this.memoryStore.query({
      filter: {
        namespace: this.namespace,
        memory_key: memoryKey,
        issue_id: issueId,
      },
    });

    for (const result of results) {
      await this.memoryStore.update(result.key, {
        ...(result.value as LinkData),
        deleted: true,
      });
    }
  }

  /**
   * Get full link objects for an issue
   *
   * @param issueId - The Beads issue ID
   * @returns Array of full link data objects
   */
  async getLinksForIssue(issueId: string): Promise<BeadsMemoryLinkType[]> {
    const results = await this.memoryStore.query({
      filter: {
        namespace: this.namespace,
        issue_id: issueId,
      },
    });

    return results
      .map((r) => r.value as LinkData)
      .filter((link) => !link.deleted)
      .map((link) => ({
        memory_key: link.memory_key,
        issue_id: link.issue_id,
        linked_at: link.linked_at,
        link_type: link.link_type,
      }));
  }

  /**
   * Bulk link multiple memory keys to a single issue
   *
   * @param memoryKeys - Array of memory keys to link
   * @param issueId - The target issue ID
   * @param linkType - Type of link relationship (default: 'auto')
   */
  async bulkLink(
    memoryKeys: string[],
    issueId: string,
    linkType: LinkType = 'auto'
  ): Promise<void> {
    // Store all links
    for (const memoryKey of memoryKeys) {
      const linkData: LinkData = {
        memory_key: memoryKey,
        issue_id: issueId,
        link_type: linkType,
        linked_at: new Date().toISOString(),
      };

      const linkKey = `link-${memoryKey}-${issueId}-${Date.now()}`;

      await this.memoryStore.store({
        namespace: this.namespace,
        key: linkKey,
        value: linkData,
      });
    }

    // Update issue once with all linked patterns
    await this.beadsWrapper.update({
      id: issueId,
      notes: `Linked ${memoryKeys.length} memory entries: ${memoryKeys.join(', ')}`,
    });
  }
}

/**
 * Factory function to create a BeadsMemoryLink instance
 */
export function createBeadsMemoryLink(
  memoryStore: MemoryStore,
  beadsWrapper: BeadsCliWrapper
): BeadsMemoryLink {
  return new BeadsMemoryLink(memoryStore, beadsWrapper);
}
