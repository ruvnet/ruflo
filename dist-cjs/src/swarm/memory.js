import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
export class SwarmMemoryManager extends EventEmitter {
    logger;
    config;
    memory;
    partitions = new Map();
    entries = new Map();
    index;
    cache;
    replication;
    persistence;
    encryption;
    isInitialized = false;
    syncTimer;
    backupTimer;
    cleanupTimer;
    constructor(config = {}){
        super();
        const logLevel = config.logging?.level || 'error';
        const logFormat = config.logging?.format || 'text';
        const logDestination = config.logging?.destination || 'console';
        this.logger = new Logger({
            level: logLevel,
            format: logFormat,
            destination: logDestination
        }, {
            component: 'SwarmMemoryManager'
        });
        this.config = this.mergeWithDefaults(config);
        this.memory = {
            namespace: this.config.namespace,
            partitions: [],
            permissions: {
                read: 'swarm',
                write: 'team',
                delete: 'private',
                share: 'team'
            },
            persistent: true,
            backupEnabled: true,
            distributed: this.config.enableDistribution,
            consistency: this.config.consistencyLevel,
            cacheEnabled: this.config.enableCaching,
            compressionEnabled: this.config.enableCompression
        };
        this.index = new MemoryIndex();
        this.cache = new MemoryCache(this.config.cacheSize, this.config.cacheTtl);
        this.replication = new MemoryReplication(this.config);
        this.persistence = new MemoryPersistence(this.config);
        this.encryption = new MemoryEncryption(this.config);
        this.setupEventHandlers();
    }
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        this.logger.info('Initializing swarm memory manager...');
        try {
            await this.persistence.initialize();
            await this.encryption.initialize();
            await this.replication.initialize();
            await this.index.initialize();
            await this.loadMemoryState();
            await this.createDefaultPartitions();
            this.startBackgroundProcesses();
            this.isInitialized = true;
            this.emit('memory:initialized', {
                namespace: this.config.namespace,
                entriesLoaded: this.entries.size,
                partitionsLoaded: this.partitions.size
            });
            this.logger.info('Swarm memory manager initialized', {
                namespace: this.config.namespace,
                entries: this.entries.size,
                partitions: this.partitions.size
            });
        } catch (error) {
            this.logger.error('Failed to initialize memory manager', {
                error
            });
            throw error;
        }
    }
    async shutdown() {
        if (!this.isInitialized) {
            return;
        }
        this.logger.info('Shutting down swarm memory manager...');
        try {
            this.stopBackgroundProcesses();
            await this.saveMemoryState();
            await this.replication.shutdown();
            await this.persistence.shutdown();
            await this.encryption.shutdown();
            this.isInitialized = false;
            this.emit('memory:shutdown');
            this.logger.info('Swarm memory manager shut down');
        } catch (error) {
            this.logger.error('Error during memory manager shutdown', {
                error
            });
        }
    }
    async store(key, value, options = {}) {
        this.ensureInitialized();
        const entryId = generateId('mem');
        const now = new Date();
        if (options.owner) {
            await this.validateAccess(options.owner, 'write', options.partition);
        }
        const partitionName = options.partition || 'default';
        const partition = await this.getOrCreatePartition(partitionName);
        const entry = {
            id: entryId,
            key,
            value: await this.serializeValue(value),
            type: options.type || 'knowledge',
            tags: options.tags || [],
            owner: options.owner || {
                id: 'system',
                swarmId: '',
                type: 'coordinator',
                instance: 0
            },
            accessLevel: options.accessLevel || 'team',
            createdAt: now,
            updatedAt: now,
            expiresAt: options.ttl ? new Date(now.getTime() + options.ttl) : undefined,
            version: 1,
            references: [],
            dependencies: []
        };
        const entrySize = this.calculateEntrySize(entry);
        if (entrySize > this.config.maxEntrySize) {
            throw new Error(`Entry size ${entrySize} exceeds maximum ${this.config.maxEntrySize}`);
        }
        await this.enforceMemoryLimits(entrySize);
        this.entries.set(entryId, entry);
        partition.entries.push(entry);
        await this.index.addEntry(entry);
        if (this.config.enableCaching) {
            this.cache.set(key, entry);
        }
        if (this.config.enableDistribution) {
            await this.replication.replicate(entry);
        }
        this.emit('memory:stored', {
            entryId,
            key,
            partition: partitionName,
            type: entry.type,
            size: entrySize
        });
        this.logger.debug('Stored memory entry', {
            entryId,
            key,
            partition: partitionName,
            type: entry.type,
            size: entrySize
        });
        return entryId;
    }
    async retrieve(key, options = {}) {
        this.ensureInitialized();
        if (this.config.enableCaching) {
            const cached = this.cache.get(key);
            if (cached && !this.isExpired(cached)) {
                if (options.requester) {
                    await this.validateAccess(options.requester, 'read', options.partition);
                }
                return options.includeMetadata ? cached : await this.deserializeValue(cached.value);
            }
        }
        const entry = await this.findEntry(key, options.partition);
        if (!entry) {
            return null;
        }
        if (this.isExpired(entry)) {
            await this.deleteEntry(entry.id);
            return null;
        }
        if (options.requester) {
            await this.validateAccess(options.requester, 'read', options.partition);
        }
        if (this.config.enableCaching) {
            this.cache.set(key, entry);
        }
        this.emit('memory:retrieved', {
            entryId: entry.id,
            key,
            requester: options.requester?.id
        });
        return options.includeMetadata ? entry : await this.deserializeValue(entry.value);
    }
    async update(key, value, options = {}) {
        this.ensureInitialized();
        const entry = await this.findEntry(key, options.partition);
        if (!entry) {
            return false;
        }
        if (options.updater) {
            await this.validateAccess(options.updater, 'write', options.partition);
        }
        if (options.incrementVersion !== false) {
            entry.previousVersions = entry.previousVersions || [];
            entry.previousVersions.push({
                ...entry
            });
            if (entry.previousVersions.length > 10) {
                entry.previousVersions = entry.previousVersions.slice(-10);
            }
        }
        entry.value = await this.serializeValue(value);
        entry.updatedAt = new Date();
        if (options.incrementVersion !== false) {
            entry.version++;
        }
        await this.index.updateEntry(entry);
        if (this.config.enableCaching) {
            this.cache.set(key, entry);
        }
        if (this.config.enableDistribution) {
            await this.replication.replicate(entry);
        }
        this.emit('memory:updated', {
            entryId: entry.id,
            key,
            version: entry.version,
            updater: options.updater?.id
        });
        return true;
    }
    async delete(key, options = {}) {
        this.ensureInitialized();
        const entry = await this.findEntry(key, options.partition);
        if (!entry) {
            return false;
        }
        if (options.deleter && !options.force) {
            await this.validateAccess(options.deleter, 'delete', options.partition);
        }
        return await this.deleteEntry(entry.id);
    }
    async query(query) {
        this.ensureInitialized();
        let results = Array.from(this.entries.values());
        if (query.partition) {
            const partition = this.partitions.get(query.partition);
            if (partition) {
                const entryIds = new Set(partition.entries.map((e)=>e.id));
                results = results.filter((e)=>entryIds.has(e.id));
            } else {
                return [];
            }
        }
        if (query.key) {
            results = results.filter((e)=>e.key === query.key);
        }
        if (query.type) {
            results = results.filter((e)=>e.type === query.type);
        }
        if (query.owner) {
            results = results.filter((e)=>e.owner.id === query.owner.id);
        }
        if (query.accessLevel) {
            results = results.filter((e)=>e.accessLevel === query.accessLevel);
        }
        if (query.tags && query.tags.length > 0) {
            results = results.filter((e)=>query.tags.some((tag)=>e.tags.includes(tag)));
        }
        if (query.createdAfter) {
            results = results.filter((e)=>e.createdAt >= query.createdAfter);
        }
        if (query.createdBefore) {
            results = results.filter((e)=>e.createdAt <= query.createdBefore);
        }
        if (query.expiresAfter) {
            results = results.filter((e)=>e.expiresAt && e.expiresAt >= query.expiresAfter);
        }
        results = results.filter((e)=>!this.isExpired(e));
        if (query.sortBy) {
            results.sort((a, b)=>{
                let compareValue = 0;
                switch(query.sortBy){
                    case 'createdAt':
                        compareValue = a.createdAt.getTime() - b.createdAt.getTime();
                        break;
                    case 'updatedAt':
                        compareValue = a.updatedAt.getTime() - b.updatedAt.getTime();
                        break;
                    case 'key':
                        compareValue = a.key.localeCompare(b.key);
                        break;
                    default:
                        compareValue = 0;
                }
                return query.sortOrder === 'desc' ? -compareValue : compareValue;
            });
        }
        const offset = query.offset || 0;
        const limit = query.limit || results.length;
        results = results.slice(offset, offset + limit);
        return results;
    }
    async search(options) {
        this.ensureInitialized();
        return await this.index.search(options);
    }
    async shareMemory(key, targetAgent, options = {}) {
        this.ensureInitialized();
        const entry = await this.findEntry(key, options.partition);
        if (!entry) {
            throw new Error(`Memory entry not found: ${key}`);
        }
        if (options.sharer) {
            await this.validateAccess(options.sharer, 'share', options.partition);
        }
        const sharedEntryId = generateId('shared-mem');
        const sharedEntry = {
            ...entry,
            id: sharedEntryId,
            owner: targetAgent,
            accessLevel: options.accessLevel || entry.accessLevel,
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: options.expiresAt,
            references: [
                ...entry.references,
                entry.id
            ]
        };
        this.entries.set(sharedEntryId, sharedEntry);
        await this.index.addEntry(sharedEntry);
        const targetPartition = await this.getOrCreatePartition(`agent_${targetAgent.id}`);
        targetPartition.entries.push(sharedEntry);
        this.emit('memory:shared', {
            originalId: entry.id,
            sharedId: sharedEntryId,
            key,
            sharer: options.sharer?.id,
            target: targetAgent.id
        });
        this.logger.info('Shared memory entry', {
            key,
            from: options.sharer?.id,
            to: targetAgent.id,
            sharedId: sharedEntryId
        });
        return sharedEntryId;
    }
    async broadcastMemory(key, targetAgents, options = {}) {
        this.ensureInitialized();
        const sharedIds = [];
        for (const targetAgent of targetAgents){
            try {
                const sharedId = await this.shareMemory(key, targetAgent, {
                    ...options,
                    sharer: options.broadcaster
                });
                sharedIds.push(sharedId);
            } catch (error) {
                this.logger.warn('Failed to share memory with agent', {
                    key,
                    targetAgent: targetAgent.id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
        this.emit('memory:broadcasted', {
            key,
            broadcaster: options.broadcaster?.id,
            targets: targetAgents.map((a)=>a.id),
            sharedCount: sharedIds.length
        });
        return sharedIds;
    }
    async synchronizeWith(targetNode, options = {}) {
        this.ensureInitialized();
        if (!this.config.enableDistribution) {
            throw new Error('Distribution not enabled');
        }
        await this.replication.synchronizeWith(targetNode, options);
        this.emit('memory:synchronized', {
            targetNode,
            direction: options.direction || 'bidirectional',
            partition: options.partition
        });
    }
    async createPartition(name, options = {}, skipInitCheck = false) {
        if (!skipInitCheck) {
            this.ensureInitialized();
        }
        if (this.partitions.has(name)) {
            throw new Error(`Partition already exists: ${name}`);
        }
        const partition = {
            id: generateId('partition'),
            name,
            type: options.type || 'knowledge',
            entries: [],
            maxSize: options.maxSize || this.config.maxMemorySize,
            ttl: options.ttl,
            readOnly: options.readOnly || false,
            shared: options.shared || true,
            indexed: options.indexed !== false,
            compressed: options.compressed || this.config.enableCompression
        };
        this.partitions.set(name, partition);
        this.memory.partitions.push(partition);
        this.emit('memory:partition-created', {
            partitionId: partition.id,
            name,
            type: partition.type
        });
        this.logger.info('Created memory partition', {
            name,
            type: partition.type,
            maxSize: partition.maxSize
        });
        return partition.id;
    }
    async deletePartition(name, force = false) {
        this.ensureInitialized();
        const partition = this.partitions.get(name);
        if (!partition) {
            return false;
        }
        if (partition.entries.length > 0 && !force) {
            throw new Error(`Partition ${name} contains entries. Use force=true to delete.`);
        }
        for (const entry of partition.entries){
            await this.deleteEntry(entry.id);
        }
        this.partitions.delete(name);
        this.memory.partitions = this.memory.partitions.filter((p)=>p.id !== partition.id);
        this.emit('memory:partition-deleted', {
            partitionId: partition.id,
            name
        });
        return true;
    }
    getPartition(name) {
        return this.partitions.get(name);
    }
    getPartitions() {
        return Array.from(this.partitions.values());
    }
    async createBackup() {
        this.ensureInitialized();
        const backup = {
            timestamp: new Date(),
            version: '1.0.0',
            checksum: '',
            metadata: {
                namespace: this.config.namespace,
                entryCount: this.entries.size,
                partitionCount: this.partitions.size
            },
            entries: Array.from(this.entries.values()),
            partitions: Array.from(this.partitions.values())
        };
        backup.checksum = this.calculateChecksum(backup);
        const backupId = generateId('backup');
        await this.persistence.saveBackup(backupId, backup);
        this.emit('memory:backup-created', {
            backupId,
            entryCount: backup.entries.length,
            size: JSON.stringify(backup).length
        });
        return backupId;
    }
    async restoreFromBackup(backupId) {
        this.ensureInitialized();
        const backup = await this.persistence.loadBackup(backupId);
        if (!backup) {
            throw new Error(`Backup not found: ${backupId}`);
        }
        const calculatedChecksum = this.calculateChecksum(backup);
        if (calculatedChecksum !== backup.checksum) {
            throw new Error('Backup checksum verification failed');
        }
        this.entries.clear();
        this.partitions.clear();
        await this.index.clear();
        for (const entry of backup.entries){
            this.entries.set(entry.id, entry);
            await this.index.addEntry(entry);
        }
        for (const partition of backup.partitions){
            this.partitions.set(partition.name, partition);
        }
        this.memory.partitions = backup.partitions;
        this.emit('memory:backup-restored', {
            backupId,
            entryCount: backup.entries.length,
            partitionCount: backup.partitions.length
        });
        this.logger.info('Restored from backup', {
            backupId,
            entries: backup.entries.length,
            partitions: backup.partitions.length
        });
    }
    getStatistics() {
        const entries = Array.from(this.entries.values());
        const validEntries = entries.filter((e)=>!this.isExpired(e));
        const entriesByType = {
            knowledge: 0,
            state: 0,
            cache: 0,
            logs: 0,
            results: 0,
            communication: 0,
            configuration: 0,
            metrics: 0
        };
        const entriesByAccess = {
            private: 0,
            team: 0,
            swarm: 0,
            public: 0,
            system: 0
        };
        let totalSize = 0;
        let oldestEntry = new Date();
        let newestEntry = new Date(0);
        let expiringEntries = 0;
        for (const entry of validEntries){
            entriesByType[entry.type]++;
            entriesByAccess[entry.accessLevel]++;
            const entrySize = this.calculateEntrySize(entry);
            totalSize += entrySize;
            if (entry.createdAt < oldestEntry) {
                oldestEntry = entry.createdAt;
            }
            if (entry.createdAt > newestEntry) {
                newestEntry = entry.createdAt;
            }
            if (entry.expiresAt && entry.expiresAt.getTime() - Date.now() < 24 * 60 * 60 * 1000) {
                expiringEntries++;
            }
        }
        return {
            totalEntries: validEntries.length,
            totalSize,
            partitionCount: this.partitions.size,
            entriesByType,
            entriesByAccess,
            averageSize: validEntries.length > 0 ? totalSize / validEntries.length : 0,
            oldestEntry,
            newestEntry,
            expiringEntries
        };
    }
    async exportMemory(options = {}) {
        this.ensureInitialized();
        let entries = Array.from(this.entries.values());
        if (!options.includeExpired) {
            entries = entries.filter((e)=>!this.isExpired(e));
        }
        if (options.filter) {
            const filteredResults = await this.query(options.filter);
            const filteredIds = new Set(filteredResults.map((e)=>e.id));
            entries = entries.filter((e)=>filteredIds.has(e.id));
        }
        if (options.format === 'csv') {
            return this.entriesToCSV(entries);
        } else {
            return JSON.stringify({
                exported: new Date().toISOString(),
                namespace: this.config.namespace,
                entryCount: entries.length,
                entries: entries.map((e)=>({
                        ...e,
                        value: e.value
                    }))
            }, null, 2);
        }
    }
    ensureInitialized() {
        if (!this.isInitialized) {
            throw new Error('Memory manager not initialized');
        }
    }
    async findEntry(key, partition) {
        for (const entry of this.entries.values()){
            if (entry.key === key) {
                if (partition) {
                    const part = this.partitions.get(partition);
                    if (part && part.entries.find((e)=>e.id === entry.id)) {
                        return entry;
                    }
                } else {
                    return entry;
                }
            }
        }
        return null;
    }
    async deleteEntry(entryId) {
        const entry = this.entries.get(entryId);
        if (!entry) {
            return false;
        }
        this.entries.delete(entryId);
        for (const partition of this.partitions.values()){
            partition.entries = partition.entries.filter((e)=>e.id !== entryId);
        }
        await this.index.removeEntry(entryId);
        if (this.config.enableCaching) {
            this.cache.delete(entry.key);
        }
        this.emit('memory:deleted', {
            entryId,
            key: entry.key
        });
        return true;
    }
    isExpired(entry) {
        return entry.expiresAt ? entry.expiresAt <= new Date() : false;
    }
    async validateAccess(agent, operation, partition) {
        return;
    }
    async getOrCreatePartition(name) {
        let partition = this.partitions.get(name);
        if (!partition) {
            await this.createPartition(name, {}, !this.isInitialized);
            partition = this.partitions.get(name);
        }
        return partition;
    }
    async serializeValue(value) {
        let serialized = JSON.stringify(value);
        if (this.config.enableCompression) {}
        if (this.config.enableEncryption) {
            serialized = await this.encryption.encrypt(serialized);
        }
        return serialized;
    }
    async deserializeValue(value) {
        let deserialized = value;
        if (this.config.enableEncryption) {
            deserialized = await this.encryption.decrypt(deserialized);
        }
        if (this.config.enableCompression) {}
        return JSON.parse(deserialized);
    }
    calculateEntrySize(entry) {
        return JSON.stringify(entry).length;
    }
    async enforceMemoryLimits(newEntrySize) {
        const stats = this.getStatistics();
        const projectedSize = stats.totalSize + newEntrySize;
        if (projectedSize > this.config.maxMemorySize) {
            await this.cleanupExpiredEntries();
            const updatedStats = this.getStatistics();
            if (updatedStats.totalSize + newEntrySize > this.config.maxMemorySize) {
                await this.evictOldEntries(newEntrySize);
            }
        }
    }
    async cleanupExpiredEntries() {
        const expiredEntries = Array.from(this.entries.values()).filter((e)=>this.isExpired(e));
        for (const entry of expiredEntries){
            await this.deleteEntry(entry.id);
        }
        if (expiredEntries.length > 0) {
            this.logger.info('Cleaned up expired entries', {
                count: expiredEntries.length
            });
        }
    }
    async evictOldEntries(requiredSpace) {
        const entries = Array.from(this.entries.values()).filter((e)=>!this.isExpired(e)).sort((a, b)=>a.createdAt.getTime() - b.createdAt.getTime());
        let freedSpace = 0;
        let evictedCount = 0;
        for (const entry of entries){
            if (freedSpace >= requiredSpace) {
                break;
            }
            if (entry.accessLevel !== 'system') {
                const entrySize = this.calculateEntrySize(entry);
                await this.deleteEntry(entry.id);
                freedSpace += entrySize;
                evictedCount++;
            }
        }
        this.logger.warn('Evicted old entries for space', {
            evictedCount,
            freedSpace,
            requiredSpace
        });
    }
    calculateChecksum(backup) {
        const content = JSON.stringify({
            entries: backup.entries,
            partitions: backup.partitions
        });
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    entriesToCSV(entries) {
        const headers = [
            'id',
            'key',
            'type',
            'accessLevel',
            'createdAt',
            'updatedAt',
            'owner',
            'tags'
        ];
        const rows = entries.map((entry)=>[
                entry.id,
                entry.key,
                entry.type,
                entry.accessLevel,
                entry.createdAt.toISOString(),
                entry.updatedAt.toISOString(),
                entry.owner.id,
                entry.tags.join(';')
            ]);
        return [
            headers,
            ...rows
        ].map((row)=>row.join(',')).join('\n');
    }
    async loadMemoryState() {
        try {
            const state = await this.persistence.loadState();
            if (state) {
                for (const entry of state.entries || []){
                    this.entries.set(entry.id, entry);
                    await this.index.addEntry(entry);
                }
                for (const partition of state.partitions || []){
                    this.partitions.set(partition.name, partition);
                }
                this.memory.partitions = state.partitions || [];
                this.logger.info('Loaded memory state', {
                    entries: this.entries.size,
                    partitions: this.partitions.size
                });
            }
        } catch (error) {
            this.logger.warn('Failed to load memory state', {
                error
            });
        }
    }
    async saveMemoryState() {
        try {
            const state = {
                namespace: this.config.namespace,
                timestamp: new Date(),
                entries: Array.from(this.entries.values()),
                partitions: Array.from(this.partitions.values())
            };
            await this.persistence.saveState(state);
        } catch (error) {
            this.logger.error('Failed to save memory state', {
                error
            });
        }
    }
    async createDefaultPartitions() {
        const defaultPartitions = [
            {
                name: 'default',
                type: 'knowledge'
            },
            {
                name: 'system',
                type: 'configuration'
            },
            {
                name: 'cache',
                type: 'cache'
            },
            {
                name: 'logs',
                type: 'logs'
            }
        ];
        for (const partition of defaultPartitions){
            if (!this.partitions.has(partition.name)) {
                await this.createPartition(partition.name, {
                    type: partition.type
                }, true);
            }
        }
    }
    mergeWithDefaults(config) {
        return {
            namespace: 'default',
            persistencePath: './swarm-memory',
            maxMemorySize: 100 * 1024 * 1024,
            maxEntrySize: 10 * 1024 * 1024,
            defaultTtl: 24 * 60 * 60 * 1000,
            enableCompression: false,
            enableEncryption: false,
            consistencyLevel: 'eventual',
            syncInterval: 60000,
            backupInterval: 3600000,
            maxBackups: 24,
            enableDistribution: false,
            distributionNodes: [],
            replicationFactor: 1,
            enableCaching: true,
            cacheSize: 1000,
            cacheTtl: 300000,
            ...config
        };
    }
    startBackgroundProcesses() {
        if (this.config.syncInterval > 0) {
            this.syncTimer = setInterval(()=>{
                this.performSync();
            }, this.config.syncInterval);
        }
        if (this.config.backupInterval > 0) {
            this.backupTimer = setInterval(()=>{
                this.createBackup().catch((error)=>{
                    this.logger.error('Background backup failed', {
                        error
                    });
                });
            }, this.config.backupInterval);
        }
        this.cleanupTimer = setInterval(()=>{
            this.cleanupExpiredEntries();
        }, 60000);
    }
    stopBackgroundProcesses() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = undefined;
        }
        if (this.backupTimer) {
            clearInterval(this.backupTimer);
            this.backupTimer = undefined;
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }
    }
    async performSync() {
        try {
            await this.saveMemoryState();
            if (this.config.enableDistribution) {
                await this.replication.sync();
            }
        } catch (error) {
            this.logger.error('Background sync failed', {
                error
            });
        }
    }
    setupEventHandlers() {
        this.replication.on('entry-received', async (data)=>{
            const entry = data.entry;
            this.entries.set(entry.id, entry);
            await this.index.addEntry(entry);
            this.emit('memory:replicated', {
                entryId: entry.id,
                key: entry.key,
                source: data.source
            });
        });
    }
}
let MemoryIndex = class MemoryIndex {
    index = new Map();
    async initialize() {}
    async addEntry(entry) {
        this.indexTerms(entry.id, [
            entry.key,
            ...entry.tags,
            entry.type
        ]);
    }
    async updateEntry(entry) {
        await this.removeEntry(entry.id);
        await this.addEntry(entry);
    }
    async removeEntry(entryId) {
        for (const termSet of this.index.values()){
            termSet.delete(entryId);
        }
    }
    async search(options) {
        return [];
    }
    async clear() {
        this.index.clear();
    }
    indexTerms(entryId, terms) {
        for (const term of terms){
            const normalizedTerm = term.toLowerCase();
            if (!this.index.has(normalizedTerm)) {
                this.index.set(normalizedTerm, new Set());
            }
            this.index.get(normalizedTerm).add(entryId);
        }
    }
};
let MemoryCache = class MemoryCache {
    cache = new Map();
    maxSize;
    ttl;
    constructor(maxSize, ttl){
        this.maxSize = maxSize;
        this.ttl = ttl;
    }
    set(key, entry) {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            entry,
            expiry: Date.now() + this.ttl
        });
    }
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }
        if (Date.now() > cached.expiry) {
            this.cache.delete(key);
            return null;
        }
        return cached.entry;
    }
    delete(key) {
        this.cache.delete(key);
    }
};
let MemoryReplication = class MemoryReplication extends EventEmitter {
    config;
    constructor(config){
        super();
        this.config = config;
    }
    async initialize() {}
    async shutdown() {}
    async replicate(entry) {}
    async synchronizeWith(targetNode, options) {}
    async sync() {}
};
let MemoryPersistence = class MemoryPersistence {
    config;
    constructor(config){
        this.config = config;
    }
    async initialize() {
        await fs.mkdir(this.config.persistencePath, {
            recursive: true
        });
    }
    async shutdown() {}
    async saveState(state) {
        const statePath = path.join(this.config.persistencePath, 'state.json');
        await fs.writeFile(statePath, JSON.stringify(state, null, 2));
    }
    async loadState() {
        try {
            const statePath = path.join(this.config.persistencePath, 'state.json');
            const content = await fs.readFile(statePath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }
    async saveBackup(backupId, backup) {
        const backupPath = path.join(this.config.persistencePath, 'backups', `${backupId}.json`);
        await fs.mkdir(path.dirname(backupPath), {
            recursive: true
        });
        await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));
    }
    async loadBackup(backupId) {
        try {
            const backupPath = path.join(this.config.persistencePath, 'backups', `${backupId}.json`);
            const content = await fs.readFile(backupPath, 'utf-8');
            return JSON.parse(content);
        } catch (error) {
            return null;
        }
    }
};
let MemoryEncryption = class MemoryEncryption {
    config;
    constructor(config){
        this.config = config;
    }
    async initialize() {}
    async shutdown() {}
    async encrypt(data) {
        return data;
    }
    async decrypt(data) {
        return data;
    }
};
export default SwarmMemoryManager;

//# sourceMappingURL=memory.js.map