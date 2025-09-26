import { promises as fs } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { gzip, gunzip } from 'zlib';
const execAsync = promisify(exec);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
export class StateManager extends EventEmitter {
    snapshots = new Map();
    snapshotDir;
    maxSnapshots;
    compressionEnabled;
    constructor(snapshotDir = './snapshots', maxSnapshots = 100, compressionEnabled = true){
        super();
        this.snapshotDir = snapshotDir;
        this.maxSnapshots = maxSnapshots;
        this.compressionEnabled = compressionEnabled;
        this.initializeStorage();
    }
    async initializeStorage() {
        try {
            await fs.mkdir(this.snapshotDir, {
                recursive: true
            });
            await this.loadExistingSnapshots();
        } catch (error) {
            this.emit('error', new Error(`Failed to initialize storage: ${error}`));
        }
    }
    async loadExistingSnapshots() {
        try {
            const files = await fs.readdir(this.snapshotDir);
            const snapshotFiles = files.filter((f)=>f.endsWith('.snapshot.json'));
            for (const file of snapshotFiles){
                try {
                    const content = await fs.readFile(join(this.snapshotDir, file), 'utf-8');
                    const snapshot = JSON.parse(content);
                    this.snapshots.set(snapshot.id, snapshot);
                } catch (error) {
                    console.warn(`Failed to load snapshot ${file}:`, error);
                }
            }
            this.emit('snapshots_loaded', this.snapshots.size);
        } catch (error) {
            this.emit('error', new Error(`Failed to load snapshots: ${error}`));
        }
    }
    async captureSnapshot(description, tags = [], triggeredBy = 'manual') {
        const id = this.generateSnapshotId();
        const timestamp = Date.now();
        try {
            const [config, memory, processes, files, git] = await Promise.all([
                this.captureConfig(),
                this.captureMemory(),
                this.captureProcesses(),
                this.captureFiles(),
                this.captureGitState()
            ]);
            const snapshot = {
                id,
                timestamp,
                version: '1.0.0',
                metadata: {
                    description,
                    tags,
                    triggeredBy,
                    severity: 'medium'
                },
                state: {
                    config,
                    memory,
                    processes,
                    files,
                    git
                },
                integrity: {
                    checksum: '',
                    compressed: this.compressionEnabled,
                    size: 0
                }
            };
            const serialized = JSON.stringify(snapshot.state);
            snapshot.integrity.checksum = createHash('sha256').update(serialized).digest('hex');
            snapshot.integrity.size = Buffer.byteLength(serialized, 'utf8');
            await this.storeSnapshot(snapshot);
            this.snapshots.set(id, snapshot);
            await this.cleanupOldSnapshots();
            this.emit('snapshot_created', snapshot);
            return snapshot;
        } catch (error) {
            this.emit('error', new Error(`Failed to capture snapshot: ${error}`));
            throw error;
        }
    }
    async captureConfig() {
        try {
            const configPaths = [
                './claude-flow.config.json',
                './package.json',
                './tsconfig.json',
                './.env'
            ];
            const config = {};
            for (const path of configPaths){
                try {
                    const content = await fs.readFile(path, 'utf-8');
                    config[path] = JSON.parse(content);
                } catch  {}
            }
            return config;
        } catch (error) {
            return {};
        }
    }
    async captureMemory() {
        try {
            const memoryPaths = [
                './memory/memory-store.json',
                './memory/claude-flow-data.json',
                './swarm-memory/state.json'
            ];
            const memory = {};
            for (const path of memoryPaths){
                try {
                    const content = await fs.readFile(path, 'utf-8');
                    memory[path] = JSON.parse(content);
                } catch  {}
            }
            return memory;
        } catch (error) {
            return {};
        }
    }
    async captureProcesses() {
        try {
            const { stdout } = await execAsync('ps aux | grep -E "(claude-flow|node)" | grep -v grep');
            const lines = stdout.trim().split('\n');
            return lines.map((line)=>{
                const parts = line.trim().split(/\s+/);
                return {
                    pid: parseInt(parts[1]) || 0,
                    name: parts[10] || 'unknown',
                    status: 'running',
                    memory: parseFloat(parts[5]) || 0,
                    cpu: parseFloat(parts[2]) || 0,
                    env: process.env
                };
            });
        } catch  {
            return [];
        }
    }
    async captureFiles() {
        try {
            const criticalPaths = [
                './src/verification/rollback.ts',
                './src/core/orchestrator.ts',
                './src/memory/manager.ts',
                './src/mcp/server.ts'
            ];
            const files = [];
            for (const path of criticalPaths){
                try {
                    const [content, stats] = await Promise.all([
                        fs.readFile(path, 'utf-8'),
                        fs.stat(path)
                    ]);
                    files.push({
                        path,
                        content,
                        stats: {
                            size: stats.size,
                            mtime: stats.mtime.getTime(),
                            mode: stats.mode
                        },
                        checksum: createHash('md5').update(content).digest('hex')
                    });
                } catch  {}
            }
            return files;
        } catch  {
            return [];
        }
    }
    async captureGitState() {
        try {
            const [branch, commit, status, staged, modified, untracked] = await Promise.all([
                execAsync('git rev-parse --abbrev-ref HEAD').then((r)=>r.stdout.trim()).catch(()=>'unknown'),
                execAsync('git rev-parse HEAD').then((r)=>r.stdout.trim()).catch(()=>'unknown'),
                execAsync('git status --porcelain').then((r)=>r.stdout.trim()).catch(()=>''),
                execAsync('git diff --cached --name-only').then((r)=>r.stdout.trim().split('\n').filter(Boolean)).catch(()=>[]),
                execAsync('git diff --name-only').then((r)=>r.stdout.trim().split('\n').filter(Boolean)).catch(()=>[]),
                execAsync('git ls-files --others --exclude-standard').then((r)=>r.stdout.trim().split('\n').filter(Boolean)).catch(()=>[])
            ]);
            return {
                branch,
                commit,
                status,
                staged,
                modified,
                untracked
            };
        } catch  {
            return {
                branch: 'unknown',
                commit: 'unknown',
                status: '',
                staged: [],
                modified: [],
                untracked: []
            };
        }
    }
    async storeSnapshot(snapshot) {
        const filename = `${snapshot.id}.snapshot.json`;
        const filepath = join(this.snapshotDir, filename);
        let content = JSON.stringify(snapshot, null, 2);
        if (this.compressionEnabled) {
            const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));
            await fs.writeFile(filepath + '.gz', compressed);
        } else {
            await fs.writeFile(filepath, content);
        }
    }
    async cleanupOldSnapshots() {
        if (this.snapshots.size <= this.maxSnapshots) return;
        const sorted = Array.from(this.snapshots.values()).sort((a, b)=>a.timestamp - b.timestamp);
        const toDelete = sorted.slice(0, sorted.length - this.maxSnapshots);
        for (const snapshot of toDelete){
            try {
                const filename = `${snapshot.id}.snapshot.json`;
                const filepath = join(this.snapshotDir, filename);
                await fs.unlink(filepath).catch(()=>{});
                await fs.unlink(filepath + '.gz').catch(()=>{});
                this.snapshots.delete(snapshot.id);
            } catch (error) {
                console.warn(`Failed to delete snapshot ${snapshot.id}:`, error);
            }
        }
    }
    generateSnapshotId() {
        return `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    async getSnapshot(id) {
        return this.snapshots.get(id) || null;
    }
    listSnapshots() {
        return Array.from(this.snapshots.values()).sort((a, b)=>b.timestamp - a.timestamp);
    }
    async deleteSnapshot(id) {
        try {
            const filename = `${id}.snapshot.json`;
            const filepath = join(this.snapshotDir, filename);
            await fs.unlink(filepath).catch(()=>{});
            await fs.unlink(filepath + '.gz').catch(()=>{});
            this.snapshots.delete(id);
            this.emit('snapshot_deleted', id);
            return true;
        } catch  {
            return false;
        }
    }
}
export class RollbackTrigger extends EventEmitter {
    config;
    monitoring = false;
    metrics = [];
    monitoringInterval;
    lastRollback = 0;
    constructor(config = {}){
        super();
        this.config = this.mergeConfig(config);
    }
    mergeConfig(config) {
        return {
            enabled: config.enabled ?? true,
            thresholds: {
                errorRate: config.thresholds?.errorRate ?? 10,
                memoryUsage: config.thresholds?.memoryUsage ?? 90,
                cpuUsage: config.thresholds?.cpuUsage ?? 95,
                responseTime: config.thresholds?.responseTime ?? 5000,
                diskSpace: config.thresholds?.diskSpace ?? 10,
                consecutiveFailures: config.thresholds?.consecutiveFailures ?? 3
            },
            monitoring: {
                interval: config.monitoring?.interval ?? 30000,
                cooldown: config.monitoring?.cooldown ?? 300000,
                gracePeriod: config.monitoring?.gracePeriod ?? 60000
            },
            notifications: {
                webhook: config.notifications?.webhook,
                email: config.notifications?.email,
                slack: config.notifications?.slack
            }
        };
    }
    startMonitoring() {
        if (this.monitoring) return;
        this.monitoring = true;
        this.monitoringInterval = setInterval(()=>this.checkThresholds(), this.config.monitoring.interval);
        this.emit('monitoring_started');
    }
    stopMonitoring() {
        if (!this.monitoring) return;
        this.monitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
        this.emit('monitoring_stopped');
    }
    async checkThresholds() {
        if (!this.config.enabled) return;
        if (Date.now() - this.lastRollback < this.config.monitoring.cooldown) {
            return;
        }
        try {
            const metrics = await this.collectMetrics();
            this.metrics.push(metrics);
            const oneHourAgo = Date.now() - 3600000;
            this.metrics = this.metrics.filter((m)=>m.timestamp > oneHourAgo);
            const violations = this.evaluateThresholds(metrics);
            if (violations.length > 0) {
                this.emit('threshold_violated', {
                    metrics,
                    violations
                });
                const recentViolations = this.metrics.filter((m)=>m.timestamp > Date.now() - this.config.monitoring.gracePeriod).filter((m)=>this.evaluateThresholds(m).length > 0);
                if (recentViolations.length >= 2) {
                    this.triggerRollback(metrics, violations);
                }
            }
        } catch (error) {
            this.emit('monitoring_error', error);
        }
    }
    async collectMetrics() {
        const timestamp = Date.now();
        try {
            const [memInfo, cpuInfo, diskInfo] = await Promise.all([
                this.getMemoryInfo(),
                this.getCpuInfo(),
                this.getDiskInfo()
            ]);
            return {
                timestamp,
                errors: {
                    count: 0,
                    rate: 0,
                    recent: []
                },
                performance: {
                    memory: memInfo,
                    cpu: cpuInfo,
                    disk: diskInfo,
                    network: {
                        in: 0,
                        out: 0
                    }
                },
                health: {
                    status: 'healthy',
                    score: 100,
                    checks: []
                }
            };
        } catch (error) {
            return {
                timestamp,
                errors: {
                    count: 1,
                    rate: 1,
                    recent: [
                        error
                    ]
                },
                performance: {
                    memory: {
                        used: 0,
                        total: 0,
                        percentage: 0
                    },
                    cpu: {
                        usage: 0,
                        load: [
                            0,
                            0,
                            0
                        ]
                    },
                    disk: {
                        used: 0,
                        total: 0,
                        free: 0
                    },
                    network: {
                        in: 0,
                        out: 0
                    }
                },
                health: {
                    status: 'critical',
                    score: 0,
                    checks: [
                        {
                            name: 'metrics_collection',
                            status: 'fail',
                            message: error?.toString() || 'Unknown error',
                            duration: 0
                        }
                    ]
                }
            };
        }
    }
    async getMemoryInfo() {
        try {
            const meminfo = await fs.readFile('/proc/meminfo', 'utf-8');
            const lines = meminfo.split('\n');
            const memTotal = parseInt(lines.find((l)=>l.startsWith('MemTotal:'))?.split(/\s+/)[1] || '0') * 1024;
            const memAvailable = parseInt(lines.find((l)=>l.startsWith('MemAvailable:'))?.split(/\s+/)[1] || '0') * 1024;
            const memUsed = memTotal - memAvailable;
            return {
                used: memUsed,
                total: memTotal,
                percentage: memTotal > 0 ? memUsed / memTotal * 100 : 0
            };
        } catch  {
            return {
                used: 0,
                total: 0,
                percentage: 0
            };
        }
    }
    async getCpuInfo() {
        try {
            const loadavg = await fs.readFile('/proc/loadavg', 'utf-8');
            const loads = loadavg.trim().split(' ').slice(0, 3).map(parseFloat);
            return {
                usage: loads[0] * 100,
                load: loads
            };
        } catch  {
            return {
                usage: 0,
                load: [
                    0,
                    0,
                    0
                ]
            };
        }
    }
    async getDiskInfo() {
        try {
            const { stdout } = await execAsync('df -h . | tail -1');
            const parts = stdout.trim().split(/\s+/);
            const total = this.parseSize(parts[1]);
            const used = this.parseSize(parts[2]);
            const free = this.parseSize(parts[3]);
            return {
                used,
                total,
                free
            };
        } catch  {
            return {
                used: 0,
                total: 0,
                free: 0
            };
        }
    }
    parseSize(sizeStr) {
        const match = sizeStr.match(/^(\d+(?:\.\d+)?)(K|M|G|T)?$/);
        if (!match) return 0;
        const value = parseFloat(match[1]);
        const unit = match[2] || '';
        const multipliers = {
            '': 1,
            'K': 1024,
            'M': 1024 * 1024,
            'G': 1024 * 1024 * 1024,
            'T': 1024 * 1024 * 1024 * 1024
        };
        return value * (multipliers[unit] || 1);
    }
    evaluateThresholds(metrics) {
        const violations = [];
        if (metrics.performance.memory.percentage > this.config.thresholds.memoryUsage) {
            violations.push(`Memory usage: ${metrics.performance.memory.percentage.toFixed(1)}% > ${this.config.thresholds.memoryUsage}%`);
        }
        if (metrics.performance.cpu.usage > this.config.thresholds.cpuUsage) {
            violations.push(`CPU usage: ${metrics.performance.cpu.usage.toFixed(1)}% > ${this.config.thresholds.cpuUsage}%`);
        }
        const diskFreePercentage = metrics.performance.disk.free / metrics.performance.disk.total * 100;
        if (diskFreePercentage < this.config.thresholds.diskSpace) {
            violations.push(`Disk space: ${diskFreePercentage.toFixed(1)}% free < ${this.config.thresholds.diskSpace}%`);
        }
        if (metrics.errors.rate > this.config.thresholds.errorRate) {
            violations.push(`Error rate: ${metrics.errors.rate}/min > ${this.config.thresholds.errorRate}/min`);
        }
        return violations;
    }
    async triggerRollback(metrics, violations) {
        this.lastRollback = Date.now();
        this.emit('rollback_triggered', {
            reason: 'threshold_violations',
            violations,
            metrics
        });
        await this.sendNotifications(violations, metrics);
    }
    async sendNotifications(violations, metrics) {
        const message = `🚨 Rollback triggered due to threshold violations:\n${violations.join('\n')}`;
        try {
            if (this.config.notifications.webhook) {}
            if (this.config.notifications.slack) {}
            if (this.config.notifications.email) {}
        } catch (error) {
            this.emit('notification_error', error);
        }
    }
    updateConfig(config) {
        this.config = this.mergeConfig(config);
        this.emit('config_updated', this.config);
    }
    getCurrentMetrics() {
        return this.metrics[this.metrics.length - 1] || null;
    }
    getMetricsHistory() {
        return [
            ...this.metrics
        ];
    }
}
export class AutomatedRecovery extends EventEmitter {
    strategies = new Map();
    recoveryHistory = [];
    stateManager;
    isRecovering = false;
    constructor(stateManager){
        super();
        this.stateManager = stateManager;
        this.initializeDefaultStrategies();
    }
    initializeDefaultStrategies() {
        this.registerStrategy({
            name: 'service_restart',
            priority: 1,
            enabled: true,
            timeout: 30000,
            retries: 2,
            conditions: (metrics)=>metrics.health.status === 'degraded',
            execute: async (snapshot, context)=>{
                try {
                    this.emit('recovery_step', {
                        strategy: 'service_restart',
                        action: 'restarting_services'
                    });
                    await execAsync('pkill -f "claude-flow" && sleep 2');
                    await new Promise((resolve)=>setTimeout(resolve, 5000));
                    return true;
                } catch (error) {
                    this.emit('recovery_error', {
                        strategy: 'service_restart',
                        error
                    });
                    return false;
                }
            }
        });
        this.registerStrategy({
            name: 'memory_cleanup',
            priority: 2,
            enabled: true,
            timeout: 15000,
            retries: 1,
            conditions: (metrics)=>metrics.performance.memory.percentage > 85,
            execute: async (snapshot, context)=>{
                try {
                    this.emit('recovery_step', {
                        strategy: 'memory_cleanup',
                        action: 'clearing_memory'
                    });
                    if (global.gc) {
                        global.gc();
                    }
                    await this.clearApplicationCaches();
                    return true;
                } catch (error) {
                    this.emit('recovery_error', {
                        strategy: 'memory_cleanup',
                        error
                    });
                    return false;
                }
            }
        });
        this.registerStrategy({
            name: 'config_reset',
            priority: 3,
            enabled: true,
            timeout: 20000,
            retries: 1,
            conditions: (metrics)=>metrics.health.status === 'critical',
            execute: async (snapshot, context)=>{
                try {
                    this.emit('recovery_step', {
                        strategy: 'config_reset',
                        action: 'resetting_config'
                    });
                    await this.restoreConfiguration(snapshot);
                    return true;
                } catch (error) {
                    this.emit('recovery_error', {
                        strategy: 'config_reset',
                        error
                    });
                    return false;
                }
            }
        });
        this.registerStrategy({
            name: 'full_rollback',
            priority: 10,
            enabled: true,
            timeout: 60000,
            retries: 1,
            conditions: ()=>true,
            execute: async (snapshot, context)=>{
                try {
                    this.emit('recovery_step', {
                        strategy: 'full_rollback',
                        action: 'rolling_back_state'
                    });
                    await this.performFullRollback(snapshot);
                    return true;
                } catch (error) {
                    this.emit('recovery_error', {
                        strategy: 'full_rollback',
                        error
                    });
                    return false;
                }
            }
        });
    }
    registerStrategy(strategy) {
        this.strategies.set(strategy.name, strategy);
        this.emit('strategy_registered', strategy.name);
    }
    async executeRecovery(metrics, triggerReason, preferredSnapshot) {
        if (this.isRecovering) {
            this.emit('recovery_blocked', 'Recovery already in progress');
            return false;
        }
        this.isRecovering = true;
        try {
            this.emit('recovery_started', {
                reason: triggerReason,
                metrics
            });
            const snapshots = this.stateManager.listSnapshots();
            const snapshot = preferredSnapshot ? await this.stateManager.getSnapshot(preferredSnapshot) : snapshots[0];
            if (!snapshot) {
                throw new Error('No snapshot available for recovery');
            }
            const applicableStrategies = Array.from(this.strategies.values()).filter((s)=>s.enabled && s.conditions(metrics)).sort((a, b)=>a.priority - b.priority);
            if (applicableStrategies.length === 0) {
                throw new Error('No applicable recovery strategies found');
            }
            const context = {
                triggeredBy: triggerReason,
                reason: triggerReason,
                metrics,
                previousAttempts: this.recoveryHistory.slice(-10)
            };
            for (const strategy of applicableStrategies){
                const success = await this.executeStrategy(strategy, snapshot, context);
                if (success) {
                    this.emit('recovery_success', {
                        strategy: strategy.name,
                        snapshot: snapshot.id,
                        duration: Date.now() - metrics.timestamp
                    });
                    return true;
                }
            }
            throw new Error('All recovery strategies failed');
        } catch (error) {
            this.emit('recovery_failed', {
                error: error?.toString(),
                metrics
            });
            return false;
        } finally{
            this.isRecovering = false;
        }
    }
    async executeStrategy(strategy, snapshot, context) {
        const startTime = Date.now();
        for(let attempt = 0; attempt <= strategy.retries; attempt++){
            try {
                this.emit('strategy_attempt', {
                    strategy: strategy.name,
                    attempt: attempt + 1,
                    maxAttempts: strategy.retries + 1
                });
                const success = await Promise.race([
                    strategy.execute(snapshot, context),
                    new Promise((_, reject)=>setTimeout(()=>reject(new Error('Strategy timeout')), strategy.timeout))
                ]);
                const duration = Date.now() - startTime;
                const recoveryAttempt = {
                    strategy: strategy.name,
                    timestamp: Date.now(),
                    success,
                    duration
                };
                this.recoveryHistory.push(recoveryAttempt);
                if (success) {
                    this.emit('strategy_success', {
                        strategy: strategy.name,
                        attempt,
                        duration
                    });
                    return true;
                }
            } catch (error) {
                const duration = Date.now() - startTime;
                const recoveryAttempt = {
                    strategy: strategy.name,
                    timestamp: Date.now(),
                    success: false,
                    error: error?.toString(),
                    duration
                };
                this.recoveryHistory.push(recoveryAttempt);
                this.emit('strategy_failed', {
                    strategy: strategy.name,
                    attempt,
                    error: error?.toString(),
                    duration
                });
                if (attempt === strategy.retries) {
                    return false;
                }
                await new Promise((resolve)=>setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
        return false;
    }
    async clearApplicationCaches() {
        try {
            const memoryPaths = [
                './memory/cache',
                './swarm-memory/cache',
                './temp'
            ];
            for (const path of memoryPaths){
                try {
                    await fs.rm(path, {
                        recursive: true,
                        force: true
                    });
                    await fs.mkdir(path, {
                        recursive: true
                    });
                } catch  {}
            }
        } catch (error) {
            throw new Error(`Failed to clear caches: ${error}`);
        }
    }
    async restoreConfiguration(snapshot) {
        try {
            for (const [path, content] of Object.entries(snapshot.state.config)){
                try {
                    await fs.writeFile(path, JSON.stringify(content, null, 2));
                } catch (error) {
                    console.warn(`Failed to restore config file ${path}:`, error);
                }
            }
        } catch (error) {
            throw new Error(`Failed to restore configuration: ${error}`);
        }
    }
    async performFullRollback(snapshot) {
        try {
            await execAsync('pkill -f "claude-flow"').catch(()=>{});
            for (const file of snapshot.state.files){
                try {
                    await fs.writeFile(file.path, file.content);
                    await fs.chmod(file.path, file.stats.mode);
                } catch (error) {
                    console.warn(`Failed to restore file ${file.path}:`, error);
                }
            }
            for (const [path, content] of Object.entries(snapshot.state.memory)){
                try {
                    await fs.writeFile(path, JSON.stringify(content, null, 2));
                } catch (error) {
                    console.warn(`Failed to restore memory file ${path}:`, error);
                }
            }
            if (snapshot.state.git.commit !== 'unknown') {
                try {
                    await execAsync(`git reset --hard ${snapshot.state.git.commit}`);
                } catch (error) {
                    console.warn('Failed to perform git rollback:', error);
                }
            }
            await new Promise((resolve)=>setTimeout(resolve, 2000));
        } catch (error) {
            throw new Error(`Failed to perform full rollback: ${error}`);
        }
    }
    getStrategyNames() {
        return Array.from(this.strategies.keys());
    }
    getStrategy(name) {
        return this.strategies.get(name);
    }
    enableStrategy(name) {
        const strategy = this.strategies.get(name);
        if (strategy) {
            strategy.enabled = true;
            this.emit('strategy_enabled', name);
            return true;
        }
        return false;
    }
    disableStrategy(name) {
        const strategy = this.strategies.get(name);
        if (strategy) {
            strategy.enabled = false;
            this.emit('strategy_disabled', name);
            return true;
        }
        return false;
    }
    getRecoveryHistory() {
        return [
            ...this.recoveryHistory
        ];
    }
}
export class RollbackHistory extends EventEmitter {
    history = new Map();
    historyDir;
    maxHistorySize;
    compressionEnabled;
    ttlMs;
    cleanupInterval;
    constructor(historyDir = './rollback-history', maxHistorySize = 1000, ttlDays = 30, compressionEnabled = true){
        super();
        this.historyDir = historyDir;
        this.maxHistorySize = maxHistorySize;
        this.ttlMs = ttlDays * 24 * 60 * 60 * 1000;
        this.compressionEnabled = compressionEnabled;
        this.initializeStorage();
        this.startCleanupInterval();
    }
    async initializeStorage() {
        try {
            await fs.mkdir(this.historyDir, {
                recursive: true
            });
            await this.loadExistingHistory();
        } catch (error) {
            this.emit('error', new Error(`Failed to initialize history storage: ${error}`));
        }
    }
    async loadExistingHistory() {
        try {
            const files = await fs.readdir(this.historyDir);
            const historyFiles = files.filter((f)=>f.endsWith('.history.json') || f.endsWith('.history.json.gz'));
            for (const file of historyFiles){
                try {
                    const filepath = join(this.historyDir, file);
                    let content;
                    if (file.endsWith('.gz')) {
                        const compressed = await fs.readFile(filepath);
                        const decompressed = await gunzipAsync(compressed);
                        content = decompressed.toString('utf-8');
                    } else {
                        content = await fs.readFile(filepath, 'utf-8');
                    }
                    const entry = JSON.parse(content);
                    this.history.set(entry.id, entry);
                } catch (error) {
                    console.warn(`Failed to load history entry ${file}:`, error);
                }
            }
            this.emit('history_loaded', this.history.size);
        } catch (error) {
            this.emit('error', new Error(`Failed to load history: ${error}`));
        }
    }
    startCleanupInterval() {
        this.cleanupInterval = setInterval(()=>{
            this.cleanupExpiredEntries();
        }, 6 * 60 * 60 * 1000);
    }
    async addEntry(snapshot, triggerType, triggerReason, triggerMetrics, recoveryStrategy, recoverySuccess, recoveryDuration, recoveryAttempts, verificationChecks, verificationPassed, rollbackRequired) {
        const id = this.generateHistoryId();
        const entry = {
            id,
            timestamp: Date.now(),
            snapshot,
            trigger: {
                type: triggerType,
                reason: triggerReason,
                metrics: triggerMetrics
            },
            recovery: {
                strategy: recoveryStrategy,
                success: recoverySuccess,
                duration: recoveryDuration,
                attempts: recoveryAttempts
            },
            verification: {
                passed: verificationPassed,
                checks: verificationChecks,
                rollbackRequired
            }
        };
        try {
            await this.storeHistoryEntry(entry);
            this.history.set(id, entry);
            await this.cleanupOldEntries();
            this.emit('entry_added', entry);
            return id;
        } catch (error) {
            this.emit('error', new Error(`Failed to add history entry: ${error}`));
            throw error;
        }
    }
    async storeHistoryEntry(entry) {
        const filename = `${entry.id}.history.json`;
        const filepath = join(this.historyDir, filename);
        let content = JSON.stringify(entry, null, 2);
        if (this.compressionEnabled) {
            const compressed = await gzipAsync(Buffer.from(content, 'utf-8'));
            await fs.writeFile(filepath + '.gz', compressed);
        } else {
            await fs.writeFile(filepath, content);
        }
    }
    async cleanupExpiredEntries() {
        const now = Date.now();
        const expiredEntries = [];
        for (const [id, entry] of this.history.entries()){
            if (now - entry.timestamp > this.ttlMs) {
                expiredEntries.push(id);
            }
        }
        for (const id of expiredEntries){
            await this.deleteEntry(id);
        }
        if (expiredEntries.length > 0) {
            this.emit('entries_expired', expiredEntries.length);
        }
    }
    async cleanupOldEntries() {
        if (this.history.size <= this.maxHistorySize) return;
        const sorted = Array.from(this.history.values()).sort((a, b)=>a.timestamp - b.timestamp);
        const toDelete = sorted.slice(0, sorted.length - this.maxHistorySize);
        for (const entry of toDelete){
            await this.deleteEntry(entry.id);
        }
    }
    async deleteEntry(id) {
        try {
            const filename = `${id}.history.json`;
            const filepath = join(this.historyDir, filename);
            await fs.unlink(filepath).catch(()=>{});
            await fs.unlink(filepath + '.gz').catch(()=>{});
            this.history.delete(id);
        } catch (error) {
            console.warn(`Failed to delete history entry ${id}:`, error);
        }
    }
    generateHistoryId() {
        return `history_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    getEntry(id) {
        return this.history.get(id) || null;
    }
    getRecentEntries(limit = 50) {
        return Array.from(this.history.values()).sort((a, b)=>b.timestamp - a.timestamp).slice(0, limit);
    }
    getEntriesByDateRange(startDate, endDate) {
        const startTime = startDate.getTime();
        const endTime = endDate.getTime();
        return Array.from(this.history.values()).filter((entry)=>entry.timestamp >= startTime && entry.timestamp <= endTime).sort((a, b)=>b.timestamp - a.timestamp);
    }
    getSuccessRate(timeframe = 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - timeframe;
        const recentEntries = Array.from(this.history.values()).filter((entry)=>entry.timestamp > cutoff);
        if (recentEntries.length === 0) return 100;
        const successCount = recentEntries.filter((entry)=>entry.recovery.success).length;
        return successCount / recentEntries.length * 100;
    }
    getStatistics() {
        const entries = Array.from(this.history.values());
        if (entries.length === 0) {
            return {
                totalEntries: 0,
                successRate: 100,
                averageRecoveryTime: 0,
                mostCommonFailureReason: 'none',
                rollbacksByTrigger: {}
            };
        }
        const successCount = entries.filter((e)=>e.recovery.success).length;
        const successRate = successCount / entries.length * 100;
        const totalRecoveryTime = entries.reduce((sum, e)=>sum + e.recovery.duration, 0);
        const averageRecoveryTime = totalRecoveryTime / entries.length;
        const failureReasons = entries.filter((e)=>!e.recovery.success).map((e)=>e.trigger.reason);
        const reasonCounts = failureReasons.reduce((acc, reason)=>{
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
        }, {});
        const mostCommonFailureReason = Object.entries(reasonCounts).sort(([, a], [, b])=>b - a)[0]?.[0] || 'none';
        const rollbacksByTrigger = entries.reduce((acc, entry)=>{
            acc[entry.trigger.type] = (acc[entry.trigger.type] || 0) + 1;
            return acc;
        }, {});
        return {
            totalEntries: entries.length,
            successRate,
            averageRecoveryTime,
            mostCommonFailureReason,
            rollbacksByTrigger
        };
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
    }
}
export class GitRollbackManager extends EventEmitter {
    gitDir;
    backupBranch;
    safetyChecks;
    constructor(gitDir = './', backupBranch = 'rollback-backup', safetyChecks = true){
        super();
        this.gitDir = gitDir;
        this.backupBranch = backupBranch;
        this.safetyChecks = safetyChecks;
    }
    async createRollbackPoint(message = 'Automated rollback point', tags = []) {
        try {
            await this.ensureGitRepo();
            if (this.safetyChecks) {
                await this.performSafetyChecks();
            }
            await this.createBackupBranch();
            await execAsync('git add -A', {
                cwd: this.gitDir
            });
            const rollbackMessage = this.formatRollbackMessage(message, tags);
            await execAsync(`git commit -m "${rollbackMessage}"`, {
                cwd: this.gitDir
            });
            const { stdout: commitHash } = await execAsync('git rev-parse HEAD', {
                cwd: this.gitDir
            });
            const hash = commitHash.trim();
            const tagName = `rollback-${Date.now()}`;
            await execAsync(`git tag -a "${tagName}" -m "Rollback point: ${message}"`, {
                cwd: this.gitDir
            });
            this.emit('rollback_point_created', {
                hash,
                tag: tagName,
                message
            });
            return hash;
        } catch (error) {
            this.emit('error', new Error(`Failed to create rollback point: ${error}`));
            throw error;
        }
    }
    async rollbackToCommit(commitHash, strategy = 'mixed', preserveUntracked = true) {
        try {
            if (this.safetyChecks) {
                await this.performSafetyChecks();
                await this.validateCommit(commitHash);
            }
            let stashRef = null;
            if (preserveUntracked) {
                try {
                    await execAsync('git stash push -u -m "Pre-rollback stash"', {
                        cwd: this.gitDir
                    });
                    stashRef = await this.getLastStashRef();
                } catch  {}
            }
            await execAsync(`git reset --${strategy} ${commitHash}`, {
                cwd: this.gitDir
            });
            if (strategy === 'hard' && stashRef && preserveUntracked) {
                try {
                    await execAsync(`git stash show -p ${stashRef} | git apply --index`, {
                        cwd: this.gitDir
                    });
                    await execAsync(`git stash drop ${stashRef}`, {
                        cwd: this.gitDir
                    });
                } catch  {
                    this.emit('warning', 'Rollback completed but failed to restore untracked files');
                }
            }
            const { stdout: currentHash } = await execAsync('git rev-parse HEAD', {
                cwd: this.gitDir
            });
            const success = currentHash.trim() === commitHash;
            if (success) {
                this.emit('rollback_completed', {
                    commitHash,
                    strategy
                });
            } else {
                throw new Error('Rollback verification failed');
            }
            return success;
        } catch (error) {
            this.emit('error', new Error(`Rollback failed: ${error}`));
            try {
                await this.emergencyRecovery();
            } catch (recoveryError) {
                this.emit('error', new Error(`Emergency recovery failed: ${recoveryError}`));
            }
            return false;
        }
    }
    async rollbackFiles(files, commitHash) {
        try {
            if (this.safetyChecks) {
                await this.validateCommit(commitHash);
                await this.validateFiles(files);
            }
            const backupStash = await this.createFileBackup(files);
            try {
                for (const file of files){
                    await execAsync(`git checkout ${commitHash} -- "${file}"`, {
                        cwd: this.gitDir
                    });
                }
                this.emit('files_rolled_back', {
                    files,
                    commitHash
                });
                return true;
            } catch (error) {
                if (backupStash) {
                    await this.restoreFileBackup(backupStash, files);
                }
                throw error;
            }
        } catch (error) {
            this.emit('error', new Error(`File rollback failed: ${error}`));
            return false;
        }
    }
    async createTestBranch(name) {
        try {
            const branchName = name || `rollback-test-${Date.now()}`;
            await execAsync(`git checkout -b "${branchName}"`, {
                cwd: this.gitDir
            });
            this.emit('test_branch_created', branchName);
            return branchName;
        } catch (error) {
            this.emit('error', new Error(`Failed to create test branch: ${error}`));
            throw error;
        }
    }
    async listRollbackPoints() {
        try {
            const { stdout } = await execAsync('git log --grep="\\[ROLLBACK\\]" --oneline --format="%H|%ai|%s" -n 50', {
                cwd: this.gitDir
            });
            const commits = stdout.trim().split('\n').filter(Boolean).map((line)=>{
                const [hash, dateStr, message] = line.split('|');
                return {
                    hash,
                    date: new Date(dateStr),
                    message: message.replace(/\[ROLLBACK\]/, '').trim(),
                    tags: this.extractTagsFromMessage(message)
                };
            });
            const { stdout: tagOutput } = await execAsync('git tag -l "rollback-*" --format="%(refname:short)|%(creatordate)|%(subject)"', {
                cwd: this.gitDir
            }).catch(()=>({
                    stdout: ''
                }));
            const taggedCommits = tagOutput.trim().split('\n').filter(Boolean).map((line)=>{
                const [tag, dateStr, message] = line.split('|');
                return {
                    hash: tag,
                    date: new Date(dateStr),
                    message: message || 'Tagged rollback point',
                    tags: [
                        tag
                    ]
                };
            });
            return [
                ...commits,
                ...taggedCommits
            ].sort((a, b)=>b.date.getTime() - a.date.getTime());
        } catch (error) {
            this.emit('error', new Error(`Failed to list rollback points: ${error}`));
            return [];
        }
    }
    async ensureGitRepo() {
        try {
            await execAsync('git rev-parse --git-dir', {
                cwd: this.gitDir
            });
        } catch  {
            throw new Error('Not a git repository');
        }
    }
    async performSafetyChecks() {
        const { stdout: status } = await execAsync('git status --porcelain', {
            cwd: this.gitDir
        });
        if (status.trim()) {
            this.emit('warning', 'Uncommitted changes detected');
        }
        const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
            cwd: this.gitDir
        });
        const currentBranch = branch.trim();
        const protectedBranches = [
            'main',
            'master',
            'production',
            'release'
        ];
        if (protectedBranches.includes(currentBranch)) {
            this.emit('warning', `Operating on protected branch: ${currentBranch}`);
        }
    }
    async createBackupBranch() {
        try {
            await execAsync(`git branch -D "${this.backupBranch}"`, {
                cwd: this.gitDir
            }).catch(()=>{});
            await execAsync(`git checkout -b "${this.backupBranch}"`, {
                cwd: this.gitDir
            });
            await execAsync('git checkout -', {
                cwd: this.gitDir
            });
        } catch (error) {
            this.emit('warning', `Failed to create backup branch: ${error}`);
        }
    }
    formatRollbackMessage(message, tags) {
        const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
        return `[ROLLBACK] ${message}${tagStr}`;
    }
    extractTagsFromMessage(message) {
        const match = message.match(/\[([^\]]+)\]/g);
        if (!match) return [];
        return match.map((tag)=>tag.slice(1, -1)).filter((tag)=>tag !== 'ROLLBACK');
    }
    async validateCommit(commitHash) {
        try {
            await execAsync(`git cat-file -e ${commitHash}`, {
                cwd: this.gitDir
            });
        } catch  {
            throw new Error(`Invalid commit hash: ${commitHash}`);
        }
    }
    async validateFiles(files) {
        for (const file of files){
            try {
                await fs.access(join(this.gitDir, file));
            } catch  {
                throw new Error(`File not found: ${file}`);
            }
        }
    }
    async getLastStashRef() {
        const { stdout } = await execAsync('git stash list -1 --format="%H"', {
            cwd: this.gitDir
        });
        return stdout.trim();
    }
    async createFileBackup(files) {
        try {
            for (const file of files){
                await execAsync(`git add "${file}"`, {
                    cwd: this.gitDir
                });
            }
            await execAsync('git stash push -m "File backup before rollback"', {
                cwd: this.gitDir
            });
            return await this.getLastStashRef();
        } catch  {
            return null;
        }
    }
    async restoreFileBackup(stashRef, files) {
        try {
            await execAsync(`git stash show -p ${stashRef} | git apply`, {
                cwd: this.gitDir
            });
            await execAsync(`git stash drop ${stashRef}`, {
                cwd: this.gitDir
            });
        } catch (error) {
            this.emit('error', new Error(`Failed to restore file backup: ${error}`));
        }
    }
    async emergencyRecovery() {
        try {
            if (this.backupBranch) {
                await execAsync(`git checkout "${this.backupBranch}"`, {
                    cwd: this.gitDir
                });
                await execAsync('git checkout -b "emergency-recovery"', {
                    cwd: this.gitDir
                });
                this.emit('emergency_recovery_completed', 'emergency-recovery');
            }
        } catch (error) {
            throw new Error(`Emergency recovery failed: ${error}`);
        }
    }
}
export class RollbackManager extends EventEmitter {
    stateManager;
    rollbackTrigger;
    automatedRecovery;
    rollbackHistory;
    gitRollbackManager;
    isInitialized = false;
    constructor(config = {}){
        super();
        this.stateManager = new StateManager(config.snapshotDir, config.maxSnapshots, config.compressionEnabled);
        this.rollbackTrigger = new RollbackTrigger(config.triggerConfig);
        this.automatedRecovery = new AutomatedRecovery(this.stateManager);
        this.rollbackHistory = new RollbackHistory(config.historyDir, config.maxHistorySize, config.historyTtlDays, config.compressionEnabled);
        this.gitRollbackManager = new GitRollbackManager(config.gitDir);
        this.setupEventHandlers();
    }
    setupEventHandlers() {
        this.rollbackTrigger.on('rollback_triggered', async (event)=>{
            await this.handleAutomaticRollback(event.metrics, event.reason);
        });
        this.stateManager.on('error', (error)=>this.emit('error', error));
        this.rollbackTrigger.on('error', (error)=>this.emit('error', error));
        this.automatedRecovery.on('error', (error)=>this.emit('error', error));
        this.rollbackHistory.on('error', (error)=>this.emit('error', error));
        this.gitRollbackManager.on('error', (error)=>this.emit('error', error));
        this.stateManager.on('snapshot_created', (snapshot)=>this.emit('snapshot_created', snapshot));
        this.automatedRecovery.on('recovery_success', (event)=>this.emit('recovery_success', event));
        this.gitRollbackManager.on('rollback_completed', (event)=>this.emit('git_rollback_completed', event));
    }
    async initialize() {
        if (this.isInitialized) return;
        try {
            this.rollbackTrigger.startMonitoring();
            this.isInitialized = true;
            this.emit('initialized');
        } catch (error) {
            this.emit('error', new Error(`Failed to initialize RollbackManager: ${error}`));
            throw error;
        }
    }
    async shutdown() {
        if (!this.isInitialized) return;
        try {
            this.rollbackTrigger.stopMonitoring();
            this.rollbackHistory.destroy();
            this.isInitialized = false;
            this.emit('shutdown');
        } catch (error) {
            this.emit('error', new Error(`Failed to shutdown RollbackManager: ${error}`));
        }
    }
    async createCheckpoint(description, tags = []) {
        try {
            const snapshot = await this.stateManager.captureSnapshot(description, tags, 'manual_checkpoint');
            await this.gitRollbackManager.createRollbackPoint(description, tags);
            this.emit('checkpoint_created', {
                snapshot: snapshot.id,
                description,
                tags
            });
            return snapshot.id;
        } catch (error) {
            this.emit('error', new Error(`Failed to create checkpoint: ${error}`));
            throw error;
        }
    }
    async rollbackToCheckpoint(snapshotId, strategy = 'graceful') {
        try {
            const snapshot = await this.stateManager.getSnapshot(snapshotId);
            if (!snapshot) {
                throw new Error(`Snapshot not found: ${snapshotId}`);
            }
            const startTime = Date.now();
            let success;
            if (strategy === 'graceful') {
                success = await this.performGracefulRollback(snapshot);
            } else {
                success = await this.performImmediateRollback(snapshot);
            }
            const duration = Date.now() - startTime;
            await this.rollbackHistory.addEntry(snapshot, 'manual', `Manual rollback to checkpoint ${snapshotId}`, undefined, strategy, success, duration, [], [], success, !success);
            if (success) {
                this.emit('manual_rollback_success', {
                    snapshotId,
                    strategy,
                    duration
                });
            } else {
                this.emit('manual_rollback_failed', {
                    snapshotId,
                    strategy,
                    duration
                });
            }
            return success;
        } catch (error) {
            this.emit('error', new Error(`Manual rollback failed: ${error}`));
            return false;
        }
    }
    async handleAutomaticRollback(metrics, reason) {
        try {
            const success = await this.automatedRecovery.executeRecovery(metrics, reason);
            if (success) {
                this.emit('automatic_rollback_success', {
                    reason,
                    metrics
                });
            } else {
                this.emit('automatic_rollback_failed', {
                    reason,
                    metrics
                });
            }
        } catch (error) {
            this.emit('error', new Error(`Automatic rollback failed: ${error}`));
        }
    }
    async performGracefulRollback(snapshot) {
        try {
            await this.stateManager.captureSnapshot('Pre-rollback backup', [
                'auto-backup'
            ], 'rollback_backup');
            const restoreSteps = [
                ()=>this.restoreConfiguration(snapshot),
                ()=>this.restoreMemoryState(snapshot),
                ()=>this.restoreFileSystem(snapshot),
                ()=>this.performGitRollback(snapshot)
            ];
            for (const step of restoreSteps){
                await step();
                await new Promise((resolve)=>setTimeout(resolve, 1000));
            }
            return true;
        } catch (error) {
            this.emit('graceful_rollback_error', error);
            return false;
        }
    }
    async performImmediateRollback(snapshot) {
        try {
            await Promise.all([
                this.restoreConfiguration(snapshot),
                this.restoreMemoryState(snapshot),
                this.restoreFileSystem(snapshot),
                this.performGitRollback(snapshot)
            ]);
            return true;
        } catch (error) {
            this.emit('immediate_rollback_error', error);
            return false;
        }
    }
    async restoreConfiguration(snapshot) {
        for (const [path, content] of Object.entries(snapshot.state.config)){
            try {
                await fs.writeFile(path, JSON.stringify(content, null, 2));
            } catch (error) {
                console.warn(`Failed to restore config ${path}:`, error);
            }
        }
    }
    async restoreMemoryState(snapshot) {
        for (const [path, content] of Object.entries(snapshot.state.memory)){
            try {
                await fs.writeFile(path, JSON.stringify(content, null, 2));
            } catch (error) {
                console.warn(`Failed to restore memory ${path}:`, error);
            }
        }
    }
    async restoreFileSystem(snapshot) {
        for (const file of snapshot.state.files){
            try {
                await fs.writeFile(file.path, file.content);
                await fs.chmod(file.path, file.stats.mode);
            } catch (error) {
                console.warn(`Failed to restore file ${file.path}:`, error);
            }
        }
    }
    async performGitRollback(snapshot) {
        if (snapshot.state.git.commit !== 'unknown') {
            try {
                await this.gitRollbackManager.rollbackToCommit(snapshot.state.git.commit);
            } catch (error) {
                console.warn('Git rollback failed:', error);
            }
        }
    }
    getStateManager() {
        return this.stateManager;
    }
    getRollbackTrigger() {
        return this.rollbackTrigger;
    }
    getAutomatedRecovery() {
        return this.automatedRecovery;
    }
    getRollbackHistory() {
        return this.rollbackHistory;
    }
    getGitRollbackManager() {
        return this.gitRollbackManager;
    }
    async getSystemStatus() {
        const snapshots = this.stateManager.listSnapshots();
        const recentEntries = this.rollbackHistory.getRecentEntries(10);
        const successRate = this.rollbackHistory.getSuccessRate();
        return {
            isMonitoring: this.rollbackTrigger.getCurrentMetrics() !== null,
            snapshotCount: snapshots.length,
            historyEntries: recentEntries.length,
            lastCheckpoint: snapshots[0]?.id || null,
            healthScore: successRate
        };
    }
}
export default RollbackManager;

//# sourceMappingURL=rollback.js.map