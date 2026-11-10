# ADR 510: loading ruflo plugins in headless and Agent SDK workers

Status: Accepted (implemented in PR #4586)

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

## Implementation notes

- **Resolver:** `v3/@claude-flow/cli/src/mods/plugin-paths.ts` (`resolvePluginPaths`). "Local" is only a directory marketplace that Claude Code records in the user-level `known_marketplaces.json`, with an absolute path. The cache step takes the `installed_plugins.json` path first, else the highest version folder that holds a manifest.
- **Command builders:** `withHeadlessPlugins` (`src/mods/headless-plugins.ts`) is applied in the three places the CLI builds a `claude -p` worker: `HeadlessWorkerExecutor.executeClaudeCode` (the daemon's workers), `hive-mind work` (`runWithClaude`) and `hive-mind spawn --claude --non-interactive` (staged before the prompt, which stays the last argument; a missing plugin is returned as `data.claude.missingPlugins`). The interactive `hive-mind spawn --claude` launch is unchanged: an interactive start loads plugins the normal, trusted way. A caller's own `--plugin-dir` is matched by real path or by folder name and is never duplicated. A missing plugin is logged once per process and recorded as `missingPlugins` on `HeadlessExecutionResult`, on `RunOutcome`, and in the hive task's result record. `RUFLO_HEADLESS_PLUGINS` (comma list, or `none`) overrides the default profile (ruflo-mods).
- **Not changed, on purpose:** `services/fable-harness.ts` (the advisor/judge) also spawns `claude -p`, but it runs from a fresh empty temp directory precisely so the call carries no project context, and its argv is pinned by a test. Loading mods there would add hooks and context to a budget-capped judge call, so it is left out of the worker profile.
- **Out of the repo:** `/federation dispatch` lives in `~/.claude/helpers/federation.sh`, and the metaharness/Darwin runners are upstream packages; neither builds its command line in this repository. They can call `ruflo plugins paths --json`.
- **Doctor:** `ruflo doctor --component headless-plugins` (`src/mods/headless-check.ts`), `--component` only, because it spends a model call. On Claude Code 2.1.289 the init event carries `plugins: [{ name, path, source, version }]` (an inline plugin shows `source: "ruflo-mods@inline"`), and `plugin_errors` is absent when there are none; the check treats an absent key as empty. The runner is injectable and the tests use a fake one.
- **Deviation, mock model:** ADR-504's scripted mock model is not on `main` yet, so the doctor check cannot fall back to it. Without any model credential (API key, auth token, base URL, Bedrock/Vertex, or `<config>/.credentials.json`; macOS is assumed to have a keychain login) the check reports `skipped` as a warning instead of spawning. Once ADR-504 lands, the no-credential path can point `ANTHROPIC_BASE_URL` at it.
- **Trust boundary (review fix):** the first version also read `extraKnownMarketplaces.ruflo` from the project's `.claude/settings.local.json` and the committed `.claude/settings.json`, resolving a relative path against the project root, and preferred that over the user's clone and cache. That let a cloned repository choose the folder every daemon worker and `hive-mind work` loads in-process via `--plugin-dir`, with function hooks forced on and no trust prompt (interactive Claude Code gates a project-declared marketplace behind workspace trust; `--plugin-dir` does not, and an inline plugin replaces the marketplace copy of the same name, so the repo's code would also stand in for the user's ruflo-mods guard). The project's settings are no longer read at all: only Claude Code's user-level `known_marketplaces.json` (an entry the user added through an interactive, trusted start) can make a folder "local", and a relative path there is rejected. `ruflo mods install --source local` still resolves as local, because it also runs `claude plugin marketplace add <dir>`, and Claude Code keeps one ruflo marketplace per config dir in `known_marketplaces.json` (on this machine the entry carries no scope marker: `{ source: { source: "directory", path }, installLocation }`); `ruflo plugins paths` shows what a worker will load. Tests: a project-scope `settings.json` or `settings.local.json` pointing into the repo (absolute or `./x`) resolves to the clone or the cache, never the repo; a relative path is rejected. Live check (real filesystem, real `~/.claude`): a scratch project with `.claude/settings.json` declaring `ruflo` as `{ source: "directory", path: "./x" }` and a valid `./x/plugins/ruflo-mods/.claude-plugin/plugin.json` resolved to the user's own directory marketplace from `known_marketplaces.json`, not `./x`. No model call was spent on this pass: the change is in path resolution and at one spawn site, and the `--plugin-dir` load itself was live-validated below. Staging stays on by default: with the project removed as a source, every folder it can load is one the user installed. Revisit with ADR-509's signature check.
- **Deviation, signature check:** §3's "check the plugin's signature first when `modTrust` is `refuse-risky`" depends on ADR-509, which is not on `main`. Not implemented here.
- **Known side effect:** a daemon worker runs with `cwd` = the project, so its ruflo-mods session start rewrites `.claude-flow/mods/session.json` (display only; nothing decides by it).
- **Live validation (Claude Code 2.1.289, haiku):** `claude -p --plugin-dir <worktree>/plugins/ruflo-mods` wrote the heartbeat. `ruflo doctor --component headless-plugins` passed against this branch's ruflo-mods 0.8.0, and warned ("loads but its function hooks did not run") against a ruflo-mods 0.7.0 checkout, the release whose unmatched `session.start` registrations the loader refuses (#4485). That is the per-machine answer §2.4 asks for.
