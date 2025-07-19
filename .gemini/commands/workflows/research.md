# Research Workflow Coordination

## Purpose
Coordinate Gemini CLI's research activities for comprehensive, systematic exploration.

## Step-by-Step Coordination

### 1. Initialize Research Framework
```
Tool: mcp__claude-flow__swarm_init
Parameters: {"topology": "mesh", "maxAgents": 5, "strategy": "balanced"}
```
Creates a mesh topology for comprehensive exploration from multiple angles.

### 2. Define Research Perspectives
```
Tool: mcp__claude-flow__agent_spawn
Parameters: {"type": "researcher", "name": "Literature Review"}
```
```
Tool: mcp__claude-flow__agent_spawn  
Parameters: {"type": "analyst", "name": "Data Analysis"}
```
Sets up different analytical approaches for Gemini CLI to use.

### 3. Execute Coordinated Research
```
Tool: mcp__claude-flow__task_orchestrate
Parameters: {"task": "Research modern web frameworks performance", "strategy": "adaptive"}
```

## What Gemini CLI Actually Does
1. Uses **WebSearch** tool for finding resources
2. Uses **Read** tool for analyzing documentation
3. Uses **Task** tool for parallel exploration
4. Synthesizes findings using coordination patterns
5. Stores insights in memory for future reference

Remember: The swarm coordinates HOW Gemini CLI researches, not WHAT it finds.