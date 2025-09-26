import { agenticHookManager } from './hook-manager.js';
export const preMemoryStoreHook = {
    id: 'agentic-pre-memory-store',
    type: 'pre-memory-store',
    priority: 100,
    handler: async (payload, context)=>{
        const { namespace, key, value, ttl, provider } = payload;
        const sideEffects = [];
        const validation = await validateMemoryStore(namespace, key, value, context);
        if (!validation.valid) {
            return {
                continue: false,
                sideEffects: [
                    {
                        type: 'log',
                        action: 'write',
                        data: {
                            level: 'error',
                            message: 'Memory store validation failed',
                            data: validation
                        }
                    }
                ]
            };
        }
        let processedValue = value;
        if (shouldCompress(value)) {
            processedValue = await compressValue(value);
            sideEffects.push({
                type: 'metric',
                action: 'increment',
                data: {
                    name: 'memory.compressions'
                }
            });
        }
        const enrichedValue = {
            data: processedValue,
            metadata: {
                stored: Date.now(),
                provider,
                sessionId: context.sessionId,
                compressed: processedValue !== value,
                size: getValueSize(processedValue)
            }
        };
        sideEffects.push({
            type: 'metric',
            action: 'update',
            data: {
                name: `memory.usage.${namespace}`,
                value: getValueSize(enrichedValue)
            }
        });
        return {
            continue: true,
            modified: true,
            payload: {
                ...payload,
                value: enrichedValue
            },
            sideEffects
        };
    }
};
export const postMemoryStoreHook = {
    id: 'agentic-post-memory-store',
    type: 'post-memory-store',
    priority: 100,
    handler: async (payload, context)=>{
        const { namespace, key, value, crossProvider, syncTargets } = payload;
        const sideEffects = [];
        if (crossProvider && syncTargets && syncTargets.length > 0) {
            for (const target of syncTargets){
                sideEffects.push({
                    type: 'memory',
                    action: 'sync',
                    data: {
                        source: payload.provider,
                        target,
                        namespace,
                        key,
                        value
                    }
                });
            }
        }
        await updateMemoryIndex(namespace, key, value, context);
        const patterns = await detectMemoryPatterns(namespace, key, value, context);
        if (patterns.length > 0) {
            sideEffects.push({
                type: 'neural',
                action: 'analyze',
                data: {
                    patterns,
                    context: {
                        namespace,
                        key
                    }
                }
            });
        }
        sideEffects.push({
            type: 'notification',
            action: 'emit',
            data: {
                event: 'memory:stored',
                data: {
                    namespace,
                    key,
                    size: getValueSize(value)
                }
            }
        });
        return {
            continue: true,
            sideEffects
        };
    }
};
export const preMemoryRetrieveHook = {
    id: 'agentic-pre-memory-retrieve',
    type: 'pre-memory-retrieve',
    priority: 100,
    handler: async (payload, context)=>{
        const { namespace, key } = payload;
        const cached = await checkLocalCache(namespace, key, context);
        if (cached) {
            return {
                continue: false,
                modified: true,
                payload: {
                    ...payload,
                    value: cached
                },
                sideEffects: [
                    {
                        type: 'metric',
                        action: 'increment',
                        data: {
                            name: 'memory.cache.hits'
                        }
                    }
                ]
            };
        }
        const relatedKeys = await findRelatedKeys(namespace, key, context);
        if (relatedKeys.length > 0) {
            prefetchKeys(namespace, relatedKeys, context);
        }
        return {
            continue: true,
            sideEffects: [
                {
                    type: 'metric',
                    action: 'increment',
                    data: {
                        name: `memory.retrievals.${namespace}`
                    }
                }
            ]
        };
    }
};
export const postMemoryRetrieveHook = {
    id: 'agentic-post-memory-retrieve',
    type: 'post-memory-retrieve',
    priority: 100,
    handler: async (payload, context)=>{
        const { namespace, key, value } = payload;
        if (!value) {
            return {
                continue: true
            };
        }
        const sideEffects = [];
        let processedValue = value;
        if (value.metadata?.compressed) {
            processedValue = await decompressValue(value.data);
            sideEffects.push({
                type: 'metric',
                action: 'increment',
                data: {
                    name: 'memory.decompressions'
                }
            });
        }
        await updateAccessPattern(namespace, key, context);
        await cacheLocally(namespace, key, processedValue, context);
        const latency = Date.now() - context.timestamp;
        sideEffects.push({
            type: 'metric',
            action: 'update',
            data: {
                name: `memory.latency.${namespace}`,
                value: latency
            }
        });
        return {
            continue: true,
            modified: true,
            payload: {
                ...payload,
                value: processedValue.data || processedValue
            },
            sideEffects
        };
    }
};
export const memorySyncHook = {
    id: 'agentic-memory-sync',
    type: 'memory-sync',
    priority: 100,
    handler: async (payload, context)=>{
        const { operation, namespace, provider, syncTargets } = payload;
        const sideEffects = [];
        switch(operation){
            case 'sync':
                const changes = await detectMemoryChanges(namespace, provider, context);
                if (changes.length > 0) {
                    sideEffects.push({
                        type: 'log',
                        action: 'write',
                        data: {
                            level: 'info',
                            message: `Syncing ${changes.length} memory changes`,
                            data: {
                                namespace,
                                provider,
                                targets: syncTargets
                            }
                        }
                    });
                    for (const change of changes){
                        await applyMemoryChange(change, syncTargets || [], context);
                    }
                    sideEffects.push({
                        type: 'metric',
                        action: 'update',
                        data: {
                            name: 'memory.sync.changes',
                            value: changes.length
                        }
                    });
                }
                break;
            case 'persist':
                const snapshot = await createMemorySnapshot(namespace, context);
                sideEffects.push({
                    type: 'memory',
                    action: 'store',
                    data: {
                        key: `snapshot:${namespace}:${Date.now()}`,
                        value: snapshot,
                        ttl: 0
                    }
                });
                sideEffects.push({
                    type: 'notification',
                    action: 'emit',
                    data: {
                        event: 'memory:persisted',
                        data: {
                            namespace,
                            size: snapshot.size
                        }
                    }
                });
                break;
            case 'expire':
                const expired = await findExpiredEntries(namespace, context);
                if (expired.length > 0) {
                    for (const key of expired){
                        await removeMemoryEntry(namespace, key, context);
                    }
                    sideEffects.push({
                        type: 'metric',
                        action: 'update',
                        data: {
                            name: 'memory.expired',
                            value: expired.length
                        }
                    });
                }
                break;
        }
        return {
            continue: true,
            sideEffects
        };
    }
};
export const memoryPersistHook = {
    id: 'agentic-memory-persist',
    type: 'memory-persist',
    priority: 90,
    handler: async (payload, context)=>{
        const { namespace } = payload;
        const backup = await createFullBackup(namespace, context);
        const backupData = {
            timestamp: Date.now(),
            sessionId: context.sessionId,
            namespace,
            entries: backup.entries,
            size: backup.size,
            checksum: calculateChecksum(backup)
        };
        return {
            continue: true,
            sideEffects: [
                {
                    type: 'memory',
                    action: 'store',
                    data: {
                        key: `backup:${namespace}:${context.sessionId}`,
                        value: backupData,
                        ttl: 604800
                    }
                },
                {
                    type: 'notification',
                    action: 'emit',
                    data: {
                        event: 'memory:backup:created',
                        data: {
                            namespace,
                            size: backup.size,
                            entries: backup.entries.length
                        }
                    }
                }
            ]
        };
    }
};
async function validateMemoryStore(namespace, key, value, context) {
    const size = getValueSize(value);
    const maxSize = 10 * 1024 * 1024;
    if (size > maxSize) {
        return {
            valid: false,
            reason: `Value size ${size} exceeds limit ${maxSize}`
        };
    }
    const quota = await getNamespaceQuota(namespace, context);
    const usage = await getNamespaceUsage(namespace, context);
    if (usage + size > quota) {
        return {
            valid: false,
            reason: `Namespace quota exceeded: ${usage + size} > ${quota}`
        };
    }
    if (key && !isValidKey(key)) {
        return {
            valid: false,
            reason: `Invalid key format: ${key}`
        };
    }
    return {
        valid: true
    };
}
function shouldCompress(value) {
    const size = getValueSize(value);
    return size > 1024;
}
async function compressValue(value) {
    return {
        compressed: true,
        data: JSON.stringify(value)
    };
}
async function decompressValue(value) {
    if (value.compressed) {
        return JSON.parse(value.data);
    }
    return value;
}
function getValueSize(value) {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
async function updateMemoryIndex(namespace, key, value, context) {}
async function detectMemoryPatterns(namespace, key, value, context) {
    const patterns = [];
    const accessHistory = await getAccessHistory(namespace, context);
    if (isSequentialPattern(accessHistory)) {
        patterns.push({
            type: 'sequential',
            confidence: 0.8,
            suggestion: 'prefetch-next'
        });
    }
    if (isTemporalPattern(accessHistory)) {
        patterns.push({
            type: 'temporal',
            confidence: 0.7,
            suggestion: 'cache-duration'
        });
    }
    return patterns;
}
async function checkLocalCache(namespace, key, context) {
    const cacheKey = `${namespace}:${key}`;
    return context.memory.cache.get(cacheKey);
}
async function findRelatedKeys(namespace, key, context) {
    return [];
}
async function prefetchKeys(namespace, keys, context) {}
async function updateAccessPattern(namespace, key, context) {
    const patternKey = `pattern:${namespace}:${key}`;
    const pattern = await context.memory.cache.get(patternKey) || {
        accesses: [],
        lastAccess: 0
    };
    pattern.accesses.push(Date.now());
    pattern.lastAccess = Date.now();
    if (pattern.accesses.length > 100) {
        pattern.accesses = pattern.accesses.slice(-100);
    }
    await context.memory.cache.set(patternKey, pattern);
}
async function cacheLocally(namespace, key, value, context) {
    const cacheKey = `${namespace}:${key}`;
    context.memory.cache.set(cacheKey, value);
}
async function detectMemoryChanges(namespace, provider, context) {
    return [];
}
async function applyMemoryChange(change, targets, context) {}
async function createMemorySnapshot(namespace, context) {
    return {
        namespace,
        timestamp: Date.now(),
        entries: [],
        size: 0
    };
}
async function findExpiredEntries(namespace, context) {
    return [];
}
async function removeMemoryEntry(namespace, key, context) {}
async function createFullBackup(namespace, context) {
    return {
        entries: [],
        size: 0
    };
}
function calculateChecksum(data) {
    return 'checksum';
}
async function getNamespaceQuota(namespace, context) {
    return 100 * 1024 * 1024;
}
async function getNamespaceUsage(namespace, context) {
    return 0;
}
function isValidKey(key) {
    return /^[a-zA-Z0-9:_\-./]+$/.test(key);
}
async function getAccessHistory(namespace, context) {
    return [];
}
function isSequentialPattern(history) {
    return false;
}
function isTemporalPattern(history) {
    return false;
}
export function registerMemoryHooks() {
    agenticHookManager.register(preMemoryStoreHook);
    agenticHookManager.register(postMemoryStoreHook);
    agenticHookManager.register(preMemoryRetrieveHook);
    agenticHookManager.register(postMemoryRetrieveHook);
    agenticHookManager.register(memorySyncHook);
    agenticHookManager.register(memoryPersistHook);
}

//# sourceMappingURL=memory-hooks.js.map