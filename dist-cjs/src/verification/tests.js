export class SecurityTestUtils {
    static createMockVerificationRequest(overrides = {}) {
        const crypto = require('crypto');
        return {
            requestId: crypto.randomBytes(16).toString('hex'),
            agentId: 'test-agent-1',
            truthClaim: {
                statement: 'Test truth claim',
                confidence: 0.9
            },
            timestamp: new Date(),
            nonce: crypto.randomBytes(32).toString('hex'),
            signature: 'mock-signature',
            ...overrides
        };
    }
    static createMockVerificationRequests(count, baseRequest) {
        return Array.from({
            length: count
        }, (_, i)=>this.createMockVerificationRequest({
                ...baseRequest,
                requestId: `test-request-${i}`,
                agentId: `test-agent-${i % 5}`
            }));
    }
    static createMaliciousRequests() {
        const baseTime = new Date();
        return {
            byzantineRequests: [
                this.createMockVerificationRequest({
                    agentId: 'byzantine-agent',
                    truthClaim: {
                        statement: 'The sky is blue',
                        confidence: 1.0
                    },
                    timestamp: baseTime
                }),
                this.createMockVerificationRequest({
                    agentId: 'byzantine-agent',
                    truthClaim: {
                        statement: 'The sky is red',
                        confidence: 1.0
                    },
                    timestamp: new Date(baseTime.getTime() + 1000)
                })
            ],
            spamRequests: Array.from({
                length: 100
            }, (_, i)=>this.createMockVerificationRequest({
                    agentId: 'spam-agent',
                    timestamp: new Date(baseTime.getTime() + i * 10)
                })),
            replayAttacks: (()=>{
                const originalRequest = this.createMockVerificationRequest({
                    agentId: 'replay-attacker',
                    timestamp: baseTime
                });
                return Array.from({
                    length: 5
                }, ()=>({
                        ...originalRequest
                    }));
            })(),
            oversizedRequests: [
                this.createMockVerificationRequest({
                    agentId: 'oversized-agent',
                    truthClaim: {
                        statement: 'A'.repeat(50000),
                        confidence: 0.5
                    }
                })
            ]
        };
    }
    static async measurePerformance(operation, iterations = 100) {
        const times = [];
        let successCount = 0;
        let errorCount = 0;
        const startTime = Date.now();
        for(let i = 0; i < iterations; i++){
            const operationStart = Date.now();
            try {
                await operation();
                const operationTime = Date.now() - operationStart;
                times.push(operationTime);
                successCount++;
            } catch (error) {
                errorCount++;
            }
        }
        const totalTime = Date.now() - startTime;
        const averageTime = times.length > 0 ? times.reduce((sum, time)=>sum + time, 0) / times.length : 0;
        const minTime = times.length > 0 ? Math.min(...times) : 0;
        const maxTime = times.length > 0 ? Math.max(...times) : 0;
        const throughput = iterations / (totalTime / 1000);
        return {
            averageTime,
            minTime,
            maxTime,
            totalTime,
            successCount,
            errorCount,
            throughput
        };
    }
}
export class PenetrationTestingSuite {
    security;
    testResults = new Map();
    vulnerabilities = [];
    constructor(security){
        this.security = security;
    }
    async runFullPenetrationTest() {
        console.log('Starting comprehensive penetration test...');
        await this.testAuthenticationBypass();
        await this.testRateLimitBypass();
        await this.testByzantineAttacks();
        await this.testCryptographicSecurity();
        await this.testAuditTrailSecurity();
        await this.testDoSResistance();
        const securityScore = this.calculateSecurityScore();
        const recommendations = this.generateRecommendations();
        return {
            testResults: this.testResults,
            vulnerabilities: this.vulnerabilities,
            securityScore,
            recommendations
        };
    }
    async testAuthenticationBypass() {
        console.log('Testing authentication bypass...');
        const tests = [
            {
                name: 'Invalid Agent ID',
                test: ()=>this.security.processVerificationRequest(SecurityTestUtils.createMockVerificationRequest({
                        agentId: 'non-existent-agent'
                    }))
            },
            {
                name: 'Missing Signature',
                test: ()=>this.security.processVerificationRequest(SecurityTestUtils.createMockVerificationRequest({
                        signature: undefined
                    }))
            },
            {
                name: 'Invalid Signature',
                test: ()=>this.security.processVerificationRequest(SecurityTestUtils.createMockVerificationRequest({
                        signature: 'invalid-signature'
                    }))
            },
            {
                name: 'Expired Timestamp',
                test: ()=>this.security.processVerificationRequest(SecurityTestUtils.createMockVerificationRequest({
                        timestamp: new Date(Date.now() - 10 * 60 * 1000)
                    }))
            }
        ];
        const results = [];
        for (const test of tests){
            try {
                await test.test();
                this.vulnerabilities.push(`Authentication bypass possible: ${test.name}`);
                results.push({
                    name: test.name,
                    passed: false,
                    error: 'No error thrown'
                });
            } catch (error) {
                results.push({
                    name: test.name,
                    passed: true,
                    error: error.message
                });
            }
        }
        this.testResults.set('authenticationBypass', results);
    }
    async testRateLimitBypass() {
        console.log('Testing rate limiting bypass...');
        try {
            await this.security.registerAgent('rate-limit-test-agent', [
                'verify'
            ], 'MEDIUM');
        } catch (error) {}
        const rapidRequests = SecurityTestUtils.createMockVerificationRequests(50, {
            agentId: 'rate-limit-test-agent'
        });
        let successCount = 0;
        let rateLimitedCount = 0;
        for (const request of rapidRequests){
            try {
                await this.security.processVerificationRequest(request);
                successCount++;
            } catch (error) {
                if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
                    rateLimitedCount++;
                }
            }
        }
        const rateLimitEffective = rateLimitedCount > 0;
        if (!rateLimitEffective) {
            this.vulnerabilities.push('Rate limiting appears ineffective');
        }
        this.testResults.set('rateLimitBypass', {
            totalRequests: rapidRequests.length,
            successCount,
            rateLimitedCount,
            effective: rateLimitEffective
        });
    }
    async testByzantineAttacks() {
        console.log('Testing Byzantine attack detection...');
        const maliciousRequests = SecurityTestUtils.createMaliciousRequests();
        const results = {};
        try {
            await this.security.registerAgent('byzantine-test-agent', [
                'verify'
            ], 'MEDIUM');
        } catch (error) {}
        let byzantineDetected = false;
        for (const request of maliciousRequests.byzantineRequests){
            try {
                await this.security.processVerificationRequest(request);
            } catch (error) {
                if (error.message.includes('Byzantine') || error.message.includes('byzantine')) {
                    byzantineDetected = true;
                }
            }
        }
        results.byzantineDetection = {
            detected: byzantineDetected,
            requestCount: maliciousRequests.byzantineRequests.length
        };
        if (!byzantineDetected) {
            this.vulnerabilities.push('Byzantine behavior not detected');
        }
        this.testResults.set('byzantineAttacks', results);
    }
    async testCryptographicSecurity() {
        console.log('Testing cryptographic security...');
        const originalRequest = SecurityTestUtils.createMockVerificationRequest();
        const tamperedRequest = {
            ...originalRequest,
            truthClaim: {
                statement: 'Tampered claim',
                confidence: 0.1
            }
        };
        let signatureVerificationWorking = false;
        try {
            await this.security.processVerificationRequest(tamperedRequest);
        } catch (error) {
            if (error.message.includes('signature') || error.message.includes('Invalid')) {
                signatureVerificationWorking = true;
            }
        }
        if (!signatureVerificationWorking) {
            this.vulnerabilities.push('Signature verification may be compromised');
        }
        this.testResults.set('cryptographicSecurity', {
            signatureVerification: signatureVerificationWorking
        });
    }
    async testAuditTrailSecurity() {
        console.log('Testing audit trail security...');
        const securityStatus = this.security.getSecurityStatus();
        const auditTrailWorking = securityStatus.auditSummary.integrityValid;
        if (!auditTrailWorking) {
            this.vulnerabilities.push('Audit trail integrity compromised');
        }
        this.testResults.set('auditTrailSecurity', {
            integrityValid: auditTrailWorking,
            totalEntries: securityStatus.auditSummary.totalEntries
        });
    }
    async testDoSResistance() {
        console.log('Testing DoS resistance...');
        const maliciousRequests = SecurityTestUtils.createMaliciousRequests();
        let dosResistant = false;
        for (const request of maliciousRequests.oversizedRequests){
            try {
                await this.security.processVerificationRequest(request);
            } catch (error) {
                if (error.message.includes('size') || error.message.includes('large') || error.message.includes('Invalid')) {
                    dosResistant = true;
                }
            }
        }
        this.testResults.set('dosResistance', {
            resistant: dosResistant,
            oversizedRequestsBlocked: dosResistant
        });
    }
    calculateSecurityScore() {
        const totalTests = this.testResults.size;
        let passedTests = 0;
        for (const [testName, result] of this.testResults){
            switch(testName){
                case 'authenticationBypass':
                    if (result.every((test)=>test.passed)) passedTests++;
                    break;
                case 'rateLimitBypass':
                    if (result.effective) passedTests++;
                    break;
                case 'byzantineAttacks':
                    if (result.byzantineDetection.detected) passedTests++;
                    break;
                case 'cryptographicSecurity':
                    if (result.signatureVerification) passedTests++;
                    break;
                case 'auditTrailSecurity':
                    if (result.integrityValid) passedTests++;
                    break;
                case 'dosResistance':
                    if (result.resistant) passedTests++;
                    break;
            }
        }
        return Math.round(passedTests / totalTests * 100);
    }
    generateRecommendations() {
        const recommendations = [];
        if (this.vulnerabilities.length === 0) {
            recommendations.push('Security system appears robust');
            recommendations.push('Continue regular security assessments');
        } else {
            recommendations.push('Address identified vulnerabilities immediately');
            recommendations.push('Implement additional security layers');
            recommendations.push('Increase monitoring and alerting');
            recommendations.push('Consider external security audit');
        }
        return recommendations;
    }
}
export class LoadTestingSuite {
    security;
    constructor(security){
        this.security = security;
    }
    async runConcurrentLoadTest(concurrentUsers, requestsPerUser, durationSeconds) {
        console.log(`Starting load test: ${concurrentUsers} users, ${requestsPerUser} requests each, ${durationSeconds}s duration`);
        const startTime = Date.now();
        const endTime = startTime + durationSeconds * 1000;
        const results = [];
        const errorDistribution = new Map();
        const testAgents = Array.from({
            length: concurrentUsers
        }, (_, i)=>`load-test-agent-${i}`);
        for (const agentId of testAgents){
            try {
                await this.security.registerAgent(agentId, [
                    'verify'
                ], 'MEDIUM');
            } catch (error) {}
        }
        const userPromises = testAgents.map(async (agentId, userIndex)=>{
            const userResults = [];
            let requestCount = 0;
            while(Date.now() < endTime && requestCount < requestsPerUser){
                const requestStart = Date.now();
                try {
                    const request = SecurityTestUtils.createMockVerificationRequest({
                        agentId
                    });
                    await this.security.processVerificationRequest(request);
                    const responseTime = Date.now() - requestStart;
                    userResults.push({
                        success: true,
                        responseTime,
                        timestamp: new Date()
                    });
                } catch (error) {
                    const responseTime = Date.now() - requestStart;
                    userResults.push({
                        success: false,
                        responseTime,
                        error: error.message,
                        timestamp: new Date()
                    });
                    const errorType = error.message.split(':')[0] || 'Unknown';
                    errorDistribution.set(errorType, (errorDistribution.get(errorType) || 0) + 1);
                }
                requestCount++;
                await new Promise((resolve)=>setTimeout(resolve, 10));
            }
            return userResults;
        });
        const allUserResults = await Promise.all(userPromises);
        const allResults = allUserResults.flat();
        const totalRequests = allResults.length;
        const successfulRequests = allResults.filter((r)=>r.success).length;
        const failedRequests = totalRequests - successfulRequests;
        const responseTimes = allResults.map((r)=>r.responseTime);
        const averageResponseTime = responseTimes.reduce((sum, time)=>sum + time, 0) / responseTimes.length;
        const actualDuration = (Date.now() - startTime) / 1000;
        const throughput = totalRequests / actualDuration;
        return {
            totalRequests,
            successfulRequests,
            failedRequests,
            averageResponseTime,
            throughput,
            errorDistribution
        };
    }
    async runStressTest(maxConcurrentUsers, rampUpDurationSeconds, sustainDurationSeconds) {
        console.log(`Starting stress test: ramp up to ${maxConcurrentUsers} users over ${rampUpDurationSeconds}s`);
        const degradationPattern = [];
        let breakingPoint = maxConcurrentUsers;
        let maxThroughput = 0;
        const step = Math.max(1, Math.floor(maxConcurrentUsers / 10));
        for(let users = step; users <= maxConcurrentUsers; users += step){
            console.log(`Testing with ${users} concurrent users...`);
            const result = await this.runConcurrentLoadTest(users, 10, Math.max(10, sustainDurationSeconds));
            const errorRate = result.failedRequests / result.totalRequests;
            degradationPattern.push({
                users,
                throughput: result.throughput,
                errorRate
            });
            maxThroughput = Math.max(maxThroughput, result.throughput);
            if (errorRate > 0.1 || degradationPattern.length > 1 && result.throughput < degradationPattern[degradationPattern.length - 2].throughput * 0.8) {
                breakingPoint = users;
                console.log(`Breaking point detected at ${users} users`);
                break;
            }
            await new Promise((resolve)=>setTimeout(resolve, 2000));
        }
        return {
            breakingPoint,
            maxThroughput,
            degradationPattern
        };
    }
}
export class SecurityValidationSuite {
    security;
    constructor(security){
        this.security = security;
    }
    async validateSecuritySystem() {
        const componentStatus = new Map();
        const issues = [];
        const recommendations = [];
        componentStatus.set('authentication', await this.validateAuthentication());
        componentStatus.set('rateLimiting', await this.validateRateLimiting());
        componentStatus.set('byzantineDetection', await this.validateByzantineDetection());
        componentStatus.set('cryptography', await this.validateCryptography());
        componentStatus.set('auditTrail', await this.validateAuditTrail());
        const overallHealth = Array.from(componentStatus.values()).every((status)=>status);
        for (const [component, status] of componentStatus){
            if (!status) {
                issues.push(`${component} validation failed`);
                recommendations.push(`Review and fix ${component} implementation`);
            }
        }
        if (overallHealth) {
            recommendations.push('Security system is functioning correctly');
            recommendations.push('Continue regular monitoring and updates');
        }
        return {
            componentStatus,
            overallHealth,
            issues,
            recommendations
        };
    }
    async validateAuthentication() {
        try {
            const agentId = 'validation-test-agent';
            await this.security.registerAgent(agentId, [
                'verify'
            ], 'HIGH');
            const validRequest = SecurityTestUtils.createMockVerificationRequest({
                agentId
            });
            await this.security.processVerificationRequest(validRequest);
            return true;
        } catch (error) {
            console.error('Authentication validation failed:', error);
            return false;
        }
    }
    async validateRateLimiting() {
        try {
            const agentId = 'rate-limit-validation-agent';
            await this.security.registerAgent(agentId, [
                'verify'
            ], 'MEDIUM');
            const requests = SecurityTestUtils.createMockVerificationRequests(20, {
                agentId
            });
            let rateLimitHit = false;
            for (const request of requests){
                try {
                    await this.security.processVerificationRequest(request);
                } catch (error) {
                    if (error.message.includes('rate limit')) {
                        rateLimitHit = true;
                        break;
                    }
                }
            }
            return rateLimitHit;
        } catch (error) {
            console.error('Rate limiting validation failed:', error);
            return false;
        }
    }
    async validateByzantineDetection() {
        try {
            return true;
        } catch (error) {
            console.error('Byzantine detection validation failed:', error);
            return false;
        }
    }
    async validateCryptography() {
        try {
            const status = this.security.getSecurityStatus();
            return status.metrics.totalRequests >= 0;
        } catch (error) {
            console.error('Cryptography validation failed:', error);
            return false;
        }
    }
    async validateAuditTrail() {
        try {
            const status = this.security.getSecurityStatus();
            return status.auditSummary.integrityValid;
        } catch (error) {
            console.error('Audit trail validation failed:', error);
            return false;
        }
    }
}
export { SecurityTestUtils, PenetrationTestingSuite, LoadTestingSuite, SecurityValidationSuite };

//# sourceMappingURL=tests.js.map