/**
 * Enhanced MCP Tools with Comprehensive Error Handling
 * Provides robust communication, validation, and recovery for MCP operations
 */

import { EnhancedMCPTools } from './mcp-tools-enhanced.js';
import { ErrorHandlingManager, ErrorCategory, ErrorSeverity } from './error-handling-manager.js';
import crypto from 'crypto';

// MCP-specific error types
export class MCPTimeoutError extends Error {
    constructor(operation, timeout) {
        super(`MCP operation ${operation} timed out after ${timeout}ms`);
        this.name = 'MCPTimeoutError';
        this.operation = operation;
        this.timeout = timeout;
    }
}

export class MCPValidationError extends Error {
    constructor(message, parameter, value) {
        super(message);
        this.name = 'MCPValidationError';
        this.parameter = parameter;
        this.value = value;
    }
}

export class MCPCommunicationError extends Error {
    constructor(message, operation, retryable = true) {
        super(message);
        this.name = 'MCPCommunicationError';
        this.operation = operation;
        this.retryable = retryable;
    }
}

/**
 * MCP Operation Validator
 */
class MCPValidator {
    static validateSwarmInit(params) {
        const errors = [];
        
        if (params.topology && !['mesh', 'hierarchical', 'ring', 'star', 'centralized', 'distributed'].includes(params.topology)) {
            errors.push(new MCPValidationError(
                'Invalid topology. Must be one of: mesh, hierarchical, ring, star, centralized, distributed',
                'topology',
                params.topology
            ));
        }
        
        if (params.maxAgents !== undefined) {
            if (typeof params.maxAgents !== 'number' || params.maxAgents < 1 || params.maxAgents > 1000) {
                errors.push(new MCPValidationError(
                    'maxAgents must be a number between 1 and 1000',
                    'maxAgents',
                    params.maxAgents
                ));
            }
        }
        
        if (params.strategy && !['balanced', 'specialized', 'adaptive', 'parallel'].includes(params.strategy)) {
            errors.push(new MCPValidationError(
                'Invalid strategy. Must be one of: balanced, specialized, adaptive, parallel',
                'strategy',
                params.strategy
            ));
        }
        
        return errors;
    }
    
    static validateAgentSpawn(params) {
        const errors = [];
        
        if (params.type && !['coordinator', 'researcher', 'coder', 'analyst', 'architect', 'tester', 'reviewer', 'optimizer', 'documenter', 'monitor', 'specialist'].includes(params.type)) {
            errors.push(new MCPValidationError(
                'Invalid agent type. Must be one of: coordinator, researcher, coder, analyst, architect, tester, reviewer, optimizer, documenter, monitor, specialist',
                'type',
                params.type
            ));
        }
        
        if (params.name && (typeof params.name !== 'string' || params.name.length === 0 || params.name.length > 100)) {
            errors.push(new MCPValidationError(
                'Agent name must be a non-empty string with max length of 100 characters',
                'name',
                params.name
            ));
        }
        
        if (params.capabilities && !Array.isArray(params.capabilities)) {
            errors.push(new MCPValidationError(
                'Capabilities must be an array',
                'capabilities',
                params.capabilities
            ));
        }
        
        return errors;
    }
    
    static validateTaskOrchestrate(params) {
        const errors = [];
        
        if (!params.task || typeof params.task !== 'string' || params.task.trim().length === 0) {
            errors.push(new MCPValidationError(
                'Task description is required and must be a non-empty string',
                'task',
                params.task
            ));
        }
        
        if (params.priority && !['low', 'medium', 'high', 'critical'].includes(params.priority)) {
            errors.push(new MCPValidationError(
                'Invalid priority. Must be one of: low, medium, high, critical',
                'priority',
                params.priority
            ));
        }
        
        if (params.maxAgents !== undefined) {
            if (typeof params.maxAgents !== 'number' || params.maxAgents < 1 || params.maxAgents > 100) {
                errors.push(new MCPValidationError(
                    'maxAgents must be a number between 1 and 100',
                    'maxAgents',
                    params.maxAgents
                ));
            }
        }
        
        return errors;
    }
    
    static validateNeuralTrain(params) {
        const errors = [];
        
        if (!params.agentId || typeof params.agentId !== 'string') {
            errors.push(new MCPValidationError(
                'agentId is required and must be a string',
                'agentId',
                params.agentId
            ));
        }
        
        if (params.iterations !== undefined) {
            if (typeof params.iterations !== 'number' || params.iterations < 1 || params.iterations > 10000) {
                errors.push(new MCPValidationError(
                    'iterations must be a number between 1 and 10000',
                    'iterations',
                    params.iterations
                ));
            }
        }
        
        if (params.learningRate !== undefined) {
            if (typeof params.learningRate !== 'number' || params.learningRate <= 0 || params.learningRate > 1) {
                errors.push(new MCPValidationError(
                    'learningRate must be a number between 0 and 1 (exclusive of 0)',
                    'learningRate',
                    params.learningRate
                ));
            }
        }
        
        return errors;
    }
}

/**
 * Enhanced MCP Tools with robust error handling
 */
export class RobustMCPTools {
    constructor(ruvSwarmInstance = null, options = {}) {
        this.baseMCP = new EnhancedMCPTools(ruvSwarmInstance);
        this.errorHandler = new ErrorHandlingManager({
            retry: {
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 15000,
                backoffMultiplier: 2
            },
            circuitBreaker: {
                failureThreshold: 5,
                recoveryTimeout: 30000
            },
            ...options.errorHandling
        });
        
        // MCP-specific configurations
        this.operationTimeouts = {
            swarm_init: 30000,
            agent_spawn: 15000,
            task_orchestrate: 20000,
            neural_train: 60000,
            benchmark_run: 120000,
            memory_usage: 5000,
            swarm_status: 5000,
            task_status: 5000,
            task_results: 10000
        };
        
        this.validationCache = new Map();
        this.operationHistory = [];
        this.maxHistorySize = 1000;
        
        // Performance monitoring
        this.performanceMetrics = {
            totalOperations: 0,
            successfulOperations: 0,
            failedOperations: 0,
            averageResponseTime: 0,
            operationCounts: {}
        };
        
        this.setupEventHandlers();
    }

    /**
     * Initialize with comprehensive error handling
     */
    async initialize(ruvSwarmInstance = null) {
        return await this.errorHandler.wrapOperation(async () => {
            console.log('🔧 Initializing robust MCP tools...');
            
            // Validate ruv-swarm instance if provided
            if (ruvSwarmInstance && !this.validateRuvSwarmInstance(ruvSwarmInstance)) {
                throw new Error('Invalid ruv-swarm instance provided');
            }
            
            const result = await this.withTimeout(
                this.baseMCP.initialize(ruvSwarmInstance),
                30000,
                'MCP initialization'
            );
            
            console.log('✅ Robust MCP tools initialized successfully');
            return result;
        }, {
            category: ErrorCategory.MCP,
            component: 'mcp-tools',
            operation: 'initialize'
        });
    }

    /**
     * Enhanced swarm_init with validation and error recovery
     */
    async swarm_init(params = {}) {
        return await this.executeValidatedOperation('swarm_init', params, async (validatedParams) => {
            // Pre-operation checks
            await this.preOperationChecks('swarm_init');
            
            const result = await this.withTimeout(
                this.baseMCP.swarm_init(validatedParams),
                this.operationTimeouts.swarm_init,
                'swarm_init'
            );
            
            // Post-operation validation
            this.validateSwarmInitResult(result);
            
            return result;
        });
    }

    /**
     * Enhanced agent_spawn with validation and monitoring
     */
    async agent_spawn(params = {}) {
        return await this.executeValidatedOperation('agent_spawn', params, async (validatedParams) => {
            await this.preOperationChecks('agent_spawn');
            
            const result = await this.withTimeout(
                this.baseMCP.agent_spawn(validatedParams),
                this.operationTimeouts.agent_spawn,
                'agent_spawn'
            );
            
            this.validateAgentSpawnResult(result);
            
            return result;
        });
    }

    /**
     * Enhanced task_orchestrate with dependency checking
     */
    async task_orchestrate(params = {}) {
        return await this.executeValidatedOperation('task_orchestrate', params, async (validatedParams) => {
            await this.preOperationChecks('task_orchestrate');
            
            // Check for available agents before orchestration
            await this.checkAgentAvailability(validatedParams);
            
            const result = await this.withTimeout(
                this.baseMCP.task_orchestrate(validatedParams),
                this.operationTimeouts.task_orchestrate,
                'task_orchestrate'
            );
            
            this.validateTaskOrchestrationResult(result);
            
            return result;
        });
    }

    /**
     * Enhanced neural_train with comprehensive validation
     */
    async neural_train(params = {}) {
        return await this.executeValidatedOperation('neural_train', params, async (validatedParams) => {
            await this.preOperationChecks('neural_train');
            
            // Verify neural capabilities are available
            await this.verifyNeuralCapabilities();
            
            // Check agent exists and is capable of neural training
            await this.verifyAgentForNeuralTraining(validatedParams.agentId);
            
            const result = await this.withTimeout(
                this.baseMCP.neural_train(validatedParams),
                this.operationTimeouts.neural_train,
                'neural_train'
            );
            
            this.validateNeuralTrainResult(result);
            
            return result;
        });
    }

    /**
     * Enhanced task_results with comprehensive error handling
     */
    async task_results(params = {}) {
        return await this.executeValidatedOperation('task_results', params, async (validatedParams) => {
            await this.preOperationChecks('task_results');
            
            // Verify task exists
            if (validatedParams.taskId) {
                await this.verifyTaskExists(validatedParams.taskId);
            }
            
            const result = await this.withTimeout(
                this.baseMCP.task_results(validatedParams),
                this.operationTimeouts.task_results,
                'task_results'
            );
            
            this.validateTaskResultsResponse(result);
            
            return result;
        });
    }

    /**
     * Enhanced benchmark_run with resource monitoring
     */
    async benchmark_run(params = {}) {
        return await this.executeValidatedOperation('benchmark_run', params, async (validatedParams) => {
            await this.preOperationChecks('benchmark_run');
            
            // Check system resources before benchmark
            const resourceCheck = await this.checkSystemResources();
            if (!resourceCheck.suitable) {
                console.warn('⚠️ System resources may be insufficient for benchmarking:', resourceCheck.warnings);
            }
            
            const result = await this.withTimeout(
                this.baseMCP.benchmark_run(validatedParams),
                this.operationTimeouts.benchmark_run,
                'benchmark_run'
            );
            
            this.validateBenchmarkResult(result);
            
            return result;
        });
    }

    /**
     * Execute operation with validation and error handling
     */
    async executeValidatedOperation(operationName, params, operation) {
        const operationId = crypto.randomUUID();
        const startTime = Date.now();
        
        try {
            // Validate parameters
            const validatedParams = await this.validateParameters(operationName, params);
            
            // Record operation start
            this.recordOperationStart(operationId, operationName, validatedParams);
            
            // Execute operation with error handling
            const result = await this.errorHandler.wrapOperation(operation, {
                category: ErrorCategory.MCP,
                component: 'mcp-tools',
                operation: operationName,
                operationId,
                parameters: validatedParams
            })(validatedParams);
            
            // Record successful operation
            this.recordOperationEnd(operationId, true, Date.now() - startTime, result);
            
            return result;
        } catch (error) {
            // Record failed operation
            this.recordOperationEnd(operationId, false, Date.now() - startTime, null, error);
            
            // Enhance error with operation context
            const enhancedError = this.enhanceError(error, operationName, params);
            throw enhancedError;
        }
    }

    /**
     * Validate operation parameters
     */
    async validateParameters(operationName, params) {
        // Check cache first
        const cacheKey = `${operationName}_${JSON.stringify(params)}`;
        if (this.validationCache.has(cacheKey)) {
            return this.validationCache.get(cacheKey);
        }
        
        let validationErrors = [];
        
        // Operation-specific validation
        switch (operationName) {
            case 'swarm_init':
                validationErrors = MCPValidator.validateSwarmInit(params);
                break;
            case 'agent_spawn':
                validationErrors = MCPValidator.validateAgentSpawn(params);
                break;
            case 'task_orchestrate':
                validationErrors = MCPValidator.validateTaskOrchestrate(params);
                break;
            case 'neural_train':
                validationErrors = MCPValidator.validateNeuralTrain(params);
                break;
            // Add more validators as needed
        }
        
        if (validationErrors.length > 0) {
            const errorMessages = validationErrors.map(e => e.message).join('; ');
            throw new MCPValidationError(`Parameter validation failed: ${errorMessages}`, 'multiple', params);
        }
        
        // Cache successful validation
        this.validationCache.set(cacheKey, params);
        
        // Limit cache size
        if (this.validationCache.size > 1000) {
            const firstKey = this.validationCache.keys().next().value;
            this.validationCache.delete(firstKey);
        }
        
        return params;
    }

    /**
     * Pre-operation checks
     */
    async preOperationChecks(operationName) {
        // Check if MCP tools are initialized
        if (!this.baseMCP.ruvSwarm) {
            throw new MCPCommunicationError('MCP tools not properly initialized', operationName);
        }
        
        // Check system health
        const health = await this.checkSystemHealth();
        if (!health.healthy && health.severity === 'critical') {
            throw new MCPCommunicationError(`System health critical, cannot execute ${operationName}`, operationName, false);
        }
        
        // Check operation-specific requirements
        await this.checkOperationRequirements(operationName);
    }

    /**
     * Check system health before operations
     */
    async checkSystemHealth() {
        try {
            const memoryUsage = process.memoryUsage();
            const memoryUsageMB = memoryUsage.used / (1024 * 1024);
            
            const health = {
                healthy: true,
                severity: 'normal',
                issues: []
            };
            
            // Memory check
            if (memoryUsageMB > 1000) { // > 1GB
                health.issues.push(`High memory usage: ${memoryUsageMB.toFixed(2)}MB`);
                health.severity = 'warning';
            }
            
            if (memoryUsageMB > 2000) { // > 2GB
                health.healthy = false;
                health.severity = 'critical';
            }
            
            // CPU usage check (simplified)
            const loadAverage = process.loadavg ? process.loadavg()[0] : 0;
            if (loadAverage > 2.0) {
                health.issues.push(`High CPU load: ${loadAverage.toFixed(2)}`);
                health.severity = health.severity === 'critical' ? 'critical' : 'warning';
            }
            
            return health;
        } catch (error) {
            return {
                healthy: false,
                severity: 'warning',
                issues: [`Health check failed: ${error.message}`]
            };
        }
    }

    /**
     * Check operation-specific requirements
     */
    async checkOperationRequirements(operationName) {
        switch (operationName) {
            case 'neural_train':
                await this.verifyNeuralCapabilities();
                break;
            case 'benchmark_run':
                const resources = await this.checkSystemResources();
                if (!resources.suitable) {
                    console.warn('⚠️ System may not be suitable for benchmarking');
                }
                break;
            // Add more requirement checks
        }
    }

    /**
     * Verify neural capabilities are available
     */
    async verifyNeuralCapabilities() {
        try {
            const features = await this.baseMCP.features_detect({ category: 'neural_networks' });
            if (!features.available) {
                throw new MCPCommunicationError('Neural network capabilities not available', 'neural_train', false);
            }
        } catch (error) {
            throw new MCPCommunicationError(`Failed to verify neural capabilities: ${error.message}`, 'neural_train', true);
        }
    }

    /**
     * Check system resources for resource-intensive operations
     */
    async checkSystemResources() {
        const memoryUsage = process.memoryUsage();
        const memoryUsageMB = memoryUsage.used / (1024 * 1024);
        
        return {
            suitable: memoryUsageMB < 1500, // Less than 1.5GB
            warnings: memoryUsageMB > 1000 ? [`High memory usage: ${memoryUsageMB.toFixed(2)}MB`] : [],
            memory_mb: memoryUsageMB,
            uptime_hours: process.uptime() / 3600
        };
    }

    /**
     * Verify agent exists and capabilities for neural training
     */
    async verifyAgentForNeuralTraining(agentId) {
        try {
            const agents = await this.baseMCP.agent_list({ filter: 'all' });
            const agent = agents.agents.find(a => a.id === agentId);
            
            if (!agent) {
                throw new MCPValidationError(`Agent not found: ${agentId}`, 'agentId', agentId);
            }
            
            if (agent.status === 'error' || agent.status === 'offline') {
                throw new MCPCommunicationError(`Agent ${agentId} is not available (status: ${agent.status})`, 'neural_train', true);
            }
        } catch (error) {
            if (error instanceof MCPValidationError || error instanceof MCPCommunicationError) {
                throw error;
            }
            throw new MCPCommunicationError(`Failed to verify agent ${agentId}: ${error.message}`, 'neural_train', true);
        }
    }

    /**
     * Verify task exists
     */
    async verifyTaskExists(taskId) {
        try {
            const status = await this.baseMCP.task_status({ taskId });
            if (!status || !status.id) {
                throw new MCPValidationError(`Task not found: ${taskId}`, 'taskId', taskId);
            }
        } catch (error) {
            if (error instanceof MCPValidationError) {
                throw error;
            }
            throw new MCPCommunicationError(`Failed to verify task ${taskId}: ${error.message}`, 'task_results', true);
        }
    }

    /**
     * Check agent availability for task orchestration
     */
    async checkAgentAvailability(params) {
        try {
            const agents = await this.baseMCP.agent_list({ filter: 'idle' });
            const availableAgents = agents.agents || [];
            
            if (availableAgents.length === 0) {
                throw new MCPCommunicationError('No idle agents available for task orchestration', 'task_orchestrate', false);
            }
            
            const maxAgents = params.maxAgents || availableAgents.length;
            if (availableAgents.length < maxAgents) {
                console.warn(`⚠️ Requested ${maxAgents} agents but only ${availableAgents.length} available`);
            }
        } catch (error) {
            if (error instanceof MCPCommunicationError) {
                throw error;
            }
            throw new MCPCommunicationError(`Failed to check agent availability: ${error.message}`, 'task_orchestrate', true);
        }
    }

    /**
     * Add timeout to operations
     */
    async withTimeout(promise, timeoutMs, operationName) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new MCPTimeoutError(operationName, timeoutMs));
            }, timeoutMs);
        });
        
        return Promise.race([promise, timeoutPromise]);
    }

    /**
     * Validate operation results
     */
    validateSwarmInitResult(result) {
        if (!result || !result.id) {
            throw new Error('Invalid swarm_init result: missing swarm ID');
        }
        if (!result.topology || !result.maxAgents) {
            throw new Error('Invalid swarm_init result: missing required fields');
        }
    }

    validateAgentSpawnResult(result) {
        if (!result || !result.agent || !result.agent.id) {
            throw new Error('Invalid agent_spawn result: missing agent information');
        }
    }

    validateTaskOrchestrationResult(result) {
        if (!result || !result.taskId) {
            throw new Error('Invalid task_orchestrate result: missing task ID');
        }
        if (!result.assigned_agents || result.assigned_agents.length === 0) {
            throw new Error('Invalid task_orchestrate result: no agents assigned');
        }
    }

    validateNeuralTrainResult(result) {
        if (!result || !result.training_complete) {
            throw new Error('Invalid neural_train result: training not completed');
        }
        if (typeof result.final_accuracy !== 'number' || result.final_accuracy < 0 || result.final_accuracy > 1) {
            throw new Error('Invalid neural_train result: invalid accuracy value');
        }
    }

    validateTaskResultsResponse(result) {
        if (!result || !result.task_id) {
            throw new Error('Invalid task_results response: missing task ID');
        }
    }

    validateBenchmarkResult(result) {
        if (!result || !result.results) {
            throw new Error('Invalid benchmark_run result: missing results');
        }
    }

    /**
     * Enhance error with additional context
     */
    enhanceError(error, operationName, params) {
        if (error instanceof MCPTimeoutError || 
            error instanceof MCPValidationError || 
            error instanceof MCPCommunicationError) {
            return error; // Already enhanced
        }
        
        // Add operation context to generic errors
        const enhancedError = new MCPCommunicationError(
            `${operationName} failed: ${error.message}`,
            operationName,
            this.isRetryableError(error)
        );
        
        enhancedError.originalError = error;
        enhancedError.parameters = params;
        enhancedError.timestamp = new Date().toISOString();
        
        return enhancedError;
    }

    /**
     * Determine if error is retryable
     */
    isRetryableError(error) {
        const retryablePatterns = [
            'timeout',
            'network',
            'connection',
            'temporary',
            'busy',
            'rate limit',
            'service unavailable'
        ];
        
        const errorMessage = error.message.toLowerCase();
        return retryablePatterns.some(pattern => errorMessage.includes(pattern));
    }

    /**
     * Record operation metrics
     */
    recordOperationStart(operationId, operationName, params) {
        this.performanceMetrics.totalOperations++;
        this.performanceMetrics.operationCounts[operationName] = 
            (this.performanceMetrics.operationCounts[operationName] || 0) + 1;
        
        this.operationHistory.push({
            id: operationId,
            operation: operationName,
            startTime: Date.now(),
            parameters: JSON.stringify(params),
            status: 'running'
        });
        
        // Maintain history size
        if (this.operationHistory.length > this.maxHistorySize) {
            this.operationHistory.shift();
        }
    }

    recordOperationEnd(operationId, success, duration, result, error) {
        const operation = this.operationHistory.find(op => op.id === operationId);
        if (operation) {
            operation.endTime = Date.now();
            operation.duration = duration;
            operation.status = success ? 'completed' : 'failed';
            operation.error = error?.message;
            operation.result = success ? 'success' : 'error';
        }
        
        if (success) {
            this.performanceMetrics.successfulOperations++;
        } else {
            this.performanceMetrics.failedOperations++;
        }
        
        // Update average response time
        const totalSuccessful = this.performanceMetrics.successfulOperations;
        if (success && totalSuccessful > 0) {
            this.performanceMetrics.averageResponseTime = 
                ((this.performanceMetrics.averageResponseTime * (totalSuccessful - 1)) + duration) / totalSuccessful;
        }
    }

    /**
     * Setup event handlers for monitoring
     */
    setupEventHandlers() {
        this.errorHandler.on('error', (errorRecord) => {
            console.error(`🚨 MCP Error: ${errorRecord.operation} - ${errorRecord.error.message}`);
        });
        
        this.errorHandler.on('criticalError', (errorRecord) => {
            console.error(`💥 Critical MCP Error: ${errorRecord.operation} - Manual intervention may be required`);
        });
        
        this.errorHandler.on('healthStatusChange', (status) => {
            if (!status.isHealthy) {
                console.warn('⚠️ MCP system health degraded:', status.metrics);
            } else {
                console.log('✅ MCP system health restored');
            }
        });
    }

    /**
     * Validate ruv-swarm instance
     */
    validateRuvSwarmInstance(instance) {
        return instance && 
               typeof instance === 'object' &&
               typeof instance.createSwarm === 'function' &&
               typeof instance.getGlobalMetrics === 'function';
    }

    /**
     * Get comprehensive health status
     */
    async getHealthStatus() {
        const systemHealth = await this.checkSystemHealth();
        const errorHandlerHealth = this.errorHandler.getHealthStatus();
        
        return {
            mcp_tools: {
                initialized: !!this.baseMCP.ruvSwarm,
                system_health: systemHealth,
                performance_metrics: this.performanceMetrics,
                operation_history_size: this.operationHistory.length,
                validation_cache_size: this.validationCache.size
            },
            error_handling: errorHandlerHealth,
            overall_health: systemHealth.healthy && errorHandlerHealth.isHealthy,
            recommendations: this.generateHealthRecommendations(systemHealth, errorHandlerHealth)
        };
    }

    /**
     * Generate health recommendations
     */
    generateHealthRecommendations(systemHealth, errorHandlerHealth) {
        const recommendations = [];
        
        if (!systemHealth.healthy) {
            recommendations.push({
                type: 'system_health',
                priority: 'high',
                message: 'System health issues detected',
                issues: systemHealth.issues,
                actions: ['Monitor memory usage', 'Check CPU load', 'Consider restarting processes']
            });
        }
        
        const failureRate = this.performanceMetrics.totalOperations > 0 ? 
            this.performanceMetrics.failedOperations / this.performanceMetrics.totalOperations : 0;
        
        if (failureRate > 0.1) { // >10% failure rate
            recommendations.push({
                type: 'high_failure_rate',
                priority: 'medium',
                message: `High failure rate: ${(failureRate * 100).toFixed(1)}%`,
                actions: ['Review error logs', 'Check system resources', 'Validate parameters']
            });
        }
        
        if (this.performanceMetrics.averageResponseTime > 10000) { // >10 seconds
            recommendations.push({
                type: 'slow_responses',
                priority: 'medium',
                message: `Slow average response time: ${this.performanceMetrics.averageResponseTime.toFixed(0)}ms`,
                actions: ['Check network connectivity', 'Monitor system load', 'Consider increasing timeouts']
            });
        }
        
        return recommendations;
    }

    /**
     * Pass through other MCP methods with error handling wrapper
     */
    async swarm_status(params = {}) {
        return await this.executeValidatedOperation('swarm_status', params, 
            async (p) => await this.withTimeout(
                this.baseMCP.swarm_status(p), 
                this.operationTimeouts.swarm_status, 
                'swarm_status'
            )
        );
    }

    async task_status(params = {}) {
        return await this.executeValidatedOperation('task_status', params,
            async (p) => await this.withTimeout(
                this.baseMCP.task_status(p),
                this.operationTimeouts.task_status,
                'task_status'
            )
        );
    }

    async agent_list(params = {}) {
        return await this.executeValidatedOperation('agent_list', params,
            async (p) => await this.withTimeout(
                this.baseMCP.agent_list(p),
                5000,
                'agent_list'
            )
        );
    }

    async memory_usage(params = {}) {
        return await this.executeValidatedOperation('memory_usage', params,
            async (p) => await this.withTimeout(
                this.baseMCP.memory_usage(p),
                this.operationTimeouts.memory_usage,
                'memory_usage'
            )
        );
    }

    async features_detect(params = {}) {
        return await this.executeValidatedOperation('features_detect', params,
            async (p) => await this.withTimeout(
                this.baseMCP.features_detect(p),
                10000,
                'features_detect'
            )
        );
    }

    async neural_status(params = {}) {
        return await this.executeValidatedOperation('neural_status', params,
            async (p) => await this.withTimeout(
                this.baseMCP.neural_status(p),
                5000,
                'neural_status'
            )
        );
    }

    async neural_patterns(params = {}) {
        return await this.executeValidatedOperation('neural_patterns', params,
            async (p) => await this.withTimeout(
                this.baseMCP.neural_patterns(p),
                5000,
                'neural_patterns'
            )
        );
    }

    async agent_metrics(params = {}) {
        return await this.executeValidatedOperation('agent_metrics', params,
            async (p) => await this.withTimeout(
                this.baseMCP.agent_metrics(p),
                10000,
                'agent_metrics'
            )
        );
    }

    async swarm_monitor(params = {}) {
        return await this.executeValidatedOperation('swarm_monitor', params,
            async (p) => await this.withTimeout(
                this.baseMCP.swarm_monitor(p),
                15000,
                'swarm_monitor'
            )
        );
    }
}

export default RobustMCPTools;