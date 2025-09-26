import { describe, beforeAll, afterAll, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { MaestroSwarmCoordinator } from '../maestro-swarm-coordinator.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, access } from 'fs/promises';
describe('Native Hive Mind Integration Tests', ()=>{
    let swarmCoordinator;
    let eventBus;
    let logger;
    let tempDir;
    let config;
    beforeAll(async ()=>{
        tempDir = await mkdtemp(join(tmpdir(), 'maestro-test-'));
        eventBus = new EventBus();
        logger = new Logger({
            level: 'debug'
        });
        config = {
            hiveMindConfig: {
                name: 'test-maestro-specs-swarm',
                topology: 'specs-driven',
                queenMode: 'strategic',
                maxAgents: 8,
                consensusThreshold: 0.66,
                memoryTTL: 60000,
                autoSpawn: true,
                enableConsensus: true,
                enableMemory: true,
                enableCommunication: true
            },
            enableConsensusValidation: true,
            enableLivingDocumentation: true,
            enableSteeringIntegration: true,
            specsDirectory: join(tempDir, 'specs'),
            steeringDirectory: join(tempDir, 'steering')
        };
    });
    afterAll(async ()=>{
        if (swarmCoordinator) {
            await swarmCoordinator.shutdown();
        }
        await rm(tempDir, {
            recursive: true,
            force: true
        });
    });
    beforeEach(async ()=>{
        swarmCoordinator = new MaestroSwarmCoordinator(config, eventBus, logger);
    });
    afterEach(async ()=>{
        if (swarmCoordinator) {
            await swarmCoordinator.shutdown();
        }
    });
    describe('Swarm Initialization', ()=>{
        it('should initialize native hive mind with specs-driven topology', async ()=>{
            const swarmId = await swarmCoordinator.initialize();
            expect(swarmId).toBeDefined();
            expect(typeof swarmId).toBe('string');
            expect(swarmId).toMatch(/^swarm_/);
        });
        it('should spawn 8 specialized agents with correct types', async ()=>{
            await swarmCoordinator.initialize();
            const hiveMind = swarmCoordinator.hiveMind;
            const agents = hiveMind.agents;
            expect(agents.size).toBe(8);
            const agentTypes = Array.from(agents.values()).map((agent)=>agent.type);
            expect(agentTypes).toContain('requirements_analyst');
            expect(agentTypes).toContain('design_architect');
            expect(agentTypes).toContain('task_planner');
            expect(agentTypes).toContain('implementation_coder');
            expect(agentTypes).toContain('quality_reviewer');
            expect(agentTypes).toContain('steering_documenter');
            expect(agentTypes.filter((t)=>t === 'requirements_analyst')).toHaveLength(1);
            expect(agentTypes.filter((t)=>t === 'design_architect')).toHaveLength(2);
            expect(agentTypes.filter((t)=>t === 'task_planner')).toHaveLength(1);
            expect(agentTypes.filter((t)=>t === 'implementation_coder')).toHaveLength(2);
            expect(agentTypes.filter((t)=>t === 'quality_reviewer')).toHaveLength(1);
            expect(agentTypes.filter((t)=>t === 'steering_documenter')).toHaveLength(1);
        });
        it('should initialize steering documents in swarm memory', async ()=>{
            await swarmCoordinator.initialize();
            const hiveMind = swarmCoordinator.hiveMind;
            const productSteering = await hiveMind.memory.retrieve('steering/product');
            const techSteering = await hiveMind.memory.retrieve('steering/tech');
            const workflowSteering = await hiveMind.memory.retrieve('steering/workflow');
            expect(productSteering).toBeDefined();
            expect(productSteering.domain).toBe('product');
            expect(techSteering).toBeDefined();
            expect(techSteering.domain).toBe('tech');
            expect(workflowSteering).toBeDefined();
            expect(workflowSteering.domain).toBe('workflow');
        });
    });
    describe('Specs-Driven Workflow', ()=>{
        beforeEach(async ()=>{
            await swarmCoordinator.initialize();
        });
        it('should create specification using requirements_analyst agent', async ()=>{
            const featureName = 'test-auth-feature';
            const initialRequest = 'Create user authentication system with JWT tokens';
            await swarmCoordinator.createSpec(featureName, initialRequest);
            const workflowState = swarmCoordinator.getWorkflowState(featureName);
            expect(workflowState).toBeDefined();
            expect(workflowState.featureName).toBe(featureName);
            expect(workflowState.currentPhase).toBe('Requirements Clarification');
            expect(workflowState.status).toBe('running');
            const requirementsPath = join(config.specsDirectory, featureName, 'requirements.md');
            await expect(access(requirementsPath)).resolves.not.toThrow();
        }, 30000);
        it('should generate design using parallel design_architect agents with consensus', async ()=>{
            const featureName = 'test-design-feature';
            await swarmCoordinator.createSpec(featureName, 'Test feature for design generation');
            await swarmCoordinator.generateDesign(featureName);
            const workflowState = swarmCoordinator.getWorkflowState(featureName);
            expect(workflowState.currentPhase).toBe('Research & Design');
            expect(workflowState.history).toHaveLength(2);
            expect(workflowState.history[1].phase).toBe('Research & Design');
            expect(workflowState.history[1].status).toBe('completed');
            const designPath = join(config.specsDirectory, featureName, 'design.md');
            await expect(access(designPath)).resolves.not.toThrow();
        }, 60000);
        it('should generate tasks using task_planner agent', async ()=>{
            const featureName = 'test-tasks-feature';
            await swarmCoordinator.createSpec(featureName, 'Test feature for task generation');
            await swarmCoordinator.generateDesign(featureName);
            await swarmCoordinator.generateTasks(featureName);
            const workflowState = swarmCoordinator.getWorkflowState(featureName);
            expect(workflowState.currentPhase).toBe('Implementation Planning');
            const tasksPath = join(config.specsDirectory, featureName, 'tasks.md');
            await expect(access(tasksPath)).resolves.not.toThrow();
        }, 90000);
        it('should implement tasks using implementation_coder agents', async ()=>{
            const featureName = 'test-implementation-feature';
            await swarmCoordinator.createSpec(featureName, 'Test feature for implementation');
            await swarmCoordinator.generateDesign(featureName);
            await swarmCoordinator.generateTasks(featureName);
            await swarmCoordinator.implementTask(featureName, 1);
            const workflowState = swarmCoordinator.getWorkflowState(featureName);
            expect(workflowState.currentPhase).toBe('Task Execution');
            expect(workflowState.currentTaskIndex).toBe(1);
        }, 120000);
    });
    describe('Consensus Validation', ()=>{
        beforeEach(async ()=>{
            await swarmCoordinator.initialize();
        });
        it('should use consensus for phase approval when enabled', async ()=>{
            const featureName = 'test-consensus-feature';
            await swarmCoordinator.createSpec(featureName, 'Test consensus validation');
            const hiveMind = swarmCoordinator.hiveMind;
            const consensusEngine = hiveMind.consensus;
            jest.spyOn(consensusEngine, 'createProposal').mockResolvedValue('test-proposal-id');
            jest.spyOn(consensusEngine, 'getProposalStatus').mockResolvedValue({
                status: 'achieved',
                currentRatio: 0.75
            });
            await swarmCoordinator.approvePhase(featureName);
            expect(consensusEngine.createProposal).toHaveBeenCalled();
            expect(consensusEngine.getProposalStatus).toHaveBeenCalled();
        });
        it('should handle consensus failure gracefully', async ()=>{
            const featureName = 'test-consensus-failure';
            await swarmCoordinator.createSpec(featureName, 'Test consensus failure handling');
            const hiveMind = swarmCoordinator.hiveMind;
            const consensusEngine = hiveMind.consensus;
            jest.spyOn(consensusEngine, 'createProposal').mockResolvedValue('test-proposal-id');
            jest.spyOn(consensusEngine, 'getProposalStatus').mockResolvedValue({
                status: 'failed',
                currentRatio: 0.4
            });
            await expect(swarmCoordinator.approvePhase(featureName)).rejects.toThrow('Phase approval consensus failed');
        });
    });
    describe('Steering Integration', ()=>{
        beforeEach(async ()=>{
            await swarmCoordinator.initialize();
        });
        it('should create steering documents in swarm memory', async ()=>{
            const domain = 'custom-steering';
            const content = 'Custom steering guidelines for testing';
            await swarmCoordinator.createSteeringDocument(domain, content);
            const hiveMind = swarmCoordinator.hiveMind;
            const storedDoc = await hiveMind.memory.retrieve(`steering/${domain}`);
            expect(storedDoc).toBeDefined();
            expect(storedDoc.content).toBe(content);
            expect(storedDoc.domain).toBe(domain);
            expect(storedDoc.maintainer).toBe('steering_documenter');
        });
        it('should broadcast steering updates to all agents', async ()=>{
            const domain = 'broadcast-test';
            const content = 'Test broadcast content';
            const hiveMind = swarmCoordinator.hiveMind;
            const broadcastSpy = jest.spyOn(hiveMind.communication, 'broadcast');
            await swarmCoordinator.createSteeringDocument(domain, content);
            expect(broadcastSpy).toHaveBeenCalledWith({
                type: 'steering_update',
                domain,
                content: expect.stringContaining('Test broadcast content')
            });
        });
        it('should retrieve steering context for agents', async ()=>{
            await swarmCoordinator.createSteeringDocument('test-context', 'Context for testing');
            const steeringContext = await swarmCoordinator.getSteeringContext();
            expect(steeringContext).toContain('test-context');
            expect(steeringContext).toContain('Context for testing');
        });
    });
    describe('Performance and Error Handling', ()=>{
        beforeEach(async ()=>{
            await swarmCoordinator.initialize();
        });
        it('should handle agent spawning limits gracefully', async ()=>{
            const limitedConfig = {
                ...config,
                hiveMindConfig: {
                    ...config.hiveMindConfig,
                    maxAgents: 4
                }
            };
            const limitedCoordinator = new MaestroSwarmCoordinator(limitedConfig, eventBus, logger);
            await limitedCoordinator.initialize();
            const hiveMind = limitedCoordinator.hiveMind;
            expect(hiveMind.agents.size).toBeLessThanOrEqual(4);
            await limitedCoordinator.shutdown();
        });
        it('should timeout on task completion properly', async ()=>{
            const featureName = 'timeout-test';
            const hiveMind = swarmCoordinator.hiveMind;
            jest.spyOn(hiveMind, 'getTask').mockResolvedValue({
                id: 'test-task',
                status: 'in_progress',
                result: null
            });
            await expect(swarmCoordinator.waitForTaskCompletion('test-task', 1000)).rejects.toThrow('Task timeout');
        });
        it('should handle swarm shutdown gracefully', async ()=>{
            const hiveMind = swarmCoordinator.hiveMind;
            const shutdownSpy = jest.spyOn(hiveMind, 'shutdown');
            await swarmCoordinator.shutdown();
            expect(shutdownSpy).toHaveBeenCalled();
        });
    });
    describe('Event Integration', ()=>{
        beforeEach(async ()=>{
            await swarmCoordinator.initialize();
        });
        it('should emit maestro events through event bus', async ()=>{
            const specCreatedSpy = jest.fn();
            eventBus.on('maestro:spec_created', specCreatedSpy);
            await swarmCoordinator.createSpec('event-test', 'Test event emission');
            expect(specCreatedSpy).toHaveBeenCalledWith({
                featureName: 'event-test'
            });
        });
        it('should handle event-driven workflow progression', async ()=>{
            const phaseApprovedSpy = jest.fn();
            eventBus.on('maestro:phase_approved', phaseApprovedSpy);
            const featureName = 'workflow-events';
            await swarmCoordinator.createSpec(featureName, 'Test workflow events');
            const hiveMind = swarmCoordinator.hiveMind;
            const consensusEngine = hiveMind.consensus;
            jest.spyOn(consensusEngine, 'createProposal').mockResolvedValue('test-proposal');
            jest.spyOn(consensusEngine, 'getProposalStatus').mockResolvedValue({
                status: 'achieved',
                currentRatio: 0.8
            });
            await swarmCoordinator.approvePhase(featureName);
            expect(phaseApprovedSpy).toHaveBeenCalledWith({
                featureName,
                nextPhase: 'Research & Design'
            });
        });
    });
});
describe('Performance Benchmarks', ()=>{
    let coordinator;
    let eventBus;
    let logger;
    let tempDir;
    beforeAll(async ()=>{
        tempDir = await mkdtemp(join(tmpdir(), 'maestro-perf-'));
        eventBus = new EventBus();
        logger = new Logger({
            level: 'warn'
        });
        const config = {
            hiveMindConfig: {
                name: 'perf-test-swarm',
                topology: 'specs-driven',
                queenMode: 'strategic',
                maxAgents: 8,
                consensusThreshold: 0.66,
                memoryTTL: 300000,
                autoSpawn: true,
                enableConsensus: false,
                enableMemory: true,
                enableCommunication: true
            },
            enableConsensusValidation: false,
            enableLivingDocumentation: true,
            enableSteeringIntegration: true,
            specsDirectory: join(tempDir, 'specs'),
            steeringDirectory: join(tempDir, 'steering')
        };
        coordinator = new MaestroSwarmCoordinator(config, eventBus, logger);
        await coordinator.initialize();
    });
    afterAll(async ()=>{
        await coordinator.shutdown();
        await rm(tempDir, {
            recursive: true,
            force: true
        });
    });
    it('should initialize swarm within performance target (< 5 seconds)', async ()=>{
        const startTime = Date.now();
        const testCoordinator = new MaestroSwarmCoordinator(coordinator.config, eventBus, logger);
        await testCoordinator.initialize();
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(5000);
        await testCoordinator.shutdown();
    });
    it('should create specs within performance target (< 2 minutes)', async ()=>{
        const startTime = Date.now();
        await coordinator.createSpec('perf-test-spec', 'Performance test specification');
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(120000);
    });
    it('should handle multiple concurrent spec creations efficiently', async ()=>{
        const startTime = Date.now();
        const concurrentSpecs = 3;
        const promises = Array.from({
            length: concurrentSpecs
        }, (_, i)=>coordinator.createSpec(`concurrent-spec-${i}`, `Concurrent test spec ${i}`));
        await Promise.all(promises);
        const duration = Date.now() - startTime;
        const avgTimePerSpec = duration / concurrentSpecs;
        expect(avgTimePerSpec).toBeLessThan(90000);
    }, 300000);
});

//# sourceMappingURL=native-hive-mind-integration.test.js.map