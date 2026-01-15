# Claude-Flow v3: Enterprise AI Orchestration Platform

<div align="center">


[![Star on GitHub](https://img.shields.io/github/stars/ruvnet/claude-flow?style=for-the-badge&logo=github&color=gold)](https://github.com/ruvnet/claude-flow)
[![Downloads](https://img.shields.io/npm/dt/claude-flow?style=for-the-badge&logo=npm&color=blue&label=Downloads)](https://www.npmjs.com/package/claude-flow)
[![Latest Release](https://img.shields.io/npm/v/claude-flow/alpha?style=for-the-badge&logo=npm&color=green&label=v3.0.0-alpha)](https://www.npmjs.com/package/claude-flow)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-SDK%20Integrated-green?style=for-the-badge&logo=anthropic)](https://github.com/ruvnet/claude-flow)
[![Agentics Foundation](https://img.shields.io/badge/Agentics-Foundation-crimson?style=for-the-badge&logo=openai)](https://discord.com/invite/dfxmpwkG2D)
[![ruv.io](https://img.shields.io/badge/ruv.io-AI%20Platform-purple?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQyIDAtOC0zLjU4LTgtOHMzLjU4LTggOC04IDggMy41OCA4IDgtMy41OCA4LTggOHoiLz48L3N2Zz4=)](https://ruv.io)
[![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge&logo=opensourceinitiative)](https://opensource.org/licenses/MIT)

**Production-ready multi-agent AI orchestration for Claude Code**

*Deploy 54+ specialized agents in coordinated swarms with self-learning capabilities, fault-tolerant consensus, and enterprise-grade security.*

</div>

## Overview

Claude-Flow is a comprehensive AI agent orchestration framework that transforms Claude Code into a powerful multi-agent development platform. It enables teams to deploy, coordinate, and optimize specialized AI agents working together on complex software engineering tasks.

### Architecture

```
User → Claude-Flow (CLI/MCP) → Router → Swarm → Agents → Memory → LLM Providers
                       ↑                          ↓
                       └──── Learning Loop ←──────┘
```
### Get Started Fast

``` 
npx claude-flow@v3alpha init 
```

---
### Key Capabilities

🤖 **54+ Specialized Agents** - Ready-to-use AI agents for coding, code review, testing, security audits, documentation, and DevOps. Each agent is optimized for its specific role.

🐝 **Coordinated Agent Teams** - Run unlimited agents simultaneously in organized swarms. Agents spawn sub-workers, communicate, share context, and divide work automatically using hierarchical (queen/workers) or mesh (peer-to-peer) patterns.

🧠 **Learns From Your Workflow** - The system remembers what works. Successful patterns are stored and reused, routing similar tasks to the best-performing agents. Gets smarter over time.

🔌 **Works With Any LLM** - Switch between Claude, GPT, Gemini, Cohere, or local models like Llama. Automatic failover if one provider is unavailable. Smart routing picks the cheapest option that meets quality requirements.

⚡ **Plugs Into Claude Code** - Native integration via MCP (Model Context Protocol). Use claude-flow commands directly in your Claude Code sessions with full tool access.

🔒 **Production-Ready Security** - Built-in protection against prompt injection, input validation, path traversal prevention, command injection blocking, and safe credential handling.

🧩 **Extensible Plugin System** - Add custom capabilities with the plugin SDK. Create workers, hooks, providers, and security modules. Share plugins via the decentralized IPFS marketplace.

---

<details open>
<summary>🔄 <strong>Core Flow</strong> — How requests move through the system</summary>

| Layer | Components | What It Does |
|-------|------------|--------------|
| User | Claude Code, CLI | Your interface to control and run commands |
| Orchestration | MCP Server, Router, Hooks | Routes requests to the right agents |
| Agents | 54+ types | Specialized workers (coder, tester, reviewer...) |
| Providers | Anthropic, OpenAI, Google, Ollama | AI models that power reasoning |

</details>

<details>
<summary>🐝 <strong>Swarm Coordination</strong> — How agents work together</summary>

| Layer | Components | What It Does |
|-------|------------|--------------|
| Coordination | Queen, Swarm, Consensus | Manages agent teams (Raft, Byzantine, Gossip) |
| Drift Control | Hierarchical topology, Checkpoints | Prevents agents from going off-task |

</details>

<details>
<summary>🧠 <strong>Intelligence & Memory</strong> — How the system learns and remembers</summary>

| Layer | Components | What It Does |
|-------|------------|--------------|
| Memory | HNSW, AgentDB, Cache | Stores and retrieves patterns 150x faster |
| Embeddings | ONNX Runtime, MiniLM | Local vectors without API calls (75x faster) |
| Learning | SONA, MoE, ReasoningBank | Self-improves from results (<0.05ms adaptation) |
| Fine-tuning | MicroLoRA, EWC++ | Lightweight adaptation without full retraining |

</details>

<details>
<summary>⚡ <strong>Optimization</strong> — How to reduce cost and latency</summary>

| Layer | Components | What It Does |
|-------|------------|--------------|
| Agent Booster | WASM, AST analysis | Skips LLM for simple edits (<1ms) |
| Token Optimizer | Compression, Caching | Reduces token usage 30-50% |

</details>

<details>
<summary>🔧 <strong>Operations</strong> — Background services and integrations</summary>

| Layer | Components | What It Does |
|-------|------------|--------------|
| Background | Daemon, 12 Workers | Auto-runs audits, optimization, learning |
| Security | AIDefence, Validation | Blocks injection, detects threats |
| Sessions | Persist, Restore, Export | Saves context across conversations |
| GitHub | PR, Issues, Workflows | Manages repos and code reviews |
| Analytics | Metrics, Benchmarks | Monitors performance, finds bottlenecks |

</details>

<details>
<summary>🎯 <strong>Task Routing</strong> — Extend your Claude Code subscription by 250%</summary>

Smart routing skips expensive LLM calls when possible. Simple edits use WASM (free), medium tasks use cheaper models. This can extend your Claude Code usage by 250% or save significantly on direct API costs.

| Complexity | Handler | Speed |
|------------|---------|-------|
| Simple | Agent Booster (WASM) | <1ms |
| Medium | Haiku/Sonnet | ~500ms |
| Complex | Opus + Swarm | 2-5s |

</details>

### Claude Code: With vs Without Claude-Flow

| Capability | Claude Code Alone | Claude Code + Claude-Flow |
|------------|-------------------|---------------------------|
| **Agent Collaboration** | Agents work in isolation, no shared context | Agents collaborate via swarms with shared memory and consensus |
| **Coordination** | Manual orchestration between tasks | Queen-led hierarchy with 5 consensus algorithms (Raft, Byzantine, Gossip) |
| **Memory** | Session-only, no persistence | HNSW vector memory with 150x-12,500x faster retrieval |
| **Learning** | Static behavior, no adaptation | SONA self-learning with <0.05ms adaptation, improves over time |
| **Task Routing** | You decide which agent to use | Intelligent routing based on learned patterns (89% accuracy) |
| **Complex Tasks** | Manual breakdown required | Automatic decomposition across 5 domains (Security, Core, Integration, Support) |
| **Background Workers** | Nothing runs automatically | 12 context-triggered workers auto-dispatch on file changes, patterns, sessions |
| **LLM Provider** | Anthropic only | 6 providers with automatic failover and cost-based routing (85% savings) |
| **Security** | Standard protections | CVE-hardened with bcrypt, input validation, path traversal prevention |
| **Performance** | Baseline | 2.8-4.4x faster tasks, 4-32x memory reduction via quantization |

## Quick Start

### Prerequisites

- **Node.js 18+** or **Bun 1.0+** (Bun is faster)
- **npm 9+** / **pnpm** / **bun** package manager

**IMPORTANT**: Claude Code must be installed first:

```bash
# 1. Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# 2. (Optional) Skip permissions check for faster setup
claude --dangerously-skip-permissions
```

### Installation

```bash
# With npm/npx (Node.js)
npm install claude-flow@v3alpha
npx claude-flow@v3alpha init

# With Bun (faster)
bun add claude-flow@v3alpha
bunx claude-flow@v3alpha init

# Start MCP server for Claude Code integration
npx claude-flow@v3alpha mcp start

# Run a task with agents
npx claude-flow@v3alpha --agent coder --task "Implement user authentication"

# List available agents
npx claude-flow@v3alpha --list
```

### Claude Code MCP Integration

Add claude-flow as an MCP server for seamless integration:

```bash
# Add claude-flow MCP server to Claude Code
claude mcp add claude-flow -- npx -y claude-flow@v3alpha

# Verify installation
claude mcp list
```

Once added, Claude Code can use all 175+ claude-flow tools directly:
- `swarm_init` - Initialize agent swarms
- `agent_spawn` - Spawn specialized agents
- `memory_search` - Search patterns with HNSW (150x faster)
- `hooks_route` - Intelligent task routing
- And 170+ more tools...


<summary><h3>🆚 Why Claude-Flow v3? </h3></summary>

Claude-Flow v3 introduces **self-learning neural capabilities** that no other agent orchestration framework offers. While competitors require manual agent configuration and static routing, Claude-Flow learns from every task execution, prevents catastrophic forgetting of successful patterns, and intelligently routes work to specialized experts.

| Feature | Claude Flow v3 | CrewAI | LangGraph | AutoGen | MetaGPT |
|---------|----------------|--------|-----------|---------|---------|
| **Self-Learning** | ✅ SONA + EWC++ | ⛔ | ⛔ | ⛔ | ⛔ |
| **Prevents Forgetting** | ✅ EWC++ consolidation | ⛔ | ⛔ | ⛔ | ⛔ |
| **Expert Routing** | ✅ MoE (8 experts) | Manual roles | Graph edges | ⛔ | Fixed roles |
| **Vector Memory** | ✅ HNSW (150x faster) | ⛔ | Via plugins | ⛔ | ⛔ |
| **Hyperbolic Embeddings** | ✅ Poincaré ball model | ⛔ | ⛔ | ⛔ | ⛔ |
| **Pattern Learning** | ✅ From trajectories | ⛔ | ⛔ | ⛔ | ⛔ |
| **Work Ownership** | ✅ Claims system | ⛔ | ⛔ | ⛔ | ⛔ |
| **Threat Detection** | ✅ AIDefence | ⛔ | ⛔ | ⛔ | ⛔ |
| **Attention Optimization** | ✅ Flash Attention | ⛔ | ⛔ | ⛔ | ⛔ |
| **Low-Rank Adaptation** | ✅ LoRA (128x compression) | ⛔ | ⛔ | ⛔ | ⛔ |
| **Quantization** | ✅ Int8 (3.92x savings) | ⛔ | ⛔ | ⛔ | ⛔ |
| **Consensus Protocols** | ✅ 5 (Raft, Byzantine, etc.) | ⛔ | ⛔ | ⛔ | ⛔ |
| **Background Workers** | ✅ 12 auto-triggered | ⛔ | ⛔ | ⛔ | ⛔ |
| **Multi-Provider LLM** | ✅ 6 with failover | 2 | 3 | 2 | 1 |
| **MCP Integration** | ✅ Native | ⛔ | ⛔ | ⛔ | ⛔ |
| **Swarm Topologies** | ✅ 4 (mesh, hierarchical, etc.) | 1 | 1 | 1 | 1 |

<details>
<summary>🚀 <strong>Key Differentiators</strong> — Self-learning, memory optimization, fault tolerance</summary>

What makes Claude-Flow different from other agent frameworks? These 9 capabilities work together to create a system that learns from experience, runs efficiently on any hardware, and keeps working even when things go wrong.

| | Feature | What It Does | Technical Details |
|---|---------|--------------|-------------------|
| 🧠 | **SONA** | Learns which agents perform best for each task type and routes work accordingly | Self-Optimizing Neural Architecture, <0.05ms adaptation |
| 🔒 | **EWC++** | Preserves learned patterns when training on new ones — no forgetting | Elastic Weight Consolidation prevents catastrophic forgetting |
| 🎯 | **MoE** | Routes tasks through 8 specialized expert networks based on task type | Mixture of 8 Experts with dynamic gating |
| ⚡ | **Flash Attention** | Accelerates attention computation 2-7x for faster agent responses | 2.49x-7.47x speedup for attention computations |
| 🌐 | **Hyperbolic Embeddings** | Represents hierarchical code relationships in compact vector space | Poincaré ball model for hierarchical code relationships |
| 📦 | **LoRA** | Compresses model weights 128x so agents fit in limited memory | 128x memory compression via Low-Rank Adaptation |
| 🗜️ | **Int8 Quantization** | Converts 32-bit weights to 8-bit with minimal accuracy loss | 3.92x memory reduction with calibrated 8-bit integers |
| 🤝 | **Claims System** | Manages task ownership between humans and agents with handoff support | Work ownership with claim/release/handoff protocols |
| 🛡️ | **Byzantine Consensus** | Coordinates agents even when some fail or return bad results | Fault-tolerant, handles up to 1/3 failing agents |

</details>

<details>
<summary>💰 <strong>Intelligent 3-Tier Model Routing</strong> — Save 75% on API costs, extend Claude Max 2.5x</summary>

Not every task needs the most powerful (and expensive) model. Claude-Flow analyzes each request and automatically routes it to the cheapest handler that can do the job well. Simple code transforms skip the LLM entirely using WebAssembly. Medium tasks use faster, cheaper models. Only complex architecture decisions use Opus.

**Cost & Usage Benefits:**

| Benefit | Impact |
|---------|--------|
| 💵 **API Cost Reduction** | 75% lower costs by using right-sized models |
| ⏱️ **Claude Max Extension** | 2.5x more tasks within your quota limits |
| 🚀 **Faster Simple Tasks** | <1ms for transforms vs 2-5s with LLM |
| 🎯 **Zero Wasted Tokens** | Simple edits use 0 tokens (WASM handles them) |

**Routing Tiers:**

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms: var→const, add-types, remove-console |
| **2** | Haiku/Sonnet | 500ms-2s | $0.0002-$0.003 | Bug fixes, refactoring, feature implementation |
| **3** | Opus | 2-5s | $0.015 | Architecture, security design, distributed systems |

**Benchmark Results:** 100% routing accuracy, 0.57ms avg routing decision latency

</details>

<details>
<summary>📋 <strong>Spec-Driven Development</strong> — Build complete specs, implement without drift</summary>

Complex projects fail when implementation drifts from the original plan. Claude-Flow solves this with a spec-first approach: define your architecture through ADRs (Architecture Decision Records), organize code into DDD bounded contexts, and let the system enforce compliance as agents work. The result is implementations that match specifications — even across multi-agent swarms working in parallel.

**How It Prevents Drift:**

| Capability | What It Does |
|------------|--------------|
| 🎯 **Spec-First Planning** | Agents generate ADRs before writing code, capturing requirements and decisions |
| 🔍 **Real-Time Compliance** | Statusline shows ADR compliance %, catches deviations immediately |
| 🚧 **Bounded Contexts** | Each domain (Security, Memory, etc.) has clear boundaries agents can't cross |
| ✅ **Validation Gates** | `hooks progress` blocks merges that violate specifications |
| 🔄 **Living Documentation** | ADRs update automatically as requirements evolve |

**Specification Features:**

| Feature | Description |
|---------|-------------|
| **Architecture Decision Records** | 10 ADRs defining system behavior, integration patterns, and security requirements |
| **Domain-Driven Design** | 5 bounded contexts with clean interfaces preventing cross-domain pollution |
| **Automated Spec Generation** | Agents create specs from requirements using SPARC methodology |
| **Drift Detection** | Continuous monitoring flags when code diverges from spec |
| **Hierarchical Coordination** | Queen agent enforces spec compliance across all worker agents |

**DDD Bounded Contexts:**
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│    Core     │  │   Memory    │  │  Security   │
│  Agents,    │  │  AgentDB,   │  │  AIDefence, │
│  Swarms,    │  │  HNSW,      │  │  Validation │
│  Tasks      │  │  Cache      │  │  CVE Fixes  │
└─────────────┘  └─────────────┘  └─────────────┘
┌─────────────┐  ┌─────────────┐
│ Integration │  │Coordination │
│ agentic-    │  │  Consensus, │
│ flow,MCP    │  │  Hive-Mind  │
└─────────────┘  └─────────────┘
```

**Key ADRs:**
- **ADR-001**: agentic-flow@alpha as foundation (eliminates 10,000+ duplicate lines)
- **ADR-006**: Unified Memory Service with AgentDB
- **ADR-008**: Vitest testing framework (10x faster than Jest)
- **ADR-009**: Hybrid Memory Backend (SQLite + HNSW)
- **ADR-026**: Intelligent 3-tier model routing

</details>

### 🏗️ Architecture Diagrams

<details>
<summary>📊 <strong>System Overview</strong> — High-level architecture</summary>

```mermaid
flowchart TB
    subgraph User["👤 User Layer"]
        CC[Claude Code]
        CLI[CLI Commands]
    end

    subgraph Orchestration["🎯 Orchestration Layer"]
        MCP[MCP Server]
        Router[Intelligent Router]
        Hooks[Self-Learning Hooks]
    end

    subgraph Agents["🤖 Agent Layer"]
        Queen[Queen Coordinator]
        Workers[54+ Specialized Agents]
        Swarm[Swarm Manager]
    end

    subgraph Intelligence["🧠 Intelligence Layer"]
        SONA[SONA Learning]
        MoE[Mixture of Experts]
        HNSW[HNSW Vector Search]
    end

    subgraph Providers["☁️ Provider Layer"]
        Anthropic[Anthropic]
        OpenAI[OpenAI]
        Google[Google]
        Ollama[Ollama]
    end

    CC --> MCP
    CLI --> MCP
    MCP --> Router
    Router --> Hooks
    Hooks --> Queen
    Queen --> Workers
    Queen --> Swarm
    Workers --> Intelligence
    Intelligence --> Providers
```

</details>

<details>
<summary>🔄 <strong>Request Flow</strong> — How tasks are processed</summary>

```mermaid
sequenceDiagram
    participant U as User
    participant R as Router
    participant H as Hooks
    participant A as Agent Pool
    participant M as Memory
    participant P as Provider

    U->>R: Submit Task
    R->>H: pre-task hook
    H->>H: Analyze complexity

    alt Simple Task
        H->>A: Agent Booster (WASM)
        A-->>U: Result (<1ms)
    else Medium Task
        H->>A: Spawn Haiku Agent
        A->>M: Check patterns
        M-->>A: Cached context
        A->>P: LLM Call
        P-->>A: Response
        A->>H: post-task hook
        H->>M: Store patterns
        A-->>U: Result
    else Complex Task
        H->>A: Spawn Swarm
        A->>A: Coordinate agents
        A->>P: Multiple LLM calls
        P-->>A: Responses
        A->>H: post-task hook
        A-->>U: Result
    end
```

</details>

<details>
<summary>🧠 <strong>Memory Architecture</strong> — How knowledge is stored and retrieved</summary>

```mermaid
flowchart LR
    subgraph Input["📥 Input"]
        Query[Query/Pattern]
    end

    subgraph Processing["⚙️ Processing"]
        Embed[ONNX Embeddings]
        Normalize[Normalization]
    end

    subgraph Storage["💾 Storage"]
        HNSW[(HNSW Index<br/>150x faster)]
        SQLite[(SQLite Cache)]
        AgentDB[(AgentDB)]
    end

    subgraph Retrieval["🔍 Retrieval"]
        Vector[Vector Search]
        Semantic[Semantic Match]
        Results[Top-K Results]
    end

    Query --> Embed
    Embed --> Normalize
    Normalize --> HNSW
    Normalize --> SQLite
    HNSW --> Vector
    SQLite --> Vector
    AgentDB --> Semantic
    Vector --> Results
    Semantic --> Results
```

</details>

<details>
<summary>🐝 <strong>Swarm Topology</strong> — Multi-agent coordination patterns</summary>

```mermaid
flowchart TB
    subgraph Hierarchical["👑 Hierarchical (Default)"]
        Q1[Queen] --> W1[Worker 1]
        Q1 --> W2[Worker 2]
        Q1 --> W3[Worker 3]
    end

    subgraph Mesh["🕸️ Mesh"]
        M1[Agent] <--> M2[Agent]
        M2 <--> M3[Agent]
        M3 <--> M1[Agent]
    end

    subgraph Ring["💍 Ring"]
        R1[Agent] --> R2[Agent]
        R2 --> R3[Agent]
        R3 --> R1
    end

    subgraph Star["⭐ Star"]
        S1[Hub] --> S2[Agent]
        S1 --> S3[Agent]
        S1 --> S4[Agent]
    end
```

</details>

<details>
<summary>🔒 <strong>Security Layer</strong> — Threat detection and prevention</summary>

```mermaid
flowchart TB
    subgraph Input["📥 Input Validation"]
        Req[Request] --> Scan[AIDefence Scan]
        Scan --> PII[PII Detection]
        Scan --> Inject[Injection Check]
        Scan --> Jailbreak[Jailbreak Detection]
    end

    subgraph Decision["⚖️ Decision"]
        PII --> Risk{Risk Level}
        Inject --> Risk
        Jailbreak --> Risk
    end

    subgraph Action["🎬 Action"]
        Risk -->|Safe| Allow[✅ Allow]
        Risk -->|Warning| Sanitize[🧹 Sanitize]
        Risk -->|Threat| Block[⛔ Block]
    end

    subgraph Learn["📚 Learning"]
        Allow --> Log[Log Pattern]
        Sanitize --> Log
        Block --> Log
        Log --> Update[Update Model]
    end
```

</details>

---

<details>
<summary><h2>🔌 MCP Setup — Connect Claude-Flow to Any AI Environment</h2></summary>

Claude-Flow runs as an MCP (Model Context Protocol) server, allowing you to connect it to any MCP-compatible AI client. This means you can use Claude-Flow's 54+ agents, swarm coordination, and self-learning capabilities from Claude Desktop, VS Code, Cursor, Windsurf, ChatGPT, and more.

### Quick Add Command

```bash
# Add Claude-Flow MCP server to any environment
npx claude-flow@v3alpha mcp add
```

---

<details open>
<summary>🖥️ <strong>Claude Desktop</strong></summary>

**Config Location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

**Access:** Claude → Settings → Developers → Edit Config

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart Claude Desktop after saving. Look for the MCP indicator (hammer icon) in the input box.

*Sources: [Claude Help Center](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [Anthropic Desktop Extensions](https://www.anthropic.com/engineering/desktop-extensions)*

</details>

<details>
<summary>⌨️ <strong>Claude Code (CLI)</strong></summary>

```bash
# Add via CLI (recommended)
claude mcp add claude-flow -- npx claude-flow@v3alpha mcp start

# Or add with environment variables
claude mcp add claude-flow \
  --env ANTHROPIC_API_KEY=sk-ant-... \
  -- npx claude-flow@v3alpha mcp start

# Verify installation
claude mcp list
```

*Sources: [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)*

</details>

<details>
<summary>💻 <strong>VS Code</strong></summary>

**Requires:** VS Code 1.102+ (MCP support is GA)

**Method 1: Command Palette**
1. Press `Cmd+Shift+P` (Mac) / `Ctrl+Shift+P` (Windows)
2. Run `MCP: Add Server`
3. Enter server details

**Method 2: Workspace Config**

Create `.vscode/mcp.json` in your project:

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

*Sources: [VS Code MCP Docs](https://code.visualstudio.com/docs/copilot/customization/mcp-servers), [MCP Integration Guides](https://mcpez.com/integrations)*

</details>

<details>
<summary>🎯 <strong>Cursor IDE</strong></summary>

**Method 1: One-Click** (if available in Cursor MCP marketplace)

**Method 2: Manual Config**

Create `.cursor/mcp.json` in your project (or global config):

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

**Important:** Cursor must be in **Agent Mode** (not Ask Mode) to access MCP tools. Cursor supports up to 40 MCP tools.

*Sources: [Cursor MCP Docs](https://docs.cursor.com/context/model-context-protocol), [Cursor Directory](https://cursor.directory/mcp)*

</details>

<details>
<summary>🏄 <strong>Windsurf IDE</strong></summary>

**Config Location:** `~/.codeium/windsurf/mcp_config.json`

**Access:** Windsurf Settings → Cascade → MCP Servers, or click the hammer icon in Cascade panel

```json
{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["claude-flow@v3alpha", "mcp", "start"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Click **Refresh** in the MCP settings to connect. Windsurf supports up to 100 MCP tools.

*Sources: [Windsurf MCP Tutorial](https://windsurf.com/university/tutorials/configuring-first-mcp-server), [Windsurf Cascade Docs](https://docs.windsurf.com/windsurf/cascade/mcp)*

</details>

<details>
<summary>🤖 <strong>ChatGPT</strong></summary>

**Requires:** ChatGPT Pro or Plus subscription with Developer Mode enabled

**Setup:**
1. Go to **Settings → Connectors → Advanced**
2. Enable **Developer Mode** (beta)
3. Add your MCP Server in the **Connectors** tab

**Remote Server Setup:**

For ChatGPT, you need a remote MCP server (not local stdio). Deploy claude-flow to a server with HTTP transport:

```bash
# Start with HTTP transport
npx claude-flow@v3alpha mcp start --transport http --port 3000
```

Then add the server URL in ChatGPT Connectors settings.

*Sources: [OpenAI MCP Docs](https://platform.openai.com/docs/mcp), [Docker MCP for ChatGPT](https://www.docker.com/blog/add-mcp-server-to-chatgpt/)*

</details>

<details>
<summary>🧪 <strong>Google AI Studio</strong></summary>

Google AI Studio supports MCP natively since May 2025, with managed MCP servers for Google services (Maps, BigQuery, etc.) launched December 2025.

**Using MCP SuperAssistant Extension:**
1. Install [MCP SuperAssistant](https://chrome.google.com/webstore) Chrome extension
2. Configure your claude-flow MCP server
3. Use with Google AI Studio, Gemini, and other AI platforms

**Native SDK Integration:**

```javascript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });

// MCP definitions are natively supported in the Gen AI SDK
const mcpConfig = {
  servers: [{
    name: 'claude-flow',
    command: 'npx',
    args: ['claude-flow@v3alpha', 'mcp', 'start']
  }]
};
```

*Sources: [Google AI Studio MCP](https://developers.googleblog.com/en/google-ai-studio-native-code-generation-agentic-tools-upgrade/), [Google Cloud MCP Announcement](https://cloud.google.com/blog/products/ai-machine-learning/announcing-official-mcp-support-for-google-services)*

</details>

<details>
<summary>🧠 <strong>JetBrains IDEs</strong></summary>

JetBrains AI Assistant supports MCP for IntelliJ IDEA, PyCharm, WebStorm, and other JetBrains IDEs.

**Setup:**
1. Open **Settings → Tools → AI Assistant → MCP**
2. Click **Add Server**
3. Configure:

```json
{
  "name": "claude-flow",
  "command": "npx",
  "args": ["claude-flow@v3alpha", "mcp", "start"]
}
```

*Sources: [JetBrains AI Assistant MCP](https://www.jetbrains.com/help/ai-assistant/mcp.html)*

</details>

### Environment Variables

All configurations support these environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | Yes (for Claude models) |
| `OPENAI_API_KEY` | OpenAI API key | Optional (for GPT models) |
| `GOOGLE_API_KEY` | Google AI API key | Optional (for Gemini) |
| `CLAUDE_FLOW_LOG_LEVEL` | Logging level (debug, info, warn, error) | Optional |

### Security Best Practices

⚠️ **Never hardcode API keys in config files checked into version control.**

```bash
# Use environment variables instead
export ANTHROPIC_API_KEY="sk-ant-..."

# Or use a .env file (add to .gitignore)
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

</details>

---

<details>
<summary><h2>📦 Features — 54+ Agents, Swarm Topologies, MCP Tools & Security</h2></summary>

Comprehensive feature set for enterprise-grade AI agent orchestration.

<details open>
<summary>🤖 <strong>Agent Ecosystem</strong> — 54+ specialized agents across 8 categories</summary>

Pre-built agents for every development task, from coding to security audits.

| Category | Agent Count | Key Agents | Purpose |
|----------|-------------|------------|---------|
| **Core Development** | 5 | coder, reviewer, tester, planner, researcher | Daily development tasks |
| **V3 Specialized** | 10 | queen-coordinator, security-architect, memory-specialist | Enterprise orchestration |
| **Swarm Coordination** | 5 | hierarchical-coordinator, mesh-coordinator, adaptive-coordinator | Multi-agent patterns |
| **Consensus & Distributed** | 7 | byzantine-coordinator, raft-manager, gossip-coordinator | Fault-tolerant coordination |
| **Performance** | 5 | perf-analyzer, performance-benchmarker, task-orchestrator | Optimization & monitoring |
| **GitHub & Repository** | 9 | pr-manager, code-review-swarm, issue-tracker, release-manager | Repository automation |
| **SPARC Methodology** | 6 | sparc-coord, specification, pseudocode, architecture | Structured development |
| **Specialized Dev** | 8 | backend-dev, mobile-dev, ml-developer, cicd-engineer | Domain expertise |

</details>

<details>
<summary>🐝 <strong>Swarm Topologies</strong> — 6 coordination patterns for any workload</summary>

Choose the right topology for your task complexity and team size.

| Topology | Recommended Agents | Best For | Execution Time | Memory/Agent |
|----------|-------------------|----------|----------------|--------------|
| **Hierarchical** | 6+ | Structured tasks, clear authority chains | 0.20s | 256 MB |
| **Mesh** | 4+ | Collaborative work, high redundancy | 0.15s | 192 MB |
| **Ring** | 3+ | Sequential processing pipelines | 0.12s | 128 MB |
| **Star** | 5+ | Centralized control, spoke workers | 0.14s | 180 MB |
| **Hybrid (Hierarchical-Mesh)** | 7+ | Complex multi-domain tasks | 0.18s | 320 MB |
| **Adaptive** | 2+ | Dynamic workloads, auto-scaling | Variable | Dynamic |

</details>

<details>
<summary>🔧 <strong>MCP Tools & Integration</strong> — 31+ tools across 7 categories</summary>

Full MCP server with tools for coordination, monitoring, memory, and GitHub integration.

| Category | Tools | Description |
|----------|-------|-------------|
| **Coordination** | `swarm_init`, `agent_spawn`, `task_orchestrate` | Swarm and agent lifecycle management |
| **Monitoring** | `swarm_status`, `agent_list`, `agent_metrics`, `task_status` | Real-time status and metrics |
| **Memory & Neural** | `memory_usage`, `neural_status`, `neural_train`, `neural_patterns` | Memory operations and learning |
| **GitHub** | `github_swarm`, `repo_analyze`, `pr_enhance`, `issue_triage`, `code_review` | Repository integration |
| **Workers** | `worker/run`, `worker/status`, `worker/alerts`, `worker/history` | Background task management |
| **Hooks** | `hooks/pre-*`, `hooks/post-*`, `hooks/route`, `hooks/session-*`, `hooks/intelligence/*` | 31 lifecycle hooks |
| **Progress** | `progress/check`, `progress/sync`, `progress/summary`, `progress/watch` | V3 implementation tracking |

</details>

<details>
<summary>🔒 <strong>Security Features</strong> — CVE-hardened with 7 protection layers</summary>

Enterprise-grade security with input validation, sandboxing, and active CVE monitoring.

| Feature | Protection | Implementation |
|---------|------------|----------------|
| **Input Validation** | Injection attacks | Boundary validation on all inputs |
| **Path Traversal Prevention** | Directory escape | Blocked patterns (`../`, `~/.`, `/etc/`) |
| **Command Sandboxing** | Shell injection | Allowlisted commands, metacharacter blocking |
| **Prototype Pollution** | Object manipulation | Safe JSON parsing with validation |
| **TOCTOU Protection** | Race conditions | Symlink skipping and atomic operations |
| **Information Disclosure** | Data leakage | Error message sanitization |
| **CVE Monitoring** | Known vulnerabilities | Active scanning and patching |

</details>

<details>
<summary>⚡ <strong>Advanced Capabilities</strong> — Self-healing, auto-scaling, event sourcing</summary>

Production-ready features for high availability and continuous learning.

| Feature | Description | Benefit |
|---------|-------------|---------|
| **Automatic Topology Selection** | AI-driven topology choice based on task complexity | Optimal resource utilization |
| **Parallel Execution** | Concurrent agent operation with load balancing | 2.8-4.4x speed improvement |
| **Neural Training** | 27+ model support with continuous learning | Adaptive intelligence |
| **Bottleneck Analysis** | Real-time performance monitoring and optimization | Proactive issue detection |
| **Smart Auto-Spawning** | Dynamic agent creation based on workload | Elastic scaling |
| **Self-Healing Workflows** | Automatic error recovery and task retry | High availability |
| **Cross-Session Memory** | Persistent pattern storage across sessions | Continuous learning |
| **Event Sourcing** | Complete audit trail with replay capability | Debugging and compliance |

</details>

<details>
<summary>🧩 <strong>Plugin System</strong> — Extend with custom tools, hooks, workers</summary>

Build custom plugins with the fluent builder API. Create MCP tools, hooks, workers, and providers.

| Component | Description | Key Features |
|-----------|-------------|--------------|
| **PluginBuilder** | Fluent builder for creating plugins | MCP tools, hooks, workers, providers |
| **MCPToolBuilder** | Build MCP tools with typed parameters | String, number, boolean, enum params |
| **HookBuilder** | Build hooks with conditions and transformers | Priorities, conditional execution |
| **WorkerPool** | Managed worker pool with auto-scaling | Min/max workers, task queuing |
| **ProviderRegistry** | LLM provider management with fallback | Cost optimization, automatic failover |
| **AgentDBBridge** | Vector storage with HNSW indexing | 150x faster search, batch operations |

**Plugin Performance:** Load <20ms, Hook execution <0.5ms, Worker spawn <50ms

</details>

<details>
<summary>🪝 <strong>Plugin Hook Events</strong> — 25+ lifecycle hooks for full control</summary>

Intercept and extend any operation with pre/post hooks.

| Category | Events | Description |
|----------|--------|-------------|
| **Session** | `session:start`, `session:end` | Session lifecycle management |
| **Agent** | `agent:pre-spawn`, `agent:post-spawn`, `agent:pre-terminate` | Agent lifecycle hooks |
| **Task** | `task:pre-execute`, `task:post-complete`, `task:error` | Task execution hooks |
| **Tool** | `tool:pre-call`, `tool:post-call` | MCP tool invocation hooks |
| **Memory** | `memory:pre-store`, `memory:post-store`, `memory:pre-retrieve` | Memory operation hooks |
| **Swarm** | `swarm:initialized`, `swarm:shutdown`, `swarm:consensus-reached` | Swarm coordination hooks |
| **File** | `file:pre-read`, `file:post-read`, `file:pre-write` | File operation hooks |
| **Learning** | `learning:pattern-learned`, `learning:pattern-applied` | Pattern learning hooks |

</details>

<details>
<summary>🔌 <strong>RuVector WASM Plugins</strong> — High-performance WebAssembly extensions</summary>

Pre-built WASM plugins for semantic search, intent routing, and pattern storage.

| Plugin | Description | Performance |
|--------|-------------|-------------|
| **SemanticCodeSearchPlugin** | Semantic code search with vector embeddings | Real-time indexing |
| **IntentRouterPlugin** | Routes user intents to optimal handlers | 95%+ accuracy |
| **HookPatternLibraryPlugin** | Pre-built patterns for common tasks | Security, testing, performance |
| **MCPToolOptimizerPlugin** | Optimizes MCP tool selection | Context-aware suggestions |
| **ReasoningBankPlugin** | Vector-backed pattern storage with HNSW | 150x faster search |
| **AgentConfigGeneratorPlugin** | Generates optimized agent configurations | From pretrain data |

</details>

<details>
<summary>⚙️ <strong>Background Workers</strong> — 12 auto-triggered workers for automation</summary>

Workers run automatically based on context, or dispatch manually via MCP tools.

| Worker | Trigger | Purpose | Auto-Triggers On |
|--------|---------|---------|------------------|
| **UltraLearn** | `ultralearn` | Deep knowledge acquisition | New project, major refactors |
| **Optimize** | `optimize` | Performance suggestions | Slow operations detected |
| **Consolidate** | `consolidate` | Memory consolidation | Session end, memory threshold |
| **Audit** | `audit` | Security vulnerability analysis | Security-related file changes |
| **Map** | `map` | Codebase structure mapping | New directories, large changes |
| **DeepDive** | `deepdive` | Deep code analysis | Complex file edits |
| **Document** | `document` | Auto-documentation | New functions/classes created |
| **Refactor** | `refactor` | Refactoring detection | Code smell patterns |
| **Benchmark** | `benchmark` | Performance benchmarking | Performance-critical changes |
| **TestGaps** | `testgaps` | Test coverage analysis | Code changes without tests |

```bash
npx claude-flow@v3alpha worker dispatch --trigger audit --context "./src"
npx claude-flow@v3alpha worker status
```

</details>

<details>
<summary>☁️ <strong>LLM Providers</strong> — 6 providers with automatic failover</summary>

| Provider | Models (2025-2026) | Features | Cost |
|----------|--------|----------|------|
| **Anthropic** | Claude Opus 4.5, Claude Sonnet 4.5, Claude Haiku 4.5 | Native, streaming, tool calling, extended thinking | $1-25/1M tokens |
| **OpenAI** | GPT-5.2, o3, o3-pro, o4-mini | 400K context, reasoning chains, 100% AIME 2025 | $0.15-60/1M tokens |
| **Google** | Gemini 3 Pro, Gemini 3 Flash, Gemini 3 Deep Think | 1M+ context, multimodal, Deep Think reasoning | $0.075-7/1M tokens |
| **xAI** | Grok 4.1, Grok 3 | Truth-seeking, real-time data, 200K H100 training | $2-10/1M tokens |
| **Mistral** | Mistral Large 3 (675B MoE), Codestral | 92% GPT-5.2 performance at 15% cost | $0.50-8/1M tokens |
| **Meta/Ollama** | Llama 4 Scout/Maverick, DeepSeek V3, Qwen 3 | Local, free, up to 10M context (Scout) | Free |

<details>
<summary>⚖️ <strong>Provider Load Balancing</strong> — 4 strategies for optimal cost and performance</summary>

| Strategy | Description | Best For |
|----------|-------------|----------|
| `round-robin` | Rotate through providers sequentially | Even distribution |
| `least-loaded` | Use provider with lowest current load | High throughput |
| `latency-based` | Use fastest responding provider | Low latency |
| `cost-based` | Use cheapest provider that meets requirements | Cost optimization (85%+ savings) |

</details>

<details>
<summary>🔢 <strong>Embedding Providers</strong> — 4 providers from 3ms local to cloud APIs</summary>

| Provider | Models | Dimensions | Latency | Cost |
|----------|--------|------------|---------|------|
| **Agentic-Flow** | ONNX SIMD optimized | 384 | ~3ms | Free (local) |
| **OpenAI** | text-embedding-3-small/large, ada-002 | 1536-3072 | ~50-100ms | $0.02-0.13/1M tokens |
| **Transformers.js** | all-MiniLM-L6-v2, all-mpnet-base-v2, bge-small | 384-768 | ~230ms | Free (local) |
| **Mock** | Deterministic hash-based | Configurable | <1ms | Free |

| Feature | Description | Performance |
|---------|-------------|-------------|
| **Auto-Install** | `provider: 'auto'` installs agentic-flow automatically | Zero config |
| **Smart Fallback** | agentic-flow → transformers → mock chain | Always works |
| **75x Faster** | Agentic-flow ONNX vs Transformers.js | 3ms vs 230ms |
| **LRU Caching** | Intelligent cache with hit rate tracking | <1ms cache hits |
| **Batch Processing** | Efficient batch embedding with partial cache | 10 items <100ms |
| **Similarity Functions** | Cosine, Euclidean, Dot product | Optimized math |

</details>

</details>

<details>
<summary>🤝 <strong>Consensus Strategies</strong> — 5 distributed agreement protocols</summary>

| Strategy | Algorithm | Fault Tolerance | Latency | Best For |
|----------|-----------|-----------------|---------|----------|
| **Byzantine (PBFT)** | Practical Byzantine Fault Tolerance | f < n/3 faulty nodes | ~100ms | Adversarial environments |
| **Raft** | Leader-based log replication | f < n/2 failures | ~50ms | Strong consistency |
| **Gossip** | Epidemic protocol dissemination | High partition tolerance | ~200ms | Eventually consistent |
| **CRDT** | Conflict-free Replicated Data Types | Strong eventual consistency | ~10ms | Concurrent updates |
| **Quorum** | Configurable read/write quorums | Flexible | ~75ms | Tunable consistency |

</details>

<details>
<summary>💻 <strong>CLI Commands</strong> — 26 commands with 140+ subcommands</summary>

| Command | Subcommands | Description |
|---------|-------------|-------------|
| `init` | 4 | Project initialization (wizard, check, skills, hooks) |
| `agent` | 8 | Agent lifecycle (spawn, list, status, stop, metrics, pool, health, logs) |
| `swarm` | 6 | Swarm coordination (init, start, status, stop, scale, coordinate) |
| `memory` | 11 | Memory operations (store, retrieve, search, list, delete, stats, configure, cleanup, compress, export, import) |
| `mcp` | 9 | MCP server (start, stop, status, health, restart, tools, toggle, exec, logs) |
| `task` | 6 | Task management (create, list, status, cancel, assign, retry) |
| `session` | 7 | Session management (list, save, restore, delete, export, import, current) |
| `config` | 7 | Configuration (init, get, set, providers, reset, export, import) |
| `status` | 3 | System status with watch mode (agents, tasks, memory) |
| `workflow` | 6 | Workflow execution (run, validate, list, status, stop, template) |
| `hooks` | 32 | Self-learning hooks (pre/post-edit, pre/post-command, route, explain, pretrain, session-*, intelligence/*, worker/*, progress) |
| `hive-mind` | 6 | Queen-led coordination (init, spawn, status, task, optimize-memory, shutdown) |
| `migrate` | 5 | V2→V3 migration (status, run, verify, rollback, breaking) |
| `neural` | 5 | Neural pattern training (train, status, patterns, predict, optimize) |
| `security` | 6 | Security scanning (scan, audit, cve, threats, validate, report) |
| `performance` | 5 | Performance profiling (benchmark, profile, metrics, optimize, report) |
| `providers` | 5 | AI providers (list, add, remove, test, configure) |
| `plugins` | 5 | Plugin management (list, install, uninstall, enable, disable) |
| `deployment` | 5 | Deployment management (deploy, rollback, status, environments, release) |
| `embeddings` | 13 | Vector embeddings with ONNX, hyperbolic space, neural substrate |
| `daemon` | 5 | Background workers (start, stop, status, trigger, enable) |
| `progress` | 4 | V3 implementation progress (check, sync, summary, watch) |
| `claims` | 4 | Authorization (check, grant, revoke, list) |
| `analyze` | 6 | Code analysis (diff, risk, classify, reviewers, file-risk, stats) |
| `issues` | 10 | Human-agent claims (list, claim, release, handoff, status, stealable, steal, load, rebalance, board) |
| `transfer-store` | 4 | Pattern marketplace via IPFS (list, search, download, publish) |
| `update` | 2 | Auto-update system (check, apply) |
| `route` | 3 | Intelligent routing (task, explain, coverage) |

</details>

<details>
<summary>🧪 <strong>Testing Framework</strong> — London School TDD with Vitest integration</summary>

| Component | Description | Features |
|-----------|-------------|----------|
| **London School TDD** | Behavior verification with mocks | Mock-first, interaction testing |
| **Vitest Integration** | ADR-008 compliant test runner | 10x faster than Jest |
| **Fixture Library** | Pre-defined test data | Agents, memory, swarm, MCP |
| **Mock Factory** | Application and service mocks | Auto-reset, state tracking |
| **Async Utilities** | waitFor, retry, withTimeout | Reliable async testing |
| **Performance Assertions** | V3 target validation | Speedup, memory, latency checks |

| Fixture Type | Contents | Use Case |
|--------------|----------|----------|
| `agentConfigs` | 15 V3 agent configurations | Agent testing |
| `memoryEntries` | Patterns, rules, embeddings | Memory testing |
| `swarmConfigs` | V3 default, minimal, mesh, hierarchical | Swarm testing |
| `mcpTools` | 175+ tool definitions | MCP testing |

</details>

<details>
<summary>🚀 <strong>Deployment & CI/CD</strong> — Automated versioning and release management</summary>

| Feature | Description | Automation |
|---------|-------------|------------|
| **Version Bumping** | major, minor, patch, prerelease | Automatic semver |
| **Changelog Generation** | Conventional commits parsing | Auto-generated |
| **Git Integration** | Tagging, committing | Automatic |
| **NPM Publishing** | alpha, beta, rc, latest tags | Tag-based |
| **Validation** | Lint, test, build, dependency checks | Pre-release |
| **Dry Run Mode** | Test releases without changes | Safe testing |

### Release Channels

| Channel | Version Format | Purpose |
|---------|---------------|---------|
| `alpha` | 1.0.0-alpha.1 | Early development |
| `beta` | 1.0.0-beta.1 | Feature complete, testing |
| `rc` | 1.0.0-rc.1 | Release candidate |
| `latest` | 1.0.0 | Stable production |

### Integration (`@claude-flow/integration`)

| Component | Description | Performance |
|-----------|-------------|-------------|
| **AgenticFlowBridge** | agentic-flow@alpha integration | ADR-001 compliant |
| **SONA Adapter** | Learning system integration | <0.05ms adaptation |
| **Flash Attention** | Attention mechanism coordinator | 2.49x-7.47x speedup |
| **SDK Bridge** | Version negotiation, API compatibility | Auto-detection |
| **Feature Flags** | Dynamic feature management | 9 configurable flags |
| **Runtime Detection** | NAPI, WASM, JS auto-selection | Optimal performance |

### Integration Runtimes

| Runtime | Performance | Requirements |
|---------|-------------|--------------|
| **NAPI** | Optimal | Native bindings, x64 |
| **WASM** | Good | WebAssembly support |
| **JS** | Fallback | Always available |

### Performance Benchmarking (`@claude-flow/performance`)

| Capability | Description | Output |
|------------|-------------|--------|
| **Statistical Analysis** | Mean, median, P95, P99, stddev | Comprehensive metrics |
| **Memory Tracking** | Heap, RSS, external, array buffers | Resource monitoring |
| **Auto-Calibration** | Automatic iteration adjustment | Statistical significance |
| **Regression Detection** | Baseline comparison | Change detection |
| **V3 Target Validation** | Built-in performance targets | Pass/fail checking |

### V3 Benchmark Targets

| Category | Benchmark | Target |
|----------|-----------|--------|
| **Startup** | CLI cold start | <500ms |
| **Startup** | MCP server init | <400ms |
| **Startup** | Agent spawn | <200ms |
| **Memory** | Vector search | <1ms |
| **Memory** | HNSW indexing | <10ms |
| **Memory** | Memory write | <5ms |
| **Swarm** | Agent coordination | <50ms |
| **Swarm** | Consensus latency | <100ms |
| **Neural** | SONA adaptation | <0.05ms |

### Neural & SONA (`@claude-flow/neural`)

| Feature | Description | Performance |
|---------|-------------|-------------|
| **SONA Learning** | Self-Optimizing Neural Architecture | <0.05ms adaptation |
| **5 Learning Modes** | real-time, balanced, research, edge, batch | Mode-specific optimization |
| **9 RL Algorithms** | PPO, A2C, DQN, Q-Learning, SARSA, Decision Transformer, etc. | Comprehensive RL |
| **LoRA Integration** | Low-Rank Adaptation for efficient fine-tuning | Minimal memory overhead |
| **MicroLoRA** | Ultra-lightweight LoRA for edge/real-time modes | <5MB memory footprint |
| **EWC++ Memory** | Elastic Weight Consolidation prevents catastrophic forgetting | Zero knowledge loss |
| **Trajectory Tracking** | Execution path recording for pattern extraction | Continuous learning |

### Memory & Vector Optimization

| Feature | Description | Improvement |
|---------|-------------|-------------|
| **Scalar Quantization** | Reduce vector precision for memory savings | 4x memory reduction |
| **Product Quantization** | Compress vectors into codebooks | 8-32x memory reduction |
| **HNSW Indexing** | Hierarchical Navigable Small World graphs | 150x-12,500x faster search |
| **LRU Caching** | Intelligent embedding cache with TTL | <1ms cache hits |
| **Batch Processing** | Process multiple embeddings in single call | 10x throughput |
| **Memory Compression** | Pattern distillation and pruning | 50-75% reduction |

### Embedding System (`@claude-flow/embeddings`)

| Feature | Description | Performance |
|---------|-------------|-------------|
| **Multi-Provider** | Agentic-Flow (ONNX), OpenAI, Transformers.js, Mock | 4 providers |
| **Auto-Install** | `claude-flow embeddings init` or `createEmbeddingServiceAsync()` | Zero config |
| **75x Faster** | Agentic-flow ONNX SIMD vs Transformers.js | 3ms vs 230ms |
| **Hyperbolic Space** | Poincaré ball model for hierarchical data | Exponential capacity |
| **Dimensions** | 384 to 3072 configurable | Quality vs speed tradeoff |
| **Similarity Metrics** | Cosine, Euclidean, Dot product, Hyperbolic distance | Task-specific matching |
| **Neural Substrate** | Drift detection, memory physics, swarm coordination | agentic-flow integration |
| **LRU + SQLite Cache** | Persistent cross-session caching | <1ms cache hits |

```bash
# Initialize ONNX embeddings with hyperbolic config
claude-flow embeddings init

# Use larger model for higher quality
claude-flow embeddings init --model all-mpnet-base-v2

# Semantic search
claude-flow embeddings search -q "authentication patterns"
```

### SONA Learning Modes

| Mode | Adaptation | Quality | Memory | Use Case |
|------|------------|---------|--------|----------|
| `real-time` | <0.5ms | 70%+ | 25MB | Production, low-latency |
| `balanced` | <18ms | 75%+ | 50MB | General purpose |
| `research` | <100ms | 95%+ | 100MB | Deep exploration |
| `edge` | <1ms | 80%+ | 5MB | Resource-constrained |
| `batch` | <50ms | 85%+ | 75MB | High-throughput |

### RL Algorithms

| Algorithm | Type | Best For |
|-----------|------|----------|
| **PPO** | Policy Gradient | Stable continuous learning |
| **A2C** | Actor-Critic | Balanced exploration/exploitation |
| **DQN** | Value-based | Discrete action spaces |
| **Q-Learning** | Tabular | Simple state spaces |
| **SARSA** | On-policy | Online learning |
| **Decision Transformer** | Sequence modeling | Long-horizon planning |

### Hive-Mind Coordination

| Feature | Description | Capability |
|---------|-------------|------------|
| **Queen-Led Topology** | Hierarchical command structure | Unlimited agents + sub-workers |
| **Byzantine Consensus** | Fault-tolerant agreement | f < n/3 tolerance |
| **Collective Memory** | Shared pattern storage | Distillation, compression |
| **Specialist Spawning** | Domain-specific agents | Security, performance, etc. |
| **Adaptive Topology** | Dynamic structure changes | Load-based optimization |

### agentic-flow@alpha Integration

| Feature | Description | Benefit |
|---------|-------------|---------|
| **ADR-001 Compliance** | Build on agentic-flow, don't duplicate | Eliminates 10,000+ duplicate lines |
| **Core Foundation** | Use agentic-flow as the base layer | Unified architecture |
| **SONA Integration** | Seamless learning system connection | <0.05ms adaptation |
| **Flash Attention** | Optimized attention mechanisms | 2.49x-7.47x speedup |
| **AgentDB Bridge** | Vector storage integration | 150x-12,500x faster search |
| **Feature Flags** | Dynamic capability management | 9 configurable features |
| **Runtime Detection** | NAPI/WASM/JS auto-selection | Optimal performance per platform |
| **Graceful Fallback** | Works with or without agentic-flow | Always functional |

### MCP Server (`@claude-flow/mcp`)

| Feature | Description | Spec |
|---------|-------------|------|
| **MCP 2025-11-25** | Full specification compliance | Latest MCP standard |
| **Multiple Transports** | stdio, HTTP, WebSocket, in-process | Flexible connectivity |
| **Resources** | list, read, subscribe with caching | Dynamic content |
| **Prompts** | Templates with arguments and embedding | Reusable prompts |
| **Tasks** | Async operations with progress/cancel | Long-running ops |
| **Tool Registry** | O(1) lookup, <10ms registration | Fast tool access |
| **Connection Pooling** | Max 10 connections, configurable | Resource management |
| **Session Management** | Timeout handling, authentication | Secure sessions |

### MCP Methods

| Method | Description |
|--------|-------------|
| `initialize` | Initialize connection |
| `tools/list` | List available tools |
| `tools/call` | Execute a tool |
| `resources/list` | List resources with pagination |
| `resources/read` | Read resource content |
| `resources/subscribe` | Subscribe to updates |
| `prompts/list` | List prompts with pagination |
| `prompts/get` | Get prompt with arguments |
| `tasks/status` | Get task status |
| `tasks/cancel` | Cancel running task |
| `completion/complete` | Auto-complete arguments |

### Security Module (`@claude-flow/security`)

| Feature | CVE/Issue | Description |
|---------|-----------|-------------|
| **Password Hashing** | CVE-2 | Secure bcrypt with 12+ rounds |
| **Credential Generation** | CVE-3 | Cryptographically secure API keys |
| **Safe Command Execution** | HIGH-1 | Allowlist-based command execution |
| **Path Validation** | HIGH-2 | Path traversal and symlink protection |
| **Input Validation** | General | Zod-based schema validation |
| **Token Generation** | General | HMAC-signed secure tokens |
| **HTML Sanitization** | XSS | Script and injection prevention |
| **AIDefence** | Threats | Prompt injection, jailbreak detection, PII scanning (<10ms) |

### Security Validation Schemas

| Schema | Purpose |
|--------|---------|
| `SafeStringSchema` | Basic safe string with length limits |
| `IdentifierSchema` | Alphanumeric identifiers |
| `FilenameSchema` | Safe filenames |
| `EmailSchema` | Email addresses |
| `PasswordSchema` | Secure passwords (8-72 chars) |
| `UUIDSchema` | UUID v4 format |
| `HttpsUrlSchema` | HTTPS URLs only |
| `SpawnAgentSchema` | Agent spawn requests |
| `TaskInputSchema` | Task definitions |

### Hooks System (`@claude-flow/hooks`)

| Component | Description | Performance |
|-----------|-------------|-------------|
| **ReasoningBank** | Pattern storage with HNSW indexing | 150x faster retrieval |
| **GuidanceProvider** | Context-aware development guidance | Real-time suggestions |
| **PatternLearning** | Automatic strategy extraction | Continuous improvement |
| **QualityTracking** | Success/failure rate per pattern | Performance metrics |
| **DomainDetection** | Auto-categorization of patterns | Security, testing, etc. |
| **AgentRouting** | Task-to-agent optimization | Historical performance |
| **Consolidation** | Prune low-quality, promote high-quality | Memory optimization |

### Hook Lifecycle Events

| Phase | Hooks | Purpose |
|-------|-------|---------|
| **Pre-Edit** | `pre-edit` | Context gathering, security checks |
| **Post-Edit** | `post-edit` | Outcome recording, pattern learning |
| **Pre-Command** | `pre-command` | Risk assessment, validation |
| **Post-Command** | `post-command` | Success/failure tracking |
| **Pre-Task** | `pre-task` | Setup, resource allocation |
| **Post-Task** | `post-task` | Cleanup, learning |
| **Session** | `session-end`, `session-restore` | State management |

### V3 Statusline (`@claude-flow/hooks`)

Real-time development status display for Claude Code integration showing DDD progress, swarm activity, security status, and system metrics.

**Output Format:**
```
▊ Claude Flow V3 ● ruvnet  │  ⎇ v3  │  Opus 4.5
─────────────────────────────────────────────────────
🏗️  DDD Domains    [●●●●●]  5/5    ⚡ 1.0x → 2.49x-7.47x
🤖 Swarm  ◉ [58/15]  👥 0    🟢 CVE 3/3    💾 22282MB    📂  47%    🧠  10%
🔧 Architecture    DDD ● 98%  │  Security ●CLEAN  │  Memory ●AgentDB  │  Integration ●
```

| Indicator | Description | Values |
|-----------|-------------|--------|
| `▊ Claude Flow V3` | Project header | Always shown |
| `● ruvnet` | GitHub user (via `gh` CLI) | Dynamic |
| `⎇ v3` | Current git branch | Dynamic |
| `Opus 4.5` | Claude model name | From Claude Code |
| `[●●●●●]` | DDD domain progress bar | 0-5 domains |
| `⚡ 1.0x → 2.49x-7.47x` | Performance speedup target | Current → Target |
| `◉/○` | Swarm coordination status | Active/Inactive |
| `[58/15]` | Active agents / max agents | Process count |
| `👥 0` | Sub-agents spawned | Task tool agents |
| `🟢 CVE 3/3` | Security CVE remediation | Fixed/Total |
| `💾 22282MB` | Memory usage (Node.js processes) | Real-time |
| `📂 47%` | Context window usage | From Claude Code |
| `🧠 10%` | Intelligence score (patterns learned) | 0-100% |
| `DDD ● 98%` | Domain-Driven Design progress | Percentage |
| `Security ●CLEAN` | Security audit status | CLEAN/PENDING/FAILED |
| `Memory ●AgentDB` | Memory backend in use | AgentDB/SQLite/Hybrid |
| `Integration ●` | agentic-flow integration status | Active/Inactive |

**Usage:**
```bash
# V3 statusline (Node.js)
node v3/@claude-flow/hooks/bin/statusline.js

# JSON output for scripting
node v3/@claude-flow/hooks/bin/statusline.js --json

# Compact JSON (single line)
node v3/@claude-flow/hooks/bin/statusline.js --compact

# Help
node v3/@claude-flow/hooks/bin/statusline.js --help
```

**Claude Code Integration:**

Add to `.claude/settings.json`:
```json
{
  "statusLine": {
    "type": "command",
    "command": "node v3/@claude-flow/hooks/bin/statusline.js"
  }
}
```

**Data Sources:**
- `.claude-flow/metrics/v3-progress.json` - DDD domain progress
- `.claude-flow/metrics/swarm-activity.json` - Active agent counts
- `.claude-flow/security/audit-status.json` - CVE remediation status
- `.claude-flow/learning/patterns.db` - Intelligence score (pattern count)
- Process detection via `ps aux` - Real-time memory and agent counts
- Git branch via `git branch --show-current`
- GitHub user via `gh api user`

### Background Daemons

#### V3 Node.js Worker Daemon (Recommended)

Cross-platform TypeScript-based daemon service with auto-scheduling:

| Worker | Interval | Priority | Description |
|--------|----------|----------|-------------|
| `map` | 5min | normal | Codebase structure mapping |
| `audit` | 10min | critical | Security vulnerability scanning |
| `optimize` | 15min | high | Performance optimization |
| `consolidate` | 30min | low | Memory consolidation |
| `testgaps` | 20min | normal | Test coverage analysis |

**Commands:**
```bash
# Start daemon (auto-runs on SessionStart hooks)
npx claude-flow@v3alpha daemon start

# Check status with worker history
npx claude-flow@v3alpha daemon status

# Manually trigger a worker
npx claude-flow@v3alpha daemon trigger map

# Enable/disable workers
npx claude-flow@v3alpha daemon enable map audit optimize

# Stop daemon
npx claude-flow@v3alpha daemon stop
```

**Daemon Status Output:**
```
+-- Worker Daemon ---+
| Status: ● RUNNING  |
| PID: 12345         |
| Workers Enabled: 5 |
| Max Concurrent: 3  |
+--------------------+

Worker Status
+-------------+----+----------+------+---------+----------+----------+
| Worker      | On | Status   | Runs | Success | Last Run | Next Run |
+-------------+----+----------+------+---------+----------+----------+
| map         | ✓  | idle     | 12   | 100%    | 2m ago   | in 3m    |
| audit       | ✓  | idle     | 6    | 100%    | 5m ago   | in 5m    |
| optimize    | ✓  | running  | 4    | 100%    | now      | -        |
| consolidate | ✓  | idle     | 2    | 100%    | 15m ago  | in 15m   |
| testgaps    | ✓  | idle     | 3    | 100%    | 8m ago   | in 12m   |
+-------------+----+----------+------+---------+----------+----------+
```

#### Legacy Shell Daemons (V2)

Shell-based daemons for monitoring (Linux/macOS only):

| Daemon | Interval | Purpose | Output |
|--------|----------|---------|--------|
| **Swarm Monitor** | 3s | Process detection, agent counting | `swarm-activity.json` |
| **Metrics Daemon** | 30s | V3 progress sync, SQLite metrics | `metrics.db` |

**Commands:**
```bash
# Start all daemons
.claude/helpers/daemon-manager.sh start 3 5

# Check daemon status
.claude/helpers/daemon-manager.sh status

# Stop all daemons
.claude/helpers/daemon-manager.sh stop
```

### Worker Manager (7 Scheduled Workers)

| Worker | Interval | Purpose |
|--------|----------|---------|
| `perf` | 5 min | Performance benchmarks |
| `health` | 5 min | Disk, memory, CPU monitoring |
| `patterns` | 15 min | Pattern dedup & pruning |
| `ddd` | 10 min | DDD progress tracking |
| `adr` | 15 min | ADR compliance checking |
| `security` | 30 min | Security vulnerability scans |
| `learning` | 30 min | Learning pattern optimization |

**Commands:**
```bash
# Start worker manager
.claude/helpers/worker-manager.sh start 60

# Force run all workers immediately
.claude/helpers/worker-manager.sh force

# Check worker status
.claude/helpers/worker-manager.sh status
```

</details>

---

<details>
<summary><h2>🎯 Use Cases — Real-world scenarios and how to solve them</h2></summary>

### 👨‍💻 Development & Code Quality

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Code Review** | Get thorough reviews with security, performance, and style checks | `npx claude-flow@v3alpha --agent reviewer --task "Review PR #123"` |
| **Test Generation** | Auto-generate unit, integration, and e2e tests for existing code | `npx claude-flow@v3alpha --agent tester --task "Write tests for auth module"` |
| **Refactoring** | Safely restructure code while maintaining behavior | `npx claude-flow@v3alpha --agent coder --task "Refactor user service to use repository pattern"` |
| **Bug Fixing** | Diagnose and fix bugs with full context analysis | `npx claude-flow@v3alpha --agent coder --task "Fix race condition in checkout flow"` |

### 🔒 Security & Compliance

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Security Audit** | Find vulnerabilities before attackers do | `npx claude-flow@v3alpha --agent security-architect --task "Audit for OWASP Top 10"` |
| **Dependency Scan** | Identify vulnerable packages and suggest upgrades | `npx claude-flow@v3alpha security scan --depth full` |
| **Compliance Check** | Ensure code meets security standards | `npx claude-flow@v3alpha --agent security-architect --task "Check PCI-DSS compliance"` |

### 🐝 Multi-Agent Swarms

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Feature Development** | Coordinate multiple agents on complex features | `npx claude-flow@v3alpha swarm init --topology hierarchical && npx claude-flow@v3alpha task orchestrate "Build user dashboard"` |
| **Large Refactors** | Parallel refactoring across many files without conflicts | `npx claude-flow@v3alpha swarm init --topology mesh --max-agents 8` |
| **Codebase Migration** | Migrate frameworks, languages, or patterns systematically | `npx claude-flow@v3alpha task orchestrate "Migrate from Express to Fastify" --strategy adaptive` |

### 📊 Performance & Optimization

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Performance Profiling** | Find and fix bottlenecks in your application | `npx claude-flow@v3alpha --agent perf-analyzer --task "Profile API endpoints"` |
| **Query Optimization** | Speed up slow database queries | `npx claude-flow@v3alpha hooks route "Optimize database queries"` |
| **Memory Analysis** | Reduce memory usage and fix leaks | `npx claude-flow@v3alpha --agent perf-analyzer --task "Analyze memory usage patterns"` |

### 🔄 GitHub & DevOps

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **PR Management** | Review, approve, and merge PRs efficiently | `npx claude-flow@v3alpha --agent pr-manager --task "Review open PRs"` |
| **Issue Triage** | Categorize, prioritize, and assign issues automatically | `npx claude-flow@v3alpha --agent issue-tracker --task "Triage new issues"` |
| **Release Management** | Coordinate releases with changelogs and versioning | `npx claude-flow@v3alpha --agent release-manager --task "Prepare v2.0 release"` |
| **CI/CD Optimization** | Speed up pipelines and reduce flaky tests | `npx claude-flow@v3alpha --agent cicd-engineer --task "Optimize GitHub Actions workflow"` |

### 📋 Spec-Driven Development

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Generate Specs** | Create complete specifications before coding | `npx claude-flow@v3alpha --agent architect --task "Create ADR for authentication system"` |
| **Validate Implementation** | Ensure code matches specifications | `npx claude-flow@v3alpha hooks progress --detailed` |
| **Track Compliance** | Monitor spec adherence across the team | `npx claude-flow@v3alpha progress sync` |

### 🧠 Learning & Intelligence

| Scenario | What It Solves | How To Do It |
|----------|----------------|--------------|
| **Bootstrap Intelligence** | Train the system on your codebase patterns | `npx claude-flow@v3alpha hooks pretrain --depth deep` |
| **Optimize Routing** | Improve task-to-agent matching over time | `npx claude-flow@v3alpha hooks route "<task>" --include-explanation` |
| **Transfer Learning** | Apply patterns learned from other projects | `npx claude-flow@v3alpha hooks transfer <sourceProject>` |

</details>

---

<details>
<summary><h2>🪝 Self-Learning Hooks Commands (27 Hooks) </h2></summary>


### Core Tool Lifecycle Hooks
```bash
# Before/after file editing
npx claude-flow@v3alpha hooks pre-edit <filePath>
npx claude-flow@v3alpha hooks post-edit <filePath> --success true --train-patterns

# Before/after commands
npx claude-flow@v3alpha hooks pre-command "<command>"
npx claude-flow@v3alpha hooks post-command "<command>" --success true

# Before/after tasks
npx claude-flow@v3alpha hooks pre-task --description "<task>"
npx claude-flow@v3alpha hooks post-task --task-id "<id>" --success true
```

### Intelligence & Routing Hooks
```bash
# Route task to optimal agent using learned patterns
npx claude-flow@v3alpha hooks route "<task description>" --include-explanation

# Explain routing decision with transparency
npx claude-flow@v3alpha hooks explain "<topic>" --depth comprehensive

# Bootstrap intelligence from repository
npx claude-flow@v3alpha hooks pretrain --model-type moe --epochs 10

# Generate optimized agent configs from pretrain data
npx claude-flow@v3alpha hooks build-agents --agent-types coder,tester --config-format yaml

# Transfer patterns from another project
npx claude-flow@v3alpha hooks transfer <sourceProject>

# Initialize hooks system
npx claude-flow@v3alpha hooks init

# View learning metrics dashboard
npx claude-flow@v3alpha hooks metrics

# List all registered hooks
npx claude-flow@v3alpha hooks list
```

### Session Management Hooks
```bash
# Start session with context loading
npx claude-flow@v3alpha hooks session-start --session-id "<id>" --load-context

# End session with persistence
npx claude-flow@v3alpha hooks session-end --export-metrics true --persist-patterns

# Restore previous session context
npx claude-flow@v3alpha hooks session-restore --session-id "<id>"

# Send notifications to swarm
npx claude-flow@v3alpha hooks notify --message "<message>" --swarm-status
```

### RuVector Intelligence Hooks (Reinforcement Learning)
```bash
# Trajectory-based learning (4-step pipeline: RETRIEVE, JUDGE, DISTILL, CONSOLIDATE)
npx claude-flow@v3alpha hooks intelligence trajectory-start --session "<session>"
npx claude-flow@v3alpha hooks intelligence trajectory-step --action "<action>" --reward 0.9
npx claude-flow@v3alpha hooks intelligence trajectory-end --verdict success

# Pattern storage with HNSW indexing (150x faster search)
npx claude-flow@v3alpha hooks intelligence pattern-store --pattern "<pattern>" --embedding "[...]"
npx claude-flow@v3alpha hooks intelligence pattern-search --query "<query>" --limit 10

# Learning stats and attention focus
npx claude-flow@v3alpha hooks intelligence stats
npx claude-flow@v3alpha hooks intelligence learn --experience '{"type":"success"}'
npx claude-flow@v3alpha hooks intelligence attention --focus "<task>"

# Full intelligence system (SONA, MoE, HNSW, EWC++, Flash Attention)
npx claude-flow@v3alpha hooks intelligence
npx claude-flow@v3alpha hooks intelligence reset --confirm

# ═══════════════════════════════════════════════════════════════
# Background Worker Commands (12 workers for analysis/optimization)
# ═══════════════════════════════════════════════════════════════

# List all available workers
npx claude-flow@v3alpha hooks worker list

# Detect triggers from prompt text
npx claude-flow@v3alpha hooks worker detect --prompt "optimize performance"

# Auto-dispatch workers when triggers match (confidence ≥0.6)
npx claude-flow@v3alpha hooks worker detect --prompt "deep dive into auth" --auto-dispatch --min-confidence 0.6

# Manually dispatch a worker (ultralearn, optimize, audit, map, deepdive, document, refactor, benchmark, testgaps, etc.)
npx claude-flow@v3alpha hooks worker dispatch --trigger refactor --context "auth module"

# Check worker status
npx claude-flow@v3alpha hooks worker status

# Cancel a running worker
npx claude-flow@v3alpha hooks worker cancel --id worker_refactor_1_abc123
```

### Progress Tracking Hooks
```bash
# Check V3 implementation progress
npx claude-flow@v3alpha hooks progress

# Detailed breakdown by category (CLI, MCP, Hooks, Packages, DDD)
npx claude-flow@v3alpha hooks progress --detailed

# Sync progress and persist to file
npx claude-flow@v3alpha hooks progress --sync

# Get human-readable summary
npx claude-flow@v3alpha hooks progress --summary

# JSON output for scripting
npx claude-flow@v3alpha progress --json
```

</details>

---

<details>
<summary><h2>🏗️ Architecture </h2></summary>


### V3 Module Structure

```
v3/
├── @claude-flow/hooks      # Event-driven lifecycle hooks + ReasoningBank
├── @claude-flow/memory     # AgentDB unification module
├── @claude-flow/security   # CVE remediation & patterns
├── @claude-flow/swarm      # 15-agent coordination
├── @claude-flow/plugins    # RuVector WASM plugins
├── @claude-flow/cli        # CLI modernization
├── @claude-flow/neural     # SONA learning integration
├── @claude-flow/testing    # TDD London School framework
├── @claude-flow/deployment # Release & CI/CD
└── @claude-flow/shared     # Shared utilities & types
```
 
### Performance Metrics

| Metric | Measured |
|--------|----------|
| Swarm task execution | 100% success rate (7/7 strategies) |
| Average task duration | 0.15-0.30 seconds |
| Memory usage per agent | 128-320 MB |
| CPU utilization | 15-30% per agent |
| Parallel agent capacity | Unlimited (resource-dependent) |

### Topology Performance

| Topology | Agents | Execution Time | Memory |
|----------|--------|----------------|--------|
| Centralized | 2-3 | 0.14-0.20s | 180-256 MB |
| Distributed | 4-5 | 0.10-0.12s | 128-160 MB |
| Hierarchical | 6 | 0.20s | 256 MB |
| Mesh | 4 | 0.15s | 192 MB |
| Hybrid | 7 | 0.18s | 320 MB |

</details>

---

<details>
<summary><h2>💻 Cross-Platform Support </h2></summary>


### Windows (PowerShell)

```powershell
npx @claude-flow/security@latest audit --platform windows
$env:CLAUDE_FLOW_MODE = "integration"
```

### macOS (Bash/Zsh)

```bash
npx @claude-flow/security@latest audit --platform darwin
export CLAUDE_FLOW_SECURITY_MODE="strict"
```

### Linux (Bash)

```bash
npx @claude-flow/security@latest audit --platform linux
export CLAUDE_FLOW_MEMORY_PATH="./data"
```

</details>

---

<details>
<summary><h2>⚙️ Environment Variables </h2></summary>


| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_FLOW_MODE` | Operation mode (`development`, `production`, `integration`) | `development` |
| `CLAUDE_FLOW_MEMORY_PATH` | Directory for persistent memory storage | `./data` |
| `CLAUDE_FLOW_SECURITY_MODE` | Security level (`strict`, `standard`, `permissive`) | `standard` |
| `CLAUDE_FLOW_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) | `info` |
| `CLAUDE_FLOW_MAX_AGENTS` | Default concurrent agent limit (increase for more parallelism) | `15` |
| `CLAUDE_FLOW_TOPOLOGY` | Default swarm topology | `hierarchical` |
| `CLAUDE_FLOW_HNSW_M` | HNSW index M parameter (connectivity) | `16` |
| `CLAUDE_FLOW_HNSW_EF` | HNSW search ef parameter (accuracy) | `200` |
| `CLAUDE_FLOW_EMBEDDING_DIM` | Vector embedding dimensions | `384` |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude integration | - |

</details>

---

<details>
<summary><h2>🔧 Troubleshooting </h2></summary>


### Common Issues

**MCP server won't start**
```bash
# Check if port is in use
lsof -i :3000
# Kill existing process
kill -9 <PID>
# Restart MCP server
npx claude-flow@v3alpha mcp start
```

**Agent spawn failures**
```bash
# Check available memory
free -m
# Reduce max agents if memory constrained
export CLAUDE_FLOW_MAX_AGENTS=5
```

**Pattern search returning no results**
```bash
# Verify patterns are stored
npx claude-flow@v3alpha hooks metrics
# Re-run pretraining if empty
npx claude-flow@v3alpha hooks pretrain
```

**Windows path issues**
```powershell
# Use forward slashes or escape backslashes
$env:CLAUDE_FLOW_MEMORY_PATH = "./data"
# Or use absolute path
$env:CLAUDE_FLOW_MEMORY_PATH = "C:/Users/name/claude-flow/data"
```

**Permission denied errors**
```bash
# Fix npm permissions (Linux/macOS)
sudo chown -R $(whoami) ~/.npm
# Or use nvm to manage Node.js
```

**High memory usage**
```bash
# Enable garbage collection
node --expose-gc node_modules/.bin/claude-flow
# Reduce HNSW parameters for lower memory
export CLAUDE_FLOW_HNSW_M=8
export CLAUDE_FLOW_HNSW_EF=100
```

</details>

---

<details>
<summary><h2>🔄 Migration Guide (V2 → V3) </h2></summary>


### Breaking Changes

1. **Module Structure**: V3 uses scoped packages (`@claude-flow/*`)
2. **Memory Backend**: Default changed from JSON to AgentDB with HNSW
3. **Hooks System**: New ReasoningBank replaces basic pattern storage
4. **Security**: Stricter input validation enabled by default

### Upgrade Steps

```bash
# 1. Backup existing data
cp -r ./data ./data-backup-v2

# 2. Update to V3
npm install claude-flow@latest

# 3. Run migration
npx claude-flow@v3alpha migrate --from v2

# 4. Verify installation
npx claude-flow@v3alpha --version
npx claude-flow@v3alpha hooks metrics
```

### Configuration Changes

```bash
# V2 (deprecated)
npx claude-flow init --mode basic

# V3 (new)
npx claude-flow@v3alpha init
npx claude-flow@v3alpha hooks pretrain  # Bootstrap learning
```

### API Changes

| V2 API | V3 API |
|--------|--------|
| `claude-flow start` | `claude-flow mcp start` |
| `--pattern-store` | `--memory-backend agentdb` |
| `hooks record` | `hooks post-edit --success` |
| `swarm create` | `swarm init --topology` |

</details>

---

<details>
<summary><h2>📚 Documentation </h2></summary>


### V3 Module Documentation

| Module | Description | Docs |
|--------|-------------|------|
| `@claude-flow/plugins` | Plugin SDK with workers, hooks, providers, security | [README](./v3/@claude-flow/plugins/README.md) |
| `@claude-flow/hooks` | Event-driven lifecycle hooks + ReasoningBank | [Source](./v3/@claude-flow/hooks/) |
| `@claude-flow/memory` | AgentDB unification with HNSW indexing | [Source](./v3/@claude-flow/memory/) |
| `@claude-flow/security` | CVE remediation & security patterns | [Source](./v3/@claude-flow/security/) |
| `@claude-flow/swarm` | 15-agent coordination engine | [Source](./v3/@claude-flow/swarm/) |
| `@claude-flow/cli` | CLI modernization | [Source](./v3/@claude-flow/cli/) |
| `@claude-flow/neural` | SONA learning integration | [Source](./v3/@claude-flow/neural/) |
| `@claude-flow/testing` | TDD London School framework | [Source](./v3/@claude-flow/testing/) |
| `@claude-flow/mcp` | MCP server & tools | [Source](./v3/@claude-flow/mcp/) |
| `@claude-flow/embeddings` | Vector embedding providers | [Source](./v3/@claude-flow/embeddings/) |
| `@claude-flow/providers` | LLM provider integrations | [Source](./v3/@claude-flow/providers/) |
| `@claude-flow/integration` | agentic-flow@alpha integration | [Source](./v3/@claude-flow/integration/) |
| `@claude-flow/performance` | Benchmarking & optimization | [Source](./v3/@claude-flow/performance/) |
| `@claude-flow/deployment` | Release & CI/CD | [Source](./v3/@claude-flow/deployment/) |
| `@claude-flow/shared` | Shared utilities, types & V3ProgressService | [Source](./v3/@claude-flow/shared/) |

### Additional Resources

- [V2 Documentation](./v2/README.md)
- [Architecture Decisions (ADRs)](./v3/docs/adr/)
- [API Reference](./v2/docs/technical/)
- [Examples](./v2/examples/)

</details>

## Support

- Documentation: https://github.com/ruvnet/claude-flow
- Issues: https://github.com/ruvnet/claude-flow/issues
- Discord: [Agentics Foundation](https://discord.com/invite/dfxmpwkG2D)

## License

MIT - [RuvNet](https://github.com/ruvnet)
