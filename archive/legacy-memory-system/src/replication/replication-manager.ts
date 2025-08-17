/**
 * SPARC Memory Bank - Replication Manager
 * Handles distributed memory synchronization across nodes
 */

import { EventEmitter } from 'events';
import { MemoryItem, MemoryBackend, ReplicationConfig, ReplicationNode } from '../types';
import axios, { AxiosInstance } from 'axios';

interface ReplicationStats {
  totalReplicated: number;
  failedReplications: number;
  lastSyncTime: number;
  nodesStatus: Map<string, NodeStatus>;
  queueSize: number;
}

interface NodeStatus {
  id: string;
  url: string;
  status: 'online' | 'offline' | 'syncing';
  lastSeen: number;
  lastError?: string;
  itemsReplicated: number;
  itemsFailed: number;
}

interface ReplicationMessage {
  type: 'store' | 'delete' | 'batch' | 'sync';
  sourceNodeId: string;
  timestamp: number;
  data: any;
  signature?: string;
}

export class ReplicationManager extends EventEmitter {
  private localNodeId: string;
  private backend: MemoryBackend;
  private config: ReplicationConfig;
  private nodes: Map<string, ReplicationNode> = new Map();
  private nodeClients: Map<string, AxiosInstance> = new Map();
  private nodeStatus: Map<string, NodeStatus> = new Map();
  private replicationQueue: ReplicationMessage[] = [];
  private syncInterval?: NodeJS.Timer;
  private healthCheckInterval?: NodeJS.Timer;
  private stats: ReplicationStats;
  private isReplicating: boolean = false;

  constructor(options: {
    localNodeId: string;
    backend: MemoryBackend;
    config: ReplicationConfig;
  }) {
    super();
    
    this.localNodeId = options.localNodeId;
    this.backend = options.backend;
    this.config = options.config;
    
    this.stats = {
      totalReplicated: 0,
      failedReplications: 0,
      lastSyncTime: 0,
      nodesStatus: this.nodeStatus,
      queueSize: 0
    };

    // Initialize nodes
    for (const node of options.config.nodes) {
      this.nodes.set(node.id, node);
      this.initializeNodeClient(node);
    }
  }

  async initialize(): Promise<void> {
    // Start sync interval
    if (this.config.syncInterval) {
      this.syncInterval = setInterval(
        () => this.processSyncQueue(),
        this.config.syncInterval
      );
    }

    // Start health check interval
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      30000 // 30 seconds
    );

    // Perform initial health check
    await this.performHealthChecks();

    this.emit('initialized');
  }

  /**
   * Replicate a memory item to other nodes
   */
  async replicate(item: MemoryItem): Promise<void> {
    const message: ReplicationMessage = {
      type: 'store',
      sourceNodeId: this.localNodeId,
      timestamp: Date.now(),
      data: item
    };

    if (this.config.mode === 'master-slave') {
      await this.replicateMasterSlave(message);
    } else {
      await this.replicatePeerToPeer(message);
    }
  }

  /**
   * Replicate deletion to other nodes
   */
  async replicateDeletion(category: string, key: string): Promise<void> {
    const message: ReplicationMessage = {
      type: 'delete',
      sourceNodeId: this.localNodeId,
      timestamp: Date.now(),
      data: { category, key }
    };

    if (this.config.mode === 'master-slave') {
      await this.replicateMasterSlave(message);
    } else {
      await this.replicatePeerToPeer(message);
    }
  }

  /**
   * Sync with a specific node
   */
  async syncWithNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    const status = this.nodeStatus.get(nodeId);
    if (status) {
      status.status = 'syncing';
    }

    try {
      // Get remote node's state
      const client = this.nodeClients.get(nodeId);
      if (!client) {
        throw new Error(`No client for node ${nodeId}`);
      }

      const response = await client.get('/memory/sync-state');
      const remoteState = response.data;

      // Compare and sync differences
      await this.reconcileWithRemote(nodeId, remoteState);

      if (status) {
        status.status = 'online';
        status.lastSeen = Date.now();
      }

      this.emit('sync-complete', { nodeId });
    } catch (error: any) {
      if (status) {
        status.status = 'offline';
        status.lastError = error.message;
      }

      this.emit('sync-failed', { nodeId, error: error.message });
      throw error;
    }
  }

  /**
   * Get replication statistics
   */
  async getStats(): Promise<ReplicationStats> {
    this.stats.queueSize = this.replicationQueue.length;
    return { ...this.stats };
  }

  /**
   * Close and cleanup
   */
  async close(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Process remaining queue
    if (this.replicationQueue.length > 0) {
      await this.processSyncQueue();
    }

    this.emit('closed');
  }

  /**
   * Initialize HTTP client for a node
   */
  private initializeNodeClient(node: ReplicationNode): void {
    const client = axios.create({
      baseURL: node.url,
      timeout: 30000,
      headers: {
        'X-Node-ID': this.localNodeId,
        'Content-Type': 'application/json'
      }
    });

    // Add retry logic
    client.interceptors.response.use(
      response => response,
      async error => {
        const config = error.config;
        
        if (!config || !config.retry) {
          config.retry = 0;
        }

        if (config.retry < (this.config.retryAttempts || 3)) {
          config.retry++;
          
          await new Promise(resolve => 
            setTimeout(resolve, this.config.retryDelay || 1000)
          );
          
          return client(config);
        }

        return Promise.reject(error);
      }
    );

    this.nodeClients.set(node.id, client);

    // Initialize status
    this.nodeStatus.set(node.id, {
      id: node.id,
      url: node.url,
      status: 'offline',
      lastSeen: 0,
      itemsReplicated: 0,
      itemsFailed: 0
    });
  }

  /**
   * Replicate in master-slave mode
   */
  private async replicateMasterSlave(message: ReplicationMessage): Promise<void> {
    const localNode = Array.from(this.nodes.values()).find(
      n => n.id === this.localNodeId
    );

    if (localNode?.role === 'master') {
      // Master replicates to all slaves
      const slaves = Array.from(this.nodes.values()).filter(
        n => n.role === 'slave'
      );

      await this.replicateToNodes(slaves, message);
    } else {
      // Slave sends to master
      const master = Array.from(this.nodes.values()).find(
        n => n.role === 'master'
      );

      if (master) {
        await this.replicateToNodes([master], message);
      }
    }
  }

  /**
   * Replicate in peer-to-peer mode
   */
  private async replicatePeerToPeer(message: ReplicationMessage): Promise<void> {
    // Replicate to all peers
    const peers = Array.from(this.nodes.values()).filter(
      n => n.id !== this.localNodeId
    );

    await this.replicateToNodes(peers, message);
  }

  /**
   * Replicate message to specific nodes
   */
  private async replicateToNodes(
    nodes: ReplicationNode[], 
    message: ReplicationMessage
  ): Promise<void> {
    // Queue message if sync interval is set
    if (this.config.syncInterval) {
      this.replicationQueue.push(message);
      return;
    }

    // Otherwise, replicate immediately
    await Promise.allSettled(
      nodes.map(node => this.sendToNode(node.id, message))
    );
  }

  /**
   * Send message to a specific node
   */
  private async sendToNode(
    nodeId: string, 
    message: ReplicationMessage
  ): Promise<void> {
    const client = this.nodeClients.get(nodeId);
    const status = this.nodeStatus.get(nodeId);

    if (!client || !status) {
      return;
    }

    try {
      await client.post('/memory/replicate', message);
      
      status.itemsReplicated++;
      this.stats.totalReplicated++;
      
      this.emit('replicated', { nodeId, message });
    } catch (error: any) {
      status.itemsFailed++;
      this.stats.failedReplications++;
      
      this.emit('replication-failed', { 
        nodeId, 
        message, 
        error: error.message 
      });
    }
  }

  /**
   * Process queued replication messages
   */
  private async processSyncQueue(): Promise<void> {
    if (this.isReplicating || this.replicationQueue.length === 0) {
      return;
    }

    this.isReplicating = true;
    this.stats.lastSyncTime = Date.now();

    // Group messages by node
    const messagesByNode = new Map<string, ReplicationMessage[]>();
    
    while (this.replicationQueue.length > 0) {
      const message = this.replicationQueue.shift()!;
      
      for (const node of this.nodes.values()) {
        if (node.id === this.localNodeId) continue;
        
        if (!messagesByNode.has(node.id)) {
          messagesByNode.set(node.id, []);
        }
        
        messagesByNode.get(node.id)!.push(message);
      }
    }

    // Send batch messages to each node
    await Promise.allSettled(
      Array.from(messagesByNode.entries()).map(([nodeId, messages]) =>
        this.sendBatchToNode(nodeId, messages)
      )
    );

    this.isReplicating = false;
  }

  /**
   * Send batch of messages to a node
   */
  private async sendBatchToNode(
    nodeId: string, 
    messages: ReplicationMessage[]
  ): Promise<void> {
    const batchMessage: ReplicationMessage = {
      type: 'batch',
      sourceNodeId: this.localNodeId,
      timestamp: Date.now(),
      data: messages
    };

    await this.sendToNode(nodeId, batchMessage);
  }

  /**
   * Perform health checks on all nodes
   */
  private async performHealthChecks(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.nodes.values()).map(node => 
        this.checkNodeHealth(node.id)
      )
    );
  }

  /**
   * Check health of a specific node
   */
  private async checkNodeHealth(nodeId: string): Promise<void> {
    if (nodeId === this.localNodeId) return;

    const client = this.nodeClients.get(nodeId);
    const status = this.nodeStatus.get(nodeId);

    if (!client || !status) return;

    try {
      const response = await client.get('/memory/health', {
        timeout: 5000
      });

      if (response.status === 200) {
        status.status = 'online';
        status.lastSeen = Date.now();
        status.lastError = undefined;
      }
    } catch (error: any) {
      status.status = 'offline';
      status.lastError = error.message;
    }
  }

  /**
   * Reconcile local state with remote node
   */
  private async reconcileWithRemote(
    nodeId: string, 
    remoteState: any
  ): Promise<void> {
    // This is a simplified reconciliation
    // In production, you'd want more sophisticated conflict resolution
    
    const localItems = await this.backend.query({});
    const localMap = new Map(
      localItems.map(item => [`${item.category}:${item.key}`, item])
    );

    const remoteMap = new Map(
      remoteState.items.map((item: MemoryItem) => 
        [`${item.category}:${item.key}`, item]
      )
    );

    // Find items to pull from remote
    const toPull: MemoryItem[] = [];
    for (const [key, remoteItem] of remoteMap) {
      const localItem = localMap.get(key);
      
      if (!localItem || this.shouldPullRemote(localItem, remoteItem)) {
        toPull.push(remoteItem);
      }
    }

    // Find items to push to remote
    const toPush: MemoryItem[] = [];
    for (const [key, localItem] of localMap) {
      const remoteItem = remoteMap.get(key);
      
      if (!remoteItem || this.shouldPushLocal(localItem, remoteItem)) {
        toPush.push(localItem);
      }
    }

    // Apply changes
    for (const item of toPull) {
      await this.backend.store(item);
    }

    if (toPush.length > 0) {
      const client = this.nodeClients.get(nodeId);
      if (client) {
        await client.post('/memory/batch-store', { items: toPush });
      }
    }
  }

  /**
   * Determine if should pull remote version
   */
  private shouldPullRemote(local: MemoryItem, remote: MemoryItem): boolean {
    // Use configured conflict resolution strategy
    switch (this.config.conflictResolution) {
      case 'last-write-wins':
        const localTime = local.metadata?.timestamp || 0;
        const remoteTime = remote.metadata?.timestamp || 0;
        return remoteTime > localTime;
        
      case 'vector-clock':
        // Simplified vector clock comparison
        return this.compareVectorClocks(local, remote) < 0;
        
      default:
        return false;
    }
  }

  /**
   * Determine if should push local version
   */
  private shouldPushLocal(local: MemoryItem, remote: MemoryItem): boolean {
    return !this.shouldPullRemote(local, remote);
  }

  /**
   * Compare vector clocks (simplified)
   */
  private compareVectorClocks(item1: MemoryItem, item2: MemoryItem): number {
    const v1 = item1.metadata?.version || '0';
    const v2 = item2.metadata?.version || '0';
    
    if (v1 < v2) return -1;
    if (v1 > v2) return 1;
    return 0;
  }
}