# ADR 475: Policy ledger anchor cannot be deleted and silently re-established

Status: Accepted

Date: 2026-10-07

Builds on: ADR-324 (agentic policy engine), #3568 (ledger truncation anchor)

## 1. Context

#3568 added an anchor (`ledgerLength`, `ledgerHead`) so that a truncated ledger no longer verified. The anchor lived in
`state.json`, the file it protects, and `verify` re-created it whenever it was absent while receipts existed ("established-now").
So an attacker who truncated receipts and also deleted the two anchor fields got `{"valid":true,"anchor":"established-now"}`
(#3602, reproduced on 3.54.1). Appending a receipt to an unanchored ledger re-anchored it the same way.

## 2. Decision

1. **Never re-anchor silently.** With receipts present and no anchor, `verify` reports `anchor-missing` (invalid), and
   `appendReceipt` / any policy transaction refuse (`policy-ledger-anchor-missing`). Only an empty ledger (genesis) anchors on its first receipt.
2. **A second anchor outside the file the attacker edits.** `.claude-flow/policy/ledger-anchors.json` is an append-only,
   hash-chained list `{seq, length, headHash, prevAnchorHash, ts, event, by?, hash}`, written after each state write that changes the chain.
   The newest entry is mirrored to `~/.config/ruflo/policy-trust/<project>/ledger-anchor-head.json`. `verify` checks the
   state against the primary anchor, the newest log entry and the mirror. The mirror must appear in the log (an older copy of the log is a rollback).
   The log is written after `state.json`, so a crash leaves the state ahead of the log; that is caught up, never read as truncation.
3. **Explicit repair.** `ruflo policy verify --establish-anchor` (interactive terminal only, not exposed over MCP) anchors a ledger
   that has receipts and no usable anchor (a corrupt log or mirror is rebuilt; a readable one must still agree with the chain), and records `event: establish-anchor`, the OS user and the time in the log. It cannot override a
   truncation or mismatch that the remaining anchors still prove.
4. **Migration.** A state.json anchor from an older version is accepted; the second anchor is then written (`migrated-from-state`).
   A ledger with no anchor at all (pre-#3568) gets `anchor-missing` and the one-step repair above, not a crash. A deleted primary with an
   intact second anchor is restored from it (`restored-primary`) when the chain agrees.

## 3. Threat model (stated in `verify` output as `scope`)

Detected: edits confined to `state.json`; edits confined to the project directory (the mirror remembers the newest anchor); a rolled-back or deleted anchor log while the mirror exists; a
corrupted log.

NOT detected: an attacker who can rewrite both the project directory and the user's `~/.config/ruflo`. They can also delete the anchors,
the mirror and the receipts, leaving a ledger that is either `anchor-missing` (which a naive operator may then "repair" with `--establish-anchor`) or, if they also forge a coherent log and mirror, valid.
No local, unkeyed scheme defends against full local write access; stronger evidence needs an external witness (signed receipts via
`CLAUDE_FLOW_POLICY_SIGNING_KEY`, or shipping the head hash off-host). A truncation back to a point where a *previous* anchor
entry exists while that entry and everything after it is also removed from log and mirror is likewise undetectable. The mirror is best-effort (a read-only home logs a warning and continues).

In `enforce` mode `state.json` was already HMAC-authenticated through `state.anchor.json` in the home directory, so the #3602 repro only bit in `legacy` and `observe`, where no HMAC exists; the second anchor extends the same kind of coverage to those modes.

## 4. Consequences

- A pre-#3568 ledger (receipts, no anchor of any kind) makes every policy transaction fail with `policy-ledger-anchor-missing: ... run ruflo policy verify --establish-anchor` until an operator repairs it; `authorizeMcpTool` rethrows, so MCP calls fail with that text (CLI startup migration swallows it). A truncation already failed the same way (`policy-ledger-truncated`).
- `verifyPolicyLedger` gains `{ establishAnchor }` and results may carry `secondaryAnchor`. `LedgerVerification.anchor` is only set by an explicit establish.
- `AgenticPolicyEngine.verifyLedger({ establishAnchor })` is the only engine path that anchors existing receipts.
- Touches `@claude-flow/security` (bundled) and `@claude-flow/cli`.
