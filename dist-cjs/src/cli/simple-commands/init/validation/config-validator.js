import { promises as fs } from 'fs';
export class ConfigValidator {
    constructor(workingDir){
        this.workingDir = workingDir;
    }
    async validateRoomodes() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            config: null
        };
        const roomodesPath = `${this.workingDir}/.roomodes`;
        try {
            const stat = await fs.stat(roomodesPath);
            if (!stat.isFile) {
                result.success = false;
                result.errors.push('.roomodes exists but is not a file');
                return result;
            }
            const content = await fs.readFile(roomodesPath, 'utf8');
            try {
                const config = JSON.parse(content);
                result.config = config;
                const validationResult = this.validateRoomodesStructure(config);
                if (!validationResult.valid) {
                    result.success = false;
                    result.errors.push(...validationResult.errors);
                }
                result.warnings.push(...validationResult.warnings);
            } catch (jsonError) {
                result.success = false;
                result.errors.push(`Invalid JSON in .roomodes: ${jsonError.message}`);
            }
        } catch (error) {
            if (error instanceof Deno.errors.NotFound) {
                result.warnings.push('.roomodes file not found - SPARC features may not be available');
            } else {
                result.success = false;
                result.errors.push(`Could not read .roomodes: ${error.message}`);
            }
        }
        return result;
    }
    async validateClaudeMd() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            content: null
        };
        const claudeMdPath = `${this.workingDir}/CLAUDE.md`;
        try {
            const content = await fs.readFile(claudeMdPath, 'utf8');
            result.content = content;
            const requiredSections = [
                '# Claude Code Configuration',
                '## Project Overview',
                '## SPARC Development Commands'
            ];
            for (const section of requiredSections){
                if (!content.includes(section)) {
                    result.warnings.push(`Missing recommended section: ${section}`);
                }
            }
            const importantCommands = [
                'npx claude-flow sparc',
                'npm run build',
                'npm run test'
            ];
            for (const command of importantCommands){
                if (!content.includes(command)) {
                    result.warnings.push(`Missing important command reference: ${command}`);
                }
            }
            if (content.length < 100) {
                result.success = false;
                result.errors.push('CLAUDE.md appears to be too short or empty');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Could not read CLAUDE.md: ${error.message}`);
        }
        return result;
    }
    async validateMemoryConfig() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            data: null
        };
        const memoryDataPath = `${this.workingDir}/memory/claude-flow-data.json`;
        try {
            const content = await fs.readFile(memoryDataPath, 'utf8');
            try {
                const data = JSON.parse(content);
                result.data = data;
                const validationResult = this.validateMemoryDataStructure(data);
                if (!validationResult.valid) {
                    result.success = false;
                    result.errors.push(...validationResult.errors);
                }
                result.warnings.push(...validationResult.warnings);
            } catch (jsonError) {
                result.success = false;
                result.errors.push(`Invalid JSON in memory data: ${jsonError.message}`);
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Could not read memory data: ${error.message}`);
        }
        return result;
    }
    async validateCoordinationConfig() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            content: null
        };
        const coordinationPath = `${this.workingDir}/coordination.md`;
        try {
            const content = await fs.readFile(coordinationPath, 'utf8');
            result.content = content;
            const requiredSections = [
                '# Multi-Agent Coordination',
                '## Agent Coordination Patterns',
                '## Memory Management'
            ];
            for (const section of requiredSections){
                if (!content.includes(section)) {
                    result.warnings.push(`Missing recommended section in coordination.md: ${section}`);
                }
            }
            if (content.length < 50) {
                result.warnings.push('coordination.md appears to be very short');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Could not read coordination.md: ${error.message}`);
        }
        return result;
    }
    async validateExecutable() {
        const result = {
            success: true,
            errors: [],
            warnings: []
        };
        const executablePath = `${this.workingDir}/claude-flow`;
        try {
            const stat = await fs.stat(executablePath);
            if (!stat.isFile) {
                result.success = false;
                result.errors.push('claude-flow executable is not a file');
                return result;
            }
            if (Deno.build.os !== 'windows') {
                const isExecutable = (stat.mode & 0o111) !== 0;
                if (!isExecutable) {
                    result.warnings.push('claude-flow file is not executable');
                }
            }
            const content = await fs.readFile(executablePath, 'utf8');
            if (content.includes('#!/usr/bin/env')) {
                if (!content.includes('claude-flow') && !content.includes('deno run')) {
                    result.warnings.push("Executable script may not be properly configured");
                }
            } else {
                result.warnings.push('Executable may not have proper shebang');
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Could not validate executable: ${error.message}`);
        }
        return result;
    }
    validateRoomodesStructure(config) {
        const result = {
            valid: true,
            errors: [],
            warnings: []
        };
        if (typeof config !== 'object' || config === null) {
            result.valid = false;
            result.errors.push('.roomodes must be a JSON object');
            return result;
        }
        const requiredFields = [
            'modes',
            'version'
        ];
        for (const field of requiredFields){
            if (!(field in config)) {
                result.warnings.push(`Missing recommended field in .roomodes: ${field}`);
            }
        }
        if ('modes' in config) {
            if (typeof config.modes !== 'object' || config.modes === null) {
                result.valid = false;
                result.errors.push('.roomodes modes must be an object');
            } else {
                for (const [modeName, modeConfig] of Object.entries(config.modes)){
                    const modeValidation = this.validateModeConfig(modeName, modeConfig);
                    if (!modeValidation.valid) {
                        result.warnings.push(...modeValidation.errors.map((err)=>`Mode ${modeName}: ${err}`));
                    }
                }
            }
        }
        return result;
    }
    validateModeConfig(modeName, modeConfig) {
        const result = {
            valid: true,
            errors: []
        };
        if (typeof modeConfig !== 'object' || modeConfig === null) {
            result.valid = false;
            result.errors.push('mode configuration must be an object');
            return result;
        }
        const recommendedFields = [
            "description",
            'persona',
            'tools'
        ];
        for (const field of recommendedFields){
            if (!(field in modeConfig)) {
                result.errors.push(`missing recommended field: ${field}`);
            }
        }
        if ('tools' in modeConfig && !Array.isArray(modeConfig.tools)) {
            result.errors.push('tools must be an array');
        }
        if ("description" in modeConfig && typeof modeConfig.description !== 'string') {
            result.errors.push("description must be a string");
        }
        return result;
    }
    validateMemoryDataStructure(data) {
        const result = {
            valid: true,
            errors: [],
            warnings: []
        };
        if (typeof data !== 'object' || data === null) {
            result.valid = false;
            result.errors.push('Memory data must be a JSON object');
            return result;
        }
        const requiredFields = [
            'agents',
            'tasks',
            'lastUpdated'
        ];
        for (const field of requiredFields){
            if (!(field in data)) {
                result.warnings.push(`Missing field in memory data: ${field}`);
            }
        }
        if ('agents' in data && !Array.isArray(data.agents)) {
            result.errors.push('agents must be an array');
        }
        if ('tasks' in data && !Array.isArray(data.tasks)) {
            result.errors.push('tasks must be an array');
        }
        if ('lastUpdated' in data && typeof data.lastUpdated !== 'number') {
            result.warnings.push('lastUpdated should be a timestamp number');
        }
        return result;
    }
}

//# sourceMappingURL=config-validator.js.map