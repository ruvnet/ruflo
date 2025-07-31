#!/usr/bin/env node

/**
 * Maestro Documentation Validation Suite Runner
 * 
 * This script executes the comprehensive validation test suite and generates
 * detailed reports on documentation accuracy and usefulness.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

class ValidationSuiteRunner {
  constructor() {
    this.validator = new MaestroDocumentationValidator();
    this.scenarios = new UserJourneyScenarios();
    this.results = {
      startTime: new Date(),
      endTime: null,
      duration: null,
      validationResults: null,
      scenarioValidation: null,
      finalReport: null
    };
  }

  async runComprehensiveValidation() {
    console.log('🚀 Starting Comprehensive Maestro Documentation Validation');
    console.log('============================================================');
    console.log(`Start time: ${this.results.startTime.toLocaleString()}\n`);

    try {
      // Phase 1: Validate scenario definitions
      console.log('📋 Phase 1: Validating Test Scenarios');
      await this.validateScenarios();

      // Phase 2: Run documentation validation tests
      console.log('\n🧪 Phase 2: Running Documentation Validation Tests');
      await this.runDocumentationValidation();

      // Phase 3: Generate comprehensive reports
      console.log('\n📊 Phase 3: Generating Comprehensive Reports');
      await this.generateFinalReports();

      // Phase 4: Provide actionable recommendations
      console.log('\n💡 Phase 4: Generating Recommendations');
      await this.generateActionableRecommendations();

      this.results.endTime = new Date();
      this.results.duration = this.results.endTime - this.results.startTime;

      console.log('\n🎉 Comprehensive Validation Complete!');
      console.log(`Total duration: ${Math.round(this.results.duration / 1000)} seconds`);
      console.log(`End time: ${this.results.endTime.toLocaleString()}`);

      return this.results;

    } catch (error) {
      console.error('\n💥 Validation suite failed:', error.message);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  }

  async validateScenarios() {
    console.log('  Validating user journey scenarios...');
    
    this.results.scenarioValidation = this.scenarios.validateScenarios();
    
    console.log(`  ✅ Scenarios validated: ${this.results.scenarioValidation.totalScenarios}`);
    console.log(`  📊 Completeness score: ${(this.results.scenarioValidation.completenessScore * 100).toFixed(1)}%`);
    
    if (this.results.scenarioValidation.issues.length > 0) {
      console.log(`  ⚠️  Issues found: ${this.results.scenarioValidation.issues.length}`);
      this.results.scenarioValidation.issues.forEach(issue => {
        console.log(`     - ${issue}`);
      });
    }

    // Generate execution plan
    const executionPlan = this.scenarios.generateExecutionPlan();
    console.log(`  📅 Execution plan: ${executionPlan.totalTestableSteps} testable steps across ${executionPlan.executionOrder.length} scenarios`);
    console.log(`  ⏱️  Estimated duration: ${executionPlan.estimatedDuration}`);
  }

  async runDocumentationValidation() {
    console.log('  Running comprehensive documentation tests...');
    
    this.results.validationResults = await this.validator.runAllValidationTests();
    
    const overall = this.results.validationResults.overall || this.validator.testResults.overall;
    console.log(`  ✅ Tests completed: ${overall.totalTests}`);
    console.log(`  📈 Success rate: ${overall.totalTests > 0 ? (overall.passed / overall.totalTests * 100).toFixed(1) : 0}%`);
    console.log(`  ❌ Failed tests: ${overall.failed}`);
  }

  async generateFinalReports() {
    console.log('  Generating comprehensive validation reports...');

    // Combine all results into final report
    this.results.finalReport = {
      executionSummary: {
        startTime: this.results.startTime.toISOString(),
        endTime: this.results.endTime?.toISOString(),
        duration: this.results.duration,
        totalTests: this.validator.testResults.overall.totalTests,
        overallScore: this.calculateOverallScore()
      },
      validationResults: this.validator.testResults,
      scenarioAnalysis: this.results.scenarioValidation,
      documentationCoverage: await this.analyzeDocumentationCoverage(),
      criticalFindings: this.extractCriticalFindings(),
      recommendations: this.generatePrioritizedRecommendations()
    };

    // Write comprehensive report
    const reportPath = path.join(process.cwd(), 'maestro-comprehensive-validation-report.json');
    await fs.writeFile(reportPath, JSON.stringify(this.results.finalReport, null, 2));
    console.log(`  📄 Comprehensive report: ${reportPath}`);

    // Generate executive summary
    await this.generateExecutiveSummary();
  }

  async generateExecutiveSummary() {
    const summary = this.createExecutiveSummary();
    const summaryPath = path.join(process.cwd(), 'maestro-validation-executive-summary.md');
    await fs.writeFile(summaryPath, summary);
    console.log(`  📋 Executive summary: ${summaryPath}`);
  }

  createExecutiveSummary() {
    const overall = this.validator.testResults.overall;
    const score = this.calculateOverallScore();
    
    return `# Maestro Documentation Validation - Executive Summary

**Generated:** ${new Date().toLocaleString()}  
**Duration:** ${Math.round(this.results.duration / 1000)} seconds  
**Overall Score:** ${(score * 100).toFixed(1)}%

## 🎯 Executive Summary

${this.getExecutiveSummaryText(score)}

## 📊 Key Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Total Tests Executed | ${overall.totalTests} | ${overall.totalTests > 50 ? '✅' : '⚠️'} |
| Success Rate | ${overall.totalTests > 0 ? (overall.passed / overall.totalTests * 100).toFixed(1) : 0}% | ${overall.passed / overall.totalTests > 0.7 ? '✅' : '❌'} |
| Documentation Accuracy | ${(score * 100).toFixed(1)}% | ${score > 0.8 ? '✅' : score > 0.6 ? '⚠️' : '❌'} |
| Critical Issues | ${this.results.finalReport.criticalFindings.length} | ${this.results.finalReport.criticalFindings.length === 0 ? '✅' : '❌'} |

## 🚨 Critical Findings

${this.results.finalReport.criticalFindings.map((finding, index) => 
  `${index + 1}. **${finding.severity}**: ${finding.title}\n   - ${finding.description}`
).join('\n\n')}

## 📋 Test Category Results

### Command Syntax Validation
- **Tests:** ${this.validator.testResults.commandSyntax.length}
- **Pass Rate:** ${this.calculateCategoryPassRate('commandSyntax')}%
- **Key Issue:** ${this.getTopIssue('commandSyntax')}

### User Journey Testing
- **Tests:** ${this.validator.testResults.userJourneys.length}
- **Pass Rate:** ${this.calculateCategoryPassRate('userJourneys')}%
- **Key Issue:** ${this.getTopIssue('userJourneys')}

### Error Case Validation
- **Tests:** ${this.validator.testResults.errorCases.length}
- **Pass Rate:** ${this.calculateCategoryPassRate('errorCases')}%
- **Key Issue:** ${this.getTopIssue('errorCases')}

### Integration Testing
- **Tests:** ${this.validator.testResults.integrationTests.length}
- **Pass Rate:** ${this.calculateCategoryPassRate('integrationTests')}%
- **Key Issue:** ${this.getTopIssue('integrationTests')}

### Usability Testing
- **Tests:** ${this.validator.testResults.usabilityTests.length}
- **Pass Rate:** ${this.calculateCategoryPassRate('usabilityTests')}%
- **Key Issue:** ${this.getTopIssue('usabilityTests')}

## 🎯 Priority Recommendations

${this.results.finalReport.recommendations.slice(0, 3).map((rec, index) => 
  `### ${index + 1}. ${rec.title} (${rec.priority} Priority)\n${rec.description}\n\n**Action:** ${rec.action}`
).join('\n\n')}

## 📈 Improvement Roadmap

### Immediate Actions (1-2 weeks)
${this.getRecommendationsByPriority('HIGH').map(rec => `- ${rec.title}`).join('\n')}

### Short-term Actions (1 month)
${this.getRecommendationsByPriority('MEDIUM').map(rec => `- ${rec.title}`).join('\n')}

### Long-term Actions (3 months)
${this.getRecommendationsByPriority('LOW').map(rec => `- ${rec.title}`).join('\n')}

## 🔍 Next Steps

1. **Address CLI Access Issues**: Priority #1 is resolving the TypeScript compilation problems that prevent CLI access
2. **Update Documentation**: Correct any inaccuracies found during validation
3. **Improve Alternative Workflows**: Enhance documented workarounds and alternatives
4. **Enhance User Experience**: Implement usability improvements based on test results
5. **Establish Continuous Validation**: Set up automated validation to maintain documentation quality

## 📞 Support and Follow-up

For questions about this validation report or implementation of recommendations:
- Review detailed findings in \`maestro-comprehensive-validation-report.json\`
- Check specific test results in individual category reports
- Monitor progress using the validation framework for ongoing quality assurance

---
*This executive summary provides a high-level overview of the Maestro documentation validation results. See the comprehensive report for detailed technical findings and specific recommendations.*`;
  }

  calculateOverallScore() {
    const results = this.validator.testResults;
    if (results.overall.totalTests === 0) return 0;

    // Weighted scoring system
    const weights = {
      commandSyntax: 0.3,    // High weight - core functionality
      userJourneys: 0.25,    // High weight - user experience
      errorCases: 0.2,       // Medium weight - reliability
      integrationTests: 0.15, // Medium weight - compatibility
      usabilityTests: 0.1    // Lower weight - nice to have
    };

    let weightedScore = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([category, weight]) => {
      if (results[category] && results[category].length > 0) {
        const passRate = results[category].filter(test => test.passed).length / results[category].length;
        weightedScore += passRate * weight;
        totalWeight += weight;
      }
    });

    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  calculateCategoryPassRate(category) {
    const tests = this.validator.testResults[category];
    if (!tests || tests.length === 0) return 0;
    return (tests.filter(test => test.passed).length / tests.length * 100).toFixed(1);
  }

  getTopIssue(category) {
    const tests = this.validator.testResults[category];
    if (!tests || tests.length === 0) return 'No tests conducted';
    
    const failures = tests.filter(test => !test.passed);
    if (failures.length === 0) return 'No issues found';
    
    // Get most common issue
    const allIssues = failures.flatMap(test => test.issues || []);
    if (allIssues.length === 0) return 'Tests failed but no specific issues recorded';
    
    const issueCount = {};
    allIssues.forEach(issue => {
      issueCount[issue] = (issueCount[issue] || 0) + 1;
    });
    
    const topIssue = Object.entries(issueCount).sort((a, b) => b[1] - a[1])[0];
    return topIssue ? topIssue[0] : 'Various issues identified';
  }

  getExecutiveSummaryText(score) {
    if (score >= 0.9) {
      return 'The Maestro documentation is highly accurate and comprehensive. Users can rely on the documented procedures with minimal issues. Only minor improvements are needed.';
    } else if (score >= 0.8) {
      return 'The Maestro documentation is generally accurate with some areas for improvement. Most documented procedures work as described, but there are some inconsistencies that should be addressed.';
    } else if (score >= 0.6) {
      return 'The Maestro documentation has significant accuracy issues that impact user experience. While the content is comprehensive, many documented commands and procedures do not work as described, primarily due to CLI access issues.';
    } else if (score >= 0.4) {
      return 'The Maestro documentation requires major updates. Multiple critical issues prevent users from following documented procedures successfully. The primary blocker is CLI inaccessibility.';
    } else {
      return 'The Maestro documentation is currently not usable for its intended purpose. Critical system access issues prevent execution of most documented procedures. Immediate action is required to restore functionality.';
    }
  }

  async analyzeDocumentationCoverage() {
    try {
      const docFiles = [
        'README.md',
        'COMMAND-REFERENCE.md', 
        'WORKFLOW-GUIDE.md',
        'WORKAROUNDS.md',
        'API.md'
      ];

      const coverage = {
        totalFiles: docFiles.length,
        existingFiles: 0,
        totalSize: 0,
        commandsCovered: 0,
        examplesProvided: 0,
        troubleshootingScenarios: 0
      };

      for (const file of docFiles) {
        try {
          const filePath = path.join(process.cwd(), 'docs', 'maestro', file);
          const content = await fs.readFile(filePath, 'utf8');
          coverage.existingFiles++;
          coverage.totalSize += content.length;
          
          // Count commands
          const commandMatches = content.match(/npx claude-flow maestro \w+/g);
          coverage.commandsCovered += commandMatches ? commandMatches.length : 0;
          
          // Count examples
          const exampleMatches = content.match(/```[\s\S]*?```/g);
          coverage.examplesProvided += exampleMatches ? exampleMatches.length : 0;
          
          // Count troubleshooting scenarios
          if (content.includes('Error:') || content.includes('Issue:') || content.includes('Problem:')) {
            coverage.troubleshootingScenarios++;
          }
          
        } catch (error) {
          // File doesn't exist or can't be read
          console.warn(`⚠️  Could not analyze ${file}: ${error.message}`);
        }
      }

      return coverage;
    } catch (error) {
      console.error('Error analyzing documentation coverage:', error);
      return { error: error.message };
    }
  }

  extractCriticalFindings() {
    const criticalFindings = [];

    // CLI Access Issues
    const cliIssues = this.validator.testResults.commandSyntax?.filter(test => 
      test.status === 'cli_not_available'
    ) || [];
    
    if (cliIssues.length > 0) {
      criticalFindings.push({
        severity: 'CRITICAL',
        title: 'CLI Commands Not Accessible',
        description: `${cliIssues.length} documented commands cannot be executed due to build system issues. This affects core functionality.`,
        impact: 'HIGH',
        category: 'System Access'
      });
    }

    // Failed User Journeys
    const failedJourneys = this.validator.testResults.userJourneys?.filter(journey => 
      journey.completionRate < 0.3
    ) || [];
    
    if (failedJourneys.length > 0) {
      criticalFindings.push({
        severity: 'HIGH',
        title: 'User Workflows Not Functional',
        description: `${failedJourneys.length} documented user workflows have completion rates below 30%.`,
        impact: 'HIGH',
        category: 'User Experience'
      });
    }

    // Integration Failures
    const integrationFailures = this.validator.testResults.integrationTests?.filter(test => 
      test.testsPassed === 0
    ) || [];
    
    if (integrationFailures.length > 0) {
      criticalFindings.push({
        severity: 'MEDIUM',
        title: 'System Integration Issues',
        description: `${integrationFailures.length} integration scenarios completely failed to execute.`,
        impact: 'MEDIUM',
        category: 'System Integration'
      });
    }

    // Documentation Accuracy
    const overall = this.validator.testResults.overall;
    if (overall.totalTests > 0 && (overall.passed / overall.totalTests) < 0.5) {
      criticalFindings.push({
        severity: 'HIGH',
        title: 'Documentation Accuracy Below 50%',
        description: `Only ${(overall.passed / overall.totalTests * 100).toFixed(1)}% of documented procedures work as described.`,
        impact: 'HIGH',
        category: 'Documentation Quality'
      });
    }

    return criticalFindings;
  }

  generatePrioritizedRecommendations() {
    const recommendations = [];

    // CLI Access Fix
    const cliIssues = this.validator.testResults.commandSyntax?.filter(test => 
      test.status === 'cli_not_available'
    ).length || 0;
    
    if (cliIssues > 0) {
      recommendations.push({
        priority: 'HIGH',
        title: 'Resolve CLI Access Issues',
        description: 'Fix TypeScript compilation errors preventing CLI command registration.',
        action: 'Debug and resolve build system issues, ensure proper command registration.',
        estimatedEffort: '1-2 weeks',
        impact: 'Enables all documented command functionality'
      });
    }

    // Alternative Workflow Enhancement
    const failedAlternatives = this.validator.testResults.userJourneys?.filter(journey => 
      journey.name.includes('Alternative') && !journey.passed
    ).length || 0;
    
    if (failedAlternatives > 0) {
      recommendations.push({
        priority: 'HIGH',
        title: 'Improve Alternative Workflows',
        description: 'Ensure documented workarounds and alternatives actually work.',
        action: 'Test and validate all alternative approaches, update documentation.',
        estimatedEffort: '1 week',
        impact: 'Provides working alternatives while CLI issues are resolved'
      });
    }

    // Documentation Updates
    const inaccurateCommands = this.validator.testResults.commandSyntax?.filter(test => 
      !test.passed && test.status !== 'cli_not_available'
    ).length || 0;
    
    if (inaccurateCommands > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        title: 'Update Command Documentation',
        description: 'Correct inaccuracies in command syntax and behavior documentation.',
        action: 'Review each documented command against actual implementation.',
        estimatedEffort: '3-5 days',
        impact: 'Improves documentation accuracy and user trust'
      });
    }

    // Usability Improvements
    const usabilityScore = this.validator.testResults.usabilityTests?.reduce((sum, test) => 
      sum + test.overallScore, 0) / (this.validator.testResults.usabilityTests?.length || 1);
    
    if (usabilityScore < 0.8) {
      recommendations.push({
        priority: 'LOW',
        title: 'Enhance Documentation Usability',
        description: 'Improve user experience with better examples, cross-references, and getting started guides.',
        action: 'Add more practical examples, improve navigation, enhance getting started content.',
        estimatedEffort: '1-2 weeks',
        impact: 'Better user experience and faster onboarding'
      });
    }

    // Continuous Validation
    recommendations.push({
      priority: 'LOW',
      title: 'Implement Continuous Validation',
      description: 'Set up automated validation to maintain documentation quality.',
      action: 'Integrate validation tests into CI/CD pipeline.',
      estimatedEffort: '2-3 days',
      impact: 'Prevents documentation regression and maintains quality'
    });

    return recommendations;
  }

  getRecommendationsByPriority(priority) {
    return this.results.finalReport.recommendations.filter(rec => rec.priority === priority);
  }

  async generateActionableRecommendations() {
    console.log('  Creating actionable improvement plan...');

    const actionPlan = {
      immediate: [],
      shortTerm: [],
      longTerm: []
    };

    this.results.finalReport.recommendations.forEach(rec => {
      const item = {
        title: rec.title,
        action: rec.action,
        effort: rec.estimatedEffort,
        impact: rec.impact
      };

      switch (rec.priority) {
        case 'HIGH':
          actionPlan.immediate.push(item);
          break;
        case 'MEDIUM':
          actionPlan.shortTerm.push(item);
          break;
        case 'LOW':
          actionPlan.longTerm.push(item);
          break;
      }
    });

    const planPath = path.join(process.cwd(), 'maestro-improvement-action-plan.json');
    await fs.writeFile(planPath, JSON.stringify(actionPlan, null, 2));
    console.log(`  📋 Action plan: ${planPath}`);

    return actionPlan;
  }
}

// Run validation if script is executed directly
if (require.main === module) {
  const runner = new ValidationSuiteRunner();
  
  runner.runComprehensiveValidation()
    .then((results) => {
      console.log('\n🎯 Validation Summary:');
      console.log(`📊 Overall Score: ${(runner.calculateOverallScore() * 100).toFixed(1)}%`);
      console.log(`🧪 Total Tests: ${results.validationResults?.overall?.totalTests || runner.validator.testResults.overall.totalTests}`);
      console.log(`✅ Passed: ${results.validationResults?.overall?.passed || runner.validator.testResults.overall.passed}`);
      console.log(`❌ Failed: ${results.validationResults?.overall?.failed || runner.validator.testResults.overall.failed}`);
      console.log(`🚨 Critical Issues: ${results.finalReport.criticalFindings.length}`);
      
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Validation suite failed:', error.message);
      process.exit(1);
    });
}

module.exports = ValidationSuiteRunner;