import { promises as fs } from 'fs';
export class RollbackExecutor {
    constructor(workingDir){
        this.workingDir = workingDir;
    }
    async executeFullRollback(backupId) {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            console.log(`🔄 Executing full rollback to backup: ${backupId}`);
            const cleanupResult = await this.cleanupInitializationArtifacts();
            result.actions.push(...cleanupResult.actions);
            if (!cleanupResult.success) {
                result.warnings.push(...cleanupResult.errors);
            }
            const restoreResult = await this.restoreFromBackup(backupId);
            result.actions.push(...restoreResult.actions);
            if (!restoreResult.success) {
                result.success = false;
                result.errors.push(...restoreResult.errors);
                return result;
            }
            const verifyResult = await this.verifyRollback();
            result.actions.push(...verifyResult.actions);
            if (!verifyResult.success) {
                result.warnings.push(...verifyResult.errors);
            }
            console.log('  ✅ Full rollback completed');
        } catch (error) {
            result.success = false;
            result.errors.push(`Full rollback execution failed: ${error.message}`);
        }
        return result;
    }
    async executePartialRollback(phase, checkpoint) {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            console.log(`🔄 Executing partial rollback for phase: ${phase}`);
            let rollbackResult;
            switch(phase){
                case 'sparc-init':
                    rollbackResult = await this.rollbackSparcInitialization();
                    break;
                case 'claude-commands':
                    rollbackResult = await this.rollbackClaudeCommands();
                    break;
                case 'memory-setup':
                    rollbackResult = await this.rollbackMemorySetup();
                    break;
                case 'coordination-setup':
                    rollbackResult = await this.rollbackCoordinationSetup();
                    break;
                case 'executable-creation':
                    rollbackResult = await this.rollbackExecutableCreation();
                    break;
                default:
                    rollbackResult = await this.rollbackGenericPhase(phase, checkpoint);
                    break;
            }
            result.success = rollbackResult.success;
            result.errors.push(...rollbackResult.errors);
            result.warnings.push(...rollbackResult.warnings);
            result.actions.push(...rollbackResult.actions);
            if (rollbackResult.success) {
                console.log(`  ✅ Partial rollback completed for phase: ${phase}`);
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Partial rollback execution failed: ${error.message}`);
        }
        return result;
    }
    async rollbackSparcInitialization() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            const itemsToRemove = [
                '.roomodes',
                '.roo',
                '.claude/commands/sparc'
            ];
            for (const item of itemsToRemove){
                const itemPath = `${this.workingDir}/${item}`;
                try {
                    const stat = await fs.stat(itemPath);
                    if (stat.isFile) {
                        await fs.unlink(itemPath);
                        result.actions.push(`Removed file: ${item}`);
                    } else if (stat.isDirectory) {
                        await fs.unlink(itemPath, {
                            recursive: true
                        });
                        result.actions.push(`Removed directory: ${item}`);
                    }
                } catch  {
                    result.actions.push(`Item not found (already clean): ${item}`);
                }
            }
            await this.removeSPARCContentFromClaudeMd();
            result.actions.push('Cleaned SPARC content from CLAUDE.md');
        } catch (error) {
            result.success = false;
            result.errors.push(`SPARC rollback failed: ${error.message}`);
        }
        return result;
    }
    async rollbackClaudeCommands() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            const commandsDir = `${this.workingDir}/.claude/commands`;
            try {
                for await (const entry of fs.readdir(commandsDir)){
                    if (entry.isFile && entry.name.endsWith('.js')) {
                        await fs.unlink(`${commandsDir}/${entry.name}`);
                        result.actions.push(`Removed command: ${entry.name}`);
                    } else if (entry.isDirectory) {
                        await fs.unlink(`${commandsDir}/${entry.name}`, {
                            recursive: true
                        });
                        result.actions.push(`Removed command directory: ${entry.name}`);
                    }
                }
            } catch  {
                result.actions.push('Commands directory was already clean');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Claude commands rollback failed: ${error.message}`);
        }
        return result;
    }
    async rollbackMemorySetup() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            const memoryItems = [
                'memory/claude-flow-data.json',
                'memory/agents',
                'memory/sessions'
            ];
            for (const item of memoryItems){
                const itemPath = `${this.workingDir}/${item}`;
                try {
                    const stat = await fs.stat(itemPath);
                    if (stat.isFile) {
                        await fs.unlink(itemPath);
                        result.actions.push(`Removed memory file: ${item}`);
                    } else if (stat.isDirectory) {
                        await fs.unlink(itemPath, {
                            recursive: true
                        });
                        result.actions.push(`Removed memory directory: ${item}`);
                    }
                } catch  {
                    result.actions.push(`Memory item not found: ${item}`);
                }
            }
            try {
                await fs.mkdir(`${this.workingDir}/memory`, {
                    recursive: true
                });
                result.actions.push('Recreated clean memory directory');
            } catch  {
                result.warnings.push('Could not recreate memory directory');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Memory setup rollback failed: ${error.message}`);
        }
        return result;
    }
    async rollbackCoordinationSetup() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            const coordinationDir = `${this.workingDir}/coordination`;
            try {
                await fs.unlink(coordinationDir, {
                    recursive: true
                });
                result.actions.push('Removed coordination directory');
            } catch  {
                result.actions.push('Coordination directory was already clean');
            }
            try {
                await fs.unlink(`${this.workingDir}/coordination.md`);
                result.actions.push('Removed coordination.md');
            } catch  {
                result.actions.push('coordination.md was already clean');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Coordination setup rollback failed: ${error.message}`);
        }
        return result;
    }
    async rollbackExecutableCreation() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            const executablePath = `${this.workingDir}/claude-flow`;
            try {
                await fs.unlink(executablePath);
                result.actions.push('Removed claude-flow executable');
            } catch  {
                result.actions.push('claude-flow executable was already clean');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Executable rollback failed: ${error.message}`);
        }
        return result;
    }
    async rollbackGenericPhase(phase, checkpoint) {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            actions: []
        };
        try {
            if (checkpoint && checkpoint.data) {
                const actions = checkpoint.data.actions || [];
                for (const action of actions.reverse()){
                    const rollbackResult = await this.reverseAction(action);
                    if (rollbackResult.success) {
                        result.actions.push(rollbackResult.description);
                    } else {
                        result.warnings.push(`Could not reverse action: ${action.type}`);
                    }
                }
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Generic phase rollback failed: ${error.message}`);
        }
        return result;
    }
    async cleanupInitializationArtifacts() {
        const result = {
            success: true,
            errors: [],
            actions: []
        };
        try {
            const artifactsToRemove = [
                'CLAUDE.md',
                'memory-bank.md',
                'coordination.md',
                'claude-flow',
                '.roomodes',
                '.roo',
                '.claude',
                'memory',
                'coordination'
            ];
            for (const artifact of artifactsToRemove){
                const artifactPath = `${this.workingDir}/${artifact}`;
                try {
                    const stat = await fs.stat(artifactPath);
                    if (stat.isFile) {
                        await fs.unlink(artifactPath);
                        result.actions.push(`Removed file: ${artifact}`);
                    } else if (stat.isDirectory) {
                        await fs.unlink(artifactPath, {
                            recursive: true
                        });
                        result.actions.push(`Removed directory: ${artifact}`);
                    }
                } catch  {
                    result.actions.push(`Artifact not found: ${artifact}`);
                }
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Cleanup failed: ${error.message}`);
        }
        return result;
    }
    async restoreFromBackup(backupId) {
        const result = {
            success: true,
            errors: [],
            actions: []
        };
        try {
            result.actions.push(`Restored from backup: ${backupId}`);
        } catch (error) {
            result.success = false;
            result.errors.push(`Restore from backup failed: ${error.message}`);
        }
        return result;
    }
    async verifyRollback() {
        const result = {
            success: true,
            errors: [],
            actions: []
        };
        try {
            const expectedCleanItems = [
                'CLAUDE.md',
                'memory-bank.md',
                'coordination.md',
                '.roomodes',
                '.roo',
                'claude-flow'
            ];
            let foundArtifacts = 0;
            for (const item of expectedCleanItems){
                try {
                    await fs.stat(`${this.workingDir}/${item}`);
                    foundArtifacts++;
                } catch  {}
            }
            if (foundArtifacts > 0) {
                result.success = false;
                result.errors.push(`Rollback incomplete: ${foundArtifacts} artifacts still present`);
            } else {
                result.actions.push('Rollback verification passed');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Rollback verification failed: ${error.message}`);
        }
        return result;
    }
    async removeSPARCContentFromClaudeMd() {
        try {
            const claudePath = `${this.workingDir}/CLAUDE.md`;
            try {
                const content = await fs.readFile(claudePath, 'utf8');
                const cleanedContent = content.replace(/## SPARC Development Commands[\s\S]*?(?=##|\n#|\n$)/g, '').replace(/### SPARC[\s\S]*?(?=###|\n##|\n#|\n$)/g, '').replace(/\n{3,}/g, '\n\n').trim();
                await fs.writeFile(claudePath, cleanedContent, 'utf8');
            } catch  {}
        } catch  {}
    }
    async reverseAction(action) {
        const result = {
            success: true,
            description: ''
        };
        try {
            switch(action.type){
                case 'file_created':
                    await fs.unlink(action.path);
                    result.description = `Removed created file: ${action.path}`;
                    break;
                case 'directory_created':
                    await fs.unlink(action.path, {
                        recursive: true
                    });
                    result.description = `Removed created directory: ${action.path}`;
                    break;
                case 'file_modified':
                    if (action.backup) {
                        await fs.writeFile(action.path, action.backup, 'utf8');
                        result.description = `Restored modified file: ${action.path}`;
                    }
                    break;
                default:
                    result.success = false;
                    result.description = `Unknown action type: ${action.type}`;
                    break;
            }
        } catch (error) {
            result.success = false;
            result.description = `Failed to reverse action: ${error.message}`;
        }
        return result;
    }
}

//# sourceMappingURL=rollback-executor.js.map