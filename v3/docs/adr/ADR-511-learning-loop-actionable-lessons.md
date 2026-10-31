# ADR 511: lessons that say where the fix goes, and patterns that learn from reworded tasks

Status: Accepted (implemented in PR #4603; see section 6)

Issue: #4581 (the §7 evaluation). Builds on: ADR-502 (the loop), ADR-503 (gaming defences), #4134 (neighbour reinforcement).

## 1. Context

The first §7 run (2026-10-30, comment on #4581) solved 30/30 tasks in both arms. Replaying it offline showed three things that limit what the loop can learn, independent of that corpus:

1. **A lesson carries nothing the model can act on.** It says "tasks about <keywords> went to <agent> and passed (check)". In a single-agent `claude -p` session the agent name changes nothing.
2. **Different tasks merge.** Prompts that differ only in the feature and file they name share at least 0.6 of their keywords, so SONA's neighbour rule (#4134) folded five task kinds into one lesson about `slugify`.
3. **The same task worded differently never learns.** Replaying the 15 training prompts of a corpus with three wordings per feature gave 15 patterns, each at one success, so none reached the 0.6 gate: zero lessons. The first run produced a lesson only because its prompts were identical within a kind. Real users do not repeat themselves word for word.

## 2. Decision

### 2.1 Lessons name the files the passing fixes edited

- The mod records the project-relative paths a verified turn's successful edits changed (at most five). This replaces ADR-503's "only the class is kept, never the path" for these paths only. That is acceptable because a path is recorded only after it passes `lessonFile`:
  - no absolute path, no `..`, no dot-file or dot-directory (`.env`, `.claude/`, `.git/`);
  - no name that may hold a secret (`*secret*`, `*credential*`, `*token*`, `.pem`, `.key`, `id_rsa`, `npmrc`, ...);
  - no test file and no verifier config, so a lesson can never teach "edit the test" (ADR-503).
- The path is re-screened at every hop: the CLI's `parseRecord`, the ledger read-back and the mod's `parseLessons`. A path that fails is dropped and never shown. It stays in the same project's `.claude-flow/` and reaches only that project's prompts, inside the block `scan()` screens.
- The CLI counts files per pattern for **successes only**, and a lesson names the three most often edited. A caution never names files.
- A lesson that carries files leads with them: "verified fixes for tasks like this (<keywords>) edited `a`, `b`: look there first. They passed `<check>`." (Section 5 explains why.) A lessons file without files renders exactly as before.

### 2.2 Verified edited files anchor patterns

- `processTrajectoryOutcome` accepts optional `anchors` (the record's files). They are stored on the pattern as `anchors`, never as keywords, so routing's match ratio and a lesson's keyword list are unchanged.
- Two trajectories reinforce one pattern when they share an anchor **and** at least two non-generic keywords (`GENERIC_WORDS`: test, fix, bug, run, wrong, ...). Without the second condition, two unrelated tasks that both touched a README would merge.
- A verified failure anchors too, so a reworded failure lowers the same lesson; it never contributes file names.

### 2.3 Tasks that name different files stay apart

- A keyword containing `/` names a file or directory (`src/slugify`). When both tasks name one and they share none, they never reinforce one pattern, however alike the rest of their wording. Tasks with no path keyword, such as the #4134 report's, merge exactly as before.

### 2.4 Lesson matching weighs rare words

- `pick()` weights each keyword by its inverse document frequency among the lessons, so words every lesson has ("test", "fix") barely count. A lesson scoring under half the best match is dropped (`MIN_SHARE_OF_BEST`). Still at most three.

## 3. Consequences

- The loop now forms lessons from reworded tasks and keeps features apart. Both changes are proved offline (section 4).
- Lessons can now steer a model to a file. If that file was right for past tasks but wrong for this one, the lesson costs exploration. The block stays "Advisory only", is cited, and is bounded at three lessons.
- Known limit: when no lesson fits a prompt, the best-scoring wrong lesson can still be shown. On the corpus below, right matches scored as low as 0.20 and wrong ones as high as 0.29, so no absolute floor separates them without overfitting.
- `verified-outcomes.ts` was at 477 lines; lesson building moved to `verified-lessons.ts` (re-exported, so imports do not change).

## 4. Verification

$0, in `__tests__/mods/mods-learning-loop-files.test.ts`:
- Path screening: both halves accept and refuse the same paths.
- Records carry files only for verified outcomes; hostile file lists are screened.
- Lessons name the top three files; cautions never do; the old rendering is unchanged.
- **The first run's 15 identical-per-kind prompts train 5 patterns, not 1.**
- **15 reworded prompts with no anchors: 15 patterns at one success, no lesson. With the verified file as anchor: 5 patterns of 3 successes, each ≥ 0.636.**
- A shared README alone does not merge tasks; a reworded failure lowers the same pattern.
- End to end (mod record → CLI ingest with real SONA → next prompt): the lesson names the files and never `.env`.
- #4134's tests still pass.

Offline ranking check on the corpus below: the right lesson ranked first for 30/30 eval prompts, with 1.07 lessons shown per prompt on average (3.0 before IDF weighting).

## 5. The paid evidence (haiku, 2026-10-30)

Corpus: `scripts/eval-learning-loop-corpus.mjs`. One project with five features. Each feature's behaviour lives in a module reached only through a registry and a JSON config, next to an unused module with a more obvious name. One bug is planted per fixture; there are 3 training and 6 evaluation fixtures per feature, and the prompts describe a symptom and name no file. Training: 15/15 passed and produced 4 lessons (one feature's third success was tainted). Total spend was about $6.80; none of these runs used a gate index, because each was a sizing run.

| Run | Off | On (this ADR) | On, lessons without files |
|---|---|---|---|
| Calibration, uncapped, 5 train tasks | 5/5, 11–17 turns | | |
| Pilot, `--max-turns 6`, 6 eval tasks | 0/6 | 0/6 | 0/6 |
| Pilot, `--max-turns 8`, 10 eval tasks | 2/10 | 4/10 | 1/10 |
| Probe, uncapped, 6 eval tasks | 6/6, $0.633 | 6/6, $0.627 | |

Reading:
- At 6 turns the lesson reached the model (seen in the transcript), but haiku explored as usual (money.js, test, registry) and ran out of turns. That is why a lesson with files now leads with the file and "look there first".
- At 8 turns the direction favours this ADR: on beat off 2–0, and beat the old lesson text 4–1. One of the two wins over off (slug-3) came with a wrong lesson shown, so it is noise. The turn cap sits on haiku's natural 9–11-turn finish, so capped pass/fail is noisy.
- Uncapped, both arms are at ceiling. "On" saved 2 or more turns on 2/6 tasks; cost differed by about 1%.
- Not run: the full 30-task, three-arm evaluation. By the pilot's rates the gate's second test (13 net discordant wins) is out of reach at 30 tasks, so the stop rule set before the probe applied.

The learning capability (forming the right lesson from reworded verified work, keeping features apart, matching it to the next prompt) is proved. Its effect on a haiku session is directional and has not cleared the gate. ADR-502 §6 (on by default) is unchanged.

## 6. Implementation notes

- Mod: `plugins/ruflo-mods/hooks/loop/record.ts` (`lessonFile`, `files`), `lessons.ts` (`files`, IDF `pick`, rendering). ruflo-mods 0.13.0.
- CLI: `src/memory/verified-lessons.ts` (new), `verified-outcomes.ts` (files, anchors), `sona-optimizer.ts` (`anchors`, the path-disjoint and anchor neighbour rules).
- Harness: `scripts/eval-learning-loop.mjs` gains `--ablate`, `--test-index`, `--concurrency`, `--lessons`/`--save-lessons`, `--eval-sample`, `--calibrate`, `--max-turns` (eval arms and calibration only; training is always uncapped). `scripts/eval-learning-loop-corpus.mjs` writes and validates the corpus above.
