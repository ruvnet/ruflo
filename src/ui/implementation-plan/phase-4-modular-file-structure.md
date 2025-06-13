# Phase 4: Modular File Structure - Claude-Flow VS Code Extension

## Overview

This document outlines the complete modular file structure for the Claude-Flow VS Code extension, demonstrating a clean architecture with separation of concerns, testability, and maintainability.

## Directory Structure

```
📦 claude-flow-vscode-extension/
├─ 📄 package.json                    # Extension manifest and dependencies
├─ 📄 tsconfig.json                   # TypeScript configuration
├─ 📄 .eslintrc.json                  # ESLint configuration
├─ 📄 .mocharc.json                   # Mocha test configuration
├─ 📄 nyc.config.js                   # Coverage configuration
├─ 📄 webpack.config.js               # Webpack bundling configuration
├─ 📄 README.md                       # Extension documentation
├─ 📄 CHANGELOG.md                    # Version history
├─ 📄 LICENSE                         # MIT License
├─ 📄 .vscodeignore                   # Files to exclude from package
├─ 📄 .gitignore                      # Git ignore patterns
│
├─ 📂 .vscode/                        # VS Code workspace settings
│  ├─ 📄 launch.json                  # Debug configurations
│  ├─ 📄 tasks.json                   # Build tasks
│  └─ 📄 extensions.json              # Recommended extensions
│
├─ 📂 src/                            # Source code
│  ├─ 📄 extension.ts                 # Main entry point
│  │
│  ├─ 📂 interfaces/                  # TypeScript interfaces
│  │  ├─ 📄 IExtensionContext.ts      # Extension context interface
│  │  ├─ 📄 IChatManager.ts           # Chat manager interface
│  │  ├─ 📄 IOrchestratorManager.ts   # Orchestrator interface
│  │  ├─ 📄 IToolManager.ts           # Tool manager interface
│  │  ├─ 📄 IMemoryManager.ts         # Memory manager interface
│  │  ├─ 📄 IConfigManager.ts         # Configuration interface
│  │  └─ 📄 index.ts                  # Interface exports
│  │
│  ├─ 📂 types/                       # Type definitions
│  │  ├─ 📄 OperationMode.ts          # Operation modes enum
│  │  ├─ 📄 Message.ts                # Message types
│  │  ├─ 📄 ChatSession.ts            # Session types
│  │  ├─ 📄 Task.ts                   # Task types
│  │  ├─ 📄 SystemEvent.ts            # Event types
│  │  ├─ 📄 Agent.ts                  # Agent types
│  │  ├─ 📄 Tool.ts                   # Tool types
│  │  ├─ 📄 Permission.ts             # Permission types
│  │  ├─ 📄 Memory.ts                 # Memory types
│  │  └─ 📄 index.ts                  # Type exports
│  │
│  ├─ 📂 managers/                    # Core business logic
│  │  ├─ 📄 ChatManager.ts            # Chat session management
│  │  ├─ 📄 ChatManager.test.ts       # Chat manager tests
│  │  ├─ 📄 OrchestratorManager.ts    # Claude-Flow integration
│  │  ├─ 📄 OrchestratorManager.test.ts
│  │  ├─ 📄 ToolManager.ts            # Tool execution management
│  │  ├─ 📄 ToolManager.test.ts
│  │  ├─ 📄 MemoryManager.ts          # Context and memory
│  │  ├─ 📄 MemoryManager.test.ts
│  │  ├─ 📄 ConfigManager.ts          # Configuration handling
│  │  ├─ 📄 ConfigManager.test.ts
│  │  └─ 📄 index.ts                  # Manager exports
│  │
│  ├─ 📂 ui/                          # User interface components
│  │  ├─ 📄 ChatPanel.ts              # Main webview panel
│  │  ├─ 📄 ChatPanel.test.ts
│  │  ├─ 📄 panelHtml.ts              # HTML template generator
│  │  ├─ 📄 WebviewMessageHandler.ts  # Message handling
│  │  ├─ 📄 WebviewMessageHandler.test.ts
│  │  └─ 📂 webview/                  # Webview frontend
│  │      ├─ 📄 index.html            # Webview HTML template
│  │      ├─ 📄 main.ts               # Frontend entry point
│  │      ├─ 📄 style.css             # Webview styles
│  │      ├─ 📂 components/           # React/UI components
│  │      │  ├─ 📄 ChatInterface.tsx  # Main chat UI
│  │      │  ├─ 📄 MessageList.tsx    # Message display
│  │      │  ├─ 📄 InputBox.tsx       # User input
│  │      │  ├─ 📄 ModeSelector.tsx   # Mode switching
│  │      │  ├─ 📄 AgentVisualizer.tsx # Agent status
│  │      │  ├─ 📄 TaskProgress.tsx   # Task tracking
│  │      │  ├─ 📄 ScratchpadView.tsx # Reflection display
│  │      │  └─ 📄 ToolLog.tsx        # Tool execution log
│  │      └─ 📂 utils/                # Frontend utilities
│  │         ├─ 📄 messageHandler.ts  # Webview messaging
│  │         ├─ 📄 markdown.ts        # Markdown rendering
│  │         └─ 📄 syntax.ts          # Syntax highlighting
│  │
│  ├─ 📂 commands/                    # VS Code command handlers
│  │  ├─ 📄 registerCommands.ts       # Command registration
│  │  ├─ 📄 chatCommands.ts           # Chat-related commands
│  │  ├─ 📄 chatCommands.test.ts
│  │  ├─ 📄 modeCommands.ts           # Mode switching commands
│  │  ├─ 📄 modeCommands.test.ts
│  │  └─ 📄 index.ts                  # Command exports
│  │
│  ├─ 📂 adapters/                    # External service adapters
│  │  ├─ 📄 ClaudeFlowAdapter.ts      # Claude-Flow integration
│  │  ├─ 📄 ClaudeFlowAdapter.test.ts
│  │  ├─ 📄 ClaudeAPIAdapter.ts       # Anthropic API adapter
│  │  ├─ 📄 ClaudeAPIAdapter.test.ts
│  │  ├─ 📄 VSCodeAdapter.ts          # VS Code API wrapper
│  │  ├─ 📄 VSCodeAdapter.test.ts
│  │  └─ 📄 index.ts                  # Adapter exports
│  │
│  ├─ 📂 tools/                       # Tool implementations
│  │  ├─ 📄 FileSystemTool.ts         # File operations
│  │  ├─ 📄 FileSystemTool.test.ts
│  │  ├─ 📄 TerminalTool.ts           # Terminal execution
│  │  ├─ 📄 TerminalTool.test.ts
│  │  ├─ 📄 GitTool.ts                # Git operations
│  │  ├─ 📄 GitTool.test.ts
│  │  ├─ 📄 SearchTool.ts             # Code search
│  │  ├─ 📄 SearchTool.test.ts
│  │  └─ 📄 index.ts                  # Tool exports
│  │
│  ├─ 📂 utils/                       # Utility functions
│  │  ├─ 📄 logger.ts                 # Logging utility
│  │  ├─ 📄 logger.test.ts
│  │  ├─ 📄 validation.ts             # Input validation
│  │  ├─ 📄 validation.test.ts
│  │  ├─ 📄 tokenCounter.ts           # Token counting
│  │  ├─ 📄 tokenCounter.test.ts
│  │  ├─ 📄 errorHandler.ts           # Error handling
│  │  ├─ 📄 errorHandler.test.ts
│  │  └─ 📄 index.ts                  # Utility exports
│  │
│  └─ 📂 test/                         # Test infrastructure
│     ├─ 📄 runTests.ts               # Test runner
│     ├─ 📄 setup.ts                  # Test setup
│     ├─ 📂 fixtures/                 # Test data
│     │  ├─ 📄 conversations.ts       # Sample conversations
│     │  ├─ 📄 agents.ts              # Mock agent data
│     │  ├─ 📄 tasks.ts               # Sample tasks
│     │  └─ 📄 responses.ts           # Mock API responses
│     ├─ 📂 mocks/                    # Mock implementations
│     │  ├─ 📄 MockOrchestrator.ts    # Mock orchestrator
│     │  ├─ 📄 MockClaudeAPI.ts       # Mock Claude API
│     │  ├─ 📄 MockVSCodeAPI.ts       # Mock VS Code API
│     │  └─ 📄 mockFactory.ts         # Mock factory
│     ├─ 📂 helpers/                  # Test helpers
│     │  ├─ 📄 testHelpers.ts         # Common test utilities
│     │  ├─ 📄 asyncHelpers.ts        # Async test helpers
│     │  └─ 📄 assertions.ts          # Custom assertions
│     └─ 📂 e2e/                      # End-to-end tests
│        ├─ 📄 chat.e2e.test.ts       # Chat flow tests
│        ├─ 📄 planReflect.e2e.test.ts # Plan & Reflect tests
│        └─ 📄 tools.e2e.test.ts      # Tool execution tests
│
├─ 📂 media/                          # Static assets
│  ├─ 📄 icon.png                     # Extension icon
│  ├─ 📄 logo.svg                     # Claude Flow logo
│  └─ 📂 screenshots/                 # Documentation images
│
├─ 📂 out/                            # Compiled output (gitignored)
│  ├─ 📂 extension/                   # Compiled extension code
│  └─ 📂 webview/                     # Compiled webview code
│
└─ 📂 node_modules/                   # Dependencies (gitignored)
```

## Module Descriptions

### Core Modules

#### 1. Extension Entry (`src/extension.ts`)
- Activates and deactivates the extension
- Initializes all managers
- Sets up dependency injection
- Registers commands and UI elements

#### 2. Managers (`src/managers/`)
- **ChatManager**: Handles chat sessions, message routing, and conversation history
- **OrchestratorManager**: Integrates with Claude-Flow, manages agents and tasks
- **ToolManager**: Registers and executes tools with permission checking
- **MemoryManager**: Manages context storage and semantic search
- **ConfigManager**: Handles extension settings and API keys

#### 3. UI Components (`src/ui/`)
- **ChatPanel**: Main VS Code webview panel management
- **Webview Components**: React-based UI for chat interface
- **Message Handler**: Bidirectional communication between extension and webview

#### 4. Adapters (`src/adapters/`)
- **ClaudeFlowAdapter**: Wraps Claude-Flow orchestrator functionality
- **ClaudeAPIAdapter**: Handles direct Claude API calls
- **VSCodeAdapter**: Abstracts VS Code API for testing

#### 5. Tools (`src/tools/`)
- **FileSystemTool**: Safe file read/write operations
- **TerminalTool**: Execute terminal commands with permission
- **GitTool**: Git operations (commit, branch, etc.)
- **SearchTool**: Code search and navigation

### Testing Structure

#### Unit Tests
- Located alongside source files (`*.test.ts`)
- Test individual modules in isolation
- Use mocks and stubs for dependencies
- Coverage target: 80%+

#### Integration Tests
- Located in `src/test/`
- Test module interactions
- Use VS Code test framework
- Test extension activation and commands

#### E2E Tests
- Located in `src/test/e2e/`
- Test complete user workflows
- Use mock Claude API responses
- Verify UI updates and agent coordination

### Build and Configuration Files

#### TypeScript Configuration (`tsconfig.json`)
- Strict type checking enabled
- Module resolution for VS Code
- Source maps for debugging
- Incremental compilation

#### ESLint Configuration (`.eslintrc.json`)
- TypeScript-specific rules
- Naming conventions enforced
- Code style consistency
- Security best practices

#### Test Configuration
- **Mocha** (`.mocharc.json`): Test runner settings
- **NYC** (`nyc.config.js`): Coverage reporting
- **VS Code Test**: Integration test setup

## Development Guidelines

### File Naming Conventions
- PascalCase for classes and interfaces
- camelCase for functions and variables
- kebab-case for file names (except components)
- Test files: `<module>.test.ts`

### Code Organization Principles
1. **Single Responsibility**: Each module has one clear purpose
2. **Dependency Injection**: Use interfaces for testability
3. **Separation of Concerns**: UI, business logic, and data separate
4. **DRY (Don't Repeat Yourself)**: Shared logic in utils
5. **SOLID Principles**: Especially Open/Closed and Interface Segregation

### Module Size Limits
- Maximum 500 lines per file
- Split large modules into smaller focused files
- Use barrel exports (`index.ts`) for clean imports

### Testing Requirements
- Write tests before implementation (TDD)
- Unit test for each public method
- Integration test for module interactions
- E2E test for critical user paths

## Import Structure

### Example Import Hierarchy
```typescript
// In a manager file
import { IExtensionContext } from '../interfaces/IExtensionContext';
import { Message, OperationMode } from '../types';
import { logger } from '../utils';
import { ClaudeFlowAdapter } from '../adapters';

// In a UI component
import { IChatManager } from '../../interfaces/IChatManager';
import { Message } from '../../types/Message';
import { formatMessage } from '../utils/messageFormatter';

// In a test file
import { expect } from 'chai';
import * as sinon from 'sinon';
import { ChatManager } from './ChatManager';
import { MockOrchestrator } from '../test/mocks';
```

### Barrel Exports
Each module directory contains an `index.ts` for clean exports:

```typescript
// src/managers/index.ts
export * from './ChatManager';
export * from './OrchestratorManager';
export * from './ToolManager';
export * from './MemoryManager';
export * from './ConfigManager';
```

## Build Output Structure

### Development Build
```
out/
├── extension.js
├── extension.js.map
├── managers/
├── ui/
├── adapters/
└── ...
```

### Production Build (Webpack)
```
out/
├── extension.js        # Bundled extension code
├── extension.js.map    # Source maps
└── webview/
    ├── main.js        # Bundled webview code
    ├── main.css       # Compiled styles
    └── assets/        # Static assets
```

## Next Steps

With this modular file structure in place:

1. **Implement Core Managers**: Start with TDD implementation of each manager
2. **Build UI Components**: Create the webview interface with React
3. **Integrate Claude-Flow**: Connect the orchestrator and test agent coordination
4. **Add Tools**: Implement file system, terminal, and git tools
5. **Write Integration Tests**: Ensure all modules work together
6. **Package and Deploy**: Build and publish to VS Code Marketplace

This structure provides a solid foundation for building a maintainable, testable, and scalable VS Code extension that integrates the full power of Claude-Flow orchestration.