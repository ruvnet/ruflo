/**
 * Legacy Data Bridge - Migration utilities for AgentDB integration
 * Provides safe migration from legacy memory stores to AgentDB
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export class LegacyDataBridge {
  constructor(options = {}) {
    this.backupDir = options.backupDir || '.agentdb/backups';
    this.verbose = options.verbose || false;
  }

  /**
   * Migrate all data from legacy store to AgentDB
   * @param {Object} sourceStore - Legacy memory store (EnhancedMemory)
   * @param {Object} targetAdapter - AgentDB adapter
   * @param {Object} options - Migration options
   * @returns {Promise<Object>} Migration results
   */
  async migrateToAgentDB(sourceStore, targetAdapter, options = {}) {
    const startTime = Date.now();
    const results = {
      success: false,
      migrated: 0,
      errors: 0,
      skipped: 0,
      backupPath: null,
      duration: 0,
    };

    try {
      // Step 1: Create backup
      this._log('Creating backup of legacy data...');
      const backupPath = await this.createBackup(sourceStore);
      results.backupPath = backupPath;
      this._log(`Backup created at: ${backupPath}`);

      // Step 2: Export all legacy data
      this._log('Exporting legacy data...');
      const legacyData = await sourceStore.exportData();

      // Step 3: Migrate each namespace
      for (const [namespace, items] of Object.entries(legacyData)) {
        this._log(`Migrating namespace: ${namespace} (${items.length} items)`);

        for (const item of items) {
          try {
            // Check if item should be migrated with embedding
            const shouldEmbed = this._shouldEmbed(item, namespace, options);

            if (shouldEmbed && options.generateEmbedding) {
              // Generate embedding and store with vector
              const embedding = await options.generateEmbedding(item.value);

              await targetAdapter.storeWithEmbedding(item.key, item.value, {
                embedding,
                metadata: item.metadata,
                namespace,
                ttl: item.ttl,
              });
            } else {
              // Store without embedding (legacy compatibility)
              await targetAdapter.store(item.key, item.value, {
                metadata: item.metadata,
                namespace,
                ttl: item.ttl,
              });
            }

            results.migrated++;
          } catch (error) {
            results.errors++;
            this._log(`Error migrating ${item.key}: ${error.message}`, 'error');

            if (options.stopOnError) {
              throw error;
            }
          }
        }
      }

      // Step 4: Validate migration
      this._log('Validating migration...');
      const validation = await this.validateMigration(sourceStore, targetAdapter);

      if (!validation.isValid && options.strictValidation) {
        throw new Error(`Migration validation failed: ${validation.errors.join(', ')}`);
      }

      results.success = true;
      results.duration = Date.now() - startTime;

      this._log(`Migration completed in ${results.duration}ms`);
      this._log(`Migrated: ${results.migrated}, Errors: ${results.errors}, Skipped: ${results.skipped}`);

      return results;
    } catch (error) {
      results.success = false;
      results.duration = Date.now() - startTime;
      results.error = error.message;

      this._log(`Migration failed: ${error.message}`, 'error');
      return results;
    }
  }

  /**
   * Validate migration integrity
   * @param {Object} sourceStore - Source legacy store
   * @param {Object} targetAdapter - Target AgentDB adapter
   * @returns {Promise<Object>} Validation results
   */
  async validateMigration(sourceStore, targetAdapter) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      stats: {
        sourceCount: 0,
        targetCount: 0,
        matched: 0,
        mismatched: 0,
      },
    };

    try {
      // Export both stores
      const sourceData = await sourceStore.exportData();
      const targetData = await targetAdapter.exportData();

      // Count total items
      for (const items of Object.values(sourceData)) {
        validation.stats.sourceCount += items.length;
      }

      for (const items of Object.values(targetData)) {
        validation.stats.targetCount += items.length;
      }

      // Validate each namespace
      for (const [namespace, sourceItems] of Object.entries(sourceData)) {
        const targetItems = targetData[namespace] || [];
        const targetKeys = new Set(targetItems.map(item => item.key));

        for (const sourceItem of sourceItems) {
          if (targetKeys.has(sourceItem.key)) {
            // Find matching item
            const targetItem = targetItems.find(item => item.key === sourceItem.key);

            // Deep compare values
            if (JSON.stringify(sourceItem.value) === JSON.stringify(targetItem.value)) {
              validation.stats.matched++;
            } else {
              validation.stats.mismatched++;
              validation.warnings.push(
                `Value mismatch for key: ${sourceItem.key} in namespace: ${namespace}`,
              );
            }
          } else {
            validation.errors.push(`Missing key in target: ${sourceItem.key} in namespace: ${namespace}`);
            validation.isValid = false;
          }
        }
      }

      // Check for count discrepancies
      if (validation.stats.sourceCount !== validation.stats.targetCount) {
        validation.warnings.push(
          `Count mismatch: source=${validation.stats.sourceCount}, target=${validation.stats.targetCount}`,
        );
      }

      return validation;
    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`Validation error: ${error.message}`);
      return validation;
    }
  }

  /**
   * Rollback migration from backup
   * @param {string} backupPath - Path to backup file
   * @param {Object} targetStore - Store to restore to
   * @returns {Promise<Object>} Rollback results
   */
  async rollback(backupPath, targetStore) {
    const startTime = Date.now();
    const results = {
      success: false,
      restored: 0,
      errors: 0,
      duration: 0,
    };

    try {
      // Check if backup exists
      if (!existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      // Read backup
      this._log(`Reading backup from: ${backupPath}`);
      const backupData = JSON.parse(readFileSync(backupPath, 'utf-8'));

      // Restore data
      this._log('Restoring data from backup...');
      await targetStore.importData(backupData);

      results.success = true;
      results.duration = Date.now() - startTime;

      this._log(`Rollback completed in ${results.duration}ms`);
      return results;
    } catch (error) {
      results.success = false;
      results.duration = Date.now() - startTime;
      results.error = error.message;

      this._log(`Rollback failed: ${error.message}`, 'error');
      return results;
    }
  }

  /**
   * Create backup of current data
   * @param {Object} sourceStore - Store to backup
   * @returns {Promise<string>} Backup file path
   */
  async createBackup(sourceStore) {
    try {
      // Ensure backup directory exists
      const fs = await import('fs');
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      // Export data
      const data = await sourceStore.exportData();

      // Create backup file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(this.backupDir, `backup-${timestamp}.json`);

      // Write backup
      writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf-8');

      return backupPath;
    } catch (error) {
      throw new Error(`Backup creation failed: ${error.message}`);
    }
  }

  /**
   * Determine if item should have embedding
   * @private
   */
  _shouldEmbed(item, namespace, options) {
    // Skip embedding for certain namespaces
    const skipNamespaces = options.skipEmbedding || ['metrics', 'performance', 'coordination'];

    if (skipNamespaces.includes(namespace)) {
      return false;
    }

    // Skip if value is not suitable for embedding
    if (typeof item.value !== 'object' && typeof item.value !== 'string') {
      return false;
    }

    // Embed knowledge, learning, and sessions by default
    const embedNamespaces = options.embedNamespaces || ['knowledge', 'learning', 'sessions', 'workflows'];

    return embedNamespaces.includes(namespace);
  }

  /**
   * Log message
   * @private
   */
  _log(message, level = 'info') {
    if (!this.verbose && level !== 'error') {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = level === 'error' ? 'ERROR' : 'INFO';

    console.error(`[${timestamp}] ${prefix} [legacy-bridge] ${message}`);
  }

  /**
   * Generate migration report
   * @param {Object} results - Migration results
   * @returns {string} Formatted report
   */
  generateReport(results) {
    const lines = [];

    lines.push('='.repeat(60));
    lines.push('AgentDB Migration Report');
    lines.push('='.repeat(60));
    lines.push('');
    lines.push(`Status: ${results.success ? 'SUCCESS' : 'FAILED'}`);
    lines.push(`Duration: ${results.duration}ms`);
    lines.push('');
    lines.push('Statistics:');
    lines.push(`  Migrated: ${results.migrated}`);
    lines.push(`  Errors: ${results.errors}`);
    lines.push(`  Skipped: ${results.skipped}`);

    if (results.backupPath) {
      lines.push('');
      lines.push(`Backup Location: ${results.backupPath}`);
    }

    if (results.error) {
      lines.push('');
      lines.push(`Error: ${results.error}`);
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
  }
}

export default LegacyDataBridge;
