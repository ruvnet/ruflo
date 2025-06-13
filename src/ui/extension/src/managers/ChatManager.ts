import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { IChatManager } from '../interfaces/IChatManager';
import { IOrchestratorManager } from '../interfaces/IOrchestratorManager';
import { IMemoryManager } from '../interfaces/IMemoryManager';
import { ChatSession, Message, OperationMode } from '../types';

export class ChatManager extends EventEmitter implements IChatManager {
    private sessions: Map<string, ChatSession> = new Map();
    private activeSessionId: string | null = null;

    constructor(
        private orchestratorManager: IOrchestratorManager,
        private memoryManager: IMemoryManager
    ) {
        super();
        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        this.orchestratorManager.on('agent-message', (event) => {
            this.handleAgentMessage(event);
        });

        this.orchestratorManager.on('error', (error) => {
            this.emit('error', error);
        });
    }

    createSession(): string {
        const sessionId = uuidv4();
        const session: ChatSession = {
            id: sessionId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            mode: OperationMode.Chat,
            messages: []
        };

        this.sessions.set(sessionId, session);
        this.activeSessionId = sessionId;
        this.emit('session-created', sessionId);

        return sessionId;
    }

    getActiveSession(): string | null {
        return this.activeSessionId;
    }

    setActiveSession(sessionId: string): void {
        if (!this.sessions.has(sessionId)) {
            throw new Error(`Session ${sessionId} not found`);
        }
        this.activeSessionId = sessionId;
        this.emit('session-changed', sessionId);
    }

    getSession(sessionId: string): ChatSession | undefined {
        return this.sessions.get(sessionId);
    }

    clearSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.messages = [];
            session.updatedAt = Date.now();
            this.emit('session-cleared', sessionId);
        }
    }

    async sendMessage(content: string, mode: OperationMode): Promise<void> {
        if (!this.activeSessionId) {
            this.createSession();
        }

        const session = this.sessions.get(this.activeSessionId!);
        if (!session) {
            throw new Error('No active session');
        }

        // Update session mode if different
        if (session.mode !== mode) {
            session.mode = mode;
            await this.orchestratorManager.switchMode(mode);
        }

        // Create user message
        const userMessage: Message = {
            id: uuidv4(),
            role: 'user',
            content,
            timestamp: Date.now()
        };

        // Add to session history
        session.messages.push(userMessage);
        session.updatedAt = Date.now();

        // Store in memory for context
        await this.memoryManager.store(
            `session:${session.id}:message:${userMessage.id}`,
            userMessage
        );

        // Emit user message event
        this.emit('user-message', userMessage);

        // Process with orchestrator
        try {
            await this.orchestratorManager.processMessage(content, mode);
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async streamResponse(response: AsyncIterable<string>): Promise<void> {
        const session = this.sessions.get(this.activeSessionId!);
        if (!session) {
            throw new Error('No active session');
        }

        const assistantMessage: Message = {
            id: uuidv4(),
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

            assistantMessage.metadata!.streaming = false;
            session.updatedAt = Date.now();

            // Store completed message
            await this.memoryManager.store(
                `session:${session.id}:message:${assistantMessage.id}`,
                assistantMessage
            );

            this.emit('assistant-message-complete', assistantMessage);
        } catch (error) {
            this.emit('stream-error', error);
            throw error;
        }
    }

    getHistory(sessionId: string): Message[] {
        const session = this.sessions.get(sessionId);
        return session ? [...session.messages] : [];
    }

    private handleAgentMessage(event: any): void {
        const session = this.sessions.get(this.activeSessionId!);
        if (!session) {
            return;
        }

        const agentMessage: Message = {
            id: uuidv4(),
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

    dispose(): void {
        this.removeAllListeners();
        this.sessions.clear();
        this.activeSessionId = null;
    }
}