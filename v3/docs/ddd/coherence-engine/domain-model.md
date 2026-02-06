# Coherence Engine Domain Model (Truth-Synced)

## Implementation Status

- Status: `Partially Implemented`.
- Canonical model elements in this repository are TypeScript interfaces and plugin APIs.
- Rich mathematical domain behavior remains partially scaffolded.

## Canonical Model Elements (Implemented Contracts)

### 1. Coherence Types

- `CoherenceEnergy`
- `CoherenceResult`

### 2. Spectral Types

- `SpectralGap`
- `SpectralResult`

### 3. Causal Types

- `CausalGraph`
- `CausalResult`

### 4. Topology Types

- `BettiNumbers`
- `TopologyResult`
- `PersistenceDiagram`

### 5. Bridge Interface

- `IPrimeRadiantBridge` defines coherence, spectral, causal, topology, morphism, and HoTT operations.

### 6. Coherence Gate

- `CoherenceGate` provides action-based validation (`allow`, `warn`, `reject`) with configurable thresholds.

## Runtime Mapping

| Concept | Source Artifact |
|---|---|
| Domain contracts | `v3/plugins/prime-radiant/src/types.ts` |
| Engine interfaces | `v3/plugins/prime-radiant/src/interfaces.ts` |
| Bridge and gate implementation | `v3/plugins/prime-radiant/src/plugin.ts` |

## Evidence

- Coherence and spectral contract types: `v3/plugins/prime-radiant/src/types.ts:17`, `v3/plugins/prime-radiant/src/types.ts:107`
- Causal and topology contract types: `v3/plugins/prime-radiant/src/types.ts:130`, `v3/plugins/prime-radiant/src/types.ts:179`
- Bridge interface methods: `v3/plugins/prime-radiant/src/interfaces.ts:41`, `v3/plugins/prime-radiant/src/interfaces.ts:91`
- Coherence gate thresholds and actions: `v3/plugins/prime-radiant/src/plugin.ts:442`, `v3/plugins/prime-radiant/src/plugin.ts:467`
- Batch validation behavior: `v3/plugins/prime-radiant/src/plugin.ts:483`, `v3/plugins/prime-radiant/src/plugin.ts:496`

## Known Limitations

- Some advanced mathematical claims are not fully backed by non-scaffold runtime implementations.
- Domain entities in prior docs were stronger than current executable behavior and are now treated as design intent.
