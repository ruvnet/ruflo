# ADR 523: Event Intelligence Gateway

Status: Proposed implementation
Date: 2026 11 01

## Decision

Add an opt in GitHub event adapter to Ruflo CLI. Reuse MissionService as the only authoritative task lifecycle. No second task scheduler or autonomous code execution path.

Authenticated GitHub webhooks are triggers, not authorization. Verify the HMAC SHA256 signature over exact bytes, cap messages at 256 KiB, apply a local actor and repository allowlist, then create **draft** missions only when explicitly enabled. Default mode is observe, which cannot create tasks.

All accepted and ignored signed events get atomic, durable receipts under `.claude-flow/event-gateway/events`. PR and issue threads map to mission owners under `.claude-flow/event-gateway/owners`. Followups attach to the same owner; workers poll by mission ID and acknowledge after consumption. Raw comment bodies are not persisted in receipts.

This layer reuses Ruflo's existing lock primitive, atomic file writer, MissionService idempotent request IDs, hash chained mission history and authorization flow. It never grants tool capabilities, runs a model, posts comments, merges PRs or advances mission state beyond draft.

## Core invariants

1. Invalid signature or missing secret creates no durable state.
2. Repository or sender outside allowlist creates no mission.
3. One PR thread maps to one mission even under concurrent events.
4. Same delivery ID is idempotent. Altered payload, type or thread fails closed.
5. Corrupt mission ownership fails closed, never silently remaps.
6. A receipt can only be acknowledged through its owning mission.
7. Worker disconnection never implies mission failure.
8. The canonical receipt directory remains authoritative, with no unsafe secondary index.

GitHub webhook origin is proven by HMAC, but the sender is authorized only by explicit local policy. GitHub event text is untrusted and never promoted into tool authority.

## Supported events

The initial adapter handles `issue_comment`, `pull_request_review_comment`, `pull_request`, and `check_run`, restricted to defined actionable operations and PR or issue thread IDs.

## Replay and recovery

A stable event derived MissionService request ID protects creation from duplicate attempts after crash and source redelivery. The local gateway lock serializes ownership updates. A crash before a complete receipt requires redelivery from the webhook source; no upstream queue is part of this PR. The event worker inbox is durable but uses a linear authoritative scan.

## Load measurement

November 1, 2026, Node 20.20.2, Vitest 2.1.9, synthetic signed payloads, real MissionService and filesystem, zero model calls.

| Metric | Result |
| :--- | ---: |
| Signed deliveries | 300 |
| PR threads | 20 |
| Draft missions created | 20 |
| Attached followups | 280 |
| Duplicate replays suppressed | 30 of 30 |
| Inbox receipts | 300 |
| Ingest throughput | 440.1 per second |
| p50 ingestion | 1.66 ms |
| p95 ingestion | 7.82 ms |
| p99 ingestion | 10.967 ms |
| Total for 20 inbox reads | 226.5 ms |
| Tests passing | 12 of 12 |

Task ownership reduces 300 possible independent requests to 20 task owners for this synthetic workload, a 93.3 percent reduction in mission cardinality versus one new mission per event. It is not a measured execution speedup or DeepSeek comparison.

Ingestion is already fast for this workload. Inbox scanning, around 11.3 ms per mission read here, is the optimization target. Indexed lookup was deferred because a crash between receipt and index updates could hide delivered events. A future index must prove no lost events under crash and multi process replay.

## Installation caveats

The repository's npm lockfile is not aligned with the workspace manifests, so `npm ci` is not the supported verification path for this feature. The V3 workspace already pins pnpm 8.15.0 and has a usable `pnpm-lock.yaml`. `corepack pnpm install --filter @claude-flow/cli... --frozen-lockfile --ignore-scripts` succeeded. After building referenced TypeScript packages (cli-core, swarm, shared, memory, neural), the complete CLI typecheck and emitting build passed, and the compiled `ruflo events --help` command ran on Node 22. The three gateway test suites passed 12 of 12 on the locked dependency graph with Vitest 4.1.8. A separate replay measured 512 events per second and p95 5.754 ms on the same desktop; timings vary between runs and neither value benchmarks DeepSeek. Run `bash v3/scripts/verify-event-intelligence.sh` using Node 22 and Corepack to reproduce. A live GitHub webhook HTTP listener and external GitHub writes remain untested and out of scope.

## Rollback and future work

Change the local event policy to observe mode or remove the events command. Existing mission data remains unchanged. A production rollout additionally needs an authenticated HTTP webhook listener, rate limiting, secret rotation, retention limits, queue retries, real GitHub fixtures and worker authorization handoff tests.
