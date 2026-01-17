/**
 * Delete Memory Command - Application Layer (CQRS)
 *
 * Command for deleting memory entries.
 * Supports soft delete and hard delete.
 *
 * @module v3/memory/application/commands
 */

import { IMemoryRepository } from '../../domain/repositories/memory-repository.interface.js';

/**
 * Delete Memory Command Input
 */
export interface DeleteMemoryInput {
  id?: string;
  namespace?: string;
  key?: string;
  hardDelete?: boolean;
}

/**
 * Delete Memory Command Result
 */
export interface DeleteMemoryResult {
  success: boolean;
  deleted: boolean;
  entryId?: string;
  wasHardDelete: boolean;
}

/**
 * Delete Memory Command Handler
 */
export class DeleteMemoryCommandHandler {
  constructor(private readonly repository: IMemoryRepository) {}

  async execute(input: DeleteMemoryInput): Promise<DeleteMemoryResult> {
    let entryId: string | undefined;

    // Find entry by ID or by namespace:key
    if (input.id) {
      entryId = input.id;
    } else if (input.namespace && input.key) {
      const entry = await this.repository.findByKey(input.namespace, input.key);
      entryId = entry?.id;
    }

    if (!entryId) {
      return {
        success: false,
        deleted: false,
        wasHardDelete: false,
      };
    }

    if (input.hardDelete) {
      // Hard delete - remove from database
      const deleted = await this.repository.delete(entryId);
      return {
        success: true,
        deleted,
        entryId,
        wasHardDelete: true,
      };
    } else {
      // Soft delete - mark as deleted
      const entry = await this.repository.findById(entryId);
      if (entry) {
        entry.delete();
        await this.repository.save(entry);
        return {
          success: true,
          deleted: true,
          entryId,
          wasHardDelete: false,
        };
      }
    }

    return {
      success: false,
      deleted: false,
      entryId,
      wasHardDelete: false,
    };
  }
}

/**
 * Bulk Delete Command Input
 */
export interface BulkDeleteMemoryInput {
  ids?: string[];
  namespace?: string;
  olderThan?: Date;
  hardDelete?: boolean;
}

/**
 * Bulk Delete Command Result
 */
export interface BulkDeleteMemoryResult {
  success: boolean;
  deletedCount: number;
  failedCount: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Bulk Delete Memory Command Handler
 */
export class BulkDeleteMemoryCommandHandler {
  constructor(private readonly repository: IMemoryRepository) {}

  async execute(input: BulkDeleteMemoryInput): Promise<BulkDeleteMemoryResult> {
    let idsToDelete: string[] = [];

    if (input.ids) {
      idsToDelete = input.ids;
    } else if (input.namespace) {
      const entries = await this.repository.findByNamespace(input.namespace);
      idsToDelete = entries
        .filter((e) => !input.olderThan || e.createdAt < input.olderThan)
        .map((e) => e.id);
    }

    if (idsToDelete.length === 0) {
      return {
        success: true,
        deletedCount: 0,
        failedCount: 0,
        errors: [],
      };
    }

    if (input.hardDelete) {
      const result = await this.repository.deleteMany(idsToDelete);
      return {
        success: result.failed === 0,
        deletedCount: result.success,
        failedCount: result.failed,
        errors: result.errors,
      };
    } else {
      // Soft delete
      const entries = await this.repository.findByIds(idsToDelete);
      let deletedCount = 0;
      const errors: Array<{ id: string; error: string }> = [];

      for (const entry of entries) {
        try {
          entry.delete();
          await this.repository.save(entry);
          deletedCount++;
        } catch (error) {
          errors.push({
            id: entry.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      return {
        success: errors.length === 0,
        deletedCount,
        failedCount: errors.length,
        errors,
      };
    }
  }
}
