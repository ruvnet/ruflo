"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var agents_exports = {};
__export(agents_exports, {
  AgentCapabilitySystem: () => import_capabilities.AgentCapabilitySystem,
  AgentFactory: () => AgentFactory,
  AgentLifecycle: () => AgentLifecycle,
  AgentManager: () => import_agent_manager.AgentManager,
  AgentRegistry: () => import_agent_registry.AgentRegistry,
  AnalystAgent: () => import_analyst.AnalystAgent,
  ArchitectAgent: () => import_architect.ArchitectAgent,
  BaseAgent: () => import_base_agent.BaseAgent,
  CoderAgent: () => import_coder.CoderAgent,
  CoordinatorAgent: () => import_coordinator.CoordinatorAgent,
  ResearcherAgent: () => import_researcher.ResearcherAgent,
  TesterAgent: () => import_tester.TesterAgent,
  createAgentFactory: () => createAgentFactory,
  createAnalystAgent: () => import_analyst.createAnalystAgent,
  createArchitectAgent: () => import_architect.createArchitectAgent,
  createCoderAgent: () => import_coder.createCoderAgent,
  createCoordinatorAgent: () => import_coordinator.createCoordinatorAgent,
  createResearcherAgent: () => import_researcher.createResearcherAgent,
  createTesterAgent: () => import_tester.createTesterAgent
});
module.exports = __toCommonJS(agents_exports);
var import_base_agent = require("./base-agent.js");
var import_researcher = require("./researcher.js");
var import_coder = require("./coder.js");
var import_analyst = require("./analyst.js");
var import_architect = require("./architect.js");
var import_tester = require("./tester.js");
var import_coordinator = require("./coordinator.js");
var import_capabilities = require("./capabilities.js");
var import_agent_manager = require("../../agents/agent-manager.js");
var import_agent_registry = require("../../agents/agent-registry.js");
var import_researcher2 = require("./researcher.js");
var import_coder2 = require("./coder.js");
var import_analyst2 = require("./analyst.js");
var import_architect2 = require("./architect.js");
var import_tester2 = require("./tester.js");
var import_coordinator2 = require("./coordinator.js");
class AgentFactory {
  static {
    __name(this, "AgentFactory");
  }
  logger;
  eventBus;
  memory;
  agentCounter = 0;
  constructor(config) {
    this.logger = config.logger;
    this.eventBus = config.eventBus;
    this.memory = config.memory;
  }
  /**
   * Create an agent of the specified type
   */
  createAgent(type, config = {}, environment = {}, customId) {
    const id = customId || this.generateAgentId(type);
    this.logger.info("Creating agent", {
      id,
      type,
      factory: "AgentFactory"
    });
    switch (type) {
      case "researcher":
        return (0, import_researcher2.createResearcherAgent)(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory
        );
      case "coder":
        return (0, import_coder2.createCoderAgent)(id, config, environment, this.logger, this.eventBus, this.memory);
      case "analyst":
        return (0, import_analyst2.createAnalystAgent)(id, config, environment, this.logger, this.eventBus, this.memory);
      case "architect":
        return (0, import_architect2.createArchitectAgent)(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory
        );
      case "tester":
        return (0, import_tester2.createTesterAgent)(id, config, environment, this.logger, this.eventBus, this.memory);
      case "coordinator":
        return (0, import_coordinator2.createCoordinatorAgent)(
          id,
          config,
          environment,
          this.logger,
          this.eventBus,
          this.memory
        );
      default:
        throw new Error(`Unknown agent type: ${type}`);
    }
  }
  /**
   * Create multiple agents of different types
   */
  createAgents(specs) {
    const agents = [];
    for (const spec of specs) {
      const count = spec.count || 1;
      for (let i = 0; i < count; i++) {
        const agent = this.createAgent(spec.type, spec.config, spec.environment);
        agents.push(agent);
      }
    }
    this.logger.info("Created multiple agents", {
      totalAgents: agents.length,
      specs: specs.map((s) => ({ type: s.type, count: s.count || 1 }))
    });
    return agents;
  }
  /**
   * Create a balanced swarm of agents
   */
  createBalancedSwarm(size = 5, strategy = "balanced") {
    const compositions = {
      research: {
        researcher: 0.4,
        analyst: 0.3,
        coordinator: 0.2,
        architect: 0.1
      },
      development: {
        coder: 0.4,
        tester: 0.25,
        architect: 0.2,
        coordinator: 0.15
      },
      analysis: {
        analyst: 0.4,
        researcher: 0.3,
        coordinator: 0.2,
        architect: 0.1
      },
      balanced: {
        coder: 0.25,
        researcher: 0.2,
        analyst: 0.2,
        tester: 0.15,
        architect: 0.1,
        coordinator: 0.1
      }
    };
    const composition = compositions[strategy];
    const specs = [];
    for (const [type, ratio] of Object.entries(composition)) {
      const count = Math.max(1, Math.round(size * ratio));
      specs.push({ type, count });
    }
    const totalCount = specs.reduce((sum, spec) => sum + spec.count, 0);
    if (totalCount > size) {
      specs.sort((a, b) => b.count - a.count);
      let excess = totalCount - size;
      for (const spec of specs) {
        if (excess <= 0)
          break;
        const reduction = Math.min(excess, spec.count - 1);
        spec.count -= reduction;
        excess -= reduction;
      }
    }
    return this.createAgents(specs.map((spec) => ({ type: spec.type, count: spec.count })));
  }
  /**
   * Get supported agent types
   */
  getSupportedTypes() {
    return [
      "researcher",
      "coder",
      "analyst",
      "architect",
      "tester",
      "coordinator",
      "reviewer",
      "optimizer",
      "documenter",
      "monitor",
      "specialist",
      "requirements_analyst",
      "design_architect",
      "task_planner",
      "implementation_coder",
      "quality_reviewer",
      "steering_documenter"
    ];
  }
  /**
   * Get agent type descriptions
   */
  getAgentTypeDescriptions() {
    return {
      researcher: "Specialized in information gathering, web research, and data collection",
      coder: "Expert in software development, code generation, and implementation",
      analyst: "Focused on data analysis, performance optimization, and insights",
      architect: "Designs system architecture, technical specifications, and solutions",
      tester: "Specializes in testing, quality assurance, and validation",
      coordinator: "Manages task orchestration, planning, and team coordination",
      reviewer: "Reviews and validates work quality and standards",
      optimizer: "Optimizes performance and efficiency across systems",
      documenter: "Creates and maintains comprehensive documentation",
      monitor: "Monitors system health and performance metrics",
      specialist: "Provides domain-specific expertise and specialized knowledge",
      requirements_analyst: "Analyzes requirements and creates user stories with acceptance criteria",
      design_architect: "Creates technical designs and system architecture for features",
      "system-architect": "High-level system architecture and design patterns",
      task_planner: "Plans implementation tasks and orchestrates workflow execution",
      "task-planner": "Plans implementation tasks and orchestrates workflow execution",
      implementation_coder: "Implements code based on designs with quality focus",
      developer: "General purpose software development and implementation",
      quality_reviewer: "Reviews code quality and ensures standards compliance",
      steering_documenter: "Maintains governance documentation and project steering"
    };
  }
  /**
   * Generate unique agent ID
   */
  generateAgentId(type) {
    this.agentCounter++;
    const timestamp = Date.now().toString(36);
    const counter = this.agentCounter.toString(36).padStart(2, "0");
    return `${type}-${timestamp}-${counter}`;
  }
}
function createAgentFactory(logger, eventBus, memory) {
  return new AgentFactory({ logger, eventBus, memory });
}
__name(createAgentFactory, "createAgentFactory");
class AgentLifecycle {
  static {
    __name(this, "AgentLifecycle");
  }
  agents = /* @__PURE__ */ new Map();
  logger;
  constructor(logger) {
    this.logger = logger;
  }
  /**
   * Register an agent for lifecycle management
   */
  register(agent) {
    const info = agent.getAgentInfo();
    this.agents.set(info.id.id, agent);
    this.logger.info("Agent registered for lifecycle management", {
      agentId: info.id.id,
      type: info.type
    });
  }
  /**
   * Initialize all registered agents
   */
  async initializeAll() {
    const initPromises = Array.from(this.agents.values()).map(
      (agent) => agent.initialize().catch((error) => {
        const info = agent.getAgentInfo();
        this.logger.error("Agent initialization failed", {
          agentId: info.id.id,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      })
    );
    await Promise.all(initPromises);
    this.logger.info("All agents initialized", {
      count: this.agents.size
    });
  }
  /**
   * Shutdown all registered agents
   */
  async shutdownAll() {
    const shutdownPromises = Array.from(this.agents.values()).map(
      (agent) => agent.shutdown().catch((error) => {
        const info = agent.getAgentInfo();
        this.logger.error("Agent shutdown failed", {
          agentId: info.id.id,
          error: error instanceof Error ? error.message : String(error)
        });
      })
    );
    await Promise.all(shutdownPromises);
    this.agents.clear();
    this.logger.info("All agents shutdown");
  }
  /**
   * Get agent by ID
   */
  getAgent(agentId) {
    return this.agents.get(agentId);
  }
  /**
   * Get all registered agents
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }
  /**
   * Get agents by type
   */
  getAgentsByType(type) {
    return Array.from(this.agents.values()).filter((agent) => {
      const info = agent.getAgentInfo();
      return info.type === type;
    });
  }
  /**
   * Get agent statistics
   */
  getStatistics() {
    const stats = {
      total: this.agents.size,
      byType: {},
      byStatus: {},
      healthy: 0,
      active: 0
    };
    for (const agent of this.agents.values()) {
      const info = agent.getAgentInfo();
      stats.byType[info.type] = (stats.byType[info.type] || 0) + 1;
      stats.byStatus[info.status] = (stats.byStatus[info.status] || 0) + 1;
      if (info.health > 0.7) {
        stats.healthy++;
      }
      if (info.status === "idle" || info.status === "busy") {
        stats.active++;
      }
    }
    return stats;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AgentCapabilitySystem,
  AgentFactory,
  AgentLifecycle,
  AgentManager,
  AgentRegistry,
  AnalystAgent,
  ArchitectAgent,
  BaseAgent,
  CoderAgent,
  CoordinatorAgent,
  ResearcherAgent,
  TesterAgent,
  createAgentFactory,
  createAnalystAgent,
  createArchitectAgent,
  createCoderAgent,
  createCoordinatorAgent,
  createResearcherAgent,
  createTesterAgent
});
//# sourceMappingURL=index.js.map
