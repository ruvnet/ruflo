import { EventEmitter } from 'events';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from '../../utils/type-guards.js';
const execAsync = promisify(exec);
export class MCPToolWrapper extends EventEmitter {
    toolPrefix = 'mcp__ruv-swarm__';
    isInitialized = false;
    constructor(){
        super();
    }
    async initialize() {
        try {
            await this.checkToolAvailability();
            this.isInitialized = true;
            this.emit('initialized');
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async checkToolAvailability() {
        try {
            const { stdout } = await execAsync('npx ruv-swarm --version');
            if (!stdout) {
                throw new Error('ruv-swarm MCP tools not found');
            }
        } catch (error) {
            throw new Error('MCP tools not available. Please ensure ruv-swarm is installed.');
        }
    }
    async executeTool(toolName, params) {
        try {
            const command = `npx ruv-swarm mcp-execute ${toolName} '${JSON.stringify(params)}'`;
            const { stdout, stderr } = await execAsync(command);
            if (stderr) {
                return {
                    success: false,
                    error: stderr
                };
            }
            const result = JSON.parse(stdout);
            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                error: getErrorMessage(error)
            };
        }
    }
    async initSwarm(params) {
        return this.executeTool('swarm_init', params);
    }
    async spawnAgent(params) {
        return this.executeTool('agent_spawn', params);
    }
    async orchestrateTask(params) {
        return this.executeTool('task_orchestrate', params);
    }
    async getSwarmStatus(swarmId) {
        return this.executeTool('swarm_status', {
            swarmId
        });
    }
    async monitorSwarm(params) {
        return this.executeTool('swarm_monitor', params);
    }
    async analyzePattern(params) {
        return this.executeTool('neural_patterns', params);
    }
    async trainNeural(params) {
        return this.executeTool('neural_train', params);
    }
    async predict(params) {
        return this.executeTool('neural_predict', params);
    }
    async getNeuralStatus(modelId) {
        return this.executeTool('neural_status', {
            modelId
        });
    }
    async storeMemory(params) {
        return this.executeTool('memory_usage', params);
    }
    async retrieveMemory(params) {
        const result = await this.executeTool('memory_usage', params);
        return result.success ? result.data : null;
    }
    async searchMemory(params) {
        return this.executeTool('memory_search', params);
    }
    async deleteMemory(params) {
        return this.executeTool('memory_usage', params);
    }
    async listMemory(params) {
        return this.executeTool('memory_usage', params);
    }
    async getPerformanceReport(params) {
        return this.executeTool('performance_report', params || {});
    }
    async analyzeBottlenecks(params) {
        return this.executeTool('bottleneck_analyze', params || {});
    }
    async getTokenUsage(params) {
        return this.executeTool('token_usage', params || {});
    }
    async listAgents(swarmId) {
        return this.executeTool('agent_list', {
            swarmId
        });
    }
    async getAgentMetrics(agentId) {
        return this.executeTool('agent_metrics', {
            agentId
        });
    }
    async getTaskStatus(taskId) {
        return this.executeTool('task_status', {
            taskId
        });
    }
    async getTaskResults(taskId) {
        return this.executeTool('task_results', {
            taskId
        });
    }
    async optimizeTopology(swarmId) {
        return this.executeTool('topology_optimize', {
            swarmId
        });
    }
    async loadBalance(params) {
        return this.executeTool('load_balance', params);
    }
    async syncCoordination(swarmId) {
        return this.executeTool('coordination_sync', {
            swarmId
        });
    }
    async scaleSwarm(params) {
        return this.executeTool('swarm_scale', params);
    }
    async runSparcMode(params) {
        return this.executeTool('sparc_mode', params);
    }
    async createWorkflow(params) {
        return this.executeTool('workflow_create', params);
    }
    async executeWorkflow(params) {
        return this.executeTool('workflow_execute', params);
    }
    async analyzeRepository(params) {
        return this.executeTool('github_repo_analyze', params);
    }
    async manageGitHubPR(params) {
        return this.executeTool('github_pr_manage', params);
    }
    async createDynamicAgent(params) {
        return this.executeTool('daa_agent_create', params);
    }
    async matchCapabilities(params) {
        return this.executeTool('daa_capability_match', params);
    }
    async runBenchmark(suite) {
        return this.executeTool('benchmark_run', {
            suite
        });
    }
    async collectMetrics(components) {
        return this.executeTool('metrics_collect', {
            components
        });
    }
    async analyzeTrends(params) {
        return this.executeTool('trend_analysis', params);
    }
    async analyzeCost(timeframe) {
        return this.executeTool('cost_analysis', {
            timeframe
        });
    }
    async assessQuality(params) {
        return this.executeTool('quality_assess', params);
    }
    async healthCheck(components) {
        return this.executeTool('health_check', {
            components
        });
    }
    async batchProcess(params) {
        return this.executeTool('batch_process', params);
    }
    async parallelExecute(tasks) {
        return this.executeTool('parallel_execute', {
            tasks
        });
    }
    async executeMCPTool(toolName, params) {
        return this.executeTool(toolName, params);
    }
    formatResponse(response) {
        if (response.success) {
            return response.data;
        } else {
            throw new Error(`MCP Tool Error: ${response.error}`);
        }
    }
}

//# sourceMappingURL=MCPToolWrapper.js.map