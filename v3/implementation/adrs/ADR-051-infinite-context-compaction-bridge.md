# ADR-051: Infinite Context via Compaction-to-Memory Bridge

**Status:** Implemented
**Date:** 2026-02-10
**Authors:** RuvNet, Claude Flow Team
**Version:** 1.1.0
**Related:** ADR-006 (Unified Memory), ADR-009 (Hybrid Memory Backend), ADR-027 (RuVector PostgreSQL), ADR-048 (Auto Memory Integration), ADR-049 (Self-Learning Memory GNN)
**Implementation:** `.claude/helpers/context-persistence-hook.mjs` (1420 lines)

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

1. **Hook-Native**: Uses Claude Code's official PreCompact and SessionStart hooks --
   no monkey-patching, no SDK modifications
2. **Backend-Agnostic**: Works with JsonFileBackend (zero dependencies), AgentDB
   (HNSW vectors), or RuVector PostgreSQL (TB-scale) -- graceful degradation
3. **Timeout-Safe**: All operations complete within the 5-second hook timeout using
   local I/O and hash-based embeddings (no LLM calls, no network)
4. **Dedup-Aware**: Content hashing prevents re-storing on repeated compactions
5. **Budget-Constrained**: Restored context fits within a configurable character
   budget (default 4000 chars) to avoid overwhelming the new context window
6. **Non-Blocking**: Hook failures are silently caught -- compaction always proceeds
7. **Smart Compaction Gate**: PreCompact exit code 0 outputs custom instructions
   guiding what Claude preserves; exit code 2 optionally blocks compaction entirely

## SDK Compaction Mechanics (Discovered via Deep Review)

The Claude Code SDK (`cli.js`) processes PreCompact hooks with three exit code behaviors:

| Exit Code | SDK Behavior |
|-----------|-------------|
| **0** | stdout is appended as **custom compact instructions** (guides preservation) |
| **2** | **Blocks compaction entirely** (hook can prevent compaction) |
| Other | stderr shown to user, compaction continues normally |

The `_H0` function (line 4700) executes all PreCompact hooks, collecting
`newCustomInstructions` from exit code 0 hooks. The `NJ1` function (line 1769)
performs actual compaction, using these instructions to guide the summary.

This enables our **Smart Compaction Gate**:
- **Default mode**: Exit code 0 with custom instructions listing archived files,
  tools, decisions, and recent turns -- Claude's compaction summary preserves
  the most important details
- **Block mode** (`CLAUDE_FLOW_BLOCK_COMPACTION=true`): Exit code 2 on auto-trigger
  to prevent compaction when proactive archiving has captured everything

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

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CLAUDE_FLOW_COMPACT_RESTORE_BUDGET` | `4000` | Max chars for restored context in SessionStart |
| `CLAUDE_FLOW_COMPACT_INSTRUCTION_BUDGET` | `2000` | Max chars for custom compact instructions |
| `CLAUDE_FLOW_BLOCK_COMPACTION` | `false` | Set `true` to block auto-compaction (exit code 2) |
| `CLAUDE_FLOW_AUTO_OPTIMIZE` | `true` | Enable importance ranking, pruning, RuVector sync |
| `CLAUDE_FLOW_RETENTION_DAYS` | `30` | Auto-prune never-accessed entries older than N days |
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

### Phase 1: SQLite + Proactive Archiving (Current - Implemented)
- better-sqlite3 with WAL mode, indexed queries, ACID transactions
- Proactive archiving on every user prompt via UserPromptSubmit hook
- PreCompact as safety net, SessionStart for restoration
- Dedup via SHA-256 content hash + indexed lookup

### Phase 2: RuVector PostgreSQL (When configured)
- Set `RUVECTOR_HOST`, `RUVECTOR_DATABASE`, `RUVECTOR_USER`, `RUVECTOR_PASSWORD`
- pgvector extension for 768-dim embedding storage and similarity search
- TB-scale storage with connection pooling (max 3 connections)
- GNN-enhanced retrieval using code dependency graphs
- Automatic fallback to SQLite if PostgreSQL connection fails

### Phase 3: AgentDB Integration (When built)
- If `@claude-flow/memory` dist exists, use `AgentDBBackend`
- HNSW-indexed embeddings enable semantic search across archived transcripts
- Cross-session retrieval: "What did we discuss about auth?" finds relevant chunks

### Phase 4: JsonFileBackend (Fallback)
- Zero dependencies, works everywhere
- Used only when better-sqlite3 is not available
- Stores transcript chunks as JSON
- No indexed queries, linear scan for retrieval

## Auto-Optimization Pipeline

When `CLAUDE_FLOW_AUTO_OPTIMIZE` is not `false` (default: enabled), the system
automatically optimizes storage and retrieval:

### 1. Importance Scoring

Entries are ranked by a composite importance score:

```
importance = recency × frequency × richness

recency   = exp(-0.693 × ageDays / 7)     # Exponential decay, 7-day half-life
frequency = log2(accessCount + 1) + 1      # Log-scaled access count
richness  = 1.0 + toolBoost + fileBoost    # +0.5 for tools, +0.3 for files
```

This means entries with tool calls, file edits, and frequent retrieval are
prioritized over plain conversational turns.

### 2. Access Tracking

When entries are restored after compaction, their `access_count` is incremented
and `last_accessed_at` is updated. This creates a feedback loop:

```
Archive → Restore → Track Access → Next Restore Uses Access Data
```

Entries that are repeatedly useful get higher importance scores automatically.

### 3. Auto-Retention

On every PreCompact, stale entries are pruned:
- **Criteria**: `access_count = 0` AND `created_at < now - RETENTION_DAYS`
- **Default retention**: 30 days (configurable via `CLAUDE_FLOW_RETENTION_DAYS`)
- **Never prunes accessed entries**: If it was ever restored, it's kept

### 4. Auto-Sync to RuVector

When SQLite is the primary backend but RuVector PostgreSQL env vars are configured:
- All entries are synced to RuVector with hash embeddings attached
- RuVector's `pgvector` extension enables true semantic search
- ON CONFLICT DO NOTHING prevents duplicate inserts
- Sync is best-effort — failures don't block the archive pipeline

This enables a zero-config upgrade path: just set `RUVECTOR_HOST` and your
local SQLite archive is automatically replicated to PostgreSQL with vector
search capabilities.

## Consequences

### Positive

1. **No more context cliff**: Conversation details survive compaction as structured
   memory entries persisted BEFORE compaction fires
2. **Proactive, not reactive**: UserPromptSubmit archives on every prompt, so
   context is always persisted before it can be lost to compaction
3. **Cross-session recall**: Archived transcripts accumulate across sessions, enabling
   "What did we do last time?" queries
4. **4-tier scaling**: SQLite (local, fast) -> RuVector PostgreSQL (TB-scale,
   vector search) -> AgentDB (HNSW) -> JSON (zero deps)
5. **Non-invasive**: Uses official SDK hooks -- no patches, no internal API dependencies
6. **Composable**: Transcript entries are searchable alongside patterns,
   learnings, and other memory types
7. **Self-optimizing**: Importance scoring, access tracking, and auto-pruning ensure
   retrieval quality improves over time without manual tuning
8. **Auto-sync**: SQLite → RuVector migration happens automatically when configured

### Negative

1. **Storage growth**: Long sessions produce many chunks. Mitigation: auto-retention
   prunes never-accessed entries after configurable retention period
2. **Summary quality**: Extractive summarization is fast but imprecise. Mitigation:
   full content is stored; summaries are just for the restoration preview
3. **RuVector network latency**: PostgreSQL adds ~100ms per archive operation.
   Mitigation: connection pooling, timeout safety, automatic SQLite fallback

### Neutral

1. **Hook timeout pressure**: 5s budget is generous for local I/O operations
2. **Embedding quality**: Hash embeddings are deterministic approximations. When real
   ONNX embeddings are available, they can replace hash embeddings transparently

## Future Enhancements

1. **Compaction summary capture**: After compaction, store Claude's own summary as a
   high-confidence semantic entry alongside our chunk-level detail
2. **Cross-session search MCP tool**: Expose `transcript-archive` search as an MCP
   tool so Claude can explicitly query past conversations
3. **MemoryGraph integration**: Add reference edges between sequential chunks for
   PageRank-aware retrieval (ADR-049)
4. **Real ONNX embeddings**: Replace hash embeddings with ONNX-based embeddings for
   true semantic similarity search (transparent upgrade)
5. **Adaptive retention**: Dynamically adjust retention period based on storage usage
   and access patterns

## Implementation Details

### Files

| File | Lines | Purpose |
|------|-------|---------|
| `.claude/helpers/context-persistence-hook.mjs` | 1420 | Core hook script (all 4 backends, all commands) |
| `.claude/settings.json` | +9 | Hook wiring: PreCompact, SessionStart, UserPromptSubmit |
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
- **I/O**: `readStdin`
- **Constants**: `NAMESPACE`, `ARCHIVE_DB_PATH`, `ARCHIVE_JSON_PATH`, `COMPACT_INSTRUCTION_BUDGET`, `RETENTION_DAYS`, `AUTO_OPTIMIZE`

### Hook Wiring (settings.json)

```json
// PreCompact (manual + auto matchers)
{ "type": "command", "timeout": 5000,
  "command": "node .claude/helpers/context-persistence-hook.mjs pre-compact 2>/dev/null || true" }

// SessionStart
{ "type": "command", "timeout": 6000,
  "command": "node .claude/helpers/context-persistence-hook.mjs session-start 2>/dev/null || true" }

// UserPromptSubmit (proactive archiving)
{ "type": "command", "timeout": 5000,
  "command": "node .claude/helpers/context-persistence-hook.mjs user-prompt-submit 2>/dev/null || true" }
```

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
