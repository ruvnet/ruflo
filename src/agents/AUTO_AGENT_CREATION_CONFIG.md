# Automatic Agent Creation Configuration

## Overview

The Claude Flow system now includes automatic agent creation capabilities. When you attempt to spawn an agent type that doesn't exist, the system will automatically:

1. **Detect** the missing agent type
2. **Create** a new agent template based on intelligent inference
3. **Register** the template in the agent manager
4. **Spawn** the agent with the newly created template
5. **Persist** the template for future use

## How It Works

### Intelligent Capability Inference

The system analyzes the agent type name to infer appropriate capabilities:

- **Research-related**: Enables web search, documentation, analysis
- **Development-related**: Enables code generation, file system, terminal access
- **Design-related**: Enables documentation, analysis, architecture domains
- **Testing-related**: Enables testing, code review, validation
- **Language-specific**: Detects programming languages (python, javascript, rust, etc.)
- **Framework-specific**: Detects frameworks (react, django, express, etc.)

### Example Agent Type Recognition

When you create agents with these types, they automatically get appropriate capabilities:

- `market_researcher` → Research + Web Search + Analysis
- `ux_designer` → Design + Documentation + UI/UX domains
- `frontend_developer` → Code Generation + React/Vue + Frontend domains
- `python_developer` → Code Generation + Python + Terminal Access
- `database_analyst` → Analysis + Database domains + SQL
- `security_specialist` → Code Review + Security domains + Vulnerability Assessment
- `fullstack_developer` → All coding capabilities + Frontend + Backend
- `devops_engineer` → Terminal Access + Infrastructure + Deployment

### Compound Type Recognition

The system recognizes compound patterns:

- Types containing "senior" or "expert" get boosted expertise levels
- Types containing "junior" or "trainee" get adjusted expertise levels
- Types containing "full" and "stack" get comprehensive web development capabilities
- Types containing "data" and "scientist" get data science and ML capabilities

## Usage Examples

### Basic Usage

```javascript
// This will automatically create a "market_researcher" agent type
const agentId = await agentManager.createAgent('market_researcher', {
  name: 'Market Research Specialist'
});
```

### With Custom Capabilities

```javascript
// Create with additional custom capabilities
const agentId = await agentManager.createAgent('seo_specialist', {
  name: 'SEO Expert',
  config: {
    expertise: {
      seo: 0.95,
      content_optimization: 0.9
    }
  }
});
```

### Using Task Tool

When using the Task tool to spawn agents:

```javascript
Task {
  subagent_type: "brand_strategist",
  description: "Create brand positioning strategy",
  prompt: "You are a brand strategist agent..."
}
```

If "brand_strategist" doesn't exist, it will be automatically created with:
- Documentation capabilities
- Analysis capabilities
- Strategy and branding domains

## Configuration Options

### Enable/Disable Auto-Creation

```javascript
// Disable auto-creation
agentManager.setAutoCreation(false);

// Re-enable auto-creation
agentManager.setAutoCreation(true);
```

### Custom Template Handlers

For specialized agent types, you can add custom handlers:

```javascript
agentManager.addCustomTemplateHandler('quantum_researcher', async (type) => {
  return {
    name: 'Quantum Research Specialist',
    type: type,
    capabilities: {
      research: true,
      analysis: true,
      domains: ['quantum-computing', 'physics', 'research'],
      // ... custom capabilities
    },
    // ... rest of template
  };
});
```

### Default Configuration

```javascript
const config = {
  enableAutoCreation: true, // Enabled by default
  autoCreation: {
    inferFromName: true,     // Infer capabilities from agent name
    autoRegister: true,      // Automatically register created templates
    baseCapabilities: {      // Default capabilities for all auto-created agents
      fileSystem: true,
      maxConcurrentTasks: 3,
      reliability: 0.8
    }
  }
};
```

## Persistence

All automatically created agent templates are:
- Stored in memory for the current session
- Persisted to the distributed memory system
- Automatically loaded on system restart
- Tagged as 'auto-created' for easy identification

## Best Practices

1. **Naming Convention**: Use descriptive agent type names that indicate their purpose
   - Good: `react_frontend_developer`, `ai_research_analyst`
   - Less optimal: `agent1`, `worker`

2. **Capability Verification**: After auto-creation, verify the agent has the right capabilities:
   ```javascript
   const agent = agentManager.getAgent(agentId);
   console.log('Agent capabilities:', agent.capabilities);
   ```

3. **Custom Overrides**: Always provide custom capabilities for specialized needs:
   ```javascript
   await agentManager.createAgent('custom_analyst', {
     config: {
       expertise: { 
         custom_domain: 0.9 
       },
       permissions: ['special-access']
     }
   });
   ```

4. **Monitor Creation**: Check auto-creation statistics:
   ```javascript
   const stats = agentManager.getAutoCreationStats();
   console.log('Auto-created templates:', stats.createdTemplates);
   ```

## Error Handling

The system prevents infinite loops with a maximum of 3 creation attempts per agent type. If creation fails:

1. Check the agent type name for typos
2. Verify the system has necessary permissions
3. Check logs for specific error messages
4. Consider using a custom template handler for complex types

## Integration with AIME

When AIME requests new agent types through the Task tool, they are automatically created:

```javascript
// AIME can request any agent type
Task {
  subagent_type: "sustainability_analyst",
  description: "Analyze environmental impact",
  prompt: "..."
}
// "sustainability_analyst" will be auto-created with appropriate capabilities
```

This ensures AIME missions can dynamically create specialized agents as needed without manual template definition.