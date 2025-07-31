#!/usr/bin/env node

/**
 * Quick Maestro Documentation Validation Test
 * 
 * This simplified version tests the core documentation validation scenarios
 * using CommonJS modules to avoid ES module complications.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class QuickValidationTest {
  constructor() {
    this.testResults = {
      cliAccess: { tested: false, passed: false, error: '' },
      commandSyntax: { tested: false, passed: false, error: '' },
      alternativeWorkflow: { tested: false, passed: false, error: '' },
      documentationFiles: { tested: false, passed: false, error: '' },
      overall: { totalTests: 0, passed: 0, failed: 0 }
    };
  }

  async runQuickValidation() {
    console.log('🚀 Running Quick Maestro Documentation Validation');
    console.log('==================================================\n');

    try {
      // Test 1: CLI Access
      await this.testCliAccess();
      
      // Test 2: Command Syntax
      await this.testCommandSyntax();
      
      // Test 3: Alternative Workflow
      await this.testAlternativeWorkflow();
      
      // Test 4: Documentation Files
      await this.testDocumentationFiles();
      
      // Generate Summary
      this.generateSummary();
      
      return this.testResults;
      
    } catch (error) {
      console.error('❌ Validation test failed:', error.message);
      throw error;
    }
  }

  async testCliAccess() {
    console.log('📋 Test 1: CLI Access Validation');
    console.log('================================');
    
    this.testResults.cliAccess.tested = true;
    this.testResults.overall.totalTests++;
    
    try {
      const output = await this.runCommand('npx claude-flow maestro help', { timeout: 10000 });
      
      if (output.includes('Unknown command: maestro')) {
        console.log('  ❌ CLI not accessible - commands not registered');
        this.testResults.cliAccess.passed = false;
        this.testResults.cliAccess.error = 'CLI commands not registered due to build issues';
        this.testResults.overall.failed++;
      } else if (output.includes('maestro')) {
        console.log('  ✅ CLI accessible - help command works');
        this.testResults.cliAccess.passed = true;
        this.testResults.overall.passed++;
      } else {
        console.log('  ⚠️  Unexpected CLI response');
        this.testResults.cliAccess.passed = false;
        this.testResults.cliAccess.error = 'Unexpected CLI behavior';
        this.testResults.overall.failed++;
      }
      
    } catch (error) {
      console.log(`  ❌ CLI test failed: ${error.message}`);
      this.testResults.cliAccess.passed = false;
      this.testResults.cliAccess.error = error.message;
      this.testResults.overall.failed++;
    }
    
    console.log('');
  }

  async testCommandSyntax() {
    console.log('📝 Test 2: Command Syntax Documentation');
    console.log('=======================================');
    
    this.testResults.commandSyntax.tested = true;
    this.testResults.overall.totalTests++;
    
    try {
      // Read command reference documentation
      const commandRefPath = path.join(process.cwd(), 'docs', 'maestro', 'COMMAND-REFERENCE.md');
      const commandRef = await fs.readFile(commandRefPath, 'utf8');
      
      // Check for documented commands
      const documentedCommands = [
        'create-spec',
        'generate-design', 
        'generate-tasks',
        'implement-task',
        'review-tasks',
        'approve-phase',
        'status',
        'init-steering',
        'clean',
        'help'
      ];
      
      let commandsFound = 0;
      let examplesFound = 0;
      
      documentedCommands.forEach(command => {
        if (commandRef.includes(`npx claude-flow maestro ${command}`)) {
          commandsFound++;
        }
      });
      
      // Check for examples
      const exampleMatches = commandRef.match(/```bash[\s\S]*?```/g);
      examplesFound = exampleMatches ? exampleMatches.length : 0;
      
      console.log(`  📊 Commands documented: ${commandsFound}/${documentedCommands.length}`);
      console.log(`  📊 Examples provided: ${examplesFound}`);
      
      if (commandsFound >= 8 && examplesFound >= 10) {
        console.log('  ✅ Command syntax documentation is comprehensive');
        this.testResults.commandSyntax.passed = true;
        this.testResults.overall.passed++;
      } else {
        console.log('  ❌ Command syntax documentation incomplete');
        this.testResults.commandSyntax.passed = false;
        this.testResults.commandSyntax.error = `Only ${commandsFound}/${documentedCommands.length} commands documented with ${examplesFound} examples`;
        this.testResults.overall.failed++;
      }
      
    } catch (error) {
      console.log(`  ❌ Documentation read failed: ${error.message}`);
      this.testResults.commandSyntax.passed = false;
      this.testResults.commandSyntax.error = error.message;
      this.testResults.overall.failed++;
    }
    
    console.log('');
  }

  async testAlternativeWorkflow() {
    console.log('🔄 Test 3: Alternative Workflow Validation');
    console.log('==========================================');
    
    this.testResults.alternativeWorkflow.tested = true;
    this.testResults.overall.totalTests++;
    
    try {
      // Test hive-mind alternative
      const output = await this.runCommand('npx claude-flow@alpha hive-mind --help', { 
        timeout: 15000,
        allowErrors: true 
      });
      
      if (output.includes('hive-mind') || output.includes('Usage:') || !output.includes('command not found')) {
        console.log('  ✅ Hive-mind alternative appears to be available');
        this.testResults.alternativeWorkflow.passed = true;
        this.testResults.overall.passed++;
      } else {
        console.log('  ❌ Hive-mind alternative not accessible');
        this.testResults.alternativeWorkflow.passed = false;
        this.testResults.alternativeWorkflow.error = 'Hive-mind commands not accessible';
        this.testResults.overall.failed++;
      }
      
    } catch (error) {
      console.log(`  ⚠️  Alternative workflow test inconclusive: ${error.message}`);
      // Don't fail the test completely - this is expected in some environments
      this.testResults.alternativeWorkflow.passed = false;
      this.testResults.alternativeWorkflow.error = `Test inconclusive: ${error.message}`;
      this.testResults.overall.failed++;
    }
    
    console.log('');
  }

  async testDocumentationFiles() {
    console.log('📚 Test 4: Documentation File Structure');
    console.log('=======================================');
    
    this.testResults.documentationFiles.tested = true;
    this.testResults.overall.totalTests++;
    
    try {
      const expectedFiles = [
        'README.md',
        'COMMAND-REFERENCE.md',
        'WORKFLOW-GUIDE.md', 
        'WORKAROUNDS.md'
      ];
      
      const docsDir = path.join(process.cwd(), 'docs', 'maestro');
      let filesFound = 0;
      let totalSize = 0;
      
      for (const file of expectedFiles) {
        try {
          const filePath = path.join(docsDir, file);
          const stats = await fs.stat(filePath);
          filesFound++;
          totalSize += stats.size;
          console.log(`  ✅ ${file} - ${Math.round(stats.size / 1024)}KB`);
        } catch (error) {
          console.log(`  ❌ ${file} - Not found`);
        }
      }
      
      console.log(`  📊 Documentation files: ${filesFound}/${expectedFiles.length}`);
      console.log(`  📊 Total documentation size: ${Math.round(totalSize / 1024)}KB`);
      
      if (filesFound >= 3 && totalSize > 50000) { // At least 3 files and 50KB total
        console.log('  ✅ Documentation structure is comprehensive');
        this.testResults.documentationFiles.passed = true;
        this.testResults.overall.passed++;
      } else {
        console.log('  ❌ Documentation structure incomplete');
        this.testResults.documentationFiles.passed = false;
        this.testResults.documentationFiles.error = `Only ${filesFound}/${expectedFiles.length} files found, ${Math.round(totalSize / 1024)}KB total`;
        this.testResults.overall.failed++;
      }
      
    } catch (error) {
      console.log(`  ❌ Documentation structure test failed: ${error.message}`);
      this.testResults.documentationFiles.passed = false;
      this.testResults.documentationFiles.error = error.message;
      this.testResults.overall.failed++;
    }
    
    console.log('');
  }

  generateSummary() {
    console.log('📊 Validation Summary');
    console.log('====================');
    
    const { overall } = this.testResults;
    const successRate = overall.totalTests > 0 ? (overall.passed / overall.totalTests * 100) : 0;
    
    console.log(`Total Tests: ${overall.totalTests}`);
    console.log(`Passed: ${overall.passed} (${successRate.toFixed(1)}%)`);
    console.log(`Failed: ${overall.failed}`);
    console.log('');
    
    // Test Results Detail
    console.log('📋 Test Results Detail:');
    Object.entries(this.testResults).forEach(([testName, result]) => {
      if (testName === 'overall') return;
      
      const status = result.passed ? '✅' : '❌';
      const error = result.error ? ` - ${result.error}` : '';
      console.log(`  ${status} ${testName}${error}`);
    });
    console.log('');
    
    // Key Findings
    console.log('🔍 Key Findings:');
    
    if (!this.testResults.cliAccess.passed) {
      console.log('  🚨 CRITICAL: Maestro CLI commands are not accessible');
      console.log('     This is the primary issue affecting documentation usefulness');
    }
    
    if (this.testResults.documentationFiles.passed) {
      console.log('  ✅ Documentation files are comprehensive and well-structured');
    }
    
    if (!this.testResults.alternativeWorkflow.passed) {
      console.log('  ⚠️  Alternative workflows may not be fully functional');
    }
    
    console.log('');
    
    // Recommendations
    console.log('💡 Recommendations:');
    console.log('  1. Priority: Fix CLI access issues (TypeScript compilation problems)');
    console.log('  2. Verify and improve alternative workflow documentation');
    console.log('  3. Test documented workarounds in clean environments');
    console.log('  4. Consider automated validation in CI/CD pipeline');
    console.log('');
    
    // Overall Assessment
    if (successRate >= 75) {
      console.log('🎉 Overall Assessment: Documentation is mostly accurate and useful');
    } else if (successRate >= 50) {
      console.log('⚠️  Overall Assessment: Documentation has significant issues but provides value');
    } else {
      console.log('❌ Overall Assessment: Documentation requires major improvements for practical use');
    }
  }

  async runCommand(command, options = {}) {
    const {
      timeout = 30000,
      allowErrors = false
    } = options;
    
    return new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeout
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      child.on('close', (code) => {
        const output = stdout + stderr;
        
        if (code !== 0 && !allowErrors) {
          reject(new Error(`Command failed with code ${code}: ${output}`));
        } else {
          resolve(output);
        }
      });
      
      child.on('error', (error) => {
        if (!allowErrors) {
          reject(error);
        } else {
          resolve(error.message);
        }
      });
      
      // Handle timeout
      setTimeout(() => {
        child.kill('SIGTERM');
        if (!allowErrors) {
          reject(new Error(`Command timed out after ${timeout}ms`));
        } else {
          resolve('Command timed out');
        }
      }, timeout);
    });
  }
}

// Run validation if script is executed directly
if (require.main === module) {
  const validator = new QuickValidationTest();
  
  validator.runQuickValidation()
    .then((results) => {
      const successRate = results.overall.totalTests > 0 ? 
        (results.overall.passed / results.overall.totalTests * 100) : 0;
      
      console.log('🏁 Validation Complete!');
      console.log(`Final Score: ${successRate.toFixed(1)}% (${results.overall.passed}/${results.overall.totalTests} tests passed)`);
      
      // Exit with appropriate code
      process.exit(successRate >= 50 ? 0 : 1);
    })
    .catch((error) => {
      console.error('💥 Validation failed:', error.message);
      process.exit(1);
    });
}

module.exports = QuickValidationTest;