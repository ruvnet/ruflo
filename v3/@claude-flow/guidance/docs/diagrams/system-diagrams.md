# System Diagrams

Mermaid diagrams for the Guidance Control Plane. Render with any Mermaid-compatible viewer (GitHub, VS Code, etc.).

## 1. Full System Overview

```mermaid
graph TB
    CLAUDE["CLAUDE.md + CLAUDE.local.md"]

    subgraph "Compile Time"
        C[GuidanceCompiler]
        CLAUDE --> C
        C --> CONST[Constitution]
        C --> SHARDS[Rule Shards]
        C --> MAN[Manifest]
    end

    subgraph "Runtime — Per Task"
        RET[ShardRetriever]
        SHARDS --> RET
        RET --> REL[Relevant Shards]

        subgraph "Enforcement Pipeline"
            GW[ToolGateway]
            GATES[EnforcementGates]
            MEMG[MemoryWriteGate]
            GW --> GATES
            GW --> MEMG
        end

        subgraph "Step Control"
            CG[ContinueGate]
            COH[CoherenceScheduler]
            ECON[EconomicGovernor]
            COH --> CG
            ECON --> CG
        end

        subgraph "Audit"
            PROOF[ProofChain]
            LED[RunLedger]
        end
    end

    subgraph "Evolution — Periodic"
        OPT[OptimizerLoop]
        LED --> OPT
        OPT --> CLAUDE
    end

    subgraph "WASM Kernel"
        WK["Rust WASM (SHA-256, scanning, scoring)"]
        PROOF -.-> WK
        GATES -.-> WK
    end
```

## 2. Enforcement Pipeline Detail

```mermaid
flowchart LR
    TC[Tool Call] --> ID{Idempotency\nCache?}
    ID -->|Hit| CR[Cached Result]
    ID -->|Miss| SV{Schema\nValid?}
    SV -->|No| DENY1[Deny: Invalid Schema]
    SV -->|Yes| BUD{Budget\nAvailable?}
    BUD -->|No| DENY2[Deny: Budget Exceeded]
    BUD -->|Yes| G1{Destructive\nOps Gate}
    G1 -->|Match| DENY3[Deny: Destructive]
    G1 -->|Pass| G2{Secrets\nGate}
    G2 -->|Match| WARN1[Warn: Secrets Found]
    G2 -->|Pass| G3{Diff Size\nGate}
    G3 -->|Over| WARN2[Warn: Large Diff]
    G3 -->|Under| G4{Tool\nAllowlist}
    G4 -->|Blocked| DENY4[Deny: Not Allowed]
    G4 -->|Pass| ALLOW[Allow]
```

## 3. ContinueGate Decision Tree

```mermaid
flowchart TD
    START[Evaluate Step] --> CRIT{Coherence < 0.4\nor Budget = 0?}
    CRIT -->|Yes| STOP[STOP]
    CRIT -->|No| COOL{In Cooldown?}
    COOL -->|Yes| CONT[CONTINUE]
    COOL -->|No| HARD{Steps >= Max?}
    HARD -->|Yes| STOP2[STOP]
    HARD -->|No| SLOPE{Budget Slope\n> Threshold?}
    SLOPE -->|Yes| PAUSE[PAUSE]
    SLOPE -->|No| UNC{Uncertainty\n> 0.8?}
    UNC -->|Yes| PAUSE2[PAUSE]
    UNC -->|No| RW{Rework Ratio\n> 0.3?}
    RW -->|Yes| THROTTLE[THROTTLE]
    RW -->|No| CKP{Step % 25\n== 0?}
    CKP -->|Yes| CHECKPOINT[CHECKPOINT]
    CKP -->|No| CONT2[CONTINUE]
```

## 4. Trust Accumulation

```mermaid
graph LR
    subgraph "Gate Outcomes"
        A[Allow +0.01]
        D[Deny -0.05]
        W[Warn -0.02]
    end

    subgraph "Trust Score 0.0 — 1.0"
        UT[Untrusted\n< 0.3]
        PR[Probation\n0.3-0.5]
        ST[Standard\n0.5-0.8]
        TR[Trusted\n> 0.8]
    end

    A --> ST
    D --> PR
    W --> ST

    UT -->|"Many allows"| PR
    PR -->|"Continued success"| ST
    ST -->|"Long track record"| TR
    TR -->|"Deny"| ST
    ST -->|"Multiple denies"| PR
    PR -->|"Continued denies"| UT
```

## 5. Capability Delegation Chain

```mermaid
graph TD
    SYS[System Root] -->|"grant(file, /**, rw)"| COORD[Coordinator]
    COORD -->|"delegate(file, /src/**, rw)"| COD[Coder]
    COORD -->|"delegate(file, /tests/**, r)"| TEST[Tester]
    COD -->|"delegate(file, /src/auth/**, r)"| REV[Reviewer]

    COD -->|"attenuate: remove write"| COD_RO[Coder: read-only mode]

    style SYS fill:#f96
    style COORD fill:#69f
    style COD fill:#6f9
    style TEST fill:#6f9
    style REV fill:#9f6
```

## 6. Memory Security Layers

```mermaid
flowchart TB
    AGENT[Agent Write Request]
    AGENT --> TD[ThreatDetector\nScan for injection/poisoning]
    TD -->|Threat| BLOCK1[Block]
    TD -->|Clean| TRUST[TrustSystem\nCheck tier]
    TRUST -->|Untrusted| BLOCK2[Block]
    TRUST -->|OK| MWG[MemoryWriteGate\nCheck namespace + rate]
    MWG -->|Denied| BLOCK3[Block]
    MWG -->|Allowed| CRIT{Critical\nNamespace?}
    CRIT -->|Yes| MQ[MemoryQuorum\nRequire votes]
    MQ -->|Rejected| BLOCK4[Block]
    MQ -->|Accepted| WRITE[Write to Memory]
    CRIT -->|No| WRITE
    WRITE --> CD[CollusionDetector\nLog interaction]
    WRITE --> PROOF[ProofChain\nRecord hash]
```

## 7. Knowledge Management Stack

```mermaid
graph TB
    subgraph "External Facts"
        TA[TruthAnchors\nImmutable, signed]
    end

    subgraph "Temporal Knowledge"
        TS[TemporalStore\nBitemporal assertions]
    end

    subgraph "Probabilistic Beliefs"
        UL[UncertaintyLedger\nConfidence intervals]
    end

    subgraph "Resolution"
        TR[TruthResolver]
        TEMP[TemporalReasoner]
        UA[UncertaintyAggregator]
    end

    TA --> TR
    TS --> TEMP
    UL --> UA

    TR -->|"Anchor wins"| DECISION[Final Decision]
    TEMP -->|"Time-valid"| DECISION
    UA -->|"Confidence-weighted"| DECISION
```

## 8. Proof Chain Structure

```mermaid
graph LR
    G["Genesis\nprev: 000...000"] --> E1["Envelope 1\nprev: hash(G)"]
    E1 --> E2["Envelope 2\nprev: hash(E1)"]
    E2 --> E3["Envelope 3\nprev: hash(E2)"]
    E3 --> EN["Envelope N\nprev: hash(N-1)"]

    subgraph "Each Envelope"
        H[Content Hash]
        TC[Tool Call Hashes]
        ML[Memory Lineage]
        SIG[HMAC Signature]
    end
```

## 9. Meta-Governance Amendment Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Proposed: proposeAmendment()
    Proposed --> Voting: voteOnAmendment()
    Voting --> Voting: more votes
    Voting --> Resolved: resolveAmendment()
    Resolved --> Enacted: supermajority reached
    Resolved --> Rejected: below threshold
    Enacted --> [*]
    Rejected --> [*]

    note right of Voting
        Requires supermajority
        Rate-limited
        Emergency veto available
    end note
```

## 10. Compile → Retrieve → Gate Lifecycle

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CP as ControlPlane
    participant Comp as Compiler
    participant Ret as Retriever
    participant G as Gates
    participant Led as Ledger
    participant Opt as Optimizer

    Dev->>CP: initialize()
    CP->>Comp: compile(CLAUDE.md)
    Comp-->>CP: PolicyBundle
    CP->>Ret: loadBundle(bundle)
    CP->>G: setActiveRules(rules)

    loop Per Agent Task
        Dev->>CP: retrieveForTask(description)
        CP->>Ret: retrieve(request)
        Ret-->>Dev: constitution + shards

        Dev->>CP: evaluateCommand(cmd)
        CP->>G: evaluateCommand(cmd)
        G-->>Dev: allow/deny/warn

        Dev->>CP: startRun()
        Note over Dev: agent works...
        Dev->>CP: finalizeRun()
        CP->>Led: evaluate(event)
    end

    Note over Opt: Weekly
    CP->>Opt: runCycle(ledger, bundle)
    Opt-->>CP: promoted[], demoted[], ADRs[]
```
