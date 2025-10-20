# Binto Labs Documentation Index

**Quick navigation to fork-specific documentation in `docs/binto-labs/`**

This fork adds **39 comprehensive documentation files** organized under `docs/binto-labs/`. All upstream documentation (137 files) remains in the main `docs/` directory.

---

## 🚀 Start Here

| Document | Description |
|----------|-------------|
| **[Fork README](README.md)** | Fork mission, contribution guidelines, and overview |
| **[Practical Guide](guides/practical-guide-2025.md)** | Complete user guide (1,606 lines) - your main starting point |
| **[Architecture Guide](guides/architecture-guide-2025.md)** | System architecture and design patterns |
| **[Skills Quick Start](guides/skills-quickstart.md)** | Essential Skills that activate with natural language (no commands to memorize!) |

---

## 📚 Technical Reference (7 Guides)

Fork-specific deep technical documentation.

| Document | Description |
|----------|-------------|
| [Agent Execution Framework](technical-reference/AGENT-EXECUTION-FRAMEWORK.md) | 5 execution strategies, lifecycle management, resource allocation |
| [Checkpoint Management](technical-reference/CHECKPOINT-MANAGEMENT.md) | Git-like session restore points, state preservation |
| [Docker Validation](technical-reference/DOCKER-VALIDATION.md) | 50+ automated tests, 8 test categories, CI/CD integration |
| [ReasoningBank Integration](technical-reference/REASONINGBANK-INTEGRATION.md) | AI-powered memory, SAFLA algorithm, 11,000+ patterns |
| [Neural Training Additions](technical-reference/NEURAL-TRAINING-ADDITIONS.md) | Fork additions to neural training (refers to upstream for full docs) |
| [SDK Additions](technical-reference/SDK-ADDITIONS.md) | Fork additions to SDK docs (checkpoint management, refers to upstream) |

> **Note:** For complete technical references including GitHub Integration, Hooks System, MCP Tools, Memory Architecture, Orchestration Patterns, Session Management, SPARC Verification, and Verification System, see the main `docs/` directory from upstream.

---

## 💻 SDK Documentation (14 Files)

Complete SDK reference with working examples.

| Document | Description |
|----------|-------------|
| [SDK Index](sdk/INDEX.md) | Navigation hub for SDK documentation |
| [Executive Summary](sdk/EXECUTIVE-SUMMARY.md) | High-level overview, component ratings, quick start |
| [API Reference](sdk/API-REFERENCE.md) | Complete TypeScript API (1,700 lines) |
| [SDK Improvements Analysis](sdk/SDK-IMPROVEMENTS-ANALYSIS.md) | Deep technical analysis (2,300 lines) |
| [Integration Roadmap](sdk/INTEGRATION-ROADMAP.md) | SDK integration planning |
| [MCP Tools Update](sdk/MCP-TOOLS-UPDATE.md) | MCP tool enhancements |
| [SDK Integration Complete](sdk/SDK-INTEGRATION-COMPLETE.md) | Integration status report |
| [SDK Validation Results](sdk/SDK-VALIDATION-RESULTS.md) | Validation and testing results |
| [Examples README](sdk/examples/README.md) | How to run and use the examples |
| [Checkpoint Workflow Example](sdk/examples/checkpoint-workflow.ts) | Git-like versioning demo (TypeScript) |
| [Parallel Agents Example](sdk/examples/parallel-agents.ts) | 10-20x speedup demo (TypeScript) |
| [Integrated Session Example](sdk/examples/integrated-session.ts) | SDK + MCP integration (TypeScript) |
| + 2 more SDK analysis docs

---

## 🔧 DevOps Documentation (6 Guides)

Testing, benchmarking, and operational excellence.

| Document | Description |
|----------|-------------|
| [DevOps Index](devops/README.md) | Navigation by task and role |
| [DevOps Tooling Analysis](devops/DEVOPS_TOOLING_ANALYSIS.md) | Comprehensive 21KB analysis of all DevOps tools |
| [Docker Validation Guide](devops/DOCKER_VALIDATION_GUIDE.md) | Quick start for Docker testing (50+ tests) |
| [Integration Testing Guide](devops/INTEGRATION_TESTING_GUIDE.md) | 150+ tests, 85%+ coverage, test framework |
| [Benchmark Reference](devops/BENCHMARK_REFERENCE.md) | Performance tracking, 352x speedup validation |
| [Quick Setup Examples](devops/QUICK_SETUP_EXAMPLES.md) | Copy-paste commands for common workflows |

---

## 📋 Architecture Decision Records (4 Files)

Understanding design choices and their rationale.

| Document | Description |
|----------|-------------|
| [ADR Process Guide](adr/README.md) | How to create and use ADRs |
| [ADR Template](adr/TEMPLATE.md) | Standard template for new ADRs |
| [ADR-001: User Guide Architecture](adr/001-user-guide-architecture-workflow-first.md) | Documentation-first approach decision |
| [ADR-002: Upstream Integration](adr/002-upstream-integration-v2.7.0-alpha.md) | v2.7.0-alpha merge strategy and decisions |

---

## 🔍 Investigation Reports (3 Files)

Deep-dive analysis and research findings.

| Document | Description |
|----------|-------------|
| [Investigation Index](investigation/README.md) | Overview of investigation reports |
| [Architecture Deep Dive](investigation/ARCHITECTURE-DEEP-DIVE.md) | Comprehensive system architecture analysis |
| [Guide Recommendations](investigation/NEW-GUIDE-RECOMMENDATIONS.md) | Documentation improvement suggestions |

---

## 🏗️ Additional Analysis (2 Files)

| Document | Description |
|----------|-------------|
| [MCP Integration Architecture](analysis/MCP-INTEGRATION-ARCHITECTURE.md) | Model Context Protocol integration patterns |
| [Plugin System Investigation](analysis/PLUGIN_SYSTEM_INVESTIGATION_REPORT.md) | Plugin architecture research and findings |

---

## 📊 Quick Statistics

| Metric | Value |
|--------|-------|
| **Fork-Original Docs** | 39 files in `docs/binto-labs/` |
| **Upstream Docs** | 137 files in main `docs/` |
| **Total Docs (fork + upstream)** | 176 files |
| **Documentation Lines Added** | 26,256+ lines |
| **Working Code Examples** | 3 TypeScript files |
| **Coverage Areas** | Technical, SDK, DevOps, Architecture, Investigation |

---

## 🎯 Recommended Reading Paths

### **For New Users**
1. [Practical Guide](guides/practical-guide-2025.md) - Start here!
2. [Quick Setup Examples](devops/QUICK_SETUP_EXAMPLES.md) - Get running fast
3. [SDK Examples](sdk/examples/) - See it in action

### **For Developers**
1. [SDK API Reference](sdk/API-REFERENCE.md) - Complete API
2. [Agent Execution Framework](technical-reference/AGENT-EXECUTION-FRAMEWORK.md) - Core concepts
3. [Checkpoint Management](technical-reference/CHECKPOINT-MANAGEMENT.md) - Session restore

### **For DevOps Engineers**
1. [Docker Validation Guide](devops/DOCKER_VALIDATION_GUIDE.md) - Testing setup
2. [Benchmark Reference](devops/BENCHMARK_REFERENCE.md) - Performance tracking
3. [Integration Testing Guide](devops/INTEGRATION_TESTING_GUIDE.md) - Test framework

### **For Architects**
1. [Architecture Guide](guides/architecture-guide-2025.md) - System design
2. [ADR-002](adr/002-upstream-integration-v2.7.0-alpha.md) - Recent decisions
3. [ReasoningBank Integration](technical-reference/REASONINGBANK-INTEGRATION.md) - AI memory

---

## 📂 Documentation Organization

```
/docs/
├── binto-labs/              ← ALL FORK DOCUMENTATION
│   ├── README.md            ← Fork overview
│   ├── guides/              ← User-facing guides (2)
│   ├── technical-reference/ ← Deep technical docs (7)
│   ├── sdk/                 ← SDK docs + examples (14)
│   ├── devops/              ← Operational guides (6)
│   ├── adr/                 ← Architecture decisions (4)
│   ├── investigation/       ← Research reports (3)
│   └── analysis/            ← Specialized analysis (2)
│
└── [upstream docs]/         ← 137 files from ruvnet/claude-flow
    ├── reasoningbank/
    ├── integrations/
    ├── technical-reference/
    ├── reports/
    └── ...
```

---

## 🔗 External Resources

- **Upstream Repository:** https://github.com/ruvnet/claude-flow
- **Fork Repository:** https://github.com/binto-labs/claude-flow
- **Flow-Nexus Platform:** https://flow-nexus.ruv.io
- **Official Issues:** https://github.com/ruvnet/claude-flow/issues

---

## 🤝 Contributing

See [Fork README](README.md) for contribution guidelines. We focus on:
- User-friendly guides and examples
- Troubleshooting documentation
- API reference improvements
- Setup and installation guides

---

**Last Updated:** 2025-10-16
**Fork Version:** v2.7.0-alpha with comprehensive documentation
**Upstream Sync:** Current with ruvnet/claude-flow v2.7.0-alpha.10
**Customizations:** Documentation only + enhanced .gitignore
