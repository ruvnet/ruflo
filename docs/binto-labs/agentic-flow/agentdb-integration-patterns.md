# AgentDB Integration Patterns Guide

**Version:** 1.3.9
**Last Updated:** November 12, 2025
**Audience:** Developers integrating AgentDB into existing systems

---

## Table of Contents

1. [Integration with Claude Flow](#integration-with-claude-flow)
2. [Hybrid Memory Systems](#hybrid-memory-systems)
3. [Real-World Use Case Patterns](#real-world-use-case-patterns)
4. [SAFLA Implementation](#safla-implementation)
5. [Multi-Agent Coordination](#multi-agent-coordination)
6. [Migration Strategies](#migration-strategies)
7. [API Integration Patterns](#api-integration-patterns)
8. [Testing & Validation](#testing--validation)

---

## Integration with Claude Flow

### Pattern 1: CLI Integration

**Use Case:** Command-line tools and automation scripts

```bash
# Initialize Claude Flow with AgentDB
npx claude-flow@alpha init --force

# Store patterns with vector embeddings
npx claude-flow memory store-vector auth_pattern \
  "OAuth2 authentication with JWT refresh tokens" \
  --namespace backend \
  --metadata '{"language":"javascript","framework":"express"}'

# Semantic search
npx claude-flow memory vector-search \
  "user authentication system" \
  --k 10 \
  --threshold 0.7 \
  --namespace backend

# Check AgentDB status
npx claude-flow memory agentdb-info

# Hybrid query (tries AgentDB first, falls back to ReasoningBank)
npx claude-flow memory query "authentication patterns" \
  --namespace backend
```

---

### Pattern 2: MCP Tool Integration

**Use Case:** Integration with Claude Code via Model Context Protocol

```javascript
// In Claude Code, use MCP tools

// Initialize memory system
mcp__claude-flow__memory_init {
  mode: "hybrid",  // AgentDB + ReasoningBank
  namespace: "project-alpha"
}

// Store with semantic vector
mcp__claude-flow__memory_store_vector {
  key: "api-auth-pattern",
  value: "RESTful API authentication using JWT tokens...",
  namespace: "backend",
  metadata: {
    type: "authentication",
    language: "javascript"
  }
}

// Semantic search
mcp__claude-flow__memory_vector_search {
  query: "authentication implementation",
  k: 10,
  threshold: 0.75,
  namespace: "backend"
}

// Standard memory operations (ReasoningBank)
mcp__claude-flow__memory_usage {
  action: "store",
  key: "feature-status",
  value: JSON.stringify({ status: "in-progress" }),
  namespace: "coordination"
}
```

---

### Pattern 3: SDK Programmatic Access

**Use Case:** Custom applications and services

```typescript
import { AgentDBMemoryAdapter } from 'claude-flow/memory';
import { SwarmCoordinator } from 'claude-flow/coordination';

// Initialize hybrid memory system
const memory = new AgentDBMemoryAdapter({
  mode: 'hybrid',
  agentdbPath: '.agentdb/app.db',
  reasoningbankPath: '.swarm/memory.db',
  quantization: 'scalar',
  enableHNSW: true
});

await memory.initialize();

// Store with embedding
await memory.storeWithEmbedding('pattern-001', {
  description: 'Error handling pattern for async operations',
  code: `...`,
  metadata: {
    domain: 'backend',
    language: 'javascript',
    confidence: 0.95
  }
}, embeddingVector);

// Semantic search
const results = await memory.vectorSearch(queryVector, {
  k: 10,
  threshold: 0.7,
  filter: { domain: 'backend' }
});

// Integration with swarm coordination
const coordinator = new SwarmCoordinator({
  memory: memory,
  maxAgents: 5
});

await coordinator.start();
```

---

## Hybrid Memory Systems

### Pattern 1: Query Router

**Use Case:** Intelligently route queries to AgentDB or ReasoningBank

```javascript
class HybridQueryRouter {
  constructor(agentdb, reasoningbank) {
    this.agentdb = agentdb;
    this.reasoningbank = reasoningbank;
  }

  async query(input, options = {}) {
    const queryType = this.classifyQuery(input);

    switch (queryType) {
      case 'semantic':
        // Natural language, concepts → AgentDB
        return await this.queryAgentDB(input, options);

      case 'exact':
        // IDs, specific keys → ReasoningBank
        return await this.queryReasoningBank(input, options);

      case 'hybrid':
        // Combine both approaches
        return await this.queryBoth(input, options);
    }
  }

  classifyQuery(input) {
    // Semantic indicators
    if (typeof input === 'object' && input.vector) {
      return 'semantic';
    }

    // Exact match indicators
    if (typeof input === 'string' && input.match(/^[a-z0-9-_]+$/i)) {
      return 'exact';
    }

    // Natural language
    if (typeof input === 'string' && input.split(' ').length > 3) {
      return 'semantic';
    }

    return 'hybrid';
  }

  async queryAgentDB(input, options) {
    const embedding = await this.generateEmbedding(input);
    return await this.agentdb.search(embedding, options);
  }

  async queryReasoningBank(input, options) {
    return await this.reasoningbank.query(input, options);
  }

  async queryBoth(input, options) {
    const [agentdbResults, reasoningbankResults] = await Promise.all([
      this.queryAgentDB(input, options),
      this.queryReasoningBank(input, options)
    ]);

    return this.mergeResults(agentdbResults, reasoningbankResults);
  }

  mergeResults(results1, results2) {
    // Deduplicate by ID
    const seen = new Set();
    const merged = [];

    for (const result of [...results1, ...results2]) {
      if (!seen.has(result.id)) {
        seen.add(result.id);
        merged.push(result);
      }
    }

    // Re-rank by utility score
    return this.utilityBasedRerank(merged);
  }

  utilityBasedRerank(results) {
    // U = α·similarity + β·uplift − γ·latency
    const α = 0.5, β = 0.3, γ = 0.2;

    return results.map(r => ({
      ...r,
      utilityScore: α * (r.score || r.similarity || 0.5) +
                    β * (r.uplift || 0.5) -
                    γ * (r.latency || 0)
    })).sort((a, b) => b.utilityScore - a.utilityScore);
  }
}

// Usage
const router = new HybridQueryRouter(agentdb, reasoningbank);

// Semantic query → AgentDB
await router.query("authentication patterns for REST APIs");

// Exact query → ReasoningBank
await router.query("auth-pattern-001");

// Hybrid query → Both systems
await router.query("auth", { hybrid: true });
```

---

### Pattern 2: Data Synchronization

**Use Case:** Keep AgentDB and ReasoningBank in sync

```javascript
class MemorySyncManager {
  constructor(agentdb, reasoningbank) {
    this.agentdb = agentdb;
    this.reasoningbank = reasoningbank;
  }

  async syncPattern(pattern) {
    // Store in both systems simultaneously
    await Promise.all([
      this.storeInAgentDB(pattern),
      this.storeInReasoningBank(pattern)
    ]);
  }

  async storeInAgentDB(pattern) {
    const embedding = await this.generateEmbedding(
      pattern.description || pattern.text
    );

    await agentdb_insert(this.agentdb, embedding, {
      id: pattern.id,
      ...pattern.metadata
    });
  }

  async storeInReasoningBank(pattern) {
    await this.reasoningbank.store(
      pattern.id,
      pattern.description,
      {
        ...pattern.metadata,
        synced_to_agentdb: true,
        sync_timestamp: new Date().toISOString()
      }
    );
  }

  async validateSync() {
    const [agentdbCount, reasoningbankCount] = await Promise.all([
      this.getAgentDBCount(),
      this.getReasoningBankCount()
    ]);

    if (agentdbCount !== reasoningbankCount) {
      console.warn(`Sync mismatch: AgentDB=${agentdbCount}, ReasoningBank=${reasoningbankCount}`);
      return false;
    }

    return true;
  }

  async reconcile() {
    // Find patterns in ReasoningBank not in AgentDB
    const rbPatterns = await this.reasoningbank.listAll();
    const agentdbIds = new Set(await this.getAgentDBIds());

    const missing = rbPatterns.filter(p => !agentdbIds.has(p.id));

    // Sync missing patterns
    for (const pattern of missing) {
      await this.storeInAgentDB(pattern);
    }

    console.log(`Synced ${missing.length} missing patterns`);
  }
}

// Usage
const syncManager = new MemorySyncManager(agentdb, reasoningbank);

// Sync new pattern
await syncManager.syncPattern({
  id: 'auth-pattern-042',
  description: 'OAuth2 refresh token flow',
  metadata: { domain: 'backend', language: 'javascript' }
});

// Periodic validation
setInterval(async () => {
  const inSync = await syncManager.validateSync();
  if (!inSync) {
    await syncManager.reconcile();
  }
}, 60 * 60 * 1000);  // Hourly
```

---

## Real-World Use Case Patterns

### Pattern 1: Code Pattern Library

**Use Case:** Store and retrieve successful code patterns

```javascript
class CodePatternLibrary {
  constructor(agentdb) {
    this.agentdb = agentdb;
  }

  async storePattern(pattern) {
    const embedding = await this.generateEmbedding(
      `${pattern.name}: ${pattern.description}\n${pattern.code}`
    );

    await agentdb_insert(this.agentdb, embedding, {
      id: pattern.id,
      name: pattern.name,
      description: pattern.description,
      code: pattern.code,
      language: pattern.language,
      framework: pattern.framework,
      tags: pattern.tags,
      usage_count: 0,
      success_rate: 1.0,
      created: new Date().toISOString()
    });
  }

  async findSimilarPattern(description) {
    const embedding = await this.generateEmbedding(description);

    const results = await agentdb_search(this.agentdb, embedding, {
      k: 5,
      threshold: 0.75,
      filter: { success_rate: '>0.7' }
    });

    return results.map(r => ({
      id: r.id,
      name: r.metadata.name,
      description: r.metadata.description,
      code: r.metadata.code,
      similarity: r.score,
      success_rate: r.metadata.success_rate
    }));
  }

  async recordUsage(patternId, successful) {
    const pattern = await this.getPattern(patternId);

    pattern.usage_count++;
    if (successful) {
      pattern.success_count = (pattern.success_count || 0) + 1;
    }
    pattern.success_rate = pattern.success_count / pattern.usage_count;

    await this.updatePattern(pattern);
  }
}

// Usage
const library = new CodePatternLibrary(agentdb);

// Store pattern
await library.storePattern({
  id: 'auth-jwt-001',
  name: 'JWT Authentication Middleware',
  description: 'Express middleware for JWT token verification',
  code: `
    export async function authenticate(req, res, next) {
      const token = req.headers.authorization?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'No token' });
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
      } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
      }
    }
  `,
  language: 'javascript',
  framework: 'express',
  tags: ['auth', 'jwt', 'middleware']
});

// Find similar pattern
const similar = await library.findSimilarPattern(
  "authentication middleware for API routes"
);

// Use pattern and record success
const pattern = similar[0];
// ... use pattern ...
await library.recordUsage(pattern.id, true);
```

---

### Pattern 2: Research Knowledge Base

**Use Case:** Semantic search over research papers and findings

```javascript
class ResearchKnowledgeBase {
  constructor(agentdb) {
    this.agentdb = agentdb;
  }

  async indexPaper(paper) {
    // Create embedding from title + abstract + key findings
    const content = `
      ${paper.title}
      ${paper.abstract}
      ${paper.keyFindings.join(' ')}
    `;

    const embedding = await this.generateEmbedding(content);

    await agentdb_insert(this.agentdb, embedding, {
      id: paper.doi || paper.id,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      journal: paper.journal,
      abstract: paper.abstract,
      keyFindings: paper.keyFindings,
      citations: paper.citations,
      topics: paper.topics,
      methodology: paper.methodology
    });
  }

  async searchRelevantPapers(query, options = {}) {
    const embedding = await this.generateEmbedding(query);

    const results = await agentdb_search(this.agentdb, embedding, {
      k: options.k || 20,
      threshold: options.threshold || 0.7,
      filter: {
        ...(options.topic && { topics: options.topic }),
        ...(options.yearFrom && { year: `>=${options.yearFrom}` }),
        ...(options.minCitations && { citations: `>=${options.minCitations}` })
      }
    });

    return results.map(r => ({
      doi: r.id,
      title: r.metadata.title,
      year: r.metadata.year,
      relevance: r.score,
      abstract: r.metadata.abstract,
      keyFindings: r.metadata.keyFindings
    }));
  }

  async discoverRelatedWork(paperId) {
    // Find papers similar to a given paper
    const paper = await this.getPaper(paperId);
    return await this.searchRelevantPapers(
      `${paper.title} ${paper.abstract}`,
      { k: 10, threshold: 0.8 }
    );
  }
}

// Usage
const kb = new ResearchKnowledgeBase(agentdb);

// Index paper
await kb.indexPaper({
  doi: '10.1234/example.2025',
  title: 'Improved CRISPR Efficiency with Modified Guide RNAs',
  authors: ['Smith, J.', 'Doe, A.'],
  year: 2025,
  journal: 'Nature Biotechnology',
  abstract: 'We demonstrate a 40% improvement in CRISPR efficiency...',
  keyFindings: [
    'Modified guide RNAs show 40% efficiency improvement',
    'Reduced off-target effects by 60%',
    'Compatible with existing CRISPR-Cas9 systems'
  ],
  citations: 42,
  topics: ['genomics', 'crispr', 'gene-editing']
});

// Search for relevant papers
const papers = await kb.searchRelevantPapers(
  'improving gene editing accuracy and reducing off-target effects',
  {
    k: 10,
    topic: 'genomics',
    yearFrom: 2020,
    minCitations: 10
  }
);
```

---

## SAFLA Implementation

**Pattern: Self-Adaptive Feedback Loop Architecture**

**Use Case:** Continuous learning and improvement system

```javascript
class SAFLAEngine {
  constructor(agentdb) {
    this.agentdb = agentdb;
    this.cycles = 0;
  }

  async runCycle(task, executeTask) {
    this.cycles++;

    // 1. STORE: Retrieve relevant patterns
    const patterns = await this.retrievePatterns(task);

    // 2. EMBED: Execute task with pattern context
    const result = await executeTask(task, patterns);

    // 3. QUERY: Evaluate outcome
    const evaluation = await this.evaluateOutcome(result, task);

    // 4. RANK: Score and rank patterns by utility
    const rankedPatterns = this.utilityBasedRerank(patterns, evaluation);

    // 5. LEARN: Update patterns and store new learnings
    await this.learn(task, result, evaluation, rankedPatterns);

    return result;
  }

  async retrievePatterns(task) {
    const embedding = await this.generateEmbedding(task.description);

    return await agentdb_search(this.agentdb, embedding, {
      k: 10,
      threshold: 0.7,
      filter: { domain: task.domain, confidence: '>0.6' }
    });
  }

  async evaluateOutcome(result, task) {
    // Calculate reward signal
    const reward = this.calculateReward(result, task.expectedOutcome);

    // Generate self-critique
    const critique = await this.generateCritique(result, reward);

    return {
      reward,
      critique,
      success: reward > 0.7,
      metrics: result.metrics
    };
  }

  calculateReward(result, expected) {
    // Domain-specific reward calculation
    // Example for task completion:
    const completeness = result.completed / expected.tasks;
    const quality = result.quality_score;
    const efficiency = expected.time / result.actual_time;

    return (completeness * 0.5 + quality * 0.3 + efficiency * 0.2);
  }

  async generateCritique(result, reward) {
    if (reward > 0.7) {
      return `Success: ${result.summary}. Key factors: ${result.successFactors.join(', ')}`;
    } else {
      return `Failure: ${result.summary}. Issues: ${result.issues.join(', ')}. Improvements: ${result.suggestedImprovements.join(', ')}`;
    }
  }

  utilityBasedRerank(patterns, evaluation) {
    // U = α·similarity + β·uplift − γ·latency
    const α = 0.5, β = 0.3, γ = 0.2;

    return patterns.map(p => ({
      ...p,
      utility: α * p.score +
               β * (evaluation.reward * p.metadata.confidence) -
               γ * (p.metadata.complexity || 0)
    })).sort((a, b) => b.utility - a.utility);
  }

  async learn(task, result, evaluation, patterns) {
    // Store reflexion episode
    await this.storeReflexionEpisode({
      task,
      result,
      evaluation,
      patterns
    });

    // Update pattern confidences (Bayesian)
    for (const pattern of patterns) {
      await this.updatePatternConfidence(
        pattern.id,
        evaluation.reward,
        evaluation.success
      );
    }

    // Store new patterns if successful
    if (evaluation.success && evaluation.reward > 0.8) {
      await this.consolidateIntoSkill(task, result, patterns);
    }

    // Discover causal relationships
    await this.discoverCausalEdges(task, result, evaluation);
  }

  async storeReflexionEpisode(episode) {
    const content = `
      Task: ${episode.task.description}
      Outcome: ${episode.result.summary}
      Critique: ${episode.evaluation.critique}
    `;

    const embedding = await this.generateEmbedding(content);

    await agentdb_insert(this.agentdb, embedding, {
      id: `episode-${Date.now()}`,
      type: 'reflexion_episode',
      task: episode.task,
      result: episode.result,
      evaluation: episode.evaluation,
      patterns_used: episode.patterns.map(p => p.id),
      reward: episode.evaluation.reward,
      timestamp: new Date().toISOString()
    });
  }

  async updatePatternConfidence(patternId, reward, success) {
    const pattern = await this.getPattern(patternId);

    // Bayesian update
    if (success) {
      pattern.confidence = Math.min(pattern.confidence * 1.20, 0.95);
    } else {
      pattern.confidence = Math.max(pattern.confidence * 0.85, 0.05);
    }

    await this.updatePattern(pattern);
  }

  async consolidateIntoSkill(task, result, patterns) {
    const skill = {
      id: `skill-${Date.now()}`,
      type: 'skill',
      name: task.description,
      implementation: result.approach,
      patterns_used: patterns.map(p => p.id),
      success_rate: 1.0,
      usage_count: 1,
      created: new Date().toISOString()
    };

    const embedding = await this.generateEmbedding(
      `${skill.name}: ${skill.implementation}`
    );

    await agentdb_insert(this.agentdb, embedding, skill);
  }

  async discoverCausalEdges(task, result, evaluation) {
    // Identify what actions caused the outcome
    for (const action of result.actions) {
      const causalEdge = {
        id: `causal-${Date.now()}`,
        type: 'causal_edge',
        action: action.description,
        outcome: evaluation.success ? 'success' : 'failure',
        confidence: evaluation.reward,
        context: task.domain,
        timestamp: new Date().toISOString()
      };

      const embedding = await this.generateEmbedding(
        `${causalEdge.action} causes ${causalEdge.outcome}`
      );

      await agentdb_insert(this.agentdb, embedding, causalEdge);
    }
  }
}

// Usage
const safla = new SAFLAEngine(agentdb);

// Run SAFLA cycle
const result = await safla.runCycle(
  {
    description: 'Implement user authentication',
    domain: 'backend',
    expectedOutcome: { tasks: 5, quality: 0.9 }
  },
  async (task, patterns) => {
    // Execute task with pattern guidance
    console.log('Using patterns:', patterns.map(p => p.metadata.name));

    // ... implementation ...

    return {
      completed: 5,
      quality_score: 0.92,
      actual_time: 45,
      summary: 'Successfully implemented JWT authentication',
      successFactors: ['Used proven JWT pattern', 'Added refresh tokens'],
      actions: [
        { description: 'Implemented JWT verification middleware' },
        { description: 'Added refresh token rotation' }
      ]
    };
  }
);
```

---

## Multi-Agent Coordination

**Pattern: Shared Memory for Agent Collaboration**

```javascript
class AgentCoordinator {
  constructor(agentdb) {
    this.agentdb = agentdb;
    this.agents = new Map();
  }

  async registerAgent(agentId, capabilities) {
    this.agents.set(agentId, {
      id: agentId,
      capabilities,
      status: 'idle',
      tasks: []
    });

    // Store agent in shared memory
    await this.storeAgentInfo(agentId, capabilities);
  }

  async coordinateTask(task) {
    // Find relevant agents
    const agents = await this.findCapableAgents(task);

    // Distribute subtasks
    const subtasks = this.splitTask(task, agents.length);

    // Execute in parallel
    const results = await Promise.all(
      subtasks.map((subtask, i) =>
        this.executeSubtask(agents[i], subtask)
      )
    );

    // Consolidate results
    return this.consolidateResults(results);
  }

  async findCapableAgents(task) {
    const embedding = await this.generateEmbedding(
      task.requirements.join(' ')
    );

    const results = await agentdb_search(this.agentdb, embedding, {
      k: 5,
      threshold: 0.7,
      filter: { type: 'agent', status: 'idle' }
    });

    return results.map(r => r.metadata.id);
  }

  async executeSubtask(agentId, subtask) {
    // Update agent status
    await this.updateAgentStatus(agentId, 'working', subtask);

    // Agent retrieves relevant patterns
    const patterns = await this.getRelevantPatterns(subtask);

    // Execute subtask (actual implementation)
    const result = await this.executeWithAgent(agentId, subtask, patterns);

    // Store result in shared memory
    await this.storeSubtaskResult(agentId, subtask, result);

    // Update agent status
    await this.updateAgentStatus(agentId, 'idle', null);

    return result;
  }

  async getRelevantPatterns(subtask) {
    const embedding = await this.generateEmbedding(subtask.description);

    return await agentdb_search(this.agentdb, embedding, {
      k: 10,
      threshold: 0.75
    });
  }

  async storeSubtaskResult(agentId, subtask, result) {
    const embedding = await this.generateEmbedding(
      `${subtask.description}: ${result.summary}`
    );

    await agentdb_insert(this.agentdb, embedding, {
      id: `result-${agentId}-${Date.now()}`,
      type: 'subtask_result',
      agent: agentId,
      subtask: subtask,
      result: result,
      timestamp: new Date().toISOString()
    });
  }

  async updateAgentStatus(agentId, status, currentTask) {
    const agent = this.agents.get(agentId);
    agent.status = status;
    agent.currentTask = currentTask;

    // Update in shared memory
    const embedding = await this.generateEmbedding(
      `Agent ${agentId} capabilities: ${agent.capabilities.join(', ')}`
    );

    await agentdb_delete(this.agentdb, {
      filter: { type: 'agent', id: agentId }
    });

    await agentdb_insert(this.agentdb, embedding, {
      id: agentId,
      type: 'agent',
      capabilities: agent.capabilities,
      status: status,
      currentTask: currentTask
    });
  }
}

// Usage
const coordinator = new AgentCoordinator(agentdb);

// Register agents
await coordinator.registerAgent('agent-researcher', ['research', 'analysis']);
await coordinator.registerAgent('agent-coder', ['coding', 'testing']);
await coordinator.registerAgent('agent-reviewer', ['review', 'quality-check']);

// Coordinate complex task
const result = await coordinator.coordinateTask({
  description: 'Build REST API with authentication',
  requirements: ['research', 'coding', 'testing', 'review']
});
```

---

## Migration Strategies

### Strategy 1: Gradual Migration (Recommended)

**Phase 1: Hybrid Mode (Weeks 1-2)**
```javascript
// Start with hybrid mode - zero risk
const memory = new AgentDBMemoryAdapter({
  mode: 'hybrid',  // AgentDB + ReasoningBank
  gracefulDegradation: true  // Fall back if issues
});

// Use existing code unchanged
await memory.store('key', 'value', { namespace: 'app' });
await memory.retrieve('key', { namespace: 'app' });
```

**Phase 2: Parallel Testing (Weeks 3-4)**
```javascript
// Test AgentDB alongside existing system
class ParallelTester {
  async store(key, value, options) {
    const [legacy, agentdb] = await Promise.all([
      this.legacyMemory.store(key, value, options),
      this.agentdbMemory.store(key, value, options)
    ]);

    // Compare results
    this.compareAndLog(legacy, agentdb);

    return legacy;  // Still using legacy in production
  }
}
```

**Phase 3: Gradual Rollout (Weeks 5-8)**
```javascript
// Route percentage of traffic to AgentDB
class GradualRollout {
  constructor(legacyMemory, agentdbMemory, rolloutPercent = 0) {
    this.legacyMemory = legacyMemory;
    this.agentdbMemory = agentdbMemory;
    this.rolloutPercent = rolloutPercent;  // Start at 0%, increase gradually
  }

  async query(input, options) {
    if (Math.random() * 100 < this.rolloutPercent) {
      return await this.agentdbMemory.query(input, options);
    } else {
      return await this.legacyMemory.query(input, options);
    }
  }

  increaseRollout(percent) {
    this.rolloutPercent = Math.min(this.rolloutPercent + percent, 100);
    console.log(`Rollout increased to ${this.rolloutPercent}%`);
  }
}

// Gradual increase: 10% → 25% → 50% → 75% → 100%
```

**Phase 4: Full Migration (Week 9+)**
```javascript
// Switch to pure AgentDB mode
const memory = new AgentDBMemoryAdapter({
  mode: 'agentdb',  // Pure AgentDB
  quantization: 'scalar',
  enableHNSW: true
});
```

---

## API Integration Patterns

### Pattern: RESTful API Wrapper

```javascript
import express from 'express';
import { agentdb_init, agentdb_search, agentdb_insert } from 'agentdb';

const app = express();
const db = agentdb_init('./api.db', {
  enableHNSW: true,
  quantization: 'scalar'
});

// Search endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query, k = 10, threshold = 0.7, filter = {} } = req.body;

    // Generate embedding
    const embedding = await generateEmbedding(query);

    // Search
    const results = await agentdb_search(db, embedding, {
      k,
      threshold,
      filter
    });

    res.json({
      success: true,
      results: results.map(r => ({
        id: r.id,
        score: r.score,
        metadata: r.metadata
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store endpoint
app.post('/api/patterns', async (req, res) => {
  try {
    const { id, text, metadata } = req.body;

    const embedding = await generateEmbedding(text);

    await agentdb_insert(db, embedding, { id, ...metadata });

    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3000, () => {
  console.log('AgentDB API running on port 3000');
});
```

---

## Testing & Validation

### Pattern: Integration Test Suite

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { agentdb_init, agentdb_search, agentdb_insert_batch } from 'agentdb';

describe('AgentDB Integration', () => {
  let db;

  beforeAll(async () => {
    db = agentdb_init(':memory:', {
      enableHNSW: true,
      quantization: 'scalar'
    });

    // Seed test data
    await seedTestData(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should perform semantic search', async () => {
    const query = await generateEmbedding('authentication');
    const results = await agentdb_search(db, query, { k: 5 });

    expect(results).toHaveLength(5);
    expect(results[0].score).toBeGreaterThan(0.7);
  });

  it('should filter by metadata', async () => {
    const query = await generateEmbedding('backend patterns');
    const results = await agentdb_search(db, query, {
      k: 10,
      filter: { domain: 'backend', language: 'javascript' }
    });

    results.forEach(r => {
      expect(r.metadata.domain).toBe('backend');
      expect(r.metadata.language).toBe('javascript');
    });
  });

  it('should handle batch operations', async () => {
    const vectors = generateTestVectors(1000);
    const start = Date.now();

    await agentdb_insert_batch(db, vectors);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(100);  // Should be < 100ms
  });

  it('should meet performance targets', async () => {
    const query = await generateEmbedding('test query');
    const iterations = 100;
    const start = Date.now();

    for (let i = 0; i < iterations; i++) {
      await agentdb_search(db, query, { k: 10 });
    }

    const duration = Date.now() - start;
    const avgLatency = duration / iterations;

    expect(avgLatency).toBeLessThan(20);  // < 20ms per search
  });
});
```

---

## Summary

This guide covered:

✅ **Claude Flow Integration** - CLI, MCP, SDK patterns
✅ **Hybrid Memory Systems** - Router, sync, reranking
✅ **Real-World Use Cases** - Code library, research KB
✅ **SAFLA Implementation** - Continuous learning cycle
✅ **Multi-Agent Coordination** - Shared memory patterns
✅ **Migration Strategies** - Gradual, safe rollout
✅ **API Integration** - RESTful wrapper patterns
✅ **Testing** - Integration test suites

---

## Next Steps

- ✅ You understand integration patterns
- → Implement: Hybrid memory system
- → Test: Performance with your data
- → Deploy: Gradual rollout strategy
- → Monitor: Track metrics and optimize

---

**Questions?**
- GitHub: https://github.com/ruvnet/agentic-flow/issues
- Author: Reuven Cohen (@ruvnet)

---

Last Updated: November 12, 2025
