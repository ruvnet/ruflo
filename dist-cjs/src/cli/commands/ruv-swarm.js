import { success, error, warning, info } from '../cli-core.js';
import { getRuvSwarmConfigManager } from '../../config/ruv-swarm-config.js';
import { execAsync } from '../../utils/helpers.js';
import { Logger } from '../../core/logger.js';
import { isRuvSwarmAvailable, initializeRuvSwarmIntegration } from '../../mcp/ruv-swarm-tools.js';
const logger = new Logger({
    level: 'info',
    format: 'text',
    destination: 'console'
});
export async function ruvSwarmAction(ctx) {
    if (ctx.flags.help || ctx.flags.h || ctx.args.length === 0) {
        showRuvSwarmHelp();
        return;
    }
    const subcommand = ctx.args[0];
    const subArgs = ctx.args.slice(1);
    const subCtx = {
        ...ctx,
        args: subArgs
    };
    try {
        const available = await isRuvSwarmAvailable(logger);
        if (!available) {
            error('ruv-swarm is not available');
            console.log('Install it with: npm install -g ruv-swarm');
            console.log('Or locally: npm install ruv-swarm');
            return;
        }
        switch(subcommand){
            case 'init':
                await handleInit(subCtx);
                break;
            case 'status':
                await handleStatus(subCtx);
                break;
            case 'spawn':
                await handleSpawn(subCtx);
                break;
            case 'list':
                await handleList(subCtx);
                break;
            case 'orchestrate':
                await handleOrchestrate(subCtx);
                break;
            case 'monitor':
                await handleMonitor(subCtx);
                break;
            case 'neural':
                await handleNeural(subCtx);
                break;
            case 'benchmark':
                await handleBenchmark(subCtx);
                break;
            case 'config':
                await handleConfig(subCtx);
                break;
            case 'memory':
                await handleMemory(subCtx);
                break;
            default:
                error(`Unknown ruv-swarm subcommand: ${subcommand}`);
                showRuvSwarmHelp();
                break;
        }
    } catch (err) {
        error(`ruv-swarm command failed: ${err.message}`);
    }
}
function showRuvSwarmHelp() {
    console.log('ruv-swarm - Advanced AI swarm coordination with neural capabilities\
');
    console.log('Usage:');
    console.log('  claude-flow ruv-swarm <command> [options]\
');
    console.log('Commands:');
    console.log('  init                       Initialize a new ruv-swarm');
    console.log('  status [--verbose]         Get swarm status');
    console.log('  spawn <type> [--name]      Spawn a new agent');
    console.log('  list [--filter]           List all agents');
    console.log('  orchestrate <task>         Orchestrate a task across the swarm');
    console.log('  monitor [--duration]       Monitor swarm activity');
    console.log('  neural <subcommand>        Neural capabilities management');
    console.log('  benchmark [--type]         Run performance benchmarks');
    console.log('  config <subcommand>        Configuration management');
    console.log('  memory [--detail]          Memory usage and management\
');
    console.log('Examples:');
    console.log('  claude-flow ruv-swarm init --topology mesh --max-agents 8');
    console.log('  claude-flow ruv-swarm spawn researcher --name \"AI Researcher\"');
    console.log('  claude-flow ruv-swarm orchestrate \"Build a REST API\"');
    console.log('  claude-flow ruv-swarm neural train --iterations 20');
    console.log('  claude-flow ruv-swarm benchmark --type swarm');
}
async function handleInit(ctx) {
    const topology = ctx.flags.topology || 'mesh';
    const maxAgents = ctx.flags.maxAgents || ctx.flags['max-agents'] || 5;
    const strategy = ctx.flags.strategy || 'balanced';
    if (![
        'mesh',
        'hierarchical',
        'ring',
        'star'
    ].includes(topology)) {
        error('Invalid topology. Use: mesh, hierarchical, ring, or star');
        return;
    }
    if (maxAgents < 1 || maxAgents > 100) {
        error('Max agents must be between 1 and 100');
        return;
    }
    info(`Initializing ruv-swarm with ${topology} topology...`);
    try {
        const command = `npx ruv-swarm swarm init --topology ${topology} --max-agents ${maxAgents} --strategy ${strategy}`;
        const result = await execAsync(command);
        if (result.stdout) {
            success('Swarm initialized successfully!');
            console.log(result.stdout);
        }
        const integration = await initializeRuvSwarmIntegration(process.cwd(), logger);
        if (integration.success) {
            info('Claude Code integration enabled');
        } else {
            warning(`Integration warning: ${integration.error}`);
        }
    } catch (err) {
        error(`Failed to initialize swarm: ${err.message}`);
    }
}
async function handleStatus(ctx) {
    const verbose = ctx.flags.verbose || ctx.flags.v || false;
    try {
        const command = `npx ruv-swarm swarm status${verbose ? ' --verbose' : ''}`;
        const result = await execAsync(command);
        if (result.stdout) {
            try {
                const statusData = JSON.parse(result.stdout);
                if (statusData.success && statusData.data) {
                    console.log('🐝 Swarm Status:\
');
                    const data = statusData.data;
                    if (data.swarmId) {
                        console.log(`  Swarm ID: ${data.swarmId}`);
                    }
                    if (data.topology) {
                        console.log(`  Topology: ${data.topology}`);
                    }
                    if (data.agents !== undefined) {
                        console.log(`  Active Agents: ${data.agents.active || 0}/${data.agents.total || 0}`);
                    }
                    if (data.tasks !== undefined) {
                        console.log(`  Tasks: ${data.tasks.completed || 0} completed, ${data.tasks.running || 0} running`);
                    }
                    if (data.memory) {
                        console.log(`  Memory Usage: ${data.memory.used || 'N/A'}`);
                    }
                    if (verbose && data.details) {
                        console.log('\
📋 Detailed Status:');
                        console.log(JSON.stringify(data.details, null, 2));
                    }
                } else {
                    console.log(result.stdout);
                }
            } catch  {
                console.log(result.stdout);
            }
        }
        if (result.stderr) {
            warning(result.stderr);
        }
    } catch (err) {
        error(`Failed to get swarm status: ${err.message}`);
    }
}
async function handleSpawn(ctx) {
    if (ctx.args.length === 0) {
        error('Agent type is required');
        console.log('Usage: claude-flow ruv-swarm spawn <type> [--name <name>]');
        console.log('Types: researcher, coder, analyst, optimizer, coordinator');
        return;
    }
    const type = ctx.args[0];
    const name = ctx.flags.name;
    const capabilities = ctx.flags.capabilities;
    if (![
        'researcher',
        'coder',
        'analyst',
        'optimizer',
        'coordinator'
    ].includes(type)) {
        error('Invalid agent type');
        console.log('Valid types: researcher, coder, analyst, optimizer, coordinator');
        return;
    }
    info(`Spawning ${type} agent...`);
    try {
        let command = `npx ruv-swarm agent spawn --type ${type}`;
        if (name) {
            command += ` --name \"${name}\"`;
        }
        if (capabilities) {
            command += ` --capabilities \"${capabilities}\"`;
        }
        const result = await execAsync(command);
        if (result.stdout) {
            try {
                const spawnData = JSON.parse(result.stdout);
                if (spawnData.success) {
                    success(`Agent spawned successfully!`);
                    console.log(`  Agent ID: ${spawnData.data.agentId}`);
                    if (spawnData.data.agentName) {
                        console.log(`  Name: ${spawnData.data.agentName}`);
                    }
                    console.log(`  Type: ${type}`);
                } else {
                    error(`Failed to spawn agent: ${spawnData.error}`);
                }
            } catch  {
                console.log(result.stdout);
            }
        }
    } catch (err) {
        error(`Failed to spawn agent: ${err.message}`);
    }
}
async function handleList(ctx) {
    const filter = ctx.flags.filter || 'all';
    try {
        const command = `npx ruv-swarm agent list --filter ${filter}`;
        const result = await execAsync(command);
        if (result.stdout) {
            try {
                const listData = JSON.parse(result.stdout);
                if (listData.success && listData.data.agents) {
                    console.log(`🤖 Agents (${listData.data.count}):`);
                    if (listData.data.count === 0) {
                        console.log('  No agents found');
                        return;
                    }
                    listData.data.agents.forEach((agent, index)=>{
                        console.log(`\
  ${index + 1}. ${agent.id || agent.agentId}`);
                        console.log(`     Type: ${agent.type}`);
                        console.log(`     Status: ${agent.status}`);
                        if (agent.name && agent.name !== agent.id) {
                            console.log(`     Name: ${agent.name}`);
                        }
                        if (agent.capabilities && agent.capabilities.length > 0) {
                            console.log(`     Capabilities: ${agent.capabilities.join(', ')}`);
                        }
                    });
                } else {
                    console.log(result.stdout);
                }
            } catch  {
                console.log(result.stdout);
            }
        }
    } catch (err) {
        error(`Failed to list agents: ${err.message}`);
    }
}
async function handleOrchestrate(ctx) {
    if (ctx.args.length === 0) {
        error("Task description is required");
        console.log('Usage: claude-flow ruv-swarm orchestrate "<task description>" [options]');
        return;
    }
    const task = ctx.args.join(' ');
    const strategy = ctx.flags.strategy || 'adaptive';
    const priority = ctx.flags.priority || 'medium';
    const maxAgents = ctx.flags.maxAgents || ctx.flags['max-agents'];
    info(`Orchestrating task: ${task}`);
    try {
        let command = `npx ruv-swarm task orchestrate --task \"${task}\" --strategy ${strategy} --priority ${priority}`;
        if (maxAgents) {
            command += ` --max-agents ${maxAgents}`;
        }
        const result = await execAsync(command);
        if (result.stdout) {
            try {
                const taskData = JSON.parse(result.stdout);
                if (taskData.success) {
                    success('Task orchestration started!');
                    console.log(`  Task ID: ${taskData.data.taskId}`);
                    console.log(`  Strategy: ${strategy}`);
                    console.log(`  Priority: ${priority}`);
                    if (taskData.data.assignedAgents) {
                        console.log(`  Assigned Agents: ${taskData.data.assignedAgents}`);
                    }
                } else {
                    error(`Failed to orchestrate task: ${taskData.error}`);
                }
            } catch  {
                console.log(result.stdout);
            }
        }
    } catch (err) {
        error(`Failed to orchestrate task: ${err.message}`);
    }
}
async function handleMonitor(ctx) {
    const duration = ctx.flags.duration || 30;
    const interval = ctx.flags.interval || 5;
    info(`Monitoring swarm for ${duration} seconds...`);
    try {
        const command = `npx ruv-swarm swarm monitor --duration ${duration} --interval ${interval}`;
        const result = await execAsync(command);
        if (result.stdout) {
            console.log(result.stdout);
        }
    } catch (err) {
        error(`Failed to monitor swarm: ${err.message}`);
    }
}
async function handleNeural(ctx) {
    if (ctx.args.length === 0) {
        console.log('Neural subcommands:');
        console.log('  status     - Get neural agent status');
        console.log('  train      - Train neural agents');
        console.log('  patterns   - View cognitive patterns');
        return;
    }
    const subcommand = ctx.args[0];
    try {
        switch(subcommand){
            case 'status':
                {
                    const agentId = ctx.flags.agentId || ctx.flags['agent-id'];
                    let command = 'npx ruv-swarm neural status';
                    if (agentId) {
                        command += ` --agent-id ${agentId}`;
                    }
                    const result = await execAsync(command);
                    if (result.stdout) {
                        console.log(result.stdout);
                    }
                    break;
                }
            case 'train':
                {
                    const agentId = ctx.flags.agentId || ctx.flags['agent-id'];
                    const iterations = ctx.flags.iterations || 10;
                    let command = `npx ruv-swarm neural train --iterations ${iterations}`;
                    if (agentId) {
                        command += ` --agent-id ${agentId}`;
                    }
                    info(`Training neural agents for ${iterations} iterations...`);
                    const result = await execAsync(command);
                    if (result.stdout) {
                        console.log(result.stdout);
                    }
                    break;
                }
            case 'patterns':
                {
                    const pattern = ctx.flags.pattern || 'all';
                    const command = `npx ruv-swarm neural patterns --pattern ${pattern}`;
                    const result = await execAsync(command);
                    if (result.stdout) {
                        console.log(result.stdout);
                    }
                    break;
                }
            default:
                error(`Unknown neural subcommand: ${subcommand}`);
                break;
        }
    } catch (err) {
        error(`Neural command failed: ${err.message}`);
    }
}
async function handleBenchmark(ctx) {
    const type = ctx.flags.type || 'all';
    const iterations = ctx.flags.iterations || 10;
    info(`Running ${type} benchmark with ${iterations} iterations...`);
    try {
        const command = `npx ruv-swarm benchmark run --type ${type} --iterations ${iterations}`;
        const result = await execAsync(command);
        if (result.stdout) {
            console.log(result.stdout);
        }
    } catch (err) {
        error(`Benchmark failed: ${err.message}`);
    }
}
async function handleConfig(ctx) {
    if (ctx.args.length === 0) {
        console.log('Config subcommands:');
        console.log('  show       - Show current configuration');
        console.log('  set        - Set configuration value');
        console.log('  reset      - Reset to defaults');
        console.log('  validate   - Validate configuration');
        return;
    }
    const subcommand = ctx.args[0];
    const configManager = getRuvSwarmConfigManager(logger);
    try {
        switch(subcommand){
            case 'show':
                {
                    const config = configManager.getConfig();
                    console.log('🔧 ruv-swarm Configuration:\
');
                    console.log(JSON.stringify(config, null, 2));
                    break;
                }
            case 'set':
                {
                    if (ctx.args.length < 3) {
                        error('Usage: config set <section>.<key> <value>');
                        console.log('Example: config set swarm.maxAgents 10');
                        return;
                    }
                    const path = ctx.args[1];
                    const value = ctx.args[2];
                    const [section, key] = path.split('.');
                    if (!section || !key) {
                        error('Invalid path format. Use: section.key');
                        return;
                    }
                    let parsedValue = value;
                    if (value === 'true') parsedValue = true;
                    else if (value === 'false') parsedValue = false;
                    else if (!isNaN(Number(value))) parsedValue = Number(value);
                    const updates = {
                        [section]: {
                            [key]: parsedValue
                        }
                    };
                    configManager.updateConfig(updates);
                    success(`Configuration updated: ${path} = ${value}`);
                    break;
                }
            case 'reset':
                {
                    configManager.resetConfig();
                    success('Configuration reset to defaults');
                    break;
                }
            case 'validate':
                {
                    const validation = configManager.validateConfig();
                    if (validation.valid) {
                        success('Configuration is valid');
                    } else {
                        error('Configuration validation failed:');
                        validation.errors.forEach((err)=>console.log(`  - ${err}`));
                    }
                    break;
                }
            default:
                error(`Unknown config subcommand: ${subcommand}`);
                break;
        }
    } catch (err) {
        error(`Config command failed: ${err.message}`);
    }
}
async function handleMemory(ctx) {
    const detail = ctx.flags.detail || 'summary';
    try {
        const command = `npx ruv-swarm memory usage --detail ${detail}`;
        const result = await execAsync(command);
        if (result.stdout) {
            try {
                const memoryData = JSON.parse(result.stdout);
                if (memoryData.success) {
                    console.log('💾 Memory Usage:\
');
                    const data = memoryData.data;
                    if (data.total !== undefined) {
                        console.log(`  Total Memory: ${formatBytes(data.total)}`);
                    }
                    if (data.used !== undefined) {
                        console.log(`  Used Memory: ${formatBytes(data.used)}`);
                    }
                    if (data.available !== undefined) {
                        console.log(`  Available: ${formatBytes(data.available)}`);
                    }
                    if (data.swarmUsage !== undefined) {
                        console.log(`  Swarm Usage: ${formatBytes(data.swarmUsage)}`);
                    }
                    if (detail === 'detailed' && data.breakdown) {
                        console.log('\
📊 Memory Breakdown:');
                        console.log(JSON.stringify(data.breakdown, null, 2));
                    }
                } else {
                    console.log(result.stdout);
                }
            } catch  {
                console.log(result.stdout);
            }
        }
    } catch (err) {
        error(`Failed to get memory usage: ${err.message}`);
    }
}
function formatBytes(bytes) {
    const sizes = [
        'B',
        'KB',
        'MB',
        'GB',
        'TB'
    ];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}
export default {
    ruvSwarmAction
};

//# sourceMappingURL=ruv-swarm.js.map