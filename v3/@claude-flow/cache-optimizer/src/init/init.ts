/**
 * @claude-flow/cache-optimizer - Init System
 *
 * Initializes cache-optimizer with configuration profiles and
 * updates .claude/settings.json with appropriate hooks.
 */

import { mkdir, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import { createSettingsManager, SettingsManager } from './settings-manager.js';
import {
  getProfile,
  listProfiles,
  detectRecommendedProfile,
  mergeWithProfile,
  type ProfileId,
  type Profile,
  type ProfileCacheConfig,
  type ProfileHandoffConfig,
} from './profiles.js';

/**
 * Init options
 */
export interface InitOptions {
  /** Configuration profile to use */
  profile?: ProfileId;
  /** Custom cache config overrides */
  cacheConfig?: ProfileCacheConfig;
  /** Custom handoff config overrides */
  handoffConfig?: ProfileHandoffConfig;
  /** Project root path */
  projectRoot?: string;
  /** Replace existing hooks (vs merge) */
  replace?: boolean;
  /** Skip settings.json update */
  skipHooks?: boolean;
  /** Create data directory */
  createDataDir?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Init result
 */
export interface InitResult {
  success: boolean;
  profile: Profile;
  settingsPath: string;
  settingsUpdated: boolean;
  changes: string[];
  configPath?: string;
  errors: string[];
}

/**
 * Generate README.md content for the cache-optimizer
 */
function generateReadme(profile: Profile): string {
  return `# Cache Optimizer Configuration

This project uses [@claude-flow/cache-optimizer](https://github.com/ruvnet/claude-flow) for intelligent context caching.

## Current Profile: ${profile.name}

${profile.description}

**Best for:** ${profile.recommended.join(', ')}

## Quick Commands

\`\`\`bash
# Check status
npx @claude-flow/cache-optimizer status

# Validate configuration
npx @claude-flow/cache-optimizer validate

# Run diagnostics
npx @claude-flow/cache-optimizer doctor

# Change profile
npx @claude-flow/cache-optimizer init --profile <profile-id>

# Reset configuration
npx @claude-flow/cache-optimizer reset
\`\`\`

## Available Profiles

| Profile | Description | Target Utilization |
|---------|-------------|-------------------|
| \`single-agent\` | Single Claude instance | 80% |
| \`multi-agent\` | Swarm orchestration | 70% |
| \`aggressive\` | Maximum retention | 85% |
| \`conservative\` | Minimal footprint | 60% |
| \`memory-constrained\` | CI/CD, Docker | 50% |
| \`performance\` | Speed-optimized | 75% |
| \`development\` | Debug logging | 75% |
| \`production\` | Stability | 72% |

## Configuration

Configuration is stored in \`.cache-optimizer.json\`.

## Hooks

Cache optimizer hooks are configured in \`.claude/settings.json\`:

- **UserPromptSubmit**: Pre-loads relevant context
- **PostToolUse**: Caches tool results
- **PreCompact**: Prevents context compaction

## Learn More

- [Documentation](https://github.com/ruvnet/claude-flow)
- [ADR-030: Cache Optimizer Architecture](https://github.com/ruvnet/claude-flow/blob/main/docs/ADR-030-cache-optimizer.md)
`;
}

/**
 * Generate capabilities.md content for the cache-optimizer
 */
function generateCapabilities(profile: Profile): string {
  return `# Cache Optimizer Capabilities

## Profile: ${profile.name}

### Core Features

#### Zero-Compaction Strategy
Prevents Claude Code context compaction by proactively managing cache entries.
Uses intelligent pruning to stay below compaction thresholds.

#### RuVector Temporal Compression
- **Hot tier**: Recently accessed entries (${(profile.cacheConfig.temporal?.hotDuration || 300000) / 1000}s)
- **Warm tier**: Moderately recent entries (${(profile.cacheConfig.temporal?.warmDuration || 1800000) / 1000}s)
- **Cold tier**: Older entries for archival (${(profile.cacheConfig.temporal?.coldDuration || 3600000) / 1000}s)

#### Attention-Based Relevance Scoring
Flash Attention algorithm (2.49x-7.47x speedup) scores entries by:
- Recency (time-decay)
- Frequency (access count)
- Type (file_read, tool_result, etc.)
- Tags and metadata

#### Session Isolation
${profile.cacheConfig.sessionIsolation ? '**Enabled** - Each Claude session has isolated storage' : '**Disabled** - Shared storage across sessions'}

### Pruning Configuration

| Setting | Value |
|---------|-------|
| Strategy | ${profile.cacheConfig.pruning?.strategy || 'adaptive'} |
| Soft Threshold | ${((profile.cacheConfig.pruning?.softThreshold || 0.6) * 100).toFixed(0)}% |
| Hard Threshold | ${((profile.cacheConfig.pruning?.hardThreshold || 0.75) * 100).toFixed(0)}% |
| Emergency Threshold | ${((profile.cacheConfig.pruning?.emergencyThreshold || 0.9) * 100).toFixed(0)}% |

### Security Features

- **SSRF Prevention**: Validates all endpoints against allowlists
- **Command Injection Protection**: Sanitizes all shell arguments
- **Path Traversal Protection**: Validates all file paths
- **Header Injection Protection**: Sanitizes HTTP headers

### Multi-Instance Safety

- **Async Mutex**: Queue-based fair scheduling for concurrent access
- **File Locking**: \`.lock\` files with stale detection for multi-process safety
- **Session Partitioning**: Isolated storage per agent/session

### Background Handoff

Delegate expensive operations to other LLMs:

\`\`\`typescript
import { handoff } from '@claude-flow/cache-optimizer';

// Synchronous handoff
const response = await handoff('Analyze this code', {
  provider: 'ollama',
  systemPrompt: 'You are a code analyst',
});

// Background handoff
const handoffId = await handoff('Generate tests', {
  background: true,
  provider: 'anthropic',
});
\`\`\`

### Hooks Integration

This profile configures the following hooks:

${Object.entries(profile.hooks).map(([hookName, entries]) => {
  if (!entries || entries.length === 0) return '';
  return `#### ${hookName}
${entries.map(e => `- \`${e.command}\`\n  ${e.description || ''}`).join('\n')}`;
}).filter(Boolean).join('\n\n')}

### Programmatic API

\`\`\`typescript
import { createCacheOptimizer } from '@claude-flow/cache-optimizer';

const optimizer = createCacheOptimizer({
  targetUtilization: ${profile.cacheConfig.targetUtilization || 0.75},
  pruning: {
    strategy: '${profile.cacheConfig.pruning?.strategy || 'adaptive'}',
  },
});

await optimizer.initialize();

// Add entries
await optimizer.add(content, 'file_read', { filePath: '/path/to/file.ts' });

// Get utilization
const utilization = optimizer.getUtilization();

// Trigger pruning
const decision = await optimizer.getPruningDecision(context);
const result = await optimizer.prune(decision);
\`\`\`

### Performance Metrics

| Metric | Target |
|--------|--------|
| Flash Attention Speedup | 2.49x-7.47x |
| HNSW Search | 150x-12,500x faster |
| Memory Reduction | 50-75% with quantization |
| Hook Response | <5000ms |

### Diagnostics

Run diagnostics with:

\`\`\`bash
# Basic diagnostics
npx @claude-flow/cache-optimizer doctor

# Security-focused diagnostics
npx @claude-flow/cache-optimizer doctor --security

# Full diagnostics with auto-fix
npx @claude-flow/cache-optimizer doctor --full --fix
\`\`\`
`;
}

/**
 * Initialize cache-optimizer in a project
 */
export async function init(options: InitOptions = {}): Promise<InitResult> {
  const {
    profile: profileId = detectRecommendedProfile(),
    cacheConfig,
    projectRoot = process.cwd(),
    replace = false,
    skipHooks = false,
    createDataDir = true,
    verbose = false,
  } = options;

  const errors: string[] = [];
  const changes: string[] = [];

  // Get profile
  let profile: Profile;
  try {
    profile = getProfile(profileId);
    if (verbose) {
      changes.push(`Using profile: ${profile.name}`);
    }
  } catch (error) {
    return {
      success: false,
      profile: getProfile('single-agent'),
      settingsPath: join(projectRoot, '.claude/settings.json'),
      settingsUpdated: false,
      changes: [],
      errors: [`Invalid profile: ${error}`],
    };
  }

  // Create data directory if requested
  if (createDataDir) {
    const dataDir = join(projectRoot, 'data', 'cache-optimizer');
    try {
      await mkdir(dataDir, { recursive: true });
      changes.push(`Created data directory: ${dataDir}`);
    } catch (error) {
      errors.push(`Failed to create data directory: ${error}`);
    }
  }

  // Create docs directory for README and capabilities
  const docsDir = join(projectRoot, 'docs', 'cache-optimizer');
  try {
    await mkdir(docsDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  // Generate README.md
  const readmePath = join(docsDir, 'README.md');
  try {
    await writeFile(readmePath, generateReadme(profile));
    changes.push(`Created README: ${readmePath}`);
  } catch (error) {
    errors.push(`Failed to create README.md: ${error}`);
  }

  // Generate capabilities.md
  const capabilitiesPath = join(docsDir, 'capabilities.md');
  try {
    await writeFile(capabilitiesPath, generateCapabilities(profile));
    changes.push(`Created capabilities: ${capabilitiesPath}`);
  } catch (error) {
    errors.push(`Failed to create capabilities.md: ${error}`);
  }

  // Create config file
  const configPath = join(projectRoot, '.cache-optimizer.json');
  const config = mergeWithProfile(profileId, cacheConfig);
  try {
    await writeFile(configPath, JSON.stringify({
      profile: profileId,
      ...config,
    }, null, 2) + '\n');
    changes.push(`Created config file: ${configPath}`);
  } catch (error) {
    errors.push(`Failed to create config file: ${error}`);
  }

  // Update settings.json if not skipped
  let settingsUpdated = false;
  const settingsManager = createSettingsManager({
    projectRoot,
    merge: !replace,
    backup: true,
  });
  const settingsPath = settingsManager.getPath();

  if (!skipHooks) {
    try {
      const result = await settingsManager.applyProfile(profile);
      settingsUpdated = result.updated;
      changes.push(...result.changes);

      if (settingsUpdated && verbose) {
        changes.push(`Updated settings: ${settingsPath}`);
      }
    } catch (error) {
      errors.push(`Failed to update settings.json: ${error}`);
    }
  } else {
    changes.push('Skipped settings.json update');
  }

  return {
    success: errors.length === 0,
    profile,
    settingsPath,
    settingsUpdated,
    changes,
    configPath,
    errors,
  };
}

/**
 * Interactive profile selection helper
 */
export function getProfileOptions(): Array<{ id: ProfileId; name: string; description: string }> {
  return listProfiles().map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
  }));
}

/**
 * Check if already initialized
 */
export async function isInitialized(projectRoot: string = process.cwd()): Promise<boolean> {
  const configPath = join(projectRoot, '.cache-optimizer.json');
  try {
    await access(configPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get current configuration
 */
export async function getCurrentConfig(
  projectRoot: string = process.cwd()
): Promise<{ profile?: ProfileId; config?: ProfileCacheConfig } | null> {
  const configPath = join(projectRoot, '.cache-optimizer.json');
  try {
    const { readFile } = await import('fs/promises');
    const content = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      profile: parsed.profile,
      config: parsed,
    };
  } catch {
    return null;
  }
}

/**
 * Reset cache-optimizer configuration
 */
export async function reset(projectRoot: string = process.cwd()): Promise<{
  success: boolean;
  removedConfig: boolean;
  removedHooks: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let removedConfig = false;
  let removedHooks = 0;

  // Remove config file
  const configPath = join(projectRoot, '.cache-optimizer.json');
  try {
    const { unlink } = await import('fs/promises');
    await unlink(configPath);
    removedConfig = true;
  } catch (error: unknown) {
    const err = error as { code?: string };
    if (err.code !== 'ENOENT') {
      errors.push(`Failed to remove config: ${error}`);
    }
  }

  // Remove hooks from settings.json
  const settingsManager = createSettingsManager({ projectRoot });
  try {
    const result = await settingsManager.removeHooks();
    removedHooks = result.removed;
  } catch (error) {
    errors.push(`Failed to remove hooks: ${error}`);
  }

  return {
    success: errors.length === 0,
    removedConfig,
    removedHooks,
    errors,
  };
}

/**
 * Validate current initialization
 */
export async function validate(projectRoot: string = process.cwd()): Promise<{
  valid: boolean;
  initialized: boolean;
  profile?: ProfileId;
  settingsValid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if initialized
  const initialized = await isInitialized(projectRoot);
  if (!initialized) {
    return {
      valid: false,
      initialized: false,
      settingsValid: false,
      errors: ['Not initialized. Run: npx @claude-flow/cache-optimizer init'],
      warnings: [],
    };
  }

  // Get current config
  const current = await getCurrentConfig(projectRoot);
  const profile = current?.profile;

  // Validate settings
  const settingsManager = createSettingsManager({ projectRoot });
  const settingsValidation = await settingsManager.validate();

  return {
    valid: settingsValidation.valid && errors.length === 0,
    initialized: true,
    profile,
    settingsValid: settingsValidation.valid,
    errors: [...errors, ...settingsValidation.errors],
    warnings: [...warnings, ...settingsValidation.warnings],
  };
}

/**
 * Show status of cache-optimizer initialization
 */
export async function status(projectRoot: string = process.cwd()): Promise<{
  initialized: boolean;
  profile?: ProfileId;
  configPath?: string;
  settingsPath: string;
  hooksInstalled: boolean;
  hookCount: number;
}> {
  const settingsManager = createSettingsManager({ projectRoot });
  const initialized = await isInitialized(projectRoot);
  const current = await getCurrentConfig(projectRoot);
  const cacheHooks = await settingsManager.getCacheOptimizerHooks();
  const hookCount = Object.values(cacheHooks).reduce((sum, hooks) => sum + (hooks?.length || 0), 0);

  return {
    initialized,
    profile: current?.profile,
    configPath: initialized ? join(projectRoot, '.cache-optimizer.json') : undefined,
    settingsPath: settingsManager.getPath(),
    hooksInstalled: hookCount > 0,
    hookCount,
  };
}

// Re-export types and functions
export { getProfile, listProfiles, detectRecommendedProfile, mergeWithProfile };
export type { ProfileId, Profile };
export { SettingsManager, createSettingsManager };
