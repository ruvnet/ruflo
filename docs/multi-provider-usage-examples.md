# Multi-Provider Routing: Practical Usage Examples

This document provides comprehensive examples of how the multi-provider routing strategy would work in practice with the claude-flow tool-gating proxy system.

## Example 1: Research-Heavy Query

### Scenario
A user asks: "Research microservices architecture patterns for e-commerce platforms with 1M+ users, including performance considerations, data consistency patterns, and deployment strategies"

### Query Classification
```json
{
  "type": "research",
  "complexity": 0.88,
  "domains": ["architecture", "microservices", "e-commerce", "performance", "data"],
  "urgency": "medium",
  "context_size": 1845,
  "technical_depth": 0.85,
  "requires_creativity": 0.4,
  "estimated_tokens": 615
}
```

### Provider Scoring Process

#### Gemini Scoring
```
Base research capability: 0.9 × 30 = 27 points
Complex research bonus: +15 points (complexity > 0.7)
Architectural domain match: +10 points
Large context handling: +10 points (1845 > 1000)
Technical depth bonus: 0.85 × 8 = 6.8 points
Load balancing: -2 points (current load)
Final Score: 66.8 points
```

#### Qwen Scoring
```
Base capability for research: 8 points
Technical depth bonus: 0.85 × 15 = 12.75 points
Architecture domain: +5 points (secondary strength)
Cost efficiency: 0.8 × 5 = 4 points
Load balancing: +3 points (low load)
Final Score: 32.75 points
```

#### Claude Scoring
```
Base capability for research: 12 points
Synthesis capability: 0.9 × 10 = 9 points
Multi-domain coordination: 0.95 × 8 = 7.6 points
Always available bonus: +5 points
Load balancing: -1 point
Final Score: 32.6 points
```

### Routing Decision
```json
{
  "primary": "gemini",
  "secondary": "claude",
  "requires_consensus": false,
  "routing_confidence": 0.92,
  "estimated_total_cost": 0.18,
  "estimated_total_time": 2500,
  "selection_reasoning": "Gemini's superior research capabilities, complex research task bonus, architectural domain match"
}
```

### Expected Execution Flow
1. **Query routed to Gemini Pro** for comprehensive research
2. **Response processed** including performance patterns, data consistency approaches, deployment strategies
3. **Claude synthesis** for architectural coherence and practical recommendations
4. **Tool gating applied** to final synthesized response
5. **Relevant tools selected** (approximately 4-6 architecture and deployment tools)

### Expected Output Quality
- Comprehensive research covering all requested aspects
- Performance benchmarks and case studies
- Practical implementation guidance
- Cost: ~$0.18, Time: ~2.5 seconds

---

## Example 2: Implementation Query

### Scenario
A user asks: "Implement OAuth2 authentication middleware for Express.js with JWT tokens, refresh token rotation, and proper error handling"

### Query Classification
```json
{
  "type": "implementation",
  "complexity": 0.75,
  "domains": ["authentication", "nodejs", "api", "security"],
  "urgency": "high",
  "context_size": 987,
  "technical_depth": 0.9,
  "requires_creativity": 0.3,
  "estimated_tokens": 329
}
```

### Provider Scoring Process

#### Qwen Scoring
```
Base implementation capability: 0.9 × 35 = 31.5 points
High technical depth: +15 points
API development domain: +12 points
Security domain: +8 points
High urgency implementation: +8 points
Cost efficiency: 0.8 × 5 = 4 points
Load balancing: +2 points
Final Score: 80.5 points
```

#### Gemini Scoring
```
Base capability for implementation: 10 points
Security domain: +8 points
Technical depth: 0.9 × 10 = 9 points
Cost efficiency: 0.7 × 5 = 3.5 points
Load balancing: -3 points (higher load)
Final Score: 37.5 points
```

#### Claude Scoring
```
Base capability for implementation: 12 points
Security considerations: +8 points
Code synthesis: 0.9 × 8 = 7.2 points
Always available: +5 points
Load balancing: 0 points
Final Score: 32.2 points
```

### Routing Decision
```json
{
  "primary": "qwen",
  "secondary": "claude",
  "requires_consensus": false,
  "routing_confidence": 0.89,
  "estimated_total_cost": 0.11,
  "estimated_total_time": 1800,
  "selection_reasoning": "Qwen's excellent implementation capabilities, high technical depth match, API development expertise"
}
```

### Expected Execution Flow
1. **Query routed to Qwen** for implementation expertise
2. **Complete middleware implementation** with OAuth2, JWT, refresh rotation
3. **Claude code review** for security best practices and error handling
4. **Tool gating applied** to implementation code
5. **Relevant tools selected** (authentication, security, testing tools)

### Expected Output Quality
- Production-ready middleware code
- Comprehensive error handling
- Security best practices
- Cost: ~$0.11, Time: ~1.8 seconds

---

## Example 3: Critical Architecture Decision

### Scenario
A user asks: "We have a monolithic application serving 500K users with increasing performance issues. Should we migrate to microservices? Consider our team size (12 developers), budget constraints, timeline (6 months), and current tech stack (Django, PostgreSQL, Redis)"

### Query Classification
```json
{
  "type": "consensus",
  "complexity": 0.95,
  "domains": ["architecture", "scalability", "migration", "performance", "team_management"],
  "urgency": "critical",
  "context_size": 2156,
  "technical_depth": 0.8,
  "requires_creativity": 0.6,
  "estimated_tokens": 719
}
```

### Provider Scoring Process
```
All providers score highly due to critical nature and complexity
Consensus automatically triggered due to:
- Critical urgency level
- High complexity (0.95)
- Multiple domains (5)
- Strategic business decision
```

### Routing Decision
```json
{
  "primary": "gemini",
  "requires_consensus": true,
  "consensus_providers": ["gemini", "qwen", "claude"],
  "routing_confidence": 0.78,
  "estimated_total_cost": 0.42,
  "estimated_total_time": 4500,
  "selection_reasoning": "Critical strategic decision requiring multi-perspective validation"
}
```

### Multi-Provider Execution

#### Gemini Analysis
- **Strategic perspective**: Market trends, architectural patterns, team readiness assessment
- **Risk analysis**: Migration risks, business continuity considerations
- **Timeline evaluation**: Realistic migration phases with team capacity

#### Qwen Analysis  
- **Technical implementation**: Code migration complexity, performance benchmarks
- **Infrastructure requirements**: Deployment, monitoring, debugging strategies
- **Development workflow**: CI/CD changes, testing strategies

#### Claude Analysis
- **Coordination synthesis**: Balancing strategic and technical perspectives
- **Team dynamics**: Change management, skill development requirements
- **Decision framework**: Structured recommendation with confidence levels

### Consensus Building Process
```json
{
  "algorithm": "weighted_voting",
  "provider_weights": {
    "gemini": 1.2,
    "qwen": 1.1, 
    "claude": 1.1
  },
  "initial_responses": 3,
  "conflicts_detected": 1,
  "resolution_method": "iterative_refinement"
}
```

### Expected Consensus Result
```json
{
  "consensus_reached": true,
  "final_recommendation": "Hybrid approach: Start with service extraction for high-load components while maintaining monolith core",
  "confidence": 0.84,
  "agreement_score": 0.78,
  "supporting_evidence": [
    "Team size sufficient for hybrid approach",
    "6-month timeline realistic for partial migration",
    "Django monolith can coexist with extracted services",
    "PostgreSQL supports both architectures"
  ],
  "implementation_phases": [
    "Phase 1: Extract user service (2 months)",
    "Phase 2: Extract payment service (2 months)", 
    "Phase 3: Evaluate and plan next services (2 months)"
  ]
}
```

### Expected Output Quality
- Balanced strategic and technical recommendation
- Risk-aware implementation plan
- Team capacity considerations
- Cost: ~$0.42, Time: ~4.5 seconds

---

## Example 4: Performance Debugging

### Scenario
A user asks: "Our distributed Node.js application has latency spikes during peak hours. We're seeing 95th percentile response times jump from 200ms to 2000ms. The system uses microservices with MongoDB, Redis cache, and nginx load balancer. Help debug this issue."

### Query Classification
```json
{
  "type": "debugging",
  "complexity": 0.82,
  "domains": ["performance", "debugging", "distributed_systems", "nodejs", "mongodb"],
  "urgency": "high",
  "context_size": 1543,
  "technical_depth": 0.88,
  "requires_creativity": 0.5,
  "estimated_tokens": 514
}
```

### Provider Scoring and Routing Decision
```json
{
  "primary": "qwen",
  "secondary": "gemini",
  "requires_consensus": true,
  "consensus_providers": ["qwen", "gemini"],
  "routing_confidence": 0.85,
  "selection_reasoning": "Complex debugging requires technical expertise (Qwen) and analytical insights (Gemini)"
}
```

### Multi-Provider Debugging Approach

#### Qwen Analysis
- **Code-level debugging**: Identify performance bottlenecks in Node.js code
- **Database optimization**: MongoDB query performance, indexing issues
- **Cache analysis**: Redis hit rates, eviction policies
- **Resource utilization**: Memory leaks, CPU spikes, connection pooling

#### Gemini Analysis
- **System-level patterns**: Distributed system bottlenecks, cascade failures
- **Load analysis**: Traffic patterns, scaling thresholds
- **Architecture review**: Service dependencies, communication overhead
- **Monitoring strategy**: Observability gaps, metric collection

### Expected Debugging Results
```json
{
  "primary_issues": [
    "MongoDB connection pool exhaustion during peak load",
    "Redis cache invalidation storms causing database load",
    "Inadequate nginx worker processes for concurrent connections"
  ],
  "optimization_recommendations": [
    "Increase MongoDB connection pool size",
    "Implement cache warming strategy",
    "Configure nginx worker_processes = auto",
    "Add circuit breakers for service calls"
  ],
  "monitoring_improvements": [
    "Add connection pool metrics",
    "Track cache hit/miss ratios",
    "Monitor request queue depths"
  ],
  "confidence": 0.87
}
```

---

## Example 5: SuperClaude Command Integration

### Scenario: Multi-Provider Swarm Command

#### Command Usage
```bash
/sc:swarm "Build comprehensive REST API documentation" --multi-provider --consensus-validation
```

#### Enhanced Command Processing
```typescript
// SuperClaude command would internally use multi-provider routing
async function executeSwarmWithMultiProvider(objective: string, options: SwarmOptions) {
  const multiProviderGating = new MultiProviderGatingService(discoveryService, providerRouter, consensusBuilder);
  
  // Step 1: Classify the swarm objective
  const classification = await classifySwarmObjective(objective);
  
  // Step 2: Determine swarm topology and provider assignment
  const swarmPlan = await planMultiProviderSwarm(classification, options);
  
  // Step 3: Execute swarm with provider specialization
  return await executeSwarmPlan(swarmPlan);
}
```

#### Swarm Provider Specialization
```json
{
  "swarm_topology": "hierarchical",
  "queen_coordinator": "claude",
  "specialist_agents": {
    "research_agent": "gemini",
    "implementation_agent": "qwen", 
    "coordination_agent": "claude",
    "validation_agent": "consensus:gemini+claude"
  },
  "task_distribution": {
    "api_design": "gemini",
    "code_examples": "qwen",
    "documentation_structure": "claude",
    "final_review": "consensus"
  }
}
```

### Scenario: Hive-Mind with Multi-Provider Consensus

#### Command Usage
```bash
/sc:hive-mind "Evaluate technology stack for new project" --diverse-perspectives --consensus-validation
```

#### Hive-Mind Provider Coordination
```typescript
class MultiProviderHiveMind extends HiveMindCore {
  async executeWithDiversePerspectives(objective: string) {
    // Each provider runs independent analysis
    const perspectives = await Promise.all([
      this.runGeminiPerspective(objective),   // Strategic analysis
      this.runQwenPerspective(objective),     // Technical evaluation  
      this.runClaudePerspective(objective)    // Integration synthesis
    ]);
    
    // Build consensus from diverse perspectives
    const consensus = await this.buildHiveMindConsensus(perspectives);
    
    // Coordinate implementation based on consensus
    return await this.coordinateImplementation(consensus);
  }
}
```

---

## Cost Optimization Examples

### Example 1: Budget-Constrained Query
```json
{
  "query": "Analyze code quality for large codebase",
  "budget_limit": 0.15,
  "provider_selection": {
    "original_choice": "gemini-pro",
    "cost_optimized_choice": "gemini-flash",
    "reasoning": "Flash model provides 70% of Pro quality at 40% of cost",
    "quality_trade_off": "Acceptable for code analysis tasks"
  }
}
```

### Example 2: Time-Sensitive Query
```json
{
  "query": "Quick bug fix for production issue",
  "time_limit": 30000,
  "provider_selection": {
    "primary": "qwen",
    "reasoning": "Fastest average response time for debugging tasks",
    "consensus_skipped": "Time constraint overrides consensus requirement"
  }
}
```

### Example 3: Quality-Critical Query
```json
{
  "query": "Security audit for payment processing system",
  "quality_threshold": 0.9,
  "provider_selection": {
    "requires_consensus": true,
    "consensus_providers": ["gemini-pro", "claude", "qwen"],
    "reasoning": "Security-critical task requires maximum validation",
    "cost_acceptance": "Quality priority overrides cost optimization"
  }
}
```

---

## Monitoring and Analytics Examples

### Real-Time Routing Dashboard
```json
{
  "current_routing_stats": {
    "total_queries_today": 1247,
    "provider_distribution": {
      "gemini": "45%",
      "qwen": "32%", 
      "claude": "23%"
    },
    "consensus_usage": "18%",
    "average_routing_confidence": 0.87,
    "cost_efficiency": 0.92
  },
  "performance_metrics": {
    "average_response_time": 2100,
    "success_rate": 0.987,
    "user_satisfaction": 0.91
  }
}
```

### Provider Performance Comparison
```json
{
  "research_tasks": {
    "gemini": {"quality": 0.94, "speed": 2.3, "cost": 0.18},
    "claude": {"quality": 0.82, "speed": 1.9, "cost": 0.15},
    "qwen": {"quality": 0.71, "speed": 1.6, "cost": 0.12}
  },
  "implementation_tasks": {
    "qwen": {"quality": 0.91, "speed": 1.8, "cost": 0.11},
    "claude": {"quality": 0.84, "speed": 2.1, "cost": 0.14},
    "gemini": {"quality": 0.76, "speed": 2.4, "cost": 0.16}
  }
}
```

These examples demonstrate how the multi-provider routing strategy provides intelligent, context-aware provider selection while maintaining cost efficiency and quality optimization. The system adapts to different query types, urgency levels, and quality requirements while providing transparent reasoning for all routing decisions.