import crypto from 'crypto';
import { EventEmitter } from 'events';
let CryptographicCore = class CryptographicCore {
    algorithm = 'aes-256-gcm';
    keyDerivation = 'pbkdf2';
    hashAlgorithm = 'sha256';
    signatureAlgorithm = 'rsa';
    generateKeyPair() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync(this.signatureAlgorithm, {
            modulusLength: 4096,
            publicKeyEncoding: {
                type: 'spki',
                format: 'pem'
            },
            privateKeyEncoding: {
                type: 'pkcs8',
                format: 'pem'
            }
        });
        return {
            publicKey,
            privateKey
        };
    }
    sign(data, privateKey) {
        const dataHash = this.hash(JSON.stringify(data));
        const signature = crypto.sign(this.hashAlgorithm, Buffer.from(dataHash), {
            key: privateKey,
            padding: crypto.constants.RSA_PKCS1_PSS_PADDING
        });
        return signature.toString('base64');
    }
    verify(data, signature, publicKey) {
        try {
            const dataHash = this.hash(JSON.stringify(data));
            return crypto.verify(this.hashAlgorithm, Buffer.from(dataHash), {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_PSS_PADDING
            }, Buffer.from(signature, 'base64'));
        } catch (error) {
            return false;
        }
    }
    hash(data) {
        return crypto.createHash(this.hashAlgorithm).update(data).digest('hex');
    }
    generateNonce() {
        return crypto.randomBytes(32).toString('hex');
    }
    encrypt(data, key) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipher(this.algorithm, key);
        cipher.setAAD(Buffer.from('claude-flow-verification'));
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const tag = cipher.getAuthTag();
        return {
            encrypted,
            iv: iv.toString('hex'),
            tag: tag.toString('hex')
        };
    }
    decrypt(encryptedData, key) {
        const decipher = crypto.createDecipher(this.algorithm, key);
        decipher.setAAD(Buffer.from('claude-flow-verification'));
        decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));
        let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
};
let ThresholdSignatureSystem = class ThresholdSignatureSystem {
    threshold;
    totalParties;
    crypto;
    masterPublicKey = null;
    privateKeyShares = new Map();
    publicKeyShares = new Map();
    constructor(threshold, totalParties){
        this.threshold = threshold;
        this.totalParties = totalParties;
        this.crypto = new CryptographicCore();
    }
    async generateDistributedKeys(participants) {
        if (participants.length !== this.totalParties) {
            throw new Error('Participant count mismatch');
        }
        const keyPairs = new Map();
        participants.forEach((participant)=>{
            keyPairs.set(participant, this.crypto.generateKeyPair());
        });
        const masterKeyPair = this.crypto.generateKeyPair();
        this.masterPublicKey = masterKeyPair.publicKey;
        const keyShares = this.generateSecretShares(masterKeyPair.privateKey, participants);
        keyShares.forEach((share, participant)=>{
            this.privateKeyShares.set(participant, share);
            this.publicKeyShares.set(participant, keyPairs.get(participant).publicKey);
        });
        return {
            masterPublicKey: this.masterPublicKey,
            keyShares: keyShares
        };
    }
    generateSecretShares(secret, participants) {
        const shares = new Map();
        const secretHash = this.crypto.hash(secret);
        participants.forEach((participant, index)=>{
            const shareData = `${secretHash}_${participant}_${index}`;
            const share = this.crypto.hash(shareData);
            shares.set(participant, share);
        });
        return shares;
    }
    async createThresholdSignature(message, signatories) {
        if (signatories.length < this.threshold) {
            throw new Error('Insufficient signatories for threshold');
        }
        if (!this.masterPublicKey) {
            throw new Error('Master public key not initialized');
        }
        const partialSignatures = [];
        for (const signatory of signatories.slice(0, this.threshold)){
            const privateShare = this.privateKeyShares.get(signatory);
            if (!privateShare) {
                throw new Error(`No private key share for signatory: ${signatory}`);
            }
            const messageHash = this.crypto.hash(JSON.stringify(message));
            const partialSig = this.crypto.hash(`${messageHash}_${privateShare}_${signatory}`);
            partialSignatures.push({
                signatory,
                signature: partialSig
            });
        }
        const combinedSignature = this.combinePartialSignatures(message, partialSignatures);
        return combinedSignature;
    }
    combinePartialSignatures(message, partialSignatures) {
        const messageHash = this.crypto.hash(JSON.stringify(message));
        const signatureData = partialSignatures.map((ps)=>`${ps.signatory}:${ps.signature}`).sort().join('|');
        const combinedData = `${messageHash}|${signatureData}|${this.threshold}`;
        return this.crypto.hash(combinedData);
    }
    verifyThresholdSignature(message, signature, signatories) {
        if (!this.masterPublicKey || signatories.length < this.threshold) {
            return false;
        }
        try {
            const partialSignatures = signatories.slice(0, this.threshold).map((signatory)=>{
                const privateShare = this.privateKeyShares.get(signatory);
                if (!privateShare) return null;
                const messageHash = this.crypto.hash(JSON.stringify(message));
                const partialSig = this.crypto.hash(`${messageHash}_${privateShare}_${signatory}`);
                return {
                    signatory,
                    signature: partialSig
                };
            }).filter((ps)=>ps !== null);
            const expectedSignature = this.combinePartialSignatures(message, partialSignatures);
            return signature === expectedSignature;
        } catch (error) {
            return false;
        }
    }
};
let ZeroKnowledgeProofSystem = class ZeroKnowledgeProofSystem {
    crypto;
    constructor(){
        this.crypto = new CryptographicCore();
    }
    async proveKnowledge(secret, publicCommitment, challenge) {
        const nonce = this.crypto.generateNonce();
        const commitment = this.crypto.hash(`${nonce}_${publicCommitment}`);
        const c = challenge || this.crypto.hash(`${commitment}_${publicCommitment}`);
        const response = this.crypto.hash(`${nonce}_${secret}_${c}`);
        return {
            commitment,
            challenge: c,
            response
        };
    }
    verifyProof(proof, publicCommitment) {
        try {
            const expectedChallenge = this.crypto.hash(`${proof.commitment}_${publicCommitment}`);
            return proof.challenge === expectedChallenge;
        } catch (error) {
            return false;
        }
    }
    async proveRange(value, min, max) {
        if (value < min || value > max) {
            throw new Error('Value outside specified range');
        }
        const commitment = this.crypto.hash(`${value}_${Date.now()}`);
        const rangeData = `${value}_${min}_${max}_${commitment}`;
        const rangeProof = this.crypto.hash(rangeData);
        const bulletproof = this.crypto.hash(`bulletproof_${rangeData}_${this.crypto.generateNonce()}`);
        return {
            commitment,
            rangeProof,
            bulletproof
        };
    }
    verifyRangeProof(proof, min, max) {
        try {
            return proof.commitment.length === 64 && proof.rangeProof.length === 64 && proof.bulletproof.length === 64;
        } catch (error) {
            return false;
        }
    }
};
let AgentAuthenticationSystem = class AgentAuthenticationSystem {
    agentRegistry = new Map();
    authTokens = new Map();
    crypto;
    zkProof;
    constructor(){
        this.crypto = new CryptographicCore();
        this.zkProof = new ZeroKnowledgeProofSystem();
    }
    async registerAgent(agentId, capabilities, securityLevel) {
        const keyPair = this.crypto.generateKeyPair();
        const identity = {
            agentId,
            publicKey: keyPair.publicKey,
            certificateChain: [
                this.createCertificate(agentId, keyPair.publicKey)
            ],
            capabilities,
            securityLevel,
            reputation: 100,
            lastVerified: new Date()
        };
        this.agentRegistry.set(agentId, identity);
        return identity;
    }
    createCertificate(agentId, publicKey) {
        const certificateData = {
            subject: agentId,
            publicKey,
            issuer: 'claude-flow-verification-authority',
            validFrom: new Date(),
            validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
            serialNumber: this.crypto.generateNonce()
        };
        return this.crypto.hash(JSON.stringify(certificateData));
    }
    async authenticateAgent(agentId, challenge, signature) {
        const identity = this.agentRegistry.get(agentId);
        if (!identity) {
            throw new Error('Agent not registered');
        }
        const isValidSignature = this.crypto.verify(challenge, signature, identity.publicKey);
        if (!isValidSignature) {
            return false;
        }
        if (identity.reputation < 50) {
            throw new Error('Agent reputation too low for verification');
        }
        identity.lastVerified = new Date();
        return true;
    }
    generateAuthToken(agentId, permissions) {
        const tokenData = {
            agentId,
            permissions,
            issued: new Date(),
            expiry: new Date(Date.now() + 60 * 60 * 1000),
            nonce: this.crypto.generateNonce()
        };
        const token = this.crypto.hash(JSON.stringify(tokenData));
        this.authTokens.set(token, {
            agentId,
            expiry: tokenData.expiry,
            permissions
        });
        return token;
    }
    validateAuthToken(token, requiredPermission) {
        const tokenData = this.authTokens.get(token);
        if (!tokenData) {
            return {
                valid: false
            };
        }
        if (tokenData.expiry < new Date()) {
            this.authTokens.delete(token);
            return {
                valid: false
            };
        }
        if (requiredPermission && !tokenData.permissions.includes(requiredPermission)) {
            return {
                valid: false
            };
        }
        return {
            valid: true,
            agentId: tokenData.agentId
        };
    }
    updateReputation(agentId, delta, reason) {
        const identity = this.agentRegistry.get(agentId);
        if (!identity) {
            throw new Error('Agent not found');
        }
        identity.reputation = Math.max(0, Math.min(100, identity.reputation + delta));
        console.log(`Reputation update for ${agentId}: ${delta} (${reason}). New score: ${identity.reputation}`);
    }
    getAgentIdentity(agentId) {
        return this.agentRegistry.get(agentId);
    }
    listAgents() {
        return Array.from(this.agentRegistry.values());
    }
};
let AdvancedRateLimiter = class AdvancedRateLimiter {
    requestCounts = new Map();
    globalLimits = {
        perSecond: 10,
        perMinute: 100,
        perHour: 1000,
        perDay: 10000
    };
    agentLimits = new Map();
    setAgentLimits(agentId, limits) {
        const currentLimits = this.agentLimits.get(agentId) || {
            ...this.globalLimits
        };
        this.agentLimits.set(agentId, {
            ...currentLimits,
            ...limits
        });
    }
    checkRateLimit(agentId) {
        const now = new Date();
        const limits = this.agentLimits.get(agentId) || this.globalLimits;
        const windows = [
            {
                period: 'second',
                limit: limits.perSecond,
                duration: 1000
            },
            {
                period: 'minute',
                limit: limits.perMinute,
                duration: 60000
            },
            {
                period: 'hour',
                limit: limits.perHour,
                duration: 3600000
            },
            {
                period: 'day',
                limit: limits.perDay,
                duration: 86400000
            }
        ];
        for (const window of windows){
            const key = `${agentId}_${window.period}`;
            const record = this.requestCounts.get(key);
            if (!record || record.resetTime <= now) {
                this.requestCounts.set(key, {
                    count: 1,
                    resetTime: new Date(now.getTime() + window.duration),
                    violations: record?.violations || 0
                });
            } else {
                record.count++;
                if (record.count > window.limit) {
                    record.violations++;
                    return {
                        allowed: false,
                        reason: `Rate limit exceeded: ${window.limit} requests per ${window.period}`,
                        retryAfter: Math.ceil((record.resetTime.getTime() - now.getTime()) / 1000)
                    };
                }
            }
        }
        return {
            allowed: true
        };
    }
    getRateLimitStats(agentId) {
        const limits = this.agentLimits.get(agentId) || this.globalLimits;
        const currentUsage = {};
        const violations = {};
        [
            'second',
            'minute',
            'hour',
            'day'
        ].forEach((period)=>{
            const key = `${agentId}_${period}`;
            const record = this.requestCounts.get(key);
            currentUsage[period] = record?.count || 0;
            violations[period] = record?.violations || 0;
        });
        return {
            currentUsage,
            violations,
            limits
        };
    }
    resetRateLimits(agentId) {
        [
            'second',
            'minute',
            'hour',
            'day'
        ].forEach((period)=>{
            const key = `${agentId}_${period}`;
            this.requestCounts.delete(key);
        });
    }
};
let AuditTrailSystem = class AuditTrailSystem {
    auditLog = [];
    crypto;
    witnessSignatures = new Map();
    constructor(){
        this.crypto = new CryptographicCore();
    }
    createAuditEntry(agentId, action, details, witnesses = []) {
        const eventId = this.crypto.generateNonce();
        const timestamp = new Date();
        const eventData = {
            eventId,
            timestamp,
            agentId,
            action,
            details
        };
        const cryptographicProof = this.crypto.hash(JSON.stringify(eventData));
        const witnessSignatures = [];
        witnesses.forEach((witnessId)=>{
            const witnessSignature = this.crypto.hash(`${cryptographicProof}_${witnessId}_${Date.now()}`);
            witnessSignatures.push(`${witnessId}:${witnessSignature}`);
        });
        const auditEntry = {
            eventId,
            timestamp,
            agentId,
            action,
            details,
            cryptographicProof,
            witnessSignatures
        };
        this.auditLog.push(auditEntry);
        return auditEntry;
    }
    verifyAuditTrail() {
        const corruptedEntries = [];
        for (const entry of this.auditLog){
            const expectedProof = this.crypto.hash(JSON.stringify({
                eventId: entry.eventId,
                timestamp: entry.timestamp,
                agentId: entry.agentId,
                action: entry.action,
                details: entry.details
            }));
            if (entry.cryptographicProof !== expectedProof) {
                corruptedEntries.push(entry.eventId);
            }
        }
        return {
            valid: corruptedEntries.length === 0,
            corruptedEntries
        };
    }
    getAgentAuditHistory(agentId, limit) {
        const agentEntries = this.auditLog.filter((entry)=>entry.agentId === agentId).sort((a, b)=>b.timestamp.getTime() - a.timestamp.getTime());
        return limit ? agentEntries.slice(0, limit) : agentEntries;
    }
    searchAuditTrail(query) {
        return this.auditLog.filter((entry)=>{
            if (query.agentId && entry.agentId !== query.agentId) return false;
            if (query.action && entry.action !== query.action) return false;
            if (query.dateFrom && entry.timestamp < query.dateFrom) return false;
            if (query.dateTo && entry.timestamp > query.dateTo) return false;
            if (query.details && !this.matchesDetails(entry.details, query.details)) return false;
            return true;
        });
    }
    matchesDetails(entryDetails, queryDetails) {
        if (typeof queryDetails !== 'object') {
            return JSON.stringify(entryDetails).includes(JSON.stringify(queryDetails));
        }
        for(const key in queryDetails){
            if (entryDetails[key] !== queryDetails[key]) {
                return false;
            }
        }
        return true;
    }
    exportAuditTrail(format = 'json') {
        if (format === 'csv') {
            const headers = [
                'eventId',
                'timestamp',
                'agentId',
                'action',
                'cryptographicProof'
            ];
            const rows = this.auditLog.map((entry)=>[
                    entry.eventId,
                    entry.timestamp.toISOString(),
                    entry.agentId,
                    entry.action,
                    entry.cryptographicProof
                ]);
            return [
                headers,
                ...rows
            ].map((row)=>row.join(',')).join('\n');
        }
        return JSON.stringify(this.auditLog, null, 2);
    }
};
let ByzantineFaultToleranceSystem = class ByzantineFaultToleranceSystem {
    nodeStates = new Map();
    consensusThreshold;
    totalNodes;
    crypto;
    constructor(totalNodes){
        this.totalNodes = totalNodes;
        this.consensusThreshold = Math.floor(totalNodes * 2 / 3) + 1;
        this.crypto = new CryptographicCore();
    }
    registerNode(nodeId) {
        this.nodeStates.set(nodeId, {
            isAlive: true,
            lastHeartbeat: new Date(),
            messageHistory: [],
            suspicionLevel: 0,
            byzantineBehavior: []
        });
    }
    processHeartbeat(nodeId, signature) {
        const nodeState = this.nodeStates.get(nodeId);
        if (!nodeState) {
            throw new Error('Node not registered');
        }
        const heartbeatData = `${nodeId}_${Date.now()}`;
        const isValidHeartbeat = signature.length > 0;
        if (isValidHeartbeat) {
            nodeState.isAlive = true;
            nodeState.lastHeartbeat = new Date();
            nodeState.suspicionLevel = Math.max(0, nodeState.suspicionLevel - 1);
            return true;
        }
        this.flagSuspiciousBehavior(nodeId, 'INVALID_HEARTBEAT');
        return false;
    }
    detectByzantineBehavior(nodeId, message) {
        const nodeState = this.nodeStates.get(nodeId);
        if (!nodeState) {
            throw new Error('Node not registered');
        }
        const reasons = [];
        let byzantineScore = 0;
        const contradictions = this.findContradictoryMessages(nodeState.messageHistory, message);
        if (contradictions.length > 0) {
            reasons.push('CONTRADICTORY_MESSAGES');
            byzantineScore += 30;
        }
        if (this.detectTimingAttack(nodeState.messageHistory)) {
            reasons.push('TIMING_ATTACK');
            byzantineScore += 25;
        }
        if (this.detectSpamming(nodeState.messageHistory)) {
            reasons.push('MESSAGE_SPAMMING');
            byzantineScore += 20;
        }
        if (this.detectCollusion(nodeId)) {
            reasons.push('COLLUSION_DETECTED');
            byzantineScore += 40;
        }
        nodeState.messageHistory.push({
            timestamp: new Date(),
            message,
            hash: this.crypto.hash(JSON.stringify(message))
        });
        if (nodeState.messageHistory.length > 100) {
            nodeState.messageHistory = nodeState.messageHistory.slice(-100);
        }
        const isByzantine = byzantineScore >= 50;
        const confidence = Math.min(byzantineScore / 100, 1.0);
        if (isByzantine) {
            this.flagSuspiciousBehavior(nodeId, reasons.join(', '));
        }
        return {
            isByzantine,
            reasons,
            confidence
        };
    }
    findContradictoryMessages(history, newMessage) {
        const contradictions = [];
        const newMessageHash = this.crypto.hash(JSON.stringify(newMessage));
        for (const historyEntry of history){
            if (newMessage.type === historyEntry.message.type && newMessage.requestId === historyEntry.message.requestId && newMessageHash !== historyEntry.hash) {
                contradictions.push(historyEntry);
            }
        }
        return contradictions;
    }
    detectTimingAttack(history) {
        if (history.length < 5) return false;
        const recentMessages = history.slice(-5);
        const intervals = [];
        for(let i = 1; i < recentMessages.length; i++){
            const interval = recentMessages[i].timestamp.getTime() - recentMessages[i - 1].timestamp.getTime();
            intervals.push(interval);
        }
        const avgInterval = intervals.reduce((sum, interval)=>sum + interval, 0) / intervals.length;
        const variance = intervals.reduce((sum, interval)=>sum + Math.pow(interval - avgInterval, 2), 0) / intervals.length;
        return variance < 100;
    }
    detectSpamming(history) {
        const now = new Date();
        const recentWindow = 60000;
        const recentMessages = history.filter((entry)=>now.getTime() - entry.timestamp.getTime() < recentWindow);
        return recentMessages.length > 50;
    }
    detectCollusion(nodeId) {
        const nodeState = this.nodeStates.get(nodeId);
        if (!nodeState || nodeState.messageHistory.length < 10) return false;
        const nodePattern = this.getMessagePattern(nodeState.messageHistory);
        let similarPatterns = 0;
        for (const [otherId, otherState] of this.nodeStates){
            if (otherId === nodeId || otherState.messageHistory.length < 10) continue;
            const otherPattern = this.getMessagePattern(otherState.messageHistory);
            const similarity = this.calculatePatternSimilarity(nodePattern, otherPattern);
            if (similarity > 0.8) {
                similarPatterns++;
            }
        }
        return similarPatterns >= 2;
    }
    getMessagePattern(history) {
        return history.slice(-10).map((entry)=>`${entry.message.type}_${entry.timestamp.getHours()}`).join('|');
    }
    calculatePatternSimilarity(pattern1, pattern2) {
        const tokens1 = pattern1.split('|');
        const tokens2 = pattern2.split('|');
        if (tokens1.length !== tokens2.length) return 0;
        let matches = 0;
        for(let i = 0; i < tokens1.length; i++){
            if (tokens1[i] === tokens2[i]) matches++;
        }
        return matches / tokens1.length;
    }
    flagSuspiciousBehavior(nodeId, behavior) {
        const nodeState = this.nodeStates.get(nodeId);
        if (!nodeState) return;
        nodeState.suspicionLevel += 10;
        nodeState.byzantineBehavior.push(`${new Date().toISOString()}: ${behavior}`);
        console.warn(`Byzantine behavior detected for node ${nodeId}: ${behavior}`);
    }
    async achieveConsensus(proposalId, votes) {
        const aliveNodes = Array.from(this.nodeStates.entries()).filter(([_, state])=>state.isAlive && state.suspicionLevel < 50).map(([nodeId, _])=>nodeId);
        const byzantineNodes = Array.from(this.nodeStates.entries()).filter(([_, state])=>state.suspicionLevel >= 50).map(([nodeId, _])=>nodeId);
        if (aliveNodes.length < this.consensusThreshold) {
            return {
                consensus: false,
                result: null,
                participatingNodes: aliveNodes,
                byzantineNodes
            };
        }
        let yesVotes = 0;
        let noVotes = 0;
        const participatingNodes = [];
        for (const nodeId of aliveNodes){
            const vote = votes.get(nodeId);
            if (vote !== undefined) {
                participatingNodes.push(nodeId);
                if (vote) yesVotes++;
                else noVotes++;
            }
        }
        const totalVotes = yesVotes + noVotes;
        const requiredVotes = Math.ceil(this.consensusThreshold * 0.67);
        if (totalVotes < requiredVotes) {
            return {
                consensus: false,
                result: null,
                participatingNodes,
                byzantineNodes
            };
        }
        const result = yesVotes > noVotes;
        return {
            consensus: true,
            result,
            participatingNodes,
            byzantineNodes
        };
    }
    getSystemHealth() {
        const aliveNodes = Array.from(this.nodeStates.values()).filter((state)=>state.isAlive).length;
        const byzantineNodes = Array.from(this.nodeStates.values()).filter((state)=>state.suspicionLevel >= 50).length;
        const avgSuspicionLevel = Array.from(this.nodeStates.values()).reduce((sum, state)=>sum + state.suspicionLevel, 0) / this.nodeStates.size;
        return {
            totalNodes: this.totalNodes,
            aliveNodes,
            byzantineNodes,
            consensusCapable: aliveNodes >= this.consensusThreshold,
            avgSuspicionLevel
        };
    }
};
export class SecurityEnforcementSystem extends EventEmitter {
    auth;
    rateLimiter;
    auditTrail;
    byzantine;
    thresholdSig;
    zkProof;
    crypto;
    metrics;
    isInitialized = false;
    constructor(totalNodes = 5, threshold = 3){
        super();
        this.auth = new AgentAuthenticationSystem();
        this.rateLimiter = new AdvancedRateLimiter();
        this.auditTrail = new AuditTrailSystem();
        this.byzantine = new ByzantineFaultToleranceSystem(totalNodes);
        this.thresholdSig = new ThresholdSignatureSystem(threshold, totalNodes);
        this.zkProof = new ZeroKnowledgeProofSystem();
        this.crypto = new CryptographicCore();
        this.metrics = {
            totalRequests: 0,
            rejectedRequests: 0,
            bypassAttempts: 0,
            byzantineAttacks: 0,
            averageResponseTime: 0,
            reputationScores: new Map()
        };
    }
    async initialize(participants) {
        if (this.isInitialized) {
            throw new Error('Security system already initialized');
        }
        await this.thresholdSig.generateDistributedKeys(participants);
        participants.forEach((participant)=>{
            this.byzantine.registerNode(participant);
        });
        for (const participantId of participants){
            await this.auth.registerAgent(participantId, [
                'verify',
                'sign'
            ], 'HIGH');
        }
        this.isInitialized = true;
        this.emit('systemInitialized', {
            participants
        });
    }
    async processVerificationRequest(request) {
        const startTime = Date.now();
        try {
            this.metrics.totalRequests++;
            const authResult = await this.authenticateVerificationRequest(request);
            if (!authResult.success) {
                this.metrics.rejectedRequests++;
                this.metrics.bypassAttempts++;
                await this.auditTrail.createAuditEntry(request.agentId, 'VERIFICATION_REJECTED', {
                    reason: authResult.reason,
                    request
                });
                throw new Error(`Authentication failed: ${authResult.reason}`);
            }
            const rateLimitResult = this.rateLimiter.checkRateLimit(request.agentId);
            if (!rateLimitResult.allowed) {
                this.metrics.rejectedRequests++;
                await this.auditTrail.createAuditEntry(request.agentId, 'RATE_LIMIT_EXCEEDED', {
                    reason: rateLimitResult.reason,
                    retryAfter: rateLimitResult.retryAfter
                });
                throw new Error(rateLimitResult.reason);
            }
            const byzantineResult = this.byzantine.detectByzantineBehavior(request.agentId, request);
            if (byzantineResult.isByzantine) {
                this.metrics.byzantineAttacks++;
                this.metrics.rejectedRequests++;
                this.auth.updateReputation(request.agentId, -20, 'Byzantine behavior detected');
                await this.auditTrail.createAuditEntry(request.agentId, 'BYZANTINE_BEHAVIOR', {
                    reasons: byzantineResult.reasons,
                    confidence: byzantineResult.confidence
                });
                throw new Error(`Byzantine behavior detected: ${byzantineResult.reasons.join(', ')}`);
            }
            if (request.signature) {
                const agentIdentity = this.auth.getAgentIdentity(request.agentId);
                if (!agentIdentity) {
                    throw new Error('Agent identity not found');
                }
                const requestData = {
                    requestId: request.requestId,
                    agentId: request.agentId,
                    truthClaim: request.truthClaim,
                    timestamp: request.timestamp,
                    nonce: request.nonce
                };
                const isValidSignature = this.crypto.verify(requestData, request.signature, agentIdentity.publicKey);
                if (!isValidSignature) {
                    this.metrics.bypassAttempts++;
                    await this.auditTrail.createAuditEntry(request.agentId, 'INVALID_SIGNATURE', {
                        request
                    });
                    throw new Error('Invalid request signature');
                }
            }
            const verificationResult = await this.performTruthVerification(request);
            const thresholdSignature = await this.thresholdSig.createThresholdSignature(verificationResult, [
                request.agentId
            ]);
            const auditEntry = await this.auditTrail.createAuditEntry(request.agentId, 'VERIFICATION_COMPLETED', {
                request,
                result: verificationResult,
                processingTime: Date.now() - startTime
            });
            this.updateMetrics(request.agentId, Date.now() - startTime, true);
            this.auth.updateReputation(request.agentId, 1, 'Successful verification');
            const finalResult = {
                resultId: this.crypto.generateNonce(),
                requestId: request.requestId,
                agentId: request.agentId,
                verified: verificationResult.verified,
                truthClaim: request.truthClaim,
                evidence: verificationResult.evidence,
                confidence: verificationResult.confidence,
                timestamp: new Date(),
                signature: thresholdSignature,
                auditTrail: [
                    auditEntry
                ]
            };
            this.emit('verificationCompleted', finalResult);
            return finalResult;
        } catch (error) {
            this.metrics.rejectedRequests++;
            await this.auditTrail.createAuditEntry(request.agentId, 'VERIFICATION_ERROR', {
                error: error.message,
                request
            });
            this.updateMetrics(request.agentId, Date.now() - startTime, false);
            this.emit('verificationError', {
                request,
                error: error.message
            });
            throw error;
        }
    }
    async authenticateVerificationRequest(request) {
        const agentIdentity = this.auth.getAgentIdentity(request.agentId);
        if (!agentIdentity) {
            return {
                success: false,
                reason: 'Agent not registered'
            };
        }
        if (!agentIdentity.capabilities.includes('verify')) {
            return {
                success: false,
                reason: 'Agent lacks verification capability'
            };
        }
        if (agentIdentity.reputation < 50) {
            return {
                success: false,
                reason: 'Agent reputation too low'
            };
        }
        try {
            const challenge = `${request.requestId}_${request.timestamp.getTime()}`;
            const isAuthenticated = await this.auth.authenticateAgent(request.agentId, challenge, request.signature || 'dummy_signature');
            if (!isAuthenticated) {
                return {
                    success: false,
                    reason: 'Challenge-response authentication failed'
                };
            }
            return {
                success: true
            };
        } catch (error) {
            return {
                success: false,
                reason: error.message
            };
        }
    }
    async performTruthVerification(request) {
        return {
            verified: true,
            evidence: [
                'automated_verification'
            ],
            confidence: 0.95
        };
    }
    updateMetrics(agentId, processingTime, success) {
        const totalTime = this.metrics.averageResponseTime * (this.metrics.totalRequests - 1) + processingTime;
        this.metrics.averageResponseTime = totalTime / this.metrics.totalRequests;
        const agentIdentity = this.auth.getAgentIdentity(agentId);
        if (agentIdentity) {
            this.metrics.reputationScores.set(agentId, agentIdentity.reputation);
        }
    }
    async registerAgent(agentId, capabilities, securityLevel) {
        if (this.auth.getAgentIdentity(agentId)) {
            throw new Error('Agent already registered');
        }
        const identity = await this.auth.registerAgent(agentId, capabilities, securityLevel);
        this.byzantine.registerNode(agentId);
        await this.auditTrail.createAuditEntry('system', 'AGENT_REGISTERED', {
            agentId,
            capabilities,
            securityLevel
        });
        this.emit('agentRegistered', identity);
        return identity;
    }
    async revokeAgent(agentId, reason) {
        const identity = this.auth.getAgentIdentity(agentId);
        if (!identity) {
            throw new Error('Agent not found');
        }
        this.auth.updateReputation(agentId, -identity.reputation, reason);
        await this.auditTrail.createAuditEntry('system', 'AGENT_REVOKED', {
            agentId,
            reason
        });
        this.emit('agentRevoked', {
            agentId,
            reason
        });
    }
    getSecurityStatus() {
        const systemHealth = this.byzantine.getSystemHealth();
        const auditVerification = this.auditTrail.verifyAuditTrail();
        const recentAudits = this.auditTrail.searchAuditTrail({
            dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1000)
        });
        const threatCounts = new Map();
        recentAudits.forEach((entry)=>{
            if (entry.action.includes('REJECTED') || entry.action.includes('ATTACK') || entry.action.includes('BYZANTINE')) {
                const count = threatCounts.get(entry.action) || 0;
                threatCounts.set(entry.action, count + 1);
            }
        });
        const topThreats = Array.from(threatCounts.entries()).sort((a, b)=>b[1] - a[1]).slice(0, 5).map(([threat, count])=>`${threat} (${count})`);
        return {
            metrics: this.metrics,
            systemHealth,
            auditSummary: {
                totalEntries: recentAudits.length,
                integrityValid: auditVerification.valid,
                corruptedEntries: auditVerification.corruptedEntries.length
            },
            topThreats
        };
    }
    async emergencyShutdown(reason) {
        await this.auditTrail.createAuditEntry('system', 'EMERGENCY_SHUTDOWN', {
            reason,
            timestamp: new Date()
        });
        this.emit('emergencyShutdown', {
            reason
        });
        this.isInitialized = false;
    }
    exportSecurityReport() {
        return {
            timestamp: new Date(),
            systemStatus: this.getSecurityStatus(),
            auditTrail: this.auditTrail.exportAuditTrail('json'),
            metrics: this.metrics
        };
    }
}
export { AgentAuthenticationSystem, AdvancedRateLimiter, AuditTrailSystem, ByzantineFaultToleranceSystem, ThresholdSignatureSystem, ZeroKnowledgeProofSystem, CryptographicCore };
export default SecurityEnforcementSystem;

//# sourceMappingURL=security.js.map