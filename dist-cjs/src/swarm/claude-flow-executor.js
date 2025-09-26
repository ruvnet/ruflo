import { Logger } from '../core/logger.js';
import { spawn } from 'node:child_process';
import { getClaudeFlowBin } from '../utils/paths.js';
export class ClaudeFlowExecutor {
    logger;
    claudeFlowPath;
    enableSparc;
    verbose;
    timeoutMinutes;
    constructor(config = {}){
        this.logger = config.logger || new Logger({
            level: 'info',
            format: 'text',
            destination: 'console'
        }, {
            component: 'ClaudeFlowExecutor'
        });
        this.claudeFlowPath = config.claudeFlowPath || getClaudeFlowBin();
        this.enableSparc = config.enableSparc ?? true;
        this.verbose = config.verbose ?? false;
        this.timeoutMinutes = config.timeoutMinutes ?? 59;
    }
    async executeTask(task, agent, targetDir) {
        this.logger.info('Executing task with Claude Flow SPARC', {
            taskId: task.id.id,
            taskName: task.name,
            agentType: agent.type,
            targetDir
        });
        const startTime = Date.now();
        try {
            const sparcMode = this.determineSparcMode(task, agent);
            const command = this.buildSparcCommand(task, sparcMode, targetDir);
            this.logger.info('Executing SPARC command', {
                mode: sparcMode,
                command: command.join(' ')
            });
            const result = await this.executeCommand(command);
            const endTime = Date.now();
            const executionTime = endTime - startTime;
            return {
                output: result.output,
                artifacts: result.artifacts || {},
                metadata: {
                    executionTime,
                    sparcMode,
                    command: command.join(' '),
                    exitCode: result.exitCode,
                    quality: 0.95,
                    completeness: 0.9
                },
                error: result.error
            };
        } catch (error) {
            this.logger.error('Failed to execute Claude Flow SPARC command', {
                error: error instanceof Error ? error.message : String(error),
                taskId: task.id.id
            });
            return {
                output: '',
                artifacts: {},
                metadata: {
                    executionTime: Date.now() - startTime,
                    quality: 0,
                    completeness: 0
                },
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    determineSparcMode(task, agent) {
        const modeMap = {
            coding: 'code',
            testing: 'tdd',
            analysis: 'spec-pseudocode',
            documentation: 'docs-writer',
            research: 'spec-pseudocode',
            review: 'refinement-optimization-mode',
            deployment: 'devops',
            optimization: 'refinement-optimization-mode',
            integration: 'integration',
            coder: 'code',
            tester: 'tdd',
            analyst: 'spec-pseudocode',
            documenter: 'docs-writer',
            reviewer: 'refinement-optimization-mode',
            researcher: 'spec-pseudocode',
            coordinator: 'architect'
        };
        const description = task.description.toLowerCase();
        if (description.includes('architecture') || description.includes('design')) {
            return 'architect';
        }
        if (description.includes('security')) {
            return 'security-review';
        }
        if (description.includes('debug')) {
            return 'debug';
        }
        if (description.includes('test')) {
            return 'tdd';
        }
        if (description.includes('document')) {
            return 'docs-writer';
        }
        if (description.includes('integrate')) {
            return 'integration';
        }
        return modeMap[agent.type] || modeMap[task.type] || 'code';
    }
    buildSparcCommand(task, mode, targetDir) {
        const command = [
            this.claudeFlowPath,
            'sparc',
            'run',
            mode,
            `"${this.formatTaskDescription(task)}"`
        ];
        if (targetDir) {
            command.push('--target-dir', targetDir);
        }
        if (this.verbose) {
            command.push('--verbose');
        }
        command.push('--non-interactive');
        command.push('--yes');
        return command;
    }
    formatTaskDescription(task) {
        let description = task.description;
        if (task.instructions && task.instructions !== task.description) {
            description = `${task.description}. ${task.instructions}`;
        }
        if (task.context?.targetDir) {
            description += ` in ${task.context.targetDir}`;
        }
        return description.replace(/"/g, '\\"');
    }
    async executeCommand(command) {
        return new Promise((resolve, reject)=>{
            const [cmd, ...args] = command;
            const proc = spawn(cmd, args, {
                shell: true,
                env: {
                    ...process.env,
                    CLAUDE_FLOW_NON_INTERACTIVE: 'true',
                    CLAUDE_FLOW_AUTO_CONFIRM: 'true'
                }
            });
            let stdout = '';
            let stderr = '';
            const artifacts = {};
            proc.stdout.on('data', (data)=>{
                const chunk = data.toString();
                stdout += chunk;
                const artifactMatch = chunk.match(/Created file: (.+)/g);
                if (artifactMatch) {
                    artifactMatch.forEach((match)=>{
                        const filePath = match.replace('Created file: ', '').trim();
                        artifacts[filePath] = true;
                    });
                }
            });
            proc.stderr.on('data', (data)=>{
                stderr += data.toString();
            });
            proc.on('close', (code)=>{
                clearTimeout(timeoutId);
                if (code === 0) {
                    resolve({
                        output: stdout,
                        artifacts,
                        exitCode: code,
                        error: null
                    });
                } else {
                    resolve({
                        output: stdout,
                        artifacts,
                        exitCode: code,
                        error: stderr || `Command exited with code ${code}`
                    });
                }
            });
            proc.on('error', (err)=>{
                reject(err);
            });
            const timeoutMs = this.timeoutMinutes * 60 * 1000;
            const timeoutId = setTimeout(()=>{
                proc.kill('SIGTERM');
                reject(new Error('Command execution timeout'));
            }, timeoutMs);
        });
    }
}
export default ClaudeFlowExecutor;

//# sourceMappingURL=claude-flow-executor.js.map