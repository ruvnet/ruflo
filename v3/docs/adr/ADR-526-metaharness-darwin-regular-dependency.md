# ADR-526: @metaharness/darwin is a regular dependency, used in-process

- **Status:** Accepted
- **Date:** 2026-11-09
- **Amends:** [ADR-150](ADR-150-metaharness-integration-surfaces.md) rule 2, for `@metaharness/darwin` only
- **Related:** ADR-153 (darwin bench suites), #3366 (no tool-time npx)

## Context

ADR-150 makes MetaHarness a removable augmentation. Its rule 2 says every
`@metaharness/*` package is an optional dependency or an optional peer, and the
`no-metaharness-smoke` workflow fails the build if one appears in
`dependencies`.

`@metaharness/darwin` was declared as an optional dependency (`~0.13.0`), so a
default install already had it. But ruflo only ever reached it through
subprocesses:

- `metaharness_bench --op verify` spawned `node bench.mjs`, which spawned a
  second `node` for the darwin CLI.
- `metaharness_gepa` spawned `node gepa.mjs`, which then imported the darwin
  library anyway.

Both run inside the MCP server, a long-lived process that could hold the module
itself. darwin 0.13 exports everything these calls need as a library: the root
entry (`bench.loadSuite`, `bench.verifySuite`, evolve, scorer, archive) and
`./gepa`. It is small, with one dependency (`@babel/parser`), about 1.4 MB
unpacked, and declares `engines: node >=20`, so making it required does not
reintroduce the Node 20 optional-tree loss fixed in 3.73.0.

rUv asked for darwin to be integrated into ruflo as a dependency (2026-11-09).

## Decision

1. `@metaharness/darwin` moves from `optionalDependencies` to `dependencies` in
   `@claude-flow/cli`. **Only darwin.** `metaharness`, `@metaharness/router`,
   `flywheel`, `radio` and `turn-credit` keep ADR-150 rule 2.
2. The CLI imports darwin in-process through `src/metaharness/darwin-lib.ts`,
   which caches the module for the life of the process:
   - `metaharness_bench --op verify` → `benchVerify()` (`loadSuite` + `verifySuite`)
   - `metaharness_gepa` (genome, validate, render, analyze) → `gepaOp()`

   Each returns the same `{exitCode, json}` the plugin script produced, so the
   `{success, data, degraded, exitCode}` tool contract is unchanged. Verify also
   reports `suiteId`, `version`, `tasks`, `hashOk` and `hash` as fields, next to
   the old `stdoutTail` line.
3. `bench --op create`, `evolve` and `security bench` stay on the darwin CLI.
   `create` builds its scaffold task inside darwin's CLI code, and copying that
   would drift. `evolve` and `security bench` run for seconds to minutes, so a
   process spawn is noise there.
4. ADR-150 rule 3 (graceful degradation) still holds. If the import fails,
   `darwin-lib` returns null and the tool falls back to the plugin script, which
   keeps its own degraded path.
5. The plugin's `bench.mjs` verify also imports darwin directly, with a bare
   `import()` only. It never installs at tool time (#3366). When the library
   entry is missing, it uses the installed darwin CLI as before.

Gates updated in the same change:

- `no-metaharness-smoke.yml` allows exactly `@metaharness/darwin` in the CLI's
  `dependencies`.
- `doctor`'s declared-packages check and `metaharness-clean-install-test.mjs`
  read `dependencies` as well as `optionalDependencies`.
- `check-metaharness-pins.mjs` already accepted either.

## Measurements

From `scripts/benchmark-darwin-inprocess.mjs` (results in
`docs/benchmarks/runs/darwin-inprocess-*.json`). Setup: Node 22.23, 20 runs per
path, one long-lived process. Subprocess means spawning the plugin script; cold
means the first in-process call; warm means later calls.

| Operation | Subprocess median | In-process cold | In-process warm median |
|---|---|---|---|
| gepa validate | 21.4 ms | 2.9 ms | 0.03 ms |
| gepa render | 21.9 ms | 0.3 ms | 0.02 ms |
| bench verify (plugin script still spawning the darwin CLI) | 70.6 ms | 33.0 ms | 0.05 ms |
| bench verify (plugin script with item 5) | 59.7 ms | 40.0 ms | 0.05 ms |

Notes on these numbers:

- The cold cost is mostly the one-time darwin import (about 33–40 ms on this
  host).
- Node keeps the module cached after a cache reset, so only the first operation
  per entry pays it. That is why the gepa cold figures are small.
- The two bench rows ran under different host load (2.1 vs 5.7). Treat the
  plugin-script change as roughly one `node` start saved, not as an exact delta.
- Warm calls are function calls on a cached module, so the large ratios (700×+)
  measure spawn overhead removed, not faster darwin code.

**Install footprint:** a default install is unchanged, since npm already
installed darwin as an optional dependency. `npm install --omit=optional` now
also gets darwin and `@babel/parser`.

## Consequences

- MetaHarness bench and GEPA calls from Claude Code no longer spawn processes.
- A darwin release that breaks its library API now breaks ruflo at runtime. The
  `~0.13.0` range limits this to patch releases. `test-pin-alignment`,
  `metaharness-clean-install-test` and the new parity test
  (`__tests__/darwin-inprocess-adr526.test.ts`) catch export or behaviour drift.
- `npm ls --without @metaharness/darwin` is no longer a supported
  configuration. ADR-150 rule 1 still holds for every other MetaHarness
  package.
