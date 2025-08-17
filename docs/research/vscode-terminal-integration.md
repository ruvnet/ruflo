# VSCode Terminal Integration Research

## Overview
This document provides comprehensive research on VSCode terminal integration patterns, focusing on methods to spawn and control multiple terminal sessions programmatically, particularly for CLI tools that integrate with VSCode.

## 1. VSCode Extension API for Terminal Management

### Core Terminal API Features

The VSCode Extension API provides several key properties and methods for terminal management:

```typescript
// Access all terminals
const terminals = vscode.window.terminals;

// Create a new terminal
const terminal = vscode.window.createTerminal('My Terminal');

// Terminal creation with options
const terminal = vscode.window.createTerminal({
    name: 'Terminal Name',
    cwd: vscode.workspace.rootPath,
    env: { MY_VAR: 'value' },
    shellPath: '/bin/bash',
    shellArgs: ['-l']
});

// Send commands to terminal
terminal.sendText('npm install');
terminal.show(); // Reveal terminal in UI
```

### Terminal Events
- `window.onDidOpenTerminal` - Fires when a terminal is opened
- `window.onDidCloseTerminal` - Fires when a terminal is closed
- `window.onDidChangeActiveTerminal` - Fires when the active terminal changes

### 2024 Updates
- **Terminal Inline Chat**: Now default experience (Ctrl+I/Cmd+I)
- **Middle-Click Paste Support**: Quick paste functionality
- **Accessible View**: Navigation through terminal commands

## 2. Methods to Spawn and Control Multiple Terminal Sessions

### Programmatic Multiple Terminal Management

```typescript
export function activate(context: vscode.ExtensionContext) {
    let terminals: Map<string, vscode.Terminal> = new Map();
    
    // Create multiple terminals
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.createTerminals', () => {
            // Create build terminal
            const buildTerminal = vscode.window.createTerminal({
                name: 'Build',
                cwd: vscode.workspace.rootPath
            });
            terminals.set('build', buildTerminal);
            buildTerminal.show();
            buildTerminal.sendText('npm run build');
            
            // Create test terminal
            const testTerminal = vscode.window.createTerminal({
                name: 'Test',
                cwd: vscode.workspace.rootPath
            });
            terminals.set('test', testTerminal);
            testTerminal.sendText('npm test');
            
            // Create server terminal
            const serverTerminal = vscode.window.createTerminal({
                name: 'Server',
                cwd: vscode.workspace.rootPath
            });
            terminals.set('server', serverTerminal);
            serverTerminal.sendText('npm start');
        })
    );
    
    // Send text to specific terminal
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.sendToTerminal', (terminalName: string, command: string) => {
            const terminal = terminals.get(terminalName);
            if (terminal) {
                terminal.show();
                terminal.sendText(command);
            }
        })
    );
}
```

## 3. Terminal Communication and Synchronization Patterns

### Event-Based Synchronization

```typescript
// Listen for terminal lifecycle events
vscode.window.onDidCloseTerminal(terminal => {
    console.log(`Terminal ${terminal.name} closed`);
    // Clean up resources
});

vscode.window.onDidChangeActiveTerminal(terminal => {
    if (terminal) {
        console.log(`Active terminal changed to: ${terminal.name}`);
    }
});
```

### Terminal State Management
- Track terminal instances in Maps or Arrays
- Implement cleanup on terminal closure
- Maintain terminal metadata (purpose, status, etc.)

## 4. VSCode Remote Development and SSH Integration

### Remote SSH Features
- **Remote-SSH Extension**: Connects to any location via SSH
- **Port Forwarding**: Access remote ports locally
- **Environment Variables**: Proper setup before remote backend starts

### Remote Terminal Control
```bash
# Set up environment for remote development
export EDITOR="code --wait"
export VSCODE_IPC_HOOK_CLI=$(ls -tr /run/user/$UID/vscode-ipc-* | tail -n 1)
```

### Architecture
- VS Code Server installed on remote host
- SSH tunnel for secure communication
- Extensions run directly on remote workspace

## 5. Terminal Multiplexing Approaches (tmux-like functionality)

### Integrating tmux with VSCode

Configure VSCode to use tmux automatically:

```json
// settings.json
"terminal.integrated.profiles.osx": {
  "tmux-shell": {
    "path": "tmux",
    "args": ["new-session", "-A", "-s", "vscode:${workspaceFolder}"]
  }
},
"terminal.integrated.defaultProfile.osx": "tmux-shell"
```

Alternative configuration:
```json
"terminal.integrated.profiles.linux": {
  "bash-tmux": {
    "path": "bash",
    "args": ["-c", "tmux new -ADs ${PWD##*/}"]
  }
}
```

### Benefits of tmux Integration
- **Persistent Sessions**: Survive VSCode restarts
- **Session Recovery**: Reconnect after SSH drops
- **Multiple Panes**: Split terminals within single session
- **Workspace-based Sessions**: Automatic session per project

## 6. VSCode's Integrated Terminal API Capabilities

### Terminal Options Interface
```typescript
interface TerminalOptions {
    name?: string;           // Terminal name
    shellPath?: string;      // Path to shell executable
    shellArgs?: string[];    // Shell arguments
    cwd?: string;           // Working directory
    env?: { [key: string]: string }; // Environment variables
    hideFromUser?: boolean;  // Hide terminal from UI
    location?: TerminalLocation; // Where to show terminal
}
```

### Advanced Features
- **Extension-controlled terminals**: Full programmatic control
- **Terminal renderers**: Custom terminal UI
- **Terminal links**: Clickable links in terminal output
- **Terminal profiles**: Predefined terminal configurations

## 7. Best Practices for CLI Tools that Integrate with VSCode

### 1. **Terminal Reuse Pattern**
```typescript
let myTerminal: vscode.Terminal | undefined;

function getOrCreateTerminal(): vscode.Terminal {
    if (!myTerminal || myTerminal.exitStatus !== undefined) {
        myTerminal = vscode.window.createTerminal('My CLI Tool');
    }
    return myTerminal;
}
```

### 2. **Command Queuing**
- Queue commands when terminal is busy
- Implement command history
- Handle terminal failures gracefully

### 3. **Environment Setup**
- Detect and use appropriate shell
- Set up PATH and environment variables
- Handle different OS platforms

### 4. **User Experience**
- Clear terminal naming conventions
- Show/hide terminals appropriately
- Provide visual feedback for long-running commands

## 8. Existing VSCode Extensions for Terminal Management

### Notable Extensions
1. **Tasks** - Load VSCode tasks into status bar
2. **Code Runner** - Run code snippets in terminal
3. **Multi Command** - Execute multiple commands as one
4. **Project Manager** - Manage multiple projects and their terminals

### Deno Support
- **Deno Extension**: Full TypeScript/Deno language support
- Integrates with Deno CLI via Language Server Protocol
- Supports debugging with V8 Inspector Protocol

## 9. Orchestration Patterns from External CLIs

### Claude Code Flow Patterns

#### 1. **Fanning Out Pattern**
Handle large-scale operations by:
- Generate task list programmatically
- Loop through tasks calling Claude for each
- Provide specific tools and context per task

#### 2. **Git Worktrees for Parallel Workflows**
```bash
# Create new branch and worktree
pgw new-feature
# Opens VS Code with Claude Code ready
# Work in parallel on multiple features
```

#### 3. **Automatic Terminal Launch**
Using `.vscode/tasks.json`:
```json
{
  "version": "2.0.0",
  "tasks": [{
    "label": "Run Claude Code Automatically",
    "type": "shell",
    "command": "/path/to/claude --dangerously-skip-permissions",
    "presentation": {
      "reveal": "always",
      "panel": "new",
      "focus": true
    },
    "runOptions": {
      "runOn": "folderOpen"
    }
  }]
}
```

### Headless/Programmatic Mode
```bash
# Run Claude Code programmatically
claude -p "migrate foo.py from React to Vue" --allowedTools Edit Bash
```

### MCP (Model Context Protocol) Integration
- Connect multiple tools and services
- Example: Playwright MCP server for browser testing
- Claude Code as MCP server for nested agent workflows

## Implementation Recommendations for TypeScript/Deno Runtime

### 1. **Core Architecture**
```typescript
interface TerminalManager {
    terminals: Map<string, Terminal>;
    createTerminal(config: TerminalConfig): Terminal;
    sendCommand(terminalId: string, command: string): Promise<void>;
    orchestrate(workflow: WorkflowDefinition): Promise<void>;
}

interface Terminal {
    id: string;
    name: string;
    status: 'idle' | 'busy' | 'closed';
    send(text: string): Promise<void>;
    close(): Promise<void>;
}
```

### 2. **VSCode Integration Strategy**
- Use VSCode tasks for automatic terminal spawn
- Implement extension for deeper integration
- Support both CLI and extension modes

### 3. **Communication Patterns**
- WebSocket for real-time terminal updates
- Message queue for command orchestration
- Event-driven architecture for terminal state

### 4. **Persistence and Recovery**
- Integrate tmux for session persistence
- Save terminal state and command history
- Implement reconnection logic

### 5. **Multi-Agent Coordination**
- Central coordinator process
- Agent-specific terminal instances
- Shared context and state management

## Conclusion

The most effective approach for VSCode terminal integration combines:
1. Native VSCode Extension API for terminal management
2. tmux integration for persistence and multiplexing
3. Event-driven architecture for coordination
4. Support for both programmatic and interactive modes
5. Integration with existing tools via MCP or similar protocols

For a TypeScript/Deno implementation, focus on:
- Building a robust terminal manager class
- Implementing VSCode extension for deep integration
- Supporting headless/CLI mode for automation
- Using tmux for advanced terminal features
- Creating clear APIs for multi-agent orchestration