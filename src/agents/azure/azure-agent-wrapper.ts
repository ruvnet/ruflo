/**
 * Azure Agent Wrapper - Simplified interface for common Azure operations
 * Provides convenience methods and higher-level abstractions
 *
 * @module azure-agent-wrapper
 */

import type { AzureAgent } from './azure-agent.js';
import type { ILogger } from '../../core/logger.js';

export interface DeploymentResult {
  deploymentId: string;
  status: 'succeeded' | 'failed' | 'in-progress';
  resources: string[];
  outputs?: Record<string, any>;
  error?: string;
}

export interface ResourceHealth {
  resourceId: string;
  status: 'available' | 'unavailable' | 'degraded' | 'unknown';
  reason?: string;
  lastUpdated: Date;
}

export interface MonitoringData {
  metrics: Array<{
    name: string;
    value: number;
    unit: string;
    timestamp: Date;
  }>;
  logs: Array<{
    timestamp: Date;
    level: string;
    message: string;
  }>;
}

/**
 * High-level wrapper for Azure Agent operations
 */
export class AzureAgentWrapper {
  constructor(
    private agent: AzureAgent,
    private logger: ILogger,
  ) {}

  /**
   * Deploy a simple ARM template
   */
  async deployTemplate(
    resourceGroup: string,
    templatePath: string,
    parametersPath?: string,
  ): Promise<DeploymentResult> {
    this.logger.info('Deploying ARM template', { resourceGroup, templatePath });

    const result = await this.agent.deploy({
      resourceGroup,
      templateFile: templatePath,
      parametersFile: parametersPath,
      mode: 'Incremental',
    });

    if (!result.success) {
      return {
        deploymentId: 'unknown',
        status: 'failed',
        resources: [],
        error: result.error?.message,
      };
    }

    return {
      deploymentId: result.data?.deploymentId || 'unknown',
      status: result.data?.status || 'in-progress',
      resources: result.data?.resources || [],
      outputs: result.data?.outputs,
    };
  }

  /**
   * Get secret from Key Vault
   */
  async getSecret(vaultName: string, secretName: string): Promise<string | null> {
    this.logger.info('Retrieving secret from Key Vault', { vaultName, secretName });

    const result = await this.agent.keyVault('get', 'secret', {
      vaultName,
      secretName,
    });

    if (!result.success) {
      this.logger.error('Failed to retrieve secret', { error: result.error?.message });
      return null;
    }

    return result.data?.value || null;
  }

  /**
   * Set secret in Key Vault
   */
  async setSecret(vaultName: string, secretName: string, value: string): Promise<boolean> {
    this.logger.info('Setting secret in Key Vault', { vaultName, secretName });

    const result = await this.agent.keyVault('set', 'secret', {
      vaultName,
      secretName,
    });

    return result.success;
  }

  /**
   * Query logs from Azure Monitor
   */
  async queryLogs(
    query: string,
    timeRange: string = '24h',
    workspace?: string,
  ): Promise<MonitoringData> {
    this.logger.info('Querying Azure Monitor logs', { query, timeRange, workspace });

    const result = await this.agent.monitor({
      query,
      timeRange,
      workspace,
    });

    if (!result.success) {
      this.logger.error('Failed to query logs', { error: result.error?.message });
      return { metrics: [], logs: [] };
    }

    // Transform result data to MonitoringData format
    const data: MonitoringData = {
      metrics: result.data?.metrics || [],
      logs: result.data?.logs || [],
    };

    return data;
  }

  /**
   * Check health of multiple resources
   */
  async checkHealth(resourceIds: string[]): Promise<ResourceHealth[]> {
    this.logger.info('Checking health of resources', { count: resourceIds.length });

    const healthChecks = await Promise.allSettled(
      resourceIds.map((resourceId) => this.agent.checkResourceHealth(resourceId)),
    );

    return healthChecks.map((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        return {
          resourceId: resourceIds[index],
          status: result.value.data?.availabilityState || 'unknown',
          reason: result.value.data?.reasonType,
          lastUpdated: new Date(result.value.data?.lastUpdated || Date.now()),
        };
      } else {
        return {
          resourceId: resourceIds[index],
          status: 'unknown',
          reason: 'Failed to check health',
          lastUpdated: new Date(),
        };
      }
    });
  }

  /**
   * Run compliance scan on subscription
   */
  async runComplianceScan(subscription?: string): Promise<{
    compliant: boolean;
    issues: Array<{
      severity: string;
      resource: string;
      issue: string;
      recommendation: string;
    }>;
    score: number;
  }> {
    this.logger.info('Running compliance scan', { subscription });

    const result = await this.agent.complianceReview({ subscription });

    if (!result.success) {
      this.logger.error('Failed to run compliance scan', { error: result.error?.message });
      return {
        compliant: false,
        issues: [],
        score: 0,
      };
    }

    return {
      compliant: result.data?.compliant || false,
      issues: result.data?.issues || [],
      score: result.data?.complianceScore || 0,
    };
  }

  /**
   * List all resources in a resource group
   */
  async listResourcesInGroup(resourceGroup: string, subscription?: string): Promise<string[]> {
    this.logger.info('Listing resources in group', { resourceGroup, subscription });

    // This would need to be implemented using Azure Resource Manager API
    // For now, return empty array as placeholder
    return [];
  }

  /**
   * Scale application
   */
  async scaleApplication(
    resourceId: string,
    targetInstances: number,
    subscription?: string,
  ): Promise<boolean> {
    this.logger.info('Scaling application', { resourceId, targetInstances, subscription });

    // This would need to be implemented using Azure CLI or ARM templates
    const result = await this.agent.azd(
      `az resource update --ids ${resourceId} --set properties.instanceCount=${targetInstances}`,
      { subscription },
    );

    return result.success;
  }

  /**
   * Get best practices for a specific topic
   */
  async getBestPractices(
    topic: 'functions' | 'sdk' | 'deployment' = 'deployment',
  ): Promise<string[]> {
    this.logger.info('Getting best practices', { topic });

    const result = await this.agent.getBestPractices(topic);

    if (!result.success) {
      this.logger.error('Failed to get best practices', { error: result.error?.message });
      return [];
    }

    return result.data?.recommendations || [];
  }

  /**
   * Assign RBAC role to principal
   */
  async assignRole(
    principalId: string,
    roleDefinitionId: string,
    scope: string,
    subscription?: string,
  ): Promise<boolean> {
    this.logger.info('Assigning RBAC role', { principalId, roleDefinitionId, scope });

    const result = await this.agent.manageRBAC('assign', {
      principalId,
      roleDefinitionId,
      scope,
      subscription,
    });

    return result.success;
  }

  /**
   * List role assignments
   */
  async listRoleAssignments(subscription?: string): Promise<
    Array<{
      principalId: string;
      roleDefinitionId: string;
      scope: string;
    }>
  > {
    this.logger.info('Listing RBAC role assignments', { subscription });

    const result = await this.agent.manageRBAC('list', { subscription });

    if (!result.success) {
      this.logger.error('Failed to list role assignments', { error: result.error?.message });
      return [];
    }

    return result.data?.roleAssignments || [];
  }

  /**
   * Get resource quotas for subscription
   */
  async getQuotas(location: string, provider: string, subscription?: string): Promise<
    Array<{
      name: string;
      limit: number;
      current: number;
      unit: string;
    }>
  > {
    this.logger.info('Getting resource quotas', { location, provider, subscription });

    const result = await this.agent.manageQuotas('list', {
      location,
      provider,
      subscription,
    });

    if (!result.success) {
      this.logger.error('Failed to get quotas', { error: result.error?.message });
      return [];
    }

    return result.data?.quotas || [];
  }

  /**
   * Diagnose application issues
   */
  async diagnoseApplication(
    resourceId: string,
    detector?: string,
  ): Promise<{
    healthy: boolean;
    issues: Array<{
      name: string;
      severity: string;
      description: string;
      recommendation: string;
    }>;
  }> {
    this.logger.info('Diagnosing application', { resourceId, detector });

    const result = await this.agent.appLens(resourceId, detector);

    if (!result.success) {
      this.logger.error('Failed to diagnose application', { error: result.error?.message });
      return {
        healthy: false,
        issues: [],
      };
    }

    return {
      healthy: result.data?.healthy || false,
      issues: result.data?.detectedIssues || [],
    };
  }
}
