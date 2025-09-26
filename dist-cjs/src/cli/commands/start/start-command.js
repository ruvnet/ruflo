import { promises as fs } from 'node:fs';
import { Command } from '@cliffy/command';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { ProcessManager } from './process-manager.js';
import { ProcessUI } from './process-ui.js';
import { SystemMonitor } from './system-monitor.js';
import { eventBus } from '../../../core/event-bus.js';
export const startCommand = new Command().description('Start the Claude-Flow orchestration system').option('-d, --daemon', 'Run as daemon in background').option('-p, --port <port:number>', 'MCP server port', {
    default: 3000
}).option('--mcp-transport <transport:string>', 'MCP transport type (stdio, http)', {
    default: 'stdio'
}).option('-u, --ui', 'Launch interactive process management UI').option('-v, --verbose', 'Enable verbose logging').option('--auto-start', 'Automatically start all processes').option('--config <path:string>', 'Configuration file path').option('--force', 'Force start even if already running').option('--health-check', 'Perform health checks before starting').option('--timeout <seconds:number>', 'Startup timeout in seconds', {
    default: 60
}).action(async (options)=>{
    console.log(chalk.cyan('🧠 Claude-Flow Orchestration System'));
    console.log(chalk.gray('─'.repeat(60)));
    try {
        if (!options.force && await isSystemRunning()) {
            console.log(chalk.yellow('⚠ Claude-Flow is already running'));
            const { shouldContinue } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'shouldContinue',
                    message: 'Stop existing instance and restart?',
                    default: false
                }
            ]);
            if (!shouldContinue) {
                console.log(chalk.gray('Use --force to override or "claude-flow stop" first'));
                return;
            }
            await stopExistingInstance();
        }
        if (options.healthCheck) {
            console.log(chalk.blue('Running pre-flight health checks...'));
            await performHealthChecks();
        }
        const processManager = new ProcessManager();
        console.log(chalk.blue('Initializing system components...'));
        const initPromise = processManager.initialize(options.config);
        const timeoutPromise = new Promise((_, reject)=>setTimeout(()=>reject(new Error('Initialization timeout')), (options.timeout || 30) * 1000));
        await Promise.race([
            initPromise,
            timeoutPromise
        ]);
        const systemMonitor = new SystemMonitor(processManager);
        systemMonitor.start();
        setupSystemEventHandlers(processManager, systemMonitor, options);
        if (options.port) {
            const mcpProcess = processManager.getProcess('mcp-server');
            if (mcpProcess) {
                mcpProcess.config = {
                    ...mcpProcess.config,
                    port: options.port
                };
            }
        }
        if (options.mcpTransport) {
            const mcpProcess = processManager.getProcess('mcp-server');
            if (mcpProcess) {
                mcpProcess.config = {
                    ...mcpProcess.config,
                    transport: options.mcpTransport
                };
            }
        }
        if (options.verbose) {
            setupVerboseLogging(systemMonitor);
        }
        if (options.ui) {
            try {
                const { ClaudeCodeWebServer } = await import('../../simple-commands/web-server.js');
                console.log(chalk.blue('Starting Web UI server...'));
                const webServer = new ClaudeCodeWebServer(options.port);
                await webServer.start();
                const openCommand = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
                try {
                    const { exec } = await import('child_process');
                    exec(`${openCommand} http://localhost:${options.port}/console`);
                } catch  {}
                console.log(chalk.green('✨ Web UI is running at:'), chalk.cyan(`http://localhost:${options.port}/console`));
                console.log(chalk.gray('Press Ctrl+C to stop'));
                const shutdownWebUI = async ()=>{
                    console.log('\n' + chalk.yellow('Shutting down Web UI...'));
                    await webServer.stop();
                    systemMonitor.stop();
                    await processManager.stopAll();
                    console.log(chalk.green('✓ Shutdown complete'));
                    process.exit(0);
                };
                Deno.addSignalListener('SIGINT', shutdownWebUI);
                Deno.addSignalListener('SIGTERM', shutdownWebUI);
                await new Promise(()=>{});
            } catch (webError) {
                console.log(chalk.yellow('Web UI not available, falling back to Terminal UI'));
                const ui = new ProcessUI(processManager);
                await ui.start();
                systemMonitor.stop();
                await processManager.stopAll();
                console.log(chalk.green.bold('✓'), 'Shutdown complete');
                process.exit(0);
            }
        } else if (options.daemon) {
            console.log(chalk.yellow('Starting in daemon mode...'));
            if (options.autoStart) {
                console.log(chalk.blue('Starting all system processes...'));
                await startWithProgress(processManager, 'all');
            } else {
                console.log(chalk.blue('Starting core processes...'));
                await startWithProgress(processManager, 'core');
            }
            const pid = Deno.pid;
            const pidData = {
                pid,
                startTime: Date.now(),
                config: options.config || 'default',
                processes: processManager.getAllProcesses().map((p)=>({
                        id: p.id,
                        status: p.status
                    }))
            };
            await fs.writeFile('.claude-flow.pid', JSON.stringify(pidData, null, 2));
            console.log(chalk.gray(`Process ID: ${pid}`));
            await waitForSystemReady(processManager);
            console.log(chalk.green.bold('✓'), 'Daemon started successfully');
            console.log(chalk.gray('Use "claude-flow status" to check system status'));
            console.log(chalk.gray('Use "claude-flow monitor" for real-time monitoring'));
            await new Promise(()=>{});
        } else {
            console.log(chalk.cyan('Starting in interactive mode...'));
            console.log();
            console.log(chalk.white.bold('Quick Actions:'));
            console.log('  [1] Start all processes');
            console.log('  [2] Start core processes only');
            console.log('  [3] Launch process management UI');
            console.log('  [4] Show system status');
            console.log('  [q] Quit');
            console.log();
            console.log(chalk.gray('Press a key to select an option...'));
            const decoder = new TextDecoder();
            while(true){
                const buf = new Uint8Array(1);
                await Deno.stdin.read(buf);
                const key = decoder.decode(buf);
                switch(key){
                    case '1':
                        console.log(chalk.cyan('\nStarting all processes...'));
                        await startWithProgress(processManager, 'all');
                        console.log(chalk.green.bold('✓'), 'All processes started');
                        break;
                    case '2':
                        console.log(chalk.cyan('\nStarting core processes...'));
                        await startWithProgress(processManager, 'core');
                        console.log(chalk.green.bold('✓'), 'Core processes started');
                        break;
                    case '3':
                        const ui = new ProcessUI(processManager);
                        await ui.start();
                        break;
                    case '4':
                        console.clear();
                        systemMonitor.printSystemHealth();
                        console.log();
                        systemMonitor.printEventLog(10);
                        console.log();
                        console.log(chalk.gray('Press any key to continue...'));
                        await Deno.stdin.read(new Uint8Array(1));
                        break;
                    case 'q':
                    case 'Q':
                        console.log(chalk.yellow('\nShutting down...'));
                        await processManager.stopAll();
                        systemMonitor.stop();
                        console.log(chalk.green.bold('✓'), 'Shutdown complete');
                        process.exit(0);
                        break;
                }
                console.clear();
                console.log(chalk.cyan('🧠 Claude-Flow Interactive Mode'));
                console.log(chalk.gray('─'.repeat(60)));
                const stats = processManager.getSystemStats();
                console.log(chalk.white('System Status:'), chalk.green(`${stats.runningProcesses}/${stats.totalProcesses} processes running`));
                console.log();
                console.log(chalk.white.bold('Quick Actions:'));
                console.log('  [1] Start all processes');
                console.log('  [2] Start core processes only');
                console.log('  [3] Launch process management UI');
                console.log('  [4] Show system status');
                console.log('  [q] Quit');
                console.log();
                console.log(chalk.gray('Press a key to select an option...'));
            }
        }
    } catch (error) {
        console.error(chalk.red.bold('Failed to start:'), error.message);
        if (options.verbose) {
            console.error(error.stack);
        }
        console.log(chalk.yellow('Performing cleanup...'));
        try {
            await cleanupOnFailure();
        } catch (cleanupError) {
            console.error(chalk.red('Cleanup failed:'), cleanupError.message);
        }
        process.exit(1);
    }
});
async function isSystemRunning() {
    try {
        const pidData = await fs.readFile('.claude-flow.pid', 'utf-8');
        const data = JSON.parse(pidData);
        try {
            Deno.kill(data.pid, 'SIGTERM');
            return false;
        } catch  {
            return false;
        }
    } catch  {
        return false;
    }
}
async function stopExistingInstance() {
    try {
        const pidData = await fs.readFile('.claude-flow.pid', 'utf-8');
        const data = JSON.parse(pidData);
        console.log(chalk.yellow('Stopping existing instance...'));
        Deno.kill(data.pid, 'SIGTERM');
        await new Promise((resolve)=>setTimeout(resolve, 2000));
        try {
            Deno.kill(data.pid, 'SIGKILL');
        } catch  {}
        await Deno.remove('.claude-flow.pid').catch(()=>{});
        console.log(chalk.green('✓ Existing instance stopped'));
    } catch (error) {
        console.warn(chalk.yellow('Warning: Could not stop existing instance'), error.message);
    }
}
async function performHealthChecks() {
    const checks = [
        {
            name: 'Disk Space',
            check: checkDiskSpace
        },
        {
            name: 'Memory Available',
            check: checkMemoryAvailable
        },
        {
            name: 'Network Connectivity',
            check: checkNetworkConnectivity
        },
        {
            name: 'Required Dependencies',
            check: checkDependencies
        }
    ];
    for (const { name, check } of checks){
        try {
            console.log(chalk.gray(`  Checking ${name}...`));
            await check();
            console.log(chalk.green(`  ✓ ${name} OK`));
        } catch (error) {
            console.log(chalk.red(`  ✗ ${name} Failed: ${error.message}`));
            throw error;
        }
    }
}
async function checkDiskSpace() {
    const stats = await fs.stat('.');
    if (!stats.isDirectory) {
        throw new Error('Current directory is not accessible');
    }
}
async function checkMemoryAvailable() {
    const memoryInfo = Deno.memoryUsage();
    if (memoryInfo.heapUsed > 500 * 1024 * 1024) {
        throw new Error('High memory usage detected');
    }
}
async function checkNetworkConnectivity() {
    try {
        const response = await fetch('https://httpbin.org/status/200', {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) {
            throw new Error(`Network check failed: ${response.status}`);
        }
    } catch  {
        console.log(chalk.yellow('  ⚠ Network connectivity check skipped (offline mode?)'));
    }
}
async function checkDependencies() {
    const requiredDirs = [
        '.claude-flow',
        'memory',
        'logs'
    ];
    for (const dir of requiredDirs){
        try {
            await Deno.mkdir(dir, {
                recursive: true
            });
        } catch (error) {
            throw new Error(`Cannot create required directory: ${dir}`);
        }
    }
}
function setupSystemEventHandlers(processManager, systemMonitor, options) {
    const shutdownHandler = async ()=>{
        console.log('\n' + chalk.yellow('Received shutdown signal, shutting down gracefully...'));
        systemMonitor.stop();
        await processManager.stopAll();
        await cleanupOnShutdown();
        console.log(chalk.green('✓ Shutdown complete'));
        process.exit(0);
    };
    Deno.addSignalListener('SIGINT', shutdownHandler);
    Deno.addSignalListener('SIGTERM', shutdownHandler);
    if (options.verbose) {
        setupVerboseLogging(systemMonitor);
    }
    processManager.on('processError', (event)=>{
        console.error(chalk.red(`Process error in ${event.processId}:`), event.error);
        if (event.processId === 'orchestrator') {
            console.error(chalk.red.bold('Critical process failed, initiating recovery...'));
        }
    });
}
async function startWithProgress(processManager, mode) {
    const processes = mode === 'all' ? [
        'event-bus',
        'memory-manager',
        'terminal-pool',
        'coordinator',
        'mcp-server',
        'orchestrator'
    ] : [
        'event-bus',
        'memory-manager',
        'mcp-server'
    ];
    for(let i = 0; i < processes.length; i++){
        const processId = processes[i];
        const progress = `[${i + 1}/${processes.length}]`;
        console.log(chalk.gray(`${progress} Starting ${processId}...`));
        try {
            await processManager.startProcess(processId);
            console.log(chalk.green(`${progress} ✓ ${processId} started`));
        } catch (error) {
            console.log(chalk.red(`${progress} ✗ ${processId} failed: ${error.message}`));
            if (processId === 'orchestrator' || processId === 'mcp-server') {
                throw error;
            }
        }
        if (i < processes.length - 1) {
            await new Promise((resolve)=>setTimeout(resolve, 500));
        }
    }
}
async function waitForSystemReady(processManager) {
    console.log(chalk.blue('Waiting for system to be ready...'));
    const maxWait = 30000;
    const checkInterval = 1000;
    let waited = 0;
    while(waited < maxWait){
        const stats = processManager.getSystemStats();
        if (stats.errorProcesses === 0 && stats.runningProcesses >= 3) {
            console.log(chalk.green('✓ System ready'));
            return;
        }
        await new Promise((resolve)=>setTimeout(resolve, checkInterval));
        waited += checkInterval;
    }
    console.log(chalk.yellow('⚠ System startup completed but some processes may not be fully ready'));
}
async function cleanupOnFailure() {
    try {
        await Deno.remove('.claude-flow.pid').catch(()=>{});
        console.log(chalk.gray('Cleaned up PID file'));
    } catch  {}
}
async function cleanupOnShutdown() {
    try {
        await Deno.remove('.claude-flow.pid').catch(()=>{});
        console.log(chalk.gray('Cleaned up PID file'));
    } catch  {}
}
function setupVerboseLogging(monitor) {
    console.log(chalk.gray('Verbose logging enabled'));
    setInterval(()=>{
        console.log();
        console.log(chalk.cyan('--- System Health Report ---'));
        monitor.printSystemHealth();
        console.log(chalk.cyan('--- End Report ---'));
    }, 30000);
    eventBus.on('process:started', (data)=>{
        console.log(chalk.green(`[VERBOSE] Process started: ${data.processId}`));
    });
    eventBus.on('process:stopped', (data)=>{
        console.log(chalk.yellow(`[VERBOSE] Process stopped: ${data.processId}`));
    });
    eventBus.on('process:error', (data)=>{
        console.log(chalk.red(`[VERBOSE] Process error: ${data.processId} - ${data.error}`));
    });
}

//# sourceMappingURL=start-command.js.map