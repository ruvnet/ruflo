export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    metadata?: MessageMetadata;
}
export interface MessageMetadata {
    agent?: string;
    mode?: string;
    tokens?: number;
    model?: string;
    streaming?: boolean;
}
//# sourceMappingURL=Message.d.ts.map