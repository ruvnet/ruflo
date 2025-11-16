#!/bin/bash
# Run Claude-Flow Test (Treatment - With Coordination)

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           CLAUDE-FLOW TEST (Treatment Group)                 ║"
echo "║      Multi-Agent Coordination with Memory & Hooks            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

cd ~/checkout-claude-flow

# Clean memory databases to ensure fresh start
echo "🧹 Cleaning memory databases..."
rm -rf .swarm/memory.db .hive-mind/hive.db
npx claude-flow@alpha init --force
echo "✅ Clean memory databases initialized"
echo ""

# Record start time
START_TIME=$(date +%s)
echo "⏱️  Start time: $(date)"
echo ""

# Copy requirements
cp /tmp/test-requirements.md ./requirements.md

# Create agent instructions with 6-step protocol
cat > agent-instructions.md << 'EOF'
# Multi-Agent E-Commerce Checkout Development

## Task
Build e-commerce checkout flow per requirements.md

## Agent Roles (6 agents)

### Agent 1: Backend API Developer
- Build Express REST API endpoints
- Implement cart logic (add, remove, update, calculate totals)
- Database schema and migrations
- **MUST publish API contracts to memory for frontend agent**

### Agent 2: Database Architect
- Design PostgreSQL schema
- Create migration files
- **MUST publish schema to memory**

### Agent 3: Frontend Developer
- React checkout UI components
- **MUST read API contracts from memory before starting**
- Multi-step checkout form
- Integration with backend API

### Agent 4: Payment Integration Specialist
- Stripe integration (test mode)
- Payment API endpoint
- Security (no PII in logs)

### Agent 5: Test Engineer
- Jest unit tests (90%+ coverage)
- Cypress E2E tests
- Integration tests

### Agent 6: Code Reviewer
- Review all code for quality
- Check security issues
- Verify test coverage
- Document architecture decisions

## CRITICAL: Every Agent MUST Follow 6-Step Protocol

### Before Starting Work:
```bash
npx claude-flow@alpha hooks pre-task --description "[your task]"
npx claude-flow@alpha hooks session-restore --session-id "checkout-swarm"
```

### Read from Memory:
```bash
# Check what other agents have published
npx claude-flow@alpha memory list --namespace swarm
npx claude-flow@alpha memory read --namespace swarm --key "[relevant-key]"
```

### After Each File Edit:
```bash
npx claude-flow@alpha hooks post-edit --file "[file-path]"
```

### Publish Your Work:
```bash
# Backend publishes API contract
npx claude-flow@alpha memory store --namespace swarm --key "api-contract" --value "$(cat api-docs.json)"

# Database publishes schema
npx claude-flow@alpha memory store --namespace swarm --key "db-schema" --value "$(cat schema.sql)"

# Frontend publishes component structure
npx claude-flow@alpha memory store --namespace swarm --key "ui-structure" --value "$(cat components.md)"
```

### After Completing Tasks:
```bash
npx claude-flow@alpha hooks post-task --task-id "[task-name]"
npx claude-flow@alpha hooks session-end --export-metrics true
```

## Execution Strategy

1. **Database agent** designs schema → publishes to memory
2. **Backend agent** reads schema → builds API → publishes contracts
3. **Payment agent** builds Stripe integration → publishes payment docs
4. **Frontend agent** reads API contracts → builds UI
5. **Test agent** reads all contracts → writes comprehensive tests
6. **Reviewer agent** reviews everything → documents decisions

## Success = Coordination via Memory
- No duplicate work
- Frontend waits for backend contracts
- Tests wait for implementation
- All decisions documented
EOF

echo "📋 Task: Build e-commerce checkout flow with coordination"
echo ""
echo "Files created:"
echo "  - requirements.md (project requirements)"
echo "  - agent-instructions.md (6-step protocol)"
echo ""
echo "🎯 Now run Claude Code and give it this prompt:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Build e-commerce checkout flow using multi-agent coordination."
echo ""
echo "Follow instructions in agent-instructions.md"
echo ""
echo "Use claude-flow coordination:"
echo "- Spawn 6 agents (backend, database, frontend, payment, tester, reviewer)"
echo "- Each agent MUST follow 6-step protocol in agent-instructions.md"
echo "- Use memory for coordination (publish/subscribe pattern)"
echo "- Backend publishes API contracts before frontend starts"
echo "- Database publishes schema before backend starts"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "When done, press ENTER to record completion time..."
read

# Record end time
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
MINUTES=$((DURATION / 60))
SECONDS=$((DURATION % 60))

echo ""
echo "✅ Claude-flow test complete!"
echo "⏱️  Duration: ${MINUTES}m ${SECONDS}s"
echo ""

# Check memory usage
echo "📊 Memory Coordination Stats:"
sqlite3 .swarm/memory.db "SELECT COUNT(*) as entries FROM memory_entries;" 2>/dev/null || echo "  Memory DB not found"

# Create results template
cat > results-claude-flow.md << EOF
# Claude-Flow Test Results

**Date**: $(date)
**Duration**: ${MINUTES}m ${SECONDS}s

## Code Quality Metrics

### Test Coverage
\`\`\`bash
npm run test:coverage
\`\`\`
- Overall coverage: ____%
- Line coverage: ____%
- Branch coverage: ____%

### TypeScript Errors
\`\`\`bash
npx tsc --noEmit
\`\`\`
- Errors: ____

### ESLint Issues
\`\`\`bash
npx eslint . --ext .ts,.tsx
\`\`\`
- Errors: ____
- Warnings: ____

## Functionality Test

| Feature | Working? | Notes |
|---------|----------|-------|
| Add to cart | [ ] | |
| Remove from cart | [ ] | |
| Update quantity | [ ] | |
| Calculate totals | [ ] | |
| Apply discount | [ ] | |
| Shipping address | [ ] | |
| Payment method | [ ] | |
| Stripe payment | [ ] | |
| Order confirmation | [ ] | |

## Bugs Found

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | ____ | |
| Major | ____ | |
| Minor | ____ | |

## Coordination Metrics

### Memory Usage
\`\`\`bash
npx claude-flow@alpha memory list --namespace swarm
\`\`\`
- Memory entries created: ____
- API contracts published: [ ] Yes [ ] No
- Database schema published: [ ] Yes [ ] No
- Frontend read contracts: [ ] Yes [ ] No

### Coordination Failures
- Duplicate work instances: ____
- Missing dependencies: ____
- Integration failures: ____
- Context loss instances: ____

## Notes
- Coordination improvements observed:
- Memory usage patterns:
- Hook execution:
EOF

echo "📝 Results template created: results-claude-flow.md"
echo ""
echo "📊 Next steps:"
echo "  1. Run test coverage: npm run test:coverage"
echo "  2. Check TypeScript: npx tsc --noEmit"
echo "  3. Check ESLint: npx eslint . --ext .ts,.tsx"
echo "  4. Check memory: npx claude-flow@alpha memory list --namespace swarm"
echo "  5. Fill out results-claude-flow.md"
