/**
 * Cross-Component Integration Tests
 * Tests integration between all major components working together
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { IntegrationTestFramework, IntegrationTestContext, waitForEvent, measureTime, TestDataFactory } from './test-infrastructure';

describe('Cross-Component Integration Tests', () => {
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
      name: 'Cross-Component Integration Test',
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
      timeout: 240000 // 4 minutes for complex integration tests
    });
  });

  afterEach(async () => {
    await testContext.cleanup();
  });

  describe('Full System Integration', () => {
    it('should integrate all components in a complete workflow', async () => {
      const { coordinator, workflowEngine, agents, providers } = testContext;
      
      const fullSystemTest = {
        objective: 'Complete system integration test with all components',
        phases: [
          'initialization',
          'team_formation',
          'workflow_execution',
          'provider_coordination',
          'result_aggregation'
        ]
      };

      const integrationResults = {
        phaseResults: [] as any[],
        componentInteractions: [] as any[],
        dataFlow: [] as any[],
        crossComponentCalls: 0
      };

      const { result: systemResult, duration: totalDuration } = await measureTime(async () => {
        // Phase 1: System Initialization
        const { result: initResult, duration: initDuration } = await measureTime(async () => {
          // Verify all components are initialized and healthy
          const providersHealth = await providers.getHealth();
          const agentsStatus = Array.from(agents.values()).map(agent => ({
            id: agent.id,
            status: agent.getState(),
            capabilities: agent.getCapabilities()
          }));
          const workflowEngineStatus = await workflowEngine.getHealthStatus();

          integrationResults.componentInteractions.push({
            phase: 'initialization',
            interaction: 'health_check',
            components: ['providers', 'agents', 'workflow_engine'],
            timestamp: Date.now()
          });

          return {
            providersHealthy: Object.values(providersHealth).every((p: any) => p.healthy),
            agentsReady: agentsStatus.every(a => a.status.energy > 0),
            workflowEngineReady: workflowEngineStatus.status === 'healthy',
            totalComponents: Object.keys(providersHealth).length + agentsStatus.length + 1
          };
        });

        integrationResults.phaseResults.push({
          phase: 'initialization',
          duration: initDuration,
          success: initResult.providersHealthy && initResult.agentsReady && initResult.workflowEngineReady,
          metrics: initResult
        });

        // Phase 2: Multi-Component Team Formation
        const { result: teamResult, duration: teamDuration } = await measureTime(async () => {
          const complexGoal = TestDataFactory.createGoal(
            'Design and implement a distributed caching system with monitoring',
            9
          );

          // Use coordinator to form team with provider consultation
          integrationResults.crossComponentCalls++;
          const team = await coordinator.formTeam(complexGoal);
          
          // Validate team formation used multiple components
          integrationResults.componentInteractions.push({
            phase: 'team_formation',
            interaction: 'goal_analysis',
            components: ['coordinator', 'agents', 'providers'],
            timestamp: Date.now(),
            teamSize: team.members.length
          });

          // Each agent should have consulted providers for capability assessment
          const capabilityAssessments = await Promise.all(
            team.members.map(async (member) => {
              integrationResults.crossComponentCalls++;
              return await providers.complete({
                model: 'claude-3-haiku',
                messages: [
                  { 
                    role: 'user', 
                    content: `Assess capability fit for agent ${member.type} on goal: ${complexGoal.description}` 
                  }
                ],
                maxTokens: 100
              });
            })
          );

          return {
            teamFormed: team,
            capabilityAssessments: capabilityAssessments.length,
            goalComplexity: complexGoal.priority,
            agentDiversity: new Set(team.members.map(m => m.type)).size
          };
        });

        integrationResults.phaseResults.push({
          phase: 'team_formation',
          duration: teamDuration,
          success: teamResult.teamFormed && teamResult.capabilityAssessments > 0,
          metrics: teamResult
        });

        // Phase 3: Workflow Execution with Agent-Provider Integration
        const { result: workflowResult, duration: workflowDuration } = await measureTime(async () => {
          const workflowDefinition = TestDataFactory.createWorkflowDefinition(
            'Cross-Component Workflow',
            'complex'
          );

          // Enhance workflow with cross-component steps
          workflowDefinition.nodes.push(
            {
              id: 'provider_consultation',
              type: 'agent-task',
              name: 'Consult Multiple Providers',
              config: { requiresProviderCall: true }
            },
            {
              id: 'agent_collaboration',
              type: 'agent-task',
              name: 'Multi-Agent Collaboration',
              config: { requiresTeamwork: true }
            },
            {
              id: 'result_synthesis',
              type: 'agent-task',
              name: 'Synthesize Results',
              config: { requiresDataAggregation: true }
            }
          );

          integrationResults.crossComponentCalls++;
          const instanceId = await workflowEngine.startWorkflow(workflowDefinition, {
            integrationTest: true,
            team: teamResult.teamFormed,
            crossComponentEnabled: true
          });

          // Track workflow execution with component interactions
          const workflowEvents: any[] = [];
          workflowEngine.on('workflow:step-started', (event) => {
            workflowEvents.push({ type: 'step-started', ...event, timestamp: Date.now() });
            integrationResults.componentInteractions.push({
              phase: 'workflow_execution',
              interaction: 'step_execution',
              components: ['workflow_engine', 'agents'],
              stepId: event.stepId,
              timestamp: Date.now()
            });
          });

          workflowEngine.on('workflow:step-completed', (event) => {
            workflowEvents.push({ type: 'step-completed', ...event, timestamp: Date.now() });
            if (event.providerCalls) {
              integrationResults.crossComponentCalls += event.providerCalls;
            }
          });

          // Wait for workflow completion
          await waitForEvent(workflowEngine, 'workflow:completed', 120000);
          
          const workflowInstance = await workflowEngine.getWorkflowInstance(instanceId);
          
          return {
            workflowCompleted: workflowInstance.status === 'completed',
            stepsExecuted: workflowEvents.filter(e => e.type === 'step-completed').length,
            workflowEvents: workflowEvents.length,
            outputs: workflowInstance.context.outputs
          };
        });

        integrationResults.phaseResults.push({
          phase: 'workflow_execution',
          duration: workflowDuration,
          success: workflowResult.workflowCompleted,
          metrics: workflowResult
        });

        // Phase 4: Provider Coordination and Fallback
        const { result: providerResult, duration: providerDuration } = await measureTime(async () => {
          const multiProviderRequests = [
            {
              model: 'claude-3-haiku',
              messages: [{ role: 'user', content: 'Analyze system performance metrics' }],
              maxTokens: 50
            },
            {
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: 'Generate code documentation' }],
              maxTokens: 50
            },
            {
              model: 'auto', // Let provider manager choose
              messages: [{ role: 'user', content: 'Optimize query performance' }],
              maxTokens: 50
            }
          ];

          const providerResponses = await Promise.all(
            multiProviderRequests.map(async (request, index) => {
              try {
                integrationResults.crossComponentCalls++;
                const response = await providers.complete(request);
                
                integrationResults.componentInteractions.push({
                  phase: 'provider_coordination',
                  interaction: 'provider_request',
                  components: ['providers'],
                  requestIndex: index,
                  success: true,
                  timestamp: Date.now()
                });

                return { success: true, response, index };
              } catch (error) {
                integrationResults.componentInteractions.push({
                  phase: 'provider_coordination',
                  interaction: 'provider_fallback',
                  components: ['providers'],
                  requestIndex: index,
                  success: false,
                  timestamp: Date.now()
                });
                return { success: false, error, index };
              }
            })
          );

          return {
            totalRequests: multiProviderRequests.length,
            successfulResponses: providerResponses.filter(r => r.success).length,
            failedResponses: providerResponses.filter(r => !r.success).length,
            providerDiversity: new Set(multiProviderRequests.map(r => r.model)).size
          };
        });

        integrationResults.phaseResults.push({
          phase: 'provider_coordination',
          duration: providerDuration,
          success: providerResult.successfulResponses > 0,
          metrics: providerResult
        });

        // Phase 5: Result Aggregation and Cross-Component Data Flow
        const { result: aggregationResult, duration: aggregationDuration } = await measureTime(async () => {
          const aggregationGoal = TestDataFactory.createGoal(
            'Aggregate and analyze all system test results',
            7
          );

          // Use coordinator to aggregate results from all phases
          integrationResults.crossComponentCalls++;
          const aggregationTeam = await coordinator.formSpecializedTeam(aggregationGoal, {
            specialization: 'analysis',
            skills: ['data_aggregation', 'result_synthesis', 'reporting']
          });

          // Collect data from all components
          const systemData = {
            providerMetrics: providers.getMetrics(),
            agentStates: Array.from(agents.values()).map(agent => ({
              id: agent.id,
              state: agent.getState(),
              experiences: agent.getExperiences().length
            })),
            workflowMetrics: await workflowEngine.getSystemMetrics(),
            coordinationMetrics: await coordinator.getMetrics()
          };

          integrationResults.dataFlow.push({
            source: 'all_components',
            destination: 'aggregation_team',
            dataSize: JSON.stringify(systemData).length,
            timestamp: Date.now()
          });

          // Generate comprehensive analysis using provider
          integrationResults.crossComponentCalls++;
          const analysisResponse = await providers.complete({
            model: 'claude-3-haiku',
            messages: [
              {
                role: 'user',
                content: `Analyze this system integration test data: ${JSON.stringify(systemData, null, 2)}`
              }
            ],
            maxTokens: 200
          });

          return {
            dataAggregated: Object.keys(systemData).length,
            analysisGenerated: !!analysisResponse.choices[0]?.message?.content,
            teamFormed: aggregationTeam.members.length > 0,
            totalDataSize: JSON.stringify(systemData).length
          };
        });

        integrationResults.phaseResults.push({
          phase: 'result_aggregation',
          duration: aggregationDuration,
          success: aggregationResult.dataAggregated > 0 && aggregationResult.analysisGenerated,
          metrics: aggregationResult
        });

        return {
          phasesCompleted: integrationResults.phaseResults.length,
          successfulPhases: integrationResults.phaseResults.filter(p => p.success).length,
          totalCrossComponentCalls: integrationResults.crossComponentCalls,
          componentInteractions: integrationResults.componentInteractions.length,
          dataFlowEvents: integrationResults.dataFlow.length
        };
      });

      // Validate full system integration
      const integrationSuccess = systemResult.successfulPhases === fullSystemTest.phases.length;
      const componentCoverage = new Set(
        integrationResults.componentInteractions.map(i => i.components).flat()
      ).size;

      framework.recordMetric(testContext.id, 'full_system_integration_duration', totalDuration);
      framework.recordMetric(testContext.id, 'integration_phases_completed', systemResult.phasesCompleted);
      framework.recordMetric(testContext.id, 'integration_success_rate', (systemResult.successfulPhases / systemResult.phasesCompleted) * 100);
      framework.recordMetric(testContext.id, 'cross_component_calls', systemResult.totalCrossComponentCalls);
      framework.recordMetric(testContext.id, 'component_interactions', systemResult.componentInteractions);
      framework.recordMetric(testContext.id, 'component_coverage', componentCoverage);

      expect(integrationSuccess).toBe(true);
      expect(systemResult.totalCrossComponentCalls).toBeGreaterThan(10);
      expect(componentCoverage).toBeGreaterThanOrEqual(4); // At least 4 different component types involved

      console.log('Full System Integration Results:', {
        totalDuration: totalDuration.toFixed(2) + 'ms',
        phasesCompleted: systemResult.phasesCompleted,
        successfulPhases: systemResult.successfulPhases,
        crossComponentCalls: systemResult.totalCrossComponentCalls,
        componentInteractions: systemResult.componentInteractions,
        componentCoverage
      });
    });

    it('should handle complex data flow between components', async () => {
      const { coordinator, workflowEngine, providers, agents } = testContext;
      
      const dataFlowTest = {
        stages: [
          'data_ingestion',
          'multi_agent_processing',
          'provider_enhancement',
          'workflow_orchestration',
          'result_synthesis'
        ]
      };

      const dataFlowMetrics = {
        dataTransfers: [] as any[],
        transformations: [] as any[],
        dataIntegrity: true,
        componentLatencies: new Map<string, number[]>()
      };

      const { result: dataFlowResult, duration } = await measureTime(async () => {
        // Stage 1: Data Ingestion
        const inputData = {
          requirements: 'Build a scalable microservices architecture',
          constraints: { budget: 100000, timeline: '3 months', team_size: 8 },
          preferences: { technology: 'Node.js', database: 'PostgreSQL', cloud: 'AWS' },
          metadata: { requestId: 'DF001', priority: 'high', stakeholders: ['CTO', 'Lead Engineer'] }
        };

        const dataChecksum = this.calculateChecksum(JSON.stringify(inputData));
        dataFlowMetrics.dataTransfers.push({
          stage: 'ingestion',
          source: 'external',
          destination: 'system',
          size: JSON.stringify(inputData).length,
          checksum: dataChecksum,
          timestamp: Date.now()
        });

        // Stage 2: Multi-Agent Processing
        const processingTeam = await coordinator.formTeam(
          TestDataFactory.createGoal('Process architecture requirements', 8)
        );

        const agentProcessingResults = await Promise.all(
          processingTeam.members.slice(0, 3).map(async (agent, index) => {
            const startTime = Date.now();
            
            // Each agent processes different aspects of the data
            const aspectMap = ['requirements', 'constraints', 'preferences'];
            const aspect = aspectMap[index % aspectMap.length];
            const agentInput = { [aspect]: inputData[aspect], metadata: inputData.metadata };
            
            // Simulate agent processing with data transformation
            const transformedData = {
              ...agentInput,
              processedBy: agent.id,
              processingTimestamp: Date.now(),
              insights: `Analysis of ${aspect} by ${agent.type}`,
              recommendations: [`Recommendation 1 for ${aspect}`, `Recommendation 2 for ${aspect}`]
            };

            const processingTime = Date.now() - startTime;
            if (!dataFlowMetrics.componentLatencies.has(agent.type)) {
              dataFlowMetrics.componentLatencies.set(agent.type, []);
            }
            dataFlowMetrics.componentLatencies.get(agent.type)!.push(processingTime);

            dataFlowMetrics.dataTransfers.push({
              stage: 'agent_processing',
              source: 'coordinator',
              destination: agent.id,
              size: JSON.stringify(agentInput).length,
              timestamp: Date.now()
            });

            dataFlowMetrics.transformations.push({
              agent: agent.id,
              inputSize: JSON.stringify(agentInput).length,
              outputSize: JSON.stringify(transformedData).length,
              transformationType: 'analysis_enhancement',
              timestamp: Date.now()
            });

            return transformedData;
          })
        );

        // Stage 3: Provider Enhancement
        const enhancedResults = await Promise.all(
          agentProcessingResults.map(async (agentResult, index) => {
            const startTime = Date.now();
            
            const providerResponse = await providers.complete({
              model: 'claude-3-haiku',
              messages: [
                {
                  role: 'user',
                  content: `Enhance this analysis with additional insights: ${JSON.stringify(agentResult)}`
                }
              ],
              maxTokens: 150
            });

            const enhancedData = {
              ...agentResult,
              providerEnhancement: providerResponse.choices[0]?.message?.content,
              enhancementTimestamp: Date.now(),
              tokenUsage: providerResponse.usage
            };

            const enhancementTime = Date.now() - startTime;
            if (!dataFlowMetrics.componentLatencies.has('providers')) {
              dataFlowMetrics.componentLatencies.set('providers', []);
            }
            dataFlowMetrics.componentLatencies.get('providers')!.push(enhancementTime);

            dataFlowMetrics.dataTransfers.push({
              stage: 'provider_enhancement',
              source: agentResult.processedBy,
              destination: 'providers',
              size: JSON.stringify(agentResult).length,
              timestamp: Date.now()
            });

            dataFlowMetrics.transformations.push({
              component: 'providers',
              inputSize: JSON.stringify(agentResult).length,
              outputSize: JSON.stringify(enhancedData).length,
              transformationType: 'llm_enhancement',
              timestamp: Date.now()
            });

            return enhancedData;
          })
        );

        // Stage 4: Workflow Orchestration
        const workflowData = {
          id: 'data-flow-workflow',
          inputData: inputData,
          processedData: agentProcessingResults,
          enhancedData: enhancedResults,
          orchestrationRules: ['sequential_processing', 'data_validation', 'result_aggregation']
        };

        const workflow = TestDataFactory.createWorkflowDefinition('Data Flow Orchestration', 'complex');
        const workflowStartTime = Date.now();
        const instanceId = await workflowEngine.startWorkflow(workflow, workflowData);
        
        await waitForEvent(workflowEngine, 'workflow:completed', 60000);
        const workflowTime = Date.now() - workflowStartTime;
        
        if (!dataFlowMetrics.componentLatencies.has('workflow_engine')) {
          dataFlowMetrics.componentLatencies.set('workflow_engine', []);
        }
        dataFlowMetrics.componentLatencies.get('workflow_engine')!.push(workflowTime);

        const workflowInstance = await workflowEngine.getWorkflowInstance(instanceId);

        dataFlowMetrics.dataTransfers.push({
          stage: 'workflow_orchestration',
          source: 'enhanced_data',
          destination: 'workflow_engine',
          size: JSON.stringify(workflowData).length,
          timestamp: Date.now()
        });

        // Stage 5: Result Synthesis
        const finalResult = {
          originalRequirements: inputData,
          agentAnalyses: agentProcessingResults,
          enhancedInsights: enhancedResults,
          workflowOutputs: workflowInstance.context.outputs,
          synthesizedRecommendations: enhancedResults.map(r => r.recommendations).flat(),
          dataIntegrityCheck: this.calculateChecksum(JSON.stringify(inputData)) === dataChecksum,
          processingMetadata: {
            totalProcessingTime: Date.now() - dataFlowMetrics.dataTransfers[0].timestamp,
            componentCount: dataFlowMetrics.componentLatencies.size,
            transformationCount: dataFlowMetrics.transformations.length,
            dataTransferCount: dataFlowMetrics.dataTransfers.length
          }
        };

        dataFlowMetrics.dataIntegrity = finalResult.dataIntegrityCheck;

        return finalResult;
      });

      // Analyze data flow metrics
      const totalDataTransferred = dataFlowMetrics.dataTransfers.reduce((sum, transfer) => sum + transfer.size, 0);
      const avgComponentLatency = Array.from(dataFlowMetrics.componentLatencies.values())
        .flat()
        .reduce((sum, latency) => sum + latency, 0) / 
        Array.from(dataFlowMetrics.componentLatencies.values()).flat().length;
      
      const dataAmplification = dataFlowMetrics.transformations.reduce((sum, t) => sum + t.outputSize, 0) /
        dataFlowMetrics.transformations.reduce((sum, t) => sum + t.inputSize, 0);

      framework.recordMetric(testContext.id, 'data_flow_duration', duration);
      framework.recordMetric(testContext.id, 'data_flow_stages_completed', dataFlowTest.stages.length);
      framework.recordMetric(testContext.id, 'total_data_transferred', totalDataTransferred);
      framework.recordMetric(testContext.id, 'data_transformations', dataFlowMetrics.transformations.length);
      framework.recordMetric(testContext.id, 'avg_component_latency', avgComponentLatency);
      framework.recordMetric(testContext.id, 'data_amplification_ratio', dataAmplification);
      framework.recordMetric(testContext.id, 'data_integrity_maintained', dataFlowMetrics.dataIntegrity);

      expect(dataFlowResult.dataIntegrityCheck).toBe(true);
      expect(dataFlowMetrics.transformations.length).toBeGreaterThan(6); // Multiple transformations
      expect(dataAmplification).toBeGreaterThan(1.5); // Data should be enhanced
      expect(dataFlowMetrics.componentLatencies.size).toBeGreaterThanOrEqual(3); // Multiple components involved

      console.log('Data Flow Test Results:', {
        duration: duration.toFixed(2) + 'ms',
        dataTransferred: totalDataTransferred + ' bytes',
        transformations: dataFlowMetrics.transformations.length,
        avgLatency: avgComponentLatency.toFixed(2) + 'ms',
        dataAmplification: dataAmplification.toFixed(2) + 'x',
        dataIntegrity: dataFlowMetrics.dataIntegrity
      });
    });

    // Helper method for data integrity checking
    calculateChecksum(data: string): string {
      let hash = 0;
      for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString(16);
    }
  });

  describe('Component Failure Cascading', () => {
    it('should prevent failure cascades across components', async () => {
      const { coordinator, workflowEngine, providers, agents } = testContext;
      
      const cascadeTest = {
        failureScenarios: [
          {
            name: 'provider_cascade',
            initialFailure: 'provider',
            description: 'Provider failure should not cascade to other components'
          },
          {
            name: 'agent_cascade',
            initialFailure: 'agent',
            description: 'Agent failure should not cascade to workflows'
          },
          {
            name: 'workflow_cascade',
            initialFailure: 'workflow',
            description: 'Workflow failure should not affect agent coordination'
          }
        ]
      };

      const cascadeResults: any[] = [];

      for (const scenario of cascadeTest.failureScenarios) {
        const { result: scenarioResult, duration } = await measureTime(async () => {
          const componentStates = {
            beforeFailure: await this.captureSystemState(testContext),
            duringFailure: null as any,
            afterRecovery: null as any
          };

          let cleanupFunction: () => void = () => {};
          
          try {
            // Simulate component failure
            switch (scenario.initialFailure) {
              case 'provider':
                const originalComplete = providers.complete.bind(providers);
                providers.complete = async () => {
                  throw new Error('Simulated provider failure');
                };
                cleanupFunction = () => { providers.complete = originalComplete; };
                break;

              case 'agent':
                const targetAgent = Array.from(agents.values())[0];
                await targetAgent.pause();
                cleanupFunction = () => targetAgent.resume();
                break;

              case 'workflow':
                const originalStartWorkflow = workflowEngine.startWorkflow.bind(workflowEngine);
                workflowEngine.startWorkflow = async () => {
                  throw new Error('Simulated workflow engine failure');
                };
                cleanupFunction = () => { workflowEngine.startWorkflow = originalStartWorkflow; };
                break;
            }

            // Wait for failure to take effect
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Capture state during failure
            componentStates.duringFailure = await this.captureSystemState(testContext);

            // Test that other components still function
            const operationResults = await this.testRemainingComponents(
              testContext, 
              scenario.initialFailure
            );

            // Restore failed component
            cleanupFunction();
            await new Promise(resolve => setTimeout(resolve, 500));

            // Capture state after recovery
            componentStates.afterRecovery = await this.captureSystemState(testContext);

            return {
              scenario: scenario.name,
              failedComponent: scenario.initialFailure,
              componentStates,
              operationResults,
              cascadeContained: operationResults.functionalComponents > 0,
              recoverySuccessful: componentStates.afterRecovery.healthyComponents >= componentStates.beforeFailure.healthyComponents
            };

          } catch (error) {
            cleanupFunction();
            return {
              scenario: scenario.name,
              error: error.message,
              cascadeContained: false,
              recoverySuccessful: false
            };
          }
        });

        cascadeResults.push({
          ...scenarioResult,
          duration
        });

        framework.recordMetric(testContext.id, `cascade_${scenario.name}_contained`, scenarioResult.cascadeContained);
        framework.recordMetric(testContext.id, `cascade_${scenario.name}_recovery`, scenarioResult.recoverySuccessful);
        framework.recordMetric(testContext.id, `cascade_${scenario.name}_duration`, duration);
      }

      const cascadesContained = cascadeResults.filter(r => r.cascadeContained).length;
      const successfulRecoveries = cascadeResults.filter(r => r.recoverySuccessful).length;
      const cascadeContainmentRate = (cascadesContained / cascadeTest.failureScenarios.length) * 100;

      framework.recordMetric(testContext.id, 'cascade_containment_rate', cascadeContainmentRate);
      framework.recordMetric(testContext.id, 'successful_recoveries', successfulRecoveries);

      expect(cascadeContainmentRate).toBeGreaterThan(66); // At least 2/3 cascades contained
      expect(successfulRecoveries).toBeGreaterThan(1); // At least 2 successful recoveries

      console.log('Cascade Prevention Results:', cascadeResults);
    });

    // Helper methods for cascade testing
    async captureSystemState(context: IntegrationTestContext): Promise<any> {
      try {
        const providersHealth = await context.providers.getHealth();
        const agentsStatus = Array.from(context.agents.values()).map(agent => agent.getState());
        const workflowStatus = await context.workflowEngine.getHealthStatus();

        return {
          providersHealthy: Object.values(providersHealth).filter((p: any) => p.healthy).length,
          agentsActive: agentsStatus.filter(a => a.energy > 0).length,
          workflowEngineHealthy: workflowStatus.status === 'healthy' ? 1 : 0,
          healthyComponents: Object.values(providersHealth).filter((p: any) => p.healthy).length + 
                           agentsStatus.filter(a => a.energy > 0).length + 
                           (workflowStatus.status === 'healthy' ? 1 : 0),
          timestamp: Date.now()
        };
      } catch (error) {
        return {
          providersHealthy: 0,
          agentsActive: 0,
          workflowEngineHealthy: 0,
          healthyComponents: 0,
          error: error.message,
          timestamp: Date.now()
        };
      }
    }

    async testRemainingComponents(context: IntegrationTestContext, failedComponent: string): Promise<any> {
      const testResults = {
        functionalComponents: 0,
        testResults: [] as any[]
      };

      // Test providers (if not the failed component)
      if (failedComponent !== 'provider') {
        try {
          await context.providers.complete({
            model: 'claude-3-haiku',
            messages: [{ role: 'user', content: 'Cascade test' }],
            maxTokens: 10
          });
          testResults.functionalComponents++;
          testResults.testResults.push({ component: 'providers', functional: true });
        } catch (error) {
          testResults.testResults.push({ component: 'providers', functional: false, error: error.message });
        }
      }

      // Test agents (if not the failed component)
      if (failedComponent !== 'agent') {
        try {
          const agent = Array.from(context.agents.values())[1]; // Use different agent
          const goal = TestDataFactory.createGoal('Cascade test goal', 3);
          await agent.setGoal(goal.description, goal.priority);
          testResults.functionalComponents++;
          testResults.testResults.push({ component: 'agents', functional: true });
        } catch (error) {
          testResults.testResults.push({ component: 'agents', functional: false, error: error.message });
        }
      }

      // Test workflow engine (if not the failed component)
      if (failedComponent !== 'workflow') {
        try {
          const workflow = TestDataFactory.createWorkflowDefinition('Cascade Test', 'simple');
          await context.workflowEngine.startWorkflow(workflow, { cascadeTest: true });
          testResults.functionalComponents++;
          testResults.testResults.push({ component: 'workflow', functional: true });
        } catch (error) {
          testResults.testResults.push({ component: 'workflow', functional: false, error: error.message });
        }
      }

      return testResults;
    }
  });

  describe('Cross-Component Metrics and Reporting', () => {
    it('should provide comprehensive cross-component integration metrics', () => {
      const metrics = framework.getMetrics(testContext.id);
      const stats = framework.getPerformanceStats(testContext.id);
      
      expect(metrics).toBeDefined();
      expect(stats).toBeDefined();
      
      console.log('\n=== Cross-Component Integration Test Metrics ===');
      console.log('Total Requests:', stats?.requests || 0);
      console.log('Success Rate:', stats?.successRate?.toFixed(2) + '%' || 'N/A');
      console.log('Average Latency:', stats?.latency?.avg?.toFixed(2) + 'ms' || 'N/A');
      console.log('P95 Latency:', stats?.latency?.p95?.toFixed(2) + 'ms' || 'N/A');
      console.log('Test Duration:', stats?.duration?.toFixed(2) + 'ms' || 'N/A');
      console.log('Memory Usage:', (stats?.resourceUsage?.memory / 1024 / 1024)?.toFixed(2) + 'MB' || 'N/A');
      
      if (metrics?.customMetrics) {
        console.log('\nIntegration-Specific Metrics:');
        const integrationMetrics = Array.from(metrics.customMetrics.entries())
          .filter(([key]) => 
            key.includes('integration') || 
            key.includes('cross_component') || 
            key.includes('data_flow') ||
            key.includes('cascade')
          )
          .sort(([a], [b]) => a.localeCompare(b));
          
        integrationMetrics.forEach(([key, value]) => {
          if (typeof value === 'number') {
            console.log(`  ${key}: ${value.toFixed(2)}`);
          } else {
            console.log(`  ${key}: ${value}`);
          }
        });

        console.log('\nComponent Coverage:');
        const componentMetrics = Array.from(metrics.customMetrics.entries())
          .filter(([key]) => key.includes('component'))
          .sort(([a], [b]) => a.localeCompare(b));
          
        componentMetrics.forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }
      console.log('=================================================\n');
      
      // Calculate overall integration health score
      if (metrics?.customMetrics) {
        const integrationSuccessMetrics = Array.from(metrics.customMetrics.entries())
          .filter(([key, value]) => 
            (key.includes('integration') || key.includes('cascade')) && 
            key.includes('rate') && 
            typeof value === 'number'
          )
          .map(([, value]) => value as number);
        
        if (integrationSuccessMetrics.length > 0) {
          const avgIntegrationScore = integrationSuccessMetrics.reduce((a, b) => a + b, 0) / integrationSuccessMetrics.length;
          framework.recordMetric(testContext.id, 'overall_integration_score', avgIntegrationScore);
          expect(avgIntegrationScore).toBeGreaterThan(75); // Overall integration should be strong
        }
      }
    });
  });
});