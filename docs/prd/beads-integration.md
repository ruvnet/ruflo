# PRD: Beads Integration for Claude-Flow

## Product Requirements Document
**Version:** 1.0.0
**Date:** January 23, 2026
**Author:** Claude (AI-Generated for shaalofer@gmail.com)
**Methodology:** SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) with TDD

---

## Executive Summary

This PRD outlines the integration of Steve Yegge's **Beads** issue tracking system into **Claude-Flow**, creating a unified platform that combines Beads' human-readable, git-backed task management with Claude-Flow's powerful multi-agent orchestration, memory systems, and SPARC development methodology.

### Why This Integration?

| Current Gap | Solution |
|-------------|----------|
| Claude-Flow tasks are in SQLite (binary, not git-friendly) | Beads provides git-backed JSONL storage |
| No simple `list` command to see blocked vs ready tasks | Beads' `bd ready`, `bd blocked`, `bd list` |
| Team sharing requires GitHub releases | Beads shares via standard git push/pull |
| Dependencies are implicit in workflow JSON | Beads has explicit 4-type dependency graph |
| No human-readable task audit trail | Beads stores full audit history in JSONL |

---

# Phase 1: SPECIFICATION

## 1.1 Problem Statement

Claude-Flow provides excellent multi-agent orchestration but lacks a human-readable, team-shareable task tracking system. Users must choose between:
- **Claude-Flow**: Great AI orchestration, poor task visibility
- **Beads**: Great task visibility, no agent orchestration

This integration eliminates that tradeoff.

## 1.2 Goals

### Primary Goals
1. **G1**: Native Beads CLI integration via MCP tools
2. **G2**: Two-way sync between Beads issues and Claude-Flow memory/tasks
3. **G3**: Agent-driven task management (agents file/query/update Beads issues)
4. **G4**: Human-readable task visibility via `bd` CLI within Claude-Flow workflows

### Secondary Goals
1. **G5**: Automatic issue creation from SPARC phase outputs
2. **G6**: Hive-mind coordination using Beads as shared task queue
3. **G7**: ReasoningBank pattern storage linked to Beads issues

## 1.3 Non-Goals (Out of Scope for v1.0)
- Replacing Claude-Flow's internal task table entirely
- Building a custom UI (use existing beads-ui, bdui, perles)
- Multi-repo Beads synchronization (future feature)
- Real-time Agent Mail integration (future feature)

## 1.4 User Stories

### US-1: Developer Task Visibility
> As a developer using Claude-Flow, I want to run `bd list` or `bd ready` to see what tasks are pending and what's blocked, so I can understand project status without digging through SQLite.

**Acceptance Criteria:**
- [ ] `bd` commands work from Claude-Flow project root
- [ ] Tasks created by agents appear in `bd list`
- [ ] Dependency blocking is accurate
- [ ] Status syncs within 5 seconds of changes

### US-2: Team Collaboration
> As a team lead, I want my team to see the same task list via git, so we can collaborate without sharing database files.

**Acceptance Criteria:**
- [ ] `git pull` brings new issues from teammates
- [ ] `git push` shares local issue changes
- [ ] No merge conflicts on concurrent edits (hash IDs)
- [ ] Works with protected branches via sync branch

### US-3: Agent-Driven Issue Management
> As an AI agent in Claude-Flow, I want to file issues when I discover bugs or remaining work, so nothing gets lost between sessions.

**Acceptance Criteria:**
- [ ] MCP tool `beads_create` available to agents
- [ ] MCP tool `beads_ready` returns unblocked work
- [ ] MCP tool `beads_update` changes issue status
- [ ] MCP tool `beads_dep_add` creates dependencies
- [ ] JSON output for all tools

### US-4: SPARC Phase Integration
> As a developer using SPARC methodology, I want each phase to automatically create Beads issues for remaining work, so I have a clear backlog after specification.

**Acceptance Criteria:**
- [ ] Specification phase creates epic + child tasks
- [ ] Architecture phase creates design decision issues
- [ ] TDD phase creates test coverage issues
- [ ] Issues link via `discovered-from` dependency type

### US-5: Memory-Task Linking
> As a developer, I want Claude-Flow's memory entries linked to Beads issues, so I can trace why certain patterns were learned.

**Acceptance Criteria:**
- [ ] Memory entries can reference Beads issue IDs
- [ ] `bd show <id>` displays linked memory keys
- [ ] ReasoningBank patterns store originating issue

## 1.5 Functional Requirements

### FR-1: Beads CLI Installation & Detection
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Detect if `bd` is installed during `claude-flow init` | P0 |
| FR-1.2 | Auto-install Beads via npm if missing (with user consent) | P1 |
| FR-1.3 | Initialize Beads (`bd init --quiet`) on new projects | P0 |
| FR-1.4 | Support `bd init --stealth` for non-intrusive use | P2 |

### FR-2: MCP Tool Integration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | `mcp__beads__create` - Create issue with all options | P0 |
| FR-2.2 | `mcp__beads__list` - List issues with filters | P0 |
| FR-2.3 | `mcp__beads__ready` - Get unblocked work | P0 |
| FR-2.4 | `mcp__beads__show` - Get issue details | P0 |
| FR-2.5 | `mcp__beads__update` - Update issue fields | P0 |
| FR-2.6 | `mcp__beads__close` - Close issue with reason | P0 |
| FR-2.7 | `mcp__beads__dep_add` - Add dependency link | P1 |
| FR-2.8 | `mcp__beads__dep_tree` - Show dependency tree | P1 |
| FR-2.9 | `mcp__beads__blocked` - List blocked issues | P1 |
| FR-2.10 | `mcp__beads__stats` - Get issue statistics | P2 |
| FR-2.11 | `mcp__beads__sync` - Force git sync | P2 |

### FR-3: Memory Integration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Store Beads issue ID in memory entry metadata | P1 |
| FR-3.2 | Query memories by linked issue ID | P1 |
| FR-3.3 | Auto-link patterns learned during issue work | P2 |
| FR-3.4 | Export memory-issue relationships | P2 |

### FR-4: SPARC Integration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Specification phase creates epic from requirements | P1 |
| FR-4.2 | Pseudocode phase creates algorithm design issues | P2 |
| FR-4.3 | Architecture phase creates component issues | P1 |
| FR-4.4 | TDD phase creates test coverage issues | P1 |
| FR-4.5 | Completion phase closes related issues | P1 |

### FR-5: Hooks Integration
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | `pre-task` hook queries Beads for context | P1 |
| FR-5.2 | `post-task` hook updates/closes Beads issues | P1 |
| FR-5.3 | `session-end` hook creates issues for remaining work | P0 |
| FR-5.4 | `session-start` hook shows ready work | P1 |

## 1.6 Non-Functional Requirements

### NFR-1: Performance
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1.1 | MCP tool response time | < 200ms |
| NFR-1.2 | Issue creation latency | < 500ms |
| NFR-1.3 | List query with 1000 issues | < 1s |
| NFR-1.4 | Dependency tree traversal | < 2s |

### NFR-2: Reliability
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.1 | No data loss on crash | 100% |
| NFR-2.2 | Git sync success rate | > 99% |
| NFR-2.3 | Merge conflict auto-resolution | > 95% |

### NFR-3: Compatibility
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-3.1 | Beads version support | v0.20.1+ |
| NFR-3.2 | Claude-Flow version | v2.7.0+ |
| NFR-3.3 | Node.js version | 18+ |
| NFR-3.4 | Platform support | Linux, macOS, Windows |

---

# Phase 2: PSEUDOCODE

## 2.1 Core Integration Logic

```pseudocode
// ============================================
// BEADS INTEGRATION MODULE
// ============================================

MODULE BeadsIntegration:

  // Configuration
  CONFIG:
    beads_binary: "bd"
    auto_init: true
    sync_interval: 5000ms
    json_output: true

  // ============================================
  // INITIALIZATION
  // ============================================

  FUNCTION initialize():
    IF NOT beads_installed():
      prompt_user("Beads not found. Install? [Y/n]")
      IF user_confirms:
        run("npm install -g @beads/bd")

    IF NOT beads_initialized():
      run("bd init --quiet")

    register_mcp_tools()
    setup_hooks()
    RETURN success

  FUNCTION beads_installed() -> boolean:
    RETURN shell_command("which bd").exit_code == 0

  FUNCTION beads_initialized() -> boolean:
    RETURN file_exists(".beads/beads.jsonl")

  // ============================================
  // MCP TOOL HANDLERS
  // ============================================

  FUNCTION mcp_beads_create(params) -> JSON:
    // Build command from params
    cmd = "bd create"
    cmd += quote(params.title)

    IF params.description:
      cmd += " -d " + quote(params.description)
    IF params.priority != null:
      cmd += " -p " + params.priority
    IF params.type:
      cmd += " -t " + params.type
    IF params.labels:
      cmd += " -l " + params.labels.join(",")
    IF params.parent_id:
      cmd += " --parent " + params.parent_id

    cmd += " --json"

    result = run(cmd)

    // Link to memory if in active session
    IF current_session:
      memory_store(
        namespace: "beads/issues",
        key: result.id,
        value: result,
        metadata: { session_id: current_session }
      )

    RETURN result

  FUNCTION mcp_beads_ready(params) -> JSON:
    cmd = "bd ready --json"

    IF params.limit:
      cmd += " --limit " + params.limit
    IF params.priority:
      cmd += " --priority " + params.priority
    IF params.assignee:
      cmd += " --assignee " + params.assignee
    IF params.sort:
      cmd += " --sort " + params.sort

    RETURN run(cmd)

  FUNCTION mcp_beads_list(params) -> JSON:
    cmd = "bd list --json"

    // Apply all filters
    FOR filter IN params.filters:
      cmd += " --" + filter.key + " " + filter.value

    RETURN run(cmd)

  FUNCTION mcp_beads_show(params) -> JSON:
    result = run("bd show " + params.id + " --json")

    // Enrich with linked memories
    memories = memory_query(
      namespace: "beads/issues",
      filter: { issue_id: params.id }
    )
    result.linked_memories = memories

    RETURN result

  FUNCTION mcp_beads_update(params) -> JSON:
    cmd = "bd update " + params.id

    IF params.status:
      cmd += " --status " + params.status
    IF params.priority:
      cmd += " --priority " + params.priority
    IF params.assignee:
      cmd += " --assignee " + params.assignee

    cmd += " --json"
    RETURN run(cmd)

  FUNCTION mcp_beads_close(params) -> JSON:
    cmd = "bd close " + params.id

    IF params.reason:
      cmd += " --reason " + quote(params.reason)

    cmd += " --json"

    result = run(cmd)

    // Update linked memories
    memory_update(
      namespace: "beads/issues",
      key: params.id,
      metadata: { status: "closed", closed_at: now() }
    )

    RETURN result

  FUNCTION mcp_beads_dep_add(params) -> JSON:
    cmd = "bd dep add " + params.from_id + " " + params.to_id

    IF params.type:
      cmd += " --type " + params.type  // blocks, related, parent-child, discovered-from

    cmd += " --json"
    RETURN run(cmd)

  FUNCTION mcp_beads_dep_tree(params) -> JSON:
    RETURN run("bd dep tree " + params.id + " --json")

  // ============================================
  // HOOKS INTEGRATION
  // ============================================

  FUNCTION hook_session_start():
    // Show ready work to agent
    ready = mcp_beads_ready({ limit: 5, sort: "priority" })

    inject_context("""
      Ready Work (no blockers):
      ${format_ready_list(ready)}

      Use beads_show <id> for details before starting work.
    """)

  FUNCTION hook_session_end():
    // Prompt agent to file remaining work
    inject_prompt("""
      Before ending session:
      1. File any discovered issues with beads_create
      2. Update in-progress issues with beads_update
      3. Close completed issues with beads_close
      4. Run "bd sync" to push changes
    """)

  FUNCTION hook_pre_task(task):
    // Query related issues
    issues = mcp_beads_list({
      filters: [
        { key: "title-contains", value: task.keywords }
      ]
    })

    IF issues.length > 0:
      inject_context("""
        Related Beads issues found:
        ${format_issue_list(issues)}
      """)

  FUNCTION hook_post_task(task, result):
    IF task.status == "completed":
      // Auto-close if issue was being worked
      IF task.beads_issue_id:
        mcp_beads_close({
          id: task.beads_issue_id,
          reason: result.summary
        })

    // Store learned patterns with issue link
    IF result.patterns_learned:
      FOR pattern IN result.patterns_learned:
        reasoningbank_store(
          pattern: pattern,
          metadata: { beads_issue: task.beads_issue_id }
        )

  // ============================================
  // SPARC INTEGRATION
  // ============================================

  FUNCTION sparc_specification_complete(spec):
    // Create epic from specification
    epic = mcp_beads_create({
      title: spec.name,
      description: spec.summary,
      type: "epic",
      priority: 1,
      labels: ["sparc", "specification"]
    })

    // Create child tasks from requirements
    FOR req IN spec.requirements:
      task = mcp_beads_create({
        title: req.name,
        description: req.acceptance_criteria,
        type: "task",
        parent_id: epic.id,
        labels: ["sparc", "requirement"]
      })

      // Link to epic
      mcp_beads_dep_add({
        from_id: task.id,
        to_id: epic.id,
        type: "parent-child"
      })

    RETURN epic

  FUNCTION sparc_architecture_complete(arch):
    // Create issues for each component
    FOR component IN arch.components:
      mcp_beads_create({
        title: "Implement " + component.name,
        description: component.specification,
        type: "task",
        labels: ["sparc", "architecture", component.layer]
      })

  FUNCTION sparc_tdd_complete(tests):
    // Create issues for uncovered areas
    FOR gap IN tests.coverage_gaps:
      mcp_beads_create({
        title: "Test coverage: " + gap.area,
        description: "Coverage currently at " + gap.percentage + "%",
        type: "chore",
        priority: 2,
        labels: ["sparc", "tdd", "coverage"]
      })

  // ============================================
  // MEMORY INTEGRATION
  // ============================================

  FUNCTION link_memory_to_issue(memory_key, issue_id):
    // Update memory metadata
    memory = memory_retrieve(memory_key)
    memory.metadata.beads_issue = issue_id
    memory_update(memory_key, memory)

    // Add note to issue
    mcp_beads_update({
      id: issue_id,
      notes: "Linked memory: " + memory_key
    })

  FUNCTION query_memories_for_issue(issue_id) -> Array:
    RETURN memory_query({
      filter: { "metadata.beads_issue": issue_id }
    })

  FUNCTION auto_link_patterns(pattern, context):
    // If pattern was learned during issue work, auto-link
    IF context.active_issue:
      pattern.metadata.beads_issue = context.active_issue
      pattern.metadata.learned_from = "issue-work"

    RETURN pattern
```

## 2.2 Data Flow Pseudocode

```pseudocode
// ============================================
// DATA SYNCHRONIZATION
// ============================================

MODULE BeadsSync:

  // Beads stores data in two places:
  // 1. .beads/beads.jsonl (git-tracked, source of truth)
  // 2. .beads/beads.db (SQLite cache, gitignored)

  // Claude-Flow stores data in:
  // 1. .swarm/memory.db (SQLite)

  // This module keeps them in sync

  FUNCTION sync_beads_to_memory():
    // Get all beads issues
    issues = run("bd list --json")

    FOR issue IN issues:
      // Store in Claude-Flow memory
      memory_store(
        namespace: "beads/issues",
        key: issue.id,
        value: {
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          dependencies: issue.dependencies,
          updated_at: issue.updated_at
        }
      )

  FUNCTION sync_memory_to_beads():
    // Get memory entries with beads metadata
    memories = memory_query({
      namespace: "beads/*"
    })

    FOR memory IN memories:
      IF memory.metadata.pending_beads_update:
        // Apply update to beads
        mcp_beads_update({
          id: memory.metadata.beads_issue,
          notes: memory.value.summary
        })

        // Clear pending flag
        memory.metadata.pending_beads_update = false
        memory_update(memory.key, memory)

  FUNCTION watch_for_changes():
    // Watch .beads/beads.jsonl for changes
    file_watcher(".beads/beads.jsonl", ON_CHANGE: sync_beads_to_memory)

    // Watch memory for beads-related changes
    memory_watcher("beads/*", ON_CHANGE: sync_memory_to_beads)
```

---

# Phase 3: ARCHITECTURE

## 3.1 System Architecture

```
+-------------------------------------------------------------------------+
|                           CLAUDE-FLOW + BEADS                           |
+-------------------------------------------------------------------------+
|                                                                         |
|  +-------------------+     +-------------------+     +-------------------+
|  |   Claude Code     |     |  Claude-Flow      |     |     Human         |
|  |     Agent         |     |     CLI           |     |   Developer       |
|  +--------+----------+     +--------+----------+     +--------+----------+
|           |                         |                         |          |
|           +--------------------------+-------------------------+          |
|                                     |                                    |
|                                     v                                    |
|  +-------------------------------------------------------------------+  |
|  |                        MCP SERVER                                  |  |
|  |  +---------------+  +---------------+  +---------------+           |  |
|  |  | beads_*       |  | memory_*      |  | swarm_*       |           |  |
|  |  | tools (11)    |  | tools         |  | tools         |           |  |
|  |  +---------------+  +---------------+  +---------------+           |  |
|  +-------------------------------------------------------------------+  |
|                                     |                                    |
|           +--------------------------+-------------------------+         |
|           |                         |                         |          |
|           v                         v                         v          |
|  +-------------------+     +-------------------+     +-------------------+
|  |  BEADS ENGINE     |     |  MEMORY ENGINE    |     |  SWARM ENGINE     |
|  |                   |     |                   |     |                   |
|  |  +-------------+  |     | +-------------+   |     | +-------------+   |
|  |  | bd CLI      |  |<--->| | Reasoning   |   |     | | Hive Mind   |   |
|  |  | wrapper     |  |     | | Bank        |   |     | |             |   |
|  |  +-------------+  |     | +-------------+   |     | +-------------+   |
|  |        |          |     |       |           |     |       |           |
|  |        v          |     |       v           |     |       v           |
|  |  +-------------+  |     | +-------------+   |     | +-------------+   |
|  |  | SQLite      |  |     | | SQLite      |   |     | | SQLite      |   |
|  |  | .beads/     |  |     | | .swarm/     |   |     | | hive.db     |   |
|  |  +-------------+  |     | +-------------+   |     | +-------------+   |
|  |        |          |     |                   |     |                   |
|  |        v          |     +-------------------+     +-------------------+
|  |  +-------------+  |                                                   |
|  |  | JSONL       |  |<---- GIT SYNC ----> Team Members                  |
|  |  | .beads/     |  |                                                   |
|  |  +-------------+  |                                                   |
|  +-------------------+                                                   |
|                                                                          |
+--------------------------------------------------------------------------+
```

## 3.2 Component Diagram

```
+-------------------------------------------------------------------------+
|                         BEADS INTEGRATION MODULE                        |
+-------------------------------------------------------------------------+
|                                                                         |
|  +--------------------------------------------------------------------+ |
|  |                        src/beads/                                   | |
|  |  +----------------+  +----------------+  +----------------+         | |
|  |  | index.ts       |  | cli-wrapper.ts |  | mcp-tools.ts   |         | |
|  |  |                |  |                |  |                |         | |
|  |  | - initialize() |  | - runBd()      |  | - beads_create |         | |
|  |  | - isInstalled()|  | - parseJson()  |  | - beads_list   |         | |
|  |  | - isInited()   |  | - handleError()|  | - beads_ready  |         | |
|  |  | - configure()  |  |                |  | - beads_show   |         | |
|  |  +----------------+  +----------------+  | - beads_update |         | |
|  |                                          | - beads_close  |         | |
|  |                                          | - beads_dep_*  |         | |
|  |                                          | - beads_sync   |         | |
|  |                                          +----------------+         | |
|  |                                                                     | |
|  |  +----------------+  +----------------+  +----------------+         | |
|  |  | hooks.ts       |  | sparc.ts       |  | memory-link.ts |         | |
|  |  |                |  |                |  |                |         | |
|  |  | - preTask      |  | - onSpec()     |  | - linkMemory() |         | |
|  |  | - postTask     |  | - onArch()     |  | - queryByIssue |         | |
|  |  | - sessionStart |  | - onTdd()      |  | - autoLink()   |         | |
|  |  | - sessionEnd   |  | - onComplete() |  |                |         | |
|  |  +----------------+  +----------------+  +----------------+         | |
|  |                                                                     | |
|  |  +----------------+  +----------------+                             | |
|  |  | sync.ts        |  | types.ts       |                             | |
|  |  |                |  |                |                             | |
|  |  | - syncToMem()  |  | - BeadsIssue   |                             | |
|  |  | - syncFromMem()|  | - BeadsDep     |                             | |
|  |  | - watchChanges |  | - BeadsConfig  |                             | |
|  |  +----------------+  | - MCPParams    |                             | |
|  |                      +----------------+                             | |
|  +--------------------------------------------------------------------+ |
|                                                                         |
+-------------------------------------------------------------------------+
```

## 3.3 File Structure

```
claude-flow/
├── src/
│   ├── beads/                          # NEW: Beads integration module
│   │   ├── index.ts                    # Main entry point
│   │   ├── cli-wrapper.ts              # bd CLI wrapper
│   │   ├── mcp-tools.ts                # MCP tool definitions
│   │   ├── hooks.ts                    # Hook implementations
│   │   ├── sparc.ts                    # SPARC phase integration
│   │   ├── memory-link.ts              # Memory <-> Beads linking
│   │   ├── sync.ts                     # Sync logic
│   │   └── types.ts                    # TypeScript types
│   │
│   ├── cli/
│   │   └── simple-commands/
│   │       └── beads.ts                # NEW: claude-flow beads CLI
│   │
│   └── mcp/
│       └── tools/
│           └── beads-tools.ts          # NEW: MCP tool registrations
│
├── tests/
│   └── beads/                          # NEW: Test suite
│       ├── cli-wrapper.test.ts
│       ├── mcp-tools.test.ts
│       ├── hooks.test.ts
│       ├── sparc.test.ts
│       ├── memory-link.test.ts
│       └── integration.test.ts
│
└── docs/
    └── BEADS-INTEGRATION.md            # NEW: Integration docs
```

## 3.4 Interface Definitions

### MCP Tool Schemas

```typescript
// src/beads/types.ts

export interface BeadsIssue {
  id: string;              // e.g., "bd-a1b2" or "bd-a1b2.1"
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed';
  priority: 0 | 1 | 2 | 3 | 4;
  type: 'bug' | 'feature' | 'task' | 'epic' | 'chore';
  assignee?: string;
  labels: string[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  close_reason?: string;
  dependencies: BeadsDependency[];
  notes?: string;
}

export interface BeadsDependency {
  from_id: string;
  to_id: string;
  type: 'blocks' | 'related' | 'parent-child' | 'discovered-from';
  created_at: string;
}

export interface BeadsCreateParams {
  title: string;
  description?: string;
  priority?: number;
  type?: string;
  assignee?: string;
  labels?: string[];
  parent_id?: string;
}

export interface BeadsListParams {
  status?: string;
  priority?: number;
  assignee?: string;
  labels?: string[];
  label_any?: string[];
  title_contains?: string;
  desc_contains?: string;
  created_after?: string;
  created_before?: string;
  limit?: number;
}

export interface BeadsReadyParams {
  limit?: number;
  priority?: number;
  assignee?: string;
  sort?: 'priority' | 'oldest' | 'hybrid';
}

export interface BeadsUpdateParams {
  id: string;
  status?: string;
  priority?: number;
  assignee?: string;
  labels?: string[];
  notes?: string;
}

export interface BeadsCloseParams {
  id: string;
  reason?: string;
}

export interface BeadsDepAddParams {
  from_id: string;
  to_id: string;
  type?: 'blocks' | 'related' | 'parent-child' | 'discovered-from';
}
```

---

# Phase 4: REFINEMENT (TDD)

## 4.1 Test Plan

### Unit Tests

```typescript
// tests/beads/cli-wrapper.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeadsCliWrapper } from '../../src/beads/cli-wrapper';

describe('BeadsCliWrapper', () => {
  let wrapper: BeadsCliWrapper;

  beforeEach(() => {
    wrapper = new BeadsCliWrapper();
  });

  describe('isInstalled()', () => {
    it('should return true when bd is in PATH', async () => {
      vi.spyOn(wrapper, 'runCommand').mockResolvedValue({ exitCode: 0 });
      expect(await wrapper.isInstalled()).toBe(true);
    });

    it('should return false when bd is not found', async () => {
      vi.spyOn(wrapper, 'runCommand').mockRejectedValue(new Error('not found'));
      expect(await wrapper.isInstalled()).toBe(false);
    });
  });

  describe('isInitialized()', () => {
    it('should return true when .beads/beads.jsonl exists', async () => {
      vi.spyOn(wrapper, 'fileExists').mockResolvedValue(true);
      expect(await wrapper.isInitialized()).toBe(true);
    });

    it('should return false when .beads directory missing', async () => {
      vi.spyOn(wrapper, 'fileExists').mockResolvedValue(false);
      expect(await wrapper.isInitialized()).toBe(false);
    });
  });

  describe('create()', () => {
    it('should create issue with all parameters', async () => {
      const mockResult = { id: 'bd-a1b2', title: 'Test Issue' };
      vi.spyOn(wrapper, 'runBd').mockResolvedValue(mockResult);

      const result = await wrapper.create({
        title: 'Test Issue',
        description: 'Description',
        priority: 1,
        type: 'bug',
        labels: ['urgent', 'backend']
      });

      expect(result.id).toBe('bd-a1b2');
      expect(wrapper.runBd).toHaveBeenCalledWith([
        'create',
        '"Test Issue"',
        '-d', '"Description"',
        '-p', '1',
        '-t', 'bug',
        '-l', 'urgent,backend',
        '--json'
      ]);
    });

    it('should throw on bd error', async () => {
      vi.spyOn(wrapper, 'runBd').mockRejectedValue(new Error('bd failed'));
      await expect(wrapper.create({ title: 'Test' })).rejects.toThrow();
    });
  });

  describe('ready()', () => {
    it('should return unblocked issues', async () => {
      const mockIssues = [
        { id: 'bd-a1b2', title: 'Ready task', blocked: false },
        { id: 'bd-f14c', title: 'Another ready', blocked: false }
      ];
      vi.spyOn(wrapper, 'runBd').mockResolvedValue(mockIssues);

      const result = await wrapper.ready({ limit: 10 });

      expect(result).toHaveLength(2);
      expect(result[0].blocked).toBe(false);
    });

    it('should apply priority filter', async () => {
      vi.spyOn(wrapper, 'runBd').mockResolvedValue([]);

      await wrapper.ready({ priority: 0 });

      expect(wrapper.runBd).toHaveBeenCalledWith(
        expect.arrayContaining(['--priority', '0'])
      );
    });
  });

  describe('update()', () => {
    it('should update issue status', async () => {
      vi.spyOn(wrapper, 'runBd').mockResolvedValue({ id: 'bd-a1b2', status: 'in_progress' });

      const result = await wrapper.update({
        id: 'bd-a1b2',
        status: 'in_progress'
      });

      expect(result.status).toBe('in_progress');
    });
  });

  describe('close()', () => {
    it('should close issue with reason', async () => {
      vi.spyOn(wrapper, 'runBd').mockResolvedValue({ id: 'bd-a1b2', status: 'closed' });

      await wrapper.close({
        id: 'bd-a1b2',
        reason: 'Completed implementation'
      });

      expect(wrapper.runBd).toHaveBeenCalledWith([
        'close',
        'bd-a1b2',
        '--reason', '"Completed implementation"',
        '--json'
      ]);
    });
  });
});
```

### Integration Tests

```typescript
// tests/beads/integration.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BeadsIntegration } from '../../src/beads';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Beads Integration (E2E)', () => {
  const testDir = path.join(__dirname, 'test-workspace');
  let integration: BeadsIntegration;

  beforeAll(async () => {
    // Create test workspace
    fs.mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    // Initialize git
    execSync('git init');

    // Initialize beads
    execSync('bd init --quiet');

    integration = new BeadsIntegration();
    await integration.initialize();
  });

  afterAll(() => {
    process.chdir(__dirname);
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Full Workflow', () => {
    let epicId: string;
    let taskId: string;

    it('should create an epic', async () => {
      const result = await integration.mcpTools.beads_create({
        title: 'Test Epic',
        type: 'epic',
        priority: 1,
        labels: ['test']
      });

      epicId = result.id;
      expect(epicId).toMatch(/^bd-[a-f0-9]+$/);
    });

    it('should create a child task', async () => {
      const result = await integration.mcpTools.beads_create({
        title: 'Child Task',
        type: 'task',
        priority: 2
      });

      taskId = result.id;

      // Add parent-child dependency
      await integration.mcpTools.beads_dep_add({
        from_id: taskId,
        to_id: epicId,
        type: 'parent-child'
      });
    });

    it('should show task in ready list', async () => {
      const ready = await integration.mcpTools.beads_ready({});
      expect(ready.some(i => i.id === taskId)).toBe(true);
    });

    it('should update task status', async () => {
      await integration.mcpTools.beads_update({
        id: taskId,
        status: 'in_progress'
      });

      const show = await integration.mcpTools.beads_show({ id: taskId });
      expect(show.status).toBe('in_progress');
    });

    it('should close task with reason', async () => {
      await integration.mcpTools.beads_close({
        id: taskId,
        reason: 'Test completed'
      });

      const show = await integration.mcpTools.beads_show({ id: taskId });
      expect(show.status).toBe('closed');
    });

    it('should show dependency tree', async () => {
      const tree = await integration.mcpTools.beads_dep_tree({ id: epicId });
      expect(tree).toBeDefined();
    });
  });

  describe('Memory Linking', () => {
    it('should link memory to issue', async () => {
      const issue = await integration.mcpTools.beads_create({
        title: 'Memory Link Test'
      });

      await integration.memoryLink.linkMemory('test-pattern', issue.id);

      const memories = await integration.memoryLink.queryByIssue(issue.id);
      expect(memories).toContain('test-pattern');
    });
  });
});
```

### Hook Tests

```typescript
// tests/beads/hooks.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BeadsHooks } from '../../src/beads/hooks';

describe('BeadsHooks', () => {
  let hooks: BeadsHooks;
  let mockBeadsCli: any;

  beforeEach(() => {
    mockBeadsCli = {
      ready: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      close: vi.fn()
    };
    hooks = new BeadsHooks(mockBeadsCli);
  });

  describe('sessionStart', () => {
    it('should inject ready work context', async () => {
      mockBeadsCli.ready.mockResolvedValue([
        { id: 'bd-a1b2', title: 'Ready Task', priority: 1 }
      ]);

      const context = await hooks.sessionStart();

      expect(context).toContain('Ready Work');
      expect(context).toContain('bd-a1b2');
    });

    it('should handle empty ready list', async () => {
      mockBeadsCli.ready.mockResolvedValue([]);

      const context = await hooks.sessionStart();

      expect(context).toContain('No ready work');
    });
  });

  describe('sessionEnd', () => {
    it('should return prompt for issue management', async () => {
      const prompt = await hooks.sessionEnd();

      expect(prompt).toContain('beads_create');
      expect(prompt).toContain('beads_close');
      expect(prompt).toContain('bd sync');
    });
  });

  describe('preTask', () => {
    it('should inject related issues', async () => {
      mockBeadsCli.list.mockResolvedValue([
        { id: 'bd-a1b2', title: 'Related Auth Issue' }
      ]);

      const context = await hooks.preTask({ keywords: 'auth' });

      expect(context).toContain('Related Beads issues');
      expect(context).toContain('bd-a1b2');
    });
  });

  describe('postTask', () => {
    it('should close issue on task completion', async () => {
      await hooks.postTask({
        status: 'completed',
        beads_issue_id: 'bd-a1b2'
      }, {
        summary: 'Implemented feature'
      });

      expect(mockBeadsCli.close).toHaveBeenCalledWith({
        id: 'bd-a1b2',
        reason: 'Implemented feature'
      });
    });

    it('should not close if task failed', async () => {
      await hooks.postTask({
        status: 'failed',
        beads_issue_id: 'bd-a1b2'
      }, {});

      expect(mockBeadsCli.close).not.toHaveBeenCalled();
    });
  });
});
```

## 4.2 Implementation Order (TDD Red-Green-Refactor)

### Sprint 1: Core CLI Wrapper (Week 1)
1. **RED**: Write `cli-wrapper.test.ts` tests
2. **GREEN**: Implement `cli-wrapper.ts` to pass tests
3. **REFACTOR**: Extract common patterns, add error handling

### Sprint 2: MCP Tools (Week 2)
1. **RED**: Write `mcp-tools.test.ts` tests
2. **GREEN**: Implement `mcp-tools.ts` to pass tests
3. **REFACTOR**: Optimize JSON parsing, add validation

### Sprint 3: Hooks Integration (Week 3)
1. **RED**: Write `hooks.test.ts` tests
2. **GREEN**: Implement `hooks.ts` to pass tests
3. **REFACTOR**: Add configurable hook behavior

### Sprint 4: Memory Linking (Week 4)
1. **RED**: Write `memory-link.test.ts` tests
2. **GREEN**: Implement `memory-link.ts` to pass tests
3. **REFACTOR**: Optimize sync performance

### Sprint 5: SPARC Integration (Week 5)
1. **RED**: Write `sparc.test.ts` tests
2. **GREEN**: Implement `sparc.ts` to pass tests
3. **REFACTOR**: Add template customization

### Sprint 6: Integration Testing (Week 6)
1. **RED**: Write `integration.test.ts` tests
2. **GREEN**: Fix all integration issues
3. **REFACTOR**: Performance optimization, documentation

---

# Phase 5: COMPLETION

## 5.1 Deliverables Checklist

### Code Deliverables
- [ ] `src/beads/index.ts` - Module entry point
- [ ] `src/beads/cli-wrapper.ts` - bd CLI wrapper
- [ ] `src/beads/mcp-tools.ts` - 11 MCP tools
- [ ] `src/beads/hooks.ts` - 4 lifecycle hooks
- [ ] `src/beads/sparc.ts` - SPARC phase integration
- [ ] `src/beads/memory-link.ts` - Memory linking
- [ ] `src/beads/sync.ts` - Sync logic
- [ ] `src/beads/types.ts` - TypeScript types

### Test Deliverables
- [ ] Unit tests with >90% coverage
- [ ] Integration tests
- [ ] E2E workflow tests
- [ ] Performance benchmarks

### Documentation Deliverables
- [ ] `docs/BEADS-INTEGRATION.md` - User guide
- [ ] Updated README with Beads section
- [ ] MCP tool reference documentation
- [ ] SPARC-Beads workflow guide

## 5.2 Release Plan

### v3.0.0-alpha.1 (Week 7)
- Core CLI wrapper
- Basic MCP tools (create, list, ready, show)
- Installation detection

### v3.0.0-alpha.2 (Week 8)
- Full MCP tool suite
- Hook integration
- Memory linking

### v3.0.0-alpha.3 (Week 9)
- SPARC integration
- Sync improvements
- Bug fixes

### v3.0.0-beta.1 (Week 10)
- Documentation complete
- Performance optimization
- Community testing

### v3.0.0 (Week 12)
- Stable release
- Migration guide from v2.x

## 5.3 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| MCP tool response time | < 200ms | Benchmark suite |
| Test coverage | > 90% | Jest coverage |
| Documentation completeness | 100% | Checklist |
| User satisfaction (beta) | > 4/5 | Survey |
| Bug reports (first month) | < 10 critical | GitHub issues |

## 5.4 Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Beads API changes | Medium | High | Pin version, abstract CLI |
| Performance overhead | Low | Medium | Lazy loading, caching |
| Git conflicts | Medium | Low | Use Beads merge driver |
| User confusion (two systems) | Medium | Medium | Clear documentation |

---

# Appendix A: MCP Tool Reference

## beads_create
Creates a new Beads issue.

**Parameters:**
```json
{
  "title": "string (required)",
  "description": "string",
  "priority": "number (0-4, default 2)",
  "type": "bug|feature|task|epic|chore (default task)",
  "assignee": "string",
  "labels": "string[]",
  "parent_id": "string"
}
```

**Returns:**
```json
{
  "id": "bd-a1b2",
  "title": "Issue title",
  "status": "open",
  "created_at": "2026-01-23T10:00:00Z"
}
```

## beads_ready
Gets issues with no open blockers.

**Parameters:**
```json
{
  "limit": "number (default 10)",
  "priority": "number (filter by priority)",
  "assignee": "string (filter by assignee)",
  "sort": "priority|oldest|hybrid (default hybrid)"
}
```

**Returns:**
```json
[
  {
    "id": "bd-a1b2",
    "title": "Ready task",
    "priority": 1,
    "blocked": false
  }
]
```

## beads_list
Lists issues with filters.

**Parameters:**
```json
{
  "status": "open|in_progress|closed",
  "priority": "number",
  "assignee": "string",
  "labels": "string[]",
  "label_any": "string[]",
  "title_contains": "string",
  "created_after": "ISO date string",
  "limit": "number"
}
```

## beads_show
Gets full issue details.

**Parameters:**
```json
{
  "id": "string (required)"
}
```

**Returns:** Full `BeadsIssue` object with linked memories.

## beads_update
Updates issue fields.

**Parameters:**
```json
{
  "id": "string (required)",
  "status": "open|in_progress|closed",
  "priority": "number",
  "assignee": "string",
  "labels": "string[]",
  "notes": "string"
}
```

## beads_close
Closes an issue.

**Parameters:**
```json
{
  "id": "string (required)",
  "reason": "string"
}
```

## beads_dep_add
Adds a dependency link.

**Parameters:**
```json
{
  "from_id": "string (required)",
  "to_id": "string (required)",
  "type": "blocks|related|parent-child|discovered-from (default blocks)"
}
```

## beads_dep_tree
Shows dependency tree.

**Parameters:**
```json
{
  "id": "string (required)"
}
```

## beads_blocked
Lists blocked issues.

**Parameters:**
```json
{
  "limit": "number"
}
```

## beads_stats
Gets issue statistics.

**Parameters:** None

**Returns:**
```json
{
  "total": 42,
  "open": 15,
  "in_progress": 5,
  "closed": 22,
  "by_priority": { "0": 2, "1": 5, "2": 10 }
}
```

## beads_sync
Forces git sync.

**Parameters:** None

---

# Appendix B: CLAUDE.md Additions

Add to project CLAUDE.md for Beads integration:

```markdown
## Beads Issue Tracking

This project uses Beads for task management. Before starting work:

1. Run `bd ready` to see available tasks
2. Use `bd show <id>` for task details
3. Update status with `bd update <id> --status in_progress`

During work:
- File discovered issues: `bd create "Issue title" -t bug -p 1`
- Link to parent: `bd dep add <new-id> <parent-id> --type discovered-from`

Before ending session:
- Close completed issues: `bd close <id> --reason "Completed"`
- Sync to git: `bd sync`

### MCP Tools Available
- `beads_ready` - Get unblocked work
- `beads_create` - File new issues
- `beads_update` - Update status
- `beads_close` - Close with reason
- `beads_show` - Get details
- `beads_dep_add` - Add dependencies
```

---

*Document generated using SPARC methodology with TDD principles.*
*Ready for implementation review and Sprint 1 kickoff.*
