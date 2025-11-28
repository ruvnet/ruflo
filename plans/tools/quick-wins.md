# Quick Wins: Immediate Improvements

Changes that can be implemented immediately with minimal risk.

---

## 1. Add Examples to Top 10 Tools (1-2 hours)

**Files to modify:** `src/mcp/claude-flow-tools.ts`

Add `examples` array to these tools:

```typescript
// Template for adding examples
const exampleTemplate = {
  description: 'What this example shows',
  complexity: 'minimal' | 'typical' | 'advanced',
  input: { /* actual parameters */ }
};
```

### Priority List

| Tool | Status | Notes |
|------|--------|-------|
| `agents/spawn` | TODO | Multiple agent types |
| `agents/list` | TODO | Filter options |
| `tasks/create` | TODO | Dependencies, assignment |
| `tasks/list` | TODO | Status filtering |
| `memory/query` | TODO | Multiple filters |
| `memory/store` | TODO | Type options |
| `system/status` | TODO | Simple |
| `workflow/execute` | TODO | File vs inline |
| `swarm/create-objective` | TODO | Strategy options |
| `swarm/get-status` | TODO | Detail levels |

---

## 2. Enhance Tool Descriptions (30 min)

Add return format documentation to descriptions:

**Before:**
```typescript
description: 'List all active agents'
```

**After:**
```typescript
description: `List all active agents in the system.

Returns:
- agents: Array of {id, name, type, status, currentTask}
- count: Number of agents
- timestamp: ISO 8601 timestamp

Status values: "active", "idle", "busy", "terminated"`
```

### Tools needing enhanced descriptions
- `agents/list`
- `tasks/list`
- `memory/query`
- `workflow/list`
- `swarm/get-status`

---

## 3. Configure Deferred Loading for Low-Use Tools (30 min)

**File:** `src/mcp/schemas/deferred-loading.ts` (create)

Mark these tools as `defer_loading: true`:

- All `terminal/*` tools
- All `config/*` tools
- `memory/export`, `memory/import`
- `workflow/create`
- `query/control`, `query/list`

---

## 4. Improve Error Messages (1 hour)

Add better error context to handlers:

**Before:**
```typescript
if (!context?.orchestrator) {
  throw new Error('Orchestrator not available');
}
```

**After:**
```typescript
if (!context?.orchestrator) {
  throw new Error(
    'Orchestrator not available. ' +
    'Ensure claude-flow is properly initialized with an orchestrator context.'
  );
}
```

---

## 5. Add Format Hints to Schema Properties (30 min)

Add `format` hints where applicable:

```typescript
{
  timeout: {
    type: 'number',
    description: 'Timeout in milliseconds (e.g., 30000 for 30 seconds)',
    format: 'milliseconds',  // Add format hint
    default: 30000
  },
  startTime: {
    type: 'string',
    description: 'Filter entries after this time',
    format: 'date-time',  // ISO 8601
    example: '2024-01-15T10:00:00Z'
  },
  priority: {
    type: 'number',
    description: 'Priority level (1=lowest, 10=highest)',
    minimum: 1,
    maximum: 10,
    default: 5
  }
}
```

---

## 6. Add Input Validation (1 hour)

Add validation for common errors:

```typescript
// In handlers, add validation
handler: async (input: any, context?: ClaudeFlowToolContext) => {
  // Validate priority range
  if (input.priority && (input.priority < 1 || input.priority > 10)) {
    throw new Error('Priority must be between 1 and 10');
  }

  // Validate timeout
  if (input.timeout && input.timeout < 1000) {
    throw new Error('Timeout must be at least 1000ms (1 second)');
  }

  // Validate datetime format
  if (input.startTime && isNaN(Date.parse(input.startTime))) {
    throw new Error('startTime must be valid ISO 8601 datetime');
  }

  // ... rest of handler
}
```

---

## 7. Update tools/search Enhancement (1 hour)

**File:** `src/mcp/tools/system/search.ts`

Add these features:
- Regex pattern support
- Description search
- Relevance scoring
- Category filtering

```typescript
// Enhanced search input
{
  pattern: 'memory/.*',     // Regex
  description: 'query',     // Text search
  category: 'agents',       // Category filter
  limit: 10
}
```

---

## Implementation Checklist

### Today (2-3 hours)
- [ ] Add examples to `agents/spawn`
- [ ] Add examples to `tasks/create`
- [ ] Add examples to `memory/query`
- [ ] Enhance `agents/list` description with return format
- [ ] Create `deferred-loading.ts` with tool configurations

### This Week
- [ ] Add examples to remaining 7 priority tools
- [ ] Update all list tool descriptions with return formats
- [ ] Enhance tools/search with regex support
- [ ] Add input validation to all handlers

### Verification
```bash
# Run tests
npm test -- --grep "tool"

# Check for schema validation
npm run typecheck

# Test specific tool
npx claude-flow mcp test agents/spawn
```

---

## Estimated Impact

| Change | Effort | Impact |
|--------|--------|--------|
| Add examples | Low | High (accuracy) |
| Enhanced descriptions | Low | Medium (clarity) |
| Deferred loading config | Low | High (tokens) |
| Better errors | Low | Medium (DX) |
| Format hints | Low | Low (clarity) |
| Input validation | Medium | Medium (reliability) |
| Search enhancement | Medium | High (discovery) |
