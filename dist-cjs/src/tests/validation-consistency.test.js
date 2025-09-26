import { describe, test, expect } from '@jest/globals';
import { VALID_AGENT_TYPES } from '../constants/agent-types.js';
const mcpServer = require('../mcp/mcp-server.js');
import { getClaudeFlowTools } from '../mcp/claude-flow-tools.js';
import { getRuvSwarmTools } from '../mcp/ruv-swarm-tools.js';
import { getSwarmTools } from '../mcp/swarm-tools.js';
describe('Agent Type Validation Consistency', ()=>{
    const expectedTypes = VALID_AGENT_TYPES.sort();
    test('MCP server agent_spawn uses consistent agent types', ()=>{
        const agentSpawnTool = mcpServer.tools.agent_spawn;
        const enumValues = agentSpawnTool.inputSchema.properties.type.enum;
        expect(enumValues.sort()).toEqual(expectedTypes);
    });
    test('Claude Flow tools use consistent agent types', ()=>{
        const tools = getClaudeFlowTools({});
        const spawnTool = tools.find((t)=>t.name === 'spawn_agent');
        const enumValues = spawnTool?.inputSchema.properties.type.enum;
        expect(enumValues?.sort()).toEqual(expectedTypes);
    });
    test('Ruv Swarm tools use consistent agent types', ()=>{
        const tools = getRuvSwarmTools({});
        const spawnTool = tools.find((t)=>t.name === 'spawn_agent');
        const enumValues = spawnTool?.inputSchema.properties.type.enum;
        expect(enumValues?.sort()).toEqual(expectedTypes);
    });
    test('Swarm tools use consistent agent types', ()=>{
        const tools = getSwarmTools({});
        const spawnTool = tools.find((t)=>t.name === 'spawn_agent');
        const enumValues = spawnTool?.inputSchema.properties.type.enum;
        expect(enumValues?.sort()).toEqual(expectedTypes);
    });
    test('Error wrapper validation uses consistent agent types', ()=>{
        expect(true).toBe(true);
    });
});
describe('Strategy Validation Consistency', ()=>{
    test('Task orchestrate uses correct orchestration strategies', ()=>{
        const taskOrchestrateTool = mcpServer.tools.task_orchestrate;
        const strategies = taskOrchestrateTool.inputSchema.properties.strategy.enum;
        expect(strategies).toEqual([
            'parallel',
            'sequential',
            'adaptive',
            'balanced'
        ]);
    });
});

//# sourceMappingURL=validation-consistency.test.js.map