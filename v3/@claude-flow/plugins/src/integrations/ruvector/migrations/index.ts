/**
 * RuVector PostgreSQL Bridge - Migrations Module
 *
 * Exports migration manager and utilities for database schema management.
 *
 * @module @claude-flow/plugins/integrations/ruvector/migrations
 */

export {
  MigrationManager,
  createMigrationManager,
  runMigrationsFromCLI,
} from './migrations.js';

export type {
  MigrationFile,
  AppliedMigration,
  MigrationResult,
  MigrationManagerOptions,
  DatabaseClient,
  Logger,
} from './migrations.js';

// Migration file list (in order)
export const MIGRATION_FILES = [
  '001_create_extension.sql',
  '002_create_vector_tables.sql',
  '003_create_indices.sql',
  '004_create_functions.sql',
  '005_create_attention_functions.sql',
  '006_create_gnn_functions.sql',
  '007_create_hyperbolic_functions.sql',
] as const;

export type MigrationName = typeof MIGRATION_FILES[number];
