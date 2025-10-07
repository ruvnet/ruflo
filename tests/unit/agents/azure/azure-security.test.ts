/**
 * Unit Tests for Azure Security Operations
 * Tests security scanning, policy management, and compliance
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from '@jest/globals';
import { createAzureMCPMock, AzureMCPMock } from '../../../mocks/azure/azure-mcp-mock.js';

describe('Azure Security Operations', () => {
  let azureMock: AzureMCPMock;

  beforeEach(() => {
    azureMock = createAzureMCPMock();
  });

  afterEach(() => {
    azureMock.reset();
  });

  describe('Security Alerts', () => {
    it('should retrieve security alerts', async () => {
      const result = await azureMock.getSecurityAlerts();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(azureMock.getSecurityAlerts).toHaveBeenCalled();
    });

    it('should handle empty alerts list', async () => {
      const result = await azureMock.getSecurityAlerts();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(0);
    });

    it('should handle alerts retrieval failure', async () => {
      azureMock.setShouldFail(true, 'Unable to retrieve security alerts');

      const result = await azureMock.getSecurityAlerts();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unable to retrieve security alerts');
    });
  });

  describe('Security Scanning', () => {
    it('should run security scan on resource', async () => {
      // Create a resource first
      const resourceResult = await azureMock.createResource({
        name: 'test-vm',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      const resourceId = resourceResult.data.id;
      const scanResult = await azureMock.runSecurityScan(resourceId);

      expect(scanResult.success).toBe(true);
      expect(scanResult.data.scanId).toBeDefined();
      expect(scanResult.data.findings).toBeDefined();
      expect(azureMock.runSecurityScan).toHaveBeenCalledWith(resourceId);
    });

    it('should detect vulnerabilities in scan', async () => {
      const resourceResult = await azureMock.createResource({
        name: 'vulnerable-vm',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      const scanResult = await azureMock.runSecurityScan(resourceResult.data.id);

      expect(scanResult.success).toBe(true);
      expect(Array.isArray(scanResult.data.findings)).toBe(true);
    });

    it('should handle scan failure', async () => {
      azureMock.setShouldFail(true, 'Security scanner unavailable');

      const result = await azureMock.runSecurityScan('resource-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Security scanner unavailable');
    });

    it('should scan multiple resources concurrently', async () => {
      const resources = await Promise.all([
        azureMock.createResource({ name: 'vm-1', type: 'VM', location: 'eastus' }),
        azureMock.createResource({ name: 'vm-2', type: 'VM', location: 'westus' }),
        azureMock.createResource({ name: 'vm-3', type: 'VM', location: 'centralus' })
      ]);

      const scans = resources.map(r => azureMock.runSecurityScan(r.data.id));
      const results = await Promise.all(scans);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Security Policy Management', () => {
    it('should apply security policy', async () => {
      const policyParams = {
        name: 'require-encryption',
        scope: '/subscriptions/test-sub',
        rules: {
          encryption: 'required',
          tlsVersion: '1.2'
        }
      };

      const result = await azureMock.applySecurityPolicy(policyParams);

      expect(result.success).toBe(true);
      expect(result.data.policyId).toBeDefined();
      expect(result.data.applied).toBe(true);
      expect(azureMock.applySecurityPolicy).toHaveBeenCalledWith(policyParams);
    });

    it('should apply network security policy', async () => {
      const networkPolicy = {
        name: 'restrict-ssh',
        scope: '/subscriptions/test-sub/resourceGroups/test-rg',
        rules: {
          inboundRules: [
            { port: 22, action: 'deny', priority: 100 }
          ]
        }
      };

      const result = await azureMock.applySecurityPolicy(networkPolicy);

      expect(result.success).toBe(true);
      expect(result.data.applied).toBe(true);
    });

    it('should apply compliance policy', async () => {
      const compliancePolicy = {
        name: 'pci-dss-compliance',
        scope: '/subscriptions/test-sub',
        standards: ['PCI-DSS', 'ISO-27001'],
        rules: {
          auditLogging: 'required',
          dataEncryption: 'required'
        }
      };

      const result = await azureMock.applySecurityPolicy(compliancePolicy);

      expect(result.success).toBe(true);
    });

    it('should handle policy application failure', async () => {
      azureMock.setShouldFail(true, 'Insufficient permissions');

      const result = await azureMock.applySecurityPolicy({
        name: 'test-policy',
        scope: '/subscriptions/test-sub'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient permissions');
    });
  });

  describe('Compliance and Audit', () => {
    it('should get audit logs', async () => {
      const result = await azureMock.getAuditLogs();

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it('should filter audit logs by resource', async () => {
      const params = {
        resourceId: 'vm-test-001',
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endTime: new Date()
      };

      const result = await azureMock.getAuditLogs(params);

      expect(result.success).toBe(true);
      expect(azureMock.getAuditLogs).toHaveBeenCalledWith(params);
    });

    it('should filter audit logs by action', async () => {
      const params = {
        action: 'ResourceCreated',
        startTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        endTime: new Date()
      };

      const result = await azureMock.getAuditLogs(params);

      expect(result.success).toBe(true);
    });

    it('should handle audit log retrieval failure', async () => {
      azureMock.setShouldFail(true, 'Audit service unavailable');

      const result = await azureMock.getAuditLogs();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Audit service unavailable');
    });
  });

  describe('Vulnerability Assessment', () => {
    it('should assess SQL database vulnerabilities', async () => {
      const dbResource = await azureMock.createResource({
        name: 'test-sqldb',
        type: 'Microsoft.Sql/servers/databases',
        location: 'eastus'
      });

      const scanResult = await azureMock.runSecurityScan(dbResource.data.id);

      expect(scanResult.success).toBe(true);
      expect(scanResult.data.scanId).toBeDefined();
    });

    it('should assess storage account security', async () => {
      const storageResource = await azureMock.createResource({
        name: 'teststorageacct',
        type: 'Microsoft.Storage/storageAccounts',
        location: 'westus'
      });

      const scanResult = await azureMock.runSecurityScan(storageResource.data.id);

      expect(scanResult.success).toBe(true);
    });

    it('should assess network security groups', async () => {
      const nsgResource = await azureMock.createResource({
        name: 'test-nsg',
        type: 'Microsoft.Network/networkSecurityGroups',
        location: 'eastus'
      });

      const scanResult = await azureMock.runSecurityScan(nsgResource.data.id);

      expect(scanResult.success).toBe(true);
    });
  });

  describe('Threat Protection', () => {
    it('should enable threat protection on resource', async () => {
      const policyParams = {
        name: 'threat-protection',
        scope: '/subscriptions/test-sub/resourceGroups/test-rg',
        rules: {
          threatProtection: 'enabled',
          alertLevel: 'high'
        }
      };

      const result = await azureMock.applySecurityPolicy(policyParams);

      expect(result.success).toBe(true);
      expect(result.data.applied).toBe(true);
    });

    it('should configure DDoS protection', async () => {
      const ddosPolicy = {
        name: 'ddos-protection',
        scope: '/subscriptions/test-sub',
        rules: {
          ddosProtection: 'standard',
          mitigation: 'automatic'
        }
      };

      const result = await azureMock.applySecurityPolicy(ddosPolicy);

      expect(result.success).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle scanning non-existent resource', async () => {
      const result = await azureMock.runSecurityScan('non-existent-resource');

      // Mock doesn't validate existence, but real implementation would
      expect(result.success).toBe(true);
    });

    it('should handle concurrent security scans', async () => {
      const resources = await Promise.all([
        azureMock.createResource({ name: 'r1', type: 'VM', location: 'eastus' }),
        azureMock.createResource({ name: 'r2', type: 'VM', location: 'westus' }),
        azureMock.createResource({ name: 'r3', type: 'VM', location: 'centralus' }),
        azureMock.createResource({ name: 'r4', type: 'VM', location: 'northeurope' }),
        azureMock.createResource({ name: 'r5', type: 'VM', location: 'southeastasia' })
      ]);

      const startTime = Date.now();
      const scans = resources.map(r => azureMock.runSecurityScan(r.data.id));
      await Promise.all(scans);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
    });

    it('should handle policy with empty rules', async () => {
      const result = await azureMock.applySecurityPolicy({
        name: 'empty-policy',
        scope: '/subscriptions/test-sub',
        rules: {}
      });

      expect(result.success).toBe(true);
    });

    it('should handle very long audit log queries', async () => {
      const params = {
        startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        endTime: new Date()
      };

      const result = await azureMock.getAuditLogs(params);

      expect(result.success).toBe(true);
    });
  });
});
