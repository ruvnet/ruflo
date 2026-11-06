---
title: Ruflo vs CrewAI, LangGraph, AutoGen and Claude Code subagents
description: How Ruflo compares with Claude Code's built-in subagents, CrewAI, LangGraph and AutoGen, and when to pick each.
---

# Ruflo compared with other multi-agent tools

Ruflo answers one question: how do you get Claude Code and Codex agents that coordinate, remember across sessions, and get better over time, without writing your own agent runtime? It installs into your project and runs inside your Claude Code or Codex session, through MCP tools and hooks.

The other tools below answer different questions. CrewAI, LangGraph and AutoGen are libraries for building your own agent applications, where your code calls the model. Claude Code's subagents are a built-in feature of Claude Code itself.

## At a glance

| | Ruflo | Claude Code subagents | CrewAI | LangGraph | AutoGen |
|---|---|---|---|---|---|
| **What it is** | Agent harness for Claude Code and Codex | Built-in Claude Code feature: specialized assistants with their own context | Python framework for crews of collaborating agents | Low-level orchestration library for stateful agent graphs | Multi-agent conversation framework (archived; Microsoft points to Microsoft Agent Framework as its successor) |
| **Language** | TypeScript, Node.js CLI and MCP server | Configured as Markdown files with frontmatter | Python | Python (JavaScript version also available) | Python |
| **Where agents run** | Inside your Claude Code or Codex session | Inside your Claude Code session | In your own application, which calls the model | In your own application, which calls the model | In your own application, which calls the model |
| **Models** | The models your Claude Code or Codex session uses | Claude; the main conversation's model by default, overridable per subagent | Configurable | Configurable | Configurable |
| **Memory across sessions** | Project memory database with vector search (AgentDB) | Optional per-subagent `memory` field (user, project or local scope) | Built-in memory component | Checkpointed thread state and long-term memory store | — |
| **Get started** | `npx ruflo@latest init` | Add an agent file under `.claude/agents/` | `uv tool install crewai` | `pip install -U langgraph` | `pip install -U "autogen-agentchat" "autogen-ext[openai]"` |

"—" means we couldn't confirm it from the project's own documentation.

## When to pick which

- **You already work in Claude Code or Codex and want a team of agents, shared memory, hooks and swarms there:** Ruflo.
- **You want one or two focused helpers in Claude Code with nothing to install:** Claude Code subagents. Ruflo also works alongside them.
- **You're building your own Python application and want role-based crews:** CrewAI.
- **You need fine-grained control over agent state and control flow, with durable execution:** LangGraph.
- **You're on AutoGen today:** Microsoft recommends moving to Microsoft Agent Framework for new work.

## Sources

Checked 2026-11-06.

- Claude Code subagents: <https://code.claude.com/docs/en/sub-agents>
- CrewAI: <https://docs.crewai.com>, <https://github.com/crewAIInc/crewAI>
- LangGraph: <https://docs.langchain.com/oss/python/langgraph/>, <https://github.com/langchain-ai/langgraph>
- AutoGen (repository, archive notice and install command): <https://github.com/microsoft/autogen>
- Ruflo: [README](https://github.com/ruvnet/ruflo#readme)
