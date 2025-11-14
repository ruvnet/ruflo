# Swarm Task: [Task Name]

## Objective
[Clear, specific description of what needs to be built/analyzed/implemented]

## Context
[Background information, why this is needed, what exists already]

## Claude-Flow Command

```bash
# Execute this swarm task
npx claude-flow@alpha swarm "[Detailed objective with specific requirements:
- Requirement 1 with technical details (e.g., Express.js 4.18+ with TypeScript 5.0+)
- Requirement 2 with frameworks/libraries (e.g., PostgreSQL 14+ with TypeORM)
- Requirement 3 with quality standards (e.g., >90% test coverage with Jest)
- Requirement 4 with deliverables (e.g., OpenAPI 3.0 documentation)
- Requirement 5 with constraints (e.g., response time < 200ms)
]" \
  --strategy [research|development|analysis|testing|optimization|maintenance] \
  --mode [centralized|distributed|mesh|hierarchical|hybrid] \
  --max-agents [number] \
  --parallel \
  --executor
```

## Expected Agent Configuration

Based on the `--mode [X] --max-agents [N]` configuration:
- Nx [Agent Type] ([specific responsibility, e.g., "Express.js + TypeScript implementation"])
- Nx [Agent Type] ([specific responsibility, e.g., "PostgreSQL schema design and migrations"])
- Nx [Agent Type] ([specific responsibility, e.g., "Jest test suite with >90% coverage"])
- Nx [Agent Type] ([specific responsibility, e.g., "Security review for authentication"])

## Success Criteria
- [ ] Measurable criterion 1 with verification method (e.g., "All endpoints return 200 status with valid JWT")
- [ ] Measurable criterion 2 with acceptance test (e.g., "Test coverage > 90% verified by Jest report")
- [ ] Measurable criterion 3 with deliverable (e.g., "OpenAPI documentation accessible at /api-docs")
- [ ] Measurable criterion 4 with quality gate (e.g., "No security vulnerabilities in npm audit")

## Dependencies
- [Existing code/systems that must be used - e.g., "Database connection in src/config/db.ts"]
- [Required data/resources - e.g., "JWT secret from environment variable JWT_SECRET"]
- [External services/APIs - e.g., "SendGrid for email verification"]

## Constraints
- **Time**: [if any - e.g., "Must complete within 2 sprints"]
- **Resources**: [if limited - e.g., "Development environment only, no AWS access"]
- **Technical**: [specific technology requirements - e.g., "Must use TypeScript 5.0+, Node.js 18+"]
- **Quality**: [code coverage, performance targets - e.g., ">90% coverage, <200ms response time"]

## Deliverables
- [ ] Source code with tests (e.g., "src/api/ and src/auth/ with corresponding test files")
- [ ] Documentation (e.g., "README.md with setup instructions, API documentation")
- [ ] Configuration files (e.g., ".env.example, docker-compose.yaml")
- [ ] Deployment guides (if applicable - e.g., "docs/deployment/production-setup.md")

## Notes
[Additional context, warnings, or special considerations]
- Example: "Use existing database connection from src/config/db.ts"
- Example: "Follow security best practices from docs/security-guidelines.md"
- Example: "JWT secret must be from environment variable, never hardcoded"

---

## Quick Reference

### Strategy Guide
- `research` - Web search, data gathering, documentation review
- `development` - Code implementation, feature development
- `analysis` - Performance/security audits, code quality
- `testing` - Unit/integration/E2E testing
- `optimization` - Performance tuning, resource optimization
- `maintenance` - Bug fixes, dependency updates

### Mode (Topology) Guide
- `centralized` - Single coordinator (best for: simple tasks, 3-8 agents)
- `distributed` - Multiple coordinators (best for: large-scale, 15+ agents)
- `mesh` - Peer-to-peer (best for: collaborative, consensus-driven)
- `hierarchical` - Tree structure (best for: complex projects, clear phases)
- `hybrid` - Mixed strategies (best for: multi-phase projects)

### Agent Sizing
- **3-5 agents**: Single file, bug fixes, simple features
- **6-10 agents**: Multi-file features, API endpoints, test suites
- **10-20 agents**: Microservices, system refactoring, research

### Key Flags
- `--parallel` - Enable parallel execution (2.8-4.4x faster)
- `--executor` - Use built-in autonomous executor
- `--analysis` - Read-only mode (no code changes)
- `--memory-namespace <name>` - Share knowledge across phases
