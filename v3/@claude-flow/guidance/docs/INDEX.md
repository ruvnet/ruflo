# @claude-flow/guidance Documentation

## Guides

Conceptual explanations of how each system works.

| Guide | Description |
|-------|-------------|
| [Getting Started](./guides/getting-started.md) | Installation, minimal setup, core loop |
| [Architecture Overview](./guides/architecture-overview.md) | 7-layer architecture, data flow, module map |
| [Multi-Agent Security](./guides/multi-agent-security.md) | Threat detection, collusion, quorum, trust |
| [Capabilities and Trust](./guides/capabilities-and-trust.md) | Permission algebra, trust accumulation, authority |
| [Knowledge Management](./guides/knowledge-management.md) | Uncertainty, temporal assertions, truth anchors |
| [WASM Kernel](./guides/wasm-kernel.md) | Building, using, and benchmarking the Rust WASM kernel |

## Tutorials

Step-by-step walkthroughs for specific tasks.

| Tutorial | Description |
|----------|-------------|
| [Enforcement Gates](./tutorials/enforcement-gates.md) | Wire gates to block destructive ops and secrets |
| [ContinueGate](./tutorials/continue-gate.md) | Prevent runaway agent loops |
| [Proof & Audit Trail](./tutorials/proof-audit-trail.md) | Create tamper-evident audit trails |
| [CI/CD & Headless Testing](./tutorials/cicd-headless-testing.md) | Automated compliance testing |

## Reference

| Document | Description |
|----------|-------------|
| [API Quick Reference](./reference/api-quick-reference.md) | All exports, methods, and types |

## Diagrams

| Diagram | Description |
|---------|-------------|
| [System Diagrams](./diagrams/system-diagrams.md) | 10 Mermaid diagrams: architecture, pipelines, decision trees |

## Architecture Decision Records

| ADR | Title |
|-----|-------|
| [G001](./adrs/ADR-G001-guidance-control-plane.md) | Guidance Control Plane |
| [G002](./adrs/ADR-G002-policy-compilation.md) | Policy Compilation |
| [G003](./adrs/ADR-G003-shard-retrieval.md) | Shard Retrieval |
| [G004](./adrs/ADR-G004-enforcement-gates.md) | Enforcement Gates |
| [G005](./adrs/ADR-G005-run-ledger.md) | Run Ledger and Evaluators |
| [G006](./adrs/ADR-G006-rule-evolution.md) | Rule Evolution Pipeline |
| [G007](./adrs/ADR-G007-hook-integration.md) | Hook Integration |
| [G008](./adrs/ADR-G008-persistent-ledger.md) | Persistent Ledger |
| [G009](./adrs/ADR-G009-headless-testing.md) | Headless Testing |
| [G010](./adrs/ADR-G010-deterministic-gateway.md) | Deterministic Tool Gateway |
| [G011](./adrs/ADR-G011-artifact-ledger.md) | Artifact Ledger |
| [G012](./adrs/ADR-G012-evolution-pipeline.md) | Evolution Pipeline |
| [G013](./adrs/ADR-G013-manifest-validator.md) | Manifest Validator |
| [G014](./adrs/ADR-G014-proof-chain.md) | Cryptographic Proof Chain |
| [G015](./adrs/ADR-G015-memory-write-gate.md) | Memory Write Gate |
| [G016](./adrs/ADR-G016-coherence-scheduler.md) | Coherence Scheduler |
| [G017](./adrs/ADR-G017-capability-algebra.md) | Capability Algebra |
| [G018](./adrs/ADR-G018-conformance-kit.md) | Conformance Kit |
| [G019](./adrs/ADR-G019-ruvbot-integration.md) | RuvBot Integration |
| [G020](./adrs/ADR-G020-meta-governance.md) | Meta-Governance |
| [G021](./adrs/ADR-G021-adversarial-model.md) | Adversarial Model |
| [G022](./adrs/ADR-G022-trust-system.md) | Trust System |
| [G023](./adrs/ADR-G023-truth-uncertainty-temporal.md) | Truth Anchors, Uncertainty, Temporal |
| [G024](./adrs/ADR-G024-authority-irreversibility.md) | Authority Gate and Irreversibility |
| [G025](./adrs/ADR-G025-wasm-kernel.md) | WASM Policy Kernel |
