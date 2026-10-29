# ADR 506: plugin secrets through `userConfig` with `sensitive: true`

Status: Proposed (2026-10-29)

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

Each plugin that needs a credential declares it as a `userConfig` option with `"sensitive": true` and `"required": false`:

- ruflo-cost-tracker: `openrouterApiKey`;
- ruflo-x-gateway: `adminToken`;
- ruflo-metaharness: `openrouterApiKey`.

The description says what the key is for and that it is stored in the credential store.

### 2.2 Read it through one helper

A shared helper, `readSecret(name, envFallbacks)`, is copied into each plugin's scripts folder; plugins may not import across folders. It reads, in order:

1. `CLAUDE_PLUGIN_OPTION_<NAME>`, which is set when the plugin runs under Claude Code with the option filled in;
2. the existing environment variables, kept for backward compatibility and for standalone CLI use.

It never logs or echoes the value. Its error text names the option and the variable, never the value.

### 2.3 Never put a secret in a command line

Plugin hooks and MCP entries that need a secret take it from the environment variable. They never use `${user_config.KEY}` substitution into argv: the value would be visible in `ps`, and the shell forms refuse it anyway.

### 2.4 Guard against regressions

A new audit, `scripts/audit-plugin-secrets.mjs`, runs in the existing `plugin-package-audit` CI job:

- It fails when a plugin declares a `userConfig` key whose name matches `/(key|token|secret|password|jwt)/i` without `sensitive: true`.
- It fails when a `.claude-plugin/plugin.json` or `hooks.json` carries a literal value that matches a secret shape. It uses the same patterns as the mods' secret screen.

## 3. What does not change

- The npm publish token and the helpers signing key stay in GCP Secret Manager. They belong to maintainer tooling, not to plugins.
- Environment variables keep working, so no user is broken.

## 4. Verification

- The audit is unit-tested with three fixtures: a key declared without `sensitive`, a literal secret, and a clean manifest.
- The helper is unit-tested: option over environment, fallback order, and no value in error text.
- Live: with `openrouterApiKey` set through `/plugin` configuration, a cost-tracker script receives it as `CLAUDE_PLUGIN_OPTION_OPENROUTERAPIKEY` and nothing else in the process sees it.
