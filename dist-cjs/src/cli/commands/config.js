#!/usr/bin/env node
import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import { ConfigManager } from '../../core/config.js';
const configManager = ConfigManager.getInstance();
export const configCommand = new Command('config').description('Configuration management commands');
configCommand.command('get').arguments('<key>').description('Get configuration value').action(async (key)=>{
    try {
        const value = configManager.getValue(key);
        console.log(chalk.green('✓'), `${key}:`, JSON.stringify(value, null, 2));
    } catch (error) {
        console.error(chalk.red('Failed to get configuration:'), error.message);
        process.exit(1);
    }
});
configCommand.command('set').arguments('<key> <value>').description('Set configuration value').action(async (key, value)=>{
    try {
        let parsedValue = value;
        try {
            parsedValue = JSON.parse(value);
        } catch  {}
        await configManager.set(key, parsedValue);
        console.log(chalk.green('✓'), `Configuration updated: ${key} = ${JSON.stringify(parsedValue)}`);
    } catch (error) {
        console.error(chalk.red('Failed to set configuration:'), error.message);
        process.exit(1);
    }
});
configCommand.command('list').description('List all configuration values').option('--json', 'Output as JSON').action(async (options)=>{
    try {
        const config = await configManager.getAll();
        if (options.json) {
            console.log(JSON.stringify(config, null, 2));
        } else {
            console.log(chalk.cyan.bold('Configuration:'));
            console.log('─'.repeat(40));
            for (const [key, value] of Object.entries(config)){
                console.log(`${chalk.yellow(key)}: ${JSON.stringify(value)}`);
            }
        }
    } catch (error) {
        console.error(chalk.red('Failed to list configuration:'), error.message);
        process.exit(1);
    }
});
configCommand.command('reset').description('Reset configuration to defaults').option('--force', 'Skip confirmation').action(async (options)=>{
    try {
        if (!options.force) {
            console.log(chalk.yellow('This will reset all configuration to defaults.'));
        }
        await configManager.reset();
        console.log(chalk.green('✓'), 'Configuration reset to defaults');
    } catch (error) {
        console.error(chalk.red('Failed to reset configuration:'), error.message);
        process.exit(1);
    }
});
export default configCommand;

//# sourceMappingURL=config.js.map