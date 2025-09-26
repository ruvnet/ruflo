import { BaseStrategy } from './base.js';
import { generateId } from '../../utils/helpers.js';
export class AutoStrategy extends BaseStrategy {
    mlHeuristics;
    decompositionCache;
    patternCache;
    performanceHistory;
    constructor(config){
        super(config);
        this.mlHeuristics = this.initializeMLHeuristics();
        this.decompositionCache = new Map();
        this.patternCache = new Map();
        this.performanceHistory = new Map();
    }
    async decomposeObjective(objective) {
        const startTime = Date.now();
        const cacheKey = this.getCacheKey(objective);
        if (this.decompositionCache.has(cacheKey)) {
            this.metrics.cacheHitRate = (this.metrics.cacheHitRate + 1) / 2;
            return this.decompositionCache.get(cacheKey);
        }
        const [detectedPatterns, taskTypes, complexity] = await Promise.all([
            this.detectPatternsAsync(objective.description),
            this.analyzeTaskTypesAsync(objective.description),
            this.estimateComplexityAsync(objective.description)
        ]);
        const tasks = await this.generateTasksWithBatching(objective, detectedPatterns, taskTypes, complexity);
        const dependencies = this.analyzeDependencies(tasks);
        const batchGroups = this.createTaskBatches(tasks, dependencies);
        const estimatedDuration = this.calculateOptimizedDuration(batchGroups);
        const result = {
            tasks,
            dependencies,
            estimatedDuration,
            recommendedStrategy: this.selectOptimalStrategy(objective, complexity),
            complexity,
            batchGroups,
            timestamp: new Date(),
            ttl: 1800000,
            accessCount: 0,
            lastAccessed: new Date(),
            data: {
                objectiveId: objective.id,
                strategy: 'auto'
            }
        };
        this.decompositionCache.set(cacheKey, result);
        this.updateMetrics(result, Date.now() - startTime);
        return result;
    }
    async selectAgentForTask(task, availableAgents) {
        if (availableAgents.length === 0) return null;
        const scoredAgents = await Promise.all(availableAgents.map(async (agent)=>({
                agent,
                score: await this.calculateAgentScore(agent, task)
            })));
        scoredAgents.sort((a, b)=>b.score - a.score);
        const selectedAgent = scoredAgents[0].agent;
        this.updateAgentPerformanceHistory(selectedAgent.id.id, scoredAgents[0].score);
        return selectedAgent.id.id;
    }
    async optimizeTaskSchedule(tasks, agents) {
        const schedule = await this.createPredictiveSchedule(tasks, agents);
        return this.allocateAgentsOptimally(tasks, agents, schedule);
    }
    initializeMLHeuristics() {
        return {
            taskTypeWeights: {
                development: 1.0,
                testing: 0.8,
                analysis: 0.9,
                documentation: 0.6,
                optimization: 1.1,
                research: 0.7
            },
            agentPerformanceHistory: new Map(),
            complexityFactors: {
                integration: 1.5,
                system: 1.3,
                api: 1.2,
                database: 1.4,
                ui: 1.1,
                algorithm: 1.6
            },
            parallelismOpportunities: [
                'independent modules',
                'separate components',
                'different layers',
                'parallel testing',
                'concurrent analysis'
            ]
        };
    }
    async detectPatternsAsync(description) {
        const cacheKey = `patterns-${description.slice(0, 50)}`;
        if (this.patternCache.has(cacheKey)) {
            return this.patternCache.get(cacheKey);
        }
        return new Promise((resolve)=>{
            setTimeout(()=>{
                const patterns = this.taskPatterns.filter((pattern)=>pattern.pattern.test(description));
                const dynamicPatterns = this.generateDynamicPatterns(description);
                const allPatterns = [
                    ...patterns,
                    ...dynamicPatterns
                ];
                this.patternCache.set(cacheKey, allPatterns);
                resolve(allPatterns);
            }, 10);
        });
    }
    async analyzeTaskTypesAsync(description) {
        return new Promise((resolve)=>{
            setTimeout(()=>{
                const types = [];
                if (/create|build|implement|develop|code/i.test(description)) {
                    types.push('development');
                }
                if (/test|verify|validate|check/i.test(description)) {
                    types.push('testing');
                }
                if (/analyze|research|investigate|study/i.test(description)) {
                    types.push('analysis');
                }
                if (/document|write|explain|describe/i.test(description)) {
                    types.push('documentation');
                }
                if (/optimize|improve|enhance|refactor/i.test(description)) {
                    types.push('optimization');
                }
                if (/deploy|install|configure|setup/i.test(description)) {
                    types.push('deployment');
                }
                resolve(types.length > 0 ? types : [
                    'generic'
                ]);
            }, 5);
        });
    }
    async estimateComplexityAsync(description) {
        return new Promise((resolve)=>{
            setTimeout(()=>{
                let complexity = this.estimateComplexity(description);
                for (const [factor, weight] of Object.entries(this.mlHeuristics.complexityFactors)){
                    if (description.toLowerCase().includes(factor)) {
                        complexity *= weight;
                    }
                }
                resolve(Math.min(Math.round(complexity), 5));
            }, 5);
        });
    }
    generateDynamicPatterns(description) {
        const patterns = [];
        if (description.includes('API') || description.includes('endpoint')) {
            patterns.push({
                pattern: /api|endpoint|service/i,
                type: 'api-development',
                complexity: 3,
                estimatedDuration: 20 * 60 * 1000,
                requiredAgents: 2,
                priority: 2
            });
        }
        if (description.includes('database') || description.includes('data')) {
            patterns.push({
                pattern: /database|data|storage/i,
                type: 'data-management',
                complexity: 3,
                estimatedDuration: 18 * 60 * 1000,
                requiredAgents: 2,
                priority: 2
            });
        }
        return patterns;
    }
    async generateTasksWithBatching(objective, patterns, taskTypes, complexity) {
        const tasks = [];
        if (objective.strategy === 'development') {
            tasks.push(...await this.generateDevelopmentTasks(objective, complexity));
        } else if (objective.strategy === 'analysis') {
            tasks.push(...await this.generateAnalysisTasks(objective, complexity));
        } else {
            tasks.push(...await this.generateAutoTasks(objective, patterns, taskTypes, complexity));
        }
        return tasks;
    }
    async generateDevelopmentTasks(objective, complexity) {
        const tasks = [];
        const baseId = generateId('task');
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-analysis`,
            type: 'analysis',
            name: 'Requirements Analysis and Planning',
            description: `Analyze requirements and create implementation plan for: ${objective.description}`,
            priority: 'high',
            estimatedDuration: Math.max(5 * 60 * 1000, complexity * 3 * 60 * 1000),
            capabilities: [
                'analysis',
                'documentation',
                'research'
            ]
        }));
        const implementationTasks = this.createParallelImplementationTasks(objective, complexity, baseId);
        tasks.push(...implementationTasks);
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-testing`,
            type: 'testing',
            name: 'Comprehensive Testing',
            description: `Create and execute tests for the implementation`,
            priority: 'high',
            estimatedDuration: Math.max(8 * 60 * 1000, complexity * 4 * 60 * 1000),
            capabilities: [
                'testing',
                'code-generation'
            ],
            dependencies: implementationTasks.map((t)=>t.id.id)
        }));
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-documentation`,
            type: 'documentation',
            name: 'Documentation Creation',
            description: `Create comprehensive documentation`,
            priority: 'medium',
            estimatedDuration: Math.max(5 * 60 * 1000, complexity * 2 * 60 * 1000),
            capabilities: [
                'documentation'
            ],
            dependencies: implementationTasks.map((t)=>t.id.id)
        }));
        return tasks;
    }
    createParallelImplementationTasks(objective, complexity, baseId) {
        const tasks = [];
        const canParallelize = this.canParallelizeImplementation(objective.description);
        if (canParallelize && complexity >= 3) {
            const components = this.identifyComponents(objective.description);
            components.forEach((component, index)=>{
                tasks.push(this.createTaskDefinition({
                    id: `${baseId}-impl-${index}`,
                    type: 'coding',
                    name: `Implement ${component}`,
                    description: `Implement ${component} component for: ${objective.description}`,
                    priority: 'high',
                    estimatedDuration: Math.max(10 * 60 * 1000, complexity * 5 * 60 * 1000),
                    capabilities: [
                        'code-generation',
                        'file-system'
                    ],
                    dependencies: [
                        `${baseId}-analysis`
                    ]
                }));
            });
        } else {
            tasks.push(this.createTaskDefinition({
                id: `${baseId}-implementation`,
                type: 'coding',
                name: 'Core Implementation',
                description: `Implement the solution for: ${objective.description}`,
                priority: 'high',
                estimatedDuration: Math.max(15 * 60 * 1000, complexity * 8 * 60 * 1000),
                capabilities: [
                    'code-generation',
                    'file-system'
                ],
                dependencies: [
                    `${baseId}-analysis`
                ]
            }));
        }
        return tasks;
    }
    async generateAnalysisTasks(objective, complexity) {
        const tasks = [];
        const baseId = generateId('task');
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-collection`,
            type: 'research',
            name: 'Data Collection and Research',
            description: `Collect and research data for: ${objective.description}`,
            priority: 'high',
            estimatedDuration: Math.max(8 * 60 * 1000, complexity * 4 * 60 * 1000),
            capabilities: [
                'research',
                'analysis',
                'web-search'
            ]
        }));
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-analysis`,
            type: 'analysis',
            name: 'Data Analysis',
            description: `Analyze collected data and generate insights`,
            priority: 'high',
            estimatedDuration: Math.max(10 * 60 * 1000, complexity * 5 * 60 * 1000),
            capabilities: [
                'analysis',
                'documentation'
            ],
            dependencies: [
                `${baseId}-collection`
            ]
        }));
        tasks.push(this.createTaskDefinition({
            id: `${baseId}-reporting`,
            type: 'documentation',
            name: 'Analysis Report',
            description: `Create comprehensive analysis report`,
            priority: 'medium',
            estimatedDuration: Math.max(6 * 60 * 1000, complexity * 3 * 60 * 1000),
            capabilities: [
                'documentation',
                'analysis'
            ],
            dependencies: [
                `${baseId}-analysis`
            ]
        }));
        return tasks;
    }
    async generateAutoTasks(objective, patterns, taskTypes, complexity) {
        const tasks = [];
        const baseId = generateId('task');
        const optimalStructure = this.determineOptimalTaskStructure(patterns, taskTypes, complexity);
        if (optimalStructure.requiresAnalysis) {
            tasks.push(this.createTaskDefinition({
                id: `${baseId}-analysis`,
                type: 'analysis',
                name: 'Intelligent Analysis',
                description: `Analyze and understand: ${objective.description}`,
                priority: 'high',
                estimatedDuration: optimalStructure.analysisDuration,
                capabilities: [
                    'analysis',
                    'research'
                ]
            }));
        }
        if (optimalStructure.requiresImplementation) {
            const implTasks = this.createOptimalImplementationTasks(objective, optimalStructure, baseId);
            tasks.push(...implTasks);
        }
        if (optimalStructure.requiresTesting) {
            tasks.push(this.createTaskDefinition({
                id: `${baseId}-testing`,
                type: 'testing',
                name: 'Intelligent Testing',
                description: `Test and validate the solution`,
                priority: 'high',
                estimatedDuration: optimalStructure.testingDuration,
                capabilities: [
                    'testing',
                    'validation'
                ],
                dependencies: tasks.filter((t)=>t.type === 'coding').map((t)=>t.id.id)
            }));
        }
        return tasks;
    }
    createTaskDefinition(params) {
        const taskId = {
            id: params.id,
            swarmId: 'auto-strategy',
            sequence: 1,
            priority: 1
        };
        return {
            id: taskId,
            type: params.type,
            name: params.name,
            description: params.description,
            instructions: params.description,
            requirements: {
                capabilities: params.capabilities,
                tools: this.getRequiredTools(params.type),
                permissions: [
                    'read',
                    'write',
                    'execute'
                ]
            },
            constraints: {
                dependencies: (params.dependencies || []).map((dep)=>({
                        id: dep,
                        swarmId: 'auto-strategy',
                        sequence: 1,
                        priority: 1
                    })),
                dependents: [],
                conflicts: [],
                maxRetries: 3,
                timeoutAfter: params.estimatedDuration
            },
            priority: params.priority,
            input: {
                description: params.description
            },
            context: {},
            examples: [],
            status: 'created',
            createdAt: new Date(),
            updatedAt: new Date(),
            attempts: [],
            statusHistory: [
                {
                    timestamp: new Date(),
                    from: 'created',
                    to: 'created',
                    reason: 'Task created by AutoStrategy',
                    triggeredBy: 'system'
                }
            ]
        };
    }
    getRequiredTools(type) {
        const toolMap = {
            coding: [
                'file-system',
                'terminal',
                'editor'
            ],
            testing: [
                'test-runner',
                'file-system',
                'terminal'
            ],
            analysis: [
                'analyst',
                'file-system',
                'web-search'
            ],
            documentation: [
                'editor',
                'file-system'
            ],
            research: [
                'web-search',
                'analyst',
                'file-system'
            ],
            review: [
                'analyst',
                'file-system'
            ],
            deployment: [
                'terminal',
                'file-system',
                'deployment-tools'
            ],
            monitoring: [
                'monitoring-tools',
                'analyst'
            ],
            coordination: [
                'communication-tools'
            ],
            communication: [
                'communication-tools'
            ],
            maintenance: [
                'file-system',
                'terminal',
                'monitoring-tools'
            ],
            optimization: [
                'analyst',
                'profiler',
                'file-system'
            ],
            validation: [
                'validator',
                'test-runner'
            ],
            integration: [
                'integration-tools',
                'file-system',
                'terminal'
            ],
            custom: [
                'file-system'
            ]
        };
        return toolMap[type] || [
            'file-system'
        ];
    }
    canParallelizeImplementation(description) {
        const parallelKeywords = [
            'components',
            'modules',
            'services',
            'layers',
            'parts'
        ];
        return parallelKeywords.some((keyword)=>description.toLowerCase().includes(keyword));
    }
    identifyComponents(description) {
        const components = [
            'Core Logic',
            'User Interface',
            'Data Layer'
        ];
        if (description.toLowerCase().includes('api')) {
            components.push('API Layer');
        }
        if (description.toLowerCase().includes('database')) {
            components.push('Database Integration');
        }
        return components.slice(0, 3);
    }
    determineOptimalTaskStructure(patterns, taskTypes, complexity) {
        return {
            requiresAnalysis: complexity >= 2 || taskTypes.includes('analysis'),
            requiresImplementation: taskTypes.includes('development') || taskTypes.includes('coding'),
            requiresTesting: complexity >= 2 || taskTypes.includes('testing'),
            analysisDuration: Math.max(5 * 60 * 1000, complexity * 3 * 60 * 1000),
            testingDuration: Math.max(5 * 60 * 1000, complexity * 4 * 60 * 1000)
        };
    }
    createOptimalImplementationTasks(objective, structure, baseId) {
        return [
            this.createTaskDefinition({
                id: `${baseId}-implementation`,
                type: 'coding',
                name: 'Optimal Implementation',
                description: `Implement solution for: ${objective.description}`,
                priority: 'high',
                estimatedDuration: Math.max(15 * 60 * 1000, structure.complexity * 8 * 60 * 1000),
                capabilities: [
                    'code-generation',
                    'file-system'
                ],
                dependencies: structure.requiresAnalysis ? [
                    `${baseId}-analysis`
                ] : []
            })
        ];
    }
    analyzeDependencies(tasks) {
        const dependencies = new Map();
        tasks.forEach((task)=>{
            if (task.constraints.dependencies.length > 0) {
                dependencies.set(task.id.id, task.constraints.dependencies.map((dep)=>dep.id));
            }
        });
        return dependencies;
    }
    createTaskBatches(tasks, dependencies) {
        const batches = [];
        const processed = new Set();
        let batchIndex = 0;
        while(processed.size < tasks.length){
            const batchTasks = tasks.filter((task)=>!processed.has(task.id.id) && task.constraints.dependencies.every((dep)=>processed.has(dep.id)));
            if (batchTasks.length === 0) break;
            const batch = {
                id: `batch-${batchIndex++}`,
                tasks: batchTasks,
                canRunInParallel: batchTasks.length > 1,
                estimatedDuration: Math.max(...batchTasks.map((t)=>t.constraints.timeoutAfter || 0)),
                requiredResources: this.calculateBatchResources(batchTasks)
            };
            batches.push(batch);
            batchTasks.forEach((task)=>processed.add(task.id.id));
        }
        return batches;
    }
    calculateBatchResources(tasks) {
        return {
            agents: tasks.length,
            memory: tasks.length * 512,
            cpu: tasks.length * 0.5
        };
    }
    calculateOptimizedDuration(batches) {
        return batches.reduce((total, batch)=>total + batch.estimatedDuration, 0);
    }
    selectOptimalStrategy(objective, complexity) {
        if (complexity >= 4) return 'development';
        if (objective.description.toLowerCase().includes('analyze')) return 'analysis';
        if (objective.description.toLowerCase().includes('test')) return 'testing';
        return 'auto';
    }
    async calculateAgentScore(agent, task) {
        let score = 0;
        const capabilityMatch = this.calculateCapabilityMatch(agent, task);
        score += capabilityMatch * 0.4;
        const performanceScore = this.getAgentPerformanceScore(agent.id.id);
        score += performanceScore * 0.3;
        const workloadScore = 1 - agent.workload;
        score += workloadScore * 0.2;
        const mlScore = this.applyMLHeuristics(agent, task);
        score += mlScore * 0.1;
        return score;
    }
    calculateCapabilityMatch(agent, task) {
        const requiredCaps = task.requirements.capabilities;
        let matches = 0;
        for (const cap of requiredCaps){
            if (this.agentHasCapability(agent, cap)) {
                matches++;
            }
        }
        return requiredCaps.length > 0 ? matches / requiredCaps.length : 1.0;
    }
    agentHasCapability(agent, capability) {
        const caps = agent.capabilities;
        switch(capability){
            case 'code-generation':
                return caps.codeGeneration;
            case 'code-review':
                return caps.codeReview;
            case 'testing':
                return caps.testing;
            case 'documentation':
                return caps.documentation;
            case 'research':
                return caps.research;
            case 'analysis':
                return caps.analysis;
            case 'web-search':
                return caps.webSearch;
            case 'api-integration':
                return caps.apiIntegration;
            case 'file-system':
                return caps.fileSystem;
            case 'terminal-access':
                return caps.terminalAccess;
            default:
                return caps.domains.includes(capability) || caps.languages.includes(capability) || caps.frameworks.includes(capability) || caps.tools.includes(capability);
        }
    }
    getAgentPerformanceScore(agentId) {
        const history = this.performanceHistory.get(agentId);
        if (!history || history.length === 0) return 0.8;
        const average = history.reduce((sum, score)=>sum + score, 0) / history.length;
        return Math.min(average, 1.0);
    }
    applyMLHeuristics(agent, task) {
        const taskType = this.detectTaskType(task.description);
        const weight = this.mlHeuristics.taskTypeWeights[taskType] || 1.0;
        let bonus = 0;
        if (agent.type === 'coder' && taskType === 'development') bonus = 0.2;
        if (agent.type === 'tester' && taskType === 'testing') bonus = 0.2;
        if (agent.type === 'analyst' && taskType === 'analysis') bonus = 0.2;
        return Math.min(weight + bonus, 1.0);
    }
    updateAgentPerformanceHistory(agentId, score) {
        if (!this.performanceHistory.has(agentId)) {
            this.performanceHistory.set(agentId, []);
        }
        const history = this.performanceHistory.get(agentId);
        history.push(score);
        if (history.length > 10) {
            history.shift();
        }
    }
    async createPredictiveSchedule(tasks, agents) {
        const timeline = [];
        let currentTime = Date.now();
        for (const task of tasks){
            const duration = task.constraints.timeoutAfter || 300000;
            timeline.push({
                startTime: currentTime,
                endTime: currentTime + duration,
                tasks: [
                    task.id.id
                ],
                agents: [],
                dependencies: task.constraints.dependencies.map((dep)=>dep.id)
            });
            currentTime += duration;
        }
        return {
            timeline,
            resourceUtilization: {
                cpu: 0.7,
                memory: 0.6
            },
            bottlenecks: [],
            optimizationSuggestions: [
                'Consider parallel execution for independent tasks'
            ]
        };
    }
    allocateAgentsOptimally(tasks, agents, schedule) {
        const allocations = [];
        agents.forEach((agent)=>{
            const suitableTasks = tasks.filter((task)=>this.calculateCapabilityMatch(agent, task) > 0.5);
            if (suitableTasks.length > 0) {
                allocations.push({
                    agentId: agent.id.id,
                    tasks: suitableTasks.slice(0, 3).map((t)=>t.id.id),
                    estimatedWorkload: suitableTasks.length * 0.3,
                    capabilities: Object.keys(agent.capabilities).filter((cap)=>agent.capabilities[cap] === true)
                });
            }
        });
        return allocations;
    }
}

//# sourceMappingURL=auto.js.map