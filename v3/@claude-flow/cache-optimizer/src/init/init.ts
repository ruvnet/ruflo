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
