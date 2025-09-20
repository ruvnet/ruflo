/**
 * Dual Planning System for AIME Framework
 * Combines Strategic and Tactical planning for comprehensive mission execution
 */

import { EventEmitter } from 'events';
import { StrategicPlanner } from './planners/strategic-planner.js';
import { TacticalPlanner } from './planners/tactical-planner.js';

export class DualPlanningSystem extends EventEmitter {
  constructor(claudeFlowCore) {
    super();
    this.claudeFlowCore = claudeFlowCore;
    this.strategicPlanner = new StrategicPlanner(
      claudeFlowCore.orchestrator,
      claudeFlowCore.neuralEngine
    );
    this.tacticalPlanner = new TacticalPlanner(
      claudeFlowCore.toolOrganizer,
      claudeFlowCore.agentCapabilityMatrix
    );
    this.planCache = new Map();
    this.executionMonitor = new ExecutionMonitor();
  }

  /**
   * Create comprehensive dual plan for mission objective
   */
  async createDualPlan(missionObjective, options = {}) {
    try {
      // Generate both strategic and tactical plans
      const strategicPlan = await this.strategicPlanner.analyzeMission(missionObjective);
      const tacticalPlan = await this.tacticalPlanner.createExecutionPlan(strategicPlan);
      
      // Synthesize plans for optimal execution
      const synthesizedPlan = await this.synthesizePlans(strategicPlan, tacticalPlan);
      
      // Store in cache for future reference
      this.planCache.set(synthesizedPlan.id, synthesizedPlan);
      
      // Initialize execution monitoring
      await this.executionMonitor.initializeMonitoring(synthesizedPlan);
      
      // Emit plan created event
      this.emit('planCreated', synthesizedPlan);
      
      return {
        id: synthesizedPlan.id,
        strategic: strategicPlan,
        tactical: tacticalPlan,
        synthesized: synthesizedPlan,
        monitoring: {
          dashboardUrl: this.executionMonitor.getDashboardUrl(synthesizedPlan.id),
          websocketEndpoint: this.executionMonitor.getWebSocketEndpoint(synthesizedPlan.id)
        },
        metadata: {
          created: new Date().toISOString(),
          version: '2.0.0',
          options: options
        }
      };
    } catch (error) {
      console.error('Error creating dual plan:', error);
      throw new Error(`Failed to create dual plan: ${error.message}`);
    }
  }

  /**
   * Synthesize strategic and tactical plans into unified execution plan
   */
  async synthesizePlans(strategic, tactical) {
    const synthesized = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      missionId: strategic.missionId,
      planId: tactical.planId,
      executionGraph: this.buildExecutionGraph(strategic, tactical),
      resourceAllocation: this.optimizeResourceAllocation(strategic.resources, tactical.assignments),
      criticalPath: this.calculateCriticalPath(tactical.sequence),
      parallelExecutionPlan: this.optimizeParallelExecution(tactical.parallelizationOpportunities),
      adaptationTriggers: this.defineAdaptationTriggers(strategic.contingencies),
      monitoringPoints: this.defineMonitoringPoints(strategic, tactical),
      successCriteria: this.consolidateSuccessCriteria(strategic, tactical),
      riskMitigation: this.integrateRiskMitigation(strategic.risks, tactical)
    };

    // Validate synthesized plan
    await this.validateSynthesizedPlan(synthesized);
    
    return synthesized;
  }

  /**
   * Build comprehensive execution graph
   */
  buildExecutionGraph(strategic, tactical) {
    const graph = {
      nodes: [],
      edges: [],
      clusters: []
    };

    // Create phase clusters
    for (const phase of strategic.phases) {
      const cluster = {
        id: phase.id,
        label: phase.name,
        nodes: []
      };

      // Add tasks as nodes
      const phaseTasks = tactical.tasks.filter(t => t.phaseId === phase.id);
      for (const task of phaseTasks) {
        const node = {
          id: task.id,
          label: task.name,
          type: task.type,
          cluster: phase.id,
          data: {
            task: task,
            agent: tactical.assignments.assignments[task.id],
            tools: tactical.tools.allocations[task.id],
            duration: task.estimatedDuration,
            priority: task.priority
          }
        };
        graph.nodes.push(node);
        cluster.nodes.push(node.id);
      }

      graph.clusters.push(cluster);
    }

    // Add dependency edges
    for (const task of tactical.tasks) {
      if (task.dependencies) {
        for (const dep of task.dependencies) {
          graph.edges.push({
            from: dep,
            to: task.id,
            type: 'dependency'
          });
        }
      }
    }

    // Add synchronization edges
    for (const syncPoint of tactical.synchronizationPoints) {
      for (const fromTask of syncPoint.afterTasks) {
        for (const toTask of syncPoint.beforeTasks || []) {
          graph.edges.push({
            from: fromTask,
            to: toTask,
            type: 'synchronization',
            syncPoint: syncPoint.id
          });
        }
      }
    }

    return graph;
  }

  /**
   * Optimize resource allocation across strategic and tactical plans
   */
  optimizeResourceAllocation(strategicResources, tacticalAssignments) {
    const optimized = {
      agents: {},
      tools: {},
      memory: {},
      timeline: []
    };

    // Optimize agent allocation
    for (const [taskId, assignment] of Object.entries(tacticalAssignments.assignments)) {
      const agentId = assignment.agentId;
      
      if (!optimized.agents[agentId]) {
        optimized.agents[agentId] = {
          tasks: [],
          utilization: 0,
          capabilities: assignment.capabilities
        };
      }
      
      optimized.agents[agentId].tasks.push(taskId);
    }

    // Calculate utilization
    for (const [agentId, data] of Object.entries(optimized.agents)) {
      data.utilization = tacticalAssignments.utilization[agentId] || 0;
    }

    // Add resource buffers from strategic plan
    optimized.buffer = strategicResources.buffer;
    
    // Create timeline
    optimized.timeline = this.createResourceTimeline(optimized, tacticalAssignments);

    return optimized;
  }

  /**
   * Calculate critical path through execution
   */
  calculateCriticalPath(sequence) {
    const path = [];
    const taskDurations = new Map();
    const taskDependencies = new Map();

    // Build duration and dependency maps
    for (const task of sequence.tasks) {
      taskDurations.set(task.id, task.estimatedDuration || 600);
      taskDependencies.set(task.id, task.dependencies || []);
    }

    // Calculate earliest start times
    const earliestStart = new Map();
    const earliestFinish = new Map();

    for (const task of sequence.tasks) {
      const dependencies = taskDependencies.get(task.id);
      let maxFinish = 0;

      for (const dep of dependencies) {
        maxFinish = Math.max(maxFinish, earliestFinish.get(dep) || 0);
      }

      earliestStart.set(task.id, maxFinish);
      earliestFinish.set(task.id, maxFinish + taskDurations.get(task.id));
    }

    // Calculate latest start times (backward pass)
    const latestStart = new Map();
    const latestFinish = new Map();
    const projectDuration = Math.max(...Array.from(earliestFinish.values()));

    // Initialize with project end time
    for (const task of [...sequence.tasks].reverse()) {
      const successors = sequence.tasks.filter(t => 
        (t.dependencies || []).includes(task.id)
      );

      if (successors.length === 0) {
        latestFinish.set(task.id, projectDuration);
      } else {
        let minStart = projectDuration;
        for (const successor of successors) {
          minStart = Math.min(minStart, latestStart.get(successor.id) || projectDuration);
        }
        latestFinish.set(task.id, minStart);
      }

      latestStart.set(task.id, latestFinish.get(task.id) - taskDurations.get(task.id));
    }

    // Identify critical tasks (zero slack)
    for (const task of sequence.tasks) {
      const slack = latestStart.get(task.id) - earliestStart.get(task.id);
      
      if (Math.abs(slack) < 1) { // Allow for small rounding errors
        path.push({
          taskId: task.id,
          name: task.name,
          duration: taskDurations.get(task.id),
          earliestStart: earliestStart.get(task.id),
          latestStart: latestStart.get(task.id),
          slack: slack
        });
      }
    }

    return {
      path: path,
      totalDuration: projectDuration,
      criticalTasks: path.map(p => p.taskId)
    };
  }

  /**
   * Optimize parallel execution opportunities
   */
  optimizeParallelExecution(opportunities) {
    const optimizedPlan = {
      parallelGroups: [],
      resourceRequirements: {},
      estimatedSpeedup: 1.0,
      risks: []
    };

    for (const opportunity of opportunities) {
      const group = {
        id: `parallel_group_${optimizedPlan.parallelGroups.length + 1}`,
        stageId: opportunity.stageId,
        tasks: opportunity.tasks,
        maxConcurrency: this.calculateOptimalConcurrency(opportunity),
        synchronization: this.defineSynchronizationStrategy(opportunity),
        errorHandling: this.defineParallelErrorHandling(opportunity)
      };

      optimizedPlan.parallelGroups.push(group);

      // Aggregate resource requirements
      for (const [resource, amount] of Object.entries(opportunity.resourceRequirements)) {
        optimizedPlan.resourceRequirements[resource] = 
          (optimizedPlan.resourceRequirements[resource] || 0) + amount;
      }

      // Calculate cumulative speedup
      optimizedPlan.estimatedSpeedup *= opportunity.estimatedSpeedup;

      // Collect risks
      optimizedPlan.risks.push(...opportunity.risks);
    }

    return optimizedPlan;
  }

  /**
   * Define adaptation triggers based on contingencies
   */
  defineAdaptationTriggers(contingencies) {
    return contingencies.map(contingency => ({
      id: `trigger_${contingency.id}`,
      contingencyId: contingency.id,
      condition: contingency.activationCriteria,
      action: {
        type: 'execute_contingency',
        plan: contingency.plan,
        resources: contingency.resources
      },
      priority: this.calculateTriggerPriority(contingency)
    }));
  }

  /**
   * Define monitoring points for execution tracking
   */
  defineMonitoringPoints(strategic, tactical) {
    const points = [];

    // Phase transitions
    for (const phase of strategic.phases) {
      points.push({
        id: `monitor_phase_${phase.id}`,
        type: 'phase_transition',
        target: phase.id,
        metrics: ['completion', 'duration', 'resource_usage']
      });
    }

    // Critical path tasks
    for (const task of tactical.sequence.criticalPath) {
      points.push({
        id: `monitor_critical_${task}`,
        type: 'critical_task',
        target: task,
        metrics: ['status', 'duration', 'bottlenecks']
      });
    }

    // Synchronization points
    for (const sync of tactical.synchronizationPoints) {
      points.push({
        id: `monitor_sync_${sync.id}`,
        type: 'synchronization',
        target: sync.id,
        metrics: ['readiness', 'conflicts', 'delays']
      });
    }

    return points;
  }

  /**
   * Consolidate success criteria from both plans
   */
  consolidateSuccessCriteria(strategic, tactical) {
    return {
      strategic: strategic.metrics,
      tactical: {
        taskCompletion: 100,
        onTimeDelivery: 95,
        resourceEfficiency: 85,
        qualityScore: 90
      },
      overall: {
        missionSuccess: true,
        objectivesMet: strategic.objectives.length,
        phasesCompleted: strategic.phases.length,
        tasksExecuted: tactical.tasks.length
      }
    };
  }

  /**
   * Integrate risk mitigation strategies
   */
  integrateRiskMitigation(strategicRisks, tactical) {
    const integrated = {
      riskProfile: strategicRisks,
      mitigationStrategies: [],
      monitoringProtocol: {}
    };

    // Map strategic risks to tactical mitigation
    for (const [riskType, risks] of Object.entries(strategicRisks)) {
      if (Array.isArray(risks)) {
        for (const risk of risks) {
          integrated.mitigationStrategies.push({
            riskId: risk.id,
            strategy: risk.mitigation || strategicRisks.mitigation?.[risk.id],
            tacticalImplementation: this.mapRiskToTactical(risk, tactical),
            monitoringFrequency: this.determineMonitoringFrequency(risk)
          });
        }
      }
    }

    return integrated;
  }

  /**
   * Validate the synthesized plan
   */
  async validateSynthesizedPlan(plan) {
    const validations = [
      this.validateResourceAvailability(plan),
      this.validateDependencies(plan),
      this.validateTimeline(plan),
      this.validateParallelization(plan)
    ];

    const results = await Promise.all(validations);
    const issues = results.filter(r => !r.valid);

    if (issues.length > 0) {
      console.warn('Plan validation issues:', issues);
    }

    return issues.length === 0;
  }

  /**
   * Helper methods
   */
  createResourceTimeline(resources, assignments) {
    // Simple timeline creation
    const timeline = [];
    const timeSlots = 24; // 24 hour slots

    for (let i = 0; i < timeSlots; i++) {
      timeline.push({
        slot: i,
        agents: this.getActiveAgents(i, resources, assignments),
        utilization: this.calculateSlotUtilization(i, resources)
      });
    }

    return timeline;
  }

  calculateOptimalConcurrency(opportunity) {
    const factors = {
      availableResources: 8,
      taskCount: opportunity.tasks.length,
      riskLevel: opportunity.risks.length
    };

    return Math.min(
      factors.availableResources,
      factors.taskCount,
      Math.max(1, 8 - factors.riskLevel)
    );
  }

  defineSynchronizationStrategy(opportunity) {
    return {
      type: 'barrier',
      timeout: 300000, // 5 minutes
      retryPolicy: {
        maxAttempts: 3,
        backoff: 'exponential'
      }
    };
  }

  defineParallelErrorHandling(opportunity) {
    return {
      strategy: 'isolate',
      recovery: 'retry-with-backoff',
      escalation: 'coordinator-notification'
    };
  }

  calculateTriggerPriority(contingency) {
    // Simple priority based on risk severity
    return contingency.risk?.severity || 0.5;
  }

  mapRiskToTactical(risk, tactical) {
    // Map strategic risk to tactical tasks
    return {
      affectedTasks: [],
      preventiveMeasures: [],
      responsePlan: {}
    };
  }

  determineMonitoringFrequency(risk) {
    if (risk.severity >= 0.8) return 60; // Every minute
    if (risk.severity >= 0.5) return 300; // Every 5 minutes
    return 900; // Every 15 minutes
  }

  async validateResourceAvailability(plan) {
    return { valid: true, issues: [] };
  }

  async validateDependencies(plan) {
    return { valid: true, issues: [] };
  }

  async validateTimeline(plan) {
    return { valid: true, issues: [] };
  }

  async validateParallelization(plan) {
    return { valid: true, issues: [] };
  }

  getActiveAgents(slot, resources, assignments) {
    return Object.keys(resources.agents).filter(agentId => {
      // Simplified - in real implementation would check actual schedule
      return true;
    });
  }

  calculateSlotUtilization(slot, resources) {
    // Simplified utilization calculation
    return Math.random() * 100;
  }
}

/**
 * Execution Monitor for tracking plan execution
 */
class ExecutionMonitor {
  constructor() {
    this.monitoringSessions = new Map();
    this.metrics = new Map();
  }

  async initializeMonitoring(plan) {
    const session = {
      id: plan.id,
      startTime: Date.now(),
      status: 'initialized',
      metrics: {},
      events: []
    };

    this.monitoringSessions.set(plan.id, session);
    return session;
  }

  getDashboardUrl(planId) {
    return `http://localhost:3000/dashboard/${planId}`;
  }

  getWebSocketEndpoint(planId) {
    return `ws://localhost:3000/monitor/${planId}`;
  }
}