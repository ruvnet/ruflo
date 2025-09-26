import { promises as fs } from 'fs';
export class ModeValidator {
    constructor(workingDir){
        this.workingDir = workingDir;
    }
    async testAllModes() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            modes: {}
        };
        try {
            const sparcInitialized = await this.checkSparcInitialization();
            if (!sparcInitialized.initialized) {
                result.warnings.push('SPARC not initialized - mode testing skipped');
                return result;
            }
            const availableModes = await this.getAvailableModes();
            if (availableModes.length === 0) {
                result.warnings.push('No SPARC modes found for testing');
                return result;
            }
            for (const mode of availableModes){
                const modeTest = await this.testMode(mode);
                result.modes[mode] = modeTest;
                if (!modeTest.success) {
                    result.success = false;
                    result.errors.push(`Mode ${mode} failed testing: ${modeTest.error}`);
                }
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Mode testing failed: ${error.message}`);
        }
        return result;
    }
    async testMode(modeName) {
        const result = {
            success: true,
            error: null,
            checks: {
                accessible: false,
                configValid: false,
                executable: false
            }
        };
        try {
            const accessTest = await this.testModeAccess(modeName);
            result.checks.accessible = accessTest.success;
            if (!accessTest.success) {
                result.success = false;
                result.error = accessTest.error;
                return result;
            }
            const configTest = await this.testModeConfig(modeName);
            result.checks.configValid = configTest.success;
            if (!configTest.success) {
                result.success = false;
                result.error = configTest.error;
                return result;
            }
            const execTest = await this.testModeExecution(modeName);
            result.checks.executable = execTest.success;
            if (!execTest.success) {
                result.success = false;
                result.error = execTest.error;
                return result;
            }
        } catch (error) {
            result.success = false;
            result.error = error.message;
        }
        return result;
    }
    async checkSparcInitialization() {
        const result = {
            initialized: false,
            hasRoomodes: false,
            hasExecutable: false,
            error: null
        };
        try {
            try {
                const stat = await Deno.stat(`${this.workingDir}/.roomodes`);
                result.hasRoomodes = stat.isFile;
            } catch  {
                result.error = '.roomodes file not found';
            }
            try {
                const stat = await Deno.stat(`${this.workingDir}/claude-flow`);
                result.hasExecutable = stat.isFile;
            } catch  {
                result.error = 'claude-flow executable not found';
            }
            result.initialized = result.hasRoomodes && result.hasExecutable;
        } catch (error) {
            result.error = error.message;
        }
        return result;
    }
    async getAvailableModes() {
        const modes = [];
        try {
            const roomodesPath = `${this.workingDir}/.roomodes`;
            const content = await fs.readFile(roomodesPath, 'utf8');
            const config = JSON.parse(content);
            if (config.modes && typeof config.modes === 'object') {
                modes.push(...Object.keys(config.modes));
            }
        } catch (error) {
            modes.push('architect', 'code', 'tdd', 'spec-pseudocode', 'integration', 'debug', 'docs-writer');
        }
        return modes;
    }
    async testModeAccess(modeName) {
        const result = {
            success: false,
            error: null
        };
        try {
            const command = new Deno.Command('./claude-flow', {
                args: [
                    'sparc',
                    'info',
                    modeName
                ],
                cwd: this.workingDir,
                stdout: 'piped',
                stderr: 'piped'
            });
            const { success, stdout, stderr } = await command.output();
            if (success) {
                result.success = true;
            } else {
                const errorOutput = new TextDecoder().decode(stderr);
                result.error = `Mode not accessible: ${errorOutput}`;
            }
        } catch (error) {
            result.error = `Failed to test mode access: ${error.message}`;
        }
        return result;
    }
    async testModeConfig(modeName) {
        const result = {
            success: false,
            error: null
        };
        try {
            const roomodesPath = `${this.workingDir}/.roomodes`;
            const content = await fs.readFile(roomodesPath, 'utf8');
            const config = JSON.parse(content);
            if (!config.modes || !config.modes[modeName]) {
                result.error = `Mode ${modeName} not found in configuration`;
                return result;
            }
            const modeConfig = config.modes[modeName];
            if (typeof modeConfig !== 'object') {
                result.error = `Invalid configuration for mode ${modeName}`;
                return result;
            }
            const requiredFields = [
                "description"
            ];
            for (const field of requiredFields){
                if (!modeConfig[field]) {
                    result.error = `Mode ${modeName} missing required field: ${field}`;
                    return result;
                }
            }
            result.success = true;
        } catch (error) {
            result.error = `Configuration validation failed: ${error.message}`;
        }
        return result;
    }
    async testModeExecution(modeName) {
        const result = {
            success: false,
            error: null
        };
        try {
            const command = new Deno.Command('./claude-flow', {
                args: [
                    'sparc',
                    'run',
                    modeName,
                    'test validation',
                    '--dry-run'
                ],
                cwd: this.workingDir,
                stdout: 'piped',
                stderr: 'piped'
            });
            const { success, stdout, stderr } = await command.output();
            if (success) {
                result.success = true;
            } else {
                const errorOutput = new TextDecoder().decode(stderr);
                if (errorOutput.includes('dry-run') || errorOutput.includes('unknown flag')) {
                    const testCommand = new Deno.Command('./claude-flow', {
                        args: [
                            'sparc',
                            'modes'
                        ],
                        cwd: this.workingDir,
                        stdout: 'piped',
                        stderr: 'piped'
                    });
                    const testResult = await testCommand.output();
                    if (testResult.success) {
                        const output = new TextDecoder().decode(testResult.stdout);
                        result.success = output.includes(modeName);
                        if (!result.success) {
                            result.error = `Mode ${modeName} not listed in available modes`;
                        }
                    } else {
                        result.error = `Mode execution test failed: ${errorOutput}`;
                    }
                } else {
                    result.error = `Mode execution failed: ${errorOutput}`;
                }
            }
        } catch (error) {
            result.error = `Execution test failed: ${error.message}`;
        }
        return result;
    }
    async testWorkflowFunctionality() {
        const result = {
            success: true,
            errors: [],
            warnings: [],
            workflows: {}
        };
        try {
            const workflowDir = `${this.workingDir}/.roo/workflows`;
            try {
                const entries = [];
                for await (const entry of Deno.readDir(workflowDir)){
                    if (entry.isFile && entry.name.endsWith('.json')) {
                        entries.push(entry.name);
                    }
                }
                for (const workflowFile of entries){
                    const workflowTest = await this.testWorkflowFile(workflowFile);
                    result.workflows[workflowFile] = workflowTest;
                    if (!workflowTest.success) {
                        result.warnings.push(`Workflow ${workflowFile} has issues: ${workflowTest.error}`);
                    }
                }
                if (entries.length === 0) {
                    result.warnings.push('No workflow files found');
                }
            } catch  {
                result.warnings.push('Workflow directory not accessible');
            }
        } catch (error) {
            result.errors.push(`Workflow testing failed: ${error.message}`);
        }
        return result;
    }
    async testWorkflowFile(filename) {
        const result = {
            success: true,
            error: null
        };
        try {
            const workflowPath = `${this.workingDir}/.roo/workflows/${filename}`;
            const content = await fs.readFile(workflowPath, 'utf8');
            const workflow = JSON.parse(content);
            if (typeof workflow !== 'object' || workflow === null) {
                result.success = false;
                result.error = 'Workflow must be a JSON object';
                return result;
            }
            const recommendedFields = [
                'name',
                "description",
                'steps'
            ];
            for (const field of recommendedFields){
                if (!(field in workflow)) {
                    result.success = false;
                    result.error = `Missing recommended field: ${field}`;
                    return result;
                }
            }
        } catch (error) {
            result.success = false;
            result.error = `Workflow validation failed: ${error.message}`;
        }
        return result;
    }
}

//# sourceMappingURL=mode-validator.js.map