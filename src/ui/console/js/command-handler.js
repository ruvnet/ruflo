/**
 * Command Handler for Claude Code Console
 * Processes and executes console commands
 */

export class CommandHandler {
  constructor(terminal, wsClient) {
    this.terminal = terminal;
    this.wsClient = wsClient;
    this.isProcessing = false;

    // Built-in commands
    this.builtinCommands = {
      help: this.showHelp.bind(this),
      clear: this.clearConsole.bind(this),
      status: this.showStatus.bind(this),
      connect: this.connectToServer.bind(this),
      disconnect: this.disconnectFromServer.bind(this),
      tools: this.listTools.bind(this),
      health: this.checkHealth.bind(this),
      history: this.showHistory.bind(this),
      export: this.exportSession.bind(this),
      theme: this.changeTheme.bind(this),
      version: this.showVersion.bind(this),
    };

    // Claude Flow commands
    this.claudeFlowCommands = {
      'claude-flow': this.executeClaudeFlow.bind(this),
      swarm: this.executeSwarm.bind(this),
      init: this.initializeProject.bind(this),
      config: this.manageConfig.bind(this),
      memory: this.manageMemory.bind(this),
      agents: this.manageAgents.bind(this),
      benchmark: this.runBenchmark.bind(this),
      sparc: this.executeSparc.bind(this),
    };

    // Direct SPARC mode commands
    this.sparcModeCommands = {
      coder: this.executeSparcMode.bind(this, 'coder'),
      architect: this.executeSparcMode.bind(this, 'architect'),
      analyst: this.executeSparcMode.bind(this, 'analyst'),
      researcher: this.executeSparcMode.bind(this, 'researcher'),
      reviewer: this.executeSparcMode.bind(this, 'reviewer'),
      tester: this.executeSparcMode.bind(this, 'tester'),
      debugger: this.executeSparcMode.bind(this, 'debugger'),
      documenter: this.executeSparcMode.bind(this, 'documenter'),
      optimizer: this.executeSparcMode.bind(this, 'optimizer'),
      designer: this.executeSparcMode.bind(this, 'designer'),
    };

    this.allCommands = {
      ...this.builtinCommands,
      ...this.claudeFlowCommands,
      ...this.sparcModeCommands,
    };
  }

  /**
   * Process a command
   */
  async processCommand(command) {
    if (this.isProcessing) {
      this.terminal.writeWarning('Another command is still processing. Please wait...');
      return;
    }

    this.isProcessing = true;
    this.terminal.setLocked(true);

    try {
      const { cmd, args } = this.parseCommand(command);

      if (this.allCommands[cmd]) {
        await this.allCommands[cmd](args);
      } else {
        await this.executeRemoteCommand(cmd, args);
      }
    } catch (error) {
      this.terminal.writeError(error.message);
      console.error('Command execution error:', error);
    } finally {
      this.isProcessing = false;
      this.terminal.setLocked(false);
    }
  }

  /**
   * Parse command string into command and arguments
   */
  parseCommand(commandString) {
    const parts = commandString.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    return { cmd, args };
  }

  /**
   * Show help information
   */
  async showHelp(args) {
    if (args.length > 0) {
      const command = args[0].toLowerCase();
      if (this.allCommands[command]) {
        this.showCommandHelp(command);
      } else {
        this.terminal.writeError(`Unknown command: ${command}`);
      }
      return;
    }

    this.terminal.writeInfo('Claude Flow Console Commands:');
    this.terminal.writeLine('');

    this.terminal.writeInfo('Built-in Commands:');
    Object.keys(this.builtinCommands).forEach((cmd) => {
      this.terminal.writeLine(`  ${cmd.padEnd(12)} - ${this.getCommandDescription(cmd)}`);
    });

    this.terminal.writeLine('');
    this.terminal.writeInfo('Claude Flow Commands:');
    Object.keys(this.claudeFlowCommands).forEach((cmd) => {
      this.terminal.writeLine(`  ${cmd.padEnd(12)} - ${this.getCommandDescription(cmd)}`);
    });

    this.terminal.writeLine('');
    this.terminal.writeInfo('Tool Commands (from tools list):');
    this.terminal.writeLine('  system/health        - Get system health status');
    this.terminal.writeLine(
      '  memory/manage        - Manage memory (list, store <key> <value>, retrieve <key>)',
    );
    this.terminal.writeLine(
      '  agents/manage        - Manage agents (list, create <type>, status <id>)',
    );
    this.terminal.writeLine(
      '  swarm/orchestrate    - Swarm operations (status, create, start, stop)',
    );
    this.terminal.writeLine(
      '  sparc/execute        - Execute SPARC modes (coder, architect, etc.)',
    );
    this.terminal.writeLine(
      '  benchmark/run        - Run benchmarks (default, memory, cpu, network)',
    );
    this.terminal.writeLine('  claude-flow/execute  - Execute Claude Flow commands');

    this.terminal.writeLine('');
    this.terminal.writeInfo(
      'Use "help <command>" for detailed information about a specific command.',
    );
    this.terminal.writeInfo(
      'Use Ctrl+L to clear console, Ctrl+C to interrupt, Tab for autocomplete.',
    );
  }

  /**
   * Get command description
   */
  getCommandDescription(command) {
    const descriptions = {
      help: 'Show help information',
      clear: 'Clear console output',
      status: 'Show connection and system status',
      connect: 'Connect to Claude Code server',
      disconnect: 'Disconnect from server',
      tools: 'List available tools',
      health: 'Check server health',
      history: 'Show command history',
      export: 'Export session data',
      theme: 'Change console theme',
      version: 'Show version information',
      'claude-flow': 'Execute Claude Flow commands',
      swarm: 'Manage and execute swarms',
      init: 'Initialize new project',
      config: 'Manage configuration',
      memory: 'Manage memory and data',
      agents: 'Manage agents',
      benchmark: 'Run benchmarks',
      sparc: 'Execute SPARC mode commands',
    };

    return descriptions[command] || 'No description available';
  }

  /**
   * Show detailed command help
   */
  showCommandHelp(command) {
    const helpText = {
      help: `
Usage: help [command]
Show help information for all commands or a specific command.

Examples:
  help              - Show all commands
  help claude-flow  - Show help for claude-flow command`,

      clear: `
Usage: clear
Clear the console output. You can also use Ctrl+L.`,

      connect: `
Usage: connect [url] [token]
Connect to Claude Code server.

Arguments:
  url     - WebSocket URL (default: ws://localhost:3000/ws)
  token   - Authentication token (optional)

Examples:
  connect
  connect ws://localhost:3000/ws
  connect ws://localhost:3000/ws my-auth-token`,

      'claude-flow': `
Usage: claude-flow <subcommand> [options]
Execute Claude Flow commands.

Subcommands:
  start [mode]     - Start Claude Flow in specified mode
  stop             - Stop Claude Flow
  status           - Show Claude Flow status
  modes            - List available SPARC modes
  
Examples:
  claude-flow start coder
  claude-flow status
  claude-flow modes`,

      swarm: `
Usage: swarm <action> [options]
Manage and execute swarms.

Actions:
  create <name>    - Create new swarm
  start <name>     - Start existing swarm
  stop <name>      - Stop running swarm
  list             - List all swarms
  status <name>    - Show swarm status
  
Examples:
  swarm create my-swarm
  swarm start my-swarm
  swarm list`,
    };

    if (helpText[command]) {
      this.terminal.writeInfo(helpText[command].trim());
    } else {
      this.terminal.writeInfo(`No detailed help available for: ${command}`);
    }
  }

  /**
   * Clear console
   */
  async clearConsole() {
    this.terminal.clear();
    this.terminal.writeSuccess('Console cleared');
  }

  /**
   * Show status
   */
  async showStatus() {
    const wsStatus = this.wsClient.getStatus();
    const terminalStats = this.terminal.getStats();

    this.terminal.writeInfo('System Status:');
    this.terminal.writeLine('');

    this.terminal.writeInfo('Connection:');
    this.terminal.writeLine(`  Status: ${wsStatus.connected ? 'Connected' : 'Disconnected'}`);
    this.terminal.writeLine(`  URL: ${wsStatus.url || 'Not set'}`);
    this.terminal.writeLine(`  Reconnect attempts: ${wsStatus.reconnectAttempts}`);
    this.terminal.writeLine(`  Queued messages: ${wsStatus.queuedMessages}`);
    this.terminal.writeLine(`  Pending requests: ${wsStatus.pendingRequests}`);

    this.terminal.writeLine('');
    this.terminal.writeInfo('Terminal:');
    this.terminal.writeLine(`  Total lines: ${terminalStats.totalLines}`);
    this.terminal.writeLine(`  History size: ${terminalStats.historySize}`);
    this.terminal.writeLine(`  Input locked: ${terminalStats.isLocked}`);
    this.terminal.writeLine(`  Current prompt: ${terminalStats.currentPrompt}`);

    if (wsStatus.connected) {
      try {
        const healthStatus = await this.wsClient.getHealthStatus();
        this.terminal.writeLine('');
        this.terminal.writeInfo('Server Health:');
        this.terminal.writeLine(`  Status: ${healthStatus.healthy ? 'Healthy' : 'Unhealthy'}`);

        if (healthStatus.metrics) {
          Object.entries(healthStatus.metrics).forEach(([key, value]) => {
            this.terminal.writeLine(`  ${key}: ${value}`);
          });
        }
      } catch (error) {
        this.terminal.writeWarning('Failed to get server health status');
      }
    }
  }

  /**
   * Connect to server
   */
  async connectToServer(args) {
    const url = args[0] || 'ws://localhost:3000/ws';
    const token = args[1] || '';

    this.terminal.writeInfo(`Connecting to ${url}...`);

    try {
      await this.wsClient.connect(url, token);

      // Initialize session
      await this.wsClient.initializeSession();

      this.terminal.writeSuccess('Connected successfully');
      this.terminal.setPrompt('claude-flow>');
    } catch (error) {
      this.terminal.writeError(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Disconnect from server
   */
  async disconnectFromServer() {
    this.wsClient.disconnect();
    this.terminal.writeSuccess('Disconnected from server');
    this.terminal.setPrompt('offline>');
  }

  /**
   * List available tools
   */
  async listTools() {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const tools = await this.wsClient.getAvailableTools();

      this.terminal.writeInfo('Available Tools:');
      this.terminal.writeLine('');

      if (tools && tools.length > 0) {
        tools.forEach((tool) => {
          this.terminal.writeLine(
            `  ${tool.name.padEnd(20)} - ${tool.description || 'No description'}`,
          );
        });
      } else {
        this.terminal.writeWarning('No tools available');
      }
    } catch (error) {
      this.terminal.writeError(`Failed to list tools: ${error.message}`);
    }
  }

  /**
   * Check server health
   */
  async checkHealth() {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const health = await this.wsClient.getHealthStatus();

      if (health.healthy) {
        this.terminal.writeSuccess('Server is healthy');
      } else {
        this.terminal.writeError(`Server is unhealthy: ${health.error || 'Unknown error'}`);
      }

      if (health.metrics) {
        this.terminal.writeLine('');
        this.terminal.writeInfo('Metrics:');
        Object.entries(health.metrics).forEach(([key, value]) => {
          this.terminal.writeLine(`  ${key}: ${value}`);
        });
      }
    } catch (error) {
      this.terminal.writeError(`Health check failed: ${error.message}`);
    }
  }

  /**
   * Show command history
   */
  async showHistory() {
    const history = this.terminal.history;

    if (history.length === 0) {
      this.terminal.writeInfo('No command history');
      return;
    }

    this.terminal.writeInfo('Command History:');
    history.forEach((cmd, index) => {
      this.terminal.writeLine(`  ${(index + 1).toString().padStart(3)}: ${cmd}`);
    });
  }

  /**
   * Export session data
   */
  async exportSession(args) {
    const format = args[0] || 'json';

    const sessionData = {
      timestamp: new Date().toISOString(),
      terminal: this.terminal.exportHistory(),
      history: this.terminal.history,
      status: this.wsClient.getStatus(),
    };

    if (format === 'json') {
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
      this.downloadFile(blob, `console-session-${Date.now()}.json`);
      this.terminal.writeSuccess('Session exported as JSON');
    } else {
      this.terminal.writeError(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Change theme
   */
  async changeTheme(args) {
    const theme = args[0];
    const validThemes = ['dark', 'light', 'classic', 'matrix'];

    if (!theme) {
      this.terminal.writeInfo(`Available themes: ${validThemes.join(', ')}`);
      return;
    }

    if (!validThemes.includes(theme)) {
      this.terminal.writeError(`Invalid theme: ${theme}`);
      return;
    }

    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('console_theme', theme);
    this.terminal.writeSuccess(`Theme changed to: ${theme}`);
  }

  /**
   * Show version information
   */
  async showVersion() {
    this.terminal.writeInfo('🌊 Claude Flow v2.0.0');
    this.terminal.writeLine('Advanced swarm orchestration platform');
    this.terminal.writeLine('Built with modern web technologies');
  }

  /**
   * Execute Claude Flow command
   */
  async executeClaudeFlow(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    if (args.length === 0) {
      this.terminal.writeError('Usage: claude-flow <subcommand> [options]');
      return;
    }

    const subcommand = args[0];
    const subArgs = args.slice(1);

    try {
      const result = await this.wsClient.executeCommand('claude-flow', {
        subcommand,
        args: subArgs,
      });

      this.terminal.writeSuccess(`Claude Flow ${subcommand} executed successfully`);
      if (result && result.output) {
        this.terminal.writeLine(result.output);
      }
    } catch (error) {
      this.terminal.writeError(`Claude Flow command failed: ${error.message}`);
    }
  }

  /**
   * Execute swarm command
   */
  async executeSwarm(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const action = args[0] || 'status';
      this.terminal.writeInfo(`Executing swarm ${action}...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'swarm/status',
        arguments: { action, args: args.slice(1) },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess('Swarm command executed successfully');
      }
    } catch (error) {
      this.terminal.writeError(`Swarm command failed: ${error.message}`);
    }
  }

  /**
   * Initialize project
   */
  async initializeProject(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    this.terminal.writeWarning('Project initialization not yet implemented in web console');
  }

  /**
   * Manage configuration
   */
  async manageConfig(args) {
    this.terminal.writeInfo('Use the Settings panel (⚙️ button) to manage configuration');
  }

  /**
   * Manage memory
   */
  async manageMemory(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const operation = args[0] || 'list';
      const key = args[1];
      const value = args.slice(2).join(' ');

      this.terminal.writeInfo(`Executing memory ${operation}...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'memory/manage',
        arguments: { operation, key, value },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess('Memory operation completed successfully');
      }
    } catch (error) {
      this.terminal.writeError(`Memory command failed: ${error.message}`);
    }
  }

  /**
   * Manage agents
   */
  async manageAgents(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const action = args[0] || 'list';
      const agentType = args[1];
      const agentId = args[1];

      this.terminal.writeInfo(`Executing agents ${action}...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'agents/manage',
        arguments: { action, agentType, agentId },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess('Agent operation completed successfully');
      }
    } catch (error) {
      this.terminal.writeError(`Agent command failed: ${error.message}`);
    }
  }

  /**
   * Run benchmark
   */
  async runBenchmark(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const suite = args[0] || 'default';
      const iterations = parseInt(args[1]) || 10;

      this.terminal.writeInfo(`Running benchmark suite: ${suite}...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'benchmark/run',
        arguments: { suite, iterations },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess('Benchmark completed successfully');
      }
    } catch (error) {
      this.terminal.writeError(`Benchmark failed: ${error.message}`);
    }
  }

  /**
   * Execute SPARC mode
   */
  async executeSparc(args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    if (args.length === 0) {
      this.terminal.writeInfo('Available SPARC modes:');
      const modes = [
        'coder',
        'architect',
        'analyst',
        'researcher',
        'reviewer',
        'tester',
        'debugger',
        'documenter',
        'optimizer',
        'designer',
      ];
      modes.forEach((mode) => {
        this.terminal.writeLine(`  ${mode}`);
      });
      return;
    }

    try {
      const mode = args[0];
      const task = args.slice(1).join(' ') || 'General task execution';
      const options = {};

      this.terminal.writeInfo(`Executing SPARC mode: ${mode}...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'sparc/execute',
        arguments: { mode, task, options },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess(`SPARC ${mode} mode executed successfully`);
      }
    } catch (error) {
      this.terminal.writeError(`SPARC execution failed: ${error.message}`);
    }
  }

  /**
   * Execute specific SPARC mode
   */
  async executeSparcMode(mode, args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server');
      return;
    }

    try {
      const task = args.join(' ') || `Execute ${mode} mode tasks`;
      const options = {};

      this.terminal.writeInfo(`Executing SPARC ${mode} mode...`);

      const result = await this.wsClient.sendRequest('tools/call', {
        name: 'sparc/execute',
        arguments: { mode, task, options },
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess(`SPARC ${mode} mode executed successfully`);
      }
    } catch (error) {
      this.terminal.writeError(`SPARC ${mode} execution failed: ${error.message}`);
    }
  }

  /**
   * Execute remote command via WebSocket
   */
  async executeRemoteCommand(command, args) {
    if (!this.wsClient.isConnected) {
      this.terminal.writeError('Not connected to server. Use "connect" command first.');
      return;
    }

    try {
      // Check if this is a tool name (contains slash)
      if (command.includes('/')) {
        return await this.executeToolDirect(command, args);
      }

      this.terminal.writeInfo(`Executing remote command: ${command}`);

      const result = await this.wsClient.executeCommand(command, { args });

      if (result && result.output) {
        this.terminal.writeLine(result.output);
      } else {
        this.terminal.writeSuccess('Command executed successfully');
      }
    } catch (error) {
      this.terminal.writeError(`Remote command failed: ${error.message}`);
    }
  }

  /**
   * Execute tool directly by name
   */
  async executeToolDirect(toolName, args) {
    try {
      this.terminal.writeInfo(`Executing tool: ${toolName}...`);

      // Prepare arguments based on tool
      let toolArgs = {};

      switch (toolName) {
        case 'system/health':
          toolArgs = { detailed: args.includes('--detailed') };
          break;

        case 'memory/manage':
          toolArgs = {
            operation: args[0] || 'list',
            key: args[1],
            value: args.slice(2).join(' '),
          };
          break;

        case 'agents/manage':
          toolArgs = {
            action: args[0] || 'list',
            agentType: args[1],
            agentId: args[1],
          };
          break;

        case 'swarm/orchestrate':
          toolArgs = {
            action: args[0] || 'status',
            args: args.slice(1),
          };
          break;

        case 'sparc/execute':
          toolArgs = {
            mode: args[0] || 'coder',
            task: args.slice(1).join(' ') || 'General task execution',
            options: {},
          };
          break;

        case 'benchmark/run':
          toolArgs = {
            suite: args[0] || 'default',
            iterations: parseInt(args[1]) || 10,
          };
          break;

        case 'claude-flow/execute':
          toolArgs = {
            command: args[0] || 'status',
            args: args.slice(1),
          };
          break;

        default:
          toolArgs = { args };
      }

      const result = await this.wsClient.sendRequest('tools/call', {
        name: toolName,
        arguments: toolArgs,
      });

      if (result && result.content && result.content[0]) {
        this.terminal.writeSuccess(result.content[0].text);
      } else {
        this.terminal.writeSuccess(`Tool ${toolName} executed successfully`);
      }
    } catch (error) {
      this.terminal.writeError(`Tool execution failed: ${error.message}`);
    }
  }

  /**
   * Download file helper
   */
  downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Get command suggestions
   */
  getCommandSuggestions(input) {
    const allCommands = Object.keys(this.allCommands);
    return allCommands.filter((cmd) => cmd.startsWith(input.toLowerCase()));
  }

  /**
   * Check if command exists
   */
  hasCommand(command) {
    return this.allCommands.hasOwnProperty(command.toLowerCase());
  }
}
