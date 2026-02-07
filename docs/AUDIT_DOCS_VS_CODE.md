# AUDIT_DOCS_VS_CODE

Date: 2026-02-06
Repository: `/Users/alessiorocchi/Projects/claude-flow`
Audit mode: `docs-as-code` + strong adversarial verification
Final verdict: `PASS`

## 1. Executive Summary

This cycle synchronized `README.md`, `docs/**`, and `v3/docs/**` with repository code/config/test truth.

Outcome snapshot:

- Scope files cataloged: `27`
- Markdown docs rewritten: `10`
- Canonical facts extracted: `38`
- Permitted claims: `18`
- Downgraded/removed claims: `4`
- Evidence pointers validated: `113/113`
- Mermaid diagrams compiled: `2/2`
- Open contradictions: `0`
- Open critical findings: `0`

Primary result:

- Documentation now underclaims where evidence is incomplete.
- DDD documents under `v3/docs/ddd/**` were downgraded to `Partially Implemented` or `Aspirational` where runtime code is scaffolded.
- Historical comparison/performance claims without reproducible local evidence were removed or weakened.

## 2. Scope and Methodology

### Scope

- `README.md`
- `docs/**`
- `v3/docs/**`

### Method

1. Inventory and classify docs/assets in scope.
2. Extract canonical facts from source code, config, scripts, and tests.
3. Rewrite docs to keep only code-traceable claims.
4. Run adversarial checks:
   - claim falsification
   - diagram attack (Mermaid compile + edge trace)
   - flow walkthrough (MCP start, RuVector setup, provider routing, QE/Coherence integration)
   - omission hunting (limitations and boundary conditions)
   - getting-started command-to-script mapping
5. Reconcile until no critical findings and no open contradictions.

## 3. Doc Catalog + Doc-to-Scope Map

### 3.1 Catalog

| Path | Classification |
|---|---|
| `README.md` | overview, architecture, onboarding, operations, API overview |
| `docs/ruvector-postgres/README.md` | onboarding, operations, data/API SQL |
| `docs/ruvector-postgres/docker-compose.yml` | operations/deployment asset |
| `docs/ruvector-postgres/examples/attention-ops.sql` | data/API example |
| `docs/ruvector-postgres/examples/basic-queries.sql` | data/API example |
| `docs/ruvector-postgres/examples/similarity-search.sql` | data/API example |
| `docs/ruvector-postgres/examples/v3-demo.sql` | data/API example |
| `docs/ruvector-postgres/scripts/cleanup.sh` | operations/runtime script |
| `docs/ruvector-postgres/scripts/init-db.sql` | data/schema/API SQL |
| `docs/ruvector-postgres/scripts/run-migrations.sh` | operations/runtime script |
| `docs/ruvector-postgres/scripts/test-connection.sh` | operations/validation script |
| `docs/ruvector-postgres/tests/benchmark.sh` | validation asset |
| `docs/ruvector-postgres/tests/test-vectors.ts` | validation asset |
| `docs/ruvector-postgres/agents/architect.yaml` | supporting artifact |
| `docs/ruvector-postgres/agents/coder.yaml` | supporting artifact |
| `docs/ruvector-postgres/agents/reviewer.yaml` | supporting artifact |
| `docs/ruvector-postgres/agents/security-architect.yaml` | supporting artifact |
| `docs/ruvector-postgres/agents/tester.yaml` | supporting artifact |
| `docs/ruvector-postgres/tmp.json` | supporting artifact |
| `v3/docs/CLAUDE-FLOW-VS-TEAMMATE-TOOL-COMPARISON.md` | architecture/comparison |
| `v3/docs/adr/README.md` | ADR index/architecture status |
| `v3/docs/ddd/quality-engineering/README.md` | DDD architecture/domain |
| `v3/docs/ddd/quality-engineering/domain-model.md` | DDD domain model |
| `v3/docs/ddd/quality-engineering/integration-points.md` | DDD integration |
| `v3/docs/ddd/coherence-engine/README.md` | DDD architecture/domain |
| `v3/docs/ddd/coherence-engine/domain-model.md` | DDD domain model |
| `v3/docs/ddd/coherence-engine/integration-points.md` | DDD integration |

### 3.2 Doc-to-Code Scope Map

- `README.md`:
  - CLI entrypoint and runtime behavior (`package.json`, `v3/@claude-flow/cli/bin/cli.js`, `v3/@claude-flow/cli/src/index.ts`, `v3/@claude-flow/cli/src/commands/**`)
  - MCP server/client behavior (`v3/@claude-flow/cli/src/mcp-server.ts`, `v3/@claude-flow/cli/src/mcp-client.ts`, `v3/@claude-flow/cli/src/mcp-tools/**`)
  - Provider modules (`v3/@claude-flow/providers/src/**`)
  - CI metadata (`.github/workflows/*.yml`)

- `docs/ruvector-postgres/README.md`:
  - CLI RuVector command group (`v3/@claude-flow/cli/src/commands/ruvector/**`)
  - Local compose/SQL/scripts (`docs/ruvector-postgres/docker-compose.yml`, `docs/ruvector-postgres/scripts/**`, `docs/ruvector-postgres/tests/**`)
  - SQL migration references (`v3/@claude-flow/plugins/src/integrations/ruvector/migrations/*.sql`)

- `v3/docs/CLAUDE-FLOW-VS-TEAMMATE-TOOL-COMPARISON.md`:
  - CLI command families (`v3/@claude-flow/cli/src/commands/index.ts`)
  - teammate package and bridge (`v3/plugins/teammate-plugin/src/**`)

- `v3/docs/adr/README.md`:
  - ADR corpus (`v3/implementation/adrs/*`)
  - Runtime anchors (`v3/@claude-flow/cli/src/commands/**`, `v3/@claude-flow/providers/src/**`, `v3/@claude-flow/plugins/src/**`)

- `v3/docs/ddd/quality-engineering/*`:
  - `v3/plugins/agentic-qe/src/**`
  - `v3/plugins/agentic-qe/__tests__/**`

- `v3/docs/ddd/coherence-engine/*`:
  - `v3/plugins/prime-radiant/src/**`
  - `v3/plugins/prime-radiant/__tests__/**`

## 4. Top Contradictions Found and Resolved

1. Historical numeric overlap claims in teammate comparison were not reproducible from local repository artifacts.
   - Resolution: removed percentages and binary-level assertions; kept evidence-limited comparison only.

2. QE docs previously read as fully implemented bounded contexts, while plugin handlers include explicit scaffold notes.
   - Resolution: downgraded to `Partially Implemented`, added `Known Limitations`, kept design intent as aspirational.

3. Coherence docs previously implied always-on full WASM runtime behavior.
   - Resolution: explicitly documented mock fallback and external WASM dependency boundary.

4. Performance/benchmark style statements lacked local reproducible benchmark backing for this snapshot.
   - Resolution: removed or downgraded those claims to unverified/aspirational.

5. README architecture flow had a potentially over-strong runtime edge to provider internals.
   - Resolution: simplified diagram to only trace command/runtime edges directly supported by CLI flow.

## 5. Strong Adversarial Findings

### 5.1 Closed Findings (resolved in this cycle)

- id: `FND-001`
  - location_in_docs: `v3/docs/CLAUDE-FLOW-VS-TEAMMATE-TOOL-COMPARISON.md`
  - claim_or_diagram_element: historical `% overlap` and reverse-engineering parity statements
  - issue_type: `unverifiable`
  - severity: `high`
  - evidence: no repository-contained reproducible comparison artifacts or binary traces
  - suggested_fix: remove percentages; keep only source-backed structural comparison

- id: `FND-002`
  - location_in_docs: `v3/docs/ddd/quality-engineering/*.md`
  - claim_or_diagram_element: implied full implemented domain behavior
  - issue_type: `contradiction`
  - severity: `high`
  - evidence: `v3/plugins/agentic-qe/src/plugin.ts` contains multiple handler notes: "Full implementation requires agentic-qe package"
  - suggested_fix: mark as partially implemented + preserve design intent as aspirational

- id: `FND-003`
  - location_in_docs: `v3/docs/ddd/coherence-engine/*.md`
  - claim_or_diagram_element: implied guaranteed full WASM runtime path
  - issue_type: `ambiguity`
  - severity: `medium`
  - evidence: `v3/plugins/prime-radiant/src/plugin.ts` falls back to mock behavior when WASM module is unavailable
  - suggested_fix: document fallback and runtime dependency boundary explicitly

- id: `FND-004`
  - location_in_docs: `README.md`
  - claim_or_diagram_element: over-strong provider runtime edge in architecture diagram
  - issue_type: `ambiguity`
  - severity: `medium`
  - evidence: CLI providers command surface is not a direct runtime proof of manager invocation in that flow
  - suggested_fix: simplify diagram to direct command/runtime flow only

### 5.2 Open Findings (after reconciliation)

```yaml
[]
```

### 5.3 Automated Adversarial Checks

- Evidence-pointer validation: `113` references checked, `0` invalid.
- Mermaid render validation with `@mermaid-js/mermaid-cli`: `2/2` diagrams compiled.
- Contradiction gate after reconciliation: no open contradictions.

## 6. Diagram Update List

- `DGM-001` from `README.md`: architecture flowchart simplified to code-traceable runtime path.
- `DGM-002` from `README.md`: `claude-flow mcp start` sequence retained and validated against CLI command flow.
- Render status: PASS (`diagram-001.svg`, `diagram-002.svg` generated during adversarial run).

## 7. Terminology Glossary (Canonical)

- **CLI**: command-line interface implementation in `v3/@claude-flow/cli`.
- **MCP**: Model Context Protocol command and stdio/server interfaces in the CLI package.
- **RuVector**: vector extension workflow represented by CLI `ruvector` commands and `docs/ruvector-postgres` assets.
- **Provider module**: implementation package under `v3/@claude-flow/providers/src/*`.
- **Provider command**: CLI surface `claude-flow providers ...` under `v3/@claude-flow/cli/src/commands/providers.ts`.
- **Plugin**: package under `v3/plugins/*` loaded via plugin contracts/interfaces.
- **Partially Implemented**: contracts/surfaces exist; some runtime behavior is scaffolded.
- **Aspirational**: design intent not fully present as executable behavior in this snapshot.

## 8. Remaining Unknowns

1. Dist artifact dependency:
   - `v3/@claude-flow/cli/bin/*.js` imports from `../dist/src/*`, which is not committed by default.
   - Impact: running bin scripts requires local build first.

2. External runtime parity for teammate comparison:
   - Repository does not include authoritative external runtime outputs.
   - Impact: parity/performance claims remain intentionally out of scope.

3. Prime-radiant full WASM path:
   - Runtime behavior varies by external module availability.
   - Impact: advanced mathematical claims remain constrained.

## 9. Confidence Statement

Confidence: `High` for code/config-path claims and command surface claims.
Confidence: `Medium` for environment-dependent runtime behavior (WASM availability, external comparisons).

The current docs intentionally prefer fewer, verifiable claims over broader speculative descriptions.

## 10. Quality Gates

| Gate | Result |
|---|---|
| No critical findings remain | PASS |
| No open contradictions remain | PASS |
| All Mermaid diagrams render | PASS |
| README claims are subset of canonical facts | PASS |
| Getting started steps map to existing files/scripts/commands | PASS |
| Terminology consistency across README + docs + v3/docs | PASS |

