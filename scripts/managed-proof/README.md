# Host actor proof scripts

These scripts are experimental host jobs, not MCP tools or promotion authority.

* `actor_pilot_v1.py` and `actor_pilot_v2.py` are immutable executed-source archives.
  V1 has a confirmed oracle bug. Do not run either as a new proof campaign.
* `cost_endpoint_v2.py` is the exact executed v2 analysis source. Its fixed
  comparison passed conditionally; its random comparison failed.
* `actor_pilot.py` is the next v3 oracle with offline hardening, not an executed
  model confirmation. It requires a fresh host manifest and checks all references
  before inference. Every invocation may spend real provider credit through the
  host-owned Claude CLI, up to the frozen reported-cost admission envelope;
  in-flight billing and unknown metering require host reconciliation.
* `analyze_actor_pilot.py` only describes archived evidence and rejects malformed,
  duplicate, foreign, altered-selection and wrong-random-schedule records.
* `cost_endpoint.py` implements the frozen narrow global-prompt cost endpoint,
  separate from Ruflo's unchanged quality-lift proof gate. Its paired test assumes
  independent tasks; IDs alone cannot establish that assumption.

Run offline regression tests without credentials or actor calls:

```sh
python3 -m unittest discover -s scripts/managed-proof -p 'test_*.py'
```

For a separately authorized fresh host experiment, provide a bounded regular JSON
manifest with `training` and `audit` arrays. Every task has exactly `id`, `spec`,
`parameters`, `returnType`, `cases` and `referenceCode`. Cases are `[args, expected]`.
Use core ECMAScript, plain finite JSON values and immutable inputs. The v1 published
corpus is mechanically excluded; the operator must also exclude other published
or consumed data and semantically equivalent cases. A fresh directory does not
provide global holdout custody or an alpha-spending ledger.

The archived v1/v2 results and limitations are in
[the validation reports](../../docs/validation/managed-actor-pilot-v2.md).
Generated code runs in bubblewrap with no home/network/credential environment.
The Node old-heap setting is not a total OS memory limit. Use host resource controls
before treating this as an adversarial multi-tenant execution service.


Next host transfer/edit entrypoints now use `journaled_openrouter.py` and the
private `effect_journal.py` admission ledger. A tiny actual canary recorded one
provider receipt and blocked a duplicate before another paid completion. This
is separate from historical model experiments; it does not repair their lost
request history. `ruos_credential.py` permits only explicit fixed placement lookup,
never shell sourcing or arbitrary credential selection.

`verified_application.py` rejects confidence-only acceptance and permits verified
full-source fallback only for the frozen host complete-source request format.
The actual known-case guard replay accepted 8 Booster outputs plus 2 direct
fallbacks; raw Booster is still 8/10. See the actual experiment reports.
