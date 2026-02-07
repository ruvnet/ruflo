---
name: workflow-automation
description: >
  Workflow creation, execution, and template management. Automates complex multi-step processes with agent coordination.
  Use when: automating processes, creating reusable workflows, orchestrating multi-step tasks.
  Skip when: simple single-step tasks, ad-hoc operations.
---

# Workflow Automation Skill

## Purpose
Create and execute automated workflows for complex multi-step processes.

## When to Trigger
- Multi-step automated processes
- Reusable workflow creation
- Complex task orchestration
- CI/CD pipeline setup

## Commands

### Create Workflow
```bash
npx claude-flow workflow create --name "deploy-flow" --template ci
```

### Execute Workflow
```bash
npx claude-flow workflow execute --name "deploy-flow" --env production
```

### List Workflows
```bash
npx claude-flow workflow list
```

### Export Template
```bash
npx claude-flow workflow export --name "deploy-flow" --format yaml
```

### View Status
```bash
npx claude-flow workflow status --name "deploy-flow"
```

## Built-in Templates

| Template | Description |
|----------|-------------|
| `ci` | Continuous integration pipeline |
| `deploy` | Deployment workflow |
| `test` | Testing workflow |
| `release` | Release automation |
| `review` | Code review workflow |

## Workflow Structure
```yaml
name: example-workflow
steps:
  - name: analyze
    agent: researcher
    task: "Analyze requirements"
  - name: implement
    agent: coder
    depends: [analyze]
    task: "Implement solution"
  - name: test
    agent: tester
    depends: [implement]
    task: "Write and run tests"
```

## Best Practices
1. Define clear step dependencies
2. Use appropriate agent types per step
3. Include validation gates
4. Export workflows for reuse
