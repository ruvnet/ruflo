# ruv-swarm Integration Examples

This document provides comprehensive examples of integrating ruv-swarm with Claude Code for enhanced coordination and productivity.

## 🚀 Complete Full-Stack Development Example

### Scenario: Building a REST API with Authentication, Database, and Tests

This example demonstrates the complete ruv-swarm coordination pattern for a complex development task.

#### Step 1: Initialize Swarm and Spawn All Agents (Single Message)

```javascript
// ✅ CORRECT: Everything in ONE message with BatchTool
[BatchTool - Message 1]:
  // Initialize swarm with optimal topology
  mcp__claude-flow__swarm_init({ 
    topology: "hierarchical", 
    maxAgents: 8, 
    strategy: "parallel",
    autoOptimize: true 
  })
  
  // Spawn ALL agents simultaneously
  mcp__claude-flow__agent_spawn({ type: "architect", name: "System Designer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "API Developer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Auth Expert" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "DB Designer" })
  mcp__claude-flow__agent_spawn({ type: "tester", name: "QA Engineer" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Tech Lead" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Project Manager" })
  
  // Create comprehensive todo list
  TodoWrite({ todos: [
    { id: "architecture", content: "Design API architecture and component interfaces", status: "in_progress", priority: "high" },
    { id: "database", content: "Design database schema and relationships", status: "pending", priority: "high" },
    { id: "auth", content: "Implement JWT authentication system", status: "pending", priority: "high" },
    { id: "api_endpoints", content: "Build REST API endpoints", status: "pending", priority: "high" },
    { id: "middleware", content: "Create middleware and validation", status: "pending", priority: "medium" },
    { id: "tests", content: "Write comprehensive test suite", status: "pending", priority: "medium" },
    { id: "documentation", content: "Generate API documentation", status: "pending", priority: "low" }
  ]})
  
  // Start orchestration
  mcp__claude-flow__task_orchestrate({ 
    task: "Build complete REST API system", 
    strategy: "parallel",
    dependencies: true 
  })
  
  // Store initial project context
  mcp__claude-flow__memory_usage({ 
    action: "store", 
    key: "project/api-system/init", 
    value: { 
      started: Date.now(),
      requirements: "REST API with auth, database, tests",
      technology: "Node.js, Express, JWT, PostgreSQL",
      deadline: "7 days"
    } 
  })
```

#### Step 2: Parallel Infrastructure Setup (Single Message)

```javascript
[BatchTool - Message 2]:
  // Create ALL directories simultaneously
  Bash("mkdir -p rest-api-system/{src,tests,docs,config,scripts}")
  Bash("mkdir -p rest-api-system/src/{models,routes,middleware,services,controllers}")
  Bash("mkdir -p rest-api-system/tests/{unit,integration,e2e}")
  
  // Initialize ALL base files at once
  Write("rest-api-system/package.json", packageJsonContent)
  Write("rest-api-system/.env.example", envExampleContent)
  Write("rest-api-system/README.md", readmeContent)
  Write("rest-api-system/src/server.js", serverBaseContent)
  Write("rest-api-system/src/config/database.js", dbConfigContent)
  Write("rest-api-system/src/config/auth.js", authConfigContent)
  
  // Store file creation progress
  mcp__claude-flow__memory_usage({ 
    action: "store", 
    key: "project/api-system/infrastructure", 
    value: { 
      directories: ["src", "tests", "docs", "config", "scripts"],
      baseFiles: ["package.json", "server.js", "database.js", "auth.js"],
      completed: Date.now()
    } 
  })
```

#### Step 3: Parallel Component Development (Single Message)

```javascript
[BatchTool - Message 3]:
  // Read context files for informed development
  Read("rest-api-system/package.json")
  Read("rest-api-system/src/config/database.js")
  Read("rest-api-system/src/config/auth.js")
  
  // Implement ALL core components simultaneously
  Write("rest-api-system/src/models/User.js", userModelContent)
  Write("rest-api-system/src/models/index.js", modelsIndexContent)
  Write("rest-api-system/src/middleware/auth.js", authMiddlewareContent)
  Write("rest-api-system/src/middleware/validation.js", validationContent)
  Write("rest-api-system/src/controllers/authController.js", authControllerContent)
  Write("rest-api-system/src/controllers/userController.js", userControllerContent)
  Write("rest-api-system/src/routes/auth.js", authRoutesContent)
  Write("rest-api-system/src/routes/users.js", userRoutesContent)
  Write("rest-api-system/src/services/authService.js", authServiceContent)
  
  // Update coordination memory
  mcp__claude-flow__memory_usage({ 
    action: "store", 
    key: "project/api-system/components", 
    value: { 
      models: ["User"],
      controllers: ["auth", "user"],
      middleware: ["auth", "validation"],
      routes: ["auth", "users"],
      services: ["auth"],
      progress: "85%"
    } 
  })
```

#### Step 4: Parallel Testing and Validation (Single Message)

```javascript
[BatchTool - Message 4]:
  // Create comprehensive test suite
  Write("rest-api-system/tests/unit/models/user.test.js", userModelTestContent)
  Write("rest-api-system/tests/unit/services/auth.test.js", authServiceTestContent)
  Write("rest-api-system/tests/integration/auth.test.js", authIntegrationTestContent)
  Write("rest-api-system/tests/integration/users.test.js", userIntegrationTestContent)
  Write("rest-api-system/tests/e2e/api.test.js", e2eTestContent)
  Write("rest-api-system/jest.config.js", jestConfigContent)
  
  // Run all validation commands
  Bash("cd rest-api-system && npm install")
  Bash("cd rest-api-system && npm run lint")
  Bash("cd rest-api-system && npm test")
  Bash("cd rest-api-system && npm run build")
  
  // Final coordination update
  mcp__claude-flow__memory_usage({ 
    action: "store", 
    key: "project/api-system/completion", 
    value: { 
      testsCreated: ["unit", "integration", "e2e"],
      allTestsPassing: true,
      lintPassing: true,
      buildSuccessful: true,
      readyForDeployment: true,
      completedAt: Date.now()
    } 
  })
```

## 🧠 Research Coordination Example

### Scenario: Comprehensive Technology Research

#### Step 1: Initialize Research Swarm

```javascript
[BatchTool]:
  mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 6, strategy: "research" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Literature Review" })
  mcp__claude-flow__agent_spawn({ type: "researcher", name: "Market Analysis" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Data Synthesizer" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Trend Analyzer" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Quality Checker" })
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Research Lead" })
  
  TodoWrite({ todos: [
    { id: "literature", content: "Conduct comprehensive literature review", status: "in_progress", priority: "high" },
    { id: "market", content: "Analyze current market trends", status: "pending", priority: "high" },
    { id: "synthesis", content: "Synthesize findings into insights", status: "pending", priority: "medium" },
    { id: "validation", content: "Validate research quality", status: "pending", priority: "medium" }
  ]})
```

#### Step 2: Parallel Research Execution

```javascript
[BatchTool]:
  // Parallel search and analysis
  WebSearch("latest trends in neural architecture search 2024")
  WebSearch("transformer model efficiency improvements")
  WebSearch("edge AI deployment strategies")
  
  // Store findings simultaneously
  mcp__claude-flow__memory_usage({ action: "store", key: "research/nas/trends", value: searchResults1 })
  mcp__claude-flow__memory_usage({ action: "store", key: "research/transformers/efficiency", value: searchResults2 })
  mcp__claude-flow__memory_usage({ action: "store", key: "research/edge-ai/deployment", value: searchResults3 })
  
  // Create research documentation
  Write("research-output/literature-review.md", literatureContent)
  Write("research-output/market-analysis.md", marketContent)
  Write("research-output/synthesis-report.md", synthesisContent)
```

## 🎯 Real-World Integration Patterns

### Pattern 1: Microservices Development

```javascript
// Initialize with hierarchical topology for complex systems
mcp__claude-flow__swarm_init({ topology: "hierarchical", maxAgents: 12, strategy: "development" })

// Service-specific agents
mcp__claude-flow__agent_spawn({ type: "architect", name: "System Architect" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "User Service Dev" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "Payment Service Dev" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "Notification Service Dev" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "API Gateway Dev" })
mcp__claude-flow__agent_spawn({ type: "analyst", name: "Database Architect" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "Integration Tester" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "Performance Tester" })
```

### Pattern 2: Data Pipeline Development

```javascript
// Mesh topology for data flow coordination
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 8, strategy: "analysis" })

// Data-focused agents
mcp__claude-flow__agent_spawn({ type: "analyst", name: "Data Architect" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "ETL Developer" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "Stream Processor" })
mcp__claude-flow__agent_spawn({ type: "analyst", name: "ML Pipeline Expert" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "Data Quality Tester" })
```

### Pattern 3: Frontend Application Development

```javascript
// Star topology with central UI coordinator
mcp__claude-flow__swarm_init({ topology: "star", maxAgents: 6, strategy: "development" })

// Frontend-specific agents
mcp__claude-flow__agent_spawn({ type: "designer", name: "UI/UX Designer" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "React Developer" })
mcp__claude-flow__agent_spawn({ type: "coder", name: "State Manager" })
mcp__claude-flow__agent_spawn({ type: "tester", name: "UI Tester" })
mcp__claude-flow__agent_spawn({ type: "optimizer", name: "Performance Optimizer" })
```

## 📊 Memory Coordination Patterns

### Hierarchical Memory Structure

```javascript
// Project-level memory
mcp__claude-flow__memory_usage({
  action: "store",
  key: "project/microservices/architecture",
  value: {
    services: ["user", "payment", "notification", "gateway"],
    databases: ["userDB", "paymentDB", "notificationQueue"],
    communication: "async-messaging",
    deployment: "kubernetes"
  }
})

// Service-specific memory
mcp__claude-flow__memory_usage({
  action: "store", 
  key: "project/microservices/services/user/api",
  value: {
    endpoints: ["/users", "/users/:id", "/users/profile"],
    authentication: "JWT",
    validation: "joi",
    database: "PostgreSQL"
  }
})

// Cross-service dependencies
mcp__claude-flow__memory_usage({
  action: "store",
  key: "project/microservices/dependencies",
  value: {
    "user-service": ["gateway"],
    "payment-service": ["user-service", "notification-service"],
    "notification-service": ["user-service"]
  }
})
```

### Task Progress Tracking

```javascript
// Track individual agent progress
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/agents/user-service-dev/progress",
  value: {
    currentTask: "implementing user CRUD operations",
    completed: ["user model", "user routes", "user controller"],
    inProgress: ["user service layer"],
    blocked: [],
    estimatedCompletion: "2 hours"
  }
})

// Track overall project status
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/project/status",
  value: {
    totalTasks: 25,
    completed: 18,
    inProgress: 5,
    blocked: 2,
    overallProgress: "72%",
    criticalPath: ["payment-service", "integration-tests"]
  }
})
```

## 🔧 Advanced Coordination Hooks

### Pre-Task Coordination

```bash
# Before starting any major task
npx ruv-swarm hook pre-task \
  --description "Implementing user authentication system" \
  --dependencies "database,jwt-config" \
  --estimated-time "3h" \
  --auto-spawn-agents true
```

### Real-Time Progress Updates

```bash
# After each significant step
npx ruv-swarm hook post-edit \
  --file "src/auth/authController.js" \
  --memory-key "auth/controller/implementation" \
  --progress "75%" \
  --next-steps "add input validation,implement logout"
```

### Cross-Agent Notifications

```bash
# Notify other agents of important decisions
npx ruv-swarm hook notification \
  --message "Auth middleware completed - ready for integration" \
  --affected-agents "api-developer,tester" \
  --telemetry true \
  --priority "high"
```

### Session Management

```bash
# End of session cleanup and summary
npx ruv-swarm hook session-end \
  --export-metrics true \
  --generate-summary true \
  --persist-state true \
  --cleanup-temp-files true
```

## 🚀 Performance Optimization Examples

### Batch File Operations

```javascript
// ✅ Optimal: All related files in one batch
[BatchTool]:
  Write("src/models/User.js", userModel)
  Write("src/models/Product.js", productModel)
  Write("src/models/Order.js", orderModel)
  Write("src/models/index.js", modelsIndex)
  
  Write("src/controllers/userController.js", userController)
  Write("src/controllers/productController.js", productController) 
  Write("src/controllers/orderController.js", orderController)
  
  Write("tests/unit/models/user.test.js", userTest)
  Write("tests/unit/models/product.test.js", productTest)
  Write("tests/unit/models/order.test.js", orderTest)
```

### Parallel Command Execution

```javascript
// ✅ Optimal: All commands in parallel
[BatchTool]:
  Bash("npm install express mongoose cors helmet")
  Bash("npm install --save-dev jest supertest nodemon")
  Bash("mkdir -p src/{models,routes,middleware,controllers}")
  Bash("mkdir -p tests/{unit,integration,e2e}")
  Bash("touch .env .gitignore README.md")
```

### Coordinated Agent Spawning

```javascript
// ✅ Optimal: All agents spawned simultaneously with full coordination
[BatchTool]:
  mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 8, strategy: "parallel" })
  
  // Backend team
  mcp__claude-flow__agent_spawn({ type: "architect", name: "Backend Architect" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "API Developer" })
  mcp__claude-flow__agent_spawn({ type: "analyst", name: "Database Designer" })
  
  // Frontend team  
  mcp__claude-flow__agent_spawn({ type: "designer", name: "UI Designer" })
  mcp__claude-flow__agent_spawn({ type: "coder", name: "Frontend Developer" })
  
  // Quality team
  mcp__claude-flow__agent_spawn({ type: "tester", name: "QA Engineer" })
  mcp__claude-flow__agent_spawn({ type: "reviewer", name: "Code Reviewer" })
  
  // Coordination team
  mcp__claude-flow__agent_spawn({ type: "coordinator", name: "Project Manager" })
  
  // Initialize shared memory for all agents
  mcp__claude-flow__memory_usage({ 
    action: "store", 
    key: "swarm/shared/project-context",
    value: { initialized: Date.now(), agents: 8, strategy: "parallel" }
  })
```

## 📈 Monitoring and Analytics

### Real-Time Swarm Monitoring

```javascript
// Monitor swarm performance in real-time
mcp__claude-flow__swarm_monitor({
  interval: "30s",
  metrics: ["task-completion", "agent-utilization", "memory-usage", "error-rates"],
  alerts: ["blocked-tasks", "performance-degradation", "memory-exhaustion"],
  dashboard: true
})
```

### Performance Analytics

```javascript
// Generate performance reports
mcp__claude-flow__benchmark_run({
  duration: "1h",
  scenarios: ["development", "testing", "deployment"],
  metrics: ["throughput", "latency", "resource-utilization"],
  output: "performance-report.json"
})
```

## 🎓 Best Practices Summary

1. **Always Batch Operations**: Use BatchTool for ALL related operations
2. **Parallel Agent Spawning**: Spawn all agents in a single message
3. **Memory Coordination**: Store ALL decisions and progress in swarm memory
4. **Hook Integration**: Use ruv-swarm hooks for automation and coordination
5. **Monitor Progress**: Regular status checks with real-time monitoring
6. **Optimize Topology**: Choose the right topology for your use case
7. **Neural Learning**: Let agents learn from successful patterns
8. **Error Recovery**: Implement robust error handling and recovery

## 🔗 Additional Resources

- [ruv-swarm GitHub Repository](https://github.com/ruvnet/ruv-FANN/tree/main/ruv-swarm)
- [Claude Code Documentation](https://claude.ai/code)
- [MCP Protocol Specification](https://github.com/modelcontextprotocol/specification)
- [Integration Examples](./examples/)
- [Performance Benchmarks](./benchmark/)

---

**Remember**: ruv-swarm coordinates, Claude Code creates! The key to success is understanding that MCP tools orchestrate and enhance Claude Code's native capabilities rather than replacing them.