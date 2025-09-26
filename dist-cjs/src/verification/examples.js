import { EventEmitter } from 'events';
import { createProductionSecuritySystem, createHighSecuritySystem } from './index';
import { SecurityMiddlewareManager, ThreatIntelligenceMiddleware, IPFilterMiddleware } from './middleware';
import { PenetrationTestingSuite, LoadTestingSuite, SecurityValidationSuite } from './tests';
export class BasicSecurityIntegration {
    security;
    isInitialized = false;
    constructor(){
        this.security = createProductionSecuritySystem();
        this.setupEventHandlers();
    }
    async initialize() {
        if (this.isInitialized) return;
        const participants = [
            'claude-verification-node-1',
            'claude-verification-node-2',
            'claude-verification-node-3',
            'claude-verification-node-4',
            'claude-verification-node-5'
        ];
        await this.security.initialize(participants);
        await this.registerDefaultAgents();
        this.isInitialized = true;
        console.log('Security system initialized successfully');
    }
    async registerDefaultAgents() {
        const defaultAgents = [
            {
                id: 'truth-verifier-1',
                capabilities: [
                    'verify',
                    'audit'
                ],
                level: 'HIGH'
            },
            {
                id: 'truth-verifier-2',
                capabilities: [
                    'verify',
                    'sign'
                ],
                level: 'HIGH'
            },
            {
                id: 'consensus-node-1',
                capabilities: [
                    'verify',
                    'consensus'
                ],
                level: 'CRITICAL'
            },
            {
                id: 'monitoring-agent',
                capabilities: [
                    'audit',
                    'monitor'
                ],
                level: 'MEDIUM'
            }
        ];
        for (const agent of defaultAgents){
            try {
                await this.security.registerAgent(agent.id, agent.capabilities, agent.level);
                console.log(`Registered agent: ${agent.id}`);
            } catch (error) {
                console.error(`Failed to register agent ${agent.id}:`, error.message);
            }
        }
    }
    setupEventHandlers() {
        this.security.on('verificationCompleted', (result)=>{
            console.log(`✓ Verification completed: ${result.resultId} (confidence: ${result.confidence})`);
        });
        this.security.on('verificationError', (event)=>{
            console.error(`✗ Verification failed: ${event.error}`);
        });
        this.security.on('agentRegistered', (identity)=>{
            console.log(`+ Agent registered: ${identity.agentId} (level: ${identity.securityLevel})`);
        });
        this.security.on('emergencyShutdown', (event)=>{
            console.error(`🚨 EMERGENCY SHUTDOWN: ${event.reason}`);
        });
    }
    async verifyTruthClaim(claim, agentId) {
        const request = {
            requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            agentId,
            truthClaim: claim,
            timestamp: new Date(),
            nonce: require('crypto').randomBytes(32).toString('hex'),
            signature: 'placeholder-signature'
        };
        return await this.security.processVerificationRequest(request);
    }
    getSecurityStatus() {
        return this.security.getSecurityStatus();
    }
    async shutdown(reason) {
        await this.security.emergencyShutdown(reason);
        this.isInitialized = false;
    }
}
export class AdvancedSecurityIntegration {
    security;
    middlewareManager;
    threatIntelligence;
    constructor(){
        this.security = createHighSecuritySystem();
        this.middlewareManager = new SecurityMiddlewareManager();
        this.threatIntelligence = new ThreatIntelligenceMiddleware();
        this.setupAdvancedSecurity();
    }
    setupAdvancedSecurity() {
        this.middlewareManager.registerMiddleware(this.threatIntelligence);
        this.middlewareManager.registerMiddleware(new IPFilterMiddleware([
            '127.0.0.1',
            '10.0.0.0/8'
        ], [
            '192.168.1.100'
        ]));
        this.integrateMiddleware();
    }
    integrateMiddleware() {
        const originalProcess = this.security.processVerificationRequest.bind(this.security);
        this.security.processVerificationRequest = async (request)=>{
            await this.middlewareManager.executeBeforeVerification(request);
            try {
                const result = await originalProcess(request);
                await this.middlewareManager.executeAfterVerification(result);
                return result;
            } catch (error) {
                await this.middlewareManager.executeErrorHandling(error);
                throw error;
            }
        };
    }
    async initialize() {
        await this.security.initialize([
            'secure-node-1',
            'secure-node-2',
            'secure-node-3',
            'secure-node-4',
            'secure-node-5',
            'secure-node-6',
            'secure-node-7',
            'secure-node-8',
            'secure-node-9'
        ]);
        await this.security.registerAgent('high-security-verifier', [
            'verify',
            'audit',
            'sign'
        ], 'CRITICAL');
        console.log('Advanced security system initialized');
    }
    addThreatIndicator(indicator) {
        this.threatIntelligence.addThreatIndicator(indicator);
    }
    async processHighSecurityVerification(claim, agentId) {
        const request = {
            requestId: `hs_req_${Date.now()}`,
            agentId,
            truthClaim: claim,
            timestamp: new Date(),
            nonce: require('crypto').randomBytes(64).toString('hex'),
            signature: 'high-security-signature'
        };
        return await this.security.processVerificationRequest(request);
    }
}
export class ClaudeFlowAgentSecurityWrapper {
    security;
    registeredAgents = new Set();
    constructor(security){
        this.security = security;
    }
    async registerClaudeFlowAgent(agentConfig) {
        const securityLevel = agentConfig.securityLevel || 'MEDIUM';
        const capabilities = [
            ...agentConfig.capabilities,
            'verify'
        ];
        await this.security.registerAgent(agentConfig.agentId, capabilities, securityLevel);
        this.registeredAgents.add(agentConfig.agentId);
        console.log(`Claude Flow agent secured: ${agentConfig.agentId} (${agentConfig.type})`);
    }
    async executeSecureTask(agentId, task, truthClaim) {
        if (!this.registeredAgents.has(agentId)) {
            throw new Error(`Agent ${agentId} not registered for secure operations`);
        }
        try {
            const verificationResult = await this.security.processVerificationRequest({
                requestId: `task_${Date.now()}`,
                agentId,
                truthClaim,
                timestamp: new Date(),
                nonce: require('crypto').randomBytes(32).toString('hex'),
                signature: 'task-signature'
            });
            const taskResult = await this.simulateTaskExecution(task);
            return {
                taskResult,
                verificationResult,
                securityStatus: 'SECURE'
            };
        } catch (error) {
            if (error.message.includes('Byzantine') || error.message.includes('rate limit')) {
                return {
                    taskResult: null,
                    verificationResult: null,
                    securityStatus: 'BLOCKED'
                };
            }
            return {
                taskResult: null,
                verificationResult: null,
                securityStatus: 'SUSPICIOUS'
            };
        }
    }
    async simulateTaskExecution(task) {
        await new Promise((resolve)=>setTimeout(resolve, 100));
        return {
            task,
            completed: true,
            timestamp: new Date()
        };
    }
    getAgentSecurityMetrics() {
        const status = this.security.getSecurityStatus();
        const agentMetrics = new Map();
        for (const agentId of this.registeredAgents){
            agentMetrics.set(agentId, {
                reputation: status.metrics.reputationScores.get(agentId) || 100,
                registered: true,
                securityLevel: 'ACTIVE'
            });
        }
        return agentMetrics;
    }
}
export class SecurityTestingExample {
    security;
    penetrationTester;
    loadTester;
    validator;
    constructor(){
        this.security = createProductionSecuritySystem();
        this.penetrationTester = new PenetrationTestingSuite(this.security);
        this.loadTester = new LoadTestingSuite(this.security);
        this.validator = new SecurityValidationSuite(this.security);
    }
    async runComprehensiveSecurityTest() {
        console.log('🔒 Starting comprehensive security testing...');
        await this.security.initialize([
            'test-node-1',
            'test-node-2',
            'test-node-3',
            'test-node-4',
            'test-node-5'
        ]);
        console.log('🔍 Running penetration tests...');
        const penetrationTestResults = await this.penetrationTester.runFullPenetrationTest();
        console.log('⚡ Running load tests...');
        const loadTestResults = await this.loadTester.runConcurrentLoadTest(10, 50, 30);
        console.log('✅ Running validation tests...');
        const validationResults = await this.validator.validateSecuritySystem();
        const overallAssessment = this.generateOverallAssessment(penetrationTestResults, loadTestResults, validationResults);
        console.log('🏁 Security testing completed');
        return {
            penetrationTestResults,
            loadTestResults,
            validationResults,
            overallAssessment
        };
    }
    generateOverallAssessment(pentestResults, loadResults, validationResults) {
        const pentestScore = pentestResults.securityScore * 0.4;
        const loadScore = loadResults.successfulRequests / loadResults.totalRequests * 100 * 0.3;
        const validationScore = validationResults.overallHealth ? 100 : 50;
        const validationWeight = 0.3;
        const securityScore = Math.round(pentestScore + loadScore + validationScore * validationWeight);
        let riskLevel;
        if (securityScore >= 90) riskLevel = 'LOW';
        else if (securityScore >= 75) riskLevel = 'MEDIUM';
        else if (securityScore >= 60) riskLevel = 'HIGH';
        else riskLevel = 'CRITICAL';
        const recommendations = [
            ...pentestResults.recommendations,
            ...validationResults.recommendations
        ];
        if (loadResults.failedRequests > loadResults.totalRequests * 0.1) {
            recommendations.push('Improve system resilience under load');
        }
        return {
            securityScore,
            riskLevel,
            recommendations
        };
    }
}
export class ProductionDeploymentExample {
    security;
    monitoring;
    alerting;
    constructor(){
        this.security = createProductionSecuritySystem();
        this.monitoring = new EventEmitter();
        this.alerting = new EventEmitter();
        this.setupProductionMonitoring();
    }
    setupProductionMonitoring() {
        this.security.on('verificationError', (event)=>{
            this.monitoring.emit('securityIncident', {
                type: 'VERIFICATION_FAILURE',
                severity: 'HIGH',
                details: event,
                timestamp: new Date()
            });
        });
        this.security.on('emergencyShutdown', (event)=>{
            this.alerting.emit('criticalAlert', {
                type: 'EMERGENCY_SHUTDOWN',
                message: event.reason,
                timestamp: new Date()
            });
        });
        setInterval(()=>{
            this.performHealthCheck();
        }, 60000);
    }
    async deployToProduction() {
        console.log('🚀 Deploying security system to production...');
        const productionNodes = [
            'prod-security-node-us-east-1',
            'prod-security-node-us-west-2',
            'prod-security-node-eu-west-1',
            'prod-security-node-ap-southeast-1',
            'prod-security-node-ap-northeast-1'
        ];
        await this.security.initialize(productionNodes);
        await this.registerProductionAgents();
        this.startMonitoring();
        console.log('✅ Security system deployed to production');
    }
    async registerProductionAgents() {
        const productionAgents = [
            {
                id: 'primary-verifier',
                capabilities: [
                    'verify',
                    'audit',
                    'sign'
                ],
                level: 'CRITICAL'
            },
            {
                id: 'backup-verifier',
                capabilities: [
                    'verify',
                    'audit'
                ],
                level: 'HIGH'
            },
            {
                id: 'consensus-coordinator',
                capabilities: [
                    'consensus',
                    'audit'
                ],
                level: 'CRITICAL'
            },
            {
                id: 'security-monitor',
                capabilities: [
                    'audit',
                    'monitor'
                ],
                level: 'HIGH'
            }
        ];
        for (const agent of productionAgents){
            await this.security.registerAgent(agent.id, agent.capabilities, agent.level);
        }
    }
    startMonitoring() {
        console.log('📊 Starting production monitoring...');
        this.monitoring.on('securityIncident', (incident)=>{
            console.warn(`⚠️  Security incident: ${incident.type} - ${incident.details.error}`);
        });
        this.alerting.on('criticalAlert', (alert)=>{
            console.error(`🚨 CRITICAL ALERT: ${alert.type} - ${alert.message}`);
        });
    }
    performHealthCheck() {
        const status = this.security.getSecurityStatus();
        if (!status.systemHealth.consensusCapable) {
            this.alerting.emit('criticalAlert', {
                type: 'CONSENSUS_FAILURE',
                message: 'System cannot achieve consensus',
                timestamp: new Date()
            });
        }
        if (status.systemHealth.byzantineNodes > 0) {
            this.monitoring.emit('securityIncident', {
                type: 'BYZANTINE_NODES_DETECTED',
                severity: 'HIGH',
                details: {
                    count: status.systemHealth.byzantineNodes
                },
                timestamp: new Date()
            });
        }
    }
    async gracefulShutdown() {
        console.log('🔄 Initiating graceful shutdown...');
        const report = this.security.exportSecurityReport();
        console.log('💾 Security report exported');
        await this.security.emergencyShutdown('Scheduled maintenance');
        console.log('✅ Graceful shutdown completed');
    }
}
export { BasicSecurityIntegration, AdvancedSecurityIntegration, ClaudeFlowAgentSecurityWrapper, SecurityTestingExample, ProductionDeploymentExample };

//# sourceMappingURL=examples.js.map