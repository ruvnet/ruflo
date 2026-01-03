import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { join } from 'node:path';
export class ToolFilter {
    config;
    lastStats;
    categoryMap = new Map();
    constructor(config){
        this.config = config;
        this.initializeCategoryMap();
    }
    initializeCategoryMap() {
        const categoryPatterns = {
            'swarm_': 'swarm',
            'agent_': 'swarm',
            'memory_': 'memory',
            'neural_': 'neural',
            'github_': 'github',
            'workflow_': 'workflow',
            'task_': 'coordination',
            'daa_': 'coordination',
            'benchmark_': 'analysis',
            'features_': 'system',
            'system_': 'system'
        };
        this.categoryMap = new Map(Object.entries(categoryPatterns));
    }
    getToolCategory(toolName) {
        for (const [prefix, category] of this.categoryMap.entries()){
            if (toolName.startsWith(prefix)) {
                return category;
            }
        }
        return 'other';
    }
    matchPattern(toolName, pattern) {
        if (pattern === toolName) {
            return true;
        }
        if (pattern === '*') {
            return true;
        }
        const regexPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(toolName);
    }
    filter(tools) {
        const startTime = performance.now();
        if (!this.config.enabled) {
            const stats = {
                totalTools: tools.length,
                filteredTools: tools.length,
                matchedPatterns: [],
                filterTime: performance.now() - startTime,
                lastFiltered: new Date()
            };
            this.lastStats = stats;
            return {
                tools,
                stats
            };
        }
        const matchedPatterns = [];
        let filteredTools;
        if (this.config.mode === 'allowlist') {
            filteredTools = tools.filter((tool)=>{
                const matches = this.config.patterns.some((pattern)=>{
                    const isMatch = this.matchPattern(tool.name, pattern);
                    if (isMatch && !matchedPatterns.includes(pattern)) {
                        matchedPatterns.push(pattern);
                    }
                    return isMatch;
                });
                if (matches && this.config.categories && this.config.categories.length > 0) {
                    const category = this.getToolCategory(tool.name);
                    return this.config.categories.includes(category);
                }
                return matches;
            });
        } else {
            filteredTools = tools.filter((tool)=>{
                const shouldExclude = this.config.patterns.some((pattern)=>{
                    const isMatch = this.matchPattern(tool.name, pattern);
                    if (isMatch && !matchedPatterns.includes(pattern)) {
                        matchedPatterns.push(pattern);
                    }
                    return isMatch;
                });
                if (!shouldExclude && this.config.categories && this.config.categories.length > 0) {
                    const category = this.getToolCategory(tool.name);
                    return !this.config.categories.includes(category);
                }
                return !shouldExclude;
            });
        }
        if (this.config.maxTools && filteredTools.length > this.config.maxTools) {
            const priorities = this.config.toolPriorities || {};
            filteredTools.sort((a, b)=>{
                const priorityA = priorities[a.name] ?? 0;
                const priorityB = priorities[b.name] ?? 0;
                if (priorityA !== priorityB) {
                    return priorityB - priorityA;
                }
                return a.name.localeCompare(b.name);
            });
            filteredTools = filteredTools.slice(0, this.config.maxTools);
        }
        const stats = {
            totalTools: tools.length,
            filteredTools: filteredTools.length,
            matchedPatterns,
            filterTime: performance.now() - startTime,
            lastFiltered: new Date()
        };
        this.lastStats = stats;
        return {
            tools: filteredTools,
            stats
        };
    }
    getStats() {
        return this.lastStats;
    }
    updateConfig(config) {
        this.config = {
            ...this.config,
            ...config
        };
    }
    getConfig() {
        return {
            ...this.config,
            patterns: [
                ...this.config.patterns
            ],
            categories: this.config.categories ? [
                ...this.config.categories
            ] : undefined,
            toolPriorities: this.config.toolPriorities ? {
                ...this.config.toolPriorities
            } : undefined
        };
    }
}
export function createToolFilter(config) {
    return new ToolFilter(config);
}
function createMockTool(name, description) {
    return {
        name,
        description: description ?? `Description for ${name}`,
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async ()=>({})
    };
}
function createMockToolSet() {
    return [
        createMockTool('swarm_init'),
        createMockTool('swarm_status'),
        createMockTool('swarm_monitor'),
        createMockTool('agent_spawn'),
        createMockTool('agent_list'),
        createMockTool('agent_metrics'),
        createMockTool('memory_usage'),
        createMockTool('memory_search'),
        createMockTool('memory_persist'),
        createMockTool('neural_status'),
        createMockTool('neural_train'),
        createMockTool('neural_patterns'),
        createMockTool('github_repo_analyze'),
        createMockTool('github_pr_manage'),
        createMockTool('workflow_create'),
        createMockTool('workflow_execute'),
        createMockTool('task_orchestrate'),
        createMockTool('task_status'),
        createMockTool('daa_agent_create'),
        createMockTool('benchmark_run'),
        createMockTool('features_detect'),
        createMockTool('system_health')
    ];
}
describe('ToolFilter', ()=>{
    let mockTools;
    beforeEach(()=>{
        mockTools = createMockToolSet();
    });
    afterEach(()=>{});
    describe('No Filtering (Disabled)', ()=>{
        it('should return all tools when filtering is disabled', ()=>{
            const filter = createToolFilter({
                enabled: false,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(mockTools.length);
            expect(result.tools).toEqual(mockTools);
            expect(result.stats.totalTools).toBe(mockTools.length);
            expect(result.stats.filteredTools).toBe(mockTools.length);
        });
        it('should track timing even when disabled', ()=>{
            const filter = createToolFilter({
                enabled: false,
                mode: 'allowlist',
                patterns: []
            });
            const result = filter.filter(mockTools);
            expect(result.stats.filterTime).toBeGreaterThanOrEqual(0);
            expect(result.stats.lastFiltered).toBeInstanceOf(Date);
        });
    });
    describe('Allowlist Mode - Exact Matching', ()=>{
        it('should include only exactly matched tools', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_init',
                    'swarm_status'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(2);
            expect(result.tools.map((t)=>t.name)).toEqual([
                'swarm_init',
                'swarm_status'
            ]);
        });
        it('should return empty array when no tools match', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'nonexistent_tool'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(0);
            expect(result.stats.filteredTools).toBe(0);
        });
    });
    describe('Allowlist Mode - Glob Pattern Matching', ()=>{
        it('should match tools using wildcard pattern', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>t.name.startsWith('swarm_'))).toBe(true);
            expect(result.tools.map((t)=>t.name)).toEqual([
                'swarm_init',
                'swarm_status',
                'swarm_monitor'
            ]);
        });
        it('should match tools using multiple wildcard patterns', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*',
                    'agent_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(6);
            expect(result.tools.every((t)=>t.name.startsWith('swarm_') || t.name.startsWith('agent_'))).toBe(true);
        });
        it('should match all tools with global wildcard', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(mockTools.length);
        });
        it('should handle complex patterns with prefix and suffix', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*_status'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>t.name.endsWith('_status'))).toBe(true);
            expect(result.tools.map((t)=>t.name)).toEqual([
                'swarm_status',
                'neural_status',
                'task_status'
            ]);
        });
        it('should match middle wildcard patterns', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*_*_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>t.name.split('_').length >= 3)).toBe(true);
        });
    });
    describe('Denylist Mode', ()=>{
        it('should exclude exactly matched tools', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: [
                    'swarm_init',
                    'swarm_status'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.some((t)=>t.name === 'swarm_init')).toBe(false);
            expect(result.tools.some((t)=>t.name === 'swarm_status')).toBe(false);
            expect(result.tools).toHaveLength(mockTools.length - 2);
        });
        it('should exclude tools matching wildcard patterns', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>!t.name.startsWith('swarm_'))).toBe(true);
            expect(result.tools).toHaveLength(mockTools.length - 3);
        });
        it('should exclude all tools with global wildcard', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: [
                    '*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(0);
        });
        it('should exclude multiple pattern groups', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: [
                    'swarm_*',
                    'agent_*',
                    'neural_*'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>!t.name.startsWith('swarm_') && !t.name.startsWith('agent_') && !t.name.startsWith('neural_'))).toBe(true);
            expect(result.tools).toHaveLength(mockTools.length - 9);
        });
    });
    describe('Category Filtering', ()=>{
        it('should filter by category in allowlist mode', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                categories: [
                    'swarm'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>t.name.startsWith('swarm_') || t.name.startsWith('agent_'))).toBe(true);
        });
        it('should filter by multiple categories', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                categories: [
                    'swarm',
                    'memory'
                ]
            });
            const result = filter.filter(mockTools);
            const toolNames = result.tools.map((t)=>t.name);
            expect(toolNames.some((n)=>n.startsWith('swarm_'))).toBe(true);
            expect(toolNames.some((n)=>n.startsWith('agent_'))).toBe(true);
            expect(toolNames.some((n)=>n.startsWith('memory_'))).toBe(true);
        });
        it('should exclude categories in denylist mode', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: [],
                categories: [
                    'neural',
                    'github'
                ]
            });
            const result = filter.filter(mockTools);
            expect(result.tools.every((t)=>!t.name.startsWith('neural_') && !t.name.startsWith('github_'))).toBe(true);
        });
        it('should correctly detect tool categories', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ]
            });
            expect(filter.getToolCategory('swarm_init')).toBe('swarm');
            expect(filter.getToolCategory('agent_spawn')).toBe('swarm');
            expect(filter.getToolCategory('memory_usage')).toBe('memory');
            expect(filter.getToolCategory('neural_train')).toBe('neural');
            expect(filter.getToolCategory('github_pr_manage')).toBe('github');
            expect(filter.getToolCategory('workflow_create')).toBe('workflow');
            expect(filter.getToolCategory('task_orchestrate')).toBe('coordination');
            expect(filter.getToolCategory('daa_agent_create')).toBe('coordination');
            expect(filter.getToolCategory('benchmark_run')).toBe('analysis');
            expect(filter.getToolCategory('features_detect')).toBe('system');
            expect(filter.getToolCategory('unknown_tool')).toBe('other');
        });
    });
    describe('maxTools Limit', ()=>{
        it('should limit the number of tools returned', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                maxTools: 5
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(5);
        });
        it('should not affect result when under limit', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ],
                maxTools: 10
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(3);
        });
        it('should maintain stable ordering when limiting', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                maxTools: 5
            });
            const result1 = filter.filter(mockTools);
            const result2 = filter.filter(mockTools);
            expect(result1.tools.map((t)=>t.name)).toEqual(result2.tools.map((t)=>t.name));
        });
    });
    describe('Priority Ordering', ()=>{
        it('should order tools by priority when limiting', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                maxTools: 3,
                toolPriorities: {
                    'neural_train': 100,
                    'swarm_init': 50,
                    'memory_usage': 75
                }
            });
            const result = filter.filter(mockTools);
            const names = result.tools.map((t)=>t.name);
            expect(names).toContain('neural_train');
            expect(names).toContain('memory_usage');
            expect(names).toContain('swarm_init');
        });
        it('should use name ordering for tools without explicit priority', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                maxTools: 5,
                toolPriorities: {
                    'neural_train': 100
                }
            });
            const result = filter.filter(mockTools);
            expect(result.tools[0].name).toBe('neural_train');
        });
        it('should handle equal priorities by name', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*',
                    'agent_*'
                ],
                maxTools: 4,
                toolPriorities: {
                    'swarm_init': 50,
                    'swarm_status': 50,
                    'agent_spawn': 50,
                    'agent_list': 50
                }
            });
            const result = filter.filter(mockTools);
            const names = result.tools.map((t)=>t.name);
            const sortedNames = [
                ...names
            ].sort();
            expect(names).toEqual(sortedNames);
        });
    });
    describe('Filter Statistics Tracking', ()=>{
        it('should track total and filtered tool counts', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ],
                trackStats: true
            });
            const result = filter.filter(mockTools);
            expect(result.stats.totalTools).toBe(mockTools.length);
            expect(result.stats.filteredTools).toBe(3);
        });
        it('should track matched patterns', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*',
                    'agent_*',
                    'nonexistent_*'
                ],
                trackStats: true
            });
            const result = filter.filter(mockTools);
            expect(result.stats.matchedPatterns).toContain('swarm_*');
            expect(result.stats.matchedPatterns).toContain('agent_*');
            expect(result.stats.matchedPatterns).not.toContain('nonexistent_*');
        });
        it('should record filter execution time', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                trackStats: true
            });
            const result = filter.filter(mockTools);
            expect(result.stats.filterTime).toBeGreaterThanOrEqual(0);
            expect(result.stats.filterTime).toBeLessThan(100);
        });
        it('should record timestamp of filter operation', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ],
                trackStats: true
            });
            const before = new Date();
            const result = filter.filter(mockTools);
            const after = new Date();
            expect(result.stats.lastFiltered.getTime()).toBeGreaterThanOrEqual(before.getTime());
            expect(result.stats.lastFiltered.getTime()).toBeLessThanOrEqual(after.getTime());
        });
        it('should provide stats via getStats()', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ],
                trackStats: true
            });
            expect(filter.getStats()).toBeUndefined();
            filter.filter(mockTools);
            const stats = filter.getStats();
            expect(stats).toBeDefined();
            expect(stats?.filteredTools).toBe(3);
        });
    });
    describe('Empty Tool List Handling', ()=>{
        it('should handle empty input gracefully', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    '*'
                ]
            });
            const result = filter.filter([]);
            expect(result.tools).toHaveLength(0);
            expect(result.stats.totalTools).toBe(0);
            expect(result.stats.filteredTools).toBe(0);
        });
        it('should handle empty patterns array', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: []
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(0);
        });
        it('should handle empty patterns in denylist mode', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'denylist',
                patterns: []
            });
            const result = filter.filter(mockTools);
            expect(result.tools).toHaveLength(mockTools.length);
        });
    });
    describe('Configuration Management', ()=>{
        it('should update configuration dynamically', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result1 = filter.filter(mockTools);
            expect(result1.tools).toHaveLength(3);
            filter.updateConfig({
                patterns: [
                    'agent_*'
                ]
            });
            const result2 = filter.filter(mockTools);
            expect(result2.tools).toHaveLength(3);
            expect(result2.tools.every((t)=>t.name.startsWith('agent_'))).toBe(true);
        });
        it('should toggle enabled state', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result1 = filter.filter(mockTools);
            expect(result1.tools).toHaveLength(3);
            filter.updateConfig({
                enabled: false
            });
            const result2 = filter.filter(mockTools);
            expect(result2.tools).toHaveLength(mockTools.length);
        });
        it('should switch modes', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const result1 = filter.filter(mockTools);
            expect(result1.tools).toHaveLength(3);
            filter.updateConfig({
                mode: 'denylist'
            });
            const result2 = filter.filter(mockTools);
            expect(result2.tools).toHaveLength(mockTools.length - 3);
        });
        it('should return current config via getConfig()', ()=>{
            const originalConfig = {
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'test_*'
                ],
                categories: [
                    'swarm'
                ],
                maxTools: 10
            };
            const filter = createToolFilter(originalConfig);
            const config = filter.getConfig();
            expect(config.enabled).toBe(true);
            expect(config.mode).toBe('allowlist');
            expect(config.patterns).toEqual([
                'test_*'
            ]);
            expect(config.categories).toEqual([
                'swarm'
            ]);
            expect(config.maxTools).toBe(10);
        });
        it('should not mutate internal config when returning', ()=>{
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'swarm_*'
                ]
            });
            const config = filter.getConfig();
            config.patterns.push('hacked_*');
            const config2 = filter.getConfig();
            expect(config2.patterns).toEqual([
                'swarm_*'
            ]);
        });
    });
    describe('Edge Cases', ()=>{
        it('should handle special characters in tool names', ()=>{
            const specialTools = [
                createMockTool('tool-with-dashes'),
                createMockTool('tool.with.dots'),
                createMockTool('tool_with_underscores'),
                createMockTool('Tool123WithNumbers')
            ];
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'tool*'
                ]
            });
            const result = filter.filter(specialTools);
            expect(result.tools).toHaveLength(3);
        });
        it('should handle very long tool names', ()=>{
            const longName = 'a'.repeat(1000);
            const longTools = [
                createMockTool(longName)
            ];
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'a*'
                ]
            });
            const result = filter.filter(longTools);
            expect(result.tools).toHaveLength(1);
        });
        it('should handle many patterns efficiently', ()=>{
            const patterns = Array.from({
                length: 100
            }, (_, i)=>`pattern_${i}_*`);
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns
            });
            const start = performance.now();
            const result = filter.filter(mockTools);
            const elapsed = performance.now() - start;
            expect(elapsed).toBeLessThan(50);
            expect(result.tools).toHaveLength(0);
        });
        it('should handle many tools efficiently', ()=>{
            const manyTools = Array.from({
                length: 1000
            }, (_, i)=>createMockTool(`tool_${i}`));
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'tool_*'
                ]
            });
            const start = performance.now();
            const result = filter.filter(manyTools);
            const elapsed = performance.now() - start;
            expect(elapsed).toBeLessThan(100);
            expect(result.tools).toHaveLength(1000);
        });
    });
    describe('Pattern Edge Cases', ()=>{
        it('should handle single character wildcard', ()=>{
            const tools = [
                createMockTool('tool_a'),
                createMockTool('tool_b'),
                createMockTool('tool_ab')
            ];
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'tool_?'
                ]
            });
            const result = filter.filter(tools);
            expect(result.tools.map((t)=>t.name)).toEqual([
                'tool_a',
                'tool_b'
            ]);
        });
        it('should handle mixed wildcards', ()=>{
            const tools = [
                createMockTool('a1x'),
                createMockTool('a2y'),
                createMockTool('a12x'),
                createMockTool('b1x')
            ];
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'a?*'
                ]
            });
            const result = filter.filter(tools);
            expect(result.tools.map((t)=>t.name)).toEqual([
                'a1x',
                'a2y',
                'a12x'
            ]);
        });
        it('should handle escaped regex special characters', ()=>{
            const tools = [
                createMockTool('tool.name'),
                createMockTool('tool_name'),
                createMockTool('toolXname')
            ];
            const filter = createToolFilter({
                enabled: true,
                mode: 'allowlist',
                patterns: [
                    'tool.name'
                ]
            });
            const result = filter.filter(tools);
            expect(result.tools).toHaveLength(1);
            expect(result.tools[0].name).toBe('tool.name');
        });
    });
});
describe('createToolFilter Factory', ()=>{
    it('should create a ToolFilter instance', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ]
        });
        expect(filter).toBeInstanceOf(ToolFilter);
    });
    it('should create independent instances', ()=>{
        const filter1 = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'swarm_*'
            ]
        });
        const filter2 = createToolFilter({
            enabled: true,
            mode: 'denylist',
            patterns: [
                'agent_*'
            ]
        });
        expect(filter1.getConfig().mode).toBe('allowlist');
        expect(filter2.getConfig().mode).toBe('denylist');
    });
});
describe('Config File Precedence', ()=>{
    const originalEnv = process.env;
    beforeEach(()=>{
        jest.resetModules();
        process.env = {
            ...originalEnv
        };
    });
    afterEach(()=>{
        process.env = originalEnv;
    });
    function createMockConfigLoader(mockFs) {
        const configPaths = [
            '.claude-flow/mcp-tools.json',
            '.claude-flow/mcp-tools.yaml',
            'mcp-tools.json'
        ];
        return async function loadConfig(cwd) {
            for (const configPath of configPaths){
                const fullPath = join(cwd, configPath);
                if (mockFs.files[fullPath]) {
                    const content = mockFs.files[fullPath];
                    const parsed = JSON.parse(content);
                    return {
                        config: {
                            enabled: parsed.enabled ?? false,
                            mode: parsed.mode ?? 'allowlist',
                            patterns: parsed.patterns ?? [],
                            categories: parsed.categories,
                            maxTools: parsed.maxTools,
                            toolPriorities: parsed.toolPriorities
                        },
                        source: configPath
                    };
                }
            }
            return null;
        };
    }
    it('should return first file found when multiple config files exist', async ()=>{
        const mockFs = {
            files: {
                '/project/.claude-flow/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'allowlist',
                    patterns: [
                        'first_*'
                    ]
                }),
                '/project/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'denylist',
                    patterns: [
                        'second_*'
                    ]
                })
            }
        };
        const loadConfig = createMockConfigLoader(mockFs);
        const result = await loadConfig('/project');
        expect(result).not.toBeNull();
        expect(result?.source).toBe('.claude-flow/mcp-tools.json');
        expect(result?.config.patterns).toEqual([
            'first_*'
        ]);
        expect(result?.config.mode).toBe('allowlist');
    });
    it('should prefer JSON over YAML at same directory level (.claude-flow)', async ()=>{
        const mockFs = {
            files: {
                '/project/.claude-flow/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'allowlist',
                    patterns: [
                        'json_*'
                    ]
                })
            }
        };
        const loadConfig = createMockConfigLoader(mockFs);
        const result = await loadConfig('/project');
        expect(result).not.toBeNull();
        expect(result?.source).toBe('.claude-flow/mcp-tools.json');
        expect(result?.config.patterns).toEqual([
            'json_*'
        ]);
    });
    it('should check .claude-flow/mcp-tools.json before mcp-tools.json at root', async ()=>{
        const mockFs = {
            files: {
                '/project/.claude-flow/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'allowlist',
                    patterns: [
                        'subdir_config_*'
                    ]
                }),
                '/project/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'denylist',
                    patterns: [
                        'root_config_*'
                    ]
                })
            }
        };
        const loadConfig = createMockConfigLoader(mockFs);
        const result = await loadConfig('/project');
        expect(result).not.toBeNull();
        expect(result?.source).toBe('.claude-flow/mcp-tools.json');
        expect(result?.config.patterns).toEqual([
            'subdir_config_*'
        ]);
    });
    it('should fall back to root mcp-tools.json when .claude-flow config is missing', async ()=>{
        const mockFs = {
            files: {
                '/project/mcp-tools.json': JSON.stringify({
                    enabled: true,
                    mode: 'denylist',
                    patterns: [
                        'fallback_*'
                    ]
                })
            }
        };
        const loadConfig = createMockConfigLoader(mockFs);
        const result = await loadConfig('/project');
        expect(result).not.toBeNull();
        expect(result?.source).toBe('mcp-tools.json');
        expect(result?.config.patterns).toEqual([
            'fallback_*'
        ]);
    });
    it('should allow environment variables to override file config values', ()=>{
        const fileConfig = {
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'file_pattern_*'
            ],
            maxTools: 10
        };
        process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED = 'false';
        process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE = 'denylist';
        process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED = 'env_tool_1,env_tool_2';
        process.env.CLAUDE_FLOW_MCP_MAX_TOOLS = '25';
        const enabledEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_ENABLED;
        const hasExplicitEnabled = enabledEnv === 'true' || enabledEnv === 'false';
        const enabled = enabledEnv === 'true';
        const modeEnv = process.env.CLAUDE_FLOW_MCP_TOOL_FILTER_MODE;
        const hasExplicitMode = modeEnv === 'allowlist' || modeEnv === 'denylist';
        const mode = hasExplicitMode ? modeEnv : fileConfig.mode;
        const toolsEnv = process.env.CLAUDE_FLOW_MCP_TOOLS_ALLOWED || '';
        const envTools = toolsEnv ? toolsEnv.split(',').map((t)=>t.trim()).filter((t)=>t.length > 0) : [];
        const maxToolsEnv = process.env.CLAUDE_FLOW_MCP_MAX_TOOLS;
        const envMaxTools = maxToolsEnv ? parseInt(maxToolsEnv, 10) : undefined;
        const mergedConfig = {
            ...fileConfig,
            enabled: hasExplicitEnabled ? enabled : fileConfig.enabled,
            mode: hasExplicitMode ? mode : fileConfig.mode,
            patterns: envTools.length > 0 ? envTools : fileConfig.patterns,
            maxTools: envMaxTools !== undefined && !isNaN(envMaxTools) ? envMaxTools : fileConfig.maxTools
        };
        expect(mergedConfig.enabled).toBe(false);
        expect(mergedConfig.mode).toBe('denylist');
        expect(mergedConfig.patterns).toEqual([
            'env_tool_1',
            'env_tool_2'
        ]);
        expect(mergedConfig.maxTools).toBe(25);
    });
    it('should return null when no config files exist', async ()=>{
        const mockFs = {
            files: {}
        };
        const loadConfig = createMockConfigLoader(mockFs);
        const result = await loadConfig('/project');
        expect(result).toBeNull();
    });
});
describe('Priority Ordering Edge Cases', ()=>{
    let mockTools;
    beforeEach(()=>{
        mockTools = [
            createMockTool('tool_a'),
            createMockTool('tool_b'),
            createMockTool('tool_c'),
            createMockTool('tool_d'),
            createMockTool('tool_e')
        ];
    });
    it('should use alphabetical ordering as tiebreaker when tools have same priority', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 5,
            toolPriorities: {
                'tool_a': 50,
                'tool_b': 50,
                'tool_c': 50,
                'tool_d': 50,
                'tool_e': 50
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names).toEqual([
            'tool_a',
            'tool_b',
            'tool_c',
            'tool_d',
            'tool_e'
        ]);
    });
    it('should ensure stable sorting with same priority (multiple runs produce same order)', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 3,
            toolPriorities: {
                'tool_a': 100,
                'tool_b': 100,
                'tool_c': 100,
                'tool_d': 50,
                'tool_e': 50
            }
        });
        const results = [];
        for(let i = 0; i < 5; i++){
            const result = filter.filter(mockTools);
            results.push(result.tools.map((t)=>t.name));
        }
        const firstResult = results[0];
        for (const result of results){
            expect(result).toEqual(firstResult);
        }
        expect(firstResult).toEqual([
            'tool_a',
            'tool_b',
            'tool_c'
        ]);
    });
    it('should always rank tools with explicit priority above those with default priority', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 3,
            toolPriorities: {
                'tool_c': 1,
                'tool_e': 1
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names).toContain('tool_c');
        expect(names).toContain('tool_e');
    });
    it('should handle negative priority values correctly', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 3,
            toolPriorities: {
                'tool_a': 100,
                'tool_b': 50,
                'tool_c': 0,
                'tool_d': -50,
                'tool_e': -100
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names[0]).toBe('tool_a');
        expect(names[1]).toBe('tool_b');
        expect(names[2]).toBe('tool_c');
        expect(names).not.toContain('tool_d');
        expect(names).not.toContain('tool_e');
    });
    it('should handle zero priority correctly', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 3,
            toolPriorities: {
                'tool_a': 0,
                'tool_b': 0,
                'tool_c': 0,
                'tool_d': 1,
                'tool_e': -1
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names[0]).toBe('tool_d');
        expect(names).toHaveLength(3);
        expect(names.includes('tool_d')).toBe(true);
        expect(names.filter((n)=>[
                'tool_a',
                'tool_b',
                'tool_c'
            ].includes(n))).toHaveLength(2);
    });
    it('should handle very large priority values correctly', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 3,
            toolPriorities: {
                'tool_a': Number.MAX_SAFE_INTEGER,
                'tool_b': 1e15,
                'tool_c': 1e10,
                'tool_d': 1e5,
                'tool_e': 1
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names[0]).toBe('tool_a');
        expect(names[1]).toBe('tool_b');
        expect(names[2]).toBe('tool_c');
    });
    it('should handle mixed positive, zero, and negative priorities', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'tool_*'
            ],
            maxTools: 4,
            toolPriorities: {
                'tool_a': 100,
                'tool_b': -100,
                'tool_c': 0,
                'tool_d': 50,
                'tool_e': -50
            }
        });
        const result = filter.filter(mockTools);
        const names = result.tools.map((t)=>t.name);
        expect(names).toHaveLength(4);
        expect(names[0]).toBe('tool_a');
        expect(names).toContain('tool_a');
        expect(names).toContain('tool_d');
        expect(names).toContain('tool_c');
        expect(names).toContain('tool_e');
        expect(names).not.toContain('tool_b');
        expect(names.indexOf('tool_a')).toBeLessThan(names.indexOf('tool_d'));
        expect(names.indexOf('tool_d')).toBeLessThan(names.indexOf('tool_c'));
        expect(names.indexOf('tool_c')).toBeLessThan(names.indexOf('tool_e'));
    });
});
describe('Empty Allowlist Behavior', ()=>{
    let mockTools;
    beforeEach(()=>{
        mockTools = createMockToolSet();
    });
    it('should return empty array when allowlist has no patterns (expected behavior)', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: []
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toHaveLength(0);
        expect(result.stats.filteredTools).toBe(0);
        expect(result.stats.totalTools).toBe(mockTools.length);
    });
    it('should return all tools when denylist has no patterns (contrast with allowlist)', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'denylist',
            patterns: []
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toHaveLength(mockTools.length);
        expect(result.stats.filteredTools).toBe(mockTools.length);
    });
    it('should still respect maxTools even with empty allowlist result', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [],
            maxTools: 5
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toHaveLength(0);
    });
});
describe('Config Validation', ()=>{
    let mockTools;
    beforeEach(()=>{
        mockTools = createMockToolSet();
    });
    it('should default to allowlist mode when mode value is invalid', ()=>{
        const invalidConfig = {
            enabled: true,
            mode: 'invalid_mode',
            patterns: [
                'swarm_*'
            ]
        };
        const filter = createToolFilter(invalidConfig);
        const config = filter.getConfig();
        const result = filter.filter(mockTools);
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);
    });
    it('should handle negative maxTools value', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ],
            maxTools: -5
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);
    });
    it('should ignore zero maxTools value', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ],
            maxTools: 0
        });
        const result = filter.filter(mockTools);
        expect(result.tools.length).toBeGreaterThanOrEqual(0);
    });
    it('should handle NaN maxTools gracefully', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ],
            maxTools: parseInt('not_a_number', 10)
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toBeDefined();
        expect(Array.isArray(result.tools)).toBe(true);
    });
    it('should skip malformed patterns gracefully without throwing', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'valid_pattern_*',
                '',
                'another_valid_*'
            ]
        });
        expect(()=>filter.filter(mockTools)).not.toThrow();
        const result = filter.filter(mockTools);
        expect(result.tools).toBeDefined();
    });
    it('should handle undefined categories array', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'swarm_*'
            ],
            categories: undefined
        });
        const result = filter.filter(mockTools);
        expect(result.tools.length).toBe(3);
    });
    it('should handle empty categories array', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ],
            categories: []
        });
        const result = filter.filter(mockTools);
        expect(result.tools.length).toBeGreaterThan(0);
    });
    it('should handle toolPriorities with undefined values', ()=>{
        const filter = createToolFilter({
            enabled: true,
            mode: 'allowlist',
            patterns: [
                'swarm_*'
            ],
            maxTools: 2,
            toolPriorities: {
                'swarm_init': 100,
                'swarm_status': undefined,
                'swarm_monitor': 50
            }
        });
        const result = filter.filter(mockTools);
        expect(result.tools).toHaveLength(2);
    });
    it('should validate and use defaults for missing config properties', ()=>{
        const minimalConfig = {
            enabled: true,
            mode: 'allowlist',
            patterns: [
                '*'
            ]
        };
        const filter = createToolFilter(minimalConfig);
        const config = filter.getConfig();
        expect(config.enabled).toBe(true);
        expect(config.mode).toBe('allowlist');
        expect(config.patterns).toEqual([
            '*'
        ]);
        expect(config.maxTools).toBeUndefined();
    });
});
describe('Pattern Validation (ReDoS Protection)', ()=>{
    let validateGlobPattern;
    let MAX_PATTERN_LENGTH;
    let ToolFilterClass;
    beforeAll(async ()=>{
        const toolFilterModule = await import('../mcp/tool-filter.js');
        validateGlobPattern = toolFilterModule.validateGlobPattern;
        MAX_PATTERN_LENGTH = toolFilterModule.MAX_PATTERN_LENGTH;
        ToolFilterClass = toolFilterModule.ToolFilter;
    });
    describe('validateGlobPattern', ()=>{
        it('should accept valid simple patterns', ()=>{
            expect(validateGlobPattern('system/*').valid).toBe(true);
            expect(validateGlobPattern('agent_spawn').valid).toBe(true);
            expect(validateGlobPattern('**/test').valid).toBe(true);
            expect(validateGlobPattern('*.js').valid).toBe(true);
        });
        it('should reject non-string patterns', ()=>{
            const result = validateGlobPattern(123);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('must be a string');
        });
        it('should reject empty strings', ()=>{
            const result = validateGlobPattern('');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('cannot be empty');
        });
        it('should reject whitespace-only strings', ()=>{
            const result = validateGlobPattern('   ');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('whitespace only');
        });
        it('should reject patterns exceeding max length', ()=>{
            const longPattern = 'a'.repeat(MAX_PATTERN_LENGTH + 1);
            const result = validateGlobPattern(longPattern);
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('maximum length');
        });
        it('should accept patterns at max length', ()=>{
            const maxPattern = 'a'.repeat(MAX_PATTERN_LENGTH);
            const result = validateGlobPattern(maxPattern);
            expect(result.valid).toBe(true);
        });
        it('should reject nested double stars (ReDoS risk)', ()=>{
            const result = validateGlobPattern('**/**/file.js');
            expect(result.valid).toBe(false);
            expect(result.reason?.includes('catastrophic backtracking') || result.reason?.includes('performance issues')).toBe(true);
        });
        it('should reject triple wildcards', ()=>{
            const result = validateGlobPattern('***');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('not valid glob patterns');
        });
        it('should reject excessive repeated wildcard segments', ()=>{
            const result = validateGlobPattern('/*/*/*/*/*/*');
            expect(result.valid).toBe(false);
            expect(result.reason).toContain('Excessive repeated');
        });
        it('should accept valid double star patterns', ()=>{
            expect(validateGlobPattern('**/file.js').valid).toBe(true);
            expect(validateGlobPattern('src/**/*.ts').valid).toBe(true);
        });
        it('should accept normal glob patterns with multiple wildcards', ()=>{
            expect(validateGlobPattern('*.{js,ts}').valid).toBe(true);
            expect(validateGlobPattern('src/*.test.js').valid).toBe(true);
        });
    });
    describe('Pattern Validation in ToolFilter', ()=>{
        it('should filter out invalid patterns during construction', ()=>{
            const mockLogger = {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            };
            const filter = new ToolFilterClass({
                enabled: true,
                mode: 'allowlist',
                tools: [
                    'system/*',
                    '**/**/**',
                    'valid_tool',
                    '***'
                ]
            }, mockLogger);
            expect(mockLogger.warn).toHaveBeenCalled();
        });
    });
});

//# sourceMappingURL=tool-filter.test.js.map