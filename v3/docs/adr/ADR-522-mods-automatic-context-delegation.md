# ADR-522: Automatic context delegation in ruflo-mods

- **Status:** Accepted (opt-in; default `off`)
- **Date:** 2026-11-01
- **Depends on:** ADR-521 (bounded context delegation in core), ADR-404 (ruflo as a mod)

## Context

ADR-521 added `planContextRead` / `delegateContextRead` to the CLI core but left automatic tool interception off: a host had
to call the API, and the only concrete transport (`createAnthropicContextAdapter`) needs an `ANTHROPIC_API_KEY`. No live
delegation had ever run.

A Claude Code mod can do both missing halves itself:

- a `tool.call` hook sees every `Read` before and after it runs, and may replace what the model receives (`{ result }`);
- `$.model.complete` sends one no-tools completion **through the session's own client and credentials**, so a subscription
  session needs no API key; it returns the text and token usage.

Two questions decided whether this is safe. Both were settled with a throwaway plugin on the real `claude` binary and the
scripted mock model before any production code was written:

| Spike | Hook | Later `Edit` of that file |
|---|---|---|
| A | answers the `Read` itself (`{ result }` without `next(e)`) | **fails**: "File has not been read yet" |
| B | runs the real `Read` (`next(e)`), then returns a fresh `{ result }` with replaced content | **succeeds**; the model saw only the extract |

Returning core's own object with `ref` set makes core reuse its original messages, so the replacement must be a fresh object.

## Decision

New optional module `plugins/ruflo-mods/hooks/context-delegate/`, option **`contextDelegation`: `off` (default) | `observe` |
`enforce`**. `register.ts` loads it only when the option is not `off`.

### What qualifies

Every condition must hold (`plan.ts`, pure):

1. the tool is `Read`, in the main loop (`agentId` unset: never a subagent's read, so workers never nest);
2. a whole-file read (no `offset` / `limit`), and the first read of that path this session;
3. 14,000–120,000 bytes (ADR-521's `minInputBytes` / `maxInputBytes`);
4. the current prompt is non-empty, contains no change verb (fix, change, edit, refactor, implement, add, remove, …), and
   routes to `researcher` or `reviewer` with the mod's own router (ADR-521: only analysis delegates).

Everything else reads directly, unchanged.

### What happens

- **The real `Read` always runs first** (spike B). Claude Code records the file as read, so a later `Edit` works, and every
  failure path below returns that real result unchanged. The module never denies and never throws (a `.catch` passes the
  read through).
- `observe`: records `would-delegate` with byte counts and returns the real result. Nothing the model sees changes.
- `enforce`: one `$.model.complete({ model: 'haiku', system, prompt, maxTokens: 2048, timeoutMs: 30000 })`. The prompt is the
  user's question (2,000 characters at most) and the file with `N| ` line prefixes, so the worker reads line numbers instead
  of counting them. The reply must be `{"findings":[{startLine,endLine,quote,answer}]}` (one surrounding code fence is
  tolerated), at most 8,000 bytes and 32 findings, and **every `quote` must be whole lines of the bytes the module read**
  (the ADR-521 rule). Two differences are forgiven: surrounding whitespace on each line, and a cited range up to 3 lines from
  where the quoted lines really are. Both are safe because the model is always shown the file's own lines at their real
  range, never the worker's text. A quote whose words differ (forged, partial, paraphrased) fails the reply. Answers are
  worker text: whitespace-collapsed and cut to 400 characters.
- On success the model receives a `Read`-shaped result whose content is a header followed by the cited passages:
  - the header gives the file's real size, says how many passages and lines are shown, and says every quote was checked;
  - it says unshown lines were not read into context, gives a ready `offset` / `limit` to read more, and says to read the
    lines before editing them;
  - each passage is listed under its real line range.

  A verified reply is cached by `sha256(content)|sha256(question)` for the session.
- Fallback to the whole file on any of these, each counted by reason:
  - the worker failed or timed out;
  - the reply is invalid or over the limit;
  - there are no findings;
  - a quote is forged, partial or misplaced;
  - the extract is not smaller than the file.

Counters and the last 50 events go to `.claude-flow/metrics/context-delegation.json`:
- bytes read and bytes shown;
- worker milliseconds and tokens;
- delegated, would-delegate and fallback counts, with the fallback reasons.

### Security

- **Model calls.** The mod's static contract (`scripts/smoke.sh` step 4) forbids model, network, process and MCP calls. It
  now allows exactly one `$.model.complete(` call, in `context-delegate/index.ts`, and checks that `register.ts` loads that
  module only when `contextDelegation !== 'off'`. A default install still makes no model call. A model call in any other
  file, or an ungated registration, fails the smoke check (both mutation-tested).
- **Untrusted file content.** The file is untrusted data, and the worker's system prompt says so. A prompt injection in the
  file cannot forge a quote, because quotes are checked byte for byte. It can only influence the 400-character `answer`
  beside a verified quote, which the header presents as worker text.
- **Local by construction.** Paths come from Claude Code's own `Read` input. Files are read with `$.fs.read` (4 MiB cap),
  only plain files are read, and symlinks are skipped.
- **Credentials.** The worker runs on the session's credentials. The cost of each call is recorded, and the user turns it
  on explicitly.

### Parity with the core

A hooks module cannot import `@claude-flow/cli`, so the limits and quote check are reimplemented (about 30 lines).
`v3/@claude-flow/cli/__tests__/mods/context-delegation-parity.test.ts` asserts that:
- the limits equal `DEFAULT_CONTEXT_LIMITS`;
- both verifiers accept exact and multi-line quotes, and both reject forged, partial and past-the-end quotes;
- only the mod accepts dropped indentation and a range two lines off.

## Verification

- **Plugin tests** (`claude plugin test plugins/ruflo-mods`): 8 new.
  - **Pure:** the qualifying rules, the quote verdicts, and that the extract is bounded.
  - **Wired:**
    - off leaves the file and calls no worker;
    - observe changes nothing but records the event;
    - enforce shows the extract and records usage;
    - a forged quote shows the whole file;
    - worker failure, ranged reads and change prompts read directly.
  - The quote-check tests fail with the exact-line comparison removed.
  - The 3 failures elsewhere in the suite are pre-existing and identical on main.
- **Real binary** (`__tests__/real-binary/context-delegation.test.ts`, mock model answering the worker's tool-less request),
  3 tests:
  - enforce: the model's next request contains the extract and not the file, and the scripted `Edit` succeeds;
  - a forged worker quote leaves the model with the whole file;
  - with the default `off`, no worker request is ever made.
- **Smoke checks and validation:** `smoke.sh` passes 17/17, and `claude plugin validate` passes.

## Measured

### Live A/B on the real binary (`benchmarks/context-delegation/mod-live.mjs`, raw rows in `results-mod-live.json`)

**Setup**
- Run with `claude -p --model haiku` on the session's own subscription credentials, with no API key.
- Each case copies one real repository file of 17–83 KB into a fresh project and asks an analysis question with a known
  answer. Each case runs once with `contextDelegation` `off` and once with `enforce`.
- Six cases, so these are samples, not a statistical result.

**Pricing.** `claude -p`'s `total_cost_usd` covers the main loop only; the worker's `$.model.complete` tokens are not in
it (checked against `modelUsage`). The worker is priced separately from the mod's own token counts, at haiku list price
($1 / $5 per million input / output tokens; the price is a parameter).

| | off | enforce |
|---|---:|---:|
| Correct answers | 6 / 6 | 6 / 6 |
| Reads delegated | 0 | 6 |
| Main-loop input tokens | 332,996 | 261,439 (−21.5%) |
| Main-loop cost | $0.2816 | $0.1298 |
| Worker cost (76,332 in / 2,435 out tokens) | — | $0.0885 |
| **Total cost** | **$0.2816** | **$0.2183 (−22.5%)** |
| Wall time, sum | 47.0 s | 50.1 s (+6.5%) |

Per file, enforce:

| File | Bytes read | Bytes shown to the model | Worker time |
|---|---:|---:|---:|
| agentdb-tools.ts | 82,621 | 3,785 | 10.3 s |
| agent-tools.ts | 48,368 | 1,346 | 3.3 s |
| swarm-tools.ts | 22,108 | 720 | 1.4 s |
| config-tools.ts | 20,832 | 1,078 | 2.6 s |
| raft.ts | 19,509 | 1,095 | 2.6 s |
| global-ai-budget.ts | 17,881 | 1,124 | 3.0 s |

**What the first run showed and what changed.** The first version required byte-exact quotes, and 5 of 6 live replies
failed with `quote-mismatch`. The cause, inspected directly: haiku cited the right line numbers but dropped each line's
leading indentation. All 6 runs fell back to the whole file, which was correct but saved nothing.

The verifier now compares lines with surrounding whitespace trimmed, forgives a cited range up to 3 lines off, and always
shows the **file's own lines** rather than the worker's text. That keeps the provenance guarantee: the model never sees a
quote that is not in the file. After the change, 6 of 6 reads were delegated.

**Reading the numbers**
- About 35 K of each run's main-loop input is Claude Code's own cached system context, so a 95% cut in what the model
  sees of a file becomes about 21% of main-loop input.
- The main model here was haiku, the same as the worker. With a pricier main model the same token cut is worth more; that
  was not measured.
- The +6.5% wall time is the worker call: 1.4–10.3 s per delegated read.
- A change prompt is never delegated (`change-intent`). Sessions where the model needed a whole file and then edited it
  were outside this sample.

## Consequences

- Off by default. Turning it on can only shrink what the model sees of qualifying reads, never block a read or an edit.
- What the worker missed, the model must ask for (the header tells it how). A wrong *answer* beside a correct quote is
  possible; a wrong *quote* is not.
- The limits are duplicated by necessity and pinned by the parity test.
