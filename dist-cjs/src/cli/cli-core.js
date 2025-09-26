#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra';
export const VERSION = '1.0.45';
let CLI = class CLI {
    name;
    description;
    commands = new Map();
    globalOptions = [
        {
            name: 'help',
            short: 'h',
            description: 'Show help',
            type: 'boolean'
        },
        {
            name: 'version',
            short: 'v',
            description: 'Show version',
            type: 'boolean'
        },
        {
            name: 'config',
            short: 'c',
            description: 'Path to configuration file',
            type: 'string'
        },
        {
            name: 'verbose',
            description: 'Enable verbose logging',
            type: 'boolean'
        },
        {
            name: 'log-level',
            description: 'Set log level (debug, info, warn, error)',
            type: 'string',
            default: 'info'
        }
    ];
    constructor(name, description){
        this.name = name;
        this.description = description;
    }
    command(cmd) {
        const cmdName = typeof cmd.name === 'function' ? cmd.name() : cmd.name || 'unknown';
        this.commands.set(cmdName, cmd);
        if (cmd.aliases && typeof cmd.aliases[Symbol.iterator] === 'function') {
            for (const alias of cmd.aliases){
                this.commands.set(alias, cmd);
            }
        }
        return this;
    }
    async run(args = process.argv.slice(2)) {
        const flags = this.parseArgs(args);
        if (flags.version || flags.v) {
            console.log(`${this.name} v${VERSION}`);
            return;
        }
        const commandName = flags._[0]?.toString() || '';
        if (!commandName || flags.help || flags.h) {
            this.showHelp();
            return;
        }
        const command = this.commands.get(commandName);
        if (!command) {
            console.error(chalk.red(`Unknown command: ${commandName}`));
            console.log(`Run "${this.name} help" for available commands`);
            process.exit(1);
        }
        const ctx = {
            args: flags._.slice(1).map(String),
            flags: flags,
            config: await this.loadConfig(flags.config)
        };
        try {
            if (command.action) {
                await command.action(ctx);
            } else {
                console.log(chalk.yellow(`Command '${commandName}' has no action defined`));
            }
        } catch (error) {
            console.error(chalk.red(`Error executing command '${commandName}':`), error.message);
            if (flags.verbose) {
                console.error(error);
            }
            process.exit(1);
        }
    }
    parseArgs(args) {
        const result = {
            _: []
        };
        let i = 0;
        while(i < args.length){
            const arg = args[i];
            if (arg.startsWith('--')) {
                const key = arg.slice(2);
                if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    result[key] = args[i + 1];
                    i += 2;
                } else {
                    result[key] = true;
                    i++;
                }
            } else if (arg.startsWith('-')) {
                const key = arg.slice(1);
                if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    result[key] = args[i + 1];
                    i += 2;
                } else {
                    result[key] = true;
                    i++;
                }
            } else {
                result._.push(arg);
                i++;
            }
        }
        return result;
    }
    async loadConfig(configPath) {
        const configFile = configPath || 'claude-flow.config.json';
        try {
            const content = await fs.readFile(configFile, 'utf8');
            return JSON.parse(content);
        } catch  {
            return undefined;
        }
    }
    getBooleanFlags() {
        const flags = [];
        for (const opt of [
            ...this.globalOptions,
            ...this.getAllOptions()
        ]){
            if (opt.type === 'boolean') {
                flags.push(opt.name);
                if (opt.short) flags.push(opt.short);
            }
        }
        return flags;
    }
    getStringFlags() {
        const flags = [];
        for (const opt of [
            ...this.globalOptions,
            ...this.getAllOptions()
        ]){
            if (opt.type === 'string' || opt.type === 'number') {
                flags.push(opt.name);
                if (opt.short) flags.push(opt.short);
            }
        }
        return flags;
    }
    getAliases() {
        const aliases = {};
        for (const opt of [
            ...this.globalOptions,
            ...this.getAllOptions()
        ]){
            if (opt.short) {
                aliases[opt.short] = opt.name;
            }
        }
        return aliases;
    }
    getDefaults() {
        const defaults = {};
        for (const opt of [
            ...this.globalOptions,
            ...this.getAllOptions()
        ]){
            if (opt.default !== undefined) {
                defaults[opt.name] = opt.default;
            }
        }
        return defaults;
    }
    getAllOptions() {
        const options = [];
        for (const cmd of this.commands.values()){
            if (cmd.options) {
                options.push(...cmd.options);
            }
        }
        return options;
    }
    showHelp() {
        console.log(`
${chalk.bold(chalk.blue(`🧠 ${this.name} v${VERSION}`))} - ${this.description}

${chalk.bold('USAGE:')}
  ${this.name} [COMMAND] [OPTIONS]

${chalk.bold('COMMANDS:')}
${this.formatCommands()}

${chalk.bold('GLOBAL OPTIONS:')}
${this.formatOptions(this.globalOptions)}

${chalk.bold('EXAMPLES:')}
  ${this.name} start                                    # Start orchestrator
  ${this.name} agent spawn researcher --name "Bot"     # Spawn research agent
  ${this.name} task create research "Analyze data"     # Create task
  ${this.name} config init                             # Initialize config
  ${this.name} status                                  # Show system status

For more detailed help on specific commands, use:
  ${this.name} [COMMAND] --help

Documentation: https://github.com/ruvnet/claude-code-flow
Issues: https://github.com/ruvnet/claude-code-flow/issues

Created by rUv - Built with ❤️ for the Claude community
`);
    }
    formatCommands() {
        const commands = Array.from(new Set(this.commands.values()));
        return commands.filter((cmd)=>cmd && cmd.name).map((cmd)=>`  ${String(cmd.name).padEnd(20)} ${cmd.description || ''}`).join('\n');
    }
    formatOptions(options) {
        return options.map((opt)=>{
            const flags = opt.short ? `-${opt.short}, --${opt.name}` : `    --${opt.name}`;
            return `  ${flags.padEnd(25)} ${opt.description}`;
        }).join('\n');
    }
};
function success(message) {
    console.log(chalk.green(`✅ ${message}`));
}
function error(message) {
    console.error(chalk.red(`❌ ${message}`));
}
function warning(message) {
    console.warn(chalk.yellow(`⚠️  ${message}`));
}
function info(message) {
    console.log(chalk.blue(`ℹ️  ${message}`));
}
export { CLI, success, error, warning, info };
async function main() {
    if (process.argv[1] && (process.argv[1].endsWith('cli-core.js') || process.argv[1].endsWith('cli-core.ts'))) {
        const cli = new CLI('claude-flow', 'Advanced AI Agent Orchestration System');
        const { setupCommands } = await import('./commands/index.js');
        setupCommands(cli);
        await cli.run();
    }
}
main().catch(console.error);

//# sourceMappingURL=cli-core.js.map