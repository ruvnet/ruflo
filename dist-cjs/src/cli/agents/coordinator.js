import { BaseAgent } from './base-agent.js';
export class CoordinatorAgent extends BaseAgent {
    constructor(id, config, environment, logger, eventBus, memory){
        super(id, 'coordinator', config, environment, logger, eventBus, memory);
    }
    getDefaultCapabilities() {
        return {
            codeGeneration: false,
            codeReview: false,
            testing: false,
            documentation: true,
            research: true,
            analysis: true,
            webSearch: false,
            apiIntegration: true,
            fileSystem: true,
            terminalAccess: false,
            languages: [],
            frameworks: [],
            domains: [
                'project-management',
                'task-coordination',
                'workflow-orchestration',
                'team-management',
                'planning',
                'communication',
                'resource-allocation',
                'progress-tracking'
            ],
            tools: [
                'task-manager',
                'workflow-orchestrator',
                'communication-hub',
                'progress-tracker',
                'resource-allocator',
                'deadline-manager',
                'status-reporter'
            ],
            maxConcurrentTasks: 8,
            maxMemoryUsage: 512 * 1024 * 1024,
            maxExecutionTime: 600000,
            reliability: 0.95,
            speed: 0.9,
            quality: 0.88
        };
    }
    getDefaultConfig() {
        return {
            autonomyLevel: 0.9,
            learningEnabled: true,
            adaptationEnabled: true,
            maxTasksPerHour: 30,
            maxConcurrentTasks: 8,
            timeoutThreshold: 600000,
            reportingInterval: 15000,
            heartbeatInterval: 8000,
            permissions: [
                'file-read',
                'file-write',
                'api-access',
                'agent-management',
                'task-management'
            ],
            trustedAgents: [],
            expertise: {
                'task-orchestration': 0.95,
                'resource-management': 0.9,
                'progress-tracking': 0.92,
                communication: 0.88,
                planning: 0.85
            },
            preferences: {
                communicationStyle: 'clear',
                reportingFrequency: 'regular',
                prioritization: 'impact-based',
                escalationThreshold: 'medium'
            }
        };
    }
    async executeTask(task) {
        this.logger.info('Coordinator executing task', {
            agentId: this.id,
            taskType: task.type,
            taskId: task.id
        });
        try {
            switch(task.type){
                case 'task-orchestration':
                    return await this.orchestrateTasks(task);
                case 'progress-tracking':
                    return await this.trackProgress(task);
                case 'resource-allocation':
                    return await this.allocateResources(task);
                case 'workflow-management':
                    return await this.manageWorkflow(task);
                case 'team-coordination':
                    return await this.coordinateTeam(task);
                case 'status-reporting':
                    return await this.generateStatusReport(task);
                default:
                    return await this.performGeneralCoordination(task);
            }
        } catch (error) {
            this.logger.error('Coordination task failed', {
                agentId: this.id,
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async orchestrateTasks(task) {
        const tasks = task.parameters?.tasks || [];
        const strategy = task.parameters?.strategy || 'sequential';
        const priority = task.parameters?.priority || 'balanced';
        this.logger.info('Orchestrating tasks', {
            taskCount: tasks.length,
            strategy,
            priority
        });
        const orchestration = {
            strategy,
            priority,
            tasks: [],
            dependencies: [],
            timeline: {
                estimated: 0,
                critical_path: [],
                milestones: []
            },
            resource_allocation: {},
            monitoring: {
                checkpoints: [],
                alerts: [],
                metrics: []
            },
            risk_assessment: {
                risks: [],
                mitigation: []
            },
            timestamp: new Date()
        };
        await this.delay(2000);
        orchestration.tasks = tasks.map((t, index)=>({
                id: t.id || `task-${index + 1}`,
                name: t.name || `Task ${index + 1}`,
                status: 'pending',
                assignee: null,
                estimated_duration: t.duration || 30,
                dependencies: t.dependencies || []
            }));
        return orchestration;
    }
    async trackProgress(task) {
        const project = task.parameters?.project;
        const timeframe = task.parameters?.timeframe || 'weekly';
        const metrics = task.parameters?.metrics || [
            'completion',
            'velocity',
            'quality'
        ];
        this.logger.info('Tracking progress', {
            project,
            timeframe,
            metrics
        });
        const progress = {
            project,
            timeframe,
            metrics,
            summary: {
                overall_progress: 0,
                tasks_completed: 0,
                tasks_in_progress: 0,
                tasks_pending: 0,
                blockers: 0
            },
            velocity: {
                current: 0,
                average: 0,
                trend: 'stable'
            },
            quality_metrics: {
                defect_rate: 0,
                review_coverage: 0,
                test_coverage: 0
            },
            timeline: {
                on_track: true,
                estimated_completion: new Date(),
                delays: []
            },
            recommendations: [],
            timestamp: new Date()
        };
        await this.delay(1500);
        progress.summary = {
            overall_progress: 68,
            tasks_completed: 15,
            tasks_in_progress: 6,
            tasks_pending: 4,
            blockers: 1
        };
        return progress;
    }
    async allocateResources(task) {
        const resources = task.input?.resources || [];
        const requirements = task.input?.requirements || [];
        const constraints = task.input?.constraints || [];
        this.logger.info('Allocating resources', {
            resources: resources.length,
            requirements: requirements.length,
            constraints: constraints.length
        });
        const allocation = {
            resources,
            requirements,
            constraints,
            assignments: [],
            utilization: {},
            conflicts: [],
            optimizations: [],
            recommendations: [],
            efficiency: 0,
            timestamp: new Date()
        };
        await this.delay(2500);
        allocation.assignments = [
            {
                resource: 'Agent-001',
                task: 'API Development',
                utilization: 0.8,
                duration: '2 days'
            },
            {
                resource: 'Agent-002',
                task: 'Testing',
                utilization: 0.6,
                duration: '1 day'
            }
        ];
        allocation.efficiency = 0.85;
        return allocation;
    }
    async manageWorkflow(task) {
        const workflow = task.input?.workflow;
        const stage = task.input?.stage || 'planning';
        const automation = task.input?.automation || false;
        this.logger.info('Managing workflow', {
            workflow,
            stage,
            automation
        });
        const management = {
            workflow,
            stage,
            automation,
            stages: [],
            transitions: [],
            approvals: [],
            bottlenecks: [],
            optimizations: [],
            sla_compliance: {
                on_time: 0,
                quality: 0,
                budget: 0
            },
            timestamp: new Date()
        };
        await this.delay(2000);
        management.stages = [
            {
                name: 'Planning',
                status: 'completed',
                duration: '2 days'
            },
            {
                name: 'Development',
                status: 'in_progress',
                duration: '5 days'
            },
            {
                name: 'Testing',
                status: 'pending',
                duration: '2 days'
            },
            {
                name: 'Deployment',
                status: 'pending',
                duration: '1 day'
            }
        ];
        return management;
    }
    async coordinateTeam(task) {
        const team = task.parameters?.team || [];
        const objectives = task.parameters?.objectives || [];
        const communication = task.parameters?.communication || 'daily';
        this.logger.info('Coordinating team', {
            teamSize: team.length,
            objectives: objectives.length,
            communication
        });
        const coordination = {
            team,
            objectives,
            communication,
            meetings: [],
            assignments: [],
            collaboration: {
                tools: [],
                channels: [],
                frequency: communication
            },
            performance: {
                individual: {},
                team: {
                    productivity: 0,
                    satisfaction: 0,
                    collaboration_score: 0
                }
            },
            issues: [],
            improvements: [],
            timestamp: new Date()
        };
        await this.delay(1800);
        coordination.performance.team = {
            productivity: 0.82,
            satisfaction: 0.88,
            collaboration_score: 0.85
        };
        return coordination;
    }
    async generateStatusReport(task) {
        const scope = task.input?.scope || 'project';
        const period = task.input?.period || 'weekly';
        const audience = task.input?.audience || 'stakeholders';
        const format = task.input?.format || 'summary';
        this.logger.info('Generating status report', {
            scope,
            period,
            audience,
            format
        });
        const report = {
            scope,
            period,
            audience,
            format,
            executive_summary: '',
            key_metrics: {},
            achievements: [],
            challenges: [],
            next_steps: [],
            risks: [],
            recommendations: [],
            appendix: {
                detailed_metrics: {},
                charts: [],
                raw_data: {}
            },
            timestamp: new Date()
        };
        await this.delay(3000);
        report.executive_summary = 'Project is 68% complete and on track for delivery. Team productivity is high with minor blockers identified.';
        report.key_metrics = {
            completion: '68%',
            velocity: '12 points/sprint',
            quality: '4.2/5.0',
            budget: '72% utilized'
        };
        report.achievements = [
            'Completed API development milestone',
            'Achieved 85% test coverage',
            'Resolved 3 critical bugs'
        ];
        return report;
    }
    async performGeneralCoordination(task) {
        this.logger.info('Performing general coordination', {
            description: task.description
        });
        return await this.orchestrateTasks(task);
    }
    async delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    getAgentStatus() {
        return {
            ...super.getAgentStatus(),
            specialization: 'Task Orchestration & Project Management',
            coordinationCapabilities: [
                'Task Orchestration',
                'Resource Allocation',
                'Progress Tracking',
                'Team Coordination',
                'Workflow Management',
                'Status Reporting'
            ],
            managementStyles: [
                'Agile',
                'Waterfall',
                'Hybrid'
            ],
            currentCoordinations: this.getCurrentTasks().length,
            averageCoordinationTime: '5-15 minutes',
            lastCoordinationCompleted: this.getLastTaskCompletedTime(),
            teamSize: this.collaborators.length
        };
    }
}
export const createCoordinatorAgent = (id, config, environment, logger, eventBus, memory)=>{
    const defaultConfig = {
        autonomyLevel: 0.9,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 20,
        maxConcurrentTasks: 5,
        timeoutThreshold: 180000,
        reportingInterval: 30000,
        heartbeatInterval: 15000,
        permissions: [
            'task-orchestration',
            'resource-allocation',
            'progress-tracking',
            'team-coordination',
            'reporting',
            'workflow-management'
        ],
        trustedAgents: [],
        expertise: {
            'task-orchestration': 0.98,
            'resource-allocation': 0.95,
            'progress-tracking': 0.92,
            'team-coordination': 0.9,
            'workflow-management': 0.94
        },
        preferences: {
            coordinationStyle: 'collaborative',
            reportingFrequency: 'regular',
            escalationThreshold: 'medium',
            teamSize: 'medium'
        }
    };
    const defaultEnv = {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: './agents/coordinator',
        tempDirectory: './tmp/coordinator',
        logDirectory: './logs/coordinator',
        apiEndpoints: {},
        credentials: {},
        availableTools: [
            'task-manager',
            'workflow-orchestrator',
            'communication-hub',
            'progress-tracker'
        ],
        toolConfigs: {
            taskManager: {
                autoAssign: true,
                prioritization: 'impact'
            },
            communication: {
                frequency: 'regular',
                style: 'clear'
            }
        }
    };
    return new CoordinatorAgent(id, {
        ...defaultConfig,
        ...config
    }, {
        ...defaultEnv,
        ...environment
    }, logger, eventBus, memory);
};

//# sourceMappingURL=coordinator.js.map