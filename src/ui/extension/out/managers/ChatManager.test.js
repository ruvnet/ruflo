"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const chai_1 = require("chai");
const sinon = __importStar(require("sinon"));
const ChatManager_1 = require("./ChatManager");
const OperationMode_1 = require("../types/OperationMode");
const events_1 = require("events");
// We'll use regular chai assertions without the plugins for now
class MockOrchestratorManager extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.initialized = false;
        this.currentMode = OperationMode_1.OperationMode.Chat;
    }
    async initialize(config) {
        this.initialized = true;
    }
    isInitialized() {
        return this.initialized;
    }
    async switchMode(mode) {
        this.currentMode = mode;
    }
    getCurrentMode() {
        return this.currentMode;
    }
    async executeTask(task) {
        return { taskId: task.id, status: 'completed' };
    }
    async processMessage(message, mode) {
        // Simulate processing
    }
    async stopExecution() {
        // Simulate stop
    }
    getActiveAgents() {
        return [];
    }
    subscribeToEvents(handler) {
        return () => { };
    }
    dispose() {
        this.removeAllListeners();
    }
}
class MockMemoryManager {
    constructor() {
        this.storage = new Map();
    }
    async store(key, value) {
        this.storage.set(key, value);
    }
    async retrieve(key) {
        return this.storage.get(key);
    }
    async delete(key) {
        this.storage.delete(key);
    }
    async exists(key) {
        return this.storage.has(key);
    }
    async searchSemantic(query, limit) {
        return [];
    }
    async getRelevantContext(query, maxTokens) {
        return [];
    }
    pruneContext(contexts, maxTokens) {
        return contexts;
    }
    getStoragePath() {
        return '/test/storage';
    }
    async getStorageSize() {
        return this.storage.size;
    }
    async clearStorage() {
        this.storage.clear();
    }
    dispose() {
        this.storage.clear();
    }
}
describe('ChatManager', () => {
    let chatManager;
    let orchestratorManager;
    let memoryManager;
    let sandbox;
    beforeEach(() => {
        sandbox = sinon.createSandbox();
        orchestratorManager = new MockOrchestratorManager();
        memoryManager = new MockMemoryManager();
        chatManager = new ChatManager_1.ChatManager(orchestratorManager, memoryManager);
    });
    afterEach(() => {
        sandbox.restore();
        chatManager.dispose();
    });
    describe('session management', () => {
        it('should create a new session', () => {
            const sessionId = chatManager.createSession();
            (0, chai_1.expect)(sessionId).to.be.a('string');
            (0, chai_1.expect)(chatManager.getActiveSession()).to.equal(sessionId);
            const session = chatManager.getSession(sessionId);
            (0, chai_1.expect)(session).to.exist;
            (0, chai_1.expect)(session?.messages).to.be.empty;
            (0, chai_1.expect)(session?.mode).to.equal(OperationMode_1.OperationMode.Chat);
        });
        it('should emit session-created event when creating session', (done) => {
            chatManager.on('session-created', (sessionId) => {
                (0, chai_1.expect)(sessionId).to.be.a('string');
                done();
            });
            chatManager.createSession();
        });
        it('should switch active session', () => {
            const session1 = chatManager.createSession();
            const session2 = chatManager.createSession();
            chatManager.setActiveSession(session1);
            (0, chai_1.expect)(chatManager.getActiveSession()).to.equal(session1);
        });
        it('should throw error when switching to non-existent session', () => {
            (0, chai_1.expect)(() => chatManager.setActiveSession('invalid-id'))
                .to.throw('Session invalid-id not found');
        });
        it('should clear session history', () => {
            const sessionId = chatManager.createSession();
            // Add a message first
            chatManager.sendMessage('test', OperationMode_1.OperationMode.Chat);
            chatManager.clearSession(sessionId);
            const history = chatManager.getHistory(sessionId);
            (0, chai_1.expect)(history).to.be.empty;
        });
    });
    describe('message handling', () => {
        it('should send user message and store in history', async () => {
            const sessionId = chatManager.createSession();
            const message = 'Hello, Claude!';
            const processMessageSpy = sandbox.spy(orchestratorManager, 'processMessage');
            const storeMessageSpy = sandbox.spy(memoryManager, 'store');
            await chatManager.sendMessage(message, OperationMode_1.OperationMode.Chat);
            (0, chai_1.expect)(processMessageSpy.calledOnce).to.be.true;
            (0, chai_1.expect)(processMessageSpy.firstCall.args).to.deep.equal([message, OperationMode_1.OperationMode.Chat]);
            (0, chai_1.expect)(storeMessageSpy.called).to.be.true;
            const history = chatManager.getHistory(sessionId);
            (0, chai_1.expect)(history).to.have.lengthOf(1);
            (0, chai_1.expect)(history[0].content).to.equal(message);
            (0, chai_1.expect)(history[0].role).to.equal('user');
        });
        it('should create session if none exists when sending message', async () => {
            const createSessionSpy = sandbox.spy(chatManager, 'createSession');
            await chatManager.sendMessage('test', OperationMode_1.OperationMode.Chat);
            (0, chai_1.expect)(createSessionSpy.calledOnce).to.be.true;
            (0, chai_1.expect)(chatManager.getActiveSession()).to.exist;
        });
        it('should switch mode when sending message in different mode', async () => {
            chatManager.createSession();
            const switchModeSpy = sandbox.spy(orchestratorManager, 'switchMode');
            await chatManager.sendMessage('test', OperationMode_1.OperationMode.PlanReflect);
            (0, chai_1.expect)(switchModeSpy.calledOnce).to.be.true;
            (0, chai_1.expect)(switchModeSpy.firstCall.args[0]).to.equal(OperationMode_1.OperationMode.PlanReflect);
        });
        it('should emit user-message event', (done) => {
            chatManager.createSession();
            chatManager.on('user-message', (message) => {
                (0, chai_1.expect)(message.content).to.equal('test message');
                (0, chai_1.expect)(message.role).to.equal('user');
                done();
            });
            chatManager.sendMessage('test message', OperationMode_1.OperationMode.Chat);
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
            (0, chai_1.expect)(assembled).to.equal('Hello world!');
        });
        it('should emit events for streaming lifecycle', async () => {
            chatManager.createSession();
            const chunks = ['test'];
            const events = [];
            chatManager.on('assistant-message-start', () => events.push('start'));
            chatManager.on('assistant-message-complete', () => events.push('complete'));
            const asyncIterable = createAsyncIterableStub(chunks);
            await chatManager.streamResponse(asyncIterable);
            (0, chai_1.expect)(events).to.deep.equal(['start', 'complete']);
        });
        it('should store completed streamed message', async () => {
            const sessionId = chatManager.createSession();
            const chunks = ['Hello', ' AI'];
            const storeSpy = sandbox.spy(memoryManager, 'store');
            const asyncIterable = createAsyncIterableStub(chunks);
            await chatManager.streamResponse(asyncIterable);
            (0, chai_1.expect)(storeSpy.called).to.be.true;
            const history = chatManager.getHistory(sessionId);
            (0, chai_1.expect)(history).to.have.lengthOf(1);
            (0, chai_1.expect)(history[0].content).to.equal('Hello AI');
            (0, chai_1.expect)(history[0].role).to.equal('assistant');
        });
    });
    describe('agent message handling', () => {
        it('should handle agent messages from orchestrator', (done) => {
            const sessionId = chatManager.createSession();
            chatManager.on('agent-message', (message) => {
                (0, chai_1.expect)(message.role).to.equal('assistant');
                (0, chai_1.expect)(message.content).to.equal('Agent response');
                (0, chai_1.expect)(message.metadata?.agent).to.equal('coordinator');
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
            (0, chai_1.expect)(history).to.have.lengthOf(1);
            (0, chai_1.expect)(history[0].content).to.equal('Task completed');
            (0, chai_1.expect)(history[0].metadata?.agent).to.equal('implementer');
        });
    });
    describe('error handling', () => {
        it('should emit error when orchestrator processing fails', async () => {
            chatManager.createSession();
            const error = new Error('Processing failed');
            sandbox.stub(orchestratorManager, 'processMessage').rejects(error);
            let emittedError = null;
            chatManager.on('error', (err) => {
                emittedError = err;
            });
            try {
                await chatManager.sendMessage('test', OperationMode_1.OperationMode.Chat);
                chai_1.expect.fail('Should have thrown an error');
            }
            catch (err) {
                (0, chai_1.expect)(err).to.be.instanceOf(Error);
                (0, chai_1.expect)(err.message).to.equal('Processing failed');
            }
            (0, chai_1.expect)(emittedError).to.equal(error);
        });
        it('should forward orchestrator errors', (done) => {
            const error = new Error('Orchestrator error');
            chatManager.on('error', (err) => {
                (0, chai_1.expect)(err).to.equal(error);
                done();
            });
            orchestratorManager.emit('error', error);
        });
    });
    describe('lifecycle', () => {
        it('should clean up resources on dispose', () => {
            const sessionId = chatManager.createSession();
            chatManager.sendMessage('test', OperationMode_1.OperationMode.Chat);
            chatManager.dispose();
            (0, chai_1.expect)(chatManager.getActiveSession()).to.be.null;
            (0, chai_1.expect)(chatManager.getSession(sessionId)).to.be.undefined;
            (0, chai_1.expect)(chatManager.listenerCount('user-message')).to.equal(0);
        });
    });
});
// Helper function
function createAsyncIterableStub(items) {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of items) {
                yield item;
            }
        }
    };
}
//# sourceMappingURL=ChatManager.test.js.map