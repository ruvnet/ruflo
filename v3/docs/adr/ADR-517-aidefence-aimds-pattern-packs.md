# ADR 517: @claude-flow/aidefence runs the AIMDS pattern packs

Status: Accepted (`@claude-flow/aidefence` 3.1.0, ruflo 3.67.0)

Builds on: ADR-516 (aidefence source recovery). Upstream: midstream AIMDS #105 (pattern packs), #102 (Rust `aidefence-core`), ADR 0042 (npm `aidefence` 3.0, side-effect-free entry); the `undoLeet` ReDoS fix is #121 and ships in npm `aidefence` 3.0.1.

## 1. Context

ruflo's prompt-injection detector is `@claude-flow/aidefence`'s `ThreatDetectionService`, about 28 hand-written regexes. The midstream AIMDS review (2026-09-04) built a shared corpus of 55 bypass cases and 30 legitimate texts, and moved detection into data: six JSON pattern packs with 53 patterns (`core`, `tool_invocation`, `exfil_url`, `encoded_instruction`, `slack_markup_forgery`, `instruction_override_i18n`) and an engine that normalises confusables, leet and separators and decodes base64, hex and URL encoding.

The `core` pack is ruflo's 3.0.2 patterns, copied verbatim. On that corpus:

| detector | attacks caught | false positives |
|---|---|---|
| ruflo built-ins (3.0.4, with ADR-118) | 8 / 55 | F13, F27 |
| AIMDS all packs | 55 / 55 | F13, F27 |

The built-ins miss every tool-invocation, exfiltration-URL, encoded, markup-carrier, multilingual and Slack-forgery case. Those are the forms seen live in the cognitum-slack indirect-injection incident.

## 2. Decision

Vendor the AIMDS engine and the six packs into `@claude-flow/aidefence` and run them as a second pass in `ThreatDetectionService.detect()`. Release as **3.1.0** (minor: new detection, compatible API).

- The packs are embedded as TS modules, not read from disk, so they load from the published ESM `dist` with no path lookup, and the `files` allowlist is unchanged. Each vendored file names its midstream source path and commit.
- The built-in patterns stay, including the ADR-118 extras the packs lack. Pack findings are merged under the existing one-threat-per-type dedupe. `ThreatType` gains `tool_invocation`, `data_exfiltration` and `markup_forgery`, because folding them into `prompt_injection` would have merged distinct findings. `Threat` gains an optional `ruleId`.
- On by default. `createAIDefence({ packs: false })` turns them off; a list or per-pack record selects specific packs. `quickScan` also runs them.
- Patterns are compiled and warmed once per process.

## 3. Safety

Vendoring found a real ReDoS upstream. AIMDS's leet normaliser (`undoLeet`) used `/[cls]*[A-Za-z][cls]*/g`, which rescans a letter-free run from every start: 100 KB of hex took about 2 s per `detect()`. It was rewritten to match maximal runs and test for a letter in the callback, which gives byte-identical output (checked on a 30 KB mixed corpus) in 0.3 ms. The fix is in both the vendored copy and midstream (npm `aidefence` 3.0.1). Decoded blobs are also capped at about 12 KB before decoding.

The timing test runs 17 adversarial 100 KB inputs (whitespace runs, `a.a.a`, nested brackets, base64, hex, URL-encoding, leet) through the full detector, each under 250 ms. The slowest takes 48 ms.

## 4. Cost

Median of 300 warm runs on legitimate prose:

| input | built-ins only | with packs |
|---|---|---|
| 1 KB | 0.031 ms | 0.950 ms |
| 10 KB | 0.142 ms | 5.151 ms |

That is about 30× the built-ins, still inside the package's 10 ms target. Callers on a hot path can select specific packs.

## 5. Not done

- The two inherited false positives (F13: prose that mentions base64; F27: a `data:image/png;base64,` URI) come from the built-in `encoding_attack` regex and are pinned in the tests as known.
- `threat-detection-service.ts` is 562 lines, over the 500-line guideline. It was already over before; split it in a follow-up.
- Pack findings report positions in the normalised text, so offsets are approximate.
