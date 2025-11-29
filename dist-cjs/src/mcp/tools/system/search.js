export function createSearchToolsTool(loader, logger) {
    return {
        name: 'tools/search',
        description: "Search for tools with configurable detail levels. Use names-only for quick discovery (saves 98%+ tokens), basic for descriptions, full for complete schemas. This is the primary tool discovery mechanism.",
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: "Search query (searches tool names and descriptions)"
                },
                category: {
                    type: 'string',
                    description: 'Filter by category',
                    enum: [
                        'agents',
                        'tasks',
                        'memory',
                        'system',
                        'config',
                        'workflow',
                        'terminal',
                        'query',
                        'swarm',
                        'data',
                        'jobs'
                    ]
                },
                tags: {
                    type: 'array',
                    items: {
                        type: 'string'
                    },
                    description: 'Filter by tags (all tags must match)'
                },
                detailLevel: {
                    type: 'string',
                    enum: [
                        'names-only',
                        'basic',
                        'full'
                    ],
                    description: "Level of detail to return. names-only: just names (fastest, minimal tokens). basic: name + description + category (recommended for discovery). full: complete schemas with examples (use only when needed)",
                    default: 'basic'
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results (default: 20)',
                    minimum: 1,
                    maximum: 100,
                    default: 20
                }
            },
            required: []
        },
        metadata: {
            category: 'system',
            tags: [
                'discovery',
                'search',
                'progressive-disclosure',
                'tools'
            ],
            examples: [
                {
                    description: 'Quick search for agent-related tools (minimal tokens)',
                    input: {
                        query: 'agent',
                        detailLevel: 'names-only',
                        limit: 10
                    },
                    expectedOutput: {
                        tools: [
                            {
                                name: 'agents/spawn'
                            },
                            {
                                name: 'agents/list'
                            },
                            {
                                name: 'agents/terminate'
                            }
                        ],
                        totalMatches: 5,
                        detailLevel: 'names-only'
                    }
                },
                {
                    description: 'Get basic info about system tools',
                    input: {
                        category: 'system',
                        detailLevel: 'basic'
                    },
                    expectedOutput: {
                        tools: [
                            {
                                name: 'system/status',
                                description: 'Get system health status',
                                category: 'system'
                            }
                        ],
                        totalMatches: 3,
                        detailLevel: 'basic'
                    }
                },
                {
                    description: 'Get full schema for specific tool',
                    input: {
                        query: 'agents/spawn',
                        detailLevel: 'full',
                        limit: 1
                    },
                    expectedOutput: {
                        tools: [
                            {
                                name: 'agents/spawn',
                                description: 'Spawn a new agent',
                                category: 'agents',
                                inputSchema: {
                                    type: 'object',
                                    properties: {}
                                },
                                examples: []
                            }
                        ],
                        totalMatches: 1,
                        detailLevel: 'full'
                    }
                }
            ],
            detailLevel: 'standard'
        },
        handler: async (input, context)=>{
            const validatedInput = input;
            const detailLevel = validatedInput.detailLevel || 'basic';
            const limit = validatedInput.limit || 20;
            logger.info('tools/search invoked', {
                query: validatedInput.query,
                category: validatedInput.category,
                detailLevel,
                limit
            });
            try {
                const metadata = loader.searchTools({
                    category: validatedInput.category,
                    tags: validatedInput.tags,
                    namePattern: validatedInput.query
                });
                logger.debug('Tool search results', {
                    totalMatches: metadata.length,
                    detailLevel
                });
                const results = [];
                const limitedMetadata = metadata.slice(0, limit);
                for (const meta of limitedMetadata){
                    if (detailLevel === 'names-only') {
                        results.push({
                            name: meta.name
                        });
                    } else if (detailLevel === 'basic') {
                        results.push({
                            name: meta.name,
                            description: meta.description,
                            category: meta.category,
                            tags: meta.tags
                        });
                    } else if (detailLevel === 'full') {
                        const tool = await loader.loadTool(meta.name, logger);
                        if (tool) {
                            results.push({
                                name: tool.name,
                                description: tool.description,
                                category: meta.category,
                                tags: meta.tags,
                                inputSchema: tool.inputSchema,
                                examples: tool.metadata?.examples || []
                            });
                        }
                    }
                }
                const actualSize = JSON.stringify(results).length;
                const estimatedFullSize = limitedMetadata.length * 2000;
                const reductionPercent = detailLevel === 'full' ? 0 : (estimatedFullSize - actualSize) / estimatedFullSize * 100;
                logger.info('tools/search completed successfully', {
                    resultsCount: results.length,
                    totalMatches: metadata.length,
                    detailLevel,
                    actualSizeBytes: actualSize,
                    reductionPercent: reductionPercent.toFixed(2)
                });
                return {
                    success: true,
                    tools: results,
                    totalMatches: metadata.length,
                    detailLevel,
                    tokenSavings: detailLevel !== 'full' ? {
                        estimatedFullSize,
                        actualSize,
                        reductionPercent: Math.round(reductionPercent * 100) / 100
                    } : undefined
                };
            } catch (error) {
                logger.error('tools/search failed', {
                    error,
                    input: validatedInput
                });
                throw error;
            }
        }
    };
}
export const toolMetadata = {
    name: 'tools/search',
    description: 'Search and discover tools with progressive disclosure',
    category: 'system',
    detailLevel: 'standard',
    tags: [
        'discovery',
        'search',
        'tools'
    ]
};

//# sourceMappingURL=search.js.map