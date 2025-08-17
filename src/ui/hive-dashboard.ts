/**
 * Hive Mind Monitoring Dashboard
 * Real-time visualization of swarm activity and consensus
 */

import { HiveOrchestrator } from '../coordination/hive-orchestrator.js';
import { HiveCommunicationProtocol } from '../coordination/hive-protocol.js';

export interface HiveDashboardData {
  swarmId: string;
  status: 'initializing' | 'active' | 'voting' | 'executing' | 'completed';
  agents: AgentStatus[];
  tasks: TaskProgress[];
  consensus: ConsensusMetrics;
  communication: CommunicationStats;
  performance: PerformanceMetrics;
  timestamp: number;
}

export interface AgentStatus {
  id: string;
  name: string;
  type: string;
  status: 'idle' | 'thinking' | 'voting' | 'executing' | 'communicating';
  currentTask?: string;
  workload: number; // 0-100
  votes: number;
  contributions: number;
}

export interface TaskProgress {
  id: string;
  type: string;
  description: string;
  status: string;
  assignedTo?: string;
  progress: number; // 0-100
  dependencies: string[];
  votes?: { approve: number; reject: number };
}

export interface ConsensusMetrics {
  totalDecisions: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  averageConsensus: number;
  currentVotes: VoteStatus[];
}

export interface VoteStatus {
  topic: string;
  votes: { for: number; against: number; pending: number };
  deadline?: number;
}

export interface CommunicationStats {
  totalMessages: number;
  messageRate: number; // messages per minute
  channelActivity: Map<string, number>;
  knowledgeShared: number;
}

export interface PerformanceMetrics {
  tasksCompleted: number;
  tasksPending: number;
  avgExecutionTime: number;
  successRate: number;
  qualityScore: number;
}

export class HiveDashboard {
  private orchestrator: HiveOrchestrator;
  private protocol: HiveCommunicationProtocol;
  private refreshInterval: number = 1000; // 1 second
  private updateCallback?: (data: HiveDashboardData) => void;

  constructor(orchestrator: HiveOrchestrator, protocol: HiveCommunicationProtocol) {
    this.orchestrator = orchestrator;
    this.protocol = protocol;
  }

  /**
   * Start monitoring with callback for updates
   */
  startMonitoring(callback: (data: HiveDashboardData) => void) {
    this.updateCallback = callback;
    this.update();

    // Set up periodic updates
    const interval = setInterval(() => {
      this.update();
    }, this.refreshInterval);

    return () => clearInterval(interval);
  }

  /**
   * Get current dashboard data
   */
  private update() {
    const data = this.collectDashboardData();
    if (this.updateCallback) {
      this.updateCallback(data);
    }
  }

  /**
   * Collect all dashboard data
   */
  private collectDashboardData(): HiveDashboardData {
    const perfMetrics = this.orchestrator.getPerformanceMetrics();
    const commStats = this.protocol.getStatistics();

    return {
      swarmId: 'current-swarm',
      status: this.determineSwarmStatus(perfMetrics),
      agents: this.getAgentStatuses(),
      tasks: this.getTaskProgress(),
      consensus: this.getConsensusMetrics(),
      communication: this.getCommunicationStats(commStats),
      performance: this.getPerformanceMetrics(perfMetrics),
      timestamp: Date.now(),
    };
  }

  /**
   * Determine overall swarm status
   */
  private determineSwarmStatus(metrics: any): HiveDashboardData['status'] {
    if (metrics.executingTasks > 0) return 'executing';
    if (metrics.pendingTasks > 0) return 'active';
    if (metrics.completedTasks === metrics.totalTasks) return 'completed';
    return 'initializing';
  }

  /**
   * Get status of all agents
   */
  private getAgentStatuses(): AgentStatus[] {
    // This would be populated from actual agent data
    return [
      {
        id: 'queen-1',
        name: 'Queen-Genesis',
        type: 'queen',
        status: 'thinking',
        workload: 85,
        votes: 15,
        contributions: 42,
      },
      {
        id: 'architect-1',
        name: 'Architect-1',
        type: 'architect',
        status: 'executing',
        currentTask: 'Design system architecture',
        workload: 70,
        votes: 8,
        contributions: 23,
      },
      {
        id: 'worker-1',
        name: 'Worker-1',
        type: 'worker',
        status: 'voting',
        workload: 45,
        votes: 12,
        contributions: 31,
      },
    ];
  }

  /**
   * Get task progress information
   */
  private getTaskProgress(): TaskProgress[] {
    const taskGraph = this.orchestrator.getTaskGraph();
    return taskGraph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      description: `${node.type} task`,
      status: node.status,
      assignedTo: node.assignedTo,
      progress: this.calculateTaskProgress(node.status),
      dependencies: [],
    }));
  }

  /**
   * Calculate task progress based on status
   */
  private calculateTaskProgress(status: string): number {
    switch (status) {
      case 'completed':
        return 100;
      case 'executing':
        return 50;
      case 'assigned':
        return 25;
      case 'voting':
        return 10;
      case 'pending':
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Get consensus metrics
   */
  private getConsensusMetrics(): ConsensusMetrics {
    const metrics = this.orchestrator.getPerformanceMetrics();
    return {
      totalDecisions: metrics.totalDecisions,
      approvedDecisions: metrics.approvedDecisions,
      rejectedDecisions: metrics.totalDecisions - metrics.approvedDecisions,
      averageConsensus: metrics.consensusRate,
      currentVotes: [], // Would be populated from active votes
    };
  }

  /**
   * Get communication statistics
   */
  private getCommunicationStats(stats: any): CommunicationStats {
    return {
      totalMessages: stats.totalMessages,
      messageRate: stats.totalMessages / 10, // Approximate rate
      channelActivity: stats.messagesByType,
      knowledgeShared: stats.knowledgeEntries,
    };
  }

  /**
   * Get performance metrics
   */
  private getPerformanceMetrics(metrics: any): PerformanceMetrics {
    return {
      tasksCompleted: metrics.completedTasks,
      tasksPending: metrics.pendingTasks,
      avgExecutionTime: metrics.avgExecutionTime,
      successRate: metrics.totalTasks > 0 ? metrics.completedTasks / metrics.totalTasks : 0,
      qualityScore: 0.85, // Would be calculated from quality reports
    };
  }

  /**
   * Format dashboard for console output
   */
  static formatConsoleOutput(data: HiveDashboardData): string {
    const output = [];

    // Header
    output.push('🐝 Hive Mind Dashboard');
    output.push('═══════════════════════════════════════════════════════════════');
    output.push(
      `Status: ${data.status.toUpperCase()} | Time: ${new Date(data.timestamp).toLocaleTimeString()}`,
    );
    output.push('');

    // Agents Section
    output.push('👥 Agent Status');
    output.push('───────────────────────────────────────────────────────────────');
    for (const agent of data.agents) {
      const statusIcon = this.getStatusIcon(agent.status);
      const workloadBar = this.createProgressBar(agent.workload);
      output.push(`${statusIcon} ${agent.name} (${agent.type})`);
      output.push(`   Status: ${agent.status} | Workload: ${workloadBar} ${agent.workload}%`);
      if (agent.currentTask) {
        output.push(`   Task: ${agent.currentTask}`);
      }
      output.push(`   Votes: ${agent.votes} | Contributions: ${agent.contributions}`);
      output.push('');
    }

    // Tasks Section
    output.push('📋 Task Progress');
    output.push('───────────────────────────────────────────────────────────────');
    for (const task of data.tasks) {
      const progressBar = this.createProgressBar(task.progress);
      const statusIcon = this.getTaskStatusIcon(task.status);
      output.push(`${statusIcon} ${task.type}: ${task.description}`);
      output.push(`   Progress: ${progressBar} ${task.progress}%`);
      if (task.assignedTo) {
        output.push(`   Assigned to: ${task.assignedTo}`);
      }
      output.push('');
    }

    // Consensus Section
    output.push('🗳️ Consensus Metrics');
    output.push('───────────────────────────────────────────────────────────────');
    output.push(`Total Decisions: ${data.consensus.totalDecisions}`);
    output.push(
      `Approved: ${data.consensus.approvedDecisions} | Rejected: ${data.consensus.rejectedDecisions}`,
    );
    output.push(`Average Consensus: ${(data.consensus.averageConsensus * 100).toFixed(1)}%`);
    output.push('');

    // Performance Section
    output.push('📊 Performance');
    output.push('───────────────────────────────────────────────────────────────');
    output.push(
      `Tasks: ${data.performance.tasksCompleted}/${data.performance.tasksCompleted + data.performance.tasksPending} completed`,
    );
    output.push(`Success Rate: ${(data.performance.successRate * 100).toFixed(1)}%`);
    output.push(`Quality Score: ${(data.performance.qualityScore * 100).toFixed(1)}%`);
    output.push(`Avg Execution Time: ${(data.performance.avgExecutionTime / 1000).toFixed(1)}s`);
    output.push('');

    // Communication Section
    output.push('💬 Communication');
    output.push('───────────────────────────────────────────────────────────────');
    output.push(`Total Messages: ${data.communication.totalMessages}`);
    output.push(`Message Rate: ${data.communication.messageRate.toFixed(1)}/min`);
    output.push(`Knowledge Shared: ${data.communication.knowledgeShared} entries`);

    return output.join('\\n');
  }

  /**
   * Get status icon for agent
   */
  private static getStatusIcon(status: AgentStatus['status']): string {
    switch (status) {
      case 'idle':
        return '😴';
      case 'thinking':
        return '🤔';
      case 'voting':
        return '🗳️';
      case 'executing':
        return '⚡';
      case 'communicating':
        return '💬';
      default:
        return '❓';
    }
  }

  /**
   * Get status icon for task
   */
  private static getTaskStatusIcon(status: string): string {
    switch (status) {
      case 'pending':
        return '⭕';
      case 'voting':
        return '🗳️';
      case 'assigned':
        return '📌';
      case 'executing':
        return '🔄';
      case 'reviewing':
        return '🔍';
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      default:
        return '❓';
    }
  }

  /**
   * Create ASCII progress bar
   */
  private static createProgressBar(percentage: number, width: number = 20): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${' '.repeat(empty)}]`;
  }

  /**
   * Export dashboard data as JSON
   */
  exportData(): string {
    const data = this.collectDashboardData();
    return JSON.stringify(data, null, 2);
  }

  /**
   * Get real-time event stream
   */
  getEventStream(): AsyncGenerator<any> {
    // This would return a stream of dashboard events
    return (async function* () {
      while (true) {
        yield { type: 'update', timestamp: Date.now() };
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    })();
  }
}
