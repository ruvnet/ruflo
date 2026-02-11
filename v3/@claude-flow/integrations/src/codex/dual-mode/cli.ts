/**
 * Dual-Mode CLI Commands
 * CLI interface for running collaborative dual-mode swarms
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  DualModeOrchestrator,
  DualModeConfig,
  WorkerConfig,
  CollaborationTemplates,
  CollaborationResult,
} from './orchestrator.js';

/**
 * Create the dual-mode command
 */
export function createDualModeCommand(): Command {
  const cmd = new Command('dual')
    .description('Run collaborative dual-mode swarms (Claude Code + Codex)')
    .addCommand(createRunCommand())
    .addCommand(createTemplateCommand())
    .addCommand(createStatusCommand());

  return cmd;
}

/**
 * Run a dual-mode collaboration
 */
function createRunCommand(): Command {
  return new Command('run')
    .description('Run a collaborative dual-mode swarm')
    .option('-t, --template <name>', 'Use a pre-built template (feature, security, refactor)')
    .option('-c, --config <path>', 'Path to collaboration config JSON')
    .option('--task <description>', 'Task description for the swarm')
    .option('--max-concurrent <n>', 'Maximum concurrent workers', '4')
    .option('--timeout <ms>', 'Worker timeout in milliseconds', '300000')
    .option('--namespace <name>', 'Shared memory namespace', 'collaboration')
    .action(async (options) => {
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  DUAL-MODE COLLABORATIVE EXECUTION'));
      console.log(chalk.cyan('  Claude Code + Codex workers with shared memory'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log();

      const config: DualModeConfig = {
        projectPath: process.cwd(),
        maxConcurrent: parseInt(options.maxConcurrent, 10),
        timeout: parseInt(options.timeout, 10),
        sharedNamespace: options.namespace,
      };

      const orchestrator = new DualModeOrchestrator(config);

      // Set up event listeners
      orchestrator.on('memory:initialized', ({ namespace }) => {
        console.log(chalk.green(`✓ Shared memory initialized: ${namespace}`));
      });

      orchestrator.on('worker:started', ({ id, role, platform }) => {
        const icon = platform === 'claude' ? '🔵' : '🟢';
        console.log(chalk.blue(`${icon} [${platform}] ${role} (${id}) started`));
      });

      orchestrator.on('worker:completed', ({ id }) => {
        console.log(chalk.green(`✓ Worker ${id} completed`));
      });

      orchestrator.on('worker:failed', ({ id, error }) => {
        console.log(chalk.red(`✗ Worker ${id} failed: ${error}`));
      });

      let workers: WorkerConfig[];
      let taskContext: string;

      if (options.template) {
        const task = options.task || 'Complete the assigned task';
        workers = getTemplateWorkers(options.template, task);
        taskContext = `Template: ${options.template}, Task: ${task}`;
      } else if (options.config) {
        const configData = await import(options.config);
        workers = configData.workers;
        taskContext = configData.taskContext || options.task || 'Collaborative task';
      } else {
        console.log(chalk.yellow('Please specify --template or --config'));
        console.log();
        console.log('Available templates:');
        console.log('  feature  - Feature development (architect → coder → tester → reviewer)');
        console.log('  security - Security audit (scanner → analyzer → fixer)');
        console.log('  refactor - Code refactoring (analyzer → planner → refactorer → validator)');
        return;
      }

      console.log();
      console.log(chalk.bold('Swarm Configuration:'));
      console.log(`  Workers: ${workers.length}`);
      console.log(`  Max Concurrent: ${config.maxConcurrent}`);
      console.log(`  Timeout: ${config.timeout}ms`);
      console.log(`  Namespace: ${config.sharedNamespace}`);
      console.log();

      console.log(chalk.bold('Worker Pipeline:'));
      for (const w of workers) {
        const deps = w.dependsOn?.length ? ` (after: ${w.dependsOn.join(', ')})` : '';
        const icon = w.platform === 'claude' ? '🔵' : '🟢';
        console.log(`  ${icon} ${w.id}: ${w.role}${deps}`);
      }
      console.log();

      console.log(chalk.bold('Starting collaboration...'));
      console.log();

      const startTime = Date.now();
      const result = await orchestrator.runCollaboration(workers, taskContext);

      console.log();
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log(chalk.cyan.bold('  COLLABORATION COMPLETE'));
      console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
      console.log();

      printResults(result);
    });
}

/**
 * List available templates
 */
function createTemplateCommand(): Command {
  return new Command('templates')
    .description('List available collaboration templates')
    .action(() => {
      console.log(chalk.bold('\nAvailable Collaboration Templates:\n'));

      console.log(chalk.cyan('feature') + ' - Feature Development Swarm');
      console.log('  Pipeline: architect → coder → tester → reviewer');
      console.log('  Platforms: Claude (architect, reviewer) + Codex (coder, tester)');
      console.log('  Usage: npx claude-flow-codex dual run --template feature --task "Add user auth"');
      console.log();

      console.log(chalk.cyan('security') + ' - Security Audit Swarm');
      console.log('  Pipeline: scanner → analyzer → fixer');
      console.log('  Platforms: Codex (scanner, fixer) + Claude (analyzer)');
      console.log('  Usage: npx claude-flow-codex dual run --template security --task "src/auth/"');
      console.log();

      console.log(chalk.cyan('refactor') + ' - Refactoring Swarm');
      console.log('  Pipeline: analyzer → planner → refactorer → validator');
      console.log('  Platforms: Claude (analyzer, planner) + Codex (refactorer, validator)');
      console.log('  Usage: npx claude-flow-codex dual run --template refactor --task "src/legacy/"');
      console.log();

      console.log(chalk.gray('Custom configurations can be provided via --config <path.json>'));
    });
}

/**
 * Check status of running collaboration
 */
function createStatusCommand(): Command {
  return new Command('status')
    .description('Check status of dual-mode collaboration')
    .option('--namespace <name>', 'Memory namespace to check', 'collaboration')
    .action(async (options) => {
      console.log(chalk.bold('\nDual-Mode Collaboration Status\n'));

      // Check shared memory
      const { spawn } = await import('child_process');

      const proc = spawn('npx', [
        'claude-flow@alpha', 'memory', 'list',
        '--namespace', options.namespace
      ], { stdio: 'inherit' });

      proc.on('close', () => {
        console.log();
      });
    });
}

/**
 * Get workers for a template
 */
function getTemplateWorkers(template: string, task: string): WorkerConfig[] {
  switch (template) {
    case 'feature':
      return CollaborationTemplates.featureDevelopment(task);
    case 'security':
      return CollaborationTemplates.securityAudit(task);
    case 'refactor':
      return CollaborationTemplates.refactoring(task);
    default:
      throw new Error(`Unknown template: ${template}`);
  }
}

/**
 * Print collaboration results
 */
function printResults(result: CollaborationResult): void {
  console.log(chalk.bold('Results:'));
  console.log(`  Status: ${result.success ? chalk.green('SUCCESS') : chalk.red('FAILED')}`);
  console.log(`  Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
  console.log();

  console.log(chalk.bold('Worker Summary:'));
  for (const worker of result.workers) {
    const status = worker.status === 'completed' ? chalk.green('✓') :
                   worker.status === 'failed' ? chalk.red('✗') :
                   chalk.yellow('○');
    const duration = worker.startedAt && worker.completedAt
      ? `${((worker.completedAt.getTime() - worker.startedAt.getTime()) / 1000).toFixed(1)}s`
      : '-';
    const icon = worker.platform === 'claude' ? '🔵' : '🟢';

    console.log(`  ${status} ${icon} ${worker.id} (${worker.role}): ${duration}`);
  }

  if (result.errors.length > 0) {
    console.log();
    console.log(chalk.red.bold('Errors:'));
    for (const error of result.errors) {
      console.log(chalk.red(`  • ${error}`));
    }
  }

  console.log();
  console.log(chalk.gray('View shared memory: npx claude-flow@alpha memory list --namespace collaboration'));
}
