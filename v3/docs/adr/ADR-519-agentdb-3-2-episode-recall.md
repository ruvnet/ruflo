# ADR 519: session episodes through agentdb 3.2 hybrid retrieval

Status: Accepted (ruflo 3.68.0)

Date: 2026-11-01

Builds on: ADR-514 (agentdb 3.0.0), ADR-518 (agentdb marketplace plugin), agentdb ADR-016 (hybrid retrieval, LongMemEval). Related: ADR-171 (proxy outcomes never promote), ADR-174 (memory distillation).

## 1. Context

agentdb 3.2.0 changed how `ReflexionMemory.retrieveRelevant` ranks episodes. It now fuses BM25 keyword ranking with vector ranking by default. An optional local cross-encoder (`rerank: true`) re-scores the top candidates. On LongMemEval_M (470 questions, about 500 past sessions each, MiniLM embeddings), recall_all@5 went from 0.630 with vector search alone to 0.719 with hybrid ranking, and to 0.789 with rerank. The best result in the LongMemEval paper is 0.762.

None of that reached ruflo, for three reasons:

- **Session episodes were never written.** `bridgeSessionStart` and `bridgeSessionEnd` guarded on `reflexion.startEpisode` and `reflexion.endEpisode`. `ReflexionMemory` has never had either method; its API is `storeEpisode` and `retrieveRelevant`. Both guards were always false, so `agentdb_session-start`, `agentdb_session-end` and the `hooks session-*` tools never touched ReflexionMemory. Each reported `bridge-search` or `bridge-store`.
- **Nothing read episodes.** `memory distill` writes `episodes` and `episode_embeddings` (ADR-174), and `doctor` checks their coverage. No tool ever called `retrieveRelevant`, so distilled episodes could not be recalled.
- **The pins allowed 3.0.0.** The CLI, the `claude-flow` umbrella and the `ruflo` wrapper's override accepted agentdb 3.0.0, which has no hybrid ranking.

## 2. Decision

1. **Session end stores an episode.** When a summary is given, `bridgeSessionEnd` calls `storeEpisode` with the session id, the summary (truncated to 4,000 characters) and tag `session-end`. The outcome is not verified, so the episode is stored as neutral: `reward: 0, success: false`, with `metadata.provenance: 'session-summary'`. A session summary therefore never counts as evidence that an approach worked (ADR-171). Without a summary, nothing is stored. A failing `storeEpisode` is not fatal, and the `session` memory entry is still written. The result gains `episodeId`.
2. **New MCP tool `agentdb_episode-recall`.** It takes `query`, `k` (1–50, default 5), `hybrid` (default true), `rerank` (default false), `onlySuccesses` or `onlyFailures`, `minReward` and `timeWindowDays`, and calls `retrieveRelevant`. Results drop the 384-float embedding and bound each text field to 2,000 characters. The query is validated (string, non-blank, at most 10,000 characters).
3. **`agentdb_session-start` can recall.** With `recall: true` and a `context`, it returns `episodes` ranked the same way. Recall is opt-in, because it costs an embedding call and the `hooks session-start` caller passes a generic context ("new session") that matches nothing in particular.
4. **Rerank stays opt-in.** It costs about 200 ms per call on CPU and downloads a 23 MB model on first use, which is over the 100 ms MCP target.
5. **Pins move to `^3.2.0`.** This covers `@claude-flow/cli`, `claude-flow`, and the `ruflo` wrapper's override (`>=3.2.0`). `@claude-flow/memory` keeps `^3.0.0-alpha.20`, which already admits 3.2.0; changing it would force a standalone memory publish for no behaviour change.

A secondary write failing, whether the `session` memory entry or the pattern search, no longer discards an episode that was already stored or recalled. If neither path succeeds, the bridge still returns `null` as before.

## 3. Not changed

`bridgeDeleteHierarchical` looks up `registry.get('reflexionMemory')`. The registry has no controller of that name, so that path is dead. It was left dead on purpose. `deleteEpisode` coerces its argument with `parseInt`, so a hierarchical key such as `12-notes` would delete episode 12. Reviving the path needs a key-to-episode mapping first.

## 4. Verification

- Unit tests (`__tests__/agentdb-episode-recall-519.test.ts`, 11 tests with a mocked registry) cover the following:
  - session end stores a neutral episode, stores nothing without a summary, bounds the text and survives a failing `storeEpisode`;
  - recall defaults to hybrid on and rerank off, passes filters through, clamps `k` and strips embeddings;
  - session start recalls only when asked;
  - the tool validates its input.
- `scripts/smoke-episode-recall.mjs` runs against the real agentdb 3.2.0 through the bridge, on a temporary database. In it:
  - five session ends store five episodes and five embeddings;
  - an exact identifier (`ZX-4471`) comes back first in about 10 ms;
  - a paraphrase with no shared keywords ("running out of memory while resizing pictures") returns the thumbnail-OOM episode first;
  - `session-start` with `recall: true` returns the related episode first;
  - with `SMOKE_RERANK=1`, rerank keeps the identifier first.

  Set `RUFLO_CLI_DIST` to run it against an installed package.
- Existing tests that touch agentdb or sessions: 116 files and 1,293 tests. Their failures are pre-existing: two `#2245` counter tests that fail on main, and two `commands.test.ts` memory tests that need an initialised `.swarm/memory.db` in the working directory.

## 5. Consequences

- `agentdb_session-end` and `hooks session-end` now report `controller: 'reflexion+bridge-store'` when an episode is stored.
- Episodes accumulate, one per summarised session end. agentdb's keyword index covers the newest 10,000 (`AGENTDB_HYBRID_MAX_EPISODES`), and `pruneEpisodes` remains available.
- The ranking quality numbers come from agentdb ADR-016 and its LongMemEval harness. ruflo's own `memory_search` pipeline (`hybrid-retrieval.ts`) has not been run through that harness.
