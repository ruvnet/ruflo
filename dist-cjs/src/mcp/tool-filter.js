import { minimatch } from 'minimatch';
export const MAX_PATTERN_LENGTH = 200;
const DANGEROUS_PATTERN_CHECKS = [
    {
        pattern: /\*\*[^/]*\*\*/,
        reason: 'Nested double stars (**/**) can cause catastrophic backtracking'
    },
    {
        pattern: /\*\*\/\*\*\//,
        reason: 'Consecutive double star segments (**/**/) can cause performance issues'
    },
    {
        pattern: /\*{3,}/,
        reason: 'Triple or more consecutive wildcards (***) are not valid glob patterns'
    },
    {
        pattern: /\[[^\]]*\*[^\]]*\*[^\]]*\]/,
        reason: 'Multiple wildcards in character class can cause performance issues'
    },
    {
        pattern: /(?:\/\*){5,}/,
        reason: 'Excessive repeated wildcard segments can cause performance issues'
    },
    {
        pattern: /\{[^}]*\*[^}]*,[^}]*\*[^}]*\}/,
        reason: 'Alternation with multiple wildcard options can cause performance issues'
    }
];
export function validateGlobPattern(pattern) {
    if (typeof pattern !== 'string') {
        return {
            valid: false,
            reason: `Pattern must be a string, got ${typeof pattern}`
        };
    }
    if (pattern.length === 0) {
        return {
            valid: false,
            reason: 'Pattern cannot be empty'
        };
    }
    if (pattern.trim().length === 0) {
        return {
            valid: false,
            reason: 'Pattern cannot be whitespace only'
        };
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
        return {
            valid: false,
            reason: `Pattern exceeds maximum length of ${MAX_PATTERN_LENGTH} characters (got ${pattern.length})`
        };
    }
    for (const check of DANGEROUS_PATTERN_CHECKS){
        if (check.pattern.test(pattern)) {
            return {
                valid: false,
                reason: check.reason
            };
        }
    }
    return {
        valid: true
    };
}
export function validateAndFilterPatterns(patterns, logger, context) {
    const validPatterns = [];
    for (const pattern of patterns){
        const result = validateGlobPattern(pattern);
        if (result.valid) {
            validPatterns.push(pattern);
        } else {
            logger.warn(`Invalid ${context} pattern skipped: "${String(pattern)}"`, {
                reason: result.reason
            });
        }
    }
    return validPatterns;
}
const CORE_SYSTEM_TOOLS = [
    'system/info',
    'system/health',
    'swarm_init',
    'swarm_status',
    'agent_spawn',
    'agent_list'
];
const DEFAULT_PRIORITIES = {
    'system/info': 100,
    'system/health': 100,
    'agents/spawn': 90,
    'agents/list': 90,
    'agents/status': 85,
    'tasks/create': 90,
    'tasks/status': 85,
    'tasks/list': 80,
    'memory/store': 85,
    'memory/retrieve': 85,
    'memory/search': 80,
    'swarm/init': 80,
    'swarm/status': 75
};
const DEFAULT_TOOL_PRIORITY = 50;
const DEFAULT_CACHE_TTL = 60000;
export class ToolFilter {
    config;
    logger;
    stats;
    cache = null;
    cacheHits = 0;
    cacheMisses = 0;
    constructor(config, logger){
        this.logger = logger;
        this.config = config ?? {
            enabled: false,
            mode: 'allowlist',
            tools: []
        };
        if (this.config.enabled) {
            this.config = this.validateConfigPatterns(this.config);
        }
        this.stats = this.createEmptyStats();
        if (this.config.enabled) {
            this.logger.info('Tool filter initialized', {
                mode: this.config.mode,
                toolPatterns: this.config.tools.length,
                categories: this.config.categories?.length ?? 0,
                maxTools: this.config.maxTools,
                cacheEnabled: this.config.enableCache ?? false,
                cacheTtl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL
            });
        } else {
            this.logger.debug('Tool filtering disabled');
        }
    }
    validateConfigPatterns(config) {
        const validatedConfig = {
            ...config
        };
        if (config.tools && config.tools.length > 0) {
            validatedConfig.tools = validateAndFilterPatterns(config.tools, this.logger, 'tool');
        }
        if (config.categories && config.categories.length > 0) {
            validatedConfig.categories = validateAndFilterPatterns(config.categories, this.logger, 'category');
        }
        return validatedConfig;
    }
    generateCacheKey(tools) {
        const sortedNames = tools.map((t)=>t.name).sort();
        return sortedNames.join('|');
    }
    isCacheValid(key) {
        if (!this.cache) {
            return false;
        }
        if (this.cache.key !== key) {
            return false;
        }
        const ttl = this.config.cacheTtl ?? DEFAULT_CACHE_TTL;
        const elapsed = Date.now() - this.cache.timestamp;
        return elapsed < ttl;
    }
    createEmptyStats() {
        return {
            totalTools: 0,
            filteredTools: 0,
            excludedTools: 0,
            truncatedTools: 0,
            excludedToolNames: [],
            truncatedToolNames: [],
            excludedCoreTools: [],
            filterMode: this.config.enabled ? this.config.mode : 'disabled',
            enabled: this.config.enabled,
            lastFilterTimestamp: null,
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses
        };
    }
    matchesPatterns(toolName, patterns) {
        for (const pattern of patterns){
            if (pattern === toolName) {
                return true;
            }
            if (minimatch(toolName, pattern, {
                nocase: false
            })) {
                return true;
            }
        }
        return false;
    }
    matchesCategories(toolName, categories) {
        for (const category of categories){
            if (toolName.startsWith(`${category}/`) || toolName.startsWith(`${category}_`) || toolName.startsWith(`${category}-`)) {
                return true;
            }
        }
        return false;
    }
    getToolPriority(toolName) {
        if (this.config.priorities?.[toolName] !== undefined) {
            return this.config.priorities[toolName];
        }
        if (DEFAULT_PRIORITIES[toolName] !== undefined) {
            return DEFAULT_PRIORITIES[toolName];
        }
        const category = toolName.split(/[/_-]/)[0];
        const categoryPriorities = Object.entries(DEFAULT_PRIORITIES).filter(([key])=>key.startsWith(`${category}/`)).map(([, value])=>value);
        if (categoryPriorities.length > 0) {
            return Math.min(...categoryPriorities) - 5;
        }
        return DEFAULT_TOOL_PRIORITY;
    }
    shouldIncludeTool(toolName) {
        if (!this.config.enabled) {
            return true;
        }
        const { mode, tools, categories } = this.config;
        const matchesToolPattern = tools.length > 0 && this.matchesPatterns(toolName, tools);
        const matchesCategory = categories && categories.length > 0 && this.matchesCategories(toolName, categories);
        const matches = matchesToolPattern || matchesCategory;
        if (mode === 'allowlist') {
            return matches;
        } else {
            return !matches;
        }
    }
    filterTools(tools) {
        if (this.config.enableCache) {
            const cacheKey = this.generateCacheKey(tools);
            if (this.isCacheValid(cacheKey)) {
                this.cacheHits++;
                this.stats = {
                    ...this.cache.stats,
                    cacheHits: this.cacheHits,
                    cacheMisses: this.cacheMisses
                };
                this.stats.lastFilterTimestamp = new Date();
                this.logger.debug('Cache hit for tool filter', {
                    cacheKey: cacheKey.substring(0, 50) + '...',
                    resultCount: this.cache.result.length
                });
                return this.cache.result;
            }
            this.cacheMisses++;
        }
        this.stats = this.createEmptyStats();
        this.stats.totalTools = tools.length;
        this.stats.lastFilterTimestamp = new Date();
        if (!this.config.enabled) {
            this.stats.filteredTools = tools.length;
            this.logger.debug('Tool filtering disabled, returning all tools', {
                count: tools.length
            });
            return tools;
        }
        this.logger.debug('Filtering tools', {
            mode: this.config.mode,
            toolPatterns: this.config.tools,
            categories: this.config.categories,
            maxTools: this.config.maxTools
        });
        const filteredByPattern = [];
        const excludedByPattern = [];
        for (const tool of tools){
            if (this.shouldIncludeTool(tool.name)) {
                filteredByPattern.push(tool);
            } else {
                excludedByPattern.push(tool.name);
            }
        }
        this.stats.excludedToolNames = excludedByPattern;
        this.stats.excludedTools = excludedByPattern.length;
        this.logger.debug('Pattern filtering complete', {
            included: filteredByPattern.length,
            excluded: excludedByPattern.length
        });
        if (excludedByPattern.length > 0) {
            const maxToolsToShow = 10;
            const toolsToShow = excludedByPattern.slice(0, maxToolsToShow);
            const remaining = excludedByPattern.length - maxToolsToShow;
            let excludedMessage = toolsToShow.join(', ');
            if (remaining > 0) {
                excludedMessage += `, ... and ${remaining} more`;
            }
            this.logger.info(`Excluded tools by pattern filter: ${excludedMessage}`);
        }
        let result = filteredByPattern;
        if (this.config.maxTools !== undefined && filteredByPattern.length > this.config.maxTools) {
            const toolsWithPriority = filteredByPattern.map((tool)=>({
                    tool,
                    priority: this.getToolPriority(tool.name)
                }));
            toolsWithPriority.sort((a, b)=>{
                if (b.priority !== a.priority) {
                    return b.priority - a.priority;
                }
                return a.tool.name.localeCompare(b.tool.name);
            });
            const keptTools = toolsWithPriority.slice(0, this.config.maxTools);
            const truncatedTools = toolsWithPriority.slice(this.config.maxTools);
            this.stats.truncatedToolNames = truncatedTools.map((t)=>t.tool.name);
            this.stats.truncatedTools = truncatedTools.length;
            this.stats.excludedCoreTools = this.stats.truncatedToolNames.filter((toolName)=>CORE_SYSTEM_TOOLS.includes(toolName));
            result = keptTools.map((t)=>t.tool);
            this.logger.warn('Applied maxTools limit', {
                maxTools: this.config.maxTools,
                originalCount: filteredByPattern.length,
                resultCount: result.length,
                truncatedCount: this.stats.truncatedTools
            });
            if (this.stats.excludedCoreTools.length > 0) {
                this.logger.warn(`Warning: maxTools limit excluded core system tools: [${this.stats.excludedCoreTools.join(', ')}]. Consider increasing maxTools or adding these to priorities.`);
            }
        }
        this.stats.filteredTools = result.length;
        const modeLabel = this.config.mode === 'allowlist' ? 'allowlist' : 'denylist';
        const patternsCount = this.config.tools.length + (this.config.categories?.length ?? 0);
        this.logger.info(`Tool filter applied (${modeLabel} mode): ${result.length} tools included, ${this.stats.excludedTools} excluded by pattern` + (this.stats.truncatedTools > 0 ? `, ${this.stats.truncatedTools} truncated by maxTools limit` : ''));
        this.logger.debug('Tool filtering complete', {
            total: this.stats.totalTools,
            filtered: this.stats.filteredTools,
            excluded: this.stats.excludedTools,
            truncated: this.stats.truncatedTools,
            patternsMatched: patternsCount
        });
        if (this.config.enableCache) {
            const cacheKey = this.generateCacheKey(tools);
            this.cache = {
                key: cacheKey,
                result,
                timestamp: Date.now(),
                stats: {
                    ...this.stats
                }
            };
            this.logger.debug('Cached filter result', {
                cacheKey: cacheKey.substring(0, 50) + '...',
                resultCount: result.length,
                ttl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL
            });
        }
        return result;
    }
    getFilterStats() {
        return {
            ...this.stats,
            excludedToolNames: [
                ...this.stats.excludedToolNames
            ],
            truncatedToolNames: [
                ...this.stats.truncatedToolNames
            ],
            excludedCoreTools: [
                ...this.stats.excludedCoreTools
            ]
        };
    }
    updateConfig(config) {
        this.config = config.enabled ? this.validateConfigPatterns(config) : config;
        this.stats = this.createEmptyStats();
        this.clearCache();
        this.logger.info('Tool filter configuration updated', {
            enabled: this.config.enabled,
            mode: this.config.mode,
            toolPatterns: this.config.tools.length,
            categories: this.config.categories?.length ?? 0,
            maxTools: this.config.maxTools,
            cacheEnabled: this.config.enableCache ?? false,
            cacheTtl: this.config.cacheTtl ?? DEFAULT_CACHE_TTL
        });
    }
    clearCache() {
        if (this.cache) {
            this.logger.debug('Clearing filter cache', {
                previousHits: this.cacheHits,
                previousMisses: this.cacheMisses
            });
        }
        this.cache = null;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
}
export function createToolFilter(config, logger) {
    return new ToolFilter(config, logger);
}

//# sourceMappingURL=tool-filter.js.map