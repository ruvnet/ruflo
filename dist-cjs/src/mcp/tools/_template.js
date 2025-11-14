export function createToolTemplateTool(logger) {
    return {
        name: 'category/toolname',
        description: 'Template for creating new MCP tools with progressive disclosure. Copy and customize this file.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        metadata: {
            category: 'system',
            tags: [
                'template',
                'example'
            ],
            examples: [
                {
                    description: 'Example usage scenario',
                    input: {},
                    expectedOutput: {}
                }
            ],
            detailLevel: 'standard'
        },
        handler: async (input, context)=>{
            if (!context?.orchestrator) {
                throw new Error('Orchestrator not available in tool context');
            }
            const validatedInput = input;
            logger.info('category/toolname invoked', {
                input: validatedInput,
                sessionId: context.sessionId
            });
            try {
                logger.info('[namespace]/[toolname] completed successfully', {
                    input: validatedInput
                });
                return {
                    success: true
                };
            } catch (error) {
                logger.error('[namespace]/[toolname] failed', {
                    error,
                    input: validatedInput
                });
                throw error;
            }
        }
    };
}
export const toolMetadata = {
    name: 'category/toolname',
    description: "Brief one-line description of the tool",
    category: 'system',
    detailLevel: 'standard',
    tags: [
        'template',
        'example'
    ]
};

//# sourceMappingURL=_template.js.map