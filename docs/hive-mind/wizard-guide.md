# 🧙 Hive Mind Interactive Wizard Guide

## Introduction

The Hive Mind Interactive Wizard is your gateway to effortless AI-powered development. This guide walks you through every step of the wizard, explaining options and providing tips for optimal results.

## Starting the Wizard

Launch the wizard with a simple command:

```bash
npx claude-flow@2.0.0 hive-mind
```

You'll be greeted with:

```
🐝 Welcome to Hive Mind - Intelligent Task Orchestration

This wizard will help you break down and conquer any development task
using coordinated AI agents that work together seamlessly.

Press Enter to begin...
```

## Wizard Flow

### Step 1: Task Description

```
📝 What would you like to build or accomplish?

> _
```

**What to Enter:**
- Be specific but concise
- Include key requirements
- Mention technologies if you have preferences

**Good Examples:**
- "Build a REST API with JWT authentication and PostgreSQL"
- "Create a React dashboard with real-time charts and user management"
- "Migrate Express.js app to use TypeScript and add unit tests"

**Poor Examples:**
- "Make an app" (too vague)
- "Fix my code" (no context)
- "Something with AI" (unclear goal)

### Step 2: Complexity Assessment

```
🎯 How complex is this task?

1) Simple    - Single feature, straightforward implementation
2) Medium    - Multiple features, some integration work
3) High      - Complex system, many moving parts
4) Very High - Enterprise-level, extensive requirements

Select complexity (1-4): _
```

**Guidelines:**
- **Simple**: 1-2 hours of traditional work
- **Medium**: 2-8 hours of traditional work
- **High**: 1-3 days of traditional work
- **Very High**: 3+ days of traditional work

**Impact of Selection:**
- Determines number of agents spawned
- Affects coordination strategy
- Influences time estimates

### Step 3: Feature Requirements

```
✨ What features are essential? (Check all that apply)

[ ] Authentication & Authorization
[ ] Database Design & Integration
[ ] API Development
[ ] Frontend UI/UX
[ ] Real-time Features (WebSockets)
[ ] File Upload/Processing
[ ] Third-party Integrations
[ ] Testing Suite
[ ] Documentation
[ ] DevOps/Deployment

Use arrow keys to navigate, Space to select, Enter to continue
```

**Tips:**
- Select all that apply to your project
- More features = more specialized agents
- Each feature gets dedicated attention
- Don't worry about over-selecting

### Step 4: Timeline Preference

```
⏱️ What's your timeline preference?

1) ASAP      - Maximize speed, parallel execution
2) Balanced  - Good mix of speed and thoroughness  
3) Thorough  - Focus on quality and completeness
4) Learning  - Include detailed explanations

Select preference (1-4): _
```

**What Each Means:**
- **ASAP**: Maximum parallelization, minimal explanations
- **Balanced**: Optimal for most projects
- **Thorough**: Comprehensive testing and documentation
- **Learning**: Educational mode with detailed reasoning

### Step 5: Technology Stack (Optional)

```
🛠️ Any specific technologies or frameworks? (Optional)

Backend:  [Node.js, Python, Go, Java, etc.]
Frontend: [React, Vue, Angular, Vanilla, etc.]
Database: [PostgreSQL, MongoDB, MySQL, etc.]
Other:    [Docker, Kubernetes, AWS, etc.]

Press Enter to skip or type your preferences: _
```

**Examples:**
- "Backend: Node.js with Express, Frontend: React with TypeScript"
- "Python FastAPI, PostgreSQL, Redis for caching"
- "Next.js full-stack with Prisma ORM"
- Just press Enter to let Hive Mind choose

### Step 6: Additional Context (Optional)

```
📋 Any additional context or requirements? (Optional)

Examples:
- "Must integrate with existing REST API at /api/v2"
- "Follow company coding standards in style-guide.md"
- "Optimize for mobile-first design"
- "Include comprehensive error handling"

Enter additional context or press Enter to skip: _
```

**When to Use:**
- Existing codebase constraints
- Specific business requirements
- Performance targets
- Security considerations

### Step 7: Confirmation

```
🎯 Task Summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Task:        Build REST API with authentication
Complexity:  High
Features:    ✓ Auth ✓ Database ✓ API ✓ Tests ✓ Docs
Timeline:    Balanced
Stack:       Node.js, PostgreSQL, JWT

Estimated Agents: 6
Topology:        Hierarchical
Time Estimate:   45-60 minutes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proceed with this configuration? (Y/n): _
```

**Options:**
- **Y/Enter**: Start Hive Mind orchestration
- **n**: Return to modify options
- **Ctrl+C**: Cancel entirely

## During Execution

### Live Progress Display

Once confirmed, you'll see real-time progress:

```
🐝 Hive Mind Active - Building REST API with authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Spawning Agents]
✓ Architect-Prime    - System design specialist
✓ Coder-Alpha       - Backend implementation
✓ Coder-Beta        - Authentication specialist  
✓ Analyst-Core      - Database design
✓ Tester-Unit       - Quality assurance
✓ Documenter-Pro    - Documentation generation

[Task Orchestration]
▶ Analyzing requirements...
  └─ 23 subtasks identified
  └─ Dependencies mapped
  └─ Execution plan created

[Agent Activity]
🟢 Architect-Prime:   Designing API structure...
🟢 Analyst-Core:      Creating database schema...
🟢 Coder-Alpha:       Setting up project structure...
🟡 Coder-Beta:        Waiting for structure...
🟡 Tester-Unit:       Preparing test framework...
🟢 Documenter-Pro:    Initializing documentation...

[Progress] ████████░░░░░░░░░░░░ 42% | Time: 3m 27s
```

### Status Indicators

- 🟢 **Green**: Agent actively working
- 🟡 **Yellow**: Agent waiting on dependencies
- 🔴 **Red**: Agent blocked or error
- ✓ **Checkmark**: Task completed
- ▶ **Arrow**: Current focus

### Interactive Commands During Execution

While Hive Mind is running, you can:

- **Space**: Pause/Resume execution
- **M**: Show memory usage
- **A**: Show agent details
- **T**: Show task breakdown
- **L**: Show logs
- **Q**: Quit (with confirmation)

## Completion

### Success Display

```
✨ Hive Mind Task Completed Successfully!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Summary
- Total Time:      12m 34s (4.2x faster)
- Agents Used:     6
- Tasks Completed: 23/23
- Files Created:   18
- Tests Written:   42
- Coverage:        94%

📁 Output Structure
project/
├── src/
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   └── utils/
├── tests/
├── docs/
├── package.json
├── README.md
└── .env.example

🎯 Key Accomplishments
✓ JWT authentication with refresh tokens
✓ PostgreSQL schema with migrations
✓ RESTful API with validation
✓ Comprehensive test suite
✓ API documentation (OpenAPI)
✓ Docker configuration

📋 Next Steps
1. Run 'npm install' to install dependencies
2. Set up PostgreSQL database
3. Copy .env.example to .env
4. Run 'npm run migrate' for database
5. Start with 'npm run dev'

View detailed report? (Y/n): _
```

### Detailed Report

If you choose to view the report:

```
📊 Detailed Hive Mind Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent Performance
┌─────────────────┬────────┬─────────┬──────────┐
│ Agent           │ Tasks  │ Time    │ Tokens   │
├─────────────────┼────────┼─────────┼──────────┤
│ Architect-Prime │ 3      │ 1m 12s  │ 2,341    │
│ Coder-Alpha     │ 8      │ 4m 23s  │ 8,234    │
│ Coder-Beta      │ 5      │ 3m 45s  │ 6,122    │
│ Analyst-Core    │ 3      │ 2m 01s  │ 3,445    │
│ Tester-Unit     │ 4      │ 2m 34s  │ 4,567    │
│ Documenter-Pro  │ 2      │ 1m 39s  │ 2,890    │
└─────────────────┴────────┴─────────┴──────────┘

Task Breakdown
├── Architecture Design      ✓ 1m 12s
├── Database Schema         ✓ 2m 01s  
├── Project Setup           ✓ 0m 45s
├── Auth Implementation     ✓ 3m 45s
├── API Endpoints           ✓ 4m 23s
├── Test Suite              ✓ 2m 34s
└── Documentation           ✓ 1m 39s

Quality Metrics
- Code Coverage:     94%
- Linting Passed:    ✓
- Tests Passing:     42/42
- Security Scan:     ✓
- Documentation:     Complete

Save full report? (Y/n): _
```

## Advanced Wizard Features

### Quick Mode

Skip the wizard with command-line options:

```bash
npx claude-flow@2.0.0 hive-mind \
  --task "Build chat application" \
  --complexity high \
  --features "auth,database,api,frontend,realtime,tests" \
  --timeline balanced
```

### Template Mode

Use predefined templates:

```bash
npx claude-flow@2.0.0 hive-mind --template rest-api
```

Available templates:
- `rest-api` - REST API with authentication
- `full-stack` - Complete web application
- `microservices` - Microservice architecture
- `cli-tool` - Command-line application
- `migration` - Code migration project

### Replay Mode

Replay a previous task configuration:

```bash
npx claude-flow@2.0.0 hive-mind --replay ./hive-mind-task-12345.json
```

## Tips for Best Results

### 1. Task Description
- Be specific about your needs
- Include acceptance criteria
- Mention any constraints
- Specify integrations needed

### 2. Feature Selection
- Don't be afraid to select many features
- Each feature gets specialized attention
- More features = better coverage
- Agents coordinate automatically

### 3. Technology Choices
- Let Hive Mind choose if unsure
- Specify only strong preferences
- Include version requirements
- Mention existing tech stack

### 4. Timeline Selection
- ASAP for prototypes
- Balanced for production
- Thorough for critical systems
- Learning for education

### 5. Monitoring
- Watch agent coordination
- Note any blockers
- Check memory usage
- Review dependencies

## Common Scenarios

### Scenario 1: Quick Prototype

```
Task: Build a todo app with user accounts
Complexity: Simple
Features: Auth, Database, Frontend
Timeline: ASAP
Tech: (skip - let Hive Mind choose)
```

Result: Working prototype in ~15 minutes

### Scenario 2: Production API

```
Task: Build scalable e-commerce API with payments
Complexity: High  
Features: Auth, Database, API, Tests, Docs
Timeline: Thorough
Tech: Node.js, PostgreSQL, Stripe
```

Result: Production-ready API in ~45 minutes

### Scenario 3: System Migration

```
Task: Migrate Python Django app to Node.js Express
Complexity: Very High
Features: All applicable
Timeline: Learning
Tech: Express, PostgreSQL, TypeScript
Context: Maintain all existing endpoints
```

Result: Complete migration with documentation

## Troubleshooting

### Wizard Freezes
- Check terminal compatibility
- Try `--non-interactive` mode
- Use web UI instead

### Unclear Options
- Use help: `npx claude-flow@2.0.0 hive-mind --help`
- Check examples in this guide
- Start simple, add complexity

### Task Too Vague
- Add specific requirements
- List desired features
- Include example outputs
- Specify technologies

## Next Steps

After mastering the wizard:

1. Try [CLI Commands](./cli-commands.md) for more control
2. Explore [Examples](./examples.md) for inspiration
3. Read [API Reference](./api-reference.md) for automation
4. Check [Troubleshooting](./troubleshooting.md) for issues

The wizard is your friendly guide to AI-powered development. Let it handle the complexity while you focus on your vision!