# ADR-529: Governed self-improvement for the centroid agent router (`neural learn`)

- **Status:** Proposed
- **Date:** 2026-11-11
- **Related:** [ADR-527](ADR-527-centroid-agent-router.md) (centroid router), [ADR-528](ADR-528-ruv-fann-wsp-tooling.md) (WSP invariants), ADR-322 (flywheel transaction), ADR-381 (sequential evidence), ADR-391 (routing corpus), ADR-150 (optional MetaHarness)
- **Surfaces:** `neural learn {harvest,correct,propose,list,promote}`, `src/ruvector/router-learning.ts`, `src/ruvector/router-learning-gate.ts`, `assets/agent-router/guard.minilm.json`, `benchmarks/router/build-guard.mjs`

## Context

The ADR-527 centroid router is fixed at release: it never learns from the
project it runs in. The question was what "self-improving" should mean for it,
and whether any candidate actually improves routing. Candidates were explored
with `@metaharness/darwin` (`evolveNumeric`, numeric genome search) against
random search at equal budget, gated with `@metaharness/flywheel`
(`meetsPromotionRule`). AVO was not used: it is an LLM variation operator and
the search space here is numeric. The protocol was pre-registered before any
test-split evaluation: select on the ADR-391 `dev` split only (5 × 5-fold CV),
score at most three finalists once on `test`, adopt only if exact two-sided
McNemar p < 0.05 **and** the gain is at least 3 rows.

### Measured

| Candidate | dev CV | test (n = 113) | vs shipped |
|---|---|---|---|
| Shipped centroid | 0.552 | 71 (0.628) | — |
| Router-shape search (centring, prototypes, kNN, abstain bias), Darwin | 0.555 | not a finalist | noise; random search 0.538–0.550 |
| + ruflo's own delegations (centroid + capped, weighted rows) | 0.610 | 78 (0.690) | 10 won / 3 lost, **p = 0.092** |
| Darwin full genome incl. the data weight | 0.614 | 78 (0.690) | 11 / 4, **p = 0.118** |
| Online, bandit feedback (test stream) | — | 0.699 vs 0.690 | p = 1 |
| Online, 30 % explicit corrections (test stream) | — | 0.726 vs 0.690 | p = 0.29 |
| The shipped recipe below (weight 1.0, cap 10), 20 row orders | 0.590 ± 0.010 (range 0.574–0.612) | 77 (0.681), one order | |
| + ruv-FANN WSP patch (≤ 128 edits: biases + top-K weights by gradient), Darwin vs random | 0.610 | 77 | 3 / 3 vs unpatched, p = 1 |
| WSP patch on the dev-only base | 0.564 | 69 | 6 / 8 vs shipped, p = 0.79 |
| Labels: lead’s agent choice (227 deduplicated delegations), 20 row orders | 0.580 ± 0.010 | not scored | |
| Labels: only delegations whose own tests then passed (18 rows) | 0.567 | not scored | |
| Labels: model judge (haiku, label table only) | 0.577 ± 0.016 | not scored | |
| + 345 unmapped delegations labelled by the judge | 0.573 ± 0.022 | not scored | |

"ruflo's own delegations" are 241 labelled task descriptions mined from 651
Agent/Task tool calls in this machine's Claude Code transcripts, mapped from
agent type to router label. The labels are what a lead model chose, not ground
truth.

Findings:

1. **No candidate met the pre-registered rule.** The data source is the only
   lever that moved anything; tuning the router's shape did not. There is no
   accuracy claim in this ADR.
2. **The flywheel rule promotes noise.** `meetsPromotionRule` accepted the
   +0.2-point shape candidate and would have accepted a 4/27 → 7/27 local
   gain. With `noopRate = 0` its floor clause requires only *some* strict
   primary gain.
3. **WSP patches do not train the router further.** ruv-FANN WSP has no
   optimizer; it applies and verifies bounded absolute-value patches. Patches
   proposed by masked gradient descent and searched by Darwin applied cleanly
   under WSP (hash-bound, 11–115 edits, identical predictions), but added
   nothing on top of the data (dev 0.610 vs 0.612; test 77 vs 77) and hurt the
   dev-only base on test (69 vs 71). WSP stays an evidence tool (ADR-528).
4. **Better labels do not move this router.** Two label sources were tried
   on the same rows, with row order shuffled 20 times (order alone moves dev
   CV by ±0.010 at cap 10, because the cap keeps the first rows per label):
   - *Verified outcomes* (did the delegated agent’s own tests pass after its
     last edit) exist only for agents that edit: 27 of 227 rows, none for
     reviewer, researcher, architect or tester. Filtering on them scores
     lower. Tests passing says the work succeeded, not that the agent choice
     was right. The mod’s own loop recorded no verified outcome in 250 turns
     across six projects, because agents pipe test output and the verifier
     correctly ignores piped status (ADR-503).
   - *A model judge* given only the label table agrees with the corpus
     labeller on 82 of 84 dev prompts (the router: 0.55). It is a far better
     labeller than the lead’s agent choice, but training the centroids on its
     labels scores the same as the lead’s labels, and labelling 345 more
     delegations adds nothing. The bottleneck is the MiniLM centroid on short
     task titles, not label quality. The 82/84 measures agreement with a
     corpus written to the same rules, possibly by the same model family.
5. **Text-hash holdout leaks.** Near-identical descriptions from one session
   land on both sides; bucketing by session is required.

## Decision

Ship the **mechanism**, governed so that it cannot promote on noise, and leave
routing unchanged unless a person promotes a candidate and opts in.

1. **Ledger.** `neural learn harvest` reads this project's transcripts
   (regular `.jsonl` files up to three levels deep, no symlinks, 64 MiB per
   file) and records each labelled delegation's short `description` as
   `{text hash, session hash, label, int8 MiniLM vector}` in
   `.claude-flow/router/ledger.json` (mode 0600, gitignored, ≤ 200 rows per
   label). The prompt and the text are not stored. A vector is not anonymous,
   so the ledger never leaves the machine. `neural learn correct` records one
   explicit correction.
2. **Candidate.** Shipped centroids (× support) plus the first 10 non-holdout
   ledger rows per label (ordered by text hash) at weight 1.0, chosen on dev
   CV; nearby weights are not distinguishable within the row-order spread. Learning always starts from the shipped artifact.
3. **Evidence.** One session in five is holdout and is never learned from.
   `propose` scores base and candidate on it, on a frozen **guard set** (the
   ADR-391 `test` split as int8 vectors, no text, built and drift-checked by
   `build-guard.mjs`; nothing selects or tunes against it), and with the
   ADR-528 self-routing invariants (skipped, and said so, when WSP is absent).
4. **Gate.** Two conjunctive rules:
   - the flywheel promotion rule (the in-tree copy when the optional package is
     missing), with the guard as its anti-Goodhart anchor (no regression) and
     an invariant failure as its safety flag;
   - paired holdout evidence through the in-tree anytime-valid e-process
     (`flywheel-sequential-evidence.ts`). The k-th proposal in a project spends
     α_k = 0.05·6/(π²k²), so re-running `propose` after every harvest cannot
     shop for a lucky split. Proposal #1 needs 9 clean holdout wins; #2 needs 13.
   `propose` refuses before spending alpha when the holdout is smaller than
   that.
5. **Receipt and promotion.** Every proposal writes a receipt with hashes,
   counts, the e-value and the decision. `neural learn promote <id> --confirm`
   copies an accepted candidate to `.claude-flow/router/centroids.json`
   (keeping the previous file). Routing uses it only with
   `CLAUDE_FLOW_ROUTER_CENTROID=1` and `CLAUDE_FLOW_ROUTER_CENTROID_PATH`.
   Nothing promotes on its own.

## Consequences

- On this machine's data today, `propose` **refuses**: 132 ledger rows from 26
  sessions leave 7 holdout rows, below the 10 needed. That is the intended
  result: the evidence does not yet exist.
- The holdout measures agreement with past lead-model delegations (the shipped
  router agrees about 15 % of the time), not routing correctness. A promoted
  candidate routes more like this project's leads did; whether that is better
  is a separate cost-per-verified-solve question (ADR-527).
- Receipts are integrity-checked (an edit of the stored artifact is refused)
  but **not signed**, so they are not tamper evidence. Moving them onto the
  ADR-322 signed transaction (`registerFlywheelReceipt` /
  `promoteFlywheelCandidate`) is follow-up work; that path's payload is the
  retrieval policy, not a centroid artifact.
- The CLI tarball grows by the 63 KB guard set.
- No change to cold start, `hooks route` or the default router.
