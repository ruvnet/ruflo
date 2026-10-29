# ruflo-mods `learningLoop`: live run (2026-10-29)

Claude Code 2.1.289, model haiku, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`, `claude -p --plugin-dir plugins/ruflo-mods`. Options came from `--settings` with `learningLoop: true`. The project was a scratch git repository with `.claude-flow/` and a one-function Node project whose `npm test` runs `node --test`. `src/add.js` started with a bug: it used `a - b`. ADR-502 describes the design.

## 1. A fix turn is verified by the test's exit status

Prompt: "Run npm test, then fix the bug in src/add.js, then run npm test again."

Recorded line:

```json
{"v":1,"id":"vt-mvtytdbx-1-egj313","task":"Run npm test, then fix the bug in src/add.js, then run npm test again. Be brief.","agent":"coder","outcome":"verified-success","verifier":{"kind":"test","command":"npm test","passed":true},"steps":[{"tool":"Bash","ok":false},{"tool":"Read","ok":true},{"tool":"Read","ok":true},{"tool":"Edit","ok":true},{"tool":"Bash","ok":true}],"edits":1,...}
```

- The first `npm test` exited 1 and Claude Code reported it as an error (`ok: false`). This confirms that a non-zero Bash exit sets `isError` on `tool.call`.
- That failing run came before the edit, so it did not decide the outcome. The passing run after the edit did.

## 2. A failure is recorded even when the answer glosses over it

Prompt: "change a + b to a * b, then run npm test once and report the result. Do not fix anything."

The model answered: "the test runner confirms the operation is now multiplication instead of addition". It did not say the test failed. The record:

```json
{"outcome":"verified-failure","verifier":{"kind":"test","command":"npm test","passed":false},"steps":[{"tool":"Read","ok":true},{"tool":"Edit","ok":true},{"tool":"Bash","ok":false}],...}
```

The outcome comes from the exit status, never from the answer.

## 3. The CLI trains SONA on verified records only

`ruflo hooks verified-ingest` (worktree build of 3.64.0):

```
[OK] Ingested 1 verified success, 1 verified failure; 0 unverified (not trained), 0 malformed
Lessons at or above the 0.6 gate: 0; cautions: 0; verified patterns below the gate: 2
```

`.swarm/sona-patterns.json` then held two patterns: the success at confidence 0.55 and the failure at 0.425. `ruflo doctor --component learning-loop` passed.

## 4. A lesson above the gate reaches the model

One verified pass leaves its pattern at 0.55, below the 0.6 gate. To get a pattern over the gate without more model runs, three copies of the verified-success line from section 1 were appended with new ids. **These copies are synthetic: the same real outcome, replayed.** The ingest then reported `Lessons at or above the 0.6 gate: 1` (confidence 0.672, 4 passed / 0 failed).

The next live prompt was about the same bug. Its session transcript contains the block the mod added:

```
[RUFLO_LESSONS] From this project's own test/build exit status (never a model's claim of success). Advisory only:
- [lesson L-9d6ba1d25a conf 0.67, 4 passed / 0 failed] tasks about add, test, fix, bug, src/add, again, brief went to coder and passed `npm test`
```

## 5. What this does not show

- Whether lessons improve task success. Issue #4581 §7 asks for 30 or more comparable tasks, baseline against loop-enabled; that has not been run. The option ships on by default by maintainer decision (ADR-502 section 6), ahead of that evidence.
- Training from many independent verified turns on one task kind. Section 4 used replayed copies of one real outcome.
- Behaviour on Windows, or with the AgentDB native bridge unavailable. The CLI path uses the SONA JSON store and sql.js, not AgentDB, but it was not run on Windows.
