# Managed workflows ruOS integration validation

Date: 2026-10-25. Machine: Work Desktop, Fly ID `85050dc77130e8`.
Source: PR #4471 commit `8e08b5fbe48b9c7a55e4224cd1f5c15bf9095554`, followed by
the recall hydration fix in this commit. Node 20.20.2; Claude Code 2.1.283;
installed Ruflo 3.47.1 was left unchanged. The candidate was checked out into
`/home/ruv/work/ruflo-managed-e2e-4471`; tests and terminal bundle use that source.
Initial isolated tests did not change tenant routes, capability grants or global
runtimes. Subsequent user-authorized login and installation are recorded below.

## Verified results

| Boundary | Result |
| --- | --- |
| Candidate backend contracts on ruOS | 167 tests passed before the recall fix |
| Candidate focused console regressions on ruOS | 101 tests passed |
| Complete pure console spec suite on ruOS, one worker | 3,516 passed, 35 skipped; 236 files passed, five skipped; 214.74 seconds; exit 0 |
| Backend regressions after recall fix, local workspace | 168 passed; strict adapter types passed locally and on ruOS |
| Standalone console build | Actual candidate terminal bundle built successfully |
| Disk snapshot to terminal host to Workflows view | Passed five assertions: managed run, provider unverified, workers unverified, acceptance unverified, reported budget |
| Signed local ledger to new process | Three fixture receipts survived and were reverified |
| Native indexing with declared memory 3.0.9 | Three records durably indexed with embeddings |
| Native search after process restart, before fix | Failed: zero of three receipts recalled |
| Native search after process restart, after fix | Passed: three of three receipts authenticated; advisory strategy returned; defaults unchanged |
| Claude login and authenticated retry | Login verified; model turn succeeded; console driver failed because console tools were absent |
| Installed stable plugins with Claude Code 2.1.287 | Console tools registered; Workflows driver exited 0 |
| Candidate managed view with Claude Code 2.1.287 | Two actual console tool calls, all five display assertions passed; reported cost $0.0389625 |

The terminal check injected workersInspected=true, acceptancePassed=true and
verification=verified into a snapshot. The real Node filesystem reader and
bundled terminal host still displayed all three verification boundaries as
unverified. This was a local fixture integration test, not provider execution or
validation of the Claude Code function-hook host. Its snapshot was read without
a CLI entry or model transport.

Native tests used `scripts/e2e-managed-native.mts` in separate write and recall
processes. The fixture signing key was generated in memory and never persisted;
only its public key and signed synthetic metadata were stored. The observations
are explicitly synthetic plumbing evidence, not model-quality measurements or
production evaluation receipts. There were zero model calls and no automatic
promotion. The test used the real memory initializer, native SQLite writer and
embedding backend, rather than mocked memory APIs.

The complete pure spec command used `--maxWorkers=1 --testTimeout=30000` and
excluded `**/*.test.ts` as the plugin smoke does for host-kit tests. This resolves
the earlier incomplete pure suite result under contention; it does not claim
that the authenticated host-kit tests or full monorepo suite passed.
Machine-readable native and terminal evidence: [receipt](managed-ruos-e2e.json).

## Defect found and corrected

`searchEntries` returns 60-character content previews plus an ellipsis. The
initial implementation tried to parse those previews as complete signed JSON,
so actual authenticated recall returned no evidence even though native rows and
embeddings were present. Mocked contracts had supplied full JSON and missed it.

Recall now hydrates each eligible hit using the existing `getEntry` operation
with the exact project database, fixed namespace and admitted digest key. It
then rechecks row key, namespace, size, schema, signature, content digest and
local training-cohort membership. Search rank never establishes verification.
A regression covers truncated previews and mismatched hydrated namespaces.
Recommendations still use the complete eligible training cohort.

## Host incompatibility and unresolved live gate

The desktop's installed `@claude-flow/memory` was 3.0.0-alpha.26. A diagnostic
initialization with that older package aborted its process (exit 134) with
`memory allocation of 4158883080 bytes failed`. This is not evidence that the
candidate's pinned dependency has the same failure. The isolated probe was
aligned to the candidate manifest's memory 3.0.9 without changing global
packages; write and restart recall then passed after the hydration fix.

The isolated dependency install disabled lifecycle scripts and reused the
desktop's already working better-sqlite3 12.11.1 native binding of the same
installed package version. Initial old-backend versions were AgentDB
3.0.0-alpha.20 and RuVector core 0.1.32. No claim of arbitrary historical backend
compatibility follows from the successful current-dependency run.

The first real headless Claude console driver failed before any tool call:
`Failed to authenticate: OAuth session expired and could not be refreshed`.
It reported cost $0 and zero calls. ANTHROPIC_API_KEY and CLAUDE_API_KEY were
absent from the executor environment and Claude settings. The ruOS vault lists
an Anthropic slot, but the exposed tools do not supply a verified key-delivery
path for this running executor. Secret values were never requested or printed.

The user subsequently completed authentication. `claude auth status` confirmed
a logged-in Claude subscription, and the repeated driver made a successful model
turn with reported cost $0.0183653. Its system initialization listed
ruflo-console 0.49.0 from the candidate path, but no console tools were registered.
The model reported console_state, console_open, console_set and console_run
unavailable. The driver exited 1 with zero console calls. This establishes an
actual host registration blocker on Claude Code 2.1.283; it does not isolate
whether the cause is host feature support, configuration or module loading.
No authorization code or token is included in these artifacts.

### Installation and compatible host resolved console registration

At the user's request, the official ruflo marketplace was refreshed and
ruflo-mods 0.7.0, ruflo-swarm 0.3.7 and ruflo-console 0.48.0 were installed and
enabled at user scope. Existing settings were backed up privately, then the
documented CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 setting was enabled. Even with
that flag, the 2.1.283 isolated driver made no console calls.

Claude Code 2.1.287 was installed in an isolated prefix from its pinned official
npm package. Its native Linux binary passed console hook validation and the
stable Workflows driver (console_open and console_state, exit 0). A user-local
claude-ruflo launcher and Ruflo Console desktop entry select that tested host;
the system claude binary was not replaced. The real interactive /ruflo pane
was opened and visually confirmed on the desktop with the installed console.

The candidate console 0.49.0 was then loaded with --plugin-dir using 2.1.287,
alongside the installed mods and swarm. The actual Claude console driver made
two tool calls and exited 0; a separate assertion over its full tool-result
stream confirmed the managed session, reported budget and all three unverified
correctness boundaries. The seed intentionally claimed verified=true. The test
cost reported $0.0389625. Stable 0.48.0 remains the installed console; the draft
candidate was tested without publishing or replacing that installed version.

This supersedes the console registration blocker for the tested 2.1.287 host.
The version comparison is an observed compatibility matrix, not a diagnosis of
every internal host rollout condition. The managed source was based on
8e08b5fbe48b9c7a55e4224cd1f5c15bf9095554; its console files were unchanged by
the later recall and documentation commits. No remote provider was contacted
by the managed view itself.

Direct Anthropic Managed Agents execution, live budget pauses and fresh remote
controls remain unvalidated. A Claude subscription login does not establish
Managed Agents API credentials or beta entitlement. Securely deliver an
authorized API key with beta access before rerunning the bounded provider test.

## Reproduction and acceptance

With the candidate's declared native dependencies and tsx available:

```sh
node node_modules/tsx/dist/cli.mjs scripts/e2e-managed-native.mts write /tmp/managed-native-probe
node node_modules/tsx/dist/cli.mjs scripts/e2e-managed-native.mts recall /tmp/managed-native-probe
```

Use a new isolated directory for each write. The second command must run in a
new process, recall all three signed rows and leave defaults unchanged. Native
abort diagnostics must run in an isolated process; JavaScript cannot catch a
native process abort. Do not substitute a sql.js fallback for the native gate.

Release acceptance additionally requires one bounded live workflow visible in
the actual console host, a policy denial at execution, verified remote cleanup,
and independent task acceptance evidence. Until then PR #4471 remains draft.
