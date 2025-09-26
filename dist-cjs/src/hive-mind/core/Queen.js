import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseManager } from './DatabaseManager.js';
import { MCPToolWrapper } from '../integration/MCPToolWrapper.js';
export class Queen extends EventEmitter {
    id;
    config;
    agents;
    taskQueue;
    strategies;
    db;
    mcpWrapper;
    isActive = false;
    constructor(config){
        super();
        this.id = uuidv4();
        this.config = config;
        this.agents = new Map();
        this.taskQueue = new Map();
        this.strategies = new Map();
        this.initializeStrategies();
    }
    async initialize() {
        this.db = await DatabaseManager.getInstance();
        this.mcpWrapper = new MCPToolWrapper();
        await this.db.createAgent({
            id: this.id,
            swarmId: this.config.swarmId,
            name: 'Queen',
            type: 'coordinator',
            capabilities: JSON.stringify([
                'strategic_planning',
                'task_allocation',
                'consensus_coordination',
                'performance_optimization',
                'swarm_governance'
            ]),
            status: 'active',
            metadata: JSON.stringify({
                role: 'queen',
                mode: this.config.mode
            })
        });
        this.isActive = true;
        this.startCoordinationLoop();
        this.startOptimizationLoop();
        this.emit('initialized');
    }
    async registerAgent(agent) {
        this.agents.set(agent.id, agent);
        await this.analyzeAgentCapabilities(agent);
        if (this.config.mode === 'distributed') {
            await this.broadcastAgentRegistration(agent);
        }
        this.emit('agentRegistered', {
            agent
        });
    }
    async onTaskSubmitted(task) {
        this.taskQueue.set(task.id, task);
        const analysis = await this.analyzeTask(task);
        const decision = await this.makeStrategicDecision(task, analysis);
        if (task.requireConsensus) {
            await this.initiateConsensus(task, decision);
        }
        await this.applyDecision(decision);
        this.emit('taskDecision', {
            task,
            decision
        });
        return decision;
    }
    async makeStrategicDecision(task, analysis) {
        const neuralAnalysis = await this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: 'task_strategy',
            metadata: {
                task: task.description,
                priority: task.priority,
                topology: this.config.topology,
                availableAgents: this.getAvailableAgents().length
            }
        });
        const strategy = this.selectOptimalStrategy(task, analysis, neuralAnalysis);
        const selectedAgents = await this.selectAgentsForTask(task, strategy);
        const executionPlan = this.createExecutionPlan(task, selectedAgents, strategy);
        return {
            id: uuidv4(),
            taskId: task.id,
            strategy,
            selectedAgents: selectedAgents.map((a)=>a.id),
            executionPlan,
            confidence: analysis.confidence || 0.85,
            rationale: analysis.rationale || 'Strategic analysis completed',
            timestamp: new Date()
        };
    }
    selectOptimalStrategy(task, analysis, neuralAnalysis) {
        const factors = {
            taskComplexity: analysis.complexity || 'medium',
            agentAvailability: this.getAvailableAgents().length,
            topology: this.config.topology,
            priority: task.priority,
            consensusRequired: task.requireConsensus
        };
        if (this.config.topology === 'hierarchical' && factors.taskComplexity === 'high') {
            return this.strategies.get('hierarchical-cascade');
        }
        if (this.config.topology === 'mesh' && factors.consensusRequired) {
            return this.strategies.get('mesh-consensus');
        }
        if (factors.priority === 'critical') {
            return this.strategies.get('priority-fast-track');
        }
        return this.strategies.get('adaptive-default');
    }
    async selectAgentsForTask(task, strategy) {
        const availableAgents = this.getAvailableAgents();
        const requiredCapabilities = task.requiredCapabilities || [];
        const scoredAgents = await Promise.all(availableAgents.map(async (agent)=>{
            const score = await this.scoreAgentForTask(agent, task, requiredCapabilities);
            return {
                agent,
                score
            };
        }));
        scoredAgents.sort((a, b)=>b.score - a.score);
        const maxAgents = Math.min(task.maxAgents, strategy.maxAgents || 3);
        return scoredAgents.slice(0, maxAgents).map((sa)=>sa.agent);
    }
    async scoreAgentForTask(agent, task, requiredCapabilities) {
        let score = 0;
        const capabilityMatches = requiredCapabilities.filter((cap)=>agent.capabilities.includes(cap)).length;
        score += capabilityMatches * 10;
        const typeSuitability = this.getTypeSuitabilityForTask(agent.type, task);
        score += typeSuitability * 5;
        if (agent.status === 'idle') score += 8;
        else if (agent.status === 'active') score += 4;
        const performance = await this.db.getAgentPerformance(agent.id);
        if (performance) {
            score += performance.successRate * 10;
        }
        if (agent.type === 'specialist' && requiredCapabilities.length > 0) {
            score += 5;
        }
        return score;
    }
    getTypeSuitabilityForTask(agentType, task) {
        const suitabilityMap = {
            research: {
                researcher: 10,
                analyst: 8,
                specialist: 6,
                coder: 4,
                coordinator: 5,
                architect: 5,
                tester: 3,
                reviewer: 4,
                optimizer: 4,
                documenter: 6,
                monitor: 3
            },
            development: {
                coder: 10,
                architect: 8,
                tester: 7,
                reviewer: 6,
                coordinator: 5,
                specialist: 6,
                researcher: 4,
                analyst: 4,
                optimizer: 5,
                documenter: 4,
                monitor: 3
            },
            analysis: {
                analyst: 10,
                researcher: 8,
                specialist: 6,
                reviewer: 5,
                coordinator: 5,
                architect: 4,
                coder: 4,
                tester: 3,
                optimizer: 5,
                documenter: 4,
                monitor: 4
            },
            testing: {
                tester: 10,
                reviewer: 8,
                analyst: 6,
                coder: 5,
                coordinator: 4,
                specialist: 5,
                researcher: 3,
                architect: 4,
                optimizer: 4,
                documenter: 3,
                monitor: 4
            },
            optimization: {
                optimizer: 10,
                analyst: 8,
                coder: 7,
                architect: 6,
                coordinator: 5,
                specialist: 6,
                researcher: 4,
                tester: 4,
                reviewer: 5,
                documenter: 3,
                monitor: 4
            }
        };
        const taskType = this.detectTaskType(task.description);
        return suitabilityMap[taskType]?.[agentType] || 5;
    }
    detectTaskType(description) {
        const lower = description.toLowerCase();
        if (lower.includes('research') || lower.includes('investigate') || lower.includes('explore')) {
            return 'research';
        }
        if (lower.includes('develop') || lower.includes('implement') || lower.includes('build') || lower.includes('create')) {
            return 'development';
        }
        if (lower.includes('analyze') || lower.includes('review') || lower.includes('assess')) {
            return 'analysis';
        }
        if (lower.includes('test') || lower.includes('validate') || lower.includes('verify')) {
            return 'testing';
        }
        if (lower.includes('optimize') || lower.includes('improve') || lower.includes('enhance')) {
            return 'optimization';
        }
        return 'general';
    }
    createExecutionPlan(task, agents, strategy) {
        return {
            phases: strategy.phases || [
                'preparation',
                'execution',
                'validation'
            ],
            agentAssignments: agents.map((agent)=>({
                    agentId: agent.id,
                    role: this.determineAgentRole(agent, task),
                    responsibilities: this.getAgentResponsibilities(agent, task)
                })),
            coordinationPoints: strategy.coordinationPoints || [
                'start',
                'midpoint',
                'completion'
            ],
            checkpoints: this.createCheckpoints(task, strategy),
            fallbackPlan: this.createFallbackPlan(task, agents)
        };
    }
    async initiateConsensus(task, decision) {
        const proposal = {
            id: uuidv4(),
            swarmId: this.config.swarmId,
            taskId: task.id,
            proposal: {
                decision,
                task: task.description,
                rationale: decision.rationale
            },
            requiredThreshold: 0.66,
            deadline: new Date(Date.now() + 5 * 60 * 1000)
        };
        await this.db.createConsensusProposal(proposal);
        await this.broadcastConsensusRequest(proposal);
    }
    async applyDecision(decision) {
        await this.db.updateTask(decision.taskId, {
            assigned_agents: JSON.stringify(decision.selectedAgents),
            status: 'assigned',
            assigned_at: new Date()
        });
        for (const agentId of decision.selectedAgents){
            const agent = this.agents.get(agentId);
            if (agent) {
                await agent.assignTask(decision.taskId, decision.executionPlan);
            }
        }
        await this.mcpWrapper.storeMemory({
            action: 'store',
            key: `decision/${decision.taskId}`,
            value: JSON.stringify(decision),
            namespace: 'queen-decisions',
            ttl: 86400 * 7
        });
    }
    startCoordinationLoop() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                await this.monitorAgentHealth();
                await this.checkTaskProgress();
                await this.checkRebalancing();
            } catch (error) {
                this.emit('error', error);
            }
        }, 5000);
    }
    startOptimizationLoop() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                await this.analyzePerformancePatterns();
                await this.optimizeStrategies();
                await this.trainNeuralPatterns();
            } catch (error) {
                this.emit('error', error);
            }
        }, 60000);
    }
    initializeStrategies() {
        this.strategies.set('hierarchical-cascade', {
            name: 'Hierarchical Cascade',
            description: 'Top-down task distribution with clear delegation',
            phases: [
                'planning',
                'delegation',
                'execution',
                'aggregation'
            ],
            maxAgents: 5,
            coordinationPoints: [
                'phase-transition',
                'milestone',
                'completion'
            ],
            suitable_for: [
                'complex-tasks',
                'multi-phase-projects'
            ]
        });
        this.strategies.set('mesh-consensus', {
            name: 'Mesh Consensus',
            description: 'Peer-to-peer coordination with consensus requirements',
            phases: [
                'proposal',
                'discussion',
                'consensus',
                'execution'
            ],
            maxAgents: 7,
            coordinationPoints: [
                'consensus-check',
                'progress-sync',
                'final-vote'
            ],
            suitable_for: [
                'critical-decisions',
                'collaborative-tasks'
            ]
        });
        this.strategies.set('priority-fast-track', {
            name: 'Priority Fast Track',
            description: 'Rapid execution for critical tasks',
            phases: [
                'immediate-assignment',
                'parallel-execution',
                'quick-validation'
            ],
            maxAgents: 3,
            coordinationPoints: [
                'start',
                'critical-path',
                'completion'
            ],
            suitable_for: [
                'urgent-tasks',
                'critical-fixes'
            ]
        });
        this.strategies.set('adaptive-default', {
            name: 'Adaptive Default',
            description: 'Flexible strategy that adapts to task requirements',
            phases: [
                'analysis',
                'planning',
                'execution',
                'review'
            ],
            maxAgents: 4,
            coordinationPoints: [
                'checkpoint',
                'adaptation-point',
                'completion'
            ],
            suitable_for: [
                'general-tasks',
                'unknown-complexity'
            ]
        });
    }
    getAvailableAgents() {
        return Array.from(this.agents.values()).filter((agent)=>agent.status === 'idle' || agent.status === 'active');
    }
    async analyzeTask(task) {
        return this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: 'task_analysis',
            metadata: {
                description: task.description,
                priority: task.priority,
                dependencies: task.dependencies
            }
        });
    }
    async analyzeAgentCapabilities(agent) {
        await this.mcpWrapper.storeMemory({
            action: 'store',
            key: `agent-capabilities/${agent.id}`,
            value: JSON.stringify({
                type: agent.type,
                capabilities: agent.capabilities,
                registeredAt: new Date()
            }),
            namespace: 'agent-registry'
        });
    }
    async broadcastAgentRegistration(agent) {
        await this.db.createCommunication({
            from_agent_id: this.id,
            to_agent_id: null,
            swarm_id: this.config.swarmId,
            message_type: 'broadcast',
            content: JSON.stringify({
                type: 'agent_registered',
                agent: {
                    id: agent.id,
                    type: agent.type,
                    capabilities: agent.capabilities
                }
            }),
            priority: 'high'
        });
    }
    async broadcastConsensusRequest(proposal) {
        await this.db.createCommunication({
            from_agent_id: this.id,
            to_agent_id: null,
            swarm_id: this.config.swarmId,
            message_type: 'consensus',
            content: JSON.stringify(proposal),
            priority: 'urgent',
            requires_response: true
        });
    }
    determineAgentRole(agent, task) {
        const roleMap = {
            coordinator: 'lead',
            researcher: 'investigator',
            coder: 'implementer',
            analyst: 'evaluator',
            architect: 'designer',
            tester: 'validator',
            reviewer: 'auditor',
            optimizer: 'enhancer',
            documenter: 'recorder',
            monitor: 'observer',
            specialist: 'expert'
        };
        return roleMap[agent.type] || 'contributor';
    }
    getAgentResponsibilities(agent, task) {
        const responsibilityMap = {
            coordinator: [
                'coordinate team',
                'track progress',
                'resolve conflicts'
            ],
            researcher: [
                'gather information',
                'identify patterns',
                'provide insights'
            ],
            coder: [
                'implement solution',
                'write tests',
                'debug issues'
            ],
            analyst: [
                'analyze data',
                'identify bottlenecks',
                'suggest improvements'
            ],
            architect: [
                'design system',
                'define interfaces',
                'ensure scalability'
            ],
            tester: [
                'write tests',
                'find bugs',
                'validate functionality'
            ],
            reviewer: [
                'review code',
                'ensure quality',
                'suggest improvements'
            ],
            optimizer: [
                'improve performance',
                'reduce complexity',
                'optimize resources'
            ],
            documenter: [
                'create documentation',
                'update guides',
                'maintain clarity'
            ],
            monitor: [
                'track metrics',
                'alert on issues',
                'ensure health'
            ],
            specialist: [
                'provide expertise',
                'solve complex problems',
                'guide implementation'
            ]
        };
        return responsibilityMap[agent.type] || [
            'contribute to task'
        ];
    }
    createCheckpoints(task, strategy) {
        return strategy.coordinationPoints.map((point, index)=>({
                name: point,
                expectedProgress: Math.round((index + 1) / strategy.coordinationPoints.length * 100),
                actions: [
                    'status_check',
                    'sync_progress',
                    'adjust_strategy'
                ]
            }));
    }
    createFallbackPlan(task, agents) {
        return {
            triggers: [
                'agent_failure',
                'deadline_approaching',
                'consensus_failure'
            ],
            actions: [
                'reassign_to_available_agents',
                'escalate_to_queen',
                'activate_backup_agents',
                'simplify_task_requirements'
            ],
            escalation_path: [
                'team_lead',
                'queen',
                'human_operator'
            ]
        };
    }
    async monitorAgentHealth() {
        for (const agent of this.agents.values()){
            if (agent.status === 'error' || !agent.isResponsive()) {
                await this.handleAgentFailure(agent);
            }
        }
    }
    async checkTaskProgress() {
        const activeTasks = await this.db.getActiveTasks(this.config.swarmId);
        for (const task of activeTasks){
            if (this.isTaskStalled(task)) {
                await this.handleStalledTask(task);
            }
        }
    }
    async checkRebalancing() {
        const stats = await this.db.getSwarmStats(this.config.swarmId);
        if (stats.agentUtilization > 0.9 || stats.taskBacklog > stats.agentCount * 2) {
            this.emit('rebalanceNeeded', stats);
        }
    }
    async analyzePerformancePatterns() {
        const patterns = await this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: 'performance_patterns',
            metadata: {
                swarmId: this.config.swarmId,
                timeframe: '1h'
            }
        });
        if (patterns.recommendations) {
            await this.applyPerformanceRecommendations(patterns.recommendations);
        }
    }
    async optimizeStrategies() {
        const strategyPerformance = await this.db.getStrategyPerformance(this.config.swarmId);
        for (const [strategyName, performance] of Object.entries(strategyPerformance)){
            if (performance.successRate < 0.7) {
                await this.adjustStrategy(strategyName, performance);
            }
        }
    }
    async trainNeuralPatterns() {
        const successfulDecisions = await this.db.getSuccessfulDecisions(this.config.swarmId);
        if (successfulDecisions.length > 10) {
            await this.mcpWrapper.trainNeural({
                pattern_type: 'coordination',
                training_data: JSON.stringify(successfulDecisions),
                epochs: 50
            });
        }
    }
    async handleAgentFailure(agent) {
        if (agent.currentTask) {
            await this.reassignTask(agent.currentTask, agent.id);
        }
        await this.db.updateAgentStatus(agent.id, 'offline');
        this.emit('agentFailed', {
            agent
        });
    }
    async handleStalledTask(task) {
        this.emit('taskStalled', {
            task
        });
    }
    isTaskStalled(task) {
        const stalledThreshold = 10 * 60 * 1000;
        return task.last_progress_update && Date.now() - new Date(task.last_progress_update).getTime() > stalledThreshold;
    }
    async reassignTask(taskId, fromAgentId) {
        const availableAgents = this.getAvailableAgents().filter((a)=>a.id !== fromAgentId);
        if (availableAgents.length > 0) {
            const newAgent = availableAgents[0];
            await this.db.reassignTask(taskId, newAgent.id);
            await newAgent.assignTask(taskId, {});
        }
    }
    async applyPerformanceRecommendations(recommendations) {
        for (const rec of recommendations){
            this.emit('performanceRecommendation', rec);
        }
    }
    async adjustStrategy(strategyName, performance) {
        const strategy = this.strategies.get(strategyName);
        if (strategy) {
            if (performance.avgCompletionTime > performance.targetTime) {
                strategy.maxAgents = Math.min(strategy.maxAgents + 1, 10);
            }
            this.emit('strategyAdjusted', {
                strategyName,
                performance
            });
        }
    }
    async shutdown() {
        this.isActive = false;
        this.emit('shutdown');
    }
}

//# sourceMappingURL=Queen.js.map