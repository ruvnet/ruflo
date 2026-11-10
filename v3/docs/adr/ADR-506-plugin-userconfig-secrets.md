# ADR 506: plugin secrets through `userConfig` with `sensitive: true`

Status: Accepted (implemented in PR #4587, 2026-10-29)

Issue: #4581 follow-up 1.

## 1. Context

Today ruflo plugins read their credentials from the process environment, and therefore from shell profiles or `.env` files. The main ones:

| Variable | Used by |
|---|---|
| `OPENROUTER_API_KEY` | ruflo-cost-tracker, metaharness redblue, bench solvers |
| `PINATA_API_KEY` / `PINATA_API_SECRET` / `PINATA_API_JWT` | plugin registry publishing |
| `RUFLO_ADMIN_TOKEN` | ruflo-x-gateway |
| `CGF_CALLER_TOKEN` | x-gateway federation |
| `SERAPHINA_METALLM_KEY` | meta-llm gateway calls |
| `OLLAMA_API_KEY` | local model endpoints |

No ruflo plugin declares a `userConfig` option with `sensitive: true` (none of 40+ plugin manifests).

The Claude Code plugin reference describes what `userConfig` with `sensitive: true` does:
- The value is masked as it is entered.
- It is stored in the platform's secure credential store; non-sensitive values go under `pluginConfigs` in settings.
- Hooks receive it as the environment variable `CLAUDE_PLUGIN_OPTION_<KEY>`.
- MCP and exec-form hook `args` can use `${user_config.KEY}`.
- Shell-form hook commands, monitor commands and MCP `headersHelper` refuse `${user_config.*}` substitution.
- Monitor processes do not receive the `CLAUDE_PLUGIN_OPTION_*` variables.

## 2. Decision

### 2.1 Declare the keys

Each plugin that needs a credential, and has a path that can deliver it (2.2), declares it as a `userConfig` option with `"sensitive": true` and `"required": false`:

- ruflo-cost-tracker: `openrouterApiKey`;
- ruflo-metaharness: `openrouterApiKey`.

The description says what the key is for and that it is stored in the credential store. An option that no Claude Code process of the declaring plugin can receive is not declared: it would ask users for a secret that never arrives.

### 2.2 Deliver it to the code that uses it

Claude Code hands an option only to the declaring plugin's own hooks and MCP servers. The OpenRouter consumers are scripts that a skill or command runs through the Bash tool, which gets no `CLAUDE_PLUGIN_OPTION_*` variable. So each of the two plugins carries a SessionStart command hook that runs `scripts/_secret-env.cjs`. The hook appends `export OPENROUTER_API_KEY='…'` to `CLAUDE_ENV_FILE`, the file whose lines Claude Code loads into every later Bash command of the session. It does so only when the option is filled in and `OPENROUTER_API_KEY` is not already set. The scripts then read `OPENROUTER_API_KEY` as before.

The trade-off is stated plainly: the key then sits in the session's environment file under `~/.claude` (the bridge creates it owner-only when it is absent; a file Claude Code created keeps Claude Code's mode) and in the environment of that session's Bash commands, the same exposure as exporting it in a shell profile. What the option adds is masked entry and credential-store storage in place of a plain-text profile or `.env` file.

### 2.3 Read it through one helper

A shared helper, `readSecret(name, envFallbacks)`, is copied into each plugin's scripts folder; plugins may not import across folders. It reads, in order:

1. `CLAUDE_PLUGIN_OPTION_<NAME>`, which is set when the code runs as one of the plugin's own hooks or servers with the option filled in;
2. the existing environment variables, kept for backward compatibility, for standalone CLI use, and for the variable the bridge (2.2) writes.

It never logs or echoes the value. Its error text names the option and the variable, never the value.

### 2.4 Never put a secret in a command line

Plugin hooks and MCP entries that need a secret take it from the environment. They never use `${user_config.KEY}` substitution into argv: the value would be visible in `ps`, and the shell forms refuse it anyway.

### 2.5 Guard against regressions

A new audit, `scripts/audit-plugin-secrets.mjs`, runs in the existing `plugin-package-audit` CI job. It reads `.claude-plugin/plugin.json`, `hooks/hooks.json`, `.mcp.json` and `.lsp.json`, and fails when:

- a plugin declares a `userConfig` key whose name matches `/(key|token|secret|password|jwt)/i` without `sensitive: true`;
- any string, object keys included, matches a secret shape: the mods' secret screen patterns plus an OpenRouter key shape;
- a credential-named entry under an `env` or `headers` object holds a literal of 16 or more characters instead of a `${…}` reference;
- `${user_config.` appears in a `command`, `headersHelper` or `args` entry.

It never prints a matched value. A key shaped like a secret is shown as `<redacted-key>` in every path.

## 3. What does not change

- The npm publish token and the helpers signing key stay in GCP Secret Manager. They belong to maintainer tooling, not to plugins.
- Environment variables keep working, so no user is broken. A variable the user exported always wins over the option.
- ruflo-x-gateway keeps `RUFLO_ADMIN_TOKEN` from the environment of the deployed gateway (see 5).

## 4. Verification

- The audit is unit-tested with fixtures for each rule, including negative controls (`${user_config.…}` and `${VAR}` references, short and non-credential values) and a secret in key position whose output must not contain it.
- The helper and the bridge are unit-tested: option over environment, fallback order, no value in error text, shell quoting that round-trips through bash, refusal of multi-line values, owner-only env file, and byte-identical copies.
- Live: with `openrouterApiKey` supplied as a plugin option, a Bash tool command in the same session resolves the key from `OPENROUTER_API_KEY`.

## 5. Implementation notes

- **Review fix (PR #4587).** The first version declared the options and read `CLAUDE_PLUGIN_OPTION_*` in the scripts, but no consumer was launched in a way that receives it: the Bash tool gets no plugin options, the `metaharness_redblue` MCP tool runs inside ruflo-core's server (another plugin), and the gateway runs as a deployed service. The SessionStart bridge (2.2) was added, and the x-gateway `adminToken` option was removed.
- **x-gateway.** The gateway reads `RUFLO_ADMIN_TOKEN` in a server started from its Dockerfile and reached at `https://x.ruv.io` over HTTP MCP. No Claude Code process of the plugin ever runs that server, so no option can reach it. Its admin token stays an environment variable of the deployment.
- **Where the helpers live.** `scripts/_secret.mjs` (`readSecret`, `secretSource`, `secretHint`, `optionEnvName`) and `scripts/_secret-env.cjs` (`bridge`, `bridgeLines`) in ruflo-cost-tracker and ruflo-metaharness. Tests keep each pair of copies byte-identical.
- **Env var name.** Claude Code 2.1.289 derives the variable as `CLAUDE_PLUGIN_OPTION_` + the key with non-identifier characters replaced by `_` and upper-cased, so `openrouterApiKey` arrives as `CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY`. `optionEnvName` does the same.
- **Consumers.** cost-tracker `openrouter.mjs` uses `readSecret('openrouterApiKey', ['OPENROUTER_API_KEY'])` for `key` and `generation`. Through the Bash tool it finds the bridged `OPENROUTER_API_KEY`. `credits` needs a management key, which has no option, and stays environment-only. metaharness `_redblue.mjs` hands the option to the redblue child as `OPENROUTER_API_KEY` in its environment (never argv) only when that variable is not already set. A redblue run started from a skill gets the bridged variable.
- **What the bridge does not reach.** `CLAUDE_ENV_FILE` feeds the Bash tool only; MCP servers do not load it. So the `metaharness_redblue` MCP tool (ruflo-core's server) still needs `OPENROUTER_API_KEY` exported before Claude Code starts. A plugin-owned stdio MCP server with `env: {"OPENROUTER_API_KEY": "${user_config.openrouterApiKey}"}` would be the confined alternative. It would also keep the key out of the Bash environment. It is left for a follow-up because it adds a server and a tool surface. The bridge was verified on Linux only; where the Bash tool does not load `CLAUDE_ENV_FILE`, the environment variable remains the path.
- **Bridge rules.** The hook command is a `node -e` bootstrap (no shell expansion, no `${user_config}`), prints nothing, and never fails the session. Values are single-quoted with `'\''` escaping; a value containing a newline, carriage return or NUL is refused rather than written. When the bridge creates the file it uses mode `0600`; it does not change the mode of a file Claude Code already created.
- **Audit patterns.** The audit parses `COMMON_SECRETS` out of `plugins/ruflo-agentdb/hooks/screen.ts` instead of copying it (a `.mjs` cannot import the `.ts`), and fails when it parses no rules or finds no manifests. `LOCAL_SECRETS` adds `sk-or-v1-…` (OpenRouter), which the shared screen does not know. The env/headers rule covers tokens with no recognisable shape (admin, CGF, Seraphina). Its 16-character floor mirrors the screen's `key assignment` rule and leaves values like `"TOKEN_MODE": "readonly"` alone.
- **Name rule false positives.** `/(key|token|secret|password|jwt)/i` will also match future non-secret option names such as a token budget (`maxTokens`). No current option matches; such an option must be renamed or declared sensitive.
- **Live checks.** Two haiku runs (Claude Code 2.1.289), each with the option supplied through `--settings` `pluginConfigs` and `OPENROUTER_API_KEY` unset. The first used a probe plugin with this SessionStart hook. The second used the real `plugins/ruflo-cost-tracker`. In both, a Bash tool command resolved the key with `secretSource` = `OPENROUTER_API_KEY`, and the value matched. An earlier run showed `CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY` in the SessionStart and Stop hook environments. Storing the value in the credential store needs the interactive `/plugin` prompt, which a headless run cannot drive.
