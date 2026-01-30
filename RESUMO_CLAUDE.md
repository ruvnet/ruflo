# 📋 CLAUDE.md - Documentação Oficial Claude Flow V3

## 🎯 O Que É

Arquivo de configuração principal que define como Claude Code deve se comportar ao trabalhar com o repositório **claude-flow**.

---

## 🚀 RECURSOS PRINCIPAIS

### 1. Sistema de Roteamento Inteligente 3-Tier (ADR-026)

**3 níveis para otimizar custo/performance:**

| Tier | Handler | Latência | Custo | Uso |
|------|---------|----------|-------|-----|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simples transforms (var→const) |
| **2** | Haiku | ~500ms | $0.0002 | Tarefas simples (<30% complexidade) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Reasoning complexo (>30%) |

**Agent Booster:** 352x mais rápido, $0 - pula LLM completamente!

### 2. Protocolo Anti-Drift (PREFERIDO)

Previne drift de objetivo, contexto e dessincronização:

```javascript
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",  // Coordenador central
  maxAgents: 8,              // Time menor = menos drift
  strategy: "specialized"    // Roles claros
})
```

### 3. Auto-Start Swarm Protocol

Quando usuário pede tarefa complexa, execute em **UMA mensagem**:

1. ✅ Inicializar swarm via MCP
2. ✅ **IMEDIATAMENTE** spawnar agentes via Task tool
3. ✅ Batch todos (5-10+ mínimos)
4. ✅ Armazenar estado na memória

**CRÍTICO:** MCP + Task na MESMA mensagem!

### 4. V3 CLI Commands (140+ subcomandos)

| Comando | Subcomandos | Descrição |
|---------|-------------|-----------|
| `init` | 4 | Inicialização com wizard |
| `agent` | 8 | Lifecycle de agentes |
| `swarm` | 6 | Coordenação multi-agent |
| `memory` | 11 | AgentDB + HNSW (150x-12,500x faster) |
| `mcp` | 9 | Management MCP |
| `hooks` | 17 | Self-learning hooks |
| + 19 mais | - | Vários |

### 5. Hooks System (17 Hooks + 12 Workers)

**Categorias:**
- **Core:** pre-edit, post-edit, pre-command, post-command, pre-task, post-task
- **Session:** session-start, session-end, session-restore, notify
- **Intelligence:** route, explain, pretrain, build-agents, transfer
- **Learning:** trajectory-start/step/end, pattern-store/search, stats, attention

**12 Background Workers:**
ultralearn, optimize, consolidate, predict, audit, map, preload, deepdive, document, refactor, benchmark, testgaps

### 6. Intelligence System (RuVector)

- **SONA:** Self-Optimizing Neural Architecture (<0.05ms)
- **MoE:** Mixture of Experts
- **HNSW:** 150x-12,500x faster
- **EWC++:** Elastic Weight Consolidation
- **Flash Attention:** 2.49x-7.47x speedup

### 7. Plugin Registry (IPFS/Pinata)

Registry descentralizado para distribuição de plugins:
- Stored no IPFS via Pinata
- Imutável e distribuído
- Verified plugins
- Categories: official, community, experimental

---

## 📊 MÉTRICAS DE PERFORMANCE

| Métrica | Target | Status |
|---------|--------|--------|
| HNSW Search | 150x-12,500x faster | ✅ Implementado |
| Memory Reduction | 50-75% (quantization) | ✅ 3.92x Int8 |
| SONA Integration | Pattern learning | ✅ ReasoningBank |
| Flash Attention | 2.49x-7.47x speedup | 🔄 In progress |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |

---

## 🎯 AGENTES DISPONÍVEIS (60+ tipos)

### Core Development
`coder`, `reviewer`, `tester`, `planner`, `researcher`

### V3 Specialized
`security-architect`, `security-auditor`, `memory-specialist`, `performance-engineer`

### Swarm Coordination
`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`, `collective-intelligence-coordinator`

### Consensus & Distributed
`byzantine-coordinator`, `raft-manager`, `gossip-coordinator`, `crdt-synchronizer`, `quorum-manager`

### GitHub & Repository
`github-modes`, `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`, `workflow-automation`

### SPARC Methodology
`sparc-coord`, `sparc-coder`, `specification`, `pseudocode`, `architecture`, `refinement`

---

## 🚨 REGRAS CRÍTICAS

### Golden Rule: "1 MESSAGE = ALL RELATED OPERATIONS"

**MANDATÓRIO:**
- ✅ TodoWrite: **SEMPRE** batch **TODOS** todos em **UMA** call
- ✅ Task tool: **SEMPRE** spawnar **TODOS** agentes em **UMA** mensagem
- ✅ File operations: **SEMPRE** batch **TODAS** operações
- ✅ Bash commands: **SEMPRE** batch **TODOS** comandos
- ✅ Memory operations: **SEMPRE** batch **TODAS** operações

### File Organization

**NUNCA** salvar na raiz. Use:
- `/src` - Código fonte
- `/tests` - Testes
- `/docs` - Documentação
- `/config` - Configurações
- `/scripts` - Scripts utilitários

---

## 🔧 SETUP RÁPIDO

```bash
# Adicionar MCP servers
claude mcp add claude-flow npx claude-flow@v3alpha mcp start
claude mcp add ruv-swarm npx ruv-swarm mcp start  # Optional
claude mcp add flow-nexus npx flow-nexus@latest mcp start  # Optional

# Iniciar daemon
npx claude-flow@v3alpha daemon start

# Run doctor
npx claude-flow@v3alpha doctor --fix
```

---

## 📦 PUBLICAÇÃO NPM

**CRÍTICO:** Sempre publicar AMBOS pacotes + atualizar TODOS tags:

```bash
# 1. Publicar CLI
cd v3/@claude-flow/cli
npm version 3.0.0-alpha.XXX
npm publish --tag alpha
npm dist-tag add @claude-flow/cli@3.0.0-alpha.XXX latest

# 2. Publicar umbrella
npm version 3.0.0-alpha.YYY
npm publish --tag v3alpha

# 3. Atualizar TODOS tags (CRÍTICO!)
npm dist-tag add claude-flow@3.0.0-alpha.YYY latest
npm dist-tag add claude-flow@3.0.0-alpha.YYY alpha
```

---

## 🎉 CONCLUSÃO

O **CLAUDE.md** é a **bíblia** do repositório claude-flow, contendo:

✅ Regras de orquestração de swarms  
✅ Sistema de roteamento inteligente  
✅ Protocolo anti-drift  
✅ 140+ comandos CLI  
✅ 60+ tipos de agentes  
✅ Hooks system + 12 workers  
✅ Performance targets  
✅ Instruções completas de setup  

**Tudo que você precisa para usar claude-flow no máximo!**

---

**Fonte**: https://github.com/ruvnet/claude-flow/wiki/CLAUDE  
**Versão**: V3 (647 linhas)  
**Status**: ✅ Atualizado e sincronizado
