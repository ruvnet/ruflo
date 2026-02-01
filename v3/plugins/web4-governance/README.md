# @claude-flow/governance

Trust-based governance for claude-flow, powered by [Web4](https://github.com/dp-web4/web4) trust primitives.

## Overview

This plugin integrates Web4's trust and governance model with claude-flow's multi-agent orchestration:

- **T3 Trust Tensors**: 6-dimensional trust measurement (reliability, competence, integrity, benevolence, transparency, responsiveness)
- **Policy Entities**: Immutable, hash-tracked policies that are first-class participants in the trust network
- **Witnessing Chains**: Bidirectional trust attestation between entities
- **R6 Audit Chain**: Complete action logging with hash-linked integrity

## Integration

Designed to complement (not replace) claude-flow's existing systems:

| claude-flow System | Governance Integration |
|-------------------|------------------------|
| **Claims** | Trust-weighted authorization decisions |
| **AIDefence** | Trust-informed threat assessment |
| **Official Hooks Bridge** | Policy enforcement at tool boundaries |
| **ReasoningBank** | Trust patterns in learned decisions |

## Installation

```bash
npm install @claude-flow/governance
```

## Quick Start

```typescript
import { createGovernance } from '@claude-flow/governance';

// Create governance with a preset
const governance = createGovernance({
  policy: 'standard',  // or 'permissive', 'strict', or custom PolicyConfig
  sessionId: 'session-123',
  enableAudit: true,
});

// In pre-tool-use hook:
const output = await governance.preToolUse({
  sessionId: 'session-123',
  toolName: 'Bash',
  toolInput: { command: 'npm install' },
  target: 'npm install',
});

if (output.decision === 'deny') {
  return { decision: 'block', reason: output.reason };
}

// In post-tool-use hook:
await governance.postToolUse(context, success, result);
```

## Presets

Three built-in presets for common use cases:

### Permissive

Best for: Development, exploration, high-trust environments

- Trust-based, minimal restrictions
- Only blocks explicitly dangerous patterns (secrets, credentials)
- Focuses on audit logging over prevention

```typescript
createGovernance({ policy: 'permissive', sessionId });
```

### Standard (Recommended)

Best for: Production, team environments, balanced security

- Requires minimum trust for sensitive operations
- Rate limits on high-impact actions
- Asks user for risky but not blocked actions

```typescript
createGovernance({ policy: 'standard', sessionId });
```

### Strict

Best for: Compliance, high-security environments

- Deny by default
- Explicit allowlists required
- High trust requirements for all operations

```typescript
createGovernance({ policy: 'strict', sessionId });
```

## Custom Policies

```typescript
import { createGovernance, extendPreset } from '@claude-flow/governance';

// Extend a preset with custom rules
const policy = extendPreset('standard', {
  name: 'my-policy',
}, [
  {
    id: 'allow-my-tool',
    name: 'Allow my custom tool',
    priority: 40,
    match: { tools: ['MyCustomTool'] },
    decision: 'allow',
  },
]);

const governance = createGovernance({ policy, sessionId });
```

## Trust Management

Trust evolves based on outcomes:

```typescript
// Get entity trust
const toolTrust = governance.getEntityTrust('tool:Bash');
console.log(toolTrust?.level); // 'medium', 'high', etc.

// Get trust statistics
const stats = governance.getTrustStore().getStats();
console.log(stats.averageTrust);
```

## Audit Chain

When enabled, all actions are logged with hash-linked integrity:

```typescript
const governance = createGovernance({
  policy: 'standard',
  sessionId,
  enableAudit: true,
});

// After some operations...
const audit = governance.getAuditChain();
console.log(audit?.sequenceNumber); // Number of logged actions
console.log(audit?.latestHash);     // Hash of latest entry
```

## WASM Acceleration

For maximum performance, a Rust WASM module provides:
- Policy evaluation: <0.1ms
- Trust updates: <0.05ms
- Witness chain queries: <0.5ms
- Audit log appends: <0.02ms

```typescript
import { loadGovernanceWasm, isWasmAvailable } from '@claude-flow/governance/wasm';

// Load WASM (optional - falls back to pure TS)
await loadGovernanceWasm();

if (isWasmAvailable()) {
  console.log('Using WASM acceleration');
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Official Hooks Bridge (PreToolUse)              │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  @claude-flow/governance                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Policy    │  │    Trust    │  │    Audit Chain      │  │
│  │   Entity    │  │    Store    │  │    (R6 Format)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│               Decision: allow / deny / ask                   │
└─────────────────────────────────────────────────────────────┘
```

## Web4 Concepts

This plugin implements core Web4 primitives:

- **T3 Trust Tensor**: Multi-dimensional trust measurement
- **V3 Value Tensor**: Value assessment (future)
- **LCT (Linked Context Token)**: Entity identity (via entityId)
- **MRH (Markov Relevancy Horizon)**: Context boundaries (via witnessing chains)
- **R6 Framework**: Rules/Role/Request/Reference/Resource/Result

See [Web4 Documentation](https://github.com/dp-web4/web4) for more details.

## License

MIT
