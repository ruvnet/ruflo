# Checking a dogfood-helper sync

The packaged `v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs` and the
repository's `.claude/helpers/hook-handler.cjs` must both retain the
`require.main === module` startup guard and the `runWithTimeout` and
`INTELLIGENCE_TIMEOUT_MS` exports. A manual copy must preserve them (#3206).

Before committing a helper sync:

1. Make the intended helper changes and update the dogfood copy as needed.
2. If a packaged critical helper changed, an authorized maintainer must run
   the existing signer from `v3/@claude-flow/cli`:
   `node scripts/sign-helpers.mjs`. Use the project's existing private-key
   provisioning; never commit a key. Contributors without the signing key
   should ask a maintainer to sign the reviewed helper changes.
3. Install the CLI test dependencies with `pnpm install --frozen-lockfile`
   from `v3` (pnpm 8, Node 22, matching the Test V3 Packages job in
   `.github/workflows/v3-ci.yml`).
4. From the repository root run `node scripts/check-helper-sync.mjs`.
   This runs the timeout suite on both copies, then the CLI's
   `__tests__/helper-signing.test.ts` with its local Vitest 4. It checks the
   real committed manifest signature and every listed packaged helper's bytes.
5. Commit the helper changes and matching `helpers.manifest.json` together.

This is a manual pre-commit check. The helpers-manifest-guard workflow runs
the same command after a push or PR as an enforced CI backstop. The check
never signs or repairs files: stale or invalid committed signatures must fail.
Publish-time re-signing cannot repair a manifest that already failed CI.
