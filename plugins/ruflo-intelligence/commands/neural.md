---
name: neural
description: Neural pattern training, prediction, compression, and pipeline optimization
---

Neural system commands — dispatch by subcommand parsed from the user's input:

1. **train** — `mcp__plugin_ruflo-core_ruflo__neural_train` with `{ modelType: "moe"|"transformer"|"classifier"|"embedding", epochs: N }` (`modelType` is required). The CLI equivalent is `neural train --pattern coordination|optimization|prediction|security|testing --epochs N`.
2. **status** — `mcp__plugin_ruflo-core_ruflo__neural_status` (SONA + MoE state, active patterns, training in flight).
3. **patterns** — `mcp__plugin_ruflo-core_ruflo__neural_patterns` with `{ action: "list"|"get"|"store"|"search"|"delete" }` (default list; `search` takes `query` and `limit`).
4. **predict** — `mcp__plugin_ruflo-core_ruflo__neural_predict` with `{ input: "<task description>", topK? }` to get a predicted outcome.
5. **optimize** — `mcp__plugin_ruflo-core_ruflo__neural_optimize` to retune the pipeline based on recent outcomes.
6. **compress** — `mcp__plugin_ruflo-core_ruflo__neural_compress` to compact stored patterns (storage efficiency, runs after consolidation).
7. **wsp** — ruv-FANN weight-space checks (`@claude-flow/cli` 3.77.0+, ADR-528). CLI only, via Bash: `npx @claude-flow/cli@latest neural wsp <op>`:
   - `status` — whether the optional `ruv-fann-wsp`, `-invariants` and `-lifecycle` packages are installed; exit 2 with the reason when they are not.
   - `inspect [-m model.json]` — content hash and shape (default: the agent centroid router).
   - `check [--min-gap 0.05]` — self-routing invariants for the centroid router: each label must win on its own centroid by the gap. `check -m model.json -s suite.json` runs your own `ruv-fann.invariants/1` suite.
   - `gate -m model.json -p patch.json -s suites.json` — accept/reject a weight patch of at most 128 edits against every dataset suite (MSE policy).
   - `export-centroid -o file.json` — the centroid router as a one-layer Linear `ruv-fann.dense-layers/1` model.
   All of these are evidence only: none promotes a model or changes routing. Exit 1 means a check or gate failed.

Present results clearly. For `wsp check`/`gate`, show the verdict, then each violation or suite line. For `train`, surface the loss curve summary; for `predict`, show the predicted agent + confidence; for `optimize`/`compress`, show before/after counts.
