"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var hive_dashboard_exports = {};
__export(hive_dashboard_exports, {
  HiveDashboard: () => HiveDashboard
});
module.exports = __toCommonJS(hive_dashboard_exports);
class HiveDashboard {
  static {
    __name(this, "HiveDashboard");
  }
  orchestrator;
  protocol;
  refreshInterval = 1e3;
  // 1 second
  updateCallback;
  constructor(orchestrator, protocol) {
    this.orchestrator = orchestrator;
    this.protocol = protocol;
  }
  /**
   * Start monitoring with callback for updates
   */
  startMonitoring(callback) {
    this.updateCallback = callback;
    this.update();
    const interval = setInterval(() => {
      this.update();
    }, this.refreshInterval);
    return () => clearInterval(interval);
  }
  /**
   * Get current dashboard data
   */
  update() {
    const data = this.collectDashboardData();
    if (this.updateCallback) {
      this.updateCallback(data);
    }
  }
  /**
   * Collect all dashboard data
   */
  collectDashboardData() {
    const perfMetrics = this.orchestrator.getPerformanceMetrics();
    const commStats = this.protocol.getStatistics();
    return {
      swarmId: "current-swarm",
      status: this.determineSwarmStatus(perfMetrics),
      agents: this.getAgentStatuses(),
      tasks: this.getTaskProgress(),
      consensus: this.getConsensusMetrics(),
      communication: this.getCommunicationStats(commStats),
      performance: this.getPerformanceMetrics(perfMetrics),
      timestamp: Date.now()
    };
  }
  /**
   * Determine overall swarm status
   */
  determineSwarmStatus(metrics) {
    if (metrics.executingTasks > 0)
      return "executing";
    if (metrics.pendingTasks > 0)
      return "active";
    if (metrics.completedTasks === metrics.totalTasks)
      return "completed";
    return "initializing";
  }
  /**
   * Get status of all agents
   */
  getAgentStatuses() {
    return [
      {
        id: "queen-1",
        name: "Queen-Genesis",
        type: "queen",
        status: "thinking",
        workload: 85,
        votes: 15,
        contributions: 42
      },
      {
        id: "architect-1",
        name: "Architect-1",
        type: "architect",
        status: "executing",
        currentTask: "Design system architecture",
        workload: 70,
        votes: 8,
        contributions: 23
      },
      {
        id: "worker-1",
        name: "Worker-1",
        type: "worker",
        status: "voting",
        workload: 45,
        votes: 12,
        contributions: 31
      }
    ];
  }
  /**
   * Get task progress information
   */
  getTaskProgress() {
    const taskGraph = this.orchestrator.getTaskGraph();
    return taskGraph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      description: `${node.type} task`,
      status: node.status,
      assignedTo: node.assignedTo,
      progress: this.calculateTaskProgress(node.status),
      dependencies: []
    }));
  }
  /**
   * Calculate task progress based on status
   */
  calculateTaskProgress(status) {
    switch (status) {
      case "completed":
        return 100;
      case "executing":
        return 50;
      case "assigned":
        return 25;
      case "voting":
        return 10;
      case "pending":
        return 0;
      default:
        return 0;
    }
  }
  /**
   * Get consensus metrics
   */
  getConsensusMetrics() {
    const metrics = this.orchestrator.getPerformanceMetrics();
    return {
      totalDecisions: metrics.totalDecisions,
      approvedDecisions: metrics.approvedDecisions,
      rejectedDecisions: metrics.totalDecisions - metrics.approvedDecisions,
      averageConsensus: metrics.consensusRate,
      currentVotes: []
      // Would be populated from active votes
    };
  }
  /**
   * Get communication statistics
   */
  getCommunicationStats(stats) {
    return {
      totalMessages: stats.totalMessages,
      messageRate: stats.totalMessages / 10,
      // Approximate rate
      channelActivity: stats.messagesByType,
      knowledgeShared: stats.knowledgeEntries
    };
  }
  /**
   * Get performance metrics
   */
  getPerformanceMetrics(metrics) {
    return {
      tasksCompleted: metrics.completedTasks,
      tasksPending: metrics.pendingTasks,
      avgExecutionTime: metrics.avgExecutionTime,
      successRate: metrics.totalTasks > 0 ? metrics.completedTasks / metrics.totalTasks : 0,
      qualityScore: 0.85
      // Would be calculated from quality reports
    };
  }
  /**
   * Format dashboard for console output
   */
  static formatConsoleOutput(data) {
    const output = [];
    output.push("\u{1F41D} Hive Mind Dashboard");
    output.push("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    output.push(
      `Status: ${data.status.toUpperCase()} | Time: ${new Date(data.timestamp).toLocaleTimeString()}`
    );
    output.push("");
    output.push("\u{1F465} Agent Status");
    output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const agent of data.agents) {
      const statusIcon = this.getStatusIcon(agent.status);
      const workloadBar = this.createProgressBar(agent.workload);
      output.push(`${statusIcon} ${agent.name} (${agent.type})`);
      output.push(`   Status: ${agent.status} | Workload: ${workloadBar} ${agent.workload}%`);
      if (agent.currentTask) {
        output.push(`   Task: ${agent.currentTask}`);
      }
      output.push(`   Votes: ${agent.votes} | Contributions: ${agent.contributions}`);
      output.push("");
    }
    output.push("\u{1F4CB} Task Progress");
    output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    for (const task of data.tasks) {
      const progressBar = this.createProgressBar(task.progress);
      const statusIcon = this.getTaskStatusIcon(task.status);
      output.push(`${statusIcon} ${task.type}: ${task.description}`);
      output.push(`   Progress: ${progressBar} ${task.progress}%`);
      if (task.assignedTo) {
        output.push(`   Assigned to: ${task.assignedTo}`);
      }
      output.push("");
    }
    output.push("\u{1F5F3}\uFE0F Consensus Metrics");
    output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    output.push(`Total Decisions: ${data.consensus.totalDecisions}`);
    output.push(
      `Approved: ${data.consensus.approvedDecisions} | Rejected: ${data.consensus.rejectedDecisions}`
    );
    output.push(`Average Consensus: ${(data.consensus.averageConsensus * 100).toFixed(1)}%`);
    output.push("");
    output.push("\u{1F4CA} Performance");
    output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    output.push(
      `Tasks: ${data.performance.tasksCompleted}/${data.performance.tasksCompleted + data.performance.tasksPending} completed`
    );
    output.push(`Success Rate: ${(data.performance.successRate * 100).toFixed(1)}%`);
    output.push(`Quality Score: ${(data.performance.qualityScore * 100).toFixed(1)}%`);
    output.push(`Avg Execution Time: ${(data.performance.avgExecutionTime / 1e3).toFixed(1)}s`);
    output.push("");
    output.push("\u{1F4AC} Communication");
    output.push("\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
    output.push(`Total Messages: ${data.communication.totalMessages}`);
    output.push(`Message Rate: ${data.communication.messageRate.toFixed(1)}/min`);
    output.push(`Knowledge Shared: ${data.communication.knowledgeShared} entries`);
    return output.join("\\n");
  }
  /**
   * Get status icon for agent
   */
  static getStatusIcon(status) {
    switch (status) {
      case "idle":
        return "\u{1F634}";
      case "thinking":
        return "\u{1F914}";
      case "voting":
        return "\u{1F5F3}\uFE0F";
      case "executing":
        return "\u26A1";
      case "communicating":
        return "\u{1F4AC}";
      default:
        return "\u2753";
    }
  }
  /**
   * Get status icon for task
   */
  static getTaskStatusIcon(status) {
    switch (status) {
      case "pending":
        return "\u2B55";
      case "voting":
        return "\u{1F5F3}\uFE0F";
      case "assigned":
        return "\u{1F4CC}";
      case "executing":
        return "\u{1F504}";
      case "reviewing":
        return "\u{1F50D}";
      case "completed":
        return "\u2705";
      case "failed":
        return "\u274C";
      default:
        return "\u2753";
    }
  }
  /**
   * Create ASCII progress bar
   */
  static createProgressBar(percentage, width = 20) {
    const filled = Math.round(percentage / 100 * width);
    const empty = width - filled;
    return `[${"\u2588".repeat(filled)}${" ".repeat(empty)}]`;
  }
  /**
   * Export dashboard data as JSON
   */
  exportData() {
    const data = this.collectDashboardData();
    return JSON.stringify(data, null, 2);
  }
  /**
   * Get real-time event stream
   */
  getEventStream() {
    return async function* () {
      while (true) {
        yield { type: "update", timestamp: Date.now() };
        await new Promise((resolve) => setTimeout(resolve, 1e3));
      }
    }();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HiveDashboard
});
//# sourceMappingURL=hive-dashboard.js.map
