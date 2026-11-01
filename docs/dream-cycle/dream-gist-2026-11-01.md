# Security SOTA Report — 2026-11-01

**TL;DR**: 2026 multi-agent zero-trust literature (OWASP's agentic-AI Top 10 ASI03 "Identity & Privilege Abuse"; Cerbos's Identiverse 2026 recap; CapiscIO's RFC-001 draft; Noma Security's inter-agent-trust writeup) converges on a specific, falsifiable property: control-plane operations that change an agent's privilege or a mesh's shape must be authorized more strictly than ordinary data-plane traffic, and that authorization must be *enforced*, not merely configurable. Tonight's deep review of Ruflo's own `@claude-flow/plugin-agent-federation` found exactly the failure mode this literature warns about, and a continuation of last night's own disclosed, deferred finding: `PolicyEngine.evaluateMessage()`'s trust-level gate had no dedicated case for `trust-change`/`topology-change` — the two message types that mutate a peer's trust level or the mesh topology itself — so they fell through `getOperationForMessageType()`'s default branch to the generic `'send'` operation, the same floor as ordinary task messages, granted from `ATTESTED` (the second-lowest of five trust levels). Unlike write/memory/spawn, there was no `SecurityPolicy`-configurable threshold at all for this category. Fixed tonight with a 32-line patch plus 7 new tests.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OWASP Agentic AI Top 10, ASI03 "Identity & Privilege Abuse": agents accumulating or being granted privilege beyond task scope, exploited via delegation-chain abuse or cross-agent privilege escalation; multi-agent "confused deputy" named explicitly as a sub-case | OWASP GenAI Security Project, 2025-12 release under the "2026" name (via secondary summaries — primary doc not fetched tonight) | B |
| Cerbos's Identiverse 2026 recap: a three-plane model (control plane for establishing trust, data plane for fast per-request decisions, signaling plane for context) — "don't touch production" framed as a request, not a control, unless an actual plane boundary enforces it | Cerbos blog, 2026 | C |
| CapiscIO RFC-001 (updated 2026-04-30): proposes a deterministic Policy Enforcement Point with an explicit threat table including "authority escalation" and "forged delegation"; missing/forged trace IDs auto-deny | CapiscIO RFC draft, vendor proposal, not an adopted standard | C |
| Noma Security: multi-agent trust gaps appear at handoff points; the missing control is "verifiable delegation," not just least-privilege scoping — a downstream agent often cannot tell a legitimate peer's instruction from a compromised orchestrator's | Noma Security analysis, republished 2026-04 | C |
| arXiv 2505.12490: empirical review of Google's A2A protocol finds weak token-lifetime control and overbroad access scopes; proposes per-token permission scopes scoped to the specific operation, not the whole session | arXiv preprint, single-source, not independently reproduced | C |

## Ruflo Current Capability

`PolicyEngine` (`src/application/policy-engine.ts`) is Ruflo's real authorization gate for federation messages: a 5-level `TrustLevel` enum backed by a hardcoded `CAPABILITY_GATES` table (`trust-level.ts`), a per-message-type claims check, and — since last night's fix (#4618/#4619) — configurable `SecurityPolicy.minTrustLevelFor{Write,Memory,Spawn}` thresholds layered on top of the hardcoded floor. `trust-change` and `topology-change` are Ruflo's own control-plane messages: both already require the `federation:admin` claim and are both already in `DEFAULT_SECURITY_POLICY.allowedMessageTypes` (so, unlike last night's `claim-event`/`agent-handoff` caveat, these are genuinely reachable today, not dead-listed). But `getOperationForMessageType()` had no `case` for either — they hit `default: return 'send'`, and `CAPABILITY_GATES` grants `'send'` starting at `ATTESTED`. Confirmed live and reachable at both call sites: `federation-coordinator.ts:282` passes `peer?.trustLevel ?? TrustLevel.UNTRUSTED` from a real peer session, and `plugin.ts`'s inbound `authorizeInbound` callback passes `peer.trustLevel` from the Ed25519-verified inbound dispatcher — not simulated, not test-only.

## Competitor Comparison

| Competitor | Mechanism | Separates control-plane from data-plane trust? | Grade |
|---|---|---|---|
| LangGraph | Human-in-the-loop approval at workflow checkpoints (interrupt/resume) | Gates at a workflow boundary, not per-message; no trust-tier model | C |
| AutoGen / CrewAI | Group-chat/role-based handoff; no documented trust-tier or per-operation authorization in 2026 comparison sources | No comparable mechanism found | C |
| CapiscIO RFC-001 (reference design) | Deterministic PEP evaluating cryptographic artifacts per call; "authority escalation" is a named threat class | Yes, by design intent (draft RFC, not shipped in any product reviewed) | C |
| OWASP ASI03 reference mitigation | Short-lived, per-operation scoped tokens; independently revocable identity | Yes, as prescriptive guidance, not a specific product | B (as guidance) |
| **Ruflo (pre-fix)** | `trust-change`/`topology-change` fell through to the generic `'send'` operation | **No** — same floor as ordinary data messages | — |
| **Ruflo (post-fix, tonight)** | Dedicated `'admin-change'` capability (hardcoded floor: TRUSTED+) plus a new configurable `minTrustLevelForAdmin` | **Yes** | — |

**Why this isn't "None across the board"**: same shape as last night — this is a Ruflo-specific wiring gap, not an industry-wide absence. The useful comparison is normative (what the 2026 zero-trust literature says control-plane messages need) against what Ruflo's code actually enforced, not another product sharing the identical bug.

## Hypothesis

> Given `PolicyEngine.evaluateMessage()`, which before tonight routed `trust-change`/`topology-change` through the generic `'send'` operation (granted from `ATTESTED`) with no `SecurityPolicy`-configurable floor, when a dedicated `'admin-change'` `CAPABILITY_GATES` entry (granted from `TRUSTED`) and a new `minTrustLevelForAdmin` policy threshold are added, mirroring the existing write/memory/spawn pattern, then a `trust-change`/`topology-change` message from a peer below `TRUSTED` should be rejected by default, a tightened override should take effect, and a loosened override should never bypass the hardcoded `TRUSTED` floor — subject to: zero change to `CAPABILITY_GATES` entries for any other existing operation, zero regression to the 677-test suite, deterministic $0 Vitest evaluation. Frozen before evaluation; not modified after.

## Benchmarks

No agent-task benchmark applies — binary authorization-wiring correctness, evaluated via discriminating Vitest tests, the established convention for this class of fix (e.g. 2026-10-31, 2026-10-28). `.harness/bench.json` does not exist in this checkout.

## Evaluation

**evaluated: accepted — ACCEPT.**

Real evaluator: Vitest 4.1.8, package `@claude-flow/plugin-agent-federation`. 7 new tests added (`policy-engine.test.ts`, new `describe('admin-plane messages (trust-change / topology-change)')` block): 4 discriminating (rejects `trust-change`/`topology-change` at `ATTESTED`; a tightened `PRIVILEGED` override rejects `TRUSTED`; a loosened `VERIFIED` override cannot bypass the hardcoded floor) and 3 non-discriminating controls (allows at `TRUSTED` for both message types; extreme-low-trust-level sanity check).

Stash-isolated baseline (`policy-engine.ts` + `trust-level.ts` reverted, test file kept): **4/17 fail exactly as predicted** — the 4 discriminating cases, each because the pre-fix code allowed what should be rejected. Candidate: **17/17 pass**. Full package suite: **684/684 pass** (677 pre-existing + 7 new), 0 regressions. `tsc --noEmit`: same 5 pre-existing, unrelated module-resolution errors as last night (`@claude-flow/shared/src/plugin-interface.js` unresolved — isolated-install artifact); 0 errors in either changed file.

No reward-hacking: diff is additive-only against tests; no existing threshold, claim requirement, or `CAPABILITY_GATES` entry for any other operation was touched; no gold data exists for this fix type.

An independent adversarial critic (fresh context, re-ran stash-isolation and the full suite itself, independently confirmed reachability at both call sites via the Ed25519-verified inbound dispatcher and the real peer registry on outbound send) returned **CONFIRMED** on the core bug and **PASS** on shippability. Two non-blocking caveats disclosed: (1) `claim-event`/`agent-handoff` still fall through the same default branch — pre-existing, unrelated, already covered by their separate absence from `DEFAULT_SECURITY_POLICY.allowedMessageTypes`; (2) an uncited editorial comment citing "Identiverse 2026" inside a source comment — trimmed same session.

## Darwin Results

Skipped — binary authorization-wiring fix (a trust floor is either enforced or it isn't), not a continuous/categorical parameter. Same skip class as nearly every ACCEPT in this repo's history that wasn't a routing/topology weight.

## SOTA Proof & Witness

Session commit: 2b1a392747d71117305c14321e7cdade92a0ce3e
Candidate commit: efd1f651c78db8184e9639ba958a37828093ddab
Gist SHA-256 (pre-witness, this block held to the literal text `PENDING`): 817ad6b63ffaab6547f3e13ee1f11006aaa04b85d3e5ca89f1d31f99bc324e6a
Witness stamp: 0ecc34991209f448c5b79e156cbc0e9532392f6e4e8e96f61e222d6f75512b2a

Verifier: fetch this file, replace this block's three dynamic values with the literal text `PENDING` (as they were before this computation), SHA-256 the result, concatenate with the Session commit above, SHA-256 again — must equal the Witness stamp.

Evaluation receipt identity: 7 new tests in `policy-engine.test.ts`, stash-isolated 4/17-fail-baseline → 17/17-pass-candidate; full suite 684/684. Flywheel evidence identity: none (`.claude-flow/flywheel/` doesn't exist in this repo). Darwin lineage identity: none (skipped, see above).

## Recommended Next Steps

1. **Reconcile `allowedMessageTypes` coverage going forward**: last night's caveat (`claim-event`/`agent-handoff` missing from the allow-list) is unrelated to tonight's fix but still open — a future night should decide deliberately rather than by omission.
2. **Extend `minTrustLevelForAdmin` semantics to `evaluateTrustChange()`**: that method (separate business logic for actually applying a trust change, not gating the message) already requires human approval for escalation *to* `PRIVILEGED`, but doesn't read `minTrustLevelForAdmin` either — worth checking for the same category of gap on a future night, not investigated deeply tonight.
3. **Revisit the three-plane framing (control/data/signaling) against Ruflo's full message taxonomy**: tonight only closed the gap for `trust-change`/`topology-change`; a systematic audit of every `FederationMessageType` against "which plane does this belong to" could catch a similar gap class before it's found ad hoc.
