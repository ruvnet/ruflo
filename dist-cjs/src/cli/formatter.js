import chalk from 'chalk';
import Table from 'cli-table3';
import * as process from 'process';
export function formatError(error) {
    if (error instanceof Error) {
        let message = error instanceof Error ? error.message : String(error);
        if ('code' in error) {
            message = `[${error.code}] ${message}`;
        }
        if ('details' in error && error.details) {
            message += '\n' + chalk.gray('Details: ' + JSON.stringify(error.details, null, 2));
        }
        return message;
    }
    return String(error);
}
export function formatAgent(agent) {
    const lines = [
        chalk.cyan.bold(`Agent: ${agent.name}`),
        chalk.gray(`ID: ${agent.id}`),
        chalk.gray(`Type: ${agent.type}`),
        chalk.gray(`Priority: ${agent.priority}`),
        chalk.gray(`Max Tasks: ${agent.maxConcurrentTasks}`),
        chalk.gray(`Capabilities: ${agent.capabilities.join(', ')}`)
    ];
    return lines.join('\n');
}
export function formatTask(task) {
    const statusColor = {
        pending: chalk.gray,
        queued: chalk.yellow,
        assigned: chalk.blue,
        running: chalk.cyan,
        completed: chalk.green,
        failed: chalk.red,
        cancelled: chalk.magenta
    }[task.status] || chalk.white;
    const lines = [
        chalk.yellow.bold(`Task: ${task.description}`),
        chalk.gray(`ID: ${task.id}`),
        chalk.gray(`Type: ${task.type}`),
        statusColor(`Status: ${task.status}`),
        chalk.gray(`Priority: ${task.priority}`)
    ];
    if (task.assignedAgent) {
        lines.push(chalk.gray(`Assigned to: ${task.assignedAgent}`));
    }
    if (task.dependencies.length > 0) {
        lines.push(chalk.gray(`Dependencies: ${task.dependencies.join(', ')}`));
    }
    if (task.error) {
        lines.push(chalk.red(`Error: ${task.error}`));
    }
    return lines.join('\n');
}
export function formatMemoryEntry(entry) {
    const lines = [
        chalk.magenta.bold(`Memory Entry: ${entry.type}`),
        chalk.gray(`ID: ${entry.id}`),
        chalk.gray(`Agent: ${entry.agentId}`),
        chalk.gray(`Session: ${entry.sessionId}`),
        chalk.gray(`Timestamp: ${entry.timestamp.toISOString()}`),
        chalk.gray(`Version: ${entry.version}`)
    ];
    if (entry.tags.length > 0) {
        lines.push(chalk.gray(`Tags: ${entry.tags.join(', ')}`));
    }
    lines.push('', chalk.white('Content:'), entry.content);
    return lines.join('\n');
}
export function formatHealthStatus(health) {
    const statusColor = {
        healthy: chalk.green,
        degraded: chalk.yellow,
        unhealthy: chalk.red
    }[health.status];
    const lines = [
        statusColor.bold(`System Status: ${health.status.toUpperCase()}`),
        chalk.gray(`Checked at: ${health.timestamp.toISOString()}`),
        '',
        chalk.cyan.bold('Components:')
    ];
    for (const [name, component] of Object.entries(health.components)){
        const compColor = {
            healthy: chalk.green,
            degraded: chalk.yellow,
            unhealthy: chalk.red
        }[component.status];
        lines.push(compColor(`  ${name}: ${component.status}`));
        if (component.error) {
            lines.push(chalk.red(`    Error: ${component.error}`));
        }
        if (component.metrics) {
            for (const [metric, value] of Object.entries(component.metrics)){
                lines.push(chalk.gray(`    ${metric}: ${value}`));
            }
        }
    }
    return lines.join('\n');
}
export function createAgentTable(agents) {
    const table = new Table({
        head: [
            'ID',
            'Name',
            'Type',
            'Priority',
            'Max Tasks'
        ]
    });
    for (const agent of agents){
        table.push([
            agent.id,
            agent.name,
            agent.type,
            agent.priority.toString(),
            agent.maxConcurrentTasks.toString()
        ]);
    }
    return table;
}
export function createTaskTable(tasks) {
    const table = new Table({
        head: [
            'ID',
            'Type',
            "Description",
            'Status',
            'Agent'
        ]
    });
    for (const task of tasks){
        const statusCell = {
            pending: chalk.gray(task.status),
            queued: chalk.yellow(task.status),
            assigned: chalk.blue(task.status),
            running: chalk.cyan(task.status),
            completed: chalk.green(task.status),
            failed: chalk.red(task.status),
            cancelled: chalk.magenta(task.status)
        }[task.status] || task.status;
        table.push([
            task.id,
            task.type,
            task.description.substring(0, 40) + (task.description.length > 40 ? '...' : ''),
            statusCell,
            task.assignedAgent || '-'
        ]);
    }
    return table;
}
export function formatDuration(ms) {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}
export function displayBanner(version) {
    const banner = `
${chalk.cyan.bold('╔══════════════════════════════════════════════════════════════╗')}
${chalk.cyan.bold('║')}             ${chalk.white.bold('🧠 Claude-Flow')} ${chalk.gray('v' + version)}                        ${chalk.cyan.bold('║')}
${chalk.cyan.bold('║')}          ${chalk.gray('Advanced AI Agent Orchestration')}               ${chalk.cyan.bold('║')}
${chalk.cyan.bold('╚══════════════════════════════════════════════════════════════╝')}
`;
    console.log(banner);
}
export function displayVersion(version, buildDate) {
    const info = [
        chalk.cyan.bold('Claude-Flow Version Information'),
        '',
        chalk.white('Version:    ') + chalk.yellow(version),
        chalk.white('Build Date: ') + chalk.yellow(buildDate),
        chalk.white('Runtime:    ') + chalk.yellow('Node.js ' + process.version),
        chalk.white('Platform:   ') + chalk.yellow(process.platform),
        chalk.white('Arch:       ') + chalk.yellow(process.arch),
        '',
        chalk.gray('Components:'),
        chalk.white('  • Multi-Agent Orchestration'),
        chalk.white('  • Memory Management'),
        chalk.white('  • Terminal Integration'),
        chalk.white('  • MCP Server'),
        chalk.white('  • Task Coordination'),
        '',
        chalk.blue('Homepage: ') + chalk.underline('https://github.com/ruvnet/claude-flow')
    ];
    console.log(info.join('\n'));
}
export function formatProgressBar(current, total, width = 40, label) {
    const percentage = Math.min(100, current / total * 100);
    const filled = Math.floor(percentage / 100 * width);
    const empty = width - filled;
    const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
    const percent = percentage.toFixed(1).padStart(5) + '%';
    let result = `[${bar}] ${percent}`;
    if (label) {
        result = `${label}: ${result}`;
    }
    return result;
}
export function formatStatusIndicator(status) {
    const indicators = {
        success: chalk.green('✓'),
        error: chalk.red('✗'),
        warning: chalk.yellow('⚠'),
        info: chalk.blue('ℹ'),
        running: chalk.cyan('⟳'),
        pending: chalk.gray('○')
    };
    return indicators[status] || status;
}
export function formatSuccess(message) {
    return chalk.green('✓') + ' ' + chalk.white(message);
}
export function formatInfo(message) {
    return chalk.blue('ℹ') + ' ' + chalk.white(message);
}
export function formatWarning(message) {
    return chalk.yellow('⚠') + ' ' + chalk.white(message);
}
export function formatSpinner(message, frame = 0) {
    const frames = [
        '⠋',
        '⠙',
        '⠹',
        '⠸',
        '⠼',
        '⠴',
        '⠦',
        '⠧',
        '⠇',
        '⠏'
    ];
    const spinner = chalk.cyan(frames[frame % frames.length]);
    return `${spinner} ${message}`;
}

//# sourceMappingURL=formatter.js.map