# ADR-027 Gap Analysis: Missing Plugin Features

**Date:** 2026-01-25
**Status:** Action Required
**Related:** ADR-027-teammate-tool-integration.md

---

## Executive Summary

Analysis of Claude Code v2.1.19 reveals **15 major capabilities** not yet addressed in ADR-027's plugin design. These represent significant functionality gaps that would limit the plugin's effectiveness.

---

## 1. Critical Missing Features

### 1.1 Delegate Mode (Priority: HIGH)

**Evidence in binary:**
```
"delegate" (17 refs)
"delegate_mode" (4 refs)
"delegate_mode_exit" (4 refs)
"delegateMode" (1 ref)
```

**What it does:**
- Allows coordinator to delegate authority to teammates
- Teammates can make decisions without approval
- Reduces round-trip approval latency

**Missing from plugin:**
```typescript
// NEED TO ADD
interface TeammateSpawnConfig {
  // ...existing fields...
  delegateAuthority?: boolean;       // Can this teammate delegate?
  delegatedPermissions?: string[];   // What can they approve?
  delegationDepth?: number;          // How many levels of delegation?
}

// NEED TO ADD
async delegateToTeammate(
  teamName: string,
  fromId: string,
  toId: string,
  permissions: string[]
): Promise<void>;

async revokeDelegation(
  teamName: string,
  fromId: string,
  toId: string
): Promise<void>;
```

---

### 1.2 Remote Agent / Push to Remote (Priority: HIGH)

**Evidence in binary:**
```
"remote_agent" (11 refs)
"pushToRemote" (in ExitPlanModeInput)
"remoteSessionId" (in ExitPlanModeInput)
"remoteSessionUrl" (in ExitPlanModeInput)
```

**What it does:**
- Sync local session to Claude.ai web interface
- Allow teammates to continue work in browser
- Cross-device session continuity

**Missing from plugin:**
```typescript
// NEED TO ADD
interface RemoteSyncConfig {
  enabled: boolean;
  autoSync: boolean;
  syncInterval: number;  // ms
}

// NEED TO ADD
async pushTeamToRemote(teamName: string): Promise<{
  remoteSessionId: string;
  remoteSessionUrl: string;
}>;

async pullFromRemote(remoteSessionId: string): Promise<TeamState>;

async syncWithRemote(teamName: string): Promise<SyncResult>;
```

---

### 1.3 Session Memory & Transcript (Priority: HIGH)

**Evidence in binary:**
```
"session_memory" (8 refs)
"session_transcript" (5 refs)
"nested_memory" (4 refs)
"ultramemory" (3 refs)
"tengu_session_memory" (2 refs)
```

**What it does:**
- Persist teammate context across sessions
- Share transcripts between teammates
- Nested memory for hierarchical context

**Missing from plugin:**
```typescript
// NEED TO ADD
interface TeammateMemory {
  sessionId: string;
  teammateId: string;
  transcript: Message[];
  context: Record<string, unknown>;
  nestedMemories: TeammateMemory[];  // For hierarchical teams
}

// NEED TO ADD
async saveTeammateMemory(
  teamName: string,
  teammateId: string
): Promise<void>;

async loadTeammateMemory(
  teamName: string,
  teammateId: string
): Promise<TeammateMemory | null>;

async shareTranscript(
  teamName: string,
  fromId: string,
  toId: string,
  messageRange?: { start: number; end: number }
): Promise<void>;
```

---

### 1.4 Teleport / Session Resume (Priority: MEDIUM)

**Evidence in binary:**
```
"tengu_teleport_resume_session" (2 refs)
"tengu_teleport_resume_error" (3 refs)
"tengu_teleport_error_repo_not_in_git_dir_sessions_api" (1 ref)
"tengu_teleport_error_repo_mismatch_sessions_api" (1 ref)
```

**What it does:**
- Resume team sessions across terminal instances
- Maintain team state when switching contexts
- Git-aware session resumption

**Missing from plugin:**
```typescript
// NEED TO ADD
interface TeleportConfig {
  autoResume: boolean;
  gitAware: boolean;
  preserveMailbox: boolean;
}

// NEED TO ADD
async teleportTeam(
  teamName: string,
  targetContext: {
    workingDirectory?: string;
    gitRepo?: string;
    sessionId?: string;
  }
): Promise<TeamState>;

async canTeleport(teamName: string): Promise<{
  canTeleport: boolean;
  blockers?: string[];
}>;
```

---

### 1.5 Team Context & Permissions (Priority: HIGH)

**Evidence in binary:**
```
"team_context" (4 refs)
"team_permission_update" (3 refs)
"no_team_context" (1 ref)
"team_not_found" (3 refs)
```

**What it does:**
- Shared context across all teammates
- Dynamic permission updates during execution
- Context inheritance for new teammates

**Missing from plugin:**
```typescript
// NEED TO ADD
interface TeamContext {
  teamName: string;
  sharedVariables: Record<string, unknown>;
  inheritedPermissions: string[];
  workingDirectory: string;
  gitBranch?: string;
  environmentVariables: Record<string, string>;
}

// NEED TO ADD
async updateTeamContext(
  teamName: string,
  updates: Partial<TeamContext>
): Promise<void>;

async updateTeammatePermissions(
  teamName: string,
  teammateId: string,
  permissions: {
    add?: string[];
    remove?: string[];
  }
): Promise<void>;

async getTeamContext(teamName: string): Promise<TeamContext>;
```

---

### 1.6 Plan Mode Re-entry (Priority: MEDIUM)

**Evidence in binary:**
```
"plan_mode" (7 refs)
"plan_mode_exit" (6 refs)
"plan_mode_reentry" (4 refs)
```

**What it does:**
- Re-enter plan mode after partial execution
- Modify plan mid-execution
- Handle plan failures gracefully

**Missing from plugin:**
```typescript
// NEED TO ADD
async reenterPlanMode(
  teamName: string,
  planId: string,
  options?: {
    fromStep?: number;
    modifications?: PlanStep[];
  }
): Promise<TeamPlan>;

async pausePlanExecution(
  teamName: string,
  planId: string
): Promise<void>;

async resumePlanExecution(
  teamName: string,
  planId: string,
  fromStep?: number
): Promise<void>;
```

---

### 1.7 Worker Threads (Priority: LOW)

**Evidence in binary:**
```
"worker_threads" (2 refs)
"workers" (1 ref)
"worker" (1 ref)
"worker_permission_prompt" (3 refs)
```

**What it does:**
- Parallel execution within a single teammate
- CPU-intensive task offloading
- Shared memory between workers

**Missing from plugin:**
```typescript
// NEED TO ADD (for advanced use cases)
interface WorkerConfig {
  maxWorkers: number;
  sharedMemory: boolean;
  taskQueue: 'fifo' | 'priority';
}

async spawnWorker(
  teamName: string,
  teammateId: string,
  task: WorkerTask
): Promise<string>;  // Returns worker ID
```

---

### 1.8 Swarm Teammate Type (Priority: MEDIUM)

**Evidence in binary:**
```
"swarm_teammate" (1 ref)
```

**What it does:**
- Special teammate type for swarm coordination
- Different spawning behavior than regular teammates
- Optimized for parallel task execution

**Missing from plugin:**
```typescript
// NEED TO ADD
type TeammateType = 'regular' | 'swarm' | 'coordinator' | 'worker';

interface TeammateSpawnConfig {
  // ...existing fields...
  teammateType?: TeammateType;
}
```

---

## 2. Missing Spawn Backend Details

### 2.1 tmux Backend Configuration

**Evidence:**
```
"tmux" (26 refs)
CLAUDE_CODE_TMUX_SESSION
CLAUDE_CODE_TMUX_PREFIX
```

**Missing from plugin:**
```typescript
// NEED TO ADD
interface TmuxBackendConfig {
  sessionName?: string;
  windowName?: string;
  paneLayout?: 'tiled' | 'even-horizontal' | 'even-vertical';
  prefixKey?: string;
  shellCommand?: string;
  environment?: Record<string, string>;
}

async configureTmuxBackend(config: TmuxBackendConfig): Promise<void>;

async getTmuxPanes(sessionName: string): Promise<{
  paneId: string;
  teammateId: string;
  active: boolean;
}[]>;

async focusTmuxPane(sessionName: string, paneId: string): Promise<void>;
```

---

### 2.2 In-Process Backend Details

**Evidence:**
```
"in_process_teammate" (18 refs)
"InProcessTeammateTask" (1 ref)
```

**Missing from plugin:**
```typescript
// NEED TO ADD
interface InProcessConfig {
  maxConcurrent: number;
  memoryLimit: number;  // bytes
  timeoutMs: number;
  isolationLevel: 'none' | 'vm' | 'worker';
}

async getInProcessTeammates(): Promise<{
  teammateId: string;
  memoryUsage: number;
  cpuTime: number;
  status: string;
}[]>;
```

---

## 3. Missing MCP Tools

The following MCP tools should be added:

| Tool | Purpose | Priority |
|------|---------|----------|
| `teammate_delegate` | Delegate authority to teammate | HIGH |
| `teammate_push_remote` | Sync team to Claude.ai | HIGH |
| `teammate_save_memory` | Persist teammate context | HIGH |
| `teammate_share_transcript` | Share messages between teammates | HIGH |
| `teammate_update_context` | Update team shared context | HIGH |
| `teammate_update_permissions` | Dynamic permission changes | HIGH |
| `teammate_teleport` | Resume team in new context | MEDIUM |
| `teammate_pause_plan` | Pause plan execution | MEDIUM |
| `teammate_resume_plan` | Resume paused plan | MEDIUM |
| `teammate_reenter_plan` | Modify and re-enter plan mode | MEDIUM |
| `teammate_configure_tmux` | Configure tmux backend | LOW |
| `teammate_spawn_worker` | Spawn worker thread | LOW |

---

## 4. Missing Event Handlers

The bridge should emit these additional events:

```typescript
// NEED TO ADD to TeammateBridge
interface TeammateBridgeEvents {
  // Existing events...

  // Missing events:
  'delegate:granted': { team: string; from: string; to: string; permissions: string[] };
  'delegate:revoked': { team: string; from: string; to: string };
  'remote:pushed': { team: string; remoteUrl: string };
  'remote:synced': { team: string; changes: number };
  'memory:saved': { team: string; teammateId: string };
  'memory:loaded': { team: string; teammateId: string };
  'transcript:shared': { team: string; from: string; to: string };
  'context:updated': { team: string; keys: string[] };
  'permissions:updated': { team: string; teammateId: string };
  'plan:paused': { team: string; planId: string };
  'plan:resumed': { team: string; planId: string };
  'teleport:started': { team: string; target: object };
  'teleport:completed': { team: string; target: object };
  'worker:spawned': { team: string; teammateId: string; workerId: string };
  'worker:completed': { team: string; workerId: string; result: unknown };
}
```

---

## 5. Missing Integration with Claude Flow

### 5.1 Memory System Bridge

Need to bridge TeammateTool's session_memory with Claude Flow's HNSW-indexed memory:

```typescript
// NEED TO ADD
class MemoryBridge {
  async syncTeammateMemoryToHNSW(
    teamName: string,
    teammateId: string
  ): Promise<void>;

  async queryTeammateContext(
    teamName: string,
    query: string,
    limit?: number
  ): Promise<ContextMatch[]>;

  async embedTeammateTranscript(
    teamName: string,
    teammateId: string
  ): Promise<void>;
}
```

### 5.2 Hook Integration

Need hooks for TeammateTool events:

```typescript
// NEED TO ADD to Claude Flow hooks
const teammateHooks = {
  'teammate:pre-spawn': async (config: TeammateSpawnConfig) => { /* validate */ },
  'teammate:post-spawn': async (teammate: TeammateInfo) => { /* track */ },
  'teammate:pre-message': async (message: MailboxMessage) => { /* filter */ },
  'teammate:post-message': async (message: MailboxMessage) => { /* log */ },
  'teammate:plan-submitted': async (plan: TeamPlan) => { /* analyze */ },
  'teammate:plan-approved': async (plan: TeamPlan) => { /* notify */ },
};
```

### 5.3 Consensus Integration

Bridge TeammateTool's approval with Claude Flow's consensus:

```typescript
// NEED TO ADD
class Consensusbridge {
  async mapTeammatePlanToConsensus(
    plan: TeamPlan
  ): Promise<ConsensusProposal>;

  async mapConsensusToTeammatePlan(
    proposal: ConsensusProposal
  ): Promise<TeamPlan>;

  async hybridConsensus(
    teamName: string,
    proposal: unknown,
    algorithm: 'native' | 'raft' | 'byzantine'
  ): Promise<ConsensusResult>;
}
```

---

## 6. Missing Error Handling

### 6.1 Error Types

```typescript
// NEED TO ADD
class TeammateError extends Error {
  constructor(
    message: string,
    public code: TeammateErrorCode,
    public teamName?: string,
    public teammateId?: string
  ) {
    super(message);
  }
}

enum TeammateErrorCode {
  TEAM_NOT_FOUND = 'TEAM_NOT_FOUND',
  TEAMMATE_NOT_FOUND = 'TEAMMATE_NOT_FOUND',
  ALREADY_IN_TEAM = 'ALREADY_IN_TEAM',
  NO_TEAM_CONTEXT = 'NO_TEAM_CONTEXT',
  PLAN_NOT_APPROVED = 'PLAN_NOT_APPROVED',
  DELEGATION_DENIED = 'DELEGATION_DENIED',
  REMOTE_SYNC_FAILED = 'REMOTE_SYNC_FAILED',
  TELEPORT_FAILED = 'TELEPORT_FAILED',
  MAILBOX_FULL = 'MAILBOX_FULL',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  TIMEOUT = 'TIMEOUT',
}
```

### 6.2 Recovery Strategies

```typescript
// NEED TO ADD
interface RecoveryConfig {
  maxRetries: number;
  retryDelayMs: number;
  fallbackToMCP: boolean;
  autoCleanupOnError: boolean;
}

async recoverFromError(
  error: TeammateError,
  context: RecoveryContext
): Promise<RecoveryResult>;
```

---

## 7. Summary: Priority Implementation Order

### Phase 1 (Critical - Week 1)
1. ✅ Core bridge (already in ADR-027)
2. ⚠️ **ADD: Team Context management**
3. ⚠️ **ADD: Permission updates**
4. ⚠️ **ADD: Delegate mode**
5. ⚠️ **ADD: Session memory persistence**

### Phase 2 (High Priority - Week 2)
6. ⚠️ **ADD: Remote sync (pushToRemote)**
7. ⚠️ **ADD: Transcript sharing**
8. ⚠️ **ADD: Error handling & recovery**
9. ⚠️ **ADD: Memory bridge to HNSW**

### Phase 3 (Medium Priority - Week 3)
10. ⚠️ **ADD: Teleport/session resume**
11. ⚠️ **ADD: Plan pause/resume/reentry**
12. ⚠️ **ADD: Hook integration**
13. ⚠️ **ADD: Consensus bridge**

### Phase 4 (Nice to Have - Week 4)
14. ⚠️ **ADD: tmux backend configuration**
15. ⚠️ **ADD: Worker threads**
16. ⚠️ **ADD: Swarm teammate type**
17. ⚠️ **ADD: In-process backend configuration**

---

## 8. Estimated Additional Code

| Component | Lines of Code | Complexity |
|-----------|---------------|------------|
| Delegate Mode | ~150 | Medium |
| Remote Sync | ~200 | High |
| Session Memory | ~250 | Medium |
| Team Context | ~100 | Low |
| Teleport | ~150 | High |
| Plan Control | ~100 | Medium |
| Error Handling | ~150 | Low |
| Memory Bridge | ~200 | High |
| Hook Integration | ~100 | Low |
| Consensus Bridge | ~150 | Medium |
| **Total Additional** | **~1,550** | - |

Current ADR-027 implementation: ~1,400 lines
**Total plugin size needed: ~2,950 lines**

---

## 9. Next Steps

1. Update ADR-027 with missing features
2. Prioritize Phase 1 implementation
3. Create test cases for each feature
4. Document all new MCP tools
5. Add migration guide for existing Claude Flow users
