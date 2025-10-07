/**
 * Azure Agent Module - Export all public APIs
 * @module agents/azure
 */

export {
  AzureAgent,
  createAzureAgent,
  type AzureCredentials,
  type AzureAgentConfig,
  type AzureToolOptions,
  type AzureDeploymentOptions,
  type AzureKeyVaultOptions,
  type AzureMonitorQuery,
  type AzureRBACOptions,
  type AzureQuotaOptions,
  type AzureToolResult,
} from './azure-agent.js';

export { AzureAgentWrapper } from './azure-agent-wrapper.js';
export { AzureAgentFactory } from './azure-agent-factory.js';
