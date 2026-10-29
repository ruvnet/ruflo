# ADR 509: trust for the ruflo plugin marketplace — signing, scan before install, refusing project auto-approve keys

Status: Proposed (2026-10-29)

Issue: #4581 follow-up 7. Builds on: the `modTrust` gate (ADR-404), `settings-risk-scanner.ts`, the helpers signing key (`ruflo-helpers-signing-key`), and `metaharness mcp-scan`.

## 1. Context

ruflo's marketplace (`ruvnet/ruflo`) is third-party. Claude Code reserves the official and community tier names for marketplaces sourced from `github.com/anthropics/`. Every plugin or mod installed from ruflo's marketplace runs with the user's privileges.

Three gaps remain.

1. **Nothing proves a plugin's files are the ones the maintainers reviewed.** The marketplace clone follows the default branch. A compromised branch, a malicious PR that slipped through, or a tampered local clone all load the same way. The ruflo CLI's helpers are already signed with Ed25519 (`helpers.manifest.json`, `scripts/sign-helpers.mjs`); plugins are not.
2. **No scan runs before install.** `ruflo mods install` and `ruflo init` call `claude plugin install` without checking what the plugin's MCP servers and hooks will run. `metaharness mcp-scan` exists, but nothing calls it on that path.
3. **Project settings can pre-approve things.** CVE-2025-59536 showed that a repository's `.claude/settings.json` with `enableAllProjectMcpServers: true` started an MCP server before the user could read the trust dialog. `settings-risk-scanner.ts` already flags hook payloads and `permissions.allow` entries that `ruflo init` carries forward, but it is advisory only, and it does not cover the auto-approve keys.

## 2. Decision

### 2.1 Signed plugin manifests

At release, a new script, `scripts/sign-plugins.mjs`, writes `plugins/<name>/.claude-plugin/signature.json` for every plugin in `.claude-plugin/marketplace.json`:
- a SHA-256 of every file in the plugin, as a sorted list of path and digest;
- the plugin's version;
- an Ed25519 signature over that canonical JSON.

The signing uses the **existing** helpers signing key pair, so no new secret is created. The public key is already pinned in the CLI.

`ruflo mods doctor` and a new `ruflo plugins verify [name]` check the marketplace clone (and the install cache) against the signatures:

| Result | When |
|---|---|
| `verified` | Every file matches and the signature is valid. |
| `modified` | Lists the files that differ. |
| `unsigned` | No signature file. |
| `bad-signature` | The signature does not verify. |

With `modTrust: refuse-risky`, ruflo-mods refuses to trust a ruflo plugin whose clone is `modified` or `bad-signature`. Its `plugin.register` gate already sees the plugin id; it gains the verify result through a status file that `ruflo mods doctor` writes at install time. Without that setting the result is reported, not enforced, because a contributor running from a local checkout is always `modified`.

### 2.2 Scan before install

`ruflo mods install`, `ruflo init` (mods path) and `ruflo plugins install` run a static scan of each plugin's `.mcp.json`, `hooks/hooks.json` and hook modules before `claude plugin install`. It reuses `metaharness mcp-scan` rules when that package is present, and the mods trust classifier (`hooks/trust.ts` capability list) otherwise.

- A `high` finding stops the install and names the plugin, file and rule. `--accept-risk <plugin>` overrides it for that one plugin and records the override in `.claude-flow/mods/install.json`.
- `medium` findings are printed and the install continues.

### 2.3 Refuse project-level auto-approve keys

`settings-risk-scanner.ts` gains these keys when they appear in **project** settings (`.claude/settings.json`, `.claude/settings.local.json`):
- `enableAllProjectMcpServers: true`;
- non-empty `enabledMcpjsonServers`;
- `permissions.defaultMode: "bypassPermissions"`;
- `permissions.allow` entries with a bare `Bash` or a `*` wildcard;
- `hooks` entries whose command is not a ruflo helper.

When `ruflo init` or `init --upgrade` would carry such a key forward, it now **stops** and prints the key and the reason. Two flags continue past it:
- `--keep-risky-settings` keeps the key;
- `--drop-risky-settings` writes the merged file without it.

`ruflo doctor` reports these keys as a warning in any project.

## 3. Limits

- Signing proves the files match a release. It does not prove the release is safe; review still does that.
- A user who points the marketplace at a fork gets `unsigned` or `modified`, by design.
- The scan is static. A hook that downloads code at run time is caught only by the rules that flag network and process use, which the trust classifier already names.

## 4. Verification

- `sign-plugins` and `verify` round-trip, including tamper, missing-file, extra-file and bad-signature cases.
- The install path stops on a `high` finding and records `--accept-risk`.
- The risk scanner covers each new key.
- `init` stops and `--drop-risky-settings` removes the key.
- Live: `ruflo plugins verify ruflo-mods` reports `verified` on a published release clone.
