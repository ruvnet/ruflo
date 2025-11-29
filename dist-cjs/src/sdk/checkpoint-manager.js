import { query } from '@anthropic-ai/claude-code';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
export class RealCheckpointManager extends EventEmitter {
    checkpoints = new Map();
    sessionMessages = new Map();
    persistPath;
    autoCheckpointInterval;
    maxCheckpoints;
    messageCounters = new Map();
    constructor(options = {}){
        super();
        this.persistPath = options.persistPath || '.claude-flow/checkpoints';
        this.autoCheckpointInterval = options.autoCheckpointInterval || 10;
        this.maxCheckpoints = options.maxCheckpoints || 50;
        this.ensurePersistPath();
    }
    async ensurePersistPath() {
        try {
            await fs.mkdir(this.persistPath, {
                recursive: true
            });
        } catch (error) {}
    }
    async trackSession(sessionId, queryGenerator, autoCheckpoint = false) {
        const messages = this.sessionMessages.get(sessionId) || [];
        this.sessionMessages.set(sessionId, messages);
        let messageCount = this.messageCounters.get(sessionId) || 0;
        for await (const message of queryGenerator){
            messages.push(message);
            messageCount++;
            this.messageCounters.set(sessionId, messageCount);
            this.emit('message:tracked', {
                sessionId,
                messageCount,
                messageType: message.type,
                messageUuid: message.uuid
            });
            if (autoCheckpoint && messageCount % this.autoCheckpointInterval === 0) {
                await this.createCheckpoint(sessionId, `Auto-checkpoint at ${messageCount} messages`);
            }
        }
    }
    async createCheckpoint(sessionId, description) {
        const messages = this.sessionMessages.get(sessionId);
        if (!messages || messages.length === 0) {
            throw new Error(`No messages tracked for session: ${sessionId}`);
        }
        const lastMessage = messages[messages.length - 1];
        const checkpointId = lastMessage.uuid;
        const totalTokens = this.calculateTotalTokens(messages);
        const filesModified = this.extractFilesModified(messages);
        const checkpoint = {
            id: checkpointId,
            sessionId,
            description,
            timestamp: Date.now(),
            messageCount: messages.length,
            totalTokens,
            filesModified
        };
        this.checkpoints.set(checkpointId, checkpoint);
        await this.persistCheckpoint(checkpoint);
        await this.enforceCheckpointLimit(sessionId);
        this.emit('checkpoint:created', {
            checkpointId,
            sessionId,
            description,
            messageCount: messages.length
        });
        return checkpointId;
    }
    async rollbackToCheckpoint(checkpointId, continuePrompt) {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (!checkpoint) {
            const loaded = await this.loadCheckpoint(checkpointId);
            if (!loaded) {
                throw new Error(`Checkpoint not found: ${checkpointId}`);
            }
        }
        const chkpt = this.checkpoints.get(checkpointId);
        const rolledBackQuery = query({
            prompt: continuePrompt || 'Continue from checkpoint',
            options: {
                resume: chkpt.sessionId,
                resumeSessionAt: checkpointId
            }
        });
        this.emit('checkpoint:rollback', {
            checkpointId,
            sessionId: chkpt.sessionId,
            description: chkpt.description
        });
        return rolledBackQuery;
    }
    listCheckpoints(sessionId) {
        return Array.from(this.checkpoints.values()).filter((c)=>c.sessionId === sessionId).sort((a, b)=>b.timestamp - a.timestamp);
    }
    getCheckpoint(checkpointId) {
        return this.checkpoints.get(checkpointId);
    }
    async deleteCheckpoint(checkpointId) {
        const checkpoint = this.checkpoints.get(checkpointId);
        if (checkpoint) {
            this.checkpoints.delete(checkpointId);
            await this.deletePersistedCheckpoint(checkpointId);
            this.emit('checkpoint:deleted', {
                checkpointId,
                sessionId: checkpoint.sessionId
            });
        }
    }
    getCheckpointDiff(fromId, toId) {
        const from = this.checkpoints.get(fromId);
        const to = this.checkpoints.get(toId);
        if (!from || !to) {
            throw new Error('Checkpoint not found');
        }
        const fromFiles = new Set(from.filesModified);
        const toFiles = new Set(to.filesModified);
        const filesAdded = Array.from(toFiles).filter((f)=>!fromFiles.has(f));
        const filesRemoved = Array.from(fromFiles).filter((f)=>!toFiles.has(f));
        return {
            messagesDiff: to.messageCount - from.messageCount,
            tokensDiff: to.totalTokens - from.totalTokens,
            filesAdded,
            filesRemoved
        };
    }
    calculateTotalTokens(messages) {
        let total = 0;
        for (const msg of messages){
            if ('message' in msg && 'usage' in msg.message) {
                const usage = msg.message.usage;
                total += (usage.input_tokens || 0) + (usage.output_tokens || 0);
            }
        }
        return total;
    }
    extractFilesModified(messages) {
        const files = new Set();
        for (const msg of messages){
            if (msg.type === 'assistant' && 'message' in msg) {
                const content = msg.message.content;
                for (const block of content){
                    if (block.type === 'tool_use') {
                        if (block.name === 'Edit' || block.name === 'Write' || block.name === 'FileEdit' || block.name === 'FileWrite') {
                            const input = block.input;
                            if (input.file_path) {
                                files.add(input.file_path);
                            }
                        }
                    }
                }
            }
        }
        return Array.from(files);
    }
    async persistCheckpoint(checkpoint) {
        const filePath = join(this.persistPath, `${checkpoint.id}.json`);
        try {
            await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
            this.emit('persist:saved', {
                checkpointId: checkpoint.id,
                filePath
            });
        } catch (error) {
            this.emit('persist:error', {
                checkpointId: checkpoint.id,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async loadCheckpoint(checkpointId) {
        const filePath = join(this.persistPath, `${checkpointId}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            const checkpoint = JSON.parse(data);
            this.checkpoints.set(checkpointId, checkpoint);
            this.emit('persist:loaded', {
                checkpointId,
                filePath
            });
            return true;
        } catch (error) {
            return false;
        }
    }
    async deletePersistedCheckpoint(checkpointId) {
        const filePath = join(this.persistPath, `${checkpointId}.json`);
        try {
            await fs.unlink(filePath);
            this.emit('persist:deleted', {
                checkpointId
            });
        } catch (error) {}
    }
    async enforceCheckpointLimit(sessionId) {
        const sessionCheckpoints = this.listCheckpoints(sessionId);
        if (sessionCheckpoints.length > this.maxCheckpoints) {
            const toDelete = sessionCheckpoints.slice(this.maxCheckpoints);
            for (const checkpoint of toDelete){
                await this.deleteCheckpoint(checkpoint.id);
            }
            this.emit('checkpoint:limit_enforced', {
                sessionId,
                deleted: toDelete.length
            });
        }
    }
    async listPersistedCheckpoints() {
        try {
            const files = await fs.readdir(this.persistPath);
            return files.filter((f)=>f.endsWith('.json')).map((f)=>f.replace('.json', ''));
        } catch (error) {
            return [];
        }
    }
    async loadAllCheckpoints() {
        const checkpointIds = await this.listPersistedCheckpoints();
        let loaded = 0;
        for (const id of checkpointIds){
            if (await this.loadCheckpoint(id)) {
                loaded++;
            }
        }
        this.emit('checkpoints:loaded', {
            count: loaded
        });
        return loaded;
    }
}
export const checkpointManager = new RealCheckpointManager();

//# sourceMappingURL=checkpoint-manager.js.map