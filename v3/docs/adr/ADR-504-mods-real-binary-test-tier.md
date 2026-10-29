# ADR 504: a real-binary test tier for ruflo mods and hooks

Status: Accepted (implemented in PR on branch feat/adr-504-real-binary-tier, 2026-10-29; see section 5)

Issue: #4581 follow-up 5. Builds on: ADR-404 and the mods harness (`v3/@claude-flow/cli/__tests__/mods/harness.ts`).

## 1. Context

ruflo tests its mods in a single tier: a TypeScript harness that imitates the engine's contract. It catches most regressions but missed #4485. ruflo-mods 0.7.0 shipped with two `session.start` registrations that had no matcher. The real loader refuses that, so none of the mod's hooks ran.

The harness has learned that rule since, but it can only check rules someone already knows. The ADR-502 canary turned up two more facts the harness had only assumed, and both came from running the real binary:
- a non-zero Bash exit sets `isError`;
- `$.fs.write` into `.claude-flow/data/` succeeds.

vigiles (zernie/vigiles) tests hooks in three tiers:
- **unit:** pure hook logic;
- **deterministic:** the real `claude` binary talking to a scripted model;
- **eval:** a paid model.

Only the eval tier needs an API key.

## 2. Decision

Add the middle, deterministic tier.

### 2.1 Scripted model

A new file, `v3/@claude-flow/cli/__tests__/real-binary/mock-model.mjs`, runs a local HTTP server that speaks the Anthropic Messages API, both streaming and non-streaming.

- It replays a scripted conversation from a fixture: assistant turns, `tool_use` blocks with fixed inputs, and the final text.
- Claude Code reaches it through `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` with a dummy `ANTHROPIC_API_KEY`.
- It logs every request it receives, so a test can check what context reached the model, such as the `[RUFLO_LESSONS]` block or the route block.
- Requests it does not recognise get a minimal valid answer, so an engine-internal call (title or summary generation) cannot hang the run.

### 2.2 Runner

`__tests__/real-binary/run.ts` launches:

```
claude -p "<prompt>" --plugin-dir plugins/ruflo-mods --settings <fixture> --output-format stream-json
```

The run happens in a temporary project, with:
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`;
- an isolated `HOME` and `CLAUDE_CONFIG_DIR`;
- the mock model.

The runner returns the exit code, the stream-json events, the mock's request log, and the temporary project's files.

### 2.3 First contracts

1. **Loads.** With every boolean option on, ruflo-mods loads with no module error. This checks the #4485 class against the real loader.
2. **Learning loop.** A scripted turn edits a file and runs `npm test` (`node --test`), first failing and then passing. `verified-trajectories.jsonl` gets one `verified-success` record.
3. **Lessons reach the model.** With a lessons file present, the mock's next request contains the `[RUFLO_LESSONS]` block.
4. **Guard tightens.** A scripted Bash call that deletes the filesystem root is denied before it runs.
5. **Route context.** The route block reaches the request.

### 2.4 Where it runs

A new CI job, `mods-real-binary`, in `.github/workflows/mod-guidance.yml`:

- It installs a pinned Claude Code version (`npm i -g @anthropic-ai/claude-code@<pin>`) and runs the tier. It needs no secret.
- The pin is moved only by PR. An engine change that breaks a contract is then caught on the version bump, not in users' sessions.
- If the binary cannot be installed or started, the job fails and names the step. It never skips silently.

The tier also runs locally with `npm run test:real-binary` from `v3/@claude-flow/cli`.

## 3. Limits

- **The mock is not a model.** It cannot show whether a lesson changes behaviour; that belongs to the paid eval tier (ADR-503 §3).
- **Request shapes may change between Claude Code versions.** The mock accepts unknown fields and asserts only on message content.
- **Some features may refuse a non-Anthropic base URL.** If one does, its contract moves to the eval tier and is never faked.

## 4. Verification

The tier must be able to catch #4485. Adding a second `session.start` registration without a matcher to a scratch copy of ruflo-mods must make contract 1 fail.

## 5. Implementation notes

Built against Claude Code 2.1.289, the version installed where this was written and the version the CI job pins.

**Files.** `v3/@claude-flow/cli/__tests__/real-binary/`: `mock-model.mjs` (the scripted Messages server), `run.ts` (the runner), `loads.test.ts` (contract 1) and `contracts.test.ts` (contracts 2 to 5). `vitest.real-binary.config.ts` runs them; `npm run test:real-binary` from `v3/@claude-flow/cli` calls it. The tier takes about 6 seconds locally.

**Kept out of every default run.** Three runners would otherwise collect the files: the CLI's `vitest.config.ts` (now excludes `__tests__/real-binary/**`), `v3/vitest.config.ts` (excludes the same path) and the root ratchet (`scripts/ci-test-excluded.txt` lists both files, with the job that runs them).

**What #4485 looks like to the real loader.** The refusal is silent. A copy of ruflo-mods with a second bare `session.start` gives exit 0, empty stderr, a `success` result, and the plugin still listed in `init.plugins`. Only behaviour changes, so contract 1 asserts behaviour:
- the session-start heartbeat `.claude-flow/mods/session.json` is written, and with `capabilityProbe` on it lists `session.start`;
- `/ruflo-mods` is in `init.slash_commands`;
- `/ruflo-mods` is answered by the mod, with zero requests to the model.

The negative control is committed: `loads.test.ts` copies ruflo-mods to a temp directory, adds the bare registration, and asserts the heartbeat is missing, the command is not registered and the prompt goes to the model. Run by hand against a scratch copy first, the same shape made all three positive assertions fail.

**Contract 4 needed a second command.** Claude Code 2.1.289 refuses the root delete on its own ("Dangerous rm operation detected"), even when Bash is allowed. A test that only checked for a refusal would pass without ruflo. So:
- the root-delete test asserts ruflo's reason (`ruflo: dangerous command blocked`) in the tool result and the run's `permission_denials`;
- a control without the plugin records the engine's own refusal, so a version bump that drops it shows up;
- the Windows drive-format entry of ruflo's list, which the engine allows, is denied by ruflo; without the plugin the engine runs it.

Every command in contract 4 is shadowed on `PATH` by a recorder that only logs, so a guard that fails cannot run anything. For `rm`, GNU rm's `--preserve-root` is a second defence.

**Runner environment.** The child process gets a minimal environment built by the runner, never the parent's, so no real key, user settings, plugins or MCP servers reach it. It sets:
- `HOME`, `CLAUDE_CONFIG_DIR` and the project under a fresh `mkdtemp`;
- `--strict-mcp-config`;
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`;
- `CLAUDE_CODE_TMPDIR`. Without it the engine refused to start: "Temp directory /tmp/claude-1000 is owned by uid 0 … Refusing to use it".

stream-json output with `-p` also needs `--verbose`. Options reach the plugin through `--settings` `pluginConfigs["ruflo-mods@inline"]`, the id `--plugin-dir` gives it.

**Mock behaviour seen.** Besides `POST /v1/messages` (streaming), 2.1.289 sends one `HEAD /api/hello` connectivity probe; the mock answers any unknown path with `{}`. Main-loop requests are the ones that offer `tools`, and each takes the next scripted turn. No title or summary request was seen in `-p` mode. Such a request would offer no tools, so it would get the minimal answer and could not consume a scripted turn.

**Contract 2** runs with default options (`learningLoop` is on by default). The script reads `src/add.js` before editing it, because the engine refuses an Edit of a file not read in the session. The test asserts:
- exactly one record, `verified-success`, verifier `npm test` passed;
- the steps `Bash:false, Read:true, Edit:true, Bash:true`, so the failing run before the edit is recorded and did not decide the outcome.

Contracts 3 and 5 each have a negative control: a lesson below the 0.6 gate never reaches the request, and without the plugin no route block is added.

**`.claude-plugin/types`.** It is not in git, and the loader writes it when it loads the plugin. The tier passed against a fresh copy without it (`RUFLO_REAL_BINARY_PLUGIN_DIR` points the tier at another plugin copy), so CI needs nothing extra.

**CI.** The `mods-real-binary` job in `mod-guidance.yml`:
1. installs `@anthropic-ai/claude-code@2.1.289` globally;
2. fails, naming the step, if `claude --version` fails or reports another version;
3. runs the tier.

It needs no secret.

**Live validation** is the tier itself: every contract runs the real 2.1.289 binary end to end against the mock, at no model cost.
