---
name: cost-trend
description: Read every docs/benchmarks/runs/*.json and surface drift in win rate, latency, escalation rate, and LLM-baseline cost over time
argument-hint: ""
allowed-tools: Bash
disable-model-invocation: true
---

# Cost Trend

The smoke gate is binary (`winRate ≥ 0.80` → pass/fail). The corpus benchmarks captured over time form a curve — and curves catch regressions the gate misses (win rate slowly creeping from 100% to 85% is "still passing" by smoke but a real degradation).

This skill reads every persisted run in `docs/benchmarks/runs/*.json` and reports first→last deltas plus a per-run series, flagging regressions in win rate or latency.

## When to use

- Before a release — check that the speedup hasn't drifted.
- After expanding the corpus — verify older runs still hit the same win rate on the new corpus *they* reflected.
- After upgrading `agent-booster` — surface latency / strategy changes.

## Steps

1. **Run the trend script** from the project root:

   ```bash
   node plugins/ruflo-cost-tracker/scripts/trend.mjs
   ```

   Optional env:
   - `TREND_FORMAT=json` — emit JSON instead of markdown
   - `TREND_LIMIT=10` — consider only the most recent N runs

2. **Inspect the drift summary** — first vs last on win rate, avg latency, p99, escalation rate, speedup vs Gemini.

3. **Inspect the per-run series** — one row per run, including Sonnet 4.6 + Opus 4.7 baseline latencies if those were enabled (`BENCH_ANTHROPIC=1` at run time).

4. **Regression flags** — the script emits `> ⚠ Regression` callouts when:
   - Win rate dropped between first and last run
   - Avg latency rose ≥ 1.5× from first run

## Cross-references

- `cost-benchmark` — the producer of the run JSONs this skill consumes
- `bench/booster-corpus.json` — the corpus version is recorded in each run, so trends across corpus versions remain interpretable
- `docs/benchmarks/runs/latest.json` — the most-recent run; smoke step 23 gates on `winRate ≥ 0.80` from this file
