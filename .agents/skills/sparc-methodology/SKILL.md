---
name: sparc-methodology
description: >
  SPARC development workflow: Specification, Pseudocode, Architecture, Refinement, Completion. A structured approach for complex implementations that ensures thorough planning before coding.
  Use when: new feature implementation, complex implementations, architectural changes, system redesign, integration work, unclear requirements.
  Skip when: simple bug fixes, documentation updates, configuration changes, well-defined small tasks, routine maintenance.
---

# Sparc Methodology Skill

## Purpose
SPARC development workflow: Specification, Pseudocode, Architecture, Refinement, Completion. A structured approach for complex implementations that ensures thorough planning before coding.

## When to Trigger
- new feature implementation
- complex implementations
- architectural changes
- system redesign
- integration work
- unclear requirements

## When to Skip
- simple bug fixes
- documentation updates
- configuration changes
- well-defined small tasks
- routine maintenance

## Commands

### Specification Phase
Define requirements, acceptance criteria, and constraints

```bash
npx @claude-flow/cli hooks route --task "specification: [requirements]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "specification: user authentication with OAuth2, MFA, and session management"
```

### Pseudocode Phase
Write high-level pseudocode for the implementation

```bash
npx @claude-flow/cli hooks route --task "pseudocode: [feature]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "pseudocode: OAuth2 login flow with token refresh"
```

### Architecture Phase
Design system structure, interfaces, and dependencies

```bash
npx @claude-flow/cli hooks route --task "architecture: [design]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "architecture: auth module with service layer, repository, and API endpoints"
```

### Refinement Phase
Iterate on the design based on feedback

```bash
npx @claude-flow/cli hooks route --task "refinement: [feedback]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "refinement: add rate limiting and brute force protection"
```

### Completion Phase
Finalize implementation with tests and documentation

```bash
npx @claude-flow/cli hooks route --task "completion: [final checks]"
```

**Example:**
```bash
npx @claude-flow/cli hooks route --task "completion: verify all tests pass, update API docs, security review"
```

### SPARC Coordinator
Spawn SPARC coordinator agent

```bash
npx @claude-flow/cli agent spawn --type sparc-coord --name sparc-lead
```


## Scripts

| Script | Path | Description |
|--------|------|-------------|
| `sparc-init` | `.agents/scripts/sparc-init.sh` | Initialize SPARC workflow for a new feature |
| `sparc-review` | `.agents/scripts/sparc-review.sh` | Run SPARC phase review checklist |


## References

| Document | Path | Description |
|----------|------|-------------|
| `SPARC Overview` | `docs/sparc.md` | Complete SPARC methodology guide |
| `Phase Templates` | `docs/sparc-templates.md` | Templates for each SPARC phase |

## Best Practices
1. Check memory for existing patterns before starting
2. Use hierarchical topology for coordination
3. Store successful patterns after completion
4. Document any new learnings
