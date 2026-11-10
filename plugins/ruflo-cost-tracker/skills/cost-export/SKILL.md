---
name: cost-export
description: Export cost-tracking telemetry in Prometheus textfile or webhook JSON formats — for external observability (Grafana, Datadog, custom dashboards)
argument-hint: "[--prometheus <path>] [--webhook <url>]"
allowed-tools: Bash
disable-model-invocation: true
---

# Cost Export

Pulls every `session-*` and `budget-config-*` record from `cost-tracking` and emits in formats consumable by external observability systems. Without this, cost data lives only inside the AgentDB namespace; with it, the same data lights up dashboards.

## When to use

- After any cost-track run, to refresh metrics for Grafana / Datadog / Prometheus.
- Cron-friendly via `/loop 5m` to keep external dashboards near-real-time.
- One-shot to a webhook for ad-hoc reporting (Slack, custom endpoint).

## Steps

1. **Pick a format** — textfile collector for Prometheus / Grafana, or webhook POST for everything else:

   ```bash
   # Prometheus node_exporter textfile collector
   node plugins/ruflo-cost-tracker/scripts/export.mjs --prometheus /var/lib/node_exporter/textfile_collector/cost_tracker.prom

   # Webhook (POSTs JSON; add auth via env)
   EXPORT_WEBHOOK_HEADER='Authorization: Bearer $TOKEN' \
     node plugins/ruflo-cost-tracker/scripts/export.mjs --webhook https://hooks.example.com/cost-tracker

   # Stdout JSON (default if no flag)
   node plugins/ruflo-cost-tracker/scripts/export.mjs
   ```

2. **Inspect what's emitted** — Prometheus output includes:

   ```
   cost_tracker_total_usd                                    <gauge>
   cost_tracker_tier_total_usd{tier="opus|sonnet|haiku"}     <gauge>
   cost_tracker_session_total_usd{session="<8-char>"}        <gauge>
   cost_tracker_session_messages{session="<8-char>"}         <counter>
   cost_tracker_budget_usd                                   <gauge>  (if budget configured)
   cost_tracker_budget_utilization                           <gauge>  (spent / budget)
   ```

3. **Webhook payload shape** — the JSON the webhook receives matches the stdout JSON: `{ exportedAt, sessions: [...], budget, totalUsd, byTier }`. Headers may be added via `EXPORT_WEBHOOK_HEADER='K1: V1, K2: V2'` (comma-separated).

## Env overrides

| Env | Default | Purpose |
|---|---|---|
| `EXPORT_NAMESPACE` | `cost-tracking` | Override target namespace |
| `EXPORT_WEBHOOK_HEADER` | unset | Comma-separated `K: V` pairs for webhook auth |
| `EXPORT_QUIET=1` | unset | Suppress non-error confirmation output |

## Cross-references

- `cost-track` — produces the data this skill exports
- `cost-budget-check` — the same `cost_tracker_budget_*` metrics are alertable in Prometheus
- node_exporter textfile collector docs (Prometheus convention) — drop the `.prom` file in the collector directory and Prometheus picks it up
