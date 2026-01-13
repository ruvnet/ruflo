/**
 * Update command - manage @claude-flow package updates
 *
 * Usage:
 *   claude-flow update check       - Check for available updates
 *   claude-flow update all         - Update all packages
 *   claude-flow update <package>   - Update specific package
 *   claude-flow update history     - View update history
 *   claude-flow update rollback    - Rollback last update
 */

import { Command } from 'commander';
import { createOutput, createSpinner } from '../utils/output.js';
import {
  checkForUpdates,
  checkSinglePackage,
  getInstalledVersion,
  DEFAULT_CONFIG,
  UpdateCheckResult,
} from '../update/checker.js';
import {
  executeUpdate,
  executeMultipleUpdates,
  rollbackUpdate,
  getUpdateHistory,
  clearHistory,
} from '../update/executor.js';
import { clearCache } from '../update/rate-limiter.js';

const output = createOutput();

function formatUpdateType(type: string): string {
  switch (type) {
    case 'major':
      return output.error('MAJOR');
    case 'minor':
      return output.warn('minor');
    case 'patch':
      return output.success('patch');
    default:
      return type;
  }
}

function formatPriority(priority: string): string {
  switch (priority) {
    case 'critical':
      return output.error('CRITICAL');
    case 'high':
      return output.warn('high');
    case 'normal':
      return output.info('normal');
    case 'low':
      return output.muted('low');
    default:
      return priority;
  }
}

function createUpdateCommand(): Command {
  const updateCmd = new Command('update')
    .description('Manage @claude-flow package updates')
    .addHelpText(
      'after',
      `
Examples:
  $ claude-flow update check              Check for available updates
  $ claude-flow update all                Update all packages
  $ claude-flow update @claude-flow/cli   Update specific package
  $ claude-flow update history            View update history
  $ claude-flow update rollback           Rollback last update
  $ claude-flow update clear-cache        Clear update check cache

Environment Variables:
  CLAUDE_FLOW_AUTO_UPDATE=false    Disable auto-update
  CLAUDE_FLOW_FORCE_UPDATE=true    Force update check
`
    );

  // Check for updates
  updateCmd
    .command('check')
    .description('Check for available updates')
    .option('--force', 'Force check (ignore rate limit)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = createSpinner('Checking for updates...');

      // Force check if requested
      if (options.force) {
        process.env.CLAUDE_FLOW_FORCE_UPDATE = 'true';
      }

      try {
        const { results, skipped, reason } = await checkForUpdates(DEFAULT_CONFIG);

        spinner.stop();

        if (skipped) {
          output.printInfo(`Update check skipped: ${reason}`);
          output.writeln('Use --force to check anyway');
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          output.printSuccess('All @claude-flow packages are up to date!');
          return;
        }

        output.printHeader('Available Updates');
        output.writeln();

        output.printTable({
          headers: ['Package', 'Current', 'Latest', 'Type', 'Priority', 'Auto'],
          data: results.map((r) => ({
            package: r.package,
            current: r.currentVersion,
            latest: output.highlight(r.latestVersion),
            type: formatUpdateType(r.updateType),
            priority: formatPriority(r.priority),
            auto: r.shouldAutoUpdate ? output.success('yes') : output.muted('no'),
          })),
        });

        output.writeln();

        const autoUpdates = results.filter((r) => r.shouldAutoUpdate);
        const manualUpdates = results.filter((r) => !r.shouldAutoUpdate);

        if (autoUpdates.length > 0) {
          output.printInfo(
            `${autoUpdates.length} update(s) will be applied automatically on next startup`
          );
        }

        if (manualUpdates.length > 0) {
          output.writeln();
          output.printInfo('To update manually, run:');
          output.writeln(`  claude-flow update all`);
          output.writeln('  or');
          manualUpdates.forEach((r) => {
            output.writeln(`  claude-flow update ${r.package}`);
          });
        }
      } catch (error) {
        spinner.fail('Update check failed');
        const err = error as Error;
        output.printError(err.message);
      } finally {
        // Clean up env
        delete process.env.CLAUDE_FLOW_FORCE_UPDATE;
      }
    });

  // Update all packages
  updateCmd
    .command('all')
    .description('Update all @claude-flow packages')
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('--include-major', 'Include major version updates')
    .action(async (options) => {
      const spinner = createSpinner('Checking for updates...');

      // Force check
      process.env.CLAUDE_FLOW_FORCE_UPDATE = 'true';

      try {
        const config = {
          ...DEFAULT_CONFIG,
          autoUpdate: {
            patch: true,
            minor: true,
            major: options.includeMajor || false,
          },
        };

        const { results } = await checkForUpdates(config);

        if (results.length === 0) {
          spinner.succeed('All packages are up to date!');
          return;
        }

        spinner.text = `Updating ${results.length} package(s)...`;

        // Get installed packages
        const installedPackages: Record<string, string> = {};
        for (const update of results) {
          const version = getInstalledVersion(update.package);
          if (version) {
            installedPackages[update.package] = version;
          }
        }

        // Execute updates
        const updateResults = await executeMultipleUpdates(
          results,
          installedPackages,
          options.dryRun
        );

        spinner.stop();

        const successful = updateResults.filter((r) => r.success);
        const failed = updateResults.filter((r) => !r.success);

        if (options.dryRun) {
          output.printHeader('Dry Run - Would Update');
        } else {
          output.printHeader('Update Results');
        }

        output.writeln();

        if (successful.length > 0) {
          output.printSuccess(`${successful.length} package(s) ${options.dryRun ? 'would be ' : ''}updated:`);
          successful.forEach((r) => {
            output.writeln(`  ${output.success('✓')} ${r.package}@${r.version}`);
          });
        }

        if (failed.length > 0) {
          output.writeln();
          output.printError(`${failed.length} package(s) failed:`);
          failed.forEach((r) => {
            output.writeln(`  ${output.error('✗')} ${r.package}: ${r.error}`);
          });
        }

        // Show warnings
        for (const result of updateResults) {
          if (result.validation.warnings.length > 0) {
            output.writeln();
            output.printWarn(`Warnings for ${result.package}:`);
            result.validation.warnings.forEach((w) => {
              output.writeln(`  ${output.warn('!')} ${w}`);
            });
          }
        }
      } catch (error) {
        spinner.fail('Update failed');
        const err = error as Error;
        output.printError(err.message);
      } finally {
        delete process.env.CLAUDE_FLOW_FORCE_UPDATE;
      }
    });

  // Update specific package
  updateCmd
    .command('package <name>')
    .description('Update a specific @claude-flow package')
    .option('--dry-run', 'Show what would be updated without making changes')
    .action(async (name: string, options) => {
      const spinner = createSpinner(`Checking ${name}...`);

      try {
        const result = await checkSinglePackage(name, DEFAULT_CONFIG);

        if (!result) {
          spinner.fail(`Package ${name} not found or not installed`);
          return;
        }

        if (result.updateType === 'none') {
          spinner.succeed(`${name} is already up to date (${result.currentVersion})`);
          return;
        }

        spinner.text = `Updating ${name} to ${result.latestVersion}...`;

        // Get installed packages for validation
        const installedPackages: Record<string, string> = {};
        const version = getInstalledVersion(name);
        if (version) {
          installedPackages[name] = version;
        }

        const updateResult = await executeUpdate(result, installedPackages, options.dryRun);

        if (updateResult.success) {
          spinner.succeed(
            options.dryRun
              ? `Would update ${name}: ${result.currentVersion} → ${result.latestVersion}`
              : `Updated ${name}: ${result.currentVersion} → ${result.latestVersion}`
          );
        } else {
          spinner.fail(`Failed to update ${name}: ${updateResult.error}`);
        }

        // Show warnings
        if (updateResult.validation.warnings.length > 0) {
          output.writeln();
          output.printWarn('Warnings:');
          updateResult.validation.warnings.forEach((w) => {
            output.writeln(`  ${w}`);
          });
        }
      } catch (error) {
        spinner.fail('Update failed');
        const err = error as Error;
        output.printError(err.message);
      }
    });

  // View history
  updateCmd
    .command('history')
    .description('View update history')
    .option('-n, --limit <number>', 'Number of entries to show', '20')
    .option('--json', 'Output as JSON')
    .option('--clear', 'Clear update history')
    .action(async (options) => {
      if (options.clear) {
        clearHistory();
        output.printSuccess('Update history cleared');
        return;
      }

      const history = getUpdateHistory(parseInt(options.limit, 10));

      if (history.length === 0) {
        output.printInfo('No update history available');
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(history, null, 2));
        return;
      }

      output.printHeader('Update History');
      output.writeln();

      output.printTable({
        headers: ['Time', 'Package', 'From', 'To', 'Status'],
        data: history.map((h) => ({
          time: new Date(h.timestamp).toLocaleString(),
          package: h.package,
          from: h.fromVersion,
          to: h.toVersion,
          status: h.success
            ? output.success('success')
            : output.error(`failed: ${h.error}`),
        })),
      });
    });

  // Rollback
  updateCmd
    .command('rollback')
    .description('Rollback last update')
    .argument('[package]', 'Specific package to rollback')
    .action(async (packageName?: string) => {
      const spinner = createSpinner(
        packageName ? `Rolling back ${packageName}...` : 'Rolling back last update...'
      );

      try {
        const result = await rollbackUpdate(packageName);

        if (result.success) {
          spinner.succeed(result.message);
        } else {
          spinner.fail(result.message);
        }
      } catch (error) {
        spinner.fail('Rollback failed');
        const err = error as Error;
        output.printError(err.message);
      }
    });

  // Clear cache
  updateCmd
    .command('clear-cache')
    .description('Clear update check cache')
    .action(() => {
      clearCache();
      output.printSuccess('Update cache cleared');
      output.printInfo('Next startup will check for updates');
    });

  return updateCmd;
}
