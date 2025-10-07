/**
 * Unit Tests for Azure Monitoring Operations
 * Tests metrics collection, logging, alerting, and diagnostics
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from '@jest/globals';
import { createAzureMCPMock, AzureMCPMock } from '../../../mocks/azure/azure-mcp-mock.js';

describe('Azure Monitoring Operations', () => {
  let azureMock: AzureMCPMock;

  beforeEach(() => {
    azureMock = createAzureMCPMock();
  });

  afterEach(() => {
    azureMock.reset();
  });

  describe('Metrics Collection', () => {
    it('should get resource metrics', async () => {
      const params = {
        resourceId: 'vm-test-001',
        timeRange: '1h',
        metrics: ['CPU', 'Memory', 'Network']
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(azureMock.getMetrics).toHaveBeenCalledWith(params);
    });

    it('should get CPU metrics', async () => {
      const params = {
        resourceId: 'vm-test-001',
        metrics: ['CPU']
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
      const cpuMetric = result.data.find((m: any) => m.name === 'CPU');
      expect(cpuMetric).toBeDefined();
      expect(cpuMetric.unit).toBe('%');
      expect(typeof cpuMetric.value).toBe('number');
    });

    it('should get memory metrics', async () => {
      const params = {
        resourceId: 'vm-test-001',
        metrics: ['Memory']
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
      const memMetric = result.data.find((m: any) => m.name === 'Memory');
      expect(memMetric).toBeDefined();
      expect(memMetric.unit).toBe('MB');
    });

    it('should get request count metrics', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        metrics: ['RequestCount']
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
      const reqMetric = result.data.find((m: any) => m.name === 'RequestCount');
      expect(reqMetric).toBeDefined();
      expect(reqMetric.unit).toBe('count');
    });

    it('should handle metrics retrieval failure', async () => {
      azureMock.setShouldFail(true, 'Metrics service unavailable');

      const result = await azureMock.getMetrics({
        resourceId: 'vm-test-001'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Metrics service unavailable');
    });

    it('should get metrics with time range', async () => {
      const params = {
        resourceId: 'vm-test-001',
        timeRange: '24h',
        interval: '1h'
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('Logging', () => {
    it('should get application logs', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        logType: 'application',
        timeRange: '1h'
      };

      const result = await azureMock.getLogs(params);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should filter logs by level', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        level: 'ERROR'
      };

      const result = await azureMock.getLogs(params);

      expect(result.success).toBe(true);
      const errorLog = result.data.find((log: any) => log.level === 'ERROR');
      expect(errorLog).toBeDefined();
    });

    it('should get logs with custom query', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        query: 'level=="ERROR" | where timestamp > ago(1h)'
      };

      const result = await azureMock.getLogs(params);

      expect(result.success).toBe(true);
    });

    it('should handle log retrieval failure', async () => {
      azureMock.setShouldFail(true, 'Log Analytics unavailable');

      const result = await azureMock.getLogs({
        resourceId: 'vm-test-001'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Log Analytics unavailable');
    });

    it('should get logs with pagination', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        pageSize: 100,
        page: 1
      };

      const result = await azureMock.getLogs(params);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should get structured logs', async () => {
      const result = await azureMock.getLogs({
        resourceId: 'webapp-test-001'
      });

      expect(result.success).toBe(true);
      result.data.forEach((log: any) => {
        expect(log.level).toBeDefined();
        expect(log.message).toBeDefined();
        expect(log.timestamp).toBeDefined();
      });
    });
  });

  describe('Alerting', () => {
    it('should create metric alert', async () => {
      const alertParams = {
        name: 'high-cpu-alert',
        resourceId: 'vm-test-001',
        metric: 'CPU',
        condition: 'greaterThan',
        threshold: 80,
        severity: 2,
        actions: ['email:admin@example.com']
      };

      const result = await azureMock.setAlert(alertParams);

      expect(result.success).toBe(true);
      expect(result.data.alertId).toBeDefined();
      expect(result.data.enabled).toBe(true);
      expect(azureMock.setAlert).toHaveBeenCalledWith(alertParams);
    });

    it('should create log alert', async () => {
      const alertParams = {
        name: 'error-log-alert',
        resourceId: 'webapp-test-001',
        query: 'level=="ERROR"',
        threshold: 10,
        windowSize: '5m',
        actions: ['webhook:https://alerts.example.com']
      };

      const result = await azureMock.setAlert(alertParams);

      expect(result.success).toBe(true);
      expect(result.data.enabled).toBe(true);
    });

    it('should create availability alert', async () => {
      const alertParams = {
        name: 'availability-alert',
        resourceId: 'webapp-test-001',
        metric: 'Availability',
        condition: 'lessThan',
        threshold: 99.9,
        severity: 1
      };

      const result = await azureMock.setAlert(alertParams);

      expect(result.success).toBe(true);
    });

    it('should handle alert creation failure', async () => {
      azureMock.setShouldFail(true, 'Invalid alert configuration');

      const result = await azureMock.setAlert({
        name: 'test-alert'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid alert configuration');
    });

    it('should create alert with multiple conditions', async () => {
      const alertParams = {
        name: 'multi-condition-alert',
        resourceId: 'vm-test-001',
        conditions: [
          { metric: 'CPU', operator: 'greaterThan', threshold: 80 },
          { metric: 'Memory', operator: 'greaterThan', threshold: 90 }
        ],
        operator: 'and'
      };

      const result = await azureMock.setAlert(alertParams);

      expect(result.success).toBe(true);
    });

    it('should create alert with action groups', async () => {
      const alertParams = {
        name: 'action-group-alert',
        resourceId: 'vm-test-001',
        metric: 'CPU',
        threshold: 85,
        actionGroups: [
          'action-group-1',
          'action-group-2'
        ]
      };

      const result = await azureMock.setAlert(alertParams);

      expect(result.success).toBe(true);
    });
  });

  describe('Diagnostics', () => {
    it('should enable diagnostic settings', async () => {
      const diagParams = {
        resourceId: 'vm-test-001',
        logs: ['AuditEvent', 'ApplicationLog'],
        metrics: ['AllMetrics'],
        storageAccountId: 'storage-diag-001'
      };

      const result = await azureMock.setAlert(diagParams);

      expect(result.success).toBe(true);
    });

    it('should configure Log Analytics workspace', async () => {
      const diagParams = {
        resourceId: 'vm-test-001',
        workspaceId: 'workspace-001',
        logs: ['*'],
        metrics: ['*']
      };

      const result = await azureMock.setAlert(diagParams);

      expect(result.success).toBe(true);
    });

    it('should enable Event Hub streaming', async () => {
      const diagParams = {
        resourceId: 'webapp-test-001',
        eventHubId: 'eventhub-001',
        logs: ['ApplicationLog'],
        metrics: ['RequestMetrics']
      };

      const result = await azureMock.setAlert(diagParams);

      expect(result.success).toBe(true);
    });
  });

  describe('Performance Monitoring', () => {
    it('should monitor application performance', async () => {
      const result = await azureMock.getMetrics({
        resourceId: 'webapp-test-001',
        metrics: ['ResponseTime', 'RequestCount', 'FailedRequests']
      });

      expect(result.success).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should track dependency metrics', async () => {
      const result = await azureMock.getMetrics({
        resourceId: 'webapp-test-001',
        metrics: ['DependencyDuration', 'DependencyFailures']
      });

      expect(result.success).toBe(true);
    });

    it('should monitor database performance', async () => {
      const result = await azureMock.getMetrics({
        resourceId: 'sqldb-test-001',
        metrics: ['DTU', 'ConnectionSuccess', 'ConnectionFailed']
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent metric requests', async () => {
      const requests = Array(10).fill(null).map((_, i) =>
        azureMock.getMetrics({
          resourceId: `vm-${i}`,
          metrics: ['CPU', 'Memory']
        })
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle large time range queries', async () => {
      const params = {
        resourceId: 'vm-test-001',
        timeRange: '30d',
        interval: '1h'
      };

      const result = await azureMock.getMetrics(params);

      expect(result.success).toBe(true);
    });

    it('should handle metrics for non-existent resource', async () => {
      azureMock.setShouldFail(true, 'Resource not found');

      const result = await azureMock.getMetrics({
        resourceId: 'non-existent'
      });

      expect(result.success).toBe(false);
    });

    it('should handle empty metric results', async () => {
      const result = await azureMock.getMetrics({
        resourceId: 'vm-test-001',
        metrics: ['NonExistentMetric']
      });

      expect(result.success).toBe(true);
    });

    it('should handle rapid alert creation', async () => {
      const alerts = Array(20).fill(null).map((_, i) =>
        azureMock.setAlert({
          name: `alert-${i}`,
          resourceId: 'vm-test-001',
          metric: 'CPU',
          threshold: 70 + i
        })
      );

      const results = await Promise.all(alerts);

      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle log queries with special characters', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        query: 'message contains "error: [404]" | where level=="ERROR"'
      };

      const result = await azureMock.getLogs(params);

      expect(result.success).toBe(true);
    });
  });

  describe('Performance Tests', () => {
    it('should retrieve metrics efficiently', async () => {
      const startTime = Date.now();

      await azureMock.getMetrics({
        resourceId: 'vm-test-001',
        metrics: ['CPU', 'Memory', 'Disk', 'Network']
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(500);
    });

    it('should handle batch log retrieval', async () => {
      const startTime = Date.now();

      const logRequests = Array(5).fill(null).map((_, i) =>
        azureMock.getLogs({
          resourceId: `webapp-${i}`,
          timeRange: '1h'
        })
      );

      await Promise.all(logRequests);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000);
    });
  });
});
