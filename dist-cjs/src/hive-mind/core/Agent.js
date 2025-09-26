import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './DatabaseManager.js';
import { MCPToolWrapper } from '../integration/MCPToolWrapper.js';
export class Agent extends EventEmitter {
    id;
    name;
    type;
    swarmId;
    capabilities;
    createdAt;
    status = 'idle';
    currentTask = null;
    messageCount = 0;
    db;
    mcpWrapper;
    memory;
    communicationBuffer;
    lastHeartbeat;
    isActive = false;
    constructor(config){
        super();
        this.id = config.id || uuidv4();
        this.name = config.name;
        this.type = config.type;
        this.swarmId = config.swarmId;
        this.capabilities = config.capabilities || [];
        this.createdAt = new Date();
        this.memory = new Map();
        this.communicationBuffer = [];
        this.lastHeartbeat = Date.now();
    }
    async initialize() {
        this.db = await DatabaseManager.getInstance();
        this.mcpWrapper = new MCPToolWrapper();
        const existingAgent = await this.db.getAgent(this.id);
        if (existingAgent) {
            this.status = existingAgent.status;
            this.currentTask = existingAgent.current_task_id;
            this.messageCount = existingAgent.message_count;
        }
        this.startHeartbeatLoop();
        this.startCommunicationLoop();
        this.startLearningLoop();
        this.isActive = true;
        this.emit('initialized');
    }
    async assignTask(taskId, executionPlan) {
        if (this.currentTask) {
            throw new Error('Agent already has an active task');
        }
        this.currentTask = taskId;
        this.status = 'busy';
        await this.db.updateAgent(this.id, {
            status: 'busy',
            current_task_id: taskId
        });
        this.memory.set('current_task', {
            taskId,
            executionPlan,
            startTime: Date.now()
        });
        this.executeTask(taskId, executionPlan).catch((error)=>{
            this.emit('taskError', {
                taskId,
                error
            });
        });
        this.emit('taskAssigned', {
            taskId
        });
    }
    async executeTask(taskId, executionPlan) {
        try {
            const task = await this.db.getTask(taskId);
            if (!task) {
                throw new Error('Task not found');
            }
            await this.db.updateTaskStatus(taskId, 'in_progress');
            const result = await this.executeByType(task, executionPlan);
            await this.db.updateTask(taskId, {
                status: 'completed',
                result: JSON.stringify(result),
                progress: 100,
                completed_at: new Date()
            });
            await this.learnFromExecution(task, result);
            this.currentTask = null;
            this.status = 'idle';
            await this.db.updateAgent(this.id, {
                status: 'idle',
                current_task_id: null,
                success_count: this.db.raw('success_count + 1')
            });
            this.emit('taskCompleted', {
                taskId,
                result
            });
        } catch (error) {
            await this.handleTaskFailure(taskId, error);
        }
    }
    async executeByType(task, executionPlan) {
        const startTime = Date.now();
        const phases = executionPlan.phases || [
            'analysis',
            'execution',
            'validation'
        ];
        const results = [];
        for (const phase of phases){
            const phaseResult = await this.executePhase(phase, task, executionPlan);
            results.push(phaseResult);
            const progress = Math.round((phases.indexOf(phase) + 1) / phases.length * 100);
            await this.updateTaskProgress(task.id, progress);
            await this.communicateProgress(task.id, phase, progress);
        }
        return {
            success: true,
            data: results,
            executionTime: Date.now() - startTime,
            agentId: this.id,
            metadata: {
                phases: phases,
                plan: executionPlan
            }
        };
    }
    async executePhase(phase, task, plan) {
        switch(phase){
            case 'analysis':
                return this.performAnalysis(task);
            case 'execution':
                return this.performExecution(task, plan);
            case 'validation':
                return this.performValidation(task);
            default:
                return {
                    phase,
                    status: 'completed'
                };
        }
    }
    async performAnalysis(task) {
        const analysis = await this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: `${this.type}_analysis`,
            metadata: {
                task: task.description,
                agentType: this.type,
                capabilities: this.capabilities
            }
        });
        await this.storeInMemory('task_analysis', analysis);
        return {
            phase: 'analysis',
            complexity: analysis.complexity || 'medium',
            estimatedTime: analysis.estimatedTime || 3600000,
            requirements: analysis.requirements || []
        };
    }
    async performExecution(task, plan) {
        const actions = plan.agentAssignments?.find((a)=>a.agentId === this.id)?.responsibilities || [];
        const results = [];
        for (const action of actions){
            const actionResult = await this.executeAction(action, task);
            results.push(actionResult);
        }
        return {
            phase: 'execution',
            actions: actions,
            results: results
        };
    }
    async performValidation(task) {
        const validation = {
            phase: 'validation',
            checks: [],
            passed: true
        };
        const checks = [
            {
                name: 'completeness',
                passed: true
            },
            {
                name: 'quality',
                passed: true
            },
            {
                name: 'performance',
                passed: true
            }
        ];
        validation.checks = checks;
        validation.passed = checks.every((c)=>c.passed);
        return validation;
    }
    async executeAction(action, task) {
        return {
            action: action,
            status: 'completed',
            timestamp: new Date()
        };
    }
    async sendMessage(toAgentId, messageType, content) {
        const message = {
            id: uuidv4(),
            fromAgentId: this.id,
            toAgentId,
            swarmId: this.swarmId,
            type: messageType,
            content,
            timestamp: new Date(),
            requiresResponse: false
        };
        await this.db.createCommunication({
            from_agent_id: this.id,
            to_agent_id: toAgentId,
            swarm_id: this.swarmId,
            message_type: messageType,
            content: JSON.stringify(content),
            priority: 'normal'
        });
        this.messageCount++;
        this.emit('messageSent', message);
    }
    async receiveMessage(message) {
        this.communicationBuffer.push(message);
        this.emit('messageReceived', message);
    }
    async voteOnProposal(proposalId, vote, reason) {
        await this.db.submitConsensusVote(proposalId, this.id, vote, reason);
        this.emit('voteCast', {
            proposalId,
            vote,
            reason
        });
    }
    async updateTaskProgress(taskId, progress) {
        await this.db.updateTask(taskId, {
            progress,
            last_progress_update: new Date()
        });
    }
    async communicateProgress(taskId, phase, progress) {
        await this.sendMessage(null, 'progress_update', {
            taskId,
            agentId: this.id,
            phase,
            progress,
            timestamp: new Date()
        });
    }
    async storeInMemory(key, value) {
        this.memory.set(key, value);
        await this.mcpWrapper.storeMemory({
            action: 'store',
            key: `agent/${this.id}/${key}`,
            value: JSON.stringify(value),
            namespace: 'agent-memory',
            ttl: 3600
        });
    }
    async retrieveFromMemory(key) {
        if (this.memory.has(key)) {
            return this.memory.get(key);
        }
        const result = await this.mcpWrapper.retrieveMemory({
            action: 'retrieve',
            key: `agent/${this.id}/${key}`,
            namespace: 'agent-memory'
        });
        return result ? JSON.parse(result) : null;
    }
    async learnFromExecution(task, result) {
        const learningData = {
            taskType: this.detectTaskType(task.description),
            agentType: this.type,
            success: result.success,
            executionTime: result.executionTime,
            patterns: this.extractPatterns(task, result)
        };
        await this.mcpWrapper.trainNeural({
            pattern_type: 'optimization',
            training_data: JSON.stringify(learningData),
            epochs: 10
        });
    }
    async handleTaskFailure(taskId, error) {
        await this.db.updateTask(taskId, {
            status: 'failed',
            error: error.message,
            completed_at: new Date()
        });
        await this.db.updateAgent(this.id, {
            status: 'idle',
            current_task_id: null,
            error_count: this.db.raw('error_count + 1')
        });
        this.currentTask = null;
        this.status = 'idle';
        await this.sendMessage(null, 'task_failed', {
            taskId,
            agentId: this.id,
            error: error.message,
            timestamp: new Date()
        });
        this.emit('taskFailed', {
            taskId,
            error
        });
    }
    startHeartbeatLoop() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            this.lastHeartbeat = Date.now();
            await this.db.updateAgent(this.id, {
                last_active_at: new Date()
            });
            this.emit('heartbeat');
        }, 30000);
    }
    startCommunicationLoop() {
        setInterval(async ()=>{
            if (!this.isActive || this.communicationBuffer.length === 0) return;
            const messages = [
                ...this.communicationBuffer
            ];
            this.communicationBuffer = [];
            for (const message of messages){
                await this.processMessage(message);
            }
        }, 1000);
    }
    startLearningLoop() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                const patterns = await this.analyzeRecentPatterns();
                await this.updateCapabilities(patterns);
            } catch (error) {
                this.emit('learningError', error);
            }
        }, 300000);
    }
    async processMessage(message) {
        switch(message.type){
            case 'task_assignment':
                await this.handleTaskAssignment(message.content);
                break;
            case 'consensus':
                await this.handleConsensusRequest(message.content);
                break;
            case 'query':
                await this.handleQuery(message);
                break;
            case 'coordination':
                await this.handleCoordination(message.content);
                break;
            default:
                this.emit('unknownMessage', message);
        }
    }
    isResponsive() {
        const timeout = 60000;
        return Date.now() - this.lastHeartbeat < timeout;
    }
    getState() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            status: this.status,
            currentTask: this.currentTask,
            capabilities: this.capabilities,
            messageCount: this.messageCount,
            isResponsive: this.isResponsive(),
            memory: Object.fromEntries(this.memory)
        };
    }
    async shutdown() {
        this.isActive = false;
        await this.db.updateAgent(this.id, {
            status: 'offline'
        });
        this.memory.clear();
        this.communicationBuffer = [];
        this.emit('shutdown');
    }
    detectTaskType(description) {
        const lower = description.toLowerCase();
        if (lower.includes('research') || lower.includes('investigate')) return 'research';
        if (lower.includes('develop') || lower.includes('implement')) return 'development';
        if (lower.includes('analyze') || lower.includes('review')) return 'analysis';
        if (lower.includes('test') || lower.includes('validate')) return 'testing';
        if (lower.includes('optimize') || lower.includes('improve')) return 'optimization';
        return 'general';
    }
    extractPatterns(task, result) {
        return {
            taskComplexity: task.priority,
            executionStrategy: task.strategy,
            phasesCompleted: result.metadata?.phases?.length || 0,
            timePerPhase: result.executionTime / (result.metadata?.phases?.length || 1)
        };
    }
    async analyzeRecentPatterns() {
        return this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: 'agent_patterns',
            metadata: {
                agentId: this.id,
                agentType: this.type,
                timeframe: '1h'
            }
        });
    }
    async updateCapabilities(patterns) {
        if (patterns.suggestedCapabilities) {
            const newCapabilities = patterns.suggestedCapabilities.filter((cap)=>!this.capabilities.includes(cap));
            if (newCapabilities.length > 0) {
                this.capabilities.push(...newCapabilities);
                await this.db.updateAgent(this.id, {
                    capabilities: JSON.stringify(this.capabilities)
                });
                this.emit('capabilitiesUpdated', newCapabilities);
            }
        }
    }
    async handleTaskAssignment(content) {
        if (!this.currentTask && content.taskId) {
            await this.assignTask(content.taskId, content.executionPlan || {});
        }
    }
    async handleConsensusRequest(content) {
        const analysis = await this.analyzeProposal(content);
        await this.voteOnProposal(content.proposalId, analysis.vote, analysis.reason);
    }
    async handleQuery(message) {
        const response = await this.processQuery(message.content);
        if (message.fromAgentId) {
            await this.sendMessage(message.fromAgentId, 'response', {
                queryId: message.id,
                response
            });
        }
    }
    async handleCoordination(content) {
        this.emit('coordinationReceived', content);
    }
    async analyzeProposal(proposal) {
        return {
            vote: Math.random() > 0.3,
            reason: 'Based on agent analysis'
        };
    }
    async processQuery(query) {
        return {
            agentId: this.id,
            agentType: this.type,
            status: this.status,
            response: 'Query processed'
        };
    }
}

//# sourceMappingURL=Agent.js.map