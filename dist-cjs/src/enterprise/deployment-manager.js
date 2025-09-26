import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, readdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { Logger } from '../core/logger.js';
import { ConfigManager } from '../core/config.js';
export class DeploymentManager extends EventEmitter {
    deployments = new Map();
    environments = new Map();
    strategies = new Map();
    pipelines = new Map();
    activeProcesses = new Map();
    deploymentsPath;
    logger;
    config;
    constructor(deploymentsPath = './deployments', logger, config){
        super();
        this.deploymentsPath = deploymentsPath;
        this.logger = logger || new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        });
        this.config = config || ConfigManager.getInstance();
    }
    async initialize() {
        try {
            await mkdir(this.deploymentsPath, {
                recursive: true
            });
            await mkdir(join(this.deploymentsPath, 'environments'), {
                recursive: true
            });
            await mkdir(join(this.deploymentsPath, 'strategies'), {
                recursive: true
            });
            await mkdir(join(this.deploymentsPath, 'pipelines'), {
                recursive: true
            });
            await this.loadConfigurations();
            await this.initializeDefaultStrategies();
            this.logger.info('Deployment Manager initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize Deployment Manager', {
                error
            });
            throw error;
        }
    }
    async createEnvironment(environmentData) {
        const environment = {
            id: environmentData.id || `env-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: environmentData.name || 'Unnamed Environment',
            type: environmentData.type || 'development',
            status: 'inactive',
            configuration: {
                region: 'us-east-1',
                provider: 'aws',
                endpoints: [],
                secrets: {},
                environment_variables: {},
                resources: {
                    cpu: '1',
                    memory: '1Gi',
                    storage: '10Gi',
                    replicas: 1
                },
                ...environmentData.configuration
            },
            healthCheck: {
                url: '/health',
                method: 'GET',
                expectedStatus: 200,
                timeout: 30000,
                interval: 60000,
                retries: 3,
                ...environmentData.healthCheck
            },
            monitoring: {
                enabled: true,
                alerts: [],
                metrics: [
                    'cpu',
                    'memory',
                    'requests',
                    'errors'
                ],
                logs: {
                    level: 'info',
                    retention: '30d',
                    aggregation: true
                },
                ...environmentData.monitoring
            },
            security: {
                tls: true,
                authentication: true,
                authorization: [
                    'admin',
                    'deploy'
                ],
                compliance: [],
                scanning: {
                    vulnerabilities: true,
                    secrets: true,
                    licenses: true
                },
                ...environmentData.security
            },
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.environments.set(environment.id, environment);
        await this.saveEnvironment(environment);
        this.emit('environment:created', environment);
        this.logger.info(`Environment created: ${environment.name} (${environment.id})`);
        return environment;
    }
    async createDeployment(deploymentData) {
        const environment = this.environments.get(deploymentData.environmentId);
        if (!environment) {
            throw new Error(`Environment not found: ${deploymentData.environmentId}`);
        }
        const strategy = this.strategies.get(deploymentData.strategyId);
        if (!strategy) {
            throw new Error(`Strategy not found: ${deploymentData.strategyId}`);
        }
        const deployment = {
            id: `deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: deploymentData.name,
            version: deploymentData.version,
            projectId: deploymentData.projectId,
            environmentId: deploymentData.environmentId,
            strategyId: deploymentData.strategyId,
            status: 'pending',
            initiatedBy: deploymentData.initiatedBy,
            source: deploymentData.source,
            artifacts: {
                files: [],
                ...deploymentData.artifacts
            },
            metrics: {
                startTime: new Date(),
                deploymentSize: 0,
                successRate: 0,
                errorRate: 0,
                performanceMetrics: {}
            },
            stages: strategy.stages.map((stage)=>({
                    ...stage,
                    status: 'pending',
                    logs: []
                })),
            approvals: [],
            notifications: [],
            auditLog: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.addAuditEntry(deployment, deploymentData.initiatedBy, 'deployment_created', 'deployment', {
            deploymentId: deployment.id,
            environment: environment.name,
            strategy: strategy.name
        });
        this.deployments.set(deployment.id, deployment);
        await this.saveDeployment(deployment);
        this.emit('deployment:created', deployment);
        this.logger.info(`Deployment created: ${deployment.name} (${deployment.id})`);
        return deployment;
    }
    async executeDeployment(deploymentId) {
        const deployment = this.deployments.get(deploymentId);
        if (!deployment) {
            throw new Error(`Deployment not found: ${deploymentId}`);
        }
        if (deployment.status !== 'pending') {
            throw new Error(`Deployment ${deploymentId} is not in pending status`);
        }
        deployment.status = 'running';
        deployment.metrics.startTime = new Date();
        deployment.updatedAt = new Date();
        this.addAuditEntry(deployment, 'system', 'deployment_started', 'deployment', {
            deploymentId
        });
        await this.saveDeployment(deployment);
        this.emit('deployment:started', deployment);
        try {
            for (const stage of deployment.stages){
                await this.executeStage(deployment, stage);
                if (stage.status === 'failed') {
                    await this.handleDeploymentFailure(deployment, stage);
                    return;
                }
            }
            await this.completeDeployment(deployment);
        } catch (error) {
            await this.handleDeploymentError(deployment, error);
        }
    }
    async executeStage(deployment, stage) {
        stage.status = 'running';
        stage.startTime = new Date();
        this.addLog(stage, 'info', `Starting stage: ${stage.name}`, 'system');
        try {
            if (!this.evaluateStageConditions(deployment, stage)) {
                stage.status = 'skipped';
                this.addLog(stage, 'info', 'Stage skipped due to conditions', 'system');
                return;
            }
            if (stage.type === 'deploy' && await this.requiresApproval(deployment, stage)) {
                await this.requestApproval(deployment, stage);
                while(await this.isPendingApproval(deployment, stage)){
                    await new Promise((resolve)=>setTimeout(resolve, 10000));
                }
                if (!await this.isApproved(deployment, stage)) {
                    stage.status = 'failed';
                    this.addLog(stage, 'error', 'Stage rejected by approver', 'system');
                    return;
                }
            }
            for (const command of stage.commands){
                await this.executeCommand(deployment, stage, command);
            }
            stage.status = 'success';
            stage.endTime = new Date();
            stage.duration = stage.endTime.getTime() - stage.startTime.getTime();
            this.addLog(stage, 'info', `Stage completed successfully in ${stage.duration}ms`, 'system');
        } catch (error) {
            stage.status = 'failed';
            stage.endTime = new Date();
            this.addLog(stage, 'error', `Stage failed: ${error instanceof Error ? error.message : String(error)}`, 'system');
            if (stage.retryPolicy.maxRetries > 0) {
                await this.retryStage(deployment, stage);
            }
        }
        await this.saveDeployment(deployment);
        this.emit('stage:completed', {
            deployment,
            stage
        });
    }
    async executeCommand(deployment, stage, command) {
        return new Promise((resolve, reject)=>{
            const environment = this.environments.get(deployment.environmentId);
            const processEnv = {
                ...process.env,
                ...environment?.configuration.environment_variables,
                ...command.environment,
                DEPLOYMENT_ID: deployment.id,
                DEPLOYMENT_VERSION: deployment.version,
                ENVIRONMENT_ID: deployment.environmentId
            };
            this.addLog(stage, 'info', `Executing: ${command.command} ${command.args.join(' ')}`, 'command');
            const childProcess = spawn(command.command, command.args, {
                cwd: command.workingDirectory || process.cwd(),
                env: processEnv,
                stdio: [
                    'pipe',
                    'pipe',
                    'pipe'
                ]
            });
            this.activeProcesses.set(`${deployment.id}-${stage.id}-${command.id}`, childProcess);
            let stdout = '';
            let stderr = '';
            childProcess.stdout?.on('data', (data)=>{
                const output = data.toString();
                stdout += output;
                this.addLog(stage, 'info', output.trim(), 'stdout');
            });
            childProcess.stderr?.on('data', (data)=>{
                const output = data.toString();
                stderr += output;
                this.addLog(stage, 'error', output.trim(), 'stderr');
            });
            const timeout = setTimeout(()=>{
                childProcess.kill('SIGTERM');
                reject(new Error(`Command timed out after ${command.timeout}ms`));
            }, command.timeout);
            childProcess.on('close', (code)=>{
                clearTimeout(timeout);
                this.activeProcesses.delete(`${deployment.id}-${stage.id}-${command.id}`);
                const success = this.evaluateCommandSuccess(command, code, stdout, stderr);
                if (success) {
                    this.addLog(stage, 'info', `Command completed successfully (exit code: ${code})`, 'command');
                    resolve();
                } else {
                    this.addLog(stage, 'error', `Command failed (exit code: ${code})`, 'command');
                    reject(new Error(`Command failed with exit code ${code}`));
                }
            });
            childProcess.on('error', (error)=>{
                clearTimeout(timeout);
                this.activeProcesses.delete(`${deployment.id}-${stage.id}-${command.id}`);
                this.addLog(stage, 'error', `Command error: ${error instanceof Error ? error.message : String(error)}`, 'command');
                reject(error);
            });
        });
    }
    async rollbackDeployment(deploymentId, reason, userId = 'system') {
        const deployment = this.deployments.get(deploymentId);
        if (!deployment) {
            throw new Error(`Deployment not found: ${deploymentId}`);
        }
        const previousDeployment = await this.getPreviousSuccessfulDeployment(deployment.projectId, deployment.environmentId, deploymentId);
        if (!previousDeployment) {
            throw new Error('No previous successful deployment found for rollback');
        }
        const rollbackStartTime = new Date();
        deployment.rollback = {
            triggered: true,
            reason,
            timestamp: rollbackStartTime,
            previousDeploymentId: previousDeployment.id,
            rollbackDuration: 0
        };
        deployment.status = 'rolled-back';
        deployment.updatedAt = new Date();
        this.addAuditEntry(deployment, userId, 'rollback_initiated', 'deployment', {
            deploymentId,
            previousDeploymentId: previousDeployment.id,
            reason
        });
        try {
            await this.executeRollbackStrategy(deployment, previousDeployment);
            deployment.rollback.rollbackDuration = Date.now() - rollbackStartTime.getTime();
            this.addAuditEntry(deployment, userId, 'rollback_completed', 'deployment', {
                deploymentId,
                rollbackDuration: deployment.rollback.rollbackDuration
            });
            this.emit('deployment:rolled-back', deployment);
            this.logger.info(`Deployment rolled back: ${deploymentId}`);
        } catch (error) {
            this.addAuditEntry(deployment, userId, 'rollback_failed', 'deployment', {
                deploymentId,
                error: error instanceof Error ? error.message : String(error)
            });
            this.logger.error(`Rollback failed for deployment ${deploymentId}`, {
                error
            });
            throw error;
        }
        await this.saveDeployment(deployment);
    }
    async getDeploymentMetrics(filters) {
        let deployments = Array.from(this.deployments.values());
        if (filters) {
            if (filters.projectId) {
                deployments = deployments.filter((d)=>d.projectId === filters.projectId);
            }
            if (filters.environmentId) {
                deployments = deployments.filter((d)=>d.environmentId === filters.environmentId);
            }
            if (filters.strategyId) {
                deployments = deployments.filter((d)=>d.strategyId === filters.strategyId);
            }
            if (filters.timeRange) {
                deployments = deployments.filter((d)=>d.createdAt >= filters.timeRange.start && d.createdAt <= filters.timeRange.end);
            }
        }
        const totalDeployments = deployments.length;
        const successfulDeployments = deployments.filter((d)=>d.status === 'success').length;
        const failedDeployments = deployments.filter((d)=>d.status === 'failed').length;
        const rolledBackDeployments = deployments.filter((d)=>d.status === 'rolled-back').length;
        const completedDeployments = deployments.filter((d)=>d.metrics.endTime && d.metrics.startTime);
        const averageDeploymentTime = completedDeployments.length > 0 ? completedDeployments.reduce((sum, d)=>sum + (d.metrics.endTime.getTime() - d.metrics.startTime.getTime()), 0) / completedDeployments.length : 0;
        const environmentMetrics = {};
        for (const env of this.environments.values()){
            const envDeployments = deployments.filter((d)=>d.environmentId === env.id);
            const envSuccessful = envDeployments.filter((d)=>d.status === 'success').length;
            environmentMetrics[env.id] = {
                deployments: envDeployments.length,
                successRate: envDeployments.length > 0 ? envSuccessful / envDeployments.length * 100 : 0,
                averageTime: envDeployments.length > 0 ? envDeployments.reduce((sum, d)=>sum + (d.metrics.duration || 0), 0) / envDeployments.length : 0
            };
        }
        const strategyMetrics = {};
        for (const strategy of this.strategies.values()){
            const strategyDeployments = deployments.filter((d)=>d.strategyId === strategy.id);
            const strategySuccessful = strategyDeployments.filter((d)=>d.status === 'success').length;
            const strategyRolledBack = strategyDeployments.filter((d)=>d.status === 'rolled-back').length;
            strategyMetrics[strategy.id] = {
                deployments: strategyDeployments.length,
                successRate: strategyDeployments.length > 0 ? strategySuccessful / strategyDeployments.length * 100 : 0,
                rollbackRate: strategyDeployments.length > 0 ? strategyRolledBack / strategyDeployments.length * 100 : 0
            };
        }
        return {
            totalDeployments,
            successfulDeployments,
            failedDeployments,
            rolledBackDeployments,
            averageDeploymentTime,
            deploymentFrequency: this.calculateDeploymentFrequency(deployments),
            meanTimeToRecovery: this.calculateMTTR(deployments),
            changeFailureRate: (failedDeployments + rolledBackDeployments) / Math.max(totalDeployments, 1) * 100,
            leadTime: this.calculateLeadTime(deployments),
            environmentMetrics,
            strategyMetrics
        };
    }
    async loadConfigurations() {
        try {
            const envFiles = await readdir(join(this.deploymentsPath, 'environments'));
            for (const file of envFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.deploymentsPath, 'environments', file), 'utf-8');
                const env = JSON.parse(content);
                this.environments.set(env.id, env);
            }
            const strategyFiles = await readdir(join(this.deploymentsPath, 'strategies'));
            for (const file of strategyFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.deploymentsPath, 'strategies', file), 'utf-8');
                const strategy = JSON.parse(content);
                this.strategies.set(strategy.id, strategy);
            }
            const pipelineFiles = await readdir(join(this.deploymentsPath, 'pipelines'));
            for (const file of pipelineFiles.filter((f)=>f.endsWith('.json'))){
                const content = await readFile(join(this.deploymentsPath, 'pipelines', file), 'utf-8');
                const pipeline = JSON.parse(content);
                this.pipelines.set(pipeline.id, pipeline);
            }
            this.logger.info(`Loaded ${this.environments.size} environments, ${this.strategies.size} strategies, ${this.pipelines.size} pipelines`);
        } catch (error) {
            this.logger.warn('Failed to load some configurations', {
                error
            });
        }
    }
    async initializeDefaultStrategies() {
        const defaultStrategies = [
            {
                name: 'Blue-Green Deployment',
                type: 'blue-green',
                configuration: {
                    monitoringDuration: 300000,
                    automatedRollback: true,
                    rollbackThreshold: 5
                },
                stages: [
                    {
                        id: 'build',
                        name: 'Build',
                        order: 1,
                        type: 'build',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 600000,
                        retryPolicy: {
                            maxRetries: 2,
                            backoffMultiplier: 2,
                            initialDelay: 1000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'deploy-green',
                        name: 'Deploy to Green',
                        order: 2,
                        type: 'deploy',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 900000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 2,
                            initialDelay: 5000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'verify',
                        name: 'Verify Green',
                        order: 3,
                        type: 'verify',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 300000,
                        retryPolicy: {
                            maxRetries: 3,
                            backoffMultiplier: 1.5,
                            initialDelay: 2000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'switch-traffic',
                        name: 'Switch Traffic',
                        order: 4,
                        type: 'promote',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 60000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 1,
                            initialDelay: 1000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    }
                ],
                rollbackStrategy: {
                    automatic: true,
                    conditions: [
                        {
                            metric: 'error_rate',
                            threshold: 5,
                            operator: '>',
                            duration: 60000,
                            description: 'Error rate exceeds 5%'
                        }
                    ],
                    timeout: 300000
                }
            },
            {
                name: 'Canary Deployment',
                type: 'canary',
                configuration: {
                    trafficSplitPercentage: 10,
                    monitoringDuration: 600000,
                    automatedRollback: true,
                    rollbackThreshold: 2
                },
                stages: [
                    {
                        id: 'build',
                        name: 'Build',
                        order: 1,
                        type: 'build',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 600000,
                        retryPolicy: {
                            maxRetries: 2,
                            backoffMultiplier: 2,
                            initialDelay: 1000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'deploy-canary',
                        name: 'Deploy Canary (10%)',
                        order: 2,
                        type: 'deploy',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 900000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 2,
                            initialDelay: 5000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'monitor-canary',
                        name: 'Monitor Canary',
                        order: 3,
                        type: 'verify',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 600000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 1,
                            initialDelay: 10000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'promote-full',
                        name: 'Promote to 100%',
                        order: 4,
                        type: 'promote',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 300000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 1,
                            initialDelay: 1000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    }
                ],
                rollbackStrategy: {
                    automatic: true,
                    conditions: [
                        {
                            metric: 'error_rate',
                            threshold: 2,
                            operator: '>',
                            duration: 120000,
                            description: 'Canary error rate exceeds 2%'
                        },
                        {
                            metric: 'response_time',
                            threshold: 500,
                            operator: '>',
                            duration: 180000,
                            description: 'Response time exceeds 500ms'
                        }
                    ],
                    timeout: 180000
                }
            },
            {
                name: 'Rolling Deployment',
                type: 'rolling',
                configuration: {
                    maxUnavailable: 1,
                    maxSurge: 1,
                    monitoringDuration: 120000,
                    automatedRollback: false
                },
                stages: [
                    {
                        id: 'build',
                        name: 'Build',
                        order: 1,
                        type: 'build',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 600000,
                        retryPolicy: {
                            maxRetries: 2,
                            backoffMultiplier: 2,
                            initialDelay: 1000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'rolling-update',
                        name: 'Rolling Update',
                        order: 2,
                        type: 'deploy',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 1200000,
                        retryPolicy: {
                            maxRetries: 1,
                            backoffMultiplier: 2,
                            initialDelay: 5000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    },
                    {
                        id: 'health-check',
                        name: 'Health Check',
                        order: 3,
                        type: 'verify',
                        status: 'pending',
                        commands: [],
                        conditions: {
                            runIf: [],
                            skipIf: []
                        },
                        timeout: 300000,
                        retryPolicy: {
                            maxRetries: 3,
                            backoffMultiplier: 1.5,
                            initialDelay: 5000
                        },
                        artifacts: {
                            inputs: [],
                            outputs: []
                        },
                        logs: []
                    }
                ],
                rollbackStrategy: {
                    automatic: false,
                    conditions: [],
                    timeout: 600000
                }
            }
        ];
        for (const strategyData of defaultStrategies){
            if (!Array.from(this.strategies.values()).some((s)=>s.name === strategyData.name)) {
                const strategy = {
                    id: `strategy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    notifications: {
                        channels: [],
                        events: [
                            'deployment:started',
                            'deployment:completed',
                            'deployment:failed'
                        ]
                    },
                    ...strategyData
                };
                this.strategies.set(strategy.id, strategy);
                await this.saveStrategy(strategy);
            }
        }
    }
    async saveEnvironment(environment) {
        const filePath = join(this.deploymentsPath, 'environments', `${environment.id}.json`);
        await writeFile(filePath, JSON.stringify(environment, null, 2));
    }
    async saveStrategy(strategy) {
        const filePath = join(this.deploymentsPath, 'strategies', `${strategy.id}.json`);
        await writeFile(filePath, JSON.stringify(strategy, null, 2));
    }
    async saveDeployment(deployment) {
        const filePath = join(this.deploymentsPath, `${deployment.id}.json`);
        await writeFile(filePath, JSON.stringify(deployment, null, 2));
    }
    addAuditEntry(deployment, userId, action, target, details) {
        const entry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            userId,
            action,
            target,
            details
        };
        deployment.auditLog.push(entry);
    }
    addLog(stage, level, message, source, metadata) {
        const log = {
            timestamp: new Date(),
            level,
            message,
            source,
            metadata
        };
        stage.logs.push(log);
    }
    evaluateStageConditions(deployment, stage) {
        return true;
    }
    async requiresApproval(deployment, stage) {
        const strategy = this.strategies.get(deployment.strategyId);
        return strategy?.configuration.approvalRequired || false;
    }
    async requestApproval(deployment, stage) {
        this.emit('approval:requested', {
            deployment,
            stage
        });
    }
    async isPendingApproval(deployment, stage) {
        return false;
    }
    async isApproved(deployment, stage) {
        return true;
    }
    evaluateCommandSuccess(command, exitCode, stdout, stderr) {
        if (command.successCriteria.exitCode !== undefined && exitCode !== command.successCriteria.exitCode) {
            return false;
        }
        if (command.successCriteria.outputContains) {
            for (const pattern of command.successCriteria.outputContains){
                if (!stdout.includes(pattern)) {
                    return false;
                }
            }
        }
        if (command.successCriteria.outputNotContains) {
            for (const pattern of command.successCriteria.outputNotContains){
                if (stdout.includes(pattern) || stderr.includes(pattern)) {
                    return false;
                }
            }
        }
        return true;
    }
    async retryStage(deployment, stage) {
        this.logger.info(`Retrying stage: ${stage.name}`);
    }
    async handleDeploymentFailure(deployment, failedStage) {
        deployment.status = 'failed';
        deployment.metrics.endTime = new Date();
        deployment.updatedAt = new Date();
        this.addAuditEntry(deployment, 'system', 'deployment_failed', 'deployment', {
            deploymentId: deployment.id,
            failedStage: failedStage.name,
            reason: 'Stage execution failed'
        });
        await this.saveDeployment(deployment);
        this.emit('deployment:failed', {
            deployment,
            failedStage
        });
        const strategy = this.strategies.get(deployment.strategyId);
        if (strategy?.rollbackStrategy.automatic) {
            await this.rollbackDeployment(deployment.id, 'Automatic rollback due to deployment failure');
        }
    }
    async handleDeploymentError(deployment, error) {
        deployment.status = 'failed';
        deployment.metrics.endTime = new Date();
        deployment.updatedAt = new Date();
        this.addAuditEntry(deployment, 'system', 'deployment_error', 'deployment', {
            deploymentId: deployment.id,
            error: error instanceof Error ? error.message : String(error)
        });
        await this.saveDeployment(deployment);
        this.emit('deployment:error', {
            deployment,
            error
        });
        this.logger.error(`Deployment error: ${deployment.id}`, {
            error
        });
    }
    async completeDeployment(deployment) {
        deployment.status = 'success';
        deployment.metrics.endTime = new Date();
        deployment.metrics.duration = deployment.metrics.endTime.getTime() - deployment.metrics.startTime.getTime();
        deployment.updatedAt = new Date();
        this.addAuditEntry(deployment, 'system', 'deployment_completed', 'deployment', {
            deploymentId: deployment.id,
            duration: deployment.metrics.duration
        });
        await this.saveDeployment(deployment);
        this.emit('deployment:completed', deployment);
        this.logger.info(`Deployment completed: ${deployment.id} in ${deployment.metrics.duration}ms`);
    }
    async getPreviousSuccessfulDeployment(projectId, environmentId, currentDeploymentId) {
        const deployments = Array.from(this.deployments.values()).filter((d)=>d.projectId === projectId && d.environmentId === environmentId && d.status === 'success' && d.id !== currentDeploymentId).sort((a, b)=>b.createdAt.getTime() - a.createdAt.getTime());
        return deployments[0] || null;
    }
    async executeRollbackStrategy(deployment, previousDeployment) {
        this.logger.info(`Executing rollback from ${deployment.id} to ${previousDeployment.id}`);
        this.emit('rollback:executed', {
            deployment,
            previousDeployment
        });
    }
    calculateDeploymentFrequency(deployments) {
        if (deployments.length === 0) return 0;
        const sortedDeployments = deployments.sort((a, b)=>a.createdAt.getTime() - b.createdAt.getTime());
        const firstDeployment = sortedDeployments[0];
        const lastDeployment = sortedDeployments[sortedDeployments.length - 1];
        const timeSpan = lastDeployment.createdAt.getTime() - firstDeployment.createdAt.getTime();
        const days = timeSpan / (1000 * 60 * 60 * 24);
        return deployments.length / Math.max(days, 1);
    }
    calculateMTTR(deployments) {
        const failedDeployments = deployments.filter((d)=>d.status === 'failed' || d.status === 'rolled-back');
        if (failedDeployments.length === 0) return 0;
        const recoveryTimes = failedDeployments.map((d)=>d.rollback?.rollbackDuration || 0).filter((time)=>time > 0);
        if (recoveryTimes.length === 0) return 0;
        return recoveryTimes.reduce((sum, time)=>sum + time, 0) / recoveryTimes.length;
    }
    calculateLeadTime(deployments) {
        const completedDeployments = deployments.filter((d)=>d.metrics.duration);
        if (completedDeployments.length === 0) return 0;
        return completedDeployments.reduce((sum, d)=>sum + (d.metrics.duration || 0), 0) / completedDeployments.length;
    }
}

//# sourceMappingURL=deployment-manager.js.map