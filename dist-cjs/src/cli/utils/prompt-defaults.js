import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
export class PromptDefaultsManager {
    config = {};
    configPath;
    environmentDefaults = new Map();
    constructor(configPath){
        this.configPath = configPath || join(homedir(), '.claude-flow', 'prompt-defaults.json');
        this.loadConfig();
        this.loadEnvironmentDefaults();
    }
    loadConfig() {
        try {
            if (existsSync(this.configPath)) {
                const content = readFileSync(this.configPath, 'utf-8');
                this.config = JSON.parse(content);
            }
        } catch (error) {
            this.config = {};
        }
    }
    saveConfig() {
        try {
            const dir = join(this.configPath, '..');
            if (!existsSync(dir)) {
                require('fs').mkdirSync(dir, {
                    recursive: true
                });
            }
            writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {}
    }
    loadEnvironmentDefaults() {
        const env = process.env;
        if (env.CLAUDE_AUTO_APPROVE === '1' || env.CLAUDE_AUTO_APPROVE === 'true') {
            this.environmentDefaults.set('confirm:*', true);
        }
        if (env.CLAUDE_DEFAULT_MODEL) {
            this.environmentDefaults.set('select:model', env.CLAUDE_DEFAULT_MODEL);
        }
        if (env.CLAUDE_DEFAULT_REGION) {
            this.environmentDefaults.set('select:region', env.CLAUDE_DEFAULT_REGION);
        }
        if (env.CLAUDE_PROMPT_DEFAULTS) {
            try {
                const defaults = JSON.parse(env.CLAUDE_PROMPT_DEFAULTS);
                Object.entries(defaults).forEach(([key, value])=>{
                    this.environmentDefaults.set(key, value);
                });
            } catch (error) {}
        }
    }
    getDefault(promptId, command, promptType) {
        const envKey = `${promptType || 'text'}:${promptId}`;
        if (this.environmentDefaults.has(envKey)) {
            return this.environmentDefaults.get(envKey);
        }
        const wildcardKey = `${promptType || 'text'}:*`;
        if (this.environmentDefaults.has(wildcardKey)) {
            return this.environmentDefaults.get(wildcardKey);
        }
        if (command && this.config.command?.[command]) {
            const commandDefault = this.config.command[command].find((d)=>d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern));
            if (commandDefault) {
                return commandDefault.defaultValue;
            }
        }
        const currentEnv = process.env.NODE_ENV || 'development';
        if (this.config.environment?.[currentEnv]) {
            const envDefault = this.config.environment[currentEnv].find((d)=>d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern));
            if (envDefault) {
                return envDefault.defaultValue;
            }
        }
        if (this.config.global) {
            const globalDefault = this.config.global.find((d)=>d.id === promptId || d.pattern && this.matchPattern(promptId, d.pattern));
            if (globalDefault) {
                return globalDefault.defaultValue;
            }
        }
        return undefined;
    }
    setDefault(promptId, defaultValue, options = {}) {
        const defaultEntry = {
            id: promptId,
            type: options.type || 'text',
            defaultValue,
            description: options.description,
            pattern: options.pattern
        };
        const scope = options.scope || 'global';
        if (scope === 'command' && options.command) {
            if (!this.config.command) {
                this.config.command = {};
            }
            if (!this.config.command[options.command]) {
                this.config.command[options.command] = [];
            }
            this.config.command[options.command].push(defaultEntry);
        } else if (scope === 'environment') {
            const currentEnv = process.env.NODE_ENV || 'development';
            if (!this.config.environment) {
                this.config.environment = {};
            }
            if (!this.config.environment[currentEnv]) {
                this.config.environment[currentEnv] = [];
            }
            this.config.environment[currentEnv].push(defaultEntry);
        } else {
            if (!this.config.global) {
                this.config.global = [];
            }
            this.config.global.push(defaultEntry);
        }
        this.saveConfig();
    }
    getNonInteractiveDefaults() {
        return {
            'confirm:continue': true,
            'confirm:overwrite': true,
            'confirm:delete': false,
            'confirm:deploy': false,
            'select:model': 'claude-3-opus-20240229',
            'select:region': 'us-east-1',
            'select:topology': 'hierarchical',
            'select:strategy': 'auto',
            'text:projectName': 'claude-flow-project',
            "text:description": 'Claude Flow AI Project',
            'number:maxAgents': 4,
            'number:timeout': 30000,
            'number:port': 3000
        };
    }
    applyNonInteractiveDefaults(isNonInteractive) {
        if (!isNonInteractive) return;
        const defaults = this.getNonInteractiveDefaults();
        Object.entries(defaults).forEach(([key, value])=>{
            if (!this.environmentDefaults.has(key)) {
                this.environmentDefaults.set(key, value);
            }
        });
    }
    matchPattern(promptId, pattern) {
        if (typeof pattern === 'string') {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            return regex.test(promptId);
        } else {
            return pattern.test(promptId);
        }
    }
    exportConfig() {
        return JSON.parse(JSON.stringify(this.config));
    }
    importConfig(config) {
        this.config = JSON.parse(JSON.stringify(config));
        this.saveConfig();
    }
    clearDefaults(scope, target) {
        if (scope === 'command' && target && this.config.command) {
            delete this.config.command[target];
        } else if (scope === 'environment' && target && this.config.environment) {
            delete this.config.environment[target];
        } else if (scope === 'global' || !scope) {
            this.config.global = [];
        }
        this.saveConfig();
    }
}
let instance = null;
export function getPromptDefaultsManager(configPath) {
    if (!instance) {
        instance = new PromptDefaultsManager(configPath);
    }
    return instance;
}
export function getPromptDefault(promptId, command, promptType) {
    return getPromptDefaultsManager().getDefault(promptId, command, promptType);
}
export function applyNonInteractiveDefaults(flags) {
    const manager = getPromptDefaultsManager();
    const isNonInteractive = flags.nonInteractive || flags['non-interactive'] || flags.ci || !process.stdout.isTTY;
    manager.applyNonInteractiveDefaults(isNonInteractive);
}

//# sourceMappingURL=prompt-defaults.js.map