import { EventEmitter } from 'events';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { HiveMind } from '../hive-mind/core/HiveMind.js';
import { SystemError } from '../utils/errors.js';
export class MaestroSwarmCoordinator extends EventEmitter {
    config;
    eventBus;
    logger;
    hiveMind;
    maestroState = new Map();
    specsDirectory;
    steeringDirectory;
    constructor(config, eventBus, logger){
        super(), this.config = config, this.eventBus = eventBus, this.logger = logger;
        this.specsDirectory = config.specsDirectory || join(process.cwd(), '.claude', 'claude-flow', 'maestro', 'specs');
        this.steeringDirectory = config.steeringDirectory || join(process.cwd(), '.claude', 'claude-flow', 'maestro', 'steering');
        this.setupEventHandlers();
        this.logger.info('MaestroSwarmCoordinator initialized with native hive mind');
    }
    async initialize() {
        try {
            const hiveMindConfig = {
                name: 'maestro-specs-driven-swarm',
                topology: 'specs-driven',
                queenMode: 'strategic',
                maxAgents: 8,
                consensusThreshold: 0.66,
                memoryTTL: 86400000,
                autoSpawn: true,
                enableConsensus: this.config.enableConsensusValidation,
                enableMemory: true,
                enableCommunication: true,
                ...this.config.hiveMindConfig
            };
            this.hiveMind = new HiveMind(hiveMindConfig);
            const swarmId = await this.hiveMind.initialize();
            if (this.config.enableSteeringIntegration) {
                await this.initializeSteeringMemory();
            }
            this.logger.info(`Maestro specs-driven swarm initialized: ${swarmId}`);
            this.emit('initialized', {
                swarmId
            });
            return swarmId;
        } catch (error) {
            this.logger.error(`Failed to initialize maestro swarm: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async createSpec(featureName, initialRequest) {
        const featurePath = join(this.specsDirectory, featureName);
        await mkdir(featurePath, {
            recursive: true
        });
        const workflowState = {
            featureName,
            currentPhase: 'Requirements Clarification',
            currentTaskIndex: 0,
            status: 'running',
            lastActivity: new Date(),
            history: [
                {
                    phase: 'Requirements Clarification',
                    status: 'in-progress',
                    timestamp: new Date()
                }
            ]
        };
        this.maestroState.set(featureName, workflowState);
        const requirementsTask = {
            description: `Generate comprehensive requirements for feature: ${featureName}`,
            priority: 'high',
            strategy: 'sequential',
            requiredCapabilities: [
                'requirements_analysis',
                'user_story_creation',
                'acceptance_criteria'
            ],
            metadata: {
                maestroFeature: featureName,
                maestroPhase: 'Requirements Clarification',
                initialRequest,
                outputFile: join(featurePath, 'requirements.md')
            }
        };
        const task = await this.hiveMind.submitTask(requirementsTask);
        await this.waitForTaskCompletion(task.id, 120000);
        this.logger.info(`Created specification for '${featureName}' using native swarm`);
        this.eventBus.emit('maestro:spec_created', {
            featureName
        });
    }
    async generateDesign(featureName) {
        const state = this.maestroState.get(featureName);
        if (!state) {
            throw new SystemError(`No workflow state found for '${featureName}'`);
        }
        const featurePath = join(this.specsDirectory, featureName);
        const requirementsPath = join(featurePath, 'requirements.md');
        const requirementsContent = await readFile(requirementsPath, 'utf8');
        const designTask = {
            description: `Generate comprehensive technical design for ${featureName}`,
            priority: 'high',
            strategy: 'parallel',
            requiredCapabilities: [
                'system_design',
                'architecture',
                'specs_driven_design'
            ],
            requireConsensus: this.config.enableConsensusValidation,
            maxAgents: 2,
            metadata: {
                maestroFeature: featureName,
                maestroPhase: 'Research & Design',
                requirements: requirementsContent,
                outputFile: join(featurePath, 'design.md')
            }
        };
        const task = await this.hiveMind.submitTask(designTask);
        await this.waitForTaskCompletion(task.id, 300000);
        state.currentPhase = 'Research & Design';
        state.lastActivity = new Date();
        state.history.push({
            phase: 'Research & Design',
            status: 'completed',
            timestamp: new Date()
        });
        this.logger.info(`Generated design for '${featureName}' using native swarm consensus`);
        this.eventBus.emit('maestro:design_generated', {
            featureName
        });
    }
    async generateTasks(featureName) {
        const state = this.maestroState.get(featureName);
        if (!state) {
            throw new SystemError(`No workflow state found for '${featureName}'`);
        }
        const featurePath = join(this.specsDirectory, featureName);
        const designPath = join(featurePath, 'design.md');
        const designContent = await readFile(designPath, 'utf8');
        const taskPlanningTask = {
            description: `Generate implementation task breakdown for ${featureName}`,
            priority: 'high',
            strategy: 'sequential',
            requiredCapabilities: [
                'task_management',
                'workflow_orchestration'
            ],
            metadata: {
                maestroFeature: featureName,
                maestroPhase: 'Implementation Planning',
                designContent,
                outputFile: join(featurePath, 'tasks.md')
            }
        };
        const task = await this.hiveMind.submitTask(taskPlanningTask);
        await this.waitForTaskCompletion(task.id, 180000);
        state.currentPhase = 'Implementation Planning';
        state.lastActivity = new Date();
        state.history.push({
            phase: 'Implementation Planning',
            status: 'completed',
            timestamp: new Date()
        });
        this.logger.info(`Generated tasks for '${featureName}' using native swarm planner`);
        this.eventBus.emit('maestro:tasks_generated', {
            featureName
        });
    }
    async implementTask(featureName, taskId) {
        const state = this.maestroState.get(featureName);
        if (!state) {
            throw new SystemError(`No workflow state found for '${featureName}'`);
        }
        const featurePath = join(this.specsDirectory, featureName);
        const tasksPath = join(featurePath, 'tasks.md');
        const tasksContent = await readFile(tasksPath, 'utf8');
        const taskLines = tasksContent.split('\n').filter((line)=>line.startsWith('- [ ]') || line.startsWith('- [x]'));
        if (taskId < 1 || taskId > taskLines.length) {
            throw new SystemError(`Invalid task ID ${taskId} for feature '${featureName}'`);
        }
        const taskDescription = taskLines[taskId - 1].substring(taskLines[taskId - 1].indexOf(']') + 2).trim();
        const implementationTask = {
            description: `Implement task: ${taskDescription}`,
            priority: 'high',
            strategy: 'parallel',
            requiredCapabilities: [
                'code_generation',
                'implementation'
            ],
            maxAgents: 2,
            metadata: {
                maestroFeature: featureName,
                maestroPhase: 'Task Execution',
                taskId,
                taskDescription,
                steeringContext: await this.getSteeringContext()
            }
        };
        const task = await this.hiveMind.submitTask(implementationTask);
        await this.waitForTaskCompletion(task.id, 600000);
        const updatedTasksContent = tasksContent.replace(taskLines[taskId - 1], taskLines[taskId - 1].replace('- [ ]', '- [x]'));
        await writeFile(tasksPath, updatedTasksContent, 'utf8');
        state.currentPhase = 'Task Execution';
        state.currentTaskIndex = taskId;
        state.lastActivity = new Date();
        this.logger.info(`Implemented task ${taskId} for '${featureName}' using native swarm`);
        this.eventBus.emit('maestro:task_implemented', {
            featureName,
            taskId,
            taskDescription
        });
    }
    async reviewTasks(featureName) {
        const state = this.maestroState.get(featureName);
        if (!state) {
            throw new SystemError(`No workflow state found for '${featureName}'`);
        }
        const featurePath = join(this.specsDirectory, featureName);
        const tasksPath = join(featurePath, 'tasks.md');
        const tasksContent = await readFile(tasksPath, 'utf8');
        const reviewTask = {
            description: `Review implementation quality for ${featureName}`,
            priority: 'high',
            strategy: 'sequential',
            requiredCapabilities: [
                'code_review',
                'quality_assurance',
                'testing'
            ],
            metadata: {
                maestroFeature: featureName,
                maestroPhase: 'Quality Gates',
                tasksContent,
                steeringContext: await this.getSteeringContext()
            }
        };
        const task = await this.hiveMind.submitTask(reviewTask);
        await this.waitForTaskCompletion(task.id, 300000);
        state.currentPhase = 'Quality Gates';
        state.lastActivity = new Date();
        state.history.push({
            phase: 'Quality Gates',
            status: 'completed',
            timestamp: new Date()
        });
        this.logger.info(`Completed quality review for '${featureName}' using native quality_reviewer`);
        this.eventBus.emit('maestro:quality_review_completed', {
            featureName
        });
    }
    async approvePhase(featureName) {
        const state = this.maestroState.get(featureName);
        if (!state) {
            throw new SystemError(`No workflow state found for '${featureName}'`);
        }
        if (this.config.enableConsensusValidation) {
            const consensusProposal = {
                id: `maestro-phase-approval-${featureName}-${Date.now()}`,
                swarmId: this.hiveMind.id,
                proposal: {
                    action: 'approve_phase',
                    featureName,
                    currentPhase: state.currentPhase,
                    details: `Approve completion of ${state.currentPhase} phase for ${featureName}`
                },
                requiredThreshold: 0.66,
                deadline: new Date(Date.now() + 300000),
                taskId: `maestro-approval-${featureName}`,
                metadata: {
                    type: 'phase_approval',
                    featureName,
                    phase: state.currentPhase
                }
            };
            const consensusEngine = this.hiveMind.consensus;
            const proposalId = await consensusEngine.createProposal(consensusProposal);
            const consensusResult = await this.waitForConsensusResult(proposalId, 300000);
            if (!consensusResult.achieved) {
                throw new SystemError(`Phase approval consensus failed: ${consensusResult.reason}`);
            }
        }
        const phaseProgression = {
            'Requirements Clarification': 'Research & Design',
            'Research & Design': 'Implementation Planning',
            'Implementation Planning': 'Task Execution',
            'Task Execution': 'Completed'
        };
        const nextPhase = phaseProgression[state.currentPhase];
        if (nextPhase) {
            state.currentPhase = nextPhase;
            state.lastActivity = new Date();
            state.history.push({
                phase: nextPhase,
                status: 'approved',
                timestamp: new Date()
            });
        }
        this.logger.info(`Approved phase transition for '${featureName}': ${state.currentPhase} -> ${nextPhase}`);
        this.eventBus.emit('maestro:phase_approved', {
            featureName,
            nextPhase
        });
    }
    getWorkflowState(featureName) {
        return this.maestroState.get(featureName);
    }
    async createSteeringDocument(domain, content) {
        if (!this.config.enableSteeringIntegration) {
            throw new SystemError('Steering integration is disabled');
        }
        await this.hiveMind.memory.store(`steering/${domain}`, {
            content,
            domain,
            lastUpdated: new Date(),
            maintainer: 'steering_documenter'
        });
        await this.hiveMind.communication.broadcast({
            type: 'steering_update',
            domain,
            content: content.substring(0, 200) + '...'
        });
        this.logger.info(`Created steering document for '${domain}' in swarm memory`);
    }
    async getSteeringContext() {
        if (!this.config.enableSteeringIntegration) {
            return 'No steering context available.';
        }
        try {
            const steeringKeys = await this.hiveMind.memory.search('steering/*');
            const steeringDocs = await Promise.all(steeringKeys.map((key)=>this.hiveMind.memory.retrieve(key)));
            return steeringDocs.filter((doc)=>doc).map((doc)=>`## ${doc.domain}\n${doc.content}`).join('\n\n---\n\n');
        } catch (error) {
            this.logger.warn(`Failed to retrieve steering context: ${error instanceof Error ? error.message : String(error)}`);
            return 'Steering context temporarily unavailable.';
        }
    }
    async initializeSteeringMemory() {
        const defaultSteering = {
            'product': 'Focus on user value and clear requirements specification.',
            'tech': 'Follow clean architecture patterns and maintainable code practices.',
            'workflow': 'Use specs-driven development with clear phase progression.'
        };
        for (const [domain, content] of Object.entries(defaultSteering)){
            await this.hiveMind.memory.store(`steering/${domain}`, {
                content,
                domain,
                lastUpdated: new Date(),
                maintainer: 'system'
            });
        }
        this.logger.info('Initialized default steering documents in swarm memory');
    }
    async waitForTaskCompletion(taskId, timeoutMs) {
        return new Promise((resolve, reject)=>{
            const timeout = setTimeout(()=>{
                reject(new Error(`Task timeout: ${taskId}`));
            }, timeoutMs);
            const checkInterval = setInterval(async ()=>{
                try {
                    const task = await this.hiveMind.getTask(taskId);
                    if (task.status === 'completed') {
                        clearTimeout(timeout);
                        clearInterval(checkInterval);
                        resolve(task.result ? JSON.parse(task.result) : {});
                    } else if (task.status === 'failed') {
                        clearTimeout(timeout);
                        clearInterval(checkInterval);
                        reject(new Error(`Task failed: ${task.error || 'Unknown error'}`));
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    clearInterval(checkInterval);
                    reject(error);
                }
            }, 2000);
        });
    }
    async waitForConsensusResult(proposalId, timeoutMs) {
        return new Promise((resolve, reject)=>{
            const timeout = setTimeout(()=>{
                reject(new Error(`Consensus timeout for proposal ${proposalId}`));
            }, timeoutMs);
            const checkInterval = setInterval(async ()=>{
                try {
                    const consensusEngine = this.hiveMind.consensus;
                    const status = await consensusEngine.getProposalStatus(proposalId);
                    if (status.status === 'achieved') {
                        clearTimeout(timeout);
                        clearInterval(checkInterval);
                        resolve({
                            achieved: true,
                            finalRatio: status.currentRatio,
                            reason: 'Consensus achieved'
                        });
                    } else if (status.status === 'failed') {
                        clearTimeout(timeout);
                        clearInterval(checkInterval);
                        resolve({
                            achieved: false,
                            finalRatio: status.currentRatio,
                            reason: 'Consensus failed'
                        });
                    }
                } catch (error) {
                    clearTimeout(timeout);
                    clearInterval(checkInterval);
                    reject(error);
                }
            }, 1000);
        });
    }
    setupEventHandlers() {
        this.eventBus.on('maestro:spec_created', this.handleSpecCreated.bind(this));
        this.eventBus.on('maestro:phase_approved', this.handlePhaseApproved.bind(this));
        this.eventBus.on('maestro:task_implemented', this.handleTaskImplemented.bind(this));
    }
    async handleSpecCreated(data) {
        this.logger.info(`Spec created via native swarm: ${JSON.stringify(data)}`);
    }
    async handlePhaseApproved(data) {
        this.logger.info(`Phase approved via native consensus: ${JSON.stringify(data)}`);
    }
    async handleTaskImplemented(data) {
        this.logger.info(`Task implemented via native swarm: ${JSON.stringify(data)}`);
    }
    async shutdown() {
        this.logger.info('Shutting down MaestroSwarmCoordinator');
        if (this.hiveMind) {
            await this.hiveMind.shutdown();
            this.logger.info('Native hive mind swarm shutdown complete');
        }
        this.logger.info('MaestroSwarmCoordinator shutdown complete');
    }
}

//# sourceMappingURL=maestro-swarm-coordinator.js.map