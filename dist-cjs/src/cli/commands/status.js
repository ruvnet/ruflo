import { Command } from '../commander-fix.js';
import chalk from 'chalk';
import Table from 'cli-table3';
import { formatDuration, formatStatusIndicator } from '../formatter.js';
import { VERSION } from '../../core/version.js';
import { MetricsReader } from '../../utils/metrics-reader.js';
export const statusCommand = new Command().name('status').description('Show Claude-Flow system status').option('-w, --watch', 'Watch mode - continuously update status').option('-i, --interval <seconds>', 'Update interval in seconds', '5').option('-c, --component <name>', 'Show status for specific component').option('--json', 'Output in JSON format').action(async (options)=>{
    if (options.watch) {
        await watchStatus(options);
    } else {
        await showStatus(options);
    }
});
async function showStatus(options) {
    try {
        const status = await getSystemStatus();
        if (options.json) {
            console.log(JSON.stringify(status, null, 2));
            return;
        }
        if (options.component) {
            showComponentStatus(status, options.component);
        } else {
            showFullStatus(status);
        }
    } catch (error) {
        if (error.message.includes('ECONNREFUSED') || error.message.includes('connection refused')) {
            console.error(chalk.red('✗ Claude-Flow is not running'));
            console.log(chalk.gray('Start it with: claude-flow start'));
        } else {
            console.error(chalk.red('Error getting status:'), error.message);
        }
    }
}
async function watchStatus(options) {
    const interval = parseInt(options.interval) * 1000;
    console.log(chalk.cyan('Watching Claude-Flow status...'));
    console.log(chalk.gray(`Update interval: ${options.interval}s`));
    console.log(chalk.gray('Press Ctrl+C to stop\n'));
    while(true){
        console.clear();
        console.log(chalk.cyan.bold('Claude-Flow Status Monitor'));
        console.log(chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}\n`));
        try {
            await showStatus({
                ...options,
                json: false
            });
        } catch (error) {
            console.error(chalk.red('Status update failed:'), error.message);
        }
        await new Promise((resolve)=>setTimeout(resolve, interval));
    }
}
function showFullStatus(status) {
    console.log(chalk.cyan.bold('System Overview'));
    console.log('─'.repeat(50));
    const statusIcon = formatStatusIndicator(status.overall);
    console.log(`${statusIcon} Overall Status: ${getStatusColor(status.overall)(status.overall.toUpperCase())}`);
    console.log(`${chalk.white('Uptime:')} ${formatDuration(status.uptime)}`);
    console.log(`${chalk.white('Version:')} ${status.version}`);
    console.log(`${chalk.white('Started:')} ${new Date(status.startTime).toLocaleString()}`);
    console.log();
    console.log(chalk.cyan.bold('Components'));
    console.log('─'.repeat(50));
    const componentRows = [];
    for (const [name, component] of Object.entries(status.components)){
        const comp = component;
        const statusIcon = formatStatusIndicator(comp.status);
        const statusText = getStatusColor(comp.status)(comp.status.toUpperCase());
        componentRows.push([
            chalk.white(name),
            `${statusIcon} ${statusText}`,
            formatDuration(comp.uptime || 0),
            comp.details || '-'
        ]);
    }
    const componentTable = new Table({
        head: [
            'Component',
            'Status',
            'Uptime',
            'Details'
        ]
    });
    componentTable.push(...componentRows);
    console.log(componentTable.toString());
    console.log();
    if (status.resources) {
        console.log(chalk.cyan.bold('Resource Usage'));
        console.log('─'.repeat(50));
        const resourceRows = [];
        for (const [name, resource] of Object.entries(status.resources)){
            const res = resource;
            const percentage = (res.used / res.total * 100).toFixed(1);
            const color = getResourceColor(parseFloat(percentage));
            resourceRows.push([
                chalk.white(name),
                res.used.toString(),
                res.total.toString(),
                color(`${percentage}%`)
            ]);
        }
        const resourceTable = new Table({
            head: [
                'Resource',
                'Used',
                'Total',
                'Percentage'
            ]
        });
        resourceTable.push(...resourceRows);
        console.log(resourceTable.toString());
        console.log();
    }
    if (status.agents) {
        console.log(chalk.cyan.bold(`Active Agents (${status.agents.length})`));
        console.log('─'.repeat(50));
        if (status.agents.length > 0) {
            const agentRows = [];
            for (const agent of status.agents){
                const statusIcon = formatStatusIndicator(agent.status);
                const statusText = getStatusColor(agent.status)(agent.status);
                agentRows.push([
                    chalk.gray(agent.id.slice(0, 8)),
                    chalk.white(agent.name),
                    agent.type,
                    `${statusIcon} ${statusText}`,
                    agent.activeTasks.toString()
                ]);
            }
            const agentTable = new Table({
                head: [
                    'ID',
                    'Name',
                    'Type',
                    'Status',
                    'Tasks'
                ]
            });
            agentTable.push(...agentRows);
            console.log(agentTable.toString());
        } else {
            console.log(chalk.gray('No active agents'));
        }
        console.log();
    }
    if (status.recentTasks) {
        console.log(chalk.cyan.bold('Recent Tasks'));
        console.log('─'.repeat(50));
        if (status.recentTasks.length > 0) {
            const taskRows = [];
            for (const task of status.recentTasks.slice(0, 10)){
                const statusIcon = formatStatusIndicator(task.status);
                const statusText = getStatusColor(task.status)(task.status);
                taskRows.push([
                    chalk.gray(task.id.slice(0, 8)),
                    task.type,
                    `${statusIcon} ${statusText}`,
                    formatDuration(Date.now() - new Date(task.startTime).getTime()),
                    task.assignedTo ? chalk.gray(task.assignedTo.slice(0, 8)) : '-'
                ]);
            }
            const taskTable = new Table({
                head: [
                    'ID',
                    'Type',
                    'Status',
                    'Duration',
                    'Agent'
                ]
            });
            taskTable.push(...taskRows);
            console.log(taskTable.toString());
        } else {
            console.log(chalk.gray('No recent tasks'));
        }
    }
}
function showComponentStatus(status, componentName) {
    const component = status.components[componentName];
    if (!component) {
        console.error(chalk.red(`Component '${componentName}' not found`));
        console.log(chalk.gray(`Available components: ${Object.keys(status.components).join(', ')}`));
        return;
    }
    console.log(chalk.cyan.bold(`Component: ${componentName}`));
    console.log('─'.repeat(50));
    const statusIcon = formatStatusIndicator(component.status);
    console.log(`${statusIcon} Status: ${getStatusColor(component.status)(component.status.toUpperCase())}`);
    console.log(`${chalk.white('Uptime:')} ${formatDuration(component.uptime || 0)}`);
    if (component.details) {
        console.log(`${chalk.white('Details:')} ${component.details}`);
    }
    if (component.metrics) {
        console.log();
        console.log(chalk.cyan('Metrics:'));
        const metricRows = [];
        for (const [name, value] of Object.entries(component.metrics)){
            metricRows.push([
                chalk.white(name),
                value.toString()
            ]);
        }
        const metricsTable = new Table({
            head: [
                'Metric',
                'Value'
            ]
        });
        metricsTable.push(...metricRows);
        console.log(metricsTable.toString());
    }
    if (component.errors && component.errors.length > 0) {
        console.log();
        console.log(chalk.red('Recent Errors:'));
        const errorRows = [];
        for (const error of component.errors.slice(0, 5)){
            errorRows.push([
                new Date(error.timestamp).toLocaleTimeString(),
                error.message
            ]);
        }
        const errorTable = new Table({
            head: [
                'Time',
                'Error'
            ]
        });
        errorTable.push(...errorRows);
        console.log(errorTable.toString());
    }
}
async function getSystemStatus() {
    const reader = new MetricsReader();
    const [systemMetrics, perfMetrics, agents, recentTasks, overallHealth] = await Promise.all([
        reader.getSystemMetrics(),
        reader.getPerformanceMetrics(),
        reader.getActiveAgents(),
        reader.getRecentTasks(5),
        reader.getOverallHealth()
    ]);
    const uptime = systemMetrics ? systemMetrics.uptime * 1000 : 0;
    const memUsedMB = systemMetrics ? Math.round(systemMetrics.memoryUsed / (1024 * 1024)) : 0;
    const memTotalMB = systemMetrics ? Math.round(systemMetrics.memoryTotal / (1024 * 1024)) : 512;
    const orchestratorStatus = perfMetrics && perfMetrics.totalTasks > 0 ? 'healthy' : 'idle';
    const agentsStatus = agents.length > 0 ? 'healthy' : 'idle';
    const memoryStatus = systemMetrics && systemMetrics.memoryUsagePercent < 80 ? 'healthy' : systemMetrics && systemMetrics.memoryUsagePercent < 90 ? 'warning' : 'error';
    const activeAgentCount = agents.filter((a)=>a.status === 'active' || a.status === 'busy').length;
    return {
        overall: overallHealth,
        version: VERSION,
        uptime: uptime,
        startTime: Date.now() - uptime,
        components: {
            orchestrator: {
                status: orchestratorStatus,
                uptime: uptime,
                details: perfMetrics ? `${perfMetrics.totalTasks} tasks processed` : 'No tasks yet'
            },
            agents: {
                status: agentsStatus,
                uptime: uptime,
                details: `${activeAgentCount} active, ${agents.length} total agents`
            },
            memory: {
                status: memoryStatus,
                uptime: uptime,
                details: `Using ${memUsedMB}MB of ${memTotalMB}MB`
            }
        },
        resources: {
            memory: {
                used: memUsedMB,
                total: memTotalMB
            },
            cpu: {
                used: systemMetrics ? Math.round(systemMetrics.cpuLoad * 100) : 0,
                total: 100
            }
        },
        agents: agents,
        recentTasks: recentTasks
    };
}
function getStatusColor(status) {
    switch(status.toLowerCase()){
        case 'healthy':
        case 'active':
        case 'completed':
            return chalk.green;
        case 'warning':
        case 'idle':
        case 'pending':
            return chalk.yellow;
        case 'error':
        case 'failed':
            return chalk.red;
        default:
            return chalk.gray;
    }
}
function getResourceColor(percentage) {
    if (percentage < 50) return chalk.green;
    if (percentage < 80) return chalk.yellow;
    return chalk.red;
}

//# sourceMappingURL=status.js.map