# ADR 509: trust for the ruflo plugin marketplace — signing, scan before install, refusing project auto-approve keys

Status: Accepted (implemented in the PR from branch `feat/adr-509-plugin-trust`, 2026-10-29)

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

## Implementation notes

What shipped, and where it differs from §2.

**§2.1 signing.**
- `v3/@claude-flow/cli/scripts/sign-plugins.mjs` signs every plugin listed in `.claude-plugin/marketplace.json`. It writes `signature.json` into the plugin's marketplace `source` directory: `plugins/<name>` for most plugins, a subdirectory such as `plugins/ruflo-ai-team/directory` for the few whose source points there.
- It resolves the key exactly as `scripts/sign-helpers.mjs` does:
  - `RUFLO_HELPERS_SIGNING_SECRET` + `RUFLO_HELPERS_SIGNING_PROJECT`;
  - `RUFLO_HELPERS_SIGNING_KEY`;
  - `~/.ruflo/helpers-signing.key`;
  - `--stdin-key`.

  It never prints the key, and it refuses a non-Ed25519 key without echoing it.
- **Inside a git checkout it signs only the files git tracks.** A stray untracked file in the release checkout then verifies as `extra` and is never vouched for.
- **This PR signs nothing with the real key.** The tests use a generated key pair. Every plugin reports `unsigned` until the first signed release.
- **Release step** (after the tree is final, before tagging):

  ```bash
  RUFLO_HELPERS_SIGNING_SECRET=ruflo-helpers-signing-key RUFLO_HELPERS_SIGNING_PROJECT=ruv-dev \
    node v3/@claude-flow/cli/scripts/sign-plugins.mjs
  node v3/@claude-flow/cli/bin/cli.js plugins verify --clone . --strict   # every plugin must print verified
  ```

  Commit the `signature.json` files with the release. Re-sign whenever a plugin file changes: a stale signature reads as `modified`.
- **Verifier** (`src/plugins/marketplace-trust/signature.ts`). It uses the pinned `RUFLO_HELPERS_PUBKEY`.
  - A signature whose `plugin` field is not the marketplace name is `bad-signature`, so a valid signature cannot be copied onto another plugin.
  - Symlinks are digested as `link:<target>` and never followed.
  - `.git` and `node_modules` are not signed content.
- **Status file location.** The status file is `~/.claude-flow/mods/plugin-verify.json`, keyed by Claude Code config dir. It lives under home rather than in the project, so a repository cannot ship a file that says its own tampered clone verified. These commands write it:
  - `ruflo mods install`, after the claude step;
  - `ruflo mods doctor`;
  - `ruflo plugins verify`, unless `--clone` is given.
- **Mod gate.** The `plugin.register` gate (`plugins/ruflo-mods/hooks/trust.ts`, `marketplaceRefusal`) refuses a user-tier `<name>@ruflo` module whose result is `modified` or `bad-signature`. It does so only under `modTrust: refuse-risky`.
  - `modTrustAllow` does not exempt the check: a tampered clone shares the allow-listed provenance.
  - A missing or unreadable result, `unsigned`, or `verified` is not enforced, because unknown is not a refusal.
  - A verified module still goes through the existing risk judge.
- **Exit and doctor behaviour.**
  - `ruflo mods doctor` reports `unsigned` as a pass that says "unsigned", so `mods doctor --strict` CI gates do not fail before the first signed release. `modified` and `bad-signature` warn.
  - `ruflo plugins verify` exits 1 on `modified` and `bad-signature`. With `--strict` it also exits 1 on `unsigned`.

**§2.2 scan before install.**
- `src/plugins/marketplace-trust/scan.ts` is a built-in static scan. `metaharness mcp-scan` is not called: it is an optional subprocess, and it reads a harness layout (`.mcp/servers.json`), not a plugin layout. The scan reuses two existing rule sets:
  - the settings-risk-scanner command rules, for `.mcp.json` server commands and `hooks/hooks.json` command hooks;
  - the capability names from the ruflo-mods trust classifier (`$.process`, `$.http.fetch`, `$.mcp`, `$.tool.call`, `$.config.set`), for hook modules.
- **Severity.**
  - High: a dangerous command, or a hook module that imports `child_process` or uses `eval` / `new Function`.
  - Medium: a capability use, an unpinned `npx -y` server, or a remote plain-http MCP URL.
  - Measured on this tree: 0 high and 17 medium across all 47 marketplace plugins, so no ruflo plugin is blocked.
- **`ruflo mods install` and `ruflo init` (mods path).** The scan runs after the marketplace refresh and before any `claude plugin install`. It is wired in through a new `beforeInstall` hook in `repairPluginInstall`.
  - A blocked plugin's install step does not run. The step output names the file and the rule.
  - `--accept-risk <plugin>` on `ruflo mods install` overrides the block. The override is recorded under `acceptedRisk` in `.claude-flow/mods/install.json`.
  - `ruflo init` has no `--accept-risk` of its own. A plugin it blocks is reported, and `ruflo mods install --accept-risk <name>` completes it.
  - A `--source local` directory marketplace has no install step, so nothing is gated there.
- **`ruflo plugins install`.**
  - A local-path install is scanned the same way, with `--accept-risk <dir-name>`.
  - An npm or registry install is not scanned before it is registered: the package lands inside the plugin manager. That path keeps its existing checksum and trust gates.

**§2.3 project auto-approve keys.**
- `settings-risk-scanner.ts` gains `scanProjectAutoApproveKeys` and `dropAutoApproveKeys`.
- **What counts as a ruflo helper.** A hook counts as one when `isRufloHelperCommand` (in `helper-commands.ts`) recognises it, with nothing chained onto it. That covers:
  - every form ruflo generates;
  - the older `npx @claude-flow/cli@… hooks|memory …` hooks that `init upgrade` migrates.

  ruflo's own generated settings produce no finding, so a re-init never stops on itself.
- **Where it stops.** The check runs before anything is written, so a stop leaves the project untouched. These commands can stop:
  - `ruflo init` and its wizard, when merging into an existing `.claude/settings.json`;
  - `init hooks`;
  - `init upgrade --settings`.

  `--force`, and an upgrade without `--settings`, carry nothing forward and never stop.
- **Flags.** `--keep-risky-settings` keeps the keys and still reports them. `--drop-risky-settings` writes the merged file without them. Passing both is an error.
- **Doctor.** `ruflo init` merges only `settings.json`. `ruflo doctor` (component `auto-approve`) warns on both `settings.json` and `settings.local.json`.
- **Behaviour change for existing projects.** If a project's settings carry any hook ruflo did not write (for example a formatter), `init upgrade --settings` now stops until one of the two flags is given. Two existing test fixtures carry such a hook. Both now pass `--keep-risky-settings` and assert the stop:
  - `mods-commands.test.ts`, case `--add-missing and --settings`;
  - `doctor-2677-stale-settings.test.ts`.

**Live validation.**
- **Setup.** Claude Code 2.1.289 with haiku and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. `--plugin-dir` pointed at this branch's `plugins/ruflo-mods`, and `modTrust: refuse-risky` was set through `--settings pluginConfigs`. A temporary status file marked three marketplace-installed plugins:
  - `ruflo-docs` as `modified`;
  - `ruflo-jujutsu` as `bad-signature`;
  - `ruflo-testgen` as `verified`.
- **Mod gate result.** The debug log showed:
  - `ruflo-docs@ruflo` refused with "marketplace clone is modified (ADR-509 signature check)";
  - `ruflo-jujutsu@ruflo` refused as `bad-signature`;
  - `ruflo-testgen@ruflo` passed through to the risk judge.

  The temporary file was removed afterwards.
- **Init result.** The scratch project's settings held `enableAllProjectMcpServers: true` and a bare `Bash` allow. `ruflo init` stopped with exit 1 and wrote nothing. The same run with `--drop-risky-settings` wrote merged settings without either key.

**Not done here.** §4 asks for a live `ruflo plugins verify ruflo-mods` that reports `verified` on a published release clone. That needs the first signed release; until then it reports `unsigned`.
