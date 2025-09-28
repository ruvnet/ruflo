# MCP Tools Reference Documentation

This directory contains comprehensive documentation for Model Context Protocol (MCP) tools used in the Claude-Flow multi-agent orchestration framework.

## Directory Structure

- `categories/` - Categorized MCP tools by functionality
- `requirements/` - Extracted requirements and specifications
- `specifications/` - Detailed tool specifications
- `steering/` - Steering documentation for multi-agent orchestration

## Overview

The Claude-Flow framework provides 70+ MCP tools across multiple categories for orchestrating multi-agent workflows. These tools enable:

- **Coordination**: Swarm initialization, agent spawning, task orchestration
- **Monitoring**: Status tracking, metrics collection, performance analysis
- **Memory Management**: Cross-session memory, neural pattern training
- **GitHub Integration**: Repository analysis, PR management, issue tracking
- **System Operations**: Benchmarking, feature detection, monitoring

## Key Principles

1. **MCP Tools Coordinate**: Set up topology, define patterns, orchestrate workflows
2. **Claude Code Executes**: Spawn real agents, perform actual work
3. **Concurrent Execution**: All operations batched in single messages
4. **Memory-Driven**: Cross-session context and neural pattern learning

## Quick Start

```bash
# Add MCP servers
claude mcp add claude-flow npx claude-flow@alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional
```

## Documentation Index

- [Tool Categories](categories/README.md) - Complete categorization of all MCP tools
- [Requirements](requirements/README.md) - Extracted requirements and specifications
- [Specifications](specifications/README.md) - Detailed tool specifications
- [Steering Guide](steering/README.md) - Multi-agent orchestration guidance