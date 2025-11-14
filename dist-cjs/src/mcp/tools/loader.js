import { promises as fs } from 'fs';
import { join, dirname, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export class DynamicToolLoader {
    toolsDir;
    logger;
    metadataCache = new Map();
    toolCache = new Map();
    scanComplete = false;
    constructor(toolsDir = join(__dirname, '.'), logger){
        this.toolsDir = toolsDir;
        this.logger = logger;
    }
    async scanTools() {
        if (this.scanComplete) {
            return this.metadataCache;
        }
        this.logger.info('Scanning tools directory for metadata', {
            toolsDir: this.toolsDir
        });
        const startTime = Date.now();
        let scannedFiles = 0;
        let loadedMetadata = 0;
        try {
            const resolvedToolsDir = resolve(this.toolsDir);
            const entries = await fs.readdir(resolvedToolsDir, {
                withFileTypes: true
            });
            const categories = entries.filter((e)=>e.isDirectory() && !e.name.startsWith('_'));
            for (const categoryEntry of categories){
                const category = categoryEntry.name;
                const categoryPath = resolve(resolvedToolsDir, category);
                if (!categoryPath.startsWith(resolvedToolsDir)) {
                    this.logger.warn('Skipping category outside tools directory', {
                        category,
                        categoryPath,
                        toolsDir: resolvedToolsDir
                    });
                    continue;
                }
                try {
                    const toolFiles = await fs.readdir(categoryPath);
                    const validToolFiles = toolFiles.filter((f)=>{
                        const ext = extname(f);
                        return (ext === '.ts' || ext === '.js') && !f.startsWith('_');
                    });
                    for (const toolFile of validToolFiles){
                        scannedFiles++;
                        const toolPath = resolve(categoryPath, toolFile);
                        if (!toolPath.startsWith(categoryPath)) {
                            this.logger.warn('Skipping tool file outside category directory', {
                                toolFile,
                                toolPath,
                                categoryPath
                            });
                            continue;
                        }
                        try {
                            const module = await import(toolPath);
                            if (module.toolMetadata) {
                                const metadata = {
                                    ...module.toolMetadata,
                                    category,
                                    filePath: toolPath
                                };
                                this.metadataCache.set(metadata.name, metadata);
                                loadedMetadata++;
                                this.logger.debug('Loaded tool metadata', {
                                    name: metadata.name,
                                    category: metadata.category,
                                    filePath: toolPath
                                });
                            } else {
                                this.logger.warn('Tool file missing toolMetadata export', {
                                    filePath: toolPath
                                });
                            }
                        } catch (error) {
                            this.logger.error('Failed to load tool metadata', {
                                filePath: toolPath,
                                error: error instanceof Error ? error.message : String(error)
                            });
                        }
                    }
                } catch (error) {
                    this.logger.error('Failed to scan category directory', {
                        category,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            const scanTime = Date.now() - startTime;
            this.scanComplete = true;
            this.logger.info('Tool scan complete', {
                scannedFiles,
                loadedMetadata,
                totalTools: this.metadataCache.size,
                scanTimeMs: scanTime
            });
            return this.metadataCache;
        } catch (error) {
            this.logger.error('Failed to scan tools directory', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async loadTool(toolName, logger) {
        if (this.toolCache.has(toolName)) {
            this.logger.debug('Tool loaded from cache', {
                toolName
            });
            return this.toolCache.get(toolName);
        }
        const metadata = this.metadataCache.get(toolName);
        if (!metadata) {
            this.logger.warn('Tool not found in metadata cache', {
                toolName
            });
            return null;
        }
        try {
            this.logger.debug('Loading full tool definition', {
                toolName,
                filePath: metadata.filePath
            });
            const module = await import(metadata.filePath);
            const creatorFn = Object.values(module).find((exp)=>typeof exp === 'function' && exp.name.startsWith('create'));
            if (!creatorFn) {
                throw new Error(`No tool creator function found in ${metadata.filePath}. ` + `Expected function name starting with 'create'.`);
            }
            const tool = creatorFn(logger);
            if (tool.name !== toolName) {
                this.logger.warn('Tool name mismatch', {
                    expected: toolName,
                    actual: tool.name,
                    filePath: metadata.filePath
                });
            }
            this.toolCache.set(toolName, tool);
            this.logger.info('Tool loaded successfully', {
                toolName,
                category: metadata.category
            });
            return tool;
        } catch (error) {
            this.logger.error('Failed to load tool', {
                toolName,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    getToolMetadata(toolName) {
        return this.metadataCache.get(toolName);
    }
    searchTools(query) {
        const results = [];
        for (const metadata of this.metadataCache.values()){
            if (query.category && metadata.category !== query.category) {
                continue;
            }
            if (query.detailLevel && metadata.detailLevel !== query.detailLevel) {
                continue;
            }
            if (query.tags && query.tags.length > 0) {
                const toolTags = metadata.tags || [];
                const hasAllTags = query.tags.every((tag)=>toolTags.includes(tag));
                if (!hasAllTags) {
                    continue;
                }
            }
            if (query.namePattern) {
                const pattern = query.namePattern.toLowerCase();
                if (!metadata.name.toLowerCase().includes(pattern) && !metadata.description.toLowerCase().includes(pattern)) {
                    continue;
                }
            }
            results.push(metadata);
        }
        results.sort((a, b)=>a.name.localeCompare(b.name));
        return results;
    }
    getAllToolNames() {
        return Array.from(this.metadataCache.keys()).sort();
    }
    getToolsByCategory() {
        const byCategory = new Map();
        for (const metadata of this.metadataCache.values()){
            const category = metadata.category;
            if (!byCategory.has(category)) {
                byCategory.set(category, []);
            }
            byCategory.get(category).push(metadata);
        }
        return byCategory;
    }
    getStats() {
        const byCategory = this.getToolsByCategory();
        return {
            totalTools: this.metadataCache.size,
            cachedTools: this.toolCache.size,
            categories: Array.from(byCategory.keys()).sort(),
            toolsByCategory: Object.fromEntries(Array.from(byCategory.entries()).map(([cat, tools])=>[
                    cat,
                    tools.length
                ])),
            scanComplete: this.scanComplete
        };
    }
    clearCache() {
        this.toolCache.clear();
        this.logger.info('Tool cache cleared', {
            previouslyCached: this.toolCache.size
        });
    }
    async reload() {
        this.metadataCache.clear();
        this.toolCache.clear();
        this.scanComplete = false;
        await this.scanTools();
        this.logger.info('Tool loader reloaded');
    }
}

//# sourceMappingURL=loader.js.map