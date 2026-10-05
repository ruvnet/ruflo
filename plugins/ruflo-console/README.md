# ruflo-console

ruflo's cockpit inside Claude Code: the `/ruflo` command, its pages, and a band above the prompt. It reads ruflo's own files; anything it cannot measure reads `n/a`. Design notes: ADR-407 (cockpit), ADR-448 (the Room), ADR-446 (plugin mods).

## Drive the console from the command line

`scripts/drive.sh` runs the console through its own model tools (`console_open`, `console_state`, `console_set`, `console_run`) from a real headless Claude, prints what each tool answered, and can assert on it, so a dev loop or CI job can check that a UI shows something.

```bash
RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/drive.sh \
  --expect 'Waiting for a yes' \
  "$PWD/plugins/ruflo-console" read "Open the Room and quote back what is waiting for a yes."
```

Output is one `CALL <tool> <input>` and one `RESULT <tool> <text>` line per console call (each result cut at 4000 characters), then `COST <usd> CALLS <n>`, then one `EXPECT ok|FAIL /regex/` line per `--expect`.

| Exit | Meaning |
|------|---------|
| 0 | a console call ran and every `--expect` matched (or the run was skipped, see below) |
| 1 | no console tool call ran |
| 2 | usage error: bad level or an invalid `--expect` regex |
| 3 | at least one `--expect` regex (case-insensitive, repeatable) matched no `RESULT` |

- **What it spends:** about $0.10 per run with haiku, hard-capped at $0.40 (`--max-budget-usd`). Use one to three runs, not a sweep.
- **Isolated config:** the run uses a throwaway `CLAUDE_CONFIG_DIR` seeded with the level you ask for and confirm mode `auto` (your login is copied 0600 and shredded on exit), because `RUFLO_CONSOLE_CONTROL` can only lower the saved setting (ADR-450 T12) and your own saved mode would otherwise decide what a drive does.
- **Why the level is capped:** the level is `read`, `write` or `manage`; `full` is rejected (exit 2). The run happens in a scratch project (`mktemp -d`), with Bash, Write and Edit disallowed, so a drive can never spend money or delete anything.
- **Seeding:** `CONSOLE_DRIVE_SEED=<dir>` copies that directory into the scratch `.claude-flow/` first, for example a `claims/claims.json` to assert the claims view shows it.
- **Skips cleanly:** without `RUFLO_E2E_LIVE=1` or a `claude` binary (on `PATH` or `$CLAUDE_BIN`) it prints `SKIP` and exits 0, so it is safe to call from CI.
- **Extra plugins:** any further arguments are added as `--plugin-dir`.

## Room and Mods

Open it with `/ruflo room` (menu: Safety → The Room).

- **Waiting for a yes**: the one confirm that is pending, with the seconds left to answer it.
- **The feed**: events, Claude's console actions and what you said, newest first. Filter by who, search, pause, page back. **⛔ blocked** shows only what was refused or failed: Claude's actions the control log marked denied or error, and events that say denied. Press a line to open it; an event that came from a page of its own (swarm, claims, learning, plugins, missions) offers a jump button to that page.
- **Mods**: one line per plugin mod that has written `.claude-flow/<name>-mod/status.json`. Press a line for its detail: what it guards (the file's own `summary`), guard, calls, blocked, the *class* of its last refusal (`secret`, `destructive`, `path`, `network`, `policy`, `other`; the refused text is never kept), `modVersion`, session start, last write, file age, and a stale marker when the last write was an earlier session.

A status file is data, not instructions: it is size-capped, shape-checked (`version: 1` only), and every string is stripped of control and bidi characters and cut to length before it is drawn. `summary`, `modVersion` and `lastDenied` are optional; a mod that does not write them shows "not reported".
