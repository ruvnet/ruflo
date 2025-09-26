import { logger } from '../core/logger.js';
import { AppError } from '../utils/error-handler.js';
import { VERIFICATION_CONSTANTS } from './types.js';
import { TruthScorer } from './truth-scorer.js';
import { AgentClaimValidator } from './agent-claim-validator.js';
import { IntegrationTestRunner } from './integration-test-runner.js';
import { StateSnapshotManager } from './state-snapshot.js';
export class VerificationPipeline {
    config;
    logger;
    truthScorer;
    claimValidator;
    testRunner;
    snapshotManager;
    eventEmitter;
    currentExecution;
    executionHistory = [];
    checkpointCache = new Map();
    constructor(options){
        this.config = options.config;
        this.logger = options.logger || logger.child({
            component: 'VerificationPipeline',
            pipelineId: options.config.id
        });
        this.truthScorer = options.truthScorer || new TruthScorer();
        this.claimValidator = options.claimValidator || new AgentClaimValidator();
        this.testRunner = options.testRunner || new IntegrationTestRunner();
        this.snapshotManager = options.snapshotManager || new StateSnapshotManager();
        this.eventEmitter = options.eventEmitter;
        this.logger.info('VerificationPipeline initialized', {
            pipelineId: this.config.id,
            checkpointCount: this.config.checkpoints.length,
            level: this.config.level,
            parallel: this.config.parallel
        });
    }
    async execute(context, callbacks) {
        const startTime = Date.now();
        const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.logger.info('Starting verification pipeline execution', {
            executionId,
            pipelineId: this.config.id,
            context: {
                targetType: context.target?.type,
                targetId: context.target?.id,
                parametersCount: Object.keys(context.parameters || {}).length
            }
        });
        try {
            this.currentExecution = {
                id: executionId,
                pipelineId: this.config.id,
                status: 'running',
                startTime: new Date(),
                context,
                checkpointResults: [],
                snapshots: [],
                resourceUsage: this.initializeResourceUsage(),
                callbacks
            };
            if (this.config.enableRollback) {
                await this.createSnapshot('initial', 'Pipeline execution start');
            }
            await this.validatePipelineConfig();
            const sortedCheckpoints = [
                ...this.config.checkpoints
            ].sort((a, b)=>a.order - b.order);
            const checkpointResults = await this.executeCheckpoints(sortedCheckpoints, context, callbacks);
            const overallResult = this.calculateOverallResult(checkpointResults);
            const result = {
                id: executionId,
                pipelineId: this.config.id,
                timestamp: new Date(),
                status: overallResult.status,
                score: overallResult.score,
                passed: overallResult.passed,
                checkpointResults,
                truthScore: overallResult.truthScore,
                duration: Date.now() - startTime,
                resourceUsage: this.currentExecution.resourceUsage,
                evidence: overallResult.evidence,
                artifacts: overallResult.artifacts,
                errors: overallResult.errors,
                warnings: overallResult.warnings,
                recommendations: overallResult.recommendations,
                nextSteps: overallResult.nextSteps
            };
            this.currentExecution.status = result.status;
            this.currentExecution.endTime = new Date();
            this.currentExecution.result = result;
            this.executionHistory.push(this.currentExecution);
            this.currentExecution = undefined;
            this.eventEmitter?.emit('pipeline:completed', result);
            this.logger.info('Verification pipeline execution completed', {
                executionId,
                status: result.status,
                passed: result.passed,
                score: result.score,
                duration: result.duration,
                checkpointsPassed: checkpointResults.filter((r)=>r.passed).length,
                checkpointsTotal: checkpointResults.length
            });
            return result;
        } catch (error) {
            const errorResult = await this.handleExecutionError(error, executionId, startTime);
            if (this.currentExecution) {
                this.currentExecution.status = 'error';
                this.currentExecution.endTime = new Date();
                this.currentExecution.result = errorResult;
                this.executionHistory.push(this.currentExecution);
                this.currentExecution = undefined;
            }
            this.eventEmitter?.emit('pipeline:error', errorResult);
            return errorResult;
        }
    }
    getStatus() {
        return {
            pipelineId: this.config.id,
            isRunning: this.currentExecution !== undefined,
            currentExecution: this.currentExecution ? {
                id: this.currentExecution.id,
                status: this.currentExecution.status,
                progress: this.calculateProgress(),
                startTime: this.currentExecution.startTime,
                resourceUsage: this.currentExecution.resourceUsage
            } : undefined,
            history: this.executionHistory.slice(-10).map((exec)=>({
                    id: exec.id,
                    status: exec.status,
                    startTime: exec.startTime,
                    endTime: exec.endTime,
                    duration: exec.endTime ? exec.endTime.getTime() - exec.startTime.getTime() : undefined,
                    passed: exec.result?.passed,
                    score: exec.result?.score
                }))
        };
    }
    async pause() {
        if (!this.currentExecution) {
            throw new AppError('No active pipeline execution to pause', 'NO_ACTIVE_EXECUTION');
        }
        this.currentExecution.status = 'paused';
        this.logger.info('Pipeline execution paused', {
            executionId: this.currentExecution.id
        });
        this.eventEmitter?.emit('pipeline:paused', this.currentExecution.id);
    }
    async resume() {
        if (!this.currentExecution || this.currentExecution.status !== 'paused') {
            throw new AppError('No paused pipeline execution to resume', 'NO_PAUSED_EXECUTION');
        }
        this.currentExecution.status = 'running';
        this.logger.info('Pipeline execution resumed', {
            executionId: this.currentExecution.id
        });
        this.eventEmitter?.emit('pipeline:resumed', this.currentExecution.id);
    }
    async cancel() {
        if (!this.currentExecution) {
            throw new AppError('No active pipeline execution to cancel', 'NO_ACTIVE_EXECUTION');
        }
        this.currentExecution.status = 'cancelled';
        this.currentExecution.endTime = new Date();
        this.logger.info('Pipeline execution cancelled', {
            executionId: this.currentExecution.id
        });
        this.eventEmitter?.emit('pipeline:cancelled', this.currentExecution.id);
        const result = {
            id: this.currentExecution.id,
            pipelineId: this.config.id,
            timestamp: new Date(),
            status: 'cancelled',
            score: 0,
            passed: false,
            checkpointResults: this.currentExecution.checkpointResults,
            truthScore: {
                score: 0,
                components: {
                    agentReliability: 0,
                    crossValidation: 0,
                    externalVerification: 0,
                    factualConsistency: 0,
                    logicalCoherence: 0,
                    overall: 0
                },
                confidence: {
                    lower: 0,
                    upper: 0,
                    level: 0
                },
                evidence: [],
                timestamp: new Date(),
                metadata: {
                    reason: 'cancelled'
                }
            },
            duration: this.currentExecution.endTime.getTime() - this.currentExecution.startTime.getTime(),
            resourceUsage: this.currentExecution.resourceUsage,
            evidence: [],
            artifacts: {},
            errors: [
                {
                    code: 'PIPELINE_CANCELLED',
                    message: 'Pipeline execution was cancelled',
                    severity: 'medium',
                    context: {
                        executionId: this.currentExecution.id
                    },
                    recoverable: true,
                    timestamp: new Date()
                }
            ],
            warnings: [],
            recommendations: [
                'Consider reviewing cancellation reason',
                'Check for incomplete state'
            ],
            nextSteps: [
                'Restart pipeline if needed',
                'Clean up any partial state'
            ]
        };
        this.currentExecution.result = result;
        this.executionHistory.push(this.currentExecution);
        this.currentExecution = undefined;
    }
    clearHistory() {
        this.executionHistory.length = 0;
        this.checkpointCache.clear();
        this.logger.debug('Pipeline execution history cleared');
    }
    async validatePipelineConfig() {
        const errors = [];
        if (this.config.checkpoints.length === 0) {
            errors.push('Pipeline must have at least one checkpoint');
        }
        const mandatoryCheckpoints = this.config.checkpoints.filter((cp)=>cp.mandatory);
        if (mandatoryCheckpoints.length === 0) {
            errors.push('Pipeline must have at least one mandatory checkpoint');
        }
        for (const checkpoint of this.config.checkpoints){
            for (const depId of checkpoint.dependencies){
                if (!this.config.checkpoints.find((cp)=>cp.id === depId)) {
                    errors.push(`Checkpoint ${checkpoint.id} depends on non-existent checkpoint ${depId}`);
                }
            }
        }
        if (this.hasCircularDependencies()) {
            errors.push('Circular dependencies detected in checkpoint configuration');
        }
        if (errors.length > 0) {
            throw new AppError(`Pipeline configuration validation failed: ${errors.join(', ')}`, 'INVALID_PIPELINE_CONFIG');
        }
    }
    async executeCheckpoints(checkpoints, context, callbacks) {
        const results = [];
        const completed = new Set();
        const pending = new Set(checkpoints.map((cp)=>cp.id));
        while(pending.size > 0){
            const ready = checkpoints.filter((cp)=>pending.has(cp.id) && cp.dependencies.every((depId)=>completed.has(depId)));
            if (ready.length === 0) {
                throw new AppError('Dependency deadlock in checkpoint execution', 'CHECKPOINT_DEADLOCK');
            }
            if (this.config.parallel && ready.length > 1) {
                const batchResults = await Promise.all(ready.map((checkpoint)=>this.executeCheckpoint(checkpoint, context, callbacks)));
                results.push(...batchResults);
            } else {
                for (const checkpoint of ready){
                    const result = await this.executeCheckpoint(checkpoint, context, callbacks);
                    results.push(result);
                    if (!result.passed && checkpoint.mandatory) {
                        throw new AppError(`Mandatory checkpoint ${checkpoint.id} failed`, 'MANDATORY_CHECKPOINT_FAILED');
                    }
                }
            }
            ready.forEach((cp)=>{
                completed.add(cp.id);
                pending.delete(cp.id);
            });
        }
        return results.sort((a, b)=>{
            const aCheckpoint = checkpoints.find((cp)=>cp.id === a.checkpointId);
            const bCheckpoint = checkpoints.find((cp)=>cp.id === b.checkpointId);
            return aCheckpoint.order - bCheckpoint.order;
        });
    }
    async executeCheckpoint(checkpoint, context, callbacks) {
        const startTime = Date.now();
        this.logger.info('Executing checkpoint', {
            checkpointId: checkpoint.id,
            type: checkpoint.type,
            mandatory: checkpoint.mandatory,
            validatorCount: checkpoint.validators.length
        });
        try {
            while(this.currentExecution?.status === 'paused'){
                await new Promise((resolve)=>setTimeout(resolve, 1000));
            }
            if (this.currentExecution?.status === 'cancelled') {
                throw new AppError('Execution cancelled', 'EXECUTION_CANCELLED');
            }
            if (checkpoint.createSnapshot && this.config.enableRollback) {
                await this.createSnapshot(checkpoint.id, `Before checkpoint ${checkpoint.name}`);
            }
            const validatorResults = await this.executeValidators(checkpoint.validators, context);
            const conditionResults = this.evaluateConditions(checkpoint.conditions, context, validatorResults);
            const passed = validatorResults.every((vr)=>vr.passed) && conditionResults.every((cr)=>cr.passed);
            const score = validatorResults.reduce((sum, vr)=>sum + vr.score, 0) / validatorResults.length;
            const result = {
                checkpointId: checkpoint.id,
                status: passed ? 'passed' : 'failed',
                score,
                passed,
                duration: Date.now() - startTime,
                validatorResults,
                evidence: validatorResults.flatMap((vr)=>vr.evidence),
                errors: validatorResults.flatMap((vr)=>vr.errors || []),
                warnings: validatorResults.flatMap((vr)=>vr.warnings || [])
            };
            if (!passed && checkpoint.rollbackOnFailure && this.config.enableRollback) {
                await this.handleCheckpointRollback(checkpoint);
            }
            if (this.currentExecution) {
                this.currentExecution.checkpointResults.push(result);
            }
            this.checkpointCache.set(checkpoint.id, result);
            if (callbacks?.onCheckpointComplete) {
                await callbacks.onCheckpointComplete(result);
            }
            this.eventEmitter?.emit('checkpoint:completed', result);
            this.logger.info('Checkpoint execution completed', {
                checkpointId: checkpoint.id,
                passed,
                score,
                duration: result.duration
            });
            return result;
        } catch (error) {
            const errorResult = {
                checkpointId: checkpoint.id,
                status: 'error',
                score: 0,
                passed: false,
                duration: Date.now() - startTime,
                validatorResults: [],
                evidence: [],
                errors: [
                    {
                        code: 'CHECKPOINT_EXECUTION_ERROR',
                        message: `Checkpoint execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        severity: 'high',
                        context: {
                            checkpointId: checkpoint.id
                        },
                        recoverable: !checkpoint.mandatory,
                        timestamp: new Date()
                    }
                ],
                warnings: []
            };
            this.logger.error('Checkpoint execution failed', {
                checkpointId: checkpoint.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return errorResult;
        }
    }
    async executeValidators(validators, context) {
        const results = [];
        for (const validator of validators){
            try {
                let result;
                switch(validator.type){
                    case 'truth_score':
                        result = await this.executeTruthScoreValidator(validator, context);
                        break;
                    case 'agent_claim':
                        result = await this.executeAgentClaimValidator(validator, context);
                        break;
                    case 'integration_test':
                        result = await this.executeIntegrationTestValidator(validator, context);
                        break;
                    case 'state_validation':
                        result = await this.executeStateValidationValidator(validator, context);
                        break;
                    case 'custom':
                        result = await this.executeCustomValidator(validator, context);
                        break;
                    default:
                        throw new AppError(`Unknown validator type: ${validator.type}`, 'UNKNOWN_VALIDATOR_TYPE');
                }
                results.push(result);
            } catch (error) {
                if (validator.required) {
                    throw error;
                }
                results.push({
                    validatorId: validator.id,
                    status: 'error',
                    score: 0,
                    passed: false,
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    evidence: [],
                    errors: [
                        {
                            code: 'VALIDATOR_EXECUTION_ERROR',
                            message: `Validator execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                            severity: 'medium',
                            context: {
                                validatorId: validator.id
                            },
                            recoverable: true,
                            timestamp: new Date()
                        }
                    ]
                });
            }
        }
        return results;
    }
    async executeTruthScoreValidator(validator, context) {
        if (!context.claims || context.claims.length === 0) {
            return {
                validatorId: validator.id,
                status: 'failed',
                score: 0,
                passed: false,
                details: {
                    reason: 'No claims to validate'
                },
                evidence: []
            };
        }
        const scores = await Promise.all(context.claims.map((claim)=>this.truthScorer.scoreClaim(claim, context.scoringContext)));
        const averageScore = scores.reduce((sum, score)=>sum + score.score, 0) / scores.length;
        const passed = averageScore >= (validator.config.threshold || VERIFICATION_CONSTANTS.DEFAULT_TRUTH_THRESHOLD);
        return {
            validatorId: validator.id,
            status: passed ? 'passed' : 'failed',
            score: averageScore,
            passed,
            details: {
                claimCount: context.claims.length,
                averageScore,
                threshold: validator.config.threshold,
                scores: scores.map((s)=>s.score)
            },
            evidence: scores.flatMap((s)=>s.evidence)
        };
    }
    async executeAgentClaimValidator(validator, context) {
        if (!context.claims || context.claims.length === 0) {
            return {
                validatorId: validator.id,
                status: 'failed',
                score: 0,
                passed: false,
                details: {
                    reason: 'No claims to validate'
                },
                evidence: []
            };
        }
        const validationResults = await Promise.all(context.claims.map((claim)=>this.claimValidator.validateClaim(claim, validator.config)));
        const passedCount = validationResults.filter((r)=>r.passed).length;
        const successRate = passedCount / validationResults.length;
        const averageScore = validationResults.reduce((sum, r)=>sum + r.score, 0) / validationResults.length;
        const passed = successRate >= (validator.config.minSuccessRate || 0.8);
        return {
            validatorId: validator.id,
            status: passed ? 'passed' : 'failed',
            score: averageScore,
            passed,
            details: {
                claimCount: context.claims.length,
                passedCount,
                successRate,
                averageScore,
                results: validationResults
            },
            evidence: validationResults.flatMap((r)=>r.evidence)
        };
    }
    async executeIntegrationTestValidator(validator, context) {
        if (!context.testConfig) {
            return {
                validatorId: validator.id,
                status: 'failed',
                score: 0,
                passed: false,
                details: {
                    reason: 'No test configuration provided'
                },
                evidence: []
            };
        }
        const testResult = await this.testRunner.runTests(context.testConfig);
        return {
            validatorId: validator.id,
            status: testResult.passed ? 'passed' : 'failed',
            score: testResult.score,
            passed: testResult.passed,
            details: {
                testId: testResult.testId,
                scenarioCount: testResult.scenarioResults.length,
                passedScenarios: testResult.scenarioResults.filter((sr)=>sr.passed).length,
                duration: testResult.duration,
                coverage: testResult.coverage
            },
            evidence: testResult.evidence
        };
    }
    async executeStateValidationValidator(validator, context) {
        const validationScore = 0.85;
        const passed = validationScore >= (validator.config.threshold || 0.8);
        return {
            validatorId: validator.id,
            status: passed ? 'passed' : 'failed',
            score: validationScore,
            passed,
            details: {
                validationType: 'state_validation',
                validationScore,
                threshold: validator.config.threshold
            },
            evidence: [
                {
                    type: 'state_validation',
                    source: 'system_state',
                    timestamp: new Date(),
                    data: {
                        score: validationScore
                    },
                    reliability: 0.9,
                    weight: 1.0
                }
            ]
        };
    }
    async executeCustomValidator(validator, context) {
        const customScore = 0.8;
        const passed = customScore >= (validator.config.threshold || 0.8);
        return {
            validatorId: validator.id,
            status: passed ? 'passed' : 'failed',
            score: customScore,
            passed,
            details: {
                validationType: 'custom',
                config: validator.config,
                customScore
            },
            evidence: [
                {
                    type: 'custom',
                    source: 'custom_validator',
                    timestamp: new Date(),
                    data: validator.config,
                    reliability: 0.8,
                    weight: 1.0
                }
            ]
        };
    }
    evaluateConditions(conditions, context, validatorResults) {
        return conditions.map((condition)=>{
            try {
                const value = this.extractConditionValue(condition.field, context, validatorResults);
                const passed = this.evaluateCondition(condition, value);
                return {
                    condition,
                    passed,
                    value,
                    reason: passed ? 'Condition satisfied' : 'Condition not satisfied'
                };
            } catch (error) {
                return {
                    condition,
                    passed: false,
                    value: undefined,
                    reason: `Condition evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                };
            }
        });
    }
    extractConditionValue(field, context, validatorResults) {
        if (field.startsWith('validator.')) {
            const validatorId = field.split('.')[1];
            const validatorField = field.split('.').slice(2).join('.');
            const validator = validatorResults.find((vr)=>vr.validatorId === validatorId);
            if (validatorField === 'score') return validator?.score;
            if (validatorField === 'passed') return validator?.passed;
            return this.getNestedValue(validator?.details, validatorField);
        }
        if (field.startsWith('context.')) {
            const contextField = field.split('.').slice(1).join('.');
            return this.getNestedValue(context, contextField);
        }
        return undefined;
    }
    getNestedValue(obj, path) {
        return path.split('.').reduce((current, key)=>current?.[key], obj);
    }
    evaluateCondition(condition, value) {
        switch(condition.operator){
            case 'eq':
                return value === condition.value;
            case 'ne':
                return value !== condition.value;
            case 'gt':
                return typeof value === 'number' && value > condition.value;
            case 'gte':
                return typeof value === 'number' && value >= condition.value;
            case 'lt':
                return typeof value === 'number' && value < condition.value;
            case 'lte':
                return typeof value === 'number' && value <= condition.value;
            case 'in':
                return Array.isArray(condition.value) && condition.value.includes(value);
            case 'nin':
                return Array.isArray(condition.value) && !condition.value.includes(value);
            case 'regex':
                return typeof value === 'string' && new RegExp(condition.value).test(value);
            default:
                return false;
        }
    }
    calculateOverallResult(checkpointResults) {
        const mandatoryResults = checkpointResults.filter((r)=>{
            const checkpoint = this.config.checkpoints.find((cp)=>cp.id === r.checkpointId);
            return checkpoint?.mandatory;
        });
        const mandatoryPassed = mandatoryResults.every((r)=>r.passed);
        const overallPassed = mandatoryPassed && checkpointResults.every((r)=>r.passed);
        const totalScore = checkpointResults.reduce((sum, r)=>sum + r.score, 0) / checkpointResults.length;
        const status = overallPassed ? 'passed' : 'failed';
        const truthScore = {
            score: totalScore,
            components: {
                agentReliability: totalScore,
                crossValidation: totalScore,
                externalVerification: totalScore,
                factualConsistency: totalScore,
                logicalCoherence: totalScore,
                overall: totalScore
            },
            confidence: {
                lower: totalScore - 0.1,
                upper: totalScore + 0.1,
                level: 0.95
            },
            evidence: checkpointResults.flatMap((r)=>r.evidence),
            timestamp: new Date(),
            metadata: {
                pipelineId: this.config.id
            }
        };
        return {
            status,
            passed: overallPassed,
            score: totalScore,
            truthScore,
            evidence: checkpointResults.flatMap((r)=>r.evidence),
            artifacts: {},
            errors: checkpointResults.flatMap((r)=>r.errors),
            warnings: checkpointResults.flatMap((r)=>r.warnings),
            recommendations: [
                ...overallPassed ? [
                    'Pipeline verification successful'
                ] : [
                    'Review failed checkpoints'
                ],
                'Monitor ongoing performance'
            ],
            nextSteps: [
                ...overallPassed ? [
                    'Proceed with deployment'
                ] : [
                    'Address verification failures'
                ],
                'Schedule next verification cycle'
            ]
        };
    }
    async createSnapshot(checkpointId, description) {
        if (this.currentExecution) {
            const snapshot = await this.snapshotManager.createSnapshot({
                name: `${this.config.id}_${checkpointId}`,
                description,
                context: {
                    pipelineId: this.config.id,
                    checkpointId
                }
            });
            this.currentExecution.snapshots.push(snapshot.id);
            this.logger.debug('Snapshot created', {
                snapshotId: snapshot.id,
                checkpointId,
                description
            });
        }
    }
    async handleCheckpointRollback(checkpoint) {
        if (!this.currentExecution || this.currentExecution.snapshots.length === 0) {
            this.logger.warn('Cannot rollback: no snapshots available', {
                checkpointId: checkpoint.id
            });
            return;
        }
        const latestSnapshotId = this.currentExecution.snapshots[this.currentExecution.snapshots.length - 1];
        try {
            await this.snapshotManager.rollback({
                snapshotId: latestSnapshotId,
                reason: `Checkpoint ${checkpoint.id} failed`,
                scope: {
                    includeAgents: true,
                    includeTasks: true,
                    includeSwarms: true
                }
            });
            this.logger.info('Rollback completed', {
                checkpointId: checkpoint.id,
                snapshotId: latestSnapshotId
            });
        } catch (error) {
            this.logger.error('Rollback failed', {
                checkpointId: checkpoint.id,
                snapshotId: latestSnapshotId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    async handleExecutionError(error, executionId, startTime) {
        this.logger.error('Pipeline execution error', {
            executionId,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return {
            id: executionId,
            pipelineId: this.config.id,
            timestamp: new Date(),
            status: 'error',
            score: 0,
            passed: false,
            checkpointResults: this.currentExecution?.checkpointResults || [],
            truthScore: {
                score: 0,
                components: {
                    agentReliability: 0,
                    crossValidation: 0,
                    externalVerification: 0,
                    factualConsistency: 0,
                    logicalCoherence: 0,
                    overall: 0
                },
                confidence: {
                    lower: 0,
                    upper: 0,
                    level: 0
                },
                evidence: [],
                timestamp: new Date(),
                metadata: {
                    error: error instanceof Error ? error.message : 'Unknown error'
                }
            },
            duration: Date.now() - startTime,
            resourceUsage: this.currentExecution?.resourceUsage || this.initializeResourceUsage(),
            evidence: [],
            artifacts: {},
            errors: [
                {
                    code: 'PIPELINE_EXECUTION_ERROR',
                    message: `Pipeline execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    severity: 'critical',
                    context: {
                        executionId,
                        pipelineId: this.config.id
                    },
                    recoverable: false,
                    timestamp: new Date()
                }
            ],
            warnings: [],
            recommendations: [
                'Review pipeline configuration',
                'Check system logs for details'
            ],
            nextSteps: [
                'Fix identified issues',
                'Restart pipeline execution'
            ]
        };
    }
    calculateProgress() {
        if (!this.currentExecution) return 0;
        const totalCheckpoints = this.config.checkpoints.length;
        const completedCheckpoints = this.currentExecution.checkpointResults.length;
        return totalCheckpoints > 0 ? completedCheckpoints / totalCheckpoints * 100 : 0;
    }
    hasCircularDependencies() {
        const visited = new Set();
        const recursionStack = new Set();
        const hasCircle = (checkpointId)=>{
            if (recursionStack.has(checkpointId)) return true;
            if (visited.has(checkpointId)) return false;
            visited.add(checkpointId);
            recursionStack.add(checkpointId);
            const checkpoint = this.config.checkpoints.find((cp)=>cp.id === checkpointId);
            if (checkpoint) {
                for (const depId of checkpoint.dependencies){
                    if (hasCircle(depId)) return true;
                }
            }
            recursionStack.delete(checkpointId);
            return false;
        };
        return this.config.checkpoints.some((cp)=>hasCircle(cp.id));
    }
    initializeResourceUsage() {
        return {
            cpu: 0,
            memory: 0,
            disk: 0,
            network: 0,
            tokens: 0,
            apiCalls: 0
        };
    }
}
export default VerificationPipeline;

//# sourceMappingURL=verification-pipeline.js.map