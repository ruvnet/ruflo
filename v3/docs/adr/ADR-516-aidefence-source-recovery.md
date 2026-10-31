# ADR 516: recover aidefence 3.0.3's detection into source

Status: Accepted (implemented in the 3.67.0 ecosystem-convergence PR)

Issue: #4625. Builds on: ADR-118 (wider detection from upstream aidefence 2.3.0), #3177 (ReDoS bounds), ADR-513 (stable-only, source-built releases).

## 1. Context

`@claude-flow/aidefence@3.0.3` has been npm `latest` since 2026-05-17. The CLI pinned `3.0.2`, so ruflo users never ran it; direct consumers did.

3.0.3 was not built from main. Its `gitHead` is `dacbe0ec` on `feat/hive-mind-federation-transport`, and that branch has no aidefence commits that main lacks: `git log --all -S` finds the ADR-118 code in no commit at all. It was published from an uncommitted working tree. The only copy was the compiled `dist/` in the tarball.

So the two lines had diverged in both directions:

| | published 3.0.3 | main |
|---|---|---|
| ADR-118 override window (verb → noun, 0..6 words) | yes | no |
| `behave as/like …` role hijack | yes | no |
| `god/root/admin/sudo mode` jailbreak | yes | no |
| #3177 bounded email/marker/DAN regexes | no (email regex 3.8 s per 100 KB) | yes |
| #3177 O(P) confidence pass (was O(P²)) | no | yes |
| stateless PII regexes (no `/g` `lastIndex` carry-over) | no | yes |

Publishing from main would have dropped the ADR-118 detection for every direct consumer. Publishing 3.0.3's code would have dropped the ReDoS fixes. Either release would have been a regression.

## 2. Decision

Port the three ADR-118 additions from the 3.0.3 `dist/` back into `src/domain/services/threat-detection-service.ts` on main, and publish the result as **3.0.4**. It is a superset of both lines.

- Only `threat-detection-service.js` differed between the 3.0.3 tarball and a main build. Every other `dist` file was byte-identical. The diff was reviewed hunk by hunk, and only the additive hunks were taken. Main's side of every hunk where it is ahead stays as it was.
- The override window is `\b(ignore|disregard|forget|override)(?:\s+\S+){0,6}\s+(instructions?|prompts?|rules?|context|system\s*-?\s*prompts?)\b`. `\s+` and `\S+` are disjoint, so each repetition has exactly one split point. Matching stays linear, and the new test times 50 KB adversarial inputs to show it.
- `publishConfig.tag: "alpha"` is removed (ADR-513: no alpha dist-tags; a stable publish must land on `latest`).
- The CLI pin moves from `3.0.2` to `3.0.4`, so ruflo users get both the ADR-118 detection and the ReDoS fixes for the first time.

## 3. Verification

- `__tests__/adr-118-wider-detection.test.ts`: phrasings 3.0.3 catches (override window, behave-as, privileged modes), benign near-misses that must not fire, and a linear-time check.
- A parity script runs the published 3.0.3 `dist` and the new build over a 24-input corpus. The corpus covers injection, jailbreak, role, context markers, PII and benign text. The two report the same threat types per input: 0 regressions and no new false positives on the benign inputs.
- aidefence suite: 36/36.

## 4. Consequences

- Direct consumers move from 3.0.3 to 3.0.4 with no lost detection. They also gain the #3177 ReDoS bounds, which closes a 3.8 s/100 KB email-regex stall on input that `detect()` scans on every call.
- Lesson recorded in ADR-513: a leaf's `latest` must be checked against main (`npm view <pkg>@latest gitHead`, plus a tarball diff when there is no gitHead) before any standalone publish.

## 5. Not done

- The optional `agentdb` peer range (`>=2.0.0-alpha.1`) is unchanged. ADR-514 makes agentdb stable at 3.0.0, which that range already admits; that is what removes the second AgentDB from installs (ADR-513 §3).
