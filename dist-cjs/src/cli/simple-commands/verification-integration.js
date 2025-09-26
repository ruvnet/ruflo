import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
const execAsync = promisify(exec);
export class VerificationMiddleware {
    constructor(verificationSystem){
        this.verificationSystem = verificationSystem;
        this.enabled = true;
        this.autoRollback = true;
    }
    async executeWithVerification(taskFn, taskId, agentType, context) {
        const preCheck = await this.preTaskVerification(taskId, context);
        if (!preCheck.passed && this.enabled) {
            console.log(`❌ Pre-task verification failed for ${taskId}`);
            return {
                success: false,
                reason: 'Pre-task verification failed',
                preCheck
            };
        }
        let result;
        let error;
        try {
            result = await taskFn();
        } catch (err) {
            error = err;
            result = {
                success: false,
                error: err.message
            };
        }
        const postCheck = await this.postTaskVerification(taskId, agentType, result, context);
        if (!postCheck.passed && this.autoRollback) {
            await this.rollbackTask(taskId, context);
            return {
                success: false,
                reason: 'Post-task verification failed',
                result,
                verification: postCheck,
                rollback: true
            };
        }
        return {
            success: postCheck.passed,
            result,
            verification: postCheck
        };
    }
    async preTaskVerification(taskId, context) {
        const checks = [];
        if (context.requiresCleanState) {
            const gitStatus = await this.checkGitStatus();
            checks.push({
                name: 'clean-state',
                passed: gitStatus.clean,
                score: gitStatus.clean ? 1.0 : 0.0
            });
        }
        if (context.dependencies) {
            for (const dep of context.dependencies){
                const exists = await this.checkDependency(dep);
                checks.push({
                    name: `dependency-${dep}`,
                    passed: exists,
                    score: exists ? 1.0 : 0.0
                });
            }
        }
        const score = checks.length > 0 ? checks.reduce((sum, c)=>sum + c.score, 0) / checks.length : 1.0;
        return {
            passed: score >= 0.95,
            score,
            checks,
            timestamp: new Date().toISOString()
        };
    }
    async postTaskVerification(taskId, agentType, result, context) {
        const checks = [];
        switch(agentType){
            case 'coder':
                if (context.language === "typescript" || context.language === "javascript") {
                    const typecheck = await this.runTypeCheck();
                    checks.push({
                        name: 'typecheck',
                        passed: typecheck.passed,
                        score: typecheck.score
                    });
                }
                if (context.hasTests) {
                    const tests = await this.runTests();
                    checks.push({
                        name: 'tests',
                        passed: tests.passed,
                        score: tests.score
                    });
                }
                const lint = await this.runLint();
                checks.push({
                    name: 'lint',
                    passed: lint.passed,
                    score: lint.score
                });
                break;
            case 'researcher':
                if (result && result.output) {
                    const hasFindings = result.output.includes('findings') || result.output.includes('results');
                    checks.push({
                        name: 'research-completeness',
                        passed: hasFindings,
                        score: hasFindings ? 1.0 : 0.5
                    });
                }
                break;
            case 'tester':
                if (context.requiresCoverage) {
                    const coverage = await this.checkTestCoverage();
                    checks.push({
                        name: 'coverage',
                        passed: coverage.percentage >= 80,
                        score: coverage.percentage / 100
                    });
                }
                break;
            case 'architect':
                const hasDocs = await this.checkDocumentation();
                checks.push({
                    name: 'documentation',
                    passed: hasDocs,
                    score: hasDocs ? 1.0 : 0.3
                });
                break;
        }
        if (result && result.success !== undefined) {
            checks.push({
                name: 'claimed-success',
                passed: result.success,
                score: result.success ? 1.0 : 0.0
            });
        }
        const score = checks.length > 0 ? checks.reduce((sum, c)=>sum + c.score, 0) / checks.length : 0.5;
        await this.verificationSystem.verifyTask(taskId, agentType, {
            success: result?.success,
            checks,
            score
        });
        return {
            passed: score >= this.verificationSystem.getThreshold(),
            score,
            checks,
            timestamp: new Date().toISOString()
        };
    }
    async rollbackTask(taskId, context) {
        console.log(`🔄 Rolling back task ${taskId}...`);
        try {
            if (context.gitCheckpoint) {
                await execAsync(`git reset --hard ${context.gitCheckpoint}`);
                console.log(`✅ Rolled back to checkpoint ${context.gitCheckpoint}`);
            } else {
                await execAsync('git reset --hard HEAD');
                console.log(`✅ Rolled back to last commit`);
            }
            return true;
        } catch (error) {
            console.error(`❌ Rollback failed: ${error.message}`);
            return false;
        }
    }
    async checkGitStatus() {
        try {
            const { stdout } = await execAsync('git status --porcelain');
            return {
                clean: stdout.trim() === ''
            };
        } catch  {
            return {
                clean: false
            };
        }
    }
    async checkDependency(dep) {
        try {
            await execAsync(`which ${dep}`);
            return true;
        } catch  {
            return false;
        }
    }
    async runTypeCheck() {
        try {
            const { stdout } = await execAsync('npm run typecheck 2>&1 || true');
            const hasErrors = stdout.toLowerCase().includes('error');
            return {
                passed: !hasErrors,
                score: hasErrors ? 0.5 : 1.0
            };
        } catch  {
            return {
                passed: false,
                score: 0.3
            };
        }
    }
    async runTests() {
        try {
            const { stdout } = await execAsync('npm test 2>&1 || true');
            const passed = stdout.includes('PASS') || stdout.includes('passing');
            const failed = stdout.includes('FAIL') || stdout.includes('failing');
            if (passed && !failed) {
                return {
                    passed: true,
                    score: 1.0
                };
            } else if (passed && failed) {
                return {
                    passed: false,
                    score: 0.7
                };
            } else {
                return {
                    passed: false,
                    score: 0.3
                };
            }
        } catch  {
            return {
                passed: false,
                score: 0.0
            };
        }
    }
    async runLint() {
        try {
            const { stdout } = await execAsync('npm run lint 2>&1 || true');
            const hasErrors = stdout.toLowerCase().includes('error');
            const hasWarnings = stdout.toLowerCase().includes('warning');
            if (!hasErrors && !hasWarnings) {
                return {
                    passed: true,
                    score: 1.0
                };
            } else if (!hasErrors && hasWarnings) {
                return {
                    passed: true,
                    score: 0.8
                };
            } else {
                return {
                    passed: false,
                    score: 0.5
                };
            }
        } catch  {
            return {
                passed: false,
                score: 0.3
            };
        }
    }
    async checkTestCoverage() {
        try {
            const { stdout } = await execAsync('npm run coverage 2>&1 || true');
            const match = stdout.match(/(\d+(\.\d+)?)\s*%/);
            const percentage = match ? parseFloat(match[1]) : 0;
            return {
                percentage
            };
        } catch  {
            return {
                percentage: 0
            };
        }
    }
    async checkDocumentation() {
        try {
            const docFiles = [
                'README.md',
                'ARCHITECTURE.md',
                'docs/design.md'
            ];
            for (const file of docFiles){
                try {
                    await fs.access(file);
                    return true;
                } catch  {}
            }
            return false;
        } catch  {
            return false;
        }
    }
}
export function integrateWithSwarm(swarmCommand, verificationSystem) {
    const originalExecute = swarmCommand.execute;
    const middleware = new VerificationMiddleware(verificationSystem);
    swarmCommand.execute = async function(objective, options) {
        const checkpoint = await createGitCheckpoint();
        const context = {
            requiresCleanState: !options.allowDirty,
            dependencies: options.dependencies || [],
            language: options.language || "javascript",
            hasTests: options.runTests !== false,
            requiresCoverage: options.coverage === true,
            gitCheckpoint: checkpoint
        };
        return await middleware.executeWithVerification(()=>originalExecute.call(this, objective, options), `swarm-${Date.now()}`, 'swarm', context);
    };
    return swarmCommand;
}
export function integrateWithNonInteractive(flags, verificationSystem) {
    const verificationFlags = {
        ...flags,
        verify: true,
        verificationThreshold: flags.threshold || 0.95,
        autoRollback: flags.rollback !== false
    };
    return {
        flags: verificationFlags,
        preExecute: async (taskId)=>{
            await verificationSystem.initialize('strict');
            console.log('✅ Verification enabled for non-interactive mode');
        },
        postExecute: async (taskId, result)=>{
            const verification = await verificationSystem.verifyTask(taskId, 'non-interactive', result);
            if (!verification.passed) {
                console.error('❌ Verification failed in non-interactive mode');
                process.exit(1);
            }
        }
    };
}
export function integrateWithTraining(trainingSystem, verificationSystem) {
    verificationSystem.onVerification = async (verification)=>{
        const trainingData = {
            input: {
                taskId: verification.taskId,
                agentType: verification.agentType,
                context: verification.context
            },
            output: {
                success: verification.passed,
                score: verification.score,
                checks: verification.results
            }
        };
        await trainingSystem.learn(trainingData);
        if (verification.agentType) {
            await trainingSystem.updateAgentModel(verification.agentType, verification.score);
        }
    };
    return verificationSystem;
}
async function createGitCheckpoint() {
    try {
        const { stdout } = await execAsync('git rev-parse HEAD');
        return stdout.trim();
    } catch  {
        return null;
    }
}
export const verificationHooks = {
    beforeTask: async (taskId, context)=>{
        console.log(`🔍 Pre-task verification for ${taskId}`);
    },
    afterTask: async (taskId, result, context)=>{
        console.log(`✅ Post-task verification for ${taskId}`);
    },
    onFailure: async (taskId, verification)=>{
        console.log(`❌ Verification failed for ${taskId}: ${verification.score}`);
    }
};
export default {
    VerificationMiddleware,
    integrateWithSwarm,
    integrateWithNonInteractive,
    integrateWithTraining,
    verificationHooks
};

//# sourceMappingURL=verification-integration.js.map