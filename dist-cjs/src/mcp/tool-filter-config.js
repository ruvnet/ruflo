import { promises as fs } from 'node:fs';
import { join } from 'node:path';
const DEFAULT_CONFIG_PATHS = [
    '.claude-flow/mcp-tools.json',
    '.claude-flow/mcp-tools.yaml',
    'mcp-tools.json'
];
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
                const config = validateAndNormalize(parsed.toolFilter);
                logger.info('Loaded tool filter config from file', {
                    source: configPath
                });
                return {
                    config,
                    source: configPath
                };
            }
            if (parsed.enabled !== undefined && parsed.mode !== undefined) {
                const config = validateAndNormalize(parsed);
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
function parseConfigFile(content, path) {
    if (path.endsWith('.json')) {
        return JSON.parse(content);
    }
    if (path.endsWith('.yaml') || path.endsWith('.yml')) {
        return parseBasicYaml(content);
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
function validateAndNormalize(config) {
    return {
        enabled: config.enabled ?? DEFAULT_CONFIG.enabled,
        mode: config.mode ?? DEFAULT_CONFIG.mode,
        tools: Array.isArray(config.tools) ? config.tools : DEFAULT_CONFIG.tools,
        categories: Array.isArray(config.categories) ? config.categories : undefined,
        maxTools: typeof config.maxTools === 'number' && config.maxTools > 0 ? config.maxTools : undefined,
        priorities: typeof config.priorities === 'object' && config.priorities !== null ? config.priorities : undefined
    };
}
function parseBasicYaml(content) {
    const result = {};
    const lines = content.split('\n');
    const stack = [
        {
            obj: result,
            indent: -1
        }
    ];
    let currentArray = null;
    let currentArrayKey = '';
    let currentArrayIndent = -1;
    for (const line of lines){
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const indent = line.search(/\S/);
        if (trimmed.startsWith('- ')) {
            const value = trimmed.substring(2).trim();
            if (currentArray && indent >= currentArrayIndent) {
                currentArray.push(parseYamlValue(value));
            }
            continue;
        }
        if (indent <= currentArrayIndent) {
            currentArray = null;
            currentArrayKey = '';
            currentArrayIndent = -1;
        }
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) {
            continue;
        }
        const key = trimmed.substring(0, colonIndex).trim();
        const rawValue = trimmed.substring(colonIndex + 1).trim();
        while(stack.length > 1 && stack[stack.length - 1].indent >= indent){
            stack.pop();
        }
        const parent = stack[stack.length - 1].obj;
        if (rawValue === '' || rawValue === null) {
            const lineIdx = lines.indexOf(line);
            const nextLineIdx = lines.findIndex((l, i)=>i > lineIdx && l.trim() !== '' && !l.trim().startsWith('#'));
            const nextLine = nextLineIdx >= 0 ? lines[nextLineIdx] : '';
            if (nextLine.trim().startsWith('- ')) {
                const arr = [];
                parent[key] = arr;
                currentArray = arr;
                currentArrayKey = key;
                currentArrayIndent = nextLine.search(/\S/);
            } else {
                const newObj = {};
                parent[key] = newObj;
                stack.push({
                    obj: newObj,
                    indent
                });
            }
        } else {
            parent[key] = parseYamlValue(rawValue);
        }
    }
    return result;
}
function parseYamlValue(value) {
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1);
    }
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null' || value === '~') return null;
    const num = Number(value);
    if (!isNaN(num) && value !== '') return num;
    return value;
}

//# sourceMappingURL=tool-filter-config.js.map