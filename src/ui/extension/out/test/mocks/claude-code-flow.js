"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
// Mock implementation of claude-code-flow for testing
const events_1 = require("events");
class Orchestrator extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.initialized = false;
        this.agents = [];
    }
    async initialize() {
        this.initialized = true;
        this.emit('initialized');
    }
    async spawnAgent(config) {
        const agent = { id: Math.random().toString(), ...config };
        this.agents.push(agent);
        this.emit('agent.spawned', agent);
        return agent;
    }
    async clearAgents() {
        this.agents = [];
        this.emit('agents.cleared');
    }
    async setWorkflow(workflow) {
        this.emit('workflow.set', workflow);
    }
    async assignTask(task) {
        this.emit('task.assigned', task);
    }
    registerTool(tool) {
        this.emit('tool.registered', tool);
    }
    getAgents() {
        return this.agents;
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=claude-code-flow.js.map