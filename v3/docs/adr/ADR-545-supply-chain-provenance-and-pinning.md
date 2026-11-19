# ADR-545: Provenance-attested releases and pinned install output

- **Status:** Proposed
- **Date:** 2026-11-19
- **Related:** ADR-513 (alpha tags frozen), ADR-509 (plugin install trust gate), ADR-453 (Project Anatole), ADR-404 (ruflo as a mod)
- **Surfaces:** `.github/workflows/stable-npm-release.yml`, `scripts/verify-npm-provenance.mjs`, `v3/@claude-flow/cli/src/init/*` (pinned output, `--repin`), `ruflo doctor --component provenance`, the RuVector publish workflows (ruvnet/ruvector)

## Context

A client security review (2026-11-19) asked for four things before adopting ruflo:

1. Publish `ruflo`, `claude-flow` (and `@claude-flow/cli`) and RuVector with SLSA provenance, as other packages they use already do. Confirm hardware-key 2FA on the npm and GitHub accounts.
2. Move the generated hooks and CLAUDE.md off `@latest` onto pinned, provenance-verified versions.
3. Before applying an artex-defense detection pack to their environment, build an identity telemetry feed (auth events, session changes, credential resets) so the detections have something real to replay.

The current state, measured on 2026-11-19:

- No version of `ruflo`, `claude-flow`, `@claude-flow/cli`, `ruvector` or `@ruvector/core` carries a provenance attestation. The registry endpoint `/-/npm/v1/attestations/ruflo@3.78.1` returns 404.
- The train is published from a maintainer laptop with a granular token (`bypass_2fa: true`). npm can mint provenance only inside a supported CI (GitHub Actions OIDC), so a laptop publish cannot be attested.
- `stable-npm-release.yml` already builds, packs, smoke-tests and publishes the three archives from an immutable tag. It last ran in September (3.47.1), had no `id-token` permission and no `--provenance`, and moved the `alpha`/`v3alpha` tags, which ADR-513 forbids.
- `ruflo init` writes about 80 `@latest`/`@alpha` references into user projects: hook helpers, `.mcp.json` (`npx -y ruflo@latest mcp start`) and CLAUDE.md. Every `npx` call therefore resolves whatever was published last, so a compromised publish would reach every project on its next hook.

## Decision

### 1. The train is published only from CI, with provenance

- `stable-npm-release.yml` publishes each verified archive with `npm publish --provenance`. The job has `permissions: { contents: read, id-token: write }` and runs on a GitHub-hosted runner.
- The workflow fails before publishing if any package's `repository.url` is not `git+https://github.com/ruvnet/ruflo.git` (npm rejects provenance from a mismatched repository).
- A new `dry_run` input defaults to **true**. Publishing requires `dry_run: false` **and** a dispatch from `main`. A dry run stops after the archives are built, smoke-tested and uploaded as an artifact.
- **Promotion gate:** archives are first published under a `release-<version>` candidate tag. `latest` moves only after `scripts/verify-npm-provenance.mjs` confirms the registry holds a SLSA v1 provenance statement whose subject digest equals the verified archive's sha512 and whose build ran in `https://github.com/ruvnet/ruflo`. A version that fails the gate stays on its candidate tag and is never promoted.
- Only `latest` moves (ADR-513); the `alpha`/`v3alpha` writes and checks are removed.
- The laptop publish path in CLAUDE.md is retired for the train: 3.79.0 is the first release cut through this workflow. Versions up to 3.78.1 have no provenance and cannot gain it retroactively.
- Non-bundled leaves (`@claude-flow/neural`, `memory`, `shared`, `cli-core`) need the same path. Until a leaf workflow exists, a leaf published from a laptop is unattested, and `ruflo doctor --component provenance` reports it as such.

### 2. Generated projects pin exact versions and verify them

- `ruflo init` writes our packages at the running CLI's own exact version (`npx -y ruflo@3.79.0 …`), never `@latest` or `@alpha`. `--channel latest` keeps the old floating behaviour for people who choose it.
- `ruflo init --repin` rewrites an existing project's `.claude/settings.json`, `.mcp.json`, CLAUDE.md and `.claude/helpers/*` to the current version. It is idempotent, has a dry run, and lists every changed line. Helper auto-refresh must not undo a pin.
- `ruflo doctor --component provenance` (also run by `--repin`, and as a non-fatal warning at init) checks the pinned version's attestation the same way the release gate does: SLSA v1, matching digest, repository `ruvnet/ruflo`. Missing provenance on an older version is a warning; an attestation for the wrong repository or digest is a failure.
- `npm audit signatures` stays the end-to-end check users run in their own project. It verifies the sigstore signatures over the attestations.
- **Limit:** a pin fixes the top-level package only. Its dependencies still resolve within their declared ranges at `npx` time. A project that needs the whole tree frozen should install ruflo as a devDependency with a lockfile and call the local binary rather than `npx`.

### 3. RuVector

The same change goes to ruvnet/ruvector's publish workflows (`--provenance`, `id-token: write`, matching `repository` fields) in a PR in that repository. Packages that are published only from a laptop there need a CI path before they can be attested.

### 4. Account security: needs the maintainer, not code

- An agent cannot confirm the second factor's type: the GitHub API does not expose it, and npm reports only the 2FA mode. The maintainer must confirm by hand that both the npm and GitHub accounts use a hardware security key (WebAuthn/FIDO2) and no TOTP or SMS fallback, then record the date here.
- The npm account currently has "require 2FA for writes" turned off and uses a granular token with `bypass_2fa` for publishing. With publishing moved to CI, the target state is:
  1. npm **trusted publishing** (OIDC) configured for the three packages and bound to `ruvnet/ruflo` + `stable-npm-release.yml`. This is set on npmjs.com, per package, by the maintainer.
  2. Then the long-lived `NPM_TOKEN` is removed from the repository secrets and Secret Manager.
  3. Then write-2FA is turned back on for the account.
- Until then, the GitHub `NPM_TOKEN` secret is the only standing credential, and it is usable only by this workflow, only by `ruvnet`, only from `main`.

### 5. Identity telemetry for artex-defense: not ruflo code

- The identity feed (IdP auth events, session creation/revocation, MFA and credential resets) lives in the client's environment and SIEM. It is a prerequisite for their detection pack, not a ruflo feature, so this ADR implements nothing for it.
- The maintainer's offer is advisory help building that feed, scoped separately with the client.
- ruflo-side work would be justified only if the client wants ruflo's own security-relevant events (Project Anatole alerts, plugin install-trust decisions, MCP auth failures) exported to that feed. That would be a separate ADR.

## Consequences

- Each release is slower (a CI run of about 30 to 75 minutes instead of a laptop publish), and a broken workflow blocks the release instead of being bypassed.
- Consumers can verify every version from 3.79.0 on, and the release gate refuses to promote an archive that does not match its attestation.
- Generated projects no longer auto-update; users move with `ruflo init --repin` after upgrading the CLI. That is the point: an update becomes a decision.
- Trusted publishing and hardware-key 2FA remain open until the maintainer completes them. This ADR stays Proposed until the account items are recorded.

## Verification

- `node --test scripts/__tests__/verify-npm-provenance.test.mjs` uses fixtures for a valid attestation, a publish-only attestation, a wrong digest, a wrong repository and bad input. It runs in `v3-ci.yml`.
- The verifier passes against a real attested package (`@sigstore/sign`, repository `sigstore/sigstore-js`) and fails when told to expect `ruvnet/ruflo`.
- A `dry_run: true` dispatch of the workflow builds, smoke-tests and uploads the archives without publishing.
- After 3.79.0: `curl https://registry.npmjs.org/-/npm/v1/attestations/ruflo@3.79.0` returns a SLSA v1 statement, and `npm audit signatures` in a fresh `npm i ruflo@3.79.0` project reports verified attestations.
