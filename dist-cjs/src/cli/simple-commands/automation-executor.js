import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { printSuccess, printError } from '../utils.js';
function generateId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
export class WorkflowExecutor {
    constructor(options = {}){
        this.options = {
            enableClaude: false,
            nonInteractive: false,
            outputFormat: 'text',
            maxConcurrency: 3,
            timeout: 3600000,
            logLevel: 'info',
            ...options
        };
        if (options.workflowType === 'ml' || options.workflowName?.toLowerCase().includes('mle')) {
            this.options.timeout = 7200000;
        }
        this.executionId = generateId('workflow-exec');
        this.startTime = Date.now();
        this.activeTasks = new Map();
        this.claudeInstances = new Map();
        this.results = new Map();
        this.errors = [];
        this.currentWorkflow = null;
        this.taskOutputStreams = new Map();
        this.enableChaining = options.enableChaining !== false;
        this.hooksEnabled = true;
        this.sessionId = generateId('automation-session');
    }
    async executeWorkflow(workflowData, variables = {}) {
        try {
            this.currentWorkflow = workflowData;
            if (this.options.logLevel === 'quiet') {
                console.log(`🚀 Executing workflow: ${this.executionId}`);
            } else {
                console.log(`🚀 Starting workflow execution: ${this.executionId}`);
                console.log(`📋 Workflow: ${workflowData.name}`);
                console.log(`🎯 Strategy: MLE-STAR Machine Learning Engineering`);
                if (this.options.enableClaude) {
                    console.log(`🤖 Claude CLI Integration: Enabled`);
                }
                if (this.options.nonInteractive) {
                    console.log(`🖥️  Non-Interactive Mode: Enabled`);
                    if (this.options.outputFormat === 'stream-json') {
                        console.log();
                        console.log('● Running MLE-STAR workflow with Claude CLI integration');
                        console.log('  ⎿  Command format: claude --print --output-format stream-json --verbose --dangerously-skip-permissions');
                        console.log('  ⎿  Each agent will show real-time stream output below');
                        console.log('  ⎿  Interactive-style formatting enabled');
                    }
                }
            }
            console.log();
            if (this.hooksEnabled) {
                await this.executeHook('pre-task', {
                    description: `Execute workflow: ${workflowData.name}`,
                    sessionId: this.sessionId
                });
            }
            this.validateWorkflow(workflowData);
            const processedWorkflow = this.applyVariables(workflowData, variables);
            if (this.options.enableClaude) {
                await this.initializeClaudeAgents(processedWorkflow.agents);
            }
            const result = await this.executeWorkflowTasks(processedWorkflow);
            if (this.hooksEnabled) {
                await this.executeHook('post-task', {
                    taskId: this.executionId,
                    sessionId: this.sessionId,
                    result: result.success ? 'success' : 'failure'
                });
            }
            const duration = Date.now() - this.startTime;
            if (result.success) {
                printSuccess(`✅ Workflow completed successfully in ${this.formatDuration(duration)}`);
                console.log(`📊 Tasks: ${result.completedTasks}/${result.totalTasks} completed`);
                console.log(`🆔 Execution ID: ${this.executionId}`);
            } else {
                printError(`❌ Workflow failed after ${this.formatDuration(duration)}`);
                console.log(`📊 Tasks: ${result.completedTasks}/${result.totalTasks} completed`);
                console.log(`❌ Errors: ${this.errors.length}`);
            }
            if (this.options.enableClaude) {
                await this.cleanupClaudeInstances();
            }
            return result;
        } catch (error) {
            printError(`Workflow execution failed: ${error.message}`);
            await this.cleanupClaudeInstances();
            throw error;
        }
    }
    async initializeClaudeAgents(agents) {
        if (!agents || agents.length === 0) {
            return;
        }
        if (!await this.isClaudeAvailable()) {
            throw new Error('Claude CLI not found. Please install Claude Code: https://claude.ai/code');
        }
        if (this.options.nonInteractive) {
            if (this.options.logLevel !== 'quiet') {
                console.log(`🤖 Non-interactive mode: Claude instances will be spawned per task`);
                console.log(`📋 Each task will launch its own Claude process with specific prompts`);
            }
            return;
        } else {
            console.log(`🤖 Interactive mode: Initializing single Claude instance for workflow coordination...`);
            try {
                const masterPrompt = this.createMasterCoordinationPrompt(agents);
                const claudeProcess = await this.spawnClaudeInstance({
                    id: 'master-coordinator',
                    name: 'Workflow Coordinator',
                    type: 'coordinator'
                }, masterPrompt);
                this.claudeInstances.set('master-coordinator', {
                    process: claudeProcess,
                    agent: {
                        id: 'master-coordinator',
                        name: 'Workflow Coordinator',
                        type: 'coordinator'
                    },
                    status: 'active',
                    startTime: Date.now(),
                    agents: agents
                });
                console.log(`  ✅ Master Workflow Coordinator (PID: ${claudeProcess.pid})`);
                console.log(`  🎯 Coordinating ${agents.length} sub-agents via concurrent streams`);
                console.log(`  📋 Agents: ${agents.map((a)=>a.name).join(', ')}`);
            } catch (error) {
                console.error(`  ❌ Failed to initialize master coordinator: ${error.message}`);
                this.errors.push({
                    type: 'master_coordinator_initialization',
                    error: error.message,
                    timestamp: new Date()
                });
            }
            console.log();
        }
    }
    async isClaudeAvailable() {
        try {
            const { execSync } = await import('child_process');
            execSync('which claude', {
                stdio: 'ignore'
            });
            return true;
        } catch  {
            return false;
        }
    }
    async spawnClaudeInstance(agent1, prompt, options = {}) {
        const claudeArgs = [];
        if (this.options.nonInteractive) {
            claudeArgs.push('--print');
            if (this.options.outputFormat === 'stream-json') {
                claudeArgs.push('--output-format', 'stream-json');
                claudeArgs.push('--verbose');
                if (options.inputStream) {
                    claudeArgs.push('--input-format', 'stream-json');
                }
            }
        }
        claudeArgs.push('--dangerously-skip-permissions');
        claudeArgs.push(prompt);
        if (this.options.logLevel === 'debug') {
            const displayPrompt = prompt.length > 100 ? prompt.substring(0, 100) + '...' : prompt;
            const flagsDisplay = this.options.nonInteractive ? this.options.outputFormat === 'stream-json' ? options.inputStream ? '--print --input-format stream-json --output-format stream-json --verbose --dangerously-skip-permissions' : '--print --output-format stream-json --verbose --dangerously-skip-permissions' : '--print --dangerously-skip-permissions' : '--dangerously-skip-permissions';
            console.log(`    🤖 Spawning Claude for ${agent1.name}: claude ${flagsDisplay} "${displayPrompt}"`);
        } else if (this.options.logLevel !== 'quiet') {
            console.log(`    🚀 Starting ${agent1.name}`);
        }
        const stdioConfig = this.options.nonInteractive ? [
            options.inputStream ? 'pipe' : 'inherit',
            'pipe',
            'pipe'
        ] : [
            'inherit',
            'inherit',
            'inherit'
        ];
        const claudeProcess = spawn('claude', claudeArgs, {
            stdio: stdioConfig,
            shell: false
        });
        if (options.inputStream && claudeProcess.stdin) {
            console.log(`    🔗 Chaining: Piping output from previous agent to ${agent1.name}`);
            options.inputStream.pipe(claudeProcess.stdin);
        }
        if (this.options.nonInteractive && this.options.outputFormat === 'stream-json' && claudeProcess.stdout) {
            const { createStreamProcessor } = await import('./stream-processor.js');
            const streamProcessor = createStreamProcessor(agent1.name, this.getAgentIcon(agent1.id), {
                verbose: this.options.logLevel === 'debug',
                logLevel: this.options.logLevel,
                taskId: agent1.taskId,
                agentId: agent1.id,
                display: null
            });
            claudeProcess.stdout.pipe(streamProcessor);
            claudeProcess.stderr.on('data', (data)=>{
                const message = data.toString().trim();
                if (message) {
                    console.error(`    ❌ [${agent1.name}] Error: ${message}`);
                }
            });
        } else if (this.options.nonInteractive && this.options.outputFormat !== 'stream-json') {
            claudeProcess.stdout.on('data', (data)=>{
                console.log(data.toString().trimEnd());
            });
            claudeProcess.stderr.on('data', (data)=>{
                console.error(data.toString().trimEnd());
            });
        }
        claudeProcess.on('error', (error)=>{
            console.error(`❌ Claude instance error for ${agent1.name}:`, error.message);
            this.errors.push({
                type: 'claude_instance_error',
                agent: agent1.id,
                error: error.message,
                timestamp: new Date()
            });
        });
        claudeProcess.on('exit', (code)=>{
            const instance = this.claudeInstances.get(agent1.id);
            if (instance) {
                instance.status = code === 0 ? 'completed' : 'failed';
                instance.exitCode = code;
                instance.endTime = Date.now();
            }
        });
        return claudeProcess;
    }
    handleClaudeStreamEvent(agent1, event) {
        if (this.options.outputFormat === 'stream-json') {
            const summary = this.getEventSummary(event);
            const icon = this.getEventIcon(event.type);
            const output = {
                t: new Date().toISOString().split('T')[1].split('.')[0],
                agent: `${this.getAgentIcon(agent1.id)} ${agent1.name}`,
                phase: this.currentPhase,
                event: `${icon} ${summary}`
            };
            if (event.type === 'tool_use' && event.name) {
                output.tool = event.name;
            } else if (event.type === 'error' && event.error) {
                output.error = event.error;
            }
            console.log(JSON.stringify(output));
        } else {
            switch(event.type){
                case 'tool_use':
                    console.log(`    [${agent1.name}] 🔧 Using tool: ${event.name}`);
                    break;
                case 'message':
                    console.log(`    [${agent1.name}] 💬 ${event.content}`);
                    break;
                case 'completion':
                    console.log(`    [${agent1.name}] ✅ Task completed`);
                    break;
                case 'error':
                    console.error(`    [${agent1.name}] ❌ Error: ${event.error}`);
                    break;
                default:
                    if (this.options.logLevel === 'debug') {
                        console.log(`    [${agent1.name}] ${event.type}: ${JSON.stringify(event)}`);
                    }
            }
        }
    }
    getEventSummary(event) {
        switch(event.type){
            case 'tool_use':
                return `Using ${event.name} tool`;
            case 'message':
                return event.content?.substring(0, 100) + (event.content?.length > 100 ? '...' : '');
            case 'completion':
                return 'Task completed successfully';
            case 'error':
                return `Error: ${event.error}`;
            case 'status':
                return event.status || 'Status update';
            default:
                return event.type;
        }
    }
    getEventIcon(eventType) {
        const icons = {
            'tool_use': '🔧',
            'message': '💬',
            'completion': '✅',
            'error': '❌',
            'status': '📊',
            'init': '🚀',
            'thinking': '🤔',
            'result': '📋'
        };
        return icons[eventType] || '📌';
    }
    createTaskPrompt(task, agent1, workflow) {
        if (task.claudePrompt) {
            let basePrompt = task.claudePrompt;
            const allVariables = {
                ...workflow.variables,
                ...task.input
            };
            for (const [key, value] of Object.entries(allVariables)){
                const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
                basePrompt = basePrompt.replace(pattern, value);
            }
            return `🎯 MLE-STAR AGENT TASK EXECUTION

You are the **${agent1.name}** (${agent1.type}) in a coordinated MLE-STAR automation workflow.

📋 IMMEDIATE TASK:
${basePrompt}

🤖 AGENT ROLE & SPECIALIZATION:
${this.getAgentRoleDescription(agent1.type)}

🎯 AGENT CAPABILITIES:
${agent1.config?.capabilities?.join(', ') || 'general automation'}

🔬 MLE-STAR METHODOLOGY FOCUS:
${this.getMethodologyGuidance(agent1.type)}

🔧 COORDINATION REQUIREMENTS:
1. **HOOKS INTEGRATION** (CRITICAL):
   - BEFORE starting: \`npx claude-flow@alpha hooks pre-task --description "${task.description}"\`
   - AFTER each file operation: \`npx claude-flow@alpha hooks post-edit --file "[filepath]"\`
   - WHEN complete: \`npx claude-flow@alpha hooks post-task --task-id "${task.id}"\`

2. **MEMORY STORAGE** (CRITICAL):
   - Store findings: \`npx claude-flow@alpha memory store "agent/${agent1.id}/findings" "[your_findings]"\`
   - Store results: \`npx claude-flow@alpha memory store "agent/${agent1.id}/results" "[your_results]"\`
   - Check other agents: \`npx claude-flow@alpha memory search "agent/*"\`

3. **SESSION COORDINATION**:
   - Session ID: ${this.sessionId}
   - Execution ID: ${this.executionId}
   - Task ID: ${task.id}
   - Agent ID: ${agent1.id}

4. **WORKFLOW PIPELINE AWARENESS**:
   - Your position: ${this.getAgentPositionInPipeline(agent1.type)}
   - Coordinate with: ${this.getCoordinationPartners(agent1.type)}
   - File naming: Use \`${agent1.id}_[component].[ext]\` convention

5. **OUTPUT REQUIREMENTS**:
   - Use detailed progress reporting
   - Document methodology decisions
   - Provide clear deliverables
   - Follow MLE-STAR best practices for your role

🚀 EXECUTION INSTRUCTIONS:
1. Start with hooks pre-task command
2. Execute your specialized MLE-STAR role
3. Store all findings and results in memory
4. Coordinate with other agents as needed
5. Complete with hooks post-task command
6. Exit when task is fully complete

🎯 SUCCESS CRITERIA:
- Task objective completed according to MLE-STAR methodology
- All coordination hooks executed successfully  
- Results stored in memory for other agents
- Clear documentation of approach and findings
- Ready for next pipeline phase

Begin execution now with the hooks pre-task command.`;
        } else {
            return this.createAgentPrompt(agent1);
        }
    }
    createAgentPrompt(agent1) {
        const { config } = agent1;
        const capabilities = config?.capabilities?.join(', ') || 'general automation';
        return `You are the ${agent1.name} in a coordinated MLE-STAR automation workflow.

🎯 AGENT ROLE: ${agent1.type.toUpperCase()}
📋 CAPABILITIES: ${capabilities}
🆔 AGENT ID: ${agent1.id}

CRITICAL COORDINATION REQUIREMENTS:
1. HOOKS: Use claude-flow hooks for coordination:
   - Run "npx claude-flow@alpha hooks pre-task --description '[your task]'" before starting
   - Run "npx claude-flow@alpha hooks post-edit --file '[file]'" after each file operation  
   - Run "npx claude-flow@alpha hooks post-task --task-id '${agent1.id}'" when complete

2. MEMORY: Store all findings and results:
   - Use "npx claude-flow@alpha memory store 'agent/${agent1.id}/[key]' '[value]'" for important data
   - Check "npx claude-flow@alpha memory search 'agent/*'" for coordination with other agents

3. SESSION: Maintain session coordination:
   - Session ID: ${this.sessionId}
   - Execution ID: ${this.executionId}

AGENT-SPECIFIC CONFIGURATION:
${JSON.stringify(config, null, 2)}

MLE-STAR METHODOLOGY FOCUS:
${this.getMethodologyGuidance(agent1.type)}

WORKFLOW COORDINATION:
- Work with other agents in the pipeline: Search → Foundation → Refinement → Ensemble → Validation
- Share findings through memory system
- Use proper file naming conventions: ${agent1.id}_[component].[ext]
- Follow MLE-STAR best practices for your role

Execute your role in the MLE-STAR workflow with full coordination and hook integration.`;
    }
    createMasterCoordinationPrompt(agents) {
        const workflowData = this.currentWorkflow || {
            name: 'MLE-STAR Workflow',
            description: 'Machine Learning Engineering via Search and Targeted Refinement'
        };
        return `🚀 MLE-STAR WORKFLOW COORDINATION MASTER

You are the MASTER COORDINATOR for a comprehensive MLE-STAR (Machine Learning Engineering via Search and Targeted Refinement) workflow. 

📋 WORKFLOW: ${workflowData.name}
🎯 DESCRIPTION: ${workflowData.description}
🆔 EXECUTION ID: ${this.executionId}
🔄 SESSION ID: ${this.sessionId}

🤖 SUB-AGENTS TO COORDINATE (${agents.length} total):
${agents.map((agent1, index)=>`
${index + 1}. ${agent1.name} (${agent1.type})
   🎯 Role: ${this.getAgentRoleDescription(agent1.type)}
   📋 Capabilities: ${agent1.config?.capabilities?.join(', ') || 'general automation'}
   🆔 ID: ${agent1.id}`).join('')}

🔧 CRITICAL: USE CONCURRENT STREAMS FOR PARALLEL EXECUTION

You MUST coordinate these agents using Claude's concurrent execution capabilities:

1. **USE TASK TOOL FOR CONCURRENT AGENTS**: 
   For each sub-agent, use the Task tool to spawn them with detailed prompts:
   
   Task("You are ${agent.name}. ${detailed_role_prompt}", "${agent.id}", "agent-${agent.type}")

2. **PARALLEL EXECUTION PATTERN**:
   Execute multiple agents simultaneously using the Task tool in a single response:
   
   \`\`\`
   Task("Detailed prompt for Search Agent...", "search_agent", "researcher")
   Task("Detailed prompt for Foundation Agent...", "foundation_agent", "coder") 
   Task("Detailed prompt for Refinement Agent...", "refinement_agent", "optimizer")
   Task("Detailed prompt for Ensemble Agent...", "ensemble_agent", "analyst")
   Task("Detailed prompt for Validation Agent...", "validation_agent", "tester")
   \`\`\`

3. **DETAILED SUB-AGENT PROMPTS**:
   Each Task call should include comprehensive instructions:
   - Specific MLE-STAR role and responsibilities
   - Required actions and deliverables
   - Coordination requirements with other agents
   - Output format specifications
   - Use of --output-format stream-json for progress tracking

4. **COORDINATION WORKFLOW**:
   Phase 1: Search & Foundation (parallel)
   Phase 2: Refinement & Optimization (depends on Phase 1)
   Phase 3: Ensemble & Validation (depends on Phase 2)

5. **OUTPUT MANAGEMENT**:
   Instruct each agent to use appropriate Claude CLI flags:
   - Use --print --output-format stream-json --verbose for real-time progress
   - Coordinate results through file system and memory

🎯 YOUR MISSION:
1. Launch all ${agents.length} sub-agents using concurrent Task calls
2. Provide detailed, specific prompts for each agent's MLE-STAR role
3. Coordinate the workflow execution phases
4. Monitor progress and provide updates
5. Synthesize final results

METHODOLOGY PHASES:
${this.getMasterMethodologyGuide()}

🚀 BEGIN: Start by deploying all sub-agents with detailed prompts using the Task tool for concurrent execution. Each agent should receive comprehensive instructions for their specific MLE-STAR role.`;
    }
    getAgentRoleDescription(agentType) {
        const roles = {
            researcher: 'Web Search & Foundation Discovery - Find state-of-the-art approaches',
            coder: 'Model Implementation & Training Pipeline - Build foundation models',
            optimizer: 'Performance Tuning & Architecture Refinement - Optimize models',
            analyst: 'Ensemble Methods & Meta-Learning - Combine multiple approaches',
            tester: 'Validation & Debugging - Ensure quality and performance',
            coordinator: 'Workflow Orchestration - Manage overall pipeline'
        };
        return roles[agentType] || 'Specialized automation task execution';
    }
    getMasterMethodologyGuide() {
        return `
PHASE 1 - SEARCH & FOUNDATION (Parallel):
🔬 Search Agent: Research ML approaches, algorithms, and best practices
💻 Foundation Agent: Implement baseline models and training infrastructure

PHASE 2 - REFINEMENT (Sequential, depends on Phase 1):
⚡ Refinement Agent: Optimize models, tune hyperparameters, improve performance

PHASE 3 - ENSEMBLE & VALIDATION (Parallel, depends on Phase 2):
🏛️ Ensemble Agent: Combine models, implement voting/stacking strategies
🧪 Validation Agent: Test, debug, validate performance, generate reports

COORDINATION KEY POINTS:
- Use shared file system for intermediate results
- Maintain communication through progress updates
- Each phase builds on previous phases
- Final deliverable: Production-ready ML pipeline`;
    }
    getAgentPositionInPipeline(agentType) {
        const positions = {
            researcher: 'Phase 1: Search & Foundation Discovery (Parallel with Foundation)',
            coder: 'Phase 1: Foundation Model Building (Parallel with Search)',
            optimizer: 'Phase 2: Refinement & Optimization (Sequential, depends on Phase 1)',
            analyst: 'Phase 3: Ensemble & Meta-Learning (Parallel with Validation)',
            tester: 'Phase 3: Validation & Debugging (Parallel with Ensemble)',
            coordinator: 'All Phases: Workflow Orchestration & Coordination'
        };
        return positions[agentType] || 'Specialized task execution';
    }
    getCoordinationPartners(agentType) {
        const partners = {
            researcher: 'Foundation Agent (parallel), Refinement Agent (handoff)',
            coder: 'Search Agent (parallel), Refinement Agent (handoff)',
            optimizer: 'Search & Foundation Agents (input), Ensemble & Validation Agents (handoff)',
            analyst: 'Refinement Agent (input), Validation Agent (parallel)',
            tester: 'All previous agents (validation), Ensemble Agent (parallel)',
            coordinator: 'All agents (orchestration and monitoring)'
        };
        return partners[agentType] || 'Other workflow agents as needed';
    }
    getMethodologyGuidance(agentType) {
        const guidance = {
            researcher: `SEARCH PHASE - Web Research & Foundation Discovery:
- Search for state-of-the-art ML approaches for the problem domain
- Find winning Kaggle solutions and benchmark results
- Identify promising model architectures and techniques
- Document implementation examples and model cards
- Focus on proven, recent approaches with good performance`,
            coder: `FOUNDATION PHASE - Initial Model Building:
- Analyze dataset characteristics and problem type
- Implement baseline models based on research findings
- Create robust preprocessing pipelines
- Build modular, testable code components
- Establish performance baselines for comparison`,
            optimizer: `REFINEMENT PHASE - Targeted Component Optimization:
- Perform ablation analysis to identify high-impact components
- Focus deep optimization on most impactful pipeline elements
- Use iterative improvement with structured feedback
- Implement advanced feature engineering techniques
- Optimize hyperparameters systematically`,
            architect: `ENSEMBLE PHASE - Intelligent Model Combination:
- Create sophisticated ensemble strategies beyond simple averaging
- Implement stacking with meta-learners
- Use dynamic weighting and mixture of experts
- Apply Bayesian model averaging where appropriate
- Optimize ensemble composition for maximum performance`,
            tester: `VALIDATION PHASE - Comprehensive Testing & Debugging:
- Implement rigorous cross-validation strategies
- Detect and prevent data leakage
- Perform error analysis and debugging
- Validate model robustness and generalization
- Ensure production readiness with quality checks`,
            coordinator: `ORCHESTRATION PHASE - Workflow Management:
- Coordinate between all agents and phases
- Monitor progress and performance metrics
- Manage resource allocation and scheduling
- Handle error recovery and workflow adaptation
- Prepare final deployment and documentation`
        };
        return guidance[agentType] || 'Focus on your specialized capabilities and coordinate with other agents.';
    }
    async executeWorkflowTasks(workflow) {
        const { tasks, dependencies = {} } = workflow;
        let completedTasks = 0;
        let failedTasks = 0;
        const totalTasks = tasks.length;
        const taskStatuses = new Map();
        tasks.forEach((task)=>{
            taskStatuses.set(task.id, {
                name: task.name || task.id,
                status: 'pending',
                agent: task.assignTo,
                startTime: null,
                endTime: null,
                summary: ''
            });
        });
        const executionPlan = this.createExecutionPlan(tasks, dependencies);
        console.log(`📋 Executing ${totalTasks} tasks in ${executionPlan.length} phases...`);
        console.log();
        let concurrentDisplay = null;
        for (const [phaseIndex, phaseTasks] of executionPlan.entries()){
            this.currentPhase = `Phase ${phaseIndex + 1}`;
            if (!concurrentDisplay) {
                if (this.options.logLevel === 'quiet') {
                    console.log(`\n🔄 Phase ${phaseIndex + 1}: Running ${phaseTasks.length} tasks`);
                } else {
                    console.log(`\n🔄 Phase ${phaseIndex + 1}: ${phaseTasks.length} concurrent tasks`);
                }
                this.displayTaskBoard(taskStatuses, phaseTasks);
            }
            phaseTasks.forEach((task)=>{
                const status = taskStatuses.get(task.id);
                status.status = 'in-progress';
                status.startTime = Date.now();
            });
            const phasePromises = phaseTasks.map(async (task)=>{
                const taskStatus = taskStatuses.get(task.id);
                try {
                    console.log(`\n  🚀 Starting: ${task.name || task.id}`);
                    console.log(`     Agent: ${task.assignTo}`);
                    console.log(`     Description: ${task.description?.substring(0, 80)}...`);
                    const result = await this.executeTask(task, workflow);
                    taskStatus.status = result.success ? 'completed' : 'failed';
                    taskStatus.endTime = Date.now();
                    taskStatus.summary = result.success ? `✅ Completed in ${this.formatDuration(result.duration)}` : `❌ Failed: ${result.error?.message || 'Unknown error'}`;
                    return result;
                } catch (error) {
                    taskStatus.status = 'failed';
                    taskStatus.endTime = Date.now();
                    taskStatus.summary = `❌ Error: ${error.message}`;
                    throw error;
                }
            });
            const phaseResults = await Promise.allSettled(phasePromises);
            for (const [taskIndex, result] of phaseResults.entries()){
                const task = phaseTasks[taskIndex];
                const taskStatus = taskStatuses.get(task.id);
                if (result.status === 'fulfilled' && result.value.success) {
                    completedTasks++;
                    this.results.set(task.id, result.value);
                } else {
                    failedTasks++;
                    const error = result.status === 'rejected' ? result.reason : result.value.error;
                    this.errors.push({
                        type: 'task_execution',
                        task: task.id,
                        error: error.message || error,
                        timestamp: new Date()
                    });
                    if (workflow.settings?.failurePolicy === 'fail-fast') {
                        console.log(`\n🛑 Failing fast due to task failure`);
                        break;
                    }
                }
            }
            if (!concurrentDisplay) {
                console.log(`\n📊 Phase ${phaseIndex + 1} Complete:`);
                this.displayTaskBoard(taskStatuses);
            }
            if (workflow.settings?.failurePolicy === 'fail-fast' && failedTasks > 0) {
                break;
            }
        }
        if (!concurrentDisplay) {
            console.log(`\n📊 Final Workflow Summary:`);
            this.displayTaskBoard(taskStatuses);
        } else {
            concurrentDisplay.stop();
            console.log();
        }
        return {
            success: failedTasks === 0,
            totalTasks,
            completedTasks,
            failedTasks,
            executionId: this.executionId,
            duration: Date.now() - this.startTime,
            results: Object.fromEntries(this.results),
            errors: this.errors
        };
    }
    displayTaskBoard(taskStatuses, highlightTasks = []) {
        if (this.options.logLevel === 'quiet') {
            const totalTasks = taskStatuses.size;
            const completedTasks = Array.from(taskStatuses.values()).filter((s)=>s.status === 'completed').length;
            const activeTasks = Array.from(taskStatuses.values()).filter((s)=>s.status === 'in-progress').length;
            console.log(`📊 Progress: ${completedTasks}/${totalTasks} completed, ${activeTasks} active`);
            return;
        }
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
        const frameIndex = Math.floor(Date.now() / 100) % frames.length;
        const spinner = frames[frameIndex];
        console.log('\n╔═══════════════════════════════════════════════════════════════╗');
        console.log('║                    🤖 CONCURRENT TASK STATUS                   ║');
        console.log('╠═══════════════════════════════════════════════════════════════╣');
        const statusGroups = {
            'in-progress': [],
            'completed': [],
            'failed': [],
            'pending': []
        };
        taskStatuses.forEach((status, taskId)=>{
            statusGroups[status.status].push({
                taskId,
                ...status
            });
        });
        if (statusGroups['in-progress'].length > 0) {
            console.log(`║ ${spinner} RUNNING (${statusGroups['in-progress'].length} agents):                                      ║`);
            statusGroups['in-progress'].forEach((task)=>{
                const duration = task.startTime ? this.formatDuration(Date.now() - task.startTime) : '';
                const progress = this.getProgressBar(Date.now() - task.startTime, 60000);
                const agentIcon = this.getAgentIcon(task.agent);
                console.log(`║   ${agentIcon} ${task.name.padEnd(25)} ${progress} ${duration.padStart(8)} ║`);
            });
        }
        if (statusGroups['completed'].length > 0) {
            console.log(`║ ✅ COMPLETED (${statusGroups['completed'].length}):                                           ║`);
            statusGroups['completed'].forEach((task)=>{
                const duration = task.endTime && task.startTime ? this.formatDuration(task.endTime - task.startTime) : '';
                console.log(`║   ✓ ${task.name.padEnd(35)} ${duration.padStart(10)} ║`);
            });
        }
        if (statusGroups['failed'].length > 0) {
            console.log(`║ ❌ FAILED (${statusGroups['failed'].length}):                                              ║`);
            statusGroups['failed'].forEach((task)=>{
                const errorMsg = (task.summary || '').substring(0, 25);
                console.log(`║   ✗ ${task.name.padEnd(25)} ${errorMsg.padEnd(20)} ║`);
            });
        }
        if (statusGroups['pending'].length > 0) {
            console.log(`║ ⏳ QUEUED: ${statusGroups['pending'].length} tasks waiting                                 ║`);
        }
        const total = taskStatuses.size;
        const completed = statusGroups['completed'].length;
        const failed = statusGroups['failed'].length;
        const progress = total > 0 ? Math.floor((completed + failed) / total * 100) : 0;
        console.log('╠═══════════════════════════════════════════════════════════════╣');
        console.log(`║ 📊 Progress: ${progress}% (${completed}/${total}) │ ⚡ Active: ${statusGroups['in-progress'].length} │ ❌ Failed: ${failed}  ║`);
        console.log('╚═══════════════════════════════════════════════════════════════╝');
    }
    getProgressBar(elapsed, expected) {
        const progress = Math.min(elapsed / expected, 1);
        const filled = Math.floor(progress * 10);
        const empty = 10 - filled;
        return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
    }
    getAgentIcon(agentId) {
        const icons = {
            'search': '🔍',
            'foundation': '🏗️',
            'refinement': '🔧',
            'ensemble': '🎯',
            'validation': '✅',
            'coordinator': '🎮',
            'researcher': '🔬',
            'coder': '💻',
            'optimizer': '⚡',
            'architect': '🏛️',
            'tester': '🧪'
        };
        const type = agentId?.split('_')[0] || 'default';
        return icons[type] || '🤖';
    }
    async executeTask(task, workflow) {
        const startTime = Date.now();
        try {
            if (this.hooksEnabled) {
                await this.executeHook('notify', {
                    message: `Starting task: ${task.name || task.id}`,
                    sessionId: this.sessionId
                });
            }
            if (this.options.nonInteractive && this.options.outputFormat === 'stream-json') {
                console.log(`\n● ${task.name || task.id} - Starting Execution`);
                console.log(`  ⎿  ${task.description}`);
                console.log(`  ⎿  Agent: ${task.assignTo}`);
            } else {
                console.log(`    🔄 Executing: ${task.description}`);
            }
            if (!this.options.enableClaude) {
                const executionTime = Math.min(1000 + Math.random() * 3000, task.timeout || 30000);
                await new Promise((resolve)=>setTimeout(resolve, executionTime));
                const result = {
                    success: true,
                    taskId: task.id,
                    duration: Date.now() - startTime,
                    output: {
                        status: 'completed',
                        agent: task.assignTo,
                        executionTime: Date.now() - startTime,
                        metadata: {
                            timestamp: new Date().toISOString(),
                            executionId: this.executionId,
                            mode: 'simulation'
                        }
                    }
                };
                if (this.hooksEnabled) {
                    await this.storeTaskResult(task.id, result.output);
                }
                return result;
            } else {
                const masterCoordinator = this.claudeInstances.get('master-coordinator');
                if (masterCoordinator && !this.options.nonInteractive) {
                    console.log(`    🎯 Task delegated to Master Coordinator: ${task.description}`);
                    const completionPromise = new Promise((resolve, reject)=>{
                        masterCoordinator.process.on('exit', (code)=>{
                            if (code === 0) {
                                resolve({
                                    success: true,
                                    code
                                });
                            } else {
                                reject(new Error(`Master coordinator exited with code ${code}`));
                            }
                        });
                        masterCoordinator.process.on('error', (err)=>{
                            reject(err);
                        });
                    });
                    const timeout = Math.max(this.options.timeout, 1800000);
                    const timeoutPromise = new Promise((_, reject)=>{
                        setTimeout(()=>reject(new Error('Interactive session timeout')), timeout);
                    });
                    try {
                        await Promise.race([
                            completionPromise,
                            timeoutPromise
                        ]);
                        const result = {
                            success: true,
                            taskId: task.id,
                            duration: Date.now() - startTime,
                            output: {
                                status: 'completed',
                                agent: 'master-coordinator',
                                executionTime: Date.now() - startTime,
                                metadata: {
                                    timestamp: new Date().toISOString(),
                                    executionId: this.executionId,
                                    mode: 'interactive-coordination'
                                }
                            }
                        };
                        if (this.hooksEnabled) {
                            await this.storeTaskResult(task.id, result.output);
                        }
                        return result;
                    } catch (error) {
                        throw new Error(`Task execution failed: ${error.message}`);
                    }
                }
                const claudeInstance = this.claudeInstances.get(task.assignTo);
                if (!claudeInstance) {
                    const agent1 = workflow.agents.find((a)=>a.id === task.assignTo);
                    if (!agent1) {
                        throw new Error(`No agent definition found for: ${task.assignTo}`);
                    }
                    const taskPrompt = this.createTaskPrompt(task, agent1, workflow);
                    let chainOptions = {};
                    if (this.enableChaining && this.options.outputFormat === 'stream-json' && task.depends?.length > 0) {
                        const lastDependency = task.depends[task.depends.length - 1];
                        const dependencyStream = this.taskOutputStreams.get(lastDependency);
                        if (dependencyStream) {
                            console.log(`    🔗 Enabling stream chaining from ${lastDependency} to ${task.id}`);
                            chainOptions.inputStream = dependencyStream;
                        }
                    }
                    const taskClaudeProcess = await this.spawnClaudeInstance(agent1, taskPrompt, chainOptions);
                    if (this.enableChaining && this.options.outputFormat === 'stream-json' && taskClaudeProcess.stdout) {
                        this.taskOutputStreams.set(task.id, taskClaudeProcess.stdout);
                    }
                    this.claudeInstances.set(agent1.id, {
                        process: taskClaudeProcess,
                        agent: agent1,
                        status: 'active',
                        startTime: Date.now(),
                        taskId: task.id
                    });
                    const baseTimeout = this.options.timeout || 60000;
                    const isMLTask = task.type?.toLowerCase().includes('ml') || task.type?.toLowerCase().includes('model') || task.type?.toLowerCase().includes('search') || task.type?.toLowerCase().includes('analysis') || this.options.workflowType === 'ml';
                    const timeout = task.timeout || (isMLTask ? Math.max(baseTimeout, 300000) : baseTimeout);
                    if (this.options.logLevel === 'debug' || this.options.verbose) {
                        console.log(`    ⏱️  Timeout: ${this.formatDuration(timeout)} (Base: ${this.formatDuration(baseTimeout)}, ML Task: ${isMLTask})`);
                    }
                    const completionPromise = new Promise((resolve, reject)=>{
                        taskClaudeProcess.on('exit', (code)=>{
                            if (code === 0) {
                                resolve({
                                    success: true,
                                    code
                                });
                            } else {
                                reject(new Error(`Process exited with code ${code}`));
                            }
                        });
                        taskClaudeProcess.on('error', (err)=>{
                            reject(err);
                        });
                    });
                    const timeoutPromise = new Promise((_, reject)=>{
                        const actualTimeout = isMLTask ? Math.max(timeout, 600000) : timeout;
                        setTimeout(()=>reject(new Error('Task timeout')), actualTimeout);
                    });
                    try {
                        await Promise.race([
                            completionPromise,
                            timeoutPromise
                        ]);
                        const result = {
                            success: true,
                            taskId: task.id,
                            duration: Date.now() - startTime,
                            output: {
                                status: 'completed',
                                agent: task.assignTo,
                                executionTime: Date.now() - startTime,
                                metadata: {
                                    timestamp: new Date().toISOString(),
                                    executionId: this.executionId,
                                    mode: 'claude-task-execution'
                                }
                            }
                        };
                        if (this.hooksEnabled) {
                            await this.storeTaskResult(task.id, result.output);
                        }
                        return result;
                    } catch (error) {
                        throw error;
                    }
                } else {
                    const agent1 = claudeInstance.agent;
                    const taskPrompt = this.createTaskPrompt(task, agent1, workflow);
                    let chainOptions = {};
                    if (this.enableChaining && this.options.outputFormat === 'stream-json' && task.depends?.length > 0) {
                        const lastDependency = task.depends[task.depends.length - 1];
                        const dependencyStream = this.taskOutputStreams.get(lastDependency);
                        if (dependencyStream) {
                            console.log(`    🔗 Enabling stream chaining from ${lastDependency} to ${task.id}`);
                            chainOptions.inputStream = dependencyStream;
                        }
                    }
                    const taskClaudeProcess = await this.spawnClaudeInstance(agent1, taskPrompt, chainOptions);
                    if (this.enableChaining && this.options.outputFormat === 'stream-json' && taskClaudeProcess.stdout) {
                        this.taskOutputStreams.set(task.id, taskClaudeProcess.stdout);
                    }
                    const baseTimeout = this.options.timeout || 60000;
                    const isMLTask = task.type?.toLowerCase().includes('ml') || task.type?.toLowerCase().includes('model') || task.type?.toLowerCase().includes('search') || task.type?.toLowerCase().includes('analysis') || this.options.workflowType === 'ml';
                    const timeout = task.timeout || (isMLTask ? Math.max(baseTimeout, 300000) : baseTimeout);
                    if (this.options.logLevel === 'debug' || this.options.verbose) {
                        console.log(`    ⏱️  Timeout: ${this.formatDuration(timeout)} (Base: ${this.formatDuration(baseTimeout)}, ML Task: ${isMLTask})`);
                    }
                    const completionPromise = new Promise((resolve, reject)=>{
                        taskClaudeProcess.on('exit', (code)=>{
                            if (code === 0) {
                                resolve({
                                    success: true,
                                    code
                                });
                            } else {
                                reject(new Error(`Process exited with code ${code}`));
                            }
                        });
                        taskClaudeProcess.on('error', (err)=>{
                            reject(err);
                        });
                    });
                    const timeoutPromise = new Promise((_, reject)=>{
                        const actualTimeout = isMLTask ? Math.max(timeout, 600000) : timeout;
                        setTimeout(()=>reject(new Error('Task timeout')), actualTimeout);
                    });
                    try {
                        await Promise.race([
                            completionPromise,
                            timeoutPromise
                        ]);
                        const result = {
                            success: true,
                            taskId: task.id,
                            duration: Date.now() - startTime,
                            output: {
                                status: 'completed',
                                agent: task.assignTo,
                                executionTime: Date.now() - startTime,
                                metadata: {
                                    timestamp: new Date().toISOString(),
                                    executionId: this.executionId,
                                    mode: 'claude-task-execution'
                                }
                            }
                        };
                        if (this.hooksEnabled) {
                            await this.storeTaskResult(task.id, result.output);
                        }
                        return result;
                    } catch (error) {
                        throw error;
                    }
                }
            }
        } catch (error) {
            return {
                success: false,
                taskId: task.id,
                duration: Date.now() - startTime,
                error: error
            };
        }
    }
    createExecutionPlan(tasks, dependencies) {
        const taskMap = new Map(tasks.map((task)=>[
                task.id,
                task
            ]));
        const completed = new Set();
        const phases = [];
        while(completed.size < tasks.length){
            const readyTasks = tasks.filter((task)=>{
                if (completed.has(task.id)) return false;
                const deps = task.depends || dependencies[task.id] || [];
                return deps.every((dep)=>completed.has(dep));
            });
            if (readyTasks.length === 0) {
                throw new Error('Circular dependency detected or invalid dependencies');
            }
            phases.push(readyTasks);
            readyTasks.forEach((task)=>completed.add(task.id));
        }
        return phases;
    }
    async executeHook(hookType, params) {
        try {
            const { execSync } = await import('child_process');
            let hookCommand = `npx claude-flow@alpha hooks ${hookType}`;
            if (params.description) {
                hookCommand += ` --description "${params.description}"`;
            }
            if (params.file) {
                hookCommand += ` --file "${params.file}"`;
            }
            if (params.taskId) {
                hookCommand += ` --task-id "${params.taskId}"`;
            }
            if (params.sessionId) {
                hookCommand += ` --session-id "${params.sessionId}"`;
            }
            if (params.message) {
                hookCommand += ` --message "${params.message}"`;
            }
            execSync(hookCommand, {
                stdio: 'pipe'
            });
        } catch (error) {
            console.debug(`Hook ${hookType} failed:`, error.message);
        }
    }
    async storeTaskResult(taskId, result) {
        try {
            const { execSync } = await import('child_process');
            const resultJson = JSON.stringify(result);
            execSync(`npx claude-flow@alpha memory store "workflow/${this.executionId}/${taskId}" '${resultJson}'`, {
                stdio: 'pipe'
            });
        } catch (error) {
            console.debug(`Failed to store task result for ${taskId}:`, error.message);
        }
    }
    validateWorkflow(workflow) {
        if (!workflow.name) {
            throw new Error('Workflow name is required');
        }
        if (!workflow.tasks || workflow.tasks.length === 0) {
            throw new Error('Workflow must contain at least one task');
        }
        for (const task of workflow.tasks){
            if (!task.id || !task.type || !task.description) {
                throw new Error(`Task ${task.id || 'unknown'} is missing required fields`);
            }
        }
        if (workflow.agents) {
            const agentIds = new Set(workflow.agents.map((a)=>a.id));
            for (const task of workflow.tasks){
                if (task.assignTo && !agentIds.has(task.assignTo)) {
                    throw new Error(`Task ${task.id} assigned to unknown agent: ${task.assignTo}`);
                }
            }
        }
    }
    applyVariables(workflow, variables) {
        const allVariables = {
            ...workflow.variables,
            ...variables
        };
        const workflowStr = JSON.stringify(workflow);
        let processedStr = workflowStr;
        for (const [key, value] of Object.entries(allVariables)){
            const pattern = new RegExp(`\\$\\{${key}\\}`, 'g');
            processedStr = processedStr.replace(pattern, value);
        }
        return JSON.parse(processedStr);
    }
    async cleanupClaudeInstances() {
        if (this.claudeInstances.size === 0) return;
        console.log('🧹 Cleaning up Claude instances...');
        for (const [agentId, instance] of this.claudeInstances.entries()){
            try {
                if (instance.process && !instance.process.killed) {
                    instance.process.kill('SIGTERM');
                    setTimeout(()=>{
                        if (!instance.process.killed) {
                            instance.process.kill('SIGKILL');
                        }
                    }, 5000);
                }
                console.log(`  ✅ Cleaned up ${instance.agent.name}`);
            } catch (error) {
                console.error(`  ❌ Error cleaning up ${instance.agent.name}:`, error.message);
            }
        }
        this.claudeInstances.clear();
    }
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
}
export async function loadWorkflowFromFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        if (filePath.endsWith('.json')) {
            return JSON.parse(content);
        } else if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
            throw new Error('YAML workflows not yet supported');
        } else {
            throw new Error('Unsupported workflow file format. Use .json or .yaml');
        }
    } catch (error) {
        throw new Error(`Failed to load workflow: ${error.message}`);
    }
}
export function getMLEStarWorkflowPath() {
    return join(process.cwd(), 'src', 'cli', 'simple-commands', 'templates', 'mle-star-workflow.json');
}

//# sourceMappingURL=automation-executor.js.map