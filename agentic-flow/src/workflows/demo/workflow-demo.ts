// Workflow Engine Demonstration
// This script demonstrates the complete workflow execution system with all features

import { WorkflowEngine, WorkflowDefinition } from '../workflow-engine';
import { WorkflowMonitor } from '../monitoring/workflow-monitor';
import { WorkflowErrorHandler } from '../error-handling/workflow-error-handler';
import { v4 as uuidv4 } from 'uuid';

class WorkflowDemo {
  private engine: WorkflowEngine;
  private monitor: WorkflowMonitor;
  private errorHandler: WorkflowErrorHandler;

  constructor() {
    // Initialize components
    this.engine = new WorkflowEngine({
      enablePersistence: true,
      dbPath: ':memory:' // Use in-memory database for demo
    });

    this.monitor = new WorkflowMonitor(this.engine);
    this.errorHandler = new WorkflowErrorHandler(this.engine, this.monitor);

    this.setupEventListeners();
  }

  async runDemo(): Promise<void> {
    console.log('🚀 Starting Agentic Flow v2.0 Workflow Demo');
    console.log('===============================================\n');

    try {
      // Start monitoring
      this.monitor.startMonitoring(5000); // Check every 5 seconds
      console.log('📊 Monitoring started\n');

      // Setup error recovery strategies
      this.setupErrorRecovery();
      console.log('🛡️  Error recovery strategies configured\n');

      // Run demonstrations
      await this.demoBasicWorkflow();
      await this.demoParallelExecution();
      await this.demoConditionalLogic();
      await this.demoLoopExecution();
      await this.demoErrorHandling();
      await this.demoAgentIntegration();
      await this.demoHttpRequests();
      await this.demoScriptExecution();
      await this.demoWorkflowPersistence();
      await this.demoComplexWorkflow();

      // Show final metrics
      await this.showFinalMetrics();

    } catch (error) {
      console.error('❌ Demo failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  private async demoBasicWorkflow(): Promise<void> {
    console.log('📋 Demo 1: Basic Linear Workflow');
    console.log('─────────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Basic Demo Workflow',
      description: 'Simple linear workflow demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'init',
          type: 'script',
          name: 'Initialize',
          config: {
            script: 'console.log("Step 1: Initializing..."); return { initialized: true, timestamp: new Date() };'
          },
          next: ['process']
        },
        {
          id: 'process',
          type: 'script',
          name: 'Process Data',
          config: {
            script: 'console.log("Step 2: Processing..."); return { processed: variables.initialized, data: "demo_data" };'
          },
          next: ['finalize']
        },
        {
          id: 'finalize',
          type: 'script',
          name: 'Finalize',
          config: {
            script: 'console.log("Step 3: Finalizing..."); return { completed: true, result: "success" };'
          }
        }
      ],
      variables: { demo: true },
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id, { input: 'demo' });

    await this.waitForCompletion(executionId);
    const execution = this.engine.getExecution(executionId);
    
    console.log(`✅ Workflow completed: ${execution?.status}`);
    console.log(`📈 Steps executed: ${Object.keys(execution?.results || {}).length}`);
    console.log();
  }

  private async demoParallelExecution(): Promise<void> {
    console.log('⚡ Demo 2: Parallel Execution');
    console.log('──────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Parallel Demo Workflow',
      description: 'Parallel execution demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'parallel-tasks',
          type: 'parallel',
          name: 'Parallel Processing',
          config: {
            steps: ['task-a', 'task-b', 'task-c'],
            maxConcurrency: 3
          },
          next: ['aggregate']
        },
        {
          id: 'task-a',
          type: 'script',
          name: 'Task A',
          config: {
            script: 'await new Promise(r => setTimeout(r, 200)); console.log("Task A completed"); return { taskA: "done" };'
          }
        },
        {
          id: 'task-b',
          type: 'script',
          name: 'Task B',
          config: {
            script: 'await new Promise(r => setTimeout(r, 300)); console.log("Task B completed"); return { taskB: "done" };'
          }
        },
        {
          id: 'task-c',
          type: 'script',
          name: 'Task C',
          config: {
            script: 'await new Promise(r => setTimeout(r, 100)); console.log("Task C completed"); return { taskC: "done" };'
          }
        },
        {
          id: 'aggregate',
          type: 'script',
          name: 'Aggregate Results',
          config: {
            script: 'console.log("Aggregating parallel results"); return { allTasksCompleted: true };'
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId);
    console.log('✅ Parallel execution completed');
    console.log();
  }

  private async demoConditionalLogic(): Promise<void> {
    console.log('🔀 Demo 3: Conditional Logic');
    console.log('─────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Conditional Demo Workflow',
      description: 'Conditional logic demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'condition',
          type: 'condition',
          name: 'Check Value',
          config: {
            condition: 'variables.value > 50',
            trueStep: 'high-value',
            falseStep: 'low-value'
          }
        },
        {
          id: 'high-value',
          type: 'script',
          name: 'High Value Path',
          config: {
            script: 'console.log("Taking high value path"); return { path: "high", value: variables.value };'
          }
        },
        {
          id: 'low-value',
          type: 'script',
          name: 'Low Value Path',
          config: {
            script: 'console.log("Taking low value path"); return { path: "low", value: variables.value };'
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    
    // Test high value path
    const executionId1 = await this.engine.executeWorkflow(workflow.id, { value: 75 });
    await this.waitForCompletion(executionId1);
    
    // Test low value path
    const executionId2 = await this.engine.executeWorkflow(workflow.id, { value: 25 });
    await this.waitForCompletion(executionId2);

    console.log('✅ Conditional logic demonstrated');
    console.log();
  }

  private async demoLoopExecution(): Promise<void> {
    console.log('🔄 Demo 4: Loop Execution');
    console.log('─────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Loop Demo Workflow',
      description: 'Loop execution demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'loop',
          type: 'loop',
          name: 'Counter Loop',
          config: {
            condition: 'variables.counter < 5',
            loopStep: 'increment',
            maxIterations: 10,
            breakCondition: 'variables.counter >= 3'
          }
        },
        {
          id: 'increment',
          type: 'script',
          name: 'Increment Counter',
          config: {
            script: 'variables.counter = (variables.counter || 0) + 1; console.log(`Loop iteration: ${variables.counter}`); return { counter: variables.counter };'
          }
        }
      ],
      variables: { counter: 0 },
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId);
    console.log('✅ Loop execution completed');
    console.log();
  }

  private async demoErrorHandling(): Promise<void> {
    console.log('🛡️  Demo 5: Error Handling');
    console.log('───────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Error Handling Demo',
      description: 'Error handling demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'failing-step',
          type: 'script',
          name: 'Failing Step',
          config: {
            script: 'console.log("This step will fail"); throw new Error("Intentional demo failure");'
          },
          onFailure: 'recovery'
        },
        {
          id: 'recovery',
          type: 'script',
          name: 'Recovery Step',
          config: {
            script: 'console.log("Recovering from failure"); return { recovered: true, message: "Error handled successfully" };'
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId);
    console.log('✅ Error handling demonstrated');
    console.log();
  }

  private async demoAgentIntegration(): Promise<void> {
    console.log('🤖 Demo 6: Agent Integration');
    console.log('─────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Agent Integration Demo',
      description: 'Agent integration demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'agent-task',
          type: 'agent-task',
          name: 'AI Agent Task',
          config: {
            agentType: 'executor',
            goal: 'Process demo data using AI capabilities',
            capabilities: ['data-processing', 'analysis'],
            timeout: 10000
          }
        }
      ],
      variables: { aiDemo: true },
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId, 15000);
    console.log('✅ Agent integration demonstrated');
    console.log();
  }

  private async demoHttpRequests(): Promise<void> {
    console.log('🌐 Demo 7: HTTP Requests');
    console.log('─────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'HTTP Demo Workflow',
      description: 'HTTP request demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'api-call',
          type: 'http',
          name: 'External API Call',
          config: {
            method: 'GET',
            url: 'https://jsonplaceholder.typicode.com/posts/1',
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
            retries: 2
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId, 10000);
    console.log('✅ HTTP requests demonstrated');
    console.log();
  }

  private async demoScriptExecution(): Promise<void> {
    console.log('📜 Demo 8: Script Execution');
    console.log('────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Script Demo Workflow',
      description: 'Script execution demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'complex-script',
          type: 'script',
          name: 'Complex Processing',
          config: {
            script: `
              console.log("Running complex script...");
              
              // Simulate data processing
              const data = [];
              for (let i = 0; i < 10; i++) {
                data.push({ id: i, value: Math.random() * 100 });
              }
              
              // Calculate statistics
              const sum = data.reduce((acc, item) => acc + item.value, 0);
              const avg = sum / data.length;
              const max = Math.max(...data.map(item => item.value));
              const min = Math.min(...data.map(item => item.value));
              
              console.log(\`Processed \${data.length} items\`);
              
              return {
                itemsProcessed: data.length,
                statistics: { sum, avg, max, min },
                timestamp: new Date()
              };
            `,
            language: 'javascript',
            timeout: 5000
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId);
    console.log('✅ Script execution demonstrated');
    console.log();
  }

  private async demoWorkflowPersistence(): Promise<void> {
    console.log('💾 Demo 9: Workflow Persistence');
    console.log('────────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Persistence Demo',
      description: 'Workflow persistence demonstration',
      version: '1.0.0',
      steps: [
        {
          id: 'step1',
          type: 'script',
          name: 'First Step',
          config: {
            script: 'console.log("Step 1 executing..."); return { step1: true };'
          },
          next: ['step2']
        },
        {
          id: 'step2',
          type: 'script',
          name: 'Long Running Step',
          config: {
            script: 'console.log("Step 2 executing..."); await new Promise(r => setTimeout(r, 2000)); return { step2: true };'
          }
        }
      ],
      variables: {},
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    // Enable auto-snapshots
    await this.engine.enableAutoSnapshots(executionId, 1000);
    console.log('📸 Auto-snapshots enabled');

    // Pause after 1 second
    setTimeout(async () => {
      await this.engine.pauseWorkflow(executionId);
      console.log('⏸️  Workflow paused');
      
      // Resume after another second
      setTimeout(async () => {
        await this.engine.resumeWorkflow(executionId);
        console.log('▶️  Workflow resumed');
      }, 1000);
    }, 1000);

    await this.waitForCompletion(executionId, 10000);
    console.log('✅ Persistence demonstrated');
    console.log();
  }

  private async demoComplexWorkflow(): Promise<void> {
    console.log('🎯 Demo 10: Complex Multi-Step Workflow');
    console.log('────────────────────────────────────────');

    const workflow: WorkflowDefinition = {
      id: uuidv4(),
      name: 'Complex Demo Workflow',
      description: 'Complex workflow combining all features',
      version: '1.0.0',
      steps: [
        // Data collection phase
        {
          id: 'collect-data',
          type: 'parallel',
          name: 'Data Collection',
          config: {
            steps: ['source-a', 'source-b'],
            maxConcurrency: 2
          },
          next: ['validate-data']
        },
        {
          id: 'source-a',
          type: 'script',
          name: 'Data Source A',
          config: {
            script: 'await new Promise(r => setTimeout(r, 300)); return { sourceA: [1, 2, 3, 4, 5] };'
          }
        },
        {
          id: 'source-b',
          type: 'script',
          name: 'Data Source B',
          config: {
            script: 'await new Promise(r => setTimeout(r, 200)); return { sourceB: [6, 7, 8, 9, 10] };'
          }
        },
        
        // Validation phase
        {
          id: 'validate-data',
          type: 'condition',
          name: 'Validate Data',
          config: {
            condition: 'results["source-a"] && results["source-b"]',
            trueStep: 'process-data',
            falseStep: 'handle-error'
          }
        },
        
        // Processing phase
        {
          id: 'process-data',
          type: 'loop',
          name: 'Process Data Batches',
          config: {
            condition: 'variables.batch < 3',
            loopStep: 'process-batch',
            maxIterations: 5
          },
          next: ['aggregate-results']
        },
        {
          id: 'process-batch',
          type: 'script',
          name: 'Process Batch',
          config: {
            script: `
              variables.batch = (variables.batch || 0) + 1;
              console.log(\`Processing batch \${variables.batch}\`);
              return { batch: variables.batch, processed: true };
            `
          }
        },
        
        // Error handling
        {
          id: 'handle-error',
          type: 'script',
          name: 'Handle Error',
          config: {
            script: 'console.log("Handling data validation error"); return { error: "Data validation failed" };'
          }
        },
        
        // Final aggregation
        {
          id: 'aggregate-results',
          type: 'script',
          name: 'Aggregate Results',
          config: {
            script: `
              console.log("Aggregating all results...");
              const totalSteps = Object.keys(results).length;
              const processingTime = Date.now() - variables.startTime;
              
              return {
                summary: "Complex workflow completed",
                totalSteps,
                processingTime,
                success: true
              };
            `
          }
        }
      ],
      variables: { batch: 0, startTime: Date.now() },
      triggers: []
    };

    await this.engine.createWorkflow(workflow);
    const executionId = await this.engine.executeWorkflow(workflow.id);

    await this.waitForCompletion(executionId, 15000);
    
    const execution = this.engine.getExecution(executionId);
    const finalResult = execution?.results['aggregate-results'];
    
    console.log('✅ Complex workflow completed');
    console.log(`📊 Total steps: ${finalResult?.totalSteps}`);
    console.log(`⏱️  Processing time: ${finalResult?.processingTime}ms`);
    console.log();
  }

  private async showFinalMetrics(): Promise<void> {
    console.log('📊 Final System Metrics');
    console.log('════════════════════════');

    const workflowMetrics = this.monitor.getWorkflowMetrics();
    const errorStats = this.errorHandler.getErrorStatistics();
    const healthStatus = this.monitor.getHealthStatus();

    console.log('\n🏭 Workflow Engine Metrics:');
    console.log(`   Total Executions: ${workflowMetrics.totalExecutions}`);
    console.log(`   Completed: ${workflowMetrics.completedExecutions}`);
    console.log(`   Failed: ${workflowMetrics.failedExecutions}`);
    console.log(`   Average Execution Time: ${Math.round(workflowMetrics.averageExecutionTime)}ms`);
    console.log(`   Total Steps Executed: ${workflowMetrics.totalStepsExecuted}`);
    console.log(`   Error Rate: ${(workflowMetrics.errorRate * 100).toFixed(2)}%`);
    console.log(`   Throughput: ${workflowMetrics.throughput} completions/min`);

    console.log('\n🛡️  Error Handling Stats:');
    console.log(`   Total Errors: ${errorStats.totalErrors}`);
    console.log(`   Resolved: ${errorStats.resolvedErrors}`);
    console.log(`   Unresolved: ${errorStats.unresolvedErrors}`);
    console.log(`   Dead Letter Queue: ${errorStats.deadLetterQueueSize}`);
    console.log(`   Circuit Breakers Open: ${errorStats.circuitBreakersOpen}`);

    console.log('\n🏥 System Health:');
    console.log(`   Status: ${healthStatus.status.toUpperCase()}`);
    if (healthStatus.issues.length > 0) {
      console.log('   Issues:');
      healthStatus.issues.forEach(issue => console.log(`     - ${issue}`));
    }
    if (healthStatus.recommendations.length > 0) {
      console.log('   Recommendations:');
      healthStatus.recommendations.forEach(rec => console.log(`     - ${rec}`));
    }

    console.log('\n🎯 Step Type Performance:');
    this.monitor.getStepMetrics().forEach(metric => {
      console.log(`   ${metric.stepType}:`);
      console.log(`     Executions: ${metric.totalExecutions}`);
      console.log(`     Success Rate: ${((1 - metric.errorRate) * 100).toFixed(1)}%`);
      console.log(`     Avg Time: ${Math.round(metric.averageExecutionTime)}ms`);
    });

    console.log();
  }

  private setupEventListeners(): void {
    // Engine events
    this.engine.on('workflow:completed', (data) => {
      console.log(`✅ Workflow ${data.executionId} completed`);
    });

    this.engine.on('workflow:failed', (data) => {
      console.log(`❌ Workflow ${data.executionId} failed`);
    });

    // Monitor events
    this.monitor.on('alert:created', (alert) => {
      console.log(`🚨 Alert: ${alert.message}`);
    });

    // Error handler events
    this.errorHandler.on('error:resolved', (error) => {
      console.log(`🔧 Error resolved: ${error.error.message}`);
    });
  }

  private setupErrorRecovery(): void {
    // Configure retry strategy for script steps
    this.errorHandler.registerRecoveryStrategy('script', {
      type: 'retry',
      maxAttempts: 2,
      retryDelay: 1000
    });

    // Configure alternative strategy for HTTP steps
    this.errorHandler.registerRecoveryStrategy('http', {
      type: 'retry',
      maxAttempts: 3,
      retryDelay: 2000
    });

    // Configure escalation for agent tasks
    this.errorHandler.registerRecoveryStrategy('agent-task', {
      type: 'escalate',
      escalationHandler: 'manual-intervention'
    });
  }

  private async waitForCompletion(executionId: string, timeoutMs = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Workflow ${executionId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const checkStatus = () => {
        const execution = this.engine.getExecution(executionId);
        if (!execution) {
          clearTimeout(timeout);
          reject(new Error(`Execution ${executionId} not found`));
          return;
        }

        if (execution.status === 'completed' || execution.status === 'failed' || execution.status === 'cancelled') {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkStatus, 100);
        }
      };

      checkStatus();
    });
  }

  private async cleanup(): void {
    console.log('\n🧹 Cleaning up...');
    
    this.monitor.stopMonitoring();
    this.errorHandler.shutdown();
    await this.engine.shutdown();
    
    console.log('✅ Cleanup completed');
    console.log('\n🎉 Agentic Flow v2.0 Workflow Demo Complete!');
    console.log('═══════════════════════════════════════════════');
  }
}

// Run the demo
if (require.main === module) {
  const demo = new WorkflowDemo();
  demo.runDemo().catch(console.error);
}

export { WorkflowDemo };