#!/usr/bin/env node

/**
 * User Journey Test Scenarios for Maestro Documentation Validation
 * 
 * This module defines comprehensive user journey scenarios that test
 * real-world usage patterns documented in the Maestro guides.
 */

class UserJourneyScenarios {
  constructor() {
    this.scenarios = this.defineScenarios();
  }

  defineScenarios() {
    return {
      // ===== NEW USER SCENARIOS =====
      newUserOnboarding: {
        name: 'New User Onboarding',
        description: 'First-time user following documentation from scratch',
        userType: 'beginner',
        expectedDuration: '10-15 minutes',
        steps: [
          {
            step: 'Read getting started documentation',
            action: 'User reads README.md and WORKFLOW-GUIDE.md',
            expected: 'User understands basic concepts and workflow',
            testable: true
          },
          {
            step: 'Check prerequisites',
            action: 'User ensures they have required dependencies',
            expected: 'Prerequisites are clearly listed and verifiable',
            testable: true
          },
          {
            step: 'Run help command',
            action: 'npx claude-flow maestro help',
            expected: 'Comprehensive help information displayed',
            testable: true
          },
          {
            step: 'Create first specification',
            action: 'npx claude-flow maestro create-spec my-first-feature --request "Simple user profile API"',
            expected: 'Specification file created with proper structure',
            testable: true
          },
          {
            step: 'Check workflow status',
            action: 'npx claude-flow maestro status my-first-feature',
            expected: 'Clear status information displayed',
            testable: true
          }
        ],
        successCriteria: [
          'User can find getting started information quickly',
          'All prerequisite information is available',
          'Help command provides useful guidance',
          'First specification creation succeeds',
          'Status information is clear and actionable'
        ],
        commonFailurePoints: [
          'CLI commands not available',
          'Prerequisites not clearly stated',
          'Help information overwhelming or unclear',
          'First command fails without clear error message'
        ]
      },

      // ===== COMPLETE WORKFLOW SCENARIOS =====
      completeFeatureDevelopment: {
        name: 'Complete Feature Development Workflow',
        description: 'Full end-to-end workflow from specification to completion',
        userType: 'intermediate',
        expectedDuration: '45-60 minutes',
        steps: [
          {
            step: 'Initialize feature specification',
            action: 'npx claude-flow maestro create-spec user-authentication --request "Implement JWT-based user authentication with rate limiting"',
            expected: 'requirements.md file created with user stories and acceptance criteria',
            testable: true
          },
          {
            step: 'Generate technical design',
            action: 'npx claude-flow maestro generate-design user-authentication',
            expected: 'design.md file created with system architecture and consensus summary',
            testable: true
          },
          {
            step: 'Create implementation tasks',
            action: 'npx claude-flow maestro generate-tasks user-authentication',
            expected: 'tasks.md file created with organized task breakdown and dependencies',
            testable: true
          },
          {
            step: 'Implement foundation tasks',
            action: 'npx claude-flow maestro implement-task user-authentication 1',
            expected: 'First task implemented with generated code',
            testable: true
          },
          {
            step: 'Implement core functionality',
            action: 'npx claude-flow maestro implement-task user-authentication 2',
            expected: 'Second task implemented building on first',
            testable: true
          },
          {
            step: 'Quality assurance review',
            action: 'npx claude-flow maestro review-tasks user-authentication',
            expected: 'Quality review report generated with recommendations',
            testable: true
          },
          {
            step: 'Approve and complete phase',
            action: 'npx claude-flow maestro approve-phase user-authentication',
            expected: 'Phase approved and workflow progressed',
            testable: true
          }
        ],
        successCriteria: [
          'All workflow phases complete successfully',
          'Generated files have proper structure and content',
          'Task dependencies are respected',
          'Quality gates provide meaningful feedback',
          'Final approval progresses workflow state'
        ],
        commonFailurePoints: [
          'CLI commands fail due to access issues',
          'Generated files missing or malformed',
          'Task dependencies not properly managed',
          'Quality review incomplete or unhelpful',
          'Phase transitions fail'
        ]
      },

      // ===== ALTERNATIVE WORKFLOW SCENARIOS =====
      hiveMindAlternativeWorkflow: {
        name: 'Hive-Mind Alternative Workflow',
        description: 'Using documented workaround with hive-mind commands when Maestro CLI is unavailable',
        userType: 'intermediate',
        expectedDuration: '30-45 minutes',
        steps: [
          {
            step: 'Initialize hive-mind system',
            action: 'npx claude-flow@alpha hive-mind init',
            expected: 'Hive-mind system initializes successfully',
            testable: true
          },
          {
            step: 'Check hive-mind status',
            action: 'npx claude-flow@alpha hive-mind status',
            expected: 'System status information displayed',
            testable: true
          },
          {
            step: 'Create specification using hive-mind',
            action: 'npx claude-flow@alpha hive-mind spawn "Create comprehensive specification for user authentication system including requirements analysis, user stories, and acceptance criteria"',
            expected: 'Specification content generated through hive-mind',
            testable: true
          },
          {
            step: 'Generate design through hive-mind',
            action: 'npx claude-flow@alpha hive-mind spawn "Design technical architecture for user authentication system based on requirements, include database schema, API endpoints, and security considerations"',
            expected: 'Design content generated with architectural details',
            testable: true
          },
          {
            step: 'Create task breakdown',
            action: 'npx claude-flow@alpha hive-mind spawn "Generate detailed implementation task breakdown for authentication system, organize by priority and dependencies"',
            expected: 'Task breakdown generated with clear structure',
            testable: true
          },
          {
            step: 'Implement first task',
            action: 'npx claude-flow@alpha hive-mind spawn "Implement task 1: Create user registration endpoint with input validation and password hashing"',
            expected: 'Implementation code generated for first task',
            testable: true
          }
        ],
        successCriteria: [
          'Hive-mind commands work as documented',
          'Generated content matches Maestro specifications',
          'Workflow progression is maintained',
          'Output quality is comparable to Maestro',
          'Alternative approach is clearly documented'
        ],
        commonFailurePoints: [
          'Hive-mind commands not available',
          'Generated content different format than expected',
          'Lack of proper workflow state management',
          'Quality inconsistent with documented expectations'
        ]
      },

      // ===== ERROR RECOVERY SCENARIOS =====
      errorRecoveryWorkflow: {
        name: 'Error Recovery and Troubleshooting',
        description: 'Testing documented error scenarios and recovery procedures',
        userType: 'intermediate',
        expectedDuration: '20-30 minutes',
        steps: [
          {
            step: 'Trigger CLI access error',
            action: 'npx claude-flow maestro help',
            expected: 'Error: Unknown command: maestro',
            testable: true
          },
          {
            step: 'Follow documented workaround',
            action: 'npx claude-flow@alpha hive-mind spawn "help with specs-driven development"',
            expected: 'Alternative command works as documented',
            testable: true
          },
          {
            step: 'Test invalid parameter error',
            action: 'npx claude-flow maestro create-spec',
            expected: 'Clear error message about missing parameters',
            testable: true
          },
          {
            step: 'Test file system permission fix',
            action: 'mkdir -p docs/maestro/specs && chmod 755 docs/maestro/',
            expected: 'Directory created with proper permissions',
            testable: true
          },
          {
            step: 'Verify error message accuracy',
            action: 'Compare actual errors with documented errors',
            expected: 'Documentation accurately reflects actual error messages',
            testable: true
          }
        ],
        successCriteria: [
          'Error messages match documentation',
          'Workarounds actually resolve issues',
          'Recovery procedures are complete',
          'Error scenarios are comprehensive',
          'Solutions are actionable'
        ],
        commonFailurePoints: [
          'Documented errors don\'t match actual errors',
          'Workarounds don\'t work as described',
          'Recovery procedures incomplete',
          'Missing error scenarios'
        ]
      },

      // ===== ADVANCED USER SCENARIOS =====
      advancedConfigurationWorkflow: {
        name: 'Advanced Configuration and Customization',
        description: 'Testing advanced features and configuration options',
        userType: 'advanced',
        expectedDuration: '60-90 minutes',
        steps: [
          {
            step: 'Create high-consensus specification',
            action: 'npx claude-flow maestro create-spec enterprise-auth --request "Enterprise authentication system" --consensus-threshold 0.85 --max-agents 12',
            expected: 'Specification created with high consensus requirements',
            testable: true
          },
          {
            step: 'Generate design without consensus',
            action: 'npx claude-flow maestro generate-design rapid-proto --no-hive-mind',
            expected: 'Design generated using single architect',
            testable: true
          },
          {
            step: 'Create steering documents',
            action: 'npx claude-flow maestro init-steering security --content "All authentication must follow OWASP guidelines and use bcrypt with 12+ salt rounds"',
            expected: 'Steering document created and integrated',
            testable: true
          },
          {
            step: 'Monitor performance',
            action: 'npx claude-flow maestro performance-report',
            expected: 'Performance metrics displayed',
            testable: true
          },
          {
            step: 'Check agent utilization',
            action: 'npx claude-flow maestro agent-stats',
            expected: 'Agent utilization information shown',
            testable: true
          }
        ],
        successCriteria: [
          'Advanced configuration options work',
          'Consensus mechanisms function properly',
          'Steering documents integrate correctly',
          'Performance monitoring is available',
          'Advanced features are well documented'
        ],
        commonFailurePoints: [
          'Advanced options not implemented',
          'Configuration parameters ignored',
          'Steering integration not working',
          'Performance monitoring unavailable'
        ]
      },

      // ===== INTEGRATION SCENARIOS =====
      systemIntegrationWorkflow: {
        name: 'System Integration and Compatibility',
        description: 'Testing integration with other systems and components',
        userType: 'advanced',
        expectedDuration: '30-45 minutes',
        steps: [
          {
            step: 'Test memory system integration',
            action: 'npx claude-flow@alpha memory stats',
            expected: 'Memory system statistics displayed',
            testable: true
          },
          {
            step: 'Verify file system structure',
            action: 'ls -la docs/maestro/specs/',
            expected: 'Proper directory structure exists',
            testable: true
          },
          {
            step: 'Test programmatic access',
            action: 'node -e "console.log(\'Testing programmatic access\')"',
            expected: 'Programmatic interface available',
            testable: true
          },
          {
            step: 'Check cross-system compatibility',
            action: 'Test interaction between Maestro and hive-mind',
            expected: 'Systems work together as documented',
            testable: true
          }
        ],
        successCriteria: [
          'All integrations work as documented',
          'File system structure is correct',
          'Programmatic access is available',
          'Cross-system compatibility verified'
        ],
        commonFailurePoints: [
          'Integration points not working',
          'File system structure incorrect',
          'Programmatic access unavailable',
          'Systems conflict with each other'
        ]
      }
    };
  }

  // Get scenario by name
  getScenario(name) {
    return this.scenarios[name];
  }

  // Get all scenarios
  getAllScenarios() {
    return this.scenarios;
  }

  // Get scenarios by user type
  getScenariosByUserType(userType) {
    return Object.values(this.scenarios).filter(scenario => 
      scenario.userType === userType
    );
  }

  // Get testable steps from all scenarios
  getTestableSteps() {
    const testableSteps = [];
    
    Object.values(this.scenarios).forEach(scenario => {
      scenario.steps.forEach(step => {
        if (step.testable) {
          testableSteps.push({
            scenario: scenario.name,
            step: step.step,
            action: step.action,
            expected: step.expected
          });
        }
      });
    });
    
    return testableSteps;
  }

  // Validate scenario completeness
  validateScenarios() {
    const validation = {
      totalScenarios: Object.keys(this.scenarios).length,
      issues: [],
      completenessScore: 0
    };

    Object.entries(this.scenarios).forEach(([name, scenario]) => {
      // Check required fields
      const requiredFields = ['name', 'description', 'userType', 'steps', 'successCriteria'];
      requiredFields.forEach(field => {
        if (!scenario[field]) {
          validation.issues.push(`Scenario '${name}' missing field: ${field}`);
        }
      });

      // Check steps structure
      if (scenario.steps) {
        scenario.steps.forEach((step, index) => {
          const requiredStepFields = ['step', 'action', 'expected'];
          requiredStepFields.forEach(field => {
            if (!step[field]) {
              validation.issues.push(`Scenario '${name}' step ${index + 1} missing field: ${field}`);
            }
          });
        });
      }

      // Check success criteria
      if (scenario.successCriteria && scenario.successCriteria.length === 0) {
        validation.issues.push(`Scenario '${name}' has no success criteria`);
      }
    });

    validation.completenessScore = validation.issues.length === 0 ? 1.0 : 
      Math.max(0, 1 - (validation.issues.length / (validation.totalScenarios * 5)));

    return validation;
  }

  // Generate scenario execution plan
  generateExecutionPlan(scenarioNames = null) {
    const scenariosToRun = scenarioNames ? 
      scenarioNames.map(name => this.scenarios[name]).filter(Boolean) :
      Object.values(this.scenarios);

    return {
      executionOrder: scenariosToRun.map(scenario => ({
        name: scenario.name,
        userType: scenario.userType,
        expectedDuration: scenario.expectedDuration,
        stepCount: scenario.steps.length,
        testableSteps: scenario.steps.filter(step => step.testable).length
      })),
      totalSteps: scenariosToRun.reduce((sum, scenario) => sum + scenario.steps.length, 0),
      totalTestableSteps: scenariosToRun.reduce((sum, scenario) => 
        sum + scenario.steps.filter(step => step.testable).length, 0),
      estimatedDuration: this.calculateTotalDuration(scenariosToRun)
    };
  }

  calculateTotalDuration(scenarios) {
    const durations = scenarios.map(scenario => {
      const duration = scenario.expectedDuration || '30 minutes';
      const matches = duration.match(/(\d+)(?:-(\d+))?\s*minutes?/);
      if (matches) {
        const min = parseInt(matches[1]);
        const max = matches[2] ? parseInt(matches[2]) : min;
        return (min + max) / 2;
      }
      return 30; // Default 30 minutes
    });

    const totalMinutes = durations.reduce((sum, duration) => sum + duration, 0);
    return `${Math.round(totalMinutes)} minutes (${Math.round(totalMinutes / 60)} hours)`;
  }
}

module.exports = UserJourneyScenarios;