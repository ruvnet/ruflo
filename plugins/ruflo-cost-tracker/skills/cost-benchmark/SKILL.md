---
name: cost-benchmark
description: Run the corpus benchmark — booster locally, optional Gemini/Sonnet/Opus baselines — and persist a verifiable measured-vs-claimed table
argument-hint: "[--llm] [--anthropic]"
allowed-tools: Bash
disable-model-invocation: true
---

# Cost Benchmark

Runs `scripts/bench.mjs` against the structural+adversarial corpus and writes per-case + summary results to `docs/benchmarks/runs/`. This is the verification gate that backs every measurable claim in `cost-booster-edit` / `cost-booster-route`.

## When to use

- Before publishing a release — verify booster win rate didn't regress.
- After expanding `bench/booster-corpus.json` — confirm new cases route correctly.
- When auditing a "claimed upstream" tag — flip it to "verified" once the bench supports it.
- On a cost question ("is Sonnet 4.6 cheaper than Opus 4.7 for these tasks?") — re-run with `BENCH_ANTHROPIC=1`.

## Steps

1. **Run the bench from `v3/`** (where `agent-booster` resolves):

   ```bash
   ( cd v3 && node ../plugins/ruflo-cost-tracker/scripts/bench.mjs )                  # booster only — free, ~85 ms
   ( cd v3 && BENCH_LLM_BASELINE=1 node ../plugins/ruflo-cost-tracker/scripts/bench.mjs ) # + Gemini 2.0 Flash (cheap)
   ( cd v3 && BENCH_LLM_BASELINE=1 BENCH_ANTHROPIC=1 \
        node ../plugins/ruflo-cost-tracker/scripts/bench.mjs )                          # + Sonnet 4.6 + Opus 4.7
   ```

2. **Inspect the markdown summary** printed to stdout. The gate metric is `winRate` (Tier 1 cases). Adversarial cases are tracked separately as `escalationRate`.

3. **Persisted output** lands at:
   - `docs/benchmarks/runs/latest.json` — pointer to the most recent run
   - `docs/benchmarks/runs/<ISO-timestamp>.json` — historical record

4. **Read it back** in subsequent skills (e.g. `cost-report` step 2 reads `latest.json` for live tier-spend numbers).

## Smoke gates

- `winRate ≥ 0.80` on Tier 1 cases (smoke step 23). Lower the threshold by editing `scripts/smoke.sh`.
- `escalationRate` is reported but ungated — adversarial cases are diagnostic.

## Env overrides

| Env var | Default | Purpose |
|---|---|---|
| `BENCH_LLM_BASELINE` | unset | `=1` runs the OpenAI-compat baseline |
| `BENCH_LLM_MODEL` | `models/gemini-2.0-flash` | Override the OpenAI-compat model |
| `BENCH_LLM_BASE_URL` | Gemini OpenAI shim | Override endpoint |
| `BENCH_ANTHROPIC` | unset | `=1` runs Anthropic baseline (Sonnet 4.6 + Opus 4.7) |
| `BENCH_ANTHROPIC_MODELS` | `claude-sonnet-4-6,claude-opus-4-7` | Comma-separated Claude IDs |
| `BENCH_OUT` | timestamped file | Override output path |
| `BENCH_QUIET=1` | unset | Suppress markdown summary |

API keys auto-pulled from `gcloud secrets` (`GOOGLE_AI_API_KEY`, `ANTHROPIC_API_KEY`); override with `BENCH_LLM_API_KEY` / `BENCH_ANTHROPIC_API_KEY`.

## Cross-references

ADR-0002 §"Decision 1" / §"Riskiest assumption" · `cost-booster-edit/SKILL.md` (verification table consumes this skill's output) · `cost-report/SKILL.md` step 2 (reads `runs/latest.json`).
