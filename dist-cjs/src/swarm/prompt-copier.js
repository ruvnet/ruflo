import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { EventEmitter } from 'events';
import { logger } from '../core/logger.js';
export class PromptCopier extends EventEmitter {
    options;
    fileQueue = [];
    copiedFiles = new Set();
    errors = [];
    backupMap = new Map();
    rollbackStack = [];
    constructor(options){
        super();
        this.options = {
            ...options,
            backup: options.backup ?? true,
            overwrite: options.overwrite ?? false,
            verify: options.verify ?? true,
            preservePermissions: options.preservePermissions ?? true,
            excludePatterns: options.excludePatterns ?? [],
            includePatterns: options.includePatterns ?? [
                '*.md',
                '*.txt',
                '*.prompt',
                '*.prompts'
            ],
            parallel: options.parallel ?? true,
            maxWorkers: options.maxWorkers ?? 4,
            dryRun: options.dryRun ?? false,
            conflictResolution: options.conflictResolution ?? 'backup',
            progressCallback: options.progressCallback ?? (()=>{})
        };
    }
    async copy() {
        const startTime = Date.now();
        try {
            logger.info('Starting prompt discovery phase...');
            await this.discoverFiles();
            if (this.fileQueue.length === 0) {
                return {
                    success: true,
                    totalFiles: 0,
                    copiedFiles: 0,
                    failedFiles: 0,
                    skippedFiles: 0,
                    duration: Date.now() - startTime,
                    errors: []
                };
            }
            if (!this.options.dryRun) {
                await this.ensureDestinationDirectories();
            }
            logger.info(`Copying ${this.fileQueue.length} files...`);
            if (this.options.parallel) {
                await this.copyFilesParallel();
            } else {
                await this.copyFilesSequential();
            }
            if (this.options.verify && !this.options.dryRun) {
                await this.verifyFiles();
            }
            const duration = Date.now() - startTime;
            const result = {
                success: this.errors.length === 0,
                totalFiles: this.fileQueue.length,
                copiedFiles: this.copiedFiles.size,
                failedFiles: this.errors.length,
                skippedFiles: this.fileQueue.length - this.copiedFiles.size - this.errors.length,
                errors: this.errors,
                duration
            };
            if (this.backupMap.size > 0) {
                result.backupLocation = await this.createBackupManifest();
            }
            logger.info(`Copy completed in ${duration}ms`, result);
            return result;
        } catch (error) {
            logger.error('Copy operation failed', error);
            if (!this.options.dryRun) {
                await this.rollback();
            }
            throw error;
        }
    }
    async discoverFiles() {
        const sourceStats = await fs.stat(this.options.source);
        if (!sourceStats.isDirectory()) {
            throw new Error(`Source path ${this.options.source} is not a directory`);
        }
        await this.scanDirectory(this.options.source, '');
        this.fileQueue.sort((a, b)=>b.size - a.size);
    }
    async scanDirectory(dirPath, relativePath) {
        const entries = await fs.readdir(dirPath, {
            withFileTypes: true
        });
        for (const entry of entries){
            const fullPath = path.join(dirPath, entry.name);
            const relPath = path.join(relativePath, entry.name);
            if (entry.isDirectory()) {
                await this.scanDirectory(fullPath, relPath);
            } else if (entry.isFile() && this.shouldIncludeFile(relPath)) {
                const stats = await fs.stat(fullPath);
                this.fileQueue.push({
                    path: fullPath,
                    relativePath: relPath,
                    size: stats.size,
                    permissions: stats.mode
                });
            }
        }
    }
    shouldIncludeFile(filePath) {
        for (const pattern of this.options.excludePatterns){
            if (this.matchPattern(filePath, pattern)) {
                return false;
            }
        }
        if (this.options.includePatterns.length === 0) {
            return true;
        }
        for (const pattern of this.options.includePatterns){
            if (this.matchPattern(filePath, pattern)) {
                return true;
            }
        }
        return false;
    }
    matchPattern(filePath, pattern) {
        const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');
        return new RegExp(regex).test(filePath);
    }
    async ensureDestinationDirectories() {
        const directories = new Set();
        for (const file of this.fileQueue){
            const destDir = path.dirname(path.join(this.options.destination, file.relativePath));
            directories.add(destDir);
        }
        const sortedDirs = Array.from(directories).sort((a, b)=>a.length - b.length);
        for (const dir of sortedDirs){
            await fs.mkdir(dir, {
                recursive: true
            });
        }
    }
    async copyFilesSequential() {
        let completed = 0;
        for (const file of this.fileQueue){
            try {
                await this.copyFile(file);
                completed++;
                this.reportProgress(completed);
            } catch (error) {
                this.errors.push({
                    file: file.path,
                    error: error instanceof Error ? error.message : String(error),
                    phase: 'write'
                });
            }
        }
    }
    async copyFilesParallel() {
        const workerCount = Math.min(this.options.maxWorkers, this.fileQueue.length);
        const chunkSize = Math.ceil(this.fileQueue.length / workerCount);
        const workers = [];
        for(let i = 0; i < workerCount; i++){
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, this.fileQueue.length);
            const chunk = this.fileQueue.slice(start, end);
            if (chunk.length > 0) {
                workers.push(this.processChunk(chunk, i));
            }
        }
        await Promise.all(workers);
    }
    async processChunk(files, workerId) {
        for (const file of files){
            try {
                await this.copyFile(file);
                this.copiedFiles.add(file.path);
                this.reportProgress(this.copiedFiles.size);
            } catch (error) {
                this.errors.push({
                    file: file.path,
                    error: error instanceof Error ? error.message : String(error),
                    phase: 'write'
                });
            }
        }
    }
    async copyFile(file) {
        const destPath = path.join(this.options.destination, file.relativePath);
        if (this.options.dryRun) {
            logger.info(`[DRY RUN] Would copy ${file.path} to ${destPath}`);
            return;
        }
        const destExists = await this.fileExists(destPath);
        if (destExists) {
            switch(this.options.conflictResolution){
                case 'skip':
                    logger.info(`Skipping existing file: ${destPath}`);
                    return;
                case 'backup':
                    await this.backupFile(destPath);
                    break;
                case 'merge':
                    await this.mergeFiles(file.path, destPath);
                    return;
                case 'overwrite':
                    break;
            }
        }
        if (this.options.verify) {
            file.hash = await this.calculateFileHash(file.path);
        }
        await fs.copyFile(file.path, destPath);
        if (this.options.preservePermissions && file.permissions) {
            await fs.chmod(destPath, file.permissions);
        }
        this.rollbackStack.push(async ()=>{
            if (destExists && this.backupMap.has(destPath)) {
                const backupPath = this.backupMap.get(destPath);
                await fs.copyFile(backupPath, destPath);
            } else {
                await fs.unlink(destPath);
            }
        });
        this.copiedFiles.add(file.path);
    }
    async backupFile(filePath) {
        const backupDir = path.join(this.options.destination, '.prompt-backups');
        await fs.mkdir(backupDir, {
            recursive: true
        });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `${path.basename(filePath)}.${timestamp}.bak`;
        const backupPath = path.join(backupDir, backupName);
        await fs.copyFile(filePath, backupPath);
        this.backupMap.set(filePath, backupPath);
    }
    async mergeFiles(sourcePath, destPath) {
        const sourceContent = await fs.readFile(sourcePath, 'utf-8');
        const destContent = await fs.readFile(destPath, 'utf-8');
        const separator = '\n\n--- MERGED CONTENT ---\n\n';
        const mergedContent = destContent + separator + sourceContent;
        await this.backupFile(destPath);
        await fs.writeFile(destPath, mergedContent, 'utf-8');
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
                if (file.hash) {
                    const destHash = await this.calculateFileHash(destPath);
                    if (destHash !== file.hash) {
                        throw new Error(`Hash mismatch: ${destHash} != ${file.hash}`);
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
    async calculateFileHash(filePath) {
        const content = await fs.readFile(filePath);
        return createHash('sha256').update(content).digest('hex');
    }
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch  {
            return false;
        }
    }
    async createBackupManifest() {
        const manifestPath = path.join(this.options.destination, '.prompt-backups', `manifest-${Date.now()}.json`);
        const manifest = {
            timestamp: new Date().toISOString(),
            source: this.options.source,
            destination: this.options.destination,
            backups: Array.from(this.backupMap.entries()).map(([original, backup])=>({
                    original,
                    backup
                }))
        };
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        return manifestPath;
    }
    async rollback() {
        logger.warn('Rolling back changes...');
        for(let i = this.rollbackStack.length - 1; i >= 0; i--){
            try {
                await this.rollbackStack[i]();
            } catch (error) {
                logger.error(`Rollback operation ${i} failed:`, error);
            }
        }
        try {
            const backupDir = path.join(this.options.destination, '.prompt-backups');
            const entries = await fs.readdir(backupDir);
            if (entries.length === 0) {
                await fs.rmdir(backupDir);
            }
        } catch  {}
    }
    reportProgress(completed) {
        const progress = {
            total: this.fileQueue.length,
            completed,
            failed: this.errors.length,
            skipped: this.fileQueue.length - completed - this.errors.length,
            percentage: Math.round(completed / this.fileQueue.length * 100)
        };
        this.emit('progress', progress);
        this.options.progressCallback(progress);
    }
    async restoreFromBackup(manifestPath) {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        for (const { original, backup } of manifest.backups){
            try {
                await fs.copyFile(backup, original);
                logger.info(`Restored ${original} from ${backup}`);
            } catch (error) {
                logger.error(`Failed to restore ${original}:`, error);
            }
        }
    }
}
export async function copyPrompts(options) {
    const copier = new PromptCopier(options);
    return copier.copy();
}

//# sourceMappingURL=prompt-copier.js.map