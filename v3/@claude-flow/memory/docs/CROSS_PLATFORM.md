# Cross-Platform Database Support

## Overview

The `@claude-flow/memory` module provides **universal cross-platform support** through intelligent database provider selection. This ensures your application works seamlessly on Windows, macOS, and Linux without code changes.

## Architecture

```
┌─────────────────────────────────────────┐
│      createDatabase() Factory           │
│    Platform-Aware Auto-Selection        │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│   Windows   │  │ macOS/Linux │
│   Detected  │  │   Detected  │
└──────┬──────┘  └──────┬──────┘
       │                │
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│   sql.js    │  │better-sqlite│
│  (WASM)     │  │  (Native)   │
└──────┬──────┘  └──────┬──────┘
       │                │
       └────────┬────────┘
                │
                ▼
         ┌─────────────┐
         │JSON Fallback│
         │ (Universal) │
         └─────────────┘
```

## Supported Providers

### 1. better-sqlite3 (Native SQLite)

**Best for:** macOS, Linux
**Performance:** Fastest (native C++ bindings)
**Features:**
- WAL mode for concurrent reads
- ACID transactions
- Optimal performance
- Native compilation required

```typescript
const db = await createDatabase('./data/memory.db', {
  provider: 'better-sqlite3',
  walMode: true,
  optimize: true
});
```

### 2. sql.js (WASM SQLite)

**Best for:** Windows, environments without native compilation
**Performance:** Good (WebAssembly)
**Features:**
- Pure JavaScript/WASM (no native compilation)
- Works everywhere
- Auto-persistence to disk
- Slightly slower than native

```typescript
const db = await createDatabase('./data/memory.db', {
  provider: 'sql.js',
  autoPersistInterval: 5000  // Persist every 5 seconds
});
```

### 3. JSON (Simple File Storage)

**Best for:** Maximum compatibility, small datasets
**Performance:** Slower (brute-force search)
**Features:**
- Zero dependencies
- Human-readable storage
- Works on all platforms
- Limited scalability

```typescript
const db = await createDatabase('./data/memory.db', {
  provider: 'json'
});
```

## Platform-Specific Recommendations

### Windows

```typescript
// Recommended: sql.js (no native compilation issues)
const db = await createDatabase('./data/memory.db', {
  provider: 'sql.js',
  autoPersistInterval: 10000,  // Auto-save every 10s
  verbose: true
});
```

**Why sql.js on Windows?**
- No Visual Studio build tools required
- No Python dependency for node-gyp
- Pure JavaScript/WASM stack
- Reliable across Windows versions

### macOS

```typescript
// Recommended: better-sqlite3 (native performance)
const db = await createDatabase('./data/memory.db', {
  provider: 'better-sqlite3',
  walMode: true,    // Enable WAL mode
  optimize: true    // Performance optimizations
});
```

**Why better-sqlite3 on macOS?**
- Native compilation works reliably
- Maximum performance
- WAL mode for concurrent access
- Apple's SQLite optimizations

### Linux

```typescript
// Recommended: better-sqlite3 (native performance)
const db = await createDatabase('./data/memory.db', {
  provider: 'better-sqlite3',
  walMode: true,
  optimize: true
});
```

**Why better-sqlite3 on Linux?**
- Native SQLite library widely available
- Excellent performance
- Production-ready
- Standard on most distributions

## Automatic Provider Selection

The `createDatabase()` function uses intelligent platform detection:

```typescript
// Auto-select best provider for current platform
const db = await createDatabase('./data/memory.db');
```

**Selection Algorithm:**

1. **Detect platform** (Windows, macOS, Linux)
2. **Try recommended provider** for platform
3. **Test provider availability** (compilation check)
4. **Fallback to alternatives** if needed
5. **Final fallback** to JSON if all fail

```typescript
// Example: Auto-selection with fallback chain
Windows:  sql.js → JSON
macOS:    better-sqlite3 → sql.js → JSON
Linux:    better-sqlite3 → sql.js → JSON
```

## Usage Examples

### Example 1: Cross-Platform Application

```typescript
import { createDatabase, getPlatformInfo } from '@claude-flow/memory';

async function initDatabase() {
  const platform = getPlatformInfo();
  console.log(`Running on ${platform.os}`);
  console.log(`Recommended: ${platform.recommendedProvider}`);

  // Auto-select best provider
  const db = await createDatabase('./data/app.db', {
    verbose: true
  });

  return db;
}
```

### Example 2: Windows-Specific Setup

```typescript
import { createDatabase } from '@claude-flow/memory';

async function windowsSetup() {
  // Force sql.js for Windows reliability
  const db = await createDatabase('./data/windows.db', {
    provider: 'sql.js',
    autoPersistInterval: 5000,
    verbose: true
  });

  // Store data
  await db.store({
    id: 'config-1',
    key: 'app-config',
    content: JSON.stringify({ theme: 'dark' }),
    // ... other fields
  });

  // Changes auto-persist every 5 seconds
  // Or manually trigger:
  await db.persist();

  return db;
}
```

### Example 3: Unix Performance Optimization

```typescript
import { createDatabase, getAvailableProviders } from '@claude-flow/memory';

async function unixSetup() {
  const available = await getAvailableProviders();

  if (available.betterSqlite3) {
    // Use native SQLite with optimizations
    const db = await createDatabase('./data/unix.db', {
      provider: 'better-sqlite3',
      walMode: true,        // Concurrent reads
      optimize: true,       // Performance tuning
      maxEntries: 1000000   // Large dataset support
    });

    return db;
  } else {
    // Fallback to sql.js
    const db = await createDatabase('./data/unix.db', {
      provider: 'sql.js'
    });

    return db;
  }
}
```

### Example 4: Migration Between Providers

```typescript
import { createDatabase } from '@claude-flow/memory';

async function migrateDatabase() {
  // Load from JSON
  const sourceDb = await createDatabase('./old/data.db', {
    provider: 'json'
  });

  const entries = await sourceDb.query({
    type: 'hybrid',
    limit: 10000
  });

  await sourceDb.shutdown();

  // Migrate to SQLite
  const destDb = await createDatabase('./new/data.db', {
    provider: 'auto'  // Auto-select best for platform
  });

  await destDb.bulkInsert(entries);
  console.log(`Migrated ${entries.length} entries`);

  await destDb.shutdown();
}
```

## API Reference

### createDatabase()

```typescript
async function createDatabase(
  path: string,
  options?: DatabaseOptions
): Promise<IMemoryBackend>
```

**Parameters:**
- `path` - Database file path (`:memory:` for in-memory)
- `options.provider` - Provider type (`'auto'`, `'better-sqlite3'`, `'sql.js'`, `'json'`)
- `options.verbose` - Enable logging
- `options.walMode` - Enable WAL mode (better-sqlite3 only)
- `options.optimize` - Enable optimizations
- `options.autoPersistInterval` - Auto-save interval in ms (sql.js only)
- `options.wasmPath` - Custom WASM file path (sql.js only)

**Returns:** Initialized `IMemoryBackend` instance

### getPlatformInfo()

```typescript
function getPlatformInfo(): PlatformInfo
```

**Returns:**
```typescript
{
  os: string;                        // 'win32', 'darwin', 'linux'
  isWindows: boolean;
  isMacOS: boolean;
  isLinux: boolean;
  recommendedProvider: DatabaseProvider;
}
```

### getAvailableProviders()

```typescript
async function getAvailableProviders(): Promise<{
  betterSqlite3: boolean;
  sqlJs: boolean;
  json: boolean;
}>
```

**Returns:** Which providers are available and working

## Performance Comparison

| Provider | Read Speed | Write Speed | Memory | Compilation |
|----------|------------|-------------|--------|-------------|
| better-sqlite3 | ⚡⚡⚡⚡⚡ | ⚡⚡⚡⚡⚡ | Low | Required |
| sql.js | ⚡⚡⚡⚡ | ⚡⚡⚡⚡ | Medium | None |
| JSON | ⚡⚡ | ⚡⚡ | Low | None |

## Installation

### All Platforms

```bash
npm install @claude-flow/memory
```

Dependencies are installed automatically:
- `better-sqlite3` (tries to compile, fails gracefully)
- `sql.js` (pure JavaScript, always works)

### Windows-Specific

If you encounter compilation errors with `better-sqlite3`:

```bash
# Skip better-sqlite3 compilation
npm install @claude-flow/memory --no-optional

# The module will automatically use sql.js
```

### Linux-Specific

Install SQLite development headers:

```bash
# Debian/Ubuntu
sudo apt-get install libsqlite3-dev

# RHEL/Fedora
sudo yum install sqlite-devel

# Then install
npm install @claude-flow/memory
```

## Troubleshooting

### Windows: better-sqlite3 Compilation Fails

**Problem:** `node-gyp` errors, missing Visual Studio

**Solution:** Use sql.js provider (automatic fallback)

```typescript
const db = await createDatabase('./data/memory.db', {
  provider: 'sql.js'
});
```

### macOS: Code Signing Issues

**Problem:** "cannot be opened because the developer cannot be verified"

**Solution:** Allow native module in System Preferences or use sql.js

```bash
# Allow native module
xattr -d com.apple.quarantine node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

### Linux: Missing SQLite Headers

**Problem:** `sqlite3.h not found`

**Solution:** Install development headers

```bash
sudo apt-get install libsqlite3-dev
```

## Best Practices

### 1. Use Auto-Selection in Production

```typescript
// Let the library choose the best provider
const db = await createDatabase('./data/memory.db');
```

### 2. Persist Regularly on Windows

```typescript
// sql.js is in-memory, persist frequently
const db = await createDatabase('./data/memory.db', {
  provider: 'sql.js',
  autoPersistInterval: 5000  // 5 seconds
});
```

### 3. Enable WAL Mode on Unix

```typescript
// Better concurrency on macOS/Linux
const db = await createDatabase('./data/memory.db', {
  provider: 'better-sqlite3',
  walMode: true
});
```

### 4. Check Health Regularly

```typescript
const health = await db.healthCheck();
if (health.status !== 'healthy') {
  console.warn('Database issues:', health.issues);
  console.log('Recommendations:', health.recommendations);
}
```

### 5. Handle Shutdown Gracefully

```typescript
// Always shutdown to persist changes
process.on('SIGINT', async () => {
  await db.shutdown();
  process.exit(0);
});
```

## Environment Variables

```bash
# Force specific provider
CLAUDE_FLOW_DB_PROVIDER=sql.js

# Enable verbose logging
CLAUDE_FLOW_DB_VERBOSE=true

# Set auto-persist interval (ms)
CLAUDE_FLOW_DB_PERSIST_INTERVAL=10000
```

## Docker Support

```dockerfile
FROM node:20-alpine

# Install SQLite for better-sqlite3 (optional)
RUN apk add --no-cache sqlite-dev python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm install

# Will use better-sqlite3 if compilation succeeds,
# otherwise falls back to sql.js automatically
```

## Testing

Run cross-platform tests:

```bash
# Run all tests
npm test

# Test specific provider
npm test -- --grep "sql.js"
npm test -- --grep "better-sqlite3"

# Test on current platform
npm test -- src/database-provider.test.ts
```

## License

MIT
