import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
const DEFAULT_CONFIG = {
    orchestrator: {
        maxConcurrentAgents: 10,
        taskQueueSize: 100,
        healthCheckInterval: 30000,
        shutdownTimeout: 30000
    },
    terminal: {
        type: 'auto',
        poolSize: 5,
        recycleAfter: 10,
        healthCheckInterval: 60000,
        commandTimeout: 300000
    },
    memory: {
        backend: 'hybrid',
        cacheSizeMB: 100,
        syncInterval: 5000,
        conflictResolution: 'crdt',
        retentionDays: 30
    },
    coordination: {
        maxRetries: 3,
        retryDelay: 1000,
        deadlockDetection: true,
        resourceTimeout: 60000,
        messageTimeout: 30000
    },
    mcp: {
        transport: 'stdio',
        port: 3000,
        tlsEnabled: false
    },
    logging: {
        level: 'info',
        format: 'json',
        destination: 'console'
    },
    ruvSwarm: {
        enabled: true,
        defaultTopology: 'mesh',
        maxAgents: 8,
        defaultStrategy: 'adaptive',
        autoInit: true,
        enableHooks: true,
        enablePersistence: true,
        enableNeuralTraining: true,
        configPath: '.claude/ruv-swarm-config.json'
    },
    claude: {
        model: 'claude-3-sonnet-20240229',
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1,
        timeout: 60000,
        retryAttempts: 3,
        retryDelay: 1000
    }
};
export class ConfigError extends Error {
    constructor(message){
        super(message);
        this.name = 'ConfigError';
    }
}
export class ConfigManager {
    static instance;
    config;
    configPath;
    userConfigDir;
    constructor(){
        this.config = this.deepClone(DEFAULT_CONFIG);
        this.userConfigDir = path.join(os.homedir(), '.claude-flow');
    }
    static getInstance() {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }
    async init(configPath = 'claude-flow.config.json') {
        try {
            await this.load(configPath);
            console.log(`✅ Configuration loaded from: ${configPath}`);
        } catch (error) {
            await this.createDefaultConfig(configPath);
            console.log(`✅ Default configuration created: ${configPath}`);
        }
    }
    async createDefaultConfig(configPath) {
        const config = this.deepClone(DEFAULT_CONFIG);
        const content = JSON.stringify(config, null, 2);
        await fs.writeFile(configPath, content, 'utf8');
        this.configPath = configPath;
    }
    async load(configPath) {
        if (configPath) {
            this.configPath = configPath;
        }
        if (!this.configPath) {
            throw new ConfigError('No configuration file path specified');
        }
        try {
            const content = await fs.readFile(this.configPath, 'utf8');
            const fileConfig = JSON.parse(content);
            this.config = this.deepMerge(DEFAULT_CONFIG, fileConfig);
            this.loadFromEnv();
            this.validate(this.config);
            return this.config;
        } catch (error) {
            if (error.code === 'ENOENT') {
                throw new ConfigError(`Configuration file not found: ${this.configPath}`);
            }
            throw new ConfigError(`Failed to load configuration: ${error.message}`);
        }
    }
    show() {
        return this.deepClone(this.config);
    }
    get(path) {
        const keys = path.split('.');
        let current = this.config;
        for (const key of keys){
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return undefined;
            }
        }
        return current;
    }
    set(path, value) {
        const keys = path.split('.');
        let current = this.config;
        for(let i = 0; i < keys.length - 1; i++){
            const key = keys[i];
            if (!(key in current)) {
                current[key] = {};
            }
            current = current[key];
        }
        const lastKey = keys[keys.length - 1];
        current[lastKey] = value;
        this.validate(this.config);
    }
    async save(configPath) {
        const savePath = configPath || this.configPath;
        if (!savePath) {
            throw new ConfigError('No configuration file path specified');
        }
        const content = JSON.stringify(this.config, null, 2);
        await fs.writeFile(savePath, content, 'utf8');
    }
    validate(config) {
        if (config.orchestrator.maxConcurrentAgents < 1 || config.orchestrator.maxConcurrentAgents > 100) {
            throw new ConfigError('orchestrator.maxConcurrentAgents must be between 1 and 100');
        }
        if (config.orchestrator.taskQueueSize < 1 || config.orchestrator.taskQueueSize > 10000) {
            throw new ConfigError('orchestrator.taskQueueSize must be between 1 and 10000');
        }
        if (![
            'auto',
            'vscode',
            'native'
        ].includes(config.terminal.type)) {
            throw new ConfigError('terminal.type must be one of: auto, vscode, native');
        }
        if (config.terminal.poolSize < 1 || config.terminal.poolSize > 50) {
            throw new ConfigError('terminal.poolSize must be between 1 and 50');
        }
        if (![
            'sqlite',
            'markdown',
            'hybrid'
        ].includes(config.memory.backend)) {
            throw new ConfigError('memory.backend must be one of: sqlite, markdown, hybrid');
        }
        if (config.memory.cacheSizeMB < 1 || config.memory.cacheSizeMB > 10000) {
            throw new ConfigError('memory.cacheSizeMB must be between 1 and 10000');
        }
        if (config.coordination.maxRetries < 0 || config.coordination.maxRetries > 100) {
            throw new ConfigError('coordination.maxRetries must be between 0 and 100');
        }
        if (![
            'stdio',
            'http',
            'websocket'
        ].includes(config.mcp.transport)) {
            throw new ConfigError('mcp.transport must be one of: stdio, http, websocket');
        }
        if (config.mcp.port < 1 || config.mcp.port > 65535) {
            throw new ConfigError('mcp.port must be between 1 and 65535');
        }
        if (![
            'debug',
            'info',
            'warn',
            'error'
        ].includes(config.logging.level)) {
            throw new ConfigError('logging.level must be one of: debug, info, warn, error');
        }
        if (![
            'json',
            'text'
        ].includes(config.logging.format)) {
            throw new ConfigError('logging.format must be one of: json, text');
        }
        if (![
            'console',
            'file'
        ].includes(config.logging.destination)) {
            throw new ConfigError('logging.destination must be one of: console, file');
        }
        if (![
            'mesh',
            'hierarchical',
            'ring',
            'star'
        ].includes(config.ruvSwarm.defaultTopology)) {
            throw new ConfigError('ruvSwarm.defaultTopology must be one of: mesh, hierarchical, ring, star');
        }
        if (config.ruvSwarm.maxAgents < 1 || config.ruvSwarm.maxAgents > 100) {
            throw new ConfigError('ruvSwarm.maxAgents must be between 1 and 100');
        }
        if (![
            'balanced',
            'specialized',
            'adaptive'
        ].includes(config.ruvSwarm.defaultStrategy)) {
            throw new ConfigError('ruvSwarm.defaultStrategy must be one of: balanced, specialized, adaptive');
        }
        if (config.claude) {
            if (config.claude.model) {
                const validModels = [
                    'claude-3-opus-20240229',
                    'claude-3-sonnet-20240229',
                    'claude-3-haiku-20240307',
                    'claude-2.1',
                    'claude-2.0',
                    'claude-instant-1.2'
                ];
                if (!validModels.includes(config.claude.model)) {
                    throw new ConfigError(`claude.model must be one of: ${validModels.join(', ')}`);
                }
            }
            if (config.claude.temperature !== undefined) {
                if (config.claude.temperature < 0 || config.claude.temperature > 1) {
                    throw new ConfigError('claude.temperature must be between 0 and 1');
                }
            }
            if (config.claude.maxTokens !== undefined) {
                if (config.claude.maxTokens < 1 || config.claude.maxTokens > 100000) {
                    throw new ConfigError('claude.maxTokens must be between 1 and 100000');
                }
            }
            if (config.claude.topP !== undefined) {
                if (config.claude.topP < 0 || config.claude.topP > 1) {
                    throw new ConfigError('claude.topP must be between 0 and 1');
                }
            }
        }
    }
    loadFromEnv() {
        const maxAgents = process.env.CLAUDE_FLOW_MAX_AGENTS;
        if (maxAgents) {
            this.config.orchestrator.maxConcurrentAgents = parseInt(maxAgents, 10);
        }
        const terminalType = process.env.CLAUDE_FLOW_TERMINAL_TYPE;
        if (terminalType === 'vscode' || terminalType === 'native' || terminalType === 'auto') {
            this.config.terminal.type = terminalType;
        }
        const memoryBackend = process.env.CLAUDE_FLOW_MEMORY_BACKEND;
        if (memoryBackend === 'sqlite' || memoryBackend === 'markdown' || memoryBackend === 'hybrid') {
            this.config.memory.backend = memoryBackend;
        }
        const mcpTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
        if (mcpTransport === 'stdio' || mcpTransport === 'http' || mcpTransport === 'websocket') {
            this.config.mcp.transport = mcpTransport;
        }
        const mcpPort = process.env.CLAUDE_FLOW_MCP_PORT;
        if (mcpPort) {
            this.config.mcp.port = parseInt(mcpPort, 10);
        }
        const logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL;
        if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
            this.config.logging.level = logLevel;
        }
        const ruvSwarmEnabled = process.env.CLAUDE_FLOW_RUV_SWARM_ENABLED;
        if (ruvSwarmEnabled === 'true' || ruvSwarmEnabled === 'false') {
            this.config.ruvSwarm.enabled = ruvSwarmEnabled === 'true';
        }
        const ruvSwarmTopology = process.env.CLAUDE_FLOW_RUV_SWARM_TOPOLOGY;
        if (ruvSwarmTopology === 'mesh' || ruvSwarmTopology === 'hierarchical' || ruvSwarmTopology === 'ring' || ruvSwarmTopology === 'star') {
            this.config.ruvSwarm.defaultTopology = ruvSwarmTopology;
        }
        const ruvSwarmMaxAgents = process.env.CLAUDE_FLOW_RUV_SWARM_MAX_AGENTS;
        if (ruvSwarmMaxAgents) {
            this.config.ruvSwarm.maxAgents = parseInt(ruvSwarmMaxAgents, 10);
        }
        if (!this.config.claude) {
            this.config.claude = {};
        }
        const claudeApiKey = process.env.ANTHROPIC_API_KEY;
        if (claudeApiKey) {
            this.config.claude.apiKey = claudeApiKey;
        }
        const claudeModel = process.env.CLAUDE_MODEL;
        if (claudeModel) {
            this.config.claude.model = claudeModel;
        }
        const claudeTemperature = process.env.CLAUDE_TEMPERATURE;
        if (claudeTemperature) {
            this.config.claude.temperature = parseFloat(claudeTemperature);
        }
        const claudeMaxTokens = process.env.CLAUDE_MAX_TOKENS;
        if (claudeMaxTokens) {
            this.config.claude.maxTokens = parseInt(claudeMaxTokens, 10);
        }
        const claudeTopP = process.env.CLAUDE_TOP_P;
        if (claudeTopP) {
            this.config.claude.topP = parseFloat(claudeTopP);
        }
        const claudeTopK = process.env.CLAUDE_TOP_K;
        if (claudeTopK) {
            this.config.claude.topK = parseInt(claudeTopK, 10);
        }
        const claudeSystemPrompt = process.env.CLAUDE_SYSTEM_PROMPT;
        if (claudeSystemPrompt) {
            this.config.claude.systemPrompt = claudeSystemPrompt;
        }
    }
    deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }
    getRuvSwarmConfig() {
        return this.deepClone(this.config.ruvSwarm);
    }
    getAvailableTemplates() {
        return [
            'default',
            'development',
            'production',
            'testing'
        ];
    }
    createTemplate(name, config) {
        console.log(`Creating template: ${name}`, config);
    }
    getFormatParsers() {
        return {
            json: {
                extension: '.json',
                parse: JSON.parse,
                stringify: JSON.stringify
            },
            yaml: {
                extension: '.yaml',
                parse: (content)=>content,
                stringify: (obj)=>JSON.stringify(obj)
            }
        };
    }
    validateFile(path) {
        try {
            require('fs').readFileSync(path, 'utf8');
            return true;
        } catch  {
            return false;
        }
    }
    getPathHistory() {
        return [];
    }
    getChangeHistory() {
        return [];
    }
    async backup(path) {
        const backupPath = `${path}.backup.${Date.now()}`;
        const content = JSON.stringify(this.config, null, 2);
        await fs.writeFile(backupPath, content, 'utf8');
        console.log(`Configuration backed up to: ${backupPath}`);
    }
    async restore(path) {
        const content = await fs.readFile(path, 'utf8');
        this.config = JSON.parse(content);
        console.log(`Configuration restored from: ${path}`);
    }
    setRuvSwarmConfig(updates) {
        this.config.ruvSwarm = {
            ...this.config.ruvSwarm,
            ...updates
        };
        this.validate(this.config);
    }
    isRuvSwarmEnabled() {
        return this.config.ruvSwarm.enabled;
    }
    getRuvSwarmArgs() {
        const args = [];
        const config = this.config.ruvSwarm;
        if (!config.enabled) {
            return args;
        }
        args.push('--topology', config.defaultTopology);
        args.push('--max-agents', String(config.maxAgents));
        args.push('--strategy', config.defaultStrategy);
        if (config.enableHooks) {
            args.push('--enable-hooks');
        }
        if (config.enablePersistence) {
            args.push('--enable-persistence');
        }
        if (config.enableNeuralTraining) {
            args.push('--enable-training');
        }
        if (config.configPath) {
            args.push('--config-path', config.configPath);
        }
        return args;
    }
    getClaudeConfig() {
        return this.deepClone(this.config.claude || {});
    }
    setClaudeConfig(updates) {
        if (!this.config.claude) {
            this.config.claude = {};
        }
        this.config.claude = {
            ...this.config.claude,
            ...updates
        };
        this.validate(this.config);
    }
    isClaudeAPIConfigured() {
        return !!(this.config.claude?.apiKey || process.env.ANTHROPIC_API_KEY);
    }
    deepMerge(target, source) {
        const result = this.deepClone(target);
        if (source.orchestrator) {
            result.orchestrator = {
                ...result.orchestrator,
                ...source.orchestrator
            };
        }
        if (source.terminal) {
            result.terminal = {
                ...result.terminal,
                ...source.terminal
            };
        }
        if (source.memory) {
            result.memory = {
                ...result.memory,
                ...source.memory
            };
        }
        if (source.coordination) {
            result.coordination = {
                ...result.coordination,
                ...source.coordination
            };
        }
        if (source.mcp) {
            result.mcp = {
                ...result.mcp,
                ...source.mcp
            };
        }
        if (source.logging) {
            result.logging = {
                ...result.logging,
                ...source.logging
            };
        }
        if (source.ruvSwarm) {
            result.ruvSwarm = {
                ...result.ruvSwarm,
                ...source.ruvSwarm
            };
        }
        if (source.claude) {
            result.claude = {
                ...result.claude,
                ...source.claude
            };
        }
        return result;
    }
}
export const configManager = ConfigManager.getInstance();

//# sourceMappingURL=config-manager.js.map