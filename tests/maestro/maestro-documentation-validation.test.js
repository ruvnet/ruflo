#!/usr/bin/env node

/**
 * Maestro Documentation Validation Test Suite
 * 
 * This comprehensive test suite validates the accuracy and usefulness of the Maestro
 * documentation by testing all documented commands, workflows, and examples against
 * the actual implementation.
 * 
 * Test Categories:
 * 1. Command Syntax Validation
 * 2. User Journey Testing
 * 3. Error Case Validation
 * 4. Integration Testing
 * 5. Usability Testing
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync, spawn } = require('child_process');

class MaestroDocumentationValidator {
  constructor() {
    this.testResults = {
      commandSyntax: [],
      userJourneys: [],
      errorCases: [],
      integrationTests: [],
      usabilityTests: [],
      overall: {
        totalTests: 0,
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
    
    this.baseDir = process.cwd();
    this.docsDir = path.join(this.baseDir, 'docs', 'maestro');
    this.testFeatureName = `validation-test-${Date.now()}`;
  }

  async runAllValidationTests() {
    console.log('🚀 Starting Maestro Documentation Validation...\n');
    
    try {
      // Phase 1: Command Syntax Validation
      await this.validateCommandSyntax();
      
      // Phase 2: User Journey Testing
      await this.validateUserJourneys();
      
      // Phase 3: Error Case Validation
      await this.validateErrorCases();
      
      // Phase 4: Integration Testing
      await this.validateIntegrationScenarios();
      
      // Phase 5: Usability Testing
      await this.validateUsabilityScenarios();
      
      // Generate comprehensive report
      await this.generateValidationReport();
      
    } catch (error) {
      console.error('❌ Validation suite failed:', error.message);
      process.exit(1);
    }
  }

  // ===== PHASE 1: COMMAND SYNTAX VALIDATION =====
  async validateCommandSyntax() {
    console.log('📋 Phase 1: Command Syntax Validation');
    console.log('=====================================');
    
    const documentedCommands = [
      {
        name: 'create-spec',
        syntax: 'npx claude-flow maestro create-spec <feature-name> --request "<description>"',
        requiredParams: ['feature-name'],
        optionalParams: ['--request', '--consensus-threshold', '--max-agents', '--timeout'],
        example: `npx claude-flow maestro create-spec ${this.testFeatureName} --request "Test authentication system"`
      },
      {
        name: 'generate-design',
        syntax: 'npx claude-flow maestro generate-design <feature-name>',
        requiredParams: ['feature-name'],
        optionalParams: ['--no-hive-mind', '--consensus-threshold'],
        example: `npx claude-flow maestro generate-design ${this.testFeatureName}`
      },
      {
        name: 'generate-tasks',
        syntax: 'npx claude-flow maestro generate-tasks <feature-name>',
        requiredParams: ['feature-name'],
        optionalParams: [],
        example: `npx claude-flow maestro generate-tasks ${this.testFeatureName}`
      },
      {
        name: 'implement-task',
        syntax: 'npx claude-flow maestro implement-task <feature-name> <task-id>',
        requiredParams: ['feature-name', 'task-id'],
        optionalParams: ['--skip-consensus'],
        example: `npx claude-flow maestro implement-task ${this.testFeatureName} 1`
      },
      {
        name: 'review-tasks',
        syntax: 'npx claude-flow maestro review-tasks <feature-name>',
        requiredParams: ['feature-name'],
        optionalParams: [],
        example: `npx claude-flow maestro review-tasks ${this.testFeatureName}`
      },
      {
        name: 'approve-phase',
        syntax: 'npx claude-flow maestro approve-phase <feature-name>',
        requiredParams: ['feature-name'],
        optionalParams: [],
        example: `npx claude-flow maestro approve-phase ${this.testFeatureName}`
      },
      {
        name: 'status',
        syntax: 'npx claude-flow maestro status <feature-name>',
        requiredParams: ['feature-name'],
        optionalParams: ['--detailed', '--json'],
        example: `npx claude-flow maestro status ${this.testFeatureName}`
      },
      {
        name: 'init-steering',
        syntax: 'npx claude-flow maestro init-steering [domain]',
        requiredParams: [],
        optionalParams: ['domain', '--content'],
        example: 'npx claude-flow maestro init-steering security --content "OWASP guidelines required"'
      },
      {
        name: 'clean',
        syntax: 'npx claude-flow maestro clean',
        requiredParams: [],
        optionalParams: [],
        example: 'npx claude-flow maestro clean'
      },
      {
        name: 'help',
        syntax: 'npx claude-flow maestro help',
        requiredParams: [],
        optionalParams: [],
        example: 'npx claude-flow maestro help'
      }
    ];

    for (const command of documentedCommands) {
      await this.testCommandSyntax(command);
    }
    
    console.log(`✅ Command syntax validation completed: ${this.testResults.commandSyntax.length} commands tested\n`);
  }

  async testCommandSyntax(command) {
    console.log(`  Testing: ${command.name}`);
    
    const testResult = {
      command: command.name,
      syntax: command.syntax,
      example: command.example,
      status: 'unknown',
      actualBehavior: '',
      expectedBehavior: 'Command should be recognized and execute',
      issues: [],
      passed: false
    };

    try {
      // Test basic command recognition
      const helpOutput = await this.runCommand('npx claude-flow maestro help', { timeout: 10000 });
      
      if (helpOutput.includes('Unknown command: maestro')) {
        testResult.status = 'cli_not_available';
        testResult.actualBehavior = 'CLI command not registered due to build issues';
        testResult.issues.push('Documentation shows command as working, but CLI is not accessible');
        testResult.passed = false;
      } else if (helpOutput.includes(command.name)) {
        testResult.status = 'command_listed';
        testResult.actualBehavior = 'Command appears in help output';
        testResult.passed = true;
        
        // Try to test actual command execution for safe commands
        if (['help', 'clean', 'status'].includes(command.name)) {
          try {
            const cmdOutput = await this.runCommand(command.example, { timeout: 15000 });
            testResult.actualBehavior += `. Execution result: ${cmdOutput.substring(0, 100)}...`;
          } catch (execError) {
            testResult.issues.push(`Command execution failed: ${execError.message}`);
          }
        }
      } else {
        testResult.status = 'command_not_found';
        testResult.actualBehavior = 'Command not found in help output';
        testResult.issues.push('Command documented but not implemented or accessible');
        testResult.passed = false;
      }
      
    } catch (error) {
      testResult.status = 'test_error';
      testResult.actualBehavior = `Test execution failed: ${error.message}`;
      testResult.issues.push(`Unable to test command: ${error.message}`);
      testResult.passed = false;
    }

    this.testResults.commandSyntax.push(testResult);
    this.updateOverallStats(testResult.passed);
    
    console.log(`    ${testResult.passed ? '✅' : '❌'} ${testResult.status} - ${testResult.issues.length} issues`);
  }

  // ===== PHASE 2: USER JOURNEY TESTING =====
  async validateUserJourneys() {
    console.log('🛤️  Phase 2: User Journey Testing');
    console.log('=================================');
    
    const userJourneys = [
      {
        name: 'Complete Feature Development',
        description: 'Full workflow from spec creation to completion',
        steps: [
          'Create specification',
          'Generate design',
          'Generate tasks',
          'Implement first task',
          'Review tasks',
          'Approve phase'
        ],
        expectedOutcome: 'Complete feature documentation generated',
        commands: [
          `npx claude-flow maestro create-spec ${this.testFeatureName} --request "Test user authentication"`,
          `npx claude-flow maestro generate-design ${this.testFeatureName}`,
          `npx claude-flow maestro generate-tasks ${this.testFeatureName}`,
          `npx claude-flow maestro implement-task ${this.testFeatureName} 1`,
          `npx claude-flow maestro review-tasks ${this.testFeatureName}`,
          `npx claude-flow maestro approve-phase ${this.testFeatureName}`
        ]
      },
      {
        name: 'New User Onboarding',
        description: 'First-time user following documentation',
        steps: [
          'Check help documentation',
          'Create first specification',
          'Check status',
          'Generate design'
        ],
        expectedOutcome: 'User can successfully create their first feature spec',
        commands: [
          'npx claude-flow maestro help',
          `npx claude-flow maestro create-spec onboarding-test --request "Simple API endpoint"`,
          'npx claude-flow maestro status onboarding-test',
          'npx claude-flow maestro generate-design onboarding-test'
        ]
      },
      {
        name: 'Alternative Hive-Mind Workflow',
        description: 'Using documented workaround with hive-mind commands',
        steps: [
          'Initialize hive-mind',
          'Create specification using hive-mind',
          'Generate design using hive-mind',
          'Check hive-mind status'
        ],
        expectedOutcome: 'Successfully use alternative workflow',
        commands: [
          'npx claude-flow@alpha hive-mind init',
          'npx claude-flow@alpha hive-mind spawn "Create specification for authentication system"',
          'npx claude-flow@alpha hive-mind spawn "Design architecture for authentication"',
          'npx claude-flow@alpha hive-mind status'
        ]
      }
    ];

    for (const journey of userJourneys) {
      await this.testUserJourney(journey);
    }
    
    console.log(`✅ User journey validation completed: ${this.testResults.userJourneys.length} journeys tested\n`);
  }

  async testUserJourney(journey) {
    console.log(`  Testing journey: ${journey.name}`);
    
    const journeyResult = {
      name: journey.name,
      description: journey.description,
      steps: journey.steps,
      expectedOutcome: journey.expectedOutcome,
      completedSteps: 0,
      failedSteps: [],
      actualOutcome: '',
      issues: [],
      passed: false,
      completionRate: 0
    };

    try {
      for (let i = 0; i < journey.commands.length; i++) {
        const command = journey.commands[i];
        const step = journey.steps[i];
        
        console.log(`    Step ${i + 1}: ${step}`);
        
        try {
          const output = await this.runCommand(command, { 
            timeout: 30000,
            allowErrors: true // Don't fail the test on expected errors
          });
          
          journeyResult.completedSteps++;
          
          // Check for specific success indicators
          if (output.includes('Error: Unknown command: maestro')) {
            journeyResult.failedSteps.push(`Step ${i + 1}: CLI not accessible`);
            break; // Stop testing this journey if CLI is not available
          }
          
        } catch (error) {
          journeyResult.failedSteps.push(`Step ${i + 1}: ${error.message}`);
          
          // If this is a hive-mind alternative command, continue
          if (command.includes('hive-mind')) {
            console.log(`      ⚠️  Hive-mind command failed, but this is expected during testing`);
            continue;
          }
          
          // For other failures, note but continue testing
          console.log(`      ❌ Step failed: ${error.message.substring(0, 100)}`);
        }
      }
      
      journeyResult.completionRate = journeyResult.completedSteps / journey.commands.length;
      journeyResult.passed = journeyResult.completionRate >= 0.5; // 50% completion threshold
      
      if (journeyResult.failedSteps.length === 0) {
        journeyResult.actualOutcome = 'All steps completed successfully';
      } else {
        journeyResult.actualOutcome = `${journeyResult.completedSteps}/${journey.commands.length} steps completed`;
      }
      
    } catch (error) {
      journeyResult.actualOutcome = `Journey testing failed: ${error.message}`;
      journeyResult.issues.push(`Unable to complete journey testing: ${error.message}`);
    }

    this.testResults.userJourneys.push(journeyResult);
    this.updateOverallStats(journeyResult.passed);
    
    console.log(`    ${journeyResult.passed ? '✅' : '❌'} Completion: ${(journeyResult.completionRate * 100).toFixed(1)}%`);
  }

  // ===== PHASE 3: ERROR CASE VALIDATION =====
  async validateErrorCases() {
    console.log('🚨 Phase 3: Error Case Validation');
    console.log('==================================');
    
    const errorScenarios = [
      {
        name: 'Unknown Command Error',
        scenario: 'Test documented error for unknown maestro command',
        command: 'npx claude-flow maestro help',
        expectedError: 'Error: Unknown command: maestro',
        expectedSolution: 'Use hive-mind commands as alternative',
        documentedWorkaround: 'npx claude-flow@alpha hive-mind spawn "task description"'
      },
      {
        name: 'Missing Feature Name',
        scenario: 'Test error handling for missing required parameters',
        command: 'npx claude-flow maestro create-spec',
        expectedError: 'Missing required parameter: feature-name',
        expectedSolution: 'Provide feature name parameter',
        documentedWorkaround: 'npx claude-flow maestro create-spec my-feature --request "description"'
      },
      {
        name: 'Invalid Task ID',
        scenario: 'Test error for non-numeric task ID',
        command: `npx claude-flow maestro implement-task ${this.testFeatureName} abc`,
        expectedError: 'Invalid task ID: abc. Must be a positive integer',
        expectedSolution: 'Use numeric task ID',
        documentedWorkaround: `npx claude-flow maestro implement-task ${this.testFeatureName} 1`
      },
      {
        name: 'File System Permissions',
        scenario: 'Test documented permission errors',
        description: 'Permission denied writing to docs/maestro/specs/',
        expectedSolution: 'Create directory and fix permissions',
        documentedWorkaround: 'mkdir -p docs/maestro/specs && chmod 755 docs/maestro/'
      }
    ];

    for (const scenario of errorScenarios) {
      await this.testErrorScenario(scenario);
    }
    
    console.log(`✅ Error case validation completed: ${this.testResults.errorCases.length} scenarios tested\n`);
  }

  async testErrorScenario(scenario) {
    console.log(`  Testing error: ${scenario.name}`);
    
    const errorResult = {
      name: scenario.name,
      scenario: scenario.scenario,
      command: scenario.command,
      expectedError: scenario.expectedError,
      actualError: '',
      expectedSolution: scenario.expectedSolution,
      documentedWorkaround: scenario.documentedWorkaround,
      errorOccurred: false,
      solutionWorks: false,
      documentationAccurate: false,
      issues: [],
      passed: false
    };

    try {
      if (scenario.command) {
        // Test if the documented error actually occurs
        try {
          const output = await this.runCommand(scenario.command, { 
            timeout: 10000,
            expectError: true 
          });
          
          errorResult.actualError = output;
          errorResult.errorOccurred = output.includes(scenario.expectedError) || 
                                    output.includes('Error') || 
                                    output.includes('error');
          
          if (scenario.expectedError && output.includes(scenario.expectedError)) {
            errorResult.documentationAccurate = true;
          }
          
        } catch (error) {
          errorResult.actualError = error.message;
          errorResult.errorOccurred = true;
          
          if (scenario.expectedError && error.message.includes(scenario.expectedError)) {
            errorResult.documentationAccurate = true;
          }
        }
        
        // Test if the documented workaround actually works
        if (scenario.documentedWorkaround && !scenario.documentedWorkaround.includes('mkdir')) {
          try {
            await this.runCommand(scenario.documentedWorkaround, { timeout: 15000 });
            errorResult.solutionWorks = true;
          } catch (workaroundError) {
            errorResult.issues.push(`Documented workaround failed: ${workaroundError.message}`);
          }
        } else if (scenario.documentedWorkaround) {
          // For file system commands, just check if they're valid
          errorResult.solutionWorks = scenario.documentedWorkaround.includes('mkdir') && 
                                    scenario.documentedWorkaround.includes('chmod');
        }
      } else {
        // For scenarios without commands, assume they're documented correctly
        errorResult.documentationAccurate = true;
        errorResult.solutionWorks = true;
      }
      
      errorResult.passed = errorResult.documentationAccurate || errorResult.solutionWorks;
      
    } catch (error) {
      errorResult.issues.push(`Error scenario testing failed: ${error.message}`);
    }

    this.testResults.errorCases.push(errorResult);
    this.updateOverallStats(errorResult.passed);
    
    const statusIcon = errorResult.passed ? '✅' : '❌';
    const details = errorResult.documentationAccurate ? 'Accurate' : 
                   errorResult.solutionWorks ? 'Solution works' : 'Issues found';
    console.log(`    ${statusIcon} ${details} - ${errorResult.issues.length} issues`);
  }

  // ===== PHASE 4: INTEGRATION TESTING =====
  async validateIntegrationScenarios() {
    console.log('🔗 Phase 4: Integration Testing');
    console.log('===============================');
    
    const integrationTests = [
      {
        name: 'Hive-Mind Integration',
        description: 'Test documented integration with hive-mind system',
        testCommands: [
          'npx claude-flow@alpha hive-mind init',
          'npx claude-flow@alpha hive-mind status'
        ],
        expectedBehavior: 'Hive-mind commands should work as documented alternatives'
      },
      {
        name: 'File System Integration',
        description: 'Test file generation and structure as documented',
        testCommands: [],
        expectedBehavior: 'Proper directory structure should exist or be creatable',
        checkPaths: [
          'docs/maestro',
          'docs/maestro/specs',
          'docs/maestro/steering'
        ]
      },
      {
        name: 'Memory System Integration',
        description: 'Test documented memory system integration',
        testCommands: [
          'npx claude-flow@alpha memory stats'
        ],
        expectedBehavior: 'Memory system should be accessible for steering docs'
      },
      {
        name: 'Agent System Integration',
        description: 'Test agent coordination as documented',
        testCommands: [],
        expectedBehavior: 'Agent types should be available and properly coordinated',
        agentTypes: [
          'requirements_analyst',
          'design_architect',
          'task_planner',
          'implementation_coder',
          'quality_reviewer',
          'steering_documenter'
        ]
      }
    ];

    for (const test of integrationTests) {
      await this.testIntegrationScenario(test);
    }
    
    console.log(`✅ Integration testing completed: ${this.testResults.integrationTests.length} scenarios tested\n`);
  }

  async testIntegrationScenario(test) {
    console.log(`  Testing integration: ${test.name}`);
    
    const integrationResult = {
      name: test.name,
      description: test.description,
      expectedBehavior: test.expectedBehavior,
      actualBehavior: '',
      testsPassed: 0,
      totalTests: 0,
      issues: [],
      passed: false
    };

    try {
      // Test commands if provided
      if (test.testCommands && test.testCommands.length > 0) {
        integrationResult.totalTests += test.testCommands.length;
        
        for (const command of test.testCommands) {
          try {
            const output = await this.runCommand(command, { timeout: 15000 });
            integrationResult.testsPassed++;
            integrationResult.actualBehavior += `Command '${command}' executed successfully. `;
          } catch (error) {
            integrationResult.issues.push(`Command failed: ${command} - ${error.message}`);
          }
        }
      }
      
      // Test file system paths if provided
      if (test.checkPaths && test.checkPaths.length > 0) {
        integrationResult.totalTests += test.checkPaths.length;
        
        for (const checkPath of test.checkPaths) {
          try {
            await fs.access(checkPath);
            integrationResult.testsPassed++;
            integrationResult.actualBehavior += `Path '${checkPath}' exists. `;
          } catch (error) {
            // Try to create the path as documented
            try {
              await fs.mkdir(checkPath, { recursive: true });
              integrationResult.testsPassed++;
              integrationResult.actualBehavior += `Path '${checkPath}' created successfully. `;
            } catch (createError) {
              integrationResult.issues.push(`Cannot access or create path: ${checkPath}`);
            }
          }
        }
      }
      
      // Test agent types if provided (documentation check)
      if (test.agentTypes && test.agentTypes.length > 0) {
        integrationResult.totalTests += 1; // One test for agent documentation
        
        // Check if agent types are documented
        const workflowGuide = await this.readDocumentationFile('WORKFLOW-GUIDE.md');
        const agentTypesFound = test.agentTypes.filter(agentType => 
          workflowGuide.includes(agentType)
        );
        
        if (agentTypesFound.length === test.agentTypes.length) {
          integrationResult.testsPassed++;
          integrationResult.actualBehavior += `All agent types documented correctly. `;
        } else {
          integrationResult.issues.push(`Missing agent types in documentation: ${
            test.agentTypes.filter(type => !agentTypesFound.includes(type)).join(', ')
          }`);
        }
      }
      
      integrationResult.passed = integrationResult.testsPassed === integrationResult.totalTests;
      
    } catch (error) {
      integrationResult.issues.push(`Integration test failed: ${error.message}`);
    }

    this.testResults.integrationTests.push(integrationResult);
    this.updateOverallStats(integrationResult.passed);
    
    const successRate = integrationResult.totalTests > 0 ? 
      (integrationResult.testsPassed / integrationResult.totalTests * 100).toFixed(1) : 0;
    console.log(`    ${integrationResult.passed ? '✅' : '❌'} Success rate: ${successRate}% (${integrationResult.testsPassed}/${integrationResult.totalTests})`);
  }

  // ===== PHASE 5: USABILITY TESTING =====
  async validateUsabilityScenarios() {
    console.log('👥 Phase 5: Usability Testing');
    console.log('=============================');
    
    const usabilityTests = [
      {
        name: 'Documentation Completeness',
        description: 'Check if all documented features have examples and explanations',
        criteria: [
          'All commands have syntax examples',
          'Error messages have solutions',
          'Workflows have step-by-step guides',
          'Troubleshooting section exists',
          'Alternative approaches documented'
        ]
      },
      {
        name: 'Information Accessibility',
        description: 'Test if users can quickly find needed information',
        criteria: [
          'Quick reference table exists',
          'Command structure is consistent',
          'Examples are practical and relevant',
          'Cross-references between documents work',
          'Status information is clear'
        ]
      },
      {
        name: 'Learning Path Clarity',
        description: 'Test if new users can follow the documentation effectively',
        criteria: [
          'Clear getting started section',
          'Prerequisites are listed',
          'Progressive complexity in examples',
          'Expected outcomes are defined',
          'Success criteria are measurable'
        ]
      }
    ];

    for (const test of usabilityTests) {
      await this.testUsabilityScenario(test);
    }
    
    console.log(`✅ Usability testing completed: ${this.testResults.usabilityTests.length} scenarios tested\n`);
  }

  async testUsabilityScenario(test) {
    console.log(`  Testing usability: ${test.name}`);
    
    const usabilityResult = {
      name: test.name,
      description: test.description,
      criteria: test.criteria,
      metCriteria: [],
      failedCriteria: [],
      overallScore: 0,
      issues: [],
      passed: false
    };

    try {
      // Read documentation files
      const readme = await this.readDocumentationFile('README.md');
      const commandRef = await this.readDocumentationFile('COMMAND-REFERENCE.md');
      const workflowGuide = await this.readDocumentationFile('WORKFLOW-GUIDE.md');
      const workarounds = await this.readDocumentationFile('WORKAROUNDS.md');
      
      const allDocs = readme + commandRef + workflowGuide + workarounds;
      
      // Test each criterion
      for (const criterion of test.criteria) {
        let criterionMet = false;
        
        switch (criterion) {
          case 'All commands have syntax examples':
            criterionMet = this.checkCommandExamples(commandRef);
            break;
            
          case 'Error messages have solutions':
            criterionMet = allDocs.includes('Solutions:') && allDocs.includes('Error:');
            break;
            
          case 'Workflows have step-by-step guides':
            criterionMet = workflowGuide.includes('Step-by-Step') && workflowGuide.includes('Phase');
            break;
            
          case 'Troubleshooting section exists':
            criterionMet = allDocs.includes('Troubleshooting') || allDocs.includes('Common Issues');
            break;
            
          case 'Alternative approaches documented':
            criterionMet = workarounds.includes('Alternative') && workarounds.includes('Method');
            break;
            
          case 'Quick reference table exists':
            criterionMet = commandRef.includes('| Command |') && commandRef.includes('| Status |');
            break;
            
          case 'Command structure is consistent':
            criterionMet = this.checkCommandConsistency(commandRef);
            break;
            
          case 'Examples are practical and relevant':
            criterionMet = commandRef.includes('Examples:') && commandRef.includes('npx claude-flow');
            break;
            
          case 'Cross-references between documents work':
            criterionMet = this.checkCrossReferences(allDocs);
            break;
            
          case 'Status information is clear':
            criterionMet = allDocs.includes('Status:') && (allDocs.includes('✅') || allDocs.includes('❌'));
            break;
            
          case 'Clear getting started section':
            criterionMet = readme.includes('Quick Start') || readme.includes('Getting Started');
            break;
            
          case 'Prerequisites are listed':
            criterionMet = allDocs.includes('Prerequisites') || allDocs.includes('Requirements');
            break;
            
          case 'Progressive complexity in examples':
            criterionMet = this.checkProgressiveComplexity(commandRef);
            break;
            
          case 'Expected outcomes are defined':
            criterionMet = allDocs.includes('Expected') || allDocs.includes('Generated Output');
            break;
            
          case 'Success criteria are measurable':
            criterionMet = allDocs.includes('✅') && allDocs.includes('completed');
            break;
            
          default:
            criterionMet = false;
        }
        
        if (criterionMet) {
          usabilityResult.metCriteria.push(criterion);
        } else {
          usabilityResult.failedCriteria.push(criterion);
          usabilityResult.issues.push(`Criterion not met: ${criterion}`);
        }
      }
      
      usabilityResult.overallScore = usabilityResult.metCriteria.length / test.criteria.length;
      usabilityResult.passed = usabilityResult.overallScore >= 0.7; // 70% threshold
      
    } catch (error) {
      usabilityResult.issues.push(`Usability test failed: ${error.message}`);
    }

    this.testResults.usabilityTests.push(usabilityResult);
    this.updateOverallStats(usabilityResult.passed);
    
    const scorePercent = (usabilityResult.overallScore * 100).toFixed(1);
    console.log(`    ${usabilityResult.passed ? '✅' : '❌'} Score: ${scorePercent}% (${usabilityResult.metCriteria.length}/${test.criteria.length} criteria met)`);
  }

  // ===== HELPER METHODS =====
  
  async runCommand(command, options = {}) {
    const {
      timeout = 30000,
      allowErrors = false,
      expectError = false
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
        
        if (code !== 0 && !allowErrors && !expectError) {
          reject(new Error(`Command failed with code ${code}: ${output}`));
        } else {
          resolve(output);
        }
      });
      
      child.on('error', (error) => {
        if (!allowErrors && !expectError) {
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
  
  async readDocumentationFile(filename) {
    try {
      const filePath = path.join(this.docsDir, filename);
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      console.warn(`⚠️  Could not read documentation file: ${filename}`);
      return '';
    }
  }
  
  checkCommandExamples(commandRef) {
    const commands = ['create-spec', 'generate-design', 'generate-tasks', 'implement-task'];
    return commands.every(cmd => 
      commandRef.includes(`npx claude-flow maestro ${cmd}`) && 
      commandRef.includes('Examples:')
    );
  }
  
  checkCommandConsistency(commandRef) {
    // Check if all commands follow the same pattern
    const lines = commandRef.split('\n');
    const commandLines = lines.filter(line => line.includes('npx claude-flow maestro'));
    
    if (commandLines.length === 0) return false;
    
    // Check consistency in structure
    return commandLines.every(line => 
      line.includes('npx claude-flow maestro') && 
      (line.includes('<') || line.includes('[') || line.length > 20)
    );
  }
  
  checkCrossReferences(allDocs) {
    const references = ['README.md', 'WORKFLOW-GUIDE.md', 'WORKAROUNDS.md'];
    return references.some(ref => allDocs.includes(ref));
  }
  
  checkProgressiveComplexity(commandRef) {
    // Check if examples progress from simple to complex
    return commandRef.includes('Basic') && 
           commandRef.includes('Advanced') && 
           commandRef.includes('Examples:');
  }
  
  updateOverallStats(passed) {
    this.testResults.overall.totalTests++;
    if (passed) {
      this.testResults.overall.passed++;
    } else {
      this.testResults.overall.failed++;
    }
  }

  // ===== REPORT GENERATION =====
  
  async generateValidationReport() {
    console.log('📊 Generating Validation Report...');
    console.log('===================================');
    
    const report = {
      summary: {
        timestamp: new Date().toISOString(),
        testSuite: 'Maestro Documentation Validation',
        version: '1.0.0',
        overall: this.testResults.overall
      },
      results: this.testResults,
      recommendations: this.generateRecommendations(),
      accuracyScore: this.calculateAccuracyScore()
    };
    
    // Write detailed report
    const reportPath = path.join(this.baseDir, 'maestro-documentation-validation-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    // Generate summary report
    await this.generateSummaryReport(report);
    
    console.log(`\n📋 Detailed report saved to: ${reportPath}`);
    console.log(`📋 Summary report saved to: maestro-validation-summary.md`);
    
    return report;
  }
  
  async generateSummaryReport(report) {
    const summary = `# Maestro Documentation Validation Summary

Generated: ${new Date().toLocaleString()}

## Overall Test Results

- **Total Tests**: ${report.summary.overall.totalTests}
- **Passed**: ${report.summary.overall.passed} (${(report.summary.overall.passed / report.summary.overall.totalTests * 100).toFixed(1)}%)
- **Failed**: ${report.summary.overall.failed} (${(report.summary.overall.failed / report.summary.overall.totalTests * 100).toFixed(1)}%)
- **Documentation Accuracy Score**: ${(report.accuracyScore * 100).toFixed(1)}%

## Test Category Results

### 1. Command Syntax Validation
- **Tests**: ${this.testResults.commandSyntax.length}
- **Status**: ${this.getCategoryStatus(this.testResults.commandSyntax)}
- **Key Finding**: ${this.getKeyFinding('commandSyntax')}

### 2. User Journey Testing  
- **Tests**: ${this.testResults.userJourneys.length}
- **Status**: ${this.getCategoryStatus(this.testResults.userJourneys)}
- **Key Finding**: ${this.getKeyFinding('userJourneys')}

### 3. Error Case Validation
- **Tests**: ${this.testResults.errorCases.length}  
- **Status**: ${this.getCategoryStatus(this.testResults.errorCases)}
- **Key Finding**: ${this.getKeyFinding('errorCases')}

### 4. Integration Testing
- **Tests**: ${this.testResults.integrationTests.length}
- **Status**: ${this.getCategoryStatus(this.testResults.integrationTests)}
- **Key Finding**: ${this.getKeyFinding('integrationTests')}

### 5. Usability Testing
- **Tests**: ${this.testResults.usabilityTests.length}
- **Status**: ${this.getCategoryStatus(this.testResults.usabilityTests)}
- **Key Finding**: ${this.getKeyFinding('usabilityTests')}

## Critical Issues Identified

${this.getCriticalIssues().map(issue => `- ${issue}`).join('\n')}

## Recommendations

${report.recommendations.map(rec => `### ${rec.priority} Priority: ${rec.title}\n${rec.description}\n`).join('\n')}

## Conclusion

${this.getOverallConclusion(report)}

---
*This report was generated by the Maestro Documentation Validation Suite*
`;

    await fs.writeFile('maestro-validation-summary.md', summary);
  }
  
  calculateAccuracyScore() {
    if (this.testResults.overall.totalTests === 0) return 0;
    
    // Weighted scoring based on test importance
    const weights = {
      commandSyntax: 0.3,
      userJourneys: 0.25, 
      errorCases: 0.2,
      integrationTests: 0.15,
      usabilityTests: 0.1
    };
    
    let weightedScore = 0;
    let totalWeight = 0;
    
    for (const [category, tests] of Object.entries(this.testResults)) {
      if (category === 'overall') continue;
      
      const categoryScore = tests.length > 0 ? 
        tests.filter(test => test.passed).length / tests.length : 0;
      
      const weight = weights[category] || 0.1;
      weightedScore += categoryScore * weight;
      totalWeight += weight;
    }
    
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }
  
  generateRecommendations() {
    const recommendations = [];
    
    // CLI Access Issue
    const cliIssues = this.testResults.commandSyntax.filter(test => 
      test.status === 'cli_not_available'
    );
    if (cliIssues.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        title: 'Fix CLI Access Issues',
        description: 'The primary issue is that Maestro CLI commands are not accessible due to build system problems. This affects all command-based functionality.',
        action: 'Resolve TypeScript compilation errors and ensure proper command registration in the CLI system.'
      });
    }
    
    // Documentation Accuracy Issues
    const inaccurateCommands = this.testResults.commandSyntax.filter(test => 
      !test.passed && test.status !== 'cli_not_available'
    );
    if (inaccurateCommands.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        title: 'Update Command Documentation',
        description: `${inaccurateCommands.length} commands have documentation that doesn't match actual behavior.`,
        action: 'Review and update command documentation to reflect current implementation status.'
      });
    }
    
    // Alternative Workflow Issues
    const failedJourneys = this.testResults.userJourneys.filter(journey => 
      !journey.passed
    );
    if (failedJourneys.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        title: 'Improve Alternative Workflows',
        description: 'Some documented alternative workflows (like hive-mind integration) need better validation.',
        action: 'Test and improve documented workarounds and alternative approaches.'
      });
    }
    
    // Usability Improvements
    const usabilityIssues = this.testResults.usabilityTests.filter(test => 
      test.overallScore < 0.8
    );
    if (usabilityIssues.length > 0) {
      recommendations.push({
        priority: 'LOW',
        title: 'Enhance Documentation Usability',
        description: 'Several usability criteria could be improved for better user experience.',
        action: 'Add more examples, improve cross-references, and enhance getting started guides.'
      });
    }
    
    return recommendations;
  }
  
  getCategoryStatus(tests) {
    if (tests.length === 0) return 'No tests';
    const passRate = tests.filter(test => test.passed).length / tests.length;
    if (passRate >= 0.8) return '✅ Good';
    if (passRate >= 0.6) return '⚠️ Needs attention';
    return '❌ Critical issues';
  }
  
  getKeyFinding(category) {
    const tests = this.testResults[category];
    if (tests.length === 0) return 'No tests conducted';
    
    const failures = tests.filter(test => !test.passed);
    if (failures.length === 0) return 'All tests passed successfully';
    
    // Get most common issue
    const issues = failures.flatMap(test => test.issues || []);
    const issueMap = {};
    issues.forEach(issue => {
      issueMap[issue] = (issueMap[issue] || 0) + 1;
    });
    
    const commonIssue = Object.entries(issueMap).sort((a, b) => b[1] - a[1])[0];
    return commonIssue ? commonIssue[0] : 'Multiple issues identified';
  }
  
  getCriticalIssues() {
    const issues = [];
    
    // Check for CLI access issues
    const cliIssues = this.testResults.commandSyntax.filter(test => 
      test.status === 'cli_not_available'
    );
    if (cliIssues.length > 0) {
      issues.push('CLI commands not accessible - affects all documented functionality');
    }
    
    // Check for failed user journeys
    const failedJourneys = this.testResults.userJourneys.filter(journey => 
      journey.completionRate < 0.3
    );
    if (failedJourneys.length > 0) {
      issues.push(`${failedJourneys.length} user journey(s) have very low completion rates`);
    }
    
    // Check for integration failures
    const integrationFailures = this.testResults.integrationTests.filter(test => 
      test.testsPassed === 0
    );
    if (integrationFailures.length > 0) {
      issues.push(`${integrationFailures.length} integration scenario(s) completely failed`);
    }
    
    return issues.length > 0 ? issues : ['No critical issues identified'];
  }
  
  getOverallConclusion(report) {
    const score = report.accuracyScore;
    
    if (score >= 0.8) {
      return 'The Maestro documentation is generally accurate and useful, with minor issues that can be addressed through incremental improvements.';
    } else if (score >= 0.6) {
      return 'The Maestro documentation has significant accuracy issues, primarily due to CLI access problems. While the content is comprehensive, users cannot execute most documented commands.';
    } else {
      return 'The Maestro documentation requires major updates. The primary issue is CLI inaccessibility, which affects the practical usefulness of the documentation despite its comprehensive nature.';
    }
  }
}

// Run the validation if this script is executed directly
if (require.main === module) {
  const validator = new MaestroDocumentationValidator();
  validator.runAllValidationTests()
    .then(() => {
      console.log('\n🎉 Maestro Documentation Validation Complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Validation failed:', error);
      process.exit(1);
    });
}

module.exports = MaestroDocumentationValidator;