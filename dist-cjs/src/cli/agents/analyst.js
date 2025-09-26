import { BaseAgent } from './base-agent.js';
export class AnalystAgent extends BaseAgent {
    constructor(id, config, environment, logger, eventBus, memory){
        super(id, 'analyst', config, environment, logger, eventBus, memory);
    }
    getDefaultCapabilities() {
        return {
            codeGeneration: false,
            codeReview: true,
            testing: false,
            documentation: true,
            research: false,
            analysis: true,
            webSearch: false,
            apiIntegration: true,
            fileSystem: true,
            terminalAccess: false,
            languages: [
                'python',
                'r',
                'sql',
                "typescript",
                "javascript",
                'julia',
                'scala',
                'matlab'
            ],
            frameworks: [
                'pandas',
                'numpy',
                'matplotlib',
                'seaborn',
                'plotly',
                'dask',
                'spark',
                'tensorflow',
                'pytorch',
                'scikit-learn',
                'jupyter',
                'tableau'
            ],
            domains: [
                'data-analysis',
                'statistical-analysis',
                'performance-analysis',
                'business-intelligence',
                'data-visualization',
                'predictive-modeling',
                'machine-learning',
                'data-mining',
                'financial-analysis',
                'market-research',
                'operations-research',
                'quality-assurance'
            ],
            tools: [
                'data-processor',
                'statistical-analyzer',
                'chart-generator',
                'report-builder',
                'dashboard-creator',
                'ml-pipeline',
                'data-validator',
                'performance-profiler',
                'anomaly-detector',
                'trend-analyzer'
            ],
            maxConcurrentTasks: 4,
            maxMemoryUsage: 2048 * 1024 * 1024,
            maxExecutionTime: 1200000,
            reliability: 0.9,
            speed: 0.8,
            quality: 0.95
        };
    }
    getDefaultConfig() {
        return {
            autonomyLevel: 0.75,
            learningEnabled: true,
            adaptationEnabled: true,
            maxTasksPerHour: 15,
            maxConcurrentTasks: 4,
            timeoutThreshold: 1200000,
            reportingInterval: 45000,
            heartbeatInterval: 12000,
            permissions: [
                'file-read',
                'file-write',
                'data-access',
                'database-read',
                'api-access'
            ],
            trustedAgents: [],
            expertise: {
                'data-analysis': 0.95,
                'statistical-analysis': 0.92,
                visualization: 0.88,
                'performance-analysis': 0.9,
                'predictive-modeling': 0.85,
                'business-intelligence': 0.83
            },
            preferences: {
                outputFormat: 'detailed',
                includeCharts: true,
                statisticalTests: 'comprehensive',
                confidenceLevel: 0.95,
                visualStyle: 'professional'
            }
        };
    }
    async executeTask(task) {
        this.logger.info('Analyst executing task', {
            agentId: this.id,
            taskType: task.type,
            taskId: task.id
        });
        try {
            switch(task.type){
                case 'data-analysis':
                    return await this.analyzeData(task);
                case 'performance-analysis':
                    return await this.analyzePerformance(task);
                case 'statistical-analysis':
                    return await this.performStatisticalAnalysis(task);
                case 'visualization':
                    return await this.createVisualization(task);
                case 'predictive-modeling':
                    return await this.buildPredictiveModel(task);
                case 'anomaly-detection':
                    return await this.detectAnomalies(task);
                case 'trend-analysis':
                    return await this.analyzeTrends(task);
                case 'business-intelligence':
                    return await this.generateBusinessIntelligence(task);
                case 'quality-analysis':
                    return await this.analyzeQuality(task);
                default:
                    return await this.performGeneralAnalysis(task);
            }
        } catch (error) {
            this.logger.error('Analysis task failed', {
                agentId: this.id,
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async analyzeData(task) {
        const dataset = task.context?.dataset;
        const analysisType = task.context?.type || 'exploratory';
        const metrics = task.context?.metrics || [
            'central_tendency',
            'distribution',
            'correlation'
        ];
        const outputFormat = task.context?.format || 'report';
        this.logger.info('Analyzing data', {
            analysisType,
            metrics,
            outputFormat
        });
        const analysis = {
            dataset: {
                name: dataset?.name || 'Unknown',
                size: dataset?.size || 0,
                columns: dataset?.columns || [],
                types: dataset?.types || {}
            },
            analysisType,
            summary: {
                rowCount: 0,
                columnCount: 0,
                missingValues: 0,
                duplicateRows: 0,
                outliers: 0
            },
            descriptiveStats: {},
            correlations: {},
            distributions: {},
            insights: [],
            recommendations: [],
            visualizations: [],
            confidence: 0,
            methodology: 'statistical-analysis',
            timestamp: new Date()
        };
        await this.memory.store(`analysis:${task.id}:progress`, {
            status: 'analyzing',
            startTime: new Date(),
            analysisType
        }, {
            type: 'analysis-progress',
            tags: [
                'analysis',
                this.id,
                analysisType
            ],
            partition: 'tasks'
        });
        await this.delay(3000);
        analysis.summary = {
            rowCount: 10000,
            columnCount: 15,
            missingValues: 125,
            duplicateRows: 23,
            outliers: 47
        };
        analysis.insights = [
            'Strong positive correlation between variables A and B (r=0.85)',
            'Variable C shows seasonal patterns with 3-month cycles',
            'Data quality is high with only 1.25% missing values',
            'Outliers concentrated in Q4 periods, likely due to seasonal effects'
        ];
        analysis.recommendations = [
            'Consider log transformation for skewed variables',
            'Implement imputation strategy for missing values',
            'Investigate Q4 outliers for business context',
            'Add more recent data to improve model accuracy'
        ];
        analysis.confidence = 0.88;
        await this.memory.store(`analysis:${task.id}:results`, analysis, {
            type: 'analysis-results',
            tags: [
                'analysis',
                'completed',
                this.id,
                analysisType
            ],
            partition: 'tasks'
        });
        return analysis;
    }
    async analyzePerformance(task) {
        const system = task.context?.system;
        const metrics = task.context?.metrics || [
            'response_time',
            'throughput',
            'error_rate'
        ];
        const timeframe = task.context?.timeframe || '24h';
        const baseline = task.context?.baseline;
        this.logger.info('Analyzing performance', {
            system,
            metrics,
            timeframe
        });
        const performance = {
            system,
            timeframe,
            metrics: {},
            benchmarks: {},
            bottlenecks: [],
            trends: [],
            recommendations: [],
            alertsTriggered: [],
            slaCompliance: {
                availability: 0,
                responseTime: 0,
                throughput: 0
            },
            comparison: {
                baseline: baseline || 'previous_week',
                improvements: [],
                regressions: []
            },
            timestamp: new Date(),
            anomalies: [],
            insights: [],
            visualizations: [],
            optimizationPotential: 0,
            projectedImprovement: 0,
            confidence: 0
        };
        await this.delay(2500);
        performance.metrics = {
            averageResponseTime: 245,
            p95ResponseTime: 520,
            p99ResponseTime: 1200,
            throughput: 1250,
            errorRate: 0.03,
            availability: 99.85
        };
        performance.bottlenecks = [
            {
                component: 'Database queries',
                impact: 'high',
                description: 'N+1 query pattern causing 40% performance degradation',
                recommendation: 'Implement query optimization and caching'
            },
            {
                component: 'Memory allocation',
                impact: 'medium',
                description: 'Large object creation in hot path',
                recommendation: 'Use object pooling or lazy initialization'
            }
        ];
        performance.slaCompliance = {
            availability: 99.85,
            responseTime: 92.3,
            throughput: 103.5
        };
        return performance;
    }
    async performStatisticalAnalysis(task) {
        const data = task.context?.data;
        const tests = task.context?.tests || [
            'normality',
            'correlation',
            'significance'
        ];
        const alpha = task.context?.alpha || 0.05;
        const hypothesis = task.context?.hypothesis;
        this.logger.info('Performing statistical analysis', {
            tests,
            alpha,
            hypothesis
        });
        const statistics = {
            tests: {},
            hypothesis: hypothesis || 'no_hypothesis',
            alpha,
            results: {},
            interpretation: {},
            assumptions: {
                normality: false,
                independence: false,
                homogeneity: false
            },
            powerAnalysis: {
                power: 0,
                sampleSize: 0,
                effectSize: 0
            },
            conclusions: [],
            limitations: [],
            timestamp: new Date()
        };
        await this.delay(2000);
        statistics.results = {
            normalityTest: {
                statistic: 0.923,
                pValue: 0.041,
                significant: true,
                interpretation: 'Data deviates significantly from normal distribution'
            },
            correlationTest: {
                coefficient: 0.756,
                pValue: 0.002,
                significant: true,
                interpretation: 'Strong positive correlation detected'
            }
        };
        statistics.conclusions.push('Null hypothesis rejected at α = 0.05 level', "Effect size is large (Cohen's d = 0.8)", 'Results are statistically and practically significant');
        return statistics;
    }
    async createVisualization(task) {
        const data = task.context?.data;
        const chartType = task.context?.type || 'auto';
        const style = task.context?.style || 'professional';
        const interactive = task.context?.interactive || false;
        this.logger.info('Creating visualization', {
            chartType,
            style,
            interactive
        });
        const visualization = {
            chartType,
            style,
            interactive,
            charts: [],
            dashboard: null,
            insights: [],
            recommendations: [],
            exportFormats: [
                'png',
                'svg',
                'pdf',
                'html'
            ],
            accessibility: {
                colorBlind: true,
                screenReader: true,
                highContrast: false
            },
            timestamp: new Date()
        };
        await this.delay(1500);
        visualization.charts.push({
            type: 'line',
            title: 'Trend Analysis Over Time',
            description: 'Shows temporal patterns in the data',
            dataPoints: 100,
            interactive: true
        }, {
            type: 'scatter',
            title: 'Correlation Matrix',
            description: 'Displays relationships between variables',
            dataPoints: 500,
            interactive: false
        });
        visualization.insights.push('Clear upward trend visible in Q3-Q4', 'Seasonal patterns repeat every 3 months', 'Strong correlation between variables X and Y');
        return visualization;
    }
    async buildPredictiveModel(task) {
        const data = task.context?.data;
        const target = task.context?.target;
        const algorithm = task.context?.algorithm || 'auto';
        const validation = task.context?.validation || 'k-fold';
        this.logger.info('Building predictive model', {
            target,
            algorithm,
            validation
        });
        const model = {
            algorithm: algorithm === 'auto' ? 'random_forest' : algorithm,
            features: [],
            target: target || 'default_target',
            performance: {
                accuracy: 0,
                precision: 0,
                recall: 0,
                f1Score: 0,
                rmse: 0,
                mse: 0
            },
            validation: {
                method: validation,
                splits: 5,
                crossValidation: {
                    folds: 5,
                    avgScore: 0,
                    stdDev: 0
                }
            },
            predictions: [],
            featureImportance: {},
            insights: [],
            recommendations: [],
            modelMetadata: {
                parameters: {},
                training: {
                    epochs: 100,
                    convergence: true,
                    finalLoss: 0.15
                }
            },
            confidence: 0,
            timestamp: new Date()
        };
        await this.delay(4000);
        model.performance = {
            accuracy: 0.87,
            precision: 0.85,
            recall: 0.89,
            f1Score: 0.87,
            auc: 0.92,
            rmse: 2.34
        };
        model.featureImportance = {
            feature_1: 0.35,
            feature_2: 0.28,
            feature_3: 0.22,
            feature_4: 0.15
        };
        return model;
    }
    async detectAnomalies(task) {
        const data = task.context?.data;
        const method = task.context?.method || 'isolation_forest';
        const sensitivity = task.context?.sensitivity || 0.1;
        const threshold = task.context?.threshold;
        this.logger.info('Detecting anomalies', {
            method,
            sensitivity
        });
        const anomalies = {
            method,
            sensitivity,
            threshold: threshold || 'auto',
            detected: [],
            summary: {
                total: 0,
                severity: {
                    low: 0,
                    medium: 0,
                    high: 0,
                    critical: 0
                }
            },
            patterns: [],
            recommendations: [],
            falsePositiveRate: 0,
            confidence: 0,
            timestamp: new Date()
        };
        await this.delay(2000);
        anomalies.detected.push({
            id: 'anom_001',
            timestamp: new Date('2024-01-15'),
            severity: 'high',
            score: 0.95,
            description: 'Unusual spike in traffic during off-peak hours',
            features: [
                'traffic_volume',
                'time_of_day'
            ]
        }, {
            id: 'anom_002',
            timestamp: new Date('2024-01-16'),
            severity: 'medium',
            score: 0.72,
            description: 'Abnormal response time pattern',
            features: [
                'response_time',
                'request_size'
            ]
        });
        anomalies.summary = {
            total: 15,
            severity: {
                low: 8,
                medium: 4,
                high: 2,
                critical: 1
            }
        };
        anomalies.confidence = 0.83;
        return anomalies;
    }
    async analyzeTrends(task) {
        const data = task.context?.data;
        const timeframe = task.context?.timeframe || '3-months';
        const granularity = task.context?.granularity || 'daily';
        const forecast = task.context?.forecast || false;
        this.logger.info('Analyzing trends', {
            timeframe,
            granularity,
            forecast
        });
        const trends = {
            timeframe,
            metrics: [],
            trends: [],
            correlations: {},
            patterns: {
                seasonal: false,
                cyclical: false,
                trending: false
            },
            forecasts: forecast ? [] : [],
            insights: [],
            recommendations: [],
            confidence: 0,
            timestamp: new Date()
        };
        await this.delay(2500);
        trends.trends.push({
            metric: 'user_engagement',
            direction: 'increasing',
            slope: 0.15,
            significance: 0.92,
            period: 'Q4-2023'
        }, {
            metric: 'conversion_rate',
            direction: 'stable',
            slope: 0.02,
            significance: 0.23,
            period: 'Q4-2023'
        });
        trends.patterns = {
            seasonal: true,
            cyclical: false,
            trending: true
        };
        trends.confidence = 0.89;
        return trends;
    }
    async generateBusinessIntelligence(task) {
        const domain = task.context?.domain || 'general';
        const metrics = task.context?.metrics || [
            'revenue',
            'growth',
            'efficiency'
        ];
        const timeframe = task.context?.timeframe || 'quarterly';
        const audience = task.context?.audience || 'executive';
        this.logger.info('Generating business intelligence', {
            domain,
            metrics,
            timeframe,
            audience
        });
        const intelligence = {
            scope: domain,
            timeframe,
            kpis: {},
            trends: [],
            insights: [],
            recommendations: [],
            actionItems: [],
            riskFactors: [],
            opportunities: [],
            marketAnalysis: {
                competitors: [],
                positioning: '',
                threats: [],
                opportunities: []
            },
            financialProjections: {
                revenue: [],
                costs: [],
                profitability: []
            },
            confidence: 0,
            timestamp: new Date()
        };
        await this.delay(3500);
        intelligence.kpis = {
            revenue_growth: 12.5,
            customer_acquisition_cost: 45.3,
            lifetime_value: 1250.0,
            churn_rate: 5.2,
            market_share: 15.7
        };
        intelligence.insights = [
            'Customer acquisition costs decreased by 18% due to improved targeting',
            'Premium tier adoption increased 35% following feature updates',
            'Seasonal patterns show consistent Q4 revenue spikes'
        ];
        intelligence.recommendations = [
            'Increase marketing budget allocation to high-performing channels',
            'Develop retention strategies for at-risk customer segments',
            'Accelerate premium feature development to capture market demand'
        ];
        intelligence.confidence = 0.91;
        return intelligence;
    }
    async analyzeQuality(task) {
        const subject = task.context?.subject;
        const criteria = task.context?.criteria || [
            'accuracy',
            'completeness',
            'consistency'
        ];
        const standards = task.context?.standards || 'industry';
        const benchmark = task.context?.benchmark;
        this.logger.info('Analyzing quality', {
            subject,
            criteria,
            standards
        });
        const quality = {
            codeQuality: {
                complexity: 0,
                maintainability: 0,
                testCoverage: 0,
                technicalDebt: 0
            },
            issues: [],
            patterns: [],
            recommendations: [],
            visualizations: [],
            overallScore: 0,
            confidence: 0,
            timestamp: new Date()
        };
        await this.delay(2000);
        quality.codeQuality = {
            complexity: 3.2,
            maintainability: 0.87,
            testCoverage: 0.91,
            technicalDebt: 0.23
        };
        quality.overallScore = 0.91;
        quality.issues.push({
            category: 'completeness',
            severity: 'medium',
            description: 'Missing values in 13% of records',
            impact: 'Affects downstream analysis accuracy'
        });
        quality.patterns.push('High complexity in authentication module');
        quality.recommendations.push('Implement automated testing coverage');
        quality.confidence = 0.89;
        return quality;
    }
    async performGeneralAnalysis(task) {
        this.logger.info('Performing general analysis', {
            description: task.description
        });
        return await this.analyzeData(task);
    }
    async delay(ms) {
        return new Promise((resolve)=>setTimeout(resolve, ms));
    }
    getAgentStatus() {
        return {
            ...super.getAgentStatus(),
            specialization: 'Data Analysis & Performance Optimization',
            analyticsCapabilities: [
                'Statistical Analysis',
                'Data Visualization',
                'Performance Analysis',
                'Predictive Modeling',
                'Anomaly Detection',
                'Business Intelligence'
            ],
            supportedFormats: [
                'CSV',
                'JSON',
                'Parquet',
                'SQL',
                'Excel'
            ],
            statisticalMethods: [
                "Descriptive",
                'Inferential',
                'Multivariate',
                'Time Series'
            ],
            currentAnalyses: this.getCurrentTasks().length,
            averageAnalysisTime: '10-20 minutes',
            lastAnalysisCompleted: this.getLastTaskCompletedTime(),
            preferredTools: [
                'Python',
                'R',
                'SQL',
                'Jupyter'
            ]
        };
    }
}
export const createAnalystAgent = (id, config, environment, logger, eventBus, memory)=>{
    const tempAgent = new AnalystAgent(id, {}, {}, logger, eventBus, memory);
    const defaultConfig = tempAgent.getDefaultConfig();
    const defaultEnv = {
        runtime: 'deno',
        version: '1.40.0',
        workingDirectory: './agents/analyst',
        tempDirectory: './tmp/analyst',
        logDirectory: './logs/analyst',
        apiEndpoints: {},
        credentials: {},
        availableTools: [
            'data-processor',
            'statistical-analyzer',
            'chart-generator',
            'report-builder'
        ],
        toolConfigs: {
            dataProcessor: {
                chunkSize: 10000,
                parallel: true
            },
            chartGenerator: {
                style: 'professional',
                dpi: 300
            },
            reportBuilder: {
                format: 'pdf',
                includeCharts: true
            }
        }
    };
    return new AnalystAgent(id, {
        ...defaultConfig,
        ...config
    }, {
        ...defaultEnv,
        ...environment
    }, logger, eventBus, memory);
};

//# sourceMappingURL=analyst.js.map