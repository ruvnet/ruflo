/**
 * Comprehensive Error Handling Manager for ruv-swarm
 * Provides robust error recovery, logging, and monitoring across all integration components
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

// Error severity levels
export const ErrorSeverity = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical'
};

// Error categories
export const ErrorCategory = {
    PERSISTENCE: 'persistence',
    WASM: 'wasm',
    MCP: 'mcp',
    NEURAL: 'neural',
    COORDINATION: 'coordination',
    NETWORK: 'network',
    MEMORY: 'memory',
    VALIDATION: 'validation'
};

// Recovery strategies
export const RecoveryStrategy = {
    RETRY: 'retry',
    FALLBACK: 'fallback',
    CIRCUIT_BREAKER: 'circuit_breaker',
    GRACEFUL_DEGRADATION: 'graceful_degradation',
    RESTART: 'restart',
    MANUAL_INTERVENTION: 'manual_intervention'
};

/**
 * Circuit Breaker implementation for external dependencies
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.name = options.name || 'default';
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 30000; // 30 seconds
        this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
        this.successCount = 0;
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            circuitOpened: 0
        };
    }

    async execute(operation) {
        this.stats.totalRequests++;

        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker ${this.name} is OPEN. Next attempt at ${new Date(this.nextAttempt)}`);
            }
            this.state = 'HALF_OPEN';
            this.successCount = 0;
        }

        try {
            const result = await operation();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.failures = 0;
        this.stats.successfulRequests++;
        
        if (this.state === 'HALF_OPEN') {
            this.successCount++;
            if (this.successCount >= 3) { // Require 3 successes to close
                this.state = 'CLOSED';
            }
        }
    }

    onFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        this.stats.failedRequests++;

        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.recoveryTimeout;
            this.stats.circuitOpened++;
        }
    }

    getStats() {
        return {
            ...this.stats,
            state: this.state,
            failures: this.failures,
            lastFailureTime: this.lastFailureTime
        };
    }
}

/**
 * Retry manager with exponential backoff
 */
class RetryManager {
    constructor(options = {}) {
        this.maxRetries = options.maxRetries || 3;
        this.initialDelay = options.initialDelay || 1000;
        this.maxDelay = options.maxDelay || 30000;
        this.backoffMultiplier = options.backoffMultiplier || 2;
        this.jitterMax = options.jitterMax || 0.1;
    }

    async execute(operation, operationName = 'unknown') {
        let lastError;
        
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                
                if (attempt === this.maxRetries) {
                    break;
                }

                // Check if error is retryable
                if (!this.isRetryable(error)) {
                    throw error;
                }

                const delay = this.calculateDelay(attempt);
                console.warn(`Retry ${attempt + 1}/${this.maxRetries} for ${operationName} failed: ${error.message}. Retrying in ${delay}ms`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw new Error(`Operation ${operationName} failed after ${this.maxRetries + 1} attempts. Last error: ${lastError.message}`);
    }

    isRetryable(error) {
        // Network errors, timeouts, and temporary database issues are retryable
        const retryableErrors = [
            'ECONNREFUSED',
            'ECONNRESET', 
            'ETIMEDOUT',
            'ENOTFOUND',
            'SQLITE_BUSY',
            'SQLITE_LOCKED',
            'timeout',
            'network',
            'temporary'
        ];

        const errorMessage = error.message.toLowerCase();
        return retryableErrors.some(retryable => 
            errorMessage.includes(retryable) || error.code === retryable
        );
    }

    calculateDelay(attempt) {
        const exponentialDelay = this.initialDelay * Math.pow(this.backoffMultiplier, attempt);
        const clampedDelay = Math.min(exponentialDelay, this.maxDelay);
        
        // Add jitter to prevent thundering herd
        const jitter = clampedDelay * this.jitterMax * Math.random();
        return Math.floor(clampedDelay + jitter);
    }
}

/**
 * Main Error Handling Manager
 */
export class ErrorHandlingManager extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.correlationId = crypto.randomUUID();
        this.circuitBreakers = new Map();
        this.retryManager = new RetryManager(options.retry);
        this.errorLog = [];
        this.maxLogSize = options.maxLogSize || 1000;
        this.alertThresholds = options.alertThresholds || {
            errorRate: 0.1, // 10% error rate triggers alert
            criticalErrors: 5, // 5 critical errors in monitoring period
            circuitBreakerOpenings: 3
        };
        
        // Monitoring state
        this.monitoringWindow = options.monitoringWindow || 300000; // 5 minutes
        this.healthCheckInterval = options.healthCheckInterval || 60000; // 1 minute
        this.isHealthy = true;
        this.lastHealthCheck = Date.now();
        
        // Start background monitoring
        this.startHealthMonitoring();
    }

    /**
     * Wrap operations with comprehensive error handling
     */
    async wrapOperation(operation, context = {}) {
        const operationId = crypto.randomUUID();
        const startTime = Date.now();
        
        const operationContext = {
            operationId,
            correlationId: this.correlationId,
            category: context.category || ErrorCategory.COORDINATION,
            component: context.component || 'unknown',
            operation: context.operation || 'unknown',
            startTime,
            ...context
        };

        try {
            // Get or create circuit breaker for this operation
            const circuitBreakerKey = `${operationContext.component}_${operationContext.operation}`;
            const circuitBreaker = this.getCircuitBreaker(circuitBreakerKey, context.circuitBreaker);

            // Execute with circuit breaker and retry logic
            const result = await circuitBreaker.execute(async () => {
                return await this.retryManager.execute(operation, operationContext.operation);
            });

            // Log successful operation
            this.logSuccess(operationContext, Date.now() - startTime);
            
            return result;
        } catch (error) {
            // Handle and log error
            return await this.handleError(error, operationContext);
        }
    }

    /**
     * Handle different types of errors with appropriate strategies
     */
    async handleError(error, context) {
        const errorRecord = this.createErrorRecord(error, context);
        
        // Log error
        this.logError(errorRecord);
        
        // Emit error event for monitoring
        this.emit('error', errorRecord);
        
        // Determine recovery strategy
        const strategy = this.determineRecoveryStrategy(error, context);
        
        try {
            return await this.executeRecoveryStrategy(strategy, error, context);
        } catch (recoveryError) {
            // Recovery failed, escalate
            const escalatedError = this.createErrorRecord(recoveryError, {
                ...context,
                originalError: error,
                recoveryStrategy: strategy,
                escalated: true
            });
            
            this.logError(escalatedError);
            this.emit('criticalError', escalatedError);
            
            throw new Error(`Operation failed and recovery unsuccessful. Original: ${error.message}, Recovery: ${recoveryError.message}`);
        }
    }

    /**
     * Create comprehensive error record
     */
    createErrorRecord(error, context) {
        return {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            correlationId: context.correlationId || this.correlationId,
            operationId: context.operationId,
            severity: this.determineSeverity(error, context),
            category: context.category || ErrorCategory.COORDINATION,
            component: context.component || 'unknown',
            operation: context.operation || 'unknown',
            error: {
                name: error.name,
                message: error.message,
                code: error.code,
                stack: error.stack,
                cause: error.cause
            },
            context: {
                ...context,
                executionTime: context.startTime ? Date.now() - context.startTime : 0
            },
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            }
        };
    }

    /**
     * Determine error severity
     */
    determineSeverity(error, context) {
        // Critical errors that affect system stability
        if (error.message.includes('memory') || 
            error.message.includes('corruption') ||
            error.message.includes('fatal') ||
            context.category === ErrorCategory.MEMORY) {
            return ErrorSeverity.CRITICAL;
        }

        // High severity errors that affect functionality
        if (error.message.includes('database') ||
            error.message.includes('network') ||
            error.message.includes('timeout') ||
            context.category === ErrorCategory.PERSISTENCE ||
            context.category === ErrorCategory.WASM) {
            return ErrorSeverity.HIGH;
        }

        // Medium severity for recoverable errors
        if (error.message.includes('validation') ||
            error.message.includes('configuration') ||
            context.category === ErrorCategory.VALIDATION) {
            return ErrorSeverity.MEDIUM;
        }

        return ErrorSeverity.LOW;
    }

    /**
     * Determine recovery strategy based on error type and context
     */
    determineRecoveryStrategy(error, context) {
        const severity = this.determineSeverity(error, context);
        
        // Critical errors require immediate intervention
        if (severity === ErrorSeverity.CRITICAL) {
            return RecoveryStrategy.MANUAL_INTERVENTION;
        }

        // Network and timeout errors benefit from retries
        if (error.message.includes('network') || 
            error.message.includes('timeout') ||
            error.message.includes('ECONNREFUSED')) {
            return RecoveryStrategy.RETRY;
        }

        // Database errors use circuit breaker
        if (context.category === ErrorCategory.PERSISTENCE) {
            return RecoveryStrategy.CIRCUIT_BREAKER;
        }

        // WASM errors use graceful degradation
        if (context.category === ErrorCategory.WASM ||
            context.category === ErrorCategory.NEURAL) {
            return RecoveryStrategy.GRACEFUL_DEGRADATION;
        }

        // Default to fallback
        return RecoveryStrategy.FALLBACK;
    }

    /**
     * Execute recovery strategy
     */
    async executeRecoveryStrategy(strategy, error, context) {
        switch (strategy) {
            case RecoveryStrategy.RETRY:
                // Already handled by RetryManager, so this is an escalation
                throw new Error(`Retry strategy exhausted for ${context.operation}`);

            case RecoveryStrategy.FALLBACK:
                return this.executeFallback(error, context);

            case RecoveryStrategy.CIRCUIT_BREAKER:
                throw new Error(`Circuit breaker activated for ${context.component}`);

            case RecoveryStrategy.GRACEFUL_DEGRADATION:
                return this.executeGracefulDegradation(error, context);

            case RecoveryStrategy.RESTART:
                return this.executeRestart(error, context);

            case RecoveryStrategy.MANUAL_INTERVENTION:
                this.notifyManualIntervention(error, context);
                throw new Error(`Manual intervention required: ${error.message}`);

            default:
                throw new Error(`Unknown recovery strategy: ${strategy}`);
        }
    }

    /**
     * Execute fallback operation
     */
    async executeFallback(error, context) {
        console.warn(`Executing fallback for ${context.operation}: ${error.message}`);
        
        // Component-specific fallback strategies
        switch (context.category) {
            case ErrorCategory.PERSISTENCE:
                return this.persistenceFallback(context);
            
            case ErrorCategory.MCP:
                return this.mcpFallback(context);
            
            case ErrorCategory.NEURAL:
                return this.neuralFallback(context);
            
            default:
                return {
                    success: false,
                    fallback: true,
                    message: `Fallback executed for ${context.operation}`,
                    error: error.message
                };
        }
    }

    /**
     * Execute graceful degradation
     */
    async executeGracefulDegradation(error, context) {
        console.warn(`Graceful degradation for ${context.operation}: ${error.message}`);
        
        return {
            success: true,
            degraded: true,
            message: `Operating in degraded mode for ${context.operation}`,
            limitations: this.getDegradationLimitations(context.category),
            originalError: error.message
        };
    }

    /**
     * Get degradation limitations for each component
     */
    getDegradationLimitations(category) {
        const limitations = {
            [ErrorCategory.WASM]: [
                'WASM acceleration disabled',
                'Fallback to JavaScript implementation',
                'Reduced performance expected'
            ],
            [ErrorCategory.NEURAL]: [
                'Neural network features disabled',
                'Basic agent behavior only',
                'No learning capabilities'
            ],
            [ErrorCategory.PERSISTENCE]: [
                'In-memory storage only',
                'Data not persisted across sessions',
                'Limited historical data'
            ]
        };

        return limitations[category] || ['Feature partially unavailable'];
    }

    /**
     * Component-specific fallback implementations
     */
    async persistenceFallback(context) {
        return {
            success: true,
            fallback: true,
            storage: 'memory',
            message: 'Using in-memory storage due to persistence failure',
            limitations: ['Data will not persist across restarts']
        };
    }

    async mcpFallback(context) {
        return {
            success: true,
            fallback: true,
            mode: 'local',
            message: 'MCP communication failed, using local operations',
            limitations: ['Limited external tool access']
        };
    }

    async neuralFallback(context) {
        return {
            success: true,
            fallback: true,
            mode: 'basic',
            message: 'Neural features unavailable, using basic agent behavior',
            limitations: ['No learning capabilities', 'Reduced cognitive patterns']
        };
    }

    /**
     * Execute restart strategy
     */
    async executeRestart(error, context) {
        console.warn(`Restarting ${context.component} due to: ${error.message}`);
        
        this.emit('restart', { component: context.component, reason: error.message });
        
        return {
            success: true,
            restarted: true,
            component: context.component,
            message: `Component ${context.component} restarted`
        };
    }

    /**
     * Notify for manual intervention
     */
    notifyManualIntervention(error, context) {
        const alert = {
            timestamp: new Date().toISOString(),
            severity: 'CRITICAL',
            component: context.component,
            operation: context.operation,
            error: error.message,
            correlationId: context.correlationId,
            requiredAction: 'Manual intervention required'
        };

        console.error('🚨 CRITICAL ERROR - MANUAL INTERVENTION REQUIRED:', alert);
        this.emit('manualIntervention', alert);
    }

    /**
     * Get or create circuit breaker
     */
    getCircuitBreaker(key, options = {}) {
        if (!this.circuitBreakers.has(key)) {
            this.circuitBreakers.set(key, new CircuitBreaker({
                name: key,
                ...options
            }));
        }
        return this.circuitBreakers.get(key);
    }

    /**
     * Log error with correlation tracking
     */
    logError(errorRecord) {
        this.errorLog.push(errorRecord);
        
        // Maintain log size
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog = this.errorLog.slice(-this.maxLogSize);
        }

        // Console logging with appropriate level
        const logLevel = {
            [ErrorSeverity.LOW]: 'log',
            [ErrorSeverity.MEDIUM]: 'warn', 
            [ErrorSeverity.HIGH]: 'error',
            [ErrorSeverity.CRITICAL]: 'error'
        };

        console[logLevel[errorRecord.severity]](`[${errorRecord.severity}] ${errorRecord.component}.${errorRecord.operation}: ${errorRecord.error.message}`, {
            correlationId: errorRecord.correlationId,
            operationId: errorRecord.operationId
        });
    }

    /**
     * Log successful operation
     */
    logSuccess(context, executionTime) {
        if (context.logSuccess !== false) {
            console.log(`✅ ${context.component}.${context.operation} completed successfully (${executionTime}ms)`, {
                correlationId: context.correlationId,
                operationId: context.operationId
            });
        }
    }

    /**
     * Start background health monitoring
     */
    startHealthMonitoring() {
        const healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.healthCheckInterval);

        // Clean up on exit
        process.on('exit', () => clearInterval(healthCheckTimer));
        process.on('SIGINT', () => clearInterval(healthCheckTimer));
        process.on('SIGTERM', () => clearInterval(healthCheckTimer));
    }

    /**
     * Perform system health check
     */
    performHealthCheck() {
        const now = Date.now();
        const windowStart = now - this.monitoringWindow;
        
        // Filter recent errors
        const recentErrors = this.errorLog.filter(error => 
            new Date(error.timestamp).getTime() >= windowStart
        );

        // Calculate metrics
        const totalOperations = recentErrors.length + this.getSuccessfulOperationsCount();
        const errorRate = totalOperations > 0 ? recentErrors.length / totalOperations : 0;
        const criticalErrors = recentErrors.filter(error => 
            error.severity === ErrorSeverity.CRITICAL
        ).length;

        // Check circuit breaker states
        const openCircuitBreakers = Array.from(this.circuitBreakers.values())
            .filter(cb => cb.state === 'OPEN').length;

        // Determine health status
        const previousHealth = this.isHealthy;
        this.isHealthy = (
            errorRate < this.alertThresholds.errorRate &&
            criticalErrors < this.alertThresholds.criticalErrors &&
            openCircuitBreakers < this.alertThresholds.circuitBreakerOpenings
        );

        // Emit health status change
        if (previousHealth !== this.isHealthy) {
            this.emit('healthStatusChange', {
                isHealthy: this.isHealthy,
                metrics: { errorRate, criticalErrors, openCircuitBreakers },
                timestamp: new Date().toISOString()
            });
        }

        this.lastHealthCheck = now;
    }

    /**
     * Get successful operations count (placeholder - should integrate with actual metrics)
     */
    getSuccessfulOperationsCount() {
        // This would integrate with actual operation metrics
        return 100; // Placeholder
    }

    /**
     * Get comprehensive error statistics
     */
    getErrorStatistics(timeWindow = this.monitoringWindow) {
        const now = Date.now();
        const windowStart = now - timeWindow;
        
        const recentErrors = this.errorLog.filter(error => 
            new Date(error.timestamp).getTime() >= windowStart
        );

        const stats = {
            total: recentErrors.length,
            bySeverity: {},
            byCategory: {},
            byComponent: {},
            correlationGroups: {},
            circuitBreakers: {}
        };

        // Group by severity
        Object.values(ErrorSeverity).forEach(severity => {
            stats.bySeverity[severity] = recentErrors.filter(error => 
                error.severity === severity
            ).length;
        });

        // Group by category
        Object.values(ErrorCategory).forEach(category => {
            stats.byCategory[category] = recentErrors.filter(error => 
                error.category === category
            ).length;
        });

        // Group by component
        recentErrors.forEach(error => {
            stats.byComponent[error.component] = (stats.byComponent[error.component] || 0) + 1;
        });

        // Group by correlation ID (related errors)
        recentErrors.forEach(error => {
            if (!stats.correlationGroups[error.correlationId]) {
                stats.correlationGroups[error.correlationId] = [];
            }
            stats.correlationGroups[error.correlationId].push(error.id);
        });

        // Circuit breaker statistics
        this.circuitBreakers.forEach((breaker, name) => {
            stats.circuitBreakers[name] = breaker.getStats();
        });

        return stats;
    }

    /**
     * Generate error handling recommendations
     */
    generateRecommendations() {
        const stats = this.getErrorStatistics();
        const recommendations = [];

        // High error rate recommendations
        if (stats.bySeverity[ErrorSeverity.CRITICAL] > 0) {
            recommendations.push({
                priority: 'HIGH',
                type: 'critical_errors',
                message: `${stats.bySeverity[ErrorSeverity.CRITICAL]} critical errors detected`,
                action: 'Investigate and resolve critical issues immediately'
            });
        }

        // Component-specific recommendations
        Object.entries(stats.byComponent).forEach(([component, count]) => {
            if (count > 10) {
                recommendations.push({
                    priority: 'MEDIUM',
                    type: 'component_errors',
                    message: `High error count in ${component}: ${count}`,
                    action: `Review ${component} component for reliability issues`
                });
            }
        });

        // Circuit breaker recommendations
        Object.entries(stats.circuitBreakers).forEach(([name, cbStats]) => {
            if (cbStats.state === 'OPEN') {
                recommendations.push({
                    priority: 'HIGH',
                    type: 'circuit_breaker',
                    message: `Circuit breaker ${name} is OPEN`,
                    action: 'Check underlying service health and consider manual reset'
                });
            }
        });

        return recommendations;
    }

    /**
     * Get current system health status
     */
    getHealthStatus() {
        return {
            isHealthy: this.isHealthy,
            lastHealthCheck: new Date(this.lastHealthCheck).toISOString(),
            errorStatistics: this.getErrorStatistics(),
            circuitBreakers: Array.from(this.circuitBreakers.entries()).map(([name, breaker]) => ({
                name,
                ...breaker.getStats()
            })),
            recommendations: this.generateRecommendations(),
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }
}

export default ErrorHandlingManager;