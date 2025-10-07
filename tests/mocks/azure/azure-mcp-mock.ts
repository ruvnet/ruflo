/**
 * Mock Azure MCP Server for Testing
 * Simulates Azure MCP server responses and behaviors
 */

import { jest } from '@jest/globals';

export interface AzureMCPResponse {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface AzureResource {
  id: string;
  name: string;
  type: string;
  location: string;
  status: string;
  properties?: Record<string, any>;
}

export interface AzureDeployment {
  id: string;
  name: string;
  resourceGroup: string;
  status: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Canceled';
  template?: any;
  parameters?: any;
  outputs?: any;
  timestamp: string;
}

/**
 * Mock Azure MCP Server
 */
export class AzureMCPMock {
  private deployments: Map<string, AzureDeployment> = new Map();
  private resources: Map<string, AzureResource> = new Map();
  private securityAlerts: any[] = [];
  private metrics: any[] = [];
  private logs: any[] = [];
  private shouldFail: boolean = false;
  private failureReason?: string;

  // Mock MCP methods
  deploy = jest.fn(this.mockDeploy.bind(this));
  getDeployment = jest.fn(this.mockGetDeployment.bind(this));
  listDeployments = jest.fn(this.mockListDeployments.bind(this));
  deleteDeployment = jest.fn(this.mockDeleteDeployment.bind(this));

  listResources = jest.fn(this.mockListResources.bind(this));
  getResource = jest.fn(this.mockGetResource.bind(this));
  createResource = jest.fn(this.mockCreateResource.bind(this));
  updateResource = jest.fn(this.mockUpdateResource.bind(this));
  deleteResource = jest.fn(this.mockDeleteResource.bind(this));

  getSecurityAlerts = jest.fn(this.mockGetSecurityAlerts.bind(this));
  runSecurityScan = jest.fn(this.mockRunSecurityScan.bind(this));
  applySecurityPolicy = jest.fn(this.mockApplySecurityPolicy.bind(this));

  getMetrics = jest.fn(this.mockGetMetrics.bind(this));
  getLogs = jest.fn(this.mockGetLogs.bind(this));
  setAlert = jest.fn(this.mockSetAlert.bind(this));

  startDebugSession = jest.fn(this.mockStartDebugSession.bind(this));
  getDebugLogs = jest.fn(this.mockGetDebugLogs.bind(this));
  executeRemoteCommand = jest.fn(this.mockExecuteRemoteCommand.bind(this));

  manageUsers = jest.fn(this.mockManageUsers.bind(this));
  setPermissions = jest.fn(this.mockSetPermissions.bind(this));
  getAuditLogs = jest.fn(this.mockGetAuditLogs.bind(this));

  // Configuration methods
  setShouldFail(shouldFail: boolean, reason?: string): void {
    this.shouldFail = shouldFail;
    this.failureReason = reason;
  }

  reset(): void {
    this.deployments.clear();
    this.resources.clear();
    this.securityAlerts = [];
    this.metrics = [];
    this.logs = [];
    this.shouldFail = false;
    this.failureReason = undefined;

    jest.clearAllMocks();
  }

  // Mock implementation methods
  private async mockDeploy(params: {
    name: string;
    resourceGroup: string;
    template: any;
    parameters?: any;
  }): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Deployment failed'
      };
    }

    const deployment: AzureDeployment = {
      id: `deployment-${Date.now()}`,
      name: params.name,
      resourceGroup: params.resourceGroup,
      status: 'Running',
      template: params.template,
      parameters: params.parameters,
      timestamp: new Date().toISOString()
    };

    this.deployments.set(deployment.id, deployment);

    // Simulate deployment completion
    setTimeout(() => {
      deployment.status = 'Succeeded';
      deployment.outputs = { endpoint: `https://${params.name}.azurewebsites.net` };
    }, 100);

    return {
      success: true,
      data: deployment,
      metadata: { requestId: `req-${Date.now()}` }
    };
  }

  private async mockGetDeployment(deploymentId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get deployment'
      };
    }

    const deployment = this.deployments.get(deploymentId);

    if (!deployment) {
      return {
        success: false,
        error: 'Deployment not found'
      };
    }

    return {
      success: true,
      data: deployment
    };
  }

  private async mockListDeployments(resourceGroup?: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to list deployments'
      };
    }

    let deployments = Array.from(this.deployments.values());

    if (resourceGroup) {
      deployments = deployments.filter(d => d.resourceGroup === resourceGroup);
    }

    return {
      success: true,
      data: deployments
    };
  }

  private async mockDeleteDeployment(deploymentId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to delete deployment'
      };
    }

    const deleted = this.deployments.delete(deploymentId);

    return {
      success: deleted,
      error: deleted ? undefined : 'Deployment not found'
    };
  }

  private async mockListResources(params?: { resourceGroup?: string; type?: string }): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to list resources'
      };
    }

    let resources = Array.from(this.resources.values());

    if (params?.resourceGroup) {
      resources = resources.filter(r => r.properties?.resourceGroup === params.resourceGroup);
    }

    if (params?.type) {
      resources = resources.filter(r => r.type === params.type);
    }

    return {
      success: true,
      data: resources
    };
  }

  private async mockGetResource(resourceId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get resource'
      };
    }

    const resource = this.resources.get(resourceId);

    if (!resource) {
      return {
        success: false,
        error: 'Resource not found'
      };
    }

    return {
      success: true,
      data: resource
    };
  }

  private async mockCreateResource(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to create resource'
      };
    }

    const resource: AzureResource = {
      id: `resource-${Date.now()}`,
      name: params.name,
      type: params.type,
      location: params.location || 'eastus',
      status: 'Running',
      properties: params.properties
    };

    this.resources.set(resource.id, resource);

    return {
      success: true,
      data: resource
    };
  }

  private async mockUpdateResource(resourceId: string, updates: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to update resource'
      };
    }

    const resource = this.resources.get(resourceId);

    if (!resource) {
      return {
        success: false,
        error: 'Resource not found'
      };
    }

    Object.assign(resource, updates);

    return {
      success: true,
      data: resource
    };
  }

  private async mockDeleteResource(resourceId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to delete resource'
      };
    }

    const deleted = this.resources.delete(resourceId);

    return {
      success: deleted,
      error: deleted ? undefined : 'Resource not found'
    };
  }

  private async mockGetSecurityAlerts(): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get security alerts'
      };
    }

    return {
      success: true,
      data: this.securityAlerts
    };
  }

  private async mockRunSecurityScan(resourceId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Security scan failed'
      };
    }

    const alert = {
      id: `alert-${Date.now()}`,
      resourceId,
      severity: 'Medium',
      title: 'Security scan completed',
      description: 'No critical vulnerabilities found',
      timestamp: new Date().toISOString()
    };

    this.securityAlerts.push(alert);

    return {
      success: true,
      data: { scanId: alert.id, findings: [] }
    };
  }

  private async mockApplySecurityPolicy(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to apply security policy'
      };
    }

    return {
      success: true,
      data: { policyId: `policy-${Date.now()}`, applied: true }
    };
  }

  private async mockGetMetrics(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get metrics'
      };
    }

    const metrics = [
      { name: 'CPU', value: 45.5, unit: '%', timestamp: new Date().toISOString() },
      { name: 'Memory', value: 2048, unit: 'MB', timestamp: new Date().toISOString() },
      { name: 'RequestCount', value: 1500, unit: 'count', timestamp: new Date().toISOString() }
    ];

    return {
      success: true,
      data: metrics
    };
  }

  private async mockGetLogs(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get logs'
      };
    }

    const logs = [
      { level: 'INFO', message: 'Application started', timestamp: new Date().toISOString() },
      { level: 'WARN', message: 'High memory usage detected', timestamp: new Date().toISOString() },
      { level: 'ERROR', message: 'Database connection timeout', timestamp: new Date().toISOString() }
    ];

    return {
      success: true,
      data: logs
    };
  }

  private async mockSetAlert(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to set alert'
      };
    }

    return {
      success: true,
      data: { alertId: `alert-${Date.now()}`, enabled: true }
    };
  }

  private async mockStartDebugSession(resourceId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to start debug session'
      };
    }

    return {
      success: true,
      data: { sessionId: `debug-${Date.now()}`, endpoint: 'wss://debug.azure.com/session' }
    };
  }

  private async mockGetDebugLogs(sessionId: string): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get debug logs'
      };
    }

    return {
      success: true,
      data: [
        { level: 'DEBUG', message: 'Request received', timestamp: new Date().toISOString() },
        { level: 'DEBUG', message: 'Processing request', timestamp: new Date().toISOString() }
      ]
    };
  }

  private async mockExecuteRemoteCommand(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Command execution failed'
      };
    }

    return {
      success: true,
      data: {
        exitCode: 0,
        stdout: 'Command executed successfully',
        stderr: ''
      }
    };
  }

  private async mockManageUsers(action: string, params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'User management failed'
      };
    }

    return {
      success: true,
      data: { userId: params.userId || `user-${Date.now()}`, action }
    };
  }

  private async mockSetPermissions(params: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to set permissions'
      };
    }

    return {
      success: true,
      data: { roleAssignmentId: `role-${Date.now()}`, applied: true }
    };
  }

  private async mockGetAuditLogs(params?: any): Promise<AzureMCPResponse> {
    if (this.shouldFail) {
      return {
        success: false,
        error: this.failureReason || 'Failed to get audit logs'
      };
    }

    return {
      success: true,
      data: [
        {
          timestamp: new Date().toISOString(),
          action: 'ResourceCreated',
          user: 'admin@example.com',
          resource: 'vm-test-001'
        },
        {
          timestamp: new Date().toISOString(),
          action: 'PermissionGranted',
          user: 'admin@example.com',
          resource: 'storage-account-001'
        }
      ]
    };
  }
}

export function createAzureMCPMock(): AzureMCPMock {
  return new AzureMCPMock();
}
