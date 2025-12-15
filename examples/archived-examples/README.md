# Archived Examples

This directory contains examples that were removed from the main collection due to quality concerns. These examples have been archived rather than deleted to preserve historical context and learning opportunities.

## Why These Examples Were Archived

### 🚫 Quality Standards Not Met

The Creator of Claude-Flow made the strategic decision to archive these examples because they:

1. **Failed to showcase swarm intelligence** - Single-agent or sequential execution only
2. **Lacked production readiness** - Missing error handling, monitoring, or security
3. **Provided trivial demonstrations** - "Hello World" level complexity
4. **Didn't demonstrate performance gains** - No metrics or parallel execution benefits
5. **Had duplicate functionality** - Multiple versions of the same basic concept

## Archived Examples

### 1. `hello-world.js`
**Reason**: Too trivial, doesn't showcase any Claude-Flow capabilities
- Single file, console.log only
- No swarm coordination
- No parallel execution
- Better replaced by swarm-generated examples

### 2. `calc-app/` and `calc-app-parallel/`
**Reason**: Redundant implementations, neither showcases true swarm potential
- Basic calculator functionality repeated
- Parallel version doesn't show significant improvements
- Missing production elements (error handling, tests)
- Should be replaced with one advanced calculator showing:
  - Multi-agent algorithm optimization
  - 100x performance on complex calculations
  - Real-time visualization of agent coordination

### 3. `chat-app/` and `chat-app-2/`
**Reason**: Multiple incomplete implementations of same concept
- No real-time features
- No multi-agent coordination
- Missing WebSocket implementation
- Should be replaced with production-ready chat showing:
  - 5-agent coordination (auth, messages, presence, notifications, moderation)
  - Real-time updates with WebSockets
  - Horizontal scaling capabilities

### 4. `hello-world-workflow.json`
**Reason**: Workflow too simple to demonstrate value
- Single agent, single task
- No parallel execution
- No error handling or retries
- Doesn't showcase workflow capabilities

## What Makes a Good Example

Good Claude-Flow examples should:

✅ **Show parallel execution** - Multiple agents working simultaneously
✅ **Include performance metrics** - Concrete proof of 10-100x speedup
✅ **Be production-ready** - Error handling, monitoring, security
✅ **Demonstrate swarm intelligence** - Complex problem-solving with agent coordination
✅ **Provide visual feedback** - Progress bars, agent status, timeline views

## Learning from These Examples

While these examples don't meet our current quality standards, they can teach us:

1. **Evolution of the platform** - How Claude-Flow has grown from simple to sophisticated
2. **Anti-patterns to avoid** - What doesn't leverage the platform's strengths
3. **Minimum viable complexity** - Examples need sufficient complexity to showcase value

## Migration Path

If you're looking for modern equivalents:

- Instead of `hello-world.js` → See `05-swarm-apps/rest-api-advanced/`
- Instead of `calc-app/` → See upcoming `08-performance-showcases/parallel-computation/`
- Instead of `chat-app/` → See upcoming `07-enterprise-patterns/real-time-collaboration/`

## Contributing Better Examples

Want to create examples that won't be archived? Follow these guidelines:

1. **Start with a real problem** - No toy applications
2. **Use minimum 3 agents** - Show coordination benefits
3. **Include metrics** - Prove the performance gains
4. **Add production elements** - Monitoring, error handling, deployment configs
5. **Document the "why"** - Clear value proposition and use cases

---

*These examples are preserved for historical reference but should not be used as templates for new development.*