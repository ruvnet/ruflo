import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
import * as fs from 'fs/promises';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { PromptCopier } from './prompt-copier.js';
import { logger } from '../core/logger.js';
export class EnhancedPromptCopier extends PromptCopier {
    workerPool;
    workerResults = new Map();
    constructor(options){
        super(options);
    }
    async copyFilesParallel() {
        const workerCount = Math.min(this.options.maxWorkers, this.fileQueue.length);
        this.workerPool = await this.initializeWorkerPool(workerCount);
        try {
            await this.processWithWorkerPool();
        } finally{
            await this.terminateWorkers();
        }
    }
    async initializeWorkerPool(workerCount) {
        const workers = [];
        const pool = {
            workers,
            busy: new Set(),
            queue: []
        };
        for(let i = 0; i < workerCount; i++){
            const worker = new Worker(path.join(__dirname, 'workers', 'copy-worker.js'), {
                workerData: {
                    workerId: i
                }
            });
            worker.on('message', (result)=>{
                this.handleWorkerResult(result, i, pool);
            });
            worker.on('error', (error)=>{
                logger.error(`Worker ${i} error:`, error);
                this.errors.push({
                    file: 'worker',
                    error: error instanceof Error ? error.message : String(error),
                    phase: 'write'
                });
            });
            workers.push(worker);
        }
        return pool;
    }
    async processWithWorkerPool() {
        const chunkSize = Math.max(1, Math.floor(this.fileQueue.length / this.workerPool.workers.length / 2));
        const chunks = [];
        for(let i = 0; i < this.fileQueue.length; i += chunkSize){
            chunks.push(this.fileQueue.slice(i, i + chunkSize));
        }
        const promises = [];
        for (const chunk of chunks){
            promises.push(this.processChunkWithWorker(chunk));
        }
        await Promise.all(promises);
    }
    async processChunkWithWorker(chunk) {
        return new Promise((resolve, reject)=>{
            const pool = this.workerPool;
            const tryAssignWork = ()=>{
                const availableWorkerIndex = pool.workers.findIndex((_, index)=>!pool.busy.has(index));
                if (availableWorkerIndex === -1) {
                    pool.queue.push(tryAssignWork);
                    return;
                }
                pool.busy.add(availableWorkerIndex);
                const workerData = {
                    files: chunk.map((file)=>({
                            sourcePath: file.path,
                            destPath: path.join(this.options.destination, file.relativePath),
                            permissions: this.options.preservePermissions ? file.permissions : undefined,
                            verify: this.options.verify
                        })),
                    workerId: availableWorkerIndex
                };
                let remainingFiles = chunk.length;
                const chunkResults = [];
                const messageHandler = (result)=>{
                    chunkResults.push(result);
                    remainingFiles--;
                    if (remainingFiles === 0) {
                        pool.workers[availableWorkerIndex].off('message', messageHandler);
                        pool.busy.delete(availableWorkerIndex);
                        if (pool.queue.length > 0) {
                            const nextWork = pool.queue.shift();
                            nextWork();
                        }
                        this.processChunkResults(chunk, chunkResults);
                        resolve();
                    }
                };
                pool.workers[availableWorkerIndex].on('message', messageHandler);
                pool.workers[availableWorkerIndex].postMessage(workerData);
            };
            tryAssignWork();
        });
    }
    processChunkResults(chunk, results) {
        for (const result of results){
            if (result.success) {
                this.copiedFiles.add(result.file);
                if (result.hash) {
                    this.workerResults.set(result.file, {
                        hash: result.hash
                    });
                }
            } else {
                this.errors.push({
                    file: result.file,
                    error: result.error,
                    phase: 'write'
                });
            }
        }
        if (this.options.progressCallback) {
            this.options.progressCallback(this.copiedFiles.size, this.totalFiles);
        }
    }
    handleWorkerResult(result, workerId, pool) {
        logger.debug(`Worker ${workerId} result:`, result);
    }
    async terminateWorkers() {
        if (!this.workerPool) return;
        const terminationPromises = this.workerPool.workers.map((worker)=>worker.terminate());
        await Promise.all(terminationPromises);
        this.workerPool = undefined;
    }
    async verifyFiles() {
        logger.info('Verifying copied files...');
        for (const file of this.fileQueue){
            if (!this.copiedFiles.has(file.path)) continue;
            try {
                const destPath = path.join(this.options.destination, file.relativePath);
                if (!await this.fileExists(destPath)) {
                    throw new Error('Destination file not found');
                }
                const destStats = await fs.stat(destPath);
                const sourceStats = await fs.stat(file.path);
                if (destStats.size !== sourceStats.size) {
                    throw new Error(`Size mismatch: ${destStats.size} != ${sourceStats.size}`);
                }
                const workerResult = this.workerResults.get(file.path);
                if (workerResult?.hash) {
                    const sourceHash = await this.calculateFileHash(file.path);
                    if (sourceHash !== workerResult.hash) {
                        throw new Error(`Hash mismatch: ${sourceHash} != ${workerResult.hash}`);
                    }
                }
            } catch (error) {
                this.errors.push({
                    file: file.path,
                    error: error instanceof Error ? error.message : String(error),
                    phase: 'verify'
                });
            }
        }
    }
}
export async function copyPromptsEnhanced(options) {
    const copier = new EnhancedPromptCopier(options);
    return copier.copy();
}

//# sourceMappingURL=prompt-copier-enhanced.js.map