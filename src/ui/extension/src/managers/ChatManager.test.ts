import { expect } from 'chai';
import * as sinon from 'sinon';
import { ChatManager } from './ChatManager';
import { IOrchestratorManager } from '../interfaces/IOrchestratorManager';
import { IMemoryManager } from '../interfaces/IMemoryManager';
import { OperationMode } from '../types/OperationMode';
import { EventEmitter } from 'events';

// We'll use regular chai assertions without the plugins for now

class MockOrchestratorManager extends EventEmitter implements IOrchestratorManager {
    initialized = false;
    currentMode = OperationMode.Chat;
    
    async initialize(config: any): Promise<void> {
        this.initialized = true;
    }
    
    isInitialized(): boolean {
        return this.initialized;
    }
    
    async switchMode(mode: OperationMode): Promise<void> {
        this.currentMode = mode;
    }
    
    getCurrentMode(): OperationMode {
        return this.currentMode;
    }
    
    async executeTask(task: any): Promise<any> {
        return { taskId: task.id, status: 'completed' };
    }
    
    async processMessage(message: string, mode: OperationMode): Promise<void> {
        // Simulate processing
    }
    
    async stopExecution(): Promise<void> {
        // Simulate stop
    }
    
    getActiveAgents(): any[] {
        return [];
    }
    
    subscribeToEvents(handler: (event: any) => void): () => void {
        return () => {};
    }
    
    dispose(): void {
        this.removeAllListeners();
    }
}

class MockMemoryManager implements IMemoryManager {
    private storage = new Map<string, any>();
    
    async store(key: string, value: any): Promise<void> {
        this.storage.set(key, value);
    }
    
    async retrieve(key: string): Promise<any> {
        return this.storage.get(key);
    }
    
    async delete(key: string): Promise<void> {
        this.storage.delete(key);
    }
    
    async exists(key: string): Promise<boolean> {
        return this.storage.has(key);
    }
    
    async searchSemantic(query: string, limit?: number): Promise<any[]> {
        return [];
    }
    
    async getRelevantContext(query: string, maxTokens: number): Promise<any[]> {
        return [];
    }
    
    pruneContext(contexts: any[], maxTokens: number): any[] {
        return contexts;
    }
    
    getStoragePath(): string {
        return '/test/storage';
    }
    
    async getStorageSize(): Promise<number> {
        return this.storage.size;
    }
    
    async clearStorage(): Promise<void> {
        this.storage.clear();
    }
    
    dispose(): void {
        this.storage.clear();
    }
}

describe('ChatManager', () => {
    let chatManager: ChatManager;
    let orchestratorManager: MockOrchestratorManager;
    let memoryManager: MockMemoryManager;
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        orchestratorManager = new MockOrchestratorManager();
        memoryManager = new MockMemoryManager();
        chatManager = new ChatManager(orchestratorManager, memoryManager);
    });

    afterEach(() => {
        sandbox.restore();
        chatManager.dispose();
    });

    describe('session management', () => {
        it('should create a new session', () => {
            const sessionId = chatManager.createSession();
            
            expect(sessionId).to.be.a('string');
            expect(chatManager.getActiveSession()).to.equal(sessionId);
            
            const session = chatManager.getSession(sessionId);
            expect(session).to.exist;
            expect(session?.messages).to.be.empty;
            expect(session?.mode).to.equal(OperationMode.Chat);
        });

        it('should emit session-created event when creating session', (done) => {
            chatManager.on('session-created', (sessionId) => {
                expect(sessionId).to.be.a('string');
                done();
            });

            chatManager.createSession();
        });

        it('should switch active session', () => {
            const session1 = chatManager.createSession();
            const session2 = chatManager.createSession();
            
            chatManager.setActiveSession(session1);
            expect(chatManager.getActiveSession()).to.equal(session1);
        });

        it('should throw error when switching to non-existent session', () => {
            expect(() => chatManager.setActiveSession('invalid-id'))
                .to.throw('Session invalid-id not found');
        });

        it('should clear session history', () => {
            const sessionId = chatManager.createSession();
            
            // Add a message first
            chatManager.sendMessage('test', OperationMode.Chat);
            
            chatManager.clearSession(sessionId);
            const history = chatManager.getHistory(sessionId);
            
            expect(history).to.be.empty;
        });
    });

    describe('message handling', () => {
        it('should send user message and store in history', async () => {
            const sessionId = chatManager.createSession();
            const message = 'Hello, Claude!';
            
            const processMessageSpy = sandbox.spy(orchestratorManager, 'processMessage');
            const storeMessageSpy = sandbox.spy(memoryManager, 'store');
            
            await chatManager.sendMessage(message, OperationMode.Chat);
            
            expect(processMessageSpy.calledOnce).to.be.true;
            expect(processMessageSpy.firstCall.args).to.deep.equal([message, OperationMode.Chat]);
            expect(storeMessageSpy.called).to.be.true;
            
            const history = chatManager.getHistory(sessionId);
            expect(history).to.have.lengthOf(1);
            expect(history[0].content).to.equal(message);
            expect(history[0].role).to.equal('user');
        });

        it('should create session if none exists when sending message', async () => {
            const createSessionSpy = sandbox.spy(chatManager, 'createSession');
            
            await chatManager.sendMessage('test', OperationMode.Chat);
            
            expect(createSessionSpy.calledOnce).to.be.true;
            expect(chatManager.getActiveSession()).to.exist;
        });

        it('should switch mode when sending message in different mode', async () => {
            chatManager.createSession();
            const switchModeSpy = sandbox.spy(orchestratorManager, 'switchMode');
            
            await chatManager.sendMessage('test', OperationMode.PlanReflect);
            
            expect(switchModeSpy.calledOnce).to.be.true;
            expect(switchModeSpy.firstCall.args[0]).to.equal(OperationMode.PlanReflect);
        });

        it('should emit user-message event', (done) => {
            chatManager.createSession();
            
            chatManager.on('user-message', (message) => {
                expect(message.content).to.equal('test message');
                expect(message.role).to.equal('user');
                done();
            });
            
            chatManager.sendMessage('test message', OperationMode.Chat);
        });
    });

    describe('streaming responses', () => {
        it('should handle streaming response chunks', async () => {
            chatManager.createSession();
            const chunks = ['Hello', ' world', '!'];
            let assembled = '';
            
            chatManager.on('stream-chunk', (chunk) => {
                assembled += chunk;
            });
            
            const asyncIterable = createAsyncIterableStub(chunks);
            await chatManager.streamResponse(asyncIterable);
            
            expect(assembled).to.equal('Hello world!');
        });

        it('should emit events for streaming lifecycle', async () => {
            chatManager.createSession();
            const chunks = ['test'];
            const events: string[] = [];
            
            chatManager.on('assistant-message-start', () => events.push('start'));
            chatManager.on('assistant-message-complete', () => events.push('complete'));
            
            const asyncIterable = createAsyncIterableStub(chunks);
            await chatManager.streamResponse(asyncIterable);
            
            expect(events).to.deep.equal(['start', 'complete']);
        });

        it('should store completed streamed message', async () => {
            const sessionId = chatManager.createSession();
            const chunks = ['Hello', ' AI'];
            const storeSpy = sandbox.spy(memoryManager, 'store');
            
            const asyncIterable = createAsyncIterableStub(chunks);
            await chatManager.streamResponse(asyncIterable);
            
            expect(storeSpy.called).to.be.true;
            
            const history = chatManager.getHistory(sessionId);
            expect(history).to.have.lengthOf(1);
            expect(history[0].content).to.equal('Hello AI');
            expect(history[0].role).to.equal('assistant');
        });
    });

    describe('agent message handling', () => {
        it('should handle agent messages from orchestrator', (done) => {
            const sessionId = chatManager.createSession();
            
            chatManager.on('agent-message', (message) => {
                expect(message.role).to.equal('assistant');
                expect(message.content).to.equal('Agent response');
                expect(message.metadata?.agent).to.equal('coordinator');
                done();
            });
            
            orchestratorManager.emit('agent-message', {
                payload: {
                    agent: 'coordinator',
                    message: 'Agent response'
                }
            });
        });

        it('should add agent messages to session history', () => {
            const sessionId = chatManager.createSession();
            
            orchestratorManager.emit('agent-message', {
                payload: {
                    agent: 'implementer',
                    message: 'Task completed'
                }
            });
            
            const history = chatManager.getHistory(sessionId);
            expect(history).to.have.lengthOf(1);
            expect(history[0].content).to.equal('Task completed');
            expect(history[0].metadata?.agent).to.equal('implementer');
        });
    });

    describe('error handling', () => {
        it('should emit error when orchestrator processing fails', async () => {
            chatManager.createSession();
            const error = new Error('Processing failed');
            
            sandbox.stub(orchestratorManager, 'processMessage').rejects(error);
            
            let emittedError: Error | null = null;
            chatManager.on('error', (err) => {
                emittedError = err;
            });
            
            try {
                await chatManager.sendMessage('test', OperationMode.Chat);
                expect.fail('Should have thrown an error');
            } catch (err) {
                expect(err).to.be.instanceOf(Error);
                expect((err as Error).message).to.equal('Processing failed');
            }
            
            expect(emittedError).to.equal(error);
        });

        it('should forward orchestrator errors', (done) => {
            const error = new Error('Orchestrator error');
            
            chatManager.on('error', (err) => {
                expect(err).to.equal(error);
                done();
            });
            
            orchestratorManager.emit('error', error);
        });
    });

    describe('lifecycle', () => {
        it('should clean up resources on dispose', () => {
            const sessionId = chatManager.createSession();
            chatManager.sendMessage('test', OperationMode.Chat);
            
            chatManager.dispose();
            
            expect(chatManager.getActiveSession()).to.be.null;
            expect(chatManager.getSession(sessionId)).to.be.undefined;
            expect(chatManager.listenerCount('user-message')).to.equal(0);
        });
    });
});

// Helper function
function createAsyncIterableStub<T>(items: T[]): AsyncIterable<T> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of items) {
                yield item;
            }
        }
    };
}