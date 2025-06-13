import { Message } from './Message';
import { OperationMode } from './OperationMode';
export interface ChatSession {
    id: string;
    createdAt: number;
    updatedAt: number;
    mode: OperationMode;
    messages: Message[];
    metadata?: SessionMetadata;
}
export interface SessionMetadata {
    title?: string;
    tags?: string[];
    workspace?: string;
    activeFile?: string;
}
//# sourceMappingURL=ChatSession.d.ts.map