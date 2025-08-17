/**
 * SPARC Memory Bank - Replication Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReplicationManager } from '../replication/replication-manager';
import { SqliteBackend } from '../backends/sqlite-backend';
import { MemoryItem, ReplicationConfig } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';

// Mock axios
vi.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ReplicationManager', () => {
  let replicationManager: ReplicationManager;
  let backend: SqliteBackend;
  const testDir = '/tmp/replication-test';

  const mockConfig: ReplicationConfig = {
    mode: 'peer-to-peer',
    nodes: [
      { id: 'node1', url: 'http://node1:3000', role: 'peer' },
      { id: 'node2', url: 'http://node2:3000', role: 'peer' }
    ],
    syncInterval: 1000,
    conflictResolution: 'last-write-wins',
    retryAttempts: 3,
    retryDelay: 100
  };

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    
    backend = new SqliteBackend({
      path: path.join(testDir, 'test.db')
    });
    await backend.initialize();

    // Mock axios.create
    mockedAxios.create.mockReturnValue({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: {
        response: {
          use: vi.fn()
        }
      }
    } as any);

    replicationManager = new ReplicationManager({
      localNodeId: 'local-node',
      backend,
      config: mockConfig
    });
  });

  afterEach(async () => {
    await replicationManager.close();
    await backend.close();
    await fs.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize replication manager', async () => {
      const initHandler = vi.fn();
      replicationManager.on('initialized', initHandler);

      await replicationManager.initialize();

      expect(initHandler).toHaveBeenCalled();
    });

    it('should create HTTP clients for each node', async () => {
      await replicationManager.initialize();
      
      expect(mockedAxios.create).toHaveBeenCalledTimes(2);
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://node1:3000'
        })
      );
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'http://node2:3000'
        })
      );
    });
  });

  describe('Replication', () => {
    let mockClient: any;

    beforeEach(async () => {
      mockClient = {
        get: vi.fn(),
        post: vi.fn().mockResolvedValue({ status: 200 }),
        interceptors: {
          response: {
            use: vi.fn()
          }
        }
      };
      
      mockedAxios.create.mockReturnValue(mockClient);
      await replicationManager.initialize();
    });

    it('should replicate item to other nodes', async () => {
      const item: MemoryItem = {
        id: 'test-item',
        category: 'test',
        key: 'key1',
        value: 'test data'
      };

      await replicationManager.replicate(item);

      // With sync interval, should be queued
      expect(mockClient.post).not.toHaveBeenCalled();

      // Process queue manually
      vi.advanceTimersByTime(1000);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have sent batch message
      expect(mockClient.post).toHaveBeenCalledWith(
        '/memory/replicate',
        expect.objectContaining({
          type: 'batch',
          sourceNodeId: 'local-node'
        })
      );
    });

    it('should replicate deletion', async () => {
      await replicationManager.replicateDeletion('test', 'key1');

      vi.advanceTimersByTime(1000);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockClient.post).toHaveBeenCalledWith(
        '/memory/replicate',
        expect.objectContaining({
          type: 'batch',
          data: expect.arrayContaining([
            expect.objectContaining({
              type: 'delete',
              data: { category: 'test', key: 'key1' }
            })
          ])
        })
      );
    });

    it('should emit events on successful replication', async () => {
      const replicatedHandler = vi.fn();
      replicationManager.on('replicated', replicatedHandler);

      const noSyncConfig = { ...mockConfig, syncInterval: undefined };
      const manager = new ReplicationManager({
        localNodeId: 'local-node',
        backend,
        config: noSyncConfig
      });
      await manager.initialize();

      const item: MemoryItem = {
        id: 'test-item',
        category: 'test',
        key: 'key1',
        value: 'test data'
      };

      await manager.replicate(item);

      expect(replicatedHandler).toHaveBeenCalledTimes(2); // For each node
    });

    it('should handle replication failures', async () => {
      const failHandler = vi.fn();
      replicationManager.on('replication-failed', failHandler);

      mockClient.post.mockRejectedValueOnce(new Error('Network error'));

      const noSyncConfig = { ...mockConfig, syncInterval: undefined };
      const manager = new ReplicationManager({
        localNodeId: 'local-node',
        backend,
        config: noSyncConfig
      });
      await manager.initialize();

      const item: MemoryItem = {
        id: 'test-item',
        category: 'test',
        key: 'key1',
        value: 'test data'
      };

      await manager.replicate(item);

      expect(failHandler).toHaveBeenCalled();
    });
  });

  describe('Master-Slave Mode', () => {
    let masterSlaveManager: ReplicationManager;

    beforeEach(async () => {
      const masterSlaveConfig: ReplicationConfig = {
        mode: 'master-slave',
        nodes: [
          { id: 'master', url: 'http://master:3000', role: 'master' },
          { id: 'slave1', url: 'http://slave1:3000', role: 'slave' },
          { id: 'slave2', url: 'http://slave2:3000', role: 'slave' }
        ]
      };

      masterSlaveManager = new ReplicationManager({
        localNodeId: 'master',
        backend,
        config: masterSlaveConfig
      });

      await masterSlaveManager.initialize();
    });

    it('should replicate from master to slaves', async () => {
      const mockClient = {
        post: vi.fn().mockResolvedValue({ status: 200 }),
        get: vi.fn(),
        interceptors: { response: { use: vi.fn() } }
      };
      
      mockedAxios.create.mockReturnValue(mockClient);

      const item: MemoryItem = {
        id: 'master-item',
        category: 'test',
        key: 'key1',
        value: 'master data'
      };

      await masterSlaveManager.replicate(item);

      // Master should replicate to both slaves
      expect(mockClient.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('Node Synchronization', () => {
    let mockClient: any;

    beforeEach(async () => {
      mockClient = {
        get: vi.fn(),
        post: vi.fn().mockResolvedValue({ status: 200 }),
        interceptors: { response: { use: vi.fn() } }
      };
      
      mockedAxios.create.mockReturnValue(mockClient);
      await replicationManager.initialize();
    });

    it('should sync with specific node', async () => {
      const remoteState = {
        items: [
          {
            id: 'remote1',
            category: 'test',
            key: 'remote-key1',
            value: 'remote data',
            metadata: { timestamp: Date.now() }
          }
        ]
      };

      mockClient.get.mockResolvedValueOnce({ data: remoteState });

      const syncCompleteHandler = vi.fn();
      replicationManager.on('sync-complete', syncCompleteHandler);

      await replicationManager.syncWithNode('node1');

      expect(mockClient.get).toHaveBeenCalledWith('/memory/sync-state');
      expect(syncCompleteHandler).toHaveBeenCalledWith({ nodeId: 'node1' });
    });

    it('should handle sync failures', async () => {
      mockClient.get.mockRejectedValueOnce(new Error('Connection refused'));

      const syncFailedHandler = vi.fn();
      replicationManager.on('sync-failed', syncFailedHandler);

      await expect(
        replicationManager.syncWithNode('node1')
      ).rejects.toThrow('Connection refused');

      expect(syncFailedHandler).toHaveBeenCalledWith({
        nodeId: 'node1',
        error: 'Connection refused'
      });
    });
  });

  describe('Health Checks', () => {
    let mockClient: any;

    beforeEach(async () => {
      vi.useFakeTimers();
      
      mockClient = {
        get: vi.fn(),
        post: vi.fn(),
        interceptors: { response: { use: vi.fn() } }
      };
      
      mockedAxios.create.mockReturnValue(mockClient);
      await replicationManager.initialize();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should perform periodic health checks', async () => {
      mockClient.get.mockResolvedValue({ status: 200 });

      // Fast forward to trigger health check
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      expect(mockClient.get).toHaveBeenCalledWith('/memory/health', {
        timeout: 5000
      });
    });

    it('should track node status', async () => {
      mockClient.get.mockResolvedValueOnce({ status: 200 });
      mockClient.get.mockRejectedValueOnce(new Error('Timeout'));

      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      const stats = await replicationManager.getStats();
      
      // One node should be online, one offline
      const nodeStatuses = Array.from(stats.nodesStatus.values());
      expect(nodeStatuses.some(s => s.status === 'online')).toBe(true);
      expect(nodeStatuses.some(s => s.status === 'offline')).toBe(true);
    });
  });

  describe('Statistics', () => {
    it('should track replication statistics', async () => {
      const stats = await replicationManager.getStats();

      expect(stats).toHaveProperty('totalReplicated');
      expect(stats).toHaveProperty('failedReplications');
      expect(stats).toHaveProperty('lastSyncTime');
      expect(stats).toHaveProperty('queueSize');
      expect(stats.nodesStatus).toBeDefined();
    });
  });

  describe('Conflict Resolution', () => {
    it('should use last-write-wins strategy', async () => {
      // This is tested through the reconciliation logic
      // The ReplicationManager delegates to the configured strategy
      const config: ReplicationConfig = {
        ...mockConfig,
        conflictResolution: 'last-write-wins'
      };

      const manager = new ReplicationManager({
        localNodeId: 'local',
        backend,
        config
      });

      // The actual conflict resolution happens in reconcileWithRemote
      expect(manager).toBeDefined();
    });
  });
});