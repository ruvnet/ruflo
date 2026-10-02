# ADR 406: A Mod Manager Pane for ruflo-family Mods

Status: Proposed

Date: 2026 10 01

Related: ADR 404 (ruflo as a Claude Code mod; this ADR does not re-decide it), ADR 407 (init installs the manager), #3612 (`ruflo mods install` resolves the plugin; `mods status --json`), #3607 (ruflo-swarm pane, whose layout and test harness this mirrors), a0c4f99c2 (trust gate allow-lists by provenance; `fs.write` is risky), ADR 150 (removable augmentation)

## Context

ADR 404 made ruflo a Claude Code mod. Since then the ruflo marketplace carries several mods: `ruflo-mods` (routing, policy, trust gate, `$.ruflo` noun), `ruflo-swarm` (the swarm pane), the plugin-creator's mod template, and outside the repo the ruOS mod. A person who wants to know which of them are enabled, which Claude Code can actually resolve, what each hooks, and what the trust gate thinks of them has to combine `claude plugin list`, `claude plugin validate`, `ruflo mods doctor` and three settings files by hand. #3612 showed the cost of that: an enabled plugin that a stale marketplace clone could not resolve was skipped without a word.

This ADR decides a pane, inside Claude Code, that shows that state for ruflo-family mods and can enable or disable them. It also records a review of the Claude Code Mods field guide (gist a485e930, by ruvnet) against the engine's own declarations, because the pane is built on both.

### Sources and how they were checked

- **Engine types.** Written by Claude Code 2.1.287 into `plugins/ruflo-swarm/.claude-plugin/types/claude-code/index.d.ts` when the swarm mod loaded in a `claude -p` session on 2026-10-01 (14,916 lines). The 12,678-line snapshot at `.claude/worktrees/cc-mods-types.d.ts` is stale and was not used.
- **CLI behaviour.** `claude plugin validate --json` (0.37 s for ruflo-swarm), `claude plugin list --json`, `claude plugin enable|disable --scope --json`, `claude plugin configure --help`, all on 2.1.287.
- **A probe mod** loaded with `--plugin-dir` in `claude -p`: `$.command.register({ name: 'mods' })` resolved `{ command: 'mods' }`, and `Uint8Array.prototype.toBase64` is a function in the module environment.

## Decision

### Scope: ruflo-family mods only; native `/plugin` stays the installer

The manager is a fourth plugin, `plugins/ruflo-mods-manager`, separate from `ruflo-mods` for ADR 404's reasons (opt-in, removable, its own manifest). It:

- **lists** the ruflo marketplace's mods (plugins whose `hooks/hooks.json` names `modules`), with state read from Claude Code's own records;
- **enables and disables** them, through `ruflo mods enable|disable`, which call `claude plugin enable|disable`;
- **routes** everything else to the native surfaces: installing from another marketplace is `/plugin`, options are `claude plugin configure <id>`, and a person's own mod is theirs to manage.

It never installs, uninstalls, edits options, edits settings files directly, or touches a mod outside the ruflo marketplace. A mod it cannot account for is drawn as "not ruflo's: use /plugin".

### Data layer: Claude Code's records through the CLI, read-only

A mod cannot read `~/.claude/plugins/installed_plugins.json` without reading `HOME` or `CLAUDE_CONFIG_DIR` first, and #3612 already holds the logic for resolvability. So the pane reads, in this order:

| Fact | Source | How |
|---|---|---|
| Enabled, per scope | `$.settings.read({ source })` for `user`, `project`, `local` | in-process, no spawn |
| ruflo-mods trust policy (`modTrust`, `modTrustAllow`) | `pluginConfigs["ruflo-mods@ruflo"].options`, read from the settings files by the CLI | inside `ruflo mods list --json` (`gate`) |
| Installed, version, scope, install path | `claude plugin list --json` | inside `ruflo mods list --json` |
| Resolvable | installed and its `installPath` exists, as #3612's `installedState` decides | inside `ruflo mods list --json` |
| Hooked events and `$` calls | `claude plugin validate --json <installPath>`, the `notes` lines `hooks:` and `calls:` | inside `ruflo mods list --json` |
| Trust verdict | the scan above judged by ruflo-mods' own rules (vendored from `plugins/ruflo-mods/hooks/trust.ts`, held by a parity test) | inside `ruflo mods list --json` |
| Init chain and health | `ruflo mods status --json` (#3612's findings) | spawned |
| Last mod start | `.claude-flow/mods/session.json` (ruflo-mods' heartbeat) | `$.fs.read` |

The CLI is reached with `$.process.run(argv, { timeoutMs })`: a fixed argv, no shell. `argv` is `['node', <project>/node_modules/@claude-flow/cli/bin/cli.js, …]` when that file exists (checked with `$.fs.exists`), else the `cli` option's prefix, the same table ruflo-swarm uses (`npx --offline -y @claude-flow/cli@latest` by default, so nothing is downloaded unasked). Arguments are constants or an id that has passed validation (below). No argument comes from event input.

Every fact on screen carries its source and age. A field the CLI could not produce (no `claude` on PATH, a validate that failed) is `null` with a reason and is drawn as "unknown: <reason>", never as a default. When a refresh fails, the previous data stays on screen marked STALE with its age; it is never drawn as live.

**Last refusal.** The trust gate writes refusals to the transcript, not to disk. The heartbeat holds `startedAt`, `owned` and `statusLine` only. So the column reads "not recorded on disk" until ruflo-mods records refusals (follow-up 1). It is not inferred.

### Write path: enable and disable only

- The pane's `e` and `d` run `ruflo mods enable|disable <id> --scope <scope> --json`.
- That subcommand (ADR 407 places it in `commands/mods-manage.ts`) rebuilds the list, refuses any id not in it, refuses any id not matching `^ruflo-[a-z0-9-]{1,48}@ruflo$`, then runs `claude plugin enable|disable <id> --scope <scope> --json` through `execFile` with a 60 s timeout. Scope is one of `user`, `project`, `local`. With no runnable `claude`, it exits 1 and prints the command for a person to run; it does not fall back to editing settings.
- `d` asks for a second press (confirm row, 8 s window). Disabling `ruflo-mods` also names what goes with it ("the classic hooks take every event back").
- The change applies to the next session or `/reload-plugins`, and the pane says so instead of showing the mod as already off.

**Trust gate.** The manager's module calls `process.run`, which ruflo-mods' gate counts as risky. Under the default `modTrust: observe` it loads with one transcript line. Under `refuse-risky` it loads only if `ruflo-mods-manager@ruflo` is in `modTrustAllow`. Neither the manager nor `init` writes that allow-list: that would be a self-exemption by another route, which a0c4f99c2 removed. Instead `mods list --json` reports `trust.manager: "refused-unless-allowed"` when the policy would refuse it, and the pane and `ruflo mods status` print the one-line fix. Whether ruflo-mods should ship a default allow for its sibling is an open question for rUv.

### Pane, hotkeys and focus

- `/mods` opens the pane in the documented dialog form: `$.ui.open({ id: 'ruflo-mods-manager', title: 'Mods', focus: true, closeOnEscape: true, holdToasts: true, rows })`. `rows` is what the current view needs (list 18, diagrams 22, health 16) and is sent again on each view switch, because each open sets it anew and the dock ignores it.
- The body is laid out from `e.props.bodyColumns` and `e.props.scroll.bodyRows`, never from the viewport. When `e.props.isFocused === false` the first row says "keys go to the prompt: click the pane or press ctrl+x tab, or use /mods <key>".
- On `session.start` the manager reads `$.ui.panes()`; if its pane is still up after a reload it resumes polling. The render hook also resumes polling when it draws and nothing polls (the guide's rule), so either signal is enough.
- Timers stop on `ui.close` for this id and on `session.end`.

| Key | Action | Mirror |
|---|---|---|
| `1` `2` `3` | list, diagrams, health | `/mods list`, `/mods diagrams`, `/mods health` |
| `j` `k` | next, previous mod | `/mods select <id>` |
| `e` | enable the selected mod | `/mods enable <id> [scope]` |
| `d` | disable, after a confirm | `/mods disable <id> [scope]` (the command form is its own confirmation) |
| `r` | refresh now | `/mods refresh` |
| `c` | put `! claude plugin configure <id>` in the prompt | `/mods configure <id>` |
| `h` | help overlay | `/mods help` |
| Esc | close (via `closeOnEscape`) | `/mods close` |

Three departures from the request, each forced by the types:

- **`?` cannot be a hotkey.** `ButtonProps.hotkey` is "one digit or one lowercase letter … anything else is refused". Help is `h`, and `/mods help`.
- **Arrows cannot be hotkeys.** While the pane holds the keys the engine uses the arrows to scroll and Tab to walk the buttons. Selection is `j`/`k`, and Tab plus Enter reaches every row's button.
- **`c` cannot run `claude plugin configure`.** That command is a terminal program, and `$.command.run` "rejects … inside a hook the turn is waiting on". The pane puts the command in the prompt with `$.prompt.fill`, as ruflo-swarm does, and never runs it on the person's behalf.

Focus is a request. The slash command is the reliable path, so every key has its mirror and the tests drive both.

**Toasts.** `holdToasts: true` holds this plugin's toasts while the pane is on screen and shows them when it closes. State changes are therefore shown in the pane's outcome row while it is open, and as toasts after it closes. A status segment (`$.ui.status`) shows the count of enabled ruflo mods and any that are enabled but unresolvable; it is cleared on `session.end`.

### Views, diagrams and animation

**1. Mods list.** One row per mod: name, version, scope, then three marks, enabled / installed / resolvable, then the trust verdict (`allowed`, `observed: <n> risky`, `refused`, `unknown`), and the hooked-event count. The selected row expands into a detail block: install path, events, calls, trust reasons, last refusal ("not recorded on disk"), and its own buttons. Each row is a keyed `Box` with a hover card (`position: 'absolute'`, `display: 'none'`, `hover: { display: 'flex' }`) holding the calls list. Colours are theme names (`success`, `warning`, `error`, `suggestion`, `claude`), and every colour also has a word, as in ruflo-swarm.

**2. Diagrams.** Both come only from the sources above. Nothing is drawn for a mod whose scan is unknown, except a dim "scan unavailable" label.

- **Hook map.** A bipartite graph: mods down the left, engine events down the right (`session.start`, `prompt.submit`, `tool.check`, `tool.call`, `ui.render`, `command.run`, …, sorted by how many mods hook them), one braille line per (mod, event) pair from `validate`'s `hooks:` note. Risky events (ruflo-mods' list) are drawn in the warning colour. It is a `Raster`; its width and height are fixed by the pane's size at draw time.
- **Init chain.** Four links, `settings → marketplace → plugin → helpers`, each with its finding from `mods status --json` (`ruflo-mods plugin`, `ruflo marketplace`, `ruflo-mods installed`, `classic handshake`) and a pass / warn / fail glyph. The failed link's `fix` text is shown under it.

**3. Health.**

- A **doctor timeline**: each refresh's pass / warn / fail counts, kept in `$.store` (last 48 points, per project), drawn as a braille sparkline of warn + fail with the time span written under it.
- A **pulse**, animated with `$.ui.blit` on `await $.clock.now()`. It is labelled `pulse = time since the last measured refresh (MEASURED)`. One beat per refresh; the trace decays with the data's age; past three poll periods it goes flat and reads `STALE`. It encodes data age only: there is no hook-fire signal a mod can measure for other mods, so none is shown.

Rules the views follow, from the guide's pitfalls and the types:

- `ui.Raster` is checked per surface. Without it (desktop, VS Code, mobile) each picture is replaced by its text form: the hook map as an `event ← mods` table, the sparkline as numbers, the pulse as "last refresh 12 s ago".
- The first paint and every frame come from one function `frameOf(model, { columns, rows, t })`. Its size is a function of the pane's size only, never of `t`. Blits pass `columns` and `rows`, so a size mismatch is refused loudly, and are fire-and-forget.
- Cells are width-1 BMP characters only (braille, blocks, box drawing). Raster bounds are 512 columns and 256 rows.
- No `node:` import, `Buffer` or dynamic `import()`. Files are found through `$.plugin.root`. Base64 uses `Uint8Array.prototype.toBase64` where present, a tested encoder otherwise.

`/mods list` also answers as text. A `ui.render` hook on `{ component: 'CommandOutput', props: { command: 'mods' } }` draws that output as a table in the transcript and passes through on surfaces or args it does not handle.

### Least authority

| Capability | Used for | Not used |
|---|---|---|
| `process.run` | `ruflo mods list/status/enable/disable --json` | anything else; no shell; no argument from event input |
| `fs.read`, `fs.exists` | the heartbeat; the local CLI path | no writes (`fs.write` is not called) |
| `settings.read` | enabled flags, trust options | — |
| `store` | the doctor timeline, the last view | — |
| `prompt.fill` | the configure route | never submits |
| `ui.*`, `clock.*`, `command.register` | the pane | — |

Hooked events: `session.start`, `session.end`, `command.run` (`mods` only), `ui.render` (`Pane` for its own id, `CommandOutput` for `mods`), `ui.close`. None of the risky events (`tool.check`, `tool.call`, `*`, `classic.*`, `plugin.register`, `prompt.compose`).

Options (`userConfig`): `cli` (the argv prefix table above, validated against it), `refreshSeconds` (clamped 10 to 600, default 30), `animate` (boolean, default true; off draws the pulse still).

### Test plan

- **Plain vitest** (`tests/*.spec.ts`, run under the root vitest as ruflo-swarm's `parse.spec.ts` is): base64 against `Buffer`; every frame the same size across `t`; labels honest (MEASURED, STALE, "not recorded on disk", "unknown: <reason>"); no-Raster fallback; the list and status parsers on fixtures taken from real `--json` output; argv builders reject bad ids and scopes.
- **Engine kit** (`claude plugin test`): mount once per test; `await clock.advance`; `ui.invalidate` passed through; a hotkey test (a press on the `1`/`2`/`3` and `e` buttons, with the `hotkey` props asserted, since the kit presses by key); a blit test (a blit lands at the mounted size, stops on close); the slash mirrors; focus hint; the CommandOutput row; the terminal and desktop surfaces both accept every view.
- **`claude plugin validate`** clean.
- **CLI** (vitest, mock-first like #3612): `mods list|enable|disable --json` with an injected exec.
- **A real end-to-end run**: built CLI, isolated `CLAUDE_CONFIG_DIR` in a scratch directory, real Claude Code 2.1.287.

## Review of the field guide against the 2.1.287 types

The guide says the types win, and they do. Where it and the declarations disagree or the guide leaves something out (19 rows; row 13 is a claim checked and confirmed):

| # | Guide says | Types say (2.1.287) | Effect here |
|---|---|---|---|
| 1 | §4.4: `await $.ui.resolve(e)` | `resolve` is synchronous ("A read, not a dispatch") | harmless; call it without `await` |
| 2 | §4.4: `$.clock.every` may return a function or `{ cancel }` | `TimerCall` always returns `Timer { cancel }` | use `.cancel()` only |
| 3 | §5.1 element table | also `Link` and `Code` on every surface; `Svg` on desktop, mobile, VS Code; `Client` not on VS Code or mobile | the fallback table covers all four surfaces |
| 4 | §5.2: dock at ≥ 110 columns; open unasked only where it is a sidebar | an unasked open waits undrawn below 144 columns (110 once the person asked for that id) and resolves `{ isPlaced: false, reason }` | the pane opens only on request and reports `reason` when not placed |
| 5 | §5.2 / §4.4: resume polling from `ui.render` | `$.ui.panes()` is "the engine's record … a module reloaded while its pane stayed up finds it here" | check both |
| 6 | §5.2: `rows` only | `open` also takes `columns` (the dock width wanted) | not used |
| 7 | §5.3: hotkey is one digit or letter | stated as "anything else is refused"; also a bare digit in an empty composer answers a *band* (`AbovePrompt`) Button | `?` and arrows cannot be keys |
| 8 | §5.3: dialog form opens with the keys | `focus` "is a request, not a grant", refused over text in the composer, a dialog, a survey; `focus`, `closeOnEscape`, `holdToasts` are typed `true`, not `boolean` | pass literal `true` |
| 9 | not mentioned | `holdToasts` holds this plugin's toasts until the pane closes | outcome row while open |
| 10 | §5.4: hand-roll base64, no `Buffer` | the types' own examples use `Uint8Array.prototype.toBase64()`, and it exists at runtime (probed) | native first, encoder as fallback |
| 11 | §5.4: code point, fg, bg | code point must be a printable width-1 BMP character, or the tree is refused; Raster is 1–512 columns, 1–256 rows | glyph set restricted |
| 12 | §5.5: blit size must equal the mounted Raster's | `columns` and `rows` on a blit are optional (absent: the mounted size) | pass them anyway so a mismatch is refused, not mis-laid |
| 13 | §5.5: about 10 invalidates a second | ten a second, thirty for the shown pane and the band | confirmed: no discrepancy |
| 14 | §4.4, §8: `$.process.run` | default timeout 30 s, ten minutes at most; each stream capped at 4 MiB with `isStdoutTruncated`; `$.process.spawn` streams | timeouts set per call; truncation reported |
| 15 | not mentioned | `$.settings.read({ source })` reads one settings source, or the merge | the data layer's first source |
| 16 | §5.7: `Markdown` | at most 10,000 characters; only `https:`, `http:`, `file:` links are clickable | help overlay stays under the cap |
| 17 | §5.7: hover cards on a keyed Box | also `hover.scope`, a named group across sites | not used |
| 18 | §7: `pane.press({ key })` | presses "as a click or its hotkey does": the kit cannot press a hotkey by its letter | hotkey tests assert the `hotkey` prop and press by key |
| 19 | §2: types under `<mod>/.claude-plugin/types/` | correct; ruflo-swarm's `fetch-mod-types.sh` instead fetches Anthropic's published copy into `.claude/types/` | the manager's tsconfig uses `.claude-plugin/types/` |
| 20 | §1: no `process` in the sandbox | `$.env.get/set` take string literals, read off the source by `validate` | not used |

Two of the guide's 🧪 claims could not be checked against the types alone and are left as the guide states them: the `flexBasis` refusal (`BoxProps` has no `flexBasis`, consistent with it), and "with `focus: true` alone the pane still reported `isFocused: false`" (consistent with focus being a request).

## Consequences

- A person sees, in one place, why a ruflo mod is or is not loading, and can turn one on or off without leaving Claude Code.
- The manager adds one more user-tier module that calls `process.run`. Under `refuse-risky` it needs an explicit allow-list entry, and the pane says so.
- Each refresh spawns the CLI, which spawns `claude plugin list` and one `claude plugin validate` per mod (about 0.4 s each). Polling runs only while the pane is open, at 30 s by default.
- No change to ruflo-mods, ruflo-swarm, the classic hooks or the helpers.

## Follow-ups

1. ruflo-mods records its last trust refusal per provenance in its heartbeat, so the list can show it.
2. #3612 (or its successor) takes a plugin id in `installedState`, `repairArgv` and `repairCommands`, so ADR 407's step stops composing primitives.
3. If `/mods` becomes a Claude Code built-in, `command.register` refuses it; the manager then falls back to `/ruflo-mods-manager` and says so in the pane title.
