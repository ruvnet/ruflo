import { generateId } from '../../utils/helpers.js';
import { promises as fs } from 'node:fs';
import { success, error, warning } from '../cli-core.js';
import { BackgroundExecutor } from '../../coordination/background-executor.js';
import { SwarmCoordinator } from '../../coordination/swarm-coordinator.js';
import { SwarmMemoryManager } from '../../memory/swarm-memory.js';
export async function swarmAction(ctx) {
    if (ctx.flags.help || ctx.flags.h) {
        return;
    }
    const objective = ctx.args.join(' ').trim();
    if (!objective) {
        error('Usage: swarm <objective>');
        console.log('\nExamples:');
        console.log('  claude-flow swarm "Build a REST API"');
        console.log('  claude-flow swarm "Research cloud architecture"');
        console.log('\nOptions:');
        console.log('  --dry-run              Show configuration without executing');
        console.log('  --strategy <type>      Strategy: auto, research, development, analysis');
        console.log('  --max-agents <n>       Maximum number of agents (default: 5)');
        console.log('  --timeout <minutes>    Timeout in minutes (default: 60)');
        console.log('  --research             Enable research capabilities');
        console.log('  --parallel             Enable parallel execution');
        console.log('  --review               Enable peer review between agents');
        console.log('  --monitor              Enable real-time monitoring');
        console.log('  --ui                   Use blessed terminal UI (requires node.js)');
        console.log('  --background           Run swarm in background mode');
        console.log('  --distributed          Enable distributed coordination');
        console.log('  --memory-namespace     Memory namespace for swarm (default: swarm)');
        console.log('  --persistence          Enable task persistence (default: true)');
        return;
    }
    const options = {
        strategy: ctx.flags.strategy || 'auto',
        maxAgents: ctx.flags.maxAgents || ctx.flags['max-agents'] || 5,
        maxDepth: ctx.flags.maxDepth || ctx.flags['max-depth'] || 3,
        research: ctx.flags.research || false,
        parallel: ctx.flags.parallel || false,
        memoryNamespace: ctx.flags.memoryNamespace || ctx.flags['memory-namespace'] || 'swarm',
        timeout: ctx.flags.timeout || 60,
        review: ctx.flags.review || false,
        coordinator: ctx.flags.coordinator || false,
        config: ctx.flags.config || ctx.flags.c,
        verbose: ctx.flags.verbose || ctx.flags.v || false,
        dryRun: ctx.flags.dryRun || ctx.flags['dry-run'] || ctx.flags.d || false,
        monitor: ctx.flags.monitor || false,
        ui: ctx.flags.ui || false,
        background: ctx.flags.background || false,
        persistence: ctx.flags.persistence || true,
        distributed: ctx.flags.distributed || false
    };
    const swarmId = generateId('swarm');
    if (options.dryRun) {
        warning('DRY RUN - Swarm Configuration:');
        console.log(`Swarm ID: ${swarmId}`);
        console.log(`Objective: ${objective}`);
        console.log(`Strategy: ${options.strategy}`);
        console.log(`Max Agents: ${options.maxAgents}`);
        console.log(`Max Depth: ${options.maxDepth}`);
        console.log(`Research: ${options.research}`);
        console.log(`Parallel: ${options.parallel}`);
        console.log(`Review Mode: ${options.review}`);
        console.log(`Coordinator: ${options.coordinator}`);
        console.log(`Memory Namespace: ${options.memoryNamespace}`);
        console.log(`Timeout: ${options.timeout} minutes`);
        return;
    }
    if (options.ui) {
        try {
            const scriptPath = new URL(import.meta.url).pathname;
            const projectRoot = scriptPath.substring(0, scriptPath.indexOf('/src/'));
            const uiScriptPath = `${projectRoot}/src/cli/simple-commands/swarm-ui.js`;
            try {
                await fs.stat(uiScriptPath);
            } catch  {
                warning("Swarm UI script not found. Falling back to standard mode.");
                options.ui = false;
            }
            if (options.ui) {
                const command = new Deno.Command('node', {
                    args: [
                        uiScriptPath
                    ],
                    stdin: 'inherit',
                    stdout: 'inherit',
                    stderr: 'inherit'
                });
                const process = command.spawn();
                const { code } = await process.status;
                if (code !== 0) {
                    error(`Swarm UI exited with code ${code}`);
                }
                return;
            }
        } catch (err) {
            warning(`Failed to launch blessed UI: ${err.message}`);
            console.log('Falling back to standard mode...');
            options.ui = false;
        }
    }
    success(`🐝 Initializing Claude Swarm: ${swarmId}`);
    console.log(`📋 Objective: ${objective}`);
    console.log(`🎯 Strategy: ${options.strategy}`);
    try {
        const coordinator = new SwarmCoordinator({
            maxAgents: options.maxAgents,
            maxConcurrentTasks: options.parallel ? options.maxAgents : 1,
            taskTimeout: options.timeout * 60 * 1000,
            enableMonitoring: options.monitor,
            enableWorkStealing: options.parallel,
            enableCircuitBreaker: true,
            memoryNamespace: options.memoryNamespace,
            coordinationStrategy: options.distributed ? 'distributed' : 'centralized'
        });
        const executor = new BackgroundExecutor({
            maxConcurrentTasks: options.maxAgents,
            defaultTimeout: options.timeout * 60 * 1000,
            logPath: `./swarm-runs/${swarmId}/background-tasks`,
            enablePersistence: options.persistence
        });
        const memory = new SwarmMemoryManager({
            namespace: options.memoryNamespace,
            enableDistribution: options.distributed,
            enableKnowledgeBase: true,
            persistencePath: `./swarm-runs/${swarmId}/memory`
        });
        await coordinator.start();
        await executor.start();
        await memory.initialize();
        const swarmDir = `./swarm-runs/${swarmId}`;
        await Deno.mkdir(swarmDir, {
            recursive: true
        });
        const objectiveId = await coordinator.createObjective(objective, options.strategy || 'auto');
        console.log(`\n📝 Objective created with ID: ${objectiveId}`);
        const agentTypes = getAgentTypesForStrategy(options.strategy);
        const agents = [];
        for(let i = 0; i < Math.min(options.maxAgents, agentTypes.length); i++){
            const agentType = agentTypes[i % agentTypes.length];
            const agentId = await coordinator.registerAgent(`${agentType}-${i + 1}`, agentType, getCapabilitiesForType(agentType));
            agents.push(agentId);
            console.log(`  🤖 Registered ${agentType} agent: ${agentId}`);
        }
        await fs.writeFile(`${swarmDir}/config.json`, JSON.stringify({
            swarmId,
            objectiveId,
            objective,
            options,
            agents,
            startTime: new Date().toISOString()
        }, null, 2));
        await coordinator.executeObjective(objectiveId);
        console.log(`\n🚀 Swarm execution started...`);
        if (options.background) {
            console.log(`Running in background mode. Check status with: claude-flow swarm status ${swarmId}`);
            await fs.writeFile(`${swarmDir}/coordinator.json`, JSON.stringify({
                coordinatorRunning: true,
                pid: Deno.pid,
                startTime: new Date().toISOString()
            }, null, 2));
        } else {
            await waitForObjectiveCompletion(coordinator, objectiveId, options);
            await fs.writeFile(`${swarmDir}/status.json`, JSON.stringify({
                status: 'completed',
                endTime: new Date().toISOString()
            }, null, 2));
            const swarmStatus = coordinator.getSwarmStatus();
            console.log(`\n📊 Swarm Summary:`);
            console.log(`  - Objectives: ${swarmStatus.objectives}`);
            console.log(`  - Tasks Completed: ${swarmStatus.tasks.completed}`);
            console.log(`  - Tasks Failed: ${swarmStatus.tasks.failed}`);
            console.log(`  - Agents Used: ${swarmStatus.agents.total}`);
            console.log(`  - Results saved to: ${swarmDir}`);
            success(`\n✅ Swarm ${swarmId} completed successfully`);
        }
        if (!options.background) {
            await coordinator.stop();
            await executor.stop();
            await memory.shutdown();
        }
    } catch (err) {
        error(`Failed to execute swarm: ${err.message}`);
    }
}
async function decomposeObjective(objective, options) {
    const subtasks = [];
    switch(options.strategy){
        case 'research':
            subtasks.push({
                type: 'research',
                description: `Research background information on: ${objective}`
            }, {
                type: 'analysis',
                description: `Analyze findings and identify key patterns`
            }, {
                type: 'synthesis',
                description: `Synthesize research into actionable insights`
            });
            break;
        case 'development':
            subtasks.push({
                type: 'planning',
                description: `Plan architecture and design for: ${objective}`
            }, {
                type: 'implementation',
                description: `Implement core functionality`
            }, {
                type: 'testing',
                description: `Test and validate implementation`
            }, {
                type: 'documentation',
                description: `Document the solution`
            });
            break;
        case 'analysis':
            subtasks.push({
                type: 'data-gathering',
                description: `Gather relevant data for: ${objective}`
            }, {
                type: 'analysis',
                description: `Perform detailed analysis`
            }, {
                type: 'visualization',
                description: `Create visualizations and reports`
            });
            break;
        default:
            if (objective.toLowerCase().includes('build') || objective.toLowerCase().includes('create')) {
                subtasks.push({
                    type: 'planning',
                    description: `Plan solution for: ${objective}`
                }, {
                    type: 'implementation',
                    description: `Implement the solution`
                }, {
                    type: 'testing',
                    description: `Test and validate`
                });
            } else if (objective.toLowerCase().includes('research') || objective.toLowerCase().includes('analyze')) {
                subtasks.push({
                    type: 'research',
                    description: `Research: ${objective}`
                }, {
                    type: 'analysis',
                    description: `Analyze findings`
                }, {
                    type: 'report',
                    description: `Generate report`
                });
            } else {
                subtasks.push({
                    type: 'exploration',
                    description: `Explore requirements for: ${objective}`
                }, {
                    type: 'execution',
                    description: `Execute main tasks`
                }, {
                    type: 'validation',
                    description: `Validate results`
                });
            }
    }
    return subtasks;
}
async function executeParallelTasks(tasks, options, swarmId, swarmDir) {
    const promises = tasks.map(async (task, index)=>{
        const agentId = generateId('agent');
        console.log(`  🤖 Spawning agent ${agentId} for: ${task.type}`);
        const agentDir = `${swarmDir}/agents/${agentId}`;
        await Deno.mkdir(agentDir, {
            recursive: true
        });
        await fs.writeFile(`${agentDir}/task.json`, JSON.stringify({
            agentId,
            swarmId,
            task,
            status: 'active',
            startTime: new Date().toISOString()
        }, null, 2));
        await executeAgentTask(agentId, task, options, agentDir);
        await fs.writeFile(`${agentDir}/status.json`, JSON.stringify({
            status: 'completed',
            endTime: new Date().toISOString()
        }, null, 2));
        console.log(`  ✅ Agent ${agentId} completed: ${task.type}`);
    });
    await Promise.all(promises);
}
async function executeSequentialTasks(tasks, options, swarmId, swarmDir) {
    for (const [index, task] of tasks.entries()){
        const agentId = generateId('agent');
        console.log(`  🤖 Spawning agent ${agentId} for: ${task.type}`);
        const agentDir = `${swarmDir}/agents/${agentId}`;
        await Deno.mkdir(agentDir, {
            recursive: true
        });
        await fs.writeFile(`${agentDir}/task.json`, JSON.stringify({
            agentId,
            swarmId,
            task,
            status: 'active',
            startTime: new Date().toISOString()
        }, null, 2));
        await executeAgentTask(agentId, task, options, agentDir);
        await fs.writeFile(`${agentDir}/status.json`, JSON.stringify({
            status: 'completed',
            endTime: new Date().toISOString()
        }, null, 2));
        console.log(`  ✅ Agent ${agentId} completed: ${task.type}`);
    }
}
async function executeAgentTask(agentId, task, options, agentDir) {
    console.log(`    → Executing: ${task.type} task`);
    try {
        const checkClaude = new Deno.Command('which', {
            args: [
                'claude'
            ]
        });
        const checkResult = await checkClaude.output();
        if (checkResult.success && options.simulate !== true) {
            const promptFile = `${agentDir}/prompt.txt`;
            const prompt = `You are an AI agent with ID: ${agentId}

Your task type is: ${task.type}
Your specific task is: ${task.description}

Please execute this task and provide a detailed response.
${task.type === 'research' ? 'Use web search and research tools as needed.' : ''}
${task.type === 'implementation' ? 'Write clean, well-documented code.' : ''}
${task.type === 'testing' ? 'Create comprehensive tests.' : ''}

Provide your output in a structured format.

When you're done, please end with "TASK COMPLETED" on its own line.`;
            await fs.writeFile(promptFile, prompt);
            let tools = 'View,GlobTool,GrepTool,LS';
            if (task.type === 'research' || options.research) {
                tools = 'WebFetchTool,WebSearch';
            } else if (task.type === 'implementation') {
                tools = 'View,Edit,Replace,GlobTool,GrepTool,LS,Bash';
            }
            const claudeArgs = [
                '-p',
                task.description,
                '--dangerously-skip-permissions',
                '--allowedTools',
                tools
            ];
            await fs.writeFile(`${agentDir}/command.txt`, `claude ${claudeArgs.join(' ')}`);
            console.log(`    → Running: ${task.description}`);
            const wrapperScript = `#!/bin/bash
claude ${claudeArgs.map((arg)=>`"${arg}"`).join(' ')} | tee "${agentDir}/output.txt"
exit \${PIPESTATUS[0]}`;
            const wrapperPath = `${agentDir}/wrapper.sh`;
            await fs.writeFile(wrapperPath, wrapperScript);
            await Deno.chmod(wrapperPath, 0o755);
            console.log(`    ┌─ Claude Output ─────────────────────────────`);
            const command = new Deno.Command('bash', {
                args: [
                    wrapperPath
                ],
                stdout: 'inherit',
                stderr: 'inherit'
            });
            try {
                const process = command.spawn();
                const { code, success } = await process.status;
                console.log(`    └─────────────────────────────────────────────`);
                if (!success) {
                    throw new Error(`Claude exited with code ${code}`);
                }
                console.log(`    ✓ Task completed`);
            } catch (err) {
                throw err;
            }
        } else {
            console.log(`    → Simulating: ${task.type} (claude CLI not available)`);
            const claudeFlowArgs = [
                'claude',
                'spawn',
                task.description
            ];
            if (task.type === 'research' || options.research) {
                claudeFlowArgs.push('--research');
            }
            if (options.parallel) {
                claudeFlowArgs.push('--parallel');
            }
            console.log(`    → Using: claude-flow ${claudeFlowArgs.join(' ')}`);
            const claudeFlowPath = new URL(import.meta.url).pathname;
            const projectRoot = claudeFlowPath.substring(0, claudeFlowPath.indexOf('/src/'));
            const claudeFlowBin = `${projectRoot}/bin/claude-flow`;
            const command = new Deno.Command(claudeFlowBin, {
                args: claudeFlowArgs,
                stdout: 'piped',
                stderr: 'piped'
            });
            const { code, stdout, stderr } = await command.output();
            await fs.writeFile(`${agentDir}/output.txt`, new TextDecoder().decode(stdout));
            if (stderr.length > 0) {
                await fs.writeFile(`${agentDir}/error.txt`, new TextDecoder().decode(stderr));
            }
            if (code !== 0) {
                console.log(`    ⚠️  Command exited with code ${code}`);
            }
        }
    } catch (err) {
        console.log(`    ⚠️  Error executing task: ${err.message}`);
        await fs.writeFile(`${agentDir}/error.txt`, err.message);
    }
}
function getAgentTypesForStrategy(strategy) {
    switch(strategy){
        case 'research':
            return [
                'researcher',
                'analyst',
                'coordinator'
            ];
        case 'development':
            return [
                'coder',
                'analyst',
                'reviewer',
                'coordinator'
            ];
        case 'analysis':
            return [
                'analyst',
                'researcher',
                'coordinator'
            ];
        default:
            return [
                'coordinator',
                'researcher',
                'coder',
                'analyst'
            ];
    }
}
function getCapabilitiesForType(type) {
    switch(type){
        case 'researcher':
            return [
                'web-search',
                'data-collection',
                'analysis',
                'documentation'
            ];
        case 'coder':
            return [
                'coding',
                'testing',
                'debugging',
                'architecture'
            ];
        case 'analyst':
            return [
                'data-analysis',
                'visualization',
                'reporting',
                'insights'
            ];
        case 'reviewer':
            return [
                'code-review',
                'quality-assurance',
                'validation',
                'testing'
            ];
        case 'coordinator':
            return [
                'planning',
                'coordination',
                'task-management',
                'communication'
            ];
        default:
            return [
                'general'
            ];
    }
}
async function waitForObjectiveCompletion(coordinator, objectiveId, options) {
    return new Promise((resolve)=>{
        const checkInterval = setInterval(()=>{
            const objective = coordinator.getObjectiveStatus(objectiveId);
            if (!objective) {
                clearInterval(checkInterval);
                resolve();
                return;
            }
            if (objective.status === 'completed' || objective.status === 'failed') {
                clearInterval(checkInterval);
                resolve();
                return;
            }
            if (options.verbose) {
                const swarmStatus = coordinator.getSwarmStatus();
                console.log(`Progress: ${swarmStatus.tasks.completed}/${swarmStatus.tasks.total} tasks completed`);
            }
        }, 5000);
        setTimeout(()=>{
            clearInterval(checkInterval);
            console.log('⚠️  Swarm execution timed out');
            resolve();
        }, options.timeout * 60 * 1000);
    });
}

//# sourceMappingURL=swarm.js.map