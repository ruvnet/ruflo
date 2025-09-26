import chalk from 'chalk';
import { ProcessStatus } from './types.js';
export class ProcessUI {
    processManager;
    running = false;
    selectedIndex = 0;
    constructor(processManager){
        this.processManager = processManager;
        this.setupEventListeners();
    }
    setupEventListeners() {
        this.processManager.on('statusChanged', ({ processId, status })=>{
            if (this.running) {
                this.render();
            }
        });
        this.processManager.on('processError', ({ processId, error })=>{
            if (this.running) {
                console.log(chalk.red(`\nProcess ${processId} error: ${error instanceof Error ? error.message : String(error)}`));
            }
        });
    }
    async start() {
        this.running = true;
        console.clear();
        this.render();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        while(this.running){
            await Deno.stdout.write(encoder.encode('\nCommand: '));
            const buf = new Uint8Array(1024);
            const n = await Deno.stdin.read(buf);
            if (n === null) break;
            const input = decoder.decode(buf.subarray(0, n)).trim();
            if (input.length > 0) {
                await this.handleCommand(input);
            }
        }
    }
    async stop() {
        this.running = false;
        console.clear();
    }
    async handleCommand(input) {
        const processes = this.processManager.getAllProcesses();
        switch(input.toLowerCase()){
            case 'q':
            case 'quit':
            case 'exit':
                await this.handleExit();
                break;
            case 'a':
            case 'all':
                await this.startAll();
                break;
            case 'z':
            case 'stop-all':
                await this.stopAll();
                break;
            case 'r':
            case 'refresh':
                this.render();
                break;
            case 'h':
            case 'help':
            case '?':
                this.showHelp();
                break;
            default:
                const num = parseInt(input);
                if (!isNaN(num) && num >= 1 && num <= processes.length) {
                    this.selectedIndex = num - 1;
                    await this.showProcessMenu(processes[this.selectedIndex]);
                } else {
                    console.log(chalk.yellow('Invalid command. Type "h" for help.'));
                }
                break;
        }
    }
    render() {
        console.clear();
        const processes = this.processManager.getAllProcesses();
        const stats = this.processManager.getSystemStats();
        console.log(chalk.cyan.bold('🧠 Claude-Flow Process Manager'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.white('System Status:'), chalk.green(`${stats.runningProcesses}/${stats.totalProcesses} running`));
        if (stats.errorProcesses > 0) {
            console.log(chalk.red(`⚠️  ${stats.errorProcesses} processes with errors`));
        }
        console.log();
        console.log(chalk.white.bold('Processes:'));
        console.log(chalk.gray('─'.repeat(60)));
        processes.forEach((process, index)=>{
            const num = `[${index + 1}]`.padEnd(4);
            const status = this.getStatusDisplay(process.status);
            const name = process.name.padEnd(25);
            console.log(`${chalk.gray(num)} ${status} ${chalk.white(name)}`);
            if (process.metrics?.lastError) {
                console.log(chalk.red(`       Error: ${process.metrics.lastError}`));
            }
        });
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.gray('Commands: [1-9] Select process [a] Start All [z] Stop All'));
        console.log(chalk.gray('[r] Refresh [h] Help [q] Quit'));
    }
    async showProcessMenu(process) {
        console.log();
        console.log(chalk.cyan.bold(`Selected: ${process.name}`));
        console.log(chalk.gray('─'.repeat(40)));
        if (process.status === ProcessStatus.STOPPED) {
            console.log('[s] Start');
        } else if (process.status === ProcessStatus.RUNNING) {
            console.log('[x] Stop');
            console.log('[r] Restart');
        }
        console.log('[d] Details');
        console.log('[c] Cancel');
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        await Deno.stdout.write(encoder.encode('\nAction: '));
        const buf = new Uint8Array(1024);
        const n = await Deno.stdin.read(buf);
        if (n === null) return;
        const action = decoder.decode(buf.subarray(0, n)).trim().toLowerCase();
        switch(action){
            case 's':
                if (process.status === ProcessStatus.STOPPED) {
                    await this.startProcess(process.id);
                }
                break;
            case 'x':
                if (process.status === ProcessStatus.RUNNING) {
                    await this.stopProcess(process.id);
                }
                break;
            case 'r':
                if (process.status === ProcessStatus.RUNNING) {
                    await this.restartProcess(process.id);
                }
                break;
            case 'd':
                this.showProcessDetails(process);
                await this.waitForKey();
                break;
        }
        this.render();
    }
    showProcessDetails(process) {
        console.log();
        console.log(chalk.cyan.bold(`📋 Process Details: ${process.name}`));
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.white('ID:'), process.id);
        console.log(chalk.white('Type:'), process.type);
        console.log(chalk.white('Status:'), this.getStatusDisplay(process.status), process.status);
        if (process.pid) {
            console.log(chalk.white('PID:'), process.pid);
        }
        if (process.startTime) {
            const uptime = Date.now() - process.startTime;
            console.log(chalk.white('Uptime:'), this.formatUptime(uptime));
        }
        if (process.metrics) {
            console.log();
            console.log(chalk.white.bold('Metrics:'));
            if (process.metrics.cpu !== undefined) {
                console.log(chalk.white('CPU:'), `${process.metrics.cpu.toFixed(1)}%`);
            }
            if (process.metrics.memory !== undefined) {
                console.log(chalk.white('Memory:'), `${process.metrics.memory.toFixed(0)} MB`);
            }
            if (process.metrics.restarts !== undefined) {
                console.log(chalk.white('Restarts:'), process.metrics.restarts);
            }
            if (process.metrics.lastError) {
                console.log(chalk.red('Last Error:'), process.metrics.lastError);
            }
        }
        console.log();
        console.log(chalk.gray('Press any key to continue...'));
    }
    async waitForKey() {
        const buf = new Uint8Array(1);
        await Deno.stdin.read(buf);
    }
    getStatusDisplay(status) {
        switch(status){
            case ProcessStatus.RUNNING:
                return chalk.green('●');
            case ProcessStatus.STOPPED:
                return chalk.gray('○');
            case ProcessStatus.STARTING:
                return chalk.yellow('◐');
            case ProcessStatus.STOPPING:
                return chalk.yellow('◑');
            case ProcessStatus.ERROR:
                return chalk.red('✗');
            case ProcessStatus.CRASHED:
                return chalk.red('☠');
            default:
                return chalk.gray('?');
        }
    }
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
    showHelp() {
        console.log();
        console.log(chalk.cyan.bold('🧠 Claude-Flow Process Manager - Help'));
        console.log(chalk.gray('─'.repeat(60)));
        console.log();
        console.log(chalk.white.bold('Commands:'));
        console.log('  1-9     - Select process by number');
        console.log('  a       - Start all processes');
        console.log('  z       - Stop all processes');
        console.log('  r       - Refresh display');
        console.log('  h/?     - Show this help');
        console.log('  q       - Quit');
        console.log();
        console.log(chalk.white.bold('Process Actions:'));
        console.log('  s       - Start selected process');
        console.log('  x       - Stop selected process');
        console.log('  r       - Restart selected process');
        console.log('  d       - Show process details');
        console.log();
        console.log(chalk.gray('Press any key to continue...'));
    }
    async startProcess(processId) {
        try {
            console.log(chalk.yellow(`Starting ${processId}...`));
            await this.processManager.startProcess(processId);
            console.log(chalk.green(`✓ Started ${processId}`));
        } catch (error) {
            console.log(chalk.red(`✗ Failed to start ${processId}: ${error.message}`));
        }
        await this.waitForKey();
    }
    async stopProcess(processId) {
        try {
            console.log(chalk.yellow(`Stopping ${processId}...`));
            await this.processManager.stopProcess(processId);
            console.log(chalk.green(`✓ Stopped ${processId}`));
        } catch (error) {
            console.log(chalk.red(`✗ Failed to stop ${processId}: ${error.message}`));
        }
        await this.waitForKey();
    }
    async restartProcess(processId) {
        try {
            console.log(chalk.yellow(`Restarting ${processId}...`));
            await this.processManager.restartProcess(processId);
            console.log(chalk.green(`✓ Restarted ${processId}`));
        } catch (error) {
            console.log(chalk.red(`✗ Failed to restart ${processId}: ${error.message}`));
        }
        await this.waitForKey();
    }
    async startAll() {
        try {
            console.log(chalk.yellow('Starting all processes...'));
            await this.processManager.startAll();
            console.log(chalk.green('✓ All processes started'));
        } catch (error) {
            console.log(chalk.red(`✗ Failed to start all: ${error.message}`));
        }
        await this.waitForKey();
        this.render();
    }
    async stopAll() {
        try {
            console.log(chalk.yellow('Stopping all processes...'));
            await this.processManager.stopAll();
            console.log(chalk.green('✓ All processes stopped'));
        } catch (error) {
            console.log(chalk.red(`✗ Failed to stop all: ${error.message}`));
        }
        await this.waitForKey();
        this.render();
    }
    async handleExit() {
        const processes = this.processManager.getAllProcesses();
        const hasRunning = processes.some((p)=>p.status === ProcessStatus.RUNNING);
        if (hasRunning) {
            console.log();
            console.log(chalk.yellow('⚠️  Some processes are still running.'));
            console.log('Stop all processes before exiting? [y/N]: ');
            const decoder = new TextDecoder();
            const buf = new Uint8Array(1024);
            const n = await Deno.stdin.read(buf);
            if (n && decoder.decode(buf.subarray(0, n)).trim().toLowerCase() === 'y') {
                await this.stopAll();
            }
        }
        await this.stop();
    }
}

//# sourceMappingURL=process-ui-simple.js.map