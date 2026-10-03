# Memory SOTA Report — 2026-10-03

TL;DR: In 2026, every production vector database handles distance computation over *quantized* vectors specially — Hamming+popcount for binary codes, dequantize-then-rescale for scalar/int8, or a mandatory rescore against full-precision vectors. Ruflo's `HNSWIndex` (`v3/@claude-flow/memory/src/hnsw-index.ts`) does this correctly for product quantization (fixed 2026-08-25, #3093/#3094) — but tonight's research found that fix doesn't survive a save/reload cycle: `serialize()`/`deserialize()` never persisted the quantization config or trained PQ codebooks at all, so `AgentDBAdapter.saveToDisk()`/`loadFromDisk()` silently dropped the quantizer on every reload, re-breaking the already-fixed dispatch. Candidate fix: persist quantization config + trained codebooks across the wire format, with a versioned magic header for backward compatibility. Evaluated tonight: real bug, reproduced, fixed, tested.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| RaBitQ's 1-bit-per-dim quantization uses a provably unbiased asymmetric distance estimator (random rotation + bi-valued codebook + scalar correction), not a naive metric on packed bits | Gao & Long, SIGMOD 2024, arXiv:2405.12497 | A |
| Qdrant binary quantization: bitwise Hamming-style scoring for candidate generation, **mandatory rescore/oversampling** against full f32 vectors for correctness | Qdrant quantization docs + binary-quantization-openai article | B |
| Weaviate BQ: dedicated bitwise comparison kernel + conditional overfetch/rescore (`rescoreLimit`) against uncompressed vectors | Weaviate BQ compression docs + BQ blog | B |
| Milvus: dedicated binary vector dtype with native Hamming-distance index types (`BIN_FLAT`/`BIN_IVF_FLAT`), explicitly selected at index-creation time, not inferred from a generic metric | Zilliz index-types blog + BQ learn article | B |
| Vespa: binarized tensors declare an explicit `hamming` distance metric (XOR+popcount) for ANN retrieval, then a float rerank phase | Vespa binarizing-vectors docs + billion-scale kNN blog | B |

No competitor runs a plain float distance formula directly on packed-bit or rescaled-int arrays without either a dedicated kernel or an explicit dequantize/rescore step — a consistent pattern across 4 independent vendors plus a peer-reviewed theoretical basis (RaBitQ).

## Ruflo Current Capability

`HNSWIndex` supports three quantization modes (`product`, `binary`, `scalar`) via an internal `Quantizer` class. Product quantization's distance dispatch was fixed 2026-08-25 (`isProductQuantized()` guard routes to `productQuantizeDistance()`). Tonight's research re-verified that fix directly, and in doing so found it doesn't survive persistence: `serialize()` wrote index topology (nodes, vectors, connections) but never `config.quantization` or the trained `codebooks`; `deserialize()` always reconstructed via `new HNSWIndex({dimensions, M, efConstruction, metric})` — no quantization field — so `this.quantizer` was `null` after every reload, collapsing `isProductQuantized()` back to `false` and reintroducing the exact pre-#3093 bug for any index that persists and reloads. `AgentDBAdapter.saveToDisk()`/`loadFromDisk()` (`agentdb-adapter.ts:1267,1316`) call this pair in production.

Separately (re-confirmed, not re-fixed tonight): `binary`/`scalar` quantization have no distance-dispatch guard at all (same bug class, unfixed), but are currently **dead code** — no call site anywhere in the repo constructs `HNSWIndex` with `quantization:{type:'binary'|'scalar'}`. Flagged for a future night rather than bundled into tonight's patch (keeps the patch to one conceptual change).

## Competitor Comparison

| System | Approach to quantized distance | Source | Grade |
|---|---|---|---|
| Qdrant | Hamming-style bit-space scoring + mandatory rescore | Qdrant docs/blog | B |
| Weaviate | Bitwise kernel + overfetch/rescore | Weaviate docs/blog | B |
| Milvus | Native Hamming-distance index type for binary vectors | Zilliz blog (x2) | B |
| Vespa | Explicit `hamming` metric + float rerank phase | Vespa docs/blog | B |
| RaBitQ (theory) | Provably unbiased asymmetric estimator | SIGMOD 2024 paper | A |

LangGraph/AutoGen/CrewAI/OpenAI agent tooling delegate vector quantization entirely to an external vector DB — none implement it themselves, confirming this is a vector-DB-layer concern, not an agent-framework one.

## Hypothesis

Given an `HNSWIndex` configured with quantization (binary, scalar, or trained product) that is serialized and reconstructed via `deserialize()` — the exact round trip `AgentDBAdapter.saveToDisk()`/`loadFromDisk()` perform — when `serialize()`/`deserialize()` are extended to persist and restore `config.quantization` and (for trained product quantization) the PQ `codebooks`, then post-deserialize distance dispatch should match pre-serialize behavior (recall@10 within noise of the pre-serialize value) rather than collapsing to chance level, subject to: (1) non-quantized indexes' round-trip behavior is unchanged; (2) old-format ("v1") snapshots still deserialize without crashing; (3) existing serialization/quantization tests stay green; (4) deterministic, $0 evaluation.

## Benchmarks

New deterministic test (`hnsw-serialization-quantization.test.ts`): a trained product-quantized index (1500 synthetic clustered 64-dim vectors, 8 clusters, pqTrainingThreshold=256) measures recall@10 against brute-force ground truth before serialization and again after `deserialize(serialize())`, plus a hand-verified v1-format backward-compatibility buffer and a non-quantized-index regression check.

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls. Baseline-fails/candidate-passes via `git stash` isolation on `hnsw-index.ts` alone: pre-serialize recall@10 = 0.270 (matches 2026-08-25's measured PQ floor); post-deserialize recall@10 collapses to **0.010** on baseline, recovers to ~0.270 on the candidate (within 0.05 of pre-serialize, asserted). Full `@claude-flow/memory` suite: 557/558 both ways (1 pre-existing unrelated failure — a root-user/read-only-file permission test in `auto-memory-bridge.test.ts`, confirmed byte-identical via stash isolation). `tsc --noEmit`: clean, no errors.

## Darwin Results

Skipped: this is a correctness/persistence fix (quantizer state either round-trips or it doesn't) — not a continuous parameter with a fitness gradient. Same skip class as prior binary-correctness-fix nights (#3110, #3160, #3184, #3221, #3243, #3266, #3302, #3330, #3378, #3385, #3395).

## SOTA Proof & Witness

**Reward hack check** (manual checklist — `ruvector` CLI became unreachable via npx mid-session, same disclosed-fallback pattern as 2026-09-22): no test weakening (diff is purely additive — new magic version, new wire-format section, new methods); no gold-data tampering (ground truth is brute-force L2 on raw unquantized vectors, untouched); no cherry-picking (test corpus/seed shared with the existing 2026-08-25 PQ test for consistency, not hand-picked for this fix); no evaluator exploitation; no cost hiding ($0 deterministic). Independently re-verified by an adversarial critic who reproduced the stash-isolated fail/pass proof itself.

**Security review**: no new attack surface — the serialization format gains one versioned section read from a trusted local buffer (same trust boundary as the rest of `deserialize()`, which already parses attacker-uncontrolled local files); backward-compatible with pre-fix snapshots.

**Promotion gate** (advisory only — never self-promoted): evaluation_complete ✓, effect_positive ✓ (0.010→0.270 post-fix), significance_sufficient ✓ (27x), no_material_regression ✓ (557/558 both ways, byte-identical failure), tests_green ✓, reward_hack_clear ✓, critic_clear (pending independent critic report — see PR), witness_valid ✓ (below), receipt_reproducible ✓ (stash-isolated). **VERDICT: ACCEPT** — recommended for human review, not self-promoted.

| Field | Value |
|---|---|
| Session commit | `52d7a9d247c210a725e25bac9af2559ecc79a697` |
| Candidate commit | PENDING — filled on `dream/2026-10-03-memory` before push |
| Gist SHA-256 | `b9969030fa3927b5e979aee6201eb4b9a251bc6e44a9d88dcc5f996eeb8c368a` |
| Witness stamp | `98d206b036e3d7d4e8e27c469288792085f3e1b402a24811a040fe45767d3507` |

Verifier: fetch this gist, replace "Candidate commit"'s value with "PENDING — filled on `dream/2026-10-03-memory` before push", SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **This fix**: human review and merge of the linked draft PR — one file (`hnsw-index.ts`) + one new test file, one conceptual change (serialization completeness for quantizer state).
2. **Binary/scalar quantized-distance dispatch** (same file, `distance()` ~line 1018): still has no Hamming/dequantize kernel, same bug class as the already-fixed PQ case — but currently dead code (no production call site), so lower urgency; good candidate the day a caller wires binary/scalar quantization in.
3. **Plugin install trust/checksum enforcement** — previously flagged (2026-09-22 gist) as an open gap; tonight's scan confirms it was **already fixed** by PR #3557 (2026-09-30, trust-policy.ts + `--ignore-scripts` for untrusted installs). No action needed; closing this out of the backlog.
4. **Dream Cycle automation trigger**: tonight's `automation` scan reconfirms the nightly trigger lives entirely outside the repo (no in-repo cron/workflow references it) — root cause of the recurring no-run gaps (08-20..23, 09-13/14, 09-23/25/26) remains undiagnosed and out of this repo's visibility. Standing recommendation unchanged: a dedicated future `automation`/`meta` night scoped explicitly to diagnosing the external trigger.
