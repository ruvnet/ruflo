/**
 * End-to-End Scenario Integration Tests
 * Tests complete real-world scenarios combining all components
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, waitForEvent, measureTime, TestDataFactory } from './test-infrastructure';

describe('End-to-End Scenario Integration Tests', () => {
  let framework: IntegrationTestFramework;
  let testContext: IntegrationTestContext;

  beforeAll(async () => {
    framework = new IntegrationTestFramework();
  });

  afterAll(async () => {
    await framework.cleanup();
  });

  beforeEach(async () => {
    testContext = await framework.createTestContext({
      name: 'End-to-End Scenario Test',
      agents: {
        count: 6,
        types: ['coordinator', 'researcher', 'coder', 'analyst', 'reviewer', 'tester']
      },
      providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || 'test-key' },
        openai: { apiKey: process.env.OPENAI_API_KEY || 'test-key' }
      },
      enableRealProviders: process.env.RUN_REAL_API_TESTS === 'true',
      enablePersistence: true,
      timeout: 180000 // 3 minutes for complex scenarios
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('Software Development Lifecycle Scenario', () => {
    it('should complete a full software development workflow', async () => {
      const { coordinator, workflowEngine, agents, providers } = testContext;
      
      // Define a realistic software development project
      const projectRequirements = {
        name: 'API Rate Limiter Service',
        description: 'Design and implement a distributed rate limiting service',
        requirements: [
          'Research existing rate limiting algorithms',
          'Design system architecture',
          'Implement core rate limiting logic',
          'Add Redis integration for distributed state',
          'Create comprehensive tests',
          'Write API documentation',
          'Perform security review'
        ],
        constraints: {
          technology: 'Node.js/TypeScript',
          performance: 'Handle 10k requests/second',
          reliability: '99.9% uptime'
        }
      };

      const scenarioEvents: any[] = [];
      const phaseCompletions: any[] = [];
      
      // Track scenario progress
      coordinator.on('phase:started', (event) => {
        scenarioEvents.push({ type: 'phase-started', ...event, timestamp: Date.now() });
      });
      
      coordinator.on('phase:completed', (event) => {
        phaseCompletions.push({ ...event, timestamp: Date.now() });
        scenarioEvents.push({ type: 'phase-completed', ...event, timestamp: Date.now() });
      });

      const { result: projectResult, duration: totalDuration } = await measureTime(async () => {
        // Phase 1: Requirements Analysis and Research
        const researchGoal = TestDataFactory.createGoal(
          'Research rate limiting algorithms and existing solutions', 
          8
        );
        const researchTeam = await coordinator.formTeam(researchGoal);
        const researchResult = await coordinator.executePhase('research', researchTeam.id, {
          goal: researchGoal,
          deliverables: ['algorithm_comparison', 'architecture_recommendations']
        });

        // Phase 2: System Design
        const designGoal = TestDataFactory.createGoal(
          'Design distributed rate limiter architecture',
          9
        );
        const designTeam = await coordinator.formTeam(designGoal);
        const designResult = await coordinator.executePhase('design', designTeam.id, {
          goal: designGoal,
          inputs: researchResult.outputs,
          deliverables: ['system_architecture', 'api_specification', 'database_schema']
        });

        // Phase 3: Implementation
        const implementationGoal = TestDataFactory.createGoal(
          'Implement rate limiter service with Redis backend',
          8
        );
        const codeTeam = await coordinator.formTeam(implementationGoal);
        const implementationResult = await coordinator.executePhase('implementation', codeTeam.id, {
          goal: implementationGoal,
          inputs: designResult.outputs,
          deliverables: ['core_service', 'redis_integration', 'api_endpoints']
        });

        // Phase 4: Testing and Validation
        const testingGoal = TestDataFactory.createGoal(
          'Create comprehensive test suite and validate performance',
          7
        );
        const testTeam = await coordinator.formTeam(testingGoal);
        const testingResult = await coordinator.executePhase('testing', testTeam.id, {
          goal: testingGoal,
          inputs: implementationResult.outputs,
          deliverables: ['unit_tests', 'integration_tests', 'performance_tests', 'security_tests']
        });

        // Phase 5: Documentation and Review
        const documentationGoal = TestDataFactory.createGoal(
          'Create documentation and perform security review',
          6
        );
        const reviewTeam = await coordinator.formTeam(documentationGoal);
        const reviewResult = await coordinator.executePhase('documentation', reviewTeam.id, {
          goal: documentationGoal,
          inputs: testingResult.outputs,
          deliverables: ['api_docs', 'deployment_guide', 'security_assessment']
        });

        return {
          phases: [researchResult, designResult, implementationResult, testingResult, reviewResult],
          success: true,
          deliverables: {
            research: researchResult.deliverables,
            design: designResult.deliverables,
            implementation: implementationResult.deliverables,
            testing: testingResult.deliverables,
            documentation: reviewResult.deliverables
          }
        };
      });

      // Validate scenario completion
      expect(projectResult.success).toBe(true);
      expect(projectResult.phases.length).toBe(5);
      expect(phaseCompletions.length).toBe(5);

      // Validate deliverables
      expect(projectResult.deliverables.research).toContain('algorithm_comparison');
      expect(projectResult.deliverables.design).toContain('system_architecture');
      expect(projectResult.deliverables.implementation).toContain('core_service');
      expect(projectResult.deliverables.testing).toContain('unit_tests');
      expect(projectResult.deliverables.documentation).toContain('api_docs');

      // Verify phase execution order and timing
      const phaseOrder = phaseCompletions.map(p => p.phase);
      expect(phaseOrder).toEqual(['research', 'design', 'implementation', 'testing', 'documentation']);

      framework.recordMetric(testContext.id, 'sdlc_scenario_duration', totalDuration);
      framework.recordMetric(testContext.id, 'sdlc_phases_completed', phaseCompletions.length);
      framework.recordMetric(testContext.id, 'sdlc_scenario_success', true);
      framework.recordMetric(testContext.id, 'sdlc_total_deliverables', 
        Object.values(projectResult.deliverables).flat().length);
    });

    it('should handle feature development with iterative feedback', async () => {
      const { coordinator, workflowEngine } = testContext;
      
      const featureRequest = {
        name: 'User Authentication System',
        description: 'Add OAuth2 and JWT-based authentication',
        acceptanceCriteria: [
          'Support Google and GitHub OAuth',
          'Generate and validate JWT tokens',
          'Role-based access control',
          'Password reset functionality'
        ],
        iterative: true,
        maxIterations: 3
      };

      const iterations: any[] = [];
      let currentIteration = 0;

      const { result: featureResult, duration } = await measureTime(async () => {
        while (currentIteration < featureRequest.maxIterations) {
          currentIteration++;
          
          const iterationStart = Date.now();
          
          // Development iteration
          const developmentGoal = TestDataFactory.createGoal(
            `Authentication feature development - iteration ${currentIteration}`,
            7
          );
          
          const devTeam = await coordinator.formTeam(developmentGoal);
          const devResult = await coordinator.executePhase(`dev-iteration-${currentIteration}`, devTeam.id, {
            goal: developmentGoal,
            iteration: currentIteration,
            previousFeedback: iterations.length > 0 ? iterations[iterations.length - 1].feedback : null
          });

          // Review and feedback
          const reviewGoal = TestDataFactory.createGoal(
            `Review authentication implementation - iteration ${currentIteration}`,
            6
          );
          
          const reviewTeam = await coordinator.formTeam(reviewGoal);
          const reviewResult = await coordinator.executePhase(`review-iteration-${currentIteration}`, reviewTeam.id, {
            goal: reviewGoal,
            implementation: devResult.outputs
          });

          const iterationResult = {
            iteration: currentIteration,
            development: devResult,
            review: reviewResult,
            duration: Date.now() - iterationStart,
            feedback: reviewResult.feedback,
            quality: reviewResult.qualityScore || 0.8,
            isComplete: reviewResult.qualityScore >= 0.9 || currentIteration >= featureRequest.maxIterations
          };

          iterations.push(iterationResult);

          if (iterationResult.isComplete) {
            break;
          }
        }

        return {
          success: true,
          iterations,
          finalQuality: iterations[iterations.length - 1].quality,
          totalIterations: iterations.length
        };
      });

      expect(featureResult.success).toBe(true);
      expect(featureResult.iterations.length).toBeGreaterThan(0);
      expect(featureResult.iterations.length).toBeLessThanOrEqual(featureRequest.maxIterations);

      // Should show quality improvement over iterations
      if (featureResult.iterations.length > 1) {
        const firstQuality = featureResult.iterations[0].quality;
        const lastQuality = featureResult.iterations[featureResult.iterations.length - 1].quality;
        expect(lastQuality).toBeGreaterThanOrEqual(firstQuality);
      }

      framework.recordMetric(testContext.id, 'iterative_development_duration', duration);
      framework.recordMetric(testContext.id, 'iterative_development_iterations', featureResult.totalIterations);
      framework.recordMetric(testContext.id, 'iterative_development_final_quality', featureResult.finalQuality);
    });
  });

  describe('Research and Analysis Scenario', () => {
    it('should complete a comprehensive research project', async () => {
      const { coordinator, agents, providers } = testContext;
      
      const researchProject = {
        topic: 'Impact of Large Language Models on Software Development Productivity',
        scope: [
          'Literature review of recent studies',
          'Analysis of developer workflow changes',
          'Productivity metrics comparison',
          'Tool adoption patterns',
          'Future trend predictions'
        ],
        methodology: 'systematic_review',
        timeframe: '2020-2024'
      };

      const researchPhases: any[] = [];
      
      const { result: researchResult, duration } = await measureTime(async () => {
        // Phase 1: Literature Review
        const literatureGoal = TestDataFactory.createGoal(
          'Conduct comprehensive literature review on LLMs and developer productivity',
          8
        );
        
        const literatureTeam = await coordinator.formTeam(literatureGoal);
        const literatureResult = await coordinator.executePhase('literature-review', literatureTeam.id, {
          goal: literatureGoal,
          searchTerms: ['large language models', 'developer productivity', 'code generation', 'AI coding assistants'],
          sources: ['ACM', 'IEEE', 'arXiv', 'Google Scholar'],
          timeframe: researchProject.timeframe
        });

        researchPhases.push({ phase: 'literature-review', result: literatureResult });

        // Phase 2: Data Collection and Analysis
        const analysisGoal = TestDataFactory.createGoal(
          'Analyze collected research data and identify patterns',
          7
        );
        
        const analysisTeam = await coordinator.formTeam(analysisGoal);
        const analysisResult = await coordinator.executePhase('data-analysis', analysisTeam.id, {
          goal: analysisGoal,
          inputs: literatureResult.outputs,
          methods: ['statistical_analysis', 'thematic_analysis', 'meta_analysis']
        });

        researchPhases.push({ phase: 'data-analysis', result: analysisResult });

        // Phase 3: Synthesis and Recommendations
        const synthesisGoal = TestDataFactory.createGoal(
          'Synthesize findings and develop recommendations',
          8
        );
        
        const synthesisTeam = await coordinator.formTeam(synthesisGoal);
        const synthesisResult = await coordinator.executePhase('synthesis', synthesisTeam.id, {
          goal: synthesisGoal,
          inputs: analysisResult.outputs,
          deliverables: ['executive_summary', 'detailed_findings', 'recommendations', 'future_research']
        });

        researchPhases.push({ phase: 'synthesis', result: synthesisResult });

        return {
          success: true,
          phases: researchPhases,
          findings: synthesisResult.findings,
          recommendations: synthesisResult.recommendations
        };
      });

      expect(researchResult.success).toBe(true);
      expect(researchResult.phases.length).toBe(3);
      expect(researchResult.findings).toBeDefined();
      expect(researchResult.recommendations).toBeDefined();

      // Validate research quality
      const qualityMetrics = researchResult.phases.map(p => p.result.qualityScore || 0.8);
      const avgQuality = qualityMetrics.reduce((a, b) => a + b, 0) / qualityMetrics.length;
      expect(avgQuality).toBeGreaterThan(0.7);

      framework.recordMetric(testContext.id, 'research_project_duration', duration);
      framework.recordMetric(testContext.id, 'research_phases_completed', researchResult.phases.length);
      framework.recordMetric(testContext.id, 'research_avg_quality', avgQuality);
      framework.recordMetric(testContext.id, 'research_project_success', true);
    });

    it('should handle collaborative analysis with multiple data sources', async () => {
      const { coordinator, providers } = testContext;
      
      const analysisProject = {
        title: 'Multi-Source Data Analysis for Market Trends',
        dataSources: [
          { type: 'api', name: 'market_data_api', format: 'json' },
          { type: 'database', name: 'customer_database', format: 'sql' },
          { type: 'files', name: 'survey_responses', format: 'csv' },
          { type: 'external', name: 'industry_reports', format: 'pdf' }
        ],
        analysisTypes: ['statistical', 'trend', 'correlation', 'predictive'],
        outputFormats: ['dashboard', 'report', 'recommendations']
      };

      const dataProcessingResults: any[] = [];
      
      const { result: analysisResult, duration } = await measureTime(async () => {
        // Process each data source in parallel
        const dataProcessingPromises = analysisProject.dataSources.map(async (source) => {
          const processingGoal = TestDataFactory.createGoal(
            `Process and clean data from ${source.name}`,
            6
          );
          
          const processingTeam = await coordinator.formTeam(processingGoal);
          return await coordinator.executePhase(`data-processing-${source.name}`, processingTeam.id, {
            goal: processingGoal,
            dataSource: source,
            preprocessing: ['cleaning', 'validation', 'normalization']
          });
        });

        const processedData = await Promise.all(dataProcessingPromises);
        dataProcessingResults.push(...processedData);

        // Integrated analysis
        const integratedAnalysisGoal = TestDataFactory.createGoal(
          'Perform integrated analysis across all data sources',
          9
        );
        
        const analysisTeam = await coordinator.formTeam(integratedAnalysisGoal);
        const integratedResult = await coordinator.executePhase('integrated-analysis', analysisTeam.id, {
          goal: integratedAnalysisGoal,
          processedData: processedData.map(p => p.outputs),
          analysisTypes: analysisProject.analysisTypes
        });

        // Generate outputs
        const outputGoal = TestDataFactory.createGoal(
          'Generate analysis outputs and visualizations',
          7
        );
        
        const outputTeam = await coordinator.formTeam(outputGoal);
        const outputResult = await coordinator.executePhase('output-generation', outputTeam.id, {
          goal: outputGoal,
          analysisResults: integratedResult.outputs,
          outputFormats: analysisProject.outputFormats
        });

        return {
          success: true,
          dataSourcesProcessed: processedData.length,
          analysisResults: integratedResult,
          outputs: outputResult.deliverables
        };
      });

      expect(analysisResult.success).toBe(true);
      expect(analysisResult.dataSourcesProcessed).toBe(analysisProject.dataSources.length);
      expect(analysisResult.outputs).toBeDefined();
      expect(dataProcessingResults.length).toBe(analysisProject.dataSources.length);

      framework.recordMetric(testContext.id, 'multi_source_analysis_duration', duration);
      framework.recordMetric(testContext.id, 'data_sources_processed', analysisResult.dataSourcesProcessed);
      framework.recordMetric(testContext.id, 'multi_source_analysis_success', true);
    });
  });

  describe('Crisis Response Scenario', () => {
    it('should handle urgent system outage response', async () => {
      const { coordinator, workflowEngine } = testContext;
      
      const crisisScenario = {
        type: 'system_outage',
        severity: 'critical',
        description: 'Database cluster failure causing complete service unavailability',
        affectedSystems: ['user_api', 'payment_service', 'notification_system'],
        estimatedUsers: 50000,
        businessImpact: 'high'
      };

      const responseEvents: any[] = [];
      const escalationLevels: string[] = [];
      
      // Track crisis response
      coordinator.on('crisis:escalated', (event) => {
        escalationLevels.push(event.level);
        responseEvents.push({ type: 'escalation', ...event, timestamp: Date.now() });
      });

      const { result: responseResult, duration } = await measureTime(async () => {
        // Immediate Response (0-5 minutes)
        const immediateGoal = TestDataFactory.createGoal(
          'Immediate assessment and emergency response',
          10 // Highest priority
        );
        
        const emergencyTeam = await coordinator.formEmergencyTeam(immediateGoal, {
          skills: ['infrastructure', 'database', 'monitoring'],
          maxSize: 3,
          responseTime: 'immediate'
        });

        const immediateResponse = await coordinator.executePhase('immediate-response', emergencyTeam.id, {
          goal: immediateGoal,
          actions: [
            'assess_system_status',
            'identify_root_cause',
            'implement_emergency_fixes',
            'activate_backup_systems'
          ],
          timeLimit: 300000 // 5 minutes
        });

        // Short-term Stabilization (5-30 minutes)
        const stabilizationGoal = TestDataFactory.createGoal(
          'Stabilize systems and restore basic functionality',
          9
        );
        
        const stabilizationTeam = await coordinator.expandTeam(emergencyTeam.id, {
          additionalSkills: ['frontend', 'backend', 'devops'],
          maxSize: 6
        });

        const stabilizationResponse = await coordinator.executePhase('stabilization', stabilizationTeam.id, {
          goal: stabilizationGoal,
          inputs: immediateResponse.outputs,
          actions: [
            'restore_database_cluster',
            'verify_data_integrity',
            'restart_affected_services',
            'monitor_system_health'
          ],
          timeLimit: 1800000 // 30 minutes
        });

        // Full Recovery and Analysis (30+ minutes)
        const recoveryGoal = TestDataFactory.createGoal(
          'Complete system recovery and post-incident analysis',
          8
        );
        
        const recoveryTeam = await coordinator.formTeam(recoveryGoal);
        const recoveryResponse = await coordinator.executePhase('recovery', recoveryTeam.id, {
          goal: recoveryGoal,
          inputs: stabilizationResponse.outputs,
          actions: [
            'full_system_restoration',
            'performance_optimization',
            'incident_documentation',
            'preventive_measures'
          ]
        });

        return {
          success: true,
          phases: [immediateResponse, stabilizationResponse, recoveryResponse],
          systemsRestored: crisisScenario.affectedSystems.length,
          downtime: duration,
          responseQuality: (immediateResponse.qualityScore + stabilizationResponse.qualityScore + recoveryResponse.qualityScore) / 3
        };
      });

      expect(responseResult.success).toBe(true);
      expect(responseResult.phases.length).toBe(3);
      expect(responseResult.systemsRestored).toBe(crisisScenario.affectedSystems.length);
      expect(escalationLevels.length).toBeGreaterThan(0);

      // Crisis should be resolved quickly
      expect(duration).toBeLessThan(3600000); // Less than 1 hour for test scenario
      
      framework.recordMetric(testContext.id, 'crisis_response_duration', duration);
      framework.recordMetric(testContext.id, 'crisis_response_phases', responseResult.phases.length);
      framework.recordMetric(testContext.id, 'crisis_response_quality', responseResult.responseQuality);
      framework.recordMetric(testContext.id, 'crisis_systems_restored', responseResult.systemsRestored);
      framework.recordMetric(testContext.id, 'crisis_escalations', escalationLevels.length);
    });

    it('should coordinate multiple teams during security incident', async () => {
      const { coordinator } = testContext;
      
      const securityIncident = {
        type: 'data_breach_suspected',
        severity: 'high',
        description: 'Unusual access patterns detected in user database',
        potentialDataExposed: ['email_addresses', 'encrypted_passwords', 'user_profiles'],
        detectionTime: Date.now(),
        requiresCompliance: true
      };

      const securityResponse: any[] = [];
      
      const { result: incidentResult, duration } = await measureTime(async () => {
        // Security Assessment Team
        const assessmentGoal = TestDataFactory.createGoal(
          'Assess security breach scope and impact',
          10
        );
        
        const securityTeam = await coordinator.formSpecializedTeam(assessmentGoal, {
          specialization: 'security',
          skills: ['threat_analysis', 'forensics', 'compliance'],
          clearanceLevel: 'high'
        });

        const assessmentResult = await coordinator.executePhase('security-assessment', securityTeam.id, {
          goal: assessmentGoal,
          incident: securityIncident,
          urgency: 'critical'
        });

        securityResponse.push({ team: 'security', result: assessmentResult });

        // Technical Response Team
        const technicalGoal = TestDataFactory.createGoal(
          'Implement technical countermeasures and system hardening',
          9
        );
        
        const technicalTeam = await coordinator.formSpecializedTeam(technicalGoal, {
          specialization: 'infrastructure',
          skills: ['security_engineering', 'system_administration', 'network_security']
        });

        const technicalResult = await coordinator.executePhase('technical-response', technicalTeam.id, {
          goal: technicalGoal,
          assessmentFindings: assessmentResult.outputs,
          urgency: 'high'
        });

        securityResponse.push({ team: 'technical', result: technicalResult });

        // Legal and Compliance Team
        const complianceGoal = TestDataFactory.createGoal(
          'Handle legal requirements and compliance obligations',
          8
        );
        
        const complianceTeam = await coordinator.formSpecializedTeam(complianceGoal, {
          specialization: 'compliance',
          skills: ['legal_analysis', 'regulatory_compliance', 'incident_reporting']
        });

        const complianceResult = await coordinator.executePhase('compliance-response', complianceTeam.id, {
          goal: complianceGoal,
          incidentData: assessmentResult.outputs,
          regulatoryRequirements: ['GDPR', 'CCPA', 'SOX']
        });

        securityResponse.push({ team: 'compliance', result: complianceResult });

        // Communications Team
        const communicationsGoal = TestDataFactory.createGoal(
          'Manage internal and external communications',
          7
        );
        
        const commsTeam = await coordinator.formSpecializedTeam(communicationsGoal, {
          specialization: 'communications',
          skills: ['crisis_communication', 'stakeholder_management', 'media_relations']
        });

        const commsResult = await coordinator.executePhase('communications', commsTeam.id, {
          goal: communicationsGoal,
          incidentSummary: assessmentResult.summary,
          stakeholders: ['customers', 'employees', 'regulators', 'media']
        });

        securityResponse.push({ team: 'communications', result: commsResult });

        return {
          success: true,
          teamsCoordinated: securityResponse.length,
          incidentContained: technicalResult.containmentSuccess,
          complianceMet: complianceResult.requirementsMet,
          communicationsSent: commsResult.messagesSent
        };
      });

      expect(incidentResult.success).toBe(true);
      expect(incidentResult.teamsCoordinated).toBe(4);
      expect(securityResponse.length).toBe(4);

      // Verify all specialized teams responded
      const teamTypes = securityResponse.map(r => r.team);
      expect(teamTypes).toContain('security');
      expect(teamTypes).toContain('technical');
      expect(teamTypes).toContain('compliance');
      expect(teamTypes).toContain('communications');

      framework.recordMetric(testContext.id, 'security_incident_duration', duration);
      framework.recordMetric(testContext.id, 'security_teams_coordinated', incidentResult.teamsCoordinated);
      framework.recordMetric(testContext.id, 'security_incident_success', true);
    });
  });

  describe('Scenario Performance and Metrics', () => {
    it('should provide comprehensive end-to-end scenario metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      console.log('\n=== End-to-End Scenario Integration Test Metrics ===');
      console.log('Total Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate?.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('P95 Latency:', stats?.latency?.p95?.toFixed(2) + 'ms' || 'N/A');
      console.log('P99 Latency:', stats?.latency?.p99?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      console.log('Memory Usage:', (stats?.resourceUsage?.memory / 1024 / 1024)?.toFixed(2) + 'MB' || 'N/A');
      
      if (metrics?.customMetrics) {
        console.log('\nScenario-Specific Metrics:');
        const sortedMetrics = Array.from(metrics.customMetrics.entries()).sort(([a], [b]) => a.localeCompare(b));
        sortedMetrics.forEach(([key, value]) => {
          if (typeof value === 'number') {
            console.log(`  ${key}: ${value.toFixed(2)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });
      }
      console.log('====================================================\n');
      
      // Validate scenario complexity handling
      if (metrics?.customMetrics) {
        const scenarioMetrics = Array.from(metrics.customMetrics.entries());
        const successMetrics = scenarioMetrics.filter(([key, value]) => 
          key.includes('success') && value === true
        );
        
        expect(successMetrics.length).toBeGreaterThan(0);
        framework.recordMetric(testContext.id, 'total_successful_scenarios', successMetrics.length);
      }
    });
  });
});