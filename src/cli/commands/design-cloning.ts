/**
 * Design Cloning CLI Commands
 * 
 * Provides command-line interface for executing design cloning workflows:
 * - gemini-clone: Single screenshot to complete clone
 * - figma-library: Multiple designs to component library  
 * - website-clone: URL to complete website clone
 * - batch-process: Batch processing capabilities
 * - status: Monitor workflow progress
 * - optimize: Resource optimization
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DesignCloningSuite, WorkflowBatchProcessor, WorkflowType, WorkflowStatus } from '../../workflows/design-cloning-suite.js';
import { WorkflowCoordinator } from '../../workflows/workflow-coordinator.js';
import { createLogger } from '../../core/logger.js';

/**
 * CLI Configuration
 */
const CLI_CONFIG = {
  outputDir: process.cwd(),
  logLevel: 'info',
  maxConcurrentWorkflows: 3,
  autoOptimize: true,
  saveResults: true
};

/**
 * Global state for CLI commands
 */
let designCloningSuite: DesignCloningSuite | null = null;
let workflowCoordinator: WorkflowCoordinator | null = null;
let batchProcessor: WorkflowBatchProcessor | null = null;

/**
 * Initialize Design Cloning Suite
 */
async function initializeDesignCloningSuite(options: any = {}) {
  if (designCloningSuite && workflowCoordinator) {
    return { designCloningSuite, workflowCoordinator, batchProcessor };
  }

  const spinner = ora('Initializing Design Cloning Suite...').start();

  try {
    const logger = createLogger('CLI', { level: options.logLevel || CLI_CONFIG.logLevel });

    // Initialize Workflow Coordinator
    workflowCoordinator = new WorkflowCoordinator({
      logger,
      healthCheckInterval: 30000,
      maxConcurrentStartups: 3
    });
    await workflowCoordinator.initialize();

    // Initialize Design Cloning Suite
    designCloningSuite = new DesignCloningSuite({
      logger,
      swarmOptions: {
        maxAgents: 15,
        topology: 'hierarchical',
        enableFailover: true,
        enableLoadBalancing: true
      }
    });
    await designCloningSuite.initialize();

    // Initialize Batch Processor
    batchProcessor = new WorkflowBatchProcessor(designCloningSuite, {
      logger,
      maxConcurrentWorkflows: options.maxConcurrent || CLI_CONFIG.maxConcurrentWorkflows
    });

    spinner.succeed('Design Cloning Suite initialized successfully');

    return { designCloningSuite, workflowCoordinator, batchProcessor };

  } catch (error) {
    spinner.fail('Failed to initialize Design Cloning Suite');
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

/**
 * Save workflow results to file
 */
async function saveResults(workflowId: string, result: any, outputDir: string) {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${workflowId}_${timestamp}.json`;
    const filepath = path.join(outputDir, filename);

    await fs.writeFile(filepath, JSON.stringify(result, null, 2));
    console.log(chalk.green(`✅ Results saved to: ${filepath}`));
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Failed to save results: ${error.message}`));
  }
}

/**
 * Display workflow progress
 */
function displayWorkflowProgress(workflow: any) {
  console.log('\n' + chalk.blue('📊 Workflow Progress:'));
  console.log(`ID: ${chalk.cyan(workflow.id)}`);
  console.log(`Type: ${chalk.cyan(workflow.type)}`);
  console.log(`Status: ${getStatusColor(workflow.status)}`);
  
  if (workflow.steps && workflow.steps.length > 0) {
    console.log('\n' + chalk.blue('Steps completed:'));
    workflow.steps.forEach((step: any, index: number) => {
      console.log(`  ${index + 1}. ${chalk.green('✓')} ${step.step}`);
    });
  }

  if (workflow.executionTime) {
    console.log(`\nExecution time: ${chalk.yellow((workflow.executionTime / 1000).toFixed(2))}s`);
  }
}

/**
 * Get colored status text
 */
function getStatusColor(status: string): string {
  switch (status) {
    case WorkflowStatus.COMPLETED:
      return chalk.green(status);
    case WorkflowStatus.FAILED:
      return chalk.red(status);
    case WorkflowStatus.CANCELLED:
      return chalk.yellow(status);
    case WorkflowStatus.ANALYZING:
    case WorkflowStatus.GENERATING:
    case WorkflowStatus.INTEGRATING:
      return chalk.blue(status);
    default:
      return chalk.gray(status);
  }
}

/**
 * Gemini-Style Clone Command
 */
export function createGeminiCloneCommand(): Command {
  const command = new Command('gemini-clone')
    .description('Clone a design from a single screenshot (Gemini-style)')
    .argument('<screenshot>', 'Path to screenshot file')
    .option('-o, --output <dir>', 'Output directory', CLI_CONFIG.outputDir)
    .option('--framework <framework>', 'Target framework (nextjs, react, vue)', 'nextjs')
    .option('--typescript', 'Use TypeScript', false)
    .option('--tailwind', 'Use Tailwind CSS', true)
    .option('--save-results', 'Save results to file', CLI_CONFIG.saveResults)
    .option('--log-level <level>', 'Log level (debug, info, warn, error)', CLI_CONFIG.logLevel)
    .action(async (screenshot: string, options: any) => {
      try {
        // Validate screenshot file exists
        try {
          await fs.access(screenshot);
        } catch {
          console.error(chalk.red('❌ Screenshot file not found:'), screenshot);
          process.exit(1);
        }

        // Initialize suite
        const { designCloningSuite } = await initializeDesignCloningSuite(options);

        // Start workflow
        const spinner = ora('Starting Gemini-style design cloning...').start();
        
        const workflowOptions = {
          framework: options.framework,
          typescript: options.typescript,
          tailwindcss: options.tailwind,
          outputDir: options.output
        };

        // Execute workflow with progress monitoring
        const startTime = Date.now();
        let currentWorkflow: any = null;

        // Listen for workflow events
        designCloningSuite.on('workflowStarted', (workflow) => {
          currentWorkflow = workflow;
          spinner.text = `Processing workflow ${workflow.id}...`;
        });

        designCloningSuite.on('workflowStatusChanged', (workflow) => {
          currentWorkflow = workflow;
          spinner.text = `${workflow.status} - ${workflow.id}`;
        });

        try {
          const result = await designCloningSuite.executeGeminiStyleClone(screenshot, workflowOptions);
          
          spinner.succeed('Gemini-style clone completed successfully!');
          
          // Display results
          console.log('\n' + chalk.green('🎉 Clone Results:'));
          console.log(`Project path: ${chalk.cyan(result.projectPath)}`);
          console.log(`Components: ${chalk.yellow(result.components?.length || 0)}`);
          console.log(`Assets: ${chalk.yellow(result.assets?.length || 0)}`);
          console.log(`Build ready: ${result.buildReady ? chalk.green('Yes') : chalk.red('No')}`);
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }

          // Save results if requested
          if (options.saveResults && currentWorkflow) {
            await saveResults(currentWorkflow.id, result, options.output);
          }

          // Show next steps
          console.log('\n' + chalk.blue('🚀 Next Steps:'));
          console.log(`1. Navigate to: ${chalk.cyan(result.projectPath)}`);
          console.log(`2. Install dependencies: ${chalk.cyan('npm install')}`);
          console.log(`3. Start development: ${chalk.cyan('npm run dev')}`);

        } catch (error) {
          spinner.fail('Gemini-style clone failed');
          console.error(chalk.red('Error:'), error.message);
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }
          
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Figma-Style Library Command
 */
export function createFigmaLibraryCommand(): Command {
  const command = new Command('figma-library')
    .description('Build a component library from multiple design files (Figma-style)')
    .argument('<designs...>', 'Paths to design files')
    .option('-o, --output <dir>', 'Output directory', CLI_CONFIG.outputDir)
    .option('--name <name>', 'Library name', 'design-system')
    .option('--storybook', 'Generate Storybook documentation', true)
    .option('--documentation', 'Generate documentation', true)
    .option('--save-results', 'Save results to file', CLI_CONFIG.saveResults)
    .option('--log-level <level>', 'Log level (debug, info, warn, error)', CLI_CONFIG.logLevel)
    .action(async (designs: string[], options: any) => {
      try {
        // Validate design files
        for (const design of designs) {
          try {
            await fs.access(design);
          } catch {
            console.error(chalk.red('❌ Design file not found:'), design);
            process.exit(1);
          }
        }

        // Initialize suite
        const { designCloningSuite } = await initializeDesignCloningSuite(options);

        // Start workflow
        const spinner = ora(`Building component library from ${designs.length} design files...`).start();
        
        const workflowOptions = {
          libraryName: options.name,
          generateStorybook: options.storybook,
          generateDocumentation: options.documentation,
          outputDir: options.output
        };

        let currentWorkflow: any = null;

        // Listen for workflow events
        designCloningSuite.on('workflowStarted', (workflow) => {
          currentWorkflow = workflow;
          spinner.text = `Analyzing ${designs.length} design files...`;
        });

        designCloningSuite.on('workflowStatusChanged', (workflow) => {
          currentWorkflow = workflow;
          const statusText = {
            [WorkflowStatus.ANALYZING]: 'Analyzing designs and extracting patterns...',
            [WorkflowStatus.GENERATING]: 'Generating components and library...',
            [WorkflowStatus.INTEGRATING]: 'Creating documentation and storage...'
          };
          spinner.text = statusText[workflow.status] || workflow.status;
        });

        try {
          const result = await designCloningSuite.executeFigmaStyleLibrary(designs, workflowOptions);
          
          spinner.succeed('Component library built successfully!');
          
          // Display results
          console.log('\n' + chalk.green('📚 Library Results:'));
          console.log(`Library: ${chalk.cyan(result.library)}`);
          console.log(`Components: ${chalk.yellow(result.components?.length || 0)}`);
          console.log(`Patterns: ${chalk.yellow(result.patterns?.length || 0)}`);
          
          if (result.documentation) {
            console.log(`Documentation: ${chalk.green('Generated')}`);
          }
          if (result.storybook) {
            console.log(`Storybook: ${chalk.green('Generated')}`);
          }
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }

          // Save results if requested
          if (options.saveResults && currentWorkflow) {
            await saveResults(currentWorkflow.id, result, options.output);
          }

          // Show next steps
          console.log('\n' + chalk.blue('🚀 Next Steps:'));
          console.log(`1. Import components: ${chalk.cyan("import { Button } from './components'")}`);
          if (result.storybook) {
            console.log(`2. View Storybook: ${chalk.cyan('npm run storybook')}`);
          }
          if (result.documentation) {
            console.log(`3. Read documentation: Open generated docs`);
          }

        } catch (error) {
          spinner.fail('Component library creation failed');
          console.error(chalk.red('Error:'), error.message);
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }
          
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Website Clone Command
 */
export function createWebsiteCloneCommand(): Command {
  const command = new Command('website-clone')
    .description('Clone a complete website from URL (Website-scraping style)')
    .argument('<url>', 'Website URL to clone')
    .option('-o, --output <dir>', 'Output directory', CLI_CONFIG.outputDir)
    .option('--depth <depth>', 'Maximum crawl depth', '3')
    .option('--framework <framework>', 'Target framework (nextjs, react, vue)', 'nextjs')
    .option('--typescript', 'Use TypeScript', false)
    .option('--responsive', 'Make responsive', true)
    .option('--save-results', 'Save results to file', CLI_CONFIG.saveResults)
    .option('--log-level <level>', 'Log level (debug, info, warn, error)', CLI_CONFIG.logLevel)
    .action(async (url: string, options: any) => {
      try {
        // Validate URL
        try {
          new URL(url);
        } catch {
          console.error(chalk.red('❌ Invalid URL:'), url);
          process.exit(1);
        }

        // Initialize suite
        const { designCloningSuite } = await initializeDesignCloningSuite(options);

        // Start workflow
        const spinner = ora(`Cloning website: ${url}...`).start();
        
        const workflowOptions = {
          maxDepth: parseInt(options.depth),
          framework: options.framework,
          typescript: options.typescript,
          responsive: options.responsive,
          outputDir: options.output
        };

        let currentWorkflow: any = null;

        // Listen for workflow events
        designCloningSuite.on('workflowStarted', (workflow) => {
          currentWorkflow = workflow;
          spinner.text = `Scraping website: ${url}`;
        });

        designCloningSuite.on('workflowStatusChanged', (workflow) => {
          currentWorkflow = workflow;
          const statusText = {
            [WorkflowStatus.ANALYZING]: 'Analyzing website structure and design...',
            [WorkflowStatus.GENERATING]: 'Generating components and assets...',
            [WorkflowStatus.INTEGRATING]: 'Building final project...'
          };
          spinner.text = statusText[workflow.status] || workflow.status;
        });

        try {
          const result = await designCloningSuite.executeWebsiteScrapingClone(url, workflowOptions);
          
          spinner.succeed('Website clone completed successfully!');
          
          // Display results
          console.log('\n' + chalk.green('🌐 Clone Results:'));
          console.log(`Original URL: ${chalk.cyan(result.originalUrl)}`);
          console.log(`Project path: ${chalk.cyan(result.projectPath)}`);
          console.log(`Components: ${chalk.yellow(result.components?.length || 0)}`);
          console.log(`Assets: ${chalk.yellow(result.assets?.length || 0)}`);
          console.log(`Screenshots: ${chalk.yellow(result.screenshots?.length || 0)}`);
          console.log(`Framework: ${chalk.cyan(result.framework)}`);
          console.log(`Build ready: ${result.buildReady ? chalk.green('Yes') : chalk.red('No')}`);
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }

          // Save results if requested
          if (options.saveResults && currentWorkflow) {
            await saveResults(currentWorkflow.id, result, options.output);
          }

          // Show next steps
          console.log('\n' + chalk.blue('🚀 Next Steps:'));
          console.log(`1. Navigate to: ${chalk.cyan(result.projectPath)}`);
          console.log(`2. Install dependencies: ${chalk.cyan('npm install')}`);
          console.log(`3. Start development: ${chalk.cyan('npm run dev')}`);
          console.log(`4. Compare with original: ${chalk.cyan(url)}`);

        } catch (error) {
          spinner.fail('Website clone failed');
          console.error(chalk.red('Error:'), error.message);
          
          if (currentWorkflow) {
            displayWorkflowProgress(currentWorkflow);
          }
          
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Batch Process Command
 */
export function createBatchProcessCommand(): Command {
  const command = new Command('batch-process')
    .description('Process multiple inputs in batch')
    .option('--type <type>', 'Workflow type (gemini, figma, website)', 'gemini')
    .option('--input <file>', 'JSON file with batch inputs')
    .option('--concurrent <num>', 'Max concurrent workflows', CLI_CONFIG.maxConcurrentWorkflows.toString())
    .option('-o, --output <dir>', 'Output directory', CLI_CONFIG.outputDir)
    .option('--save-results', 'Save results to file', CLI_CONFIG.saveResults)
    .option('--log-level <level>', 'Log level (debug, info, warn, error)', CLI_CONFIG.logLevel)
    .action(async (options: any) => {
      try {
        // Validate input file
        if (!options.input) {
          console.error(chalk.red('❌ Input file is required. Use --input <file>'));
          process.exit(1);
        }

        let batchData;
        try {
          const inputData = await fs.readFile(options.input, 'utf8');
          batchData = JSON.parse(inputData);
        } catch (error) {
          console.error(chalk.red('❌ Failed to read input file:'), error.message);
          process.exit(1);
        }

        // Initialize suite
        const { batchProcessor } = await initializeDesignCloningSuite({
          ...options,
          maxConcurrent: parseInt(options.concurrent)
        });

        if (!batchProcessor) {
          throw new Error('Batch processor not initialized');
        }

        // Start batch processing
        const spinner = ora(`Processing ${batchData.length} items in batch...`).start();
        
        let completed = 0;
        let failed = 0;

        // Listen for batch events
        batchProcessor.on('batchWorkflowCompleted', () => {
          completed++;
          spinner.text = `Batch progress: ${completed}/${batchData.length} completed, ${failed} failed`;
        });

        batchProcessor.on('batchWorkflowFailed', () => {
          failed++;
          spinner.text = `Batch progress: ${completed}/${batchData.length} completed, ${failed} failed`;
        });

        try {
          let result;
          
          switch (options.type) {
            case 'gemini':
              result = await batchProcessor.processBatchGeminiStyle(batchData, {
                outputDir: options.output
              });
              break;
            case 'website':
              result = await batchProcessor.processBatchWebsiteScraping(batchData, {
                outputDir: options.output
              });
              break;
            case 'figma':
              // For figma batch, batchData should be array of design file arrays
              result = await batchProcessor.processBatch('figma_batch', 
                batchData.map((designs: any) => ({
                  type: WorkflowType.FIGMA_STYLE,
                  input: designs,
                  options: { outputDir: options.output }
                }))
              );
              break;
            default:
              throw new Error(`Unknown workflow type: ${options.type}`);
          }
          
          spinner.succeed('Batch processing completed!');
          
          // Display results
          console.log('\n' + chalk.green('📊 Batch Results:'));
          console.log(`Total items: ${chalk.yellow(batchData.length)}`);
          console.log(`Successful: ${chalk.green(result.successful.length)}`);
          console.log(`Failed: ${chalk.red(result.failed.length)}`);
          console.log(`Execution time: ${chalk.yellow((result.executionTime / 1000).toFixed(2))}s`);

          // Show failures if any
          if (result.failed.length > 0) {
            console.log('\n' + chalk.red('❌ Failed Items:'));
            result.failed.forEach((failure: any, index: number) => {
              console.log(`  ${index + 1}. ${failure.workflow.input} - ${failure.error.message}`);
            });
          }

          // Save results if requested
          if (options.saveResults) {
            await saveResults(result.batchId, result, options.output);
          }

        } catch (error) {
          spinner.fail('Batch processing failed');
          console.error(chalk.red('Error:'), error.message);
          process.exit(1);
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Status Command
 */
export function createStatusCommand(): Command {
  const command = new Command('status')
    .description('Show workflow and server status')
    .option('--workflow <id>', 'Show specific workflow status')
    .option('--servers', 'Show server status', false)
    .option('--metrics', 'Show performance metrics', false)
    .option('--refresh <seconds>', 'Auto-refresh interval in seconds')
    .action(async (options: any) => {
      try {
        // Initialize suite
        const { designCloningSuite, workflowCoordinator } = await initializeDesignCloningSuite(options);

        const showStatus = async () => {
          console.clear();
          console.log(chalk.blue.bold('🔍 Design Cloning Suite Status\n'));

          // Show specific workflow
          if (options.workflow) {
            const workflow = designCloningSuite.getWorkflowStatus(options.workflow);
            if (workflow) {
              displayWorkflowProgress(workflow);
            } else {
              console.log(chalk.red(`❌ Workflow not found: ${options.workflow}`));
            }
            return;
          }

          // Show active workflows
          const activeWorkflows = designCloningSuite.getActiveWorkflows();
          if (activeWorkflows.length > 0) {
            console.log(chalk.green('🔄 Active Workflows:'));
            activeWorkflows.forEach((workflow: any) => {
              console.log(`  ${workflow.id} - ${getStatusColor(workflow.status)} (${workflow.type})`);
            });
            console.log();
          } else {
            console.log(chalk.gray('No active workflows\n'));
          }

          // Show recent workflow history
          const history = designCloningSuite.getWorkflowHistory(5);
          if (history.length > 0) {
            console.log(chalk.blue('📜 Recent Workflows:'));
            history.forEach((workflow: any) => {
              const duration = workflow.executionTime ? 
                `(${(workflow.executionTime / 1000).toFixed(2)}s)` : '';
              console.log(`  ${workflow.id} - ${getStatusColor(workflow.status)} ${duration}`);
            });
            console.log();
          }

          // Show server status
          if (options.servers && workflowCoordinator) {
            console.log(chalk.blue('🖥️  Server Status:'));
            const serverStatuses = workflowCoordinator.getAllServersStatus();
            Object.entries(serverStatuses).forEach(([name, status]: [string, any]) => {
              const stateColor = status.state === 'running' ? chalk.green : 
                                status.state === 'error' ? chalk.red : chalk.gray;
              console.log(`  ${name}: ${stateColor(status.state)} ${status.port ? `(port ${status.port})` : ''}`);
            });
            console.log();
          }

          // Show performance metrics
          if (options.metrics) {
            const metrics = designCloningSuite.getPerformanceMetrics();
            console.log(chalk.blue('📈 Performance Metrics:'));
            console.log(`  Total workflows: ${chalk.yellow(metrics.totalWorkflows)}`);
            console.log(`  Success rate: ${chalk.green(metrics.successRate)}`);
            console.log(`  Average execution time: ${chalk.yellow((metrics.averageExecutionTime / 1000).toFixed(2))}s`);
            
            if (workflowCoordinator) {
              const serverMetrics = workflowCoordinator.getPerformanceMetrics();
              console.log(`  Active servers: ${chalk.cyan(serverMetrics.activeServers)}/${serverMetrics.totalServers}`);
              console.log(`  Servers started: ${chalk.yellow(serverMetrics.totalServersStarted)}`);
              console.log(`  Server restarts: ${chalk.yellow(serverMetrics.totalServersRestarted)}`);
            }
          }

          if (options.refresh) {
            console.log(chalk.gray(`\nRefreshing every ${options.refresh} seconds... (Press Ctrl+C to exit)`));
          }
        };

        // Show status once or start refresh loop
        await showStatus();

        if (options.refresh) {
          const refreshInterval = parseInt(options.refresh) * 1000;
          setInterval(showStatus, refreshInterval);
          
          // Keep process alive
          process.stdin.setRawMode(true);
          process.stdin.resume();
          process.stdin.on('data', (key) => {
            if (key.toString() === '\u0003') { // Ctrl+C
              process.exit(0);
            }
          });
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Optimize Command
 */
export function createOptimizeCommand(): Command {
  const command = new Command('optimize')
    .description('Optimize server resources and performance')
    .option('--force', 'Force optimization even if not needed', false)
    .option('--restart-unhealthy', 'Restart unhealthy servers', true)
    .option('--log-level <level>', 'Log level (debug, info, warn, error)', CLI_CONFIG.logLevel)
    .action(async (options: any) => {
      try {
        // Initialize suite
        const { workflowCoordinator } = await initializeDesignCloningSuite(options);

        if (!workflowCoordinator) {
          throw new Error('Workflow coordinator not initialized');
        }

        const spinner = ora('Analyzing system resources...').start();

        try {
          // Perform optimization
          const optimizations = await workflowCoordinator.optimizeResources();
          
          if (optimizations.length > 0) {
            spinner.succeed(`Applied ${optimizations.length} optimizations`);
            
            console.log('\n' + chalk.green('🔧 Optimizations Applied:'));
            optimizations.forEach((opt: any, index: number) => {
              console.log(`  ${index + 1}. ${opt.server}: ${opt.action} (${opt.issue})`);
            });
          } else {
            spinner.succeed('System is already optimized');
          }

          // Show current metrics
          const metrics = workflowCoordinator.getPerformanceMetrics();
          console.log('\n' + chalk.blue('📊 Current System Status:'));
          console.log(`Active servers: ${chalk.cyan(metrics.activeServers)}/${metrics.totalServers}`);
          console.log(`Used ports: ${chalk.yellow(metrics.usedPorts)}`);
          console.log(`Queued startups: ${chalk.yellow(metrics.queuedStartups)}`);

        } catch (error) {
          spinner.fail('Optimization failed');
          throw error;
        }

      } catch (error) {
        console.error(chalk.red('Command failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Interactive Setup Command
 */
export function createSetupCommand(): Command {
  const command = new Command('setup')
    .description('Interactive setup for design cloning workflows')
    .action(async () => {
      try {
        console.log(chalk.blue.bold('🎨 Design Cloning Suite Setup\n'));

        const answers = await inquirer.prompt([
          {
            type: 'list',
            name: 'workflowType',
            message: 'What type of workflow do you want to set up?',
            choices: [
              { name: '🖼️  Gemini-style: Single screenshot to complete clone', value: 'gemini' },
              { name: '📚 Figma-style: Multiple designs to component library', value: 'figma' },
              { name: '🌐 Website-scraping: URL to complete website clone', value: 'website' }
            ]
          },
          {
            type: 'input',
            name: 'outputDir',
            message: 'Output directory:',
            default: './output'
          },
          {
            type: 'list',
            name: 'framework',
            message: 'Target framework:',
            choices: ['nextjs', 'react', 'vue'],
            default: 'nextjs'
          },
          {
            type: 'confirm',
            name: 'typescript',
            message: 'Use TypeScript?',
            default: false
          },
          {
            type: 'confirm',
            name: 'saveResults',
            message: 'Save workflow results to file?',
            default: true
          }
        ]);

        // Generate command based on answers
        let command = '';
        switch (answers.workflowType) {
          case 'gemini':
            command = `claude-flow design-cloning gemini-clone <screenshot>`;
            break;
          case 'figma':
            command = `claude-flow design-cloning figma-library <design-files...>`;
            break;
          case 'website':
            command = `claude-flow design-cloning website-clone <url>`;
            break;
        }

        if (answers.outputDir !== './output') {
          command += ` --output "${answers.outputDir}"`;
        }
        if (answers.framework !== 'nextjs') {
          command += ` --framework ${answers.framework}`;
        }
        if (answers.typescript) {
          command += ` --typescript`;
        }
        if (!answers.saveResults) {
          command += ` --no-save-results`;
        }

        console.log('\n' + chalk.green('✅ Setup completed!'));
        console.log('\n' + chalk.blue('🚀 Run this command to get started:'));
        console.log(chalk.cyan(command));

        // Create output directory if it doesn't exist
        try {
          await fs.mkdir(answers.outputDir, { recursive: true });
          console.log(`\n📁 Created output directory: ${chalk.cyan(answers.outputDir)}`);
        } catch (error) {
          console.warn(chalk.yellow(`⚠️  Could not create output directory: ${error.message}`));
        }

      } catch (error) {
        console.error(chalk.red('Setup failed:'), error.message);
        process.exit(1);
      }
    });

  return command;
}

/**
 * Create main design cloning command with subcommands
 */
export function createDesignCloningCommand(): Command {
  const command = new Command('design-cloning')
    .alias('dc')
    .description('Design cloning workflows (2AS Design Cloning Suite)')
    .addHelpText('before', chalk.blue.bold('🎨 2AS Design Cloning Suite\n'))
    .addHelpText('after', `
${chalk.blue('Examples:')}
  ${chalk.gray('# Clone from screenshot')}
  claude-flow dc gemini-clone screenshot.png --typescript --output ./my-clone

  ${chalk.gray('# Build component library')}
  claude-flow dc figma-library design1.png design2.png --storybook

  ${chalk.gray('# Clone entire website')}
  claude-flow dc website-clone https://example.com --responsive

  ${chalk.gray('# Batch process multiple screenshots')}
  claude-flow dc batch-process --type gemini --input batch.json

  ${chalk.gray('# Monitor workflow status')}
  claude-flow dc status --servers --metrics --refresh 5
`);

  // Add subcommands
  command.addCommand(createGeminiCloneCommand());
  command.addCommand(createFigmaLibraryCommand());
  command.addCommand(createWebsiteCloneCommand());
  command.addCommand(createBatchProcessCommand());
  command.addCommand(createStatusCommand());
  command.addCommand(createOptimizeCommand());
  command.addCommand(createSetupCommand());

  return command;
}

export default createDesignCloningCommand;