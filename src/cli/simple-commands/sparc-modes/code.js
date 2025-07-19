// code.js - Auto-Coder mode orchestration template
export function getCodeOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps

1. **Project Directory Setup & Context Review** (5 mins)
   - Verify current working directory and create project structure
   - For named projects (e.g., "hello-world"), create as subdirectory
   - Review implementation task: "${taskDescription}"
   - Query architecture and pseudocode: 
     \`\`\`bash
     npx gemini-flow memory query ${memoryNamespace}_architecture
     npx gemini-flow memory query ${memoryNamespace}_pseudocode
     npx gemini-flow memory query ${memoryNamespace}_tech_specs
     \`\`\`
   - Identify modules to implement and their boundaries
   - Review configuration requirements
   - Check for any blocking dependencies

2. **Project Setup & Configuration** (10 mins)
   - Initialize project structure in current directory or subdirectory
   - IMPORTANT: Use pwd to verify you're NOT in node_modules/
   - Set up environment configuration (NO hardcoded values):
     - Create .env.example with all required variables
     - Set up config/ directory with environment loaders
     - Implement secrets management abstraction
   - Install dependencies based on tech specs
   - Create module structure (each file < 500 lines)
   - Store setup: \`npx gemini-flow memory store ${memoryNamespace}_setup "Project structure: src/{domain,application,infrastructure}. Config: dotenv + vault integration. Dependencies: express, joi, winston."\`

3. **Modular Implementation** (30 mins)
   - Implement features using clean architecture principles:
     - Domain layer: Business entities and rules
     - Application layer: Use cases and workflows
     - Infrastructure layer: External integrations
   - Follow SOLID principles and dependency injection
   - Keep each module/file under 500 lines
   - Use configuration for ALL environment-specific values
   - Implement comprehensive error handling
   - Add structured logging with context
   - Store progress: \`npx gemini-flow memory store ${memoryNamespace}_implementation "Completed: auth-service (3 modules), user-repository (2 modules). Remaining: notification-service."\`

4. **Integration & Basic Testing** (15 mins)
   - Wire up dependency injection container
   - Connect modules following architecture design
   - Implement health checks and monitoring endpoints
   - Add input validation and sanitization
   - Create smoke tests for critical paths
   - Verify configuration loading works correctly
   - Test error scenarios and graceful degradation
   - Store results: \`npx gemini-flow memory store ${memoryNamespace}_tests "Smoke tests passing. Health checks operational. Error handling verified. Ready for TDD mode deep testing."\`

5. **Code Quality & Documentation** (10 mins)
   - Run linters and formatters
   - Add inline documentation for complex logic
   - Create API documentation (if applicable)
   - Generate dependency graphs
   - Update README with setup instructions
   - Store completion: \`npx gemini-flow memory store ${memoryNamespace}_code_complete "Implementation complete. All modules < 500 lines. No hardcoded secrets. Ready for testing and integration."\`

## Directory Safety Check
Before creating any files:
1. Run \`pwd\` to verify current directory
2. Ensure you're NOT in /node_modules/ or any system directory
3. If creating a named project, create it as a subdirectory
4. Example: For "hello-world", create ./hello-world/ in current directory

## Deliverables
All files should be created relative to the current working directory:
- src/
  - domain/ (business logic, < 500 lines per file)
  - application/ (use cases, < 500 lines per file)
  - infrastructure/ (external integrations)
  - config/ (environment management)
- tests/
  - smoke/ (basic functionality tests)
  - fixtures/ (test data)
- config/
  - .env.example (all required variables)
  - config.js (environment loader)
- docs/
  - API.md (if applicable)
  - SETUP.md (detailed setup guide)

## Tool Usage Reminders
- Use \`insert_content\` for new files or empty targets
- Use \`apply_diff\` for modifying existing code with complete search/replace blocks
- Avoid \`search_and_replace\` unless absolutely necessary
- Always verify all tool parameters before execution

## Next Steps - Sequential and Background Options
After implementation, choose appropriate execution mode:

### Sequential Mode (for simple follow-up tasks):
- \`npx gemini-flow sparc run tdd "Write comprehensive tests for ${taskDescription}" --non-interactive\`
- \`npx gemini-flow sparc run security-review "Security audit for ${taskDescription}" --non-interactive\`

### Background Swarm Mode (for complex comprehensive tasks):
- \`npx gemini-flow swarm "Create comprehensive test suite with unit, integration, and e2e tests for ${taskDescription}" --strategy testing --background --parallel\`
- \`npx gemini-flow swarm "Perform full security audit and penetration testing for ${taskDescription}" --strategy analysis --background --review\`
- \`npx gemini-flow swarm "Generate complete documentation, API specs, and deployment guides for ${taskDescription}" --strategy research --background\`

## 🐝 Enhanced Development with Background Swarms
Leverage background swarm processing for large-scale development:

\`\`\`bash
# Background comprehensive implementation swarm
npx gemini-flow swarm "Implement complete ${taskDescription} with all modules, testing, and documentation" \\
  --strategy development --background --parallel --monitor --testing \\
  --max-agents 6 --output ./implementation

# Background quality assurance swarm
npx gemini-flow swarm "Comprehensive QA including testing, security review, and performance optimization for ${taskDescription}" \\
  --strategy testing --background --review --monitor \\
  --output ./qa-results

# Background documentation and deployment swarm
npx gemini-flow swarm "Create production-ready documentation, deployment scripts, and monitoring for ${taskDescription}" \\
  --strategy research --background --parallel \\
  --output ./deployment-ready

# Monitor all background development
npx gemini-flow status
npx gemini-flow monitor
\`\`\`

## 🔄 Hybrid SPARC-Swarm Development Workflow
Combine SPARC modes with background swarms for optimal development velocity:

\`\`\`bash
# Phase 1: Quick prototyping (SPARC)
npx gemini-flow sparc run code "Core ${taskDescription} prototype" --non-interactive

# Phase 2: Parallel background development (Swarm)
npx gemini-flow swarm "Full implementation of ${taskDescription} with advanced features" --strategy development --background --parallel &
npx gemini-flow swarm "Comprehensive testing strategy for ${taskDescription}" --strategy testing --background &
npx gemini-flow swarm "Security hardening and performance optimization" --strategy optimization --background &

# Phase 3: Integration and deployment (Background)
npx gemini-flow swarm "Integration testing and production deployment preparation for ${taskDescription}" \\
  --strategy integration --background --monitor --testing \\
  --output ./production-ready

# Monitor all development streams
npx gemini-flow status
tail -f ./swarm-runs/*/swarm.log
\`\`\``;
}