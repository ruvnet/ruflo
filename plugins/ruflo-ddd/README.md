# ruflo-ddd

Domain-Driven Design scaffolding -- bounded contexts, aggregate roots, domain events, and anti-corruption layers.

## Overview

Transforms business domains into well-structured bounded contexts with aggregate roots, value objects, domain events, repositories, and anti-corruption layers. Stores the domain model as a navigable graph in AgentDB with hierarchical nodes and causal edges for context dependencies.

## Installation

```bash
claude --plugin-dir plugins/ruflo-ddd
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `domain-modeler` | sonnet | Map domains to bounded contexts, design aggregates with invariants, define domain events, generate ACL interfaces |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `ddd-context` | `/ddd-context <context-name>` | Create a bounded context with standard directory structure |
| `ddd-aggregate` | `/ddd-aggregate <context> <aggregate-name>` | Scaffold an aggregate root with entity, value objects, repository, events, and test stubs |
| `ddd-validate` | `/ddd-validate` | Detect cross-context import violations and aggregate invariant issues |

## Commands (6 subcommands)

```bash
# Context management
ddd context create <name>
ddd context list

# Aggregate scaffolding
ddd aggregate <context> <name>
ddd event <context> <name>

# Validation & visualization
ddd validate                 # Check domain boundary violations
ddd map                      # Visualize context map with relationships
```

## Directory Structure per Context

```
src/<context-name>/
  domain/
    entities/           # Entities and aggregate root
    value-objects/       # Immutable value objects
    events/             # Domain events
    services/           # Domain services
    repositories/       # Repository interfaces
  application/          # Use cases / application services
  infrastructure/       # Repository implementations, ACL adapters
  index.ts              # Public API of the context
```

## Context Relationships

Detected via import analysis: upstream/downstream, ACL, shared kernel, published language. Boundary violations (direct cross-context imports) are flagged by `ddd validate`.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-ddd/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns the `ddd-patterns` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

`ddd-patterns` stores reusable bounded-context shapes, aggregate templates, and event vocabularies for cross-project reuse. Accessed via `memory_*` tools (namespace-routed).

## Verification

```bash
bash plugins/ruflo-ddd/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-ddd plugin contract](./docs/adrs/0001-ddd-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; backing store for the domain graph
- `ruflo-adr` -- Document domain decisions as Architecture Decision Records
- `ruflo-sparc` -- Architecture phase leverages DDD bounded context patterns
- `ruflo-migrations` -- Align migration boundaries with aggregate roots

## License

MIT

## As a mod

Since this version the plugin is also a function-hook mod (ADR-445 pattern; needs Claude Code 2.1.287 or later). It never calls the network or spawns a process, and it only tightens: it can refuse a call, never allow one.

- **Guard** (default on): refuses domain-model memory writes (`ddd-*` keys and `context:`/`aggregate:` hierarchy edges) that hold a key, token or password. The reason names the kind of secret, never the value.
- **`/ddd-mod`**: answered locally, no model turn: `status`, `scan <text>` (would the guard refuse this?), and `contexts` (folders under `src/`, `src/contexts`, `src/modules` with a `domain/` layer).
- **Status file**: `.claude-flow/ddd-mod/status.json` (`{version, updatedMs, guard, blocked}`), written at session start and when a call is blocked.
- **Option**: `guard` (`on` | `off`, default `on`) in the plugin's `userConfig`.

Test it: `claude plugin test plugins/ruflo-ddd` and `bash plugins/ruflo-ddd/scripts/smoke.sh`.
