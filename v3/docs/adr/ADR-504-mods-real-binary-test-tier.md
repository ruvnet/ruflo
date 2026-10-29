# ADR 504: a real-binary test tier for ruflo mods and hooks

Status: Proposed (2026-10-29)

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
