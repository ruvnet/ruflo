# Ruflo Event Intelligence Gateway

An opt in way to turn signed GitHub activity into persistent Ruflo **draft missions**, and route subsequent comments into the existing mission's inbox. It never automatically edits code or sends messages.

## Configure

Set the GitHub webhook secret as a protected environment variable named `RUFLO_GITHUB_WEBHOOK_SECRET`. Use at least 16 bytes. Do not commit the secret.

Create `event-policy.json` locally:

```json
{"mode":"enforce","repositories":["ruvnet/ruflo"],"actors":["reviewer"],"createDrafts":true}
```

Omitting the policy file results in observe mode, with no new drafts.

## Ingest a GitHub webhook

Preserve the raw request bytes and original GitHub headers when forwarding through a trusted webhook receiver:

```bash
ruflo events github --payload-file payload.json --signature "$SIGNATURE" --delivery-id "$DELIVERY_ID" --event-type issue_comment --policy-file event-policy.json
```

Read the returned JSON receipt. The `missionId` is the durable owner for that PR thread, and the `eventKey` identifies this receipt. Payload text is not stored; an authorized worker fetches the GitHub thread through its own approved connector.

## Worker inbox

```bash
ruflo events inbox --mission msn_0123456789abcdef01234567
ruflo events ack --mission msn_0123456789abcdef01234567 --event-key 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Acknowledge only after an authorized handoff. Polling does not launch a worker or bypass mission approvals.

## Tests

From the repository root, use Node 22 and Corepack. The V3 workspace pins pnpm 8.15.0:

```bash
bash v3/scripts/verify-event-intelligence.sh
```

Alternatively, run `npm run test:event-gateway` from `v3/`. The script uses the frozen pnpm lockfile, builds referenced workspace dependencies, typechecks and compiles the CLI, and runs the three test suites. All 12 tests passed on the locked dependency graph. The load test executes 300 signed deterministic events, 20 PR threads, and 30 duplicate replays. Do not use `npm ci` against the unsynchronized V3 npm lockfile.

This is **not** a production webhook server. External HTTP ingress, email and Slack, live worker dispatch, automatic GitHub writes, retention limits, and a crash safe inbox index are out of scope.

See [ADR 523](../adr/ADR-523-superagent-event-intelligence.md).
