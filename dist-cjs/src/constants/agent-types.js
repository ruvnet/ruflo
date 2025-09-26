import { getAvailableAgentTypes, isValidAgentType as validateAgentType, resolveLegacyAgentType as resolveLegacy, LEGACY_AGENT_MAPPING as LEGACY_MAPPING } from '../agents/agent-loader.js';
export const LEGACY_AGENT_MAPPING = LEGACY_MAPPING;
export async function getValidAgentTypes() {
    return await getAvailableAgentTypes();
}
export async function isValidAgentType(type) {
    return await validateAgentType(type);
}
export const resolveLegacyAgentType = resolveLegacy;
export async function getAgentTypeSchema() {
    const validTypes = await getValidAgentTypes();
    return {
        type: 'string',
        enum: validTypes,
        description: 'Type of specialized AI agent'
    };
}
export const SWARM_STRATEGIES = {
    AUTO: 'auto',
    RESEARCH: 'research',
    DEVELOPMENT: 'development',
    ANALYSIS: 'analysis',
    TESTING: 'testing',
    OPTIMIZATION: 'optimization',
    MAINTENANCE: 'maintenance',
    CUSTOM: 'custom'
};
export const VALID_SWARM_STRATEGIES = Object.values(SWARM_STRATEGIES);
export const ORCHESTRATION_STRATEGIES = {
    PARALLEL: 'parallel',
    SEQUENTIAL: 'sequential',
    ADAPTIVE: 'adaptive',
    BALANCED: 'balanced'
};
export const VALID_ORCHESTRATION_STRATEGIES = Object.values(ORCHESTRATION_STRATEGIES);

//# sourceMappingURL=agent-types.js.map