"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var enterprise_exports = {};
__export(enterprise_exports, {
  enterpriseCommands: () => enterpriseCommands
});
module.exports = __toCommonJS(enterprise_exports);
var import_cli_core = require("../cli-core.js");
var import_chalk = __toESM(require("chalk"), 1);
var import_project_manager = require("../../enterprise/project-manager.js");
var import_deployment_manager = require("../../enterprise/deployment-manager.js");
var import_cloud_manager = require("../../enterprise/cloud-manager.js");
var import_security_manager = require("../../enterprise/security-manager.js");
var import_analytics_manager = require("../../enterprise/analytics-manager.js");
var import_audit_manager = require("../../enterprise/audit-manager.js");
const { bold, blue, green, yellow, red, cyan, magenta } = import_chalk.default;
let projectManager = null;
let deploymentManager = null;
let cloudManager = null;
let securityManager = null;
let analyticsManager = null;
let auditManager = null;
async function getProjectManager() {
  if (!projectManager) {
    projectManager = new import_project_manager.ProjectManager();
    await projectManager.initialize();
  }
  return projectManager;
}
__name(getProjectManager, "getProjectManager");
async function getDeploymentManager() {
  if (!deploymentManager) {
    deploymentManager = new import_deployment_manager.DeploymentManager();
    await deploymentManager.initialize();
  }
  return deploymentManager;
}
__name(getDeploymentManager, "getDeploymentManager");
async function getCloudManager() {
  if (!cloudManager) {
    cloudManager = new import_cloud_manager.CloudManager();
    await cloudManager.initialize();
  }
  return cloudManager;
}
__name(getCloudManager, "getCloudManager");
async function getSecurityManager() {
  if (!securityManager) {
    securityManager = new import_security_manager.SecurityManager();
    await securityManager.initialize();
  }
  return securityManager;
}
__name(getSecurityManager, "getSecurityManager");
async function getAnalyticsManager() {
  if (!analyticsManager) {
    analyticsManager = new import_analytics_manager.AnalyticsManager();
    await analyticsManager.initialize();
  }
  return analyticsManager;
}
__name(getAnalyticsManager, "getAnalyticsManager");
async function getAuditManager() {
  if (!auditManager) {
    auditManager = new import_audit_manager.AuditManager();
    await auditManager.initialize();
  }
  return auditManager;
}
__name(getAuditManager, "getAuditManager");
const enterpriseCommands = [
  // Project Management Commands
  {
    name: "project",
    description: "Enterprise project management with lifecycle tracking",
    options: [
      {
        name: "verbose",
        short: "v",
        description: "Enable verbose output",
        type: "boolean"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getProjectManager();
      switch (subcommand) {
        case "create": {
          const name = ctx.args[1];
          if (!name) {
            (0, import_cli_core.error)("Usage: project create <name> [options]");
            break;
          }
          try {
            const project = await manager.createProject({
              name,
              description: ctx.flags.description || `Project: ${name}`,
              type: ctx.flags.type || "custom",
              priority: ctx.flags.priority || "medium",
              owner: ctx.flags.owner || "system",
              stakeholders: ctx.flags.stakeholders ? ctx.flags.stakeholders.split(",") : []
            });
            (0, import_cli_core.success)(`Project created: ${project.name}`);
            console.log(`${blue("ID:")} ${project.id}`);
            console.log(`${blue("Type:")} ${project.type}`);
            console.log(`${blue("Priority:")} ${project.priority}`);
            console.log(`${blue("Owner:")} ${project.owner}`);
            if (ctx.flags.verbose) {
              console.log(
                `${blue("Timeline:")} ${project.timeline.plannedStart.toLocaleDateString()} - ${project.timeline.plannedEnd.toLocaleDateString()}`
              );
              console.log(`${blue("Budget:")} ${project.budget.total} ${project.budget.currency}`);
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to create project: ${err.message}`);
          }
          break;
        }
        case "list": {
          try {
            const filters = {};
            if (ctx.flags.status)
              filters.status = ctx.flags.status;
            if (ctx.flags.type)
              filters.type = ctx.flags.type;
            if (ctx.flags.priority)
              filters.priority = ctx.flags.priority;
            if (ctx.flags.owner)
              filters.owner = ctx.flags.owner;
            const projects = await manager.listProjects(filters);
            if (projects.length === 0) {
              (0, import_cli_core.info)("No projects found");
              break;
            }
            (0, import_cli_core.success)(`Found ${projects.length} projects:`);
            console.log();
            for (const project of projects) {
              const statusColor = project.status === "active" ? green : project.status === "completed" ? blue : project.status === "on-hold" ? yellow : red;
              console.log(`${bold(project.name)} ${cyan(`(${project.id.substr(0, 8)}...)`)}`);
              console.log(
                `  Status: ${statusColor(project.status)} | Type: ${project.type} | Priority: ${project.priority}`
              );
              console.log(
                `  Owner: ${project.owner} | Updated: ${project.updatedAt.toLocaleDateString()}`
              );
              if (ctx.flags.verbose) {
                const progress = manager["calculateProjectProgress"] ? await manager.calculateProjectProgress(project) : 0;
                console.log(
                  `  Progress: ${progress.toFixed(1)}% | Phases: ${project.phases.length}`
                );
                console.log(
                  `  Budget: ${project.budget.spent}/${project.budget.total} ${project.budget.currency}`
                );
              }
              console.log();
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to list projects: ${err.message}`);
          }
          break;
        }
        case "show": {
          const projectId = ctx.args[1];
          if (!projectId) {
            (0, import_cli_core.error)("Usage: project show <project-id>");
            break;
          }
          try {
            const project = await manager.getProject(projectId);
            if (!project) {
              (0, import_cli_core.error)(`Project not found: ${projectId}`);
              break;
            }
            (0, import_cli_core.success)(`Project: ${project.name}`);
            console.log();
            console.log(`${blue("ID:")} ${project.id}`);
            console.log(`${blue("Description:")} ${project.description}`);
            console.log(`${blue("Type:")} ${project.type}`);
            console.log(`${blue("Status:")} ${project.status}`);
            console.log(`${blue("Priority:")} ${project.priority}`);
            console.log(`${blue("Owner:")} ${project.owner}`);
            console.log(`${blue("Created:")} ${project.createdAt.toLocaleDateString()}`);
            console.log(`${blue("Updated:")} ${project.updatedAt.toLocaleDateString()}`);
            console.log(`
${bold("Timeline:")}`);
            console.log(
              `  Planned: ${project.timeline.plannedStart.toLocaleDateString()} - ${project.timeline.plannedEnd.toLocaleDateString()}`
            );
            if (project.timeline.actualStart) {
              console.log(
                `  Actual: ${project.timeline.actualStart.toLocaleDateString()} - ${project.timeline.actualEnd?.toLocaleDateString() || "In Progress"}`
              );
            }
            console.log(`
${bold("Budget:")}`);
            console.log(`  Total: ${project.budget.total} ${project.budget.currency}`);
            console.log(`  Spent: ${project.budget.spent} ${project.budget.currency}`);
            console.log(`  Remaining: ${project.budget.remaining} ${project.budget.currency}`);
            if (project.phases.length > 0) {
              console.log(`
${bold("Phases:")}`);
              for (const phase of project.phases) {
                const statusColor = phase.status === "completed" ? green : phase.status === "in-progress" ? yellow : phase.status === "blocked" ? red : blue;
                console.log(
                  `  ${statusColor(phase.status.padEnd(12))} ${phase.name} (${phase.completionPercentage}%)`
                );
              }
            }
            if (project.collaboration.teamMembers.length > 0) {
              console.log(`
${bold("Team Members:")}`);
              for (const member of project.collaboration.teamMembers) {
                console.log(
                  `  ${member.name} (${member.role}) - ${member.availability}% available`
                );
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to show project: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          try {
            const projectId = ctx.args[1];
            const metrics = await manager.getProjectMetrics(projectId);
            (0, import_cli_core.success)("Project Metrics:");
            console.log();
            console.log(`${blue("Total Projects:")} ${metrics.totalProjects}`);
            console.log(`${blue("Active Projects:")} ${metrics.activeProjects}`);
            console.log(`${blue("Completed Projects:")} ${metrics.completedProjects}`);
            console.log(
              `${blue("Average Duration:")} ${metrics.averageProjectDuration.toFixed(1)} days`
            );
            console.log(
              `${blue("Budget Variance:")} ${(metrics.budgetVariance * 100).toFixed(1)}%`
            );
            console.log(
              `${blue("Resource Utilization:")} ${(metrics.resourceUtilization * 100).toFixed(1)}%`
            );
            console.log(`${blue("Quality Score:")} ${metrics.qualityScore.toFixed(1)}%`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get metrics: ${err.message}`);
          }
          break;
        }
        case "report": {
          const projectId = ctx.args[1];
          const reportType = ctx.args[2] || "status";
          if (!projectId) {
            (0, import_cli_core.error)("Usage: project report <project-id> [type]");
            break;
          }
          try {
            const report = await manager.generateReport(projectId, reportType);
            (0, import_cli_core.success)(`Generated ${reportType} report: ${report.title}`);
            console.log();
            console.log(`${blue("Summary:")} ${report.summary}`);
            console.log(`${blue("Generated:")} ${report.generatedAt.toLocaleDateString()}`);
            if (ctx.flags.verbose && Object.keys(report.details).length > 0) {
              console.log(`
${bold("Details:")}`);
              console.log(JSON.stringify(report.details, null, 2));
            }
            if (report.recommendations.length > 0) {
              console.log(`
${bold("Recommendations:")}`);
              for (const rec of report.recommendations) {
                console.log(`  \u2022 ${rec}`);
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to generate report: ${err.message}`);
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  create <name>     Create a new project");
          console.log("  list              List all projects");
          console.log("  show <id>         Show project details");
          console.log("  metrics [id]      Show project metrics");
          console.log("  report <id> [type] Generate project report");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(
            `  ${cyan("claude-flow project create")} "E-commerce Platform" --type web-app --priority high`
          );
          console.log(`  ${cyan("claude-flow project list")} --status active --verbose`);
          console.log(`  ${cyan("claude-flow project report")} proj-123 financial`);
          break;
        }
      }
    }
  },
  // Deployment Management Commands
  {
    name: "deploy",
    description: "Enterprise deployment automation with blue-green, canary, and rollback capabilities",
    options: [
      {
        name: "environment",
        short: "e",
        description: "Target environment",
        type: "string"
      },
      {
        name: "strategy",
        short: "s",
        description: "Deployment strategy (blue-green, canary, rolling)",
        type: "string"
      },
      {
        name: "version",
        short: "v",
        description: "Version to deploy",
        type: "string"
      },
      {
        name: "auto-rollback",
        description: "Enable automatic rollback on failure",
        type: "boolean"
      },
      {
        name: "dry-run",
        short: "d",
        description: "Preview deployment without executing",
        type: "boolean"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getDeploymentManager();
      switch (subcommand) {
        case "create": {
          const name = ctx.args[1];
          if (!name) {
            (0, import_cli_core.error)("Usage: deploy create <name> --environment <env> --strategy <strategy>");
            break;
          }
          try {
            const deployment = await manager.createDeployment({
              name,
              version: ctx.flags.version || "latest",
              projectId: ctx.flags.project || "default",
              environmentId: ctx.flags.environment || "development",
              strategyId: ctx.flags.strategy || "rolling",
              initiatedBy: "cli-user",
              source: {
                repository: ctx.flags.repo || "local",
                branch: ctx.flags.branch || "main",
                commit: ctx.flags.commit || "HEAD"
              }
            });
            (0, import_cli_core.success)(`Deployment created: ${deployment.name}`);
            console.log(`${blue("ID:")} ${deployment.id}`);
            console.log(`${blue("Version:")} ${deployment.version}`);
            console.log(`${blue("Environment:")} ${deployment.environmentId}`);
            console.log(`${blue("Strategy:")} ${deployment.strategyId}`);
            console.log(`${blue("Status:")} ${deployment.status}`);
            if (!ctx.flags.dryRun) {
              (0, import_cli_core.info)("Starting deployment...");
              await manager.executeDeployment(deployment.id);
            } else {
              (0, import_cli_core.warning)("Dry run - deployment not executed");
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to create deployment: ${err.message}`);
          }
          break;
        }
        case "list": {
          try {
            const filters = {};
            if (ctx.flags.environment)
              filters.environmentId = ctx.flags.environment;
            if (ctx.flags.status)
              filters.status = ctx.flags.status;
            const deployments = [];
            if (deployments.length === 0) {
              (0, import_cli_core.info)("No deployments found");
              break;
            }
            (0, import_cli_core.success)(`Found ${deployments.length} deployments:`);
            console.log();
            for (const deployment of deployments) {
              const statusColor = deployment.status === "success" ? green : deployment.status === "failed" ? red : deployment.status === "running" ? yellow : blue;
              console.log(`${bold(deployment.name)} ${cyan(`(${deployment.id.substr(0, 8)}...)`)}`);
              console.log(
                `  Status: ${statusColor(deployment.status)} | Version: ${deployment.version}`
              );
              console.log(
                `  Environment: ${deployment.environmentId} | Strategy: ${deployment.strategyId}`
              );
              console.log(`  Started: ${deployment.metrics.startTime.toLocaleDateString()}`);
              if (deployment.metrics.endTime) {
                console.log(`  Duration: ${deployment.metrics.duration}ms`);
              }
              console.log();
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to list deployments: ${err.message}`);
          }
          break;
        }
        case "rollback": {
          const deploymentId = ctx.args[1];
          const reason = ctx.args.slice(2).join(" ") || "Manual rollback requested";
          if (!deploymentId) {
            (0, import_cli_core.error)("Usage: deploy rollback <deployment-id> [reason]");
            break;
          }
          try {
            await manager.rollbackDeployment(deploymentId, reason);
            (0, import_cli_core.success)(`Rollback initiated for deployment: ${deploymentId}`);
            console.log(`${blue("Reason:")} ${reason}`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to rollback deployment: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          try {
            const filters = {};
            if (ctx.flags.environment)
              filters.environmentId = ctx.flags.environment;
            if (ctx.flags.timeRange) {
              const range = ctx.flags.timeRange.split(",");
              filters.timeRange = {
                start: new Date(range[0]),
                end: new Date(range[1])
              };
            }
            const metrics = await manager.getDeploymentMetrics(filters);
            (0, import_cli_core.success)("Deployment Metrics:");
            console.log();
            console.log(`${blue("Total Deployments:")} ${metrics.totalDeployments}`);
            console.log(`${blue("Successful:")} ${metrics.successfulDeployments}`);
            console.log(`${blue("Failed:")} ${metrics.failedDeployments}`);
            console.log(`${blue("Rolled Back:")} ${metrics.rolledBackDeployments}`);
            console.log(
              `${blue("Average Duration:")} ${(metrics.averageDeploymentTime / 1e3 / 60).toFixed(1)} minutes`
            );
            console.log(
              `${blue("Deployment Frequency:")} ${metrics.deploymentFrequency.toFixed(2)} per day`
            );
            console.log(
              `${blue("MTTR:")} ${(metrics.meanTimeToRecovery / 1e3 / 60).toFixed(1)} minutes`
            );
            console.log(`${blue("Change Failure Rate:")} ${metrics.changeFailureRate.toFixed(1)}%`);
            if (Object.keys(metrics.environmentMetrics).length > 0) {
              console.log(`
${bold("By Environment:")}`);
              for (const [env, data] of Object.entries(metrics.environmentMetrics)) {
                console.log(
                  `  ${env}: ${data.deployments} deployments, ${data.successRate.toFixed(1)}% success rate`
                );
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get metrics: ${err.message}`);
          }
          break;
        }
        case "environments": {
          const envSubcommand = ctx.args[1];
          switch (envSubcommand) {
            case "create": {
              const name = ctx.args[2];
              if (!name) {
                (0, import_cli_core.error)("Usage: deploy environments create <name> --type <type>");
                break;
              }
              try {
                const environment = await manager.createEnvironment({
                  name,
                  type: ctx.flags.type || "development",
                  configuration: {
                    region: ctx.flags.region || "us-east-1",
                    provider: ctx.flags.provider || "aws",
                    endpoints: ctx.flags.endpoints ? ctx.flags.endpoints.split(",") : [],
                    secrets: {},
                    environment_variables: {},
                    resources: { cpu: "1", memory: "1Gi", storage: "10Gi", replicas: 1 }
                  }
                });
                (0, import_cli_core.success)(`Environment created: ${environment.name}`);
                console.log(`${blue("ID:")} ${environment.id}`);
                console.log(`${blue("Type:")} ${environment.type}`);
                console.log(`${blue("Region:")} ${environment.configuration.region}`);
                console.log(`${blue("Provider:")} ${environment.configuration.provider}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to create environment: ${err.message}`);
              }
              break;
            }
            case "list": {
              (0, import_cli_core.info)("Environment listing not yet implemented");
              break;
            }
            default: {
              console.log("Available environment subcommands: create, list");
              break;
            }
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  create <name>     Create and execute deployment");
          console.log("  list              List deployments");
          console.log("  rollback <id>     Rollback deployment");
          console.log("  metrics           Show deployment metrics");
          console.log("  environments      Manage deployment environments");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(
            `  ${cyan("claude-flow deploy create")} "v2.1.0" --environment production --strategy blue-green`
          );
          console.log(`  ${cyan("claude-flow deploy rollback")} deploy-123 "Critical bug found"`);
          console.log(`  ${cyan("claude-flow deploy metrics")} --environment production`);
          break;
        }
      }
    }
  },
  // Cloud Management Commands
  {
    name: "cloud",
    description: "Multi-cloud infrastructure management with cost optimization",
    options: [
      {
        name: "provider",
        short: "p",
        description: "Cloud provider (aws, gcp, azure)",
        type: "string"
      },
      {
        name: "region",
        short: "r",
        description: "Cloud region",
        type: "string"
      },
      {
        name: "environment",
        short: "e",
        description: "Environment (development, staging, production)",
        type: "string"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getCloudManager();
      switch (subcommand) {
        case "providers": {
          const providerCmd = ctx.args[1];
          switch (providerCmd) {
            case "add": {
              const name = ctx.args[2];
              const type = ctx.args[3];
              if (!name || !type) {
                (0, import_cli_core.error)("Usage: cloud providers add <name> <type>");
                break;
              }
              try {
                const provider = await manager.addProvider({
                  name,
                  type,
                  credentials: {
                    accessKey: ctx.flags.accessKey,
                    secretKey: ctx.flags.secretKey,
                    projectId: ctx.flags.projectId
                  },
                  configuration: {
                    defaultRegion: ctx.flags.region || "us-east-1",
                    availableRegions: ctx.flags.regions ? ctx.flags.regions.split(",") : [],
                    services: ["compute", "storage", "network"],
                    endpoints: { api: "https://api.example.com" },
                    features: ["scaling", "monitoring", "backup"]
                  }
                });
                (0, import_cli_core.success)(`Cloud provider added: ${provider.name}`);
                console.log(`${blue("ID:")} ${provider.id}`);
                console.log(`${blue("Type:")} ${provider.type}`);
                console.log(`${blue("Status:")} ${provider.status}`);
                console.log(`${blue("Default Region:")} ${provider.configuration.defaultRegion}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to add provider: ${err.message}`);
              }
              break;
            }
            case "list": {
              (0, import_cli_core.info)("Provider listing not yet implemented");
              break;
            }
            default: {
              console.log("Available provider subcommands: add, list");
              break;
            }
          }
          break;
        }
        case "resources": {
          const resourceCmd = ctx.args[1];
          switch (resourceCmd) {
            case "create": {
              const name = ctx.args[2];
              const type = ctx.args[3];
              if (!name || !type) {
                (0, import_cli_core.error)("Usage: cloud resources create <name> <type> --provider <provider-id>");
                break;
              }
              try {
                const resource = await manager.createResource({
                  name,
                  type,
                  providerId: ctx.flags.provider || "default",
                  region: ctx.flags.region || "us-east-1",
                  configuration: {
                    size: ctx.flags.size || "small",
                    tags: ctx.flags.tags ? JSON.parse(ctx.flags.tags) : {}
                  },
                  metadata: {
                    environment: ctx.flags.environment || "development",
                    owner: ctx.flags.owner || "system",
                    purpose: ctx.flags.purpose || "general"
                  }
                });
                (0, import_cli_core.success)(`Resource created: ${resource.name}`);
                console.log(`${blue("ID:")} ${resource.id}`);
                console.log(`${blue("Type:")} ${resource.type}`);
                console.log(`${blue("Status:")} ${resource.status}`);
                console.log(`${blue("Provider:")} ${resource.providerId}`);
                console.log(`${blue("Region:")} ${resource.region}`);
                console.log(
                  `${blue("Monthly Cost:")} $${resource.costs.monthlyEstimate.toFixed(2)}`
                );
              } catch (err) {
                (0, import_cli_core.error)(`Failed to create resource: ${err.message}`);
              }
              break;
            }
            case "list": {
              (0, import_cli_core.info)("Resource listing not yet implemented");
              break;
            }
            case "scale": {
              const resourceId = ctx.args[2];
              if (!resourceId) {
                (0, import_cli_core.error)("Usage: cloud resources scale <resource-id> --size <size>");
                break;
              }
              try {
                await manager.scaleResource(resourceId, {
                  size: ctx.flags.size,
                  replicas: ctx.flags.replicas
                });
                (0, import_cli_core.success)(`Resource scaled: ${resourceId}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to scale resource: ${err.message}`);
              }
              break;
            }
            case "delete": {
              const resourceId = ctx.args[2];
              if (!resourceId) {
                (0, import_cli_core.error)("Usage: cloud resources delete <resource-id>");
                break;
              }
              try {
                await manager.deleteResource(resourceId);
                (0, import_cli_core.success)(`Resource deleted: ${resourceId}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to delete resource: ${err.message}`);
              }
              break;
            }
            default: {
              console.log("Available resource subcommands: create, list, scale, delete");
              break;
            }
          }
          break;
        }
        case "optimize": {
          try {
            const filters = {};
            if (ctx.flags.provider)
              filters.providerId = ctx.flags.provider;
            if (ctx.flags.environment)
              filters.environment = ctx.flags.environment;
            const optimizations = await manager.optimizeCosts(filters);
            if (optimizations.length === 0) {
              (0, import_cli_core.info)("No cost optimization opportunities found");
              break;
            }
            (0, import_cli_core.success)(`Found ${optimizations.length} cost optimization opportunities:`);
            console.log();
            for (const opt of optimizations) {
              console.log(`${bold(opt.type.toUpperCase())}: ${opt.description}`);
              console.log(
                `  ${green("Potential Savings:")} $${opt.potentialSavings.toFixed(2)}/month`
              );
              console.log(
                `  ${blue("Effort:")} ${opt.effort} | ${blue("Priority:")} ${opt.priority}`
              );
              console.log(`  ${yellow("Implementation:")} ${opt.implementation}`);
              console.log();
            }
            const totalSavings = optimizations.reduce((sum, opt) => sum + opt.potentialSavings, 0);
            (0, import_cli_core.success)(`Total potential savings: $${totalSavings.toFixed(2)}/month`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to analyze cost optimization: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          try {
            const filters = {};
            if (ctx.flags.provider)
              filters.providerId = ctx.flags.provider;
            if (ctx.flags.environment)
              filters.environment = ctx.flags.environment;
            const metrics = await manager.getCloudMetrics(filters);
            (0, import_cli_core.success)("Cloud Infrastructure Metrics:");
            console.log();
            console.log(`${bold("Providers:")}`);
            console.log(
              `  Total: ${metrics.providers.total} | Active: ${metrics.providers.active}`
            );
            console.log(
              `  Inactive: ${metrics.providers.inactive} | Errors: ${metrics.providers.errors}`
            );
            console.log(`
${bold("Resources:")}`);
            console.log(
              `  Total: ${metrics.resources.total} | Running: ${metrics.resources.running}`
            );
            console.log(
              `  Stopped: ${metrics.resources.stopped} | Errors: ${metrics.resources.errors}`
            );
            console.log(`
${bold("Costs:")}`);
            console.log(`  Total Spend: $${metrics.costs.totalSpend.toFixed(2)}`);
            console.log(`  Monthly Spend: $${metrics.costs.monthlySpend.toFixed(2)}`);
            console.log(`  Projected Annual: $${metrics.costs.projectedSpend.toFixed(2)}`);
            console.log(`
${bold("Performance:")}`);
            console.log(`  Average Uptime: ${metrics.performance.averageUptime.toFixed(1)}%`);
            console.log(`  Availability: ${metrics.performance.availability.toFixed(1)}%`);
            console.log(`
${bold("Security:")}`);
            console.log(
              `  Encryption Coverage: ${metrics.security.encryptionCoverage.toFixed(1)}%`
            );
            console.log(`  Backup Coverage: ${metrics.security.backupCoverage.toFixed(1)}%`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get metrics: ${err.message}`);
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  providers         Manage cloud providers");
          console.log("  resources         Manage cloud resources");
          console.log("  optimize          Analyze cost optimization opportunities");
          console.log("  metrics           Show cloud infrastructure metrics");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(
            `  ${cyan("claude-flow cloud providers add")} "AWS Production" aws --access-key xxx`
          );
          console.log(
            `  ${cyan("claude-flow cloud resources create")} "web-server" compute --provider aws-prod`
          );
          console.log(`  ${cyan("claude-flow cloud optimize")} --environment production`);
          break;
        }
      }
    }
  },
  // Security Management Commands
  {
    name: "security",
    description: "Security scanning, compliance checking, and vulnerability management",
    options: [
      {
        name: "type",
        short: "t",
        description: "Scan type (vulnerability, dependency, secrets, compliance)",
        type: "string"
      },
      {
        name: "severity",
        short: "s",
        description: "Minimum severity level (low, medium, high, critical)",
        type: "string"
      },
      {
        name: "format",
        short: "f",
        description: "Output format (json, csv, html)",
        type: "string"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getSecurityManager();
      switch (subcommand) {
        case "scan": {
          const name = ctx.args[1];
          const target = ctx.args[2];
          if (!name || !target) {
            (0, import_cli_core.error)("Usage: security scan <name> <target-path> --type <scan-type>");
            break;
          }
          try {
            const scan = await manager.createSecurityScan({
              name,
              type: ctx.flags.type || "vulnerability",
              target: {
                type: "repository",
                path: target,
                branch: ctx.flags.branch || "main"
              },
              projectId: ctx.flags.project,
              configuration: {
                severity: ctx.flags.severity ? ctx.flags.severity.split(",") : void 0,
                formats: ctx.flags.format ? ctx.flags.format.split(",") : void 0
              }
            });
            (0, import_cli_core.success)(`Security scan created: ${scan.name}`);
            console.log(`${blue("ID:")} ${scan.id}`);
            console.log(`${blue("Type:")} ${scan.type}`);
            console.log(`${blue("Target:")} ${scan.target.path}`);
            console.log(`${blue("Status:")} ${scan.status}`);
            (0, import_cli_core.info)("Executing scan...");
            await manager.executeScan(scan.id);
            const updatedScan = await manager["scans"].get(scan.id);
            if (updatedScan) {
              (0, import_cli_core.success)(`Scan completed: ${updatedScan.results.length} findings`);
              console.log(`${blue("Critical:")} ${updatedScan.metrics.criticalFindings}`);
              console.log(`${blue("High:")} ${updatedScan.metrics.highFindings}`);
              console.log(`${blue("Medium:")} ${updatedScan.metrics.mediumFindings}`);
              console.log(`${blue("Low:")} ${updatedScan.metrics.lowFindings}`);
              console.log(
                `${blue("Duration:")} ${(updatedScan.metrics.scanDuration / 1e3).toFixed(1)}s`
              );
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to execute scan: ${err.message}`);
          }
          break;
        }
        case "incident": {
          const incidentCmd = ctx.args[1];
          switch (incidentCmd) {
            case "create": {
              const title = ctx.args[2];
              if (!title) {
                (0, import_cli_core.error)("Usage: security incident create <title> --severity <level>");
                break;
              }
              try {
                const incident = await manager.createSecurityIncident({
                  title,
                  description: ctx.args.slice(3).join(" ") || title,
                  severity: ctx.flags.severity || "medium",
                  type: ctx.flags.type || "security-breach",
                  source: {
                    type: "user-report",
                    details: { reporter: "cli-user" }
                  },
                  affected: {
                    systems: ctx.flags.systems ? ctx.flags.systems.split(",") : []
                  }
                });
                (0, import_cli_core.success)(`Security incident created: ${incident.title}`);
                console.log(`${blue("ID:")} ${incident.id}`);
                console.log(`${blue("Severity:")} ${incident.severity}`);
                console.log(`${blue("Type:")} ${incident.type}`);
                console.log(`${blue("Status:")} ${incident.status}`);
                console.log(`${blue("Assigned To:")} ${incident.response.assignedTo.join(", ")}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to create incident: ${err.message}`);
              }
              break;
            }
            case "list": {
              (0, import_cli_core.info)("Incident listing not yet implemented");
              break;
            }
            default: {
              console.log("Available incident subcommands: create, list");
              break;
            }
          }
          break;
        }
        case "compliance": {
          const frameworks = ctx.args.slice(1);
          if (frameworks.length === 0) {
            (0, import_cli_core.error)("Usage: security compliance <framework1> [framework2] ...");
            break;
          }
          try {
            const checks = await manager.runComplianceAssessment(frameworks, {
              projectId: ctx.flags.project,
              environment: ctx.flags.environment
            });
            (0, import_cli_core.success)(`Compliance assessment completed: ${checks.length} checks`);
            console.log();
            const byFramework = {};
            for (const check of checks) {
              if (!byFramework[check.framework]) {
                byFramework[check.framework] = { passed: 0, failed: 0, total: 0 };
              }
              byFramework[check.framework].total++;
              if (check.status === "passed") {
                byFramework[check.framework].passed++;
              } else if (check.status === "failed") {
                byFramework[check.framework].failed++;
              }
            }
            for (const [framework, stats] of Object.entries(byFramework)) {
              const score = stats.passed / stats.total * 100;
              console.log(`${bold(framework)}:`);
              console.log(`  Score: ${score.toFixed(1)}% (${stats.passed}/${stats.total})`);
              console.log(
                `  ${green("Passed:")} ${stats.passed} | ${red("Failed:")} ${stats.failed}`
              );
              console.log();
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to run compliance assessment: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          try {
            const filters = {};
            if (ctx.flags.project)
              filters.projectId = ctx.flags.project;
            if (ctx.flags.environment)
              filters.environment = ctx.flags.environment;
            const metrics = await manager.getSecurityMetrics(filters);
            (0, import_cli_core.success)("Security Metrics:");
            console.log();
            console.log(`${bold("Scans:")}`);
            console.log(`  Total: ${metrics.scans.total} | Completed: ${metrics.scans.completed}`);
            console.log(
              `  Failed: ${metrics.scans.failed} | In Progress: ${metrics.scans.inProgress}`
            );
            console.log(`
${bold("Findings:")}`);
            console.log(`  Total: ${metrics.findings.total} | Open: ${metrics.findings.open}`);
            console.log(
              `  Resolved: ${metrics.findings.resolved} | Suppressed: ${metrics.findings.suppressed}`
            );
            console.log(
              `  Critical: ${metrics.findings.bySeverity.critical || 0} | High: ${metrics.findings.bySeverity.high || 0}`
            );
            console.log(`
${bold("Compliance:")}`);
            console.log(`  Overall Score: ${metrics.compliance.overallScore.toFixed(1)}%`);
            console.log(`  Trending: ${metrics.compliance.trending}`);
            console.log(`
${bold("Incidents:")}`);
            console.log(`  Total: ${metrics.incidents.total} | Open: ${metrics.incidents.open}`);
            console.log(`  Resolved: ${metrics.incidents.resolved}`);
            console.log(
              `  MTTD: ${(metrics.incidents.meanTimeToDetection / 1e3 / 60).toFixed(1)} minutes`
            );
            console.log(
              `  MTTR: ${(metrics.incidents.meanTimeToResolution / 1e3 / 60 / 60).toFixed(1)} hours`
            );
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get security metrics: ${err.message}`);
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  scan <name> <target>     Execute security scan");
          console.log("  incident                 Manage security incidents");
          console.log("  compliance <frameworks>  Run compliance assessment");
          console.log("  metrics                  Show security metrics");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(
            `  ${cyan("claude-flow security scan")} "API Vulnerability Scan" ./api --type vulnerability`
          );
          console.log(
            `  ${cyan("claude-flow security incident create")} "Unauthorized Access" --severity high`
          );
          console.log(`  ${cyan("claude-flow security compliance")} SOC2 GDPR --project web-app`);
          break;
        }
      }
    }
  },
  // Analytics Commands
  {
    name: "analytics",
    description: "Performance analytics, usage insights, and predictive optimization",
    options: [
      {
        name: "timerange",
        short: "t",
        description: "Time range for analysis (1h, 24h, 7d, 30d)",
        type: "string"
      },
      {
        name: "format",
        short: "f",
        description: "Output format (json, table, chart)",
        type: "string"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getAnalyticsManager();
      switch (subcommand) {
        case "dashboard": {
          const dashboardCmd = ctx.args[1];
          switch (dashboardCmd) {
            case "create": {
              const name = ctx.args[2];
              if (!name) {
                (0, import_cli_core.error)("Usage: analytics dashboard create <name> --type <type>");
                break;
              }
              try {
                const dashboard = await manager.createDashboard({
                  name,
                  description: ctx.args.slice(3).join(" ") || `Dashboard: ${name}`,
                  type: ctx.flags.type || "operational",
                  widgets: []
                  // Would be populated based on template
                });
                (0, import_cli_core.success)(`Dashboard created: ${dashboard.name}`);
                console.log(`${blue("ID:")} ${dashboard.id}`);
                console.log(`${blue("Type:")} ${dashboard.type}`);
                console.log(`${blue("Widgets:")} ${dashboard.widgets.length}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to create dashboard: ${err.message}`);
              }
              break;
            }
            case "list": {
              (0, import_cli_core.info)("Dashboard listing not yet implemented");
              break;
            }
            default: {
              console.log("Available dashboard subcommands: create, list");
              break;
            }
          }
          break;
        }
        case "insights": {
          try {
            const scope = {};
            if (ctx.flags.metrics) {
              scope.metrics = ctx.flags.metrics.split(",");
            }
            if (ctx.flags.timerange) {
              const range = ctx.flags.timerange;
              const now = /* @__PURE__ */ new Date();
              let start;
              switch (range) {
                case "1h":
                  start = new Date(now.getTime() - 60 * 60 * 1e3);
                  break;
                case "24h":
                  start = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
                  break;
                case "7d":
                  start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3);
                  break;
                case "30d":
                  start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
                  break;
                default:
                  start = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
              }
              scope.timeRange = { start, end: now };
            }
            const insights = await manager.generateInsights(scope);
            if (insights.length === 0) {
              (0, import_cli_core.info)("No insights generated");
              break;
            }
            (0, import_cli_core.success)(`Generated ${insights.length} insights:`);
            console.log();
            for (const insight of insights) {
              const priorityColor = insight.priority === "critical" ? red : insight.priority === "high" ? yellow : insight.priority === "medium" ? blue : green;
              console.log(
                `${bold(insight.title)} ${priorityColor(`[${insight.priority.toUpperCase()}]`)}`
              );
              console.log(`  ${insight.description}`);
              console.log(
                `  Type: ${insight.type} | Category: ${insight.category} | Confidence: ${insight.confidence}%`
              );
              if (insight.recommendations.length > 0) {
                console.log(`  Recommendations:`);
                for (const rec of insight.recommendations) {
                  console.log(`    \u2022 ${rec.action} (${rec.effort} effort)`);
                }
              }
              console.log();
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to generate insights: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          const metricType = ctx.args[1] || "performance";
          try {
            switch (metricType) {
              case "performance": {
                const metrics = await manager.getPerformanceMetrics();
                (0, import_cli_core.success)("Performance Metrics:");
                console.log();
                console.log(`${bold("System:")}`);
                console.log(`  CPU Usage: ${metrics.system.cpu.usage.toFixed(1)}%`);
                console.log(`  Memory Usage: ${metrics.system.memory.usage.toFixed(1)}%`);
                console.log(`  Disk Usage: ${metrics.system.disk.usage.toFixed(1)}%`);
                console.log(`
${bold("Application:")}`);
                console.log(
                  `  Response Time: ${metrics.application.responseTime.avg.toFixed(1)}ms (avg)`
                );
                console.log(
                  `  Throughput: ${metrics.application.throughput.requestsPerSecond.toFixed(1)} req/s`
                );
                console.log(`  Error Rate: ${metrics.application.errors.rate.toFixed(2)}%`);
                console.log(
                  `  Availability: ${metrics.application.availability.uptime.toFixed(2)}%`
                );
                console.log(`
${bold("Database:")}`);
                console.log(`  Active Connections: ${metrics.database.connections.active}`);
                console.log(
                  `  Avg Query Time: ${metrics.database.queries.avgExecutionTime.toFixed(1)}ms`
                );
                console.log(`  Slow Queries: ${metrics.database.queries.slowQueries}`);
                break;
              }
              case "usage": {
                const metrics = await manager.getUsageMetrics();
                (0, import_cli_core.success)("Usage Metrics:");
                console.log();
                console.log(`${bold("Users:")}`);
                console.log(`  Total: ${metrics.users.total}`);
                console.log(`  Active: ${metrics.users.active}`);
                console.log(`  New: ${metrics.users.new}`);
                console.log(`  Churn: ${metrics.users.churn}`);
                console.log(`
${bold("Sessions:")}`);
                console.log(`  Total: ${metrics.sessions.total}`);
                console.log(
                  `  Avg Duration: ${(metrics.sessions.duration.avg / 60).toFixed(1)} minutes`
                );
                console.log(`  Bounce Rate: ${metrics.sessions.bounceRate}%`);
                console.log(`
${bold("API:")}`);
                console.log(`  Calls: ${metrics.api.calls.toLocaleString()}`);
                console.log(`  Unique Consumers: ${metrics.api.uniqueConsumers}`);
                console.log(`  Avg Response Time: ${metrics.api.avgResponseTime}ms`);
                console.log(`  Error Rate: ${metrics.api.errorRate}%`);
                break;
              }
              case "business": {
                const metrics = await manager.getBusinessMetrics();
                (0, import_cli_core.success)("Business Metrics:");
                console.log();
                console.log(`${bold("Revenue:")}`);
                console.log(`  Total: $${metrics.revenue.total.toLocaleString()}`);
                console.log(`  Recurring: $${metrics.revenue.recurring.toLocaleString()}`);
                console.log(`  Growth: ${metrics.revenue.growth}%`);
                console.log(`  ARPU: $${metrics.revenue.arpu}`);
                console.log(`
${bold("Customers:")}`);
                console.log(`  Total: ${metrics.customers.total}`);
                console.log(`  New: ${metrics.customers.new}`);
                console.log(`  Churned: ${metrics.customers.churned}`);
                console.log(`  Satisfaction: ${metrics.customers.satisfaction}/5`);
                console.log(`
${bold("Conversion:")}`);
                console.log(`  Leads: ${metrics.conversion.leads}`);
                console.log(`  Qualified: ${metrics.conversion.qualified}`);
                console.log(`  Closed: ${metrics.conversion.closed}`);
                console.log(`  Rate: ${metrics.conversion.rate}%`);
                break;
              }
              default: {
                (0, import_cli_core.error)(`Unknown metric type: ${metricType}`);
                console.log("Available types: performance, usage, business");
                break;
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get ${metricType} metrics: ${err.message}`);
          }
          break;
        }
        case "predict": {
          const modelCmd = ctx.args[1];
          switch (modelCmd) {
            case "train": {
              const name = ctx.args[2];
              if (!name) {
                (0, import_cli_core.error)(
                  "Usage: analytics predict train <name> --features <features> --target <target>"
                );
                break;
              }
              try {
                const features = ctx.flags.features ? ctx.flags.features.split(",") : ["cpu-usage", "memory-usage"];
                const target = ctx.flags.target || "response-time";
                const model = await manager.trainPredictiveModel({
                  name,
                  description: `Predictive model: ${name}`,
                  type: ctx.flags.type || "regression",
                  algorithm: ctx.flags.algorithm || "linear-regression",
                  features,
                  target,
                  trainingPeriod: {
                    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1e3),
                    end: /* @__PURE__ */ new Date()
                  }
                });
                (0, import_cli_core.success)(`Predictive model trained: ${model.name}`);
                console.log(`${blue("ID:")} ${model.id}`);
                console.log(`${blue("Type:")} ${model.type}`);
                console.log(`${blue("Algorithm:")} ${model.algorithm}`);
                console.log(`${blue("Accuracy:")} ${model.accuracy.toFixed(1)}%`);
                console.log(`${blue("Features:")} ${model.features.join(", ")}`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to train model: ${err.message}`);
              }
              break;
            }
            case "predict": {
              const modelId = ctx.args[2];
              if (!modelId) {
                (0, import_cli_core.error)("Usage: analytics predict predict <model-id> --input <json>");
                break;
              }
              try {
                const input = ctx.flags.input ? JSON.parse(ctx.flags.input) : { "cpu-usage": 50, "memory-usage": 60 };
                const prediction = await manager.makePrediction(modelId, input);
                (0, import_cli_core.success)(`Prediction made:`);
                console.log(`${blue("Model:")} ${modelId}`);
                console.log(`${blue("Input:")} ${JSON.stringify(input)}`);
                console.log(`${blue("Prediction:")} ${JSON.stringify(prediction.prediction)}`);
                console.log(`${blue("Confidence:")} ${prediction.confidence.toFixed(1)}%`);
              } catch (err) {
                (0, import_cli_core.error)(`Failed to make prediction: ${err.message}`);
              }
              break;
            }
            default: {
              console.log("Available predict subcommands: train, predict");
              break;
            }
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  dashboard         Manage analytics dashboards");
          console.log("  insights          Generate automated insights");
          console.log("  metrics <type>    Show metrics (performance, usage, business)");
          console.log("  predict           Predictive modeling and forecasting");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(`  ${cyan("claude-flow analytics insights")} --timerange 7d`);
          console.log(`  ${cyan("claude-flow analytics metrics")} performance`);
          console.log(
            `  ${cyan("claude-flow analytics predict train")} "load-predictor" --features cpu,memory --target response-time`
          );
          break;
        }
      }
    }
  },
  // Audit and Compliance Commands
  {
    name: "audit",
    description: "Enterprise-grade audit logging and compliance reporting",
    options: [
      {
        name: "framework",
        short: "f",
        description: "Compliance framework (SOC2, GDPR, HIPAA, PCI-DSS)",
        type: "string"
      },
      {
        name: "timerange",
        short: "t",
        description: "Time range for audit (1d, 7d, 30d, 90d)",
        type: "string"
      },
      {
        name: "export",
        short: "e",
        description: "Export format (json, csv, pdf)",
        type: "string"
      }
    ],
    action: async (ctx) => {
      const subcommand = ctx.args[0];
      const manager = await getAuditManager();
      switch (subcommand) {
        case "log": {
          const eventType = ctx.args[1];
          const action = ctx.args[2];
          if (!eventType || !action) {
            (0, import_cli_core.error)("Usage: audit log <event-type> <action> --resource <resource>");
            break;
          }
          try {
            const entry = await manager.logAuditEvent({
              eventType,
              category: ctx.flags.category || "system-change",
              severity: ctx.flags.severity || "medium",
              userId: ctx.flags.user,
              resource: {
                type: ctx.flags.resourceType || "system",
                id: ctx.flags.resourceId || "unknown",
                name: ctx.flags.resourceName
              },
              action,
              outcome: ctx.flags.outcome || "success",
              details: ctx.flags.details ? JSON.parse(ctx.flags.details) : {},
              context: {
                source: "cli",
                ipAddress: ctx.flags.ip,
                userAgent: ctx.flags.userAgent
              },
              compliance: {
                frameworks: ctx.flags.frameworks ? ctx.flags.frameworks.split(",") : []
              }
            });
            (0, import_cli_core.success)(`Audit event logged: ${entry.eventType}`);
            console.log(`${blue("ID:")} ${entry.id}`);
            console.log(`${blue("Category:")} ${entry.category}`);
            console.log(`${blue("Severity:")} ${entry.severity}`);
            console.log(`${blue("Outcome:")} ${entry.outcome}`);
            console.log(`${blue("Timestamp:")} ${entry.timestamp.toISOString()}`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to log audit event: ${err.message}`);
          }
          break;
        }
        case "report": {
          const reportType = ctx.args[1] || "compliance";
          try {
            const timeRange = ctx.flags.timerange || "30d";
            const now = /* @__PURE__ */ new Date();
            let start;
            switch (timeRange) {
              case "1d":
                start = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
                break;
              case "7d":
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3);
                break;
              case "30d":
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
                break;
              case "90d":
                start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1e3);
                break;
              default:
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
            }
            const report = await manager.generateAuditReport({
              title: `${reportType.toUpperCase()} Audit Report`,
              description: `Automated ${reportType} audit report for ${timeRange}`,
              type: reportType,
              scope: {
                timeRange: { start, end: now },
                systems: ["all"],
                users: ["all"],
                events: ["all"],
                compliance: ctx.flags.framework ? [ctx.flags.framework] : []
              }
            });
            (0, import_cli_core.success)(`Audit report generated: ${report.title}`);
            console.log(`${blue("ID:")} ${report.id}`);
            console.log(`${blue("Type:")} ${report.type}`);
            console.log(`${blue("Status:")} ${report.status}`);
            console.log(`${blue("Events Analyzed:")} ${report.summary.totalEvents}`);
            console.log(`${blue("Critical Findings:")} ${report.summary.criticalFindings}`);
            console.log(
              `${blue("Compliance Score:")} ${report.summary.complianceScore.toFixed(1)}%`
            );
            console.log(`${blue("Risk Level:")} ${report.summary.riskLevel}`);
            if (report.findings.length > 0 && ctx.flags.verbose) {
              console.log(`
${bold("Findings:")}`);
              for (const finding of report.findings.slice(0, 5)) {
                console.log(`  ${finding.severity.toUpperCase()}: ${finding.title}`);
              }
              if (report.findings.length > 5) {
                console.log(`  ... and ${report.findings.length - 5} more`);
              }
            }
            if (report.recommendations.length > 0) {
              console.log(`
${bold("Recommendations:")}`);
              for (const rec of report.recommendations.slice(0, 3)) {
                console.log(`  \u2022 ${rec.title} (${rec.priority} priority)`);
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to generate audit report: ${err.message}`);
          }
          break;
        }
        case "export": {
          try {
            const format = ctx.flags.export || "json";
            const timeRange = ctx.flags.timerange || "30d";
            const now = /* @__PURE__ */ new Date();
            let start;
            switch (timeRange) {
              case "1d":
                start = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
                break;
              case "7d":
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3);
                break;
              case "30d":
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
                break;
              case "90d":
                start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1e3);
                break;
              default:
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
            }
            const filepath = await manager.exportAuditData({
              format,
              scope: {
                timeRange: { start, end: now },
                categories: ctx.flags.categories ? ctx.flags.categories.split(",") : void 0,
                severity: ctx.flags.severity ? ctx.flags.severity.split(",") : void 0
              },
              destination: ctx.flags.output || "./audit-export",
              encryption: ctx.flags.encrypt || false,
              compression: ctx.flags.compress || false
            });
            (0, import_cli_core.success)(`Audit data exported: ${filepath}`);
            console.log(`${blue("Format:")} ${format}`);
            console.log(`${blue("Time Range:")} ${timeRange}`);
            console.log(`${blue("Encrypted:")} ${ctx.flags.encrypt ? "Yes" : "No"}`);
            console.log(`${blue("Compressed:")} ${ctx.flags.compress ? "Yes" : "No"}`);
          } catch (err) {
            (0, import_cli_core.error)(`Failed to export audit data: ${err.message}`);
          }
          break;
        }
        case "verify": {
          try {
            const verification = await manager.verifyAuditIntegrity();
            if (verification.verified) {
              (0, import_cli_core.success)("Audit integrity verification passed");
            } else {
              (0, import_cli_core.error)(
                `Audit integrity verification failed: ${verification.issues.length} issues found`
              );
            }
            console.log(`${blue("Total Entries:")} ${verification.summary.totalEntries}`);
            console.log(`${blue("Verified Entries:")} ${verification.summary.verifiedEntries}`);
            console.log(`${blue("Corrupted Entries:")} ${verification.summary.corruptedEntries}`);
            console.log(`${blue("Missing Entries:")} ${verification.summary.missingEntries}`);
            if (verification.issues.length > 0 && ctx.flags.verbose) {
              console.log(`
${bold("Issues:")}`);
              for (const issue of verification.issues.slice(0, 5)) {
                console.log(`  ${issue.severity.toUpperCase()}: ${issue.description}`);
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to verify audit integrity: ${err.message}`);
          }
          break;
        }
        case "metrics": {
          try {
            const timeRange = ctx.flags.timerange || "30d";
            const now = /* @__PURE__ */ new Date();
            let start;
            switch (timeRange) {
              case "1d":
                start = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
                break;
              case "7d":
                start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1e3);
                break;
              case "30d":
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
                break;
              case "90d":
                start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1e3);
                break;
              default:
                start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1e3);
            }
            const metrics = await manager.getAuditMetrics({ start, end: now });
            (0, import_cli_core.success)("Audit Metrics:");
            console.log();
            console.log(`${bold("Volume:")}`);
            console.log(`  Total Entries: ${metrics.volume.totalEntries.toLocaleString()}`);
            console.log(`  Daily Average: ${metrics.volume.dailyAverage.toFixed(0)}`);
            console.log(`  Peak Hourly: ${metrics.volume.peakHourly}`);
            console.log(`
${bold("Compliance:")}`);
            console.log(`  Overall Score: ${metrics.compliance.overallScore.toFixed(1)}%`);
            console.log(`  Trending: ${metrics.compliance.trending}`);
            console.log(`
${bold("Integrity:")}`);
            console.log(
              `  Verification Success: ${metrics.integrity.verificationSuccess.toFixed(1)}%`
            );
            console.log(`  Tamper Attempts: ${metrics.integrity.tamperAttempts}`);
            console.log(`  Data Loss: ${metrics.integrity.dataLoss}`);
            console.log(`
${bold("Security:")}`);
            console.log(`  Unauthorized Access: ${metrics.security.unauthorizedAccess}`);
            console.log(`  Privileged Actions: ${metrics.security.privilegedActions}`);
            console.log(`  Escalated Incidents: ${metrics.security.escalatedIncidents}`);
            if (Object.keys(metrics.volume.byCategory).length > 0) {
              console.log(`
${bold("By Category:")}`);
              for (const [category, count] of Object.entries(metrics.volume.byCategory)) {
                console.log(`  ${category}: ${count.toLocaleString()}`);
              }
            }
          } catch (err) {
            (0, import_cli_core.error)(`Failed to get audit metrics: ${err.message}`);
          }
          break;
        }
        default: {
          console.log(`${bold("Available subcommands:")}`);
          console.log("  log <event> <action>  Log an audit event");
          console.log("  report [type]         Generate audit report");
          console.log("  export                Export audit data");
          console.log("  verify                Verify audit integrity");
          console.log("  metrics               Show audit metrics");
          console.log();
          console.log(`${bold("Examples:")}`);
          console.log(
            `  ${cyan("claude-flow audit log")} user_login success --user john.doe --resource user-account`
          );
          console.log(
            `  ${cyan("claude-flow audit report")} compliance --framework SOC2 --timerange 90d`
          );
          console.log(
            `  ${cyan("claude-flow audit export")} --format csv --timerange 30d --encrypt`
          );
          break;
        }
      }
    }
  }
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  enterpriseCommands
});
//# sourceMappingURL=enterprise.js.map
