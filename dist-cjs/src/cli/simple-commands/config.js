import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ProviderManager } from '../../execution/provider-manager.js';
export function createConfigCommand() {
    const config = new Command('config').description('Manage provider configuration');
    config.command('set-provider').description('Set default provider').argument('<provider>', 'Provider name (anthropic, openrouter, onnx, gemini)').option('-m, --model <model>', 'Default model for provider').action(async (provider, options)=>{
        try {
            const manager = new ProviderManager();
            await manager.setDefaultProvider(provider);
            if (options.model) {
                await manager.configureProvider(provider, {
                    model: options.model,
                    enabled: true
                });
            }
            console.log(chalk.green(`✓ Default provider set to: ${provider}`));
            if (options.model) {
                console.log(chalk.green(`✓ Default model set to: ${options.model}`));
            }
        } catch (error) {
            console.error(chalk.red('✗ Error:'), error.message);
            process.exit(1);
        }
    });
    config.command('list-providers').alias('list').description('List configured providers').option('-f, --format <format>', 'Output format (text, json)', 'text').action(async (options)=>{
        try {
            const manager = new ProviderManager();
            const providers = manager.listProviders();
            const defaultProvider = manager.getDefaultProvider();
            if (options.format === 'json') {
                console.log(JSON.stringify({
                    defaultProvider,
                    providers
                }, null, 2));
            } else {
                console.log(chalk.cyan('\n📋 Configured Providers:\n'));
                console.log(chalk.white(`Default: ${chalk.bold(defaultProvider)}\n`));
                providers.forEach((provider)=>{
                    const isDefault = provider.name === defaultProvider;
                    const prefix = isDefault ? chalk.green('●') : chalk.gray('○');
                    const status = provider.enabled ? chalk.green('enabled') : chalk.gray('disabled');
                    console.log(`${prefix} ${chalk.bold(provider.name)}`);
                    console.log(`  Model: ${provider.model || 'default'}`);
                    console.log(`  Priority: ${provider.priority || 'balanced'}`);
                    console.log(`  Status: ${status}`);
                    console.log('');
                });
            }
        } catch (error) {
            console.error(chalk.red('✗ Error:'), error.message);
            process.exit(1);
        }
    });
    config.command('wizard').description('Interactive provider configuration wizard').action(async ()=>{
        try {
            const manager = new ProviderManager();
            console.log(chalk.cyan('\n🧙 Provider Configuration Wizard\n'));
            const answers = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'defaultProvider',
                    message: 'Select default provider:',
                    choices: [
                        {
                            name: 'Anthropic (Highest quality)',
                            value: 'anthropic'
                        },
                        {
                            name: 'OpenRouter (99% cost savings)',
                            value: 'openrouter'
                        },
                        {
                            name: 'ONNX (Free local inference)',
                            value: 'onnx'
                        },
                        {
                            name: 'Gemini (Free tier)',
                            value: 'gemini'
                        }
                    ]
                },
                {
                    type: 'list',
                    name: 'optimization',
                    message: 'Optimization priority:',
                    choices: [
                        {
                            name: 'Balanced (recommended)',
                            value: 'balanced'
                        },
                        {
                            name: 'Cost (cheapest)',
                            value: 'cost'
                        },
                        {
                            name: 'Quality (best results)',
                            value: 'quality'
                        },
                        {
                            name: 'Speed (fastest)',
                            value: 'speed'
                        },
                        {
                            name: 'Privacy (local only)',
                            value: 'privacy'
                        }
                    ]
                }
            ]);
            await manager.setDefaultProvider(answers.defaultProvider);
            console.log(chalk.green('\n✓ Configuration saved successfully!'));
            console.log(chalk.gray(`\nDefault provider: ${answers.defaultProvider}`));
            console.log(chalk.gray(`Optimization: ${answers.optimization}`));
        } catch (error) {
            console.error(chalk.red('\n✗ Error:'), error.message);
            process.exit(1);
        }
    });
    return config;
}

//# sourceMappingURL=config.js.map printError('Configuration file not found');
        console.log('Run "claude-flow config init" to create configuration');
    }
}
async function setConfigValue(subArgs, flags) {
    const key = subArgs[1];
    const value = subArgs[2];
    const configFile = 'claude-flow.config.json';
    if (!key || value === undefined) {
        printError('Usage: config set <key> <value>');
        console.log('Examples:');
        console.log('  claude-flow config set terminal.poolSize 15');
        console.log('  claude-flow config set orchestrator.taskTimeout 600000');
        return;
    }
    try {
        let config = await readJsonFile(configFile, {});
        let parsedValue = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(value) && value.trim() !== '') parsedValue = Number(value);
        setNestedValue(config, key, parsedValue);
        await writeJsonFile(configFile, config);
        printSuccess(`Set ${key} = ${JSON.stringify(parsedValue)}`);
    } catch (err) {
        printError(`Failed to set configuration: ${err.message}`);
    }
}
async function validateConfig(subArgs, flags) {
    const configFile = 'claude-flow.config.json';
    try {
        const config = await readJsonFile(configFile);
        printSuccess('Validating configuration...');
        const errors = [];
        const warnings = [];
        const requiredSections = [
            'terminal',
            'orchestrator',
            'memory'
        ];
        for (const section of requiredSections){
            if (!config[section]) {
                errors.push(`Missing required section: ${section}`);
            }
        }
        if (config.terminal?.poolSize && (config.terminal.poolSize < 1 || config.terminal.poolSize > 100)) {
            warnings.push('Terminal pool size should be between 1 and 100');
        }
        if (config.orchestrator?.maxConcurrentTasks && config.orchestrator.maxConcurrentTasks < 1) {
            errors.push('Max concurrent tasks must be at least 1');
        }
        if (config.agents?.maxAgents && config.agents.maxAgents < 1) {
            errors.push('Max agents must be at least 1');
        }
        if (errors.length === 0 && warnings.length === 0) {
            printSuccess('✅ Configuration is valid');
        } else {
            if (errors.length > 0) {
                printError(`Found ${errors.length} error(s):`);
                errors.forEach((error)=>console.log(`  ❌ ${error}`));
            }
            if (warnings.length > 0) {
                printWarning(`Found ${warnings.length} warning(s):`);
                warnings.forEach((warning)=>console.log(`  ⚠️  ${warning}`));
            }
        }
    } catch (err) {
        printError('Configuration file not found or invalid');
        console.log('Run "claude-flow config init" to create valid configuration');
    }
}
async function resetConfig(subArgs, flags) {
    const force = subArgs.includes('--force') || subArgs.includes('-f');
    if (!force) {
        printWarning('This will reset configuration to defaults');
        console.log('Use --force to confirm reset');
        return;
    }
    await initConfig([
        '--force'
    ], flags);
    printSuccess('Configuration reset to defaults');
}
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, key)=>current?.[key], obj);
}
function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((current, key)=>{
        if (!current[key]) current[key] = {};
        return current[key];
    }, obj);
    target[last] = value;
}
function getFlag(args, flagName) {
    const index = args.indexOf(flagName);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}
function showConfigHelp() {
    console.log('Configuration commands:');
    console.log('  init [--force]                   Create default configuration');
    console.log('  show [--format json]             Display current configuration');
    console.log('  get <key>                        Get configuration value');
    console.log('  set <key> <value>                Set configuration value');
    console.log('  validate                         Validate configuration');
    console.log('  reset --force                    Reset to defaults');
    console.log();
    console.log('Configuration Keys:');
    console.log('  terminal.poolSize                Terminal pool size');
    console.log('  terminal.recycleAfter            Commands before recycle');
    console.log('  orchestrator.maxConcurrentTasks  Max parallel tasks');
    console.log('  orchestrator.taskTimeout         Task timeout in ms');
    console.log('  memory.backend                   Memory storage backend');
    console.log('  memory.path                      Memory database path');
    console.log('  agents.maxAgents                 Maximum number of agents');
    console.log();
    console.log('Examples:');
    console.log('  claude-flow config init');
    console.log('  claude-flow config set terminal.poolSize 15');
    console.log('  claude-flow config get orchestrator.maxConcurrentTasks');
    console.log('  claude-flow config validate');
}

//# sourceMappingURL=config.js.map