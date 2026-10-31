# Next host version: durable effect intents and explicit credential placement

The journal-aware caller is integrated into the next host transfer/edit entrypoints. It was separately qualified by a tiny actual Kimi canary. Archived Claude and
frozen Kimi/Agent Booster experiments did not use it; no historical durability
or billing reconciliation is reconstructed.

## Failure being addressed

An actual ruOS desktop restart interrupted a diagnostic Kimi transfer. The process
was gone and only partial rows remained. The old runner saved rows after responses
with write_text, without a per-request intent, atomic replacement or fsync. A valid
partial file cannot establish complete billing history. A timeout or lost process
must never be interpreted as provider cancellation or safe automatic retry.

`effect_journal.py` commits an owner-only, bounded intent before invoking the
host-owned send callback. It stores stable plan, attempt and request hashes plus
a conservative reserve. An exclusive filesystem transaction and file/directory
fsync establish local admission order. Every outstanding intent or unknown result
blocks all later sends until host/provider reconciliation supplies a matching
receipt. Receipt replay is idempotent; conflicting receipts, generation reuse,
changed budgets and changed request identities fail closed. Actual cost exceeding
a reserve is retained rather than discarded, and blocks further admission.

The journal uses explicit USD nanounits, not rounded cents. This provides precise
host accounting but does not alter native Ruflo observation schemas or claim a
native learning integration. It records provider-origin hashes and identifiers,
not credentials, prompts, provider headers or raw response bodies.

## Acceptance and limits

Fifteen offline tests pass: simulated process loss after send/before receipt,
after intent/before send and after durable receipt; duplicate attempts; duplicate
and conflicting receipts; no-resend reconciliation; changed campaign/request
identity; stale locks; malformed/symlink state; fsync failure; and actual cost
overrun retention. One test actually terminates a child with os._exit after a fsynced local fake
provider effect and then verifies that a parent restart blocks both duplicate and
new sends. No external provider is called. This does not qualify physical
power-loss or VM reboot durability. A preexisting durable parent is required;
its journal-directory entry is fsynced before admission, including after a failed
creation attempt. Persistent host storage is mandatory: tmpfs or temp-directory
cleanup cannot provide cross-reboot retention.

The API is host-only and has no model-visible arbitrary callback/command surface.
A journal grant is not authority to exceed host policy. A privileged host can
bypass the wrapper, reset a root or lie about reconciliation; provider receipt
truth and campaign custody remain external responsibilities. Stale locks need
manual inspection, not PID-based deletion. No provider idempotency, distributed
lease, invoice audit, account billing cap or exactly-once transport is claimed.
New diagnostic roots must retain prior interrupted attempts, not manufacture a
fresh proof or silently merge partial outcomes.

Run offline acceptance:

```sh
python3 scripts/managed-proof/test_effect_journal.py
```

Confirm one simulated provider invocation, crash after send, then zero additional
invocations when either the same or a new attempt is requested before reconciliation.

## Explicit ruOS credential placement

`ruos_credential.py` was not used by historical transfer runs, but the new actual
canary qualified its explicit placement path. It reads the exact
OPENROUTER_API_KEY environment value first. A trusted host must explicitly enable
placement lookup; then only ~/.ruos/env and the standard runtime ruos-env filename
are considered. It accepts only the named export through shlex parsing, never
sources a shell file, selects arbitrary keys, prints values or exposes a new MCP
tool. Owner-only regular files/directories, bounded reads and no-follow opens are
required. Ambiguous duplicate exports and unsafe permissions fail closed.

Five offline tests cover environment priority with no disk access, explicit opt-in,
no sourcing/printing, permissions, symlinks, duplicate exports, command substitution
and header injection. No actual credential was retrieved in these tests. Actual
placement qualification, provider reconciliation and integration into a new frozen
runner remain separate work.

## Actual journal-aware provider canary

[The ruOS canary](managed-journal-canary.json) used the immutable v4 source archive
SHA256 `6728ad1a8e42163503d0720938d98ce9baa1de7acb9139ab32fe435b05d36789`.
One real Kimi request cost $0.00037818, producing one fsynced receipt with
378180 USD nanos, zero pending reserve and one attempt. Repeating the same fixed
command was blocked before a second paid completion; the journal was unchanged.
The explicit credential reader worked without printing its value. This qualifies
transport/intent/receipt/dedup wiring, not new model quality or transfer proof.

Future transfer and edit CLIs now default to a journal under their campaign root;
--journal-root can explicitly select another retained root. --ruos-placement is
an explicit trusted-host opt-in. All request and receipt phases remain distinct
from correctness and promotion. The conservative .02 USD canary admission budget
was an estimate envelope; actual reported cost was .00037818, not a claim of
account-level billing enforcement.
