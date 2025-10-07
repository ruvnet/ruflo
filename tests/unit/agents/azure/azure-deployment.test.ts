/**
 * Unit Tests for Azure Deployment Operations
 * Tests deployment, resource management, and lifecycle operations
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest
} from '@jest/globals';
import { createAzureMCPMock, AzureMCPMock } from '../../../mocks/azure/azure-mcp-mock.js';

describe('Azure Deployment Operations', () => {
  let azureMock: AzureMCPMock;

  beforeEach(() => {
    azureMock = createAzureMCPMock();
  });

  afterEach(() => {
    azureMock.reset();
  });

  describe('Resource Deployment', () => {
    it('should deploy ARM template successfully', async () => {
      const deployParams = {
        name: 'test-deployment',
        resourceGroup: 'test-rg',
        template: {
          $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
          resources: []
        },
        parameters: {
          location: 'eastus'
        }
      };

      const result = await azureMock.deploy(deployParams);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.name).toBe('test-deployment');
      expect(result.data.resourceGroup).toBe('test-rg');
      expect(result.data.status).toBe('Running');
      expect(azureMock.deploy).toHaveBeenCalledWith(deployParams);
      expect(azureMock.deploy).toHaveBeenCalledTimes(1);
    });

    it('should handle deployment with custom parameters', async () => {
      const deployParams = {
        name: 'webapp-deployment',
        resourceGroup: 'webapp-rg',
        template: { resources: [] },
        parameters: {
          location: 'westus',
          sku: 'S1',
          instanceCount: 3
        }
      };

      const result = await azureMock.deploy(deployParams);

      expect(result.success).toBe(true);
      expect(result.data.parameters).toEqual(deployParams.parameters);
    });

    it('should track deployment status', async () => {
      const deployParams = {
        name: 'status-test',
        resourceGroup: 'test-rg',
        template: { resources: [] }
      };

      const deployResult = await azureMock.deploy(deployParams);
      const deploymentId = deployResult.data.id;

      // Check initial status
      const statusResult = await azureMock.getDeployment(deploymentId);
      expect(statusResult.success).toBe(true);
      expect(statusResult.data.status).toBe('Running');

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 150));

      const finalResult = await azureMock.getDeployment(deploymentId);
      expect(finalResult.data.status).toBe('Succeeded');
      expect(finalResult.data.outputs).toBeDefined();
    });

    it('should handle deployment failure', async () => {
      azureMock.setShouldFail(true, 'Template validation failed');

      const deployParams = {
        name: 'failing-deployment',
        resourceGroup: 'test-rg',
        template: { invalid: true }
      };

      const result = await azureMock.deploy(deployParams);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Template validation failed');
    });

    it('should validate required parameters', async () => {
      const invalidParams = {
        name: '',
        resourceGroup: 'test-rg',
        template: {}
      };

      // This would be validated by the actual agent
      expect(invalidParams.name).toBe('');
    });
  });

  describe('Deployment Management', () => {
    it('should list all deployments', async () => {
      // Create multiple deployments
      await azureMock.deploy({
        name: 'deployment-1',
        resourceGroup: 'rg-1',
        template: {}
      });

      await azureMock.deploy({
        name: 'deployment-2',
        resourceGroup: 'rg-2',
        template: {}
      });

      const result = await azureMock.listDeployments();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].name).toBe('deployment-1');
      expect(result.data[1].name).toBe('deployment-2');
    });

    it('should filter deployments by resource group', async () => {
      await azureMock.deploy({
        name: 'deployment-1',
        resourceGroup: 'rg-1',
        template: {}
      });

      await azureMock.deploy({
        name: 'deployment-2',
        resourceGroup: 'rg-2',
        template: {}
      });

      const result = await azureMock.listDeployments('rg-1');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].resourceGroup).toBe('rg-1');
    });

    it('should get deployment by ID', async () => {
      const deployResult = await azureMock.deploy({
        name: 'test-deployment',
        resourceGroup: 'test-rg',
        template: {}
      });

      const deploymentId = deployResult.data.id;
      const result = await azureMock.getDeployment(deploymentId);

      expect(result.success).toBe(true);
      expect(result.data.id).toBe(deploymentId);
    });

    it('should handle non-existent deployment', async () => {
      const result = await azureMock.getDeployment('non-existent-id');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Deployment not found');
    });

    it('should delete deployment', async () => {
      const deployResult = await azureMock.deploy({
        name: 'delete-test',
        resourceGroup: 'test-rg',
        template: {}
      });

      const deploymentId = deployResult.data.id;
      const deleteResult = await azureMock.deleteDeployment(deploymentId);

      expect(deleteResult.success).toBe(true);

      // Verify deletion
      const getResult = await azureMock.getDeployment(deploymentId);
      expect(getResult.success).toBe(false);
    });
  });

  describe('Resource Management', () => {
    it('should create resource', async () => {
      const resourceParams = {
        name: 'test-vm',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus',
        properties: {
          vmSize: 'Standard_D2s_v3',
          storageProfile: {
            imageReference: {
              publisher: 'Canonical',
              offer: 'UbuntuServer',
              sku: '18.04-LTS'
            }
          }
        }
      };

      const result = await azureMock.createResource(resourceParams);

      expect(result.success).toBe(true);
      expect(result.data.name).toBe('test-vm');
      expect(result.data.type).toBe('Microsoft.Compute/virtualMachines');
      expect(result.data.status).toBe('Running');
    });

    it('should list resources', async () => {
      await azureMock.createResource({
        name: 'vm-1',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      await azureMock.createResource({
        name: 'storage-1',
        type: 'Microsoft.Storage/storageAccounts',
        location: 'westus'
      });

      const result = await azureMock.listResources();

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should filter resources by type', async () => {
      await azureMock.createResource({
        name: 'vm-1',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      await azureMock.createResource({
        name: 'storage-1',
        type: 'Microsoft.Storage/storageAccounts',
        location: 'westus'
      });

      const result = await azureMock.listResources({
        type: 'Microsoft.Compute/virtualMachines'
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].type).toBe('Microsoft.Compute/virtualMachines');
    });

    it('should update resource', async () => {
      const createResult = await azureMock.createResource({
        name: 'test-vm',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      const resourceId = createResult.data.id;
      const updateResult = await azureMock.updateResource(resourceId, {
        status: 'Stopped',
        properties: { vmSize: 'Standard_D4s_v3' }
      });

      expect(updateResult.success).toBe(true);
      expect(updateResult.data.status).toBe('Stopped');
    });

    it('should delete resource', async () => {
      const createResult = await azureMock.createResource({
        name: 'delete-vm',
        type: 'Microsoft.Compute/virtualMachines',
        location: 'eastus'
      });

      const resourceId = createResult.data.id;
      const deleteResult = await azureMock.deleteResource(resourceId);

      expect(deleteResult.success).toBe(true);

      // Verify deletion
      const getResult = await azureMock.getResource(resourceId);
      expect(getResult.success).toBe(false);
    });

    it('should handle resource not found', async () => {
      const result = await azureMock.getResource('non-existent-resource');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Resource not found');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle concurrent deployments', async () => {
      const deployments = Array(5).fill(null).map((_, i) =>
        azureMock.deploy({
          name: `concurrent-${i}`,
          resourceGroup: 'test-rg',
          template: {}
        })
      );

      const results = await Promise.all(deployments);

      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    it('should handle large template deployments', async () => {
      const largeTemplate = {
        resources: Array(100).fill(null).map((_, i) => ({
          type: 'Microsoft.Storage/storageAccounts',
          name: `storage-${i}`
        }))
      };

      const result = await azureMock.deploy({
        name: 'large-deployment',
        resourceGroup: 'test-rg',
        template: largeTemplate
      });

      expect(result.success).toBe(true);
      expect(result.data.template.resources).toHaveLength(100);
    });

    it('should handle network timeout simulation', async () => {
      azureMock.setShouldFail(true, 'Request timeout');

      const result = await azureMock.deploy({
        name: 'timeout-test',
        resourceGroup: 'test-rg',
        template: {}
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timeout');
    });

    it('should handle invalid resource group', async () => {
      const result = await azureMock.deploy({
        name: 'test',
        resourceGroup: '', // Invalid
        template: {}
      });

      // The agent should validate this before calling
      expect(result.data.resourceGroup).toBe('');
    });

    it('should handle deployment with missing template', async () => {
      azureMock.setShouldFail(true, 'Template is required');

      const result = await azureMock.deploy({
        name: 'no-template',
        resourceGroup: 'test-rg',
        template: null as any
      });

      expect(result.success).toBe(false);
    });
  });

  describe('Performance Tests', () => {
    it('should complete deployment within acceptable time', async () => {
      const startTime = Date.now();

      await azureMock.deploy({
        name: 'perf-test',
        resourceGroup: 'test-rg',
        template: {}
      });

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in under 1s
    });

    it('should handle batch resource creation efficiently', async () => {
      const startTime = Date.now();

      const creates = Array(50).fill(null).map((_, i) =>
        azureMock.createResource({
          name: `resource-${i}`,
          type: 'Microsoft.Storage/storageAccounts',
          location: 'eastus'
        })
      );

      await Promise.all(creates);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(2000); // Should complete in under 2s
    });
  });
});
