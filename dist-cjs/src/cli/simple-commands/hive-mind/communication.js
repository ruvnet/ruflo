import EventEmitter from 'events';
import crypto from 'crypto';
const MESSAGE_TYPES = {
    command: {
        priority: 1,
        reliable: true,
        encrypted: true
    },
    query: {
        priority: 2,
        reliable: true,
        encrypted: false
    },
    response: {
        priority: 2,
        reliable: true,
        encrypted: false
    },
    broadcast: {
        priority: 3,
        reliable: false,
        encrypted: false
    },
    heartbeat: {
        priority: 4,
        reliable: false,
        encrypted: false
    },
    consensus: {
        priority: 1,
        reliable: true,
        encrypted: true
    },
    task: {
        priority: 2,
        reliable: true,
        encrypted: false
    },
    result: {
        priority: 2,
        reliable: true,
        encrypted: false
    },
    error: {
        priority: 1,
        reliable: true,
        encrypted: false
    },
    sync: {
        priority: 3,
        reliable: true,
        encrypted: false
    }
};
const PROTOCOLS = {
    direct: 'direct',
    broadcast: 'broadcast',
    multicast: 'multicast',
    gossip: 'gossip',
    consensus: 'consensus'
};
export class SwarmCommunication extends EventEmitter {
    constructor(config = {}){
        super();
        this.config = {
            swarmId: config.swarmId,
            encryption: config.encryption || false,
            maxRetries: config.maxRetries || 3,
            timeout: config.timeout || 5000,
            bufferSize: config.bufferSize || 1000,
            gossipFanout: config.gossipFanout || 3,
            consensusQuorum: config.consensusQuorum || 0.67,
            ...config
        };
        this.state = {
            agents: new Map(),
            channels: new Map(),
            messageBuffer: [],
            messageHistory: new Map(),
            metrics: {
                sent: 0,
                received: 0,
                failed: 0,
                encrypted: 0,
                latency: []
            }
        };
        this.encryptionKey = this.config.encryption ? crypto.randomBytes(32) : null;
        this._initialize();
    }
    _initialize() {
        this.messageProcessor = setInterval(()=>{
            this._processMessageBuffer();
        }, 100);
        this.heartbeatTimer = setInterval(()=>{
            this._sendHeartbeats();
        }, 10000);
        this.emit('communication:initialized', {
            swarmId: this.config.swarmId
        });
    }
    registerAgent(agentId, metadata = {}) {
        const agent = {
            id: agentId,
            status: 'online',
            lastSeen: Date.now(),
            metadata,
            messageCount: 0,
            channel: this._createChannel(agentId)
        };
        this.state.agents.set(agentId, agent);
        this.broadcast({
            type: 'agent_joined',
            agentId,
            metadata
        }, 'sync');
        this.emit('agent:registered', agent);
        return agent;
    }
    unregisterAgent(agentId) {
        const agent = this.state.agents.get(agentId);
        if (!agent) return;
        const channel = this.state.channels.get(agentId);
        if (channel) {
            channel.close();
            this.state.channels.delete(agentId);
        }
        this.state.agents.delete(agentId);
        this.broadcast({
            type: 'agent_left',
            agentId
        }, 'sync');
        this.emit('agent:unregistered', {
            agentId
        });
    }
    async send(toAgentId, message, type = 'query') {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();
        const envelope = {
            id: messageId,
            from: 'system',
            to: toAgentId,
            type,
            timestamp,
            message,
            protocol: PROTOCOLS.direct
        };
        if (this.config.encryption && MESSAGE_TYPES[type]?.encrypted) {
            envelope.message = this._encrypt(message);
            envelope.encrypted = true;
            this.state.metrics.encrypted++;
        }
        this._addToBuffer(envelope);
        this.state.messageHistory.set(messageId, {
            ...envelope,
            status: 'pending',
            attempts: 0
        });
        this.state.metrics.sent++;
        return new Promise((resolve, reject)=>{
            const timeout = setTimeout(()=>{
                reject(new Error(`Message timeout: ${messageId}`));
            }, this.config.timeout);
            this.once(`ack:${messageId}`, ()=>{
                clearTimeout(timeout);
                resolve({
                    messageId,
                    delivered: true
                });
            });
            this.once(`nack:${messageId}`, (error)=>{
                clearTimeout(timeout);
                reject(error);
            });
        });
    }
    broadcast(message, type = 'broadcast') {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();
        const envelope = {
            id: messageId,
            from: 'system',
            to: '*',
            type,
            timestamp,
            message,
            protocol: PROTOCOLS.broadcast
        };
        this._addToBuffer(envelope);
        this.state.metrics.sent++;
        this.emit('message:broadcast', envelope);
        return {
            messageId,
            recipients: this.state.agents.size
        };
    }
    multicast(agentIds, message, type = 'query') {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();
        const envelopes = agentIds.map((agentId)=>({
                id: `${messageId}-${agentId}`,
                from: 'system',
                to: agentId,
                type,
                timestamp,
                message,
                protocol: PROTOCOLS.multicast,
                groupId: messageId
            }));
        envelopes.forEach((envelope)=>this._addToBuffer(envelope));
        this.state.metrics.sent += envelopes.length;
        return {
            messageId,
            recipients: agentIds.length
        };
    }
    gossip(message, type = 'sync') {
        const messageId = this._generateMessageId();
        const timestamp = Date.now();
        const agents = Array.from(this.state.agents.keys());
        const selected = this._selectRandomAgents(agents, this.config.gossipFanout);
        selected.forEach((agentId)=>{
            const envelope = {
                id: `${messageId}-${agentId}`,
                from: 'system',
                to: agentId,
                type,
                timestamp,
                message: {
                    ...message,
                    _gossip: {
                        originalId: messageId,
                        hops: 0,
                        seen: []
                    }
                },
                protocol: PROTOCOLS.gossip
            };
            this._addToBuffer(envelope);
        });
        this.state.metrics.sent += selected.length;
        return {
            messageId,
            initialTargets: selected
        };
    }
    async consensus(proposal, validators = []) {
        const consensusId = this._generateMessageId();
        const timestamp = Date.now();
        if (validators.length === 0) {
            validators = Array.from(this.state.agents.keys()).filter((id)=>this.state.agents.get(id).status === 'online');
        }
        const votes = new Map();
        const votePromises = [];
        validators.forEach((agentId)=>{
            const envelope = {
                id: `${consensusId}-propose-${agentId}`,
                from: 'system',
                to: agentId,
                type: 'consensus',
                timestamp,
                message: {
                    phase: 'propose',
                    consensusId,
                    proposal
                },
                protocol: PROTOCOLS.consensus
            };
            this._addToBuffer(envelope);
            const votePromise = new Promise((resolve)=>{
                this.once(`vote:${consensusId}:${agentId}`, (vote)=>{
                    votes.set(agentId, vote);
                    resolve({
                        agentId,
                        vote
                    });
                });
                setTimeout(()=>{
                    if (!votes.has(agentId)) {
                        votes.set(agentId, null);
                        resolve({
                            agentId,
                            vote: null
                        });
                    }
                }, this.config.timeout);
            });
            votePromises.push(votePromise);
        });
        await Promise.all(votePromises);
        const voteCount = {};
        let totalVotes = 0;
        votes.forEach((vote)=>{
            if (vote !== null) {
                voteCount[vote] = (voteCount[vote] || 0) + 1;
                totalVotes++;
            }
        });
        const sortedVotes = Object.entries(voteCount).sort((a, b)=>b[1] - a[1]);
        const winner = sortedVotes[0];
        const consensusReached = winner && winner[1] / validators.length >= this.config.consensusQuorum;
        const result = {
            consensusId,
            proposal,
            validators: validators.length,
            votes: Object.fromEntries(votes),
            voteCount,
            winner: consensusReached ? winner[0] : null,
            consensusReached,
            quorum: this.config.consensusQuorum,
            timestamp: Date.now()
        };
        this.broadcast({
            phase: 'result',
            consensusId,
            result
        }, 'consensus');
        this.emit('consensus:completed', result);
        return result;
    }
    handleMessage(envelope) {
        this.state.metrics.received++;
        const agent = this.state.agents.get(envelope.from);
        if (agent) {
            agent.lastSeen = Date.now();
            agent.messageCount++;
        }
        if (envelope.encrypted && this.config.encryption) {
            try {
                envelope.message = this._decrypt(envelope.message);
            } catch (error) {
                this.emit('error', {
                    type: 'decryption_failed',
                    envelope,
                    error
                });
                return;
            }
        }
        switch(envelope.protocol){
            case PROTOCOLS.direct:
                this._handleDirectMessage(envelope);
                break;
            case PROTOCOLS.broadcast:
                this._handleBroadcastMessage(envelope);
                break;
            case PROTOCOLS.multicast:
                this._handleMulticastMessage(envelope);
                break;
            case PROTOCOLS.gossip:
                this._handleGossipMessage(envelope);
                break;
            case PROTOCOLS.consensus:
                this._handleConsensusMessage(envelope);
                break;
            default:
                this.emit('error', {
                    type: 'unknown_protocol',
                    envelope
                });
        }
        this.emit('message:received', envelope);
    }
    _handleDirectMessage(envelope) {
        this._sendAck(envelope.id, envelope.from);
        this.emit(`message:${envelope.type}`, envelope);
    }
    _handleBroadcastMessage(envelope) {
        this.emit(`broadcast:${envelope.type}`, envelope);
    }
    _handleMulticastMessage(envelope) {
        this._sendAck(envelope.groupId, envelope.from);
        this.emit(`multicast:${envelope.type}`, envelope);
    }
    _handleGossipMessage(envelope) {
        const gossipData = envelope.message._gossip;
        if (gossipData.seen.includes(this.config.swarmId)) {
            return;
        }
        gossipData.seen.push(this.config.swarmId);
        gossipData.hops++;
        this.emit(`gossip:${envelope.type}`, envelope);
        if (gossipData.hops < 3) {
            const agents = Array.from(this.state.agents.keys()).filter((id)=>!gossipData.seen.includes(id));
            const selected = this._selectRandomAgents(agents, this.config.gossipFanout);
            selected.forEach((agentId)=>{
                const newEnvelope = {
                    ...envelope,
                    id: `${gossipData.originalId}-${agentId}-hop${gossipData.hops}`,
                    to: agentId,
                    from: this.config.swarmId
                };
                this._addToBuffer(newEnvelope);
            });
        }
    }
    _handleConsensusMessage(envelope) {
        const { phase, consensusId } = envelope.message;
        switch(phase){
            case 'propose':
                this.emit('consensus:proposal', envelope);
                break;
            case 'vote':
                this.emit(`vote:${consensusId}:${envelope.from}`, envelope.message.vote);
                break;
            case 'result':
                this.emit('consensus:result', envelope.message.result);
                break;
        }
    }
    _sendAck(messageId, toAgent) {
        const ack = {
            id: `ack-${messageId}`,
            from: this.config.swarmId,
            to: toAgent,
            type: 'ack',
            timestamp: Date.now(),
            message: {
                originalId: messageId
            },
            protocol: PROTOCOLS.direct
        };
        this._addToBuffer(ack);
    }
    _createChannel(agentId) {
        const channel = new EventEmitter();
        channel.send = (message)=>{
            this.emit(`channel:${agentId}`, message);
        };
        channel.close = ()=>{
            channel.removeAllListeners();
        };
        this.state.channels.set(agentId, channel);
        return channel;
    }
    _addToBuffer(envelope) {
        this.state.messageBuffer.push(envelope);
        if (this.state.messageBuffer.length > this.config.bufferSize) {
            const dropped = this.state.messageBuffer.shift();
            this.emit('message:dropped', dropped);
        }
    }
    _processMessageBuffer() {
        const toProcess = this.state.messageBuffer.splice(0, 10);
        toProcess.forEach((envelope)=>{
            setTimeout(()=>{
                if (envelope.to === '*') {
                    this.state.agents.forEach((agent)=>{
                        this.emit(`deliver:${agent.id}`, envelope);
                    });
                } else {
                    this.emit(`deliver:${envelope.to}`, envelope);
                }
                const history = this.state.messageHistory.get(envelope.id);
                if (history) {
                    history.status = 'sent';
                    history.sentAt = Date.now();
                }
            }, Math.random() * 100);
        });
    }
    _sendHeartbeats() {
        const now = Date.now();
        this.state.agents.forEach((agent, agentId)=>{
            if (now - agent.lastSeen > 30000) {
                agent.status = 'offline';
                this.emit('agent:offline', {
                    agentId
                });
            }
            const heartbeat = {
                id: `heartbeat-${now}-${agentId}`,
                from: 'system',
                to: agentId,
                type: 'heartbeat',
                timestamp: now,
                message: {
                    timestamp: now
                },
                protocol: PROTOCOLS.direct
            };
            this._addToBuffer(heartbeat);
        });
    }
    _selectRandomAgents(agents, count) {
        const shuffled = [
            ...agents
        ].sort(()=>Math.random() - 0.5);
        return shuffled.slice(0, Math.min(count, agents.length));
    }
    _generateMessageId() {
        return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    _encrypt(data) {
        if (!this.encryptionKey) return data;
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return {
            iv: iv.toString('hex'),
            data: encrypted
        };
    }
    _decrypt(encrypted) {
        if (!this.encryptionKey) return encrypted;
        const iv = Buffer.from(encrypted.iv, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
        let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    }
    getStatistics() {
        const avgLatency = this.state.metrics.latency.length > 0 ? this.state.metrics.latency.reduce((a, b)=>a + b, 0) / this.state.metrics.latency.length : 0;
        return {
            agents: {
                total: this.state.agents.size,
                online: Array.from(this.state.agents.values()).filter((a)=>a.status === 'online').length,
                offline: Array.from(this.state.agents.values()).filter((a)=>a.status === 'offline').length
            },
            messages: {
                sent: this.state.metrics.sent,
                received: this.state.metrics.received,
                failed: this.state.metrics.failed,
                encrypted: this.state.metrics.encrypted,
                buffered: this.state.messageBuffer.length
            },
            performance: {
                avgLatency: avgLatency.toFixed(2),
                successRate: this.state.metrics.sent > 0 ? ((this.state.metrics.sent - this.state.metrics.failed) / this.state.metrics.sent * 100).toFixed(2) : 100
            }
        };
    }
    close() {
        if (this.messageProcessor) clearInterval(this.messageProcessor);
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.state.channels.forEach((channel)=>channel.close());
        this.emit('communication:closed');
    }
}

//# sourceMappingURL=communication.js.map