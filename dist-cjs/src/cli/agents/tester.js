import { BaseAgent } from './base-agent.js';
export class TesterAgent extends BaseAgent {
    constructor(id, config, environment, logger, eventBus, memory){
        super(id, 'tester', config, environment, logger, eventBus, memory);
    }
    getDefaultCapabilities() {
        return {
            codeGeneration: true,
            codeReview: true,
            testing: true,
            documentation: true,
            research: false,
            analysis: true,
            webSearch: false,
            apiIntegration: true,
            fileSystem: true,
            terminalAccess: true,
            languages: [
                "typescript",
                "javascript",
                'python',
                'java',
                'csharp',
                'go'
            ],
            frameworks: [
                'jest',
                'mocha',
                'cypress',
                'playwright',
                'selenium',
                'pytest',
                'junit',
                'testng'
            ],
            domains: [
                'unit-testing',
                'integration-testing',
                'e2e-testing',
                'performance-testing',
                'security-testing',
                'accessibility-testing',
                'api-testing',
                'mobile-testing',
                'load-testing',
                'test-automation'
            ],
            tools: [
                'test-runner',
                'coverage-analyzer',
                'mock-generator',
                'test-data-factory',
                'assertion-library',
                'browser-automation',
                'api-tester',
                'performance-profiler'
            ],
            maxConcurrentTasks: 4,
            maxMemoryUsage: 1024 * 1024 * 1024,
            maxExecutionTime: 1800000,
            reliability: 0.95,
            speed: 0.8,
            quality: 0.95
        };
    }
    getDefaultConfig() {
        return {
            autonomyLevel: 0.8,
            learningEnabled: true,
            adaptationEnabled: true,
            maxTasksPerHour: 16,
            maxConcurrentTasks: 4,
            timeoutThreshold: 1800000,
            reportingInterval: 30000,
            heartbeatInterval: 12000,
            permissions: [
                'file-read',
                'file-write',
                'terminal-access',
                'browser-control',
                'network-access'
            ],
            trustedAgents: [],
            expertise: {
                'unit-testing': 0.95,
                'integration-testing': 0.9,
                'e2e-testing': 0.88,
                'test-automation': 0.92,
                'performance-testing': 0.85,
                'security-testing': 0.8
            },
            preferences: {
                testFramework: 'jest',
                coverageThreshold: 80,
                testStrategy: 'pyramid',
                mockingStyle: 'minimal',
                reportFormat: 'detailed'
            }
        };
    }
    async executeTask(task) {
        this.logger.info('Tester executing task', {
            agentId: this.id,
            taskType: task.type,
            taskId: task.id
        });
        try {
            switch(task.type){
                case 'unit-testing':
                    return await this.createUnitTests(task);
                case 'integration-testing':
                    return await this.createIntegrationTests(task);
                case 'e2e-testing':
                    return await this.createE2ETests(task);
                case 'performance-testing':
                    return await this.performanceTest(task);
                case 'security-testing':
                    return await this.securityTest(task);
                case 'api-testing':
                    return await this.testAPI(task);
                case 'test-automation':
                    return await this.automateTests(task);
                case 'test-analysis':
                    return await this.analyzeTests(task);
                default:
                    return await this.performGeneralTesting(task);
            }
        } catch (error) {
            this.logger.error('Testing task failed', {
                agentId: this.id,
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async createUnitTests(task) {
        const code = task.input?.code;
        const framework = task.input?.framework || 'jest';
        const coverage = task.input?.coverage || 80;
        const style = task.input?.style || 'arrange-act-assert';
        this.logger.info('Creating unit tests', {
            framework,
            coverage,
            style
        });
        const testing = {
            framework,
            style,
            targetCoverage: coverage,
            testFiles: [],
            testSuites: [],
            coverage: {
                lines: 0,
                functions: 0,
                branches: 0,
                statements: 0
            },
            mocks: [],
            assertions: [],
            setup: {
                beforeEach: true,
                afterEach: true,
                fixtures: []
            },
            timestamp: new Date()
        };
        await this.delay(2000);
        testing.testFiles = [
            {
                path: 'tests/unit/user.test.ts',
                testCount: 15,
                coverage: 92
            },
            {
                path: 'tests/unit/auth.test.ts',
                testCount: 8,
                coverage: 88
            }
        ];
        testing.coverage = {
            lines: 87,
            functions: 92,
            branches: 78,
            statements: 89
        };
        return testing;
    }
    async createIntegrationTests(task) {
        const components = task.input?.components || [];
        const database = task.input?.database || false;
        const api = task.input?.api || false;
        const framework = task.input?.framework || 'jest';
        this.logger.info('Creating integration tests', {
            components: components.length,
            database,
            api,
            framework
        });
        const integration = {
            framework,
            components,
            database,
            api,
            testSuites: [],
            environment: {
                setup: 'docker-compose',
                database: 'test-db',
                services: []
            },
            scenarios: [],
            dataFlow: [],
            assertions: [],
            timestamp: new Date()
        };
        await this.delay(3000);
        integration.scenarios = [
            {
                name: 'User registration flow',
                steps: [
                    'Create user',
                    'Send email',
                    'Verify account'
                ],
                assertions: [
                    'User created',
                    'Email sent',
                    'Account active'
                ]
            },
            {
                name: 'Order processing flow',
                steps: [
                    'Create order',
                    'Process payment',
                    'Update inventory'
                ],
                assertions: [
                    'Order confirmed',
                    'Payment processed',
                    'Stock updated'
                ]
            }
        ];
        return integration;
    }
    async createE2ETests(task) {
        const userJourneys = task.input?.userJourneys || [];
        const browser = task.input?.browser || 'chromium';
        const framework = task.input?.framework || 'playwright';
        const viewport = task.input?.viewport || 'desktop';
        this.logger.info('Creating E2E tests', {
            userJourneys: userJourneys.length,
            browser,
            framework,
            viewport
        });
        const e2e = {
            framework,
            browser,
            viewport,
            userJourneys,
            testScenarios: [],
            pageObjects: [],
            selectors: [],
            assertions: [],
            configuration: {
                headless: true,
                screenshots: true,
                videos: false,
                retries: 2
            },
            crossBrowser: {
                chrome: true,
                firefox: true,
                safari: false
            },
            timestamp: new Date()
        };
        await this.delay(4000);
        e2e.testScenarios = [
            {
                name: 'User login and dashboard access',
                steps: [
                    'Navigate to login page',
                    'Enter credentials',
                    'Click login button',
                    'Verify dashboard loads'
                ],
                expected: 'User successfully logged in and sees dashboard'
            }
        ];
        return e2e;
    }
    async performanceTest(task) {
        const target = task.input?.target;
        const loadPattern = task.input?.loadPattern || 'ramp-up';
        const duration = task.input?.duration || '5m';
        const virtualUsers = task.input?.virtualUsers || 100;
        this.logger.info('Performing performance test', {
            target,
            loadPattern,
            duration,
            virtualUsers
        });
        const performance = {
            target,
            loadPattern,
            duration,
            virtualUsers,
            metrics: {
                responseTime: {
                    avg: 0,
                    p95: 0,
                    p99: 0,
                    max: 0
                },
                throughput: 0,
                errorRate: 0,
                resourceUtilization: {
                    cpu: 0,
                    memory: 0,
                    network: 0
                }
            },
            bottlenecks: [],
            recommendations: [],
            slaCompliance: {
                responseTime: false,
                throughput: false,
                errorRate: false
            },
            timestamp: new Date()
        };
        await this.delay(6000);
        performance.metrics = {
            responseTime: {
                avg: 245,
                p95: 520,
                p99: 1200,
                max: 2500
            },
            throughput: 1250,
            errorRate: 0.03,
            resourceUtilization: {
                cpu: 75,
                memory: 68,
                network: 45
            }
        };
        return performance;
    }
    async securityTest(task) {
        const target = task.input?.target;
        const testTypes = task.input?.types || [
            'authentication',
            'authorization',
            'injection'
        ];
        const severity = task.input?.severity || 'all';
        this.logger.info('Performing security test', {
            target,
            testTypes,
            severity
        });
        const security = {
            target,
            testTypes,
            severity,
            vulnerabilities: [],
            compliance: {
                owasp: [],
                gdpr: [],
                pci: []
            },
            penetrationTests: [],
            recommendations: [],
            riskLevel: 'unknown',
            timestamp: new Date()
        };
        await this.delay(5000);
        security.vulnerabilities = [
            {
                type: 'SQL Injection',
                severity: 'high',
                location: '/api/users/search',
                description: 'Input not properly sanitized',
                impact: 'Data breach potential'
            }
        ];
        security.riskLevel = 'medium';
        return security;
    }
    async testAPI(task) {
        const endpoints = task.input?.endpoints || [];
        const authentication = task.input?.auth || false;
        const environment = task.input?.environment || 'staging';
        this.logger.info('Testing API', {
            endpoints: endpoints.length,
            authentication,
            environment
        });
        const apiTest = {
            environment,
            authentication,
            endpoints,
            testResults: [],
            schemas: [],
            responseValidation: true,
            errorHandling: [],
            performance: {
                averageResponseTime: 0,
                slowestEndpoint: '',
                fastestEndpoint: ''
            },
            coverage: {
                endpoints: 0,
                statusCodes: [],
                errorScenarios: 0
            },
            timestamp: new Date()
        };
        await this.delay(3000);
        apiTest.testResults = [
            {
                endpoint: 'GET /api/users',
                status: 'passed',
                responseTime: 150,
                statusCode: 200
            },
            {
                endpoint: 'POST /api/users',
                status: 'failed',
                responseTime: 300,
                statusCode: 500,
                error: 'Internal server error'
            }
        ];
        return apiTest;
    }
    async automateTests(task) {
        const testSuite = task.input?.testSuite;
        const pipeline = task.input?.pipeline || 'ci/cd';
        const triggers = task.input?.triggers || [
            'commit',
            'pr'
        ];
        this.logger.info('Automating tests', {
            testSuite,
            pipeline,
            triggers
        });
        const automation = {
            testSuite,
            pipeline,
            triggers,
            configuration: {
                parallel: true,
                retries: 2,
                timeout: '30m',
                artifacts: [
                    'reports',
                    'screenshots'
                ]
            },
            environments: [
                'staging',
                'production'
            ],
            notifications: {
                slack: true,
                email: true,
                github: true
            },
            reporting: {
                format: 'junit',
                coverage: true,
                trends: true
            },
            timestamp: new Date()
        };
        await this.delay(2000);
        return automation;
    }
    async analyzeTests(task) {
        const testResults = task.input?.results;
        const coverage = task.input?.coverage;
        const timeframe = task.input?.timeframe || '7d';
        this.logger.info('Analyzing tests', {
            timeframe
        });
        const analysis = {
            timeframe,
            summary: {
                totalTests: 0,
                passed: 0,
                failed: 0,
                skipped: 0,
                flaky: 0
            },
            trends: {
                passRate: [],
                executionTime: [],
                coverage: []
            },
            flakyTests: [],
            slowTests: [],
            recommendations: [],
            insights: [],
            timestamp: new Date()
        };
        await this.delay(1500);
        analysis.summary = {
            totalTests: 245,
            passed: 230,
            failed: 10,
            skipped: 5,
            flaky: 3
        };
        analysis.insights = [
            'Test execution time increased by 15% this week',
            'Coverage decreased in auth module',
            '3 tests are consistently flaky and need attention'
        ];
        return analysis;
    }
    async performGeneralTesting(task) {
        this.logger.info('Performing general testing', {
            description: task.description
        });
        return await this.createUnitTests(task);
    }
    async delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    getAgentStatus() {
        return {
            ...super.getAgentStatus(),
            specialization: 'Testing & Quality Assurance',
            testingTypes: [
                'Unit Testing',
                'Integration Testing',
                'E2E Testing',
                'Performance Testing',
                'Security Testing',
                'API Testing'
            ],
            frameworks: this.capabilities.frameworks,
            currentTests: this.getCurrentTasks().length,
            averageTestTime: '15-30 minutes',
            lastTestCompleted: this.getLastTaskCompletedTime(),
            testCoverageGoal: this.config.preferences?.coverageThreshold || 80
        };
    }
}
export const createTesterAgent = (id, config, environment, logger, eventBus, memory)=>{
    const defaultConfig = {
        autonomyLevel: 0.7,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 8,
        maxConcurrentTasks: 2,
        timeoutThreshold: 900000,
        reportingInterval: 180000,
        heartbeatInterval: 60000,
        permissions: [
            'test-execution',
            'code-access',
            'system-access',
            'browser-automation',
            'security-testing'
        ],
        trustedAgents: [],
        expertise: {
            'unit-testing': 0.95,
            'integration-testing': 0.92,
            'e2e-testing': 0.9,
            'performance-testing': 0.88,
            'security-testing': 0.85,
            'api-testing': 0.9
        },
        preferences: {
            testingApproach: 'comprehensive',
            coverageThreshold: 85,
            testingFramework: 'jest',
            automationLevel: 'high'
        }
    };
    const defaultEnv = {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: './agents/tester',
        tempDirectory: './tmp/tester',
        logDirectory: './logs/tester',
        apiEndpoints: {},
        credentials: {},
        availableTools: [
            'test-runner',
            'coverage-analyzer',
            'browser-automation',
            'api-tester'
        ],
        toolConfigs: {
            testRunner: {
                framework: 'jest',
                coverage: true
            },
            browser: {
                headless: true,
                screenshots: true
            }
        }
    };
    return new TesterAgent(id, {
        ...defaultConfig,
        ...config
    }, {
        ...defaultEnv,
        ...environment
    }, logger, eventBus, memory);
};

//# sourceMappingURL=tester.js.map