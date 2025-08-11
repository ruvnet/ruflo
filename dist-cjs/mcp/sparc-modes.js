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
var sparc_modes_exports = {};
__export(sparc_modes_exports, {
  loadSparcModes: () => loadSparcModes
});
module.exports = __toCommonJS(sparc_modes_exports);
const import_meta = {};
var fs = __toESM(require("fs/promises"), 1);
var path = __toESM(require("path"), 1);
var import_url = require("url");
const __filename = (0, import_url.fileURLToPath)(import_meta.url);
const __dirname = path.dirname(__filename);
async function loadSparcModes() {
  const modesPath = path.join(__dirname, "../../.roomodes");
  try {
    const content = await fs.readFile(modesPath, "utf-8");
    const modesData = JSON.parse(content);
    const modes = [];
    for (const [name, config] of Object.entries(modesData)) {
      const mode = {
        name,
        description: config.description || "",
        tools: config.tools || [],
        systemPrompt: config.prompt || ""
      };
      mode.bestPractices = getModeBestPractices(name);
      modes.push(mode);
    }
    return modes;
  } catch (error) {
    console.error("Error loading SPARC modes:", error);
    return getDefaultModes();
  }
}
__name(loadSparcModes, "loadSparcModes");
function getModeBestPractices(modeName) {
  const bestPracticesMap = {
    orchestrator: [
      "Use batch operations when working with multiple files",
      "Store intermediate results in Memory for coordination",
      "Enable parallel execution for independent tasks",
      "Monitor resource usage during intensive operations",
      "Leverage centralized coordination for team management"
    ],
    coder: [
      "Follow existing code patterns and conventions",
      "Write comprehensive tests for new code",
      "Use batch file operations for efficiency",
      "Implement proper error handling",
      "Add meaningful comments and documentation"
    ],
    researcher: [
      "Verify information from multiple sources",
      "Store findings in Memory for later reference",
      "Create structured research reports",
      "Cross-reference and validate data",
      "Document sources and methodology"
    ],
    tdd: [
      "Write tests before implementation",
      "Follow red-green-refactor cycle",
      "Aim for comprehensive test coverage",
      "Test edge cases and error conditions",
      "Keep tests simple and focused"
    ],
    architect: [
      "Design for scalability and maintainability",
      "Document architectural decisions",
      "Create clear component boundaries",
      "Plan for future extensibility",
      "Consider performance implications"
    ],
    reviewer: [
      "Check for security vulnerabilities",
      "Verify code follows conventions",
      "Suggest performance improvements",
      "Ensure proper error handling",
      "Validate test coverage"
    ],
    debugger: [
      "Reproduce issues consistently",
      "Use systematic debugging approach",
      "Add diagnostic logging",
      "Fix root causes not symptoms",
      "Write tests to prevent regression"
    ],
    tester: [
      "Test all code paths",
      "Include edge cases",
      "Verify error handling",
      "Test performance characteristics",
      "Automate test execution"
    ],
    analyst: [
      "Use efficient search patterns",
      "Analyze code metrics",
      "Identify patterns and anomalies",
      "Store analysis results",
      "Create actionable insights"
    ],
    optimizer: [
      "Profile before optimizing",
      "Focus on bottlenecks",
      "Measure improvements",
      "Balance readability and performance",
      "Document optimization rationale"
    ],
    documenter: [
      "Keep documentation current",
      "Include examples",
      "Document APIs thoroughly",
      "Use clear language",
      "Organize logically"
    ],
    designer: [
      "Follow design principles",
      "Consider accessibility",
      "Create consistent interfaces",
      "Test with users",
      "Document design decisions"
    ],
    innovator: [
      "Think outside conventional solutions",
      "Explore emerging technologies",
      "Prototype rapidly",
      "Learn from failures",
      "Document innovative approaches"
    ],
    "swarm-coordinator": [
      "Coordinate agent activities",
      "Balance workload distribution",
      "Monitor swarm progress",
      "Handle agent failures gracefully",
      "Optimize resource usage"
    ],
    "memory-manager": [
      "Organize information hierarchically",
      "Implement retention policies",
      "Enable efficient retrieval",
      "Prevent memory bloat",
      "Backup critical data"
    ],
    "batch-executor": [
      "Maximize parallelization",
      "Handle dependencies correctly",
      "Monitor resource usage",
      "Implement retry logic",
      "Aggregate results efficiently"
    ],
    "workflow-manager": [
      "Design efficient workflows",
      "Handle error conditions",
      "Enable workflow monitoring",
      "Support workflow versioning",
      "Document workflow logic"
    ]
  };
  return bestPracticesMap[modeName] || [
    "Follow best practices for the specific mode",
    "Document your approach",
    "Test thoroughly",
    "Handle errors gracefully",
    "Optimize for efficiency"
  ];
}
__name(getModeBestPractices, "getModeBestPractices");
function getDefaultModes() {
  return [
    {
      name: "orchestrator",
      description: "Multi-agent task orchestration and coordination",
      tools: ["TodoWrite", "TodoRead", "Task", "Memory", "Bash"],
      bestPractices: [
        "Use batch operations when working with multiple files",
        "Store intermediate results in Memory for coordination",
        "Enable parallel execution for independent tasks",
        "Monitor resource usage during intensive operations",
        "Leverage centralized coordination for team management"
      ]
    },
    {
      name: "coder",
      description: "Autonomous code generation and implementation",
      tools: ["Read", "Write", "Edit", "MultiEdit", "Bash", "TodoWrite"],
      bestPractices: [
        "Follow existing code patterns and conventions",
        "Write comprehensive tests for new code",
        "Use batch file operations for efficiency",
        "Implement proper error handling",
        "Add meaningful comments and documentation"
      ]
    },
    {
      name: "researcher",
      description: "Deep research and comprehensive analysis",
      tools: ["WebSearch", "WebFetch", "Read", "Memory", "TodoWrite"],
      bestPractices: [
        "Verify information from multiple sources",
        "Store findings in Memory for later reference",
        "Create structured research reports",
        "Cross-reference and validate data",
        "Document sources and methodology"
      ]
    },
    {
      name: "tdd",
      description: "Test-driven development methodology",
      tools: ["Write", "Edit", "Bash", "TodoWrite", "Read"],
      bestPractices: [
        "Write tests before implementation",
        "Follow red-green-refactor cycle",
        "Aim for comprehensive test coverage",
        "Test edge cases and error conditions",
        "Keep tests simple and focused"
      ]
    },
    {
      name: "architect",
      description: "System design and architecture planning",
      tools: ["Write", "Memory", "TodoWrite", "Read"],
      bestPractices: [
        "Design for scalability and maintainability",
        "Document architectural decisions",
        "Create clear component boundaries",
        "Plan for future extensibility",
        "Consider performance implications"
      ]
    },
    {
      name: "reviewer",
      description: "Code review and quality optimization",
      tools: ["Read", "Edit", "TodoWrite", "Memory"],
      bestPractices: [
        "Check for security vulnerabilities",
        "Verify code follows conventions",
        "Suggest performance improvements",
        "Ensure proper error handling",
        "Validate test coverage"
      ]
    },
    {
      name: "debugger",
      description: "Debug and fix issues systematically",
      tools: ["Read", "Edit", "Bash", "TodoWrite"],
      bestPractices: [
        "Reproduce issues consistently",
        "Use systematic debugging approach",
        "Add diagnostic logging",
        "Fix root causes not symptoms",
        "Write tests to prevent regression"
      ]
    },
    {
      name: "tester",
      description: "Comprehensive testing and validation",
      tools: ["Write", "Bash", "Read", "TodoWrite"],
      bestPractices: [
        "Test all code paths",
        "Include edge cases",
        "Verify error handling",
        "Test performance characteristics",
        "Automate test execution"
      ]
    },
    {
      name: "analyst",
      description: "Code and data analysis specialist",
      tools: ["Read", "Grep", "Glob", "Memory", "TodoWrite"],
      bestPractices: [
        "Use efficient search patterns",
        "Analyze code metrics",
        "Identify patterns and anomalies",
        "Store analysis results",
        "Create actionable insights"
      ]
    },
    {
      name: "optimizer",
      description: "Performance optimization specialist",
      tools: ["Read", "Edit", "Bash", "Memory", "TodoWrite"],
      bestPractices: [
        "Profile before optimizing",
        "Focus on bottlenecks",
        "Measure improvements",
        "Balance readability and performance",
        "Document optimization rationale"
      ]
    },
    {
      name: "documenter",
      description: "Documentation generation and maintenance",
      tools: ["Write", "Read", "TodoWrite"],
      bestPractices: [
        "Keep documentation current",
        "Include examples",
        "Document APIs thoroughly",
        "Use clear language",
        "Organize logically"
      ]
    },
    {
      name: "designer",
      description: "UI/UX design and user experience",
      tools: ["Write", "Read", "TodoWrite"],
      bestPractices: [
        "Follow design principles",
        "Consider accessibility",
        "Create consistent interfaces",
        "Test with users",
        "Document design decisions"
      ]
    },
    {
      name: "innovator",
      description: "Creative problem solving and innovation",
      tools: ["Memory", "TodoWrite", "WebSearch"],
      bestPractices: [
        "Think outside conventional solutions",
        "Explore emerging technologies",
        "Prototype rapidly",
        "Learn from failures",
        "Document innovative approaches"
      ]
    },
    {
      name: "swarm-coordinator",
      description: "Swarm coordination and management",
      tools: ["Task", "TodoWrite", "Memory"],
      bestPractices: [
        "Coordinate agent activities",
        "Balance workload distribution",
        "Monitor swarm progress",
        "Handle agent failures gracefully",
        "Optimize resource usage"
      ]
    },
    {
      name: "memory-manager",
      description: "Memory and knowledge management",
      tools: ["Memory", "TodoWrite"],
      bestPractices: [
        "Organize information hierarchically",
        "Implement retention policies",
        "Enable efficient retrieval",
        "Prevent memory bloat",
        "Backup critical data"
      ]
    },
    {
      name: "batch-executor",
      description: "Parallel task execution specialist",
      tools: ["Task", "TodoWrite", "Memory"],
      bestPractices: [
        "Maximize parallelization",
        "Handle dependencies correctly",
        "Monitor resource usage",
        "Implement retry logic",
        "Aggregate results efficiently"
      ]
    },
    {
      name: "workflow-manager",
      description: "Workflow automation and process management",
      tools: ["TodoWrite", "Task", "Memory", "Bash"],
      bestPractices: [
        "Design efficient workflows",
        "Handle error conditions",
        "Enable workflow monitoring",
        "Support workflow versioning",
        "Document workflow logic"
      ]
    }
  ];
}
__name(getDefaultModes, "getDefaultModes");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  loadSparcModes
});
//# sourceMappingURL=sparc-modes.js.map
