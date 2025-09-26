export { SecurityEnforcementSystem as default, SecurityEnforcementSystem } from './security';
export { AgentAuthenticationSystem, AdvancedRateLimiter, AuditTrailSystem, ByzantineFaultToleranceSystem, ThresholdSignatureSystem, ZeroKnowledgeProofSystem, CryptographicCore } from './security';
export * from './types';
export { SECURITY_CONSTANTS } from './types';
export { SecurityError, AuthenticationError, ByzantineError, CryptographicError, RateLimitError } from './types';
export function createSecuritySystem(config) {
    const totalNodes = config?.totalNodes || 5;
    const threshold = config?.threshold || Math.floor(totalNodes * 2 / 3) + 1;
    const securitySystem = new SecurityEnforcementSystem(totalNodes, threshold);
    if (config?.rateLimits) {
        console.log('Custom rate limits configured:', config.rateLimits);
    }
    return securitySystem;
}
export function createDevelopmentSecuritySystem() {
    return createSecuritySystem({
        totalNodes: 3,
        threshold: 2,
        rateLimits: {
            perSecond: 100,
            perMinute: 1000,
            perHour: 10000,
            perDay: 100000
        }
    });
}
export function createProductionSecuritySystem() {
    return createSecuritySystem({
        totalNodes: 7,
        threshold: 5,
        rateLimits: {
            perSecond: 10,
            perMinute: 100,
            perHour: 1000,
            perDay: 10000
        }
    });
}
export function createHighSecuritySystem() {
    return createSecuritySystem({
        totalNodes: 9,
        threshold: 7,
        rateLimits: {
            perSecond: 5,
            perMinute: 50,
            perHour: 500,
            perDay: 5000
        }
    });
}

//# sourceMappingURL=index.js.map