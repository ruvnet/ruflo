/**
 * V3 CLI Deployment Command
 * Deployment management, environments, rollbacks
 *
 * Created with ❤️ by ruv.io
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Deployment State Types
// ============================================

interface DeploymentEnv {
  name: string;
  type: string; // 'local' | 'staging' | 'production'
  url?: string;
  createdAt: string;
}

interface DeploymentRecord {
  id: string;
  environment: string;
  version: string;
  status: 'deployed' | 'rolled-back' | 'failed';
  timestamp: string;
  description?: string;
}

interface DeploymentState {
  environments: Record<string, DeploymentEnv>;
  history: DeploymentRecord[];
  activeDeployment?: string;
}

// ============================================
// State Helpers
// ============================================

function getStateDir(cwd: string): string {
  return path.join(cwd, '.claude-flow');
}

function getStatePath(cwd: string): string {
  return path.join(getStateDir(cwd), 'deployments.json');
}

function emptyState(): DeploymentState {
  return { environments: {}, history: [], activeDeployment: undefined };
}

function loadDeploymentState(cwd: string): DeploymentState {
  const filePath = getStatePath(cwd);
  if (!fs.existsSync(filePath)) {
    return emptyState();
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as DeploymentState;
  } catch {
    return emptyState();
  }
}

function saveDeploymentState(cwd: string, state: DeploymentState): void {
  const dir = getStateDir(cwd);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = getStatePath(cwd);
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `dep-${ts}-${rand}`;
}

function readProjectVersion(cwd: string): string | null {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

// ============================================
// Deploy subcommand
// ============================================

const deployCommand: Command = {
  name: 'deploy',
  description: 'Deploy to target environment',
  options: [
    { name: 'env', short: 'e', type: 'string', description: 'Environment: dev, staging, prod', default: 'staging' },
    { name: 'version', short: 'v', type: 'string', description: 'Version to deploy' },
    { name: 'dry-run', short: 'd', type: 'boolean', description: 'Simulate deployment without changes' },
    { name: 'description', type: 'string', description: 'Deployment description' },
  ],
  examples: [
    { command: 'claude-flow deployment deploy -e prod', description: 'Deploy to production' },
    { command: 'claude-flow deployment deploy --dry-run', description: 'Simulate deployment' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const envName = String(ctx.flags['env'] || 'staging');
      const dryRun = ctx.flags.dryRun === true || ctx.flags['dry-run'] === true;
      const description = ctx.flags['description'] ? String(ctx.flags['description']) : undefined;

      let version = ctx.flags['version'] ? String(ctx.flags['version']) : null;
      if (!version) {
        version = readProjectVersion(ctx.cwd) || '0.0.0';
      }

      const state = loadDeploymentState(ctx.cwd);

      // Ensure environment exists; auto-create if it doesn't
      if (!state.environments[envName]) {
        state.environments[envName] = {
          name: envName,
          type: envName === 'prod' || envName === 'production' ? 'production' : envName === 'staging' ? 'staging' : 'local',
          createdAt: new Date().toISOString(),
        };
      }

      const record: DeploymentRecord = {
        id: generateId(),
        environment: envName,
        version,
        status: 'deployed',
        timestamp: new Date().toISOString(),
        description,
      };

      if (dryRun) {
        output.writeln();
        output.printInfo('Dry run - no changes will be made');
        output.writeln();
        output.writeln(output.bold('Deployment Preview'));
        output.printTable({
          columns: [
            { key: 'field', header: 'Field' },
            { key: 'value', header: 'Value' },
          ],
          data: [
            { field: 'ID', value: record.id },
            { field: 'Environment', value: envName },
            { field: 'Version', value: version },
            { field: 'Status', value: 'deployed (dry-run)' },
            { field: 'Description', value: description || '-' },
          ],
        });
        return { success: true };
      }

      state.history.push(record);
      state.activeDeployment = record.id;
      saveDeploymentState(ctx.cwd, state);

      output.writeln();
      output.printSuccess(`Deployed version ${version} to ${envName}`);
      output.writeln();
      output.printTable({
        columns: [
          { key: 'field', header: 'Field' },
          { key: 'value', header: 'Value' },
        ],
        data: [
          { field: 'ID', value: record.id },
          { field: 'Environment', value: envName },
          { field: 'Version', value: version },
          { field: 'Status', value: record.status },
          { field: 'Timestamp', value: record.timestamp },
          { field: 'Description', value: description || '-' },
        ],
      });

      return { success: true, data: record };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Deploy failed', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Status subcommand
// ============================================

const statusCommand: Command = {
  name: 'status',
  description: 'Check deployment status across environments',
  options: [
    { name: 'env', short: 'e', type: 'string', description: 'Specific environment to check' },
  ],
  examples: [
    { command: 'claude-flow deployment status', description: 'Show all environments' },
    { command: 'claude-flow deployment status -e prod', description: 'Check production' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const state = loadDeploymentState(ctx.cwd);
      const filterEnv = ctx.flags['env'] ? String(ctx.flags['env']) : null;

      output.writeln();
      output.writeln(output.bold('Deployment Status'));
      output.writeln();

      // Active deployment
      if (state.activeDeployment) {
        const active = state.history.find(r => r.id === state.activeDeployment);
        if (active) {
          output.printInfo(`Active deployment: ${active.id} (v${active.version} on ${active.environment})`);
        }
      } else {
        output.writeln(output.dim('No active deployment'));
      }

      // Environments table
      const envEntries = Object.values(state.environments);
      if (filterEnv) {
        const env = state.environments[filterEnv];
        if (!env) {
          output.printWarning(`Environment '${filterEnv}' not found`);
          return { success: true };
        }
        output.writeln();
        output.writeln(output.bold('Environment'));
        output.printTable({
          columns: [
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'url', header: 'URL' },
            { key: 'createdAt', header: 'Created' },
          ],
          data: [{ name: env.name, type: env.type, url: env.url || '-', createdAt: env.createdAt }],
        });
      } else if (envEntries.length > 0) {
        output.writeln();
        output.writeln(output.bold('Environments'));
        output.printTable({
          columns: [
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'url', header: 'URL' },
            { key: 'createdAt', header: 'Created' },
          ],
          data: envEntries.map(e => ({ name: e.name, type: e.type, url: e.url || '-', createdAt: e.createdAt })),
        });
      } else {
        output.writeln(output.dim('No environments configured'));
      }

      // Recent history (last 5)
      let recent = [...state.history].reverse().slice(0, 5);
      if (filterEnv) {
        recent = recent.filter(r => r.environment === filterEnv);
      }
      if (recent.length > 0) {
        output.writeln();
        output.writeln(output.bold('Recent Deployments'));
        output.printTable({
          columns: [
            { key: 'id', header: 'ID' },
            { key: 'environment', header: 'Env' },
            { key: 'version', header: 'Version' },
            { key: 'status', header: 'Status' },
            { key: 'timestamp', header: 'Time' },
          ],
          data: recent.map(r => ({ ...r })),
        });
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Status check failed', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Rollback subcommand
// ============================================

const rollbackCommand: Command = {
  name: 'rollback',
  description: 'Rollback to previous deployment',
  options: [
    { name: 'env', short: 'e', type: 'string', description: 'Environment to rollback', required: true },
    { name: 'version', short: 'v', type: 'string', description: 'Specific version to rollback to' },
    { name: 'steps', short: 's', type: 'number', description: 'Number of versions to rollback', default: '1' },
  ],
  examples: [
    { command: 'claude-flow deployment rollback -e prod', description: 'Rollback production' },
    { command: 'claude-flow deployment rollback -e prod -v v3.0.0', description: 'Rollback to specific version' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const envName = String(ctx.flags['env'] || '');
      if (!envName) {
        output.printError('Environment is required', 'Use --env or -e to specify');
        return { success: false, exitCode: 1 };
      }

      const targetVersion = ctx.flags['version'] ? String(ctx.flags['version']) : null;
      const state = loadDeploymentState(ctx.cwd);

      // Find deployments for this environment in reverse chronological order
      const envHistory = state.history
        .filter(r => r.environment === envName && r.status === 'deployed')
        .reverse();

      if (envHistory.length < 2 && !targetVersion) {
        output.printWarning('No previous deployment to rollback to');
        return { success: false, exitCode: 1 };
      }

      let rollbackTo: DeploymentRecord | undefined;

      if (targetVersion) {
        rollbackTo = envHistory.find(r => r.version === targetVersion);
        if (!rollbackTo) {
          output.printError(`Version '${targetVersion}' not found in deployment history for '${envName}'`);
          return { success: false, exitCode: 1 };
        }
      } else {
        // Rollback to the deployment before the most recent one
        rollbackTo = envHistory[1];
      }

      // Mark current active deployment for this env as rolled-back
      const current = envHistory[0];
      if (current) {
        const idx = state.history.findIndex(r => r.id === current.id);
        if (idx >= 0) {
          state.history[idx].status = 'rolled-back';
        }
      }

      // Create a new record for the rollback
      const record: DeploymentRecord = {
        id: generateId(),
        environment: envName,
        version: rollbackTo!.version,
        status: 'deployed',
        timestamp: new Date().toISOString(),
        description: `Rollback from ${current?.version || 'unknown'} to ${rollbackTo!.version}`,
      };

      state.history.push(record);
      state.activeDeployment = record.id;
      saveDeploymentState(ctx.cwd, state);

      output.writeln();
      output.printSuccess(`Rolled back ${envName} to version ${rollbackTo!.version}`);
      output.writeln();
      output.printTable({
        columns: [
          { key: 'field', header: 'Field' },
          { key: 'value', header: 'Value' },
        ],
        data: [
          { field: 'Rollback ID', value: record.id },
          { field: 'Environment', value: envName },
          { field: 'From Version', value: current?.version || 'unknown' },
          { field: 'To Version', value: rollbackTo!.version },
          { field: 'Timestamp', value: record.timestamp },
        ],
      });

      return { success: true, data: record };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Rollback failed', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// History subcommand (logs)
// ============================================

const historyCommand: Command = {
  name: 'history',
  description: 'View deployment history',
  options: [
    { name: 'env', short: 'e', type: 'string', description: 'Filter by environment' },
    { name: 'limit', short: 'l', type: 'number', description: 'Number of entries', default: '10' },
  ],
  examples: [
    { command: 'claude-flow deployment history', description: 'Show all history' },
    { command: 'claude-flow deployment history -e prod', description: 'Production history' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const state = loadDeploymentState(ctx.cwd);
      const filterEnv = ctx.flags['env'] ? String(ctx.flags['env']) : null;
      const limit = Number(ctx.flags['limit']) || 10;

      let records = [...state.history].reverse();
      if (filterEnv) {
        records = records.filter(r => r.environment === filterEnv);
      }
      records = records.slice(0, limit);

      output.writeln();
      output.writeln(output.bold('Deployment History'));

      if (filterEnv) {
        output.writeln(output.dim(`Filtered by environment: ${filterEnv}`));
      }
      output.writeln();

      if (records.length === 0) {
        output.writeln(output.dim('No deployment history found'));
        return { success: true };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID' },
          { key: 'environment', header: 'Env' },
          { key: 'version', header: 'Version' },
          { key: 'status', header: 'Status' },
          { key: 'timestamp', header: 'Time' },
          { key: 'description', header: 'Description' },
        ],
        data: records.map(r => ({
          ...r,
          description: r.description || '-',
        })),
      });

      output.writeln();
      output.writeln(output.dim(`Showing ${records.length} of ${state.history.length} total records`));

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Failed to load history', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Environments subcommand
// ============================================

const environmentsCommand: Command = {
  name: 'environments',
  description: 'Manage deployment environments',
  aliases: ['envs'],
  options: [
    { name: 'action', short: 'a', type: 'string', description: 'Action: list, add, remove', default: 'list' },
    { name: 'name', short: 'n', type: 'string', description: 'Environment name' },
    { name: 'type', short: 't', type: 'string', description: 'Environment type: local, staging, production', default: 'local' },
    { name: 'url', short: 'u', type: 'string', description: 'Environment URL' },
  ],
  examples: [
    { command: 'claude-flow deployment environments', description: 'List environments' },
    { command: 'claude-flow deployment envs -a add -n preview -t staging', description: 'Add environment' },
    { command: 'claude-flow deployment envs -a remove -n preview', description: 'Remove environment' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const action = String(ctx.flags['action'] || 'list');
      const state = loadDeploymentState(ctx.cwd);

      if (action === 'list') {
        const envs = Object.values(state.environments);

        output.writeln();
        output.writeln(output.bold('Deployment Environments'));
        output.writeln();

        if (envs.length === 0) {
          output.writeln(output.dim('No environments configured. Use --action add to create one.'));
          return { success: true };
        }

        output.printTable({
          columns: [
            { key: 'name', header: 'Name' },
            { key: 'type', header: 'Type' },
            { key: 'url', header: 'URL' },
            { key: 'createdAt', header: 'Created' },
          ],
          data: envs.map(e => ({ name: e.name, type: e.type, url: e.url || '-', createdAt: e.createdAt })),
        });

        return { success: true };
      }

      if (action === 'add') {
        const name = ctx.flags['name'] ? String(ctx.flags['name']) : null;
        if (!name) {
          output.printError('Environment name is required', 'Use --name or -n to specify');
          return { success: false, exitCode: 1 };
        }
        if (state.environments[name]) {
          output.printWarning(`Environment '${name}' already exists`);
          return { success: false, exitCode: 1 };
        }

        const envType = String(ctx.flags['type'] || 'local');
        const url = ctx.flags['url'] ? String(ctx.flags['url']) : undefined;

        state.environments[name] = {
          name,
          type: envType,
          url,
          createdAt: new Date().toISOString(),
        };
        saveDeploymentState(ctx.cwd, state);

        output.writeln();
        output.printSuccess(`Added environment '${name}' (${envType})`);
        if (url) {
          output.writeln(output.dim(`  URL: ${url}`));
        }
        return { success: true };
      }

      if (action === 'remove') {
        const name = ctx.flags['name'] ? String(ctx.flags['name']) : null;
        if (!name) {
          output.printError('Environment name is required', 'Use --name or -n to specify');
          return { success: false, exitCode: 1 };
        }
        if (!state.environments[name]) {
          output.printWarning(`Environment '${name}' not found`);
          return { success: false, exitCode: 1 };
        }

        delete state.environments[name];
        saveDeploymentState(ctx.cwd, state);

        output.writeln();
        output.printSuccess(`Removed environment '${name}'`);
        return { success: true };
      }

      output.printError(`Unknown action '${action}'`, 'Valid actions: list, add, remove');
      return { success: false, exitCode: 1 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Environments command failed', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Logs subcommand
// ============================================

const logsCommand: Command = {
  name: 'logs',
  description: 'View deployment logs',
  options: [
    { name: 'deployment', short: 'd', type: 'string', description: 'Deployment ID' },
    { name: 'env', short: 'e', type: 'string', description: 'Environment' },
    { name: 'lines', short: 'n', type: 'number', description: 'Number of lines', default: '50' },
  ],
  examples: [
    { command: 'claude-flow deployment logs -e prod', description: 'View production logs' },
    { command: 'claude-flow deployment logs -d dep-123', description: 'View specific deployment' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const state = loadDeploymentState(ctx.cwd);
      const filterEnv = ctx.flags['env'] ? String(ctx.flags['env']) : null;
      const deploymentId = ctx.flags['deployment'] ? String(ctx.flags['deployment']) : null;
      const limit = Number(ctx.flags['lines']) || 50;

      output.writeln();
      output.writeln(output.bold('Deployment Logs'));
      output.writeln();

      let records = [...state.history].reverse();

      if (deploymentId) {
        records = records.filter(r => r.id === deploymentId);
        if (records.length === 0) {
          output.printWarning(`Deployment '${deploymentId}' not found`);
          return { success: false, exitCode: 1 };
        }
      }

      if (filterEnv) {
        records = records.filter(r => r.environment === filterEnv);
      }

      records = records.slice(0, limit);

      if (records.length === 0) {
        output.writeln(output.dim('No deployment logs found'));
        return { success: true };
      }

      output.printTable({
        columns: [
          { key: 'id', header: 'ID' },
          { key: 'environment', header: 'Env' },
          { key: 'version', header: 'Version' },
          { key: 'status', header: 'Status' },
          { key: 'timestamp', header: 'Time' },
          { key: 'description', header: 'Description' },
        ],
        data: records.map(r => ({
          ...r,
          description: r.description || '-',
        })),
      });

      output.writeln();
      output.writeln(output.dim(`${records.length} entries shown`));

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Failed to load logs', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Release subcommand
// ============================================

const releaseCommand: Command = {
  name: 'release',
  description: 'Create a new release deployment',
  options: [
    { name: 'version', short: 'v', type: 'string', description: 'Release version' },
    { name: 'env', short: 'e', type: 'string', description: 'Target environment', default: 'production' },
    { name: 'description', short: 'd', type: 'string', description: 'Release description' },
  ],
  examples: [
    { command: 'claude-flow deployment release -v 3.5.0', description: 'Release version 3.5.0' },
    { command: 'claude-flow deployment release -v 3.5.0 -d "Major update"', description: 'Release with description' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const envName = String(ctx.flags['env'] || 'production');
      const description = ctx.flags['description'] ? String(ctx.flags['description']) : undefined;

      let version = ctx.flags['version'] ? String(ctx.flags['version']) : null;
      if (!version) {
        const pkgVersion = readProjectVersion(ctx.cwd);
        if (!pkgVersion) {
          output.printError('Version is required', 'Use --version or -v, or ensure package.json has a version field');
          return { success: false, exitCode: 1 };
        }
        version = pkgVersion;
      }

      const state = loadDeploymentState(ctx.cwd);

      // Ensure environment exists
      if (!state.environments[envName]) {
        state.environments[envName] = {
          name: envName,
          type: envName === 'prod' || envName === 'production' ? 'production' : 'staging',
          createdAt: new Date().toISOString(),
        };
      }

      const record: DeploymentRecord = {
        id: generateId(),
        environment: envName,
        version,
        status: 'deployed',
        timestamp: new Date().toISOString(),
        description: description || `Release ${version}`,
      };

      state.history.push(record);
      state.activeDeployment = record.id;
      saveDeploymentState(ctx.cwd, state);

      output.writeln();
      output.printSuccess(`Released version ${version} to ${envName}`);
      output.writeln();
      output.printTable({
        columns: [
          { key: 'field', header: 'Field' },
          { key: 'value', header: 'Value' },
        ],
        data: [
          { field: 'Release ID', value: record.id },
          { field: 'Environment', value: envName },
          { field: 'Version', value: version },
          { field: 'Status', value: record.status },
          { field: 'Timestamp', value: record.timestamp },
          { field: 'Description', value: record.description || '-' },
        ],
      });

      return { success: true, data: record };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      output.printError('Release failed', msg);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Main deployment command
// ============================================

export const deploymentCommand: Command = {
  name: 'deployment',
  description: 'Deployment management, environments, rollbacks',
  aliases: ['deploy'],
  subcommands: [deployCommand, statusCommand, rollbackCommand, historyCommand, environmentsCommand, logsCommand, releaseCommand],
  examples: [
    { command: 'claude-flow deployment deploy -e prod', description: 'Deploy to production' },
    { command: 'claude-flow deployment status', description: 'Check all environments' },
    { command: 'claude-flow deployment rollback -e prod', description: 'Rollback production' },
    { command: 'claude-flow deployment release -v 3.5.0', description: 'Create a release' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Deployment'));
    output.writeln(output.dim('Multi-environment deployment management'));
    output.writeln();
    output.writeln('Subcommands:');
    output.printList([
      'deploy       - Deploy to target environment',
      'status       - Check deployment status',
      'rollback     - Rollback to previous version',
      'history      - View deployment history',
      'environments - Manage deployment environments',
      'logs         - View deployment logs',
      'release      - Create a new release',
    ]);
    output.writeln();
    output.writeln('Features:');
    output.printList([
      'Zero-downtime rolling deployments',
      'Automatic rollback on failure',
      'Environment-specific configurations',
      'Deployment previews for PRs',
    ]);
    output.writeln();
    output.writeln(output.dim('Created with love by ruv.io'));
    return { success: true };
  },
};

export default deploymentCommand;
