import { getErrorMessage } from '../../utils/type-guards.js';
import chalk from 'chalk';
import { createCompatibleUI } from './compatible-ui.js';
export async function handleRawModeError(error, options = {}) {
    const isRawModeError = (error instanceof Error ? error.message : String(error)).includes('Raw mode is not supported') || (error instanceof Error ? error.message : String(error)).includes('stdin') || (error instanceof Error ? error.message : String(error)).includes('Ink');
    if (!isRawModeError) {
        throw error;
    }
    console.clear();
    console.log(chalk.yellow.bold('⚠️  Interactive Mode Not Supported'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.white('The current terminal environment does not support'));
    console.log(chalk.white('interactive UI features (raw mode).'));
    console.log();
    console.log(chalk.cyan('Common causes:'));
    console.log(chalk.gray('• VS Code integrated terminal'));
    console.log(chalk.gray('• WSL (Windows Subsystem for Linux)'));
    console.log(chalk.gray('• Native Windows terminals'));
    console.log(chalk.gray('• CI/CD environments'));
    console.log(chalk.gray('• Docker containers'));
    console.log(chalk.gray('• SSH sessions without TTY'));
    console.log();
    if (options.fallbackMessage) {
        console.log(chalk.blue('ℹ️  '), options.fallbackMessage);
        console.log();
    }
    if (options.enableUI) {
        console.log(chalk.green('✅ Launching compatible UI mode...'));
        console.log();
        try {
            const ui = createCompatibleUI();
            await ui.start();
        } catch (fallbackError) {
            console.log(chalk.red('❌ Fallback UI also failed:'), getErrorMessage(fallbackError));
            await showBasicInterface(options);
        }
    } else {
        await showBasicInterface(options);
    }
}
async function showBasicInterface(options) {
    console.log(chalk.green('📋 Available alternatives:'));
    console.log();
    console.log(chalk.white('1. Use CLI commands directly:'));
    console.log(chalk.gray('   ./claude-flow status'));
    console.log(chalk.gray('   ./claude-flow memory list'));
    console.log(chalk.gray('   ./claude-flow sparc modes'));
    console.log();
    console.log(chalk.white('2. Use non-interactive modes:'));
    console.log(chalk.gray('   ./claude-flow start (without --ui)'));
    console.log(chalk.gray('   ./claude-flow swarm "task" --monitor'));
    console.log();
    console.log(chalk.white('3. Use external terminal:'));
    console.log(chalk.gray('   Run in a standalone terminal application'));
    console.log();
    if (options.showHelp) {
        console.log(chalk.cyan('💡 For help with any command, use:'));
        console.log(chalk.gray('   ./claude-flow help <command>'));
        console.log(chalk.gray('   ./claude-flow <command> --help'));
        console.log();
    }
    console.log(chalk.gray('Press Ctrl+C to exit'));
    await new Promise(()=>{
        process.on('SIGINT', ()=>{
            console.log(chalk.green('\n👋 Goodbye!'));
            process.exit(0);
        });
    });
}
export function withRawModeFallback(fn, fallbackOptions = {}) {
    return async (...args)=>{
        try {
            return await fn(...args);
        } catch (error) {
            if (error instanceof Error) {
                await handleRawModeError(error, fallbackOptions);
            } else {
                throw error;
            }
        }
    };
}
export function checkUISupport() {
    if (!process.stdin.isTTY) {
        return {
            supported: false,
            reason: 'Not running in a TTY environment',
            recommendation: 'Use a proper terminal application'
        };
    }
    if (typeof process.stdin.setRawMode !== 'function') {
        return {
            supported: false,
            reason: 'Raw mode not available',
            recommendation: 'Use --no-ui flag or run in external terminal'
        };
    }
    if (process.env.TERM_PROGRAM === 'vscode') {
        return {
            supported: false,
            reason: 'Running in VS Code integrated terminal',
            recommendation: 'Use VS Code external terminal or standalone terminal'
        };
    }
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
        return {
            supported: false,
            reason: 'Running in CI/CD environment',
            recommendation: 'Use non-interactive mode'
        };
    }
    return {
        supported: true
    };
}
export function showUISupport() {
    const support = checkUISupport();
    console.log(chalk.cyan.bold('🖥️  UI Support Information'));
    console.log(chalk.gray('─'.repeat(40)));
    if (support.supported) {
        console.log(chalk.green('✅ Interactive UI supported'));
        console.log(chalk.gray('Your terminal supports all UI features'));
    } else {
        console.log(chalk.yellow('⚠️  Limited UI support'));
        console.log(chalk.gray(`Reason: ${support.reason}`));
        if (support.recommendation) {
            console.log(chalk.blue(`Recommendation: ${support.recommendation}`));
        }
    }
    console.log();
    console.log(chalk.white('Environment details:'));
    console.log(chalk.gray(`• Terminal: ${process.env.TERM || 'unknown'}`));
    console.log(chalk.gray(`• TTY: ${process.stdin.isTTY ? 'yes' : 'no'}`));
    console.log(chalk.gray(`• Program: ${process.env.TERM_PROGRAM || 'unknown'}`));
    console.log(chalk.gray(`• Platform: ${process.platform}`));
}

//# sourceMappingURL=fallback-handler.js.map