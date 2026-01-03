import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateGlobPattern } from './tool-filter.js';
const DEFAULT_CONFIG_PATHS = [
    '.claude-flow/mcp-tools.json',
    '.claude-flow/mcp-tools.yaml',
    'mcp-tools.json'
];
const KNOWN_CONFIG_PROPERTIES = new Set([
    'enabled',
    'mode',
    'tools',
    'categories',
    'maxTools',
    'priorities'
]);
const MAX_RECOMMENDED_PATTERNS = 100;
export function validateToolFilterConfig(config) {
    const errors = [];
    const warnings = [];
    if (config === null || typeof config !== 'object') {
        return {
            valid: false,
            errors: [
                'Configuration must be an object'
            ],
            warnings: []
        };
    }
    const configObj = config;
    for (const key of Object.keys(configObj)){
        if (!KNOWN_CONFIG_PROPERTIES.has(key)) {
            warnings.push(`Unknown property '${key}' will be ignored`);
        }
    }
    if ('enabled' in configObj && typeof configObj.enabled !== 'boolean') {
        errors.push(`'enabled' must be a boolean, got ${typeof configObj.enabled}`);
    }
    if ('mode' in configObj) {
        if (configObj.mode !== 'allowlist' && configObj.mode !== 'denylist') {
            errors.push(`'mode' must be 'allowlist' or 'denylist', got '${String(configObj.mode)}'`);
        }
    }
    if ('tools' in configObj) {
        if (!Array.isArray(configObj.tools)) {
            errors.push(`'tools' must be an array, got ${typeof configObj.tools}`);
        } else {
            const nonStrings = configObj.tools.map((t, i)=>({
                    value: t,
                    index: i
                })).filter(({ value })=>typeof value !== 'string');
            if (nonStrings.length > 0) {
                const indices = nonStrings.map(({ index })=>index).join(', ');
                errors.push(`'tools' array must contain only strings, non-string values at indices: ${indices}`);
            }
            for(let i = 0; i < configObj.tools.length; i++){
                const pattern = configObj.tools[i];
                if (typeof pattern === 'string') {
                    const validationResult = validateGlobPattern(pattern);
                    if (!validationResult.valid) {
                        warnings.push(`Tool pattern at index ${i} ('${pattern.substring(0, 50)}${pattern.length > 50 ? '...' : ''}'): ${validationResult.reason}`);
                    }
                }
            }
            const mode = configObj.mode ?? 'allowlist';
            if (configObj.tools.length === 0 && mode === 'allowlist') {
                warnings.push("Empty 'tools' array in allowlist mode will match nothing");
            }
            if (configObj.tools.length > MAX_RECOMMENDED_PATTERNS) {
                warnings.push(`Large number of tool patterns (${configObj.tools.length}) may impact performance. Consider using categories or wildcards.`);
            }
        }
    }
    if ('categories' in configObj) {
        if (!Array.isArray(configObj.categories)) {
            errors.push(`'categories' must be an array, got ${typeof configObj.categories}`);
        } else {
            const nonStrings = configObj.categories.map((c, i)=>({
                    value: c,
                    index: i
                })).filter(({ value })=>typeof value !== 'string');
            if (nonStrings.length > 0) {
                const indices = nonStrings.map(({ index })=>index).join(', ');
                errors.push(`'categories' array must contain only strings, non-string values at indices: ${indices}`);
            }
            for(let i = 0; i < configObj.categories.length; i++){
                const category = configObj.categories[i];
                if (typeof category === 'string') {
                    const validationResult = validateGlobPattern(category);
                    if (!validationResult.valid) {
                        warnings.push(`Category pattern at index ${i} ('${category.substring(0, 50)}${category.length > 50 ? '...' : ''}'): ${validationResult.reason}`);
                    }
                }
            }
            if (configObj.categories.length > MAX_RECOMMENDED_PATTERNS) {
                warnings.push(`Large number of category patterns (${configObj.categories.length}) may impact performance.`);
            }
        }
    }
    if ('maxTools' in configObj) {
        const maxTools = configObj.maxTools;
        if (typeof maxTools !== 'number') {
            errors.push(`'maxTools' must be a number, got ${typeof maxTools}`);
        } else if (!Number.isInteger(maxTools)) {
            errors.push(`'maxTools' must be an integer, got ${maxTools}`);
        } else if (maxTools <= 0) {
            warnings.push(`'maxTools' is ${maxTools}, which will be ignored (must be positive)`);
        }
    }
    if ('priorities' in configObj) {
        const priorities = configObj.priorities;
        if (priorities === null || typeof priorities !== 'object' || Array.isArray(priorities)) {
            errors.push(`'priorities' must be an object, got ${Array.isArray(priorities) ? 'array' : typeof priorities}`);
        } else {
            const prioritiesObj = priorities;
            for (const [key, value] of Object.entries(prioritiesObj)){
                if (typeof value !== 'number') {
                    errors.push(`'priorities.${key}' must be a number, got ${typeof value}`);
                }
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}
const DEFAULT_CONFIG = {
    enabled: false,
    mode: 'allowlist',
    tools: []
};
export async function loadToolFilterConfig(logger, workingDirectory) {
    const cwd = workingDirectory || process.cwd();
    const fileConfig = await loadFromConfigFiles(cwd, logger);
    if (fileConfig) {
        const envOverrides = loadEnvironmentOverrides();
        if (envOverrides.hasExplicitEnabled) {
            fileConfig.config.enabled = envOverrides.config.enabled;
        }
        if (envOverrides.config.tools.length > 0) {
            fileConfig.config.tools = envOverrides.config.tools;
        }
        if (envOverrides.config.maxTools !== undefined) {
            fileConfig.config.maxTools = envOverrides.config.maxTools;
        }
        if (envOverrides.hasExplicitMode) {
            fileConfig.config.mode = envOverrides.config.mode;
        }
        logger.debug('Tool filter config loaded', {
            source: fileConfig.source,
            enabled: fileConfig.config.enabled,
            mode: fileConfig.config.mode,
            toolCount: fileConfig.config.tools.length
        });
        return fileConfig;
    }
    const envConfig = loadFromEnvironment();
    if (envConfig.enabled) {
        logger.info('Tool filter config loaded from environment variables');
        return {
            config: envConfig,
            source: 'environment'
        };
    }
    logger.debug('No tool filter configuration found, filtering disabled');
    return null;
}
async function loadFromConfigFiles(cwd, logger) {
    for (const configPath of DEFAULT_CONFIG_PATHS){
        const fullPath = join(cwd, configPath);
        try {
            const content = await fs.readFile(fullPath, 'utf-8');
            const parsed = parseConfigFile(content, configPath);
            if (parsed.toolFilter) {
                const validation = validateToolFilterConfig(parsed.toolFilter);
                logValidationResults(logger, validation, configPath);
                if (!validation.valid) {
                    logger.error(`Invalid tool filter configuration in ${configPath}, using defaults`);
                    continue;
                }
                const config = validateAndNormalize(parsed.toolFilter, validation);
                logger.info('Loaded tool filter config from file', {
                    source: configPath
                });
                return {
                    config,
                    source: configPath
                };
            }
            if (parsed.enabled !== undefined && parsed.mode !== undefined) {
                const validation = validateToolFilterConfig(parsed);
                logValidationResults(logger, validation, configPath);
                if (!validation.valid) {
                    logger.error(`Invalid tool filter configuration in ${configPath}, using defaults`);
                    continue;
                }
                const config = validateAndNormalize(parsed, validation);
                logger.info('Loaded tool filter config from file (root level)', {
                    source: configPath
                });
                return {
                    config,
                    source: configPath
                };
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn(`Failed to parse config file: ${configPath}`, {
                    error
                });
            }
            continue;
        }
    }
    return null;
}
function logValidationResults(logger, validation, source) {
    for (const error of validation.errors){
        logger.error(`Config validation error in ${source}: ${error}`);
    }
    for (const warning of validation.warnings){
        logger.warn(`Config validation warning in ${source}: ${warning}`);
    }
}
function parseConfigFile(content, path) {
    if (path.endsWith('.json')) {
        return JSON.parse(content);
    }
    if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        const parsed = parseYaml(content);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return parsed;
    }
    return JSON.parse(content);
}
function loadFromEnvironment() {
    const enabled = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED === 'true';
    const modeEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE;
    const mode = modeEnv === 'allowlist' || modeEnv === 'denylist' ? modeEnv : 'allowlist';
    const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
    const tools = toolsEnv ? toolsEnv.split(',').map((t)=>t.trim()).filter((t)=>t.length > 0) : [];
    const maxToolsEnv = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS;
    const maxTools = maxToolsEnv ? parseInt(maxToolsEnv, 10) : undefined;
    return {
        enabled,
        mode,
        tools,
        maxTools: maxTools && !isNaN(maxTools) ? maxTools : undefined
    };
}
function loadEnvironmentOverrides() {
    const enabledEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED;
    const hasExplicitEnabled = enabledEnv === 'true' || enabledEnv === 'false';
    const enabled = enabledEnv === 'true';
    const modeEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE;
    const hasExplicitMode = modeEnv === 'allowlist' || modeEnv === 'denylist';
    const mode = hasExplicitMode ? modeEnv : 'allowlist';
    const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
    const tools = toolsEnv ? toolsEnv.split(',').map((t)=>t.trim()).filter((t)=>t.length > 0) : [];
    const maxToolsEnv = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS;
    const maxTools = maxToolsEnv ? parseInt(maxToolsEnv, 10) : undefined;
    return {
        config: {
            enabled,
            mode,
            tools,
            maxTools: maxTools && !isNaN(maxTools) ? maxTools : undefined
        },
        hasExplicitEnabled,
        hasExplicitMode
    };
}
function validateAndNormalize(config, validation) {
    const hasError = (field)=>{
        if (!validation) return false;
        return validation.errors.some((e)=>e.includes(`'${field}'`));
    };
    let tools = DEFAULT_CONFIG.tools;
    if (Array.isArray(config.tools) && !hasError('tools')) {
        tools = config.tools.filter((t)=>typeof t === 'string');
    }
    let categories = undefined;
    if (Array.isArray(config.categories) && !hasError('categories')) {
        const filtered = config.categories.filter((c)=>typeof c === 'string');
        categories = filtered.length > 0 ? filtered : undefined;
    }
    let priorities = undefined;
    if (typeof config.priorities === 'object' && config.priorities !== null && !Array.isArray(config.priorities) && !hasError('priorities')) {
        const filtered = {};
        for (const [key, value] of Object.entries(config.priorities)){
            if (typeof value === 'number') {
                filtered[key] = value;
            }
        }
        priorities = Object.keys(filtered).length > 0 ? filtered : undefined;
    }
    return {
        enabled: hasError('enabled') ? DEFAULT_CONFIG.enabled : config.enabled ?? DEFAULT_CONFIG.enabled,
        mode: hasError('mode') ? DEFAULT_CONFIG.mode : config.mode ?? DEFAULT_CONFIG.mode,
        tools,
        categories,
        maxTools: typeof config.maxTools === 'number' && config.maxTools > 0 && !hasError('maxTools') ? config.maxTools : undefined,
        priorities
    };
}

//# sourceMappingURL=tool-filter-config.js.map