import { EventEmitter } from 'events';
export class SecurityMiddlewareManager {
    middlewares = [];
    eventBus;
    constructor(){
        this.eventBus = new EventEmitter();
    }
    registerMiddleware(middleware) {
        this.middlewares.push(middleware);
        this.middlewares.sort((a, b)=>a.priority - b.priority);
        console.log(`Registered security middleware: ${middleware.name} (priority: ${middleware.priority})`);
    }
    unregisterMiddleware(name) {
        const index = this.middlewares.findIndex((m)=>m.name === name);
        if (index >= 0) {
            this.middlewares.splice(index, 1);
            console.log(`Unregistered security middleware: ${name}`);
            return true;
        }
        return false;
    }
    async executeBeforeVerification(request) {
        for (const middleware of this.middlewares){
            if (middleware.beforeVerification) {
                try {
                    await middleware.beforeVerification(request);
                } catch (error) {
                    console.error(`Middleware ${middleware.name} before-verification failed:`, error);
                    throw error;
                }
            }
        }
    }
    async executeAfterVerification(result) {
        for (const middleware of this.middlewares){
            if (middleware.afterVerification) {
                try {
                    await middleware.afterVerification(result);
                } catch (error) {
                    console.error(`Middleware ${middleware.name} after-verification failed:`, error);
                }
            }
        }
    }
    async executeErrorHandling(error) {
        for (const middleware of this.middlewares){
            if (middleware.onError) {
                try {
                    await middleware.onError(error);
                } catch (middlewareError) {
                    console.error(`Middleware ${middleware.name} error handling failed:`, middlewareError);
                }
            }
        }
    }
    getMiddlewareInfo() {
        return this.middlewares.map((m)=>({
                name: m.name,
                priority: m.priority
            }));
    }
}
export class ThreatIntelligenceMiddleware {
    name = 'ThreatIntelligence';
    priority = 100;
    threatIndicators = new Set();
    attackPatterns = new Map();
    threatDatabase = new Map();
    constructor(){
        this.initializeDefaultThreats();
    }
    initializeDefaultThreats() {
        this.threatIndicators.add('bypass_attempt');
        this.threatIndicators.add('injection_attack');
        this.threatIndicators.add('brute_force');
        this.threatIndicators.add('social_engineering');
        this.attackPatterns.set('rapid_requests', {
            patternId: 'rapid_requests',
            name: 'Rapid Request Pattern',
            description: 'Multiple requests in very short time span',
            indicators: [
                'high_frequency',
                'same_agent',
                'similar_payload'
            ],
            severity: 'MEDIUM',
            mitigation: [
                'rate_limiting',
                'temporary_ban'
            ],
            frequency: 0
        });
        this.attackPatterns.set('credential_stuffing', {
            patternId: 'credential_stuffing',
            name: 'Credential Stuffing',
            description: 'Multiple authentication attempts with different credentials',
            indicators: [
                'multiple_failed_auth',
                'different_credentials',
                'same_source'
            ],
            severity: 'HIGH',
            mitigation: [
                'account_lockout',
                'ip_blocking',
                'captcha'
            ],
            frequency: 0
        });
    }
    async beforeVerification(request) {
        await this.analyzeThreatIndicators(request);
        await this.checkAttackPatterns(request);
        await this.updateThreatIntelligence(request);
    }
    async afterVerification(result) {
        await this.analyzeVerificationResults(result);
    }
    async onError(error) {
        console.log(`Security error logged for threat analysis: ${error.message}`);
    }
    addThreatIndicator(indicator) {
        this.threatIndicators.add(indicator.toLowerCase());
        console.log(`Added threat indicator: ${indicator}`);
    }
    removeThreatIndicator(indicator) {
        this.threatIndicators.delete(indicator.toLowerCase());
        console.log(`Removed threat indicator: ${indicator}`);
    }
    addAttackPattern(pattern) {
        this.attackPatterns.set(pattern.patternId, pattern);
        console.log(`Added attack pattern: ${pattern.name}`);
    }
    getThreatLevel(agentId) {
        return this.threatDatabase.get(agentId) || null;
    }
    async analyzeThreatIndicators(request) {
        const requestContent = JSON.stringify(request).toLowerCase();
        for (const indicator of this.threatIndicators){
            if (requestContent.includes(indicator)) {
                console.warn(`Threat indicator detected: ${indicator} in request from ${request.agentId}`);
                const currentThreat = this.threatDatabase.get(request.agentId) || {
                    level: 'LOW',
                    score: 0,
                    indicators: [],
                    mitigationActions: []
                };
                currentThreat.indicators.push(indicator);
                currentThreat.score += 10;
                if (currentThreat.score >= 50) currentThreat.level = 'HIGH';
                else if (currentThreat.score >= 25) currentThreat.level = 'MEDIUM';
                this.threatDatabase.set(request.agentId, currentThreat);
                if (currentThreat.level === 'HIGH') {
                    throw new Error(`High threat level detected for agent ${request.agentId}: ${indicator}`);
                }
            }
        }
    }
    async checkAttackPatterns(request) {
        const now = Date.now();
        const requestKey = `${request.agentId}_requests`;
        if (request.timestamp.getTime() > now - 5000) {
            const pattern = this.attackPatterns.get('rapid_requests');
            if (pattern) {
                pattern.frequency++;
                console.warn(`Attack pattern detected: ${pattern.name} for agent ${request.agentId}`);
            }
        }
    }
    async updateThreatIntelligence(request) {
        console.debug(`Threat intelligence updated for agent: ${request.agentId}`);
    }
    async analyzeVerificationResults(result) {
        if (result.confidence < 0.5) {
            console.warn(`Low confidence verification result: ${result.confidence} for agent ${result.agentId}`);
            const currentThreat = this.threatDatabase.get(result.agentId) || {
                level: 'LOW',
                score: 0,
                indicators: [],
                mitigationActions: []
            };
            currentThreat.indicators.push('low_confidence_result');
            currentThreat.score += 5;
            this.threatDatabase.set(result.agentId, currentThreat);
        }
    }
    exportThreatIntelligence() {
        return {
            threatIndicators: Array.from(this.threatIndicators),
            attackPatterns: Array.from(this.attackPatterns.values()),
            agentThreatLevels: Array.from(this.threatDatabase.entries()).map(([agentId, threatLevel])=>({
                    agentId,
                    threatLevel
                }))
        };
    }
}
export class IPFilterMiddleware {
    name = 'IPFilter';
    priority = 50;
    whitelist;
    blacklist;
    geoBlockList;
    constructor(whitelist = [], blacklist = [], geoBlockList = []){
        this.whitelist = new Set(whitelist);
        this.blacklist = new Set(blacklist);
        this.geoBlockList = new Set(geoBlockList);
    }
    async beforeVerification(request) {
        const simulatedIP = this.extractIPFromRequest(request);
        if (simulatedIP) {
            await this.checkIPRestrictions(simulatedIP, request.agentId);
        }
    }
    extractIPFromRequest(request) {
        return `192.168.1.${Math.floor(Math.random() * 255)}`;
    }
    async checkIPRestrictions(ip, agentId) {
        if (this.blacklist.has(ip)) {
            throw new Error(`IP ${ip} is blacklisted for agent ${agentId}`);
        }
        if (this.whitelist.size > 0 && !this.whitelist.has(ip)) {
            throw new Error(`IP ${ip} is not whitelisted for agent ${agentId}`);
        }
        const countryCode = await this.getCountryCode(ip);
        if (countryCode && this.geoBlockList.has(countryCode)) {
            throw new Error(`Requests from ${countryCode} are blocked for agent ${agentId}`);
        }
    }
    async getCountryCode(ip) {
        const countries = [
            'US',
            'CA',
            'GB',
            'DE',
            'FR',
            'JP',
            'AU',
            'CN',
            'RU'
        ];
        return countries[Math.floor(Math.random() * countries.length)];
    }
    addToWhitelist(ip) {
        this.whitelist.add(ip);
        console.log(`Added ${ip} to IP whitelist`);
    }
    addToBlacklist(ip) {
        this.blacklist.add(ip);
        console.log(`Added ${ip} to IP blacklist`);
    }
    addToGeoBlock(countryCode) {
        this.geoBlockList.add(countryCode.toUpperCase());
        console.log(`Added ${countryCode} to geo-block list`);
    }
}
export class SecurityLoggingMiddleware {
    name = 'SecurityLogging';
    priority = 10;
    logBuffer = [];
    async beforeVerification(request) {
        this.logBuffer.push({
            timestamp: new Date(),
            type: 'REQUEST',
            agentId: request.agentId,
            data: {
                requestId: request.requestId,
                truthClaimType: typeof request.truthClaim,
                hasSignature: !!request.signature
            }
        });
        if (this.logBuffer.length > 1000) {
            await this.flushLogs();
        }
    }
    async afterVerification(result) {
        this.logBuffer.push({
            timestamp: new Date(),
            type: 'RESULT',
            agentId: result.agentId,
            data: {
                resultId: result.resultId,
                verified: result.verified,
                confidence: result.confidence,
                evidenceCount: result.evidence.length
            }
        });
    }
    async onError(error) {
        this.logBuffer.push({
            timestamp: new Date(),
            type: 'ERROR',
            agentId: 'system',
            data: {
                errorMessage: error.message,
                errorType: error.constructor.name
            }
        });
    }
    async flushLogs() {
        console.log(`Flushing ${this.logBuffer.length} security log entries`);
        this.logBuffer.length = 0;
    }
    exportLogs() {
        return [
            ...this.logBuffer
        ];
    }
    getLogStatistics() {
        const requestCount = this.logBuffer.filter((log)=>log.type === 'REQUEST').length;
        const resultCount = this.logBuffer.filter((log)=>log.type === 'RESULT').length;
        const errorCount = this.logBuffer.filter((log)=>log.type === 'ERROR').length;
        const timestamps = this.logBuffer.map((log)=>log.timestamp);
        const start = timestamps.length > 0 ? new Date(Math.min(...timestamps.map((t)=>t.getTime()))) : null;
        const end = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((t)=>t.getTime()))) : null;
        return {
            totalEntries: this.logBuffer.length,
            requestCount,
            resultCount,
            errorCount,
            timespan: {
                start,
                end
            }
        };
    }
}
export class PerformanceMonitoringMiddleware {
    name = 'PerformanceMonitoring';
    priority = 20;
    performanceMetrics = new Map();
    requestStartTimes = new Map();
    async beforeVerification(request) {
        this.requestStartTimes.set(request.requestId, Date.now());
    }
    async afterVerification(result) {
        const startTime = this.requestStartTimes.get(result.requestId);
        if (startTime) {
            const responseTime = Date.now() - startTime;
            this.updateMetrics(result.agentId, responseTime, false);
            this.requestStartTimes.delete(result.requestId);
        }
    }
    async onError(error) {
        console.debug('Performance monitoring: Error recorded');
    }
    updateMetrics(agentId, responseTime, isError) {
        let metrics = this.performanceMetrics.get(agentId);
        if (!metrics) {
            metrics = {
                requestCount: 0,
                totalResponseTime: 0,
                averageResponseTime: 0,
                maxResponseTime: 0,
                minResponseTime: Infinity,
                errorCount: 0
            };
        }
        metrics.requestCount++;
        if (isError) {
            metrics.errorCount++;
        } else {
            metrics.totalResponseTime += responseTime;
            metrics.averageResponseTime = metrics.totalResponseTime / (metrics.requestCount - metrics.errorCount);
            metrics.maxResponseTime = Math.max(metrics.maxResponseTime, responseTime);
            metrics.minResponseTime = Math.min(metrics.minResponseTime, responseTime);
        }
        this.performanceMetrics.set(agentId, metrics);
    }
    getAgentMetrics(agentId) {
        return this.performanceMetrics.get(agentId) || null;
    }
    getSystemMetrics() {
        const agents = Array.from(this.performanceMetrics.entries());
        const totalRequests = agents.reduce((sum, [_, metrics])=>sum + metrics.requestCount, 0);
        const totalErrors = agents.reduce((sum, [_, metrics])=>sum + metrics.errorCount, 0);
        const validAgents = agents.filter(([_, metrics])=>metrics.requestCount > metrics.errorCount);
        const totalResponseTime = validAgents.reduce((sum, [_, metrics])=>sum + metrics.totalResponseTime, 0);
        const totalSuccessfulRequests = validAgents.reduce((sum, [_, metrics])=>sum + (metrics.requestCount - metrics.errorCount), 0);
        const averageSystemResponseTime = totalSuccessfulRequests > 0 ? totalResponseTime / totalSuccessfulRequests : 0;
        let slowestAgent = null;
        let fastestAgent = null;
        let maxAvgTime = 0;
        let minAvgTime = Infinity;
        for (const [agentId, metrics] of validAgents){
            if (metrics.averageResponseTime > maxAvgTime) {
                maxAvgTime = metrics.averageResponseTime;
                slowestAgent = agentId;
            }
            if (metrics.averageResponseTime < minAvgTime) {
                minAvgTime = metrics.averageResponseTime;
                fastestAgent = agentId;
            }
        }
        return {
            totalRequests,
            totalErrors,
            averageSystemResponseTime,
            agentCount: agents.length,
            slowestAgent,
            fastestAgent
        };
    }
    resetMetrics() {
        this.performanceMetrics.clear();
        this.requestStartTimes.clear();
        console.log('Performance metrics reset');
    }
}
export class ComplianceMonitoringMiddleware {
    name = 'ComplianceMonitoring';
    priority = 30;
    complianceEvents = [];
    complianceRules = new Map();
    constructor(){
        this.initializeComplianceRules();
    }
    initializeComplianceRules() {
        this.complianceRules.set('signature_required', (request)=>!!request.signature);
        this.complianceRules.set('timestamp_recent', (request)=>{
            const now = Date.now();
            const requestTime = request.timestamp.getTime();
            return now - requestTime < 60000;
        });
        this.complianceRules.set('nonce_present', (request)=>!!request.nonce);
    }
    async beforeVerification(request) {
        await this.checkCompliance(request);
    }
    async afterVerification(result) {
        this.complianceEvents.push({
            timestamp: new Date(),
            eventType: 'VERIFICATION_COMPLETED',
            agentId: result.agentId,
            complianceLevel: 'PASS',
            details: {
                resultId: result.resultId,
                verified: result.verified
            }
        });
    }
    async onError(error) {
        this.complianceEvents.push({
            timestamp: new Date(),
            eventType: 'COMPLIANCE_ERROR',
            agentId: 'unknown',
            complianceLevel: 'FAIL',
            details: {
                error: error.message
            }
        });
    }
    async checkCompliance(request) {
        for (const [ruleName, ruleFunc] of this.complianceRules){
            const isCompliant = ruleFunc(request);
            if (!isCompliant) {
                this.complianceEvents.push({
                    timestamp: new Date(),
                    eventType: 'COMPLIANCE_VIOLATION',
                    agentId: request.agentId,
                    complianceLevel: 'FAIL',
                    details: {
                        rule: ruleName,
                        requestId: request.requestId
                    }
                });
                throw new Error(`Compliance violation: ${ruleName} for agent ${request.agentId}`);
            }
        }
        this.complianceEvents.push({
            timestamp: new Date(),
            eventType: 'COMPLIANCE_CHECK',
            agentId: request.agentId,
            complianceLevel: 'PASS',
            details: {
                requestId: request.requestId
            }
        });
    }
    addComplianceRule(name, rule) {
        this.complianceRules.set(name, rule);
        console.log(`Added compliance rule: ${name}`);
    }
    getComplianceReport(timeframe) {
        let events = this.complianceEvents;
        if (timeframe) {
            events = events.filter((event)=>event.timestamp >= timeframe.start && event.timestamp <= timeframe.end);
        }
        const passCount = events.filter((e)=>e.complianceLevel === 'PASS').length;
        const warnCount = events.filter((e)=>e.complianceLevel === 'WARN').length;
        const failCount = events.filter((e)=>e.complianceLevel === 'FAIL').length;
        const complianceRate = events.length > 0 ? passCount / events.length * 100 : 100;
        const violations = events.filter((e)=>e.eventType === 'COMPLIANCE_VIOLATION').map((e)=>({
                rule: e.details.rule,
                agentId: e.agentId,
                timestamp: e.timestamp
            }));
        return {
            totalEvents: events.length,
            passCount,
            warnCount,
            failCount,
            complianceRate,
            violations
        };
    }
}
export { SecurityMiddlewareManager, ThreatIntelligenceMiddleware, IPFilterMiddleware, SecurityLoggingMiddleware, PerformanceMonitoringMiddleware, ComplianceMonitoringMiddleware };

//# sourceMappingURL=middleware.js.map