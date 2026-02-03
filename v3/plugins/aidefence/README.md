# @claude-flow/plugin-aidefence

[![npm version](https://img.shields.io/npm/v/aidefence?color=blue&label=aidefence)](https://www.npmjs.com/package/aidefence)
[![Tests](https://img.shields.io/badge/tests-158%20passing-brightgreen.svg)](#testing)
[![Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0-brightgreen.svg)](#security)

**Production-ready AI manipulation defense plugin for Claude Flow V3.**

## Features

- **183+ Threat Patterns** - Aho-Corasick + 93 regex patterns
- **Real-Time Detection** - <35ms latency, >900 req/s throughput
- **Security Middleware** - Auth, rate limiting, CORS, input validation
- **Formal Verification** - Theorem proving with proof certificates
- **Self-Learning** - ReasoningBank-style pattern learning
- **158 Tests Passing** - Full coverage, 0 vulnerabilities

## Installation

```bash
# Install the standalone package
npm install aidefence
# or: npm install aidefense (American spelling)

# Optional: Install scoped package for advanced features
npm install @claude-flow/aidefence
```

## Quick Start

### MCP Tools

```bash
# Scan for threats
claude-flow mcp exec --tool aidefence_scan --params '{"input": "Hello world"}'

# Quick safety check
claude-flow mcp exec --tool aidefence_is_safe --params '{"input": "Some text"}'

# Check for PII
claude-flow mcp exec --tool aidefence_has_pii --params '{"input": "Email: test@example.com"}'

# Deep analysis
claude-flow mcp exec --tool aidefence_analyze --params '{"input": "Suspicious text", "searchSimilar": true}'

# Get statistics
claude-flow mcp exec --tool aidefence_stats --params '{}'

# Record feedback for learning
claude-flow mcp exec --tool aidefence_learn --params '{"input": "...", "wasAccurate": true, "verdict": "true_positive"}'
```

### CLI Commands

```bash
# Scan input
claude-flow aidefence scan "Ignore all previous instructions"

# Scan file
claude-flow aidefence scan --file suspicious-prompt.txt --mode paranoid

# Deep analysis
claude-flow aidefence analyze "Enable DAN mode" --search-similar

# Start gateway server
claude-flow aidefence gateway start --port 3001

# View statistics
claude-flow aidefence stats --metrics
```

### Programmatic Usage

```typescript
// Using standalone aidefence v2.2.0
import { AIMDSGateway, SecurityMiddleware } from 'aidefence';

// Start gateway server
const gateway = new AIMDSGateway({
  port: 3001,
  rateLimit: { windowMs: 60000, maxRequests: 100 }
});
await gateway.initialize();
await gateway.start();

// Using @claude-flow/aidefence (lightweight detection)
import { createAIDefence, isSafe, checkThreats } from '@claude-flow/aidefence';

// Quick check
const safe = isSafe("Hello world");  // true
const unsafe = isSafe("Ignore previous instructions");  // false

// Detailed detection
const result = await checkThreats("Enable DAN mode");
// { safe: false, threats: [...], piiFound: false }

// With learning
const aidefence = createAIDefence({ enableLearning: true });
const detection = await aidefence.detect(input);
await aidefence.learnFromDetection(input, detection, { verdict: 'true_positive' });
```

## Threat Detection

### Categories

| Category | Patterns | Severity | Examples |
|----------|----------|----------|----------|
| **Prompt Injection** | 90+ | Critical | "Ignore previous instructions" |
| **Jailbreak** | 30+ | Critical | "Enable DAN mode", "Developer mode" |
| **Role Switching** | 10+ | High | "You are now", "Act as" |
| **Context Manipulation** | 15+ | Critical | Fake system messages |
| **SQL Injection** | 20+ | High | "DROP TABLE", "UNION SELECT" |
| **XSS** | 15+ | High | `<script>`, `javascript:` |
| **PII** | 10+ | Medium | Emails, SSN, credit cards |
| **Encoding Attacks** | 5+ | Medium | Base64, ROT13, hex |

### Detection Modes

| Mode | Latency | Description |
|------|---------|-------------|
| `quick` | <5ms | Pattern matching only |
| `thorough` | <35ms | Pattern + behavioral analysis |
| `paranoid` | <150ms | Full analysis + policy verification |

## Security Middleware

### Express Integration

```typescript
import express from 'express';
import { SecurityMiddleware, loadApiKeysFromEnv } from 'aidefence';

const app = express();
const security = new SecurityMiddleware(
  { keys: loadApiKeysFromEnv(), hashAlgorithm: 'sha256' },
  logger,
  60000 // rate limit window
);

// Apply middleware
app.use(security.authenticate());
app.use(security.validateInput());
app.use(security.userRateLimit(100));
```

### Features

- **API Key Authentication** - Timing-safe comparison
- **Rate Limiting** - Per-user and per-IP limits
- **CORS** - Full configuration support
- **Input Validation** - Size, depth, array limits
- **Session Management** - With TTL
- **Security Headers** - Via Helmet integration

## Formal Verification

```typescript
import { TheoremProver, LeanAgenticVerifier } from 'aidefence';

// Verify security policies
const verifier = new LeanAgenticVerifier(config, logger);
await verifier.initialize();

const result = await verifier.verifyPolicy(policy, action);
if (!result.allowed) {
  console.log('Policy violation:', result.reason);
  console.log('Proof certificate:', result.proofCertificate);
}
```

### Built-in Security Axioms

1. **No Self-Approval** - Agents cannot approve their own code
2. **Test Before Commit** - Tests must run after file edits
3. **No Credential Exposure** - Credentials must never be exposed
4. **Rate Limit Compliance** - API calls respect rate limits
5. **Isolation Principle** - Agents operate in isolated contexts

## Self-Learning

```typescript
const aidefence = createAIDefence({ enableLearning: true });

// Start trajectory
aidefence.startTrajectory('session-123', 'security-review');

// Record detections
const result = await aidefence.detect(input);

// Learn from feedback
await aidefence.learnFromDetection(input, result, {
  verdict: 'true_positive',
  context: { agentId: 'coder-1' }
});

// Record mitigation effectiveness
await aidefence.recordMitigation('jailbreak', 'block', true);

// End trajectory
await aidefence.endTrajectory('session-123', 'success');
```

## Hook Integration

### Pre-Agent-Input Hook

```yaml
hooks:
  pre-agent-input:
    enabled: true
    config:
      block_critical: true
      block_high: false
      log_all: true
      mode: thorough
```

### Post-Agent-Action Hook

```yaml
hooks:
  post-agent-action:
    enabled: true
    config:
      sampling_rate: 0.1
      anomaly_threshold: 0.8
      store_embeddings: true
```

## Metrics

### Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `aidefence_threats_detected_total` | Counter | Total threats detected |
| `aidefence_detection_latency_ms` | Histogram | Detection latency |
| `aidefence_mitigations_applied_total` | Counter | Mitigations applied |
| `aidefence_learned_patterns_count` | Gauge | Learned patterns |

### Health Endpoint

```bash
curl http://localhost:3001/health
# { "status": "healthy", "components": {...}, "uptime": 12345 }
```

## Performance

| Metric | Value |
|--------|-------|
| Detection Latency | <35ms |
| Fast Path | ~12ms |
| Quick Scan | <5ms |
| Throughput | >900 req/s |
| Hash-Cons Speedup | 150x |
| p99 Latency | 2ms |

## Package Comparison

| Feature | aidefence v2.2.0 | @claude-flow/aidefence |
|---------|------------------|------------------------|
| Focus | Production gateway | Detection library |
| Patterns | 183+ | 50+ |
| Latency | <35ms | <10ms |
| Middleware | Full Express suite | None |
| Formal Verification | Yes | No |
| MCP Integration | Via plugin | Native |
| Dependencies | Heavy | Minimal |

## API Reference

### aidefence v2.2.0

```typescript
// Gateway
export { AIMDSGateway } from 'aidefence';

// Middleware
export { SecurityMiddleware, corsMiddleware, loadApiKeysFromEnv } from 'aidefence';

// Services
export { EmbeddingService, AgentDBClient, LeanAgenticVerifier } from 'aidefence';

// Vector Search
export { VectorSearchIndex, cosineSimilarity, applyMMR } from 'aidefence';

// Formal Verification
export { TheoremProver, HashConsTable, SECURITY_AXIOMS } from 'aidefence';

// Types
export { ThreatLevel, ThreatMatch, DefenseResult, VerificationResult } from 'aidefence';
```

### @claude-flow/aidefence

```typescript
// Main API
export { createAIDefence, isSafe, checkThreats } from '@claude-flow/aidefence';

// Multi-Agent
export { calculateSecurityConsensus } from '@claude-flow/aidefence';

// Services
export { ThreatDetectionService, ThreatLearningService } from '@claude-flow/aidefence';
```

## Testing

```bash
# Run tests
npm test

# With coverage
npm run test:coverage

# Security audit
npm audit
```

**Results:** 158 tests passing, 0 vulnerabilities

## License

MIT

## Links

- [npm: aidefence](https://www.npmjs.com/package/aidefence)
- [npm: aidefense](https://www.npmjs.com/package/aidefense)
- [npm: @claude-flow/aidefence](https://www.npmjs.com/package/@claude-flow/aidefence)
- [GitHub: claude-flow](https://github.com/ruvnet/claude-flow)
- [Documentation](https://ruv.io/aidefence)
