import chalk from 'chalk';
import { isInteractive, isRawModeSupported, getEnvironmentType } from './interactive-detector.js';
export function safeInteractive(interactiveFn, fallbackFn, options = {}) {
    return async function(...args) {
        const flags = args[args.length - 1] || {};
        if (flags.nonInteractive || flags['no-interactive']) {
            if (fallbackFn) {
                return fallbackFn(...args);
            } else {
                console.log(chalk.yellow('⚠️  Non-interactive mode requested but no fallback available'));
                console.log(chalk.gray('This command requires interactive mode to function properly'));
                process.exit(1);
            }
        }
        if (!isInteractive() || !isRawModeSupported()) {
            const envType = getEnvironmentType();
            if (!options.silent) {
                console.log(chalk.yellow('\n⚠️  Interactive mode not available'));
                console.log(chalk.gray(`Detected environment: ${envType}`));
                if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
                    console.log(chalk.gray('WSL detected - raw mode may cause process hangs'));
                    console.log(chalk.cyan('💡 Tip: Use --no-interactive flag or run in native Linux'));
                } else if (process.platform === 'win32') {
                    console.log(chalk.gray('Windows detected - terminal compatibility issues'));
                    console.log(chalk.cyan('💡 Tip: Use Windows Terminal or WSL2 for better experience'));
                } else if (process.env.TERM_PROGRAM === 'vscode') {
                    console.log(chalk.gray('VS Code terminal detected - limited interactive support'));
                    console.log(chalk.cyan('💡 Tip: Use external terminal for full functionality'));
                } else if (!isRawModeSupported()) {
                    console.log(chalk.gray('Terminal does not support raw mode'));
                }
                console.log();
            }
            if (fallbackFn) {
                return fallbackFn(...args);
            } else {
                console.log(chalk.red('❌ This command requires interactive mode'));
                console.log(chalk.gray('Please run in a compatible terminal environment'));
                process.exit(1);
            }
        }
        try {
            return await interactiveFn(...args);
        } catch (error) {
            if (error.message && (error.message.includes('setRawMode') || error.message.includes('raw mode') || error.message.includes('stdin') || error.message.includes('TTY'))) {
                console.log(chalk.yellow('\n⚠️  Interactive mode failed'));
                console.log(chalk.gray(error.message));
                if (fallbackFn) {
                    console.log(chalk.cyan('Falling back to non-interactive mode...'));
                    return fallbackFn(...args);
                } else {
                    console.log(chalk.red('❌ No non-interactive fallback available'));
                    process.exit(1);
                }
            }
            throw error;
        }
    };
}
export function nonInteractivePrompt(message, defaultValue) {
    console.log(chalk.gray(`📝 ${message}`));
    console.log(chalk.cyan(`   Using default: ${defaultValue}`));
    return defaultValue;
}
export function nonInteractiveSelect(message, choices, defaultChoice) {
    console.log(chalk.gray(`📋 ${message}`));
    console.log(chalk.gray('   Available choices:'));
    choices.forEach((choice)=>{
        const isDefault = choice === defaultChoice || choice.value === defaultChoice;
        console.log(chalk.gray(`   ${isDefault ? '▶' : ' '} ${choice.name || choice}`));
    });
    console.log(chalk.cyan(`   Using default: ${defaultChoice}`));
    return defaultChoice;
}
export function nonInteractiveProgress(message) {
    console.log(chalk.gray(`⏳ ${message}...`));
    return {
        update: (newMessage)=>{
            console.log(chalk.gray(`   ${newMessage}`));
        },
        succeed: (finalMessage)=>{
            console.log(chalk.green(`✅ ${finalMessage || message}`));
        },
        fail: (errorMessage)=>{
            console.log(chalk.red(`❌ ${errorMessage || 'Failed'}`));
        }
    };
}

//# sourceMappingURL=safe-interactive.js.map