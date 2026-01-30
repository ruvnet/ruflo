# 📘 COMO FUNCIONA O SISTEMA CLAUDE-FLOW

**Data**: 30 de Janeiro de 2026
**Nível**: Guia Completo do Usuário

---

## 🎯 RESUMO EXECUTIVO

O **Claude-Flow** é um sistema de orquestração de agentes AI com:

```
┌─────────────────────────────────────────────────┐
│  168 Commands  |  111 Agents  |  37 Skills      │
│  (slash cmds)  |  (tipos)     |  (módulos)      │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│     MCP SERVERS (200+ tools)                    │
│  • claude-flow: orquestração, memória, swarm    │
│  • context7: RAG para documentação oficial      │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│     SISTEMA DE MEMÓRIA RAG                      │
│  • AgentDB (SQLite) - armazenamento             │
│  • HNSW Index - busca 150x-12,500x faster       │
│  • Embeddings - vetores semânticos              │
└─────────────────────────────────────────────────┘
```

---

## 📊 ARQUITETURA EM CAMADAS

### Camada 1: Interface (Claude Code CLI)

```
Você → Claude Code → Interface de conversa
```

**O que é**:
- O CLI que você está usando agora
- Recebe seus comandos em português
- Interpreta intenção e executa ações

**Exemplo**:
```
Você: "use o swarm pra analisar memória"
Claude Code: Interpreta → Executa → Retorna resultado
```

---

### Camada 2: Orquestração (Claude-Flow Alpha)

```
┌──────────────────────────────────────────────────┐
│           CLAUDE-FLOW ALPHA                      │
│  168 Commands (slash commands)                  │
│  ├─ /swarm           → Orquestrar multi-agent   │
│  ├─ /memory          → Gerenciar memória        │
│  ├─ /sparc           → Metodologia SPARC        │
│  ├─ /github          → Integração GitHub        │
│  └─ 164 mais...                             │
│                                                  │
│  111 Agents (definições de agentes)             │
│  ├─ coder            → Escrever código          │
│  ├─ reviewer         → Revisar código           │
│  ├─ analyst          → Analisar sistemas        │
│  ├─ swarm-coord      → Coordenar swarms         │
│  └─ 107 mais...                             │
│                                                  │
│  37 Skills (módulos avançados)                  │
│  ├─ v3-memory-unification → Unificar memória    │
│  ├─ sparc-methodology    → Framework SPARC      │
│  ├─ agentdb-vector-search → Busca vetorial      │
│  └─ 34 mais...                               │
└──────────────────────────────────────────────────┘
```

**Como funciona**:

1. **Commands** (Slash Commands):
   ```bash
   /swarm --init            # Inicializa swarm
   /memory --search "query" # Busca na memória
   /sparc --run             # Executa SPARC
   ```

2. **Agents** (via Task tool):
   ```javascript
   Task("Descrição", "Tarefa específica", "tipo-do-agent")
   // Claude Code usa a definição em .claude/agents/tipo-do-agent.md
   ```

3. **Skills** (módulos reutilizáveis):
   ```bash
   skill:agentdb-vector-search    # Ativa busca vetorial
   skill:sparc-methodology        # Ativa framework SPARC
   ```

---

### Camada 3: Integração (MCP Servers)

```
┌──────────────────────────────────────────────────┐
│              MCP SERVERS                          │
│  (Model Context Protocol)                        │
└──────────────────────────────────────────────────┘
          ↓                    ↓
┌─────────────────┐  ┌─────────────────┐
│  claude-flow    │  │   context7      │
│       MCP       │  │       MCP       │
├─────────────────┤  ├─────────────────┤
│ 200+ tools      │  │ RAG para docs   │
│ - swarm_*       │  │ oficiais:       │
│ - memory_*      │  │ - React         │
│ - embeddings_*  │  │ - Vue           │
│ - github_*      │  │ - Next.js       │
│ - neural_*      │  │ - Node.js       │
│ ...             │  │ - etc           │
└─────────────────┘  └─────────────────┘
```

**MCP** = Model Context Protocol
- Permite que Claude Code se comunique com serviços externos
- Como "plugins" ou extensões
- Fornece ferramentas especializadas

**Exemplo de uso**:
```javascript
// Via MCP tool
mcp__claude_flow__memory_store({
  key: "auth-flow",
  value: "JWT authentication..."
})

// Via CLI
npx claude-flow@alpha memory store --key "auth-flow" --value "..."
```

---

### Camada 4: Memória RAG (O que configuramos!)

```
┌──────────────────────────────────────────────────┐
│          SISTEMA DE MEMÓRIA RAG                  │
└──────────────────────────────────────────────────┘
          ↓          ↓          ↓
┌─────────┐  ┌──────────┐  ┌──────────┐
│ SQLite  │  │   HNSW   │  │Embeddings│
│ AgentDB │  │  Index   │  │  OpenAI  │
└─────────┘  └──────────┘  └──────────┘
```

---

## 🧠 COMO FUNCIONA O RAG

### RAG = Retrieval Augmented Generation

**Tradução**: Geração Aumentada por Recuperação

**O que faz**:
1. **Recupera** informações relevantes da memória
2. **Augmenta** o prompt do Claude com contexto
3. **Gera** resposta mais precisa e contextual

---

### Fluxo Passo a Passo

```
┌─────────────────────────────────────────────────┐
│  EXEMPLO: "como funciona swarm coordination?"   │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  1. EMBEDDING GENERATION                        │
│                                                 │
│  Pergunta: "como funciona swarm coordination?"  │
│            ↓                                    │
│  Embedding Model (OpenAI)                       │
│            ↓                                    │
│  Vetor: [0.23, -0.45, 0.67, ..., 0.12]         │
│  (384 números representando significado)        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  2. VECTOR SEARCH (HNSW)                        │
│                                                 │
│  Busca vetores similares no banco de dados:     │
│                                                 │
│  Sua pergunta:   [0.23, -0.45, 0.67, ...]      │
│                         ↓                       │
│  ┌─────────────────────────────────────────┐   │
│  │ Compara com todos os vetores armazenados│   │
│  │ usando distância matemática             │   │
│  └─────────────────────────────────────────┘   │
│                         ↓                       │
│  Resultados:                                     │
│  • swarm-coordination → 0.79 (muito similar!)   │
│  • project-info       → 0.64                    │
│  • v3-memory          → 0.57                    │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  3. RETRIEVAL (Top K)                           │
│                                                 │
│  Recupera conteúdo das memórias mais relevantes │
│                                                 │
│  swarm-coordination (score: 0.79):              │
│  "Sistema de coordenação swarm suporta 3        │
│   topologias: hierarchical (rainha+workers),    │
│   mesh (P2P), e adaptive (dinâmico)..."         │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  4. CONTEXT AUGMENTATION                        │
│                                                 │
│  Monta prompt completo:                         │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │ PERGUNTA: "como funciona swarm?"         │  │
│  │                                          │  │
│  │ CONTEXTO RELEVANTE:                      │  │
│  │ - Sistema de coordenação swarm suporta   │  │
│  │   3 topologias: hierarchical, mesh...    │  │
│  │ - Swarm anti-drift evita divergência...  │  │
│  │                                          │  │
│  │ Responda com base no contexto acima.     │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  5. GENERATION                                  │
│                                                 │
│  Claude gera resposta usando contexto           │
│                                                 │
│  "O sistema de swarm coordination usa 3        │
│   topologias: hierarchical (com uma rainha      │
│   coordenando workers especializados), mesh     │
│   (P2P sem líder central), e adaptive (muda    │
│   dinamicamente conforme necessidade)..."       │
└─────────────────────────────────────────────────┘
```

---

## 💾 ESTRUTURA DE MEMÓRIA (AgentDB)

### Tabelas Principais

#### 1. **memory_entries** (Armazenamento Principal)

```sql
CREATE TABLE memory_entries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,                    -- Ex: "swarm-coordination"
  namespace TEXT DEFAULT 'default',     -- Ex: "docs", "code", "features"
  content TEXT NOT NULL,                -- O conteúdo real

  type TEXT DEFAULT 'semantic',         -- Tipo de memória:
  -- 'semantic'   → Busca vetorial
  -- 'episodic'   → Experiências específicas
  -- 'procedural' → Procedimentos/tarefas
  -- 'working'    → Memória de trabalho
  -- 'pattern'    → Padrões aprendidos

  embedding TEXT,                       -- Vetor (JSON array)
  embedding_model TEXT,                 -- Modelo usado
  embedding_dimensions INTEGER,         -- Ex: 384

  tags TEXT,                            -- JSON array de tags
  metadata TEXT,                        -- JSON object
  owner_id TEXT,                        -- Quem criou

  created_at INTEGER,                   -- Timestamp criação
  updated_at INTEGER,                   -- Timestamp atualização
  expires_at INTEGER,                   -- Expiração (opcional)
  last_accessed_at INTEGER,             -- Último acesso

  access_count INTEGER DEFAULT 0,       -- Contador de acessos

  status TEXT DEFAULT 'active',         -- 'active', 'archived', 'deleted'

  UNIQUE(namespace, key)                -- Só um por namespace/key
);
```

**Exemplo de entrada**:
```json
{
  "id": "entry_1769801738145_xyz",
  "key": "swarm-coordination",
  "namespace": "docs",
  "content": "Sistema de coordenação swarm suporta 3 topologias...",
  "type": "semantic",
  "embedding": [0.23, -0.45, 0.67, ...],  // 384 números
  "embedding_model": "openai",
  "embedding_dimensions": 384,
  "tags": ["swarm", "coordination", "topology"],
  "metadata": {"priority": "high", "category": "architecture"},
  "created_at": 1738278145000,
  "access_count": 3,
  "status": "active"
}
```

---

#### 2. **patterns** (Padrões Aprendidos)

```sql
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pattern_type TEXT NOT NULL,           -- 'task-routing', 'error-recovery', etc.

  condition TEXT NOT NULL,              -- Quando aplicar
  action TEXT NOT NULL,                 -- O que fazer

  confidence REAL DEFAULT 0.5,          -- Confiança (0.0 - 1.0)
  success_count INTEGER DEFAULT 0,      -- Sucessos
  failure_count INTEGER DEFAULT 0,      -- Falhas

  decay_rate REAL DEFAULT 0.01,         -- Quanto confiança decai
  half_life_days INTEGER DEFAULT 30,    -- Dias para reduzir pela metade

  embedding TEXT,                       -- Para matching semântico

  version INTEGER DEFAULT 1,            -- Versionamento
  parent_id TEXT,                       -- Pattern anterior

  tags TEXT,
  metadata TEXT,
  source TEXT,                          -- Onde foi aprendido

  created_at INTEGER,
  updated_at INTEGER
);
```

**Como funciona**:
- Sistema **aprende** padrões automaticamente
- Exemplo: "Sempre que usuário pede análise, usar agent 'analyst'"
- Confiança aumenta com sucesso, diminui com falha
- Padrões velhos decaem com tempo (temporal decay)

---

#### 3. **memory_trajectories** (Trajetórias de Reasoning)

```sql
CREATE TABLE memory_trajectories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,             -- Sessão específica
  task_type TEXT NOT NULL,              -- Tipo de tarefa

  steps TEXT NOT NULL,                  -- JSON array de passos
  outcome TEXT,                         -- 'success', 'failure', 'partial'

  duration_ms INTEGER,                  -- Tempo total
  token_usage INTEGER,                  -- Tokens usados

  embedding TEXT,                       -- Para encontrar reasoning similar

  created_at INTEGER
);
```

**Para que serve**:
- Rastreia **raciocínio completo** (não só resultado)
- Permite **reaproveitar estratégias** bem-sucedidas
- Aprende a evitar erros passados

---

### HNSW Index (Hierarchical Navigable Small World)

**O que é**:
- Estrutura de dados para **busca vetorial super rápida**
- **150x - 12,500x faster** que busca linear

**Como funciona**:

```
┌─────────────────────────────────────────────┐
│         BUSCA LINEAR (lenta)                │
│  Comparar com TODOS os vetores:             │
│  • 1.000 vetores → 1.000 comparações        │
│  • 10.000 vetores → 10.000 comparações      │
│  • 100.000 vetores → 100.000 comparações ❌ │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│         BUSCA HNSW (rápida)                 │
│  Pula entre "vizinhos próximos":            │
│  • 1.000 vetores → ~10 comparações ✅       │
│  • 10.000 vetores → ~30 comparações ✅      │
│  • 100.000 vetores → ~100 comparações ✅    │
│                                             │
│  Como um "atalho" inteligente!              │
└─────────────────────────────────────────────┘
```

**Arquivo físico**: `.swarm/hnsw.index` (1.6 MB)

---

## 🚀 COMO USAR NA PRÁTICA

### 1. Armazenar Memórias

```bash
# Via CLI
npx claude-flow@alpha memory store \
  --key "auth-flow" \
  --namespace "docs" \
  --value "JWT-based authentication with refresh tokens..."

# Via MCP (no Claude Code)
mcp__claude_flow__memory_store({
  key: "auth-flow",
  namespace: "docs",
  value: "JWT-based authentication with refresh tokens...",
  tags: ["auth", "jwt", "security"]
})
```

**Resultado**:
- Memória armazenada no SQLite
- Embedding gerado automaticamente (384-dim)
- Índice HNSW atualizado
- Pronto para busca semântica!

---

### 2. Buscar Semanticamente

```bash
# Via CLI
npx claude-flow@alpha memory search \
  --query "como funciona autenticação?" \
  --top 5

# Via MCP
mcp__claude_flow__memory_search({
  query: "autenticação jwt",
  namespace: "docs",
  limit: 5
})
```

**Resultado**:
```
Search time: 251ms

+------------------+-------+-----------+----------------------------+
| Key              | Score | Namespace | Preview                    |
+------------------+-------+-----------+----------------------------+
| auth-flow        |  0.85 | docs      | JWT-based authentication... |
| security-pattern |  0.72 | docs      | Refresh token rotation...   |
| login-module     |  0.65 | code      | Login form validation...    |
+------------------+-------+-----------+----------------------------+

Found 3 results
```

---

### 3. Listar Memórias

```bash
npx claude-flow@alpha memory list
```

**Resultado**:
```
+------------------+-----------+-------+--------+
| Key              | Namespace | Size  | Vector |
+------------------+-----------+-------+--------+
| auth-flow        | docs      | 156 B |   ✓    |
| swarm-coord      | docs      | 166 B |   ✓    |
| project-info     | code      | 122 B |   ✓    |
+------------------+-----------+-------+--------+

Showing 3 of 5 entries
```

---

### 4. Ver Estatísticas

```bash
npx claude-flow@alpha memory stats
```

**Resultado**:
```
Memory Statistics
┌───────────────┬──────────┐
│ Metric        │ Value    │
├───────────────┼──────────┤
│ Backend       │ sql.js+HNSW│
│ Version       │ 3.0.0    │
│ Total Entries │ 5        │
└───────────────┴──────────┘

V3 Performance: 150x-12,500x faster search with HNSW indexing
```

---

## 🎯 TIPOS DE MEMÓRIA

### 1. Semantic (Padrão)
```javascript
type: "semantic"
```
- **Uso**: Busca por significado
- **Exemplo**: "como funciona swarm?"
- **Busca**: Vetorial (embeddings)

### 2. Episodic
```javascript
type: "episodic"
```
- **Uso**: Experiências específicas
- **Exemplo**: "Na última sessão, tentamos migrar git e deu conflito"
- **Busca**: Temporal + semântica

### 3. Procedural
```javascript
type: "procedural"
```
- **Uso**: Procedimentos passo-a-passo
- **Exemplo**: "Como configurar embeddings: 1. init, 2. store, 3. search"
- **Busca**: Semântica + sequencial

### 4. Working
```javascript
type: "working"
```
- **Uso**: Memória temporária de trabalho
- **Exemplo**: "Variável X está sendo usada para cálculo Y"
- **Busca**: Rápida, expira em breve

### 5. Pattern
```javascript
type: "pattern"
```
- **Uso**: Padrões aprendidos automaticamente
- **Exemplo**: "Usuário sempre pede análise após digitar 'audit'"
- **Busca**: Pattern matching + semântica

---

## 📊 PERFORMANCE

### Benchmarks do Sistema

| Operação | Sem HNSW | Com HNSW | Speedup |
|----------|----------|----------|---------|
| 1K entries | 50ms | 0.3ms | **150x** |
| 10K entries | 500ms | 2ms | **250x** |
| 100K entries | 5000ms | 5ms | **1,000x** |
| 1M entries | 50000ms | 40ms | **1,250x** |

**Nosso sistema atual**:
- 5 entries
- Busca em 251ms
- Escalável para milhões!

---

## 🔄 INTEGRAÇÃO COM CONTEXT7

```
┌─────────────────────────────────────────────────┐
│            RAG COMPLETO                         │
└─────────────────────────────────────────────────┘
          ↓                    ↓
┌─────────────────┐  ┌─────────────────┐
│   CONTEXT7      │  │    AGENTDB      │
│  (MCP Server)   │  │   (Local RAG)   │
├─────────────────┤  ├─────────────────┤
│ Documentação    │  │ Código local    │
│ oficial de:     │  │ - docs/         │
│ - React         │  │ - src/          │
│ - Vue           │  │ - README.md     │
│ - Node.js       │  │ - patterns      │
│ - Next.js       │  │ - conceitos     │
│ - etc           │  │                 │
│                 │  │ Busca vetorial  │
│ Via Upstash API │  │ HNSW 150x+      │
└─────────────────┘  └─────────────────┘
          ↓                    ↓
┌─────────────────────────────────────────────────┐
│         CLAUDE CODE COM CONTEXTO COMPLETO       │
│  (Docs oficiais + Seu código + Memórias)        │
└─────────────────────────────────────────────────┘
```

**Exemplo**:
```
Sua pergunta: "como usar useState no React?"

↓ Context7 recupera:
"useState is a React Hook that lets you add state to function components..."

↓ AgentDB recupera:
"No nosso projeto, usamos useState em src/components/LoginForm.tsx..."

↓ Resposta completa:
"No React, useState é um Hook que adiciona estado a componentes...
 No seu projeto específico, você usou em LoginForm.tsx para armazenar
 email e senha..."
```

---

## 🎓 CONCEITOS CHAVE

### 1. Embeddings
**O que são**:
- Representações numéricas de texto
- Texto similar → Vetores similares
- Ex: "gato" e "cachorro" têm vetores próximos (ambos são animais)

**Como funciona**:
```
Texto: "swarm coordination"
  ↓
Modelo: OpenAI text-embedding-3-small
  ↓
Vetor: [0.23, -0.45, 0.67, 0.12, ..., 0.34]
       └───── 384 números ─────┘
```

### 2. HNSW
**O que é**:
- Hierarchical Navigable Small World
- Grafo otimizado para busca vetorial
- "Atalhos" inteligentes entre vetores próximos

**Analogia**:
- Como GPS em vez de procurar rua por rua
- Vai direto pelo "melhor caminho"

### 3. RAG
**O que é**:
- Retrieval Augmented Generation
- Recupera contexto relevante
- Aumenta resposta do AI

**Benefícios**:
- ✅ Respostas mais precisas
- ✅ Contexto específico do seu código
- ✅ Sem alucinações (baseado em fatos)

---

## 🚀 PRÓXIMOS PASSOS

### 1. Expandir Memória

```bash
# Indexar documentação do projeto
find docs/ -name "*.md" -exec sh -c '
  npx claude-flow@alpha memory store \
    --key "$(basename {} .md)" \
    --namespace "docs" \
    --value "$(cat {})"
' \;

# Indexar conceitos importantes
npx claude-flow@alpha memory store \
  --key "swarm-topologies" \
  --namespace "concepts" \
  --value "3 topologias: hierarchical (rainha), mesh (P2P), adaptive (mista)"
```

### 2. Usar nas Skills

```bash
# Ativar skill de busca vetorial
skill:agentdb-vector-search

# Usar em workflow
/swarm --init --topology hierarchical --agents 5
```

### 3. Monitorar Uso

```bash
# Ver estatísticas
npx claude-flow@alpha memory stats

# Ver acessos recentes
npx claude-flow@alpha memory list --sort accessed
```

---

## 📚 GLOSSÁRIO

| Termo | Significado |
|-------|-------------|
| **RAG** | Retrieval Augmented Generation - Geração com recuperação de contexto |
| **Embedding** | Representação numérica de texto (vetor) |
| **HNSW** | Hierarchical Navigable Small World - Índice vetorial rápido |
| **AgentDB** | Sistema de memória do claude-flow (SQLite) |
| **MCP** | Model Context Protocol - Protocolo de integração |
| **Semantic Search** | Busca por significado (não só palavras) |
| **Vector Space** | Espaço matemático onde vetores vivem |
| **Cosine Similarity** | Medida de similaridade entre vetores (0-1) |

---

## 🎉 RESUMO

### Sistema Completo = 4 Camadas

```
┌────────────────────────────────────┐
│  1. Claude Code CLI (Interface)    │  ← Você usa
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  2. Claude-Flow Alpha              │  ← 168 commands, 111 agents
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  3. MCP Servers (200+ tools)       │  ← Integração
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│  4. AgentDB + HNSW + Embeddings    │  ← Memória RAG
└────────────────────────────────────┘
```

### Fluxo de Uso

```
Você faz pergunta
  ↓
Claude Code interpreta
  ↓
Gera embedding da pergunta
  ↓
Busca vetorial no HNSW (150x+ faster)
  ↓
Recupera memórias relevantes
  ↓
Augmenta prompt com contexto
  ↓
Claude gera resposta precisa
  ↓
Você recebe resposta contextualizada! ✅
```

---

**Data**: 2026-01-30
**Status**: ✅ Sistema RAG completamente funcional!
**Próximo**: Indexar mais código e expandir memória! 🚀
