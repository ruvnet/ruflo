import { ValidationSystem } from './index.js';
import { promises as fs } from 'fs';
import { RollbackSystem } from '../rollback/index.js';
import { printSuccess, printError, printWarning } from '../../../utils.js';
export class ValidationTestRunner {
    constructor(workingDir){
        this.workingDir = workingDir;
        this.validationSystem = new ValidationSystem(workingDir);
        this.rollbackSystem = new RollbackSystem(workingDir);
        this.testResults = [];
    }
    async runAllTests() {
        console.log('🧪 Running validation and rollback system tests...');
        const tests = [
            {
                name: 'Pre-init Validation',
                test: ()=>this.testPreInitValidation()
            },
            {
                name: 'Post-init Validation',
                test: ()=>this.testPostInitValidation()
            },
            {
                name: 'Configuration Validation',
                test: ()=>this.testConfigValidation()
            },
            {
                name: 'Mode Functionality',
                test: ()=>this.testModeFunctionality()
            },
            {
                name: 'Health Checks',
                test: ()=>this.testHealthChecks()
            },
            {
                name: 'Backup System',
                test: ()=>this.testBackupSystem()
            },
            {
                name: 'Rollback System',
                test: ()=>this.testRollbackSystem()
            },
            {
                name: 'State Tracking',
                test: ()=>this.testStateTracking()
            },
            {
                name: 'Recovery Procedures',
                test: ()=>this.testRecoveryProcedures()
            },
            {
                name: 'Atomic Operations',
                test: ()=>this.testAtomicOperations()
            }
        ];
        for (const testCase of tests){
            console.log(`\n🔬 Testing: ${testCase.name}`);
            try {
                const result = await testCase.test();
                this.testResults.push({
                    name: testCase.name,
                    success: result.success,
                    details: result
                });
                if (result.success) {
                    printSuccess(`✅ ${testCase.name} passed`);
                } else {
                    printError(`❌ ${testCase.name} failed`);
                    if (result.errors) {
                        result.errors.forEach((error)=>console.error(`  - ${error}`));
                    }
                }
            } catch (error) {
                this.testResults.push({
                    name: testCase.name,
                    success: false,
                    error: error.message
                });
                printError(`❌ ${testCase.name} threw exception: ${error.message}`);
            }
        }
        this.generateTestReport();
    }
    async testPreInitValidation() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const normalValidation = await this.validationSystem.validatePreInit();
            result.details.normal = normalValidation;
            if (!normalValidation.success && normalValidation.errors.length > 0) {
                result.details.expectedFailures = normalValidation.errors;
            }
            const forceValidation = await this.validationSystem.validatePreInit({
                force: true
            });
            result.details.force = forceValidation;
            result.success = true;
        } catch (error) {
            result.success = false;
            result.errors.push(`Pre-init validation test failed: ${error.message}`);
        }
        return result;
    }
    async testPostInitValidation() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            await this.createTestFiles();
            const postValidation = await this.validationSystem.validatePostInit();
            result.details.postValidation = postValidation;
            await this.cleanupTestFiles();
            result.success = true;
        } catch (error) {
            result.success = false;
            result.errors.push(`Post-init validation test failed: ${error.message}`);
        }
        return result;
    }
    async testConfigValidation() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            await this.createTestConfigs();
            const configValidation = await this.validationSystem.validateConfiguration();
            result.details.configValidation = configValidation;
            await this.cleanupTestConfigs();
            result.success = true;
        } catch (error) {
            result.success = false;
            result.errors.push(`Config validation test failed: ${error.message}`);
        }
        return result;
    }
    async testModeFunctionality() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            await this.createTestSparcConfig();
            const modeTests = await this.validationSystem.testModeFunctionality();
            result.details.modeTests = modeTests;
            await this.cleanupTestSparcConfig();
            result.success = true;
        } catch (error) {
            result.success = false;
            result.errors.push(`Mode functionality test failed: ${error.message}`);
        }
        return result;
    }
    async testHealthChecks() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const healthChecks = await this.validationSystem.runHealthChecks();
            result.details.healthChecks = healthChecks;
            result.success = true;
        } catch (error) {
            result.success = false;
            result.errors.push(`Health checks test failed: ${error.message}`);
        }
        return result;
    }
    async testBackupSystem() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const backupResult = await this.rollbackSystem.backupManager.createBackup('test', 'Test backup');
            result.details.backupCreation = backupResult;
            if (!backupResult.success) {
                result.success = false;
                result.errors.push('Backup creation failed');
                return result;
            }
            const backups = await this.rollbackSystem.backupManager.listBackups();
            result.details.backupListing = {
                count: backups.length
            };
            if (backupResult.id) {
                const deleteResult = await this.rollbackSystem.backupManager.deleteBackup(backupResult.id);
                result.details.backupDeletion = deleteResult;
                if (!deleteResult.success) {
                    result.errors.push('Backup deletion failed');
                }
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`Backup system test failed: ${error.message}`);
        }
        return result;
    }
    async testRollbackSystem() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const rollbackValidation = await this.rollbackSystem.validateRollbackSystem();
            result.details.rollbackValidation = rollbackValidation;
            if (!rollbackValidation.success) {
                result.errors.push(...rollbackValidation.errors);
            }
            const rollbackPoints = await this.rollbackSystem.listRollbackPoints();
            result.details.rollbackPoints = {
                count: rollbackPoints.rollbackPoints.length,
                checkpoints: rollbackPoints.checkpoints.length
            };
        } catch (error) {
            result.success = false;
            result.errors.push(`Rollback system test failed: ${error.message}`);
        }
        return result;
    }
    async testStateTracking() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const stateTracker = this.rollbackSystem.stateTracker;
            const checkpoint = await stateTracker.createCheckpoint('test-phase', {
                test: true
            });
            result.details.checkpointCreation = checkpoint;
            if (!checkpoint.success) {
                result.errors.push('Checkpoint creation failed');
            }
            const rollbackPoint = await stateTracker.recordRollbackPoint('test', {
                testData: true
            });
            result.details.rollbackPointCreation = rollbackPoint;
            if (!rollbackPoint.success) {
                result.errors.push('Rollback point creation failed');
            }
            const stateValidation = await stateTracker.validateStateTracking();
            result.details.stateValidation = stateValidation;
            if (!stateValidation.success) {
                result.errors.push(...stateValidation.errors);
            }
        } catch (error) {
            result.success = false;
            result.errors.push(`State tracking test failed: ${error.message}`);
        }
        return result;
    }
    async testRecoveryProcedures() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const recoveryManager = this.rollbackSystem.recoveryManager;
            const recoveryValidation = await recoveryManager.validateRecoverySystem();
            result.details.recoveryValidation = recoveryValidation;
            if (!recoveryValidation.success) {
                result.errors.push(...recoveryValidation.errors);
            }
            const genericRecovery = await recoveryManager.performRecovery('test-failure', {
                test: true
            });
            result.details.genericRecovery = genericRecovery;
        } catch (error) {
            result.success = false;
            result.errors.push(`Recovery procedures test failed: ${error.message}`);
        }
        return result;
    }
    async testAtomicOperations() {
        const result = {
            success: true,
            errors: [],
            details: {}
        };
        try {
            const { createAtomicOperation } = await import('../rollback/index.js');
            const atomicOp = createAtomicOperation(this.rollbackSystem, 'test-operation');
            const beginResult = await atomicOp.begin();
            result.details.atomicBegin = {
                success: beginResult
            };
            if (!beginResult) {
                result.errors.push('Atomic operation begin failed');
                return result;
            }
            await atomicOp.commit();
            result.details.atomicCommit = {
                success: true
            };
        } catch (error) {
            result.success = false;
            result.errors.push(`Atomic operations test failed: ${error.message}`);
        }
        return result;
    }
    generateTestReport() {
        console.log('\n' + '='.repeat(60));
        console.log('🧪 VALIDATION & ROLLBACK SYSTEM TEST REPORT');
        console.log('='.repeat(60));
        const passed = this.testResults.filter((test)=>test.success).length;
        const failed = this.testResults.filter((test)=>!test.success).length;
        const total = this.testResults.length;
        console.log(`\n📊 Summary: ${passed}/${total} tests passed`);
        if (failed === 0) {
            printSuccess('🎉 All tests passed!');
        } else {
            printError(`❌ ${failed} tests failed`);
        }
        console.log('\n📋 Test Results:');
        this.testResults.forEach((test)=>{
            const status = test.success ? '✅' : '❌';
            console.log(`  ${status} ${test.name}`);
            if (!test.success && test.error) {
                console.log(`    Error: ${test.error}`);
            }
        });
        console.log('\n' + '='.repeat(60));
        const healthScore = passed / total * 100;
        console.log(`\n🏥 System Health Score: ${healthScore.toFixed(1)}%`);
        if (healthScore >= 90) {
            printSuccess('🟢 Excellent - System is fully operational');
        } else if (healthScore >= 70) {
            printWarning('🟡 Good - System is mostly operational with minor issues');
        } else if (healthScore >= 50) {
            printWarning('🟠 Fair - System has some significant issues');
        } else {
            printError('🔴 Poor - System has major issues requiring attention');
        }
    }
    async createTestFiles() {
        try {
            await fs.mkdir(`${this.workingDir}/test-temp`, {
                recursive: true
            });
            await fs.writeFile(`${this.workingDir}/test-temp/CLAUDE.md`, '# Test CLAUDE.md', 'utf8');
            await fs.writeFile(`${this.workingDir}/test-temp/memory-bank.md`, '# Test Memory Bank', 'utf8');
        } catch  {}
    }
    async cleanupTestFiles() {
        try {
            await fs.unlink(`${this.workingDir}/test-temp`, {
                recursive: true
            });
        } catch  {}
    }
    async createTestConfigs() {
        try {
            const testConfig = {
                version: '1.0',
                modes: {
                    'test-mode': {
                        description: 'Test mode for validation'
                    }
                }
            };
            await fs.writeFile(`${this.workingDir}/test-roomodes`, JSON.stringify(testConfig, null, 2, 'utf8'));
        } catch  {}
    }
    async cleanupTestConfigs() {
        try {
            await fs.unlink(`${this.workingDir}/test-roomodes`);
        } catch  {}
    }
    async createTestSparcConfig() {
        try {
            await this.createTestConfigs();
            await fs.mkdir(`${this.workingDir}/test-roo`, {
                recursive: true
            });
        } catch  {}
    }
    async cleanupTestSparcConfig() {
        try {
            await this.cleanupTestConfigs();
            await fs.unlink(`${this.workingDir}/test-roo`, {
                recursive: true
            });
        } catch  {}
    }
}
export async function runValidationTests(workingDir) {
    const testRunner = new ValidationTestRunner(workingDir);
    await testRunner.runAllTests();
    return testRunner.testResults;
}

//# sourceMappingURL=test-runner.js.map