# Cross model transfer and Agent Booster application

These host tools consume the corrected oracle from the sibling managed proof
runner. They do not retrieve secrets or change the tenant model route. The executor uses its authorized OPENROUTER_API_KEY environment value, or an
explicit --ruos-placement opt-in to the fixed private placement reader. Never
put the credential value in arguments, reports or project files.

Run the offline transport and policy tests:

```sh
python scripts/managed-proof/booster-transfer/test_transfer.py
```

A source policy is a bounded JSON record:

```json
{
  "version": 1,
  "instruction": "Frozen prompt text selected only from source training",
  "sourcePlanHash": "64 lowercase hex characters",
  "sourceTrainingDigest": "64 lowercase hex characters",
  "sourceModel": "exact observed source model"
}
```

A fresh task manifest has the same closed schema as `actor_pilot.py`, including
explicit parameters, return type, reference code and hidden cases. References
are not sent to the model. Freeze a new root for every campaign:

```sh
python scripts/managed-proof/booster-transfer/transfer_pilot.py \
  --manifest /host/fresh-manifest.json --source-policy /host/source-policy.json \
  --history /host/consumed-campaign.json --root /host/new-transfer-run \
  --budget .50
```

For a deliberately reused public benchmark, add `--diagnostic-reuse`. It remains
ineligible for a fresh confirmation claim. The exact initial model is Kimi K3.1
Pro. Catalog availability, account entitlement and successful inference are
separate checks.

The paired edit manifest is `{ "tasks": [...] }`, where each task has `id`,
`code`, `edit`, `language` (`javascript`), `cases` and `referenceCode`. Its oracle
cases call the complete returned `solve` function. The preinstalled, pinned npm
package must resolve from the host selected tools directory:

```sh
python scripts/managed-proof/booster-transfer/edit_ablation.py \
  --manifest /host/new-edits.json --booster-cwd /host/pinned-tools \
  --root /host/new-edit-run --budget .25
```

Both application arms share each provider generation. A successful Booster
merge without independent acceptance is not a passing result. No file in the
user project is overwritten by these runners.


The next transfer/edit entrypoints use a durable intent/receipt journal under
ROOT/effects by default; --journal-root selects an explicit retained journal.
Unknown effects block new admission until host/provider reconciliation. Current
historical experiment archives did not use this journal. The separate fixed
canary is `python scripts/managed-proof/journaled_openrouter.py --root /host/new-journal --ruos-placement`.
It is one bounded official-provider call, not an arbitrary script runner.

The next edit application guard independently tests the Booster result and only
permits verified direct fallback for the host-declared complete-source contract.
Partial edits never receive direct-as-full-file fallback. Raw observed Booster
performance remains 8/10; posthoc guarded replay is a separate 10/10 diagnostic.
