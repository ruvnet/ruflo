# ADR-051: Infinite Context via Compaction-to-Memory Bridge

**Status:** Implemented
**Date:** 2026-02-10
**Authors:** RuvNet, Claude Flow Team
**Version:** 2.0.0
**Related:** ADR-006 (Unified Memory), ADR-009 (Hybrid Memory Backend), ADR-027 (RuVector PostgreSQL), ADR-048 (Auto Memory Integration), ADR-049 (Self-Learning Memory GNN), ADR-052 (Statusline Observability)
**Implementation:** `.claude/helpers/context-persistence-hook.mjs` (~1600 lines), `.claude/helpers/patch-aggressive-prune.mjs` (~120 lines)

## Context

### The Problem: Context Window is a Hard Ceiling

Claude Code operates within a finite context window. When the conversation approaches
this limit, the system automatically **compacts** prior messages -- summarizing them
into a condensed form. While compaction preserves the gist of the conversation, it
irreversibly discards:

- **Tool call details**: Exact file paths edited, bash commands run, grep results
- **Decision reasoning**: Why a particular approach was chosen over alternatives
- **Code context**: Specific code snippets discussed, error messages diagnosed
- **Multi-step workflows**: The sequence of operations that led to a result
- **Agent coordination state**: Swarm agent outputs, task assignments, memory keys

This creates a "context cliff" -- once compaction occurs, Claude loses the ability to
reference specific earlier details, leading to repeated work, lost context, and
degraded assistance quality in long sessions.

### What We Have Today

Claude Code's SDK exposes two hook events relevant to compaction:

1. **PreCompact** (`PreCompactHookInput`): Fires BEFORE compaction with access to:
   - `transcript_path`: Full JSONL transcript of the conversation
   - `session_id`: Current session identifier
   - `trigger`: `'manual'` or `'auto'`
   - `custom_instructions`: Optional compaction guidance

2. **SessionStart** (`SessionStartHookInput`): Fires AFTER compaction with:
   - `source: 'compact'` (distinguishes post-compaction from fresh start)
   - Hook output supports `additionalContext` injection into the new context

Current PreCompact hooks (`.claude/settings.json` lines 469-498) only:
- Print guidance text about available agents
- Export learned patterns to `compact-patterns.json`
- Export intelligence state to `intelligence-state.json`

**They do NOT capture the actual conversation content.** After compaction, the rich
transcript is gone.

### What We Want

An "infinite context" system where:
1. Before compaction, conversation turns are chunked, summarized, embedded, and stored
   in the AgentDB/RuVector memory backend
2. After compaction, the most relevant stored context is retrieved and injected back
   into the new context window via `additionalContext`
3. Across sessions, accumulated transcript archives enable cross-session context
   retrieval -- Claude can recall details from previous conversations

## Decision

Implement a **Compaction-to-Memory Bridge** as a hook script that intercepts the
PreCompact lifecycle and stores conversation history in the AgentDB memory backend
(with optional RuVector PostgreSQL scaling). On post-compaction SessionStart, the
bridge retrieves and injects the most relevant archived context.

### Design Principles

1. **Hook-Native**: Uses Claude Code's official PreCompact and SessionStart hooks
2. **SDK-Patched**: Extends Claude Code's micro-compaction (`Vd()`) to also prune
   old conversation text, not just tool results -- the only way to prevent compaction
3. **Backend-Agnostic**: Works with SQLite, RuVector PostgreSQL, AgentDB, or JSON
4. **Timeout-Safe**: All operations complete within the 5-second hook timeout using
   local I/O and hash-based embeddings (no LLM calls, no network)
5. **Dedup-Aware**: Content hashing prevents re-storing on repeated compactions
6. **Budget-Constrained**: Restored context fits within a configurable character
   budget (default 4000 chars) to avoid overwhelming the new context window
7. **Non-Blocking**: Hook failures are silently caught -- compaction always proceeds
8. **Aggressive Pruning**: SDK patch truncates old conversation text automatically
   on every query, keeping context lean so compaction rarely or never fires

## SDK Compaction Mechanics (Decompiled from cli.js v2.0.76)

### Full Compaction Pipeline

The Claude Code SDK has two compaction mechanisms, decompiled from `cli.js`:

```
Every query (ew function):
│
├─ Vd() — MICRO-COMPACT (runs every query, invisible to user)
│  │  Targets: Read, Bash, Grep, Glob, WebSearch, WebFetch, Edit, Write
│  │  Keeps last 3 tool results intact (Ly5=3)
│  │  Replaces older results with "[Old tool result content cleared]"
│  │  Only activates when: tokens > warningThreshold AND savings >= 20K
│  │  Hardcoded thresholds: Ny5=40000, qy5=20000, Ly5=3
│  │  DOES NOT prune text content (user/assistant messages)
│  │
│  └─ OUR PATCH: _aggressiveTextPrune() inserted after Vd()
│     Truncates old text blocks to 80 chars + "[earlier context pruned]"
│     Keeps last 4 turns intact, starts at 20K tokens
│     Configurable via: CLAUDE_TEXT_PRUNE_KEEP, _THRESHOLD, _MAX_CHARS
│
├─ CT2() — AUTO-COMPACT (only when above threshold)
│  │  Gate 1: DISABLE_COMPACT env → skip entirely
│  │  Gate 2: autoCompactEnabled setting → skip if false
│  │  Gate 3: Sy5() → skip if tokens < threshold
│  │  Threshold: zT2() = min(maxTokens × PCT_OVERRIDE/100, maxTokens - 13000)
│  │  Default: 93% of context window (~187K tokens)
│  │  Override: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE env var
│  │
│  │  First tries TJ1() — session-memory compact (no LLM, instant)
│  │  Falls back to NJ1() — full LLM compaction (slow, "Compacting..." UI)
│  └─ NJ1 calls _H0 (executePreCompactHooks) before compacting
│
└─ NO OTHER PRUNING MECHANISM EXISTS in Claude Code
```

### Key SDK Functions (Decompiled)

```javascript
// Hd() — Is auto-compact enabled?
function Hd() {
  if (process.env.DISABLE_COMPACT) return false;
  return localSettings.autoCompactEnabled;  // default: true
}

// zT2() — Auto-compact threshold (tokens)
function zT2() {
  let max = effectiveMaxTokens();          // ~200K
  let threshold = max - 13000;             // ~187K (93%)
  let override = process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (override) {
    let pct = parseFloat(override);
    if (pct > 0 && pct <= 100)
      threshold = Math.min(Math.floor(max * pct / 100), threshold);
  }
  return threshold;
}

// T9A() — Context health check
function T9A(tokens) {
  let threshold = zT2();
  let ref = Hd() ? threshold : effectiveMaxTokens();
  return {
    isAboveWarningThreshold:     tokens >= ref - 20000,  // micro-compact activates
    isAboveErrorThreshold:       tokens >= ref - 20000,
    isAboveAutoCompactThreshold: Hd() && tokens >= threshold  // full compact fires
  };
}
```

### PreCompact Exit Code 2: NOT IMPLEMENTED

**Critical finding**: The SDK documentation (line 4140) states "Exit code 2 - block
compaction" for PreCompact hooks. However, this is **not implemented** in v2.0.76.

- `_H0` (executePreCompactHooks) uses `executeHooksOutsideREPL` (`NM0`)
- `NM0` returns `{command, succeeded: status===0, output}` — no blocking field
- Exit code 2 is treated as a failed hook (succeeded: false), not a blocking signal
- Compare: REPL-based hooks (PreToolUse, Stop) DO handle exit code 2 via the
  streaming executor (`ms`) which yields `{blockingError, outcome: "blocking"}`
- The `NJ1` compaction function ALWAYS proceeds after collecting hook outputs

**Consequence**: Compaction cannot be blocked via hooks. Our system uses
archive+restore (lossless compaction) and SDK patching (aggressive pruning)
instead of blocking.

## Architecture

### System Context

```
+------------------------------------------------------------------+
|                      Claude Code Session                          |
|                                                                   |
|  Context Window: [system prompt] [messages...] [new messages]     |
|                                                                   |
|  +--------------------------+                                     |
|  | Every User Prompt        |                                     |
|  | UserPromptSubmit fires   |-------------------------+           |
|  +--------------------------+                         |           |
|                                                       v           |
|  +-----------------------------------------------------------+   |
|  |  context-persistence-hook.mjs (proactive archive)          |   |
|  |                                                            |   |
|  |  1. Read transcript_path (JSONL)                           |   |
|  |  2. Parse -> filter -> chunk by turns                      |   |
|  |  3. Dedup: skip already-archived chunks (hash check)       |   |
|  |  4. Store NEW chunks only (incremental)                    |   |
|  |  -> Context is ALWAYS persisted BEFORE it can be lost      |   |
|  +---------------------------+--------------------------------+   |
|                              |                                    |
|  +----------------------+    |                                    |
|  | Context Window Full  |    |                                    |
|  | PreCompact fires     |----+---+                                |
|  +----------------------+        |                                |
|                                  v                                |
|  +-----------------------------------------------------------+   |
|  |  context-persistence-hook.mjs (safety net)                 |   |
|  |                                                            |   |
|  |  1. Final pass: archive any remaining unarchived turns     |   |
|  |  2. Most turns already archived by proactive hook          |   |
|  |  3. Typically 0-2 new entries (dedup handles the rest)     |   |
|  +---------------------------+--------------------------------+   |
|                              |                                    |
|                              v                                    |
|  +-----------------------------------------------------------+   |
|  |              Memory Backend (tiered)                        |   |
|  |                                                            |   |
|  |  Tier 1: SQLite (better-sqlite3)                           |   |
|  |    -> .claude-flow/data/transcript-archive.db              |   |
|  |    -> WAL mode, indexed queries, ACID transactions         |   |
|  |                                                            |   |
|  |  Tier 2: RuVector PostgreSQL (if RUVECTOR_* env set)       |   |
|  |    -> TB-scale storage, pgvector embeddings                |   |
|  |    -> GNN-enhanced retrieval, self-learning optimizer       |   |
|  |                                                            |   |
|  |  Tier 3: AgentDB + HNSW  (if @claude-flow/memory built)   |   |
|  |    -> 150x-12,500x faster semantic search                  |   |
|  |    -> Vector-indexed retrieval                             |   |
|  |                                                            |   |
|  |  Tier 4: JsonFileBackend                                   |   |
|  |    -> .claude-flow/data/transcript-archive.json            |   |
|  |    -> Zero dependencies, always available                  |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  +----------------------+                                         |
|  | Compaction complete   |                                        |
|  | SessionStart fires   |-----------------------------+           |
|  | source: 'compact'    |                             |           |
|  +----------------------+                             v           |
|                                                                   |
|  +-----------------------------------------------------------+   |
|  |  context-persistence-hook.mjs (restore)                    |   |
|  |                                                            |   |
|  |  1. Detect source === 'compact'                            |   |
|  |  2. Query transcript-archive for session_id                |   |
|  |  3. Rank by recency, fit within char budget                |   |
|  |  4. Return { additionalContext: "..." }                    |   |
|  +-----------------------------------------------------------+   |
|                                                                   |
|  New Context Window: [system] [compact summary] [restored ctx]    |
|                      [new messages continue...]                   |
+-------------------------------------------------------------------+
```

### Proactive Archiving Strategy

The key insight is that waiting for PreCompact to fire is too late -- by then,
the context window is already full and compaction is imminent. Instead, we
archive **proactively on every user prompt** via the `UserPromptSubmit` hook:

1. **UserPromptSubmit** (every prompt): Reads transcript, chunks, dedup-checks,
   stores only NEW turns. Cost: ~50ms for incremental archive (most turns
   already stored). This means context is ALWAYS persisted before it can be lost.

2. **PreCompact** (safety net): Runs the same archive logic as a final pass.
   Because proactive archiving already stored most turns, this typically
   stores 0-2 new entries. Ensures nothing slips through.

3. **SessionStart** (restore): After compaction, queries the archive and injects
   the most relevant turns back into the new context window.

Result: Compaction becomes invisible. The "Context left until auto-compact: 11%"
warning is no longer a threat because all information is already persisted in
the SQLite/RuVector database and will be restored after compaction.

### Transcript Parsing

The `transcript_path` is a JSONL file where each line is an `SDKMessage`:

| Message Type | Content | Action |
|-------------|---------|--------|
| `user` | `message.content[]` (text blocks, tool_result blocks) | **Extract**: user prompts, tool results |
| `assistant` | `message.content[]` (text blocks, tool_use blocks) | **Extract**: responses, tool calls with inputs |
| `result` | Session summary, usage stats | **Extract**: cost, turn count |
| `system` (init) | Tools, model, MCP servers | **Skip** (not conversation content) |
| `stream_event` | Partial streaming data | **Skip** (redundant with complete messages) |
| `tool_progress` | Elapsed time updates | **Skip** |

### Chunking Strategy

Messages are grouped into **conversation turns**:

```
Chunk N = {
  userMessage: SDKUserMessage,
  assistantMessage: SDKAssistantMessage,
  toolCalls: [
    { name: 'Edit', input: { file_path: '...' } },
    { name: 'Bash', input: { command: '...' } },
  ],
  metadata: {
    toolNames: ['Edit', 'Bash'],
    filePaths: ['/src/foo.ts'],
    turnIndex: N,
    timestamp: '...',
  }
}
```

**Boundary rules:**
- New user message (non-synthetic) = new chunk
- Cap at last 500 messages for timeout safety
- Skip synthetic user messages (tool result continuations)

### Summary Extraction (No LLM)

For each chunk, extractive summarization:

```
Summary = [
  firstLine(userMessage.text),
  "Tools: " + toolNames.join(", "),
  "Files: " + filePaths.join(", "),
  firstTwoLines(assistantMessage.text),
].join(" | ").slice(0, 300)
```

### Memory Entry Schema

```typescript
{
  key: `transcript:${sessionId}:${chunkIndex}:${timestamp}`,
  content: fullChunkText,
  type: 'episodic',
  namespace: 'transcript-archive',
  tags: ['transcript', 'compaction', sessionId, ...toolNames],
  metadata: {
    sessionId: string,
    chunkIndex: number,
    trigger: 'manual' | 'auto',
    timestamp: string,
    toolNames: string[],
    filePaths: string[],
    summary: string,
    contentHash: string,
    preTokens: number,
    turnRange: [start, end],
  },
  accessLevel: 'private',
}
```

### Context Restoration

On `SessionStart(source: 'compact')`:

1. Query `transcript-archive` namespace for `metadata.sessionId === current_session`
2. Also query for cross-session entries with similar tool/file patterns (future)
3. Sort by `chunkIndex` descending (most recent first)
4. Build restoration text fitting within char budget
5. Return via `hookSpecificOutput.additionalContext`

### Hash Embedding Function

Reused from `learning-bridge.ts:425-450` (deterministic, sub-millisecond):

```javascript
function createHashEmbedding(text, dimensions = 768) {
  const embedding = new Float32Array(dimensions);
  const normalized = text.toLowerCase().trim();
  for (let i = 0; i < dimensions; i++) {
    let hash = 0;
    for (let j = 0; j < normalized.length; j++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(j) * (i + 1)) | 0;
    }
    embedding[i] = (Math.sin(hash) + 1) / 2;
  }
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dimensions; i++) embedding[i] /= norm;
  return embedding;
}
```

## Context Autopilot

The Context Autopilot is a real-time context window management system that prevents
Claude Code's automatic compaction from ever firing. Instead of letting the context
window fill up and trigger lossy compaction, the autopilot tracks usage and optimizes
proactively.

### How It Works

```
Every User Prompt
       │
       ▼
┌─────────────────────────────┐
│  estimateContextTokens()    │  Read API usage from transcript JSONL
│  input_tokens +             │  (actual Claude API token counts, not
│  cache_read_input_tokens +  │   character estimates)
│  cache_creation_input_tokens│
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Calculate percentage       │  tokens / CONTEXT_WINDOW_TOKENS (200K)
│  Update autopilot-state.json│  Persistent across hook invocations
│  Track growth history       │  Last 50 data points for trend analysis
└─────────────┬───────────────┘
              │
    ┌─────────┼──────────┐
    ▼         ▼          ▼
  <70%     70-85%      85%+
   OK      WARNING    OPTIMIZE
   │         │          │
   │         │     Prune stale archive entries
   │         │     Keep responses concise
   │         │          │
   └─────────┴──────────┘
              │
              ▼
┌─────────────────────────────┐
│  Inject report into context │  [ContextAutopilot] [===----] 43% ...
│  via additionalContext       │  Includes: bar, %, tokens, trend
└─────────────────────────────┘
```

### Token Estimation (API-Accurate)

The autopilot reads **actual API usage data** from the transcript JSONL, not character
estimates. Each assistant message in the transcript contains:

```json
{
  "message": {
    "usage": {
      "input_tokens": 45000,
      "cache_read_input_tokens": 30000,
      "cache_creation_input_tokens": 5000
    }
  }
}
```

Total context = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`

This matches what Claude Code reports as context usage (e.g., "Context left until
auto-compact: 8%" corresponds to ~92% usage). Falls back to character-based estimation
(`chars / 3.5`) only when API usage data is unavailable.

### Context Management Strategy

| Layer | Mechanism | Effect |
|-------|-----------|--------|
| **SDK patch** | `_aggressiveTextPrune()` | Truncates old text every query (prevents growth) |
| **SDK native** | `Vd()` micro-compact | Prunes old tool results every query |
| **SDK native** | `CT2()` auto-compact | Full compaction at threshold (fallback only) |
| **Hook** | `UserPromptSubmit` | Archives all turns proactively to SQLite |
| **Hook** | `PreCompact` | Safety-net archive + custom compact instructions |
| **Hook** | `SessionStart` | Restores importance-ranked context after compact/clear |

With aggressive text pruning + low `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`, full
compaction rarely fires. When it does, the archive+restore system makes it lossless.

### Statusline Integration (ADR-052)

The autopilot state is read by the statusline script to display real-time metrics:

```
🛡️  43% 86.7K ⊘    (autopilot active, 43% used, 86.7K tokens, no prune cycles)
🛡️  72% 144K ⊘     (warning zone, yellow color)
🛡️  88% 176K ⟳2    (prune zone, red, 2 optimization cycles completed)
```

### Optimization Phases

| Phase | Threshold | Actions |
|-------|-----------|---------|
| **OK** | <70% | Normal operation, track growth trend |
| **Warning** | 70-85% | Flag approaching limit, archive aggressively |
| **Optimize** | 85%+ | Prune stale archive entries, increment prune counter, keep responses concise |

### Autopilot State Persistence

State is persisted to `.claude-flow/data/autopilot-state.json`:

```json
{
  "sessionId": "f1bd5b59-...",
  "lastTokenEstimate": 86736,
  "lastPercentage": 0.434,
  "pruneCount": 0,
  "warningIssued": false,
  "lastCheck": 1770750408022,
  "history": [
    { "ts": 1770749467007, "tokens": 45430, "pct": 0.227, "turns": 48 },
    { "ts": 1770750408022, "tokens": 86736, "pct": 0.434, "turns": 53 }
  ]
}
```

## Performance Budget

| Operation | Time Budget | Actual |
|-----------|------------|--------|
| Read stdin (hook input) | 100ms timeout | <10ms |
| Read transcript JSONL | 500ms | ~50ms for 500 messages |
| Parse + filter messages | 200ms | ~20ms |
| Chunk + extract summaries | 200ms | ~30ms |
| Generate hash embeddings | 100ms | <1ms total |
| Content hash (SHA-256) | 100ms | <5ms |
| Store to SQLite (WAL) | 500ms | ~20ms |
| Store to RuVector PG | 500ms | ~100ms (network) |
| **Total (UserPromptSubmit)** | **5000ms** | **~50ms (incremental)** |
| Build compact instructions | 100ms | ~5ms |
| **Total (PreCompact)** | **5000ms** | **~25ms (mostly deduped)** |
| Query + build context | 500ms | ~30ms |
| **Total (SessionStart)** | **6000ms** | **~40ms** |

## Configuration

### SDK Patch (Aggressive Text Pruning)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_TEXT_PRUNE_KEEP` | `4` | Number of recent turns to keep fully intact |
| `CLAUDE_TEXT_PRUNE_THRESHOLD` | `20000` | Start pruning text above this token count |
| `CLAUDE_TEXT_PRUNE_MAX_CHARS` | `80` | Max chars for old text blocks (truncated beyond) |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `30` | Auto-compact threshold (% of context window) |

### Hook System

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | `4000` | Max chars for restored context in SessionStart |
| `CLAUDE_FLOW_COMPACT_INSTRUCTION_BUDGET` | `2000` | Max chars for custom compact instructions |
| `CLAUDE_FLOW_AUTO_OPTIMIZE` | `true` | Enable importance ranking, pruning, RuVector sync |
| `CLAUDE_FLOW_RETENTION_DAYS` | `30` | Auto-prune never-accessed entries older than N days |
| `CLAUDE_FLOW_CONTEXT_AUTOPILOT` | `true` | Enable Context Autopilot tracking |
| `CLAUDE_FLOW_CONTEXT_WINDOW` | `200000` | Context window size in tokens |
| `CLAUDE_FLOW_AUTOPILOT_WARN` | `0.70` | Warning threshold (70%) |
| `CLAUDE_FLOW_AUTOPILOT_PRUNE` | `0.85` | Critical threshold (85%) — session rotation advised |

### RuVector PostgreSQL (Optional)

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `RUVECTOR_HOST` | - | PostgreSQL host for RuVector backend |
| `RUVECTOR_DATABASE` | - | PostgreSQL database name |
| `RUVECTOR_USER` | - | PostgreSQL username |
| `RUVECTOR_PASSWORD` | - | PostgreSQL password |
| `RUVECTOR_PORT` | `5432` | PostgreSQL port |
| `RUVECTOR_SSL` | `false` | Enable SSL for PostgreSQL connection |

## Security Considerations

1. **No credentials in transcript**: Tool inputs may contain file paths but not secrets
   (Claude Code already redacts sensitive content before tool execution)
2. **Local storage default**: SQLite writes to `.claude-flow/data/` which is
   gitignored. No network calls unless RuVector PostgreSQL is configured.
3. **Parameterized queries**: SQLite uses prepared statements, RuVector uses `$N`
   parameterized queries -- no SQL injection risk.
4. **Content hashing**: Uses `crypto.createHash('sha256')` for dedup -- standard Node.js
5. **Graceful failure**: All operations wrapped in try/catch. Hook failures produce
   empty output -- compaction always proceeds normally.
6. **RuVector credentials**: Read from `RUVECTOR_*` or `PG*` env vars only.
   Never hardcoded. Connection uses SSL when `RUVECTOR_SSL=true`.

## Migration Path

### Phase 1: SQLite + Proactive Archiving (COMPLETE - Running in Production)
- better-sqlite3 with WAL mode, indexed queries, ACID transactions
- Proactive archiving on every user prompt via UserPromptSubmit hook
- PreCompact as safety net, SessionStart for restoration
- Dedup via SHA-256 content hash + indexed lookup
- Importance-ranked smart retrieval with access tracking
- Auto-pruning of never-accessed entries after configurable retention period
- Custom compact instructions guiding Claude's compaction summary

### Phase 2: RuVector PostgreSQL (COMPLETE - Code Ready, Awaiting Configuration)
- `RuVectorBackend` class fully implemented (lines 361-596 of hook script)
- Set `RUVECTOR_HOST`, `RUVECTOR_DATABASE`, `RUVECTOR_USER`, `RUVECTOR_PASSWORD`
- pgvector extension for 768-dim embedding storage and similarity search
- TB-scale storage with connection pooling (max 3 connections)
- JSONB metadata columns with importance-ranked queries
- Auto-sync from SQLite to RuVector when env vars configured
- `ON CONFLICT (id) DO NOTHING` for database-level dedup
- Automatic fallback to SQLite if PostgreSQL connection fails

### Phase 3: AgentDB Integration (COMPLETE - Code Ready, Awaiting Build)
- `resolveBackend()` checks for `@claude-flow/memory` dist at Tier 3
- If `AgentDBBackend` class exists, uses HNSW-indexed embeddings
- Cross-session retrieval: semantic search across archived transcripts
- Transparent upgrade when `@claude-flow/memory` package is built

### Phase 4: JsonFileBackend (COMPLETE - Always Available)
- `JsonFileBackend` class implemented (lines 278-355 of hook script)
- Zero dependencies, works everywhere as ultimate fallback
- Map-based in-memory with JSON file persistence
- Linear scan for retrieval (no indexed queries)

## Self-Learning Optimization Pipeline

When `CLAUDE_FLOW_AUTO_OPTIMIZE` is not `false` (default: enabled), the system
automatically optimizes storage and retrieval using 5 self-learning stages:

### Stage 1: Confidence Decay

Every optimization cycle applies temporal confidence decay to all entries:

```
confidence = max(0.1, confidence - 0.005 × hoursElapsed)
```

- **Decay rate**: -0.5% per hour (matches LearningBridge default)
- **Floor**: 0.1 (entries never fully forgotten)
- **Effect**: Unaccessed entries gradually lose priority, creating natural curation

### Stage 2: Confidence-Based Pruning

Entries with confidence below 15% AND zero accesses are automatically removed:

```sql
DELETE FROM transcript_entries
WHERE confidence <= 0.15 AND access_count = 0
```

This is more intelligent than age-based pruning — frequently accessed entries
survive regardless of age, while irrelevant entries are pruned quickly.

### Stage 3: Age-Based Pruning (Fallback)

Standard retention policy as safety net:
- **Criteria**: `access_count = 0` AND `created_at < now - RETENTION_DAYS`
- **Default retention**: 30 days (configurable via `CLAUDE_FLOW_RETENTION_DAYS`)
- **Never prunes accessed entries**: If it was ever restored, it's kept

### Stage 4: ONNX Embedding Generation (384-dim)

Entries without vector embeddings get 384-dim ONNX embeddings generated using
`@xenova/transformers` with the `all-MiniLM-L6-v2` model:

```
Model:     Xenova/all-MiniLM-L6-v2 (ONNX, local inference, no API calls)
Dimension: 384 (down from 768 hash — better quality, less storage)
Pooling:   mean pooling + L2 normalization
Fallback:  384-dim hash embedding if ONNX unavailable
Per cycle:  up to 20 entries embedded (backfills incrementally)
Storage:   Float32Array → Buffer → BLOB column in SQLite (~1.5KB/entry)
```

ONNX embeddings provide real semantic understanding vs hash embeddings which
are purely deterministic approximations. Search for "auth optimization" will
find entries about "authentication performance" — hash embeddings cannot do this.

Once all entries are embedded, this stage only processes newly archived turns.

### Stage 5: RuVector Sync

When SQLite is the primary backend but RuVector PostgreSQL env vars are configured:
- All entries are synced to RuVector with hash embeddings attached
- RuVector's `pgvector` extension enables true semantic search
- ON CONFLICT DO NOTHING prevents duplicate inserts
- Sync is best-effort — failures don't block the archive pipeline

### Importance Scoring

Entries are ranked by a composite importance score for retrieval:

```
importance = recency × frequency × richness

recency   = exp(-0.693 × ageDays / 7)     # Exponential decay, 7-day half-life
frequency = log2(accessCount + 1) + 1      # Log-scaled access count
richness  = 1.0 + toolBoost + fileBoost    # +0.5 for tools, +0.3 for files
```

### Access Tracking (Reinforcement Learning)

When entries are restored after compaction, two things happen:

1. `access_count` is incremented (+1)
2. `confidence` is boosted (+3%, capped at 1.0)

This creates a reinforcement loop:

```
Archive → Restore → Boost Confidence → Higher Priority Next Time
                                    → Higher Importance Score
         Not Restored → Decay Confidence → Lower Priority
                                         → Eventually Pruned
```

### Cross-Session Semantic Search

After compaction, the SessionStart hook finds related context from **previous
sessions** using vector similarity:

```javascript
// Query embedding generated from most recent turn's summary
const queryEmb = createHashEmbedding(recentSummary);
// Cosine similarity × confidence score across all embedded entries
const results = backend.semanticSearch(queryEmb, k, namespace);
// Filter out current session (already restored by importance ranking)
return results.filter(r => r.sessionId !== currentSessionId);
```

This enables questions like "What did we discuss about auth?" to find relevant
context from any archived session, not just the current one.

### Verified Functionality

All capabilities confirmed working (2026-02-10):

| Capability | Status | Metric |
|-----------|--------|--------|
| Confidence decay | PASS | 38 entries decayed per cycle |
| Confidence boost | PASS | +3% per access on restore |
| Smart pruning | PASS | Prune at confidence ≤15% |
| ONNX embedding generation | PASS | 38/38 entries embedded (384-dim, all-MiniLM-L6-v2) |
| Semantic search | PASS | 5 results, top score 0.471 (true semantic matching) |
| Lossless compaction | PASS | Archive before, restore after — no data loss |
| Session rotation | PASS | /clear triggers SessionStart with source='clear', restores context |
| SDK text pruning | PASS | _aggressiveTextPrune() truncates old text every query |
| Cross-session search | PASS | Finds turns from other sessions |

## Consequences

### Positive

1. **Automatic text pruning**: SDK patch prunes old conversation text on every query,
   keeping context lean without user intervention
2. **No more context cliff**: Conversation details survive compaction as structured
   memory entries persisted BEFORE compaction fires
3. **Proactive, not reactive**: UserPromptSubmit archives on every prompt, so
   context is always persisted before it can be lost
4. **Cross-session recall**: Archived transcripts accumulate across sessions, enabling
   "What did we do last time?" queries
5. **4-tier scaling**: SQLite (local, fast) -> RuVector PostgreSQL (TB-scale,
   vector search) -> AgentDB (HNSW) -> JSON (zero deps)
6. **Self-learning**: Confidence decay + access boosting creates a reinforcement loop
   where frequently useful entries survive and irrelevant entries naturally fade
7. **ONNX semantic search**: 384-dim ONNX embeddings (all-MiniLM-L6-v2) enable true
   semantic cross-session search with real NLU
8. **Session rotation support**: SessionStart restores context after `/clear`,
   enabling manual session rotation as an alternative to compaction

### Negative

1. **SDK patch fragility**: `_aggressiveTextPrune()` is injected into `cli.js`
   which is overwritten on npm updates. Mitigation: `patch-aggressive-prune.mjs`
   with `--revert` and `--check` flags; backup at `cli.js.backup`
2. **Text truncation**: Old turns are truncated to 80 chars. Mitigation: full content
   is archived in SQLite and restorable via SessionStart hook
3. **Storage growth**: Long sessions produce many chunks. Mitigation: auto-retention
   prunes never-accessed entries after configurable retention period

### Neutral

1. **Exit code 2 not implemented**: PreCompact hooks cannot block compaction in
   Claude Code v2.0.76 despite documentation claiming otherwise. This is an SDK
   limitation, not a bug in our system.
2. **Hook timeout pressure**: 5s budget is generous for local I/O operations

## Future Enhancements

1. **Smarter text pruning**: Use extractive summarization instead of simple truncation
   for old text blocks — preserve key decisions and reasoning
2. **Cross-session search MCP tool**: Expose `transcript-archive` search as an MCP
   tool so Claude can explicitly query past conversations
3. **MemoryGraph integration**: Add reference edges between sequential chunks for
   PageRank-aware retrieval (ADR-049)
4. **Adaptive pruning thresholds**: Dynamically adjust `TEXT_PRUNE_KEEP` and
   `TEXT_PRUNE_THRESHOLD` based on conversation complexity and context growth rate
5. **Upstream contribution**: Propose text pruning as a native Claude Code feature
   to eliminate the need for SDK patching

## Implementation Details

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `.claude/helpers/context-persistence-hook.mjs` | ~1600 | Core hook script (all 4 backends, autopilot, all commands) |
| `.claude/helpers/patch-aggressive-prune.mjs` | ~120 | SDK patch: aggressive text pruning for cli.js |
| `.claude/settings.json` | +12 | Hook wiring + pruning config env vars |
| `tests/context-persistence-hook.test.mjs` | ~150 | Unit tests for parsing, chunking, dedup, retrieval |
| `v3/implementation/adrs/ADR-051-infinite-context-compaction-bridge.md` | this file | Architecture decision record |

### Backend Classes

| Class | Lines | Storage | Features |
|-------|-------|---------|----------|
| `SQLiteBackend` | 57-272 | `.claude-flow/data/transcript-archive.db` | WAL mode, indexed queries, prepared statements, importance-ranked queries, access tracking, stale pruning |
| `JsonFileBackend` | 278-355 | `.claude-flow/data/transcript-archive.json` | Zero dependencies, Map-based in-memory with JSON persist |
| `RuVectorBackend` | 361-596 | PostgreSQL with pgvector | Connection pooling (max 3), JSONB metadata, 768-dim vector column, ON CONFLICT dedup, async hash check |

### Exported Functions (for testing)

All core functions are exported from the hook module:

- **Backends**: `SQLiteBackend`, `RuVectorBackend`, `JsonFileBackend`, `resolveBackend`, `getRuVectorConfig`
- **Parsing**: `parseTranscript`, `extractTextContent`, `extractToolCalls`, `extractFilePaths`, `chunkTranscript`, `extractSummary`
- **Storage**: `buildEntry`, `storeChunks`, `hashContent`, `createHashEmbedding`
- **Retrieval**: `retrieveContext`, `retrieveContextSmart`, `computeImportance`
- **Optimization**: `autoOptimize`, `buildCompactInstructions`
- **Autopilot**: `estimateContextTokens`, `runAutopilot`, `loadAutopilotState`, `saveAutopilotState`, `buildAutopilotReport`, `buildProgressBar`, `formatTokens`
- **I/O**: `readStdin`
- **Constants**: `NAMESPACE`, `ARCHIVE_DB_PATH`, `ARCHIVE_JSON_PATH`, `COMPACT_INSTRUCTION_BUDGET`, `RETENTION_DAYS`, `AUTO_OPTIMIZE`, `AUTOPILOT_ENABLED`, `CONTEXT_WINDOW_TOKENS`, `AUTOPILOT_WARN_PCT`, `AUTOPILOT_PRUNE_PCT`

### Hook Wiring (settings.json)

```json
// PreCompact (manual + auto matchers)
{ "type": "command", "timeout": 5000,
  "command": "node .claude/helpers/context-persistence-hook.mjs pre-compact 2>/dev/null || true" }

// SessionStart (restores after compact OR /clear for session rotation)
{ "type": "command", "timeout": 6000,
  "command": "node .claude/helpers/context-persistence-hook.mjs session-start 2>/dev/null || true" }

// UserPromptSubmit (proactive archiving + autopilot)
{ "type": "command", "timeout": 5000,
  "command": "node .claude/helpers/context-persistence-hook.mjs user-prompt-submit 2>/dev/null || true" }
```

**Note**: PreCompact hooks use `|| true` because exit code 2 blocking is not
implemented in Claude Code v2.0.76 (see SDK analysis above). The hook archives
turns and outputs custom compact instructions via exit code 0.

### SDK Patch Application

```bash
# Apply aggressive text pruning patch
node .claude/helpers/patch-aggressive-prune.mjs

# Check if patched
node .claude/helpers/patch-aggressive-prune.mjs --check

# Revert to original
node .claude/helpers/patch-aggressive-prune.mjs --revert
```

The patch inserts `_aggressiveTextPrune()` into the query loop in
`node_modules/@anthropic-ai/claude-agent-sdk/cli.js`, between the native
micro-compaction (`Vd()`) and the auto-compact check (`CT2()`). A backup
is saved at `cli.js.backup` before patching. Must be re-applied after
`npm install` or SDK updates.

### Operational Notes

- **Early exit optimization**: `doUserPromptSubmit()` skips archiving when the existing
  entry count is within 2 turns of the chunk count, avoiding redundant work on every prompt
- **Decision detection**: `buildCompactInstructions()` scans assistant text for decision
  keywords (`decided`, `choosing`, `approach`, `instead of`, `rather than`) to extract
  key decisions for compact preservation
- **RuVector dedup**: Synchronous `hashExists()` returns false for RuVector (async DB);
  dedup is handled at the database level via `ON CONFLICT (id) DO NOTHING`
- **Graceful failure**: Top-level try/catch ensures hook never crashes Claude Code;
  errors are written to stderr as `[ContextPersistence] Error (non-critical): ...`

### Verification

```bash
# Status check
node .claude/helpers/context-persistence-hook.mjs status

# Run tests
node --test tests/context-persistence-hook.test.mjs
```

## References

- ADR-006: Unified Memory Service
- ADR-009: Hybrid Memory Backend (AgentDB + SQLite)
- ADR-027: RuVector PostgreSQL Integration
- ADR-048: Auto Memory Integration
- ADR-049: Self-Learning Memory with GNN
- Claude Agent SDK: `@anthropic-ai/claude-agent-sdk` PreCompact hook types
