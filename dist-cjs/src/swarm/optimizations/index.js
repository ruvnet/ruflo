export { ClaudeConnectionPool } from './connection-pool.js';
export { AsyncFileManager } from './async-file-manager.js';
export { CircularBuffer } from './circular-buffer.js';
export { TTLMap } from './ttl-map.js';
export { OptimizedExecutor } from './optimized-executor.js';
export const createOptimizedSwarmStack = (config)=>{
    const connectionPool = new ClaudeConnectionPool(config?.connectionPool);
    const fileManager = new AsyncFileManager(config?.fileManager);
    const executor = new OptimizedExecutor({
        ...config?.executor,
        connectionPool: config?.connectionPool,
        fileOperations: config?.fileManager
    });
    return {
        connectionPool,
        fileManager,
        executor,
        shutdown: async ()=>{
            await executor.shutdown();
            await fileManager.waitForPendingOperations();
            await connectionPool.drain();
        }
    };
};

//# sourceMappingURL=index.js.map