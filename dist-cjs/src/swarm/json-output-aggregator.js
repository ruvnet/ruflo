import { EventEmitter } from 'events';
import { promises as fs } from 'node:fs';
import { Logger } from '../core/logger.js';
export class SwarmJsonOutputAggregator extends EventEmitter {
    logger;
    swarmId;
    objective;
    startTime;
    endTime;
    configuration;
    agents = new Map();
    tasks = new Map();
    outputs = [];
    errors = [];
    insights = [];
    artifacts = {};
    metrics = this.initializeMetrics();
    constructor(swarmId, objective, configuration = {}){
        super();
        this.swarmId = swarmId;
        this.objective = objective;
        this.configuration = configuration;
        this.startTime = new Date();
        this.logger = new Logger({
            level: 'info',
            format: 'json',
            destination: 'console'
        }, {
            component: 'SwarmJsonAggregator'
        });
        this.logger.info('JSON output aggregator initialized', {
            swarmId,
            objective,
            timestamp: this.startTime.toISOString()
        });
    }
    addAgent(agent) {
        if (!agent || !agent.id) {
            this.logger.warn('Attempted to add agent with null/undefined ID, skipping');
            return;
        }
        const agentIdStr = typeof agent.id === 'string' ? agent.id : agent.id.id;
        const agentData = {
            agentId: agentIdStr,
            name: agent.name || agentIdStr,
            type: agent.type,
            status: agent.status,
            startTime: new Date().toISOString(),
            tasksCompleted: 0,
            outputs: [],
            errors: [],
            metrics: {
                memoryAccess: 0,
                operationsPerformed: 0
            }
        };
        this.agents.set(agentIdStr, agentData);
        this.logger.debug('Agent added to output tracking', {
            agentId: agentIdStr
        });
    }
    updateAgent(agentId, updates) {
        const agent = this.agents.get(agentId);
        if (agent) {
            Object.assign(agent, updates);
            this.logger.debug('Agent updated in output tracking', {
                agentId,
                updates
            });
        }
    }
    addAgentOutput(agentId, output) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.outputs.push(output);
            agent.metrics.operationsPerformed++;
        }
        this.outputs.push(`[${agentId}] ${output}`);
    }
    addAgentError(agentId, error) {
        const agent = this.agents.get(agentId);
        if (agent) {
            agent.errors.push(error);
        }
        this.errors.push(`[${agentId}] ${error}`);
    }
    addTask(task) {
        if (!task || !task.id) {
            this.logger.warn('Attempted to add task with null/undefined ID, skipping');
            return;
        }
        const taskIdStr = typeof task.id === 'string' ? task.id : task.id.id;
        const taskData = {
            taskId: taskIdStr,
            name: task.name || taskIdStr,
            type: task.type,
            status: task.status,
            assignedAgent: task.assignedAt ? typeof task.assignedAt === 'string' ? task.assignedAt : task.assignedAt.toString() : undefined,
            startTime: new Date().toISOString(),
            priority: task.priority || 'normal'
        };
        this.tasks.set(taskIdStr, taskData);
        this.logger.debug('Task added to output tracking', {
            taskId: taskIdStr
        });
    }
    updateTask(taskId, updates) {
        const task = this.tasks.get(taskId);
        if (task) {
            Object.assign(task, updates);
            this.logger.debug('Task updated in output tracking', {
                taskId,
                updates
            });
        }
    }
    completeTask(taskId, result) {
        const task = this.tasks.get(taskId);
        if (task) {
            task.status = 'completed';
            task.endTime = new Date().toISOString();
            task.duration = task.startTime ? Date.now() - new Date(task.startTime).getTime() : 0;
            task.result = result;
            task.output = result.output;
            task.artifacts = result.artifacts;
            if (task.assignedAgent) {
                const agent = this.agents.get(task.assignedAgent);
                if (agent) {
                    agent.tasksCompleted++;
                }
            }
        }
    }
    addInsight(insight) {
        this.insights.push(insight);
        this.logger.debug('Insight added', {
            insight
        });
    }
    addArtifact(key, artifact) {
        this.artifacts[key] = artifact;
        this.logger.debug('Artifact added', {
            key
        });
    }
    updateMetrics(updates) {
        Object.assign(this.metrics, updates);
    }
    finalize(status = 'completed') {
        this.endTime = new Date();
        const duration = this.endTime.getTime() - this.startTime.getTime();
        const totalTasks = this.tasks.size;
        const completedTasks = Array.from(this.tasks.values()).filter((task)=>task.status === 'completed').length;
        const failedTasks = Array.from(this.tasks.values()).filter((task)=>task.status === 'failed').length;
        const successRate = totalTasks > 0 ? completedTasks / totalTasks : 0;
        this.agents.forEach((agent)=>{
            if (!agent.endTime) {
                agent.endTime = this.endTime.toISOString();
                agent.duration = Date.now() - new Date(agent.startTime).getTime();
            }
        });
        const aggregate = {
            swarmId: this.swarmId,
            objective: this.objective,
            startTime: this.startTime.toISOString(),
            endTime: this.endTime.toISOString(),
            duration,
            status,
            summary: {
                totalAgents: this.agents.size,
                totalTasks,
                completedTasks,
                failedTasks,
                successRate
            },
            agents: Array.from(this.agents.values()),
            tasks: Array.from(this.tasks.values()),
            results: {
                artifacts: this.artifacts,
                outputs: this.outputs,
                errors: this.errors,
                insights: this.insights
            },
            metrics: this.metrics,
            metadata: {
                strategy: this.configuration.strategy || 'auto',
                mode: this.configuration.mode || 'centralized',
                configuration: this.configuration,
                version: '2.0.0-alpha'
            }
        };
        this.logger.info('Swarm output aggregation finalized', {
            swarmId: this.swarmId,
            status,
            duration,
            summary: aggregate.summary
        });
        return aggregate;
    }
    async saveToFile(filePath, status = 'completed') {
        const aggregate = this.finalize(status);
        const json = JSON.stringify(aggregate, this.circularReplacer(), 2);
        await fs.writeFile(filePath, json, 'utf8');
        this.logger.info('Swarm output saved to file', {
            filePath,
            size: json.length
        });
    }
    getJsonOutput(status = 'completed') {
        const aggregate = this.finalize(status);
        return JSON.stringify(aggregate, this.circularReplacer(), 2);
    }
    circularReplacer() {
        const seen = new WeakSet();
        return (key, value)=>{
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            return value;
        };
    }
    initializeMetrics() {
        return {
            throughput: 0,
            latency: 0,
            efficiency: 0,
            reliability: 0,
            averageQuality: 0,
            defectRate: 0,
            reworkRate: 0,
            resourceUtilization: {
                cpu: 0,
                memory: 0,
                disk: 0,
                network: 0
            },
            costEfficiency: 0,
            agentUtilization: 0,
            agentSatisfaction: 0,
            collaborationEffectiveness: 0,
            scheduleVariance: 0,
            deadlineAdherence: 0
        };
    }
}

//# sourceMappingURL=json-output-aggregator.js.map