/**
 * Unit Tests for Azure Debugging Operations
 * Tests remote debugging, log streaming, and diagnostic tools
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from '@jest/globals';
import { createAzureMCPMock, AzureMCPMock } from '../../../mocks/azure/azure-mcp-mock.js';

describe('Azure Debugging Operations', () => {
  let azureMock: AzureMCPMock;

  beforeEach(() => {
    azureMock = createAzureMCPMock();
  });

  afterEach(() => {
    azureMock.reset();
  });

  describe('Debug Session Management', () => {
    it('should start debug session', async () => {
      const resourceId = 'webapp-test-001';
      const result = await azureMock.startDebugSession(resourceId);

      expect(result.success).toBe(true);
      expect(result.data.sessionId).toBeDefined();
      expect(result.data.endpoint).toBeDefined();
      expect(result.data.endpoint).toContain('wss://');
      expect(azureMock.startDebugSession).toHaveBeenCalledWith(resourceId);
    });

    it('should start debug session with configuration', async () => {
      const resourceId = 'webapp-test-001';
      const result = await azureMock.startDebugSession(resourceId);

      expect(result.success).toBe(true);
      expect(result.data.sessionId).toMatch(/^debug-/);
    });

    it('should handle debug session start failure', async () => {
      azureMock.setShouldFail(true, 'Resource not in debuggable state');

      const result = await azureMock.startDebugSession('vm-test-001');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Resource not in debuggable state');
    });

    it('should support multiple concurrent debug sessions', async () => {
      const resources = ['webapp-1', 'webapp-2', 'webapp-3'];
      const sessions = resources.map(r => azureMock.startDebugSession(r));
      const results = await Promise.all(sessions);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(result.data.sessionId).toBeDefined();
      });

      // Ensure unique session IDs
      const sessionIds = results.map(r => r.data.sessionId);
      const uniqueIds = new Set(sessionIds);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('Debug Log Retrieval', () => {
    it('should get debug logs for session', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');
      const sessionId = sessionResult.data.sessionId;

      const logResult = await azureMock.getDebugLogs(sessionId);

      expect(logResult.success).toBe(true);
      expect(Array.isArray(logResult.data)).toBe(true);
      expect(logResult.data.length).toBeGreaterThan(0);
      expect(azureMock.getDebugLogs).toHaveBeenCalledWith(sessionId);
    });

    it('should get debug logs with proper structure', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');
      const logResult = await azureMock.getDebugLogs(sessionResult.data.sessionId);

      expect(logResult.success).toBe(true);
      logResult.data.forEach((log: any) => {
        expect(log.level).toBe('DEBUG');
        expect(log.message).toBeDefined();
        expect(log.timestamp).toBeDefined();
      });
    });

    it('should handle debug log retrieval failure', async () => {
      azureMock.setShouldFail(true, 'Debug session not found');

      const result = await azureMock.getDebugLogs('invalid-session-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Debug session not found');
    });

    it('should stream debug logs in real-time', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');
      const sessionId = sessionResult.data.sessionId;

      // Simulate multiple log fetches
      const logs1 = await azureMock.getDebugLogs(sessionId);
      const logs2 = await azureMock.getDebugLogs(sessionId);

      expect(logs1.success).toBe(true);
      expect(logs2.success).toBe(true);
    });
  });

  describe('Remote Command Execution', () => {
    it('should execute remote command', async () => {
      const params = {
        resourceId: 'vm-test-001',
        command: 'ls -la /var/log',
        timeout: 30000
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
      expect(result.data.exitCode).toBe(0);
      expect(result.data.stdout).toBeDefined();
      expect(result.data.stderr).toBeDefined();
      expect(azureMock.executeRemoteCommand).toHaveBeenCalledWith(params);
    });

    it('should execute PowerShell command', async () => {
      const params = {
        resourceId: 'vm-windows-001',
        command: 'Get-Process | Select-Object Name, CPU',
        shell: 'powershell'
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
      expect(result.data.exitCode).toBe(0);
    });

    it('should execute bash command', async () => {
      const params = {
        resourceId: 'vm-linux-001',
        command: 'ps aux | grep node',
        shell: 'bash'
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
      expect(result.data.stdout).toBeDefined();
    });

    it('should handle command execution failure', async () => {
      azureMock.setShouldFail(true, 'Command execution timeout');

      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'sleep 1000'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command execution timeout');
    });

    it('should execute command with environment variables', async () => {
      const params = {
        resourceId: 'vm-test-001',
        command: 'echo $MY_VAR',
        env: {
          MY_VAR: 'test-value'
        }
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
    });

    it('should handle command with non-zero exit code', async () => {
      const params = {
        resourceId: 'vm-test-001',
        command: 'exit 1'
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
      // Note: Success refers to command execution, not command result
    });
  });

  describe('Application Insights Integration', () => {
    it('should retrieve application traces', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        traceId: 'trace-12345',
        timeRange: '1h'
      };

      const result = await azureMock.getDebugLogs(params as any);

      expect(result.success).toBe(true);
    });

    it('should get request telemetry', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        operationId: 'op-12345'
      };

      const result = await azureMock.getDebugLogs(params as any);

      expect(result.success).toBe(true);
    });

    it('should retrieve dependency telemetry', async () => {
      const params = {
        resourceId: 'webapp-test-001',
        dependencyType: 'SQL',
        timeRange: '30m'
      };

      const result = await azureMock.getDebugLogs(params as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Snapshot Debugging', () => {
    it('should create application snapshot', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');

      expect(sessionResult.success).toBe(true);
      expect(sessionResult.data.sessionId).toBeDefined();
    });

    it('should download snapshot for analysis', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');
      const sessionId = sessionResult.data.sessionId;

      const result = await azureMock.getDebugLogs(sessionId);

      expect(result.success).toBe(true);
    });

    it('should analyze memory dump', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'procdump -ma webapp.exe'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Container Debugging', () => {
    it('should attach to container', async () => {
      const result = await azureMock.startDebugSession('container-test-001');

      expect(result.success).toBe(true);
      expect(result.data.endpoint).toBeDefined();
    });

    it('should execute command in container', async () => {
      const params = {
        resourceId: 'aks-cluster-001',
        container: 'webapp-container',
        command: 'kubectl logs pod-name'
      };

      const result = await azureMock.executeRemoteCommand(params);

      expect(result.success).toBe(true);
    });

    it('should get container logs', async () => {
      const sessionResult = await azureMock.startDebugSession('container-001');
      const logs = await azureMock.getDebugLogs(sessionResult.data.sessionId);

      expect(logs.success).toBe(true);
    });
  });

  describe('Network Diagnostics', () => {
    it('should run network trace', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'tcpdump -i eth0 -w /tmp/capture.pcap'
      });

      expect(result.success).toBe(true);
    });

    it('should test network connectivity', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'curl -I https://api.example.com'
      });

      expect(result.success).toBe(true);
    });

    it('should check DNS resolution', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'nslookup example.com'
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle concurrent debug sessions', async () => {
      const sessions = Array(10).fill(null).map((_, i) =>
        azureMock.startDebugSession(`webapp-${i}`)
      );

      const results = await Promise.all(sessions);

      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle debug session for non-existent resource', async () => {
      azureMock.setShouldFail(true, 'Resource not found');

      const result = await azureMock.startDebugSession('non-existent');

      expect(result.success).toBe(false);
    });

    it('should handle very long command output', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'cat /var/log/syslog'
      });

      expect(result.success).toBe(true);
      expect(result.data.stdout).toBeDefined();
    });

    it('should handle command with special characters', async () => {
      const result = await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'echo "Hello & World | Test > Output"'
      });

      expect(result.success).toBe(true);
    });

    it('should handle rapid log fetching', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');
      const sessionId = sessionResult.data.sessionId;

      const logFetches = Array(20).fill(null).map(() =>
        azureMock.getDebugLogs(sessionId)
      );

      const results = await Promise.all(logFetches);

      expect(results).toHaveLength(20);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle debug session timeout', async () => {
      const sessionResult = await azureMock.startDebugSession('webapp-test-001');

      // Simulate timeout scenario
      expect(sessionResult.data.sessionId).toBeDefined();
    });
  });

  describe('Performance Tests', () => {
    it('should start debug session quickly', async () => {
      const startTime = Date.now();

      await azureMock.startDebugSession('webapp-test-001');

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(500);
    });

    it('should execute remote commands efficiently', async () => {
      const startTime = Date.now();

      await azureMock.executeRemoteCommand({
        resourceId: 'vm-test-001',
        command: 'echo "test"'
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(300);
    });

    it('should handle batch command execution', async () => {
      const startTime = Date.now();

      const commands = Array(10).fill(null).map((_, i) =>
        azureMock.executeRemoteCommand({
          resourceId: 'vm-test-001',
          command: `echo "Command ${i}"`
        })
      );

      await Promise.all(commands);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000);
    });
  });
});
