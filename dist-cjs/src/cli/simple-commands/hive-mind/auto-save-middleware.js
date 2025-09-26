export class AutoSaveMiddleware {
    constructor(sessionId, sessionManager, saveInterval = 30000){
        this.sessionId = sessionId;
        this.saveInterval = saveInterval;
        this.sessionManager = sessionManager;
        this.saveTimer = null;
        this.pendingChanges = [];
        this.isActive = false;
        this.childProcesses = new Set();
    }
    start() {
        if (this.isActive) {
            return;
        }
        this.isActive = true;
        this.saveTimer = setInterval(()=>{
            if (this.pendingChanges.length > 0) {
                this.performAutoSave();
            }
        }, this.saveInterval);
        process.on('beforeExit', ()=>{
            this.performAutoSave();
        });
        process.on('SIGINT', async ()=>{
            console.log('\n\nReceived SIGINT, cleaning up...');
            await this.cleanup();
            process.exit(0);
        });
        process.on('SIGTERM', async ()=>{
            console.log('\n\nReceived SIGTERM, cleaning up...');
            await this.cleanup();
            process.exit(0);
        });
    }
    stop() {
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
        this.isActive = false;
        if (this.pendingChanges.length > 0) {
            this.performAutoSave();
        }
        this.sessionManager.close();
    }
    trackChange(changeType, data) {
        this.pendingChanges.push({
            type: changeType,
            data: data,
            timestamp: new Date().toISOString()
        });
        if (changeType === 'task_completed' || changeType === 'agent_spawned' || changeType === 'consensus_reached') {
            this.performAutoSave();
        }
    }
    trackTaskProgress(taskId, status, result = null) {
        this.trackChange('task_progress', {
            taskId,
            status,
            result
        });
    }
    trackAgentActivity(agentId, activity, data = null) {
        this.trackChange('agent_activity', {
            agentId,
            activity,
            data
        });
    }
    trackMemoryUpdate(key, value, type = 'general') {
        this.trackChange('memory_update', {
            key,
            value,
            type
        });
    }
    trackConsensusDecision(topic, decision, votes) {
        this.trackChange('consensus_reached', {
            topic,
            decision,
            votes
        });
    }
    async performAutoSave() {
        if (this.pendingChanges.length === 0) {
            return;
        }
        try {
            const changesByType = this.pendingChanges.reduce((acc, change)=>{
                if (!acc[change.type]) {
                    acc[change.type] = [];
                }
                acc[change.type].push(change);
                return acc;
            }, {});
            const taskProgress = changesByType.task_progress || [];
            const completedTasks = taskProgress.filter((t)=>t.data.status === 'completed').length;
            const totalTasks = taskProgress.length;
            const completionPercentage = totalTasks > 0 ? Math.round(completedTasks / totalTasks * 100) : 0;
            const checkpointData = {
                timestamp: new Date().toISOString(),
                changeCount: this.pendingChanges.length,
                changesByType,
                statistics: {
                    tasksProcessed: taskProgress.length,
                    tasksCompleted: completedTasks,
                    memoryUpdates: (changesByType.memory_update || []).length,
                    agentActivities: (changesByType.agent_activity || []).length,
                    consensusDecisions: (changesByType.consensus_reached || []).length
                }
            };
            const checkpointName = `auto-save-${Date.now()}`;
            await this.sessionManager.saveCheckpoint(this.sessionId, checkpointName, checkpointData);
            if (completionPercentage > 0) {
                await this.sessionManager.updateSessionProgress(this.sessionId, completionPercentage);
            }
            for (const change of this.pendingChanges){
                this.sessionManager.logSessionEvent(this.sessionId, 'info', `Auto-save: ${change.type}`, change.data.agentId || null, change.data);
            }
            this.pendingChanges = [];
        } catch (error) {
            console.error('Auto-save failed:', error);
        }
    }
    async forceSave() {
        await this.performAutoSave();
    }
    getPendingChangesCount() {
        return this.pendingChanges.length;
    }
    isAutoSaveActive() {
        return this.isActive;
    }
    registerChildProcess(childProcess) {
        if (childProcess && childProcess.pid) {
            this.childProcesses.add(childProcess);
            this.sessionManager.addChildPid(this.sessionId, childProcess.pid);
            childProcess.on('exit', ()=>{
                this.childProcesses.delete(childProcess);
                this.sessionManager.removeChildPid(this.sessionId, childProcess.pid);
            });
        }
    }
    async cleanup() {
        try {
            if (this.saveTimer) {
                clearInterval(this.saveTimer);
                this.saveTimer = null;
            }
            await this.performAutoSave();
            for (const childProcess of this.childProcesses){
                try {
                    if (childProcess.pid) {
                        console.log(`Terminating child process ${childProcess.pid}...`);
                        childProcess.kill('SIGTERM');
                        await new Promise((resolve)=>setTimeout(resolve, 100));
                        try {
                            process.kill(childProcess.pid, 0);
                            childProcess.kill('SIGKILL');
                        } catch (e) {}
                    }
                } catch (error) {
                    console.error(`Failed to terminate child process:`, error.message);
                }
            }
            this.childProcesses.clear();
            const session = await this.sessionManager.getSession(this.sessionId);
            if (session && (session.status === 'active' || session.status === 'paused')) {
                await this.sessionManager.stopSession(this.sessionId);
            }
            this.sessionManager.close();
            console.log('Cleanup completed successfully');
        } catch (error) {
            console.error('Error during cleanup:', error);
        }
    }
}
export function createAutoSaveMiddleware(sessionId, sessionManager, options = {}) {
    const saveInterval = options.saveInterval || 30000;
    const middleware = new AutoSaveMiddleware(sessionId, sessionManager, saveInterval);
    if (options.autoStart !== false) {
        middleware.start();
    }
    return middleware;
}
export default AutoSaveMiddleware;

//# sourceMappingURL=auto-save-middleware.js.map