# PRD: Beads Integration for Claude-Flow V3

## Overview

This document outlines the integration of [Beads](https://github.com/steveyegge/beads) - a git-backed task tracker for AI agents - into Claude-Flow V3. Beads provides persistent memory and task management that survives across sessions, solving the critical problem of context loss in long-running agent workflows.

## Problem Statement

AI agents suffer from volatile context - when sessions end, compress, or reset, task state disappears. This creates several issues:

1. **Context Loss**: Agents lose track of where they were in multi-step tasks
2. **Work Discovery Gap**: No persistent record of discovered issues or dependencies
3. **Team Coordination**: Multiple agents can't share task state effectively
4. **Session Resumability**: Cannot resume complex tasks after interruption

## Solution: Beads Integration

Beads solves these problems by:
- Storing tasks as JSON files in `.beads/` directory (git-versioned)
- Using SQLite for fast querying with JSONL formatting
- Supporting two-way synchronization for real-time updates
- Providing dependency tracking to map task relationships

## Architecture

### Integration Points

```
┌─────────────────────────────────────────────────────────────────┐
│                      Claude-Flow V3                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   CLI       │    │   Hooks     │    │   Agents    │         │
│  │ beads *     │    │ pre/post-*  │    │ beads-aware │         │
│  └─────┬───────┘    └─────┬───────┘    └─────┬───────┘         │
│        │                  │                  │                  │
│        └──────────────────┼──────────────────┘                  │
│                           ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              BeadsMemoryAdapter                          │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │   │
│  │  │ TaskSync │  │  Events  │  │ DependencyResolver   │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────────┘   │   │
│  └─────────────────────────┬───────────────────────────────┘   │
│                            │                                    │
├────────────────────────────┼────────────────────────────────────┤
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Beads (@beads/bd)                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │   │
│  │  │  .beads/ │  │  SQLite  │  │     Git Sync         │   │   │
│  │  │   JSON   │  │   DB     │  │     (versioned)      │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Responsibility |
|-----------|----------------|
| `BeadsMemoryAdapter` | Bridge between Claude-Flow memory and Beads SQLite |
| `BeadsCLI` | CLI commands for beads operations (`beads init`, `beads status`, etc.) |
| `BeadsHooks` | Pre/post task hooks for automatic state sync |
| `BeadsAgentTypes` | Agent definitions that understand beads structure |
| `BeadsDependencyResolver` | Resolve task dependencies for execution ordering |

## Detailed Design

### 1. BeadsMemoryAdapter

The adapter synchronizes Claude-Flow's memory system with Beads' SQLite database.

```typescript
interface BeadsMemoryAdapter {
  // Core sync
  syncFromBeads(): Promise<void>;
  syncToBeads(): Promise<void>;

  // Task operations
  createTask(epic: string, task: BeadsTask): Promise<string>;
  updateTask(id: string, update: BeadsTaskUpdate): Promise<void>;
  closeTask(id: string, reason: string): Promise<void>;

  // Query operations
  getEpicStatus(epicId: string): Promise<EpicStatus>;
  getReadyTasks(epicId?: string): Promise<BeadsTask[]>;
  getBlockedTasks(epicId?: string): Promise<BeadsTask[]>;

  // Dependency resolution
  resolveDependencies(taskId: string): Promise<string[]>;
  getExecutionOrder(epicId: string): Promise<string[]>;
}
```

### 2. CLI Commands

New CLI commands under `claude-flow beads`:

| Command | Description |
|---------|-------------|
| `beads init` | Initialize beads in current project |
| `beads status [epic-id]` | Show epic/task status |
| `beads ready [--parent=<id>]` | List ready (unblocked) tasks |
| `beads blocked [--parent=<id>]` | List blocked tasks with reasons |
| `beads create <title>` | Create new task |
| `beads close <id> --reason="..."` | Close a task |
| `beads sync` | Sync beads state with claude-flow memory |
| `beads epic create <title>` | Create new epic |
| `beads epic status <id>` | Show epic completion status |
| `beads import <file>` | Import tasks from plan file |

### 3. Hooks Integration

New hooks for beads-aware workflow:

| Hook | Trigger | Action |
|------|---------|--------|
| `beads-pre-task` | Before task execution | Load task context, check dependencies |
| `beads-post-task` | After task completion | Update status, sync changes |
| `beads-on-block` | When task blocked | Notify, suggest alternatives |
| `beads-on-complete` | Epic completion | Generate summary, cleanup |

### 4. Agent Types

New beads-aware agent definitions:

| Agent | Responsibility |
|-------|----------------|
| `beads-coordinator` | Orchestrate epic execution, manage task flow |
| `beads-planner` | Convert design docs to beads epics/tasks |
| `beads-executor` | Execute individual tasks with beads context |
| `beads-reviewer` | Two-stage review (spec compliance + code quality) |

### 5. Task Structure

Beads tasks have three key fields:

```typescript
interface BeadsTask {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'review' | 'closed';

  // Implementation mechanics
  description: string; // Steps, snippets, file paths, commands

  // Architectural context
  design: string; // Goals, decisions, data flow, constraints

  // Reference fallback
  notes: string; // Source document paths with line numbers

  // Dependencies
  dependsOn: string[]; // Task IDs this depends on
  blockedBy: string[]; // Computed blocked-by list

  // Metadata
  epic?: string;
  assignee?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  closeReason?: string;
}
```

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)
- [ ] Create `BeadsMemoryAdapter` class
- [ ] Implement SQLite connection to beads database
- [ ] Add basic CRUD operations for tasks
- [ ] Create adapter factory and configuration

### Phase 2: CLI Integration
- [ ] Add `beads` command group to CLI
- [ ] Implement `beads init` command
- [ ] Implement `beads status` command
- [ ] Implement `beads ready/blocked` commands
- [ ] Implement `beads sync` command
- [ ] Implement `beads epic *` commands

### Phase 3: Hooks System
- [ ] Create `beads-pre-task` hook
- [ ] Create `beads-post-task` hook
- [ ] Create `beads-on-block` hook
- [ ] Create `beads-on-complete` hook
- [ ] Integrate with existing hooks system

### Phase 4: Agent Types
- [ ] Create `beads-coordinator` agent definition
- [ ] Create `beads-planner` agent definition
- [ ] Create `beads-executor` agent definition
- [ ] Create `beads-reviewer` agent definition
- [ ] Add agent YAML configurations

### Phase 5: Advanced Features
- [ ] Two-way sync with beads-ui
- [ ] Dependency graph visualization
- [ ] Epic import from markdown plans
- [ ] Integration with GitHub issues
- [ ] Performance optimization

### Phase 6: Testing & Documentation
- [ ] Unit tests for BeadsMemoryAdapter
- [ ] Integration tests for CLI commands
- [ ] Hook execution tests
- [ ] Agent workflow tests
- [ ] API documentation
- [ ] User guide

## Success Criteria

1. **Session Persistence**: Agent state survives session termination
2. **Task Continuity**: `continue epic <id>` resumes from exact stopping point
3. **Work Discovery**: Agents autonomously discover and file issues
4. **Team Sync**: Multiple agents share coherent task state
5. **Git Integration**: All task state is version-controlled

## Performance Targets

| Metric | Target |
|--------|--------|
| Task sync latency | <100ms |
| Epic status query | <50ms |
| Dependency resolution | <20ms |
| Memory overhead | <10MB |

## Dependencies

- `@beads/bd` - Beads CLI and SQLite database
- `better-sqlite3` or `sql.js` - SQLite driver
- Existing Claude-Flow memory system
- Existing hooks infrastructure

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Beads API changes | Pin version, adapter abstraction |
| SQLite conflicts | WAL mode, proper locking |
| Large epic performance | Pagination, lazy loading |
| Git merge conflicts | JSON structure designed for mergeability |

## References

- [Beads GitHub](https://github.com/steveyegge/beads)
- [Solving Agent Context Loss](https://jx0.ca/solving-agent-context-loss/)
- [Claude-Flow Memory System](../v3/@claude-flow/memory/)
- [Introducing Beads](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a)

## Sources

- [Solving Agent Context Loss: A Beads + Claude Code Workflow](https://jx0.ca/solving-agent-context-loss/)
- [Claude Code Memory Upgrade Using Beads](https://www.geeky-gadgets.com/claude-project-memory-for-agents/)
- [Introducing Beads on Medium](https://steve-yegge.medium.com/introducing-beads-a-coding-agent-memory-system-637d7d92514a)
