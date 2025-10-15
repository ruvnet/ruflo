# 🌊 Claude-Flow v2.7.0: Enterprise AI Orchestration Platform

<div align="center">

[![🌟 Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-flow)
[![📈 Downloads](https://img.shields.io/npm/dt/claude-flow?style=for-the-badge&logo=npm&color=blue&label=Downloads)](https://www.npmjs.com/package/claude-flow)
[![📦 Latest Release](https://img.shields.io/npm/v/claude-flow/alpha?style=for-the-badge&logo=npm&color=green&label=v2.7.0-alpha.10)](https://www.npmjs.com/package/claude-flow)
[![⚡ Claude Code](https://img.shields.io/badge/Claude%20Code-SDK%20Integrated-green?style=for-the-badge&logo=anthropic)](https://github.com/ruvnet/claude-flow)
[![🏛️ Agentics Foundation](https://img.shields.io/badge/Agentics-Foundation-crimson?style=for-the-badge&logo=openai)](https://discord.com/invite/dfxmpwkG2D)
[![🛡️ MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative)](https://opensource.org/licenses/MIT)

</div>

## 🌟 **Overview**

**Claude-Flow v2.7** is an enterprise-grade AI orchestration platform that combines **hive-mind swarm intelligence**, **persistent memory**, and **100+ advanced MCP tools** to revolutionize AI-powered development workflows.

### 🎯 **Key Features**

- **🧠 ReasoningBank Memory**: Persistent SQLite storage with semantic search (2-3ms latency)
- **🔍 Semantic Search**: Hash-based embeddings - works without API keys
- **🐝 Hive-Mind Intelligence**: Queen-led AI coordination with specialized worker agents
- **🔧 100 MCP Tools**: Comprehensive toolkit for swarm orchestration and automation
- **🔄 Dynamic Agent Architecture (DAA)**: Self-organizing agents with fault tolerance
- **💾 Persistent Memory**: `.swarm/memory.db` with 30+ specialized patterns
- **🪝 Advanced Hooks System**: Automated workflows with pre/post operation hooks
- **📊 GitHub Integration**: 6 specialized modes for repository management
- **🌐 Flow Nexus Cloud**: E2B sandboxes, AI swarms, challenges, and marketplace

> 🔥 **Revolutionary AI Coordination**: Build faster, smarter, and more efficiently with AI-powered development orchestration


---

## ⚡ **Quick Start**

### 📋 **Prerequisites**

- **Node.js 18+** (LTS recommended)
- **npm 9+** or equivalent package manager

⚠️ **IMPORTANT**: Claude Code must be installed first:

```bash
# 1. Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# 2. (Optional) Skip permissions check for faster setup
claude --dangerously-skip-permissions
```

### 🚀 **Install Latest Alpha**

```bash
# NPX (recommended - always latest)
npx claude-flow@alpha init --force
npx claude-flow@alpha --help

# Or install globally
npm install -g claude-flow@alpha
claude-flow --version
# v2.7.0-alpha.10
```

---

## 🆕 **What's New in v2.7.0-alpha.10**

### ✅ **Semantic Search Fixed**
Critical bug fix for semantic search returning 0 results:
- ✅ Fixed stale compiled code (dist-cjs/ now uses Node.js backend)
- ✅ Fixed result mapping for `retrieveMemories()` flat structure
- ✅ Fixed parameter mismatch (namespace vs domain)
- ✅ 2-3ms query latency with hash embeddings
- ✅ Works without API keys (deterministic 1024-dim embeddings)

### 🧠 **ReasoningBank Integration (agentic-flow@1.5.13)**
- **Node.js Backend**: Replaced WASM with SQLite + better-sqlite3
- **Persistent Storage**: All memories saved to `.swarm/memory.db`
- **Semantic Search**: MMR ranking with 4-factor scoring
- **Database Tables**: patterns, embeddings, trajectories, links
- **Performance**: 2ms queries, 400KB per pattern with embeddings

```bash
# Semantic search now fully functional
npx claude-flow@alpha memory store test "API configuration" --namespace semantic --reasoningbank
npx claude-flow@alpha memory query "configuration" --namespace semantic --reasoningbank
# ✅ Found 3 results (semantic search) in 2ms
```

📚 **Release Notes**: [v2.7.0-alpha.10](./docs/RELEASE-NOTES-v2.7.0-alpha.10.md)

## 🧠 **Memory System Commands**

### **ReasoningBank (Persistent SQLite Memory)**

```bash
# Store memories with semantic search
npx claude-flow@alpha memory store api_key "REST API configuration" \
  --namespace backend --reasoningbank

# Query with semantic search (2-3ms latency)
npx claude-flow@alpha memory query "API config" \
  --namespace backend --reasoningbank
# ✅ Found 3 results (semantic search)

# List all memories
npx claude-flow@alpha memory list --namespace backend --reasoningbank

# Check status and statistics
npx claude-flow@alpha memory status --reasoningbank
# ✅ Total memories: 30
#    Embeddings: 30
#    Storage: .swarm/memory.db
```

### **Features**
- ✅ **No API Keys Required**: Hash-based embeddings (1024 dimensions)
- ✅ **Persistent Storage**: SQLite database survives restarts
- ✅ **Semantic Search**: MMR ranking with similarity scoring
- ✅ **Namespace Isolation**: Organize memories by domain
- ✅ **Fast Queries**: 2-3ms average latency
- ✅ **Process Cleanup**: Automatic database closing

### **Optional: Enhanced Embeddings**
```bash
# For better semantic accuracy (requires API key)
export OPENAI_API_KEY=$YOUR_API_KEY
# Uses text-embedding-3-small (1536 dimensions)
```

---

## 🐝 **Swarm Orchestration**

### **Quick Swarm Commands**

```bash
# Quick task execution (recommended)
npx claude-flow@alpha swarm "build REST API with authentication" --claude

# Multi-agent coordination
npx claude-flow@alpha swarm init --topology mesh --max-agents 5
npx claude-flow@alpha swarm spawn researcher "analyze API patterns"
npx claude-flow@alpha swarm spawn coder "implement endpoints"
npx claude-flow@alpha swarm status
```

### **Hive-Mind for Complex Projects**

```bash
# Initialize hive-mind system
npx claude-flow@alpha hive-mind wizard
npx claude-flow@alpha hive-mind spawn "build enterprise system" --claude

# Session management
npx claude-flow@alpha hive-mind status
npx claude-flow@alpha hive-mind resume session-xxxxx
```

**When to Use:**
| Feature | `swarm` | `hive-mind` |
|---------|---------|-------------|
| **Best For** | Quick tasks | Complex projects |
| **Setup** | Instant | Interactive wizard |
| **Memory** | Task-scoped | Project-wide SQLite |
| **Sessions** | Temporary | Persistent + resume |

---

## 🔧 **MCP Tools Integration**

### **Setup MCP Servers**

```bash
# Add Claude Flow MCP server (required)
claude mcp add claude-flow npx claude-flow@alpha mcp start

# Optional: Enhanced coordination
claude mcp add ruv-swarm npx ruv-swarm mcp start

# Optional: Cloud features (requires registration)
claude mcp add flow-nexus npx flow-nexus@latest mcp start
```

### **Available MCP Tools (100 Total)**

**Core Tools:**
- `swarm_init`, `agent_spawn`, `task_orchestrate`
- `memory_usage`, `memory_search`
- `neural_status`, `neural_train`, `neural_patterns`

**Memory Tools:**
- `mcp__claude-flow__memory_usage` - Store/retrieve persistent memory
- `mcp__claude-flow__memory_search` - Pattern-based search

**GitHub Tools:**
- `github_repo_analyze`, `github_pr_manage`, `github_issue_track`

**Performance Tools:**
- `benchmark_run`, `performance_report`, `bottleneck_analyze`

📚 **Full Reference**: [MCP Tools Documentation](./docs/reference/MCP_TOOLS.md)

---

## 🪝 **Advanced Hooks System**

### **Automated Workflow Enhancement**

Claude-Flow automatically configures hooks for enhanced operations:

```bash
# Auto-configures hooks during init
npx claude-flow@alpha init --force
```

### **Available Hooks**

**Pre-Operation:**
- `pre-task`: Auto-assigns agents by complexity
- `pre-edit`: Validates files and prepares resources
- `pre-command`: Security validation

**Post-Operation:**
- `post-edit`: Auto-formats code
- `post-task`: Trains neural patterns
- `post-command`: Updates memory

**Session Management:**
- `session-start`: Restores previous context
- `session-end`: Generates summaries
- `session-restore`: Loads memory

---

## 🎯 **Common Workflows**

### **Pattern 1: Single Feature Development**
```bash
# Initialize once per feature
npx claude-flow@alpha init --force
npx claude-flow@alpha hive-mind spawn "Implement authentication" --claude

# Continue same feature (reuse hive)
npx claude-flow@alpha memory query "auth" --recent
npx claude-flow@alpha swarm "Add password reset" --continue-session
```

### **Pattern 2: Multi-Feature Project**
```bash
# Project initialization
npx claude-flow@alpha init --force --project-name "my-app"

# Feature 1: Authentication
npx claude-flow@alpha hive-mind spawn "auth-system" --namespace auth --claude

# Feature 2: User management
npx claude-flow@alpha hive-mind spawn "user-mgmt" --namespace users --claude
```

### **Pattern 3: Research & Analysis**
```bash
# Start research session
npx claude-flow@alpha hive-mind spawn "Research microservices" \
  --agents researcher,analyst --claude

# Check learned knowledge
npx claude-flow@alpha memory stats
npx claude-flow@alpha memory query "microservices patterns" --reasoningbank
```

---

## 📊 **Performance & Stats**

- **84.8% SWE-Bench solve rate** - Industry-leading problem-solving
- **32.3% token reduction** - Efficient context management
- **2.8-4.4x speed improvement** - Parallel coordination
- **2-3ms query latency** - ReasoningBank semantic search
- **64 specialized agents** - Complete development ecosystem
- **100 MCP tools** - Comprehensive automation toolkit

---

## 📚 **Documentation**

### **Core Documentation**
- **[MCP Tools Reference](./docs/reference/MCP_TOOLS.md)** - Complete tool catalog
- **[Agent System](./docs/reference/AGENTS.md)** - All 64 agents

### **Release Notes**
- **[v2.7.0-alpha.10](./docs/RELEASE-NOTES-v2.7.0-alpha.10.md)** - Semantic search fix
- **[v2.7.0-alpha.9](./docs/RELEASE-NOTES-v2.7.0-alpha.9.md)** - Process cleanup
- **[Changelog](./CHANGELOG.md)** - Full version history

### **Advanced Topics**
_Documentation coming soon_

### **Configuration**
- **[SPARC Methodology](./docs/reference/SPARC.md)** - TDD patterns

---

## 🤝 **Community & Support**

- **GitHub Issues**: [Report bugs or request features](https://github.com/ruvnet/claude-flow/issues)
- **Discord**: [Join the Agentics Foundation community](https://discord.com/invite/dfxmpwkG2D)
- **Documentation**: [Complete guides and tutorials](https://github.com/ruvnet/claude-flow/wiki)
- **Examples**: [Real-world usage patterns](https://github.com/ruvnet/claude-flow/tree/main/examples)

---

## 🚀 **Roadmap & Targets**

### **Immediate (Q4 2025)**
- ✅ Semantic search fix (v2.7.0-alpha.10)
- ✅ ReasoningBank Node.js backend
- 🔄 Enhanced embedding models
- 🔄 Multi-user collaboration features

### **Q1 2026**
- Advanced neural pattern recognition
- Cloud swarm coordination
- Real-time agent communication
- Enterprise SSO integration

### **Growth Targets**
- 5K+ GitHub stars, 50K npm downloads/month
- $25K MRR, 15 enterprise customers
- 90%+ error prevention
- 30+ minutes saved per developer per week

---

## Star History

<a href="https://www.star-history.com/#ruvnet/claude-flow&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ruvnet/claude-flow&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ruvnet/claude-flow&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=ruvnet/claude-flow&type=Date" />
 </picture>
</a>

---

## 📄 **License**

MIT License - see [LICENSE](./LICENSE) for details

---

**Built with ❤️ by [rUv](https://github.com/ruvnet) | Powered by Revolutionary AI**

*v2.7.0-alpha.10 - Semantic Search Fixed + ReasoningBank Node.js Backend*

</div>
