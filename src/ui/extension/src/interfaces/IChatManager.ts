import { EventEmitter } from 'events';
import { OperationMode } from '../types/OperationMode';
import { Message } from '../types/Message';
import { ChatSession } from '../types/ChatSession';

export interface IChatManager extends EventEmitter {
    // Session management
    createSession(): string;
    getActiveSession(): string | null;
    setActiveSession(sessionId: string): void;
    getSession(sessionId: string): ChatSession | undefined;
    clearSession(sessionId: string): void;
    
    // Message handling
    sendMessage(content: string, mode: OperationMode): Promise<void>;
    streamResponse(response: AsyncIterable<string>): Promise<void>;
    getHistory(sessionId: string): Message[];
    
    // Lifecycle
    dispose(): void;
}