import { EventEmitter } from 'events';
import { IChatManager } from '../interfaces/IChatManager';
import { IOrchestratorManager } from '../interfaces/IOrchestratorManager';
import { IMemoryManager } from '../interfaces/IMemoryManager';
import { ChatSession, Message, OperationMode } from '../types';
export declare class ChatManager extends EventEmitter implements IChatManager {
    private orchestratorManager;
    private memoryManager;
    private sessions;
    private activeSessionId;
    constructor(orchestratorManager: IOrchestratorManager, memoryManager: IMemoryManager);
    private setupEventHandlers;
    createSession(): string;
    getActiveSession(): string | null;
    setActiveSession(sessionId: string): void;
    getSession(sessionId: string): ChatSession | undefined;
    clearSession(sessionId: string): void;
    sendMessage(content: string, mode: OperationMode): Promise<void>;
    streamResponse(response: AsyncIterable<string>): Promise<void>;
    getHistory(sessionId: string): Message[];
    private handleAgentMessage;
    dispose(): void;
}
//# sourceMappingURL=ChatManager.d.ts.map