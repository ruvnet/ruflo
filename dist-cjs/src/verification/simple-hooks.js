import { Logger } from '../core/logger.js';
import { agenticHookManager } from '../services/agentic-flow-hooks/index.js';
const logger = new Logger({
    level: 'info',
    format: 'text',
    destination: 'console'
}, {
    prefix: 'SimpleVerificationHooks'
});
export class SimpleVerificationHookManager {
    config;
    constructor(config = {}){
        this.config = {
            enabled: true,
            logLevel: 'info',
            ...config
        };
        if (this.config.enabled) {
            this.registerSimpleHooks();
        }
    }
    registerSimpleHooks() {
        const preTaskHook = {
            id: 'simple-verification-pre-task',
            type: 'workflow-start',
            priority: 100,
            handler: async (payload, context)=>{
                logger.info('🔍 Pre-task verification starting...');
                try {
                    const result = await this.runSimpleChecks(payload, context);
                    if (result.success) {
                        logger.info('✅ Pre-task verification passed');
                        return {
                            continue: true,
                            metadata: {
                                verificationPassed: true,
                                message: result.message
                            }
                        };
                    } else {
                        logger.warn('⚠️ Pre-task verification failed:', result.message);
                        return {
                            continue: true,
                            metadata: {
                                verificationFailed: true,
                                message: result.message
                            }
                        };
                    }
                } catch (error) {
                    logger.error('❌ Pre-task verification error:', error);
                    return {
                        continue: true,
                        metadata: {
                            verificationError: true,
                            error: error.message
                        }
                    };
                }
            }
        };
        const postTaskHook = {
            id: 'simple-verification-post-task',
            type: 'workflow-complete',
            priority: 90,
            handler: async (payload, context)=>{
                logger.info('🔍 Post-task verification starting...');
                try {
                    const result = await this.runSimpleValidation(payload, context);
                    logger.info(`✅ Post-task verification completed: ${result.message}`);
                    return {
                        continue: true,
                        metadata: {
                            validationComplete: true,
                            success: result.success,
                            message: result.message
                        }
                    };
                } catch (error) {
                    logger.error('❌ Post-task verification error:', error);
                    return {
                        continue: true,
                        metadata: {
                            validationError: true,
                            error: error.message
                        }
                    };
                }
            }
        };
        agenticHookManager.register(preTaskHook);
        agenticHookManager.register(postTaskHook);
        logger.info('Simple verification hooks registered successfully');
    }
    async runSimpleChecks(payload, context) {
        const nodeEnv = process.env.NODE_ENV;
        if (!nodeEnv) {
            return {
                success: false,
                message: 'NODE_ENV environment variable not set',
                details: {
                    missing: [
                        'NODE_ENV'
                    ]
                }
            };
        }
        const memUsage = process.memoryUsage();
        const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
        if (heapUsedMB > 1000) {
            return {
                success: false,
                message: `High memory usage detected: ${heapUsedMB.toFixed(2)}MB`,
                details: {
                    memoryUsage: heapUsedMB
                }
            };
        }
        return {
            success: true,
            message: 'All pre-task checks passed',
            details: {
                nodeEnv,
                memoryUsage: heapUsedMB
            }
        };
    }
    async runSimpleValidation(payload, context) {
        if (!payload.state || Object.keys(payload.state).length === 0) {
            return {
                success: false,
                message: 'Workflow completed with empty state',
                details: {
                    state: payload.state
                }
            };
        }
        if (payload.error) {
            return {
                success: false,
                message: 'Workflow completed with errors',
                details: {
                    error: payload.error
                }
            };
        }
        return {
            success: true,
            message: 'Post-task validation passed',
            details: {
                stateKeys: Object.keys(payload.state),
                timestamp: Date.now()
            }
        };
    }
    getStatus() {
        return {
            enabled: this.config.enabled,
            hooksRegistered: this.config.enabled ? 2 : 0,
            config: this.config
        };
    }
    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
        logger.info('Simple verification configuration updated', this.config);
    }
}
export const simpleVerificationHookManager = new SimpleVerificationHookManager();
logger.info('Simple verification hooks module initialized');

//# sourceMappingURL=simple-hooks.js.map