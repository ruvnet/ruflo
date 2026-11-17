# ADR-528: ruv-FANN weight-space tooling as optional dependencies (`neural wsp`)

- **Status:** Accepted
- **Date:** 2026-11-11
- **Related:** [ADR-527](ADR-527-centroid-agent-router.md) (centroid router; ruv-fann routing deferred), ADR-150 (optional-integration constraints)
- **Surfaces:** `neural wsp {status,inspect,check,gate,export-centroid}`, `src/commands/neural-wsp.ts`, `src/ruvector/ruv-fann-wsp.ts`

## Context

ruv-FANN 0.3.0 (2026-11-11) is a facade over fifteen capability packages. Its
neural core is unchanged from 0.1.2, the version agentdb 3.10.0 and
@metaharness/darwin 0.14.0 already pin, so it does not change ADR-527's result
(training did not beat the nearest-centroid router). What is new is the
weight-space programming (WSP) toolkit: hash-bound inspection, finite-domain
invariant checks and bounded-patch regression gates.

Installing the facade into `ruflo@3.76.0` adds 60 packages, including
`esbuild` (an install script, via `ruv-fann-wsp-cloudflare`) and a native RVF
binding, for capabilities ruflo does not call (Cloudflare workers, Hugging Face
fetches, worker-thread evolution loops with promotion authority).

The WSP regression gate is not a fit for gating centroid rebuilds: a rebuild
changes ~4,224 weights and a patch is capped at 128 edits, and the gate's
policy is MSE-only, not argmax accuracy.

## Decision

1. Add three exact-pinned **optional** dependencies to `@claude-flow/cli`:
   `ruv-fann-wsp@0.2.0`, `ruv-fann-wsp-invariants@0.1.0`,
   `ruv-fann-wsp-lifecycle@0.1.0`. They reuse the `ruv-fann@0.1.2` core and
   `ruv-fann-wasm@0.1.2` runtime already in the tree: three new packages, no
   install scripts, no native code. `ruv-fann-wsp@0.2.0` (not 0.2.1) matches
   what lifecycle and invariants pin, so one copy is installed.
2. Do **not** depend on the `ruv-fann` 0.3.0 facade, `cloudflare`,
   `huggingface`, `loop`, `swarm`, `ruos` or `agenticow` subpackages.
3. Expose them as `neural wsp`, read-only evidence that never promotes a model
   or changes routing:
   - `status` — installed versions and limits;
   - `inspect` — fingerprint and shape of a model (default: the centroid router);
   - `check` — invariants; with no `--model`, a built-in **self-routing suite**
     for the centroid router: fed its own centroid, each label must score
     1 ± 1e-5 and every other label at most `1 − minGap` (default 0.05). A
     failure means near-duplicate labels or a corrupt artifact;
   - `gate` — `runRegressionGate` on a user model, ≤128-edit patch and suites;
   - `export-centroid` — the centroid router as a one-layer Linear
     `ruv-fann.dense-layers/1` model (refuses to overwrite without `--force`).
4. The packages are loaded with a dynamic `import()` only inside those
   subcommands. When any is missing, each subcommand exits 2 with the reason;
   nothing else in the CLI imports them.
5. User-supplied files must be regular files (after resolving symlinks) of at
   most 2 MiB; WSP itself rejects unknown fields, non-plain objects and
   out-of-limit models.

## Consequences

- Cold start and `hooks route` are unchanged (measured equal to 3.76.0).
- The shipped centroid router passes self-routing at the default gap; its
  closest pair (coder/researcher/tester) sits at cosine 0.41–0.47, which
  `check --min-gap 0.6` surfaces.
- Picking up `ruv-fann-wsp@0.2.1` or `ruv-fann-wasm@0.1.3` waits for upstream
  to repin lifecycle and invariants.
- No routing-accuracy claim is made for this change.
