# @claude-flow/plugin-healthcare-clinical

<!-- adr-356:quickstart:start -->
**@claude-flow/plugin-healthcare-clinical** — A Ruflo plugin that gives agents MCP tools for patient similarity search, drug interaction checks, clinical pathways, literature search and medical ontology navigation.

**Supported environments:** Node.js 20+ · ESM

## Quickstart

```bash
npm install @claude-flow/plugin-healthcare-clinical
```

```js
import { healthcareTools, PatientSimilarityInputSchema } from '@claude-flow/plugin-healthcare-clinical';

console.log('tools:', healthcareTools.map((t) => t.name).join(', '));
const check = PatientSimilarityInputSchema.safeParse({ patientFeatures: { diagnoses: ['E11.9', 'I10'] } });
console.log('valid input:', check.success);
```

Expected output:

```text
tools: healthcare/patient-similarity, healthcare/drug-interactions, healthcare/clinical-pathways, healthcare/literature-search, healthcare/ontology-navigate
valid input: true
```

Install it into a Ruflo project with [`@claude-flow/cli`](https://www.npmjs.com/package/@claude-flow/cli): `npx @claude-flow/cli@latest plugins install -n @claude-flow/plugin-healthcare-clinical`.
<!-- adr-356:quickstart:end -->

[![npm version](https://img.shields.io/npm/v/@claude-flow/plugin-healthcare-clinical.svg)](https://www.npmjs.com/package/@claude-flow/plugin-healthcare-clinical)
[![npm downloads](https://img.shields.io/npm/dm/@claude-flow/plugin-healthcare-clinical.svg)](https://www.npmjs.com/package/@claude-flow/plugin-healthcare-clinical)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A HIPAA-compliant clinical decision support plugin that combines ultra-fast vector search for medical literature retrieval with graph neural networks for patient pathway analysis. The plugin enables semantic search across medical records, drug interaction detection, and evidence-based treatment recommendations while maintaining strict data privacy through on-device WASM processing.

## Features

- **Patient Similarity Search**: Find similar patient cases based on clinical features (diagnoses, labs, vitals, medications)
- **Drug Interaction Detection**: Analyze drug-drug and drug-condition interactions using graph neural networks
- **Clinical Pathway Recommendations**: Suggest evidence-based clinical pathways based on diagnosis and patient history
- **Medical Literature Search**: Semantic search across medical literature (PubMed, Cochrane, UpToDate)
- **Ontology Navigation**: Navigate ICD-10, SNOMED-CT, LOINC, and RxNorm hierarchies using hyperbolic embeddings

## Installation

### npm

```bash
npm install @claude-flow/plugin-healthcare-clinical
```

### CLI

```bash
npx claude-flow plugins install --name @claude-flow/plugin-healthcare-clinical
```

## Quick Start

```typescript
import { HealthcareClinicalPlugin } from '@claude-flow/plugin-healthcare-clinical';

// Initialize the plugin
const healthcare = new HealthcareClinicalPlugin({
  ontologyPath: './data/ontologies',
  indexPath: './data/patient-index',
  hipaaCompliance: true
});

// Find similar patients
const similarPatients = await healthcare.patientSimilarity({
  patientFeatures: {
    diagnoses: ['E11.9', 'I10'],  // ICD-10 codes
    labResults: { HbA1c: 7.5, eGFR: 65 },
    medications: ['metformin', 'lisinopril']
  },
  topK: 5
});

// Check drug interactions
const interactions = await healthcare.drugInteractions({
  medications: ['warfarin', 'aspirin', 'ibuprofen'],
  severity: 'major'
});

// Search medical literature
const literature = await healthcare.literatureSearch({
  query: 'diabetes management in elderly patients',
  sources: ['pubmed', 'cochrane'],
  evidenceLevel: 'systematic-review'
});
```

## MCP Tools

### 1. `healthcare/patient-similarity`

Find similar patient cases for treatment guidance.

```typescript
// Example usage via MCP
const result = await mcp.invoke('healthcare/patient-similarity', {
  patientFeatures: {
    diagnoses: ['J45.20', 'J30.9'],
    labResults: { FEV1: 72, eosinophils: 450 },
    vitals: { peakFlow: 380 },
    medications: ['budesonide', 'albuterol']
  },
  topK: 5,
  cohortFilter: 'adult-asthma'
});
```

### 2. `healthcare/drug-interactions`

Detect potential drug-drug and drug-condition interactions.

```typescript
const result = await mcp.invoke('healthcare/drug-interactions', {
  medications: ['clopidogrel', 'omeprazole', 'atorvastatin'],
  conditions: ['CKD-stage-3'],
  severity: 'all'
});
```

### 3. `healthcare/clinical-pathways`

Recommend evidence-based clinical pathways.

```typescript
const result = await mcp.invoke('healthcare/clinical-pathways', {
  primaryDiagnosis: 'I21.0',  // STEMI
  patientHistory: {
    age: 68,
    comorbidities: ['E11.9', 'I10']
  },
  constraints: {
    excludeMedications: ['aspirin'],  // Allergy
    outpatientOnly: false
  }
});
```

### 4. `healthcare/literature-search`

Semantic search across medical literature.

```typescript
const result = await mcp.invoke('healthcare/literature-search', {
  query: 'SGLT2 inhibitors cardiovascular outcomes',
  sources: ['pubmed', 'cochrane'],
  dateRange: { from: '2020-01-01', to: '2024-12-31' },
  evidenceLevel: 'rct'
});
```

### 5. `healthcare/ontology-navigate`

Navigate medical ontology hierarchies.

```typescript
const result = await mcp.invoke('healthcare/ontology-navigate', {
  code: 'E11',
  ontology: 'icd10',
  direction: 'descendants',
  depth: 2
});
```

## Configuration Options

```typescript
interface HealthcarePluginConfig {
  // Data paths
  ontologyPath: string;           // Path to ontology files
  indexPath: string;              // Path to HNSW index storage

  // HIPAA compliance
  hipaaCompliance: boolean;       // Enable HIPAA-compliant mode (default: true)
  auditLogPath: string;           // Path for audit logs
  encryptionKey?: string;         // AES-256 encryption key

  // Performance
  maxMemoryMB: number;            // WASM memory limit (default: 512)
  cacheSize: number;              // Embedding cache size (default: 10000)

  // Ontologies
  enabledOntologies: string[];    // ['icd10', 'snomed', 'loinc', 'rxnorm']

  // Access control
  roleBasedAccess: boolean;       // Enable RBAC (default: true)
}
```

## Security Considerations

### HIPAA Compliance

This plugin is designed with HIPAA compliance as a core requirement:

| Requirement | Implementation |
|-------------|----------------|
| **PHI Protection** | All patient data processed exclusively in WASM sandbox |
| **Encryption at Rest** | AES-256 encryption for all stored embeddings and indexes |
| **Encryption in Transit** | TLS 1.3 minimum for any network operations |
| **Access Logging** | Immutable audit logs with tamper detection (HMAC) |
| **Minimum Necessary** | Role-based data filtering at query time |

### On-Device Processing

- All PHI is processed locally via WASM - no cloud transmission
- WASM sandbox prevents network access and file system access
- Memory limited to 512MB to prevent exhaustion attacks
- 30-second CPU timeout per operation

### Role-Based Access Control

```typescript
const roles = {
  PHYSICIAN: ['patient-similarity', 'drug-interactions', 'clinical-pathways', 'literature-search', 'ontology-navigate'],
  NURSE: ['drug-interactions', 'ontology-navigate'],
  PHARMACIST: ['drug-interactions', 'literature-search'],
  RESEARCHER: ['literature-search', 'ontology-navigate'],  // No patient data
  CODER: ['ontology-navigate']  // Billing codes only
};
```

### Audit Logging

All tool invocations are logged with:
- Timestamp (ISO 8601 with timezone)
- User ID and role
- Tool name and action type
- Hashed patient identifiers (not actual PHI)
- Query hash for reproducibility

Audit logs are retained for 6 years per HIPAA requirements.

### Input Validation

All inputs are validated using Zod schemas:
- ICD-10 codes must match format `/^[A-Z]\d{2}(\.\d{1,2})?$/`
- RxNorm CUIs validated for format
- Maximum 100 diagnoses, 50 medications per query
- String lengths capped to prevent injection attacks
- Patient identifiers must be UUIDs or match institutional format

### Rate Limiting

```typescript
const rateLimits = {
  'healthcare/patient-similarity': { requestsPerMinute: 30, maxConcurrent: 3 },
  'healthcare/drug-interactions': { requestsPerMinute: 60, maxConcurrent: 5 },
  'healthcare/clinical-pathways': { requestsPerMinute: 20, maxConcurrent: 2 },
  'healthcare/literature-search': { requestsPerMinute: 30, maxConcurrent: 3 },
  'healthcare/ontology-navigate': { requestsPerMinute: 120, maxConcurrent: 10 }
};
```

## Performance

| Metric | Target |
|--------|--------|
| Patient similarity search | <50ms for 100K records |
| Drug interaction check | <10ms for 20 medications |
| Literature search | <100ms for 1M abstracts |
| Ontology traversal | <5ms per hop |

## Dependencies

- `micro-hnsw-wasm`: Fast similarity search (150x faster than traditional)
- `ruvector-gnn-wasm`: Graph neural networks for pathway analysis
- `ruvector-hyperbolic-hnsw-wasm`: Hierarchical medical ontology embeddings
- `ruvector-sparse-inference-wasm`: Efficient inference on sparse clinical features
- `@medplum/fhirtypes`: FHIR R4 type definitions

## Related Plugins

| Plugin | Description | Use Case |
|--------|-------------|----------|
| [@claude-flow/plugin-legal-contracts](../legal-contracts) | Contract analysis and compliance | Healthcare vendor agreements, BAAs |
| [@claude-flow/plugin-financial-risk](../financial-risk) | Risk analysis and compliance | Healthcare billing fraud detection |
| [@claude-flow/plugin-code-intelligence](../code-intelligence) | Code analysis | EHR integration development |

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

<!-- adr-356:footer:start -->
---

Built by [rUv](https://ruv.io) · [ruv.io](https://ruv.io) · [Source](https://github.com/ruvnet/ruflo/tree/main/v3/plugins/healthcare-clinical)
<!-- adr-356:footer:end -->
