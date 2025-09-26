#!/usr/bin/env -S deno run --allow-all
import './simple-cli.ts';
import { Command } from './commander-fix.js';
import chalk from 'chalk';
import { logger } from '../core/logger.js';
import { configManager } from '../core/config.js';
import { formatError, displayBanner, displayVersion } from './formatter.js';
import { startREPL } from './repl.js';
import { CompletionGenerator } from './completion.js';
import { VERSION, BUILD_DATE } from '../core/version.js';
const cli = new Command().name('claude-flow').version(VERSION).description('Claude-Flow: Advanced AI agent orchestration system for multi-agent coordination').option('-c, --config <path>', 'Path to configuration file', './claude-flow.config.json').option('-v, --verbose', 'Enable verbose logging').option('-q, --quiet', 'Suppress non-essential output').option('--log-level <level>', 'Set log level (debug, info, warn, error)', 'info').option('--no-color', 'Disable colored output').option('--json', 'Output in JSON format where applicable').option('--profile <profile>', 'Use named configuration profile').action(async (options)=>{
    await setupLogging(options);
    if (!options.quiet) {
        displayBanner(VERSION);
        console.log(chalk.gray('Type "help" for available commands or "exit" to quit.\n'));
    }
    await startREPL(options);
});
const replCommand = new Command('repl').description('Start interactive REPL mode with command completion').option('--no-banner', 'Skip welcome banner').option('--history-file <path>', 'Custom history file path').action(async (options)=>{
    await setupLogging(options);
    if (options.banner !== false) {
        displayBanner(VERSION);
    }
    await startREPL(options);
});
cli.addCommand(replCommand);
const versionCommand = new Command('version').description('Show detailed version information').option('--short', 'Show version number only').action(async (options)=>{
    if (options.short) {
        console.log(VERSION);
    } else {
        displayVersion(VERSION, BUILD_DATE);
    }
});
cli.addCommand(versionCommand);
const completionCommand = new Command('completion').description("Generate shell completion scripts").argument('[shell]', 'Shell type').option('--install', "Install completion script automatically").action(async (shell, options)=>{
    const generator = new CompletionGenerator();
    await generator.generate(shell || 'detect', options.install === true);
});
cli.addCommand(completionCommand);
async function handleError(error, options) {
    const formatted = formatError(error);
    if (options?.json) {
        console.error(JSON.stringify({
            error: true,
            message: formatted,
            timestamp: new Date().toISOString()
        }));
    } else {
        console.error(chalk.red(chalk.bold('✗ Error:')), formatted);
    }
    if (process.env['CLAUDE_FLOW_DEBUG'] === 'true' || options?.verbose) {
        console.error(chalk.gray('\nStack trace:'));
        console.error(error);
    }
    if (!options?.quiet) {
        console.error(chalk.gray('\nTry running with --verbose for more details'));
        console.error(chalk.gray('Or use "claude-flow help" to see available commands'));
    }
    process.exit(1);
}
async function setupLogging(options) {
    let logLevel = options.logLevel;
    if (options.verbose) logLevel = 'debug';
    if (options.quiet) logLevel = 'warn';
    await logger.configure({
        level: logLevel,
        format: options.json ? 'json' : 'text',
        destination: 'console'
    });
    try {
        if (options.config) {
            await configManager.load(options.config);
        } else {
            try {
                await configManager.load('./claude-flow.config.json');
            } catch  {
                configManager.loadDefault();
            }
        }
        if (options.profile) {
            await configManager.applyProfile(options.profile);
        }
    } catch (error) {
        logger.warn('Failed to load configuration:', error.message);
        configManager.loadDefault();
    }
}
function setupSignalHandlers() {
    const gracefulShutdown = ()=>{
        console.log('\n' + chalk.gray('Gracefully shutting down...'));
        process.exit(0);
    };
    Deno.addSignalListener('SIGINT', gracefulShutdown);
    Deno.addSignalListener('SIGTERM', gracefulShutdown);
}
if (false) {
    let globalOptions = {};
    try {
        setupSignalHandlers();
        const args = Deno.args;
        globalOptions = {
            verbose: args.includes('-v') || args.includes('--verbose'),
            quiet: args.includes('-q') || args.includes('--quiet'),
            json: args.includes('--json'),
            noColor: args.includes('--no-color')
        };
        if (globalOptions.noColor) {}
        await cli.parse(args);
    } catch (error) {
        await handleError(error, globalOptions);
    }
}

//# sourceMappingURL=index.js.map