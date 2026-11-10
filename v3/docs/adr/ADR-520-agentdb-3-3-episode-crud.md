# ADR-520: Episode get / list / update / delete over agentdb 3.3

- **Status:** Accepted
- **Date:** 2026-11-01
- **Depends on:** ADR-519 (episode recall), agentdb ADR-017 (full CRUD, agentdb 3.3.0)

## Context

ADR-519 made ruflo store a session-end summary as an agentdb episode and recall episodes with
`agentdb_episode-recall`. Those episodes could be created and searched, but not read by id, listed,
corrected or removed. A session-end episode is stored with `reward: 0, success: false` because nobody
has verified it; once someone has, there was no way to record that without creating a duplicate.

agentdb 3.3.0 adds in-place episode updates that keep the id and re-index the record (SQL row,
embedding, vector entry, BM25 keyword index), plus `getEpisode` and `listEpisodes`, and fixes
`deleteEpisode` (it no longer `parseInt`s ids or leaves the vector entry behind).

## Decision

Four MCP tools in a new module, `mcp-tools/agentdb-episode-tools.ts`, registered with the other
`agentdb_*` tools:

| tool | agentdb call |
|---|---|
| `agentdb_episode-get` | `ReflexionMemory.getEpisode(id)` |
| `agentdb_episode-list` | `listEpisodes({sessionId, success, limit ≤ 100, offset, order})` |
| `agentdb_episode-update` | `updateEpisode(id, patch, {replaceMetadata})` |
| `agentdb_episode-delete` | `deleteEpisode(id)` |

The bridge side lives in `memory/episode-crud.ts`, which reaches the controller through one new
memory-bridge export, `withReflexionController`, so every call holds a bridge-operation lease like the
rest of the bridge (shutdown waits for it). `memory-bridge.ts` grows by 13 lines.

Rules:

- **Strict ids.** Only positive integers (`7` or `"7"`); `"12-notes"` is rejected before agentdb is called.
- **Feature detection.** On agentdb < 3.3 each tool answers "needs agentdb >= 3.3.0". Delete is gated
  on `getEpisode` too, so the pre-3.3 `deleteEpisode` (parseInt ids, orphaned vectors) is never used.
- **Update fields.** `task`, `critique`, `output` (null clears the last two), `reward` in [0, 1],
  `success`, `tags` (≤ 64 × 128 chars), `metadata` (object, ≤ 64 KB, no `__proto__` / `constructor` /
  `prototype` at any depth; merged unless `replaceMetadata`). Unknown fields are rejected so a typo is
  not a silent no-op. Ids, timestamps and the session are not writable.
- **Bounded output.** Text fields are cut to 4,000 characters and the embedding is never returned.
  Error messages from agentdb pass through (they are validation messages) with paths stripped.

Intended use: after verifying a session's outcome, mark its episode with
`agentdb_episode-update({ id, success: true, reward: 0.9, critique: "…" })`. Recall then ranks it with
the real outcome, and the id that references it stays valid.

## Dependency

`agentdb ^3.3.0` in the root and CLI manifests, `ruflo/package.json` override `agentdb >= 3.3.0`
(root overrides do not reach installs of the published `ruflo` wrapper), both lockfiles.
The `agentdb` marketplace plugin entry moves to `plugin-v3.3.0`.

## Verification

- `__tests__/agentdb-episode-crud-520.test.ts`: tool registration, strict ids, feature detection
  (including the pre-3.3 delete refusal), patch validation, output bounding, error pass-through.
- Against the published packages on a fresh install: the tools over MCP stdio round-trip an episode
  that a real `hooks session-end` stored, and recall reflects the update.

## Consequences

- No change to existing tools. `agentdb_hierarchical-delete`'s dead `reflexionMemory` branch (ADR-519)
  is unchanged; episode deletion goes through `agentdb_episode-delete` only.
