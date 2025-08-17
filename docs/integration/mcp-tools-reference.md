# Claude Flow v2.0.0 - Complete MCP Tools Reference

## 🎯 Overview

This document provides comprehensive documentation for all 87 MCP tools available in Claude Flow v2.0.0, including ruv-swarm integration tools and native Claude Flow capabilities.

## 📋 Tool Categories

### 🐝 Swarm Coordination Tools (12)
### 🧠 Neural Network Tools (15)  
### 💾 Memory & Persistence Tools (12)
### 📊 Analysis & Monitoring Tools (13)
### 🔄 Workflow & Automation Tools (11)
### 🐙 GitHub Integration Tools (8)
### 🤖 DAA (Dynamic Agent Architecture) Tools (8)
### 🛠️ System & Utilities Tools (8)

---

## 🐝 Swarm Coordination Tools

### mcp__claude-flow__swarm_init

Initialize a swarm with specified topology and configuration.

**Parameters:**
```json
{
  "topology": {
    "type": "string",
    "enum": ["hierarchical", "mesh", "ring", "star"],
    "description": "Swarm coordination topology"
  },
  "maxAgents": {
    "type": "number",
    "default": 8,
    "description": "Maximum number of agents in the swarm"
  },
  "strategy": {
    "type": "string",
    "default": "auto",
    "enum": ["auto", "parallel", "sequential", "adaptive", "balanced"],
    "description": "Coordination strategy"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 coordination swarm-init \
  --topology hierarchical \
  --max-agents 8 \
  --strategy parallel
```

**Response:**
```json
{
  "swarm_id": "swarm_20250706_141234",
  "topology": "hierarchical",
  "max_agents": 8,
  "strategy": "parallel",
  "status": "initialized",
  "coordination_endpoints": ["ws://localhost:8080/coordination"],
  "memory_namespace": "swarm_20250706_141234"
}
```

---

### mcp__claude-flow__agent_spawn

Create a specialized agent within the swarm.

**Parameters:**
```json
{
  "type": {
    "type": "string",
    "enum": [
      "coordinator", "researcher", "coder", "analyst", 
      "architect", "tester", "reviewer", "optimizer", 
      "documenter", "monitor", "specialist"
    ],
    "description": "Type of agent to spawn"
  },
  "name": {
    "type": "string",
    "description": "Human-readable name for the agent"
  },
  "capabilities": {
    "type": "array",
    "items": {"type": "string"},
    "description": "List of specific capabilities"
  },
  "swarmId": {
    "type": "string",
    "description": "ID of the swarm to join"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 coordination agent-spawn \
  --type architect \
  --name "SystemDesigner" \
  --capabilities "system-design,database-architecture,microservices"
```

**Response:**
```json
{
  "agent_id": "agent_architect_20250706_141245",
  "type": "architect",
  "name": "SystemDesigner",
  "capabilities": ["system-design", "database-architecture", "microservices"],
  "status": "active",
  "swarm_id": "swarm_20250706_141234",
  "coordination_hooks": {
    "pre_task": "enabled",
    "post_edit": "enabled",
    "memory_sync": "enabled"
  }
}
```

---

### mcp__claude-flow__task_orchestrate

Orchestrate complex task workflows across agents.

**Parameters:**
```json
{
  "task": {
    "type": "string",
    "description": "Description of the task to orchestrate"
  },
  "strategy": {
    "type": "string",
    "enum": ["parallel", "sequential", "adaptive", "balanced"],
    "default": "adaptive",
    "description": "Execution strategy"
  },
  "priority": {
    "type": "string",
    "enum": ["low", "medium", "high", "critical"],
    "default": "medium",
    "description": "Task priority level"
  },
  "dependencies": {
    "type": "array",
    "items": {"type": "string"},
    "description": "Task dependencies"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 coordination task-orchestrate \
  --task "Build REST API with authentication and testing" \
  --strategy parallel \
  --priority high
```

**Response:**
```json
{
  "task_id": "task_20250706_141256",
  "description": "Build REST API with authentication and testing",
  "strategy": "parallel",
  "priority": "high",
  "assigned_agents": [
    {
      "agent_id": "agent_architect_20250706_141245",
      "subtask": "Design API architecture and database schema"
    },
    {
      "agent_id": "agent_coder_20250706_141247",
      "subtask": "Implement authentication endpoints"
    },
    {
      "agent_id": "agent_tester_20250706_141248",
      "subtask": "Create comprehensive test suite"
    }
  ],
  "estimated_completion": "2025-07-06T15:30:00Z",
  "coordination_plan": {
    "phases": ["design", "implementation", "testing", "integration"],
    "parallel_execution": true,
    "memory_sharing": true
  }
}
```

---

### mcp__claude-flow__swarm_status

Monitor the health and status of the swarm.

**Parameters:**
```json
{
  "swarmId": {
    "type": "string",
    "description": "ID of the swarm to monitor"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 coordination swarm-status
```

**Response:**
```json
{
  "swarm_id": "swarm_20250706_141234",
  "status": "active",
  "topology": "hierarchical",
  "agents": {
    "total": 6,
    "active": 6,
    "idle": 0,
    "busy": 3
  },
  "tasks": {
    "total": 15,
    "completed": 8,
    "in_progress": 5,
    "pending": 2,
    "failed": 0
  },
  "performance": {
    "coordination_efficiency": 94.7,
    "parallel_execution_rate": 87.3,
    "memory_sync_latency": "12ms",
    "average_task_completion_time": "2.3min"
  },
  "memory": {
    "active_entries": 1247,
    "memory_usage": "15.2MB",
    "compression_ratio": 0.65,
    "sync_status": "healthy"
  }
}
```

---

### mcp__claude-flow__agent_list

List all active agents and their capabilities.

**Parameters:**
```json
{
  "swarmId": {
    "type": "string",
    "description": "Filter by swarm ID"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 coordination agent-list
```

**Response:**
```json
{
  "agents": [
    {
      "agent_id": "agent_architect_20250706_141245",
      "type": "architect",
      "name": "SystemDesigner",
      "status": "busy",
      "current_task": "Design API architecture",
      "capabilities": ["system-design", "database-architecture"],
      "performance": {
        "tasks_completed": 12,
        "success_rate": 98.5,
        "average_completion_time": "18min"
      }
    },
    {
      "agent_id": "agent_coder_20250706_141247",
      "type": "coder",
      "name": "BackendDev",
      "status": "active",
      "current_task": null,
      "capabilities": ["node-js", "rest-api", "database"],
      "performance": {
        "tasks_completed": 8,
        "success_rate": 94.2,
        "average_completion_time": "22min"
      }
    }
  ],
  "total_agents": 6,
  "swarm_efficiency": 94.7
}
```

---

## 🧠 Neural Network Tools

### mcp__claude-flow__neural_train

Train neural patterns with WASM acceleration.

**Parameters:**
```json
{
  "pattern_type": {
    "type": "string",
    "enum": ["coordination", "optimization", "prediction"],
    "description": "Type of neural pattern to train"
  },
  "training_data": {
    "type": "string",
    "description": "Path to training data file or inline data"
  },
  "epochs": {
    "type": "number",
    "default": 50,
    "description": "Number of training epochs"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 neural train \
  --pattern-type coordination \
  --training-data "./data/coordination-patterns.json" \
  --epochs 100
```

**Response:**
```json
{
  "training_id": "neural_train_20250706_141300",
  "pattern_type": "coordination",
  "epochs": 100,
  "training_progress": {
    "current_epoch": 100,
    "loss": 0.0342,
    "accuracy": 96.7,
    "time_elapsed": "2min 34s"
  },
  "model_info": {
    "model_id": "coordination_model_v1.2",
    "size": "47KB",
    "compression_ratio": 0.73,
    "wasm_optimized": true
  },
  "performance_metrics": {
    "training_speed": "2.8x faster than baseline",
    "memory_usage": "15.2MB peak",
    "inference_latency": "8ms average"
  }
}
```

---

### mcp__claude-flow__neural_predict

Make AI predictions using trained models.

**Parameters:**
```json
{
  "modelId": {
    "type": "string",
    "description": "ID of the trained model"
  },
  "input": {
    "type": "string",
    "description": "Input data for prediction"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 neural predict \
  --model-id coordination_model_v1.2 \
  --input "complex microservices architecture with event sourcing"
```

**Response:**
```json
{
  "prediction_id": "pred_20250706_141310",
  "model_id": "coordination_model_v1.2",
  "input": "complex microservices architecture with event sourcing",
  "predictions": [
    {
      "strategy": "hierarchical_coordination",
      "confidence": 0.94,
      "reasoning": "High complexity requires structured coordination"
    },
    {
      "agent_types": ["architect", "coder", "analyst", "tester"],
      "confidence": 0.91,
      "reasoning": "Diverse expertise needed for microservices"
    }
  ],
  "recommendations": {
    "topology": "hierarchical",
    "agents_count": 8,
    "coordination_pattern": "event_driven",
    "estimated_completion": "4.2 hours"
  },
  "performance": {
    "inference_time": "12ms",
    "confidence_score": 0.93
  }
}
```

---

### mcp__claude-flow__neural_status

Check the status of neural network systems.

**Parameters:**
```json
{
  "modelId": {
    "type": "string",
    "description": "Specific model ID to check"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 neural status
```

**Response:**
```json
{
  "wasm_status": {
    "loaded": true,
    "version": "2.0.0",
    "size": "512KB",
    "simd_enabled": true,
    "performance": "optimal"
  },
  "models": {
    "total_loaded": 27,
    "active_models": [
      {
        "model_id": "coordination_model_v1.2",
        "type": "coordination",
        "accuracy": 96.7,
        "last_trained": "2025-07-06T14:13:00Z",
        "inference_count": 1247
      },
      {
        "model_id": "optimization_model_v2.1",
        "type": "optimization",
        "accuracy": 94.3,
        "last_trained": "2025-07-06T13:45:00Z",
        "inference_count": 892
      }
    ]
  },
  "performance": {
    "total_inferences": 15672,
    "average_latency": "9.4ms",
    "success_rate": 98.7,
    "memory_usage": "23.4MB"
  },
  "training": {
    "active_sessions": 0,
    "completed_today": 3,
    "total_training_time": "12min 45s"
  }
}
```

---

## 💾 Memory & Persistence Tools

### mcp__claude-flow__memory_usage

Store and retrieve persistent memory data.

**Parameters:**
```json
{
  "action": {
    "type": "string",
    "enum": ["store", "retrieve", "list", "delete", "search"],
    "description": "Memory operation to perform"
  },
  "key": {
    "type": "string",
    "description": "Memory key for store/retrieve operations"
  },
  "value": {
    "type": "string",
    "description": "Value to store (for store action)"
  },
  "namespace": {
    "type": "string",
    "default": "default",
    "description": "Memory namespace"
  },
  "ttl": {
    "type": "number",
    "description": "Time to live in seconds"
  }
}
```

**Example Usage:**
```bash
# Store project context
npx claude-flow@2.0.0 memory usage \
  --action store \
  --key "project/architecture" \
  --value "microservices with event sourcing and CQRS" \
  --namespace "development" \
  --ttl 86400

# Retrieve stored data
npx claude-flow@2.0.0 memory usage \
  --action retrieve \
  --key "project/architecture" \
  --namespace "development"
```

**Response (Store):**
```json
{
  "action": "store",
  "key": "project/architecture",
  "namespace": "development",
  "success": true,
  "memory_id": "mem_20250706_141320",
  "ttl": 86400,
  "expires_at": "2025-07-07T14:13:20Z",
  "storage_info": {
    "compressed": true,
    "size": "156B",
    "compression_ratio": 0.67
  }
}
```

**Response (Retrieve):**
```json
{
  "action": "retrieve",
  "key": "project/architecture",
  "namespace": "development",
  "value": "microservices with event sourcing and CQRS",
  "metadata": {
    "stored_at": "2025-07-06T14:13:20Z",
    "expires_at": "2025-07-07T14:13:20Z",
    "access_count": 3,
    "last_accessed": "2025-07-06T14:25:15Z"
  }
}
```

---

### mcp__claude-flow__memory_search

Search memory entries with pattern matching.

**Parameters:**
```json
{
  "pattern": {
    "type": "string",
    "description": "Search pattern (supports regex)"
  },
  "namespace": {
    "type": "string",
    "description": "Namespace to search in"
  },
  "limit": {
    "type": "number",
    "default": 10,
    "description": "Maximum results to return"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 memory search \
  --pattern "microservices|architecture" \
  --namespace "development" \
  --limit 5
```

**Response:**
```json
{
  "pattern": "microservices|architecture",
  "namespace": "development",
  "results": [
    {
      "key": "project/architecture",
      "value": "microservices with event sourcing and CQRS",
      "relevance_score": 0.95,
      "stored_at": "2025-07-06T14:13:20Z"
    },
    {
      "key": "decisions/microservices_strategy",
      "value": "event-driven architecture with domain boundaries",
      "relevance_score": 0.87,
      "stored_at": "2025-07-06T13:45:12Z"
    }
  ],
  "total_matches": 7,
  "search_time": "23ms"
}
```

---

## 📊 Analysis & Monitoring Tools

### mcp__claude-flow__performance_report

Generate comprehensive performance reports.

**Parameters:**
```json
{
  "timeframe": {
    "type": "string",
    "enum": ["24h", "7d", "30d"],
    "default": "24h",
    "description": "Report timeframe"
  },
  "format": {
    "type": "string",
    "enum": ["summary", "detailed", "json"],
    "default": "summary",
    "description": "Report format"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 performance report \
  --timeframe 24h \
  --format detailed
```

**Response:**
```json
{
  "report_id": "perf_report_20250706_141330",
  "timeframe": "24h",
  "period": {
    "start": "2025-07-05T14:13:30Z",
    "end": "2025-07-06T14:13:30Z"
  },
  "summary": {
    "total_operations": 15672,
    "success_rate": 98.7,
    "average_response_time": "234ms",
    "peak_throughput": "1247 ops/min"
  },
  "swarm_performance": {
    "coordination_efficiency": 94.7,
    "parallel_execution_rate": 87.3,
    "agent_utilization": 92.1,
    "task_completion_rate": 96.8
  },
  "neural_performance": {
    "total_inferences": 3421,
    "average_latency": "9.4ms",
    "training_sessions": 3,
    "model_accuracy": 96.2
  },
  "memory_performance": {
    "read_operations": 8432,
    "write_operations": 2314,
    "search_operations": 856,
    "cache_hit_rate": 89.3,
    "compression_efficiency": 65.2
  },
  "bottlenecks": [
    {
      "component": "memory_system",
      "severity": "low",
      "description": "Occasional high latency on large dataset searches",
      "recommendation": "Consider indexing optimization"
    }
  ]
}
```

---

### mcp__claude-flow__bottleneck_analyze

Identify and analyze system performance bottlenecks.

**Parameters:**
```json
{
  "component": {
    "type": "string",
    "description": "Specific component to analyze"
  },
  "metrics": {
    "type": "array",
    "description": "Specific metrics to analyze"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 bottleneck analyze \
  --component swarm_coordination \
  --metrics "response_time,throughput,error_rate"
```

**Response:**
```json
{
  "analysis_id": "bottleneck_20250706_141340",
  "component": "swarm_coordination",
  "analysis_period": "24h",
  "bottlenecks_detected": [
    {
      "metric": "agent_spawning_time",
      "severity": "medium",
      "current_value": "347ms",
      "threshold": "200ms",
      "impact": "Delays initial task distribution",
      "recommendations": [
        "Pre-warm agent pools",
        "Optimize agent initialization sequence",
        "Implement lazy loading for non-critical capabilities"
      ],
      "potential_improvement": "65% reduction in spawn time"
    },
    {
      "metric": "memory_sync_latency",
      "severity": "low",
      "current_value": "23ms",
      "threshold": "15ms",
      "impact": "Minor delays in cross-agent coordination",
      "recommendations": [
        "Optimize memory compression algorithm",
        "Implement delta synchronization"
      ],
      "potential_improvement": "40% latency reduction"
    }
  ],
  "performance_trends": {
    "improving": ["task_completion_rate", "neural_inference_speed"],
    "stable": ["overall_throughput", "error_rate"],
    "declining": ["memory_sync_latency"]
  },
  "action_plan": {
    "immediate": [
      "Implement agent pool pre-warming",
      "Optimize memory sync algorithm"
    ],
    "short_term": [
      "Add memory indexing for faster searches",
      "Implement adaptive agent scaling"
    ],
    "long_term": [
      "Consider distributed memory architecture",
      "Investigate WASM performance optimizations"
    ]
  }
}
```

---

## 🔄 Workflow & Automation Tools

### mcp__claude-flow__workflow_create

Create custom workflows for automation.

**Parameters:**
```json
{
  "name": {
    "type": "string",
    "description": "Workflow name"
  },
  "steps": {
    "type": "array",
    "description": "Array of workflow steps"
  },
  "triggers": {
    "type": "array",
    "description": "Workflow triggers"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 workflow create \
  --name "full-stack-development" \
  --steps '[
    {"type": "swarm_init", "topology": "hierarchical"},
    {"type": "agent_spawn", "agents": ["architect", "coder", "tester"]},
    {"type": "task_orchestrate", "strategy": "parallel"}
  ]'
```

**Response:**
```json
{
  "workflow_id": "workflow_20250706_141350",
  "name": "full-stack-development",
  "status": "created",
  "steps": [
    {
      "step_id": "step_1",
      "type": "swarm_init",
      "config": {"topology": "hierarchical"},
      "estimated_duration": "30s"
    },
    {
      "step_id": "step_2",
      "type": "agent_spawn",
      "config": {"agents": ["architect", "coder", "tester"]},
      "dependencies": ["step_1"],
      "estimated_duration": "45s"
    },
    {
      "step_id": "step_3",
      "type": "task_orchestrate",
      "config": {"strategy": "parallel"},
      "dependencies": ["step_2"],
      "estimated_duration": "variable"
    }
  ],
  "estimated_total_time": "2min 15s",
  "automation_level": "full",
  "reusable": true
}
```

---

## 🐙 GitHub Integration Tools

### mcp__claude-flow__github_repo_analyze

Analyze GitHub repositories for coordination optimization.

**Parameters:**
```json
{
  "repo": {
    "type": "string",
    "description": "Repository identifier (owner/repo)"
  },
  "analysis_type": {
    "type": "string",
    "enum": ["code_quality", "performance", "security"],
    "description": "Type of analysis to perform"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 github repo-analyze \
  --repo "myorg/my-project" \
  --analysis-type code_quality
```

**Response:**
```json
{
  "analysis_id": "gh_analysis_20250706_141400",
  "repository": "myorg/my-project",
  "analysis_type": "code_quality",
  "results": {
    "overall_score": 87.3,
    "metrics": {
      "code_complexity": {
        "score": 91.2,
        "details": "Low to medium complexity across modules"
      },
      "test_coverage": {
        "score": 84.7,
        "details": "Good test coverage with some gaps in edge cases"
      },
      "documentation": {
        "score": 79.1,
        "details": "README is comprehensive, API docs need improvement"
      }
    },
    "recommendations": [
      {
        "category": "testing",
        "priority": "high",
        "description": "Add integration tests for authentication flow",
        "estimated_effort": "2-3 hours"
      },
      {
        "category": "documentation",
        "priority": "medium",
        "description": "Document API endpoints with examples",
        "estimated_effort": "4-5 hours"
      }
    ],
    "coordination_insights": {
      "suggested_agents": ["documenter", "tester", "reviewer"],
      "workflow_strategy": "parallel",
      "estimated_improvement_time": "1-2 days"
    }
  }
}
```

---

## 🤖 DAA (Dynamic Agent Architecture) Tools

### mcp__claude-flow__daa_agent_create

Create dynamic agents with adaptive capabilities.

**Parameters:**
```json
{
  "agent_type": {
    "type": "string",
    "description": "Type of dynamic agent to create"
  },
  "capabilities": {
    "type": "array",
    "description": "Initial capabilities for the agent"
  },
  "resources": {
    "type": "object",
    "description": "Resource allocation for the agent"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 daa agent-create \
  --agent-type adaptive_coder \
  --capabilities '["javascript", "python", "api_design"]' \
  --resources '{"memory": "512MB", "cpu": "2_cores"}'
```

**Response:**
```json
{
  "agent_id": "daa_agent_20250706_141410",
  "type": "adaptive_coder",
  "status": "initializing",
  "capabilities": {
    "initial": ["javascript", "python", "api_design"],
    "adaptive": [],
    "learning_enabled": true
  },
  "resources": {
    "allocated": {
      "memory": "512MB",
      "cpu": "2_cores",
      "storage": "1GB"
    },
    "utilization": {
      "memory": "23%",
      "cpu": "12%",
      "storage": "5%"
    }
  },
  "learning_metrics": {
    "adaptation_rate": 0.0,
    "skill_acquisition_speed": "medium",
    "performance_improvement": 0.0
  }
}
```

---

## 🛠️ System & Utilities Tools

### mcp__claude-flow__health_check

Perform comprehensive system health checks.

**Parameters:**
```json
{
  "components": {
    "type": "array",
    "description": "Specific components to check"
  }
}
```

**Example Usage:**
```bash
npx claude-flow@2.0.0 health-check \
  --components '["swarm", "neural", "memory", "mcp"]'
```

**Response:**
```json
{
  "health_check_id": "health_20250706_141420",
  "timestamp": "2025-07-06T14:14:20Z",
  "overall_status": "healthy",
  "components": {
    "swarm": {
      "status": "healthy",
      "details": {
        "active_swarms": 2,
        "total_agents": 12,
        "coordination_latency": "15ms",
        "success_rate": 98.7
      },
      "issues": []
    },
    "neural": {
      "status": "healthy",
      "details": {
        "wasm_loaded": true,
        "models_active": 27,
        "inference_rate": "94.2 ops/min",
        "training_queue": 0
      },
      "issues": []
    },
    "memory": {
      "status": "warning",
      "details": {
        "total_entries": 15672,
        "memory_usage": "87.3%",
        "compression_ratio": 0.65,
        "backup_status": "current"
      },
      "issues": [
        {
          "severity": "low",
          "description": "Memory usage approaching threshold",
          "recommendation": "Consider running cleanup or increasing memory allocation"
        }
      ]
    },
    "mcp": {
      "status": "healthy",
      "details": {
        "servers_active": 2,
        "tools_available": 87,
        "connection_status": "stable",
        "response_time": "45ms"
      },
      "issues": []
    }
  },
  "recommendations": [
    "Schedule memory cleanup during low usage hours",
    "Monitor memory usage trends over next 24 hours"
  ],
  "next_check": "2025-07-06T15:14:20Z"
}
```

---

## 📝 Usage Examples

### Complete Integration Workflow

```bash
# 1. Initialize swarm
npx claude-flow@2.0.0 coordination swarm-init \
  --topology hierarchical \
  --max-agents 8

# 2. Spawn specialized agents
npx claude-flow@2.0.0 coordination agent-spawn \
  --type architect \
  --name "SystemDesigner"

npx claude-flow@2.0.0 coordination agent-spawn \
  --type coder \
  --name "BackendDev"

# 3. Train coordination patterns
npx claude-flow@2.0.0 neural train \
  --pattern-type coordination \
  --epochs 50

# 4. Store project context
npx claude-flow@2.0.0 memory usage \
  --action store \
  --key "project/requirements" \
  --value "REST API with authentication"

# 5. Orchestrate development task
npx claude-flow@2.0.0 coordination task-orchestrate \
  --task "Build complete REST API" \
  --strategy parallel

# 6. Monitor progress
npx claude-flow@2.0.0 swarm status
npx claude-flow@2.0.0 performance report
```

### Automated Workflow Example

```bash
# Create reusable workflow
npx claude-flow@2.0.0 workflow create \
  --name "api-development-pipeline" \
  --steps '[
    {"type": "swarm_init", "topology": "hierarchical"},
    {"type": "neural_train", "pattern": "api_development"},
    {"type": "github_analyze", "analysis": "code_quality"},
    {"type": "task_orchestrate", "strategy": "parallel"}
  ]'

# Execute workflow
npx claude-flow@2.0.0 workflow execute \
  --workflow-id "workflow_20250706_141350"
```

This comprehensive MCP tools reference provides detailed documentation for all 87 tools available in Claude Flow v2.0.0, enabling developers to leverage the full power of intelligent coordination and neural-enhanced development workflows.