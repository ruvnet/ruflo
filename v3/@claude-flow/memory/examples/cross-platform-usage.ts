/**
 * Cross-Platform Database Usage Examples
 *
 * Demonstrates how to use the database provider for Windows, macOS, and Linux
 */

import {
  createDatabase,
  getPlatformInfo,
  getAvailableProviders,
  createDefaultEntry,
} from '../src/index.js';

/**
 * Example 1: Automatic Platform Detection
 */
async function automaticProviderSelection() {
  console.log('=== Automatic Provider Selection ===\n');

  // Get platform information
  const platformInfo = getPlatformInfo();
  console.log('Platform Information:');
  console.log(`  OS: ${platformInfo.os}`);
  console.log(`  Windows: ${platformInfo.isWindows}`);
  console.log(`  macOS: ${platformInfo.isMacOS}`);
  console.log(`  Linux: ${platformInfo.isLinux}`);
  console.log(`  Recommended: ${platformInfo.recommendedProvider}\n`);

  // Check available providers
  const available = await getAvailableProviders();
  console.log('Available Providers:');
  console.log(`  better-sqlite3: ${available.betterSqlite3 ? '✓' : '✗'}`);
  console.log(`  sql.js: ${available.sqlJs ? '✓' : '✗'}`);
  console.log(`  JSON: ${available.json ? '✓' : '✗'}\n`);

  // Create database with automatic provider selection
  const db = await createDatabase('./data/auto-memory.db');
  console.log('✓ Database created with automatic provider selection\n');

  // Store some test data
  const entry = createDefaultEntry({
    key: 'platform-test',
    content: `Running on ${platformInfo.os}`,
    namespace: 'platform',
    tags: [platformInfo.os],
  });

  await db.store(entry);
  console.log('✓ Test entry stored');

  // Retrieve and verify
  const retrieved = await db.get(entry.id);
  console.log('✓ Entry retrieved:', retrieved?.content);

  await db.shutdown();
  console.log('✓ Database shutdown\n');
}

/**
 * Example 2: Windows-Specific Configuration
 */
async function windowsConfiguration() {
  console.log('=== Windows-Specific Configuration ===\n');

  // On Windows, use sql.js for maximum compatibility
  const db = await createDatabase('./data/windows-memory.db', {
    provider: 'sql.js',
    verbose: true,
    autoPersistInterval: 10000, // Persist every 10 seconds
  });

  console.log('✓ Windows-compatible database created\n');

  // Store data
  const entries = [
    createDefaultEntry({
      key: 'windows-app-1',
      content: 'Windows application data',
      namespace: 'apps',
      tags: ['windows', 'production'],
    }),
    createDefaultEntry({
      key: 'windows-app-2',
      content: 'More Windows data',
      namespace: 'apps',
      tags: ['windows', 'staging'],
    }),
  ];

  await db.bulkInsert(entries);
  console.log('✓ Bulk inserted 2 entries');

  // Query by namespace
  const results = await db.query({
    type: 'hybrid',
    namespace: 'apps',
    limit: 10,
  });

  console.log(`✓ Found ${results.length} entries in 'apps' namespace`);

  await db.shutdown();
  console.log('✓ Database shutdown (changes persisted to disk)\n');
}

/**
 * Example 3: macOS/Linux Native SQLite
 */
async function unixConfiguration() {
  console.log('=== macOS/Linux Native SQLite ===\n');

  // On Unix systems, use better-sqlite3 for best performance
  const available = await getAvailableProviders();

  if (!available.betterSqlite3) {
    console.log('⚠ better-sqlite3 not available, falling back to sql.js\n');
  }

  const db = await createDatabase('./data/unix-memory.db', {
    provider: available.betterSqlite3 ? 'better-sqlite3' : 'sql.js',
    verbose: true,
    walMode: true, // Enable WAL mode for better-sqlite3
    optimize: true,
  });

  console.log('✓ Unix-optimized database created\n');

  // Store data
  const entry = createDefaultEntry({
    key: 'unix-service',
    content: 'Unix service configuration',
    namespace: 'services',
    tags: ['unix', 'production'],
  });

  await db.store(entry);
  console.log('✓ Entry stored');

  // Health check
  const health = await db.healthCheck();
  console.log('✓ Health check:', health.status);
  console.log('  Storage:', health.components.storage.status);
  console.log('  Index:', health.components.index.status);
  console.log('  Cache:', health.components.cache.status);

  await db.shutdown();
  console.log('✓ Database shutdown\n');
}

/**
 * Example 4: Fallback to JSON
 */
async function jsonFallback() {
  console.log('=== JSON Fallback Example ===\n');

  // JSON backend works everywhere, no native dependencies
  const db = await createDatabase('./data/json-memory.db', {
    provider: 'json',
    verbose: true,
  });

  console.log('✓ JSON database created (no native dependencies)\n');

  // Store data
  const entry = createDefaultEntry({
    key: 'json-data',
    content: 'This works everywhere!',
    namespace: 'portable',
    tags: ['cross-platform', 'json'],
  });

  await db.store(entry);
  console.log('✓ Entry stored');

  // Get statistics
  const stats = await db.getStats();
  console.log('✓ Statistics:', {
    totalEntries: stats.totalEntries,
    avgQueryTime: `${stats.avgQueryTime.toFixed(2)}ms`,
  });

  await db.shutdown();
  console.log('✓ Database shutdown\n');
}

/**
 * Example 5: Cross-Platform Application
 */
async function crossPlatformApp() {
  console.log('=== Cross-Platform Application Example ===\n');

  const platformInfo = getPlatformInfo();

  // Use different optimizations based on platform
  const config = platformInfo.isWindows
    ? {
        // Windows: sql.js with frequent persistence
        provider: 'sql.js' as const,
        autoPersistInterval: 5000,
      }
    : {
        // Unix: better-sqlite3 with WAL mode
        provider: 'better-sqlite3' as const,
        walMode: true,
      };

  console.log(`Creating database for ${platformInfo.os}...`);
  const db = await createDatabase('./data/cross-platform.db', config);
  console.log('✓ Platform-optimized database created\n');

  // Store platform-specific configuration
  const configEntry = createDefaultEntry({
    key: 'app-config',
    content: JSON.stringify({
      platform: platformInfo.os,
      optimizations: config,
      timestamp: Date.now(),
    }),
    namespace: 'config',
    tags: ['platform', platformInfo.os],
  });

  await db.store(configEntry);
  console.log('✓ Platform configuration stored');

  // Retrieve and display
  const retrieved = await db.getByKey('config', 'app-config');
  if (retrieved) {
    const data = JSON.parse(retrieved.content);
    console.log('✓ Configuration:', JSON.stringify(data, null, 2));
  }

  await db.shutdown();
  console.log('✓ Database shutdown\n');
}

/**
 * Example 6: Migration Between Providers
 */
async function providerMigration() {
  console.log('=== Provider Migration Example ===\n');

  // Create source database (JSON)
  console.log('Creating source database (JSON)...');
  const sourceDb = await createDatabase('./data/source.db', {
    provider: 'json',
  });

  // Add test data
  const testData = Array.from({ length: 5 }, (_, i) =>
    createDefaultEntry({
      key: `migrate-${i}`,
      content: `Migration test data ${i}`,
      namespace: 'migration',
      tags: ['test', 'migration'],
    })
  );

  await sourceDb.bulkInsert(testData);
  console.log('✓ Source database populated with 5 entries');

  // Get all entries from source
  const sourceEntries = await sourceDb.query({
    type: 'hybrid',
    namespace: 'migration',
    limit: 100,
  });

  await sourceDb.shutdown();
  console.log('✓ Source database shutdown\n');

  // Create destination database (best available provider)
  console.log('Creating destination database (auto provider)...');
  const destDb = await createDatabase('./data/destination.db');

  // Migrate data
  await destDb.bulkInsert(sourceEntries);
  console.log(`✓ Migrated ${sourceEntries.length} entries to destination`);

  // Verify migration
  const count = await destDb.count('migration');
  console.log(`✓ Verified: ${count} entries in destination database`);

  await destDb.shutdown();
  console.log('✓ Destination database shutdown\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  Cross-Platform Database Examples     ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Run all examples
    await automaticProviderSelection();
    await windowsConfiguration();
    await unixConfiguration();
    await jsonFallback();
    await crossPlatformApp();
    await providerMigration();

    console.log('╔════════════════════════════════════════╗');
    console.log('║  All examples completed successfully! ║');
    console.log('╚════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  automaticProviderSelection,
  windowsConfiguration,
  unixConfiguration,
  jsonFallback,
  crossPlatformApp,
  providerMigration,
};
