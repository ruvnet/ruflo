---
name: cost-summary
description: Single-shot programmatic dump of all cost data — total spend, per-tier, top session, budget status, federation aggregate. JSON or markdown.
argument-hint: "[--format json|markdown]"
allowed-tools: Bash
disable-model-invocation: true
---

# Cost Summary

A stable single-call interface that other plugins / scripts / dashboards can shell out to and parse. ADR-0002 considered exposing `cost_report` / `cost_summary` as proper MCP tools but **deferred that** — adding MCP tools requires modifying `@claude-flow/cli` source, out of scope for plugin-local work. This script is the equivalent: same data, exposed via a stdout JSON contract.

## When to use

- Another plugin needs a snapshot of cost state — it shells out to `summary.mjs --format json` and parses.
- A dashboard / Slackbot fetches a one-line cost rollup.
- Quick "where am I right now?" view that pulls from every cost-tracker source (cost-tracking + federation-spend).

## Output contract (JSON, stable)

```json
{
  "exportedAt": "<ISO>",
  "total_cost_usd": 1546.36,
  "sessionCount": 1,
  "conversationCount": 1,
  "byTier": { "haiku": 0, "sonnet": 0, "opus": 1546.36, "unknown": 0 },
  "byModel": {
    "claude-opus-4-7": {
      "tier": "opus",
      "cost_usd": 1546.36,
      "messages": 1597,
      "input_tokens": 3090,
      "output_tokens": 3295940,
      "cache_creation_input_tokens": 10659599,
      "cache_read_input_tokens": 732833690
    }
  },
  "topSession": {
    "sessionId": "1dba3b8c-...",
    "total_cost_usd": 1546.36,
    "messageCount": 1597
  },
  "budget": {
    "budget_usd": 2500.00,
    "setAt": "<ISO>",
    "spent_usd": 1546.36,
    "utilization": 0.6185,
    "level": "INFO"
  },
  "federation": {
    "eventCount": 0,
    "peerCount": 0,
    "totalUsd24h": 0
  }
}
```

## Steps

```bash
# Markdown (default)
node plugins/ruflo-cost-tracker/scripts/summary.mjs

# JSON for programmatic consumption
node plugins/ruflo-cost-tracker/scripts/summary.mjs --format json
```

Optional env: `SUMMARY_NAMESPACE=cost-tracking`, `SUMMARY_FED_NAMESPACE=federation-spend`, `SUMMARY_FORMAT=json`.

## Cross-references

- `cost-report` — narrative report (per-agent / per-model lens; uses same data)
- `cost-export` — pushes to Prometheus / webhook (this skill is pull-style; export is push-style)
- ADR-0002 §"Decision" — explicitly defers proper MCP-tool registration to a future ADR
