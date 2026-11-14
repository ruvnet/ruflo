# ADR-532: WASM agent entries degrade to n/a when @ruvector/rvagent-wasm is absent

- **Status**: proposed
- **Date**: 2026-11-13
- **Deciders**:
- **Tags**: packaging, ruflo-console, wasm, optional-dependencies
- **Issue**: [#3979](https://github.com/ruvnet/ruflo/issues/3979) item 1

## Context

The WASM agent surface (`wasm_gallery_*`, `wasm_agent_*` MCP tools, `agent wasm-*`
CLI subcommands, and the ruflo-console Dev Tools → WASM agents rows) is backed by
`@ruvector/rvagent-wasm`, which `src/ruvector/agent-wasm.ts` imports lazily.

No supported install ships that package:

- `@claude-flow/cli` does not declare it, and the `no-cli-optdep-bloat-2561`
  guard (workflow + `agent-wasm-not-installed-3979.test.ts`) forbids adding it.
- The `ruflo` wrapper is pinned at zero optional dependencies (`RUFLO_MAX = 0`)
  because this package was one of those that made a cold `npx ruflo` time out.
- PR #4340 tried adding it to the `claude-flow` and `ruflo` umbrellas and was
  closed for exactly that reason.

PR #4179 already turned the raw `ERR_MODULE_NOT_FOUND` into a clear
"@ruvector/rvagent-wasm is not installed … npm install …" message. What remains
from #3979 item 1 is the experience: on a global `ruflo` install every console
WASM row is a button that can only fail.

Options considered:

1. **Declare the dependency** (CLI, umbrella, or wrapper) — rejected by #2561 /
   #4340; it reintroduces the cold-npx timeout.
2. **Lazy runtime install** (fetch the package on first use) — rejected: an
   unasked network fetch and code install from an MCP or console read is a
   supply-chain and consent problem, and it would still fail offline.
3. **Detect absence and degrade** — Dragan's alternative ask: hide/disable the
   entries when the package is absent.

## Decision

Option 3.

1. **ruflo-console** probes for the package when the Dev Tools page opens
   (local, read-only, $0), with the same shape as the existing tmux probe
   (`state.devtools.tmux`, `withTmux`): a `needs: 'rvagent-wasm'` marker on each
   WASM row, a `'unknown' | 'present' | 'missing'` state, and a pure helper that
   turns a row into an n/a row while the package is known missing. The n/a
   reason states the install command. While the probe is unknown or fails for
   another reason, rows stay runnable (the CLI's own message still applies), so
   the probe can never hide a working feature.
2. The probe uses the CLI's own availability check (`agent wasm-status
   --format json`), so it resolves the package exactly where the CLI does
   (a global install sees the global `node_modules`, `npx` does not). The JSON
   form of that command prints only JSON, so the console can parse it.
3. The palette drops n/a rows as it already does, so `/ruflo run dt-wasm-*`
   is not offered while the package is missing.
4. Nothing is installed automatically. The CLI keeps its `not installed`
   message; the #2561 guard and the CLI's `optionalDependencies` are unchanged.

## Consequences

### Positive
- No WASM row is shown as runnable when it can only fail.
- No new dependency in any published package; cold `npx` is unaffected.
- Reuses an existing, tested console pattern instead of a new mechanism.

### Negative
- Opening Dev Tools runs one extra local CLI process for the probe.
- The MCP `wasm_*` tools still list in `tools/list` without the package; they
  answer with the clear "not installed" error rather than being hidden.

### Neutral
- Users who want WASM agents install the package themselves
  (`npm install -g @ruvector/rvagent-wasm` next to a global ruflo).

## Links
- Issue #3979 (item 1); PR #4179 (not-installed message); PR #4340 (closed: umbrella optional dep)
- `.github/workflows/no-cli-optdep-bloat-2561.yml`
- `plugins/ruflo-console/hooks/sandbox.ts` `probeTmux` / `plugins/ruflo-console/hooks/devtools.ts` `withTmux` (prior art)
