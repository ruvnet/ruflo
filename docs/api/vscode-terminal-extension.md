# VSCode Terminal Extension Integration

This document describes how to integrate Claude-Flow's terminal system with a VSCode extension.

## Overview

Claude-Flow provides a powerful terminal management system that can integrate seamlessly with VSCode's terminal API when running as an extension. The integration provides:

- Automatic terminal creation and management
- Command execution with output capture
- Terminal pooling for efficient resource usage
- Cross-platform shell support
- Output streaming for real-time monitoring

## Extension Setup

### 1. Initialize the Terminal Bridge

In your VSCode extension's activation function:

```typescript
import * as vscode from 'vscode';
import { initializeTerminalBridge } from './claude-flow/terminal/vscode-bridge';

export function activate(context: vscode.ExtensionContext) {
  // Initialize the terminal bridge
  initializeTerminalBridge(context);
  
  // Your extension code here
}
```

### 2. Configure Claude-Flow for VSCode

When initializing Claude-Flow, configure it to use VSCode terminals:

```typescript
import { ClaudeFlow } from './claude-flow';

const config = {
  terminal: {
    type: 'vscode', // Use VSCode terminals
    poolSize: 5,
    recycleAfter: 10,
    healthCheckInterval: 30000,
    commandTimeout: 60000,
  },
  // Other configuration...
};

const claudeFlow = new ClaudeFlow(config);
await claudeFlow.initialize();
```

## Terminal Features

### Automatic Terminal Management

Claude-Flow automatically manages VSCode terminals:

```typescript
// Spawn a terminal for an agent
const terminalId = await claudeFlow.spawnTerminal({
  id: 'agent-1',
  name: 'Research Agent',
  type: 'researcher',
  capabilities: ['search', 'analyze'],
  systemPrompt: 'You are a research assistant',
  maxConcurrentTasks: 3,
  priority: 1,
});

// Execute commands
const output = await claudeFlow.executeCommand(
  terminalId,
  'npm install @anthropic-ai/sdk'
);

// Terminal is automatically cleaned up when done
await claudeFlow.terminateTerminal(terminalId);
```

### Output Streaming

Stream terminal output in real-time:

```typescript
// Set up output streaming
const unsubscribe = await claudeFlow.streamOutput(terminalId, (output) => {
  // Display output in VSCode output channel
  outputChannel.append(output);
  
  // Or update a webview
  webview.postMessage({ type: 'terminal-output', data: output });
});

// Stop streaming when done
unsubscribe();
```

### Terminal Pool Management

The terminal pool ensures efficient resource usage:

```typescript
// Check terminal pool health
const health = await claudeFlow.getTerminalHealth();
console.log(`Active terminals: ${health.metrics.activeSessions}`);
console.log(`Available terminals: ${health.metrics.availableTerminals}`);

// Perform maintenance to clean up stale terminals
await claudeFlow.performTerminalMaintenance();
```

## Shell Support

Claude-Flow automatically detects and uses the appropriate shell:

- **Windows**: PowerShell or CMD
- **macOS/Linux**: Bash, Zsh, or sh
- **Cross-platform**: Consistent command interface

```typescript
// Commands are automatically adapted for the platform
const result = await claudeFlow.executeCommand(
  terminalId,
  'echo $HOME' // Works on all platforms
);
```

## Advanced Features

### Custom Terminal Configuration

Configure terminals with specific settings:

```typescript
const profile = {
  id: 'custom-agent',
  name: 'Custom Agent',
  type: 'custom',
  capabilities: ['execute'],
  systemPrompt: 'Custom prompt',
  maxConcurrentTasks: 1,
  priority: 1,
  metadata: {
    workingDirectory: '/path/to/project',
    initCommands: [
      'source ~/.bashrc',
      'conda activate myenv',
    ],
    cleanupCommands: [
      'conda deactivate',
    ],
  },
};

const terminalId = await claudeFlow.spawnTerminal(profile);
```

### Terminal Events

Subscribe to terminal events:

```typescript
// Listen for terminal events
claudeFlow.on('terminal:created', ({ terminalId, pid }) => {
  console.log(`Terminal created: ${terminalId} (PID: ${pid})`);
});

claudeFlow.on('terminal:closed', ({ terminalId, code }) => {
  console.log(`Terminal closed: ${terminalId} (Code: ${code})`);
});

claudeFlow.on('terminal:error', ({ terminalId, error }) => {
  console.error(`Terminal error: ${terminalId}`, error);
});
```

### Error Handling

Robust error handling for terminal operations:

```typescript
try {
  const output = await claudeFlow.executeCommand(
    terminalId,
    'some-command'
  );
} catch (error) {
  if (error.code === 'TERMINAL_COMMAND_ERROR') {
    // Handle command execution error
    console.error('Command failed:', error.details);
  } else if (error.code === 'TERMINAL_NOT_ALIVE') {
    // Terminal died, spawn a new one
    terminalId = await claudeFlow.spawnTerminal(profile);
  }
}
```

## Best Practices

1. **Resource Management**: Always terminate terminals when done to free resources
2. **Error Handling**: Implement proper error handling for terminal operations
3. **Output Streaming**: Use streaming for long-running commands
4. **Platform Testing**: Test on multiple platforms to ensure compatibility
5. **Pool Configuration**: Configure pool size based on expected workload

## Example Extension

Here's a complete example of a VSCode extension using Claude-Flow terminals:

```typescript
import * as vscode from 'vscode';
import { ClaudeFlow } from './claude-flow';
import { initializeTerminalBridge } from './claude-flow/terminal/vscode-bridge';

let claudeFlow: ClaudeFlow;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  // Initialize terminal bridge
  initializeTerminalBridge(context);
  
  // Create output channel
  outputChannel = vscode.window.createOutputChannel('Claude-Flow');
  
  // Initialize Claude-Flow
  claudeFlow = new ClaudeFlow({
    terminal: {
      type: 'vscode',
      poolSize: 3,
      recycleAfter: 10,
      healthCheckInterval: 30000,
      commandTimeout: 60000,
    },
  });
  
  await claudeFlow.initialize();
  
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-flow.runTask', async () => {
      const task = await vscode.window.showInputBox({
        prompt: 'Enter task description',
      });
      
      if (task) {
        await runTask(task);
      }
    })
  );
}

async function runTask(task: string) {
  const terminalId = await claudeFlow.spawnTerminal({
    id: `task-${Date.now()}`,
    name: 'Task Runner',
    type: 'custom',
    capabilities: ['execute'],
    systemPrompt: 'You are a task runner',
    maxConcurrentTasks: 1,
    priority: 1,
  });
  
  try {
    // Stream output
    const unsubscribe = await claudeFlow.streamOutput(
      terminalId,
      (output) => outputChannel.append(output)
    );
    
    // Execute task
    outputChannel.appendLine(`Running task: ${task}`);
    const result = await claudeFlow.executeCommand(
      terminalId,
      task
    );
    
    outputChannel.appendLine(`Task completed: ${result}`);
    
    // Clean up
    unsubscribe();
  } finally {
    await claudeFlow.terminateTerminal(terminalId);
  }
}

export async function deactivate() {
  if (claudeFlow) {
    await claudeFlow.shutdown();
  }
}
```

## Troubleshooting

### Terminal Not Capturing Output

If terminal output is not being captured:

1. Ensure the terminal bridge is initialized before creating terminals
2. Check that the VSCode API is available in the global scope
3. Verify that terminal names follow the expected pattern

### Performance Issues

For performance optimization:

1. Adjust pool size based on workload
2. Configure appropriate recycle thresholds
3. Use terminal maintenance to clean up stale sessions
4. Implement command timeouts to prevent hanging

### Platform-Specific Issues

Handle platform differences:

```typescript
const platform = process.platform;
const shell = platform === 'win32' ? 'powershell' : 'bash';

// Configure platform-specific settings
const config = {
  terminal: {
    type: 'vscode',
    // Platform-specific configuration
    ...(platform === 'win32' && {
      // Windows-specific settings
    }),
  },
};
```