/**
 * Enhanced Persistence Layer with Comprehensive Error Handling
 * Wraps SwarmPersistence with robust error recovery and data protection
 */

import { SwarmPersistence } from './persistence.js';
import { ErrorHandlingManager, ErrorCategory, ErrorSeverity } from './error-handling-manager.js';
import fs from 'fs';
import path from 'path';

export class EnhancedSwarmPersistence {
    constructor(dbPath = null, options = {}) {
        this.errorHandler = new ErrorHandlingManager({
            retry: {
                maxRetries: 3,
                initialDelay: 1000,
                maxDelay: 10000
            },
            circuitBreaker: {
                failureThreshold: 5,
                recoveryTimeout: 30000
            },
            ...options.errorHandling
        });

        this.persistence = null;
        this.dbPath = dbPath;
        this.backupPath = options.backupPath || path.join(path.dirname(dbPath || './data/ruv-swarm.db'), 'backups');
        this.isInMemoryMode = false;
        this.memoryStore = new Map();
        this.transactionLog = [];
        this.corruptionDetector = new DatabaseCorruptionDetector();
        
        this.initializePersistence();
    }

    async initializePersistence() {
        try {
            await this.errorHandler.wrapOperation(async () => {
                // Ensure backup directory exists
                if (!fs.existsSync(this.backupPath)) {
                    fs.mkdirSync(this.backupPath, { recursive: true });
                }

                // Check database integrity before connecting
                if (this.dbPath && fs.existsSync(this.dbPath)) {
                    await this.corruptionDetector.checkDatabaseIntegrity(this.dbPath);
                }

                this.persistence = new SwarmPersistence(this.dbPath);
                console.log('✅ Persistence layer initialized successfully');
            }, {
                category: ErrorCategory.PERSISTENCE,
                component: 'persistence',
                operation: 'initialize'
            });
        } catch (error) {
            console.error('❌ Failed to initialize persistence, falling back to in-memory mode:', error.message);
            this.enableInMemoryMode();
        }
    }

    enableInMemoryMode() {
        this.isInMemoryMode = true;
        this.persistence = null;
        console.warn('⚠️ Operating in in-memory mode - data will not persist across restarts');
    }

    // Enhanced swarm operations with error handling
    async createSwarm(swarm) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.createSwarmInMemory(swarm);
            }

            // Validate swarm data
            this.validateSwarmData(swarm);

            // Create backup before operation
            await this.createOperationBackup('create_swarm', swarm);

            // Record transaction
            const transactionId = this.recordTransaction('create_swarm', swarm);

            try {
                const result = this.persistence.createSwarm(swarm);
                this.commitTransaction(transactionId);
                return result;
            } catch (error) {
                this.rollbackTransaction(transactionId);
                throw error;
            }
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'createSwarm',
            swarmId: swarm.id
        });
    }

    async getActiveSwarms() {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.getActiveSwarmsFromMemory();
            }

            const swarms = this.persistence.getActiveSwarms();
            
            // Validate retrieved data
            swarms.forEach(swarm => {
                if (!this.isValidSwarmData(swarm)) {
                    console.warn(`Invalid swarm data detected: ${swarm.id}`);
                }
            });

            return swarms;
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'getActiveSwarms'
        });
    }

    // Enhanced agent operations
    async createAgent(agent) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.createAgentInMemory(agent);
            }

            this.validateAgentData(agent);
            
            const transactionId = this.recordTransaction('create_agent', agent);

            try {
                const result = this.persistence.createAgent(agent);
                this.commitTransaction(transactionId);
                return result;
            } catch (error) {
                this.rollbackTransaction(transactionId);
                throw error;
            }
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'createAgent',
            agentId: agent.id
        });
    }

    async updateAgentStatus(agentId, status) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.updateAgentStatusInMemory(agentId, status);
            }

            this.validateStatusValue(status);
            
            const transactionId = this.recordTransaction('update_agent_status', { agentId, status });

            try {
                const result = this.persistence.updateAgentStatus(agentId, status);
                this.commitTransaction(transactionId);
                return result;
            } catch (error) {
                this.rollbackTransaction(transactionId);
                throw error;
            }
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'updateAgentStatus',
            agentId
        });
    }

    // Enhanced memory operations with TTL and cleanup
    async storeMemory(agentId, key, value, ttlSecs = null) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.storeMemoryInMemory(agentId, key, value, ttlSecs);
            }

            this.validateMemoryData(agentId, key, value);
            
            const transactionId = this.recordTransaction('store_memory', { agentId, key, ttlSecs });

            try {
                const result = this.persistence.storeMemory(agentId, key, value, ttlSecs);
                this.commitTransaction(transactionId);
                return result;
            } catch (error) {
                this.rollbackTransaction(transactionId);
                throw error;
            }
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'storeMemory',
            agentId
        });
    }

    async getMemory(agentId, key) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.getMemoryFromMemory(agentId, key);
            }

            const memory = this.persistence.getMemory(agentId, key);
            
            if (memory && this.isCorruptedMemoryData(memory)) {
                console.warn(`Corrupted memory data detected for agent ${agentId}, key ${key}`);
                await this.cleanupCorruptedMemory(agentId, key);
                return null;
            }

            return memory;
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'getMemory',
            agentId
        });
    }

    // Data validation methods
    validateSwarmData(swarm) {
        if (!swarm || typeof swarm !== 'object') {
            throw new Error('Invalid swarm data: must be an object');
        }
        
        if (!swarm.id || typeof swarm.id !== 'string') {
            throw new Error('Invalid swarm data: id is required and must be a string');
        }
        
        if (!swarm.name || typeof swarm.name !== 'string') {
            throw new Error('Invalid swarm data: name is required and must be a string');
        }
        
        if (!swarm.topology || typeof swarm.topology !== 'string') {
            throw new Error('Invalid swarm data: topology is required and must be a string');
        }
        
        if (typeof swarm.maxAgents !== 'number' || swarm.maxAgents < 1) {
            throw new Error('Invalid swarm data: maxAgents must be a positive number');
        }
    }

    validateAgentData(agent) {
        if (!agent || typeof agent !== 'object') {
            throw new Error('Invalid agent data: must be an object');
        }
        
        if (!agent.id || typeof agent.id !== 'string') {
            throw new Error('Invalid agent data: id is required and must be a string');
        }
        
        if (!agent.swarmId || typeof agent.swarmId !== 'string') {
            throw new Error('Invalid agent data: swarmId is required and must be a string');
        }
        
        if (!agent.name || typeof agent.name !== 'string') {
            throw new Error('Invalid agent data: name is required and must be a string');
        }
        
        if (!agent.type || typeof agent.type !== 'string') {
            throw new Error('Invalid agent data: type is required and must be a string');
        }
    }

    validateMemoryData(agentId, key, value) {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('Invalid memory data: agentId is required and must be a string');
        }
        
        if (!key || typeof key !== 'string') {
            throw new Error('Invalid memory data: key is required and must be a string');
        }
        
        if (value === undefined) {
            throw new Error('Invalid memory data: value cannot be undefined');
        }
        
        // Check for circular references in value
        try {
            JSON.stringify(value);
        } catch (error) {
            throw new Error('Invalid memory data: value contains circular references or is not serializable');
        }
    }

    validateStatusValue(status) {
        const validStatuses = ['idle', 'active', 'busy', 'error', 'offline'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status value: ${status}. Must be one of: ${validStatuses.join(', ')}`);
        }
    }

    // In-memory mode implementations
    createSwarmInMemory(swarm) {
        const memoryKey = `swarm:${swarm.id}`;
        this.memoryStore.set(memoryKey, {
            ...swarm,
            status: 'active',
            created_at: new Date().toISOString()
        });
        return { changes: 1 };
    }

    getActiveSwarmsFromMemory() {
        const swarms = [];
        for (const [key, value] of this.memoryStore) {
            if (key.startsWith('swarm:') && value.status === 'active') {
                swarms.push(value);
            }
        }
        return swarms;
    }

    createAgentInMemory(agent) {
        const memoryKey = `agent:${agent.id}`;
        this.memoryStore.set(memoryKey, {
            ...agent,
            status: 'idle',
            created_at: new Date().toISOString()
        });
        return { changes: 1 };
    }

    updateAgentStatusInMemory(agentId, status) {
        const memoryKey = `agent:${agentId}`;
        const agent = this.memoryStore.get(memoryKey);
        if (agent) {
            agent.status = status;
            this.memoryStore.set(memoryKey, agent);
            return { changes: 1 };
        }
        return { changes: 0 };
    }

    storeMemoryInMemory(agentId, key, value, ttlSecs) {
        const memoryKey = `memory:${agentId}:${key}`;
        const expiresAt = ttlSecs ? Date.now() + (ttlSecs * 1000) : null;
        
        this.memoryStore.set(memoryKey, {
            agent_id: agentId,
            key,
            value: JSON.stringify(value),
            expires_at: expiresAt,
            created_at: new Date().toISOString()
        });
        return { changes: 1 };
    }

    getMemoryFromMemory(agentId, key) {
        const memoryKey = `memory:${agentId}:${key}`;
        const memory = this.memoryStore.get(memoryKey);
        
        if (!memory) return null;
        
        // Check TTL
        if (memory.expires_at && Date.now() > memory.expires_at) {
            this.memoryStore.delete(memoryKey);
            return null;
        }
        
        return {
            ...memory,
            value: JSON.parse(memory.value)
        };
    }

    // Transaction management
    recordTransaction(operation, data) {
        const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.transactionLog.push({
            id: transactionId,
            operation,
            data: JSON.parse(JSON.stringify(data)), // Deep clone
            timestamp: new Date().toISOString(),
            status: 'pending'
        });
        return transactionId;
    }

    commitTransaction(transactionId) {
        const transaction = this.transactionLog.find(tx => tx.id === transactionId);
        if (transaction) {
            transaction.status = 'committed';
            transaction.commitTime = new Date().toISOString();
        }
    }

    rollbackTransaction(transactionId) {
        const transaction = this.transactionLog.find(tx => tx.id === transactionId);
        if (transaction) {
            transaction.status = 'rolled_back';
            transaction.rollbackTime = new Date().toISOString();
            console.warn(`Transaction ${transactionId} rolled back: ${transaction.operation}`);
        }
    }

    // Backup and recovery
    async createOperationBackup(operation, data) {
        try {
            if (!this.persistence || this.isInMemoryMode) return;
            
            const backupFileName = `backup_${operation}_${Date.now()}.json`;
            const backupFilePath = path.join(this.backupPath, backupFileName);
            
            const backupData = {
                operation,
                data,
                timestamp: new Date().toISOString(),
                database_size: fs.statSync(this.dbPath).size
            };
            
            fs.writeFileSync(backupFilePath, JSON.stringify(backupData, null, 2));
        } catch (error) {
            console.warn('Failed to create backup:', error.message);
        }
    }

    // Data integrity checks
    isValidSwarmData(swarm) {
        return swarm && 
               typeof swarm.id === 'string' && 
               typeof swarm.name === 'string' && 
               typeof swarm.topology === 'string';
    }

    isCorruptedMemoryData(memory) {
        try {
            if (memory.value) {
                JSON.parse(memory.value);
            }
            return false;
        } catch (error) {
            return true;
        }
    }

    async cleanupCorruptedMemory(agentId, key) {
        try {
            if (this.isInMemoryMode) {
                this.memoryStore.delete(`memory:${agentId}:${key}`);
            } else {
                this.persistence.deleteMemory(agentId, key);
            }
            console.log(`Cleaned up corrupted memory for agent ${agentId}, key ${key}`);
        } catch (error) {
            console.error('Failed to cleanup corrupted memory:', error.message);
        }
    }

    // Health monitoring
    async performHealthCheck() {
        const health = {
            persistence: {
                mode: this.isInMemoryMode ? 'memory' : 'database',
                database_accessible: false,
                database_size: 0,
                transaction_log_size: this.transactionLog.length
            },
            memory_store: {
                entries: this.memoryStore.size,
                estimated_size_mb: this.estimateMemoryStoreSize()
            },
            error_handling: this.errorHandler.getHealthStatus()
        };

        if (!this.isInMemoryMode && this.persistence) {
            try {
                // Test database connection
                await this.persistence.getActiveSwarms();
                health.persistence.database_accessible = true;
                
                if (fs.existsSync(this.dbPath)) {
                    health.persistence.database_size = fs.statSync(this.dbPath).size;
                }
            } catch (error) {
                health.persistence.error = error.message;
            }
        }

        return health;
    }

    estimateMemoryStoreSize() {
        let totalSize = 0;
        for (const [key, value] of this.memoryStore) {
            totalSize += JSON.stringify({ key, value }).length;
        }
        return totalSize / (1024 * 1024); // Convert to MB
    }

    // Cleanup and maintenance
    async performMaintenance() {
        console.log('🔧 Performing persistence maintenance...');
        
        // Clean up expired memory entries
        await this.cleanupExpiredMemory();
        
        // Clean up old transaction logs
        await this.cleanupTransactionLog();
        
        // Clean up old backups
        await this.cleanupOldBackups();
        
        // Run database maintenance if available
        if (!this.isInMemoryMode && this.persistence) {
            try {
                this.persistence.cleanup();
                console.log('✅ Database maintenance completed');
            } catch (error) {
                console.warn('Database maintenance failed:', error.message);
            }
        }
    }

    async cleanupExpiredMemory() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [key, value] of this.memoryStore) {
            if (key.startsWith('memory:') && value.expires_at && now > value.expires_at) {
                this.memoryStore.delete(key);
                cleanedCount++;
            }
        }
        
        console.log(`🧹 Cleaned up ${cleanedCount} expired memory entries`);
    }

    async cleanupTransactionLog() {
        const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
        const initialCount = this.transactionLog.length;
        
        this.transactionLog = this.transactionLog.filter(tx => 
            new Date(tx.timestamp).getTime() > cutoffTime
        );
        
        const cleanedCount = initialCount - this.transactionLog.length;
        console.log(`🧹 Cleaned up ${cleanedCount} old transaction log entries`);
    }

    async cleanupOldBackups() {
        try {
            if (!fs.existsSync(this.backupPath)) return;
            
            const files = fs.readdirSync(this.backupPath);
            const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
            let cleanedCount = 0;
            
            for (const file of files) {
                const filePath = path.join(this.backupPath, file);
                const stats = fs.statSync(filePath);
                
                if (stats.mtime.getTime() < cutoffTime) {
                    fs.unlinkSync(filePath);
                    cleanedCount++;
                }
            }
            
            console.log(`🧹 Cleaned up ${cleanedCount} old backup files`);
        } catch (error) {
            console.warn('Failed to cleanup old backups:', error.message);
        }
    }

    // Expose methods from original persistence with error handling
    async getAgent(id) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                const agent = this.memoryStore.get(`agent:${id}`);
                return agent || null;
            }
            return this.persistence.getAgent(id);
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'getAgent',
            agentId: id
        });
    }

    async getSwarmAgents(swarmId, filter = 'all') {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                const agents = [];
                for (const [key, value] of this.memoryStore) {
                    if (key.startsWith('agent:') && value.swarmId === swarmId) {
                        if (filter === 'all' || value.status === filter) {
                            agents.push(value);
                        }
                    }
                }
                return agents;
            }
            return this.persistence.getSwarmAgents(swarmId, filter);
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'getSwarmAgents',
            swarmId
        });
    }

    // Pass through other methods with error handling
    async createTask(task) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                this.memoryStore.set(`task:${task.id}`, task);
                return { changes: 1 };
            }
            return this.persistence.createTask(task);
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'createTask'
        });
    }

    async getTask(id) {
        return await this.errorHandler.wrapOperation(async () => {
            if (this.isInMemoryMode) {
                return this.memoryStore.get(`task:${id}`) || null;
            }
            return this.persistence.getTask(id);
        }, {
            category: ErrorCategory.PERSISTENCE,
            component: 'persistence',
            operation: 'getTask'
        });
    }

    // Delegate database property access
    get db() {
        return this.persistence?.db;
    }
}

/**
 * Database Corruption Detection Utility
 */
class DatabaseCorruptionDetector {
    async checkDatabaseIntegrity(dbPath) {
        try {
            const stats = fs.statSync(dbPath);
            
            // Check if file size is reasonable (not 0 or suspiciously small)
            if (stats.size < 1024) { // Less than 1KB might indicate corruption
                console.warn(`Database file ${dbPath} is suspiciously small (${stats.size} bytes)`);
            }
            
            // Additional integrity checks could be added here
            // such as trying to open the database and run a simple query
            
        } catch (error) {
            throw new Error(`Database integrity check failed: ${error.message}`);
        }
    }
}

export default EnhancedSwarmPersistence;