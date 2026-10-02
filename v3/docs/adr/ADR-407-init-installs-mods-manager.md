# ADR 407: `ruflo init` Installs the Mod Manager

Status: Proposed

Date: 2026 10 01

Related: ADR 406 (the mod manager pane), ADR 404 (`ruflo mods install`, `init --mods`), #3612 (install and repair make the plugin resolvable), fd35a49cb (signed helpers manifest), ADR 150 (removable augmentation)

## Context

ADR 404 added `ruflo init --mods`, which calls `installMod(cwd, 'local')`: it writes `enabledPlugins["ruflo-mods@ruflo"]`, the `ruflo` marketplace entry and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` into `.claude/settings.local.json` and records what it added. #3612 then showed that settings alone are a request: Claude Code skips an enabled plugin that a stale marketplace clone cannot resolve. `ruflo mods install` on #3612 now refreshes the marketplace and runs `claude plugin install`. `init --mods` does not: it still stops at settings.

ADR 406 adds a second ruflo mod, `ruflo-mods-manager`. This ADR decides how `init` installs it, and closes the `init --mods` gap on the way.

## Decision

### Opt-in, riding `--mods`

| Invocation | Result |
|---|---|
| `ruflo init` | no mods step (as today) |
| `ruflo init --mods` | ruflo-mods, then the manager |
| `ruflo init --mods --no-mods-manager` | ruflo-mods only, as before this ADR |
| `ruflo init --mods --dry-run` | prints the mods plan; writes and runs nothing (see below) |

**Recommendation: opt-in, not default-on.** Three reasons:

1. ADR 404 decided that function hooks are opt-in per person (`settings.local.json`), because they are early access and a server-side switch can hold them off. A default-on manager would make every `init` install a mod, contradicting it.
2. The manager calls `process.run`, which ruflo-mods' trust gate counts as risky. Installing it by default would put a risky module in front of every person who never asked for mods.
3. The manager is useful only where a ruflo mod is. With `--mods` absent there is nothing for it to manage.

`--no-mods-manager` exists so a person can keep ADR 404's exact behaviour. A separate `--mods-manager` without `--mods` is not added: the manager without ruflo-mods has a list but no gate to report on, and `ruflo mods install` remains the path for any later change.

### What the step does, in order

`v3/@claude-flow/cli/src/init/mods-generator.ts` exports `planModsStep` (pure) and `runModsStep` (effects, with injected `exec` and filesystem reads). `init.ts` calls `runModsStep` where it now calls `installMod`.

1. **Settings, ruflo-mods.** `installMod(root, 'local')` from #3612's `install.ts`, unchanged. It writes the three keys above and `.claude-flow/mods/install.json`.
2. **Settings, manager.** The same file gains `enabledPlugins["ruflo-mods-manager@ruflo"] = true`, written with #3612's `readSettingsFile`, `settingsFileFor` and the same atomic write. What was added is recorded in its own file, `.claude-flow/mods/manager.json` (`{ version: 1, settingsFile, added }`, `added` true only when the key was absent), beside #3612's `install.json`, which is left exactly as `installMod` writes it. `ruflo mods uninstall` reads both records and removes the manager's key only when its record says ruflo added it. A separate file keeps `install.ts` untouched and keeps a later `ruflo mods install` (which rewrites `install.json`) from dropping the manager's claim.
3. **Claude Code, ruflo-mods.** `repairPluginInstall({ projectRoot, scope: 'local', marketplaceKnown, claude })` from #3612's `plugin-repair.ts`: refresh or add the marketplace, then `claude plugin install ruflo-mods@ruflo --scope local`.
4. **Claude Code, manager.** `claude plugin install ruflo-mods-manager@ruflo --scope local`, through #3612's `nodeExec` and `findClaudeBinary`, with its `INSTALL_TIMEOUT_MS`. The marketplace step is not repeated: step 3 already refreshed the clone.
5. **Verify.** `resolveFindings` from #3612 for ruflo-mods; for the manager, the same check on `installed_plugins.json` (an entry for `ruflo-mods-manager@ruflo` whose `installPath` exists, user scope or this project).

The manager-specific argv in step 4 and the check in step 5 are the only new install logic. Everything else is #3612's functions called as they are. They hard-code `ruflo-mods@ruflo` today; taking a plugin id is a follow-up for #3612 to absorb, after which step 4 becomes a second `repairPluginInstall` call.

### When `claude` is missing or too old

`findClaudeBinary` finds the `claude` a shell would run; `claude --version` gives its version (the probe in #3612's `claude-installs.ts` already parses it).

- **No runnable `claude`:** steps 1 and 2 run (settings are still the request a later install honours), steps 3 to 5 are skipped, and init prints the manual commands: `repairCommands(root, 'local', known)` from #3612, then `claude plugin install ruflo-mods-manager@ruflo --scope local`.
- **Older than 2.1.287:** the same, with the version named. 2.1.277 to 2.1.286 load mods only with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` (which step 1 writes), but the manager's pane uses `$.ui.panes()` and the dialog-form open as typed in 2.1.287, so init does not install it on an older build. ruflo-mods is installed as before.
- **A step fails:** init prints the failing command and its last three output lines, then the manual commands, and continues. `init` never fails because of the mods step, as today.

### Exactly what init writes

| Path | Change | Undone by |
|---|---|---|
| `.claude/settings.local.json` | `enabledPlugins["ruflo-mods@ruflo"]`, `enabledPlugins["ruflo-mods-manager@ruflo"]`, `extraKnownMarketplaces.ruflo` (if absent), `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` | `ruflo mods uninstall` |
| `.claude/settings.local.json.bak-ruflo-mods-<ms>` | backup when the file existed (install.ts) | person |
| `.claude-flow/mods/install.json` | ruflo-mods' install record, unchanged in shape | `ruflo mods uninstall` |
| `.claude-flow/mods/manager.json` | the manager's install record | `ruflo mods uninstall` |
| `.claude-flow/policy/claude-code.json` | not written by init (`ruflo mods install` syncs it; init did not before either) | — |
| Claude Code's config dir | whatever `claude plugin marketplace update/add` and `claude plugin install` write (`plugins/known_marketplaces.json`, `plugins/installed_plugins.json`, `plugins/cache/ruflo/…`) | `claude plugin uninstall` |

Nothing under `.claude/helpers/` is written by this step.

**Helpers manifest.** `helper-signing.ts` signs `helpers.manifest.json`, and `helper-integrity.ts` re-verifies only the critical helpers it lists, read from `.claude/helpers/`. The mods step writes no helper and does not change `helpers-generator.ts`, `helper-refresh.ts` or any helper's content. The manifest's hashed set is therefore unchanged and nothing needs re-signing. (Checked by reading both files on #3612's base; the step's test asserts that no path it writes is under `.claude/helpers/`.)

### Idempotence

- `installMod` already keeps the first record's claims and rewrites the same keys.
- The manager key is set to `true` whether or not it was there; the manager record's `added` is OR-ed with the previous one's, so a second run never loses the claim and never claims a key a person set themselves.
- `claude plugin install` of an installed plugin succeeds and leaves it installed. Step 3's marketplace update is a `git pull` of the clone.
- A second `init --mods` therefore produces byte-identical settings and record (apart from `installedAt`) and the same installed state. The tests run the step twice and compare.

### `--dry-run`

`init` has no `--dry-run` today, and making the whole of init dry-runnable is outside this change. So:

- `init` declares `--dry-run`. With it, init does no work at all. It prints the mods plan (`planModsStep`: the settings JSON it would write, the record, the `claude` argv it would run, or the manual commands when `claude` is missing or old), prints "dry run: init wrote nothing; only the mods step has a plan to show", and exits 0.
- Without `--mods`, `init --dry-run` prints only that line.

That keeps the flag honest: it never writes half an init, and it never claims to preview steps it cannot. A full init dry run is an open question.

### Relation to `ruflo mods install`

`ruflo mods install` stays the way to add mods to an existing project. It gains `--manager` (default true; `--no-manager` skips it), which runs steps 2, 4 and 5 after its own, and `ruflo mods uninstall` also removes what `manager.json` records. Both are small additions to `commands/mods.ts`: calls into `mods-generator.ts`, nothing in #3612's `src/mods/*` changes. `init --mods` and `mods install` then end in the same state, through the same functions.

`mods-manage.ts` adds `ruflo mods list|enable|disable`, each with `--json`, and is registered in `commands/mods.ts`'s subcommand list with a two-line change, so #3612 can absorb it.

## Consequences

- `init --mods` now leaves the plugins installed and resolvable, not only enabled. That is a behaviour change for existing `--mods` users, in the direction #3612 already took for `mods install`.
- `init --mods` may take up to the marketplace timeout (150 s) on a cold clone. It prints each command as it runs.
- `ruflo mods uninstall` removes the manager's key with the others.

## Open questions for rUv

1. Should ruflo-mods ship `ruflo-mods-manager@ruflo` as a default `modTrustAllow` entry, so `refuse-risky` users need no extra step? Neither init nor the manager writes the allow-list (ADR 406).
2. Should `init` grow a real, whole-command `--dry-run`?
3. Should `/mods` be namespaced (`/ruflo-mods-manager`) now, before a built-in can take the name?
