export class SparcCoordinator {
    constructor(phases, options = {}){
        this.phases = phases;
        this.options = options;
        this.swarmId = null;
        this.agents = [];
        this.phaseAgents = new Map();
        this.coordination = {
            strategy: 'adaptive',
            topology: 'hierarchical',
            communication: 'event-driven',
            loadBalancing: 'capability-based'
        };
        this.metrics = {
            phaseExecutions: 0,
            agentUtilization: {},
            coordinationEfficiency: 0,
            qualityGates: [],
            learningData: []
        };
        this.neuralContext = null;
        this.swarmEnabled = options.swarmEnabled || false;
    }
    async initializeSwarm() {
        if (!this.swarmEnabled) {
            console.log('🔄 SPARC running in standalone mode');
            return;
        }
        console.log('🐝 Initializing SPARC Swarm Coordination');
        try {
            const swarmConfig = {
                topology: this.coordination.topology,
                maxAgents: this.calculateOptimalAgentCount(),
                strategy: 'sparc_methodology',
                communication: this.coordination.communication,
                loadBalancing: this.coordination.loadBalancing
            };
            this.swarmId = await this.executeSwarmHook('swarm_init', swarmConfig);
            console.log(`🆔 Swarm initialized: ${this.swarmId}`);
            await this.spawnSparcAgents();
            await this.setupPhaseCoordination();
            console.log('✅ SPARC Swarm coordination initialized');
        } catch (error) {
            console.warn(`⚠️ Swarm initialization failed: ${error.message}`);
            console.log('🔄 Falling back to standalone mode');
            this.swarmEnabled = false;
        }
    }
    calculateOptimalAgentCount() {
        const baseAgents = Object.keys(this.phases).length;
        const complexityMultiplier = this.assessTaskComplexity();
        const parallelismFactor = this.options.parallelExecution ? 2 : 1;
        return Math.min(20, Math.max(5, baseAgents * complexityMultiplier * parallelismFactor));
    }
    assessTaskComplexity() {
        const taskDescription = this.options.taskDescription || '';
        const complexityKeywords = [
            'complex',
            'enterprise',
            'scalable',
            'distributed',
            'microservice',
            'integration'
        ];
        const matchedKeywords = complexityKeywords.filter((keyword)=>taskDescription.toLowerCase().includes(keyword));
        if (matchedKeywords.length >= 3) return 3;
        if (matchedKeywords.length >= 1) return 2;
        return 1;
    }
    async spawnSparcAgents() {
        const agentTypes = [
            {
                type: 'sparc_specification',
                role: 'Requirements Analyst',
                capabilities: [
                    'analysis',
                    'documentation',
                    'validation'
                ]
            },
            {
                type: 'sparc_pseudocode',
                role: 'Logic Designer',
                capabilities: [
                    'design',
                    'flowcharts',
                    'algorithms'
                ]
            },
            {
                type: 'sparc_architecture',
                role: 'System Architect',
                capabilities: [
                    'architecture',
                    'design_patterns',
                    'scalability'
                ]
            },
            {
                type: 'sparc_refinement',
                role: 'TDD Engineer',
                capabilities: [
                    'testing',
                    'refactoring',
                    'code_quality'
                ]
            },
            {
                type: 'sparc_completion',
                role: 'Integration Specialist',
                capabilities: [
                    'integration',
                    'deployment',
                    'validation'
                ]
            },
            {
                type: 'sparc_coordinator',
                role: 'SPARC Orchestrator',
                capabilities: [
                    'coordination',
                    'monitoring',
                    'optimization'
                ]
            }
        ];
        for (const agentSpec of agentTypes){
            try {
                const agentId = await this.executeSwarmHook('agent_spawn', {
                    type: agentSpec.type,
                    role: agentSpec.role,
                    capabilities: agentSpec.capabilities,
                    maxConcurrentTasks: this.getAgentConcurrency(agentSpec.type),
                    specialization: 'sparc_methodology'
                });
                const agent = {
                    id: agentId,
                    type: agentSpec.type,
                    role: agentSpec.role,
                    capabilities: agentSpec.capabilities,
                    status: 'ready',
                    currentPhase: null,
                    assignedTasks: [],
                    performance: {
                        tasksCompleted: 0,
                        averageTime: 0,
                        qualityScore: 1.0,
                        efficiency: 1.0
                    }
                };
                this.agents.push(agent);
                console.log(`  🤖 Spawned ${agentSpec.role} (${agentSpec.type})`);
            } catch (error) {
                console.warn(`⚠️ Failed to spawn ${agentSpec.role}: ${error.message}`);
            }
        }
    }
    getAgentConcurrency(agentType) {
        const concurrencyMap = {
            sparc_specification: 2,
            sparc_pseudocode: 1,
            sparc_architecture: 3,
            sparc_refinement: 4,
            sparc_completion: 2,
            sparc_coordinator: 1
        };
        return concurrencyMap[agentType] || 2;
    }
    async setupPhaseCoordination() {
        for (const agent of this.agents){
            const phaseName = agent.type.replace('sparc_', '');
            if (this.phases[phaseName]) {
                if (!this.phaseAgents.has(phaseName)) {
                    this.phaseAgents.set(phaseName, []);
                }
                this.phaseAgents.get(phaseName).push(agent);
            }
        }
        await this.executeSwarmHook('setup_dependencies', {
            phases: Object.keys(this.phases),
            dependencies: {
                pseudocode: [
                    'specification'
                ],
                architecture: [
                    'specification',
                    'pseudocode'
                ],
                refinement: [
                    'specification',
                    'pseudocode',
                    'architecture'
                ],
                completion: [
                    'specification',
                    'pseudocode',
                    'architecture',
                    'refinement'
                ]
            }
        });
        await this.setupQualityGates();
    }
    async setupQualityGates() {
        const qualityGates = [
            {
                phase: 'specification',
                criteria: [
                    'requirements_complete',
                    'acceptance_criteria_defined'
                ],
                threshold: 0.9
            },
            {
                phase: 'pseudocode',
                criteria: [
                    'flow_diagram_complete',
                    'algorithms_defined'
                ],
                threshold: 0.85
            },
            {
                phase: 'architecture',
                criteria: [
                    'components_defined',
                    'patterns_selected'
                ],
                threshold: 0.85
            },
            {
                phase: 'refinement',
                criteria: [
                    'tests_passing',
                    'code_quality_acceptable'
                ],
                threshold: 0.8
            },
            {
                phase: 'completion',
                criteria: [
                    'validation_passed',
                    'deployment_successful'
                ],
                threshold: 0.9
            }
        ];
        for (const gate of qualityGates){
            await this.executeSwarmHook('register_quality_gate', gate);
        }
    }
    async prePhase(phaseName) {
        if (!this.swarmEnabled) return;
        console.log(`🔄 Pre-phase coordination: ${phaseName}`);
        try {
            await this.loadNeuralContext(phaseName);
            await this.assignAgentsToPhase(phaseName);
            await this.preparePhaseEnvironment(phaseName);
            await this.executeSwarmHook('memory_store', {
                key: `sparc_phase_${phaseName}_start`,
                value: {
                    timestamp: Date.now(),
                    agents: this.phaseAgents.get(phaseName)?.map((a)=>a.id) || [],
                    neuralContext: this.neuralContext
                }
            });
        } catch (error) {
            console.warn(`⚠️ Pre-phase coordination failed for ${phaseName}: ${error.message}`);
        }
    }
    async loadNeuralContext(phaseName) {
        try {
            const neuralData = await this.executeSwarmHook('neural_load_context', {
                phase: phaseName,
                methodology: 'sparc',
                taskType: this.classifyTaskType()
            });
            this.neuralContext = {
                phase: phaseName,
                patterns: neuralData.patterns || [],
                insights: neuralData.insights || [],
                recommendations: neuralData.recommendations || [],
                confidence: neuralData.confidence || 0.5
            };
            console.log(`🧠 Neural context loaded for ${phaseName} (confidence: ${this.neuralContext.confidence.toFixed(2)})`);
        } catch (error) {
            console.warn(`⚠️ Neural context loading failed: ${error.message}`);
            this.neuralContext = {
                phase: phaseName,
                patterns: [],
                insights: [],
                recommendations: [],
                confidence: 0.5
            };
        }
    }
    classifyTaskType() {
        const taskDescription = this.options.taskDescription || '';
        const taskLower = taskDescription.toLowerCase();
        if (taskLower.includes('api') || taskLower.includes('service')) return 'api_development';
        if (taskLower.includes('ui') || taskLower.includes('frontend')) return 'frontend_development';
        if (taskLower.includes('data') || taskLower.includes('database')) return 'data_management';
        if (taskLower.includes('test') || taskLower.includes('testing')) return 'testing';
        if (taskLower.includes('deploy') || taskLower.includes('infrastructure')) return 'deployment';
        return 'general_development';
    }
    async assignAgentsToPhase(phaseName) {
        const phaseAgents = this.phaseAgents.get(phaseName) || [];
        for (const agent of phaseAgents){
            agent.currentPhase = phaseName;
            agent.status = 'assigned';
            await this.executeSwarmHook('agent_assign', {
                agentId: agent.id,
                phase: phaseName,
                priority: this.getPhasePriority(phaseName),
                context: this.neuralContext
            });
        }
        if (phaseAgents.length === 0) {
            const coordinator = this.agents.find((a)=>a.type === 'sparc_coordinator');
            if (coordinator) {
                coordinator.currentPhase = phaseName;
                coordinator.status = 'assigned';
                await this.executeSwarmHook('agent_assign', {
                    agentId: coordinator.id,
                    phase: phaseName,
                    priority: this.getPhasePriority(phaseName),
                    context: this.neuralContext
                });
            }
        }
    }
    getPhasePriority(phaseName) {
        const priorities = {
            specification: 5,
            pseudocode: 4,
            architecture: 4,
            refinement: 3,
            completion: 2
        };
        return priorities[phaseName] || 1;
    }
    async preparePhaseEnvironment(phaseName) {
        await this.executeSwarmHook('create_workspace', {
            phase: phaseName,
            namespace: this.options.namespace || 'sparc',
            isolation: true
        });
        const dependencies = this.getPhaseDependencies(phaseName);
        for (const dependency of dependencies){
            await this.executeSwarmHook('load_artifacts', {
                fromPhase: dependency,
                toPhase: phaseName,
                artifactTypes: [
                    'outputs',
                    'decisions',
                    'validations'
                ]
            });
        }
    }
    getPhaseDependencies(phaseName) {
        const dependencies = {
            specification: [],
            pseudocode: [
                'specification'
            ],
            architecture: [
                'specification',
                'pseudocode'
            ],
            refinement: [
                'specification',
                'pseudocode',
                'architecture'
            ],
            completion: [
                'specification',
                'pseudocode',
                'architecture',
                'refinement'
            ]
        };
        return dependencies[phaseName] || [];
    }
    async postPhase(phaseName, result) {
        if (!this.swarmEnabled) return;
        console.log(`✅ Post-phase coordination: ${phaseName}`);
        try {
            const validation = await this.validatePhaseResults(phaseName, result);
            await this.updateAgentPerformance(phaseName, result, validation);
            await this.executeSwarmHook('memory_store', {
                key: `sparc_phase_${phaseName}_complete`,
                value: {
                    timestamp: Date.now(),
                    result: result,
                    validation: validation,
                    agents: this.phaseAgents.get(phaseName)?.map((a)=>({
                            id: a.id,
                            performance: a.performance
                        })) || []
                }
            });
            if (this.options.neuralLearning) {
                await this.recordNeuralLearning(phaseName, result, validation);
            }
            await this.preparePhaseHandoff(phaseName, result);
            this.updateCoordinationMetrics(phaseName, result, validation);
        } catch (error) {
            console.warn(`⚠️ Post-phase coordination failed for ${phaseName}: ${error.message}`);
        }
    }
    async validatePhaseResults(phaseName, result) {
        const validation = {
            phase: phaseName,
            passed: true,
            score: 0,
            issues: [],
            recommendations: []
        };
        try {
            const swarmValidation = await this.executeSwarmHook('validate_phase', {
                phase: phaseName,
                result: result,
                criteria: this.getValidationCriteria(phaseName)
            });
            validation.passed = swarmValidation.passed;
            validation.score = swarmValidation.score;
            validation.issues = swarmValidation.issues || [];
            validation.recommendations = swarmValidation.recommendations || [];
        } catch (error) {
            console.warn(`⚠️ Swarm validation failed: ${error.message}`);
            validation.passed = !!result;
            validation.score = result ? 85 : 0;
        }
        return validation;
    }
    getValidationCriteria(phaseName) {
        const criteria = {
            specification: {
                requiredFields: [
                    'requirements',
                    'acceptanceCriteria',
                    'userStories'
                ],
                qualityThresholds: {
                    completeness: 0.9,
                    clarity: 0.8
                }
            },
            pseudocode: {
                requiredFields: [
                    'flowDiagram',
                    'pseudocode',
                    'algorithms'
                ],
                qualityThresholds: {
                    completeness: 0.85,
                    complexity: 0.7
                }
            },
            architecture: {
                requiredFields: [
                    'systemDesign',
                    'components',
                    'designPatterns'
                ],
                qualityThresholds: {
                    modularity: 0.8,
                    scalability: 0.75
                }
            },
            refinement: {
                requiredFields: [
                    'testResults',
                    'codeQuality',
                    'implementations'
                ],
                qualityThresholds: {
                    testCoverage: 0.8,
                    codeQuality: 0.75
                }
            },
            completion: {
                requiredFields: [
                    'validation',
                    'deployment',
                    'documentation'
                ],
                qualityThresholds: {
                    completeness: 0.9,
                    readiness: 0.85
                }
            }
        };
        return criteria[phaseName] || {
            requiredFields: [],
            qualityThresholds: {}
        };
    }
    async updateAgentPerformance(phaseName, result, validation) {
        const phaseAgents = this.phaseAgents.get(phaseName) || [];
        for (const agent of phaseAgents){
            agent.performance.tasksCompleted += 1;
            const qualityScore = validation.score / 100;
            agent.performance.qualityScore = (agent.performance.qualityScore + qualityScore) / 2;
            const executionTime = Date.now() - this.getPhaseStartTime(phaseName);
            const expectedTime = this.getExpectedPhaseTime(phaseName);
            const efficiency = Math.min(1, expectedTime / executionTime);
            agent.performance.efficiency = (agent.performance.efficiency + efficiency) / 2;
            agent.performance.averageTime = (agent.performance.averageTime + executionTime) / 2;
            await this.executeSwarmHook('update_agent_performance', {
                agentId: agent.id,
                performance: agent.performance,
                phase: phaseName
            });
        }
    }
    getPhaseStartTime(phaseName) {
        return Date.now() - 5 * 60 * 1000;
    }
    getExpectedPhaseTime(phaseName) {
        const expectedTimes = {
            specification: 10 * 60 * 1000,
            pseudocode: 5 * 60 * 1000,
            architecture: 15 * 60 * 1000,
            refinement: 20 * 60 * 1000,
            completion: 10 * 60 * 1000
        };
        return expectedTimes[phaseName] || 10 * 60 * 1000;
    }
    async recordNeuralLearning(phaseName, result, validation) {
        try {
            const learningData = {
                phase: phaseName,
                taskType: this.classifyTaskType(),
                methodology: 'sparc',
                execution: {
                    result: result,
                    validation: validation,
                    timestamp: Date.now()
                },
                context: {
                    taskDescription: this.options.taskDescription,
                    neuralContext: this.neuralContext,
                    agentPerformance: this.getAgentPerformanceData(phaseName)
                },
                outcomes: {
                    success: validation.passed,
                    quality: validation.score,
                    efficiency: this.calculatePhaseEfficiency(phaseName),
                    learnings: this.extractLearnings(phaseName, result, validation)
                }
            };
            await this.executeSwarmHook('neural_record_learning', learningData);
            await this.executeSwarmHook('neural_train', {
                data: learningData,
                updateWeights: true,
                savePattern: true
            });
            console.log(`🧠 Neural learning recorded for ${phaseName}`);
        } catch (error) {
            console.warn(`⚠️ Neural learning failed: ${error.message}`);
        }
    }
    getAgentPerformanceData(phaseName) {
        const phaseAgents = this.phaseAgents.get(phaseName) || [];
        return phaseAgents.map((agent)=>({
                id: agent.id,
                type: agent.type,
                performance: agent.performance
            }));
    }
    calculatePhaseEfficiency(phaseName) {
        const phaseAgents = this.phaseAgents.get(phaseName) || [];
        if (phaseAgents.length === 0) return 0.5;
        const avgEfficiency = phaseAgents.reduce((sum, agent)=>sum + agent.performance.efficiency, 0) / phaseAgents.length;
        return avgEfficiency;
    }
    extractLearnings(phaseName, result, validation) {
        const learnings = [];
        if (validation.passed) {
            learnings.push(`${phaseName} phase executed successfully`);
            if (validation.score > 90) {
                learnings.push(`High quality output achieved in ${phaseName}`);
            }
        } else {
            learnings.push(`${phaseName} phase encountered issues: ${validation.issues.join(', ')}`);
        }
        if (validation.recommendations.length > 0) {
            learnings.push(`Recommendations for ${phaseName}: ${validation.recommendations.join(', ')}`);
        }
        return learnings;
    }
    async preparePhaseHandoff(phaseName, result) {
        const nextPhase = this.getNextPhase(phaseName);
        if (!nextPhase) return;
        await this.executeSwarmHook('prepare_handoff', {
            fromPhase: phaseName,
            toPhase: nextPhase,
            artifacts: {
                outputs: result,
                decisions: this.extractDecisions(result),
                context: this.neuralContext
            }
        });
        const nextPhaseAgents = this.phaseAgents.get(nextPhase) || [];
        for (const agent of nextPhaseAgents){
            await this.executeSwarmHook('agent_prewarm', {
                agentId: agent.id,
                phase: nextPhase,
                context: result
            });
        }
    }
    getNextPhase(currentPhase) {
        const sequence = [
            'specification',
            'pseudocode',
            'architecture',
            'refinement',
            'completion'
        ];
        const currentIndex = sequence.indexOf(currentPhase);
        return currentIndex >= 0 && currentIndex < sequence.length - 1 ? sequence[currentIndex + 1] : null;
    }
    extractDecisions(result) {
        const decisions = [];
        if (result.architecturalDecisions) {
            decisions.push(...result.architecturalDecisions);
        }
        if (result.designDecisions) {
            decisions.push(...result.designDecisions);
        }
        if (result.qualityGates) {
            decisions.push(...result.qualityGates.map((gate)=>({
                    decision: `Quality gate: ${gate.name}`,
                    rationale: gate.rationale || 'Quality assurance',
                    impact: gate.impact || 'process'
                })));
        }
        return decisions;
    }
    updateCoordinationMetrics(phaseName, result, validation) {
        this.metrics.phaseExecutions += 1;
        const phaseAgents = this.phaseAgents.get(phaseName) || [];
        for (const agent of phaseAgents){
            if (!this.metrics.agentUtilization[agent.id]) {
                this.metrics.agentUtilization[agent.id] = {
                    phases: 0,
                    totalTime: 0,
                    quality: 0
                };
            }
            this.metrics.agentUtilization[agent.id].phases += 1;
            this.metrics.agentUtilization[agent.id].quality += validation.score;
        }
        const efficiency = this.calculatePhaseEfficiency(phaseName);
        this.metrics.coordinationEfficiency = (this.metrics.coordinationEfficiency + efficiency) / 2;
        this.metrics.qualityGates.push({
            phase: phaseName,
            passed: validation.passed,
            score: validation.score,
            timestamp: Date.now()
        });
        if (validation.passed) {
            this.metrics.learningData.push({
                phase: phaseName,
                success: true,
                quality: validation.score,
                patterns: this.neuralContext?.patterns || []
            });
        }
    }
    async finalize() {
        if (!this.swarmEnabled) return;
        console.log('🏁 Finalizing SPARC coordination');
        try {
            const report = await this.generateCoordinationReport();
            await this.executeSwarmHook('memory_store', {
                key: 'sparc_coordination_final',
                value: {
                    metrics: this.metrics,
                    report: report,
                    timestamp: Date.now()
                }
            });
            for (const agent of this.agents){
                await this.executeSwarmHook('agent_shutdown', {
                    agentId: agent.id,
                    graceful: true
                });
            }
            await this.executeSwarmHook('swarm_shutdown', {
                swarmId: this.swarmId,
                preserveData: true
            });
            console.log('✅ SPARC coordination finalized');
        } catch (error) {
            console.warn(`⚠️ Coordination finalization failed: ${error.message}`);
        }
    }
    async generateCoordinationReport() {
        const report = {
            summary: {
                phasesExecuted: this.metrics.phaseExecutions,
                agentsUtilized: Object.keys(this.metrics.agentUtilization).length,
                coordinationEfficiency: this.metrics.coordinationEfficiency,
                qualityGatesPassed: this.metrics.qualityGates.filter((g)=>g.passed).length,
                totalQualityGates: this.metrics.qualityGates.length
            },
            agentPerformance: this.calculateAgentPerformanceSummary(),
            phaseAnalysis: this.analyzePhasePerformance(),
            recommendations: this.generateRecommendations(),
            neuralInsights: this.extractNeuralInsights()
        };
        return report;
    }
    calculateAgentPerformanceSummary() {
        const summary = {};
        for (const agent of this.agents){
            summary[agent.id] = {
                type: agent.type,
                role: agent.role,
                tasksCompleted: agent.performance.tasksCompleted,
                averageQuality: agent.performance.qualityScore,
                efficiency: agent.performance.efficiency,
                averageTime: agent.performance.averageTime
            };
        }
        return summary;
    }
    analyzePhasePerformance() {
        const analysis = {};
        for (const gate of this.metrics.qualityGates){
            if (!analysis[gate.phase]) {
                analysis[gate.phase] = {
                    executions: 0,
                    passed: 0,
                    averageScore: 0,
                    totalScore: 0
                };
            }
            analysis[gate.phase].executions += 1;
            if (gate.passed) analysis[gate.phase].passed += 1;
            analysis[gate.phase].totalScore += gate.score;
        }
        for (const phase of Object.keys(analysis)){
            analysis[phase].averageScore = analysis[phase].totalScore / analysis[phase].executions;
            analysis[phase].successRate = analysis[phase].passed / analysis[phase].executions;
        }
        return analysis;
    }
    generateRecommendations() {
        const recommendations = [];
        const avgUtilization = Object.values(this.metrics.agentUtilization).reduce((sum, agent)=>sum + agent.phases, 0) / Object.keys(this.metrics.agentUtilization).length;
        if (avgUtilization < 2) {
            recommendations.push('Consider reducing agent count for better utilization');
        } else if (avgUtilization > 4) {
            recommendations.push('Consider increasing agent count to distribute load');
        }
        if (this.metrics.coordinationEfficiency < 0.7) {
            recommendations.push('Improve coordination efficiency through better task decomposition');
        }
        const qualityGateSuccess = this.metrics.qualityGates.filter((g)=>g.passed).length / this.metrics.qualityGates.length;
        if (qualityGateSuccess < 0.8) {
            recommendations.push('Review quality gate criteria and provide additional agent training');
        }
        return recommendations;
    }
    extractNeuralInsights() {
        const insights = [];
        const successfulPatterns = this.metrics.learningData.filter((d)=>d.success);
        if (successfulPatterns.length > 0) {
            insights.push(`${successfulPatterns.length} successful execution patterns identified`);
        }
        const avgQuality = this.metrics.learningData.reduce((sum, d)=>sum + d.quality, 0) / this.metrics.learningData.length;
        if (avgQuality > 85) {
            insights.push('High quality outcomes consistently achieved');
        } else if (avgQuality < 70) {
            insights.push('Quality improvements needed in execution');
        }
        return insights;
    }
    async executeSwarmHook(hookName, data = {}) {
        if (!this.swarmEnabled) {
            throw new Error('Swarm not enabled');
        }
        try {
            const { spawn } = await import('child_process');
            return new Promise((resolve, reject)=>{
                const args = [
                    'ruv-swarm',
                    'hook',
                    hookName
                ];
                if (Object.keys(data).length > 0) {
                    args.push('--data', JSON.stringify(data));
                }
                const process = spawn('npx', args, {
                    stdio: 'pipe'
                });
                let output = '';
                let error = '';
                process.stdout.on('data', (data)=>{
                    output += data.toString();
                });
                process.stderr.on('data', (data)=>{
                    error += data.toString();
                });
                process.on('close', (code)=>{
                    if (code === 0) {
                        try {
                            const result = JSON.parse(output);
                            resolve(result);
                        } catch (parseError) {
                            resolve(output.trim());
                        }
                    } else {
                        reject(new Error(`Hook ${hookName} failed: ${error}`));
                    }
                });
                process.on('error', (err)=>{
                    reject(err);
                });
            });
        } catch (error) {
            throw new Error(`Failed to execute swarm hook ${hookName}: ${error.message}`);
        }
    }
    async recordLearning(learningData) {
        if (!this.options.neuralLearning) return;
        try {
            await this.executeSwarmHook('neural_record_learning', {
                methodology: 'sparc',
                data: learningData,
                timestamp: Date.now()
            });
        } catch (error) {
            console.warn(`⚠️ Failed to record learning: ${error.message}`);
        }
    }
    getStatus() {
        return {
            swarmEnabled: this.swarmEnabled,
            swarmId: this.swarmId,
            agentCount: this.agents.length,
            phaseAgents: Object.fromEntries(Array.from(this.phaseAgents.entries()).map(([phase, agents])=>[
                    phase,
                    agents.map((a)=>({
                            id: a.id,
                            type: a.type,
                            status: a.status
                        }))
                ])),
            metrics: this.metrics,
            coordination: this.coordination
        };
    }
}
export default SparcCoordinator;

//# sourceMappingURL=coordinator.js.map