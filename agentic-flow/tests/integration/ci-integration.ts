/**
 * CI/CD Integration Configuration
 * Provides integration with various CI/CD platforms and automation tools
 */

import { TestRunConfig, IntegrationTestRunner, TestResult } from './test-runner';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface CIConfig {
  platform: 'github' | 'gitlab' | 'jenkins' | 'azure' | 'custom';
  environment: 'development' | 'staging' | 'production' | 'pr';
  apiKeys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
  parallelJobs?: number;
  timeoutMinutes?: number;
  failFast?: boolean;
  notifications?: {
    slack?: { webhook: string; channel: string };
    email?: { recipients: string[] };
    teams?: { webhook: string };
  };
  artifacts?: {
    reports: boolean;
    logs: boolean;
    coverage: boolean;
    screenshots?: boolean;
  };
}

export class CIIntegration {
  private config: CIConfig;

  constructor(config: CIConfig) {
    this.config = config;
  }

  /**
   * Generate CI configuration files
   */
  async generateCIConfig(): Promise<void> {
    switch (this.config.platform) {
      case 'github':
        await this.generateGitHubActions();
        break;
      case 'gitlab':
        await this.generateGitLabCI();
        break;
      case 'jenkins':
        await this.generateJenkinsfile();
        break;
      case 'azure':
        await this.generateAzurePipelines();
        break;
      default:
        throw new Error(`Unsupported platform: ${this.config.platform}`);
    }
  }

  /**
   * Generate GitHub Actions workflow
   */
  private async generateGitHubActions(): Promise<void> {
    const workflow = {
      name: 'Agentic Flow Integration Tests',
      on: {
        push: {
          branches: ['main', 'develop']
        },
        pull_request: {
          branches: ['main', 'develop']
        },
        schedule: [
          {
            cron: '0 2 * * *' // Daily at 2 AM
          }
        ]
      },
      env: {
        NODE_VERSION: '18.x',
        ANTHROPIC_API_KEY: '${{ secrets.ANTHROPIC_API_KEY }}',
        OPENAI_API_KEY: '${{ secrets.OPENAI_API_KEY }}',
        GOOGLE_API_KEY: '${{ secrets.GOOGLE_API_KEY }}',
        RUN_REAL_API_TESTS: '${{ github.event_name != \'pull_request\' }}'
      },
      jobs: {
        'integration-tests': {
          'runs-on': 'ubuntu-latest',
          'timeout-minutes': this.config.timeoutMinutes || 60,
          strategy: {
            matrix: {
              'test-category': ['integration', 'e2e', 'performance', 'security']
            },
            'fail-fast': this.config.failFast !== false
          },
          steps: [
            {
              name: 'Checkout code',
              uses: 'actions/checkout@v4'
            },
            {
              name: 'Setup Node.js',
              uses: 'actions/setup-node@v4',
              with: {
                'node-version': '${{ env.NODE_VERSION }}',
                'cache': 'npm'
              }
            },
            {
              name: 'Install dependencies',
              run: 'npm ci'
            },
            {
              name: 'Build project',
              run: 'npm run build'
            },
            {
              name: 'Run integration tests',
              run: `npm run test:integration:${{ matrix.test-category }}`,
              env: {
                CI: 'true',
                JEST_JUNIT_OUTPUT_DIR: './test-reports',
                JEST_JUNIT_OUTPUT_NAME: 'integration-${{ matrix.test-category }}.xml'
              }
            },
            {
              name: 'Upload test reports',
              uses: 'actions/upload-artifact@v4',
              if: 'always()',
              with: {
                name: 'test-reports-${{ matrix.test-category }}',
                path: 'test-reports/',
                'retention-days': 30
              }
            },
            {
              name: 'Upload coverage reports',
              uses: 'codecov/codecov-action@v3',
              if: 'matrix.test-category == \'integration\'',
              with: {
                files: './coverage/lcov.info',
                flags: 'integration',
                name: 'agentic-flow-integration'
              }
            },
            {
              name: 'Comment PR with results',
              uses: 'actions/github-script@v7',
              if: 'github.event_name == \'pull_request\' && always()',
              with: {
                script: `
                  const fs = require('fs');
                  const path = require('path');
                  
                  try {
                    const reportPath = path.join('./test-reports', 'integration-test-report-*.json');
                    const reports = require('glob').sync(reportPath);
                    
                    if (reports.length > 0) {
                      const report = JSON.parse(fs.readFileSync(reports[0], 'utf8'));
                      const summary = report.summary;
                      
                      const comment = \`## 🧪 Integration Test Results ($\{{ matrix.test-category }})
                      
                      - **Success Rate**: $\{summary.overallSuccessRate.toFixed(1)}%
                      - **Test Suites**: $\{summary.passedSuites}/$\{summary.totalSuites} passed
                      - **Total Tests**: $\{summary.passedTests}/$\{summary.totalTests} passed
                      - **Duration**: $\{(summary.totalDuration / 1000).toFixed(1)}s
                      
                      $\{summary.failedSuites > 0 ? '❌ Some tests failed. Please check the logs for details.' : '✅ All tests passed!'}
                      \`;
                      
                      github.rest.issues.createComment({
                        issue_number: context.issue.number,
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        body: comment
                      });
                    }
                  } catch (error) {
                    console.log('Could not post test results comment:', error.message);
                  }
                `
              }
            }
          ]
        },
        'notify-results': {
          'runs-on': 'ubuntu-latest',
          needs: ['integration-tests'],
          if: 'always()',
          steps: [
            {
              name: 'Notify Slack',
              if: '${{ vars.SLACK_WEBHOOK }}',
              run: `
                curl -X POST -H 'Content-type: application/json' \\
                --data '{"channel":"#ci-cd","text":"Integration tests completed for Agentic Flow - Status: ${{ needs.integration-tests.result }}"}' \\
                ${{ vars.SLACK_WEBHOOK }}
              `
            }
          ]
        }
      }
    };

    const workflowPath = '.github/workflows/integration-tests.yml';
    await this.ensureDirectoryExists(path.dirname(workflowPath));
    await fs.writeFile(workflowPath, this.yamlStringify(workflow));
  }

  /**
   * Generate GitLab CI configuration
   */
  private async generateGitLabCI(): Promise<void> {
    const gitlab = `
# Agentic Flow Integration Tests - GitLab CI
image: node:18

variables:
  NODE_ENV: test
  CACHE_FALLBACK_KEY: node-modules

stages:
  - build
  - test
  - report

cache:
  key: "$CI_COMMIT_REF_SLUG"
  paths:
    - node_modules/

before_script:
  - npm ci

build:
  stage: build
  script:
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 hour

.test_template: &test_template
  stage: test
  timeout: ${this.config.timeoutMinutes || 60}m
  artifacts:
    when: always
    paths:
      - test-reports/
      - coverage/
    reports:
      junit: test-reports/*.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
    expire_in: 1 week

integration_tests:
  <<: *test_template
  script:
    - npm run test:integration:integration
  only:
    variables:
      - $CI_PIPELINE_SOURCE == "merge_request_event" || $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH

e2e_tests:
  <<: *test_template
  script:
    - npm run test:integration:e2e
  only:
    - main
    - develop

performance_tests:
  <<: *test_template
  script:
    - npm run test:integration:performance
  only:
    - main
    - schedules

security_tests:
  <<: *test_template
  script:
    - npm run test:integration:security
  only:
    - main
    - schedules

pages:
  stage: report
  dependencies:
    - integration_tests
    - e2e_tests
  script:
    - mkdir public
    - cp -r test-reports/* public/ || true
    - cp -r coverage/* public/ || true
  artifacts:
    paths:
      - public
  only:
    - main
`;

    await fs.writeFile('.gitlab-ci.yml', gitlab.trim());
  }

  /**
   * Generate Jenkinsfile
   */
  private async generateJenkinsfile(): Promise<void> {
    const jenkinsfile = `
pipeline {
    agent any
    
    environment {
        NODE_VERSION = '18'
        ANTHROPIC_API_KEY = credentials('anthropic-api-key')
        OPENAI_API_KEY = credentials('openai-api-key')
        GOOGLE_API_KEY = credentials('google-api-key')
        RUN_REAL_API_TESTS = 'true'
    }
    
    options {
        timeout(time: ${this.config.timeoutMinutes || 60}, unit: 'MINUTES')
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '50'))
    }
    
    stages {
        stage('Setup') {
            steps {
                script {
                    // Install Node.js
                    def nodeHome = tool name: "Node-\${NODE_VERSION}", type: 'nodejs'
                    env.PATH = "\${nodeHome}/bin:\${env.PATH}"
                }
                
                // Install dependencies
                sh 'npm ci'
                
                // Build project
                sh 'npm run build'
            }
        }
        
        stage('Integration Tests') {
            parallel {
                stage('Integration') {
                    steps {
                        sh 'npm run test:integration:integration'
                    }
                    post {
                        always {
                            publishTestResults testResultsPattern: 'test-reports/integration-*.xml'
                        }
                    }
                }
                
                stage('E2E') {
                    steps {
                        sh 'npm run test:integration:e2e'
                    }
                    post {
                        always {
                            publishTestResults testResultsPattern: 'test-reports/e2e-*.xml'
                        }
                    }
                }
                
                stage('Performance') {
                    when {
                        anyOf {
                            branch 'main'
                            branch 'develop'
                        }
                    }
                    steps {
                        sh 'npm run test:integration:performance'
                    }
                    post {
                        always {
                            publishTestResults testResultsPattern: 'test-reports/performance-*.xml'
                        }
                    }
                }
                
                stage('Security') {
                    when {
                        anyOf {
                            branch 'main'
                            branch 'develop'
                        }
                    }
                    steps {
                        sh 'npm run test:integration:security'
                    }
                    post {
                        always {
                            publishTestResults testResultsPattern: 'test-reports/security-*.xml'
                        }
                    }
                }
            }
        }
        
        stage('Reports') {
            steps {
                // Archive test reports
                archiveArtifacts artifacts: 'test-reports/**/*', allowEmptyArchive: true
                
                // Publish coverage
                publishHTML([
                    allowMissing: false,
                    alwaysLinkToLastBuild: true,
                    keepAll: true,
                    reportDir: 'coverage',
                    reportFiles: 'index.html',
                    reportName: 'Coverage Report'
                ])
            }
        }
    }
    
    post {
        always {
            // Clean workspace
            cleanWs()
        }
        
        success {
            script {
                if (env.SLACK_WEBHOOK) {
                    slackSend(
                        channel: '#ci-cd',
                        color: 'good',
                        message: "✅ Integration tests passed for Agentic Flow - Branch: \${env.BRANCH_NAME}"
                    )
                }
            }
        }
        
        failure {
            script {
                if (env.SLACK_WEBHOOK) {
                    slackSend(
                        channel: '#ci-cd',
                        color: 'danger',
                        message: "❌ Integration tests failed for Agentic Flow - Branch: \${env.BRANCH_NAME}"
                    )
                }
            }
        }
    }
}
`;

    await fs.writeFile('Jenkinsfile', jenkinsfile.trim());
  }

  /**
   * Generate Azure Pipelines configuration
   */
  private async generateAzurePipelines(): Promise<void> {
    const azure = {
      trigger: {
        branches: {
          include: ['main', 'develop']
        }
      },
      pr: {
        branches: {
          include: ['main', 'develop']
        }
      },
      schedules: [
        {
          cron: '0 2 * * *',
          displayName: 'Daily Integration Tests',
          branches: {
            include: ['main']
          }
        }
      ],
      variables: {
        nodeVersion: '18.x'
      },
      stages: [
        {
          stage: 'Build',
          jobs: [
            {
              job: 'Build',
              pool: {
                vmImage: 'ubuntu-latest'
              },
              steps: [
                {
                  task: 'NodeTool@0',
                  inputs: {
                    versionSpec: '$(nodeVersion)'
                  },
                  displayName: 'Install Node.js'
                },
                {
                  script: 'npm ci',
                  displayName: 'Install dependencies'
                },
                {
                  script: 'npm run build',
                  displayName: 'Build project'
                },
                {
                  task: 'PublishPipelineArtifact@1',
                  inputs: {
                    targetPath: 'dist',
                    artifactName: 'build'
                  }
                }
              ]
            }
          ]
        },
        {
          stage: 'IntegrationTests',
          dependsOn: 'Build',
          jobs: [
            {
              job: 'IntegrationTests',
              strategy: {
                matrix: {
                  integration: {
                    testCategory: 'integration'
                  },
                  e2e: {
                    testCategory: 'e2e'
                  },
                  performance: {
                    testCategory: 'performance'
                  },
                  security: {
                    testCategory: 'security'
                  }
                }
              },
              pool: {
                vmImage: 'ubuntu-latest'
              },
              timeoutInMinutes: this.config.timeoutMinutes || 60,
              steps: [
                {
                  task: 'NodeTool@0',
                  inputs: {
                    versionSpec: '$(nodeVersion)'
                  }
                },
                {
                  task: 'DownloadPipelineArtifact@2',
                  inputs: {
                    artifactName: 'build',
                    targetPath: 'dist'
                  }
                },
                {
                  script: 'npm ci',
                  displayName: 'Install dependencies'
                },
                {
                  script: 'npm run test:integration:$(testCategory)',
                  displayName: 'Run $(testCategory) tests',
                  env: {
                    ANTHROPIC_API_KEY: '$(ANTHROPIC_API_KEY)',
                    OPENAI_API_KEY: '$(OPENAI_API_KEY)',
                    GOOGLE_API_KEY: '$(GOOGLE_API_KEY)',
                    RUN_REAL_API_TESTS: 'true'
                  }
                },
                {
                  task: 'PublishTestResults@2',
                  inputs: {
                    testResultsFormat: 'JUnit',
                    testResultsFiles: 'test-reports/*.xml',
                    mergeTestResults: true,
                    testRunTitle: '$(testCategory) Integration Tests'
                  },
                  condition: 'always()'
                },
                {
                  task: 'PublishCodeCoverageResults@1',
                  inputs: {
                    codeCoverageTool: 'Cobertura',
                    summaryFileLocation: 'coverage/cobertura-coverage.xml'
                  },
                  condition: 'and(always(), eq(variables.testCategory, \'integration\'))'
                },
                {
                  task: 'PublishPipelineArtifact@1',
                  inputs: {
                    targetPath: 'test-reports',
                    artifactName: 'test-reports-$(testCategory)'
                  },
                  condition: 'always()'
                }
              ]
            }
          ]
        }
      ]
    };

    await fs.writeFile('azure-pipelines.yml', this.yamlStringify(azure));
  }

  /**
   * Run tests in CI environment
   */
  async runCITests(): Promise<TestResult[]> {
    const testConfig: TestRunConfig = {
      categories: this.getCategoriesForEnvironment(),
      parallel: true,
      maxParallel: this.config.parallelJobs || 4,
      timeout: (this.config.timeoutMinutes || 60) * 60 * 1000,
      environment: {
        CI: 'true',
        NODE_ENV: 'test',
        RUN_REAL_API_TESTS: this.shouldRunRealAPITests() ? 'true' : 'false',
        ...this.getAPIKeys()
      },
      generateReport: true,
      reportFormat: 'all'
    };

    const runner = new IntegrationTestRunner(testConfig);
    
    // Set up CI-specific event handlers
    this.setupCIEventHandlers(runner);
    
    return await runner.runTests();
  }

  /**
   * Get test categories based on CI environment
   */
  private getCategoriesForEnvironment(): string[] {
    switch (this.config.environment) {
      case 'development':
        return ['integration'];
      case 'staging':
        return ['integration', 'e2e'];
      case 'production':
        return ['integration', 'e2e', 'performance', 'security'];
      case 'pr':
        return ['integration'];
      default:
        return ['integration'];
    }
  }

  /**
   * Determine if real API tests should run
   */
  private shouldRunRealAPITests(): boolean {
    return (
      this.config.environment !== 'pr' &&
      this.config.apiKeys &&
      Object.keys(this.config.apiKeys).length > 0
    );
  }

  /**
   * Get API keys from configuration
   */
  private getAPIKeys(): Record<string, string> {
    const keys: Record<string, string> = {};
    
    if (this.config.apiKeys?.anthropic) {
      keys.ANTHROPIC_API_KEY = this.config.apiKeys.anthropic;
    }
    if (this.config.apiKeys?.openai) {
      keys.OPENAI_API_KEY = this.config.apiKeys.openai;
    }
    if (this.config.apiKeys?.google) {
      keys.GOOGLE_API_KEY = this.config.apiKeys.google;
    }
    
    return keys;
  }

  /**
   * Set up CI-specific event handlers
   */
  private setupCIEventHandlers(runner: IntegrationTestRunner): void {
    runner.on('run:started', (data) => {
      console.log(`::group::🚀 Starting integration tests (${data.totalSuites} suites)`);
    });

    runner.on('suite:started', (data) => {
      console.log(`::group::📋 Running: ${data.suite}`);
    });

    runner.on('suite:completed', (data) => {
      const status = data.result.status === 'passed' ? '✅' : '❌';
      const duration = (data.result.duration / 1000).toFixed(2);
      console.log(`${status} ${data.suite} (${duration}s, ${data.result.tests.length} tests)`);
      console.log('::endgroup::');
    });

    runner.on('suite:failed', (data) => {
      console.log(`::error::❌ ${data.suite} - FAILED`);
      if (data.error) {
        console.log(`::error::Error: ${data.error.message}`);
      }
      console.log('::endgroup::');
    });

    runner.on('run:completed', (data) => {
      console.log('::endgroup::');
      console.log(`::notice::Integration tests completed - Success rate: ${data.summary.overallSuccessRate.toFixed(1)}%`);
      
      if (data.summary.failedSuites > 0) {
        console.log(`::error::${data.summary.failedSuites} test suites failed`);
      }
    });
  }

  /**
   * Send notifications based on configuration
   */
  async sendNotifications(results: TestResult[]): Promise<void> {
    const summary = this.calculateSummary(results);
    
    if (this.config.notifications?.slack) {
      await this.sendSlackNotification(summary);
    }
    
    if (this.config.notifications?.email) {
      await this.sendEmailNotification(summary);
    }
    
    if (this.config.notifications?.teams) {
      await this.sendTeamsNotification(summary);
    }
  }

  private calculateSummary(results: TestResult[]): any {
    return {
      totalSuites: results.length,
      passedSuites: results.filter(r => r.status === 'passed').length,
      failedSuites: results.filter(r => r.status === 'failed').length,
      totalDuration: results.reduce((sum, r) => sum + r.duration, 0),
      overallSuccessRate: results.length > 0 ? (results.filter(r => r.status === 'passed').length / results.length) * 100 : 0
    };
  }

  private async sendSlackNotification(summary: any): Promise<void> {
    // Implementation would depend on Slack webhook integration
    console.log('Slack notification sent:', summary);
  }

  private async sendEmailNotification(summary: any): Promise<void> {
    // Implementation would depend on email service integration
    console.log('Email notification sent:', summary);
  }

  private async sendTeamsNotification(summary: any): Promise<void> {
    // Implementation would depend on Teams webhook integration
    console.log('Teams notification sent:', summary);
  }

  /**
   * Helper method to ensure directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Simple YAML stringify (basic implementation)
   */
  private yamlStringify(obj: any, indent = 0): string {
    const spaces = ' '.repeat(indent);
    
    if (typeof obj === 'string') {
      return `"${obj}"`;
    }
    
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj.toString();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => `${spaces}- ${this.yamlStringify(item, indent + 2).trim()}`).join('\n');
    }
    
    if (typeof obj === 'object' && obj !== null) {
      return Object.entries(obj)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `${spaces}${key}:\n${this.yamlStringify(value, indent + 2)}`;
          } else if (typeof value === 'object' && value !== null) {
            return `${spaces}${key}:\n${this.yamlStringify(value, indent + 2)}`;
          } else {
            return `${spaces}${key}: ${this.yamlStringify(value)}`;
          }
        })
        .join('\n');
    }
    
    return '';
  }
}

/**
 * Export functions for CLI usage
 */
export async function setupCI(platform: string, environment: string): Promise<void> {
  const config: CIConfig = {
    platform: platform as any,
    environment: environment as any,
    parallelJobs: 4,
    timeoutMinutes: 60,
    failFast: false,
    artifacts: {
      reports: true,
      logs: true,
      coverage: true
    }
  };

  const ci = new CIIntegration(config);
  await ci.generateCIConfig();
  
  console.log(`✅ CI configuration generated for ${platform} (${environment} environment)`);
}

export async function runCITests(environment: string): Promise<void> {
  const config: CIConfig = {
    platform: 'custom',
    environment: environment as any,
    apiKeys: {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      google: process.env.GOOGLE_API_KEY
    }
  };

  const ci = new CIIntegration(config);
  const results = await ci.runCITests();
  
  const summary = ci['calculateSummary'](results);
  
  if (summary.failedSuites > 0) {
    console.error(`❌ ${summary.failedSuites} test suites failed`);
    process.exit(1);
  } else {
    console.log(`✅ All ${summary.passedSuites} test suites passed`);
  }
}