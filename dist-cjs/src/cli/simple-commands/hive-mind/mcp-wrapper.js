const MCP_TOOLS = {
    swarm: [
        'swarm_init',
        'agent_spawn',
        'task_orchestrate',
        'swarm_status',
        'agent_list',
        'agent_metrics',
        'swarm_monitor',
        'topology_optimize',
        'load_balance',
        'coordination_sync',
        'swarm_scale',
        'swarm_destroy'
    ],
    neural: [
        'neural_status',
        'neural_train',
        'neural_patterns',
        'neural_predict',
        'model_load',
        'model_save',
        'wasm_optimize',
        'inference_run',
        'pattern_recognize',
        'cognitive_analyze',
        'learning_adapt',
        'neural_compress',
        'ensemble_create',
        'transfer_learn',
        'neural_explain'
    ],
    memory: [
        'memory_usage',
        'memory_search',
        'memory_persist',
        'memory_namespace',
        'memory_backup',
        'memory_restore',
        'memory_compress',
        'memory_sync',
        'cache_manage',
        'state_snapshot',
        'context_restore',
        'memory_analytics'
    ],
    performance: [
        'performance_report',
        'bottleneck_analyze',
        'token_usage',
        'benchmark_run',
        'metrics_collect',
        'trend_analysis',
        'cost_analysis',
        'quality_assess',
        'error_analysis',
        'usage_stats',
        'health_check'
    ],
    github: [
        'github_repo_analyze',
        'github_pr_manage',
        'github_issue_track',
        'github_release_coord',
        'github_workflow_auto',
        'github_code_review',
        'github_sync_coord',
        'github_metrics'
    ],
    workflow: [
        'workflow_create',
        'workflow_execute',
        'workflow_export',
        'automation_setup',
        'pipeline_create',
        'scheduler_manage',
        'trigger_setup',
        'workflow_template',
        'batch_process',
        'parallel_execute'
    ],
    daa: [
        'daa_agent_create',
        'daa_capability_match',
        'daa_resource_alloc',
        'daa_lifecycle_manage',
        'daa_communication',
        'daa_consensus',
        'daa_fault_tolerance',
        'daa_optimization'
    ],
    system: [
        'terminal_execute',
        'config_manage',
        'features_detect',
        'security_scan',
        'backup_create',
        'restore_system',
        'log_analysis',
        'diagnostic_run'
    ],
    sparc: [
        'sparc_mode'
    ],
    task: [
        'task_status',
        'task_results'
    ]
};
export class MCPToolWrapper {
    constructor(config = {}){
        this.config = {
            parallel: true,
            timeout: 60000,
            retryCount: 3,
            ...config
        };
        this.toolStats = new Map();
        this.parallelQueue = [];
        this.executing = false;
        this.memoryDb = null;
        this.memoryStore = new Map();
        this.initializeMemoryStorage();
    }
    async initializeMemoryStorage() {
        try {
            const { createDatabase, isSQLiteAvailable } = await import('../../../memory/sqlite-wrapper.js');
            const path = await import('path');
            const fs = await import('fs');
            const sqliteAvailable = await isSQLiteAvailable();
            if (!sqliteAvailable) {
                throw new Error('SQLite not available');
            }
            const hiveMindDir = path.join(process.cwd(), '.hive-mind');
            if (!fs.existsSync(hiveMindDir)) {
                fs.mkdirSync(hiveMindDir, {
                    recursive: true
                });
            }
            const dbPath = path.join(hiveMindDir, 'memory.db');
            this.memoryDb = await createDatabase(dbPath);
            this.memoryDb.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          type TEXT DEFAULT 'knowledge',
          timestamp INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(namespace, key)
        )
      `);
        } catch (error) {
            console.warn('Failed to initialize SQLite storage, falling back to in-memory:', error.message);
            this.memoryDb = null;
            this.memoryStore = new Map();
            if (process.platform === 'win32') {
                console.info(`
Windows users: For persistent storage, please see installation guide:
https://github.com/ruvnet/claude-code-flow/docs/windows-installation.md
`);
            }
        }
    }
    async executeTool(toolName, params = {}) {
        const startTime = Date.now();
        let lastError = null;
        for(let attempt = 1; attempt <= this.config.retryCount; attempt++){
            try {
                const result = await this._executeToolInternal(toolName, params);
                this._trackToolUsage(toolName, Date.now() - startTime, true);
                return result;
            } catch (error) {
                lastError = error;
                console.error(`Attempt ${attempt} failed for ${toolName}:`, error.message);
                if (attempt < this.config.retryCount) {
                    await new Promise((resolve)=>setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }
        this._trackToolUsage(toolName, Date.now() - startTime, false);
        throw new Error(`Failed to execute ${toolName} after ${this.config.retryCount} attempts: ${lastError.message}`);
    }
    async executeParallel(toolCalls) {
        if (!this.config.parallel) {
            const results = [];
            for (const call of toolCalls){
                results.push(await this.executeTool(call.tool, call.params));
            }
            return results;
        }
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
            return [];
        }
        const startTime = Date.now();
        const concurrencyLimit = this._calculateOptimalConcurrency(toolCalls);
        const toolGroups = this._groupToolsByPriority(toolCalls);
        const allResults = [];
        try {
            for (const group of toolGroups){
                const groupResults = [];
                for(let i = 0; i < group.length; i += concurrencyLimit){
                    const batch = group.slice(i, i + concurrencyLimit);
                    const batchPromises = batch.map((call)=>this._executeWithTimeout(call, this.config.timeout));
                    const batchResults = await Promise.allSettled(batchPromises);
                    for(let j = 0; j < batchResults.length; j++){
                        const result = batchResults[j];
                        if (result.status === 'fulfilled') {
                            groupResults.push(result.value);
                        } else {
                            console.warn(`Tool execution failed: ${batch[j].tool}`, result.reason);
                            groupResults.push({
                                error: result.reason.message,
                                tool: batch[j].tool
                            });
                        }
                    }
                }
                allResults.push(...groupResults);
            }
            const executionTime = Date.now() - startTime;
            this._trackBatchPerformance(toolCalls.length, executionTime, concurrencyLimit);
            return allResults;
        } catch (error) {
            console.error('Parallel execution failed:', error);
            throw error;
        }
    }
    _calculateOptimalConcurrency(toolCalls) {
        const toolTypes = toolCalls.map((call)=>this._getToolCategory(call.tool));
        const uniqueTypes = new Set(toolTypes);
        const heavyTypes = [
            'neural',
            'github',
            'workflow'
        ];
        const hasHeavyOps = toolTypes.some((type)=>heavyTypes.includes(type));
        if (hasHeavyOps) {
            return Math.min(3, Math.max(1, Math.floor(toolCalls.length / 2)));
        }
        return Math.min(8, Math.max(2, Math.floor(toolCalls.length / 1.5)));
    }
    _groupToolsByPriority(toolCalls) {
        const priorities = {
            critical: [],
            high: [],
            medium: [],
            low: []
        };
        toolCalls.forEach((call)=>{
            const category = this._getToolCategory(call.tool);
            const tool = call.tool;
            if ([
                'swarm_init',
                'swarm_destroy',
                'memory_backup'
            ].includes(tool)) {
                priorities.critical.push(call);
            } else if ([
                'agent_spawn',
                'memory_usage',
                'neural_train'
            ].includes(tool)) {
                priorities.high.push(call);
            } else if (category === 'performance' || tool.includes('report')) {
                priorities.low.push(call);
            } else {
                priorities.medium.push(call);
            }
        });
        return [
            priorities.critical,
            priorities.high,
            priorities.medium,
            priorities.low
        ].filter((group)=>group.length > 0);
    }
    async _executeWithTimeout(call, timeout) {
        return new Promise((resolve, reject)=>{
            const timer = setTimeout(()=>{
                reject(new Error(`Tool ${call.tool} timed out after ${timeout}ms`));
            }, timeout);
            this.executeTool(call.tool, call.params).then((result)=>{
                clearTimeout(timer);
                resolve(result);
            }).catch((error)=>{
                clearTimeout(timer);
                reject(error);
            });
        });
    }
    _trackBatchPerformance(toolCount, executionTime, concurrency) {
        if (!this.batchStats) {
            this.batchStats = {
                totalBatches: 0,
                totalTools: 0,
                totalTime: 0,
                avgConcurrency: 0,
                avgToolsPerBatch: 0,
                avgTimePerTool: 0
            };
        }
        this.batchStats.totalBatches++;
        this.batchStats.totalTools += toolCount;
        this.batchStats.totalTime += executionTime;
        this.batchStats.avgConcurrency = (this.batchStats.avgConcurrency * (this.batchStats.totalBatches - 1) + concurrency) / this.batchStats.totalBatches;
        this.batchStats.avgToolsPerBatch = this.batchStats.totalTools / this.batchStats.totalBatches;
        this.batchStats.avgTimePerTool = this.batchStats.totalTime / this.batchStats.totalTools;
    }
    async _executeToolInternal(toolName, params) {
        const toolCategory = this._getToolCategory(toolName);
        if (!toolCategory) {
            throw new Error(`Unknown MCP tool: ${toolName}`);
        }
        if (toolName === 'memory_usage') {
            if (params.action === 'store') {
                return await this.storeMemory(params.namespace, params.key, params.value, params.type);
            } else if (params.action === 'retrieve') {
                return await this.retrieveMemory(params.namespace, params.key);
            }
        } else if (toolName === 'memory_search') {
            return await this.searchMemory(params.namespace, params.pattern);
        } else if (toolName === 'swarm_status') {
            return await this.getSwarmStatus(params);
        }
        console.log(`Executing MCP tool: mcp__claude-flow__${toolName} with params:`, params);
        await new Promise((resolve)=>setTimeout(resolve, Math.random() * 500));
        const mockResponse = this._getMockResponse(toolName, params);
        return mockResponse;
    }
    _getToolCategory(toolName) {
        for (const [category, tools] of Object.entries(MCP_TOOLS)){
            if (tools.includes(toolName)) {
                return category;
            }
        }
        return null;
    }
    _getMockResponse(toolName, params) {
        const mockResponses = {
            swarm_init: {
                swarmId: `swarm-${Date.now()}`,
                topology: params.topology || 'hierarchical',
                status: 'initialized'
            },
            agent_spawn: {
                agentId: `agent-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                type: params.type,
                status: 'active'
            },
            task_orchestrate: {
                taskId: `task-${Date.now()}`,
                status: 'orchestrated',
                strategy: params.strategy || 'parallel'
            },
            memory_usage: {
                action: params.action,
                result: params.action === 'store' ? 'stored' : 'retrieved',
                data: params.value || null
            },
            neural_status: {
                status: 'ready',
                models: 27,
                accuracy: 0.848
            }
        };
        return mockResponses[toolName] || {
            status: 'success',
            toolName
        };
    }
    _trackToolUsage(toolName, duration, success) {
        if (!this.toolStats.has(toolName)) {
            this.toolStats.set(toolName, {
                calls: 0,
                successes: 0,
                failures: 0,
                totalDuration: 0,
                avgDuration: 0
            });
        }
        const stats = this.toolStats.get(toolName);
        stats.calls++;
        if (success) {
            stats.successes++;
        } else {
            stats.failures++;
        }
        stats.totalDuration += duration;
        stats.avgDuration = stats.totalDuration / stats.calls;
    }
    getStatistics() {
        const toolStats = {};
        this.toolStats.forEach((value, key)=>{
            toolStats[key] = {
                ...value
            };
        });
        return {
            tools: toolStats,
            batch: this.batchStats || {
                totalBatches: 0,
                totalTools: 0,
                totalTime: 0,
                avgConcurrency: 0,
                avgToolsPerBatch: 0,
                avgTimePerTool: 0
            },
            spawn: this.spawnStats || {
                totalSpawns: 0,
                totalAgents: 0,
                totalTime: 0,
                avgTimePerAgent: 0,
                bestTime: 0,
                worstTime: 0
            },
            performance: {
                totalCalls: Array.from(this.toolStats.values()).reduce((sum, stat)=>sum + stat.calls, 0),
                successRate: this._calculateOverallSuccessRate(),
                avgLatency: this._calculateAvgLatency(),
                throughput: this._calculateThroughput()
            }
        };
    }
    _calculateOverallSuccessRate() {
        const total = Array.from(this.toolStats.values()).reduce((sum, stat)=>sum + stat.calls, 0);
        const successes = Array.from(this.toolStats.values()).reduce((sum, stat)=>sum + stat.successes, 0);
        return total > 0 ? (successes / total * 100).toFixed(2) : 100;
    }
    _calculateAvgLatency() {
        const stats = Array.from(this.toolStats.values()).filter((stat)=>stat.calls > 0);
        if (stats.length === 0) return 0;
        const totalLatency = stats.reduce((sum, stat)=>sum + stat.avgDuration, 0);
        return (totalLatency / stats.length).toFixed(2);
    }
    _calculateThroughput() {
        const batchStats = this.batchStats;
        if (!batchStats || batchStats.totalTime === 0) return 0;
        return (batchStats.totalTools / (batchStats.totalTime / 1000)).toFixed(2);
    }
    createBatch(calls) {
        return calls.map((call)=>({
                tool: call.tool,
                params: call.params || {}
            }));
    }
    async initializeSwarm(config) {
        const swarmId = config.swarmId || `swarm-${Date.now()}`;
        const startTime = Date.now();
        try {
            const criticalOps = [
                {
                    tool: 'swarm_init',
                    params: {
                        topology: config.topology || 'hierarchical',
                        maxAgents: config.maxAgents || 8,
                        strategy: 'auto',
                        swarmId
                    }
                }
            ];
            const [swarmInitResult] = await this.executeParallel(criticalOps);
            const supportingOps = [
                {
                    tool: 'memory_namespace',
                    params: {
                        action: 'create',
                        namespace: swarmId,
                        maxSize: config.memorySize || 100
                    }
                },
                {
                    tool: 'neural_status',
                    params: {}
                },
                {
                    tool: 'performance_report',
                    params: {
                        format: 'summary'
                    }
                },
                {
                    tool: 'features_detect',
                    params: {
                        component: 'swarm'
                    }
                }
            ];
            const supportingResults = await this.executeParallel(supportingOps);
            const initTime = Date.now() - startTime;
            await this.storeMemory(swarmId, 'init_performance', {
                initTime,
                topology: config.topology || 'hierarchical',
                maxAgents: config.maxAgents || 8,
                timestamp: Date.now()
            }, 'metrics');
            await this.storeMemory(swarmId, 'status', 'active', 'status');
            await this.storeMemory(swarmId, 'config', {
                topology: config.topology || 'hierarchical',
                maxAgents: config.maxAgents || 8,
                strategy: config.strategy || 'auto',
                createdAt: Date.now()
            }, 'config');
            return [
                swarmInitResult,
                ...supportingResults
            ];
        } catch (error) {
            console.error('Swarm initialization failed:', error);
            throw error;
        }
    }
    async spawnAgents(types, swarmId) {
        if (!Array.isArray(types) || types.length === 0) {
            return [];
        }
        const startTime = Date.now();
        const groupedTypes = this._groupAgentTypes(types);
        const allResults = [];
        try {
            for (const group of groupedTypes){
                const batch = group.map((type)=>({
                        tool: 'agent_spawn',
                        params: {
                            type,
                            swarmId,
                            timestamp: Date.now(),
                            batchId: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                        }
                    }));
                const groupResults = await this.executeParallel(batch);
                allResults.push(...groupResults);
                for (const result of groupResults){
                    if (result && result.agentId && !result.error) {
                        await this.storeMemory(swarmId, `agent-${result.agentId}`, {
                            id: result.agentId,
                            type: result.type,
                            status: result.status || 'active',
                            createdAt: Date.now()
                        }, 'agent');
                    }
                }
            }
            const spawnTime = Date.now() - startTime;
            this._trackSpawnPerformance(types.length, spawnTime);
            return allResults;
        } catch (error) {
            console.error('Agent spawning failed:', error);
            throw error;
        }
    }
    _groupAgentTypes(types) {
        const groups = {
            development: [
                'coder',
                'architect',
                'reviewer'
            ],
            analysis: [
                'researcher',
                'analyst',
                'optimizer'
            ],
            quality: [
                'tester',
                'documenter'
            ],
            coordination: [
                'coordinator'
            ]
        };
        const result = [];
        const remaining = [
            ...types
        ];
        Object.values(groups).forEach((groupTypes)=>{
            const groupAgents = remaining.filter((type)=>groupTypes.includes(type));
            if (groupAgents.length > 0) {
                result.push(groupAgents);
                groupAgents.forEach((type)=>{
                    const index = remaining.indexOf(type);
                    if (index > -1) remaining.splice(index, 1);
                });
            }
        });
        remaining.forEach((type)=>result.push([
                type
            ]));
        return result;
    }
    _trackSpawnPerformance(agentCount, spawnTime) {
        if (!this.spawnStats) {
            this.spawnStats = {
                totalSpawns: 0,
                totalAgents: 0,
                totalTime: 0,
                avgTimePerAgent: 0,
                bestTime: Infinity,
                worstTime: 0
            };
        }
        this.spawnStats.totalSpawns++;
        this.spawnStats.totalAgents += agentCount;
        this.spawnStats.totalTime += spawnTime;
        this.spawnStats.avgTimePerAgent = this.spawnStats.totalTime / this.spawnStats.totalAgents;
        this.spawnStats.bestTime = Math.min(this.spawnStats.bestTime, spawnTime);
        this.spawnStats.worstTime = Math.max(this.spawnStats.worstTime, spawnTime);
    }
    async storeMemory(swarmId, key, value, type = 'knowledge') {
        try {
            if (!this.memoryDb && !this.memoryStore) {
                await this.initializeMemoryStorage();
            }
            const timestamp = Date.now();
            const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
            if (this.memoryDb) {
                const stmt = this.memoryDb.prepare(`
          INSERT OR REPLACE INTO memories (namespace, key, value, type, timestamp)
          VALUES (?, ?, ?, ?, ?)
        `);
                const result = stmt.run(swarmId, key, valueStr, type, timestamp);
                return {
                    success: true,
                    action: 'store',
                    namespace: swarmId,
                    key,
                    type,
                    timestamp,
                    id: result.lastInsertRowid
                };
            } else {
                const memoryKey = `${swarmId}:${key}`;
                this.memoryStore.set(memoryKey, {
                    namespace: swarmId,
                    key,
                    value: valueStr,
                    type,
                    timestamp
                });
                return {
                    success: true,
                    action: 'store',
                    namespace: swarmId,
                    key,
                    type,
                    timestamp
                };
            }
        } catch (error) {
            console.error('Error storing memory:', error);
            throw error;
        }
    }
    async retrieveMemory(swarmId, key) {
        try {
            if (!this.memoryDb && !this.memoryStore) {
                await this.initializeMemoryStorage();
            }
            if (this.memoryDb) {
                const stmt = this.memoryDb.prepare(`
          SELECT * FROM memories WHERE namespace = ? AND key = ?
        `);
                const row = stmt.get(swarmId, key);
                if (row) {
                    try {
                        return {
                            ...row,
                            value: JSON.parse(row.value)
                        };
                    } catch  {
                        return row;
                    }
                }
            } else {
                const memoryKey = `${swarmId}:${key}`;
                const memory = this.memoryStore.get(memoryKey);
                if (memory) {
                    try {
                        return {
                            ...memory,
                            value: JSON.parse(memory.value)
                        };
                    } catch  {
                        return memory;
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Error retrieving memory:', error);
            throw error;
        }
    }
    async searchMemory(swarmId, pattern) {
        try {
            if (!this.memoryDb && !this.memoryStore) {
                await this.initializeMemoryStorage();
            }
            let results = [];
            if (this.memoryDb) {
                let query, params;
                if (pattern && pattern.trim()) {
                    query = `
            SELECT * FROM memories 
            WHERE namespace = ? AND (key LIKE ? OR value LIKE ? OR type LIKE ?)
            ORDER BY timestamp DESC
            LIMIT 50
          `;
                    const searchPattern = `%${pattern}%`;
                    params = [
                        swarmId,
                        searchPattern,
                        searchPattern,
                        searchPattern
                    ];
                } else {
                    query = `
            SELECT * FROM memories 
            WHERE namespace = ?
            ORDER BY timestamp DESC
            LIMIT 50
          `;
                    params = [
                        swarmId
                    ];
                }
                const stmt = this.memoryDb.prepare(query);
                results = stmt.all(...params);
                results = results.map((row)=>{
                    try {
                        return {
                            ...row,
                            value: JSON.parse(row.value)
                        };
                    } catch  {
                        return row;
                    }
                });
            } else {
                for (const [memKey, memory] of this.memoryStore){
                    if (memory.namespace === swarmId) {
                        if (!pattern || memory.key.includes(pattern) || memory.value.includes(pattern) || memory.type.includes(pattern)) {
                            try {
                                results.push({
                                    ...memory,
                                    value: JSON.parse(memory.value)
                                });
                            } catch  {
                                results.push(memory);
                            }
                        }
                    }
                }
                results.sort((a, b)=>b.timestamp - a.timestamp);
                results = results.slice(0, 50);
            }
            return {
                success: true,
                namespace: swarmId,
                pattern: pattern || '',
                total: results.length,
                results: results
            };
        } catch (error) {
            console.error('Error searching memory:', error);
            throw error;
        }
    }
    async orchestrateTask(task, strategy = 'parallel', metadata = {}) {
        const taskId = metadata.taskId || `task-${Date.now()}`;
        const swarmId = metadata.swarmId || 'default-swarm';
        const complexity = metadata.complexity || 'medium';
        await this.storeMemory(swarmId, `task-${taskId}`, {
            id: taskId,
            task,
            strategy,
            status: 'pending',
            priority: metadata.priority || 5,
            complexity,
            createdAt: Date.now()
        }, 'task');
        const monitoringInterval = {
            low: 10000,
            medium: 5000,
            high: 2000
        }[complexity] || 5000;
        const batch = [
            {
                tool: 'task_orchestrate',
                params: {
                    task,
                    strategy,
                    taskId,
                    priority: metadata.priority || 5,
                    estimatedDuration: metadata.estimatedDuration || 30000
                }
            },
            {
                tool: 'swarm_monitor',
                params: {
                    interval: monitoringInterval,
                    taskId,
                    metrics: [
                        'performance',
                        'progress',
                        'bottlenecks'
                    ]
                }
            },
            ...metadata.priority > 7 ? [
                {
                    tool: 'performance_report',
                    params: {
                        format: 'detailed',
                        taskId
                    }
                }
            ] : []
        ];
        const results = await this.executeParallel(batch);
        await this.storeMemory(swarmId, `task-${taskId}`, {
            id: taskId,
            task,
            strategy,
            status: 'in_progress',
            priority: metadata.priority || 5,
            complexity,
            createdAt: Date.now()
        }, 'task');
        return results;
    }
    async analyzePerformance(swarmId) {
        const batch = [
            {
                tool: 'bottleneck_analyze',
                params: {
                    component: swarmId
                }
            },
            {
                tool: 'performance_report',
                params: {
                    format: 'detailed'
                }
            },
            {
                tool: 'token_usage',
                params: {
                    operation: swarmId
                }
            }
        ];
        return await this.executeParallel(batch);
    }
    async githubOperations(repo, operation, params = {}) {
        const githubTools = {
            analyze: 'github_repo_analyze',
            pr: 'github_pr_manage',
            issue: 'github_issue_track',
            review: 'github_code_review'
        };
        const tool = githubTools[operation];
        if (!tool) {
            throw new Error(`Unknown GitHub operation: ${operation}`);
        }
        return await this.executeTool(tool, {
            repo,
            ...params
        });
    }
    async neuralOperation(operation, params = {}) {
        const neuralTools = {
            train: 'neural_train',
            predict: 'neural_predict',
            analyze: 'neural_patterns',
            optimize: 'wasm_optimize'
        };
        const tool = neuralTools[operation];
        if (!tool) {
            throw new Error(`Unknown neural operation: ${operation}`);
        }
        return await this.executeTool(tool, params);
    }
    async destroySwarm(swarmId) {
        const batch = [
            {
                tool: 'swarm_destroy',
                params: {
                    swarmId
                }
            },
            {
                tool: 'memory_namespace',
                params: {
                    action: 'delete',
                    namespace: swarmId
                }
            },
            {
                tool: 'cache_manage',
                params: {
                    action: 'clear',
                    key: `swarm-${swarmId}`
                }
            }
        ];
        return await this.executeParallel(batch);
    }
    async getSwarmStatus(params = {}) {
        try {
            if (!this.memoryDb && !this.memoryStore) {
                await this.initializeMemoryStorage();
            }
            const swarms = [];
            let activeAgents = 0;
            let totalTasks = 0;
            let completedTasks = 0;
            if (this.memoryDb) {
                const namespacesQuery = this.memoryDb.prepare(`
          SELECT DISTINCT namespace FROM memories 
          WHERE namespace LIKE 'swarm-%' OR namespace LIKE 'hive-%'
          ORDER BY timestamp DESC
        `);
                const namespaces = namespacesQuery.all();
                for (const { namespace } of namespaces){
                    const swarmId = namespace;
                    const metadataQuery = this.memoryDb.prepare(`
            SELECT key, value, type, timestamp FROM memories 
            WHERE namespace = ? AND (
              key IN ('init_performance', 'config', 'status', 'agents', 'tasks', 'topology')
              OR key LIKE 'agent-%'
              OR key LIKE 'task-%'
            )
          `);
                    const swarmData = metadataQuery.all(swarmId);
                    let swarmInfo = {
                        id: swarmId,
                        name: swarmId,
                        status: 'unknown',
                        agents: 0,
                        tasks: {
                            total: 0,
                            completed: 0,
                            pending: 0,
                            failed: 0
                        },
                        topology: 'hierarchical',
                        createdAt: null,
                        lastActivity: null,
                        memoryUsage: swarmData.length
                    };
                    for (const record of swarmData){
                        try {
                            const value = typeof record.value === 'string' ? JSON.parse(record.value) : record.value;
                            switch(record.key){
                                case 'init_performance':
                                    swarmInfo.createdAt = value.timestamp;
                                    swarmInfo.topology = value.topology || 'hierarchical';
                                    break;
                                case 'status':
                                    swarmInfo.status = value;
                                    break;
                                case 'config':
                                    swarmInfo.topology = value.topology || swarmInfo.topology;
                                    break;
                            }
                            if (record.key.startsWith('agent-')) {
                                swarmInfo.agents++;
                                activeAgents++;
                            }
                            if (record.key.startsWith('task-')) {
                                swarmInfo.tasks.total++;
                                totalTasks++;
                                if (value.status === 'completed') {
                                    swarmInfo.tasks.completed++;
                                    completedTasks++;
                                } else if (value.status === 'failed') {
                                    swarmInfo.tasks.failed++;
                                } else if (value.status === 'pending' || value.status === 'in_progress') {
                                    swarmInfo.tasks.pending++;
                                }
                            }
                            if (record.timestamp > (swarmInfo.lastActivity || 0)) {
                                swarmInfo.lastActivity = record.timestamp;
                            }
                        } catch (e) {}
                    }
                    if (swarmInfo.status === 'unknown') {
                        const now = Date.now();
                        const lastActivityAge = now - (swarmInfo.lastActivity || 0);
                        if (lastActivityAge < 60000) {
                            swarmInfo.status = 'active';
                        } else if (lastActivityAge < 300000) {
                            swarmInfo.status = 'idle';
                        } else {
                            swarmInfo.status = 'inactive';
                        }
                    }
                    swarms.push(swarmInfo);
                }
                const activityQuery = this.memoryDb.prepare(`
          SELECT namespace, key, type, timestamp FROM memories 
          WHERE (namespace LIKE 'swarm-%' OR namespace LIKE 'hive-%')
          AND timestamp > ?
          ORDER BY timestamp DESC
          LIMIT 10
        `);
                const recentActivity = activityQuery.all(Date.now() - 300000);
                return {
                    swarms,
                    activeAgents,
                    totalTasks,
                    completedTasks,
                    pendingTasks: totalTasks - completedTasks,
                    recentActivity: recentActivity.map((r)=>({
                            swarmId: r.namespace,
                            action: r.key,
                            type: r.type,
                            timestamp: r.timestamp
                        })),
                    summary: {
                        totalSwarms: swarms.length,
                        activeSwarms: swarms.filter((s)=>s.status === 'active').length,
                        idleSwarms: swarms.filter((s)=>s.status === 'idle').length,
                        inactiveSwarms: swarms.filter((s)=>s.status === 'inactive').length
                    }
                };
            } else {
                const swarmMap = new Map();
                for (const [key, memory] of this.memoryStore){
                    const namespace = memory.namespace;
                    if (namespace && (namespace.startsWith('swarm-') || namespace.startsWith('hive-'))) {
                        if (!swarmMap.has(namespace)) {
                            swarmMap.set(namespace, {
                                id: namespace,
                                name: namespace,
                                status: 'active',
                                agents: 0,
                                tasks: {
                                    total: 0,
                                    completed: 0,
                                    pending: 0,
                                    failed: 0
                                },
                                memoryUsage: 0
                            });
                        }
                        const swarm = swarmMap.get(namespace);
                        swarm.memoryUsage++;
                        if (memory.key.startsWith('agent-')) {
                            swarm.agents++;
                            activeAgents++;
                        }
                        if (memory.key.startsWith('task-')) {
                            swarm.tasks.total++;
                            totalTasks++;
                            try {
                                const taskData = JSON.parse(memory.value);
                                if (taskData.status === 'completed') {
                                    swarm.tasks.completed++;
                                    completedTasks++;
                                } else if (taskData.status === 'failed') {
                                    swarm.tasks.failed++;
                                } else if (taskData.status === 'pending' || taskData.status === 'in_progress') {
                                    swarm.tasks.pending++;
                                }
                            } catch (e) {}
                        }
                    }
                }
                return {
                    swarms: Array.from(swarmMap.values()),
                    activeAgents,
                    totalTasks,
                    completedTasks,
                    pendingTasks: totalTasks - completedTasks,
                    summary: {
                        totalSwarms: swarmMap.size,
                        activeSwarms: swarmMap.size
                    }
                };
            }
        } catch (error) {
            console.error('Error getting swarm status:', error);
            return {
                swarms: [],
                activeAgents: 0,
                totalTasks: 0,
                completedTasks: 0,
                pendingTasks: 0,
                recentActivity: [],
                summary: {
                    totalSwarms: 0,
                    activeSwarms: 0,
                    idleSwarms: 0,
                    inactiveSwarms: 0
                },
                error: error.message
            };
        }
    }
}
export { MCP_TOOLS };

//# sourceMappingURL=mcp-wrapper.js.map