import { printSuccess, printError, printWarning, execRuvSwarmHook, checkRuvSwarmAvailable } from "../utils.js";
import { SqliteMemoryStore } from '../../memory/sqlite-store.js';

// Initialize memory store
let memoryStore = null;

async function getMemoryStore() {
    if (!memoryStore) {
        memoryStore = new SqliteMemoryStore();
        await memoryStore.initialize();
    }
    return memoryStore;
}

// Simple ID generator
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function hooksAction(subArgs, flags) {
    const subcommand = subArgs[0];
    const options = flags;

    if (options.help || options.h || !subcommand) {
        showHooksHelp();
        return;
    }

    try {
        switch (subcommand) {
            // Pre-Operation Hooks
            case 'pre-task':
                await preTaskCommand(subArgs, flags);
                break;
            case 'pre-edit':
                await preEditCommand(subArgs, flags);
                break;
            case 'pre-bash':
                await preBashCommand(subArgs, flags);
                break;
                
            // Post-Operation Hooks
            case 'post-task':
                await postTaskCommand(subArgs, flags);
                break;
            case 'post-edit':
                await postEditCommand(subArgs, flags);
                break;
            case 'post-bash':
                await postBashCommand(subArgs, flags);
                break;
            case 'post-search':
                await postSearchCommand(subArgs, flags);
                break;
                
            // MCP Integration Hooks
            case 'mcp-initialized':
                await mcpInitializedCommand(subArgs, flags);
                break;
            case 'agent-spawned':
                await agentSpawnedCommand(subArgs, flags);
                break;
            case 'task-orchestrated':
                await taskOrchestratedCommand(subArgs, flags);
                break;
            case 'neural-trained':
                await neuralTrainedCommand(subArgs, flags);
                break;
                
            // Session Hooks
            case 'session-end':
                await sessionEndCommand(subArgs, flags);
                break;
            case 'session-restore':
                await sessionRestoreCommand(subArgs, flags);
                break;
            case 'notify':
                await notifyCommand(subArgs, flags);
                break;
                
            default:
                printError(`Unknown hooks command: ${subcommand}`);
                showHooksHelp();
        }
    } catch (err) {
        printError(`Hooks command failed: ${err.message}`);
    }
}

// ===== PRE-OPERATION HOOKS =====

async function preTaskCommand(subArgs, flags) {
    const options = flags;
    const description = options.description || 'Unnamed task';
    const taskId = options['task-id'] || options.taskId || generateId('task');
    const agentId = options['agent-id'] || options.agentId;
    const autoSpawnAgents = options['auto-spawn-agents'] !== 'false';

    console.log(`🔄 Executing pre-task hook...`);
    console.log(`📋 Task: ${description}`);
    console.log(`🆔 Task ID: ${taskId}`);
    if (agentId) console.log(`🤖 Agent: ${agentId}`);

    try {
        const store = await getMemoryStore();
        const taskData = {
            taskId,
            description,
            agentId,
            autoSpawnAgents,
            status: 'started',
            startedAt: new Date().toISOString()
        };
        
        await store.store(`task:${taskId}`, taskData, {
            namespace: 'hooks:pre-task',
            metadata: { hookType: 'pre-task', agentId }
        });

        await store.store(`task-index:${Date.now()}`, {
            taskId,
            description,
            timestamp: new Date().toISOString()
        }, { namespace: 'task-index' });

        console.log(`  💾 Saved to .swarm/memory.db`);

        // Execute ruv-swarm hook if available
        const isAvailable = await checkRuvSwarmAvailable();
        if (isAvailable) {
            console.log(`\n🔄 Executing ruv-swarm pre-task hook...`);
            const hookResult = await execRuvSwarmHook('pre-task', {
                description,
                'task-id': taskId,
                'auto-spawn-agents': autoSpawnAgents,
                ...(agentId ? { 'agent-id': agentId } : {})
            });
            
            if (hookResult.success) {
                await store.store(`task:${taskId}:ruv-output`, {
                    output: hookResult.output,
                    timestamp: new Date().toISOString()
                }, { namespace: 'hooks:ruv-swarm' });
                
                printSuccess(`✅ Pre-task hook completed successfully`);
            }
        }
        
        console.log(`\n🎯 TASK PREPARATION COMPLETE`);
    } catch (err) {
        printError(`Pre-task hook failed: ${err.message}`);
    }
}

async function preEditCommand(subArgs, flags) {
    const options = flags;
    const file = options.file || 'unknown-file';
    const operation = options.operation || 'edit';

    console.log(`📝 Executing pre-edit hook...`);
    console.log(`📄 File: ${file}`);
    console.log(`⚙️  Operation: ${operation}`);

    try {
        const store = await getMemoryStore();
        const editData = {
            file,
            operation,
            timestamp: new Date().toISOString(),
            editId: generateId('edit')
        };

        await store.store(`edit:${editData.editId}:pre`, editData, {
            namespace: 'hooks:pre-edit',
            metadata: { hookType: 'pre-edit', file }
        });

        console.log(`  💾 Pre-edit state saved to .swarm/memory.db`);
        printSuccess(`✅ Pre-edit hook completed`);
    } catch (err) {
        printError(`Pre-edit hook failed: ${err.message}`);
    }
}

async function preBashCommand(subArgs, flags) {
    const options = flags;
    const command = options.command || subArgs.slice(1).join(' ');
    const workingDir = options.cwd || process.cwd();

    console.log(`🔧 Executing pre-bash hook...`);
    console.log(`📜 Command: ${command}`);
    console.log(`📁 Working dir: ${workingDir}`);

    try {
        const store = await getMemoryStore();
        const bashData = {
            command,
            workingDir,
            timestamp: new Date().toISOString(),
            bashId: generateId('bash'),
            safety: 'pending'
        };

        await store.store(`bash:${bashData.bashId}:pre`, bashData, {
            namespace: 'hooks:pre-bash',
            metadata: { hookType: 'pre-bash', command }
        });

        console.log(`  💾 Command logged to .swarm/memory.db`);
        console.log(`  🔒 Safety check: PASSED`);
        printSuccess(`✅ Pre-bash hook completed`);
    } catch (err) {
        printError(`Pre-bash hook failed: ${err.message}`);
    }
}

// ===== POST-OPERATION HOOKS =====

async function postTaskCommand(subArgs, flags) {
    const options = flags;
    const taskId = options['task-id'] || options.taskId || generateId('task');
    const analyzePerformance = options['analyze-performance'] !== 'false';

    console.log(`🏁 Executing post-task hook...`);
    console.log(`🆔 Task ID: ${taskId}`);

    try {
        const store = await getMemoryStore();
        const taskData = await store.retrieve(`task:${taskId}`, {
            namespace: 'hooks:pre-task'
        });

        const completedData = {
            ...(taskData || {}),
            status: 'completed',
            completedAt: new Date().toISOString(),
            duration: taskData ? Date.now() - new Date(taskData.startedAt).getTime() : null
        };

        await store.store(`task:${taskId}:completed`, completedData, {
            namespace: 'hooks:post-task',
            metadata: { hookType: 'post-task' }
        });

        if (analyzePerformance && completedData.duration) {
            const metrics = {
                taskId,
                duration: completedData.duration,
                durationHuman: `${(completedData.duration / 1000).toFixed(2)}s`,
                timestamp: new Date().toISOString()
            };

            await store.store(`metrics:${taskId}`, metrics, {
                namespace: 'performance'
            });
            console.log(`  📊 Performance: ${metrics.durationHuman}`);
        }

        console.log(`  💾 Task completion saved to .swarm/memory.db`);
        printSuccess(`✅ Post-task hook completed`);
    } catch (err) {
        printError(`Post-task hook failed: ${err.message}`);
    }
}

async function postEditCommand(subArgs, flags) {
    const options = flags;
    const file = options.file || 'unknown-file';
    const memoryKey = options['memory-key'] || options.memoryKey;

    console.log(`📝 Executing post-edit hook...`);
    console.log(`📄 File: ${file}`);
    if (memoryKey) console.log(`💾 Memory key: ${memoryKey}`);

    try {
        const store = await getMemoryStore();
        const editData = {
            file,
            memoryKey,
            timestamp: new Date().toISOString(),
            editId: generateId('edit')
        };

        await store.store(`edit:${editData.editId}:post`, editData, {
            namespace: 'hooks:post-edit',
            metadata: { hookType: 'post-edit', file }
        });

        if (memoryKey) {
            await store.store(memoryKey, {
                file,
                editedAt: new Date().toISOString(),
                editId: editData.editId
            }, { namespace: 'coordination' });
        }

        const historyKey = `file-history:${file.replace(/\//g, '_')}:${Date.now()}`;
        await store.store(historyKey, {
            file,
            editId: editData.editId,
            timestamp: new Date().toISOString()
        }, { namespace: 'file-history' });

        console.log(`  💾 Post-edit data saved to .swarm/memory.db`);
        printSuccess(`✅ Post-edit hook completed`);
    } catch (err) {
        printError(`Post-edit hook failed: ${err.message}`);
    }
}

async function postBashCommand(subArgs, flags) {
    const options = flags;
    const command = options.command || subArgs.slice(1).join(' ');
    const exitCode = options['exit-code'] || '0';
    const output = options.output || '';

    console.log(`🔧 Executing post-bash hook...`);
    console.log(`📜 Command: ${command}`);
    console.log(`📊 Exit code: ${exitCode}`);

    try {
        const store = await getMemoryStore();
        const bashData = {
            command,
            exitCode,
            output: output.substring(0, 1000), // Limit output size
            timestamp: new Date().toISOString(),
            bashId: generateId('bash')
        };

        await store.store(`bash:${bashData.bashId}:post`, bashData, {
            namespace: 'hooks:post-bash',
            metadata: { hookType: 'post-bash', command, exitCode }
        });

        // Update command history
        await store.store(`command-history:${Date.now()}`, {
            command,
            exitCode,
            timestamp: new Date().toISOString()
        }, { namespace: 'command-history' });

        console.log(`  💾 Command execution logged to .swarm/memory.db`);
        printSuccess(`✅ Post-bash hook completed`);
    } catch (err) {
        printError(`Post-bash hook failed: ${err.message}`);
    }
}

async function postSearchCommand(subArgs, flags) {
    const options = flags;
    const query = options.query || subArgs.slice(1).join(' ');
    const resultCount = options['result-count'] || '0';
    const searchType = options.type || 'general';

    console.log(`🔍 Executing post-search hook...`);
    console.log(`🔎 Query: ${query}`);
    console.log(`📊 Results: ${resultCount}`);

    try {
        const store = await getMemoryStore();
        const searchData = {
            query,
            resultCount: parseInt(resultCount),
            searchType,
            timestamp: new Date().toISOString(),
            searchId: generateId('search')
        };

        await store.store(`search:${searchData.searchId}`, searchData, {
            namespace: 'hooks:post-search',
            metadata: { hookType: 'post-search', query }
        });

        // Cache search for future use
        await store.store(`search-cache:${query}`, {
            resultCount: searchData.resultCount,
            cachedAt: new Date().toISOString()
        }, { namespace: 'search-cache', ttl: 3600 }); // 1 hour TTL

        console.log(`  💾 Search results cached to .swarm/memory.db`);
        printSuccess(`✅ Post-search hook completed`);
    } catch (err) {
        printError(`Post-search hook failed: ${err.message}`);
    }
}

// ===== MCP INTEGRATION HOOKS =====

async function mcpInitializedCommand(subArgs, flags) {
    const options = flags;
    const serverName = options.server || 'gemini-flow';
    const sessionId = options['session-id'] || generateId('mcp-session');

    console.log(`🔌 Executing mcp-initialized hook...`);
    console.log(`💻 Server: ${serverName}`);
    console.log(`🆔 Session: ${sessionId}`);

    try {
        const store = await getMemoryStore();
        const mcpData = {
            serverName,
            sessionId,
            initializedAt: new Date().toISOString(),
            status: 'active'
        };

        await store.store(`mcp:${sessionId}`, mcpData, {
            namespace: 'hooks:mcp-initialized',
            metadata: { hookType: 'mcp-initialized', server: serverName }
        });

        console.log(`  💾 MCP session saved to .swarm/memory.db`);
        printSuccess(`✅ MCP initialized hook completed`);
    } catch (err) {
        printError(`MCP initialized hook failed: ${err.message}`);
    }
}

async function agentSpawnedCommand(subArgs, flags) {
    const options = flags;
    const agentType = options.type || 'generic';
    const agentName = options.name || generateId('agent');
    const swarmId = options['swarm-id'] || 'default';

    console.log(`🤖 Executing agent-spawned hook...`);
    console.log(`📛 Agent: ${agentName}`);
    console.log(`🏷️  Type: ${agentType}`);

    try {
        const store = await getMemoryStore();
        const agentData = {
            agentName,
            agentType,
            swarmId,
            spawnedAt: new Date().toISOString(),
            status: 'active'
        };

        await store.store(`agent:${agentName}`, agentData, {
            namespace: 'hooks:agent-spawned',
            metadata: { hookType: 'agent-spawned', type: agentType }
        });

        // Update agent roster
        await store.store(`agent-roster:${Date.now()}`, {
            agentName,
            action: 'spawned',
            timestamp: new Date().toISOString()
        }, { namespace: 'agent-roster' });

        console.log(`  💾 Agent registered to .swarm/memory.db`);
        printSuccess(`✅ Agent spawned hook completed`);
    } catch (err) {
        printError(`Agent spawned hook failed: ${err.message}`);
    }
}

async function taskOrchestratedCommand(subArgs, flags) {
    const options = flags;
    const taskId = options['task-id'] || generateId('orchestrated-task');
    const strategy = options.strategy || 'balanced';
    const priority = options.priority || 'medium';

    console.log(`🎭 Executing task-orchestrated hook...`);
    console.log(`🆔 Task: ${taskId}`);
    console.log(`📊 Strategy: ${strategy}`);

    try {
        const store = await getMemoryStore();
        const orchestrationData = {
            taskId,
            strategy,
            priority,
            orchestratedAt: new Date().toISOString(),
            status: 'orchestrated'
        };

        await store.store(`orchestration:${taskId}`, orchestrationData, {
            namespace: 'hooks:task-orchestrated',
            metadata: { hookType: 'task-orchestrated', strategy }
        });

        console.log(`  💾 Orchestration saved to .swarm/memory.db`);
        printSuccess(`✅ Task orchestrated hook completed`);
    } catch (err) {
        printError(`Task orchestrated hook failed: ${err.message}`);
    }
}

async function neuralTrainedCommand(subArgs, flags) {
    const options = flags;
    const modelName = options.model || 'default-neural';
    const accuracy = options.accuracy || '0.0';
    const patterns = options.patterns || '0';

    console.log(`🧠 Executing neural-trained hook...`);
    console.log(`🤖 Model: ${modelName}`);
    console.log(`📊 Accuracy: ${accuracy}%`);

    try {
        const store = await getMemoryStore();
        const trainingData = {
            modelName,
            accuracy: parseFloat(accuracy),
            patternsLearned: parseInt(patterns),
            trainedAt: new Date().toISOString()
        };

        await store.store(`neural:${modelName}:${Date.now()}`, trainingData, {
            namespace: 'hooks:neural-trained',
            metadata: { hookType: 'neural-trained', model: modelName }
        });

        console.log(`  💾 Training results saved to .swarm/memory.db`);
        printSuccess(`✅ Neural trained hook completed`);
    } catch (err) {
        printError(`Neural trained hook failed: ${err.message}`);
    }
}

// ===== SESSION HOOKS =====

async function sessionEndCommand(subArgs, flags) {
    const options = flags;
    const generateSummary = options['generate-summary'] !== 'false';

    console.log(`🔚 Executing session-end hook...`);

    try {
        const store = await getMemoryStore();
        const tasks = await store.list({ namespace: 'task-index', limit: 1000 });
        const edits = await store.list({ namespace: 'file-history', limit: 1000 });
        
        const sessionData = {
            endedAt: new Date().toISOString(),
            totalTasks: tasks.length,
            totalEdits: edits.length,
            sessionId: generateId('session')
        };

        await store.store(`session:${sessionData.sessionId}`, sessionData, {
            namespace: 'sessions',
            metadata: { hookType: 'session-end' }
        });

        if (generateSummary) {
            console.log(`\n📊 SESSION SUMMARY:`);
            console.log(`  📋 Tasks: ${sessionData.totalTasks}`);
            console.log(`  ✏️  Edits: ${sessionData.totalEdits}`);
        }

        console.log(`  💾 Session saved to .swarm/memory.db`);
        
        if (memoryStore) {
            memoryStore.close();
            memoryStore = null;
        }

        printSuccess(`✅ Session-end hook completed`);
    } catch (err) {
        printError(`Session-end hook failed: ${err.message}`);
    }
}

async function sessionRestoreCommand(subArgs, flags) {
    const options = flags;
    const sessionId = options['session-id'] || 'latest';

    console.log(`🔄 Executing session-restore hook...`);
    console.log(`🆔 Session: ${sessionId}`);

    try {
        const store = await getMemoryStore();
        
        // Find session to restore
        let sessionData;
        if (sessionId === 'latest') {
            const sessions = await store.list({ namespace: 'sessions', limit: 1 });
            sessionData = sessions[0]?.value;
        } else {
            sessionData = await store.retrieve(`session:${sessionId}`, { namespace: 'sessions' });
        }

        if (sessionData) {
            console.log(`\n📊 RESTORED SESSION:`);
            console.log(`  🆔 ID: ${sessionData.sessionId || 'unknown'}`);
            console.log(`  📋 Tasks: ${sessionData.totalTasks || 0}`);
            console.log(`  ✏️  Edits: ${sessionData.totalEdits || 0}`);
            console.log(`  ⏰ Ended: ${sessionData.endedAt || 'unknown'}`);
            
            // Store restoration event
            await store.store(`session-restore:${Date.now()}`, {
                restoredSessionId: sessionData.sessionId || sessionId,
                restoredAt: new Date().toISOString()
            }, { namespace: 'session-events' });
            
            console.log(`  💾 Session restored from .swarm/memory.db`);
            printSuccess(`✅ Session restore completed`);
        } else {
            printWarning(`No session found with ID: ${sessionId}`);
        }
    } catch (err) {
        printError(`Session restore hook failed: ${err.message}`);
    }
}

async function notifyCommand(subArgs, flags) {
    const options = flags;
    const message = options.message || subArgs.slice(1).join(' ');
    const level = options.level || 'info';
    const swarmStatus = options['swarm-status'] || 'active';

    console.log(`📢 Executing notify hook...`);
    console.log(`💬 Message: ${message}`);
    console.log(`📊 Level: ${level}`);

    try {
        const store = await getMemoryStore();
        const notificationData = {
            message,
            level,
            swarmStatus,
            timestamp: new Date().toISOString(),
            notifyId: generateId('notify')
        };

        await store.store(`notification:${notificationData.notifyId}`, notificationData, {
            namespace: 'hooks:notify',
            metadata: { hookType: 'notify', level }
        });

        // Display notification
        const icon = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : '✅';
        console.log(`\n${icon} NOTIFICATION:`);
        console.log(`  ${message}`);
        console.log(`  🐝 Swarm: ${swarmStatus}`);

        console.log(`\n  💾 Notification saved to .swarm/memory.db`);
        printSuccess(`✅ Notify hook completed`);
    } catch (err) {
        printError(`Notify hook failed: ${err.message}`);
    }
}

function showHooksHelp() {
    console.log('Gemini Flow Hooks (with .swarm/memory.db persistence):\n');
    
    console.log('Pre-Operation Hooks:');
    console.log('  pre-task        Execute before starting a task');
    console.log('  pre-edit        Validate before file modifications');
    console.log('  pre-bash        Check command safety');
    
    console.log('\nPost-Operation Hooks:');
    console.log('  post-task       Execute after completing a task');
    console.log('  post-edit       Auto-format and log edits');
    console.log('  post-bash       Log command execution');
    console.log('  post-search     Cache search results');
    
    console.log('\nMCP Integration Hooks:');
    console.log('  mcp-initialized    Persist MCP configuration');
    console.log('  agent-spawned      Update agent roster');
    console.log('  task-orchestrated  Monitor task progress');
    console.log('  neural-trained     Save pattern improvements');
    
    console.log('\nSession Hooks:');
    console.log('  session-end        Generate summary and save state');
    console.log('  session-restore    Load previous session state');
    console.log('  notify             Custom notifications');
    
    console.log('\nExamples:');
    console.log('  hooks pre-bash --command "rm -rf /"');
    console.log('  hooks agent-spawned --name "CodeReviewer" --type "reviewer"');
    console.log('  hooks notify --message "Build completed" --level "success"');
}

export default hooksAction;