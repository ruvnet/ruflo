# @claude-flow/plugin-agentic-qe

**AI-powered quality engineering that writes tests, finds bugs, and breaks things (safely) so your users don't have to.**

## What is this?

This plugin adds 59+ AI agents and 63 skills to Claude Flow that handle all aspects of software quality:

- **Write tests for you** - Unit tests, integration tests, E2E tests, even chaos tests
- **Find coverage gaps** - Shows exactly which code paths aren't tested
- **Predict bugs before they happen** - ML-based defect prediction from code patterns
- **Security scanning** - Find vulnerabilities, secrets, and compliance issues
- **Break things on purpose** - Chaos engineering to test resilience (safely!)

Think of it as having a team of QA engineers who never sleep, never miss edge cases, and learn from every bug they find.

## Installation

**Via Claude Flow CLI (recommended):**
```bash
npx claude-flow plugins install --name @claude-flow/plugin-agentic-qe
```

**Via npm:**
```bash
npm install @claude-flow/plugin-agentic-qe
```

**Verify installation:**
```bash
npx claude-flow plugins list
```

---

## Practical Examples

### 🟢 Basic: Generate Unit Tests

The simplest use case - point it at a file and get tests:

```bash
npx claude-flow@v3alpha mcp call aqe/generate-tests \
  --targetPath ./src/utils/calculator.ts \
  --testType unit \
  --framework vitest
```

**What you get:**
```typescript
// Generated: calculator.test.ts
describe('Calculator', () => {
  it('should add two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('should handle negative numbers', () => {
    expect(add(-1, 5)).toBe(4);
  });

  it('should handle decimal precision', () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
  });
});
```

### 🟡 Intermediate: TDD Workflow

Give it a requirement, and it runs the full red-green-refactor cycle:

```bash
npx claude-flow@v3alpha mcp call aqe/tdd-cycle \
  --requirement "Users can reset their password via email" \
  --targetPath ./src/auth \
  --style london
```

**What happens:**
1. Writes failing tests for password reset
2. Implements minimal code to pass
3. Refactors for clean code
4. Verifies 100% coverage of the requirement

### 🟡 Intermediate: Find Security Issues

Scan your code for vulnerabilities:

```bash
npx claude-flow@v3alpha mcp call aqe/security-scan \
  --targetPath ./src \
  --scanType sast \
  --compliance owasp-top-10
```

**Output:**
```json
{
  "vulnerabilities": [
    {
      "severity": "high",
      "type": "SQL Injection",
      "file": "src/db/queries.ts",
      "line": 42,
      "fix": "Use parameterized queries instead of string concatenation"
    }
  ],
  "compliance": {
    "owasp-top-10": { "passed": 8, "failed": 2 }
  }
}
```

### 🟠 Advanced: Quality Gates for CI/CD

Block releases that don't meet quality standards:

```typescript
const evaluation = await mcp.call('aqe/evaluate-quality-gate', {
  gates: [
    { metric: 'line_coverage', operator: '>=', threshold: 80 },
    { metric: 'test_pass_rate', operator: '==', threshold: 100 },
    { metric: 'security_vulnerabilities', operator: '==', threshold: 0 },
    { metric: 'accessibility_violations', operator: '<=', threshold: 5 }
  ]
});

if (!evaluation.passed) {
  console.log('Release blocked:', evaluation.failedCriteria);
  process.exit(1);
}
```

### 🟠 Advanced: Predict Bugs Before They Ship

Use ML to find likely defects:

```bash
npx claude-flow@v3alpha mcp call aqe/predict-defects \
  --targetPath ./src/checkout \
  --includeRootCause true
```

**Output:**
```json
{
  "predictions": [
    {
      "file": "src/checkout/payment.ts",
      "probability": 0.78,
      "reason": "High cyclomatic complexity + recent churn + no error handling for network failures",
      "suggestedTests": ["network timeout", "partial payment failure", "currency conversion edge cases"]
    }
  ]
}
```

### 🔴 Expert: Chaos Engineering

Test how your system handles failures. **Always use dryRun first!**

```bash
# Step 1: Preview what would happen (safe)
npx claude-flow@v3alpha mcp call aqe/chaos-inject \
  --target payment-service \
  --failureType network-latency \
  --duration 30 \
  --intensity 0.5 \
  --dryRun true

# Step 2: Run the actual experiment
npx claude-flow@v3alpha mcp call aqe/chaos-inject \
  --target payment-service \
  --failureType network-latency \
  --duration 30 \
  --intensity 0.5 \
  --dryRun false
```

**Failure types available:**
- `network-latency` - Add delays to network calls
- `network-partition` - Isolate services from each other
- `cpu-stress` - Simulate high CPU load
- `memory-pressure` - Simulate memory exhaustion
- `disk-failure` - Simulate storage issues
- `process-kill` - Randomly kill processes
- `dns-failure` - Break DNS resolution

### 🔴 Expert: Visual Regression Testing

Catch UI changes automatically:

```typescript
// Compare against baseline
const result = await mcp.call('aqe/visual-regression', {
  targetUrl: 'http://localhost:3000',
  viewports: [
    { width: 1920, height: 1080 },  // Desktop
    { width: 768, height: 1024 },   // Tablet
    { width: 375, height: 812 }     // Mobile
  ],
  threshold: 0.1  // 10% difference allowed
});

if (result.hasRegressions) {
  console.log('Visual changes detected:', result.diffs);
}
```

### 🟣 Exotic: Full Automated QA Pipeline

Combine everything for comprehensive quality assurance:

```typescript
// 1. Generate tests for uncovered code
const tests = await mcp.call('aqe/generate-tests', {
  targetPath: './src',
  coverage: { target: 90, focusGaps: true }
});

// 2. Run security scan
const security = await mcp.call('aqe/security-scan', {
  targetPath: './src',
  scanType: 'sast',
  compliance: ['owasp-top-10', 'sans-25']
});

// 3. Check accessibility
const a11y = await mcp.call('aqe/check-accessibility', {
  targetUrl: 'http://localhost:3000',
  standard: 'WCAG21-AA'
});

// 4. Predict defects
const defects = await mcp.call('aqe/predict-defects', {
  targetPath: './src'
});

// 5. Assess release readiness
const readiness = await mcp.call('aqe/assess-readiness', {
  criteria: [
    { name: 'coverage', required: true },
    { name: 'security', required: true },
    { name: 'accessibility', required: false }
  ]
});

console.log('Ready to ship:', readiness.approved);
```

### 🟣 Exotic: Self-Learning Test Patterns

The plugin learns from your codebase and improves over time:

```typescript
// The plugin stores patterns in memory
// After running on your codebase, it learns:
// - Your testing style and conventions
// - Common edge cases in your domain
// - Patterns that historically caused bugs

// Query learned patterns
const patterns = await mcp.call('aqe/suggest-tests', {
  targetPath: './src/new-feature.ts',
  useLearned: true  // Use patterns learned from your codebase
});

// Patterns are stored in:
// - aqe/v3/test-patterns (test generation)
// - aqe/v3/defect-patterns (bug prediction)
// - aqe/v3/learning-trajectories (improvement over time)
```

---

## Available Tools

| Category | Tools | What They Do |
|----------|-------|--------------|
| **Test Generation** | `generate-tests`, `tdd-cycle`, `suggest-tests` | Write tests automatically |
| **Coverage** | `analyze-coverage`, `prioritize-gaps`, `track-trends` | Find untested code |
| **Quality** | `evaluate-quality-gate`, `assess-readiness`, `calculate-risk` | Release decisions |
| **Defects** | `predict-defects`, `analyze-root-cause`, `find-similar-defects` | Bug prediction |
| **Security** | `security-scan`, `audit-compliance`, `detect-secrets` | Vulnerability scanning |
| **Contracts** | `validate-contract`, `compare-contracts` | API validation |
| **Visual** | `visual-regression`, `check-accessibility` | UI testing |
| **Chaos** | `chaos-inject`, `assess-resilience`, `load-test` | Resilience testing |

---

## Configuration

```yaml
# claude-flow.config.yaml
plugins:
  agentic-qe:
    enabled: true
    config:
      defaultFramework: vitest
      coverageTarget: 80
      tddStyle: london
      complianceStandards:
        - owasp-top-10
        - sans-25
```

---

## Safety

- **Chaos operations default to dry-run mode** - Nothing breaks until you explicitly confirm
- **All code runs in a sandbox** - 30s timeout, 512MB memory limit, no network access
- **Production targets are blocked** - Can't accidentally chaos-test production

---

## License

MIT
