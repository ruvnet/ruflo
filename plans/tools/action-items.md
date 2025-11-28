# Action Items: MCP Tool Improvement Implementation

## Summary

Based on Anthropic's Advanced Tool Use guide, implement three key improvements:
1. **Deferred Loading** - 85% token reduction
2. **Programmatic Calling** - 37% token reduction
3. **Tool Examples** - Improved accuracy

---

## Phase 1: Deferred Loading (Week 1-2)

### Ticket 1.1: Create Deferred Loading Configuration
**Priority:** P0 | **Effort:** 2 hours

- Create `src/mcp/schemas/deferred-loading.ts`
- Define `CORE_TOOLS` (always loaded)
- Define `DEFERRED_TOOLS` (lazy loaded)
- Add `defer_loading` flag to tool metadata

**Acceptance Criteria:**
- [ ] Configuration file created
- [ ] All 50+ tools categorized
- [ ] Tests pass

---

### Ticket 1.2: Update Progressive Registry for Defer Support
**Priority:** P0 | **Effort:** 4 hours

- Modify `src/mcp/tool-registry-progressive.ts`
- Only register core tools initially
- Implement on-demand loading for deferred tools
- Add token savings logging

**Acceptance Criteria:**
- [ ] Core tools load on init
- [ ] Deferred tools load on first call
- [ ] Token savings logged

---

### Ticket 1.3: Enhance tools/search Tool
**Priority:** P0 | **Effort:** 3 hours

- Update `src/mcp/tools/system/search.ts`
- Add regex pattern matching
- Add relevance scoring
- Add description search
- Add `includeSchema` option

**Acceptance Criteria:**
- [ ] Regex patterns work
- [ ] Results sorted by relevance
- [ ] Schema optionally included

---

### Ticket 1.4: Token Savings Metrics
**Priority:** P1 | **Effort:** 2 hours

- Create `src/mcp/utils/token-calculator.ts`
- Add metrics to registry
- Log savings on startup

**Acceptance Criteria:**
- [ ] Token estimation working
- [ ] Savings logged
- [ ] Before/after comparison available

---

## Phase 2: Tool Examples (Week 2-3)

### Ticket 2.1: Create Examples Schema
**Priority:** P1 | **Effort:** 1 hour

- Create `src/mcp/schemas/tool-examples.ts`
- Define `ToolExample` interface
- Add validation function

**Acceptance Criteria:**
- [ ] Schema defined
- [ ] Validation function works

---

### Ticket 2.2: Add Examples to Core Tools
**Priority:** P1 | **Effort:** 4 hours

Add examples to:
- `agents/spawn`
- `agents/list`
- `tasks/create`
- `tasks/list`
- `memory/query`
- `memory/store`
- `system/status`

**Acceptance Criteria:**
- [ ] Each tool has 2-3 examples
- [ ] Examples include minimal/typical/advanced
- [ ] All examples validate against schema

---

### Ticket 2.3: Add Examples to Swarm Tools
**Priority:** P1 | **Effort:** 3 hours

Add examples to:
- `swarm/create-objective`
- `swarm/execute-objective`
- `swarm/get-status`
- `swarm/emergency-stop`

**Acceptance Criteria:**
- [ ] Each tool has examples
- [ ] Strategy options demonstrated
- [ ] Task structures shown

---

### Ticket 2.4: Enhanced Return Documentation
**Priority:** P2 | **Effort:** 2 hours

Add return format documentation to all list/query tools:
- Document return structure in description
- Add `returnSchema` property (optional)

**Acceptance Criteria:**
- [ ] All query tools have return docs
- [ ] Format clear and consistent

---

## Phase 3: Programmatic Calling (Week 3-4)

### Ticket 3.1: Create Sandbox Executor
**Priority:** P2 | **Effort:** 6 hours

- Create `src/mcp/programmatic/sandbox-executor.ts`
- Implement isolated code execution
- Inject tool functions
- Track metrics

**Acceptance Criteria:**
- [ ] Code executes in sandbox
- [ ] Tools accessible as functions
- [ ] Timeout/memory limits work
- [ ] Metrics tracked

---

### Ticket 3.2: Create Batch Operation Tools
**Priority:** P2 | **Effort:** 4 hours

- Create `src/mcp/programmatic/batch-tools.ts`
- Implement `batch/query-memories`
- Implement `batch/create-tasks`
- Implement `batch/agent-status`

**Acceptance Criteria:**
- [ ] Batch tools work
- [ ] Results aggregated
- [ ] Parallel execution supported

---

### Ticket 3.3: Create execute-code Tool
**Priority:** P2 | **Effort:** 3 hours

- Create `src/mcp/tools/system/execute-code.ts`
- Integrate with sandbox
- Add examples for common patterns

**Acceptance Criteria:**
- [ ] Tool works end-to-end
- [ ] Parallel execution works
- [ ] Token savings reported

---

### Ticket 3.4: SDK Integration
**Priority:** P2 | **Effort:** 2 hours

- Update `src/mcp/sdk-integration.ts`
- Add `allowed_callers` to tools
- Configure code execution mode

**Acceptance Criteria:**
- [ ] SDK config updated
- [ ] Programmatic tools accessible
- [ ] Integration tested

---

## Phase 4: Documentation & Testing (Week 4)

### Ticket 4.1: Generate Documentation
**Priority:** P2 | **Effort:** 2 hours

- Create doc generator
- Generate Markdown reference
- Generate TypeScript types

**Acceptance Criteria:**
- [ ] Markdown docs generated
- [ ] Types generated
- [ ] Auto-update in CI

---

### Ticket 4.2: Integration Tests
**Priority:** P1 | **Effort:** 4 hours

- Test deferred loading
- Test programmatic calling
- Test example validation
- Test token savings

**Acceptance Criteria:**
- [ ] All features tested
- [ ] Coverage > 80%
- [ ] CI passing

---

### Ticket 4.3: Performance Benchmarks
**Priority:** P2 | **Effort:** 2 hours

- Benchmark token usage
- Benchmark latency
- Compare before/after

**Acceptance Criteria:**
- [ ] Benchmarks documented
- [ ] Target metrics met

---

## Timeline

```
Week 1: Phase 1 (Deferred Loading) - Tickets 1.1-1.4
Week 2: Phase 2 Start (Examples) - Tickets 2.1-2.2
Week 3: Phase 2 Finish + Phase 3 Start - Tickets 2.3-2.4, 3.1
Week 4: Phase 3 Finish + Phase 4 - Tickets 3.2-3.4, 4.1-4.3
```

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Token reduction | 80% | Compare context size |
| Tool accuracy | +15% | Track call success rate |
| First-try success | +20% | Track retry rate |
| Latency | -30% | Benchmark complex workflows |

---

## Dependencies

- `vm2` or `isolated-vm` package for sandbox (Phase 3)
- No external dependencies for Phase 1-2

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking changes | Feature flag for new behavior |
| Performance regression | Benchmark before/after |
| SDK incompatibility | Test with latest SDK |

---

## Review Checklist

Before merge:
- [ ] All tests pass
- [ ] TypeScript compiles
- [ ] Linting passes
- [ ] Documentation updated
- [ ] Metrics logged
- [ ] Backwards compatible
