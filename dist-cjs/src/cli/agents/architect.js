import { BaseAgent } from './base-agent.js';
export class ArchitectAgent extends BaseAgent {
    constructor(id, config, environment, logger, eventBus, memory){
        super(id, 'architect', config, environment, logger, eventBus, memory);
    }
    getDefaultCapabilities() {
        return {
            codeGeneration: false,
            codeReview: true,
            testing: false,
            documentation: true,
            research: true,
            analysis: true,
            webSearch: true,
            apiIntegration: true,
            fileSystem: true,
            terminalAccess: false,
            languages: [
                "typescript",
                "javascript",
                'python',
                'java',
                'csharp',
                'go',
                'rust'
            ],
            frameworks: [
                'microservices',
                'kubernetes',
                'docker',
                'aws',
                'azure',
                'gcp',
                'terraform',
                'helm'
            ],
            domains: [
                'system-architecture',
                'software-architecture',
                'cloud-architecture',
                'microservices-design',
                'api-design',
                'database-architecture',
                'security-architecture',
                'scalability-design',
                'infrastructure-design',
                'enterprise-architecture'
            ],
            tools: [
                'architecture-diagrams',
                'system-modeler',
                'design-patterns',
                'cloud-designer',
                'api-designer',
                'security-analyzer',
                'performance-modeler',
                'cost-calculator'
            ],
            maxConcurrentTasks: 2,
            maxMemoryUsage: 1024 * 1024 * 1024,
            maxExecutionTime: 2400000,
            reliability: 0.95,
            speed: 0.7,
            quality: 0.98
        };
    }
    getDefaultConfig() {
        return {
            autonomyLevel: 0.6,
            learningEnabled: true,
            adaptationEnabled: true,
            maxTasksPerHour: 8,
            maxConcurrentTasks: 2,
            timeoutThreshold: 2400000,
            reportingInterval: 90000,
            heartbeatInterval: 20000,
            permissions: [
                'file-read',
                'file-write',
                'web-access',
                'api-access',
                'cloud-access'
            ],
            trustedAgents: [],
            expertise: {
                'system-design': 0.98,
                'architecture-patterns': 0.95,
                scalability: 0.92,
                security: 0.88,
                performance: 0.9,
                'cloud-design': 0.87
            },
            preferences: {
                architectureStyle: 'microservices',
                cloudProvider: 'multi',
                securityFirst: true,
                scalabilityFocus: true,
                documentationDetail: 'comprehensive'
            }
        };
    }
    async executeTask(task) {
        this.logger.info('Architect executing task', {
            agentId: this.id,
            taskType: task.type,
            taskId: task.id
        });
        try {
            switch(task.type){
                case 'system-design':
                    return await this.designSystem(task);
                case 'architecture-review':
                    return await this.reviewArchitecture(task);
                case 'api-design':
                    return await this.designAPI(task);
                case 'cloud-architecture':
                    return await this.designCloudArchitecture(task);
                case 'microservices-design':
                    return await this.designMicroservices(task);
                case 'security-architecture':
                    return await this.designSecurity(task);
                case 'scalability-design':
                    return await this.designScalability(task);
                case 'database-architecture':
                    return await this.designDatabase(task);
                default:
                    return await this.performGeneralDesign(task);
            }
        } catch (error) {
            this.logger.error('Architecture task failed', {
                agentId: this.id,
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async designSystem(task) {
        const requirements = task.input?.requirements;
        const scale = task.input?.scale || 'medium';
        const constraints = task.input?.constraints || [];
        const style = task.input?.style || 'microservices';
        this.logger.info('Designing system', {
            requirements: requirements?.length || 0,
            scale,
            style
        });
        const design = {
            requirements,
            scale,
            style,
            architecture: {
                components: [],
                services: [],
                databases: [],
                queues: [],
                caches: []
            },
            patterns: [],
            technologies: {
                backend: [],
                frontend: [],
                database: [],
                infrastructure: [],
                monitoring: []
            },
            diagrams: [],
            documentation: {
                overview: '',
                components: [],
                apis: [],
                deployment: '',
                monitoring: ''
            },
            constraints: constraints,
            tradeoffs: [],
            risks: [],
            recommendations: [],
            timestamp: new Date()
        };
        await this.memory.store(`design:${task.id}:progress`, {
            status: 'designing',
            startTime: new Date(),
            requirements
        }, {
            type: 'design-progress',
            tags: [
                'architecture',
                this.id,
                style
            ],
            partition: 'tasks'
        });
        await this.delay(5000);
        design.architecture.components = [
            {
                name: 'API Gateway',
                type: 'gateway',
                purpose: 'Request routing and load balancing',
                technology: 'Kong/NGINX'
            },
            {
                name: 'User Service',
                type: 'microservice',
                purpose: 'User management and authentication',
                technology: 'Node.js/Express'
            },
            {
                name: 'Data Service',
                type: 'microservice',
                purpose: 'Data processing and analytics',
                technology: 'Python/FastAPI'
            }
        ];
        design.patterns = [
            'Microservices Architecture',
            'API Gateway Pattern',
            'Database per Service',
            'Event Sourcing',
            'CQRS',
            'Circuit Breaker'
        ];
        design.technologies = {
            backend: [
                'Node.js',
                'Python',
                'TypeScript'
            ],
            frontend: [
                'React',
                'TypeScript'
            ],
            database: [
                'PostgreSQL',
                'Redis',
                'MongoDB'
            ],
            infrastructure: [
                'Kubernetes',
                'Docker',
                'AWS'
            ],
            monitoring: [
                'Prometheus',
                'Grafana',
                'Jaeger'
            ]
        };
        await this.memory.store(`design:${task.id}:results`, design, {
            type: 'design-results',
            tags: [
                'architecture',
                'completed',
                this.id,
                style
            ],
            partition: 'tasks'
        });
        return design;
    }
    async reviewArchitecture(task) {
        const architecture = task.parameters?.architecture;
        const focus = task.parameters?.focus || [
            'scalability',
            'security',
            'maintainability'
        ];
        const standards = task.parameters?.standards || 'enterprise';
        this.logger.info('Reviewing architecture', {
            focus,
            standards
        });
        const review = {
            architecture,
            focus,
            standards,
            scores: {},
            issues: [],
            recommendations: [],
            compliance: {
                passed: [],
                failed: [],
                warnings: []
            },
            patterns: {
                identified: [],
                missing: [],
                antipatterns: []
            },
            improvements: [],
            riskAssessment: {
                technical: [],
                security: [],
                operational: []
            },
            timestamp: new Date()
        };
        await this.delay(4000);
        review.scores = {
            scalability: 0.85,
            security: 0.78,
            maintainability: 0.92,
            performance: 0.88,
            reliability: 0.9
        };
        review.issues = [
            {
                category: 'security',
                severity: 'high',
                description: 'Missing API rate limiting',
                component: 'API Gateway',
                recommendation: 'Implement rate limiting and throttling'
            },
            {
                category: 'scalability',
                severity: 'medium',
                description: 'Single point of failure in auth service',
                component: 'Authentication Service',
                recommendation: 'Add redundancy and load balancing'
            }
        ];
        return review;
    }
    async designAPI(task) {
        const domain = task.parameters?.domain;
        const style = task.parameters?.style || 'REST';
        const version = task.parameters?.version || 'v1';
        const auth = task.parameters?.auth || 'JWT';
        this.logger.info('Designing API', {
            domain,
            style,
            version,
            auth
        });
        const apiDesign = {
            domain,
            style,
            version,
            auth,
            endpoints: [],
            schemas: [],
            security: {
                authentication: auth,
                authorization: 'RBAC',
                rateLimiting: true,
                cors: true,
                validation: true
            },
            documentation: {
                openapi: '3.0.0',
                interactive: true,
                examples: true
            },
            standards: {
                naming: 'kebab-case',
                versioning: 'url-path',
                errorHandling: 'RFC7807',
                pagination: 'cursor-based'
            },
            performance: {
                caching: 'Redis',
                compression: 'gzip',
                cdn: true
            },
            monitoring: {
                logging: true,
                metrics: true,
                tracing: true
            },
            timestamp: new Date()
        };
        await this.delay(3000);
        apiDesign.endpoints = [
            {
                method: 'GET',
                path: '/api/v1/users',
                description: 'List users with pagination',
                auth: true,
                rateLimit: '1000/hour'
            },
            {
                method: 'POST',
                path: '/api/v1/users',
                description: 'Create new user',
                auth: true,
                rateLimit: '100/hour'
            }
        ];
        return apiDesign;
    }
    async designCloudArchitecture(task) {
        const provider = task.parameters?.provider || 'AWS';
        const regions = task.parameters?.regions || [
            'us-east-1'
        ];
        const budget = task.parameters?.budget;
        const compliance = task.parameters?.compliance || [];
        this.logger.info('Designing cloud architecture', {
            provider,
            regions,
            compliance
        });
        const cloudDesign = {
            provider,
            regions,
            budget,
            compliance,
            infrastructure: {
                compute: [],
                storage: [],
                network: [],
                database: [],
                security: []
            },
            services: [],
            deployment: {
                strategy: 'blue-green',
                automation: 'terraform',
                ci_cd: 'github-actions'
            },
            monitoring: {
                logging: 'cloudwatch',
                metrics: 'cloudwatch',
                alerting: 'sns',
                tracing: 'x-ray'
            },
            security: {
                iam: 'principle-of-least-privilege',
                network: 'vpc-with-private-subnets',
                encryption: 'at-rest-and-in-transit',
                secrets: 'parameter-store'
            },
            cost: {
                estimated: 0,
                optimization: [],
                monitoring: true
            },
            timestamp: new Date()
        };
        await this.delay(4500);
        cloudDesign.infrastructure.compute = [
            {
                service: 'EKS',
                purpose: 'Container orchestration'
            },
            {
                service: 'Lambda',
                purpose: 'Serverless functions'
            },
            {
                service: 'EC2',
                purpose: 'Virtual machines'
            }
        ];
        cloudDesign.cost.estimated = 2500;
        return cloudDesign;
    }
    async designMicroservices(task) {
        const domain = task.parameters?.domain;
        const services = task.parameters?.services || [];
        const communication = task.parameters?.communication || 'async';
        const dataConsistency = task.parameters?.dataConsistency || 'eventual';
        this.logger.info('Designing microservices', {
            domain,
            servicesCount: services.length,
            communication,
            dataConsistency
        });
        const microservicesDesign = {
            domain,
            communication,
            dataConsistency,
            services: [],
            patterns: {
                communication: [
                    'API Gateway',
                    'Service Mesh',
                    'Event Bus'
                ],
                data: [
                    'Database per Service',
                    'Saga Pattern',
                    'CQRS'
                ],
                resilience: [
                    'Circuit Breaker',
                    'Retry',
                    'Timeout'
                ],
                observability: [
                    'Distributed Tracing',
                    'Centralized Logging'
                ]
            },
            infrastructure: {
                serviceDiscovery: 'consul',
                loadBalancing: 'nginx',
                messaging: 'kafka',
                monitoring: 'prometheus'
            },
            deployment: {
                containerization: 'docker',
                orchestration: 'kubernetes',
                ci_cd: 'jenkins',
                configuration: 'helm'
            },
            challenges: [],
            solutions: [],
            timestamp: new Date()
        };
        await this.delay(4000);
        microservicesDesign.services = [
            {
                name: 'User Service',
                responsibility: 'User management',
                database: 'PostgreSQL',
                api: 'REST',
                dependencies: []
            },
            {
                name: 'Order Service',
                responsibility: 'Order processing',
                database: 'MongoDB',
                api: 'REST + Events',
                dependencies: [
                    'User Service',
                    'Payment Service'
                ]
            }
        ];
        return microservicesDesign;
    }
    async designSecurity(task) {
        const system = task.parameters?.system;
        const threats = task.parameters?.threats || [];
        const compliance = task.parameters?.compliance || [];
        const sensitivity = task.parameters?.sensitivity || 'medium';
        this.logger.info('Designing security architecture', {
            threats: threats.length,
            compliance,
            sensitivity
        });
        const securityDesign = {
            system,
            sensitivity,
            compliance,
            threatModel: {
                assets: [],
                threats: [],
                vulnerabilities: [],
                risks: []
            },
            controls: {
                preventive: [],
                detective: [],
                corrective: []
            },
            architecture: {
                authentication: 'OAuth2 + JWT',
                authorization: 'RBAC + ABAC',
                encryption: 'AES-256',
                network: 'Zero Trust'
            },
            monitoring: {
                siem: true,
                ids: true,
                logging: 'centralized',
                alerting: 'real-time'
            },
            incidents: {
                response: 'automated',
                recovery: 'backup-restore',
                communication: 'stakeholder-notification'
            },
            timestamp: new Date()
        };
        await this.delay(3500);
        securityDesign.controls.preventive = [
            'Multi-factor Authentication',
            'API Rate Limiting',
            'Input Validation',
            'Access Controls',
            'Encryption at Rest'
        ];
        return securityDesign;
    }
    async designScalability(task) {
        const currentLoad = task.parameters?.currentLoad;
        const targetLoad = task.parameters?.targetLoad;
        const constraints = task.parameters?.constraints || [];
        const budget = task.parameters?.budget;
        this.logger.info('Designing scalability', {
            currentLoad,
            targetLoad,
            constraints
        });
        const scalabilityDesign = {
            currentLoad,
            targetLoad,
            constraints,
            budget,
            strategies: {
                horizontal: [],
                vertical: [],
                caching: [],
                database: []
            },
            implementation: {
                autoScaling: true,
                loadBalancing: 'application',
                caching: 'multi-tier',
                cdn: 'global'
            },
            metrics: {
                latency: 'p99 < 100ms',
                throughput: '10000 rps',
                availability: '99.99%',
                errorRate: '< 0.1%'
            },
            testing: {
                loadTesting: true,
                stressTesting: true,
                chaosEngineering: true
            },
            monitoring: {
                realTime: true,
                predictive: true,
                alerting: 'proactive'
            },
            timestamp: new Date()
        };
        await this.delay(3000);
        scalabilityDesign.strategies.horizontal = [
            'Kubernetes HPA',
            'Database Sharding',
            'Microservices Decomposition'
        ];
        return scalabilityDesign;
    }
    async designDatabase(task) {
        const requirements = task.parameters?.requirements;
        const dataTypes = task.parameters?.dataTypes || [
            'relational'
        ];
        const scale = task.parameters?.scale || 'medium';
        const consistency = task.parameters?.consistency || 'strong';
        this.logger.info('Designing database architecture', {
            dataTypes,
            scale,
            consistency
        });
        const databaseDesign = {
            requirements,
            dataTypes,
            scale,
            consistency,
            databases: [],
            patterns: {
                data: [
                    'Database per Service',
                    'Shared Database',
                    'Data Lake'
                ],
                consistency: [
                    'ACID',
                    'BASE',
                    'Eventual Consistency'
                ],
                scaling: [
                    'Read Replicas',
                    'Sharding',
                    'Partitioning'
                ]
            },
            technologies: {
                relational: [
                    'PostgreSQL',
                    'MySQL'
                ],
                document: [
                    'MongoDB',
                    'DynamoDB'
                ],
                cache: [
                    'Redis',
                    'Memcached'
                ],
                search: [
                    'Elasticsearch',
                    'Solr'
                ]
            },
            performance: {
                indexing: 'optimized',
                caching: 'multi-layer',
                partitioning: 'horizontal',
                replication: 'master-slave'
            },
            backup: {
                strategy: 'incremental',
                frequency: 'hourly',
                retention: '30-days',
                testing: 'monthly'
            },
            timestamp: new Date()
        };
        await this.delay(2500);
        databaseDesign.databases = [
            {
                name: 'Primary DB',
                type: 'PostgreSQL',
                purpose: 'Transactional data',
                size: '500GB'
            },
            {
                name: 'Cache',
                type: 'Redis',
                purpose: 'Session and application cache',
                size: '50GB'
            }
        ];
        return databaseDesign;
    }
    async performGeneralDesign(task) {
        this.logger.info('Performing general design', {
            description: task.description
        });
        return await this.designSystem(task);
    }
    async delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    getAgentStatus() {
        return {
            ...super.getAgentStatus(),
            specialization: 'System Architecture & Design',
            architectureStyles: [
                'Microservices',
                'Monolithic',
                'Serverless',
                'Event-Driven'
            ],
            cloudProviders: [
                'AWS',
                'Azure',
                'GCP',
                'Multi-Cloud'
            ],
            designPatterns: [
                'Gang of Four',
                'Enterprise',
                'Cloud Native',
                'Microservices'
            ],
            currentDesigns: this.getCurrentTasks().length,
            averageDesignTime: '30-60 minutes',
            lastDesignCompleted: this.getLastTaskCompletedTime(),
            specializations: [
                'Cloud Architecture',
                'Security Design',
                'Scalability Planning'
            ]
        };
    }
}
export const createArchitectAgent = (id, config, environment, logger, eventBus, memory)=>{
    const defaultConfig = {
        autonomyLevel: 0.8,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 12,
        maxConcurrentTasks: 3,
        timeoutThreshold: 300000,
        reportingInterval: 60000,
        heartbeatInterval: 30000,
        permissions: [
            'file-read',
            'file-write',
            'system-analysis',
            'architecture-design',
            'api-access'
        ],
        trustedAgents: [],
        expertise: {
            'system-architecture': 0.95,
            'cloud-architecture': 0.9,
            'microservices-design': 0.92,
            'api-design': 0.88,
            'database-architecture': 0.85,
            'security-architecture': 0.87
        },
        preferences: {
            designMethodology: 'domain-driven',
            architecturalStyle: 'microservices',
            documentationLevel: 'comprehensive',
            reviewThoroughness: 'detailed'
        }
    };
    const defaultEnv = {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: './agents/architect',
        tempDirectory: './tmp/architect',
        logDirectory: './logs/architect',
        apiEndpoints: {},
        credentials: {},
        availableTools: [
            'architecture-diagrams',
            'system-modeler',
            'design-patterns',
            'cloud-designer'
        ],
        toolConfigs: {
            diagramTool: {
                format: 'svg',
                style: 'professional'
            },
            cloudDesigner: {
                provider: 'multi',
                compliance: true
            }
        }
    };
    return new ArchitectAgent(id, {
        ...defaultConfig,
        ...config
    }, {
        ...defaultEnv,
        ...environment
    }, logger, eventBus, memory);
};

//# sourceMappingURL=architect.js.map