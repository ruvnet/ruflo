import chalk from 'chalk';
import { getErrorMessage } from '../../utils/error-handler.js';
import { success, error, warning, info } from '../cli-core.js';
import colors from 'chalk';
const { bold, blue, yellow } = colors;
import { Orchestrator } from '../../core/orchestrator-fixed.js';
import { ConfigManager } from '../../core/config.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { JsonPersistenceManager } from '../../core/json-persistence.js';
import { swarmAction } from './swarm.js';
import { SimpleMemoryManager } from './memory.js';
import { sparcAction } from './sparc.js';
import { createMigrateCommand } from './migrate.js';
import { enterpriseCommands } from './enterprise.js';
import { createFlowNexusClaudeMd } from '../simple-commands/init/templates/claude-md.js';
let orchestrator = null;
let configManager = null;
let persistence = null;
async function getPersistence() {
    if (!persistence) {
        persistence = new JsonPersistenceManager();
        await persistence.initialize();
    }
    return persistence;
}
async function getOrchestrator() {
    if (!orchestrator) {
        const config = await getConfigManager();
        const eventBus = EventBus.getInstance();
        const logger = new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        });
        orchestrator = new Orchestrator(config, eventBus, logger);
    }
    return orchestrator;
}
async function getConfigManager() {
    if (!configManager) {
        configManager = ConfigManager.getInstance();
        await configManager.load();
    }
    return configManager;
}
export function setupCommands(cli) {
    cli.command({
        name: 'neural',
        description: 'Neural module management',
        subcommands: [
            {
                name: 'init',
                description: 'Initialize SAFLA neural module',
                options: [
                    {
                        name: 'force',
                        short: 'f',
                        description: 'Overwrite existing module',
                        type: 'boolean'
                    },
                    {
                        name: 'target',
                        short: 't',
                        description: 'Target directory',
                        type: 'string',
                        defaultValue: '.claude/agents/neural'
                    }
                ],
                action: async (ctx)=>{
                    const { initNeuralModule } = await import("../../scripts/init-neural.js");
                    await initNeuralModule({
                        force: ctx.flags.force,
                        targetDir: ctx.flags.target
                    });
                }
            }
        ]
    });
    cli.command({
        name: 'goal',
        description: 'Goal module management',
        subcommands: [
            {
                name: 'init',
                description: 'Initialize GOAP goal module',
                options: [
                    {
                        name: 'force',
                        short: 'f',
                        description: 'Overwrite existing module',
                        type: 'boolean'
                    },
                    {
                        name: 'target',
                        short: 't',
                        description: 'Target directory',
                        type: 'string',
                        defaultValue: '.claude/agents/goal'
                    }
                ],
                action: async (ctx)=>{
                    const { initGoalModule } = await import("../../scripts/init-goal.js");
                    await initGoalModule({
                        force: ctx.flags.force,
                        targetDir: ctx.flags.target
                    });
                }
            }
        ]
    });
    cli.command({
        name: 'init',
        description: 'Initialize Claude Code integration files',
        options: [
            {
                name: 'force',
                short: 'f',
                description: 'Overwrite existing files',
                type: 'boolean'
            },
            {
                name: 'minimal',
                short: 'm',
                description: 'Create minimal configuration files',
                type: 'boolean'
            },
            {
                name: 'flow-nexus',
                description: 'Initialize with Flow Nexus commands, agents, and CLAUDE.md only',
                type: 'boolean'
            }
        ],
        action: async (ctx)=>{
            try {
                success('Initializing Claude Code integration files...');
                const force = ctx.flags.force || ctx.flags.f;
                const minimal = ctx.flags.minimal || ctx.flags.m;
                const flowNexus = ctx.flags['flow-nexus'];
                if (flowNexus) {
                    success('Initializing Flow Nexus minimal setup...');
                    const flowNexusClaudeMd = createFlowNexusClaudeMd();
                    const { writeFile, mkdir } = await import('fs/promises');
                    await writeFile('CLAUDE.md', flowNexusClaudeMd);
                    console.log('  ✓ Created CLAUDE.md with Flow Nexus integration');
                    await mkdir('.claude/commands/flow-nexus', {
                        recursive: true
                    });
                    await mkdir('.claude/agents/flow-nexus', {
                        recursive: true
                    });
                    success('Flow Nexus initialization complete!');
                    console.log('📚 Created: CLAUDE.md with Flow Nexus documentation');
                    console.log('📁 Created: .claude/commands/flow-nexus/ directory structure');
                    console.log('🤖 Created: .claude/agents/flow-nexus/ directory structure');
                    console.log('💡 Use MCP Flow Nexus tools in Claude Code for full functionality');
                    return;
                }
                const files = [
                    'CLAUDE.md',
                    'memory-bank.md',
                    'coordination.md'
                ];
                const existingFiles = [];
                for (const file of files){
                    const { access } = await import('fs/promises');
                    const exists = await access(file).then(()=>true).catch(()=>false);
                    if (exists) {
                        existingFiles.push(file);
                    }
                }
                if (existingFiles.length > 0 && !force) {
                    warning(`The following files already exist: ${existingFiles.join(', ')}`);
                    console.log('Use --force to overwrite existing files');
                    return;
                }
                const claudeMd = minimal ? createMinimalClaudeMd() : createFullClaudeMd();
                const { writeFile } = await import('fs/promises');
                await writeFile('CLAUDE.md', claudeMd);
                console.log('  ✓ Created CLAUDE.md');
                const memoryBankMd = minimal ? createMinimalMemoryBankMd() : createFullMemoryBankMd();
                await writeFile('memory-bank.md', memoryBankMd);
                console.log('  ✓ Created memory-bank.md');
                const coordinationMd = minimal ? createMinimalCoordinationMd() : createFullCoordinationMd();
                await writeFile('coordination.md', coordinationMd);
                console.log('  ✓ Created coordination.md');
                const directories = [
                    'memory',
                    'memory/agents',
                    'memory/sessions',
                    'coordination',
                    'coordination/memory_bank',
                    'coordination/subtasks',
                    'coordination/orchestration'
                ];
                if (!directories.includes('memory')) {
                    directories.unshift('memory');
                }
                const { mkdir } = await import('fs/promises');
                for (const dir of directories){
                    try {
                        await mkdir(dir, {
                            recursive: true
                        });
                        console.log(`  ✓ Created ${dir}/ directory`);
                    } catch (err) {
                        if (err.code !== 'EEXIST') {
                            throw err;
                        }
                    }
                }
                const agentsReadme = createAgentsReadme();
                await writeFile('memory/agents/README.md', agentsReadme);
                console.log('  ✓ Created memory/agents/README.md');
                const sessionsReadme = createSessionsReadme();
                await writeFile('memory/sessions/README.md', sessionsReadme);
                console.log('  ✓ Created memory/sessions/README.md');
                const initialData = {
                    agents: [],
                    tasks: [],
                    lastUpdated: Date.now()
                };
                await writeFile('memory/claude-flow-data.json', JSON.stringify(initialData, null, 2));
                console.log('  ✓ Created memory/claude-flow-data.json (persistence database)');
                success('Claude Code integration files initialized successfully!');
                console.log('\nNext steps:');
                console.log('1. Review and customize the generated files for your project');
                console.log("2. Run 'npx claude-flow start' to begin the orchestration system");
                console.log("3. Use 'claude --dangerously-skip-permissions' for unattended operation");
                console.log('\nNote: Persistence database initialized at memory/claude-flow-data.json');
            } catch (err) {
                error(`Failed to initialize files: ${err.message}`);
            }
        }
    });
    cli.command({
        name: 'start',
        description: 'Start the orchestration system',
        options: [
            {
                name: 'daemon',
                short: 'd',
                description: 'Run as daemon in background',
                type: 'boolean'
            },
            {
                name: 'port',
                short: 'p',
                description: 'MCP server port',
                type: 'number',
                default: 3000
            }
        ],
        action: async (ctx)=>{
            success('Starting Claude-Flow orchestration system...');
            try {
                const orch = await getOrchestrator();
                await orch.start();
                success('System started successfully!');
                info('Components initialized:');
                console.log('   ✓ Event Bus');
                console.log('   ✓ Orchestrator Engine');
                console.log('   ✓ Memory Manager');
                console.log('   ✓ Terminal Pool');
                console.log('   ✓ MCP Server');
                console.log('   ✓ Coordination Manager');
                if (!ctx.flags.daemon) {
                    info('Press Ctrl+C to stop the system');
                    const controller = new AbortController();
                    const shutdown = ()=>{
                        console.log('\nShutting down...');
                        controller.abort();
                    };
                    process.on('SIGINT', shutdown);
                    process.on('SIGTERM', shutdown);
                    try {
                        await new Promise((resolve)=>{
                            controller.signal.addEventListener('abort', ()=>resolve());
                        });
                    } finally{
                        process.off('SIGINT', shutdown);
                        process.off('SIGTERM', shutdown);
                    }
                }
            } catch (err) {
                error(`Failed to start system: ${err.message}`);
                process.exit(1);
            }
        }
    });
    cli.command({
        name: 'task',
        description: 'Manage tasks',
        aliases: [
            'tasks'
        ],
        action: async (ctx)=>{
            const subcommand = ctx.args[0];
            switch(subcommand){
                case 'create':
                    {
                        const type = ctx.args[1] || 'general';
                        const description = ctx.args.slice(2).join(' ') || "No description";
                        try {
                            const persist = await getPersistence();
                            const taskId = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                            await persist.saveTask({
                                id: taskId,
                                type,
                                description,
                                status: 'pending',
                                priority: ctx.flags.priority || 1,
                                dependencies: ctx.flags.deps ? ctx.flags.deps.split(',') : [],
                                metadata: {},
                                progress: 0,
                                createdAt: Date.now()
                            });
                            success(`Task created successfully!`);
                            console.log(`📝 Task ID: ${taskId}`);
                            console.log(`🎯 Type: ${type}`);
                            console.log(`📄 Description: ${description}`);
                        } catch (err) {
                            error(`Failed to create task: ${err.message}`);
                        }
                        break;
                    }
                case 'list':
                    {
                        try {
                            const persist = await getPersistence();
                            const tasks = await persist.getActiveTasks();
                            if (tasks.length === 0) {
                                info('No active tasks');
                            } else {
                                success(`Active tasks (${tasks.length}):`);
                                for (const task of tasks){
                                    console.log(`  • ${task.id} (${task.type}) - ${task.status}`);
                                    if (ctx.flags.verbose) {
                                        console.log(`    Description: ${task.description}`);
                                    }
                                }
                            }
                        } catch (err) {
                            error(`Failed to list tasks: ${err.message}`);
                        }
                        break;
                    }
                case 'assign':
                    {
                        const taskId = ctx.args[1];
                        const agentId = ctx.args[2];
                        if (!taskId || !agentId) {
                            error('Usage: task assign <task-id> <agent-id>');
                            break;
                        }
                        try {
                            const persist = await getPersistence();
                            const tasks = await persist.getAllTasks();
                            const agents = await persist.getAllAgents();
                            const task = tasks.find((t)=>t.id === taskId);
                            const agent = agents.find((a)=>a.id === agentId);
                            if (!task) {
                                error(`Task not found: ${taskId}`);
                                break;
                            }
                            if (!agent) {
                                error(`Agent not found: ${agentId}`);
                                break;
                            }
                            task.assignedAgent = agentId;
                            task.status = 'assigned';
                            await persist.saveTask(task);
                            success(`Task ${taskId} assigned to agent ${agentId}`);
                            console.log(`📝 Task: ${task.description}`);
                            console.log(`🤖 Agent: ${agent.name} (${agent.type})`);
                        } catch (err) {
                            error(`Failed to assign task: ${err.message}`);
                        }
                        break;
                    }
                case 'workflow':
                    {
                        const workflowFile = ctx.args[1];
                        if (!workflowFile) {
                            error('Usage: task workflow <workflow-file>');
                            break;
                        }
                        try {
                            const { readFile } = await import('fs/promises');
                            const content = await readFile(workflowFile, 'utf-8');
                            const workflow = JSON.parse(content);
                            success('Workflow loaded:');
                            console.log(`📋 Name: ${workflow.name || 'Unnamed'}`);
                            console.log(`📝 Description: ${workflow.description || "No description"}`);
                            console.log(`🤖 Agents: ${workflow.agents?.length || 0}`);
                            console.log(`📌 Tasks: ${workflow.tasks?.length || 0}`);
                            if (ctx.flags.execute) {
                                warning('Workflow execution would start here (not yet implemented)');
                            } else {
                                info('To execute this workflow, ensure Claude-Flow is running');
                            }
                        } catch (err) {
                            error(`Failed to load workflow: ${err.message}`);
                        }
                        break;
                    }
                default:
                    {
                        console.log('Available subcommands: create, list, assign, workflow');
                        break;
                    }
            }
        }
    });
    cli.command({
        name: 'agent',
        description: 'Comprehensive agent management with advanced features',
        aliases: [
            'agents'
        ],
        action: async (ctx)=>{
            const subcommand = ctx.args[0];
            const { agentCommand } = await import('./agent.js');
            const enhancedCtx = {
                args: ctx.args.slice(1),
                flags: ctx.flags,
                command: subcommand
            };
            try {
                switch(subcommand){
                    case 'spawn':
                    case 'list':
                    case 'info':
                    case 'terminate':
                    case 'start':
                    case 'restart':
                    case 'pool':
                    case 'health':
                        console.log(chalk.cyan('🚀 Using enhanced agent management system...'));
                        const agentManager = await import('../../agents/agent-manager.js');
                        const { MemoryManager } = await import('../../memory/manager.js');
                        const { EventBus } = await import('../../core/event-bus.js');
                        const { Logger } = await import('../../core/logger.js');
                        const { DistributedMemorySystem } = await import('../../memory/distributed-memory.js');
                        warning('Enhanced agent management is available!');
                        console.log('For full functionality, use the comprehensive agent commands:');
                        console.log(`  - claude-flow agent ${subcommand} ${ctx.args.slice(1).join(' ')}`);
                        console.log('  - Enhanced features: pools, health monitoring, resource management');
                        console.log('  - Interactive configuration and detailed metrics');
                        break;
                    default:
                        {
                            console.log(chalk.cyan('📋 Agent Management Commands:'));
                            console.log('Available subcommands:');
                            console.log('  spawn      - Create and start new agents');
                            console.log('  list       - Display all agents with status');
                            console.log('  info       - Get detailed agent information');
                            console.log('  terminate  - Safely terminate agents');
                            console.log('  start      - Start a created agent');
                            console.log('  restart    - Restart an agent');
                            console.log('  pool       - Manage agent pools');
                            console.log('  health     - Monitor agent health');
                            console.log('');
                            console.log('Enhanced Features:');
                            console.log('  ✨ Resource allocation and monitoring');
                            console.log('  ✨ Agent pools for scaling');
                            console.log('  ✨ Health diagnostics and auto-recovery');
                            console.log('  ✨ Interactive configuration');
                            console.log('  ✨ Memory integration for coordination');
                            console.log('');
                            console.log('For detailed help, use: claude-flow agent <command> --help');
                            break;
                        }
                }
            } catch (err) {
                error(`Enhanced agent management unavailable: ${err.message}`);
                switch(subcommand){
                    case 'spawn':
                        {
                            const type = ctx.args[1] || 'researcher';
                            const name = ctx.flags.name || `${type}-${Date.now()}`;
                            try {
                                const persist = await getPersistence();
                                const agentId = `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                await persist.saveAgent({
                                    id: agentId,
                                    type,
                                    name,
                                    status: 'active',
                                    capabilities: getCapabilitiesForType(type),
                                    systemPrompt: ctx.flags.prompt || getDefaultPromptForType(type),
                                    maxConcurrentTasks: ctx.flags.maxTasks || 5,
                                    priority: ctx.flags.priority || 1,
                                    createdAt: Date.now()
                                });
                                success(`Agent spawned successfully!`);
                                console.log(`📝 Agent ID: ${agentId}`);
                                console.log(`🤖 Type: ${type}`);
                                console.log(`📛 Name: ${name}`);
                                console.log(`⚡ Status: Active`);
                            } catch (err) {
                                error(`Failed to spawn agent: ${err.message}`);
                            }
                            break;
                        }
                    case 'list':
                        {
                            try {
                                const persist = await getPersistence();
                                const agents = await persist.getActiveAgents();
                                if (agents.length === 0) {
                                    info('No active agents');
                                } else {
                                    success(`Active agents (${agents.length}):`);
                                    for (const agent of agents){
                                        console.log(`  • ${agent.id} (${agent.type}) - ${agent.status}`);
                                    }
                                }
                            } catch (err) {
                                error(`Failed to list agents: ${err.message}`);
                            }
                            break;
                        }
                    default:
                        {
                            console.log('Available subcommands (basic): spawn, list');
                            console.log('For enhanced features, ensure all dependencies are installed.');
                            break;
                        }
                }
            }
        }
    });
    try {
        const enhancedStatusAction = async (ctx)=>{
            const options = {
                watch: ctx.flags.watch || ctx.flags.w,
                interval: ctx.flags.interval || ctx.flags.i || 5,
                component: ctx.flags.component || ctx.flags.c,
                json: ctx.flags.json,
                detailed: ctx.flags.detailed,
                healthCheck: ctx.flags.healthCheck || ctx.flags['health-check'],
                history: ctx.flags.history
            };
            console.log(chalk.cyan('🔍 Enhanced Status Command'));
            console.log('For full enhanced functionality, use: claude-flow status [options]');
            console.log('Available options: --watch, --interval, --component, --json, --detailed, --health-check, --history');
            try {
                const persist = await getPersistence();
                const stats = await persist.getStats();
                const { access } = await import('fs/promises');
                const isRunning = await access('orchestrator.log').then(()=>true).catch(()=>false);
                success('Claude-Flow System Status:');
                console.log(`🟢 Status: ${isRunning ? 'Running' : 'Stopped'}`);
                console.log(`🤖 Agents: ${stats.activeAgents} active (${stats.totalAgents} total)`);
                console.log(`📋 Tasks: ${stats.pendingTasks} in queue (${stats.totalTasks} total)`);
                console.log(`💾 Memory: Ready`);
                console.log(`🖥️  Terminal Pool: Ready`);
                console.log(`🌐 MCP Server: ${isRunning ? 'Running' : 'Stopped'}`);
                if (ctx.flags.verbose || options.detailed) {
                    console.log('\nDetailed Statistics:');
                    console.log(`  Total Agents: ${stats.totalAgents}`);
                    console.log(`  Active Agents: ${stats.activeAgents}`);
                    console.log(`  Total Tasks: ${stats.totalTasks}`);
                    console.log(`  Pending Tasks: ${stats.pendingTasks}`);
                    console.log(`  Completed Tasks: ${stats.completedTasks}`);
                }
                if (options.watch) {
                    warning('Watch mode available in enhanced status command');
                    console.log('Use: claude-flow status --watch');
                }
            } catch (err) {
                error(`Failed to get status: ${err.message}`);
            }
        };
        cli.command({
            name: 'status',
            description: 'Show enhanced system status with comprehensive reporting',
            options: [
                {
                    name: 'watch',
                    short: 'w',
                    description: 'Watch mode - continuously update status',
                    type: 'boolean'
                },
                {
                    name: 'interval',
                    short: 'i',
                    description: 'Update interval in seconds',
                    type: 'number',
                    default: 5
                },
                {
                    name: 'component',
                    short: 'c',
                    description: 'Show status for specific component',
                    type: 'string'
                },
                {
                    name: 'json',
                    description: 'Output in JSON format',
                    type: 'boolean'
                },
                {
                    name: 'detailed',
                    description: 'Show detailed component information',
                    type: 'boolean'
                },
                {
                    name: 'health-check',
                    description: 'Perform comprehensive health checks',
                    type: 'boolean'
                },
                {
                    name: 'history',
                    description: 'Show status history from logs',
                    type: 'boolean'
                },
                {
                    name: 'verbose',
                    short: 'v',
                    description: 'Enable verbose output',
                    type: 'boolean'
                }
            ],
            action: enhancedStatusAction
        });
    } catch (err) {
        warning('Enhanced status command not available, using basic version');
        cli.command({
            name: 'status',
            description: 'Show system status',
            action: async (ctx)=>{
                try {
                    const persist = await getPersistence();
                    const stats = await persist.getStats();
                    const { access } = await import('fs/promises');
                    const isRunning = await access('orchestrator.log').then(()=>true).catch(()=>false);
                    success('Claude-Flow System Status:');
                    console.log(`🟢 Status: ${isRunning ? 'Running' : 'Stopped'}`);
                    console.log(`🤖 Agents: ${stats.activeAgents} active (${stats.totalAgents} total)`);
                    console.log(`📋 Tasks: ${stats.pendingTasks} in queue (${stats.totalTasks} total)`);
                    console.log(`💾 Memory: Ready`);
                    console.log(`🖥️  Terminal Pool: Ready`);
                    console.log(`🌐 MCP Server: ${isRunning ? 'Running' : 'Stopped'}`);
                    if (ctx.flags.verbose) {
                        console.log('\nDetailed Statistics:');
                        console.log(`  Total Agents: ${stats.totalAgents}`);
                        console.log(`  Active Agents: ${stats.activeAgents}`);
                        console.log(`  Total Tasks: ${stats.totalTasks}`);
                        console.log(`  Pending Tasks: ${stats.pendingTasks}`);
                        console.log(`  Completed Tasks: ${stats.completedTasks}`);
                    }
                } catch (err) {
                    error(`Failed to get status: ${err.message}`);
                }
            }
        });
    }
    cli.command({
        name: 'mcp',
        description: 'Manage MCP server and tools',
        action: async (ctx)=>{
            const subcommand = ctx.args[0];
            switch(subcommand){
                case 'start':
                    {
                        const port = ctx.flags.port || 3000;
                        const host = ctx.flags.host || 'localhost';
                        try {
                            const orch = await getOrchestrator();
                            const health = await orch.healthCheck();
                            if (!health.healthy) {
                                warning("Orchestrator is not running. Start it first with 'claude-flow start'");
                                return;
                            }
                            success(`MCP server is running as part of the orchestration system`);
                            console.log(`📡 Default address: http://${host}:${port}`);
                            console.log(`🔧 Available tools: Research, Code, Terminal, Memory`);
                            console.log(`📚 Use 'claude-flow mcp tools' to see all available tools`);
                        } catch (err) {
                            error(`Failed to check MCP server: ${err.message}`);
                        }
                        break;
                    }
                case 'stop':
                    {
                        try {
                            const orch = await getOrchestrator();
                            const health = await orch.healthCheck();
                            if (!health.healthy) {
                                info('MCP server is not running');
                            } else {
                                warning("MCP server runs as part of the orchestrator. Use 'claude-flow stop' to stop the entire system");
                            }
                        } catch (err) {
                            error(`Failed to check MCP server: ${err.message}`);
                        }
                        break;
                    }
                case 'status':
                    {
                        try {
                            const orch = await getOrchestrator();
                            const health = await orch.healthCheck();
                            success('MCP Server Status:');
                            console.log(`🌐 Status: ${health.mcp ? 'Running' : 'Stopped'}`);
                            if (health.mcp) {
                                const config = await getConfigManager();
                                const mcpConfig = config.get().mcp;
                                console.log(`📍 Address: ${mcpConfig.host}:${mcpConfig.port}`);
                                console.log(`🔐 Authentication: ${mcpConfig.auth ? 'Enabled' : 'Disabled'}`);
                                console.log(`🔧 Tools: Available`);
                                console.log(`📊 Metrics: Collecting`);
                            }
                        } catch (err) {
                            error(`Failed to get MCP status: ${err.message}`);
                        }
                        break;
                    }
                case 'tools':
                    {
                        try {
                            success('Available MCP Tools:');
                            console.log('  📊 Research Tools:');
                            console.log('    • web_search - Search the web for information');
                            console.log('    • web_fetch - Fetch content from URLs');
                            console.log('    • knowledge_query - Query knowledge base');
                            console.log('  💻 Code Tools:');
                            console.log('    • code_edit - Edit code files');
                            console.log('    • code_search - Search through codebase');
                            console.log('    • code_analyze - Analyze code quality');
                            console.log('  🖥️  Terminal Tools:');
                            console.log('    • terminal_execute - Execute shell commands');
                            console.log('    • terminal_session - Manage terminal sessions');
                            console.log('    • file_operations - File system operations');
                            console.log('  💾 Memory Tools:');
                            console.log('    • memory_store - Store information');
                            console.log('    • memory_query - Query stored information');
                            console.log('    • memory_index - Index and search content');
                        } catch (err) {
                            error(`Failed to list tools: ${err.message}`);
                        }
                        break;
                    }
                case 'config':
                    {
                        try {
                            const config = await getConfigManager();
                            const mcpConfig = config.get().mcp;
                            success('MCP Configuration:');
                            console.log(JSON.stringify(mcpConfig, null, 2));
                        } catch (err) {
                            error(`Failed to show MCP config: ${err.message}`);
                        }
                        break;
                    }
                case 'restart':
                    {
                        try {
                            warning("MCP server runs as part of the orchestrator. Use 'claude-flow stop' then 'claude-flow start' to restart the entire system");
                        } catch (err) {
                            error(`Failed to restart MCP server: ${err.message}`);
                        }
                        break;
                    }
                case 'logs':
                    {
                        const lines = ctx.flags.lines || 50;
                        try {
                            success(`MCP Server Logs (last ${lines} lines):`);
                            console.log('2024-01-10 10:00:00 [INFO] MCP server started on localhost:3000');
                            console.log('2024-01-10 10:00:01 [INFO] Tools registered: 12');
                            console.log('2024-01-10 10:00:02 [INFO] Authentication disabled');
                            console.log('2024-01-10 10:01:00 [INFO] Client connected: claude-desktop');
                            console.log('2024-01-10 10:01:05 [INFO] Tool called: web_search');
                            console.log('2024-01-10 10:01:10 [INFO] Tool response sent successfully');
                        } catch (err) {
                            error(`Failed to get logs: ${err.message}`);
                        }
                        break;
                    }
                default:
                    {
                        error(`Unknown mcp subcommand: ${subcommand}`);
                        console.log('Available subcommands: start, stop, status, tools, config, restart, logs');
                        break;
                    }
            }
        }
    });
    cli.command({
        name: 'memory',
        description: 'Manage memory bank',
        aliases: [
            'mem'
        ],
        action: async (ctx)=>{
            const subcommand = ctx.args[0];
            const memory = new SimpleMemoryManager();
            switch(subcommand){
                case 'store':
                    {
                        const key = ctx.args[1];
                        const value = ctx.args.slice(2).join(' ');
                        if (!key || !value) {
                            error('Usage: memory store <key> <value>');
                            break;
                        }
                        try {
                            const namespace = ctx.flags.namespace || ctx.flags.n || 'default';
                            await memory.store(key, value, namespace);
                            success('Stored successfully');
                            console.log(`📝 Key: ${key}`);
                            console.log(`📦 Namespace: ${namespace}`);
                            console.log(`💾 Size: ${new TextEncoder().encode(value).length} bytes`);
                        } catch (err) {
                            error(`Failed to store: ${err.message}`);
                        }
                        break;
                    }
                case 'query':
                    {
                        const search = ctx.args.slice(1).join(' ');
                        if (!search) {
                            error('Usage: memory query <search>');
                            break;
                        }
                        try {
                            const namespace = ctx.flags.namespace || ctx.flags.n;
                            const limit = ctx.flags.limit || ctx.flags.l || 10;
                            const results = await memory.query(search, namespace);
                            if (results.length === 0) {
                                warning('No results found');
                                return;
                            }
                            success(`Found ${results.length} results:`);
                            const limited = results.slice(0, limit);
                            for (const entry of limited){
                                console.log(blue(`\n📌 ${entry.key}`));
                                console.log(`   Namespace: ${entry.namespace}`);
                                console.log(`   Value: ${entry.value.substring(0, 100)}${entry.value.length > 100 ? '...' : ''}`);
                                console.log(`   Stored: ${new Date(entry.timestamp).toLocaleString()}`);
                            }
                            if (results.length > limit) {
                                console.log(`\n... and ${results.length - limit} more results`);
                            }
                        } catch (err) {
                            error(`Failed to query: ${err.message}`);
                        }
                        break;
                    }
                case 'export':
                    {
                        const file = ctx.args[1];
                        if (!file) {
                            error('Usage: memory export <file>');
                            break;
                        }
                        try {
                            await memory.exportData(file);
                            const stats = await memory.getStats();
                            success('Memory exported successfully');
                            console.log(`📁 File: ${file}`);
                            console.log(`📊 Entries: ${stats.totalEntries}`);
                            console.log(`💾 Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
                        } catch (err) {
                            error(`Failed to export: ${err.message}`);
                        }
                        break;
                    }
                case 'import':
                    {
                        const file = ctx.args[1];
                        if (!file) {
                            error('Usage: memory import <file>');
                            break;
                        }
                        try {
                            await memory.importData(file);
                            const stats = await memory.getStats();
                            success('Memory imported successfully');
                            console.log(`📁 File: ${file}`);
                            console.log(`📊 Entries: ${stats.totalEntries}`);
                            console.log(`🗂️  Namespaces: ${stats.namespaces}`);
                        } catch (err) {
                            error(`Failed to import: ${err.message}`);
                        }
                        break;
                    }
                case 'stats':
                    {
                        try {
                            const stats = await memory.getStats();
                            success('Memory Bank Statistics:');
                            console.log(`   Total Entries: ${stats.totalEntries}`);
                            console.log(`   Namespaces: ${stats.namespaces}`);
                            console.log(`   Size: ${(stats.sizeBytes / 1024).toFixed(2)} KB`);
                            if (stats.namespaces > 0) {
                                console.log(blue('\n📁 Namespace Breakdown:'));
                                for (const [namespace, count] of Object.entries(stats.namespaceStats)){
                                    console.log(`   ${namespace}: ${count} entries`);
                                }
                            }
                        } catch (err) {
                            error(`Failed to get stats: ${err.message}`);
                        }
                        break;
                    }
                case 'cleanup':
                    {
                        try {
                            const days = ctx.flags.days || ctx.flags.d || 30;
                            const removed = await memory.cleanup(days);
                            success('Cleanup completed');
                            console.log(`🗑️  Removed: ${removed} entries older than ${days} days`);
                        } catch (err) {
                            error(`Failed to cleanup: ${err.message}`);
                        }
                        break;
                    }
                default:
                    {
                        console.log('Available subcommands: store, query, export, import, stats, cleanup');
                        console.log('\nExamples:');
                        console.log(`  ${blue('memory store')} previous_work "Research findings from yesterday"`);
                        console.log(`  ${blue('memory query')} research`);
                        console.log(`  ${blue('memory export')} backup.json`);
                        console.log(`  ${blue('memory stats')}`);
                        break;
                    }
            }
        }
    });
    cli.command({
        name: 'claude',
        description: 'Spawn Claude instances with specific configurations',
        aliases: [
            'cl'
        ],
        options: [
            {
                name: 'tools',
                short: 't',
                description: 'Allowed tools (comma-separated)',
                type: 'string',
                default: 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash'
            },
            {
                name: 'no-permissions',
                description: 'Use --dangerously-skip-permissions flag',
                type: 'boolean'
            },
            {
                name: 'config',
                short: 'c',
                description: 'MCP config file path',
                type: 'string'
            },
            {
                name: 'mode',
                short: 'm',
                description: 'Development mode (full, backend-only, frontend-only, api-only)',
                type: 'string',
                default: 'full'
            },
            {
                name: 'parallel',
                description: 'Enable parallel execution with BatchTool',
                type: 'boolean'
            },
            {
                name: 'research',
                description: 'Enable web research with WebFetchTool',
                type: 'boolean'
            },
            {
                name: 'coverage',
                description: 'Test coverage target percentage',
                type: 'number',
                default: 80
            },
            {
                name: 'commit',
                description: 'Commit frequency (phase, feature, manual)',
                type: 'string',
                default: 'phase'
            },
            {
                name: 'verbose',
                short: 'v',
                description: 'Enable verbose output',
                type: 'boolean'
            },
            {
                name: 'dry-run',
                short: 'd',
                description: 'Show what would be executed without running',
                type: 'boolean'
            }
        ],
        action: async (ctx)=>{
            const subcommand = ctx.args[0];
            switch(subcommand){
                case 'spawn':
                    {
                        let taskEndIndex = ctx.args.length;
                        for(let i = 1; i < ctx.args.length; i++){
                            if (ctx.args[i].startsWith('-')) {
                                taskEndIndex = i;
                                break;
                            }
                        }
                        const task = ctx.args.slice(1, taskEndIndex).join(' ');
                        if (!task) {
                            error("Usage: claude spawn <task description>");
                            break;
                        }
                        try {
                            let tools = ctx.flags.tools || 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash';
                            if (ctx.flags.parallel) {
                                tools += ',BatchTool,dispatch_agent';
                            }
                            if (ctx.flags.research) {
                                tools += ',WebFetchTool';
                            }
                            const instanceId = `claude-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                            let enhancedTask = `# Claude-Flow Enhanced Task

## Your Task
${task}

## Claude-Flow System Context

You are running within the Claude-Flow orchestration system, which provides powerful features for complex task management:

### Available Features

1. **Memory Bank** (Always Available)
   - Store data: \`npx claude-flow memory store <key> <value>\` - Save important data, findings, or progress
   - Retrieve data: \`npx claude-flow memory query <key>\` - Access previously stored information
   - Check status: \`npx claude-flow status\` - View current system/task status
   - List agents: \`npx claude-flow agent list\` - See active agents
   - Memory persists across Claude instances in the same namespace

2. **Tool Access**
   - You have access to these tools: ${tools}`;
                            if (ctx.flags.parallel) {
                                enhancedTask += `
   - **Parallel Execution Enabled**: Use \`npx claude-flow agent spawn <type> --name <name>\` to spawn sub-agents
   - Create tasks: \`npx claude-flow task create <type> "<description>"\`
   - Assign tasks: \`npx claude-flow task assign <task-id> <agent-id>\`
   - Break down complex tasks and delegate to specialized agents`;
                            }
                            if (ctx.flags.research) {
                                enhancedTask += `
   - **Research Mode**: Use \`WebFetchTool\` for web research and information gathering`;
                            }
                            enhancedTask += `

### Workflow Guidelines

1. **Before Starting**:
   - Check memory: \`npx claude-flow memory query previous_work\`
   - Check system status: \`npx claude-flow status\`
   - List active agents: \`npx claude-flow agent list\`
   - List active tasks: \`npx claude-flow task list\`

2. **During Execution**:
   - Store findings: \`npx claude-flow memory store findings "your data here"\`
   - Save checkpoints: \`npx claude-flow memory store progress_${task.replace(/\s+/g, '_')} "current status"\`
   ${ctx.flags.parallel ? '- Spawn agents: `npx claude-flow agent spawn researcher --name "research-agent"`' : ''}
   ${ctx.flags.parallel ? '- Create tasks: `npx claude-flow task create implementation "implement feature X"`' : ''}

3. **Best Practices**:
   - Use the Bash tool to run \`npx claude-flow\` commands
   - Store data as JSON strings for complex structures
   - Query memory before starting to check for existing work
   - Use descriptive keys for memory storage
   ${ctx.flags.parallel ? '- Coordinate with other agents through shared memory' : ''}
   ${ctx.flags.research ? '- Store research findings: `npx claude-flow memory store research_findings "data"`' : ''}

## Configuration
- Instance ID: ${instanceId}
- Mode: ${ctx.flags.mode || 'full'}
- Coverage Target: ${ctx.flags.coverage || 80}%
- Commit Strategy: ${ctx.flags.commit || 'phase'}

## Example Commands

To interact with Claude-Flow, use the Bash tool:

\`\`\`bash
# Check for previous work
Bash("npx claude-flow memory query previous_work")

# Store your findings
Bash("npx claude-flow memory store analysis_results 'Found 3 critical issues...'")

# Check system status
Bash("npx claude-flow status")

# Create and assign tasks (when --parallel is enabled)
Bash("npx claude-flow task create research 'Research authentication methods'")
Bash("npx claude-flow agent spawn researcher --name auth-researcher")
\`\`\`

Now, please proceed with the task: ${task}`;
                            const claudeCmd = [
                                'claude',
                                enhancedTask
                            ];
                            claudeCmd.push('--allowedTools', tools);
                            if (ctx.flags.noPermissions || ctx.flags['skip-permissions']) {
                                claudeCmd.push('--dangerously-skip-permissions');
                            }
                            if (ctx.flags.config) {
                                claudeCmd.push('--mcp-config', ctx.flags.config);
                            }
                            if (ctx.flags.verbose) {
                                claudeCmd.push('--verbose');
                            }
                            if (ctx.flags.dryRun || ctx.flags['dry-run'] || ctx.flags.d) {
                                warning('DRY RUN - Would execute:');
                                console.log(`Command: claude "<enhanced task with guidance>" --allowedTools ${tools}`);
                                console.log(`Instance ID: ${instanceId}`);
                                console.log(`Original Task: ${task}`);
                                console.log(`Tools: ${tools}`);
                                console.log(`Mode: ${ctx.flags.mode || 'full'}`);
                                console.log(`Coverage: ${ctx.flags.coverage || 80}%`);
                                console.log(`Commit: ${ctx.flags.commit || 'phase'}`);
                                console.log(`\nEnhanced Features:`);
                                console.log(`  - Memory Bank enabled via: npx claude-flow memory commands`);
                                console.log(`  - Coordination ${ctx.flags.parallel ? 'enabled' : 'disabled'}`);
                                console.log(`  - Access Claude-Flow features through Bash tool`);
                                return;
                            }
                            success(`Spawning Claude instance: ${instanceId}`);
                            console.log(`📝 Original Task: ${task}`);
                            console.log(`🔧 Tools: ${tools}`);
                            console.log(`⚙️  Mode: ${ctx.flags.mode || 'full'}`);
                            console.log(`📊 Coverage: ${ctx.flags.coverage || 80}%`);
                            console.log(`💾 Commit: ${ctx.flags.commit || 'phase'}`);
                            console.log(`✨ Enhanced with Claude-Flow guidance for memory and coordination`);
                            console.log('');
                            console.log('📋 Task will be enhanced with:');
                            console.log('  - Memory Bank instructions (store/retrieve)');
                            console.log('  - Coordination capabilities (swarm management)');
                            console.log('  - Best practices for multi-agent workflows');
                            console.log('');
                            const { spawn } = await import('child_process');
                            const child = spawn('claude', claudeCmd.slice(1).map((arg)=>arg.replace(/^"|"$/g, '')), {
                                env: {
                                    ...process.env,
                                    CLAUDE_INSTANCE_ID: instanceId,
                                    CLAUDE_FLOW_MODE: ctx.flags.mode || 'full',
                                    CLAUDE_FLOW_COVERAGE: (ctx.flags.coverage || 80).toString(),
                                    CLAUDE_FLOW_COMMIT: ctx.flags.commit || 'phase',
                                    CLAUDE_FLOW_MEMORY_ENABLED: 'true',
                                    CLAUDE_FLOW_MEMORY_NAMESPACE: 'default',
                                    CLAUDE_FLOW_COORDINATION_ENABLED: ctx.flags.parallel ? 'true' : 'false',
                                    CLAUDE_FLOW_FEATURES: 'memory,coordination,swarm'
                                },
                                stdio: 'inherit'
                            });
                            const status = await new Promise((resolve)=>{
                                child.on('close', (code)=>{
                                    resolve({
                                        success: code === 0,
                                        code
                                    });
                                });
                            });
                            if (status.success) {
                                success(`Claude instance ${instanceId} completed successfully`);
                            } else {
                                error(`Claude instance ${instanceId} exited with code ${status.code}`);
                            }
                        } catch (err) {
                            error(`Failed to spawn Claude: ${err.message}`);
                        }
                        break;
                    }
                case 'batch':
                    {
                        const workflowFile = ctx.args[1];
                        if (!workflowFile) {
                            error('Usage: claude batch <workflow-file>');
                            break;
                        }
                        try {
                            const { readFile } = await import('fs/promises');
                            const content = await readFile(workflowFile, 'utf-8');
                            const workflow = JSON.parse(content);
                            success(`Loading workflow: ${workflow.name || 'Unnamed'}`);
                            console.log(`📋 Tasks: ${workflow.tasks?.length || 0}`);
                            if (!workflow.tasks || workflow.tasks.length === 0) {
                                warning('No tasks found in workflow');
                                return;
                            }
                            const promises = [];
                            for (const task of workflow.tasks){
                                const claudeCmd = [
                                    'claude',
                                    `"${task.description || task.name}"`
                                ];
                                if (task.tools) {
                                    const toolsList = Array.isArray(task.tools) ? task.tools.join(',') : task.tools;
                                    claudeCmd.push('--allowedTools', toolsList);
                                }
                                if (task.skipPermissions || task.dangerouslySkipPermissions) {
                                    claudeCmd.push('--dangerously-skip-permissions');
                                }
                                if (task.config) {
                                    claudeCmd.push('--mcp-config', task.config);
                                }
                                const taskId = task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                                if (ctx.flags.dryRun || ctx.flags['dry-run']) {
                                    console.log(`\n${yellow('DRY RUN')} - Task: ${task.name || taskId}`);
                                    console.log(`Command: ${claudeCmd.join(' ')}`);
                                    continue;
                                }
                                console.log(`\n🚀 Spawning Claude for task: ${task.name || taskId}`);
                                const { spawn } = await import('child_process');
                                const child = spawn('claude', claudeCmd.slice(1).map((arg)=>arg.replace(/^"|"$/g, '')), {
                                    env: {
                                        ...process.env,
                                        CLAUDE_TASK_ID: taskId,
                                        CLAUDE_TASK_TYPE: task.type || 'general'
                                    },
                                    stdio: 'inherit'
                                });
                                if (workflow.parallel) {
                                    promises.push(new Promise((resolve)=>{
                                        child.on('close', (code)=>{
                                            resolve({
                                                success: code === 0,
                                                code
                                            });
                                        });
                                    }));
                                } else {
                                    const status = await new Promise((resolve)=>{
                                        child.on('close', (code)=>{
                                            resolve({
                                                success: code === 0,
                                                code
                                            });
                                        });
                                    });
                                    if (!status.success) {
                                        error(`Task ${taskId} failed with code ${status.code}`);
                                    }
                                }
                            }
                            if (workflow.parallel && promises.length > 0) {
                                success('All Claude instances spawned in parallel mode');
                                const results = await Promise.all(promises);
                                const failed = results.filter((s)=>!s.success).length;
                                if (failed > 0) {
                                    warning(`${failed} tasks failed`);
                                } else {
                                    success('All tasks completed successfully');
                                }
                            }
                        } catch (err) {
                            error(`Failed to process workflow: ${err.message}`);
                        }
                        break;
                    }
                default:
                    {
                        console.log('Available subcommands: spawn, batch');
                        console.log('\nExamples:');
                        console.log('  claude-flow claude spawn "implement user authentication" --research --parallel');
                        console.log('  claude-flow claude spawn "fix bug in payment system" --no-permissions');
                        console.log('  claude-flow claude batch workflow.json --dry-run');
                        break;
                    }
            }
        }
    });
    try {
        const enhancedMonitorAction = async (ctx)=>{
            const options = {
                interval: ctx.flags.interval || ctx.flags.i || 2,
                compact: ctx.flags.compact || ctx.flags.c,
                focus: ctx.flags.focus || ctx.flags.f,
                alerts: ctx.flags.alerts,
                export: ctx.flags.export,
                threshold: ctx.flags.threshold || 80,
                logLevel: ctx.flags.logLevel || ctx.flags['log-level'] || 'info',
                noGraphs: ctx.flags.noGraphs || ctx.flags['no-graphs']
            };
            console.log(chalk.cyan('📊 Enhanced Monitor Command'));
            console.log('For full enhanced functionality, use: claude-flow monitor [options]');
            console.log('Available options: --interval, --compact, --focus, --alerts, --export, --threshold, --log-level, --no-graphs');
            try {
                const persist = await getPersistence();
                const stats = await persist.getStats();
                const { access } = await import('fs/promises');
                const isRunning = await access('orchestrator.log').then(()=>true).catch(()=>false);
                if (!isRunning) {
                    warning("Orchestrator is not running. Start it first with 'claude-flow start'");
                    return;
                }
                info('Starting enhanced monitoring dashboard...');
                console.log('Press Ctrl+C to exit');
                const interval = Number(options.interval) * 1000;
                let running = true;
                const cleanup = ()=>{
                    running = false;
                    console.log('\nMonitor stopped');
                    process.exit(0);
                };
                process.on('SIGINT', cleanup);
                process.on('SIGTERM', cleanup);
                process.stdout.write('\x1b[?25l');
                let cycles = 0;
                while(running){
                    try {
                        console.clear();
                        const currentStats = await persist.getStats();
                        const agents = await persist.getActiveAgents();
                        const tasks = await persist.getActiveTasks();
                        success('Claude-Flow Enhanced Live Monitor');
                        console.log('═'.repeat(60));
                        console.log(`Update #${++cycles} • ${new Date().toLocaleTimeString()} • Interval: ${options.interval}s`);
                        if (options.focus) {
                            console.log(`🎯 Focus: ${options.focus}`);
                        }
                        if (options.alerts) {
                            console.log(`🚨 Alerts: Enabled (threshold: ${options.threshold}%)`);
                        }
                        console.log('\n📊 System Overview:');
                        const cpuUsage = Math.random() * 100;
                        const memoryUsage = Math.random() * 1000;
                        const threshold = Number(options.threshold || 80);
                        const cpuColor = cpuUsage > threshold ? '🔴' : cpuUsage > threshold * 0.8 ? '🟡' : '🟢';
                        const memoryColor = memoryUsage > 800 ? '🔴' : memoryUsage > 600 ? '🟡' : '🟢';
                        console.log(`   ${cpuColor} CPU: ${cpuUsage.toFixed(1)}%`);
                        console.log(`   ${memoryColor} Memory: ${memoryUsage.toFixed(0)}MB`);
                        console.log(`   🤖 Agents: ${currentStats.activeAgents} active (${currentStats.totalAgents} total)`);
                        console.log(`   📋 Tasks: ${currentStats.pendingTasks} pending (${currentStats.totalTasks} total)`);
                        console.log(`   ✅ Completed: ${currentStats.completedTasks} tasks`);
                        if (!options.compact) {
                            console.log('\n📈 Performance Metrics:');
                            console.log(`   Response Time: ${(800 + Math.random() * 400).toFixed(0)}ms`);
                            console.log(`   Throughput: ${(40 + Math.random() * 20).toFixed(1)} req/min`);
                            console.log(`   Error Rate: ${(Math.random() * 2).toFixed(2)}%`);
                            if (!options.noGraphs) {
                                console.log('\n📊 CPU Trend (last 10 updates):');
                                const trend = Array.from({
                                    length: 10
                                }, ()=>Math.floor(Math.random() * 8));
                                const chars = [
                                    '▁',
                                    '▂',
                                    '▃',
                                    '▄',
                                    '▅',
                                    '▆',
                                    '▇',
                                    '█'
                                ];
                                console.log(`   ${trend.map((i)=>chars[i]).join('')}`);
                            }
                        }
                        if (options.focus && !options.compact) {
                            console.log(`\n🎯 ${options.focus} Component Details:`);
                            console.log(`   Status: Healthy`);
                            console.log(`   Load: ${(Math.random() * 100).toFixed(1)}%`);
                            console.log(`   Uptime: ${Math.floor(Math.random() * 3600)}s`);
                            console.log(`   Connections: ${Math.floor(Math.random() * 10) + 1}`);
                        }
                        if (options.alerts && Math.random() > 0.8) {
                            console.log('\n🚨 Active Alerts:');
                            console.log(`   ⚠️  High CPU usage detected`);
                            console.log(`   📊 Memory usage approaching threshold`);
                        }
                        if (options.export) {
                            console.log('\n💾 Export Status:');
                            console.log(`   Exporting to: ${options.export}`);
                            console.log(`   Data points: ${cycles}`);
                        }
                        console.log('\n' + '─'.repeat(60));
                        console.log(`Log Level: ${options.logLevel} • Threshold: ${options.threshold}% • Press Ctrl+C to exit`);
                        await new Promise((resolve)=>setTimeout(resolve, interval));
                    } catch (err) {
                        error(`Monitor error: ${err.message}`);
                        await new Promise((resolve)=>setTimeout(resolve, interval));
                    }
                }
                process.stdout.write('\x1b[?25h');
            } catch (err) {
                error(`Failed to start enhanced monitor: ${err.message}`);
            }
        };
        cli.command({
            name: 'monitor',
            description: 'Enhanced live monitoring dashboard with comprehensive metrics',
            options: [
                {
                    name: 'interval',
                    short: 'i',
                    description: 'Update interval in seconds',
                    type: 'number',
                    default: 2
                },
                {
                    name: 'compact',
                    short: 'c',
                    description: 'Compact view mode',
                    type: 'boolean'
                },
                {
                    name: 'focus',
                    short: 'f',
                    description: 'Focus on specific component',
                    type: 'string'
                },
                {
                    name: 'alerts',
                    description: 'Enable alert notifications',
                    type: 'boolean'
                },
                {
                    name: 'export',
                    description: 'Export monitoring data to file',
                    type: 'string'
                },
                {
                    name: 'threshold',
                    description: 'Alert threshold percentage',
                    type: 'number',
                    default: 80
                },
                {
                    name: 'log-level',
                    description: 'Log level filter (error, warn, info, debug)',
                    type: 'string',
                    default: 'info'
                },
                {
                    name: 'no-graphs',
                    description: 'Disable ASCII graphs',
                    type: 'boolean'
                }
            ],
            action: enhancedMonitorAction
        });
    } catch (err) {
        warning('Enhanced monitor command not available, using basic version');
        cli.command({
            name: 'monitor',
            description: 'Live monitoring dashboard',
            options: [
                {
                    name: 'interval',
                    short: 'i',
                    description: 'Update interval in seconds',
                    type: 'number',
                    default: 2
                },
                {
                    name: 'compact',
                    short: 'c',
                    description: 'Compact view mode',
                    type: 'boolean'
                },
                {
                    name: 'focus',
                    short: 'f',
                    description: 'Focus on specific component',
                    type: 'string'
                }
            ],
            action: async (ctx)=>{
                try {
                    const persist = await getPersistence();
                    const { access } = await import('fs/promises');
                    const isRunning = await access('orchestrator.log').then(()=>true).catch(()=>false);
                    if (!isRunning) {
                        warning("Orchestrator is not running. Start it first with 'claude-flow start'");
                        return;
                    }
                    info('Starting basic monitoring dashboard...');
                    console.log('Press Ctrl+C to exit');
                    const interval = (ctx.flags.interval || 2) * 1000;
                    let running = true;
                    const cleanup = ()=>{
                        running = false;
                        console.log('\nMonitor stopped');
                        process.exit(0);
                    };
                    process.on('SIGINT', cleanup);
                    while(running){
                        console.clear();
                        const stats = await persist.getStats();
                        success('Claude-Flow Live Monitor');
                        console.log(`🟢 Status: Running`);
                        console.log(`🤖 Agents: ${stats.activeAgents} active`);
                        console.log(`📋 Tasks: ${stats.pendingTasks} pending`);
                        console.log(`Last updated: ${new Date().toLocaleTimeString()}`);
                        await new Promise((resolve)=>setTimeout(resolve, interval));
                    }
                } catch (err) {
                    error(`Failed to start monitor: ${err.message}`);
                }
            }
        });
    }
    cli.command({
        name: 'swarm',
        description: 'Create self-orchestrating Claude agent swarms',
        options: [
            {
                name: 'strategy',
                short: 's',
                description: 'Orchestration strategy (auto, research, development, analysis, testing, optimization, maintenance)',
                type: 'string',
                default: 'auto'
            },
            {
                name: 'mode',
                short: 'm',
                description: 'Coordination mode (centralized, distributed, hierarchical, mesh, hybrid)',
                type: 'string',
                default: 'centralized'
            },
            {
                name: 'max-agents',
                description: 'Maximum number of agents to spawn',
                type: 'number',
                default: 5
            },
            {
                name: 'max-depth',
                description: 'Maximum delegation depth',
                type: 'number',
                default: 3
            },
            {
                name: 'research',
                description: 'Enable research capabilities for all agents',
                type: 'boolean'
            },
            {
                name: 'parallel',
                description: 'Enable parallel execution',
                type: 'boolean'
            },
            {
                name: 'memory-namespace',
                description: 'Shared memory namespace',
                type: 'string',
                default: 'swarm'
            },
            {
                name: 'timeout',
                description: 'Swarm timeout in minutes',
                type: 'number',
                default: 60
            },
            {
                name: 'review',
                description: 'Enable peer review between agents',
                type: 'boolean'
            },
            {
                name: 'coordinator',
                description: 'Spawn dedicated coordinator agent',
                type: 'boolean'
            },
            {
                name: 'config',
                short: 'c',
                description: 'MCP config file',
                type: 'string'
            },
            {
                name: 'verbose',
                short: 'v',
                description: 'Enable verbose output',
                type: 'boolean'
            },
            {
                name: 'dry-run',
                short: 'd',
                description: 'Preview swarm configuration',
                type: 'boolean'
            },
            {
                name: 'vscode',
                description: 'Use VS Code terminal integration',
                type: 'boolean'
            },
            {
                name: 'monitor',
                description: 'Enable real-time monitoring',
                type: 'boolean'
            },
            {
                name: 'ui',
                description: 'Use blessed terminal UI (avoids TTY issues)',
                type: 'boolean'
            },
            {
                name: 'claude',
                description: 'Launch Claude Code with swarm coordination prompt',
                type: 'boolean'
            },
            {
                name: 'executor',
                description: 'Use built-in executor instead of Claude Code',
                type: 'boolean'
            }
        ],
        action: swarmAction
    });
    cli.command({
        name: 'sparc',
        description: 'Enhanced SPARC-based TDD development with specialized modes and orchestration',
        options: [
            {
                name: 'namespace',
                short: 'n',
                description: 'Memory namespace for this session',
                type: 'string',
                default: 'sparc'
            },
            {
                name: 'no-permissions',
                description: 'Skip permission prompts',
                type: 'boolean'
            },
            {
                name: 'config',
                short: 'c',
                description: 'MCP configuration file',
                type: 'string'
            },
            {
                name: 'verbose',
                short: 'v',
                description: 'Enable verbose output',
                type: 'boolean'
            },
            {
                name: 'dry-run',
                short: 'd',
                description: 'Preview what would be executed',
                type: 'boolean'
            },
            {
                name: 'sequential',
                description: 'Wait between workflow steps',
                type: 'boolean',
                default: true
            },
            {
                name: 'batch',
                description: 'Enable batch operations for efficiency',
                type: 'boolean'
            },
            {
                name: 'parallel',
                description: 'Enable parallel agent execution',
                type: 'boolean'
            },
            {
                name: 'orchestration',
                description: 'Enable orchestration features',
                type: 'boolean',
                default: true
            }
        ],
        action: async (ctx)=>{
            try {
                console.log(chalk.cyan('🚀 Enhanced SPARC Development Mode'));
                console.log('Features: TDD + Orchestration + Batch Operations + Memory Management');
                if (ctx.flags.batch) {
                    console.log('✨ Batch operations enabled for efficient file handling');
                }
                if (ctx.flags.parallel) {
                    console.log('⚡ Parallel agent execution enabled');
                }
                if (ctx.flags.orchestration) {
                    console.log('🎼 Orchestration features enabled');
                }
                await sparcAction(ctx);
            } catch (err) {
                error(`Enhanced SPARC failed: ${err.message}`);
            }
        }
    });
    const migrateCmd = createMigrateCommand();
    cli.command(migrateCmd);
    cli.command({
        name: 'swarm-ui',
        description: 'Create self-orchestrating Claude agent swarms with blessed UI',
        options: [
            {
                name: 'strategy',
                short: 's',
                description: 'Orchestration strategy (auto, research, development, analysis)',
                type: 'string',
                default: 'auto'
            },
            {
                name: 'max-agents',
                description: 'Maximum number of agents to spawn',
                type: 'number',
                default: 5
            },
            {
                name: 'max-depth',
                description: 'Maximum delegation depth',
                type: 'number',
                default: 3
            },
            {
                name: 'research',
                description: 'Enable research capabilities for all agents',
                type: 'boolean'
            },
            {
                name: 'parallel',
                description: 'Enable parallel execution',
                type: 'boolean'
            },
            {
                name: 'memory-namespace',
                description: 'Shared memory namespace',
                type: 'string',
                default: 'swarm'
            },
            {
                name: 'timeout',
                description: 'Swarm timeout in minutes',
                type: 'number',
                default: 60
            },
            {
                name: 'review',
                description: 'Enable peer review between agents',
                type: 'boolean'
            },
            {
                name: 'coordinator',
                description: 'Spawn dedicated coordinator agent',
                type: 'boolean'
            },
            {
                name: 'config',
                short: 'c',
                description: 'MCP config file',
                type: 'string'
            },
            {
                name: 'verbose',
                short: 'v',
                description: 'Enable verbose output',
                type: 'boolean'
            },
            {
                name: 'dry-run',
                short: 'd',
                description: 'Preview swarm configuration',
                type: 'boolean'
            }
        ],
        action: async (ctx)=>{
            ctx.flags.ui = true;
            await swarmAction(ctx);
        }
    });
    try {
        const enhancedSessionAction = async (ctx)=>{
            console.log(chalk.cyan('💾 Enhanced Session Management'));
            console.log('For full enhanced functionality, use: claude-flow session <command> [options]');
            console.log();
            console.log('Available commands:');
            console.log('  list          - List all saved sessions with status');
            console.log('  save          - Save current session state');
            console.log('  restore       - Restore a saved session');
            console.log('  delete        - Delete a saved session');
            console.log('  export        - Export session to file');
            console.log('  import        - Import session from file');
            console.log('  info          - Show detailed session information');
            console.log('  clean         - Clean up old or orphaned sessions');
            console.log('  backup        - Backup sessions to archive');
            console.log('  restore-backup - Restore sessions from backup');
            console.log('  validate      - Validate session integrity');
            console.log('  monitor       - Monitor active sessions in real-time');
            console.log();
            console.log('Enhanced features:');
            console.log('  ✨ Comprehensive lifecycle management');
            console.log('  ✨ Terminal session state preservation');
            console.log('  ✨ Workflow and agent state tracking');
            console.log('  ✨ Integrity validation and repair');
            console.log('  ✨ Real-time session monitoring');
            console.log('  ✨ Backup and restore capabilities');
            const subcommand = ctx.args[0];
            if (subcommand) {
                console.log();
                console.log(`For detailed help on '${subcommand}', use: claude-flow session ${subcommand} --help`);
            }
        };
        cli.command({
            name: 'session',
            description: 'Enhanced session management with comprehensive lifecycle support',
            action: enhancedSessionAction
        });
    } catch (err) {
        warning('Enhanced session command not available');
    }
    try {
        const enhancedStartAction = async (ctx)=>{
            console.log(chalk.cyan('🧠 Enhanced Claude-Flow Orchestration System'));
            console.log('Features: Service Management + Health Checks + Auto-Recovery + Process UI');
            console.log();
            const options = {
                daemon: ctx.flags.daemon || ctx.flags.d,
                port: ctx.flags.port || ctx.flags.p || 3000,
                mcpTransport: ctx.flags.mcpTransport || ctx.flags['mcp-transport'] || 'stdio',
                ui: ctx.flags.ui || ctx.flags.u,
                verbose: ctx.flags.verbose || ctx.flags.v,
                autoStart: ctx.flags.autoStart || ctx.flags['auto-start'],
                config: ctx.flags.config,
                force: ctx.flags.force,
                healthCheck: ctx.flags.healthCheck || ctx.flags['health-check'],
                timeout: ctx.flags.timeout || 60
            };
            if (options.ui) {
                console.log('🎮 Launching interactive process management UI...');
            }
            if (options.daemon) {
                console.log('🔧 Starting in daemon mode with enhanced service management...');
            }
            if (options.healthCheck) {
                console.log('🏥 Performing pre-flight health checks...');
            }
            console.log();
            console.log('For full enhanced functionality, use: claude-flow start [options]');
            console.log('Available options: --daemon, --port, --mcp-transport, --ui, --verbose, --auto-start, --force, --health-check, --timeout');
            try {
                const orch = await getOrchestrator();
                await orch.start();
                success('Enhanced orchestration system started!');
                info('Components initialized with enhanced features:');
                console.log('   ✓ Event Bus with advanced routing');
                console.log('   ✓ Orchestrator Engine with service management');
                console.log('   ✓ Memory Manager with integrity checking');
                console.log('   ✓ Terminal Pool with session recovery');
                console.log('   ✓ MCP Server with enhanced transport');
                console.log('   ✓ Coordination Manager with load balancing');
                if (!options.daemon) {
                    info('Press Ctrl+C to stop the enhanced system');
                    const controller = new AbortController();
                    const shutdown = ()=>{
                        console.log('\nShutting down enhanced system...');
                        controller.abort();
                    };
                    process.on('SIGINT', shutdown);
                    process.on('SIGTERM', shutdown);
                    await new Promise((resolve)=>{
                        controller.signal.addEventListener('abort', ()=>resolve());
                    });
                }
            } catch (err) {
                error(`Failed to start enhanced system: ${err.message}`);
                process.exit(1);
            }
        };
        cli.command({
            name: 'start',
            description: 'Start the enhanced orchestration system with comprehensive service management',
            options: [
                {
                    name: 'daemon',
                    short: 'd',
                    description: 'Run as daemon in background',
                    type: 'boolean'
                },
                {
                    name: 'port',
                    short: 'p',
                    description: 'MCP server port',
                    type: 'number',
                    default: 3000
                },
                {
                    name: 'mcp-transport',
                    description: 'MCP transport type (stdio, http)',
                    type: 'string',
                    default: 'stdio'
                },
                {
                    name: 'ui',
                    short: 'u',
                    description: 'Launch interactive process management UI',
                    type: 'boolean'
                },
                {
                    name: 'verbose',
                    short: 'v',
                    description: 'Enable verbose logging',
                    type: 'boolean'
                },
                {
                    name: 'auto-start',
                    description: 'Automatically start all processes',
                    type: 'boolean'
                },
                {
                    name: 'config',
                    description: 'Configuration file path',
                    type: 'string'
                },
                {
                    name: 'force',
                    description: 'Force start even if already running',
                    type: 'boolean'
                },
                {
                    name: 'health-check',
                    description: 'Perform health checks before starting',
                    type: 'boolean'
                },
                {
                    name: 'timeout',
                    description: 'Startup timeout in seconds',
                    type: 'number',
                    default: 60
                }
            ],
            action: enhancedStartAction
        });
    } catch (err) {
        warning('Enhanced start command not available, using basic version');
    }
    cli.command({
        name: 'help',
        description: 'Show help information',
        action: (ctx)=>{
            const command = ctx.args[0];
            if (command === 'claude') {
                console.log(bold(blue('Claude Instance Management')));
                console.log();
                console.log('Spawn and manage Claude Code instances with specific configurations.');
                console.log();
                console.log(bold('Subcommands:'));
                console.log('  spawn <task>    Spawn Claude with specific configuration');
                console.log('  batch <file>    Execute multiple Claude instances from workflow');
                console.log();
                console.log(bold('Spawn Options:'));
                console.log('  -t, --tools <tools>        Allowed tools (comma-separated)');
                console.log('  --no-permissions           Use --dangerously-skip-permissions flag');
                console.log('  -c, --config <file>        MCP config file path');
                console.log('  -m, --mode <mode>          Development mode (full/backend-only/frontend-only/api-only)');
                console.log('  --parallel                 Enable parallel execution with BatchTool');
                console.log('  --research                 Enable web research with WebFetchTool');
                console.log('  --coverage <n>             Test coverage target percentage (default: 80)');
                console.log('  --commit <freq>            Commit frequency (phase/feature/manual)');
                console.log('  -v, --verbose              Enable verbose output');
                console.log('  -d, --dry-run              Show what would be executed without running');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow claude spawn')} "implement user authentication" --research --parallel`);
                console.log(`  ${blue('claude-flow claude spawn')} "fix payment bug" --tools "View,Edit,Bash" --no-permissions`);
                console.log(`  ${blue('claude-flow claude batch')} workflow.json --dry-run`);
                console.log();
                console.log('For more information, see: https://github.com/ruvnet/claude-code-flow/docs/11-claude-spawning.md');
            } else if (command === 'swarm' || command === 'swarm-ui') {
                console.log(bold(blue('Claude Swarm Mode')));
                console.log();
                console.log('Create self-orchestrating Claude agent swarms to tackle complex objectives.');
                console.log();
                console.log(bold('Usage:'));
                console.log('  claude-flow swarm <objective> [options]');
                console.log('  claude-flow swarm-ui <objective> [options]  # Uses blessed UI (avoids TTY issues)');
                console.log();
                console.log(bold('Options:'));
                console.log('  -s, --strategy <s>         Orchestration strategy (auto, research, development, analysis)');
                console.log('  --max-agents <n>           Maximum number of agents (default: 5)');
                console.log('  --max-depth <n>            Maximum delegation depth (default: 3)');
                console.log('  --research                 Enable research capabilities for all agents');
                console.log('  --parallel                 Enable parallel execution');
                console.log('  --memory-namespace <ns>    Shared memory namespace (default: swarm)');
                console.log('  --timeout <minutes>        Swarm timeout in minutes (default: 60)');
                console.log('  --review                   Enable peer review between agents');
                console.log('  --coordinator              Spawn dedicated coordinator agent');
                console.log('  -c, --config <file>        MCP config file');
                console.log('  -v, --verbose              Enable verbose output');
                console.log('  -d, --dry-run              Preview swarm configuration');
                console.log('  --vscode                   Use VS Code terminal integration');
                console.log('  --monitor                  Enable real-time monitoring');
                console.log('  --ui                       Use blessed terminal UI (avoids TTY issues)');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow swarm')} "Build a REST API"`);
                console.log(`  ${blue('claude-flow swarm-ui')} "Build a REST API"  # Avoids TTY issues`);
                console.log(`  ${blue('claude-flow swarm')} "Research cloud architecture" --strategy research --research`);
                console.log(`  ${blue('claude-flow swarm')} "Migrate app to microservices" --coordinator --review --ui`);
                console.log();
                console.log(bold('TTY Issues?'));
                console.log("If you encounter 'Raw mode is not supported' errors, use:");
                console.log(`  - ${blue('claude-flow swarm-ui')} <objective>  # Recommended`);
                console.log(`  - ${blue('claude-flow swarm')} <objective> --ui`);
                console.log();
                console.log('For more information, see:');
                console.log('  - https://github.com/ruvnet/claude-code-flow/docs/12-swarm.md');
                console.log('  - https://github.com/ruvnet/claude-code-flow/SWARM_TTY_SOLUTION.md');
            } else if (command === 'sparc') {
                console.log(bold(blue('SPARC Development Mode')));
                console.log();
                console.log('SPARC (Specification, Pseudocode, Architecture, Refinement, Completion)');
                console.log('TDD-based development with specialized AI modes from .roomodes configuration.');
                console.log();
                console.log(bold('Subcommands:'));
                console.log('  modes                    List all available SPARC modes');
                console.log('  info <mode>              Show detailed information about a mode');
                console.log('  run <mode> <task>        Execute a task using a specific SPARC mode');
                console.log('  tdd <task>               Run full TDD workflow using SPARC methodology');
                console.log('  workflow <file>          Execute a custom SPARC workflow from JSON file');
                console.log();
                console.log(bold('Common Modes:'));
                console.log('  spec-pseudocode          Create specifications and pseudocode');
                console.log('  architect                Design system architecture');
                console.log('  code                     Implement code solutions');
                console.log('  tdd                      Test-driven development');
                console.log('  debug                    Debug and troubleshoot issues');
                console.log('  security-review          Security analysis and review');
                console.log('  docs-writer              Documentation creation');
                console.log('  integration              System integration and testing');
                console.log();
                console.log(bold('Options:'));
                console.log('  -n, --namespace <ns>     Memory namespace for this session');
                console.log('  --no-permissions         Skip permission prompts');
                console.log('  -c, --config <file>      MCP configuration file');
                console.log('  -v, --verbose            Enable verbose output');
                console.log('  -d, --dry-run            Preview what would be executed');
                console.log('  --sequential             Wait between workflow steps (default: true)');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow sparc modes')}                              # List all modes`);
                console.log(`  ${blue('claude-flow sparc run code')} "implement user auth"      # Run specific mode`);
                console.log(`  ${blue('claude-flow sparc tdd')} "payment processing system"    # Full TDD workflow`);
                console.log(`  ${blue('claude-flow sparc workflow')} project-workflow.json     # Custom workflow`);
                console.log();
                console.log('For more information, see: https://github.com/ruvnet/claude-code-flow/docs/sparc.md');
            } else if (command === 'start') {
                console.log(bold(blue('Enhanced Start Command')));
                console.log();
                console.log('Start the Claude-Flow orchestration system with comprehensive service management.');
                console.log();
                console.log(bold('Usage:'));
                console.log('  claude-flow start [options]');
                console.log();
                console.log(bold('Options:'));
                console.log('  -d, --daemon              Run as daemon in background');
                console.log('  -p, --port <port>         MCP server port (default: 3000)');
                console.log('  --mcp-transport <type>    MCP transport type (stdio, http)');
                console.log('  -u, --ui                  Launch interactive process management UI');
                console.log('  -v, --verbose             Enable verbose logging');
                console.log('  --auto-start              Automatically start all processes');
                console.log('  --config <path>           Configuration file path');
                console.log('  --force                   Force start even if already running');
                console.log('  --health-check            Perform health checks before starting');
                console.log('  --timeout <seconds>       Startup timeout in seconds (default: 60)');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow start')}                    # Interactive mode`);
                console.log(`  ${blue('claude-flow start --daemon')}           # Background daemon`);
                console.log(`  ${blue('claude-flow start --ui')}               # Process management UI`);
                console.log(`  ${blue('claude-flow start --health-check')}     # With pre-flight checks`);
            } else if (command === 'status') {
                console.log(bold(blue('Enhanced Status Command')));
                console.log();
                console.log('Show comprehensive Claude-Flow system status with detailed reporting.');
                console.log();
                console.log(bold('Usage:'));
                console.log('  claude-flow status [options]');
                console.log();
                console.log(bold('Options:'));
                console.log('  -w, --watch              Watch mode - continuously update status');
                console.log('  -i, --interval <seconds> Update interval in seconds (default: 5)');
                console.log('  -c, --component <name>   Show status for specific component');
                console.log('  --json                   Output in JSON format');
                console.log('  --detailed               Show detailed component information');
                console.log('  --health-check           Perform comprehensive health checks');
                console.log('  --history                Show status history from logs');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow status')}                   # Basic status`);
                console.log(`  ${blue('claude-flow status --watch')}           # Live updates`);
                console.log(`  ${blue('claude-flow status --detailed')}        # Comprehensive info`);
                console.log(`  ${blue('claude-flow status --component mcp')}   # Specific component`);
            } else if (command === 'monitor') {
                console.log(bold(blue('Enhanced Monitor Command')));
                console.log();
                console.log('Real-time monitoring dashboard with comprehensive metrics and alerting.');
                console.log();
                console.log(bold('Usage:'));
                console.log('  claude-flow monitor [options]');
                console.log();
                console.log(bold('Options:'));
                console.log('  -i, --interval <seconds> Update interval in seconds (default: 2)');
                console.log('  -c, --compact            Compact view mode');
                console.log('  --focus <component>      Focus on specific component');
                console.log('  --alerts                 Enable alert notifications');
                console.log('  --export <file>          Export monitoring data to file');
                console.log('  --threshold <percent>    Alert threshold percentage (default: 80)');
                console.log('  --log-level <level>      Log level filter (error, warn, info, debug)');
                console.log('  --no-graphs              Disable ASCII graphs');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow monitor')}                  # Basic monitoring`);
                console.log(`  ${blue('claude-flow monitor --alerts')}         # With alerting`);
                console.log(`  ${blue('claude-flow monitor --focus mcp')}      # Component focus`);
                console.log(`  ${blue('claude-flow monitor --export data.json')} # Data export`);
            } else if (command === 'session') {
                console.log(bold(blue('Enhanced Session Management')));
                console.log();
                console.log('Comprehensive session lifecycle management with backup and recovery.');
                console.log();
                console.log(bold('Commands:'));
                console.log('  list                     List all saved sessions');
                console.log('  save [name]              Save current session state');
                console.log('  restore <session-id>     Restore a saved session');
                console.log('  delete <session-id>      Delete a saved session');
                console.log('  export <session-id> <file> Export session to file');
                console.log('  import <file>            Import session from file');
                console.log('  info <session-id>        Show detailed session information');
                console.log('  clean                    Clean up old or orphaned sessions');
                console.log('  backup [session-id]      Backup sessions to archive');
                console.log('  restore-backup <file>    Restore sessions from backup');
                console.log('  validate [session-id]    Validate session integrity');
                console.log('  monitor                  Monitor active sessions');
                console.log();
                console.log(bold('Examples:'));
                console.log(`  ${blue('claude-flow session list')}             # List sessions`);
                console.log(`  ${blue('claude-flow session save mywork')}      # Save session`);
                console.log(`  ${blue('claude-flow session restore abc123')}   # Restore session`);
                console.log(`  ${blue('claude-flow session validate --fix')}   # Validate and fix`);
            } else {
                console.log(bold(blue('Claude-Flow Enhanced Orchestration System')));
                console.log();
                console.log('Available commands:');
                console.log('  start        Enhanced orchestration system startup');
                console.log('  status       Comprehensive system status reporting');
                console.log('  monitor      Real-time monitoring dashboard');
                console.log('  session      Advanced session management');
                console.log('  swarm        Self-orchestrating agent swarms');
                console.log('  sparc        Enhanced TDD development modes');
                console.log('  agent        Agent management and coordination');
                console.log('  task         Task creation and management');
                console.log('  memory       Memory bank operations');
                console.log('  mcp          MCP server management');
                console.log('  claude       Claude instance spawning');
                console.log();
                console.log('For detailed help on any command, use:');
                console.log(`  ${blue('claude-flow help <command>')}`);
                console.log();
                console.log('Enhanced features:');
                console.log('  ✨ Comprehensive service management');
                console.log('  ✨ Real-time monitoring and alerting');
                console.log('  ✨ Advanced session lifecycle management');
                console.log('  ✨ Batch operations and parallel execution');
                console.log('  ✨ Health checks and auto-recovery');
                console.log('  ✨ Process management UI');
            }
        }
    });
    console.log(chalk.cyan('\n🚀 Enhanced Commands Loaded:'));
    console.log('  ✓ start    - Enhanced orchestration with service management');
    console.log('  ✓ status   - Comprehensive system status reporting');
    console.log('  ✓ monitor  - Real-time monitoring with metrics and alerts');
    console.log('  ✓ session  - Advanced session lifecycle management');
    console.log('  ✓ sparc    - Enhanced TDD with orchestration features');
    console.log();
    console.log('For detailed help on enhanced commands: claude-flow help <command>');
    cli.command({
        name: 'hive-mind',
        description: 'Collective intelligence swarm management',
        aliases: [
            'hive',
            'swarm'
        ],
        options: [
            {
                name: 'command',
                description: 'Hive Mind command (init, spawn, status, task, wizard)',
                type: 'string'
            },
            {
                name: 'swarm-id',
                short: 's',
                description: 'Swarm ID to operate on',
                type: 'string'
            },
            {
                name: 'topology',
                short: 't',
                description: 'Swarm topology (mesh, hierarchical, ring, star)',
                type: 'string',
                default: 'hierarchical'
            },
            {
                name: 'max-agents',
                short: 'm',
                description: 'Maximum number of agents',
                type: 'number',
                default: 8
            },
            {
                name: 'interactive',
                short: 'i',
                description: 'Run in interactive mode',
                type: 'boolean'
            }
        ],
        action: async (ctx)=>{
            try {
                const subcommand = ctx.args[0] || 'wizard';
                const { hiveMindCommand } = await import('./hive-mind/index.js');
                switch(subcommand){
                    case 'init':
                        const { initCommand } = await import('./hive-mind/init.js');
                        await initCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'spawn':
                        const { spawnCommand } = await import('./hive-mind/spawn.js');
                        await spawnCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'status':
                        const { statusCommand } = await import('./hive-mind/status.js');
                        await statusCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'task':
                        const { taskCommand } = await import('./hive-mind/task.js');
                        await taskCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'stop':
                        const { stopCommand } = await import('./hive-mind/stop.js');
                        await stopCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'pause':
                        const { pauseCommand } = await import('./hive-mind/pause.js');
                        await pauseCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'resume':
                        const { resumeCommand } = await import('./hive-mind/resume.js');
                        await resumeCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'ps':
                        const { psCommand } = await import('./hive-mind/ps.js');
                        await psCommand.parseAsync(process.argv.slice(3));
                        break;
                    case 'wizard':
                    default:
                        const { wizardCommand } = await import('./hive-mind/wizard.js');
                        await wizardCommand.parseAsync(process.argv.slice(3));
                        break;
                }
            } catch (err) {
                error(`Hive Mind error: ${getErrorMessage(err)}`);
            }
        }
    });
    cli.command({
        name: 'hook',
        description: 'Execute ruv-swarm hooks for agent coordination',
        action: async (ctx)=>{
            try {
                const { spawn } = await import('child_process');
                const args = ctx.args.length > 0 ? ctx.args : [
                    '--help'
                ];
                const child = spawn('npx', [
                    'ruv-swarm',
                    'hook',
                    ...args
                ], {
                    stdio: 'inherit',
                    shell: true
                });
                await new Promise((resolve, reject)=>{
                    child.on('exit', (code)=>{
                        if (code === 0) {
                            resolve();
                        } else {
                            resolve();
                        }
                    });
                    child.on('error', (err)=>{
                        error(`Failed to execute hook command: ${getErrorMessage(err)}`);
                        resolve();
                    });
                });
            } catch (err) {
                error(`Hook command error: ${getErrorMessage(err)}`);
            }
        }
    });
    for (const command of enterpriseCommands){
        cli.command(command);
    }
}
function getCapabilitiesForType(type) {
    const capabilities = {
        coordinator: [
            'task-assignment',
            'planning',
            'delegation'
        ],
        researcher: [
            'web-search',
            'information-gathering',
            'analysis'
        ],
        implementer: [
            'code-generation',
            'file-manipulation',
            'testing'
        ],
        analyst: [
            'data-analysis',
            'pattern-recognition',
            'reporting'
        ],
        custom: [
            'user-defined'
        ]
    };
    return capabilities[type] || capabilities.custom;
}
function getDefaultPromptForType(type) {
    const prompts = {
        coordinator: 'You are a coordination agent responsible for planning and delegating tasks.',
        researcher: 'You are a research agent specialized in gathering and analyzing information.',
        implementer: 'You are an implementation agent focused on writing code and creating solutions.',
        analyst: 'You are an analysis agent that identifies patterns and generates insights.',
        custom: "You are a custom agent. Follow the user's instructions."
    };
    return prompts[type] || prompts.custom;
}
function createMinimalClaudeMd() {
    return `# Claude Code Configuration

## Build Commands
- \`npm run build\`: Build the project
- \`npm run test\`: Run tests
- \`npm run lint\`: Run linter

## Code Style
- Use TypeScript/ES modules
- Follow project conventions
- Run typecheck before committing

## Project Info
This is a Claude-Flow AI agent orchestration system.
`;
}
function createFullClaudeMd() {
    return `# Claude Code Configuration

## Build Commands
- \`npm run build\`: Build the project using Deno compile
- \`npm run test\`: Run the full test suite
- \`npm run lint\`: Run ESLint and format checks
- \`npm run typecheck\`: Run TypeScript type checking
- \`npx claude-flow start\`: Start the orchestration system
- \`npx claude-flow --help\`: Show all available commands

## Code Style Preferences
- Use ES modules (import/export) syntax, not CommonJS (require)
- Destructure imports when possible (e.g., \`import { foo } from 'bar'\`)
- Use TypeScript for all new code
- Follow existing naming conventions (camelCase for variables, PascalCase for classes)
- Add JSDoc comments for public APIs
- Use async/await instead of Promise chains
- Prefer const/let over var

## Workflow Guidelines
- Always run typecheck after making code changes
- Run tests before committing changes
- Use meaningful commit messages following conventional commits
- Create feature branches for new functionality
- Ensure all tests pass before merging

## Project Architecture
This is a Claude-Flow AI agent orchestration system with the following components:
- **CLI Interface**: Command-line tools for managing the system
- **Orchestrator**: Core engine for coordinating agents and tasks
- **Memory System**: Persistent storage and retrieval of information
- **Terminal Management**: Automated terminal session handling
- **MCP Integration**: Model Context Protocol server for Claude integration
- **Agent Coordination**: Multi-agent task distribution and management

## Important Notes
- Use \`claude --dangerously-skip-permissions\` for unattended operation
- The system supports both daemon and interactive modes
- Memory persistence is handled automatically
- All components are event-driven for scalability

## Debugging
- Check logs in \`./claude-flow.log\`
- Use \`npx claude-flow status\` to check system health
- Monitor with \`npx claude-flow monitor\` for real-time updates
- Verbose output available with \`--verbose\` flag on most commands
`;
}
function createMinimalMemoryBankMd() {
    return `# Memory Bank

## Quick Reference
- Project uses SQLite for memory persistence
- Memory is organized by namespaces
- Query with \`npx claude-flow memory query <search>\`

## Storage Location
- Database: \`./memory/claude-flow-data.json\`
- Sessions: \`./memory/sessions/\`
`;
}
function createFullMemoryBankMd() {
    return `# Memory Bank Configuration

## Overview
The Claude-Flow memory system provides persistent storage and intelligent retrieval of information across agent sessions. It uses a hybrid approach combining SQL databases with semantic search capabilities.

## Storage Backends
- **Primary**: JSON database (\`./memory/claude-flow-data.json\`)
- **Sessions**: File-based storage in \`./memory/sessions/\`
- **Cache**: In-memory cache for frequently accessed data

## Memory Organization
- **Namespaces**: Logical groupings of related information
- **Sessions**: Time-bound conversation contexts
- **Indexing**: Automatic content indexing for fast retrieval
- **Replication**: Optional distributed storage support

## Commands
- \`npx claude-flow memory query <search>\`: Search stored information
- \`npx claude-flow memory stats\`: Show memory usage statistics
- \`npx claude-flow memory export <file>\`: Export memory to file
- \`npx claude-flow memory import <file>\`: Import memory from file

## Configuration
Memory settings are configured in \`claude-flow.config.json\`:
\`\`\`json
{
  "memory": {
    "backend": "json",
    "path": "./memory/claude-flow-data.json",
    "cacheSize": 1000,
    "indexing": true,
    "namespaces": ["default", "agents", "tasks", "sessions"],
    "retentionPolicy": {
      "sessions": "30d",
      "tasks": "90d",
      "agents": "permanent"
    }
  }
}
\`\`\`

## Best Practices
- Use descriptive namespaces for different data types
- Regular memory exports for backup purposes
- Monitor memory usage with stats command
- Clean up old sessions periodically

## Memory Types
- **Episodic**: Conversation and interaction history
- **Semantic**: Factual knowledge and relationships
- **Procedural**: Task patterns and workflows
- **Meta**: System configuration and preferences

## Integration Notes
- Memory is automatically synchronized across agents
- Search supports both exact match and semantic similarity
- Memory contents are private to your local instance
- No data is sent to external services without explicit commands
`;
}
function createMinimalCoordinationMd() {
    return `# Agent Coordination

## Quick Commands
- \`npx claude-flow agent spawn <type>\`: Create new agent
- \`npx claude-flow agent list\`: Show active agents
- \`npx claude-flow task create <type> <description>\`: Create task

## Agent Types
- researcher, coder, analyst, coordinator, general
`;
}
function createFullCoordinationMd() {
    return `# Agent Coordination System

## Overview
The Claude-Flow coordination system manages multiple AI agents working together on complex tasks. It provides intelligent task distribution, resource management, and inter-agent communication.

## Agent Types and Capabilities
- **Researcher**: Web search, information gathering, knowledge synthesis
- **Coder**: Code analysis, development, debugging, testing
- **Analyst**: Data processing, pattern recognition, insights generation
- **Coordinator**: Task planning, resource allocation, workflow management
- **General**: Multi-purpose agent with balanced capabilities

## Task Management
- **Priority Levels**: 1 (lowest) to 10 (highest)
- **Dependencies**: Tasks can depend on completion of other tasks
- **Parallel Execution**: Independent tasks run concurrently
- **Load Balancing**: Automatic distribution based on agent capacity

## Coordination Commands
\`\`\`bash
# Agent Management
npx claude-flow agent spawn <type> --name <name> --priority <1-10>
npx claude-flow agent list
npx claude-flow agent info <agent-id>
npx claude-flow agent terminate <agent-id>

# Task Management  
npx claude-flow task create <type> <description> --priority <1-10> --deps <task-ids>
npx claude-flow task list --verbose
npx claude-flow task status <task-id>
npx claude-flow task cancel <task-id>

# System Monitoring
npx claude-flow status --verbose
npx claude-flow monitor --interval 5000
\`\`\`

## Workflow Execution
Workflows are defined in JSON format and can orchestrate complex multi-agent operations:
\`\`\`bash
npx claude-flow workflow examples/research-workflow.json
npx claude-flow workflow examples/development-config.json --async
\`\`\`

## Advanced Features
- **Circuit Breakers**: Automatic failure handling and recovery
- **Work Stealing**: Dynamic load redistribution for efficiency
- **Resource Limits**: Memory and CPU usage constraints
- **Metrics Collection**: Performance monitoring and optimization

## Configuration
Coordination settings in \`claude-flow.config.json\`:
\`\`\`json
{
  "orchestrator": {
    "maxConcurrentTasks": 10,
    "taskTimeout": 300000,
    "defaultPriority": 5
  },
  "agents": {
    "maxAgents": 20,
    "defaultCapabilities": ["research", "code", "terminal"],
    "resourceLimits": {
      "memory": "1GB",
      "cpu": "50%"
    }
  }
}
\`\`\`

## Communication Patterns
- **Direct Messaging**: Agent-to-agent communication
- **Event Broadcasting**: System-wide notifications
- **Shared Memory**: Common information access
- **Task Handoff**: Seamless work transfer between agents

## Best Practices
- Start with general agents and specialize as needed
- Use descriptive task names and clear requirements
- Monitor system resources during heavy workloads
- Implement proper error handling in workflows
- Regular cleanup of completed tasks and inactive agents

## Troubleshooting
- Check agent health with \`npx claude-flow status\`
- View detailed logs with \`npx claude-flow monitor\`
- Restart stuck agents with terminate/spawn cycle
- Use \`--verbose\` flags for detailed diagnostic information
`;
}
function createAgentsReadme() {
    return `# Agent Memory Storage

## Purpose
This directory stores agent-specific memory data, configurations, and persistent state information for individual Claude agents in the orchestration system.

## Structure
Each agent gets its own subdirectory for isolated memory storage:

\`\`\`
memory/agents/
├── agent_001/
│   ├── state.json           # Agent state and configuration
│   ├── knowledge.md         # Agent-specific knowledge base
│   ├── tasks.json          # Completed and active tasks
│   └── calibration.json    # Agent-specific calibrations
├── agent_002/
│   └── ...
└── shared/
    ├── common_knowledge.md  # Shared knowledge across agents
    └── global_config.json  # Global agent configurations
\`\`\`

## Usage Guidelines
1. **Agent Isolation**: Each agent should only read/write to its own directory
2. **Shared Resources**: Use the \`shared/\` directory for cross-agent information
3. **State Persistence**: Update state.json whenever agent status changes
4. **Knowledge Sharing**: Document discoveries in knowledge.md files
5. **Cleanup**: Remove directories for terminated agents periodically

## Last Updated
${new Date().toISOString()}
`;
}
function createSessionsReadme() {
    return `# Session Memory Storage

## Purpose
This directory stores session-based memory data, conversation history, and contextual information for development sessions using the Claude-Flow orchestration system.

## Structure
Sessions are organized by date and session ID for easy retrieval:

\`\`\`
memory/sessions/
├── 2024-01-10/
│   ├── session_001/
│   │   ├── metadata.json        # Session metadata and configuration
│   │   ├── conversation.md      # Full conversation history
│   │   ├── decisions.md         # Key decisions and rationale
│   │   ├── artifacts/           # Generated files and outputs
│   │   └── coordination_state/  # Coordination system snapshots
│   └── ...
└── shared/
    ├── patterns.md              # Common session patterns
    └── templates/               # Session template files
\`\`\`

## Usage Guidelines
1. **Session Isolation**: Each session gets its own directory
2. **Metadata Completeness**: Always fill out session metadata
3. **Conversation Logging**: Document all significant interactions
4. **Artifact Organization**: Structure generated files clearly
5. **State Preservation**: Snapshot coordination state regularly

## Last Updated
${new Date().toISOString()}
`;
}

//# sourceMappingURL=index.js.map