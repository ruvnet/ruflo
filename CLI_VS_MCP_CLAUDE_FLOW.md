# 🔄 CLI vs MCP no Claude-Flow

## 📊 Resumo Visual

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLAUDE-FLOW CORE                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   SWARMS    │  │   AGENTS    │  │   MEMORY    │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
         ▲                            ▲
         │                            │
    ┌────┴────┐                  ┌───┴────────┐
    │         │                  │            │
   CLI       MCP             CLI          MCP
 (Terminal) (Claude Code)    (Terminal)   (Tools)
```

---

## 🎯 Quando Usar Cada Um

### MCP (90% dos casos) ✅ RECOMENDADO

**Use quando:**
- ✅ Estiver dentro do Claude Code
- ✅ Precisar de roteamento inteligente
- ✅ Quiser otimização automática de agents
- ✅ Tarefas context-aware
- ✅ Integração natural com o fluxo

**Vantagens:**
- 🔥 **Zero spawn overhead** (protocolo nativo)
- 🧠 **Claude decide quando usar** (inteligente)
- 📦 **175+ tools disponíveis**
- ⚡ **Performance máxima**
- 🎯 **Context-aware**

**Exemplo:**
```javascript
// Claude Code chama diretamente
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  maxAgents: 8
})
```

---

### CLI (10% dos casos) 🛠️ SCRIPTS

**Use quando:**
- ✅ Scripts batch/automação
- ✅ Cron jobs
- ✅ CI/CD pipelines
- ✅ Fora de sessão Claude
- ✅ Rápido para tarefas standalone

**Vantagens:**
- 💻 **Direto no terminal**
- 🚀 **Baixo overhead** (npx spawn)
- 🔧 **Fácil para scripts**
- 📝 **Comandos familiares**

**Exemplo:**
```bash
# Terminal direto
npx claude-flow@v3alpha swarm init --topology hierarchical
npx claude-flow@v3alpha agent spawn -t coder --name my-coder
npx claude-flow@v3alpha memory search -q "patterns"
```

---

## 📊 Comparativo Detalhado

| Aspecto | CLI (claude-flow) | MCP (mcp__claude-flow__*) |
|---------|-------------------|---------------------------|
| **Uso** | Terminal standalone | Tools dentro Claude Code |
| **Integração** | Direta, sem Claude | Claude decide (context-aware) |
| **Performance** | Overhead baixo (npx spawn) | **Zero spawn** (protocolo nativo) |
| **Comandos** | `swarm init --topology...` | `mcp__claude-flow__swarm_init(...)` |
| **V3 Foco** | Secundário (desabilitado por default) | **Primário** (175+ tools) |
| **Roteamento** | Manual | **Automático inteligente** |
| **Contexto** | Isolado | **Integrado à sessão** |
| **Setup** | Requer instalação | Já disponível (via MCP) |

---

## 🚀 Casos de Uso Real

### Seu Sync (Exemplo Perfeito)

```bash
# ❌ MÉTODO ERRADO - CLI direto
npx claude-flow sync  # Claude NÃO otimiza os agentes

# ✅ MÉTODO CERTO - MCP dentro Claude
# 1. Claude analisa a tarefa
# 2. Roteia para os melhores agentes
# 3. Otmiza execution em tempo real
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  objective: "Sync com repositório oficial"
})
# + Task tool com agentes especializados
```

**Resultado:** MCP > CLI porque Claude otimiza os agents!

---

## 💡 Regra de Ouro

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ESTÁ NO CLAUDE CODE?                               │
│   Use MCP (90% dos casos) ✅                         │
│                                                      │
│   PRECISA DE SCRIPT/CRON/CI-CD?                      │
│   Use CLI (10% dos casos) 🛠️                        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 🔧 Setup Comparison

### MCP Setup (Recomendado)

```bash
# Adicionar ao Claude Code
claude mcp add claude-flow npx claude-flow@v3alpha mcp start

# Pronto! 175+ tools disponíveis
# Funciona mesmo sem CLI instalado
```

### CLI Setup (Opcional)

```bash
# Instalar globalmente
npm install -g claude-flow@v3alpha

# Ou usar npx
npx claude-flow@v3alpha --help
```

---

## 📈 Performance

```
Overhead de Execução:

CLI:    npx spawn → cold start → execução
        ████████░░ 20-50ms

MCP:    protocolo nativo → execução  
        █░░░░░░░░░░ 0-5ms (96% mais rápido!)

Para 1000 operações:
CLI:  ~20-50 segundos
MCP:  ~0-5 segundos
```

---

## 🎯 Exemplos Práticos

### Cenário 1: Sync de Repositório (Seu Caso)

```javascript
// ✅ MCP - Claude otimiza tudo
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  strategy: "specialized",
  maxAgents: 8
})

Task("Analista", "Comparar local vs remoto", "analyst")
Task("Git-Expert", "Fazer merge e resolver conflitos", "github-modes")
Task("Validador", "Verificar estrutura final", "tester")

// Claude: "Vou usar opus para arquitetura, sonnet para implementação"
```

### Cenário 2: Cron Job de Backup

```bash
# ✅ CLI - Perfeito para scripts
#!/bin/bash
npx claude-flow@v3alpha memory backup
npx claude-flow@v3alpha checkpoint create --message "Auto-backup"
git push origin main
```

### Cenário 3: CI/CD Pipeline

```bash
# ✅ CLI - Integração nativa
- name: Run tests with swarm
  run: npx claude-flow@v3alpha swarm test --parallel
```

### Cenário 4: Feature Development (Complexo)

```javascript
// ✅ MCP - Máxima inteligência
mcp__claude-flow__swarm_init({
  topology: "hierarchical",
  strategy: "specialized"
})

// Claude decide:
// - "Opus para arquitetura (alta complexidade)"
// - "Sonnet para coding (média complexidade)"  
// - "Haiku para formatação (baixa complexidade)"
// - "Agent Booster para var→const (pula LLM!)"

Task("Architect", "", "system-architect", {model: "opus"})
Task("Coder", "", "coder", {model: "sonnet"})
Task("Formatter", "", "base-template-generator", {model: "haiku"})
```

---

## 🚨 Erro Comum

```javascript
// ❌ NÃO FAÇA ISSO
// Usar CLI dentro do Claude Code manualmente
Bash("npx claude-flow swarm init")  // Perde otimização!

// ✅ FAÇA ISSO
// Usar MCP tools - Claude otimiza tudo
mcp__claude-flow__swarm_init({...})
```

**Por que?**
- CLI: Claude só executa o comando, sem controle
- MCP: Claude decide, roteia, otimiza em tempo real

---

## 📊 Matriz de Decisão

```
                    EM CLAUDE CODE?
                         │
            ┌────────────┴────────────┐
            │ SIM                      │ NÃO
            ▼                          ▼
         USE MCP                    USE CLI
    (175+ tools)              (comandos terminal)
            │                          │
    Roteamento                Scripts, cron,
    automático                 CI/CD
            │                          │
    🧠 Inteligente              💻 Direto
    ⚡ Zero overhead          🚀 Baixo overhead
    🎯 Context-aware          🔧 Standalone
```

---

## 🎉 Conclusão

### MCP (90%): A Escolha Inteligente
- ✅ **Claude decide** quando/usar como
- ✅ **Roteamento automático** de modelos
- ✅ **Zero spawn overhead**
- ✅ **175+ tools** disponíveis
- ✅ **Context-aware** e otimizado

### CLI (10%): Para Scripts
- ✅ **Terminal direto** para automação
- ✅ **CI/CD, cron jobs**
- ✅ **Batch operations**
- ✅ **Fora do contexto Claude**

---

**Regra final:**

> 🎯 **"Dentro do Claude Code? SEMPRE MCP. Fora? CLI."**

**Seu sync foi perfeito:** MCP dentro Claude > CLI direto! 🚀

---

**Fonte**: https://github.com/ruvnet/claude-flow  
**Versão**: V3  
**Data**: 2026-01-30
