# ruv-swarm Workflow Patterns

This document outlines proven workflow patterns for using ruv-swarm coordination with Claude Code across different development scenarios.

## 🏗️ Development Workflow Patterns

### Pattern 1: Rapid Prototyping Workflow

**Use Case**: Quick proof-of-concept development
**Topology**: Star (centralized coordination)
**Agent Count**: 3-5 agents

```javascript
// Step 1: Initialize rapid prototype swarm
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "star", 
    maxAgents: 4, 
    strategy: "development",
    mode: "rapid-prototype" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Prototype Designer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Full-Stack Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Quick Tester" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Prototype Manager" })
  
  TodoWrite({ todos: [
    { id: "mvp_design", content: "Design minimal viable prototype", status: "in_progress", priority: "high" },
    { id: "core_features", content: "Implement core functionality", status: "pending", priority: "high" },
    { id: "basic_tests", content: "Add basic validation tests", status: "pending", priority: "medium" }
  ]})

// Step 2: Rapid implementation
[BatchTool]:
  Bash("mkdir -p prototype/{src,tests}")
  Write("prototype/package.json", minimalPackageJson)
  Write("prototype/src/index.js", corePrototype)
  Write("prototype/tests/basic.test.js", basicTests)
  Bash("cd prototype && npm install && npm test")
```

### Pattern 2: Enterprise Development Workflow

**Use Case**: Large-scale enterprise application
**Topology**: Hierarchical (structured teams)
**Agent Count**: 8-15 agents

```javascript
// Step 1: Enterprise swarm initialization
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "hierarchical", 
    maxAgents: 12, 
    strategy: "development",
    compliance: "enterprise",
    security: "strict" 
  })
  
  // Leadership tier
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Solution Architect" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Tech Lead" })
  
  // Development tiers
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Backend Lead" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Frontend Lead" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "API Developer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Database Developer" })
  
  // Quality tiers
  mcp__claude-flow__agent_spawn({ type: "tester", name: "QA Lead" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Security Tester" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Code Reviewer" })
  
  // Operations tier
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "DevOps Engineer" })
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Technical Writer" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Performance Analyst" })
```

### Pattern 3: Microservices Development Workflow

**Use Case**: Distributed microservices architecture
**Topology**: Mesh (service-to-service communication)
**Agent Count**: 6-10 agents per service

```javascript
// Step 1: Microservices mesh coordination
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "mesh", 
    maxAgents: 18, 
    strategy: "development",
    architecture: "microservices",
    communication: "async-messaging" 
  })
  
  // Service teams (per service: architect, coder, tester)
  // User Service Team
  mcp__claude-flow__agent_spawn({ type: "architect", name: "User Service Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "User Service Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "User Service Tester" })
  
  // Payment Service Team
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Payment Service Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Payment Service Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Payment Service Tester" })
  
  // Order Service Team
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Order Service Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Order Service Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Order Service Tester" })
  
  // Cross-cutting concerns
  mcp__claude-flow__agent_spawn({ type: "architect", name: "API Gateway Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Gateway Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Integration Tester" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Service Monitor" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Microservices Coordinator" })
  
  // Store service boundaries and dependencies
  mcp__claude-flow__memory_usage({
    action: "store",
    key: "microservices/architecture/boundaries",
    value: {
      services: ["user", "payment", "order", "gateway"],
      dependencies: {
        "payment": ["user"],
        "order": ["user", "payment"],
        "gateway": ["user", "payment", "order"]
      },
      communication: "event-driven"
    }
  })
```

## 🔬 Research Workflow Patterns

### Pattern 1: Systematic Literature Review

**Use Case**: Academic or technical research
**Topology**: Mesh (collaborative research)
**Agent Count**: 4-6 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "mesh", 
    maxAgents: 6, 
    strategy: "research",
    methodology: "systematic-review" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Literature Searcher" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Paper Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Data Synthesizer" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Quality Assessor" })
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Report Writer" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Research Lead" })
  
  // Define research phases
  TodoWrite({ todos: [
    { id: "search_strategy", content: "Define search terms and databases", status: "in_progress", priority: "high" },
    { id: "paper_collection", content: "Collect relevant papers", status: "pending", priority: "high" },
    { id: "screening", content: "Screen papers for relevance", status: "pending", priority: "high" },
    { id: "data_extraction", content: "Extract data from selected papers", status: "pending", priority: "medium" },
    { id: "synthesis", content: "Synthesize findings", status: "pending", priority: "medium" },
    { id: "report", content: "Write systematic review report", status: "pending", priority: "medium" }
  ]})
```

### Pattern 2: Market Research and Analysis

**Use Case**: Business intelligence gathering
**Topology**: Star (centralized analysis)
**Agent Count**: 5-7 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "star", 
    maxAgents: 7, 
    strategy: "research",
    focus: "market-analysis" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Market Researcher" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Competitor Analyst" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Trend Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Data Scientist" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Consumer Insights" })
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Report Specialist" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Research Director" })
```

## 🧪 Testing Workflow Patterns

### Pattern 1: Comprehensive Test Suite Development

**Use Case**: Full testing pyramid implementation
**Topology**: Hierarchical (test layers)
**Agent Count**: 6-8 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "hierarchical", 
    maxAgents: 8, 
    strategy: "testing",
    coverage: "comprehensive" 
  })
  
  // Test management tier
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Test Manager" })
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Test Architect" })
  
  // Test implementation tier
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Unit Test Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Integration Test Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "E2E Test Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Performance Test Developer" })
  
  // Quality assurance tier
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Test Reviewer" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Coverage Analyst" })
  
  // Test strategy definition
  mcp__claude-flow__memory_usage({
    action: "store",
    key: "testing/strategy/pyramid",
    value: {
      layers: ["unit", "integration", "e2e", "performance"],
      targets: {
        unit: "80%",
        integration: "60%", 
        e2e: "40%",
        performance: "critical-paths"
      },
      tools: ["jest", "supertest", "cypress", "artillery"]
    }
  })
```

### Pattern 2: Bug Investigation and Resolution

**Use Case**: Critical bug analysis and fixing
**Topology**: Ring (collaborative debugging)
**Agent Count**: 4-5 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "ring", 
    maxAgents: 5, 
    strategy: "debugging",
    priority: "critical" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "debugger", name: "Bug Investigator" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Root Cause Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Fix Implementer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Fix Validator" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Bug Manager" })
```

## 🚀 Deployment Workflow Patterns

### Pattern 1: CI/CD Pipeline Development

**Use Case**: Automated deployment pipeline
**Topology**: Hierarchical (pipeline stages)
**Agent Count**: 6-10 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "hierarchical", 
    maxAgents: 10, 
    strategy: "deployment",
    automation: "full-cicd" 
  })
  
  // Pipeline design tier
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Pipeline Architect" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "DevOps Lead" })
  
  // Build and test tier
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Build Engineer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Pipeline Tester" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Quality Gate Analyst" })
  
  // Deployment tier
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Deployment Engineer" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Deployment Monitor" })
  
  // Operations tier
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Infrastructure Analyst" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Performance Monitor" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Release Manager" })
```

### Pattern 2: Blue-Green Deployment

**Use Case**: Zero-downtime production deployment
**Topology**: Star (centralized orchestration)
**Agent Count**: 4-6 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "star", 
    maxAgents: 6, 
    strategy: "deployment",
    pattern: "blue-green" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Deployment Controller" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Environment Manager" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Smoke Test Engineer" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Health Monitor" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Traffic Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Rollback Coordinator" })
```

## 🔄 Maintenance Workflow Patterns

### Pattern 1: Technical Debt Resolution

**Use Case**: Systematic codebase improvement
**Topology**: Mesh (collaborative refactoring)
**Agent Count**: 5-8 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "mesh", 
    maxAgents: 8, 
    strategy: "maintenance",
    focus: "technical-debt" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Debt Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Refactoring Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Refactoring Developer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Regression Tester" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Code Quality Reviewer" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Metrics Tracker" })
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Documentation Updater" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Debt Manager" })
```

### Pattern 2: Security Audit and Hardening

**Use Case**: Comprehensive security review
**Topology**: Hierarchical (security layers)
**Agent Count**: 6-9 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "hierarchical", 
    maxAgents: 9, 
    strategy: "security",
    compliance: "enterprise" 
  })
  
  // Security leadership
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Security Lead" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Threat Modeler" })
  
  // Code security tier
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Security Code Reviewer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Penetration Tester" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Vulnerability Scanner" })
  
  // Infrastructure security tier
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Infrastructure Auditor" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Security Engineer" })
  
  // Compliance tier
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Compliance Documenter" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Security Monitor" })
```

## 📊 Data Science Workflow Patterns

### Pattern 1: ML Model Development

**Use Case**: Machine learning pipeline creation
**Topology**: Star (data-centric)
**Agent Count**: 6-8 agents

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ 
    topology: "star", 
    maxAgents: 8, 
    strategy: "analysis",
    domain: "machine-learning" 
  })
  
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "ML Lead" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Data Scientist" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "ML Engineer" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Feature Engineer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "Model Validator" })
  mcp__claude-flow__agent_spawn({ type: "monitor", name: "Performance Monitor" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "MLOps Engineer" })
  mcp__claude-flow__agent_spawn({ type: "documenter", name: "Model Documenter" })
```

## 🎯 Workflow Pattern Selection Guide

### By Project Size:
- **Small (1-5 developers)**: Star topology, 3-5 agents
- **Medium (5-15 developers)**: Hierarchical topology, 6-10 agents  
- **Large (15+ developers)**: Mesh topology, 10-20 agents

### By Project Type:
- **Greenfield**: Rapid prototyping → Enterprise development
- **Legacy Modernization**: Technical debt → Refactoring patterns
- **Microservices**: Mesh topology with service teams
- **Research Projects**: Collaborative research patterns

### By Timeline:
- **Urgent (< 1 week)**: Star topology, minimal agents
- **Standard (1-4 weeks)**: Hierarchical topology, balanced teams
- **Long-term (1+ months)**: Mesh topology, specialized teams

### By Complexity:
- **Simple**: 3-5 agents, star topology
- **Complex**: 8-12 agents, hierarchical topology
- **Highly Complex**: 12+ agents, mesh topology

## 🔧 Pattern Customization

### Custom Topology Creation

```javascript
// Define custom hybrid topology
mcp__claude-flow__swarm_init({ 
  topology: "hybrid",
  customStructure: {
    core: ["architect", "coordinator"],
    teams: {
      frontend: ["ui-designer", "react-dev", "css-specialist"],
      backend: ["api-dev", "db-architect", "auth-specialist"],
      quality: ["qa-lead", "test-automator", "performance-tester"]
    },
    connections: {
      "core": ["all-teams"],
      "frontend": ["backend", "quality"],
      "backend": ["quality"]
    }
  }
})
```

### Dynamic Agent Scaling

```javascript
// Auto-scale agents based on workload
mcp__claude-flow__agent_spawn({ 
  type: "auto-scaler", 
  name: "Workload Manager",
  config: {
    minAgents: 4,
    maxAgents: 20,
    scaleUpThreshold: "75%",
    scaleDownThreshold: "25%",
    scaleUpBy: 2,
    scaleDownBy: 1
  }
})
```

## 📈 Performance Monitoring

### Workflow Metrics Tracking

```javascript
// Track workflow performance
mcp__claude-flow__memory_usage({
  action: "store",
  key: "workflow/metrics/performance",
  value: {
    pattern: "enterprise-development",
    startTime: Date.now(),
    expectedDuration: "2 weeks",
    milestones: [
      { name: "architecture", target: "day 2", completed: false },
      { name: "implementation", target: "week 1", completed: false },
      { name: "testing", target: "day 10", completed: false },
      { name: "deployment", target: "week 2", completed: false }
    ],
    kpis: {
      codeQuality: "target: 90%",
      testCoverage: "target: 85%",
      performanceScore: "target: 95/100"
    }
  }
})
```

---

These workflow patterns provide proven approaches for different development scenarios. Choose and customize patterns based on your specific project requirements, team size, and timeline constraints.