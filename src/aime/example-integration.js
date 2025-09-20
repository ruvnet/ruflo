/**
 * Example integration of AIME Dual Planning System with Claude Flow
 * This demonstrates how to use the new AIME MCP tools
 */

import { DualPlanningSystem } from './dual-planning-system.js';

// Example 1: Creating a dual plan for a complex software project
async function exampleSoftwareProject() {
  console.log('=== Example 1: Software Project Planning ===\n');
  
  const missionObjective = `
    Build a complete REST API for an e-commerce platform with the following requirements:
    - User authentication and authorization with JWT
    - Product catalog with search and filtering
    - Shopping cart and order management
    - Payment processing integration
    - Admin dashboard for inventory management
    - Real-time notifications for order updates
    - Comprehensive test coverage and documentation
  `;
  
  // In a real MCP environment, you would call:
  // mcp__claude-flow__aime_create_dual_plan({ missionObjective, options })
  
  const planner = new DualPlanningSystem({
    orchestrator: null, // Would be actual orchestrator
    neuralEngine: null, // Would be actual neural engine
    toolOrganizer: null, // Would be actual tool organizer
    agentCapabilityMatrix: null // Would be actual capability matrix
  });
  
  const plan = await planner.createDualPlan(missionObjective, {
    complexity: 'high',
    urgency: 'medium',
    resources: {
      maxAgents: 8,
      maxTime: 10080, // 1 week in minutes
      maxMemory: 4 // GB
    }
  });
  
  console.log('Strategic Plan Summary:');
  console.log(`- Mission ID: ${plan.strategic.missionId}`);
  console.log(`- Phases: ${plan.strategic.phases.length}`);
  console.log(`- Objectives: ${plan.strategic.objectives.length}`);
  console.log(`- Critical Path Length: ${plan.synthesized.criticalPath.totalDuration} minutes`);
  
  console.log('\nTactical Plan Summary:');
  console.log(`- Plan ID: ${plan.tactical.planId}`);
  console.log(`- Total Tasks: ${plan.tactical.tasks.length}`);
  console.log(`- Execution Stages: ${plan.tactical.sequence.stages.length}`);
  console.log(`- Parallel Groups: ${plan.tactical.parallelizationOpportunities.length}`);
  console.log(`- Execution Pattern: ${plan.tactical.executionPattern}`);
  
  console.log('\nMonitoring Endpoints:');
  console.log(`- Dashboard: ${plan.monitoring.dashboardUrl}`);
  console.log(`- WebSocket: ${plan.monitoring.websocketEndpoint}`);
  
  return plan;
}

// Example 2: Adapting a plan based on new conditions
async function examplePlanAdaptation(planId) {
  console.log('\n=== Example 2: Plan Adaptation ===\n');
  
  // Simulate a resource shortage scenario
  const adaptationTrigger = {
    type: 'resource_shortage',
    details: {
      resource: 'agents',
      available: 4,
      required: 8,
      impact: 'timeline_extension'
    }
  };
  
  // In MCP, you would call:
  // mcp__claude-flow__aime_adapt_plan({ planId, trigger: adaptationTrigger })
  
  console.log('Adaptation Trigger:');
  console.log(`- Type: ${adaptationTrigger.type}`);
  console.log(`- Resource: ${adaptationTrigger.details.resource}`);
  console.log(`- Available: ${adaptationTrigger.details.available}`);
  console.log(`- Required: ${adaptationTrigger.details.required}`);
  
  // Simulated adaptation response
  const adaptation = {
    id: `adapt_${Date.now()}`,
    planId: planId,
    trigger: adaptationTrigger,
    changes: [
      {
        type: 'reallocate_resources',
        details: 'Optimizing agent allocation across phases'
      },
      {
        type: 'adjust_timeline',
        details: 'Extending timeline by 20% to accommodate resource constraints'
      },
      {
        type: 'modify_parallelization',
        details: 'Reducing parallel execution to match available agents'
      }
    ],
    timestamp: new Date().toISOString()
  };
  
  console.log('\nAdaptation Changes:');
  adaptation.changes.forEach(change => {
    console.log(`- ${change.type}: ${change.details}`);
  });
  
  return adaptation;
}

// Example 3: Phase execution with monitoring
async function examplePhaseExecution(planId, phaseId) {
  console.log('\n=== Example 3: Phase Execution ===\n');
  
  // In MCP, you would call:
  // mcp__claude-flow__aime_execute_phase({ planId, phaseId, options })
  
  const executionOptions = {
    parallel: true,
    monitoring: true
  };
  
  console.log('Executing Phase:');
  console.log(`- Plan ID: ${planId}`);
  console.log(`- Phase ID: ${phaseId}`);
  console.log(`- Parallel Execution: ${executionOptions.parallel}`);
  console.log(`- Monitoring Enabled: ${executionOptions.monitoring}`);
  
  // Simulated execution status
  const execution = {
    planId: planId,
    phaseId: phaseId,
    status: 'started',
    parallel: executionOptions.parallel,
    monitoring: executionOptions.monitoring,
    startTime: new Date().toISOString(),
    estimatedCompletion: new Date(Date.now() + 3600000).toISOString() // 1 hour
  };
  
  console.log(`\nExecution started at: ${execution.startTime}`);
  console.log(`Estimated completion: ${execution.estimatedCompletion}`);
  
  return execution;
}

// Example 4: Real-time monitoring
async function exampleMonitoring(planId) {
  console.log('\n=== Example 4: Execution Monitoring ===\n');
  
  // In MCP, you would call:
  // mcp__claude-flow__aime_monitor_execution({ planId, metrics })
  
  const requestedMetrics = ['completion', 'performance', 'resource_usage', 'bottlenecks'];
  
  console.log('Monitoring Metrics:');
  requestedMetrics.forEach(metric => console.log(`- ${metric}`));
  
  // Simulated monitoring data
  const monitoring = {
    planId: planId,
    timestamp: new Date().toISOString(),
    metrics: {
      completion: {
        overall: 42.5,
        byPhase: {
          'phase_1': 100,
          'phase_2': 75,
          'phase_3': 30,
          'phase_4': 0
        }
      },
      performance: {
        efficiency: 87.3,
        throughput: 156, // tasks per hour
        latency: 234 // ms average
      },
      resourceUsage: {
        agents: {
          total: 8,
          active: 6,
          idle: 2
        },
        memory: {
          used: 2.7,
          available: 5.3
        }
      },
      bottlenecks: {
        current: [
          {
            location: 'Database writes',
            severity: 'medium',
            impact: '15% slowdown'
          }
        ],
        resolved: []
      }
    }
  };
  
  console.log('\nCurrent Status:');
  console.log(`- Overall Completion: ${monitoring.metrics.completion.overall}%`);
  console.log(`- Efficiency: ${monitoring.metrics.performance.efficiency}%`);
  console.log(`- Active Agents: ${monitoring.metrics.resourceUsage.agents.active}/${monitoring.metrics.resourceUsage.agents.total}`);
  console.log(`- Memory Usage: ${monitoring.metrics.resourceUsage.memory.used}GB/${monitoring.metrics.resourceUsage.memory.used + monitoring.metrics.resourceUsage.memory.available}GB`);
  
  if (monitoring.metrics.bottlenecks.current.length > 0) {
    console.log('\nCurrent Bottlenecks:');
    monitoring.metrics.bottlenecks.current.forEach(bottleneck => {
      console.log(`- ${bottleneck.location}: ${bottleneck.severity} (${bottleneck.impact})`);
    });
  }
  
  return monitoring;
}

// Main execution flow
async function main() {
  console.log('AIME Dual Planning System - Integration Example\n');
  console.log('================================================\n');
  
  try {
    // Step 1: Create a dual plan
    const plan = await exampleSoftwareProject();
    
    // Step 2: Simulate need for adaptation
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate time passing
    const adaptation = await examplePlanAdaptation(plan.id);
    
    // Step 3: Execute first phase
    await new Promise(resolve => setTimeout(resolve, 1000));
    const execution = await examplePhaseExecution(plan.id, 'phase_1');
    
    // Step 4: Monitor execution
    await new Promise(resolve => setTimeout(resolve, 1000));
    const monitoring = await exampleMonitoring(plan.id);
    
    console.log('\n================================================');
    console.log('Example completed successfully!');
    console.log('\nIn Claude Flow, you would use these MCP tools:');
    console.log('- mcp__claude-flow__aime_create_dual_plan');
    console.log('- mcp__claude-flow__aime_get_plan_status');
    console.log('- mcp__claude-flow__aime_adapt_plan');
    console.log('- mcp__claude-flow__aime_execute_phase');
    console.log('- mcp__claude-flow__aime_monitor_execution');
    
  } catch (error) {
    console.error('Error in example:', error);
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { 
  exampleSoftwareProject, 
  examplePlanAdaptation, 
  examplePhaseExecution, 
  exampleMonitoring 
};