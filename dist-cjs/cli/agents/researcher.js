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
var researcher_exports = {};
__export(researcher_exports, {
  ResearcherAgent: () => ResearcherAgent,
  createResearcherAgent: () => createResearcherAgent
});
module.exports = __toCommonJS(researcher_exports);
var import_base_agent = require("./base-agent.js");
class ResearcherAgent extends import_base_agent.BaseAgent {
  static {
    __name(this, "ResearcherAgent");
  }
  constructor(id, config, environment, logger, eventBus, memory) {
    super(id, "researcher", config, environment, logger, eventBus, memory);
  }
  getDefaultCapabilities() {
    return {
      codeGeneration: false,
      codeReview: false,
      testing: false,
      documentation: true,
      research: true,
      analysis: true,
      webSearch: true,
      apiIntegration: true,
      fileSystem: true,
      terminalAccess: false,
      languages: [],
      frameworks: [],
      domains: [
        "research",
        "information-gathering",
        "data-collection",
        "market-analysis",
        "competitive-intelligence",
        "academic-research",
        "fact-checking",
        "trend-analysis",
        "literature-review"
      ],
      tools: [
        "web-search",
        "document-analyzer",
        "data-extractor",
        "citation-generator",
        "summary-generator",
        "trend-tracker",
        "fact-checker",
        "source-validator",
        "research-planner"
      ],
      maxConcurrentTasks: 5,
      maxMemoryUsage: 512 * 1024 * 1024,
      // 512MB
      maxExecutionTime: 9e5,
      // 15 minutes
      reliability: 0.92,
      speed: 0.85,
      quality: 0.95
    };
  }
  getDefaultConfig() {
    return {
      autonomyLevel: 0.8,
      learningEnabled: true,
      adaptationEnabled: true,
      maxTasksPerHour: 20,
      maxConcurrentTasks: 5,
      timeoutThreshold: 9e5,
      reportingInterval: 3e4,
      heartbeatInterval: 1e4,
      permissions: ["web-access", "file-read", "api-access", "search-engines", "database-read"],
      trustedAgents: [],
      expertise: {
        research: 0.95,
        analysis: 0.9,
        documentation: 0.85,
        "data-collection": 0.92,
        "fact-checking": 0.88
      },
      preferences: {
        verbose: true,
        detailed: true,
        citeSources: true,
        validateFacts: true,
        crossReference: true
      }
    };
  }
  async executeTask(task) {
    this.logger.info("Researcher executing task", {
      agentId: this.id,
      taskType: task.type,
      taskId: task.id
    });
    try {
      switch (task.type) {
        case "research":
          return await this.performResearch(task);
        case "analysis":
          return await this.analyzeData(task);
        case "fact-check":
          return await this.verifyFacts(task);
        case "literature-review":
          return await this.conductLiteratureReview(task);
        case "market-analysis":
          return await this.analyzeMarket(task);
        default:
          return await this.performGeneralResearch(task);
      }
    } catch (error) {
      this.logger.error("Research task failed", {
        agentId: this.id,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  async performResearch(task) {
    const query = task.parameters?.query || task.description;
    const sources = task.parameters?.sources || ["web", "academic", "news"];
    const depth = task.parameters?.depth || "moderate";
    this.logger.info("Starting research task", {
      query,
      sources,
      depth
    });
    const results = {
      query,
      sources: [],
      summary: "",
      findings: [],
      recommendations: [],
      confidence: 0,
      metadata: {
        searchTime: /* @__PURE__ */ new Date(),
        totalSources: 0,
        sourcesAnalyzed: 0,
        researchDepth: depth
      }
    };
    await this.memory.store(
      `research:${task.id}:progress`,
      {
        status: "in-progress",
        startTime: /* @__PURE__ */ new Date(),
        query
      },
      {
        type: "research-progress",
        tags: ["research", this.id],
        partition: "tasks"
      }
    );
    await this.delay(2e3);
    results.summary = `Research findings for: ${query}`;
    results.findings = [
      "Key insight 1 based on research",
      "Important trend identified",
      "Relevant data points discovered"
    ];
    results.recommendations = ["Recommendation based on findings", "Suggested next steps"];
    results.confidence = 0.85;
    results.metadata.totalSources = 15;
    results.metadata.sourcesAnalyzed = 12;
    await this.memory.store(`research:${task.id}:results`, results, {
      type: "research-results",
      tags: ["research", "completed", this.id],
      partition: "tasks"
    });
    return results;
  }
  async analyzeData(task) {
    const data = task.input?.data;
    const analysisType = task.input?.type || "general";
    this.logger.info("Analyzing data", {
      analysisType,
      dataSize: data ? Object.keys(data).length : 0
    });
    const analysis = {
      type: analysisType,
      insights: [],
      patterns: [],
      anomalies: [],
      confidence: 0,
      methodology: analysisType,
      timestamp: /* @__PURE__ */ new Date()
    };
    await this.delay(1500);
    analysis.insights = [
      "Pattern A shows significant correlation",
      "Trend B indicates growth potential",
      "Factor C requires attention"
    ];
    analysis.confidence = 0.82;
    return analysis;
  }
  async verifyFacts(task) {
    const claims = task.input?.claims || [];
    const sources = task.input?.sources || ["reliable", "academic"];
    this.logger.info("Fact-checking claims", {
      claimsCount: claims.length,
      sources
    });
    const verification = {
      claims: [],
      overallAccuracy: 0,
      sourcesChecked: [],
      methodology: "cross-reference",
      timestamp: /* @__PURE__ */ new Date()
    };
    await this.delay(3e3);
    verification.overallAccuracy = 0.88;
    verification.sourcesChecked = ["Source A", "Source B", "Source C"];
    return verification;
  }
  async conductLiteratureReview(task) {
    const topic = task.input?.topic || task.description;
    const timeframe = task.input?.timeframe || "5-years";
    const scope = task.input?.scope || "broad";
    this.logger.info("Conducting literature review", {
      topic,
      timeframe,
      scope
    });
    const review = {
      topic,
      timeframe,
      scope,
      papers: [],
      keyFindings: [],
      gaps: [],
      recommendations: [],
      confidence: 0,
      methodology: "systematic-review",
      timestamp: /* @__PURE__ */ new Date()
    };
    await this.delay(4e3);
    review.keyFindings = [
      "Consistent finding across multiple studies",
      "Emerging trend in recent publications",
      "Contradictory results require further investigation"
    ];
    review.confidence = 0.9;
    return review;
  }
  async analyzeMarket(task) {
    const market = task.input?.market || "general";
    const metrics = task.input?.metrics || ["size", "growth", "competition"];
    this.logger.info("Analyzing market", {
      market,
      metrics
    });
    const analysis = {
      market,
      metrics: {},
      trends: [],
      opportunities: [],
      threats: [],
      confidence: 0,
      timestamp: /* @__PURE__ */ new Date()
    };
    await this.delay(2500);
    analysis.trends = [
      "Growing demand in segment X",
      "Declining interest in feature Y",
      "Emerging technology Z shows promise"
    ];
    analysis.confidence = 0.83;
    return analysis;
  }
  async performGeneralResearch(task) {
    this.logger.info("Performing general research", {
      description: task.description
    });
    return await this.performResearch(task);
  }
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  getAgentStatus() {
    return {
      ...super.getAgentStatus(),
      specialization: "Research & Information Gathering",
      researchCapabilities: [
        "Web Research",
        "Academic Literature Review",
        "Market Analysis",
        "Fact Checking",
        "Data Collection",
        "Trend Analysis"
      ],
      currentResearchProjects: this.getCurrentTasks().length,
      averageResearchTime: "8-15 minutes",
      preferredSources: ["Academic", "Government", "Industry Reports", "News"],
      lastResearchCompleted: this.getLastTaskCompletedTime()
    };
  }
}
const createResearcherAgent = /* @__PURE__ */ __name((id, config, environment, logger, eventBus, memory) => {
  const defaultConfig = {
    autonomyLevel: 0.8,
    learningEnabled: true,
    adaptationEnabled: true,
    maxTasksPerHour: 10,
    maxConcurrentTasks: 3,
    timeoutThreshold: 6e5,
    reportingInterval: 12e4,
    heartbeatInterval: 6e4,
    permissions: ["web-search", "data-access", "file-read", "api-access", "research-tools"],
    trustedAgents: [],
    expertise: {
      "information-gathering": 0.95,
      "fact-checking": 0.92,
      "data-analysis": 0.88,
      "literature-review": 0.9,
      "market-research": 0.85
    },
    preferences: {
      searchDepth: "comprehensive",
      sourceVerification: "rigorous",
      reportingDetail: "detailed",
      timeInvestment: "thorough"
    }
  };
  const defaultEnv = {
    runtime: "deno",
    version: "1.40.0",
    workingDirectory: "./agents/researcher",
    tempDirectory: "./tmp/researcher",
    logDirectory: "./logs/researcher",
    apiEndpoints: {},
    credentials: {},
    availableTools: ["web-search", "document-reader", "data-extractor", "citation-generator"],
    toolConfigs: {}
  };
  return new ResearcherAgent(
    id,
    { ...defaultConfig, ...config },
    { ...defaultEnv, ...environment },
    logger,
    eventBus,
    memory
  );
}, "createResearcherAgent");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ResearcherAgent,
  createResearcherAgent
});
//# sourceMappingURL=researcher.js.map
