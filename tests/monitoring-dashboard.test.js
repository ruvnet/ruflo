/**
 * Tests for Real-Time Monitoring Dashboard
 * 
 * Verifies WebSocket communication, metric collection,
 * alert management, and component registration.
 */

import { jest } from '@jest/globals';
import { RealTimeMonitoringDashboard } from '../src/monitoring/real-time-dashboard.js';
import WebSocket from 'ws';
import fetch from 'node-fetch';

describe('Real-Time Monitoring Dashboard', () => {
  let dashboard;
  const testPort = 3457; // Use different port for tests
  
  beforeEach(async () => {
    dashboard = new RealTimeMonitoringDashboard({
      port: testPort,
      updateInterval: 100 // Faster updates for testing
    });
    
    // Wait for server to start
    await new Promise(resolve => {
      dashboard.once('server-started', resolve);
    });
    
    // Give server extra time to be fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });
  
  afterEach(async () => {
    await dashboard.stop();
  });
  
  describe('HTTP API', () => {
    test('should serve dashboard UI', async () => {
      const response = await fetch(`http://localhost:${testPort}/`);
      expect(response.ok).toBe(true);
      
      const html = await response.text();
      expect(html).toContain('Claude Flow MCP - Real-Time Monitoring Dashboard');
    });
    
    test('should provide system status endpoint', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/status`);
      expect(response.ok).toBe(true);
      
      const status = await response.json();
      expect(status).toHaveProperty('healthy');
      expect(status).toHaveProperty('uptime');
      expect(status).toHaveProperty('system');
      expect(status).toHaveProperty('components');
      expect(status).toHaveProperty('alerts');
    });
    
    test('should provide metrics endpoint', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/metrics/system`);
      expect(response.ok).toBe(true);
      
      const metrics = await response.json();
      expect(metrics).toHaveProperty('cpu');
      expect(metrics).toHaveProperty('memory');
    });
    
    test('should provide alerts endpoint', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/alerts`);
      expect(response.ok).toBe(true);
      
      const alerts = await response.json();
      expect(alerts).toHaveProperty('active');
      expect(alerts).toHaveProperty('history');
    });
  });
  
  describe('WebSocket Communication', () => {
    test('should accept WebSocket connections', async () => {
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      // Expect first message to be init
      const firstMessage = await new Promise((resolve, reject) => {
        ws.on('open', () => {
          ws.once('message', (data) => {
            resolve(JSON.parse(data));
          });
        });
        ws.on('error', reject);
        
        setTimeout(() => reject(new Error('Connection timeout')), 5000);
      });
      
      expect(firstMessage.type).toBe('init');
      expect(firstMessage.data).toHaveProperty('status');
      expect(firstMessage.data).toHaveProperty('metrics');
      expect(firstMessage.data).toHaveProperty('components');
      expect(firstMessage.data).toHaveProperty('alerts');
      
      ws.close();
    });
    
    test('should handle client subscriptions', async () => {
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      await new Promise(resolve => ws.on('open', resolve));
      
      // Skip the init message
      await new Promise(resolve => {
        ws.once('message', resolve);
      });
      
      // Subscribe to system channel
      ws.send(JSON.stringify({
        type: 'subscribe',
        channels: ['system']
      }));
      
      // Wait for system metrics update
      const systemUpdate = await new Promise(resolve => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'system-metrics') {
            resolve(msg);
          }
        });
      });
      
      expect(systemUpdate.data).toHaveProperty('cpu');
      expect(systemUpdate.data).toHaveProperty('memory');
      
      ws.close();
    });
    
    test('should handle client commands', async () => {
      const ws = new WebSocket(`ws://localhost:${testPort}`);
      
      await new Promise(resolve => ws.on('open', resolve));
      
      // Skip the init message
      await new Promise(resolve => {
        ws.once('message', resolve);
      });
      
      // Send snapshot command
      ws.send(JSON.stringify({
        type: 'command',
        command: 'snapshot'
      }));
      
      // Wait for command result
      const result = await new Promise(resolve => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'command-result') {
            resolve(msg);
          }
        });
      });
      
      expect(result.command).toBe('snapshot');
      expect(result.result).toHaveProperty('metrics');
      expect(result.result).toHaveProperty('alerts');
      expect(result.result).toHaveProperty('components');
      
      ws.close();
    });
  });
  
  describe('Component Registration', () => {
    test('should register and track components', async () => {
      const testComponent = {
        name: 'Test Component',
        type: 'test',
        getMetrics: async () => ({
          testMetric: 42
        })
      };
      
      dashboard.registerComponent('test-comp', testComponent);
      
      // Verify component is registered
      const response = await fetch(`http://localhost:${testPort}/api/components`);
      const components = await response.json();
      
      expect(components).toContainEqual(
        expect.objectContaining({
          id: 'test-comp',
          name: 'Test Component',
          type: 'test'
        })
      );
    });
    
    test('should collect metrics from registered components', async () => {
      let metricsCallCount = 0;
      
      const testComponent = {
        name: 'Metric Test',
        type: 'swarm',
        getMetrics: async () => {
          metricsCallCount++;
          return {
            activeAgents: 5,
            queuedTasks: 10,
            successRate: 0.95,
            avgResponseTime: 150
          };
        }
      };
      
      dashboard.registerComponent('metric-test', testComponent);
      
      // Wait for metric collection
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(metricsCallCount).toBeGreaterThan(0);
    });
    
    test('should unregister components', () => {
      dashboard.registerComponent('temp-comp', {
        name: 'Temporary',
        type: 'test',
        getMetrics: async () => ({})
      });
      
      expect(dashboard.components.has('temp-comp')).toBe(true);
      
      dashboard.unregisterComponent('temp-comp');
      
      expect(dashboard.components.has('temp-comp')).toBe(false);
    });
  });
  
  describe('Alert Management', () => {
    test('should create alerts when thresholds are exceeded', async () => {
      // Simulate high CPU usage - need at least 10 values for averaging
      for (let i = 0; i < 10; i++) {
        dashboard._addMetric('system', 'cpu', { value: 0.9, timestamp: Date.now() + i });
      }
      
      // Force alert check
      dashboard._checkAlerts();
      
      expect(dashboard.activeAlerts.has('high-cpu')).toBe(true);
      
      const alert = dashboard.activeAlerts.get('high-cpu');
      expect(alert.severity).toBe('warning');
      expect(alert.message).toContain('CPU usage');
    });
    
    test('should clear alerts when conditions improve', async () => {
      // Create alert
      dashboard._createAlert('test-alert', { value: 100 });
      expect(dashboard.activeAlerts.has('test-alert')).toBe(true);
      
      // Clear alert
      dashboard._clearAlert('test-alert');
      expect(dashboard.activeAlerts.has('test-alert')).toBe(false);
    });
    
    test('should track alert history', () => {
      // Create and clear an alert
      dashboard._createAlert('history-test', { value: 1 });
      dashboard._clearAlert('history-test');
      
      const history = dashboard.alertHistory;
      expect(history).toContainEqual(
        expect.objectContaining({
          id: 'history-test',
          status: 'created'
        })
      );
      expect(history).toContainEqual(
        expect.objectContaining({
          id: 'history-test',
          status: 'cleared'
        })
      );
    });
  });
  
  describe('Metric Collection', () => {
    test('should collect system metrics', async () => {
      // Wait for metric collection
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const cpuMetrics = dashboard.metrics.system.cpu;
      const memoryMetrics = dashboard.metrics.system.memory;
      
      expect(cpuMetrics.length).toBeGreaterThan(0);
      expect(memoryMetrics.length).toBeGreaterThan(0);
      
      // Check metric structure
      const lastCPU = cpuMetrics[cpuMetrics.length - 1];
      expect(lastCPU).toHaveProperty('value');
      expect(lastCPU).toHaveProperty('timestamp');
      expect(lastCPU.value).toBeGreaterThanOrEqual(0);
      expect(lastCPU.value).toBeLessThanOrEqual(1);
    });
    
    test('should respect history size limit', () => {
      // Add more metrics than history size
      for (let i = 0; i < dashboard.config.historySize + 10; i++) {
        dashboard._addMetric('system', 'cpu', {
          value: Math.random(),
          timestamp: Date.now() + i
        });
      }
      
      expect(dashboard.metrics.system.cpu.length).toBe(dashboard.config.historySize);
    });
    
    test('should calculate recent averages', () => {
      // Add test metrics
      const values = [0.5, 0.6, 0.7, 0.8, 0.9];
      values.forEach((value, i) => {
        dashboard._addMetric('test', 'metric', {
          value,
          timestamp: Date.now() + i
        });
      });
      
      const avg = dashboard._getRecentAverage('test', 'metric', 3);
      expect(avg).toBeCloseTo(0.8, 1); // Average of last 3: (0.7 + 0.8 + 0.9) / 3
    });
  });
  
  describe('WebSocket Broadcasting', () => {
    test('should broadcast to subscribed clients', async () => {
      const ws1 = new WebSocket(`ws://localhost:${testPort}`);
      const ws2 = new WebSocket(`ws://localhost:${testPort}`);
      
      await Promise.all([
        new Promise(resolve => ws1.on('open', resolve)),
        new Promise(resolve => ws2.on('open', resolve))
      ]);
      
      // Subscribe ws1 to test channel
      ws1.send(JSON.stringify({
        type: 'subscribe',
        channels: ['test']
      }));
      
      // Wait a bit for subscription to process
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Broadcast to test channel
      dashboard._broadcast('test-message', { data: 'test' }, 'test');
      
      // ws1 should receive the message
      const received1 = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout')), 1000);
        ws1.on('message', (data) => {
          const msg = JSON.parse(data);
          if (msg.type === 'test-message') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
      });
      
      expect(received1.data).toEqual({ data: 'test' });
      
      ws1.close();
      ws2.close();
    });
  });
  
  describe('Performance', () => {
    test('should handle multiple concurrent connections', async () => {
      const connections = [];
      const connectionCount = 10;
      
      // Create multiple connections
      for (let i = 0; i < connectionCount; i++) {
        const ws = new WebSocket(`ws://localhost:${testPort}`);
        connections.push(ws);
      }
      
      // Wait for all to connect
      await Promise.all(
        connections.map(ws => new Promise(resolve => ws.on('open', resolve)))
      );
      
      expect(dashboard.clients.size).toBe(connectionCount);
      
      // Close all connections
      connections.forEach(ws => ws.close());
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(dashboard.clients.size).toBe(0);
    });
    
    test('should handle rapid metric updates', async () => {
      const updateCount = 100;
      const startTime = Date.now();
      
      // Rapid metric updates
      for (let i = 0; i < updateCount; i++) {
        dashboard._collectSystemMetrics();
      }
      
      const duration = Date.now() - startTime;
      
      // Should handle 100 updates in under 1 second
      expect(duration).toBeLessThan(1000);
      
      // Metrics should be collected
      expect(dashboard.metrics.system.cpu.length).toBeGreaterThan(0);
    });
  });
});

// Integration test with other components
describe('Dashboard Integration', () => {
  test('should integrate with lifecycle manager', async () => {
    const { AutonomousLifecycleManager } = await import('../src/agents/autonomous-lifecycle-manager.js');
    
    const dashboard = new RealTimeMonitoringDashboard({ port: 3458 });
    const lifecycleManager = new AutonomousLifecycleManager();
    
    // Register lifecycle manager
    dashboard.registerComponent('lifecycle', {
      name: 'Lifecycle Manager',
      type: 'lifecycle',
      getMetrics: () => lifecycleManager.getLifecycleStats()
    });
    
    // Spawn some agents
    await lifecycleManager.spawnAgent({ type: 'test', capabilities: ['testing'] });
    await lifecycleManager.spawnAgent({ type: 'test', capabilities: ['testing'] });
    
    // Collect metrics
    await dashboard._collectComponentMetrics();
    
    // Check lifecycle metrics were collected
    expect(dashboard.metrics.lifecycle.agentStates).toBeDefined();
    
    await dashboard.stop();
    await lifecycleManager.cleanup();
  });
});