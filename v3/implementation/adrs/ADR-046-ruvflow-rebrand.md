# ADR-046: Dual Umbrella Packages — claude-flow + ruvflow

**Status:** Accepted
**Date:** 2026-02-07
**Updated:** 2026-02-08
**Authors:** RuvNet, Claude Flow Team

## Context

The umbrella package is published to npm as `claude-flow`. As the ecosystem grows and the product establishes its own identity, a second umbrella package `ruvflow` is introduced alongside the original.

### Current State

| Aspect | Current Value |
|--------|---------------|
| npm package | `claude-flow` |
| CLI binary | `claude-flow` |
| GitHub repo | ruvnet/claude-flow |
| Internal packages | @claude-flow/* |
| Weekly downloads | ~1,000+ |

### Drivers for Change

1. **Brand Cohesion**: Aligns with the ruv ecosystem (ruv.io, @ruvector/*, ruv-swarm)
2. **Trademark Safety**: Removes potential trademark concerns with "Claude" in product name
3. **Product Identity**: Establishes independent product identity beyond Claude integration
4. **Discoverability**: "ruvflow" is unique, memorable, and searchable
5. **Future Flexibility**: Enables the platform to support multiple AI backends without name confusion
6. **Zero Disruption**: Keeping `claude-flow` ensures no existing users are broken

## Decision

Publish **two independent npm umbrella packages** — `claude-flow` (original) and `ruvflow` (new) — both backed by `@claude-flow/cli`.

### Package Architecture

```
npm registry
├── claude-flow          ← original umbrella (bundles @claude-flow/cli)
│   └── bin: claude-flow → v3/@claude-flow/cli/bin/cli.js
├── ruvflow              ← new umbrella (depends on @claude-flow/cli)
│   └── bin: ruvflow     → @claude-flow/cli/bin/cli.js
└── @claude-flow/cli     ← shared CLI implementation
```

### What Changes

| Aspect | Before | After |
|--------|--------|-------|
| npm packages | `claude-flow` only | `claude-flow` + `ruvflow` |
| CLI binaries | `claude-flow` | `claude-flow` + `ruvflow` |
| Install commands | `npx claude-flow@latest` | Both `npx claude-flow@latest` and `npx ruvflow@latest` |
| README branding | "Claude-Flow" | "RuvFlow" (primary), "claude-flow" (supported) |
| Product name | Claude-Flow | RuvFlow (with claude-flow alias) |

### What Stays the Same

| Aspect | Value | Reason |
|--------|-------|--------|
| GitHub repo | ruvnet/claude-flow | SEO, existing links, history |
| Internal packages | @claude-flow/* | Minimal disruption, existing integrations |
| Functionality | All features | No functional changes |
| License | MIT | No change |
| Author | RuvNet | No change |
| `claude-flow` npm package | Fully supported | No breaking changes for existing users |

## Consequences

### Positive

1. **Zero Disruption**: Existing `claude-flow` users unaffected
2. **Unified Brand**: New `ruvflow` package for the ruv ecosystem
3. **Trademark Safety**: Users can choose the non-"Claude" branded package
4. **Dual Discovery**: Package discoverable under both names on npm
5. **Future Proof**: Can add non-Claude integrations without name confusion

### Negative

1. **Two packages to maintain**: Must publish and tag both packages
2. **Documentation**: Must reference both package names
3. **Download split**: npm download stats split across two packages

### Neutral

1. **GitHub repo unchanged**: Existing links continue to work
2. **Internal packages unchanged**: No code changes required in @claude-flow/*

## Implementation

### Package Structure

```
/workspaces/claude-flow/
├── package.json            # name: "claude-flow" (original umbrella)
│                           # bin: claude-flow → v3/@claude-flow/cli/bin/cli.js
│                           # bundles CLI files directly
└── ruvflow/
    ├── package.json        # name: "ruvflow" (new umbrella)
    │                       # bin: ruvflow → ./bin/ruvflow.js
    │                       # depends on @claude-flow/cli
    ├── bin/
    │   └── ruvflow.js      # thin wrapper, imports @claude-flow/cli
    └── README.md           # RuvFlow-branded docs
```

### Phase 1: Preparation (This PR)

1. Create ADR-046 (this document)
2. Keep root `package.json` as `claude-flow` (original umbrella)
3. Create `ruvflow/` directory with new umbrella package
4. Update main README.md with RuvFlow branding
5. Update install scripts to reference `ruvflow`

### Phase 2: Publishing

```bash
# 1. Publish @claude-flow/cli (shared implementation)
cd v3/@claude-flow/cli
npm publish --tag alpha

# 2. Publish claude-flow umbrella (original)
cd /workspaces/claude-flow
npm publish --tag v3alpha
npm dist-tag add claude-flow@<version> latest
npm dist-tag add claude-flow@<version> alpha

# 3. Publish ruvflow umbrella (new)
cd /workspaces/claude-flow/ruvflow
npm publish --tag alpha
npm dist-tag add ruvflow@<version> latest
```

### Phase 3: Ongoing

1. Both packages maintained indefinitely
2. Version numbers kept in sync
3. README shows both install options
4. `ruvflow` promoted as primary in new documentation

## Publishing Checklist

When publishing updates, **all three packages** must be published:

| Order | Package | Command | Tags |
|-------|---------|---------|------|
| 1 | `@claude-flow/cli` | `npm publish --tag alpha` | alpha, latest |
| 2 | `claude-flow` | `npm publish --tag v3alpha` | v3alpha, alpha, latest |
| 3 | `ruvflow` | `npm publish --tag alpha` | alpha, latest |

## Alternatives Considered

### 1. Replace claude-flow with ruvflow (single package)

**Pros:** Simpler, one package to maintain
**Cons:** Breaks existing users, loses download history
**Decision:** Rejected - zero disruption preferred

### 2. Rename to ruv-flow (hyphenated)

**Pros:** Matches ruv-swarm pattern
**Cons:** Inconsistent with @ruvector (no hyphen)
**Decision:** Rejected - "ruvflow" is cleaner and matches ruvector pattern

### 3. Rename internal packages too (@ruvflow/*)

**Pros:** Complete rebrand
**Cons:** Major breaking change, complex migration, npm scope registration
**Decision:** Rejected - disruption not worth the benefit

### 4. Deprecate claude-flow

**Pros:** Forces migration to ruvflow
**Cons:** Breaks existing users, bad developer experience
**Decision:** Rejected - both packages coexist permanently

## Migration Guide

### For New Users

```bash
# Recommended
npx ruvflow@latest init --wizard

# Also works
npx claude-flow@latest init --wizard
```

### For Existing Users

No migration required. `claude-flow` continues to work. Optionally switch:

```bash
# Switch MCP server (optional)
claude mcp remove claude-flow
claude mcp add ruvflow npx ruvflow@latest mcp start
```

### For Contributors

1. Root `package.json` is the `claude-flow` umbrella
2. `ruvflow/package.json` is the `ruvflow` umbrella
3. Internal imports remain `@claude-flow/*`
4. GitHub repo remains `ruvnet/claude-flow`

## Metrics for Success

| Metric | Target | Measurement |
|--------|--------|-------------|
| Combined npm downloads | Maintain or grow | npm weekly stats (both packages) |
| GitHub stars | Maintain or grow | GitHub metrics |
| Issues from confusion | < 10 in 30 days | GitHub issues |
| ruvflow adoption | 50%+ new installs in 90 days | npm stats |

## References

- GitHub Issue: #1101
- npm: https://npmjs.com/package/ruvflow
- npm: https://npmjs.com/package/claude-flow
- Related: ADR-017 (RuVector Integration)

## Appendix: Branding Guidelines

### Product Names

| Context | Use |
|---------|-----|
| npm packages | `ruvflow` and `claude-flow` (both lowercase) |
| README title | "RuvFlow" (PascalCase) |
| CLI binaries | `ruvflow` or `claude-flow` (both lowercase) |
| In prose | "RuvFlow" (PascalCase) |

### Command Examples

```bash
# New recommended style
npx ruvflow@latest init
npx ruvflow@latest agent spawn -t coder
npx ruvflow@latest swarm init --topology hierarchical

# Legacy style (still fully supported)
npx claude-flow@latest init
npx claude-flow@latest agent spawn -t coder
```

---

**Decision Date:** 2026-02-07
**Updated:** 2026-02-08
**Review Date:** 2026-03-07 (30 days post-implementation)
