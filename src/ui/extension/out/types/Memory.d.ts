export interface Context {
    id: string;
    content: string;
    source: string;
    relevance: number;
    tokens: number;
    timestamp: number;
    metadata?: ContextMetadata;
}
export interface ContextMetadata {
    type: 'code' | 'documentation' | 'conversation' | 'web';
    language?: string;
    file?: string;
    url?: string;
}
export interface SearchResult {
    id: string;
    content: string;
    score: number;
    source: string;
    metadata?: any;
}
//# sourceMappingURL=Memory.d.ts.map