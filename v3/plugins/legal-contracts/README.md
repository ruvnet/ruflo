# @claude-flow/plugin-legal-contracts

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-legal-contracts.svg)](https://www.npmjs.com/package/@claude-flow/plugin-legal-contracts)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-legal-contracts.svg)](https://www.npmjs.com/package/@claude-flow/plugin-legal-contracts)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A comprehensive legal contract analysis plugin combining hyperbolic embeddings for legal ontology navigation with fast vector search for clause similarity. The plugin enables automated clause extraction, risk scoring, obligation tracking, and regulatory compliance checking while maintaining attorney-client privilege through on-device processing.

## Features

- **Clause Extraction**: Extract and classify clauses from contracts (indemnification, liability, termination, etc.)
- **Risk Assessment**: Identify and score contractual risks by category and severity
- **Contract Comparison**: Compare contracts with detailed diff and semantic alignment
- **Obligation Tracking**: Extract obligations, deadlines, and dependencies using DAG analysis
- **Playbook Matching**: Compare contract clauses against negotiation playbook positions

## Installation

### npm

```bash
npm install @claude-flow/plugin-legal-contracts
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-legal-contracts
```

## Quick Start

```typescript
import { LegalContractsPlugin } from '@claude-flow/plugin-legal-contracts';

// Initialize the plugin
const legal = new LegalContractsPlugin({
  indexPath: './data/clause-index',
  playbookPath: './data/playbooks',
  privilegeProtection: true
});

// Extract clauses from a contract
const clauses = await legal.clauseExtract({
  document: contractText,
  clauseTypes: ['indemnification', 'limitation_of_liability', 'termination'],
  jurisdiction: 'US',
  includePositions: true
});

// Assess contract risks
const risks = await legal.riskAssess({
  document: contractText,
  partyRole: 'buyer',
  riskCategories: ['financial', 'legal', 'operational'],
  threshold: 'medium'
});

// Compare two contracts
const comparison = await legal.contractCompare({
  baseDocument: standardContract,
  compareDocument: vendorContract,
  comparisonMode: 'full',
  generateRedline: true
});
```

## MCP Tools

### 1. `legal/clause-extract`

Extract and classify clauses from legal documents.

```typescript
const result = await mcp.invoke('legal/clause-extract', {
  document: contractText,
  clauseTypes: [
    'indemnification',
    'limitation_of_liability',
    'termination',
    'confidentiality',
    'ip_assignment',
    'governing_law'
  ],
  jurisdiction: 'US',
  includePositions: true
});

// Returns:
// {
//   clauses: [
//     {
//       type: 'indemnification',
//       text: 'Vendor shall indemnify and hold harmless...',
//       position: { start: 4523, end: 5012 },
//       confidence: 0.94,
//       subType: 'mutual'
//     },
//     ...
//   ]
// }
```

### 2. `legal/risk-assess`

Identify and score contractual risks.

```typescript
const result = await mcp.invoke('legal/risk-assess', {
  document: contractText,
  partyRole: 'licensee',
  riskCategories: ['financial', 'legal', 'compliance'],
  industryContext: 'software',
  threshold: 'medium'
});

// Returns:
// {
//   overallRiskScore: 0.72,
//   risks: [
//     {
//       category: 'financial',
//       severity: 'high',
//       description: 'Uncapped indemnification obligation',
//       clause: 'Section 8.2',
//       recommendation: 'Negotiate liability cap'
//     },
//     ...
//   ]
// }
```

### 3. `legal/contract-compare`

Compare two contracts with semantic alignment.

```typescript
const result = await mcp.invoke('legal/contract-compare', {
  baseDocument: masterServiceAgreement,
  compareDocument: vendorRedlinedVersion,
  comparisonMode: 'full',
  highlightChanges: true,
  generateRedline: true
});

// Returns:
// {
//   differences: [
//     {
//       section: 'Limitation of Liability',
//       baseText: 'not exceed $1,000,000',
//       compareText: 'not exceed $500,000',
//       changeType: 'modification',
//       significance: 'high',
//       recommendation: 'Reject - reduces protection by 50%'
//     },
//     ...
//   ],
//   redlineDocument: '...'
// }
```

### 4. `legal/obligation-track`

Extract and track obligations, deadlines, and conditions.

```typescript
const result = await mcp.invoke('legal/obligation-track', {
  document: contractText,
  party: 'Vendor',
  timeframe: 'P90D',  // Next 90 days
  obligationTypes: ['payment', 'delivery', 'notification'],
  includeDependencies: true
});

// Returns:
// {
//   obligations: [
//     {
//       id: 'OBL-001',
//       type: 'delivery',
//       description: 'Deliver initial software release',
//       deadline: '2024-03-15',
//       dependsOn: [],
//       triggers: ['OBL-002']
//     },
//     {
//       id: 'OBL-002',
//       type: 'payment',
//       description: 'Payment due upon delivery acceptance',
//       deadline: 'NET-30 from OBL-001',
//       dependsOn: ['OBL-001'],
//       amount: 50000
//     }
//   ]
// }
```

### 5. `legal/playbook-match`

Match clauses against standard playbook positions.

```typescript
const result = await mcp.invoke('legal/playbook-match', {
  document: vendorContract,
  playbook: 'enterprise-saas-v2',
  strictness: 'moderate',
  suggestAlternatives: true,
  prioritizeClauses: ['indemnification', 'limitation_of_liability']
});

// Returns:
// {
//   matchResults: [
//     {
//       clause: 'Indemnification',
//       playbookPosition: 'Mutual indemnification with IP carve-out',
//       documentPosition: 'One-way vendor indemnification only',
//       deviation: 'major',
//       negotiationTip: 'Request mutual indemnification',
//       fallbackPosition: 'Accept one-way with enhanced IP coverage'
//     },
//     ...
//   ]
// }
```

## Configuration Options

```typescript
interface LegalContractsConfig {
  // Data paths
  indexPath: string;              // Path to clause index storage
  playbookPath: string;           // Path to playbook definitions

  // Privacy
  privilegeProtection: boolean;   // Zero-knowledge processing (default: true)
  auditLogPath: string;           // Path for ethics-compliant audit logs

  // Performance
  maxMemoryMB: number;            // WASM memory limit (default: 2048)
  maxCpuTimeSeconds: number;      // Operation timeout (default: 120)

  // Matter isolation
  matterIsolation: boolean;       // Per-matter WASM instances (default: true)

  // Access control
  roleBasedAccess: boolean;       // Enable RBAC (default: true)
  ethicalWalls: boolean;          // Enable conflict checking (default: true)
}
```

## Security Considerations

### Attorney-Client Privilege Protection

This plugin is designed to maintain attorney-client privilege:

| Requirement | Implementation |
|-------------|----------------|
| **Privilege Preservation** | Zero-knowledge processing - no document content transmitted |
| **Work Product Protection** | Analysis results encrypted, attorney-eyes-only by default |
| **Document Isolation** | Each matter processed in isolated WASM instance |
| **Chain of Custody** | Cryptographic proof of document handling |
| **Conflict Detection** | Prevent cross-matter data leakage |

### Matter Isolation

Each legal matter gets its own isolated WASM instance:
- Separate memory regions per matter
- No cross-matter data access possible
- Independent audit trails per matter
- Automatic cleanup on matter close

### Role-Based Access Control

```typescript
const roles = {
  PARTNER: ['clause-extract', 'risk-assess', 'contract-compare', 'obligation-track', 'playbook-match'],
  ASSOCIATE: ['clause-extract', 'risk-assess', 'contract-compare', 'obligation-track'],
  PARALEGAL: ['clause-extract', 'obligation-track'],
  CONTRACT_MANAGER: ['obligation-track', 'playbook-match'],
  CLIENT: []  // No direct tool access - results only via attorney
};
```

### Ethical Walls

```typescript
interface EthicalWall {
  matterId: string;
  blockedUsers: string[];     // Users who cannot access this matter
  reason: string;             // Encrypted conflict reason
  createdBy: string;          // Partner who created wall
  createdAt: string;
}
```

### Audit Logging

All tool invocations are logged with:
- Timestamp (ISO 8601)
- User ID and role at time of access
- Matter ID
- Document hash (not content)
- Operation type

Logs are encrypted at rest, accessible only to ethics/compliance, and retained per jurisdiction requirements (typically 7+ years).

### Input Validation

- Maximum document size: 10MB
- Path traversal prevention on file inputs
- Malicious content detection (macros, scripts)
- Character encoding validation

## Performance

| Metric | Target |
|--------|--------|
| Clause extraction | <2s for 50-page contract |
| Risk assessment | <5s full analysis |
| Contract comparison | <10s for two 100-page contracts |
| Obligation extraction | <3s per contract |
| Playbook matching | <1s per clause |

## Dependencies

- `micro-hnsw-wasm`: Fast semantic search for clause similarity and precedent matching
- `ruvector-hyperbolic-hnsw-wasm`: Legal taxonomy navigation (contract types, clause hierarchies)
- `ruvector-attention-wasm`: Cross-attention for contract comparison (redline analysis)
- `ruvector-dag-wasm`: Contract dependency graphs (obligations, conditions, timelines)
- `pdf-parse`: PDF document parsing
- `mammoth`: DOCX document parsing

## Related Plugins

| Plugin | Description | Use Case |
|--------|-------------|----------|
| [@claude-flow/plugin-financial-risk](../financial-risk) | Financial risk analysis | Financial contract risk assessment |
| [@claude-flow/plugin-healthcare-clinical](../healthcare-clinical) | Clinical decision support | Healthcare BAA and compliance agreements |
| [@claude-flow/plugin-code-intelligence](../code-intelligence) | Code analysis | Software licensing and IP contracts |

## License

MIT License

Copyright (c) 2026 Claude Flow

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
