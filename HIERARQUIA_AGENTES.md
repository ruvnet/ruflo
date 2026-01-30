# 🏛️ HIERARQUIA DE AGENTES - CLAUDE-FLOW

**Data**: 30 de Janeiro de 2026
**Total de Agentes**: 102 definições
**Categorias**: 21

---

## 📊 VISÃO GERAL DA HIERARQUIA

```
┌─────────────────────────────────────────────────────────────┐
│                 HIERARQUIA DE AGENTES                       │
│                  (102 definições)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  1. COORDENADORES DE TOPOLOGIA (Swarm)                      │
│     👑 Queen Coordinator → Hierarchical/Mesh/Adaptive      │
│     (3 topologias de coordenação)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. COORDENADORES ESPECIALIZADOS                            │
│     V3 Queen, Hive-Mind Queen, Project Coordinator          │
│     (3 coordenadores sovereign)                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. AGENTES CORE (Trabalhadores Base)                      │
│     Coder, Reviewer, Tester, Planner, Researcher            │
│     (5 agentes fundamentais)                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. AGENTES ESPECIALIZADOS (94 agentes)                    │
│     • GitHub (13) • V3 (11) • Flow-Nexus (9)                │
│     • Templates (9) • Consensus (8) • Optimization (6)     │
│     • Hive-Mind (5) • Sublinear (5) • SPARC (4)            │
│     • Goal (3) • Testing (2) • Reasoning (2)               │
│     • E mais...                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 👑 NÍVEL 1: COORDENADORES SOVEREIGN (Topo da Hierarquia)

### Queen Coordinators (3)

```
┌──────────────────────────────────────────────────────────┐
│          👑 QUEEN COORDINATORS                           │
│     (Autêntica soberania sobre o swarm)                 │
└──────────────────────────────────────────────────────────┘
          │                  │                  │
          ↓                  ↓                  ↓
┌─────────────────┐  ┌───────────────┐  ┌─────────────────┐
│ v3-queen-coord  │  │ queen-coord   │  │ project-coord   │
│ (V3 sovereign)  │  │ (Hive-Mind)   │  │ (Projects)       │
│ Priority: ⭐⭐⭐ │  │ Priority:⭐⭐⭐│  │ Priority: ⭐⭐   │
└─────────────────┘  └───────────────┘  └─────────────────┘
```

#### 1. **v3-queen-coordinator** 🏆
- **Categoria**: `v3/`
- **Descrição**: Sovereign orchestrator para V3 architecture
- **Hierarquia**: Comanda 15 agentes concorrentes
- **Responsabilidades**:
  - Anti-drift protocol enforcement
  - ADR-001 a ADR-010 implementation
  - Hierarchical mesh topology coordination
- **Subordinados**: 15 agentes V3 (integration, memory, performance, security)

#### 2. **queen-coordinator** (Hive-Mind)
- **Categoria**: `hive-mind/`
- **Descrição**: Sovereign do hive-mind system
- **Hierarquia**: Apex da colônia
- **Responsabilidades**:
  - Strategic command & control
  - Resource allocation
  - Royal directives issuance
- **Subordinados**:
  - `collective-intelligence-coordinator`
  - `swarm-memory-manager`
  - `scout-explorer`
  - `worker-specialist`

#### 3. **project-coordinator**
- **Categoria**: `agents/`, `v3/`
- **Descrição**: Gerenciamento de projetos multi-agent
- **Hierarquia**: Nível tático-operacional
- **Responsabilidades**:
  - Task decomposition
  - Agent allocation
  - Progress tracking

---

## 🌐 NÍVEL 2: COORDENADORES DE TOPOLOGIA (Swarm)

### 3 Topologias de Coordenação

```
┌──────────────────────────────────────────────────────────┐
│         SWARM COORDINATION TOPOLOGIES                    │
│       (Escolha based on use case)                       │
└──────────────────────────────────────────────────────────┘
          │              │              │
          ↓              ↓              ↓
┌─────────────────┐ ┌──────────┐ ┌─────────────────┐
│  HIERARCHICAL   │ │   MESH   │ │    ADAPTIVE     │
│  coordinator    │ │coordinator│ │   coordinator   │
├─────────────────┤ ├──────────┤ ├─────────────────┤
│ Queen-led       │ │ P2P      │ │ ML-optimized    │
│ Clear command   │ │ No SPOF  │ │ Self-learning   │
│ High efficiency │ │ Fault-tol│ │ Dynamic         │
└─────────────────┘ └──────────┘ └─────────────────┘
```

#### 1. **hierarchical-coordinator** 👑
- **Arquitetura**: Queen + Workers
- **Use Case**: Projetos estruturados
- **Vantagens**: ⭐⭐⭐⭐⭐ Coordination efficiency
- **Desvantagens**: Single point of failure
- **Workers Spawna**:
  - Research Workers 🔬
  - Code Workers 💻
  - Analyst Workers 📊
  - Test Workers 🧪

#### 2. **mesh-coordinator** 🕸️
- **Arquitetura**: Peer-to-Peer
- **Use Case**: Sistemas críticos
- **Vantagens**: ⭐⭐⭐⭐⭐ Fault tolerance
- **Desvantagens**: High coordination overhead
- **Características**:
  - No central leader
  - Distributed consensus
  - Self-healing

#### 3. **adaptive-coordinator** 🧠
- **Arquitetura**: Dynamic topology switching
- **Use Case**: Workloads variáveis
- **Vantagens**: ⭐⭐⭐⭐⭐ Learning
- **Desvantagens**: Complexidade
- **Características**:
  - ML optimization
  - Learns from experience
  - Auto-tuning

---

## 📦 NÍVEL 3: AGENTES CORE (Trabalhadores Base)

### 5 Agentes Fundamentais

```
┌──────────────────────────────────────────────────────────┐
│            CORE AGENTS (5)                               │
│      (Bloco de construção para tudo)                    │
└──────────────────────────────────────────────────────────┘
```

| Agente | Função | Priority | Uso |
|--------|--------|----------|-----|
| **coder** | Escrever código | ⭐⭐⭐ | Implementação |
| **reviewer** | Revisar código | ⭐⭐⭐ | Quality assurance |
| **tester** | Criar testes | ⭐⭐⭐ | Testing |
| **planner** | Planejar tarefas | ⭐⭐⭐ | Strategy |
| **researcher** | Pesquisar info | ⭐⭐⭐ | Information gathering |

**Exemplo de Uso**:
```javascript
Task("Implement feature", "Create login form", "coder")
Task("Review code", "Check PR #123", "reviewer")
Task("Test system", "Unit tests auth", "tester")
Task("Plan sprint", "Break down epic", "planner")
Task("Research", "Find best practices", "researcher")
```

---

## 🎯 NÍVEL 4: AGENTES ESPECIALIZADOS (94)

### Por Categoria (Ordenado por Quantidade)

#### 📦 **GITHUB** (13 agentes) - Maior categoria

```
GITHUB INTEGRATION (13)
├── pr-manager              ← Gerencia Pull Requests
├── issue-tracker           ← Rastreia issues
├── release-manager         ← Gerencia releases
├── workflow-automation     ← GitHub Actions
├── repo-architect          ← Arquitetura de repositórios
├── sync-coordinator        ← Multi-repo sync
├── code-review-swarm       ← Code review em swarm
├── swarm-pr                ← PR coordination
├── swarm-issue             ← Issue-based swarm
├── multi-repo-swarm        ← Cross-repo
├── project-board-sync      ← GitHub Projects
├── github-modes            ← Integration modes
└── release-swarm           ← Release orchestration
```

**Hierarquia**: Todos são workers, alguns coordenam outros

---

#### 🚀 **V3** (11 agentes) - Arquitetura avançada

```
V3 ARCHITECTURE (11)
├── v3-queen-coordinator    ← Sovereign (⭐⭐⭐)
├── v3-integration-architect ← ADR-001 integration
├── v3-memory-specialist    ← ADR-006, ADR-009
├── v3-security-architect   ← Security overhaul
├── v3-performance-engineer ← Performance targets
├── project-coordinator     ← Project mgmt
├── database-specialist     ← DB architecture
├── typescript-specialist   ← TypeScript expert
├── python-specialist       ← Python expert
├── test-architect          ← Test architecture
└── index                   ← Registry
```

**Hierarquia**: Queen → Specialists → Workers

---

#### ☁️ **FLOW-NEXUS** (9 agentes) - Plataforma cloud

```
FLOW-NEXUS PLATFORM (9)
├── swarm                   ← Cloud deployment
├── workflow                ← Event-driven workflows
├── app-store               ← Application marketplace
├── payments                ← Credit billing
├── authentication          ← User auth
├── neural-network          ← Distributed training
├── sandbox                 ← E2B sandbox
├── user-tools              ← User management
└── challenges              ← Gamification
```

**Hierarquia**: Flat - todos são serviços

---

#### 📋 **TEMPLATES** (9 agentes) - Modelos reutilizáveis

```
AGENT TEMPLATES (9)
├── sparc-coordinator       ← SPARC methodology
├── coordinator-swarm-init  ← Swarm initialization
├── memory-coordinator      ← Memory management
├── task-orchestrator       ← Task coordination
├── automation-smart-agent  ← Auto-spawning
├── performance-analyzer    ← Performance analysis
├── migration-plan          ← Migration planning
├── github-pr-manager       ← PR management
└── sparc-coder             ← SPARC coding
```

**Hierarquia**: Templates para instanciar (não instâncias reais)

---

#### 🤝 **CONSENSUS** (8 agentes) - Algoritmos distribuídos

```
CONSENSUS ALGORITHMS (8)
├── raft-manager            ← Raft consensus
├── quorum-manager          ← Dynamic quorum
├── gossip-coordinator      ← Gossip protocol
├── byzantine-coordinator   ← Byzantine fault tolerance
├── crdt-synchronizer       ← CRDT sync
├── security-manager        ← Consensus security
├── performance-benchmarker ← Benchmarking
└── README                  ← Documentation
```

**Hierarquia**: Flat - cada algoritmo independente

---

#### ⚡ **OPTIMIZATION** (6 agentes) - Performance

```
OPTIMIZATION (6)
├── topology-optimizer      ← Dynamic topology
├── resource-allocator      ← Adaptive resources
├── load-balancer           ← Work distribution
├── performance-monitor     ← Real-time metrics
├── benchmark-suite         ← Performance tests
└── README                  ← Documentation
```

**Hierarquia**: Trabalham juntos, sem liderança

---

#### 🐝 **HIVE-MIND** (5 agentes) - Colônia inteligente

```
HIVE-MIND (5)
├── queen-coordinator       ← 👑 SOVEREIGN
├── collective-intelligence ← Collective decisions
├── swarm-memory-manager    ← Distributed memory
├── scout-explorer          ← Information recon
└── worker-specialist       ← Task execution
```

**Hierarquia**: Rígida - Queen → Workers

---

#### 📐 **SUBLINEAR** (5 agentes) - Algoritmos otimizados

```
SUBLINEAR ALGORITHMS (5)
├── consensus-coordinator   ← Fast consensus
├── matrix-optimizer        ← Matrix operations
├── pagerank-analyzer       ← PageRank analysis
├── performance-optimizer   ← System optimization
└── trading-predictor       ← Temporal advantage
```

**Hierarquia**: Flat - algoritmos independentes

---

#### 📐 **SPARC** (4 agentes) - Metodologia

```
SPARC METHODOLOGY (4)
├── specification           ← Requirements
├── pseudocode             ← Algorithm design
├── architecture           ← System design
└── refinement            ← Iterative improvement
```

**Hierarquia**: Sequencial - cada fase depende da anterior

---

#### 🎯 **GOAL** (3 agentes) - GOAP (Goal-Oriented Action Planning)

```
GOAL PLANNING (3)
├── goal-planner            ← General goals
├── code-goal-planner       ← Code-specific goals
└── agent                  ← General agent
```

**Hierarquia**: Hierárquico - general → specific

---

#### 🧪 **TESTING** (2 agentes)

```
TESTING (2)
├── tdd-london-swarm        ← TDD methodology
└── production-validator     ← Production readiness
```

---

#### 🧠 **REASONING** (2 agentes)

```
REASONING (2)
├── goal-planner            ← Planning
└── agent                   ← General agent
```

---

#### 🔍 **ANALYSIS** (2 agentes)

```
ANALYSIS (2)
├── code-analyzer           ← Code analysis
└── analyze-code-quality    ← Quality metrics
```

---

#### Outros (1 agente cada)

```
SINGLETON AGENTS (1 cada)
├── development/dev-backend-api
├── custom/test-long-runner
├── neural/safla-neural
├── sona/sona-learning-optimizer
└── payments/agentic-payments
```

---

## 🏗️ COMO FUNCIONA A HIERARQUIA NA PRÁTICA

### Exemplo 1: Projeto V3 Completo

```
v3-queen-coordinator (SOVEREIGN)
    ↓
    ├─→ v3-integration-architect (ADR-001)
    ├─→ v3-memory-specialist (ADR-006, ADR-009)
    ├─→ v3-security-architect (Security)
    ├─→ v3-performance-engineer (Performance)
    └─→ project-coordinator
            ↓
            ├─→ coder (implementation)
            ├─→ reviewer (QA)
            ├─→ tester (testing)
            └─→ planner (planning)
```

### Exemplo 2: Swarm Hierarchical

```
hierarchical-coordinator (QUEEN)
    ↓
    ├─→ researcher (workers) × N
    ├─→ coder (workers) × N
    ├─→ analyst (workers) × N
    └─→ tester (workers) × N
```

### Exemplo 3: GitHub Workflow

```
pr-manager
    ↓
    ├─→ code-review-swarm
    │       ↓
    │       ├─→ reviewer × N
    │       └─→ analyst × N
    ├─→ issue-tracker
    └─→ workflow-automation
```

---

## 📊 TABELA DE PRIORIDADES

### Priority Levels

| Nível | Agentes | Características |
|-------|---------|----------------|
| **⭐⭐⭐ Critical** | 3 | Queen coordinators, sovereign control |
| **⭐⭐ High** | ~20 | Coordinators, architects, specialists |
| **⭐ Medium** | ~50 | Workers, specialized agents |
| **Standard** | ~29 | Templates, utilities, docs |

### Agents com Priority: Critical

1. `hierarchical-coordinator` (swarm/)
2. `mesh-coordinator` (swarm/)
3. `adaptive-coordinator` (swarm/)
4. `v3-queen-coordinator` (v3/)
5. `queen-coordinator` (hive-mind/)

---

## 🎮 COMO USAR A HIERARQUIA

### 1. Escolha o Coordenador Certo

```javascript
// Para projetos V3 grandes
Task("V3 Queen", "Orquestrar ADR-001", "v3-queen-coordinator")

// Para swarm simples
Task("Coordinator", "Coordenar tarefas", "hierarchical-coordinator")

// Para alta disponibilidade
Task("Mesh", "Processamento distribuído", "mesh-coordinator")

// Para otimização automática
Task("Adaptive", "Otimizar performance", "adaptive-coordinator")
```

### 2. Deixe o Coordenador Spawnar Workers

```javascript
// ERRADO - Spawna workers manualmente
mcp__claude_flow__agent_spawn({type: "coder"})
mcp__claude_flow__agent_spawn({type: "tester"})

// CORRETO - Deixa coordinator decidir
Task("Queen", "Implementar feature X", "hierarchical-coordinator")
// Queen spawna: researcher, coder, analyst, tester automaticamente
```

### 3. Use Core Agents para Tarefas Simples

```javascript
// Para tarefas simples, use core agents diretamente
Task("Code", "Fix bug Y", "coder")
Task("Review", "Check PR Z", "reviewer")
Task("Test", "Unit tests", "tester")
```

---

## 🔗 RELAÇÃO ENTRE CATEGORIAS

```
┌─────────────────────────────────────────────────────┐
│              COORDENAÇÃO GLOBAL                     │
│     (Queen Coordinators + Swarm Coordinators)      │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              ESPECIALISTAS                          │
│   (V3, GitHub, Flow-Nexus, Consensus, etc.)        │
└─────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────┐
│              CORE + TEMPLATES                       │
│         (Blocos de construção)                     │
└─────────────────────────────────────────────────────┘
```

---

## 📈 ESTATÍSTICAS

```
Total de Agentes: 102
Total de Categorias: 21

Maior Categoria: GitHub (13 agentes)
Menor Categoria: Singletons (5 categorias com 1 agente)

Coordenadores Sovereign: 3
Coordenadores de Topologia: 3
Core Agents: 5
Especializados: 94

Distribuição:
├── Coordenação: 6 (5.9%)
├── Core: 5 (4.9%)
├── Especializados: 91 (89.2%)
```

---

## 🎓 CONCEITOS CHAVE

### 1. **Sovereign vs Coordinator**
- **Sovereign**: Queen que COMANDA (hierarchical, v3-queen, queen-coord)
- **Coordinator**: Gerencia coordenação (project-coord, collective-intelligence)

### 2. **Hierarchy vs Flat**
- **Hierarchy**: Queen → Workers (comando claro)
- **Flat**: Peer-to-peer (colaboração igualitária)

### 3. **Template vs Instance**
- **Template**: Definição em `.claude/agents/`
- **Instance**: Agente spawnado via Task tool ou agent_spawn

### 4. **Spawn vs Task**
- **Task tool**: Usa template existente (CORRETO ✅)
- **agent_spawn**: Cria novo agente dinamicamente (USE COM MODERAÇÃO)

---

## 🎉 CONCLUSÃO

### Hierarquia Resumida

```
LEVEL 1: 👑 QUEEN COORDINATORS (3)
         └→ Sovereign command

LEVEL 2: 🌐 TOPOLOGY COORDINATORS (3)
         ├→ Hierarchical (Queen-led)
         ├→ Mesh (P2P)
         └→ Adaptive (ML-optimized)

LEVEL 3: 📦 CORE AGENTS (5)
         └→ coder, reviewer, tester, planner, researcher

LEVEL 4: 🎯 SPECIALIZED AGENTS (91)
         └→ GitHub, V3, Flow-Nexus, etc.
```

### Como Navegar

1. **Use Queen Coordinators** para projetos complexos
2. **Use Core Agents** para tarefas simples
3. **Use Specialized Agents** para domínios específicos
4. **NUNCA use agent_spawn** se um Template existir

---

**Data**: 2026-01-30
**Total**: 102 agentes em 21 categorias
**Status**: ✅ Hierarquia completa e documentada

**Próximo**: Usar a hierarquia em projetos reais! 🚀
