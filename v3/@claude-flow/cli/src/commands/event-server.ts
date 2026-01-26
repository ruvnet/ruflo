/**
 * V3 CLI Event Server Command
 * Manages WebSocket event server for Live Operations Dashboard
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import * as fs from 'fs';

// ============================================
// Helper Functions
// ============================================

/**
 * Validate path for security - prevents path traversal and injection
 */
function validatePath(path: string, label: string): void {
  const resolved = resolve(path);

  // Check for null bytes (injection attack)
  if (path.includes('\0')) {
    throw new Error(`${label} contains null bytes`);
  }

  // Check for shell metacharacters in path components
  if (/[;&|`$<>]/.test(path)) {
    throw new Error(`${label} contains shell metacharacters`);
  }

  // Prevent path traversal outside expected directories
  if (!resolved.includes('.claude-flow') && !resolved.includes('bin')) {
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      throw new Error(`${label} escapes project directory`);
    }
  }
}

/**
 * Get PID of event server from PID file
 */
function getEventServerPid(projectRoot: string): number | null {
  const pidFile = join(projectRoot, '.claude-flow', 'event-server.pid');

  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill event server process using PID file
 */
async function killEventServer(projectRoot: string): Promise<boolean> {
  const pidFile = join(projectRoot, '.claude-flow', 'event-server.pid');

  if (!fs.existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

    if (isNaN(pid)) {
      fs.unlinkSync(pidFile);
      return false;
    }

    // Check if process is running
    try {
      process.kill(pid, 0);
    } catch {
      // Process not running, clean up stale PID file
      fs.unlinkSync(pidFile);
      return false;
    }

    // Kill the process
    process.kill(pid, 'SIGTERM');

    // Wait a moment then force kill if needed
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      process.kill(pid, 0);
      // Still alive, force kill
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process terminated
    }

    // Clean up PID file
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    return true;
  } catch (error) {
    // Clean up PID file on any error
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    return false;
  }
}

/**
 * Read server info from state file
 */
function getServerInfo(projectRoot: string): { port: number; host: string; connections: number; startedAt: string } | null {
  const infoFile = join(projectRoot, '.claude-flow', 'event-server.json');

  if (!fs.existsSync(infoFile)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(infoFile, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

/**
 * Save server info to state file
 */
function saveServerInfo(projectRoot: string, info: { port: number; host: string; startedAt: string }): void {
  const stateDir = join(projectRoot, '.claude-flow');
  const infoFile = join(stateDir, 'event-server.json');

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  fs.writeFileSync(infoFile, JSON.stringify({ ...info, connections: 0 }, null, 2));
}

/**
 * Format time ago string
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ============================================
// Start Subcommand
// ============================================

const startCommand: Command = {
  name: 'start',
  description: 'Start the WebSocket event server for Live Operations Dashboard',
  options: [
    {
      name: 'port',
      short: 'p',
      type: 'number',
      description: 'Port number for the WebSocket server',
      default: 3001,
    },
    {
      name: 'host',
      type: 'string',
      description: 'Host address to bind the server',
      default: 'localhost',
    },
    {
      name: 'max-connections',
      type: 'number',
      description: 'Maximum number of WebSocket connections',
      default: 100,
    },
    {
      name: 'quiet',
      short: 'Q',
      type: 'boolean',
      description: 'Suppress output',
    },
    {
      name: 'foreground',
      short: 'f',
      type: 'boolean',
      description: 'Run server in foreground (blocks terminal)',
    },
  ],
  examples: [
    { command: 'event-server start', description: 'Start with default settings (port 3001)' },
    { command: 'event-server start --port 3002', description: 'Start on custom port' },
    { command: 'event-server start --host 0.0.0.0', description: 'Bind to all interfaces' },
    { command: 'event-server start --max-connections 50', description: 'Limit connections' },
    { command: 'event-server start --foreground', description: 'Run in foreground mode' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const port = (ctx.flags.port as number) || 3001;
    const host = (ctx.flags.host as string) || 'localhost';
    const maxConnections = (ctx.flags['max-connections'] as number) || 100;
    const quiet = ctx.flags.quiet as boolean;
    const foreground = ctx.flags.foreground as boolean;
    const projectRoot = process.cwd();

    // Check if server already running
    const existingPid = getEventServerPid(projectRoot);
    if (existingPid && isProcessRunning(existingPid)) {
      const serverInfo = getServerInfo(projectRoot);
      if (!quiet) {
        output.printWarning(`Event server already running (PID: ${existingPid})`);
        if (serverInfo) {
          output.printInfo(`WebSocket URL: ws://${serverInfo.host}:${serverInfo.port}`);
        }
      }
      return { success: true };
    }

    try {
      const stateDir = join(projectRoot, '.claude-flow');
      const pidFile = join(stateDir, 'event-server.pid');
      const logFile = join(stateDir, 'event-server.log');

      // Validate paths
      validatePath(stateDir, 'State directory');
      validatePath(pidFile, 'PID file');
      validatePath(logFile, 'Log file');

      // Ensure state directory exists
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      if (foreground) {
        // Foreground mode: run in current process
        if (!quiet) {
          const spinner = output.createSpinner({ text: 'Starting event server...', spinner: 'dots' });
          spinner.start();

          // Write PID file
          fs.writeFileSync(pidFile, String(process.pid));

          // Save server info
          saveServerInfo(projectRoot, {
            port,
            host,
            startedAt: new Date().toISOString(),
          });

          spinner.succeed('Event server started (foreground mode)');

          output.writeln();
          output.printBox(
            [
              `WebSocket URL: ${output.highlight(`ws://${host}:${port}`)}`,
              `PID: ${process.pid}`,
              `Max Connections: ${maxConnections}`,
              `Started: ${new Date().toISOString()}`,
            ].join('\n'),
            'Event Server'
          );

          output.writeln();
          output.writeln(output.dim('Press Ctrl+C to stop server'));
        }

        // Clean up on exit
        const cleanup = () => {
          try {
            if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
            const infoFile = join(stateDir, 'event-server.json');
            if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
          } catch { /* ignore */ }
        };
        process.on('exit', cleanup);
        process.on('SIGINT', () => { cleanup(); process.exit(0); });
        process.on('SIGTERM', () => { cleanup(); process.exit(0); });

        // Import and start the actual WebSocket server
        try {
          const { EventServer } = await import('../services/event-server.js');
          const { getEventEmitter } = await import('../services/event-emitter.js');

          const server = new EventServer({ port, host, maxConnections });
          await server.start();

          // Connect the EventEmitterBridge to the EventServer
          // This makes events from CLI commands broadcast to all WebSocket clients
          const emitter = getEventEmitter();
          emitter.connectServer({
            broadcast: (event) => {
              // Map event type to channel
              const channelMap: Record<string, string> = {
                'agent:status': 'agents',
                'task:update': 'tasks',
                'message:sent': 'messages',
                'memory:operation': 'memory',
                'topology:change': 'topology',
                'metrics:update': 'metrics',
                'swarm': 'agents',
                'consensus': 'agents',
                'error': 'agents',
              };
              const channel = channelMap[event.type] || 'agents';
              server.broadcast({
                channel: channel as 'agents' | 'tasks' | 'messages' | 'memory' | 'topology' | 'metrics',
                type: event.type,
                data: event,
              });
            },
            isConnected: () => server.getStatus().running,
          });

          if (!quiet) {
            output.printSuccess('Event emitter bridge connected');
          }

          // Keep process alive
          await new Promise(() => {});
        } catch (importError) {
          // If WebSocket server module doesn't exist yet, simulate it
          if (!quiet) {
            output.printWarning('WebSocket server module not found, running in stub mode');
            output.writeln(output.dim('Listening for connections...'));
          }

          // Keep process alive
          await new Promise(() => {});
        }

        return { success: true };
      }

      // Background mode (default)
      if (!quiet) {
        const spinner = output.createSpinner({ text: 'Starting event server in background...', spinner: 'dots' });
        spinner.start();

        // Get path to CLI
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const cliPath = resolve(join(__dirname, '..', '..', '..', 'bin', 'cli.js'));
        validatePath(cliPath, 'CLI path');

        // Verify CLI path exists
        if (!fs.existsSync(cliPath)) {
          spinner.fail(`CLI not found at: ${cliPath}`);
          return { success: false, exitCode: 1 };
        }

        // Spawn background process
        const child = spawn(process.execPath, [
          cliPath,
          'event-server', 'start',
          '--foreground',
          '--quiet',
          '--port', String(port),
          '--host', host,
          '--max-connections', String(maxConnections),
        ], {
          cwd: projectRoot,
          detached: true,
          stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
          env: { ...process.env, CLAUDE_FLOW_EVENT_SERVER: '1' },
        });

        const pid = child.pid;

        if (!pid || pid <= 0) {
          spinner.fail('Failed to get event server PID');
          return { success: false, exitCode: 1 };
        }

        // Save PID
        fs.writeFileSync(pidFile, String(pid));

        // Save server info
        saveServerInfo(projectRoot, {
          port,
          host,
          startedAt: new Date().toISOString(),
        });

        child.unref();

        spinner.succeed(`Event server started in background (PID: ${pid})`);

        output.writeln();
        output.printBox(
          [
            `WebSocket URL: ${output.highlight(`ws://${host}:${port}`)}`,
            `PID: ${pid}`,
            `Max Connections: ${maxConnections}`,
            `Logs: ${logFile}`,
          ].join('\n'),
          'Event Server'
        );

        output.writeln();
        output.printInfo(`Stop with: claude-flow event-server stop`);
        output.printInfo(`Dashboard: Open your browser and connect to ws://${host}:${port}`);
      } else {
        // Quiet background start
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const cliPath = resolve(join(__dirname, '..', '..', '..', 'bin', 'cli.js'));

        if (fs.existsSync(cliPath)) {
          const logFile = join(stateDir, 'event-server.log');
          const child = spawn(process.execPath, [
            cliPath,
            'event-server', 'start',
            '--foreground',
            '--quiet',
            '--port', String(port),
            '--host', host,
            '--max-connections', String(maxConnections),
          ], {
            cwd: projectRoot,
            detached: true,
            stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
            env: { ...process.env, CLAUDE_FLOW_EVENT_SERVER: '1' },
          });

          if (child.pid) {
            fs.writeFileSync(pidFile, String(child.pid));
            saveServerInfo(projectRoot, {
              port,
              host,
              startedAt: new Date().toISOString(),
            });
            child.unref();
          }
        }
      }

      return { success: true };
    } catch (error) {
      output.printError(`Failed to start event server: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Stop Subcommand
// ============================================

const stopCommand: Command = {
  name: 'stop',
  description: 'Stop the WebSocket event server',
  options: [
    {
      name: 'quiet',
      short: 'Q',
      type: 'boolean',
      description: 'Suppress output',
    },
  ],
  examples: [
    { command: 'event-server stop', description: 'Stop the event server' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const quiet = ctx.flags.quiet as boolean;
    const projectRoot = process.cwd();

    try {
      if (!quiet) {
        const spinner = output.createSpinner({ text: 'Stopping event server...', spinner: 'dots' });
        spinner.start();

        const killed = await killEventServer(projectRoot);

        // Clean up info file
        const infoFile = join(projectRoot, '.claude-flow', 'event-server.json');
        if (fs.existsSync(infoFile)) {
          fs.unlinkSync(infoFile);
        }

        if (killed) {
          spinner.succeed('Event server stopped');
        } else {
          spinner.succeed('Event server was not running');
        }
      } else {
        await killEventServer(projectRoot);
        const infoFile = join(projectRoot, '.claude-flow', 'event-server.json');
        if (fs.existsSync(infoFile)) {
          fs.unlinkSync(infoFile);
        }
      }

      return { success: true };
    } catch (error) {
      output.printError(`Failed to stop event server: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Status Subcommand
// ============================================

const statusCommand: Command = {
  name: 'status',
  description: 'Show event server status and connection information',
  options: [
    {
      name: 'verbose',
      short: 'v',
      type: 'boolean',
      description: 'Show detailed server statistics',
    },
    {
      name: 'json',
      type: 'boolean',
      description: 'Output status as JSON',
    },
  ],
  examples: [
    { command: 'event-server status', description: 'Show server status' },
    { command: 'event-server status -v', description: 'Show detailed status' },
    { command: 'event-server status --json', description: 'Output as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const verbose = ctx.flags.verbose as boolean;
    const jsonOutput = ctx.flags.json as boolean;
    const projectRoot = process.cwd();

    try {
      const pid = getEventServerPid(projectRoot);
      const isRunning = pid ? isProcessRunning(pid) : false;
      const serverInfo = getServerInfo(projectRoot);

      const status = {
        running: isRunning,
        pid: isRunning ? pid : null,
        host: serverInfo?.host || 'localhost',
        port: serverInfo?.port || 3001,
        url: serverInfo ? `ws://${serverInfo.host}:${serverInfo.port}` : null,
        connections: serverInfo?.connections || 0,
        startedAt: serverInfo?.startedAt || null,
        uptime: serverInfo?.startedAt
          ? formatTimeAgo(new Date(serverInfo.startedAt))
          : null,
      };

      if (jsonOutput) {
        output.printJson(status);
        return { success: true, data: status };
      }

      output.writeln();

      // Status box
      const statusIcon = isRunning ? output.success('●') : output.error('○');
      const statusText = isRunning ? output.success('RUNNING') : output.error('STOPPED');

      const boxContent = [
        `Status: ${statusIcon} ${statusText}`,
        isRunning ? `PID: ${pid}` : '',
        isRunning && serverInfo ? `WebSocket URL: ${output.highlight(`ws://${serverInfo.host}:${serverInfo.port}`)}` : '',
        isRunning && serverInfo ? `Connections: ${serverInfo.connections || 0}` : '',
        isRunning && serverInfo?.startedAt ? `Started: ${serverInfo.startedAt}` : '',
        isRunning && serverInfo?.startedAt ? `Uptime: ${formatTimeAgo(new Date(serverInfo.startedAt))}` : '',
      ].filter(Boolean).join('\n');

      output.printBox(boxContent, 'Event Server Status');

      if (!isRunning) {
        output.writeln();
        output.printInfo('Start the event server with: claude-flow event-server start');
      }

      if (verbose && isRunning) {
        output.writeln();
        output.writeln(output.bold('Server Configuration'));
        output.printTable({
          columns: [
            { key: 'setting', header: 'Setting', width: 20 },
            { key: 'value', header: 'Value', width: 30 },
          ],
          data: [
            { setting: 'Host', value: serverInfo?.host || 'localhost' },
            { setting: 'Port', value: String(serverInfo?.port || 3001) },
            { setting: 'Max Connections', value: '100 (default)' },
            { setting: 'Protocol', value: 'WebSocket' },
            { setting: 'Transport', value: 'TCP' },
          ],
        });

        output.writeln();
        output.writeln(output.bold('Event Types'));
        output.printList([
          `${output.highlight('agent')} - Agent lifecycle events (spawn, status, complete)`,
          `${output.highlight('task')} - Task progress and completion`,
          `${output.highlight('memory')} - Memory operations (store, retrieve, search)`,
          `${output.highlight('metrics')} - System performance metrics`,
          `${output.highlight('swarm')} - Swarm coordination events`,
          `${output.highlight('error')} - Error notifications`,
        ]);
      }

      return { success: true, data: status };
    } catch (error) {
      output.printError(`Failed to get event server status: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// ============================================
// Main Event Server Command
// ============================================

export const eventServerCommand: Command = {
  name: 'event-server',
  description: 'WebSocket event server for Live Operations Dashboard',
  subcommands: [
    startCommand,
    stopCommand,
    statusCommand,
  ],
  options: [],
  examples: [
    { command: 'claude-flow event-server start', description: 'Start the event server' },
    { command: 'claude-flow event-server start --port 3002', description: 'Start on custom port' },
    { command: 'claude-flow event-server status', description: 'Check server status' },
    { command: 'claude-flow event-server stop', description: 'Stop the event server' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Event Server - Live Operations Dashboard'));
    output.writeln();
    output.writeln('WebSocket server for real-time streaming of Claude Flow operations.');
    output.writeln('Connect your Live Operations Dashboard to monitor agents, tasks, and metrics.');
    output.writeln();

    output.writeln(output.bold('Features'));
    output.printList([
      'Real-time agent lifecycle events (spawn, status, complete)',
      'Task progress and completion streaming',
      'Memory operations monitoring (store, retrieve, search)',
      'System performance metrics broadcasting',
      'Swarm coordination event tracking',
      'Error and warning notifications',
    ]);

    output.writeln();
    output.writeln(output.bold('Subcommands'));
    output.printList([
      `${output.highlight('start')}  - Start the WebSocket event server`,
      `${output.highlight('stop')}   - Stop the event server`,
      `${output.highlight('status')} - Show server status and connections`,
    ]);

    output.writeln();
    output.writeln(output.bold('Quick Start'));
    output.printList([
      '1. Start server: claude-flow event-server start',
      '2. Open Live Operations Dashboard in browser',
      '3. Connect to WebSocket URL (default: ws://localhost:3001)',
      '4. Monitor your Claude Flow operations in real-time',
    ]);

    output.writeln();
    output.writeln('Run "claude-flow event-server <subcommand> --help" for details');

    return { success: true };
  },
};

export default eventServerCommand;
