# Automatic Agent Creation System

## 🚀 Overview

Claude Flow now includes an intelligent automatic agent creation system. When you attempt to spawn an agent type that doesn't exist, the system will automatically create it with appropriate capabilities based on intelligent analysis of the agent type name.

## 🎯 Key Features

- **Zero Configuration**: Just spawn any agent type - it will be created automatically
- **Intelligent Inference**: Capabilities are inferred from the agent type name
- **Persistent Templates**: Auto-created templates are saved and reused
- **Custom Handlers**: Add specialized handlers for complex agent types
- **Full Integration**: Works seamlessly with Task tool and AIME

## 🔧 How to Use

### Basic Usage

Simply spawn any agent type - if it doesn't exist, it will be created:

```javascript
// Using Task tool
Task {
  subagent_type: "market_researcher",
  description: "Research AI consulting competitors",
  prompt: "You are a market researcher..."
}

// Using agent manager directly
const agentId = await agentManager.createAgent('ux_designer', {
  name: 'UX Design Specialist'
});
```

### Supported Patterns

The system recognizes these patterns in agent type names:

#### Domain Keywords
- `research` → Web search, documentation, analysis
- `design` → Documentation, UI/UX capabilities
- `develop`/`code` → Code generation, file system access
- `test` → Testing, code review, validation
- `analyze` → Analysis, data processing
- `optimize` → Performance analysis, optimization
- `integrate` → API integration, connectivity

#### Programming Languages
- `python` → Python language support
- `javascript`/`js` → JavaScript/TypeScript support
- `rust`, `go`, `java`, `ruby`, `php`, etc.

#### Frameworks
- `react`, `vue`, `angular`, `svelte` → Frontend frameworks
- `django`, `flask`, `express`, `rails` → Backend frameworks

#### Special Patterns
- `senior`/`expert` → Boosted expertise levels (0.85-0.95)
- `junior`/`trainee` → Adjusted expertise (0.5-0.7)
- `fullstack` → Complete web development capabilities
- `devops` → Infrastructure and deployment tools

### Examples

```javascript
// Market Researcher
"market_researcher" → {
  capabilities: {
    research: true,
    webSearch: true,
    analysis: true,
    documentation: true,
    domains: ['research', 'market-research', 'information-gathering']
  }
}

// Python Backend Developer
"python_backend_developer" → {
  capabilities: {
    codeGeneration: true,
    apiIntegration: true,
    terminalAccess: true,
    languages: ['python'],
    domains: ['backend', 'python', 'api', 'server']
  }
}

// Senior React Developer
"senior_react_developer" → {
  capabilities: {
    codeGeneration: true,
    languages: ['javascript', 'typescript'],
    frameworks: ['react', 'next.js'],
    domains: ['frontend', 'react', 'ui-development']
  },
  expertise: {
    coding: 0.95,
    react: 0.95,
    frontend: 0.9
  }
}
```

## 🛠️ Configuration

### Enable/Disable Auto-Creation

```javascript
// When creating agent manager
const agentManager = new EnhancedAgentManager({
  enableAutoCreation: true, // Default: true
  autoCreation: {
    inferFromName: true,    // Infer from agent name
    autoRegister: true      // Auto-register templates
  }
}, logger, eventBus, memory);

// Runtime control
agentManager.setAutoCreation(false); // Disable
agentManager.setAutoCreation(true);  // Re-enable
```

### Custom Template Handlers

For specialized agent types:

```javascript
agentManager.addCustomTemplateHandler('quantum_researcher', async (type) => {
  return {
    name: 'Quantum Research Specialist',
    type: type,
    capabilities: {
      research: true,
      analysis: true,
      domains: ['quantum-computing', 'physics'],
      tools: ['quantum-simulator', 'arxiv-search'],
      // ... custom capabilities
    },
    // ... rest of template
  };
});
```

## 📊 Monitoring

### Check Auto-Creation Statistics

```javascript
const stats = agentManager.getAutoCreationStats();
console.log(stats);
// {
//   enabled: true,
//   createdTemplates: 5,
//   failedAttempts: Map {},
//   customHandlers: ['quantum_researcher']
// }
```

### View Created Agent Types

```javascript
const agents = agentManager.getAllAgents();
agents.forEach(agent => {
  console.log(`${agent.name} (${agent.type}): ${agent.status}`);
});
```

## 🔄 Integration with AIME

AIME can request any agent type through the Task tool:

```javascript
// AIME's dynamic planner can request specialized agents
Task {
  subagent_type: "ai_ethics_researcher",
  description: "Research ethical implications of AI",
  prompt: "..."
}
// "ai_ethics_researcher" will be auto-created with:
// - Research capabilities
// - Web search access
// - Documentation abilities
// - Ethics and AI domains
```

## ⚠️ Error Handling

The system prevents infinite loops with a maximum of 3 creation attempts. If creation fails:

1. Check the agent type name for typos
2. Verify system permissions
3. Check logs for specific errors
4. Consider using a custom template handler

## 💾 Persistence

All auto-created templates are:
- Cached in memory for the session
- Persisted to distributed memory
- Automatically loaded on restart
- Tagged as 'auto-created'

## 🎯 Best Practices

1. **Descriptive Names**: Use clear agent type names
   - ✅ `react_frontend_developer`
   - ✅ `seo_content_strategist`
   - ❌ `agent1`, `worker`

2. **Override When Needed**: Provide custom capabilities
   ```javascript
   await agentManager.createAgent('custom_analyst', {
     config: {
       expertise: { custom_domain: 0.9 }
     }
   });
   ```

3. **Monitor Creation**: Track what's being created
   ```javascript
   agentManager.on('template:auto-created', (data) => {
     console.log('New agent type:', data.type);
   });
   ```

## 🚀 Quick Start

```javascript
import { EnhancedAgentManager } from './agents/enhanced-agent-manager.js';

// Initialize
const agentManager = new EnhancedAgentManager({
  enableAutoCreation: true
}, logger, eventBus, memory);

await agentManager.initialize();

// Spawn any agent type!
const agentId = await agentManager.createAgent('blockchain_security_auditor', {
  name: 'Blockchain Security Expert'
});

// The system automatically creates a template with:
// - Security and blockchain domains
// - Code review capabilities
// - Analysis tools
// - Appropriate expertise levels
```

## 📝 Summary

The automatic agent creation system makes Claude Flow more flexible and powerful:

- **No Manual Templates**: Just use any agent type name
- **Intelligent Defaults**: Capabilities inferred from names
- **Extensible**: Add custom handlers for specialized needs
- **Persistent**: Templates saved and reused
- **AIME Compatible**: Perfect for dynamic mission planning

Now you can focus on what agents should do, not how to define them!