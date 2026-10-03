# ADR 379A: Intersect delegated authority at execution

Status: Proposed, implemented for review

## Context

Mecatl separates session ownership, permission approval, and delegated authority.
Ruflo already implements the corresponding capability envelope and checks it at
MCP dispatch through `authorizeMcpTool` before invoking a handler. We reuse that
model rather than add a second policy engine.

Review found that a tool supplied envelope replaced the process envelope. It
also found that empty lists meant unrestricted authority, making an empty
intersection unsafe to represent. Namespace omission can mean a default namespace
or a search across all namespaces depending on the handler.

## Decision

1. Intersect process and tool envelopes. Neither may enlarge the other.
2. Treat an omitted list as unconstrained and an explicit empty list as deny all.
   Patterns support exact names and a trailing prefix wildcard. This is capability
   matching, not filesystem path confinement.
3. Validate envelope structure and finite nonnegative numeric constraints before
   use. Invalid authority fails closed, including legacy and observe policy modes.
4. Delegate snapshots with one fewer remaining hop. Do not alias parent arrays.
5. Require explicit namespaces for classified memory operations under restricted
   namespace authority. Do not silently authorize a different handler default.
6. Preserve existing behavior for callers without an envelope. Permission approval
   cannot override envelope denial.

## Migration

Existing explicit empty arrays previously meant unrestricted access. They now deny
that dimension. Operators intending unrestricted scope must omit the field or use
`["*"]`. Review generated envelopes before deployment. Policy mode does not bypass
an explicit capability boundary. No npm publication or default policy mode change
is part of this change.

## Trust boundary and limits

The envelope is trusted composition metadata. An environment variable is not a
signed credential and a process that can rewrite its own environment or executable
can bypass in-process enforcement. The feature does not isolate operating system
processes, authenticate tenants, or enforce arbitrary shell/network/file effects.
Cost and token fields are declared operation bounds, not measured accounting.
Deploy mutually untrusted agents in isolated workers and enforce credentials and
resource ownership at downstream services. Native host tools outside Ruflo dispatch
need their own enforcement adapters.

## Validation

Focused tests cover broad replacement, disjoint intersections, legitimate overlap,
namespace omission and cross-namespace denial, malformed authority, attenuation,
depth exhaustion and mutation isolation. Run the security policy regression suite
alongside them. Acceptance: denied authority never becomes an allowed decision,
regardless of permission policy mode, and a child cannot acquire a parent-excluded
capability by delegation or composition.

Source inspiration: stacklok/mecatl commit
`d14494785f2e732b5b310992eaaeaff8eee5fe7f`, architecture/agent-loop authority model.
This implements concepts independently in Ruflo's existing TypeScript policy layer.

## Local review evidence

27 focused and existing policy tests passed with Vitest 4.1.0 on Node 24.19.0.
Targeted TypeScript 5.9.3 validation passed for envelope.ts and types.ts.
A single local warm microbenchmark (100,000 checks, 10,000 warmup) measured
0.156 microseconds/check at baseline and 0.680 with validation, approximately
0.524 microseconds added. This is a microbenchmark, not end-to-end latency.
Full monorepo build and transport-wide qualification were not run.

## Research and hardening followup

Primary sources reviewed:

* [Cedar evaluation semantics](https://docs.cedarpolicy.com/policies/syntax-policy.html): explicit denial dominates permission. Retain Ruflo's separate, mandatory authority gate.
* [Biscuit authorization](https://doc.biscuitsec.org/getting-started/authorization-policies.html): added delegation checks restrict authority; only the application grants access. Use intersection, not replacement.
* [OAuth Token Exchange, RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html): expresses delegation and actor identity but leaves important token trust semantics to deployment profiles. Do not confuse attribution with enforcement.
* [Attenuating Authorization Tokens draft 01](https://www.ietf.org/archive/id/draft-niyikiza-oauth-attenuating-agent-tokens-01.html), June 15, 2026: proposes tool and argument constraints with depth and lifetime limits. This is an individual Internet Draft, not an adopted standard. We implement narrowing semantics, not its wire format or cryptography.

Additional implemented controls:

* Snapshot even a single envelope before asynchronous policy work.
* Snapshot MCP arguments once for both authorization and handler execution.
* Require known finite nonnegative usage when a corresponding cap exists.
  This changes previous missing-usage behavior. Adapters must supply trusted
  conservative bounds; do not fill unknown usage with fabricated zeros.
* Reject the reserved `all` namespace under namespace restrictions.
* Conservatively reject memory and AgentDB operations outside the reviewed
  store/retrieve/search/delete/list set when either namespace scope is restricted.
  This includes tools that ignore namespace and tools not yet qualified here.
* Recognize read action names exactly or by `.read` suffix, never a substring.
* Hoist invariant validation field metadata, avoiding a Set allocation per check.

Validation commands from the repository root (installed development dependencies):

```sh
npx vitest run --config v3/@claude-flow/security/vitest.authority.config.mts
npx tsc -p v3/@claude-flow/security/tsconfig.json --noEmit
node v3/@claude-flow/security/scripts/benchmark-authority.mjs 1c411e5b55e326d929d649b04d49902553d1d39d
```

Followup suite: 69 tests passed, including real authorization wrapper handler
nonexecution, argument mutation during policy IO, namespace sentinel rejection,
and 294 scope-pair/action combinations tested in both intersection orders.
Seven rounds of 100,000 warm checks measured median 0.614 microseconds for
1c411e5b55e326d929d649b04d49902553d1d39d and 0.382 microseconds for the candidate: about 38% lower microbenchmark
latency despite stronger validation. These results are local, not end-to-end
or evidence of superiority over another authorization system.

Remaining limits: no transport-wide certification, OS isolation, signed delegation
chain, revocation distribution, or usage metering is claimed. Mutable process
configuration is still trusted. Full monorepo build remains outside this focused gate.
