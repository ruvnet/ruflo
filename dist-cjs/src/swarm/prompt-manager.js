import * as path from 'path';
import { EventEmitter } from 'events';
import { copyPromptsEnhanced } from './prompt-copier-enhanced.js';
import { PromptConfigManager, PromptPathResolver, PromptValidator } from './prompt-utils.js';
import { logger } from '../core/logger.js';
export class PromptManager extends EventEmitter {
    configManager;
    pathResolver;
    options;
    constructor(options = {}){
        super();
        this.options = {
            configPath: options.configPath || '.prompt-config.json',
            basePath: options.basePath || process.cwd(),
            autoDiscovery: options.autoDiscovery ?? true,
            defaultProfile: options.defaultProfile || 'sparc'
        };
        this.configManager = new PromptConfigManager(path.resolve(this.options.basePath, this.options.configPath));
        this.pathResolver = new PromptPathResolver(this.options.basePath);
    }
    async initialize() {
        logger.info('Initializing PromptManager...');
        await this.configManager.loadConfig();
        if (this.options.autoDiscovery) {
            const discovered = await this.pathResolver.discoverPromptDirectories();
            if (discovered.length > 0) {
                logger.info(`Auto-discovered ${discovered.length} prompt directories`);
                const config = this.configManager.getConfig();
                const uniqueDirs = Array.from(new Set([
                    ...config.sourceDirectories,
                    ...discovered.map((dir)=>path.relative(this.options.basePath, dir))
                ]));
                await this.configManager.saveConfig({
                    sourceDirectories: uniqueDirs
                });
            }
        }
        this.emit('initialized');
    }
    async copyPrompts(options = {}) {
        const config = this.configManager.getConfig();
        const profile = this.options.defaultProfile;
        const resolved = this.pathResolver.resolvePaths(config.sourceDirectories, config.destinationDirectory);
        if (resolved.sources.length === 0) {
            throw new Error('No valid source directories found');
        }
        const copyOptions = {
            source: resolved.sources[0],
            destination: resolved.destination,
            ...this.configManager.getProfile(profile),
            ...options
        };
        logger.info('Starting prompt copy operation', {
            source: copyOptions.source,
            destination: copyOptions.destination,
            profile
        });
        this.emit('copyStart', copyOptions);
        try {
            const result = await (copyOptions.parallel ? copyPromptsEnhanced(copyOptions) : copyPrompts(copyOptions));
            this.emit('copyComplete', result);
            return result;
        } catch (error) {
            this.emit('copyError', error);
            throw error;
        }
    }
    async copyFromMultipleSources(options = {}) {
        const config = this.configManager.getConfig();
        const resolved = this.pathResolver.resolvePaths(config.sourceDirectories, config.destinationDirectory);
        const results = [];
        for (const source of resolved.sources){
            try {
                const copyOptions = {
                    source,
                    destination: resolved.destination,
                    ...this.configManager.getProfile(this.options.defaultProfile),
                    ...options
                };
                logger.info(`Copying from source: ${source}`);
                const result = await copyPrompts(copyOptions);
                results.push(result);
                this.emit('sourceComplete', {
                    source,
                    result
                });
            } catch (error) {
                logger.error(`Failed to copy from ${source}:`, error);
                this.emit('sourceError', {
                    source,
                    error
                });
                results.push({
                    success: false,
                    totalFiles: 0,
                    copiedFiles: 0,
                    failedFiles: 0,
                    skippedFiles: 0,
                    errors: [
                        {
                            file: source,
                            error: error instanceof Error ? error.message : String(error),
                            phase: 'read'
                        }
                    ],
                    duration: 0
                });
            }
        }
        return results;
    }
    async validatePrompts(sourcePath) {
        const config = this.configManager.getConfig();
        const sources = sourcePath ? [
            sourcePath
        ] : config.sourceDirectories;
        const resolved = this.pathResolver.resolvePaths(sources, config.destinationDirectory);
        let totalFiles = 0;
        let validFiles = 0;
        let invalidFiles = 0;
        const issues = [];
        for (const source of resolved.sources){
            await this.validateDirectory(source, issues);
        }
        totalFiles = issues.length;
        validFiles = issues.filter((issue)=>issue.issues.length === 0).length;
        invalidFiles = totalFiles - validFiles;
        const report = {
            totalFiles,
            validFiles,
            invalidFiles,
            issues: issues.filter((issue)=>issue.issues.length > 0)
        };
        this.emit('validationComplete', report);
        return report;
    }
    async validateDirectory(dirPath, issues) {
        const fs = require('fs').promises;
        try {
            const entries = await fs.readdir(dirPath, {
                withFileTypes: true
            });
            for (const entry of entries){
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isFile() && this.isPromptFile(entry.name)) {
                    const result = await PromptValidator.validatePromptFile(fullPath);
                    issues.push({
                        file: fullPath,
                        issues: result.issues,
                        metadata: result.metadata
                    });
                } else if (entry.isDirectory()) {
                    await this.validateDirectory(fullPath, issues);
                }
            }
        } catch (error) {
            logger.error(`Failed to validate directory ${dirPath}:`, error);
        }
    }
    isPromptFile(fileName) {
        const config = this.configManager.getConfig();
        const patterns = config.defaultOptions.includePatterns;
        return patterns.some((pattern)=>{
            const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
            return new RegExp(regex).test(fileName);
        });
    }
    async syncPrompts(options = {}) {
        const config = this.configManager.getConfig();
        const resolved = this.pathResolver.resolvePaths(config.sourceDirectories, config.destinationDirectory);
        const syncOptions = {
            bidirectional: false,
            deleteOrphaned: false,
            compareHashes: true,
            incrementalOnly: true,
            ...options
        };
        const forwardResult = await this.performIncrementalSync(resolved.sources[0], resolved.destination, syncOptions);
        let backwardResult;
        if (syncOptions.bidirectional) {
            backwardResult = await this.performIncrementalSync(resolved.destination, resolved.sources[0], syncOptions);
        }
        return {
            forward: forwardResult,
            backward: backwardResult
        };
    }
    async performIncrementalSync(source, destination, options) {
        return copyPrompts({
            source,
            destination,
            conflictResolution: 'overwrite',
            verify: options.compareHashes
        });
    }
    async generateReport() {
        const config = this.configManager.getConfig();
        const resolved = this.pathResolver.resolvePaths(config.sourceDirectories, config.destinationDirectory);
        const sources = await Promise.all(resolved.sources.map(async (sourcePath)=>{
            try {
                const fs = require('fs').promises;
                const stats = await fs.stat(sourcePath);
                if (!stats.isDirectory()) {
                    return {
                        path: sourcePath,
                        exists: false
                    };
                }
                let fileCount = 0;
                let totalSize = 0;
                const scanDir = async (dir)=>{
                    const entries = await fs.readdir(dir, {
                        withFileTypes: true
                    });
                    for (const entry of entries){
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isFile() && this.isPromptFile(entry.name)) {
                            const fileStats = await fs.stat(fullPath);
                            fileCount++;
                            totalSize += fileStats.size;
                        } else if (entry.isDirectory()) {
                            await scanDir(fullPath);
                        }
                    }
                };
                await scanDir(sourcePath);
                return {
                    path: sourcePath,
                    exists: true,
                    fileCount,
                    totalSize
                };
            } catch  {
                return {
                    path: sourcePath,
                    exists: false
                };
            }
        }));
        return {
            configuration: config,
            sources
        };
    }
    getConfig() {
        return this.configManager.getConfig();
    }
    async updateConfig(updates) {
        await this.configManager.saveConfig(updates);
    }
    getProfiles() {
        return this.configManager.listProfiles();
    }
    getProfile(name) {
        return this.configManager.getProfile(name);
    }
    async discoverPromptDirectories() {
        return this.pathResolver.discoverPromptDirectories();
    }
}
export function createPromptManager(options) {
    return new PromptManager(options);
}
let defaultManager = null;
export function getDefaultPromptManager() {
    if (!defaultManager) {
        defaultManager = new PromptManager();
    }
    return defaultManager;
}

//# sourceMappingURL=prompt-manager.js.map