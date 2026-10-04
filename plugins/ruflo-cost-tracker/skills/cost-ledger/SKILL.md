---
name: cost-ledger
description: One cost view across Claude Code and Codex on this machine — spend, tokens, cache hit ratio per provider and model, with unpriced models flagged. Use when asked "what did I spend", "how much did Codex cost", or to compare providers. Local logs only, nothing is sent.
argument-hint: "[--since 7d|24h|all] [--provider claude|codex|all] [--format json|markdown]"
allowed-tools: Bash
---

# Cost Ledger

Reads the logs the agents already wrote (`~/.claude/projects`, `$CODEX_HOME` or `~/.codex`) and prices them from `data/prices.json` (dated, editable).

## Run

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs --since 7d
node ${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs --provider codex --format json
```

## Read the result correctly

- **USD and Codex credits are never added.** GPT-6 Codex models are priced in credits; their cached-input rate is unpublished, so the figure is an upper bound.
- **Estimates at list price, not bills.** Subscriptions bill by window, not by token. `/usage` is authoritative for the live Claude session; the Console or provider dashboard is authoritative for invoices.
- **Unpriced models are listed, never counted as $0.** Say so, and offer to add them to `data/prices.json`.
- **Counting rules** (why numbers differ from naive sums): Claude messages are de-duplicated by `message.id + requestId`; Codex uses deltas of the running `total_token_usage` (never also `last_token_usage`), cached input is a subset of input, and forked rollouts are de-duplicated.
- Claude transcript output tokens can under-count streamed output.

If the log directory is missing, say so; do not invent numbers.
