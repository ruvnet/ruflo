# Actual Kimi transfer and Agent Booster application

Date: 2026-10-25. Draft PR #4474. No routing default, model weight or production
policy was changed. The exact requested/observed OpenRouter model was
`moonshotai/kimi-k3.1-pro`; credentials stayed in the authorized host process.

## Kimi result: a reusable compact policy, not new intelligence

The completed diagnostic used 98 actual requests: eight target training calls
and 90 audit calls. Every one of the 98 has a unique provider generation ID;
recorded cost matches its sanitized provider receipt and reasoning tokens are
zero. All three audit arms passed 30/30 declared strict-oracle tasks.

| Arm | Reported audit cost | p95 |
| --- | --- | --- |
| Untuned explanatory prompt | $0.082762020 | 11,950 ms |
| Transferred source compact prompt | $0.040676328 | 6,687 ms |
| Target-trained compact prompt | $0.037344780 | 7,136 ms |

The transferred arm used **50.85% less marginal audit cost** and 44.04% lower p95
than the explanatory arm. Total completed-run cost including target training and
all experimental controls was $0.171409788. Target training cost $0.010626660.

This is a code-only workload: the baseline asked for extra explanation that the
common grader did not require. Removing that narrative is a legitimate output
optimization, not evidence of better reasoning or equivalent functionality where
production needs audit explanations. The source and target-trained compact
instructions were identical: all 30 paired request digests match exactly. Their
cost/latency differences are sampling, cache and scheduling variation, not an
adaptive-policy advantage. Cache receipts and randomized order do not eliminate
cross-arm cache interference.

These tasks were explicitly reused with diagnostic mode, not presented as fresh
confirmation. `proofEligible` and `transferProven` remain false. The selector was
Python global-prompt selection, not native Ruflo MCP learning or weight training.

Economics depend on attribution. If the source policy already exists, transferred
marginal audit cost is $0.040676328. If all source training is charged to this first
batch, add $0.0374632, giving $0.078139528 rather than advertising 50.85% end-to-end
savings. Target training plus target audit costs $0.047971440. Validation controls,
VM use and source experiments are additional; these are provider-reported figures,
not reconciled invoices or a production forecast.

[Full evidence](managed-kimi-transfer.json) retains the source policy, frozen plan,
completed and interrupted runs, reference checks, outputs and receipts.
[Derived analysis](managed-kimi-transfer-analysis.json) verifies receipts and
policy equivalence.

## Interrupted first attempt and billing uncertainty

The first diagnostic was interrupted by an actual desktop restart. It retained
49 rows and $0.086435118 known reported cost, without a completed result. The
original checkpoints were not fsynced per-request intents; they cannot prove a
complete billing history after restart. An in-flight uncertainty reserve was a
planning estimate, not a hard billing reconciliation or proof of exactly one
unknown charged request.

The replacement used a separately bounded, explicitly reused diagnostic root.
Its 98 rows are not silently merged into the first attempt or labelled a fresh
proof. The interrupted plan, rows and interruption explanation remain in the full
evidence archive. No blind replay is presented as safe.

## Agent Booster: actual merge, one confident semantic failure

Ten provider generations were each shared by two application arms: direct complete
source and actual pinned `agent-booster@0.2.2` application. Cost was counted once:
**$0.0061479** total. Direct returned source passed 10/10, while raw Booster passed
8/10. Nine outputs were admitted at the fixed confidence threshold; eight were
correct. `null-safe` was safely rejected at confidence zero.

The real `preserve-helper` counterexample was admitted at confidence
**0.548148572**, above the unchanged .5 threshold. The generated complete source
was correct, but fuzzy replacement returned both a new solve declaration and the
old solve declaration afterward. JavaScript used the final old binding, producing
the wrong answer. The independent oracle caught it. Neither successful merge nor
confidence establishes correctness.

The pinned runtime WASM SHA256 was
`5b1666ad952329e9b586e5e3775f39c3746fef691d3f77bf753cc7e92ce2502c`.
The full package lock and engine hashes are retained in
[the evidence archive](managed-booster-edit.json), with
[derived analysis](managed-booster-edit-analysis.json) and
[the exact counterexample](managed-booster-counterexample.json).
The bridge's constructor-plus-apply interval had median 125.53 ms and mean
132.32 ms in this deployment. Those numbers exclude provider generation, process
startup/import and oracle checks. The experiment does not demonstrate end-to-end
speed, token or inference savings from Booster.

Decision: retain independently verified direct full-source output for this
contract. Do not promote Booster over it on these results or retune confidence
after seeing the failure. A partial-edit experiment is a different contract.

## Closed verified application guard

`verified_application.py` requires a host-issued closed request contract binding
original, candidate and oracle task hashes. Booster output must pass the oracle;
confidence alone is never accepted. Direct fallback is allowed only for an
explicit complete-source request and must itself pass. Partial edits never become
complete files through fallback, and nonboolean oracle responses cannot grant
acceptance.

The final guard SHA256
`24ea0bc6592f40bf446b7409680a11e63e5d954161e71b534e1065206095b6d9`
was actually replayed against all ten recorded cases on ruOS with the strict
bubblewrap oracle: eight verified Booster outputs and two verified complete-source
fallbacks, ten accepted, zero new provider calls. [Replay evidence](managed-booster-guard-replay.json)
is explicitly posthoc known-case diagnostic evidence; raw Booster remains 8/10.
Seven guard regressions also pass locally. This does not establish unseen
application generalization or universal acceptance-test correctness.
