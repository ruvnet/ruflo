# ADR-530: Opt-in model-judge routing in ruflo-mods

- **Status:** Proposed
- **Date:** 2026-11-11
- **Related:** ADR-391 (routing corpus), ADR-404 (mod router parity), ADR-522 (the first mod model call), ADR-527 (centroid router), ADR-529 (governed router self-improvement)
- **Surfaces:** `plugins/ruflo-mods/hooks/route/judge.ts`, `routeJudge` option

## Context

ADR-529 found that better labels do not lift the centroid router: training it
on a model judge's labels scored the same as training on the lead's own agent
choices (dev CV 0.577 vs 0.580 ± 0.010). The same work showed that the judge
itself, given only the ADR-391 label table, labels prompts far better than any
router. This ADR tests the judge *as* the router.

The judge's prompt form was chosen after two batch runs on the dev split (all 84 prompts in one call, 82/84), so **dev is not held out**. The protocol below was then written before any production-shaped scoring: frozen system text (label table
and an untrusted-data line only, no tie-break rules or examples, sha256
`0cacd89f…`), one haiku call per prompt on a clean path (no hooks, no
CLAUDE.md, no tools), the reply accepted only if it is exactly one label, else
the keyword route. Primary baseline: the keyword table users get by default.
Secondary: the shipped ADR-527 centroid.

## Measured

| | ADR-391 dev (n = 84) | ADR-391 test (n = 113), scored once |
|---|---|---|
| Keyword table (`routeTask`, default) | 27 | 32 |
| Shipped centroid (ADR-527, opt-in) | 0.552 dev CV | 71 |
| Model judge, one prompt per call | 70 and 71 (two runs, 83/84 identical) | **100** |

- Judge vs keyword on test: 71 won / 3 lost, exact McNemar p ≈ 7e-18.
  Judge vs centroid: 37 / 8, p ≈ 1.5e-5.
- Production shape costs agreement: one prompt per call scored 70–71 on dev, against 82 when all 84 prompts went in one call.
- One test reply of 113 was off-label and fell back.
- Latency (API time, `claude -p`): p50 ≈ 1.0 s, p95 ≈ 2.1 s. Cost about
  $0.0002 per call on a cold cache, less when the system text is cached.
- These numbers come from `claude -p` with the same system text, not from the
  mod's `$.model.complete` path. That path is covered by a real-binary contract
  against the scripted mock model (`__tests__/real-binary/route-judge.test.ts`:
  one judge call with the frozen text, its label in the model's request, an
  off-label reply falling back, no call when off), which proves the wiring, not
  accuracy.

**What this measures.** The test split has been scored for earlier candidates
and its labels were written to the same rules, possibly by the same model
family. The numbers are agreement with that labeller, not routing quality, and
they are secondary evidence. The primary evidence is a fresh set of 100 real
prompts from local transcripts (seed 529, filters fixed in advance), labelled
by a person blind to every router; it is **not yet scored**. Whether the lead
then does better work is ADR-527's cost-per-verified-solve question, also not
measured here.

## Decision

1. Ship the judge in ruflo-mods behind `routeJudge`, **off by default**. A
   default install makes no new model call (smoke step 4 allows exactly this
   one call site, gated on the option).
2. The prompt is sent as data to classify (≤ 2,000 chars, 32 output tokens,
   4 s timeout; the engine stops a hook's budget clock during `$` calls).
   Slash commands and `<…>` envelopes are skipped. An off-label
   reply, a refusal, a timeout or an error keeps the keyword route; the hook
   never blocks a prompt.
3. The route carries `reason: "model-judge"`; the `$.ruflo` route contract,
   vendored by ruflo-console and ruflo-ruos, is unchanged, and `confidence`
   keeps its priors (0.6 a route, 0.3 `none`). The context box names the judge.
   A `none` label is shown as `Agent: none` (no specialist; the lead handles
   it), not replaced by the keyword table's guess, so `$.ruflo.lastRoute()`
   consumers can see `agent: "none"` with `matched: false`.
4. Turning it on by default needs the fresh human-labelled result and the
   maintainer's decision.

## Consequences

- With the option on, every routed prompt adds about a second and a small
  haiku charge on the session's own credentials.
- The judge's label set is the ADR-391 one (11 labels, including `none`);
  the keyword table's `backend-dev` and `frontend-dev` are never produced.
- The keyword table stays the parity-tested default (ADR-404).
