# ADR 510: loading ruflo plugins in headless and Agent SDK workers

Status: Proposed (2026-10-29)

Issue: #4581 follow-up 8. Builds on: ADR-404 (mods), the headless worker daemon, and the ADR-502 canary (mods ran under `claude -p --plugin-dir`).

## 1. Context

ruflo starts headless Claude Code workers in three places:
- the background worker daemon;
- `/federation dispatch`;
- metaharness and Darwin runners using `claude -p`.

None of these uses the Claude Agent SDK library. ruflo has no `@anthropic-ai/claude-agent-sdk` dependency. Third parties do embed ruflo's plugins in SDK sessions.

What is known:
- **`claude -p` on a fresh config loads no marketplace plugins.** The marketplace is cloned only by an interactive, trusted start (ruflo-mods README). A headless worker therefore runs without ruflo-mods' guard, routing and learning loop unless something loads them.
- **`claude -p --plugin-dir <path>` loads a plugin from a local folder**, function-hook mods included, when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The ADR-502 canary confirmed this on 2.1.289.
- **The Agent SDK accepts plugins only as `{ type: "local", path }`** (Agent SDK plugins docs). A plugin path that does not exist is skipped without an error; the session's init message reports `plugins` and `plugin_errors`. Whether function-hook mods run under the SDK is not documented. The deep-research run could not establish it.

## 2. Decision

### 2.1 One resolver

A new module, `v3/@claude-flow/cli/src/mods/plugin-paths.ts`, provides `resolvePluginPaths(names)`. It returns an absolute folder per plugin, trying in order:

1. a `--source local` marketplace directory (the checkout);
2. the marketplace clone (`$CLAUDE_CONFIG_DIR|~/.claude/plugins/marketplaces/ruflo/plugins/<name>`);
3. the install cache (`.../plugins/cache/ruflo/<name>/<version>`).

A plugin whose folder lacks `.claude-plugin/plugin.json` is reported as missing. It is never returned.

### 2.2 Headless workers pass `--plugin-dir`

Every place where ruflo builds a `claude -p` command line adds `--plugin-dir <path>` for each resolved plugin in its worker profile. The default profile is ruflo-mods only. It also sets `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` unless the caller set it.

If a plugin cannot be resolved, the worker:
- starts anyway;
- logs `plugin <name> not found; worker runs without it` once per process;
- records the missing plugin in the worker's status.

It does not fail silently, and it does not refuse to run.

### 2.3 SDK users get the same resolver

`ruflo plugins paths [--json]` prints the resolved paths and any missing plugins. An SDK caller can then build `plugins: [{ type: "local", path }]`. The README section "Using ruflo plugins from the Agent SDK" shows this, and it shows checking the init message's `plugin_errors`.

### 2.4 Verify, do not assume

`ruflo doctor --component headless-plugins` runs `claude -p --plugin-dir <ruflo-mods> --output-format stream-json "reply ok"` with a 60-second timeout. Without a model key it uses ADR-504's mock model. It reports:
- whether the init event lists ruflo-mods;
- whether `plugin_errors` is empty;
- whether the mod's session heartbeat (`.claude-flow/mods/session.json`) was written.

This answers "do mods run headless here" per machine instead of from documentation. Running the same check through the Agent SDK stays a documented manual step until ruflo takes an SDK dependency.

## 3. Limits

- Function hooks under the SDK are unverified. The README says so.
- `--plugin-dir` loads the plugin from disk as-is. Combined with ADR-509, a worker can check the plugin's signature first; the default worker profile does so when `modTrust` is `refuse-risky`.

## 4. Verification

- `resolvePluginPaths`: tested for each source in order, a missing manifest, and a `CLAUDE_CONFIG_DIR` override.
- The worker command builder adds `--plugin-dir` and the environment variable, and does not duplicate a caller's own flag.
- The doctor check is covered by a test using the ADR-504 mock model.
- Live: a daemon worker run shows the ruflo-mods heartbeat.
