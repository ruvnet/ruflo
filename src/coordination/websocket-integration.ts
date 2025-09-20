import { getErrorMessage } from '../utils/error-handler.js';
import { EventEmitter } from 'node:events';
import { Logger } from '../core/logger.js';
import { EventBus } from '../core/event-bus.js';
import { WebSocketCoordinator, WebSocketCoordinatorConfig } from './websocket-coordinator.js';
import { MemoryManager } from '../memory/manager.js';
import type { SwarmCoordinator, SwarmAgent, SwarmTask } from './swarm-coordinator.js';
import type { Message } from '../utils/types.js';
import { generateId } from '../utils/helpers.js';

export interface WebSocketIntegrationConfig extends Partial<WebSocketCoordinatorConfig> {
  enableSwarmIntegration: boolean;
  enableTaskBroadcast: boolean;
  enableAgentDiscovery: boolean;
  enableHealthReporting: boolean;
  swarmEventTypes: string[];
  taskUpdateInterval: number;
  agentStatusInterval: number;
}

/**
 * Integration layer between WebSocket coordination and Swarm orchestration
 * Provides real-time communication capabilities to the swarm system
 */
export class WebSocketSwarmIntegration extends EventEmitter {
  private logger: Logger;
  private config: WebSocketIntegrationConfig;
  private wsCoordinator: WebSocketCoordinator;
  private swarmCoordinator: SwarmCoordinator | null = null;
  private memoryManager: MemoryManager;
  private eventBus: EventBus;
  private isInitialized: boolean = false;
  private statusUpdateInterval: NodeJS.Timeout | null = null;
  private taskUpdateInterval: NodeJS.Timeout | null = null;

  constructor(
    config: Partial<WebSocketIntegrationConfig> = {},
    eventBus: EventBus,
    memoryManager: MemoryManager
  ) {
    super();
    this.logger = new Logger('WebSocketSwarmIntegration');
    this.eventBus = eventBus;
    this.memoryManager = memoryManager;
    
    this.config = {
      port: 8080,
      host: '0.0.0.0',
      enableSwarmIntegration: true,
      enableTaskBroadcast: true,
      enableAgentDiscovery: true,
      enableHealthReporting: true,
      swarmEventTypes: [
        'agent:registered',
        'agent:terminated',
        'task:assigned',
        'task:completed',
        'task:failed',
        'objective:created',
        'objective:completed',
        'swarm:status-change'
      ],
      taskUpdateInterval: 5000, // 5 seconds
      agentStatusInterval: 10000, // 10 seconds
      topologyConstraints: 'mesh',
      enableTopologyAware: true,
      ...config
    };

    // Initialize WebSocket coordinator
    this.wsCoordinator = new WebSocketCoordinator(this.config, eventBus, memoryManager);
    this.setupEventHandlers();
  }

  /**
   * Initialize the WebSocket integration
   */
  async initialize(swarmCoordinator?: SwarmCoordinator): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('WebSocket integration already initialized');
      return;
    }

    this.logger.info('Initializing WebSocket swarm integration...');

    try {
      if (swarmCoordinator) {
        this.swarmCoordinator = swarmCoordinator;
        this.setupSwarmIntegration();
      }

      // Start WebSocket coordinator
      await this.wsCoordinator.start();

      // Start background processes
      this.startBackgroundProcesses();

      this.isInitialized = true;
      this.logger.info('WebSocket swarm integration initialized successfully');
      this.emit('integration-initialized');

    } catch (error) {
      this.logger.error('Failed to initialize WebSocket swarm integration:', error);
      throw error;
    }
  }

  /**
   * Shutdown the WebSocket integration
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.logger.info('Shutting down WebSocket swarm integration...');

    // Stop background processes
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }

    if (this.taskUpdateInterval) {
      clearInterval(this.taskUpdateInterval);
      this.taskUpdateInterval = null;
    }

    // Stop WebSocket coordinator
    await this.wsCoordinator.stop();

    this.isInitialized = false;
    this.logger.info('WebSocket swarm integration shutdown complete');
    this.emit('integration-shutdown');
  }

  /**
   * Set up event handlers for integration
   */
  private setupEventHandlers(): void {
    // WebSocket coordinator events
    this.wsCoordinator.on('client-connected', (data) => {
      this.handleClientConnected(data);
    });

    this.wsCoordinator.on('client-disconnected', (data) => {
      this.handleClientDisconnected(data);
    });

    this.wsCoordinator.on('message-processed', (data) => {
      this.handleMessageProcessed(data);
    });

    // System events from EventBus
    if (this.config.enableSwarmIntegration) {
      for (const eventType of this.config.swarmEventTypes) {
        this.eventBus.on(eventType, (data: any) => {
          this.broadcastSwarmEvent(eventType, data);
        });
      }
    }
  }

  /**
   * Set up integration with swarm coordinator
   */
  private setupSwarmIntegration(): void {
    if (!this.swarmCoordinator) {
      return;
    }

    this.logger.info('Setting up swarm coordinator integration');

    // Listen to swarm events
    this.swarmCoordinator.on('agent:registered', (agent: SwarmAgent) => {
      this.handleSwarmAgentRegistered(agent);
    });

    this.swarmCoordinator.on('agent:terminated', (data: { agentId: string }) => {
      this.handleSwarmAgentTerminated(data.agentId);
    });

    this.swarmCoordinator.on('task:assigned', (data: { task: SwarmTask; agent: SwarmAgent }) => {
      this.handleSwarmTaskAssigned(data.task, data.agent);
    });

    this.swarmCoordinator.on('task:completed', (data: { task: SwarmTask; result: any }) => {
      this.handleSwarmTaskCompleted(data.task, data.result);
    });

    this.swarmCoordinator.on('task:failed', (data: { task: SwarmTask; error: any }) => {
      this.handleSwarmTaskFailed(data.task, data.error);
    });

    this.swarmCoordinator.on('objective:created', (objective: any) => {
      this.handleSwarmObjectiveCreated(objective);
    });

    this.swarmCoordinator.on('objective:completed', (objective: any) => {
      this.handleSwarmObjectiveCompleted(objective);
    });
  }

  /**
   * Handle new client connection
   */
  private async handleClientConnected(data: { clientId: string; agentId: string }): Promise<void> {
    this.logger.info(`Agent ${data.agentId} connected via WebSocket (client: ${data.clientId})`);

    // If swarm integration is enabled, register the agent with the swarm
    if (this.config.enableSwarmIntegration && this.swarmCoordinator) {
      try {
        // Check if agent is already registered
        const existingAgent = this.swarmCoordinator.getAgentStatus(data.agentId);
        if (!existingAgent) {
          // Register new agent with swarm coordinator
          await this.swarmCoordinator.registerAgent(
            data.agentId,
            'coordinator', // Default type, can be customized
            ['websocket-communication', 'real-time-coordination']
          );
        }
      } catch (error) {
        this.logger.error(`Failed to register agent ${data.agentId} with swarm:`, error);
      }
    }

    // Send initial state to the new client
    await this.sendInitialState(data.agentId);

    this.emit('agent-connected', data);
  }

  /**
   * Handle client disconnection
   */
  private async handleClientDisconnected(data: { clientId: string; agentId: string }): Promise<void> {
    this.logger.info(`Agent ${data.agentId} disconnected from WebSocket (client: ${data.clientId})`);

    // Check if this was the last connection for the agent
    const connectedAgents = this.wsCoordinator.getConnectedAgents();
    const agentStillConnected = connectedAgents.some(agent => agent.agentId === data.agentId);

    if (!agentStillConnected && this.config.enableSwarmIntegration && this.swarmCoordinator) {
      // Agent is completely disconnected, notify swarm
      this.eventBus.emit('agent:terminated', { agentId: data.agentId });
    }

    this.emit('agent-disconnected', data);
  }

  /**
   * Handle processed message
   */
  private async handleMessageProcessed(data: { client: string; message: any }): Promise<void> {
    // Process message for swarm integration
    const message = data.message;

    if (message.type === 'task-update' && this.config.enableTaskBroadcast) {
      await this.handleTaskUpdate(message);
    } else if (message.type === 'agent-status' && this.config.enableAgentDiscovery) {
      await this.handleAgentStatusUpdate(message);
    } else if (message.type === 'health-report' && this.config.enableHealthReporting) {
      await this.handleHealthReport(message);
    }
  }

  /**
   * Broadcast swarm event to all connected agents
   */
  private async broadcastSwarmEvent(eventType: string, data: any): Promise<void> {
    try {
      const payload = {
        eventType,
        data,
        timestamp: Date.now(),
        source: 'swarm-coordinator'
      };

      const delivered = await this.wsCoordinator.broadcastMessage('swarm-coordinator', payload);
      this.logger.debug(`Broadcasted ${eventType} event to ${delivered} agents`);

    } catch (error) {
      this.logger.error(`Failed to broadcast swarm event ${eventType}:`, error);
    }
  }

  /**
   * Swarm event handlers
   */
  private async handleSwarmAgentRegistered(agent: SwarmAgent): Promise<void> {
    await this.broadcastSwarmEvent('agent-registered', {
      agentId: agent.id,
      name: agent.name,
      type: agent.type,
      capabilities: agent.capabilities,
      status: agent.status
    });
  }

  private async handleSwarmAgentTerminated(agentId: string): Promise<void> {
    await this.broadcastSwarmEvent('agent-terminated', { agentId });
  }

  private async handleSwarmTaskAssigned(task: SwarmTask, agent: SwarmAgent): Promise<void> {
    // Notify the specific agent about their new task
    try {
      await this.wsCoordinator.sendMessageWithResponse(
        'swarm-coordinator',
        agent.id,
        {
          type: 'task-assigned',
          task: {
            id: task.id,
            type: task.type,
            description: task.description,
            priority: task.priority,
            dependencies: task.dependencies,
            timeout: task.timeout
          }
        },
        5000
      );
    } catch (error) {
      this.logger.error(`Failed to notify agent ${agent.id} about task assignment:`, error);
    }

    // Broadcast to all agents for coordination awareness
    if (this.config.enableTaskBroadcast) {
      await this.broadcastSwarmEvent('task-assigned', {
        taskId: task.id,
        agentId: agent.id,
        taskType: task.type,
        priority: task.priority
      });
    }
  }

  private async handleSwarmTaskCompleted(task: SwarmTask, result: any): Promise<void> {
    if (this.config.enableTaskBroadcast) {
      await this.broadcastSwarmEvent('task-completed', {
        taskId: task.id,
        agentId: task.assignedTo,
        result: result,
        completedAt: task.completedAt
      });
    }
  }

  private async handleSwarmTaskFailed(task: SwarmTask, error: any): Promise<void> {
    if (this.config.enableTaskBroadcast) {
      await this.broadcastSwarmEvent('task-failed', {
        taskId: task.id,
        agentId: task.assignedTo,
        error: getErrorMessage(error),
        retryCount: task.retryCount,
        maxRetries: task.maxRetries
      });
    }
  }

  private async handleSwarmObjectiveCreated(objective: any): Promise<void> {
    await this.broadcastSwarmEvent('objective-created', {
      objectiveId: objective.id,
      description: objective.description,
      strategy: objective.strategy,
      taskCount: objective.tasks.length
    });
  }

  private async handleSwarmObjectiveCompleted(objective: any): Promise<void> {
    await this.broadcastSwarmEvent('objective-completed', {
      objectiveId: objective.id,
      completedAt: objective.completedAt,
      duration: objective.completedAt - objective.createdAt
    });
  }

  /**
   * Message handlers
   */
  private async handleTaskUpdate(message: any): Promise<void> {
    if (this.swarmCoordinator && message.payload) {
      const { taskId, status, progress, result, error } = message.payload;

      try {
        if (status === 'completed' && result) {
          this.eventBus.emit('task:completed', { taskId, result });
        } else if (status === 'failed' && error) {
          this.eventBus.emit('task:failed', { taskId, error });
        }
      } catch (err) {
        this.logger.error(`Failed to process task update for ${taskId}:`, err);
      }
    }
  }

  private async handleAgentStatusUpdate(message: any): Promise<void> {
    if (message.payload) {
      const { agentId, status, capabilities, metrics } = message.payload;

      // Update internal tracking
      await this.updateAgentStatus(agentId, {
        status,
        capabilities,
        metrics,
        lastUpdate: Date.now()
      });

      // Broadcast status change if significant
      if (status === 'idle' || status === 'busy' || status === 'failed') {
        await this.broadcastSwarmEvent('agent-status-change', {
          agentId,
          status,
          timestamp: Date.now()
        });
      }
    }
  }

  private async handleHealthReport(message: any): Promise<void> {
    if (message.payload) {
      const { agentId, health } = message.payload;

      // Store health report
      await this.memoryManager.store({
        id: `health-${agentId}-${Date.now()}`,
        agentId,
        type: 'health-report',
        content: JSON.stringify(health),
        namespace: 'websocket-health',
        timestamp: new Date(),
        metadata: {
          healthy: health.healthy,
          errorCount: health.errors?.length || 0
        }
      });

      // Alert if agent is unhealthy
      if (!health.healthy) {
        this.logger.warn(`Agent ${agentId} reported unhealthy status:`, health);
        await this.broadcastSwarmEvent('agent-health-alert', {
          agentId,
          health,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Send initial state to newly connected agent
   */
  private async sendInitialState(agentId: string): Promise<void> {
    try {
      const connectedAgents = this.wsCoordinator.getConnectedAgents();
      const swarmStatus = this.swarmCoordinator?.getSwarmStatus();

      const initialState = {
        type: 'initial-state',
        connectedAgents: connectedAgents.map(agent => ({
          agentId: agent.agentId,
          capabilities: agent.capabilities,
          lastActivity: agent.lastActivity
        })),
        swarmStatus,
        timestamp: Date.now()
      };

      await this.wsCoordinator.sendMessageWithResponse(
        'integration-coordinator',
        agentId,
        initialState,
        5000
      );

    } catch (error) {
      this.logger.error(`Failed to send initial state to agent ${agentId}:`, error);
    }
  }

  /**
   * Update agent status in memory
   */
  private async updateAgentStatus(agentId: string, status: any): Promise<void> {
    try {
      await this.memoryManager.store({
        id: `agent-status-${agentId}`,
        agentId,
        type: 'agent-status',
        content: JSON.stringify(status),
        namespace: 'websocket-agents',
        timestamp: new Date(),
        metadata: {
          status: status.status,
          capabilityCount: status.capabilities?.length || 0
        }
      });
    } catch (error) {
      this.logger.error(`Failed to update agent status for ${agentId}:`, error);
    }
  }

  /**
   * Start background processes
   */
  private startBackgroundProcesses(): void {
    // Periodic status updates
    if (this.config.enableAgentDiscovery) {
      this.statusUpdateInterval = setInterval(() => {
        this.broadcastStatusUpdate();
      }, this.config.agentStatusInterval);
    }

    // Periodic task updates
    if (this.config.enableTaskBroadcast) {
      this.taskUpdateInterval = setInterval(() => {
        this.broadcastTaskUpdate();
      }, this.config.taskUpdateInterval);
    }
  }

  /**
   * Broadcast periodic status update
   */
  private async broadcastStatusUpdate(): Promise<void> {
    try {
      const connectedAgents = this.wsCoordinator.getConnectedAgents();
      const swarmStatus = this.swarmCoordinator?.getSwarmStatus();
      const wsStats = this.wsCoordinator.getConnectionStats();

      const statusUpdate = {
        type: 'status-update',
        agents: connectedAgents.length,
        swarmStatus,
        connectionStats: {
          activeConnections: wsStats.activeConnections,
          totalMessages: wsStats.totalMessages,
          uptime: Date.now() - wsStats.uptime
        },
        timestamp: Date.now()
      };

      await this.wsCoordinator.broadcastMessage('integration-coordinator', statusUpdate);

    } catch (error) {
      this.logger.error('Failed to broadcast status update:', error);
    }
  }

  /**
   * Broadcast periodic task update
   */
  private async broadcastTaskUpdate(): Promise<void> {
    if (!this.swarmCoordinator) {
      return;
    }

    try {
      const swarmStatus = this.swarmCoordinator.getSwarmStatus();

      const taskUpdate = {
        type: 'task-update',
        tasks: swarmStatus.tasks,
        timestamp: Date.now()
      };

      await this.wsCoordinator.broadcastMessage('integration-coordinator', taskUpdate);

    } catch (error) {
      this.logger.error('Failed to broadcast task update:', error);
    }
  }

  /**
   * Public API methods
   */

  /**
   * Get integration status
   */
  getIntegrationStatus(): {
    initialized: boolean;
    wsCoordinatorRunning: boolean;
    swarmIntegrationEnabled: boolean;
    connectedAgents: number;
    activeConnections: number;
    totalMessages: number;
  } {
    const wsStats = this.wsCoordinator.getConnectionStats();
    const connectedAgents = this.wsCoordinator.getConnectedAgents();

    return {
      initialized: this.isInitialized,
      wsCoordinatorRunning: this.wsCoordinator !== null,
      swarmIntegrationEnabled: this.config.enableSwarmIntegration && this.swarmCoordinator !== null,
      connectedAgents: connectedAgents.length,
      activeConnections: wsStats.activeConnections,
      totalMessages: wsStats.totalMessages
    };
  }

  /**
   * Send message to specific agent
   */
  async sendToAgent(agentId: string, payload: any, timeout: number = 30000): Promise<any> {
    return this.wsCoordinator.sendMessageWithResponse('integration-api', agentId, payload, timeout);
  }

  /**
   * Broadcast message to all agents
   */
  async broadcastToAgents(payload: any, excludeAgents: string[] = []): Promise<number> {
    return this.wsCoordinator.broadcastMessage('integration-api', payload, excludeAgents);
  }

  /**
   * Get connected agents info
   */
  getConnectedAgents(): Array<{
    agentId: string;
    clientCount: number;
    capabilities: string[];
    lastActivity: number;
  }> {
    return this.wsCoordinator.getConnectedAgents();
  }

  /**
   * Force disconnect an agent
   */
  async disconnectAgent(agentId: string, reason: string = 'Integration disconnect'): Promise<number> {
    return this.wsCoordinator.disconnectAgent(agentId, reason);
  }

  /**
   * Update topology constraints
   */
  updateTopologyConstraints(constraints: WebSocketCoordinatorConfig['topologyConstraints']): void {
    this.wsCoordinator.updateTopologyConstraints(constraints);
    this.config.topologyConstraints = constraints;
  }

  /**
   * Get comprehensive health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    details: {
      integration: any;
      websocket: any;
      swarm?: any;
    };
  }> {
    try {
      const integrationStatus = this.getIntegrationStatus();
      const wsHealth = await this.wsCoordinator.getHealthStatus();
      const swarmStatus = this.swarmCoordinator?.getSwarmStatus();

      const healthy = this.isInitialized && 
                     wsHealth.healthy && 
                     integrationStatus.wsCoordinatorRunning;

      return {
        healthy,
        details: {
          integration: integrationStatus,
          websocket: wsHealth,
          swarm: swarmStatus
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: getErrorMessage(error),
        details: {
          integration: this.getIntegrationStatus(),
          websocket: { healthy: false, error: getErrorMessage(error) }
        }
      };
    }
  }
}