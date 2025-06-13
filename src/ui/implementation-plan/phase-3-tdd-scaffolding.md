# Phase 3: TDD Scaffolding - Test Structure and Implementation Strategy

## TDD Philosophy and Approach

Following the Red-Green-Refactor cycle, we'll build the extension incrementally with tests driving the implementation. Each feature will have corresponding tests written first, ensuring high quality and maintainability.

## Test Framework Setup

### Core Testing Stack

```json
{
  "devDependencies": {
    "@types/mocha": "^10.0.1",
    "@types/chai": "^4.3.5",
    "@types/sinon": "^10.0.15",
    "@types/vscode": "^1.75.0",
    "@vscode/test-electron": "^2.3.0",
    "chai": "^4.3.7",
    "mocha": "^10.2.0",
    "sinon": "^15.1.0",
    "ts-node": "^10.9.1",
    "nyc": "^15.1.0",
    "eslint": "^8.41.0",
    "@typescript-eslint/eslint-plugin": "^5.59.7",
    "@typescript-eslint/parser": "^5.59.7"
  }
}
```

### Test Configuration Files

#### `.mocharc.json`
```json
{
  "timeout": 10000,
  "color": true,
  "ui": "bdd",
  "spec": ["src/**/*.test.ts"],
  "require": ["ts-node/register"],
  "recursive": true,
  "exit": true
}
```

#### `nyc.config.js`
```javascript
module.exports = {
  "extends": "@istanbuljs/nyc-config-typescript",
  "include": ["src/**/*.ts"],
  "exclude": [
    "src/**/*.test.ts",
    "src/test/**/*"
  ],
  "reporter": ["text", "html", "lcov"],
  "all": true,
  "check-coverage": true,
  "branches": 80,
  "lines": 80,
  "functions": 80,
  "statements": 80
};
```

## Test Structure and Categories

### 1. Unit Tests

#### Chat Manager Tests
```typescript
// src/managers/ChatManager.test.ts
import { expect } from 'chai';
import * as sinon from 'sinon';
import { ChatManager } from './ChatManager';
import { IOrchestratorManager } from '../interfaces/IOrchestratorManager';
import { OperationMode } from '../types';

describe('ChatManager', () => {
    let chatManager: ChatManager;
    let orchestratorStub: sinon.SinonStubbedInstance<IOrchestratorManager>;
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        orchestratorStub = sandbox.createStubInstance(OrchestratorManager);
        chatManager = new ChatManager(orchestratorStub);
    });

    afterEach(() => {
        sandbox.restore();
    });

    describe('sendMessage', () => {
        it('should send user message to orchestrator in chat mode', async () => {
            // Arrange
            const message = 'Hello, Claude!';
            const mode = OperationMode.Chat;
            orchestratorStub.processMessage.resolves();

            // Act
            await chatManager.sendMessage(message, mode);

            // Assert
            expect(orchestratorStub.processMessage).to.have.been.calledOnceWith(
                message,
                mode
            );
        });

        it('should add message to history', async () => {
            // Arrange
            const message = 'Test message';
            const sessionId = 'test-session';

            // Act
            await chatManager.sendMessage(message, OperationMode.Chat);
            const history = chatManager.getHistory(sessionId);

            // Assert
            expect(history).to.have.lengthOf(1);
            expect(history[0].content).to.equal(message);
            expect(history[0].role).to.equal('user');
        });

        it('should handle streaming responses', async () => {
            // Arrange
            const chunks = ['Hello', ' world', '!'];
            const streamStub = createAsyncIterableStub(chunks);
            let assembled = '';

            chatManager.on('stream-chunk', (chunk) => {
                assembled += chunk;
            });

            // Act
            await chatManager.streamResponse(streamStub);

            // Assert
            expect(assembled).to.equal('Hello world!');
        });
    });

    describe('session management', () => {
        it('should create new session if none exists', () => {
            // Act
            const sessionId = chatManager.createSession();

            // Assert
            expect(sessionId).to.be.a('string');
            expect(chatManager.getActiveSession()).to.equal(sessionId);
        });

        it('should clear session history', () => {
            // Arrange
            const sessionId = chatManager.createSession();
            chatManager.sendMessage('test', OperationMode.Chat);

            // Act
            chatManager.clearSession(sessionId);
            const history = chatManager.getHistory(sessionId);

            // Assert
            expect(history).to.be.empty;
        });
    });
});
```

#### Orchestrator Manager Tests
```typescript
// src/managers/OrchestratorManager.test.ts
describe('OrchestratorManager', () => {
    let manager: OrchestratorManager;
    let orchestratorMock: MockOrchestrator;
    let eventBusSpy: sinon.SinonSpy;

    beforeEach(() => {
        orchestratorMock = new MockOrchestrator();
        manager = new OrchestratorManager(orchestratorMock);
        eventBusSpy = sinon.spy();
    });

    describe('initialization', () => {
        it('should initialize orchestrator with config', async () => {
            // Arrange
            const config = {
                apiKey: 'test-key',
                maxAgents: 5,
                memoryPath: './memory'
            };

            // Act
            await manager.initialize(config);

            // Assert
            expect(orchestratorMock.initialized).to.be.true;
            expect(orchestratorMock.config).to.deep.equal(config);
        });

        it('should throw error if already initialized', async () => {
            // Arrange
            await manager.initialize({});

            // Act & Assert
            await expect(manager.initialize({}))
                .to.be.rejectedWith('Orchestrator already initialized');
        });
    });

    describe('mode switching', () => {
        it('should switch to Plan & Reflect mode', async () => {
            // Arrange
            await manager.initialize({});

            // Act
            await manager.switchMode(OperationMode.PlanReflect);

            // Assert
            expect(orchestratorMock.agents).to.have.lengthOf(3);
            expect(orchestratorMock.agents).to.include('coordinator');
            expect(orchestratorMock.agents).to.include('implementer');
            expect(orchestratorMock.agents).to.include('reflector');
        });

        it('should clean up agents when switching modes', async () => {
            // Arrange
            await manager.initialize({});
            await manager.switchMode(OperationMode.PlanReflect);

            // Act
            await manager.switchMode(OperationMode.Chat);

            // Assert
            expect(orchestratorMock.agents).to.have.lengthOf(1);
            expect(orchestratorMock.agents[0]).to.equal('assistant');
        });
    });

    describe('event handling', () => {
        it('should forward agent messages', async () => {
            // Arrange
            const handler = sinon.spy();
            manager.subscribeToEvents(handler);

            // Act
            orchestratorMock.emit({
                type: EventType.AGENT_MESSAGE,
                payload: { agent: 'coordinator', message: 'Planning task...' }
            });

            // Assert
            expect(handler).to.have.been.calledWith({
                type: EventType.AGENT_MESSAGE,
                payload: { agent: 'coordinator', message: 'Planning task...' }
            });
        });

        it('should handle task completion events', async () => {
            // Arrange
            const taskCompleteHandler = sinon.spy();
            manager.on('task-complete', taskCompleteHandler);

            // Act
            orchestratorMock.emit({
                type: EventType.TASK_COMPLETED,
                payload: { taskId: '123', result: 'success' }
            });

            // Assert
            expect(taskCompleteHandler).to.have.been.calledWith({
                taskId: '123',
                result: 'success'
            });
        });
    });
});
```

#### Tool Manager Tests
```typescript
// src/managers/ToolManager.test.ts
describe('ToolManager', () => {
    let toolManager: ToolManager;
    let permissionManager: MockPermissionManager;
    let fileSystemTool: MockTool;

    beforeEach(() => {
        permissionManager = new MockPermissionManager();
        toolManager = new ToolManager(permissionManager);
        fileSystemTool = new MockTool();
        toolManager.registerTool('filesystem', fileSystemTool);
    });

    describe('tool registration', () => {
        it('should register new tools', () => {
            // Arrange
            const terminalTool = new MockTool();

            // Act
            toolManager.registerTool('terminal', terminalTool);

            // Assert
            expect(toolManager.getRegisteredTools()).to.include('terminal');
        });

        it('should throw error for duplicate tool names', () => {
            // Act & Assert
            expect(() => toolManager.registerTool('filesystem', new MockTool()))
                .to.throw('Tool filesystem already registered');
        });
    });

    describe('tool invocation', () => {
        it('should check permissions before invoking tool', async () => {
            // Arrange
            permissionManager.setResponse(true);

            // Act
            await toolManager.invokeTool('filesystem', {
                action: 'write',
                path: '/test.txt',
                content: 'Hello'
            });

            // Assert
            expect(permissionManager.checkPermission).to.have.been.calledWith(
                'filesystem',
                'write'
            );
        });

        it('should throw error if permission denied', async () => {
            // Arrange
            permissionManager.setResponse(false);

            // Act & Assert
            await expect(toolManager.invokeTool('filesystem', {
                action: 'delete',
                path: '/important.txt'
            })).to.be.rejectedWith('Permission denied for filesystem.delete');
        });

        it('should log tool invocations', async () => {
            // Arrange
            permissionManager.setResponse(true);

            // Act
            await toolManager.invokeTool('filesystem', {
                action: 'read',
                path: '/test.txt'
            });

            const history = toolManager.getInvocationHistory();

            // Assert
            expect(history).to.have.lengthOf(1);
            expect(history[0].tool).to.equal('filesystem');
            expect(history[0].action).to.equal('read');
            expect(history[0].timestamp).to.be.a('number');
        });
    });
});
```

### 2. Integration Tests

#### Extension Activation Test
```typescript
// src/test/extension.test.ts
import * as vscode from 'vscode';
import { expect } from 'chai';

describe('Extension Integration Tests', () => {
    it('should activate extension successfully', async () => {
        // Act
        const extension = vscode.extensions.getExtension('claude-flow.vscode-extension');
        await extension?.activate();

        // Assert
        expect(extension?.isActive).to.be.true;
    });

    it('should register all commands', async () => {
        // Arrange
        const expectedCommands = [
            'claude-flow.openChat',
            'claude-flow.askClaude',
            'claude-flow.switchMode',
            'claude-flow.stopExecution'
        ];

        // Act
        const commands = await vscode.commands.getCommands();

        // Assert
        expectedCommands.forEach(cmd => {
            expect(commands).to.include(cmd);
        });
    });

    it('should open chat panel on command', async () => {
        // Act
        await vscode.commands.executeCommand('claude-flow.openChat');
        
        // Assert
        const panels = vscode.window.tabGroups.all
            .flatMap(group => group.tabs)
            .filter(tab => tab.label === 'Claude Flow Chat');
        
        expect(panels).to.have.lengthOf(1);
    });
});
```

#### Webview Communication Test
```typescript
// src/test/webview.test.ts
describe('Webview Integration', () => {
    let panel: vscode.WebviewPanel;
    let messageSpy: sinon.SinonSpy;

    beforeEach(async () => {
        panel = vscode.window.createWebviewPanel(
            'test',
            'Test Panel',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        
        messageSpy = sinon.spy();
        panel.webview.onDidReceiveMessage(messageSpy);
    });

    it('should receive messages from webview', async () => {
        // Arrange
        const testMessage = {
            type: 'user-message',
            payload: { content: 'Hello' }
        };

        // Act
        // Simulate webview sending message
        await panel.webview.postMessage({
            command: 'test-message',
            data: testMessage
        });

        // Assert
        await waitFor(() => {
            expect(messageSpy).to.have.been.called;
            expect(messageSpy.firstCall.args[0]).to.deep.equal(testMessage);
        });
    });

    it('should update webview content', async () => {
        // Arrange
        const html = '<div id="test">Updated Content</div>';

        // Act
        panel.webview.html = html;

        // Assert
        expect(panel.webview.html).to.include('Updated Content');
    });
});
```

### 3. End-to-End Tests

#### Chat Flow E2E Test
```typescript
// src/test/e2e/chat.e2e.test.ts
describe('Chat Flow E2E', () => {
    let mockClaudeAPI: MockClaudeAPI;
    let extension: any;

    before(async () => {
        // Setup mock Claude API
        mockClaudeAPI = new MockClaudeAPI();
        mockClaudeAPI.setResponse('Hello! I can help you with that.');
        
        // Activate extension with mock
        process.env.CLAUDE_API_MOCK = 'true';
        extension = await activateExtension();
    });

    it('should complete chat interaction', async () => {
        // Open chat
        await vscode.commands.executeCommand('claude-flow.openChat');
        
        // Send message
        const chatPanel = getChatPanel();
        await chatPanel.sendMessage('Hello, Claude!');
        
        // Wait for response
        await waitFor(() => {
            const messages = chatPanel.getMessages();
            expect(messages).to.have.lengthOf(2);
            expect(messages[1].role).to.equal('assistant');
            expect(messages[1].content).to.include('Hello! I can help');
        });
    });

    it('should handle mode switching', async () => {
        // Get chat panel
        const chatPanel = getChatPanel();
        
        // Switch to Plan & Reflect mode
        await chatPanel.switchMode('plan-reflect');
        
        // Send complex task
        await chatPanel.sendMessage('Create a REST API for user management');
        
        // Verify multiple agents spawned
        await waitFor(() => {
            const agents = chatPanel.getActiveAgents();
            expect(agents).to.have.length.greaterThan(1);
            expect(agents.map(a => a.role)).to.include('coordinator');
        });
    });
});
```

#### Plan & Reflect E2E Test
```typescript
// src/test/e2e/plan-reflect.e2e.test.ts
describe('Plan & Reflect Flow E2E', () => {
    it('should execute full plan and reflect cycle', async () => {
        // Setup
        const mockOrchestrator = setupMockOrchestrator();
        mockOrchestrator.setPlanResponse([
            'Step 1: Parse requirements',
            'Step 2: Design API structure',
            'Step 3: Implement endpoints',
            'Step 4: Write tests',
            'Step 5: Refactor and optimize'
        ]);

        // Execute
        await vscode.commands.executeCommand('claude-flow.openChat');
        const chatPanel = getChatPanel();
        await chatPanel.switchMode('plan-reflect');
        await chatPanel.sendMessage('Build a TODO list API');

        // Verify planning phase
        await waitFor(() => {
            const tasks = chatPanel.getTasks();
            expect(tasks).to.have.lengthOf(5);
            expect(tasks[0].status).to.equal('in-progress');
        });

        // Simulate task completion
        for (let i = 0; i < 5; i++) {
            mockOrchestrator.completeTask(i);
            await waitFor(() => {
                const tasks = chatPanel.getTasks();
                expect(tasks[i].status).to.equal('completed');
            });
        }

        // Verify reflection phase
        await waitFor(() => {
            const scratchpad = chatPanel.getScratchpadContent();
            expect(scratchpad).to.include('All tasks completed successfully');
            expect(scratchpad).to.include('Code quality meets standards');
        });
    });
});
```

## Test Utilities and Helpers

### Mock Factory
```typescript
// src/test/mocks/mockFactory.ts
export class MockFactory {
    static createMockOrchestrator(): MockOrchestrator {
        return new MockOrchestrator({
            agents: ['assistant'],
            eventBus: new MockEventBus(),
            taskScheduler: new MockTaskScheduler()
        });
    }

    static createMockClaudeAPI(): MockClaudeAPI {
        return new MockClaudeAPI({
            model: 'claude-3-opus',
            streamingEnabled: true,
            defaultResponses: new Map()
        });
    }

    static createMockVSCodeAPI(): MockVSCodeAPI {
        return new MockVSCodeAPI({
            workspace: new MockWorkspace(),
            window: new MockWindow(),
            commands: new MockCommands()
        });
    }
}
```

### Test Helpers
```typescript
// src/test/helpers/testHelpers.ts
export async function waitFor(
    condition: () => void | Promise<void>,
    timeout: number = 5000,
    interval: number = 100
): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        try {
            await condition();
            return;
        } catch (error) {
            await sleep(interval);
        }
    }
    
    throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

export function createAsyncIterableStub<T>(items: T[]): AsyncIterable<T> {
    return {
        async *[Symbol.asyncIterator]() {
            for (const item of items) {
                yield item;
            }
        }
    };
}

export async function activateExtension(): Promise<any> {
    const extension = vscode.extensions.getExtension('claude-flow.vscode-extension');
    if (!extension) {
        throw new Error('Extension not found');
    }
    return extension.activate();
}
```

## Test Data Fixtures

### Conversation Fixtures
```typescript
// src/test/fixtures/conversations.ts
export const conversationFixtures = {
    simple: {
        user: 'What is TypeScript?',
        assistant: 'TypeScript is a typed superset of JavaScript...'
    },
    
    codeGeneration: {
        user: 'Write a function to calculate factorial',
        assistant: `Here's a factorial function in TypeScript:

\`\`\`typescript
function factorial(n: number): number {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
}
\`\`\``
    },
    
    planReflect: {
        user: 'Create a user authentication system',
        plan: [
            'Design authentication flow',
            'Implement user model',
            'Create auth endpoints',
            'Add JWT token handling',
            'Write tests'
        ],
        implementation: {
            // Mock implementation responses
        }
    }
};
```

## TDD Workflow Implementation

### 1. Feature Development Cycle

```bash
# 1. Write failing test
npm run test:watch -- --grep "new feature"

# 2. Implement minimal code to pass
# ... write implementation ...

# 3. Verify test passes
npm run test

# 4. Refactor with confidence
# ... improve code ...

# 5. Check coverage
npm run test:coverage
```

### 2. Test Scripts

```json
{
  "scripts": {
    "test": "mocha",
    "test:watch": "mocha --watch",
    "test:coverage": "nyc mocha",
    "test:integration": "node ./src/test/runTests.js",
    "test:e2e": "mocha src/test/e2e/**/*.test.ts",
    "test:all": "npm run test && npm run test:integration && npm run test:e2e"
  }
}
```

## Coverage Goals and Metrics

### Target Coverage
- Overall: 80%
- Critical paths: 95%
- UI components: 70%
- Utilities: 90%

### Coverage Report Structure
```
-------------------------|---------|----------|---------|---------|
File                     | % Stmts | % Branch | % Funcs | % Lines |
-------------------------|---------|----------|---------|---------|
All files                |   85.3  |   82.1   |   87.5  |   85.0  |
 managers/               |   90.2  |   88.5   |   92.1  |   90.0  |
  ChatManager.ts         |   92.5  |   90.0   |   95.0  |   92.5  |
  OrchestratorManager.ts |   88.0  |   85.0   |   90.0  |   88.0  |
 ui/                     |   75.5  |   72.0   |   78.0  |   75.0  |
  ChatPanel.ts           |   78.0  |   75.0   |   80.0  |   78.0  |
 utils/                  |   95.0  |   92.5   |   96.0  |   95.0  |
-------------------------|---------|----------|---------|---------|
```

## Continuous Integration Setup

### GitHub Actions Workflow
```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run type check
        run: npm run typecheck
      
      - name: Run unit tests
        run: npm run test:coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
      
      - name: Run integration tests
        run: xvfb-run -a npm run test:integration
```

---

This TDD scaffolding provides a comprehensive testing foundation for the Claude-Flow VS Code extension. By following these patterns and using the provided test structures, developers can ensure high-quality, maintainable code throughout the implementation process.