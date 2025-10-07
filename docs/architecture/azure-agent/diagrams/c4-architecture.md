# Azure Agent - C4 Architecture Diagrams

## Overview
This document provides C4 model architecture diagrams for the Azure Agent, showing the system from different levels of abstraction.

## Level 1: System Context Diagram

```
                          ┌─────────────────┐
                          │   Claude Code   │
                          │   User/Agent    │
                          └────────┬────────┘
                                   │
                                   │ Natural language
                                   │ commands & queries
                                   │
                          ┌────────▼────────┐
                          │                 │
                          │  Azure Agent    │
                          │                 │
                          │ Unified Azure   │
                          │ Operations      │
                          │                 │
                          └────┬──────┬─────┘
                               │      │
                    ┌──────────┘      └──────────┐
                    │                            │
           ┌────────▼────────┐          ┌────────▼─────────┐
           │                 │          │                  │
           │  Azure MCP      │          │  Claude Flow     │
           │  Server         │          │  Platform        │
           │                 │          │                  │
           │ 50+ Azure       │          │ • Orchestration  │
           │ Management      │          │ • Memory         │
           │ Tools           │          │ • Swarm          │
           │                 │          │                  │
           └────────┬────────┘          └──────────────────┘
                    │
                    │
           ┌────────▼────────┐
           │                 │
           │  Microsoft      │
           │  Azure Cloud    │
           │                 │
           │ Resources &     │
           │ Services        │
           │                 │
           └─────────────────┘


Key Relationships:
- User interacts with Azure Agent via natural language
- Azure Agent wraps Azure MCP Server for Azure operations
- Azure Agent integrates with Claude Flow for orchestration
- Azure MCP Server communicates with Azure Cloud
```

## Level 2: Container Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Azure Agent System                           │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐   │
│  │                                                             │   │
│  │              Agent Interface Layer                          │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐     │   │
│  │  │   Intent     │  │   Command    │  │   Context   │     │   │
│  │  │  Processor   │  │   Parser     │  │   Manager   │     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘     │   │
│  │         │                 │                  │            │   │
│  └─────────┼─────────────────┼──────────────────┼────────────┘   │
│            │                 │                  │                │
│  ┌─────────▼─────────────────▼──────────────────▼────────────┐   │
│  │                                                             │   │
│  │              Orchestration Layer                            │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐     │   │
│  │  │   Request    │  │   Workflow   │  │    State    │     │   │
│  │  │ Orchestrator │  │   Engine     │  │   Manager   │     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘     │   │
│  │         │                 │                  │            │   │
│  └─────────┼─────────────────┼──────────────────┼────────────┘   │
│            │                 │                  │                │
│  ┌─────────▼─────────────────▼──────────────────▼────────────┐   │
│  │                                                             │   │
│  │              MCP Wrapper Layer                              │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐     │   │
│  │  │     Tool     │  │   Response   │  │   Error     │     │   │
│  │  │   Registry   │  │  Normalizer  │  │  Handler    │     │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘     │   │
│  │         │                 │                  │            │   │
│  └─────────┼─────────────────┼──────────────────┼────────────┘   │
│            │                 │                  │                │
│  ┌─────────▼─────────────────▼──────────────────▼────────────┐   │
│  │                                                             │   │
│  │              Integration Layer                              │   │
│  │                                                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐     │   │
│  │  │  Claude Flow │  │     MCP      │  │  Monitoring │     │   │
│  │  │    Hooks     │  │  Connector   │  │  & Metrics  │     │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘     │   │
│  │                                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

External Dependencies:
├── Azure MCP Server (Tool execution)
├── Claude Flow Platform (Orchestration & Memory)
└── Azure Cloud (Resource management)
```

## Level 3: Component Diagram - Agent Interface Layer

```
┌──────────────────────────────────────────────────────────────┐
│                   Agent Interface Layer                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │            Intent Processor                         │    │
│  │                                                     │    │
│  │  • Parse natural language commands                  │    │
│  │  • Map intents to operations                        │    │
│  │  • Validate intent feasibility                      │    │
│  │  • Extract parameters from context                  │    │
│  │                                                     │    │
│  │  Input:  Natural language string                    │    │
│  │  Output: Structured Intent object                   │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │            Command Parser                           │    │
│  │                                                     │    │
│  │  • Parse CLI-style commands                         │    │
│  │  • Validate command syntax                          │    │
│  │  • Extract flags and options                        │    │
│  │  • Build operation request                          │    │
│  │                                                     │    │
│  │  Input:  Intent object or command string            │    │
│  │  Output: OperationRequest object                    │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │            Context Manager                          │    │
│  │                                                     │    │
│  │  • Maintain conversation context                    │    │
│  │  • Track active resources                           │    │
│  │  • Remember user preferences                        │    │
│  │  • Provide contextual defaults                      │    │
│  │  • Session state management                         │    │
│  │                                                     │    │
│  │  Storage: In-memory + persisted state               │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Level 3: Component Diagram - MCP Wrapper Layer

```
┌──────────────────────────────────────────────────────────────┐
│                   MCP Wrapper Layer                           │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │            Tool Registry                            │    │
│  │                                                     │    │
│  │  Components:                                        │    │
│  │  ├─ Tool Wrappers (50+ Azure tools)                │    │
│  │  ├─ Schema Validator                                │    │
│  │  ├─ Permission Checker                              │    │
│  │  └─ Execution Engine                                │    │
│  │                                                     │    │
│  │  Responsibilities:                                  │    │
│  │  • Register and discover tools                      │    │
│  │  • Validate tool parameters                         │    │
│  │  • Execute tools with retry logic                   │    │
│  │  • Manage tool metadata                             │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │            Response Normalizer                      │    │
│  │                                                     │    │
│  │  Components:                                        │    │
│  │  ├─ Response Transformers                           │    │
│  │  ├─ Data Extractors                                 │    │
│  │  ├─ Format Converters                               │    │
│  │  └─ Metadata Enricher                               │    │
│  │                                                     │    │
│  │  Responsibilities:                                  │    │
│  │  • Transform Azure responses to standard format     │    │
│  │  • Extract resource IDs and metadata                │    │
│  │  • Enrich responses with additional context         │    │
│  │  • Handle pagination and streaming                  │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │            Error Handler                            │    │
│  │                                                     │    │
│  │  Components:                                        │    │
│  │  ├─ Error Classifier                                │    │
│  │  ├─ Retry Executor                                  │    │
│  │  ├─ Circuit Breaker                                 │    │
│  │  └─ Recovery Manager                                │    │
│  │                                                     │    │
│  │  Responsibilities:                                  │    │
│  │  • Classify and categorize errors                   │    │
│  │  • Execute retry strategies                         │    │
│  │  • Prevent cascading failures                       │    │
│  │  • Attempt automatic recovery                       │    │
│  │  • Generate helpful error messages                  │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Level 3: Component Diagram - Integration Layer

```
┌──────────────────────────────────────────────────────────────┐
│                   Integration Layer                           │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │                                                     │    │
│  │          Claude Flow Hooks                          │    │
│  │                                                     │    │
│  │  Hook Types:                                        │    │
│  │  ├─ Pre-Task Hook                                   │    │
│  │  ├─ Post-Task Hook                                  │    │
│  │  ├─ Pre-Edit Hook                                   │    │
│  │  ├─ Post-Edit Hook                                  │    │
│  │  ├─ Session Restore Hook                            │    │
│  │  ├─ Session End Hook                                │    │
│  │  └─ Notify Hook                                     │    │
│  │                                                     │    │
│  │  Functionality:                                     │    │
│  │  • Execute hooks at operation boundaries            │    │
│  │  • Handle hook failures gracefully                  │    │
│  │  • Pass context to Claude Flow                      │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │          Memory Service                             │    │
│  │                                                     │    │
│  │  Operations:                                        │    │
│  │  ├─ Store (key, value, options)                     │    │
│  │  ├─ Retrieve (key)                                  │    │
│  │  ├─ Query (pattern)                                 │    │
│  │  ├─ Delete (key)                                    │    │
│  │  └─ Export (namespace)                              │    │
│  │                                                     │    │
│  │  Use Cases:                                         │    │
│  │  • Cache resource state                             │    │
│  │  • Store operation results                          │    │
│  │  • Share context between agents                     │    │
│  │  • Persist workflow state                           │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │          Swarm Coordination                         │    │
│  │                                                     │    │
│  │  Capabilities:                                      │    │
│  │  ├─ Initialize swarm topology                       │    │
│  │  ├─ Register agent capabilities                     │    │
│  │  ├─ Get task assignments                            │    │
│  │  ├─ Report task progress                            │    │
│  │  ├─ Coordinate with other agents                    │    │
│  │  └─ Query swarm status                              │    │
│  │                                                     │    │
│  │  Topologies:                                        │    │
│  │  • Mesh (peer-to-peer)                              │    │
│  │  • Hierarchical (coordinator-worker)                │    │
│  │  • Adaptive (dynamic topology)                      │    │
│  │                                                     │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────▼───────────────────────────────┐    │
│  │                                                     │    │
│  │          MCP Connector                              │    │
│  │                                                     │    │
│  │  Protocol Support:                                  │    │
│  │  ├─ WebSocket                                       │    │
│  │  ├─ HTTP/HTTPS                                      │    │
│  │  └─ Stdio                                           │    │
│  │                                                     │    │
│  │  Responsibilities:                                  │    │
│  │  • Manage connection lifecycle                      │    │
│  │  • Handle authentication                            │    │
│  │  • Serialize/deserialize messages                   │    │
│  │  • Monitor connection health                        │    │
│  │  • Automatic reconnection                           │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Level 4: Code Diagram - Request Flow

```
User Request: "Deploy a web app to East US"
                    │
                    ▼
┌───────────────────────────────────────────────────┐
│ 1. Intent Processor                               │
│    parse("Deploy a web app to East US")          │
│    → Intent {                                     │
│         action: "deploy",                         │
│         resourceType: "webapp",                   │
│         location: "eastus"                        │
│      }                                            │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 2. Context Manager                                │
│    enrichContext(intent)                          │
│    → Add subscription, resource group,            │
│      tags from context                            │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 3. Command Parser                                 │
│    buildOperationRequest(intent, context)         │
│    → OperationRequest {                           │
│         operation: "deploy",                      │
│         config: DeploymentConfig                  │
│      }                                            │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 4. Claude Flow Hook                               │
│    executeHook(PRE_TASK, {                        │
│      description: "Deploy webapp to eastus"       │
│    })                                             │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 5. Workflow Engine                                │
│    createWorkflow(operationRequest)               │
│    → Workflow {                                   │
│         steps: [                                  │
│           { tool: "azure_resource_group_create" }│
│           { tool: "azure_deploy_webapp" }        │
│           { tool: "azure_monitor_enable" }       │
│         ]                                         │
│      }                                            │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 6. Request Orchestrator                           │
│    executeWorkflow(workflow)                      │
│    For each step:                                 │
│      │                                            │
│      ▼                                            │
│    ┌─────────────────────────────────┐           │
│    │ 6a. Tool Registry                │           │
│    │     executeWithRetry(tool, params)│          │
│    │     ▼                             │           │
│    │   ┌──────────────────────┐       │           │
│    │   │ 6b. MCP Connector     │       │           │
│    │   │     call(tool, params)│       │           │
│    │   │     ▼                 │       │           │
│    │   │   Azure MCP Server    │       │           │
│    │   │     ▼                 │       │           │
│    │   │   Azure Cloud         │       │           │
│    │   │     ▼                 │       │           │
│    │   │   Response            │       │           │
│    │   └──────────┬────────────┘       │           │
│    │              ▼                    │           │
│    │   ┌──────────────────────┐       │           │
│    │   │ 6c. Response          │       │           │
│    │   │     Normalizer        │       │           │
│    │   │     normalize(response)│      │           │
│    │   └──────────┬────────────┘       │           │
│    └──────────────┼────────────────────┘           │
│                   ▼                                │
│    ┌─────────────────────────────────┐            │
│    │ 6d. State Manager                │            │
│    │     saveCheckpoint(step, result) │            │
│    └──────────────────────────────────┘            │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 7. Memory Service                                 │
│    store("operation/deploy-xyz/result", result)   │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 8. Claude Flow Hook                               │
│    executeHook(POST_TASK, {                       │
│      taskId: "deploy-xyz",                        │
│      success: true,                               │
│      result: result                               │
│    })                                             │
└─────────────────────┬─────────────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────────────┐
│ 9. Response to User                               │
│    "Successfully deployed web app to East US"     │
│    Resource ID: /subscriptions/.../webapp-xyz     │
│    URL: https://webapp-xyz.azurewebsites.net      │
└───────────────────────────────────────────────────┘
```

## Deployment Architecture

```
┌────────────────────────────────────────────────────────────┐
│                   Deployment View                           │
│                                                            │
│  ┌──────────────────────────────────────────────┐         │
│  │        Developer Environment                  │         │
│  │                                              │         │
│  │  ┌────────────┐      ┌─────────────┐       │         │
│  │  │  Claude    │◄────►│Azure Agent  │       │         │
│  │  │  Code CLI  │      │   NPM       │       │         │
│  │  │            │      │  Package    │       │         │
│  │  └────────────┘      └──────┬──────┘       │         │
│  │                             │              │         │
│  └─────────────────────────────┼──────────────┘         │
│                                │                         │
│  ┌─────────────────────────────▼──────────────┐         │
│  │        Claude Flow Platform                 │         │
│  │                                             │         │
│  │  • Memory Store (SQLite)                    │         │
│  │  • Hooks Engine                             │         │
│  │  • Swarm Coordinator                        │         │
│  │                                             │         │
│  └─────────────────────────────┬───────────────┘         │
│                                │                         │
│  ┌─────────────────────────────▼──────────────┐         │
│  │        Azure MCP Server                     │         │
│  │                                             │         │
│  │  • Tool Executors                           │         │
│  │  • Azure SDK Clients                        │         │
│  │  • Authentication Manager                   │         │
│  │                                             │         │
│  └─────────────────────────────┬───────────────┘         │
│                                │                         │
│  ┌─────────────────────────────▼──────────────┐         │
│  │        Microsoft Azure Cloud                │         │
│  │                                             │         │
│  │  • Azure Resource Manager                   │         │
│  │  • Azure Services                           │         │
│  │  • Azure Monitor                            │         │
│  │                                             │         │
│  └─────────────────────────────────────────────┘         │
│                                                            │
└────────────────────────────────────────────────────────────┘

Deployment Notes:
- Azure Agent: NPM package, installed locally
- Claude Flow: NPM package, can run locally or remote
- Azure MCP Server: NPM package from Microsoft
- Azure Cloud: Remote Microsoft infrastructure
```

## Data Flow Diagram

```
┌─────────┐                                          ┌──────────┐
│  User   │────1. Natural Language Command──────────►│  Agent   │
│         │                                          │ Interface│
└─────────┘                                          └────┬─────┘
                                                          │
                                                   2. Parse & Validate
                                                          │
┌──────────────────────────────────────────────────────  ▼────────┐
│                       Context Store                              │
│  • Current subscription                                          │
│  • Active resource group                                         │
│  • User preferences                                              │
│  • Recent operations                                             │
└──────────────────────────────────────────────────────────────────┘
                                                          │
                                                   3. Enrich Context
                                                          │
                                         ┌────────────────▼─────────┐
                                         │    Orchestration         │
                                         │                          │
                                         │  4. Build Workflow       │
                                         │  5. Execute Steps        │
                                         └────────┬─────────────────┘
                                                  │
                     ┌────────────────────────────┼────────────────────┐
                     │                            │                    │
                     ▼                            ▼                    ▼
           ┌──────────────┐            ┌──────────────┐    ┌──────────────┐
           │ Claude Flow  │            │     MCP      │    │    State     │
           │    Hooks     │            │   Wrapper    │    │   Manager    │
           │              │            │              │    │              │
           │ 6. Pre-Task  │            │ 7. Execute   │    │ 9. Save      │
           │ 8. Post-Task │            │    Tools     │    │   Checkpoint │
           └──────────────┘            └──────┬───────┘    └──────────────┘
                                              │
                                              ▼
                                    ┌────────────────┐
                                    │  Azure MCP     │
                                    │   Server       │
                                    │                │
                                    │ 10. Call Azure │
                                    └────────┬───────┘
                                             │
                                             ▼
                                    ┌────────────────┐
                                    │ Azure Cloud    │
                                    │                │
                                    │ 11. Execute    │
                                    │ 12. Response   │
                                    └────────┬───────┘
                                             │
                     ┌───────────────────────┼────────────────────┐
                     │                       │                    │
                     ▼                       ▼                    ▼
           ┌──────────────┐        ┌──────────────┐    ┌──────────────┐
           │   Response   │        │  Claude Flow │    │    Result    │
           │  Normalizer  │        │    Memory    │    │   Cache      │
           │              │        │              │    │              │
           │ 13. Format   │        │ 14. Store    │    │ 15. Cache    │
           └──────┬───────┘        └──────────────┘    └──────────────┘
                  │
                  ▼
           ┌──────────────┐
           │     User     │
           │              │
           │ 16. Display  │
           │    Result    │
           └──────────────┘
```

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Security Layers                           │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Authentication Layer                        │    │
│  │                                                     │    │
│  │  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │  Azure CLI   │  │   Managed    │               │    │
│  │  │  Credentials │  │   Identity   │               │    │
│  │  └──────────────┘  └──────────────┘               │    │
│  │  ┌──────────────┐  ┌──────────────┐               │    │
│  │  │   Service    │  │  Interactive │               │    │
│  │  │  Principal   │  │    Login     │               │    │
│  │  └──────────────┘  └──────────────┘               │    │
│  │                                                     │    │
│  └─────────────────────────┬───────────────────────────┘    │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │         Authorization Layer                          │    │
│  │                                                     │    │
│  │  • Azure RBAC Verification                          │    │
│  │  • Permission Checking                              │    │
│  │  • Scope Validation                                 │    │
│  │  • Policy Enforcement                               │    │
│  │                                                     │    │
│  └─────────────────────────┬───────────────────────────┘    │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │         Encryption Layer                             │    │
│  │                                                     │    │
│  │  • TLS/SSL for data in transit                      │    │
│  │  • Credentials encrypted at rest                    │    │
│  │  • Key Vault integration                            │    │
│  │  • Secret rotation                                  │    │
│  │                                                     │    │
│  └─────────────────────────┬───────────────────────────┘    │
│                            │                                │
│  ┌─────────────────────────▼───────────────────────────┐    │
│  │         Audit Layer                                  │    │
│  │                                                     │    │
│  │  • All operations logged                            │    │
│  │  • Sensitive data masked                            │    │
│  │  • Compliance reporting                             │    │
│  │  • Anomaly detection                                │    │
│  │                                                     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Scalability Architecture

```
Single Agent Deployment:
┌──────────────┐
│ Azure Agent  │──────► Azure MCP Server ──────► Azure Cloud
└──────────────┘


Multi-Agent Swarm Deployment (Mesh Topology):
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Agent 1      │◄───►│ Agent 2      │◄───►│ Agent 3      │
│ (East US)    │     │ (West US)    │     │ (Central US) │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │    ┌───────────────▼────────────┐       │
       │    │   Claude Flow Platform     │       │
       └───►│   • Memory Sharing         │◄──────┘
            │   • Task Distribution      │
            │   • State Coordination     │
            └────────────────────────────┘
                           │
                           ▼
                    Azure MCP Server
                           │
                           ▼
                     Azure Cloud


Multi-Agent Swarm Deployment (Hierarchical Topology):
                  ┌──────────────────┐
                  │  Coordinator     │
                  │  Agent           │
                  └────────┬─────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼──────┐  ┌───────▼──────┐  ┌──────▼────────┐
│ Worker Agent  │  │ Worker Agent │  │ Worker Agent  │
│ (Deployment)  │  │ (Monitoring) │  │ (Security)    │
└───────┬───────┘  └───────┬──────┘  └───────┬───────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
                    Claude Flow
                           │
                    Azure MCP Server
                           │
                     Azure Cloud
```

## Component Interaction Sequence

```
Successful Operation Sequence:

User        Agent       Hooks      Orchestrator    MCP        Azure
 │           │           │              │          │           │
 │──Command─►│           │              │          │           │
 │           │──Pre-Task─►              │          │           │
 │           │◄─────────┘│              │          │           │
 │           │────Parse──►              │          │           │
 │           │◄────────────────────────┘│          │           │
 │           │─────────Execute Workflow─►          │           │
 │           │                          │──Call────►           │
 │           │                          │          │──Request─►
 │           │                          │          │◄─Response─┘
 │           │                          │◄─Result──┘           │
 │           │◄─────────────────────────┘          │           │
 │           │─Post-Task──►             │          │           │
 │           │◄──────────┘              │          │           │
 │◄─Result───┘           │              │          │           │


Error Handling Sequence:

User        Agent       Error       Retry      Recovery    Azure
 │           │         Handler     Executor    Manager      │
 │──Command─►│           │           │           │          │
 │           │───────────Execute────────────────────────────►
 │           │                                              │
 │           │◄──────────────────────────Error──────────────┘
 │           │───────────►           │           │          │
 │           │          Classify     │           │          │
 │           │◄──────────┘           │           │          │
 │           │───────────Should Retry?───────────►          │
 │           │◄─────────────Yes────────┘         │          │
 │           │───────────────────────Retry───────────────────►
 │           │◄──────────────────────Error───────────────────┘
 │           │───────────────────────Retry───────────────────►
 │           │◄──────────────────────Success─────────────────┘
 │◄─Result───┘           │           │           │          │
```
