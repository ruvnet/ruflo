import { minimatch } from 'minimatch';
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
export class ToolFilter {
    config;
    logger;
    stats;
    constructor(config, logger){
        this.config = config ?? {
            enabled: false,
            mode: 'allowlist',
            tools: []
        };
        this.logger = logger;
        this.stats = this.createEmptyStats();
        if (this.config.enabled) {
            this.logger.info('Tool filter initialized', {
                mode: this.config.mode,
                toolPatterns: this.config.tools.length,
                categories: this.config.categories?.length ?? 0,
                maxTools: this.config.maxTools
            });
        } else {
            this.logger.debug('Tool filtering disabled');
        }
    }
    createEmptyStats() {
        return {
            totalTools: 0,
            filteredTools: 0,
            excludedTools: 0,
            truncatedTools: 0,
            excludedToolNames: [],
            truncatedToolNames: [],
            filterMode: this.config.enabled ? this.config.mode : 'disabled',
            enabled: this.config.enabled,
            lastFilterTimestamp: null
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
            result = keptTools.map((t)=>t.tool);
            this.logger.warn('Applied maxTools limit', {
                maxTools: this.config.maxTools,
                originalCount: filteredByPattern.length,
                resultCount: result.length,
                truncatedCount: this.stats.truncatedTools
            });
        }
        this.stats.filteredTools = result.length;
        this.logger.info('Tool filtering complete', {
            total: this.stats.totalTools,
            filtered: this.stats.filteredTools,
            excluded: this.stats.excludedTools,
            truncated: this.stats.truncatedTools
        });
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
            ]
        };
    }
    updateConfig(config) {
        this.config = config;
        this.stats = this.createEmptyStats();
        this.logger.info('Tool filter configuration updated', {
            enabled: config.enabled,
            mode: config.mode,
            toolPatterns: config.tools.length,
            categories: config.categories?.length ?? 0,
            maxTools: config.maxTools
        });
    }
}
export function createToolFilter(config, logger) {
    return new ToolFilter(config, logger);
}

//# sourceMappingURL=tool-filter.js.map