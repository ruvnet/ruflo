import { EventEmitter } from 'events';
import { DatabaseManager } from '../core/DatabaseManager.js';
import { MCPToolWrapper } from './MCPToolWrapper.js';
export class SwarmOrchestrator extends EventEmitter {
    hiveMind;
    db;
    mcpWrapper;
    executionPlans;
    taskAssignments;
    activeExecutions;
    isActive = false;
    constructor(hiveMind){
        super();
        this.hiveMind = hiveMind;
        this.executionPlans = new Map();
        this.taskAssignments = new Map();
        this.activeExecutions = new Map();
    }
    async initialize() {
        this.db = await DatabaseManager.getInstance();
        this.mcpWrapper = new MCPToolWrapper();
        await this.mcpWrapper.initialize();
        this.startTaskDistributor();
        this.startProgressMonitor();
        this.startLoadBalancer();
        this.isActive = true;
        this.emit('initialized');
    }
    async submitTask(task) {
        const plan = await this.createExecutionPlan(task);
        this.executionPlans.set(task.id, plan);
        const orchestrationResult = await this.mcpWrapper.orchestrateTask({
            task: task.description,
            priority: task.priority,
            strategy: task.strategy,
            dependencies: task.dependencies
        });
        if (orchestrationResult.success) {
            await this.executeTask(task, plan);
        } else {
            this.emit('orchestrationError', {
                task,
                error: orchestrationResult.error
            });
        }
    }
    async createExecutionPlan(task) {
        const strategy = this.getStrategyImplementation(task.strategy);
        const analysis = await this.analyzeTaskComplexity(task);
        const phases = strategy.determinePhases(task, analysis);
        const phaseAssignments = await Promise.all(phases.map((phase)=>this.createPhaseAssignments(task, phase, analysis)));
        return {
            taskId: task.id,
            strategy: task.strategy,
            phases,
            phaseAssignments,
            dependencies: task.dependencies,
            checkpoints: this.createCheckpoints(phases),
            parallelizable: strategy.isParallelizable(task),
            estimatedDuration: analysis.estimatedDuration,
            resourceRequirements: analysis.resourceRequirements
        };
    }
    async executeTask(task, plan) {
        const execution = {
            taskId: task.id,
            plan,
            startTime: Date.now(),
            currentPhase: 0,
            phaseResults: [],
            status: 'executing'
        };
        this.activeExecutions.set(task.id, execution);
        try {
            if (plan.parallelizable) {
                await this.executeParallel(task, plan, execution);
            } else {
                await this.executeSequential(task, plan, execution);
            }
            execution.status = 'completed';
            await this.completeTask(task, execution);
        } catch (error) {
            execution.status = 'failed';
            execution.error = error;
            await this.handleTaskFailure(task, execution, error);
        } finally{
            this.activeExecutions.delete(task.id);
        }
    }
    async executeParallel(task, plan, execution) {
        const parallelPhases = plan.phases.filter((_, index)=>plan.phaseAssignments[index].some((a)=>a.canRunParallel));
        const results = await Promise.all(parallelPhases.map((phase)=>this.executePhase(task, phase, plan, execution)));
        execution.phaseResults = results;
    }
    async executeSequential(task, plan, execution) {
        for(let i = 0; i < plan.phases.length; i++){
            const phase = plan.phases[i];
            execution.currentPhase = i;
            const result = await this.executePhase(task, phase, plan, execution);
            execution.phaseResults.push(result);
            if (plan.checkpoints[i]) {
                await this.evaluateCheckpoint(task, plan.checkpoints[i], execution);
            }
        }
    }
    async executePhase(task, phase, plan, execution) {
        const phaseIndex = plan.phases.indexOf(phase);
        const assignments = plan.phaseAssignments[phaseIndex];
        const agentAssignments = await this.assignAgentsToPhase(task, phase, assignments);
        const phaseResults = await Promise.all(agentAssignments.map((assignment)=>this.executeAssignment(task, phase, assignment)));
        return this.aggregatePhaseResults(phase, phaseResults);
    }
    async assignAgentsToPhase(task, phase, assignments) {
        const agentAssignments = [];
        for (const assignment of assignments){
            const agent = await this.findSuitableAgent(assignment.requiredCapabilities);
            if (agent) {
                await this.assignTaskToAgent(task.id, agent.id);
                agentAssignments.push({
                    agent,
                    assignment,
                    phase
                });
            } else {
                this.queueAssignment(task.id, assignment);
            }
        }
        return agentAssignments;
    }
    async executeAssignment(task, phase, assignment) {
        const { agent, assignment: taskAssignment } = assignment;
        await agent.assignTask(task.id, {
            phase,
            role: taskAssignment.role,
            responsibilities: taskAssignment.responsibilities,
            expectedOutput: taskAssignment.expectedOutput
        });
        return this.waitForAgentCompletion(agent, task.id, taskAssignment.timeout);
    }
    async assignTaskToAgent(taskId, agentId) {
        const task = await this.db.getTask(taskId);
        const assignedAgents = JSON.parse(task.assigned_agents || '[]');
        if (!assignedAgents.includes(agentId)) {
            assignedAgents.push(agentId);
            await this.db.updateTask(taskId, {
                assigned_agents: JSON.stringify(assignedAgents),
                status: 'assigned'
            });
        }
        await this.db.updateAgent(agentId, {
            current_task_id: taskId,
            status: 'busy'
        });
        this.emit('taskAssigned', {
            taskId,
            agentId
        });
    }
    async cancelTask(taskId) {
        const execution = this.activeExecutions.get(taskId);
        if (execution) {
            execution.status = 'cancelled';
            const task = await this.db.getTask(taskId);
            const assignedAgents = JSON.parse(task.assigned_agents || '[]');
            for (const agentId of assignedAgents){
                await this.notifyAgentTaskCancelled(agentId, taskId);
            }
        }
        this.activeExecutions.delete(taskId);
        this.executionPlans.delete(taskId);
        this.emit('taskCancelled', {
            taskId
        });
    }
    async rebalance() {
        const loadDistribution = await this.analyzeLoadDistribution();
        const balanceResult = await this.mcpWrapper.loadBalance({
            tasks: loadDistribution.unassignedTasks
        });
        if (balanceResult.success && balanceResult.data.reassignments) {
            await this.applyReassignments(balanceResult.data.reassignments);
        }
        this.emit('rebalanced', {
            loadDistribution
        });
    }
    getStrategyImplementation(strategy) {
        const strategies = {
            parallel: {
                determinePhases: (task)=>[
                        'preparation',
                        'parallel-execution',
                        'aggregation'
                    ],
                isParallelizable: ()=>true,
                maxConcurrency: 5
            },
            sequential: {
                determinePhases: (task)=>[
                        'analysis',
                        'planning',
                        'execution',
                        'validation'
                    ],
                isParallelizable: ()=>false,
                maxConcurrency: 1
            },
            adaptive: {
                determinePhases: (task, analysis)=>{
                    if (analysis.complexity === 'high') {
                        return [
                            'deep-analysis',
                            'planning',
                            'phased-execution',
                            'integration',
                            'validation'
                        ];
                    }
                    return [
                        'quick-analysis',
                        'execution',
                        'validation'
                    ];
                },
                isParallelizable: (task)=>!task.requireConsensus,
                maxConcurrency: 3
            },
            consensus: {
                determinePhases: ()=>[
                        'proposal',
                        'discussion',
                        'voting',
                        'execution',
                        'ratification'
                    ],
                isParallelizable: ()=>false,
                maxConcurrency: 1
            }
        };
        return strategies[strategy] || strategies.adaptive;
    }
    async analyzeTaskComplexity(task) {
        const analysis = await this.mcpWrapper.analyzePattern({
            action: 'analyze',
            operation: 'task_complexity',
            metadata: {
                description: task.description,
                priority: task.priority,
                dependencies: task.dependencies.length,
                requiresConsensus: task.requireConsensus
            }
        });
        return {
            complexity: analysis.data?.complexity || 'medium',
            estimatedDuration: analysis.data?.estimatedDuration || 3600000,
            resourceRequirements: analysis.data?.resourceRequirements || {
                minAgents: 1,
                maxAgents: task.maxAgents,
                capabilities: task.requiredCapabilities
            }
        };
    }
    async createPhaseAssignments(task, phase, analysis) {
        const assignments = [];
        switch(phase){
            case 'analysis':
            case 'deep-analysis':
                assignments.push({
                    role: 'analyst',
                    requiredCapabilities: [
                        'data_analysis',
                        'pattern_recognition'
                    ],
                    responsibilities: [
                        'Analyze task requirements',
                        'Identify patterns',
                        'Assess complexity'
                    ],
                    expectedOutput: 'Analysis report',
                    timeout: 300000,
                    canRunParallel: false
                });
                break;
            case 'planning':
                assignments.push({
                    role: 'architect',
                    requiredCapabilities: [
                        'system_design',
                        'architecture_patterns'
                    ],
                    responsibilities: [
                        'Design solution',
                        'Create implementation plan',
                        'Define interfaces'
                    ],
                    expectedOutput: 'Implementation plan',
                    timeout: 600000,
                    canRunParallel: false
                });
                break;
            case 'execution':
            case 'parallel-execution':
                const executionCount = Math.min(analysis.resourceRequirements.maxAgents, 3);
                for(let i = 0; i < executionCount; i++){
                    assignments.push({
                        role: 'executor',
                        requiredCapabilities: task.requiredCapabilities,
                        responsibilities: [
                            'Implement solution',
                            'Execute plan',
                            'Handle errors'
                        ],
                        expectedOutput: 'Execution results',
                        timeout: 1800000,
                        canRunParallel: true
                    });
                }
                break;
            case 'validation':
                assignments.push({
                    role: 'validator',
                    requiredCapabilities: [
                        'quality_assurance',
                        'test_generation'
                    ],
                    responsibilities: [
                        'Validate results',
                        'Run tests',
                        'Ensure quality'
                    ],
                    expectedOutput: 'Validation report',
                    timeout: 600000,
                    canRunParallel: false
                });
                break;
            case 'consensus':
            case 'voting':
                assignments.push({
                    role: 'consensus-coordinator',
                    requiredCapabilities: [
                        'consensus_building'
                    ],
                    responsibilities: [
                        'Coordinate voting',
                        'Collect opinions',
                        'Determine consensus'
                    ],
                    expectedOutput: 'Consensus decision',
                    timeout: 300000,
                    canRunParallel: false
                });
                break;
        }
        return assignments;
    }
    createCheckpoints(phases) {
        return phases.map((phase, index)=>({
                phase,
                index,
                requiredProgress: Math.round((index + 1) / phases.length * 100),
                validationCriteria: this.getValidationCriteria(phase),
                failureThreshold: 0.3
            }));
    }
    getValidationCriteria(phase) {
        const criteria = {
            analysis: [
                {
                    name: 'completeness',
                    weight: 0.4
                },
                {
                    name: 'accuracy',
                    weight: 0.6
                }
            ],
            planning: [
                {
                    name: 'feasibility',
                    weight: 0.5
                },
                {
                    name: 'completeness',
                    weight: 0.5
                }
            ],
            execution: [
                {
                    name: 'correctness',
                    weight: 0.7
                },
                {
                    name: 'performance',
                    weight: 0.3
                }
            ],
            validation: [
                {
                    name: 'test_coverage',
                    weight: 0.5
                },
                {
                    name: 'quality_score',
                    weight: 0.5
                }
            ]
        };
        return criteria[phase] || [
            {
                name: 'completion',
                weight: 1.0
            }
        ];
    }
    async findSuitableAgent(requiredCapabilities) {
        const agents = await this.hiveMind.getAgents();
        const suitableAgents = agents.filter((agent)=>agent.status === 'idle' && requiredCapabilities.every((cap)=>agent.capabilities.includes(cap)));
        if (suitableAgents.length === 0) {
            return null;
        }
        return this.selectBestAgent(suitableAgents, requiredCapabilities);
    }
    async selectBestAgent(agents, capabilities) {
        const scores = await Promise.all(agents.map(async (agent)=>{
            const performance = await this.db.getAgentPerformance(agent.id);
            return {
                agent,
                score: performance?.successRate || 0.5
            };
        }));
        scores.sort((a, b)=>b.score - a.score);
        return scores[0].agent;
    }
    async waitForAgentCompletion(agent, taskId, timeout) {
        return new Promise((resolve, reject)=>{
            const timer = setTimeout(()=>{
                reject(new Error(`Agent ${agent.id} timeout on task ${taskId}`));
            }, timeout);
            const checkCompletion = async ()=>{
                const agentState = await this.db.getAgent(agent.id);
                if (agentState.current_task_id !== taskId) {
                    clearTimeout(timer);
                    clearInterval(interval);
                    const task = await this.db.getTask(taskId);
                    resolve(task.result ? JSON.parse(task.result) : {});
                }
            };
            const interval = setInterval(checkCompletion, 1000);
        });
    }
    aggregatePhaseResults(phase, results) {
        return {
            phase,
            results,
            summary: this.summarizeResults(results),
            timestamp: new Date()
        };
    }
    summarizeResults(results) {
        const successful = results.filter((r)=>r.success).length;
        const total = results.length;
        return {
            successRate: total > 0 ? successful / total : 0,
            totalExecutions: total,
            aggregatedData: results.map((r)=>r.data).filter(Boolean)
        };
    }
    queueAssignment(taskId, assignment) {
        if (!this.taskAssignments.has(taskId)) {
            this.taskAssignments.set(taskId, []);
        }
        this.taskAssignments.get(taskId).push(assignment);
        this.emit('assignmentQueued', {
            taskId,
            assignment
        });
    }
    async evaluateCheckpoint(task, checkpoint, execution) {
        const phaseResult = execution.phaseResults[checkpoint.index];
        if (!phaseResult) return;
        let score = 0;
        for (const criterion of checkpoint.validationCriteria){
            const criterionScore = this.evaluateCriterion(phaseResult, criterion);
            score += criterionScore * criterion.weight;
        }
        if (score < checkpoint.failureThreshold) {
            throw new Error(`Checkpoint failed at phase ${checkpoint.phase}: score ${score}`);
        }
        this.emit('checkpointPassed', {
            task,
            checkpoint,
            score
        });
    }
    evaluateCriterion(result, criterion) {
        if (result.summary && result.summary.successRate !== undefined) {
            return result.summary.successRate;
        }
        return 0.7;
    }
    async completeTask(task, execution) {
        const finalResult = {
            success: true,
            executionTime: Date.now() - execution.startTime,
            phases: execution.phaseResults,
            summary: this.createExecutionSummary(execution)
        };
        await this.db.updateTask(task.id, {
            status: 'completed',
            result: JSON.stringify(finalResult),
            progress: 100,
            completed_at: new Date()
        });
        this.emit('taskCompleted', {
            task,
            result: finalResult
        });
    }
    async handleTaskFailure(task, execution, error) {
        await this.db.updateTask(task.id, {
            status: 'failed',
            error: error.message,
            completed_at: new Date()
        });
        this.emit('taskFailed', {
            task,
            error
        });
    }
    createExecutionSummary(execution) {
        const phaseCount = execution.phaseResults.length;
        const successfulPhases = execution.phaseResults.filter((r)=>r.summary?.successRate > 0.5).length;
        return {
            totalPhases: phaseCount,
            successfulPhases,
            overallSuccess: phaseCount > 0 ? successfulPhases / phaseCount : 0,
            executionTime: Date.now() - execution.startTime
        };
    }
    async notifyAgentTaskCancelled(agentId, taskId) {
        await this.db.createCommunication({
            from_agent_id: 'orchestrator',
            to_agent_id: agentId,
            swarm_id: this.hiveMind.id,
            message_type: 'task_cancellation',
            content: JSON.stringify({
                taskId,
                reason: 'User cancelled'
            }),
            priority: 'urgent'
        });
    }
    async analyzeLoadDistribution() {
        const agents = await this.hiveMind.getAgents();
        const tasks = await this.db.getActiveTasks(this.hiveMind.id);
        const busyAgents = agents.filter((a)=>a.status === 'busy');
        const idleAgents = agents.filter((a)=>a.status === 'idle');
        const unassignedTasks = tasks.filter((t)=>!t.assigned_agents || JSON.parse(t.assigned_agents).length === 0);
        return {
            totalAgents: agents.length,
            busyAgents: busyAgents.length,
            idleAgents: idleAgents.length,
            activeTasks: tasks.length,
            unassignedTasks: unassignedTasks.map((t)=>({
                    id: t.id,
                    priority: t.priority,
                    requiredCapabilities: JSON.parse(t.required_capabilities || '[]')
                })),
            loadFactor: agents.length > 0 ? busyAgents.length / agents.length : 0
        };
    }
    async applyReassignments(reassignments) {
        for (const reassignment of reassignments){
            await this.reassignTask(reassignment.taskId, reassignment.fromAgent, reassignment.toAgent);
        }
    }
    async reassignTask(taskId, fromAgentId, toAgentId) {
        await this.db.reassignTask(taskId, toAgentId);
        await this.db.updateAgent(fromAgentId, {
            current_task_id: null,
            status: 'idle'
        });
        await this.db.updateAgent(toAgentId, {
            current_task_id: taskId,
            status: 'busy'
        });
        await this.notifyAgentReassignment(fromAgentId, toAgentId, taskId);
    }
    async notifyAgentReassignment(fromAgentId, toAgentId, taskId) {
        await this.db.createCommunication({
            from_agent_id: 'orchestrator',
            to_agent_id: fromAgentId,
            swarm_id: this.hiveMind.id,
            message_type: 'task_reassignment',
            content: JSON.stringify({
                taskId,
                reassignedTo: toAgentId
            }),
            priority: 'high'
        });
        const task = await this.db.getTask(taskId);
        const plan = this.executionPlans.get(taskId);
        await this.db.createCommunication({
            from_agent_id: 'orchestrator',
            to_agent_id: toAgentId,
            swarm_id: this.hiveMind.id,
            message_type: 'task_assignment',
            content: JSON.stringify({
                taskId,
                task: task.description,
                executionPlan: plan
            }),
            priority: 'high'
        });
    }
    startTaskDistributor() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                for (const [taskId, assignments] of this.taskAssignments){
                    for (const assignment of assignments){
                        const agent = await this.findSuitableAgent(assignment.requiredCapabilities);
                        if (agent) {
                            await this.assignTaskToAgent(taskId, agent.id);
                            const remaining = assignments.filter((a)=>a !== assignment);
                            if (remaining.length === 0) {
                                this.taskAssignments.delete(taskId);
                            } else {
                                this.taskAssignments.set(taskId, remaining);
                            }
                        }
                    }
                }
            } catch (error) {
                this.emit('error', error);
            }
        }, 5000);
    }
    startProgressMonitor() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                for (const [taskId, execution] of this.activeExecutions){
                    const task = await this.db.getTask(taskId);
                    if (task.status === 'in_progress') {
                        const progress = this.calculateProgress(execution);
                        if (progress !== task.progress) {
                            await this.db.updateTask(taskId, {
                                progress
                            });
                            this.emit('progressUpdate', {
                                taskId,
                                progress
                            });
                        }
                    }
                }
            } catch (error) {
                this.emit('error', error);
            }
        }, 2000);
    }
    startLoadBalancer() {
        setInterval(async ()=>{
            if (!this.isActive) return;
            try {
                const load = await this.analyzeLoadDistribution();
                if (load.loadFactor > 0.8 && load.idleAgents.length > 0 && load.unassignedTasks.length > 0) {
                    await this.rebalance();
                }
            } catch (error) {
                this.emit('error', error);
            }
        }, 30000);
    }
    calculateProgress(execution) {
        if (!execution.plan || !execution.plan.phases) return 0;
        const totalPhases = execution.plan.phases.length;
        const completedPhases = execution.currentPhase;
        return Math.round(completedPhases / totalPhases * 100);
    }
    async shutdown() {
        this.isActive = false;
        for (const taskId of this.activeExecutions.keys()){
            await this.cancelTask(taskId);
        }
        this.emit('shutdown');
    }
}

//# sourceMappingURL=SwarmOrchestrator.js.map