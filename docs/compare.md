---
title: Ruflo vs CrewAI, LangGraph, AutoGen and Claude Code
description: Compare Ruflo with other multi-agent frameworks and Claude Code's built-in agents.
---

# Comparing multi-agent frameworks

Ruflo is one answer to a specific question: _How do you give Claude Code and Codex agents that coordinate, remember, and improve over time?_ Below is how it stacks up against other platforms and approaches.

## Comparison table

| What it is | Ruflo | Claude Code (built-in) | CrewAI | LangGraph | AutoGen |
|---|---|---|---|---|---|
| **Framework type** | Agent meta-harness for Claude Code/Codex | Integrated multi-agent system in Claude Code editor | Framework for collaborative agents and crews | Graph-based orchestration runtime | Multi-agent conversation framework |
| **Language/runtime** | TypeScript (runs in Claude Code or via MCP) | TypeScript/Node.js (inside Claude Code) | Python | Python | Python (+ .NET variant) |
| **How agents run** | Hierarchical swarms via MCP with SendMessage comms | Built-in types (Explore, Plan, General-purpose) + custom via Agent tool | Collaborative tasks through sequential/hierarchical/hybrid processes | Graph nodes + edges with state transitions | Multi-agent conversations with customizable agents |
| **Your own LLM calls?** | No, integrated with Claude/Codex | No, integrated with Claude | Yes, configure your own | Yes, configure your own | Yes, configure your own |
| **Persistent memory** | AgentDB + HNSW vector search, cross-session | Claude Code memory system | Yes, memory component included | Thread state + session memory, checkpointing | — |
| **Install** | `npx ruflo@latest init` | Built into Claude Code 2.1.287+ | `uv` package manager | `pip install langgraph` or `uv add` | `pip install autogen-agentchat~=0.2` |

## When to pick which

| Your situation | Pick |
|---|---|
| You write code in Claude Code and want agents to coordinate within your project | **Ruflo** or **Claude Code built-in** |
| You need agents to call your own LLMs or manage costs | **CrewAI**, **LangGraph**, or **AutoGen** |
| You want a lightweight graph-based workflow without agents | **LangGraph** |
| You're building in Python and want multi-agent conversations | **AutoGen** |
| You want memory and agents with minimal setup | **Ruflo** (in Claude Code) or **Claude Code built-in** |

## Sources

- [CrewAI Framework Documentation](https://docs.crewai.com)
- [LangGraph Documentation](https://docs.langchain.com/oss/python/langgraph/)
- [AutoGen Documentation](https://microsoft.github.io/autogen/0.2/docs/Getting-Started/)
- [Claude Code Documentation](https://code.claude.com/docs/en/sub-agents)
- [Ruflo GitHub](https://github.com/ruvnet/ruflo)
