import { Logger } from '../core/logger.js';
import { agenticHookManager } from '../services/agentic-flow-hooks/index.js';
const logger = new Logger({
    level: 'info',
    format: 'text',
    destination: 'console'
}, {
    prefix: 'VerificationHooks'
});
export const DEFAULT_VERIFICATION_CONFIG = {
    preTask: {
        enabled: true,
        checkers: [],
        failureStrategy: 'abort'
    },
    postTask: {
        enabled: true,
        validators: [],
        accuracyThreshold: 0.8
    },
    integration: {
        enabled: true,
        testSuites: [],
        parallel: true
    },
    telemetry: {
        enabled: true,
        truthValidators: [],
        reportingInterval: 30000
    },
    rollback: {
        enabled: true,
        triggers: [],
        snapshotStrategy: 'automatic'
    }
};
export class VerificationHookManager {
    config;
    contexts = new Map();
    snapshots = new Map();
    constructor(config = {}){
        this.config = {
            ...DEFAULT_VERIFICATION_CONFIG,
            ...config
        };
        this.registerHooks();
        this.startTelemetryReporting();
    }
    registerHooks() {
        this.registerPreTaskHook();
        this.registerPostTaskHook();
        this.registerIntegrationTestHook();
        this.registerTruthTelemetryHook();
        this.registerRollbackTriggerHook();
        logger.info('Verification hooks registered successfully');
    }
    registerPreTaskHook() {
        const preTaskHook = {
            id: 'verification-pre-task',
            type: 'workflow-start',
            priority: 100,
            handler: async (payload, context)=>{
                if (!this.config.preTask.enabled) {
                    return {
                        continue: true
                    };
                }
                const verificationContext = this.createVerificationContext(payload, context);
                try {
                    await this.executePreTaskChecks(verificationContext);
                    const state = verificationContext.state;
                    if (state.checksFailed.length > 0) {
                        const strategy = this.config.preTask.failureStrategy;
                        if (strategy === 'abort') {
                            return {
                                continue: false,
                                metadata: {
                                    verificationFailed: true,
                                    failedChecks: state.checksFailed,
                                    error: 'Pre-task verification failed'
                                }
                            };
                        } else if (strategy === 'warn') {
                            logger.warn('Pre-task verification warnings:', state.checksFailed);
                        }
                    }
                    await this.createSnapshot(verificationContext, 'pre-task-complete');
                    return {
                        continue: true,
                        modified: true,
                        payload: {
                            ...payload,
                            verificationContext: verificationContext.taskId
                        },
                        metadata: {
                            verificationPassed: true,
                            checksExecuted: state.checksPassed.length,
                            warnings: state.checksFailed.length
                        }
                    };
                } catch (error) {
                    logger.error('Pre-task verification error:', error);
                    return {
                        continue: this.config.preTask.failureStrategy !== 'abort',
                        metadata: {
                            verificationError: true,
                            error: error.message
                        }
                    };
                }
            },
            options: {
                timeout: 30000,
                async: false
            }
        };
        agenticHookManager.register(preTaskHook);
    }
    async executePreTaskChecks(context) {
        const checkers = this.config.preTask.checkers.sort((a, b)=>b.priority - a.priority);
        for (const checker of checkers){
            try {
                const result = await checker.check(context);
                if (result.passed) {
                    context.state.checksPassed.push(checker.id);
                } else {
                    context.state.checksFailed.push(checker.id);
                    context.state.errors.push({
                        type: 'check',
                        phase: 'pre-task',
                        message: result.message,
                        details: result.details,
                        recoverable: true
                    });
                }
                context.metrics.totalChecks++;
                if (result.passed) {
                    context.metrics.passedChecks++;
                } else {
                    context.metrics.failedChecks++;
                }
            } catch (error) {
                logger.error(`Pre-task checker '${checker.id}' failed:`, error);
                context.state.checksFailed.push(checker.id);
                context.state.errors.push({
                    type: 'check',
                    phase: 'pre-task',
                    message: `Checker '${checker.id}' threw an error: ${error.message}`,
                    details: error,
                    recoverable: false
                });
            }
        }
    }
    registerPostTaskHook() {
        const postTaskHook = {
            id: 'verification-post-task',
            type: 'workflow-complete',
            priority: 90,
            handler: async (payload, context)=>{
                if (!this.config.postTask.enabled) {
                    return {
                        continue: true
                    };
                }
                const verificationContext = this.getVerificationContext(payload.workflowId) || this.createVerificationContext(payload, context);
                try {
                    await this.executePostTaskValidation(verificationContext, payload);
                    const accuracy = this.calculateAccuracy(verificationContext);
                    const meetsThreshold = accuracy >= this.config.postTask.accuracyThreshold;
                    await this.createSnapshot(verificationContext, 'post-task-complete');
                    return {
                        continue: true,
                        modified: true,
                        payload: {
                            ...payload,
                            validationResults: verificationContext.state.validationResults,
                            accuracy,
                            meetsThreshold
                        },
                        metadata: {
                            validationComplete: true,
                            accuracy,
                            meetsThreshold,
                            validationCount: verificationContext.state.validationResults.length
                        },
                        sideEffects: [
                            {
                                type: 'metric',
                                action: 'update',
                                data: {
                                    name: 'verification.accuracy',
                                    value: accuracy
                                }
                            }
                        ]
                    };
                } catch (error) {
                    logger.error('Post-task validation error:', error);
                    return {
                        continue: true,
                        metadata: {
                            validationError: true,
                            error: error.message
                        }
                    };
                }
            },
            options: {
                timeout: 60000,
                async: true
            }
        };
        agenticHookManager.register(postTaskHook);
    }
    async executePostTaskValidation(context, payload) {
        const validators = this.config.postTask.validators.sort((a, b)=>b.priority - a.priority);
        for (const validator of validators){
            try {
                const result = await validator.validate(context, payload.state);
                context.state.validationResults.push(result);
                if (result.valid) {
                    context.metrics.accuracyScore += result.accuracy;
                    context.metrics.confidenceScore += result.confidence;
                }
            } catch (error) {
                logger.error(`Post-task validator '${validator.id}' failed:`, error);
                context.state.errors.push({
                    type: 'validation',
                    phase: 'post-task',
                    message: `Validator '${validator.id}' threw an error: ${error.message}`,
                    details: error,
                    recoverable: false
                });
            }
        }
    }
    registerIntegrationTestHook() {
        const integrationTestHook = {
            id: 'verification-integration-test',
            type: 'workflow-step',
            priority: 80,
            filter: {
                patterns: [
                    /integration.*test/i,
                    /test.*integration/i
                ]
            },
            handler: async (payload, context)=>{
                if (!this.config.integration.enabled) {
                    return {
                        continue: true
                    };
                }
                const verificationContext = this.getVerificationContext(payload.workflowId) || this.createVerificationContext(payload, context);
                try {
                    await this.executeIntegrationTests(verificationContext);
                    const allTestsPassed = verificationContext.state.testResults.every((r)=>r.passed);
                    const testCount = verificationContext.state.testResults.length;
                    const passedCount = verificationContext.state.testResults.filter((r)=>r.passed).length;
                    return {
                        continue: true,
                        modified: true,
                        payload: {
                            ...payload,
                            testResults: verificationContext.state.testResults,
                            allTestsPassed,
                            testSummary: {
                                total: testCount,
                                passed: passedCount,
                                failed: testCount - passedCount
                            }
                        },
                        metadata: {
                            integrationTestsComplete: true,
                            allTestsPassed,
                            testCount,
                            passedCount
                        },
                        sideEffects: [
                            {
                                type: 'metric',
                                action: 'update',
                                data: {
                                    name: 'verification.integration.success_rate',
                                    value: passedCount / testCount
                                }
                            }
                        ]
                    };
                } catch (error) {
                    logger.error('Integration test execution error:', error);
                    return {
                        continue: true,
                        metadata: {
                            integrationTestError: true,
                            error: error.message
                        }
                    };
                }
            },
            options: {
                timeout: 120000,
                async: true
            }
        };
        agenticHookManager.register(integrationTestHook);
    }
    async executeIntegrationTests(context) {
        const testSuites = this.config.integration.testSuites;
        for (const suite of testSuites){
            const requirementsMet = await this.checkTestRequirements(suite.requirements, context);
            if (!requirementsMet) {
                logger.warn(`Skipping test suite '${suite.id}' - requirements not met`);
                continue;
            }
            if (this.config.integration.parallel) {
                const testPromises = suite.tests.map((test)=>this.executeIntegrationTest(test, context));
                const results = await Promise.allSettled(testPromises);
                results.forEach((result, index)=>{
                    if (result.status === 'fulfilled') {
                        context.state.testResults.push(result.value);
                    } else {
                        context.state.testResults.push({
                            passed: false,
                            duration: 0,
                            message: `Test '${suite.tests[index].id}' failed: ${result.reason}`,
                            details: result.reason
                        });
                    }
                });
            } else {
                for (const test of suite.tests){
                    try {
                        const result = await this.executeIntegrationTest(test, context);
                        context.state.testResults.push(result);
                    } catch (error) {
                        context.state.testResults.push({
                            passed: false,
                            duration: 0,
                            message: `Test '${test.id}' failed: ${error.message}`,
                            details: error
                        });
                    }
                }
            }
        }
    }
    async executeIntegrationTest(test, context) {
        const startTime = Date.now();
        try {
            const result = await test.execute(context);
            result.duration = Date.now() - startTime;
            if (test.cleanup) {
                try {
                    await test.cleanup(context);
                } catch (cleanupError) {
                    logger.warn(`Test cleanup failed for '${test.id}':`, cleanupError);
                }
            }
            return result;
        } catch (error) {
            return {
                passed: false,
                duration: Date.now() - startTime,
                message: `Test execution failed: ${error.message}`,
                details: error
            };
        }
    }
    async checkTestRequirements(requirements, context) {
        for (const requirement of requirements){
            if (requirement.startsWith('env:')) {
                const envVar = requirement.substring(4);
                if (!process.env[envVar]) {
                    return false;
                }
            } else if (requirement.startsWith('check:')) {
                const checkId = requirement.substring(6);
                if (!context.state.checksPassed.includes(checkId)) {
                    return false;
                }
            }
        }
        return true;
    }
    registerTruthTelemetryHook() {
        const truthTelemetryHook = {
            id: 'verification-truth-telemetry',
            type: 'performance-metric',
            priority: 70,
            handler: async (payload, context)=>{
                if (!this.config.telemetry.enabled) {
                    return {
                        continue: true
                    };
                }
                const verificationContext = this.getOrCreateVerificationContext(payload, context);
                try {
                    await this.executeTruthValidation(verificationContext, payload);
                    const truthfulness = this.calculateTruthfulness(verificationContext);
                    return {
                        continue: true,
                        modified: true,
                        payload: {
                            ...payload,
                            truthResults: verificationContext.state.truthResults,
                            truthfulness
                        },
                        metadata: {
                            truthValidationComplete: true,
                            truthfulness,
                            validatorCount: this.config.telemetry.truthValidators.length
                        },
                        sideEffects: [
                            {
                                type: 'metric',
                                action: 'update',
                                data: {
                                    name: 'verification.truthfulness',
                                    value: truthfulness
                                }
                            },
                            {
                                type: 'memory',
                                action: 'store',
                                data: {
                                    key: `truth_telemetry_${Date.now()}`,
                                    value: {
                                        timestamp: Date.now(),
                                        truthfulness,
                                        results: verificationContext.state.truthResults
                                    }
                                }
                            }
                        ]
                    };
                } catch (error) {
                    logger.error('Truth telemetry execution error:', error);
                    return {
                        continue: true,
                        metadata: {
                            truthTelemetryError: true,
                            error: error.message
                        }
                    };
                }
            },
            options: {
                timeout: 45000,
                async: true
            }
        };
        agenticHookManager.register(truthTelemetryHook);
    }
    async executeTruthValidation(context, payload) {
        const validators = this.config.telemetry.truthValidators;
        for (const validator of validators){
            try {
                const data = payload.context.metrics || payload.value;
                const expected = payload.threshold;
                const result = await validator.validate(data, expected);
                context.state.truthResults.push(result);
            } catch (error) {
                logger.error(`Truth validator '${validator.id}' failed:`, error);
                context.state.errors.push({
                    type: 'truth',
                    phase: 'telemetry',
                    message: `Truth validator '${validator.id}' threw an error: ${error.message}`,
                    details: error,
                    recoverable: false
                });
            }
        }
    }
    calculateTruthfulness(context) {
        const truthResults = context.state.truthResults;
        if (truthResults.length === 0) return 1.0;
        const totalAccuracy = truthResults.reduce((sum, result)=>sum + result.accuracy, 0);
        return totalAccuracy / truthResults.length;
    }
    registerRollbackTriggerHook() {
        const rollbackTriggerHook = {
            id: 'verification-rollback-trigger',
            type: 'workflow-error',
            priority: 95,
            handler: async (payload, context)=>{
                if (!this.config.rollback.enabled) {
                    return {
                        continue: true
                    };
                }
                const verificationContext = this.getVerificationContext(payload.workflowId);
                if (!verificationContext) {
                    logger.warn('No verification context found for rollback evaluation');
                    return {
                        continue: true
                    };
                }
                try {
                    const shouldRollback = await this.evaluateRollbackTriggers(verificationContext, payload.error);
                    if (shouldRollback) {
                        const rollbackResult = await this.executeRollback(verificationContext);
                        return {
                            continue: rollbackResult.success,
                            modified: true,
                            payload: {
                                ...payload,
                                rollbackExecuted: true,
                                rollbackResult
                            },
                            metadata: {
                                rollbackTriggered: true,
                                rollbackSuccess: rollbackResult.success,
                                rollbackAction: rollbackResult.action
                            },
                            sideEffects: [
                                {
                                    type: 'log',
                                    action: 'warn',
                                    data: {
                                        level: 'warn',
                                        message: 'Rollback triggered due to verification failure',
                                        data: rollbackResult
                                    }
                                },
                                {
                                    type: 'metric',
                                    action: 'increment',
                                    data: {
                                        name: 'verification.rollbacks.triggered'
                                    }
                                }
                            ]
                        };
                    }
                    return {
                        continue: true
                    };
                } catch (error) {
                    logger.error('Rollback trigger evaluation error:', error);
                    return {
                        continue: true,
                        metadata: {
                            rollbackError: true,
                            error: error.message
                        }
                    };
                }
            },
            options: {
                timeout: 30000,
                async: false
            }
        };
        agenticHookManager.register(rollbackTriggerHook);
    }
    async evaluateRollbackTriggers(context, error) {
        const triggers = this.config.rollback.triggers;
        for (const trigger of triggers){
            try {
                if (trigger.condition(context, error)) {
                    logger.info(`Rollback trigger '${trigger.id}' activated`);
                    return true;
                }
            } catch (triggerError) {
                logger.error(`Rollback trigger '${trigger.id}' evaluation failed:`, triggerError);
            }
        }
        return false;
    }
    async executeRollback(context) {
        try {
            const snapshots = this.snapshots.get(context.taskId) || [];
            const latestSnapshot = snapshots[snapshots.length - 1];
            if (!latestSnapshot) {
                throw new Error('No snapshots available for rollback');
            }
            switch(this.config.rollback.snapshotStrategy){
                case 'automatic':
                    await this.restoreSnapshot(context, latestSnapshot);
                    break;
                case 'selective':
                    const bestSnapshot = this.findBestRollbackSnapshot(snapshots);
                    await this.restoreSnapshot(context, bestSnapshot);
                    break;
                default:
                    await this.restoreSnapshot(context, latestSnapshot);
            }
            return {
                success: true,
                action: 'snapshot-restored',
                details: {
                    snapshotId: latestSnapshot.id,
                    timestamp: latestSnapshot.timestamp
                }
            };
        } catch (error) {
            logger.error('Rollback execution failed:', error);
            return {
                success: false,
                action: 'rollback-failed',
                details: error.message
            };
        }
    }
    createVerificationContext(payload, context) {
        const verificationContext = {
            taskId: payload.workflowId,
            sessionId: context.sessionId,
            timestamp: Date.now(),
            metadata: {
                ...payload.state,
                ...context.metadata
            },
            state: {
                phase: 'pre-task',
                checksPassed: [],
                checksFailed: [],
                validationResults: [],
                testResults: [],
                truthResults: [],
                errors: []
            },
            snapshots: [],
            metrics: {
                totalChecks: 0,
                passedChecks: 0,
                failedChecks: 0,
                executionTime: 0,
                accuracyScore: 0,
                confidenceScore: 0
            }
        };
        this.contexts.set(verificationContext.taskId, verificationContext);
        return verificationContext;
    }
    getVerificationContext(taskId) {
        return this.contexts.get(taskId);
    }
    getOrCreateVerificationContext(payload, context) {
        const taskId = payload.workflowId || payload.context?.taskId || context.correlationId;
        let verificationContext = this.contexts.get(taskId);
        if (!verificationContext) {
            verificationContext = this.createVerificationContext({
                workflowId: taskId,
                state: payload.context || {}
            }, context);
        }
        return verificationContext;
    }
    async createSnapshot(context, phase) {
        const snapshot = {
            id: `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            phase,
            state: JSON.parse(JSON.stringify(context.state)),
            metadata: JSON.parse(JSON.stringify(context.metadata))
        };
        if (!this.snapshots.has(context.taskId)) {
            this.snapshots.set(context.taskId, []);
        }
        this.snapshots.get(context.taskId).push(snapshot);
        context.snapshots.push(snapshot);
        logger.debug(`Created snapshot '${snapshot.id}' for task '${context.taskId}' in phase '${phase}'`);
    }
    async restoreSnapshot(context, snapshot) {
        context.state = JSON.parse(JSON.stringify(snapshot.state));
        context.metadata = JSON.parse(JSON.stringify(snapshot.metadata));
        logger.info(`Restored snapshot '${snapshot.id}' for task '${context.taskId}'`);
    }
    findBestRollbackSnapshot(snapshots) {
        const successfulSnapshots = snapshots.filter((s)=>s.phase.includes('complete') && !s.phase.includes('error'));
        return successfulSnapshots.length > 0 ? successfulSnapshots[successfulSnapshots.length - 1] : snapshots[snapshots.length - 1];
    }
    calculateAccuracy(context) {
        const validationResults = context.state.validationResults;
        if (validationResults.length === 0) return 1.0;
        const totalAccuracy = validationResults.reduce((sum, result)=>sum + result.accuracy, 0);
        return totalAccuracy / validationResults.length;
    }
    startTelemetryReporting() {
        if (!this.config.telemetry.enabled) return;
        setInterval(()=>{
            this.generateTelemetryReport();
        }, this.config.telemetry.reportingInterval);
    }
    generateTelemetryReport() {
        const report = {
            timestamp: Date.now(),
            activeContexts: this.contexts.size,
            totalSnapshots: Array.from(this.snapshots.values()).reduce((sum, arr)=>sum + arr.length, 0),
            metrics: this.aggregateMetrics()
        };
        logger.info('Verification telemetry report:', report);
        agenticHookManager.emit('verification:telemetry', report);
    }
    aggregateMetrics() {
        const allContexts = Array.from(this.contexts.values());
        return {
            totalChecks: allContexts.reduce((sum, ctx)=>sum + ctx.metrics.totalChecks, 0),
            totalPassed: allContexts.reduce((sum, ctx)=>sum + ctx.metrics.passedChecks, 0),
            totalFailed: allContexts.reduce((sum, ctx)=>sum + ctx.metrics.failedChecks, 0),
            averageAccuracy: allContexts.length > 0 ? allContexts.reduce((sum, ctx)=>sum + ctx.metrics.accuracyScore, 0) / allContexts.length : 0,
            averageConfidence: allContexts.length > 0 ? allContexts.reduce((sum, ctx)=>sum + ctx.metrics.confidenceScore, 0) / allContexts.length : 0
        };
    }
    addPreTaskChecker(checker) {
        this.config.preTask.checkers.push(checker);
        logger.info(`Added pre-task checker: ${checker.name}`);
    }
    addPostTaskValidator(validator) {
        this.config.postTask.validators.push(validator);
        logger.info(`Added post-task validator: ${validator.name}`);
    }
    addIntegrationTestSuite(testSuite) {
        this.config.integration.testSuites.push(testSuite);
        logger.info(`Added integration test suite: ${testSuite.name}`);
    }
    addTruthValidator(validator) {
        this.config.telemetry.truthValidators.push(validator);
        logger.info(`Added truth validator: ${validator.name}`);
    }
    addRollbackTrigger(trigger) {
        this.config.rollback.triggers.push(trigger);
        logger.info(`Added rollback trigger: ${trigger.name}`);
    }
    getVerificationStatus(taskId) {
        return this.contexts.get(taskId);
    }
    getMetrics() {
        return this.aggregateMetrics();
    }
    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
        logger.info('Verification configuration updated');
    }
    cleanup(maxAge = 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAge;
        for (const [taskId, context] of this.contexts.entries()){
            if (context.timestamp < cutoff) {
                this.contexts.delete(taskId);
                this.snapshots.delete(taskId);
            }
        }
        logger.info(`Cleaned up verification data older than ${maxAge}ms`);
    }
}
export const DEFAULT_PRE_TASK_CHECKERS = [
    {
        id: 'environment-check',
        name: 'Environment Validation',
        description: 'Validates that required environment variables and dependencies are available',
        priority: 100,
        check: async (context)=>{
            const requiredEnvVars = [
                'NODE_ENV'
            ];
            const missing = requiredEnvVars.filter((envVar)=>!process.env[envVar]);
            return {
                passed: missing.length === 0,
                score: missing.length === 0 ? 1.0 : 0.5,
                message: missing.length === 0 ? 'Environment validation passed' : `Missing environment variables: ${missing.join(', ')}`,
                details: {
                    missing,
                    available: requiredEnvVars.filter((envVar)=>process.env[envVar])
                },
                recommendations: missing.length > 0 ? [
                    `Set missing environment variables: ${missing.join(', ')}`
                ] : undefined
            };
        }
    },
    {
        id: 'resource-check',
        name: 'Resource Availability',
        description: 'Checks system resources and capacity',
        priority: 90,
        check: async (context)=>{
            const memUsage = process.memoryUsage();
            const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
            const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
            const usageRatio = heapUsedMB / heapTotalMB;
            return {
                passed: usageRatio < 0.9,
                score: Math.max(0, 1 - usageRatio),
                message: `Memory usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB (${(usageRatio * 100).toFixed(1)}%)`,
                details: {
                    memUsage,
                    usageRatio
                },
                recommendations: usageRatio > 0.8 ? [
                    'Consider freeing memory before proceeding'
                ] : undefined
            };
        }
    }
];
export const DEFAULT_POST_TASK_VALIDATORS = [
    {
        id: 'completion-validator',
        name: 'Task Completion Validation',
        description: 'Validates that the task completed successfully',
        priority: 100,
        validate: async (context, result)=>{
            const hasErrors = context.state.errors.length > 0;
            const hasFailedChecks = context.state.checksFailed.length > 0;
            return {
                valid: !hasErrors && !hasFailedChecks,
                accuracy: hasErrors || hasFailedChecks ? 0.5 : 1.0,
                confidence: 0.9,
                message: hasErrors || hasFailedChecks ? 'Task completed with errors or failed checks' : 'Task completed successfully',
                details: {
                    errorCount: context.state.errors.length,
                    failedCheckCount: context.state.checksFailed.length
                }
            };
        }
    }
];
export const DEFAULT_TRUTH_VALIDATORS = [
    {
        id: 'data-consistency-validator',
        name: 'Data Consistency Validation',
        description: 'Validates data consistency and integrity',
        validate: async (data, expected)=>{
            const dataStr = JSON.stringify(data);
            const expectedStr = JSON.stringify(expected);
            const isEqual = dataStr === expectedStr;
            return {
                truthful: isEqual,
                accuracy: isEqual ? 1.0 : 0.0,
                confidence: 0.95,
                discrepancies: isEqual ? [] : [
                    'Data does not match expected structure'
                ],
                evidence: [
                    {
                        data,
                        expected,
                        match: isEqual
                    }
                ]
            };
        }
    }
];
export const DEFAULT_ROLLBACK_TRIGGERS = [
    {
        id: 'error-threshold-trigger',
        name: 'Error Threshold Trigger',
        description: 'Triggers rollback when error count exceeds threshold',
        condition: (context, error)=>{
            return context.state.errors.filter((e)=>!e.recoverable).length > 3;
        },
        action: 'restore-snapshot'
    },
    {
        id: 'accuracy-threshold-trigger',
        name: 'Accuracy Threshold Trigger',
        description: 'Triggers rollback when accuracy falls below threshold',
        condition: (context, error)=>{
            return context.metrics.accuracyScore < 0.5 && context.state.validationResults.length > 0;
        },
        action: 'restore-snapshot'
    }
];
export const verificationHookManager = new VerificationHookManager({
    preTask: {
        enabled: true,
        checkers: DEFAULT_PRE_TASK_CHECKERS,
        failureStrategy: 'abort'
    },
    postTask: {
        enabled: true,
        validators: DEFAULT_POST_TASK_VALIDATORS,
        accuracyThreshold: 0.8
    },
    integration: {
        enabled: true,
        testSuites: [],
        parallel: true
    },
    telemetry: {
        enabled: true,
        truthValidators: DEFAULT_TRUTH_VALIDATORS,
        reportingInterval: 30000
    },
    rollback: {
        enabled: true,
        triggers: DEFAULT_ROLLBACK_TRIGGERS,
        snapshotStrategy: 'automatic'
    }
});
logger.info('Verification hooks module initialized with default configuration');

//# sourceMappingURL=hooks.js.map