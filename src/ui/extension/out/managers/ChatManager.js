"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatManager = void 0;
const events_1 = require("events");
const uuid_1 = require("uuid");
const types_1 = require("../types");
class ChatManager extends events_1.EventEmitter {
    constructor(orchestratorManager, memoryManager) {
        super();
        this.orchestratorManager = orchestratorManager;
        this.memoryManager = memoryManager;
        this.sessions = new Map();
        this.activeSessionId = null;
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.orchestratorManager.on('agent-message', (event) => {
            this.handleAgentMessage(event);
        });
        this.orchestratorManager.on('error', (error) => {
            this.emit('error', error);
        });
    }
    createSession() {
        const sessionId = (0, uuid_1.v4)();
        const session = {
            id: sessionId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            mode: types_1.OperationMode.Chat,
            messages: []
        };
        this.sessions.set(sessionId, session);
        this.activeSessionId = sessionId;
        this.emit('session-created', sessionId);
        return sessionId;
    }
    getActiveSession() {
        return this.activeSessionId;
    }
    setActiveSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        this.activeSessionId = sessionId;
        this.emit('session-changed', sessionId);
    }
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    clearSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.messages = [];
            session.updatedAt = Date.now();
            this.emit('session-cleared', sessionId);
        }
    }
    async sendMessage(content, mode) {
        if (!this.activeSessionId) {
            this.createSession();
        }
        const session = this.sessions.get(this.activeSessionId);
        if (!session) {
            throw new Error('No active session');
        }
        // Update session mode if different
        if (session.mode !== mode) {
            session.mode = mode;
            await this.orchestratorManager.switchMode(mode);
        }
        // Create user message
        const userMessage = {
            id: (0, uuid_1.v4)(),
            role: 'user',
            content,
            timestamp: Date.now()
        };
        // Add to session history
        session.messages.push(userMessage);
        session.updatedAt = Date.now();
        // Store in memory for context
        await this.memoryManager.store(`session:${session.id}:message:${userMessage.id}`, userMessage);
        // Emit user message event
        this.emit('user-message', userMessage);
        // Process with orchestrator
        try {
            await this.orchestratorManager.processMessage(content, mode);
        }
        catch (error) {
            this.emit('error', error);
            throw error;
        }
    }
    async streamResponse(response) {
        const session = this.sessions.get(this.activeSessionId);
        if (!session) {
            throw new Error('No active session');
        }
        const assistantMessage = {
            id: (0, uuid_1.v4)(),
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            metadata: { streaming: true }
        };
        session.messages.push(assistantMessage);
        this.emit('assistant-message-start', assistantMessage);
        try {
            for await (const chunk of response) {
                assistantMessage.content += chunk;
                this.emit('stream-chunk', chunk);
            }
            assistantMessage.metadata.streaming = false;
            session.updatedAt = Date.now();
            // Store completed message
            await this.memoryManager.store(`session:${session.id}:message:${assistantMessage.id}`, assistantMessage);
            this.emit('assistant-message-complete', assistantMessage);
        }
        catch (error) {
            this.emit('stream-error', error);
            throw error;
        }
    }
    getHistory(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? [...session.messages] : [];
    }
    handleAgentMessage(event) {
        const session = this.sessions.get(this.activeSessionId);
        if (!session) {
            return;
        }
        const agentMessage = {
            id: (0, uuid_1.v4)(),
            role: 'assistant',
            content: event.payload.message,
            timestamp: Date.now(),
            metadata: {
                agent: event.payload.agent,
                mode: session.mode
            }
        };
        session.messages.push(agentMessage);
        session.updatedAt = Date.now();
        this.emit('agent-message', agentMessage);
    }
    dispose() {
        this.removeAllListeners();
        this.sessions.clear();
        this.activeSessionId = null;
    }
}
exports.ChatManager = ChatManager;
//# sourceMappingURL=ChatManager.js.map