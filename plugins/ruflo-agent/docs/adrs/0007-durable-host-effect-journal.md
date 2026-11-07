# ADR 0007: durable intent fencing for host model effects

Status: next host entrypoints wired; actual tiny transport canary qualified. Historical campaigns unchanged.
Date: 2026-10-25.

A real desktop restart during the Kimi diagnostic exposed a gap between a frozen
plan and durable per-request accounting. Post-response write_text checkpoints
cannot establish the full set of charged effects after process loss. Do not
blindly retry an unknown request or label a restarted reused corpus as a fresh
confirmation.

Select a minimal private host journal before later runner integration: exclusive
filesystem transactions, immutable plan/budget, stable attempt/request digests,
file and directory fsync before send, matching fsynced provider receipts after
send, and no admission while any intent is unresolved. Store integer USD nanos
to avoid cent rounding; this does not migrate native Ruflo learning. Reconciliation
is a trusted host/provider action, not a model approval flag. Actual overruns stay
in the ledger and prevent new admission rather than disappearing as invalid input.

The helper is separate from the currently frozen v3 oracle/transport files so
existing evidence remains byte-exact. Fifteen fault/replay tests pass, including
crash after send before receipt, crash after durable receipt and duplicate attempt
fencing. No current live-run durability or exactly-once provider behavior is claimed.

An optional fixed OpenRouter placement reader is another future host helper,
with environment first and explicit opt-in to canonical ruOS placement files.
It uses bounded owner-only regular-file reads and shlex for the named export,
never shell sourcing, arbitrary secret lookup or printing. Five offline tests
pass; it is not registered as an agent-visible tool or used in current evidence.

[Validation and limitations](../../../../docs/validation/managed-effect-journal.md)
cover stale-lock inspection, retained unknown outcomes, same-user root custody,
local POSIX durability assumptions and the absence of global billing authority.

The next fixed provider caller now wraps the official OpenRouter transport and is
used by the next transfer/edit entrypoints. An actual ruOS canary cost $.00037818,
recorded one fsynced provider receipt and blocked a duplicate before a second paid
completion. Explicit fixed credential placement also worked. This is new transport
validation, not retroactive durability of the interrupted campaign or a model
improvement result. Original v3 and canary v4 source snapshots are retained.
