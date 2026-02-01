# Tutorial: ContinueGate for Long-Running Agents

This tutorial shows how to prevent runaway agent loops using the ContinueGate.

## The Problem

An agent starts a refactoring task. It edits a file, runs tests, sees a failure, edits again, runs tests again, sees a different failure, edits again... After 200 iterations it has burned through the token budget, the code is worse than when it started, and the coherence of its work has degraded. No single tool call was obviously wrong — the problem is that the agent kept going when it should have stopped.

The ContinueGate evaluates at the step level: "Should this agent continue at all?"

## Step 1: Create the Gate

```ts
import { createContinueGate } from '@claude-flow/guidance/continue-gate';

const gate = createContinueGate({
  maxConsecutiveSteps: 100,        // Hard stop after 100 steps
  maxBudgetSlopePerStep: 0.02,    // Cost acceleration threshold
  minCoherenceForContinue: 0.4,   // Below 0.4 coherence → stop
  maxUncertaintyForContinue: 0.8, // Above 0.8 uncertainty → pause
  maxReworkRatio: 0.3,            // Over 30% rework → throttle
  checkpointIntervalSteps: 25,    // Force checkpoint every 25 steps
  cooldownMs: 5000,               // Min 5s between evaluations
});
```

## Step 2: Evaluate Each Step

Call `evaluate()` once per agent step in your main loop:

```ts
let stepNumber = 0;
let tokensUsed = 0;
let toolCallsUsed = 0;
let reworkCount = 0;
const startTime = Date.now();

while (true) {
  stepNumber++;

  const decision = gate.evaluate({
    stepNumber,
    tokensUsed,
    tokenBudget: 50000,
    toolCallsUsed,
    toolCallBudget: 200,
    timeMs: Date.now() - startTime,
    timeBudgetMs: 300000,     // 5 minutes
    coherenceScore: computeCoherence(),  // 0-1
    uncertaintyScore: computeUncertainty(), // 0-1
    reworkCount,
  });

  switch (decision.decision) {
    case 'continue':
      // Proceed to next step
      break;

    case 'checkpoint':
      // Save state before continuing
      await saveCheckpoint();
      break;

    case 'throttle':
      // Slow down — insert delay
      await sleep(decision.cooldownMs || 5000);
      break;

    case 'pause':
      // Stop and wait for human review
      await notifyHuman(decision.reason);
      await waitForApproval();
      break;

    case 'stop':
      // Halt immediately
      console.error(`Agent stopped: ${decision.reason}`);
      return;
  }

  // Do the actual work
  const result = await agent.executeStep();
  tokensUsed += result.tokensUsed;
  toolCallsUsed++;
  if (result.isRework) reworkCount++;
}
```

## Step 3: Understanding Decisions

The gate evaluates these conditions in order. The first trigger wins:

### Stop Conditions (Critical — checked even during cooldown)

| Condition | Trigger | Reason |
|-----------|---------|--------|
| Coherence collapse | `coherenceScore < 0.4` | Agent's work is no longer coherent |
| Budget exhaustion | `tokens <= 0` or `toolCalls <= 0` or `time <= 0` | No budget remaining |

### Other Conditions (Skipped during cooldown)

| Condition | Trigger | Decision |
|-----------|---------|----------|
| Hard step limit | `stepNumber >= maxConsecutiveSteps` | **stop** |
| Budget acceleration | Cost slope > threshold | **pause** |
| High uncertainty | `uncertaintyScore > 0.8` | **pause** |
| High rework ratio | `reworkCount/stepNumber > 0.3` | **throttle** |
| Checkpoint interval | `stepNumber % 25 === 0` | **checkpoint** |
| Default | None of the above triggered | **continue** |

### Budget Slope Detection

The gate tracks budget usage over recent steps and fits a linear regression. If the cost per step is accelerating (slope > threshold), it means the agent is burning resources faster and faster — a sign of a degenerative loop.

```
Step 1: 100 tokens  → slope: flat
Step 2: 120 tokens  → slope: slight increase
Step 3: 200 tokens  → slope: accelerating
Step 4: 500 tokens  → slope: exceeds threshold → PAUSE
```

## Step 4: Inspecting History

```ts
// Get all past decisions
const history = gate.getHistory();
for (const entry of history) {
  console.log(`Step ${entry.stepNumber}: ${entry.decision} — ${entry.reason}`);
}

// Get aggregate stats
const stats = gate.getStats();
console.log(`Total evaluations: ${stats.totalEvaluations}`);
console.log(`Continues: ${stats.continueCount}`);
console.log(`Checkpoints: ${stats.checkpointCount}`);
console.log(`Throttles: ${stats.throttleCount}`);
console.log(`Pauses: ${stats.pauseCount}`);
console.log(`Stops: ${stats.stopCount}`);
```

## Step 5: Combining with Coherence Scheduler

Use the `CoherenceScheduler` to compute the coherence score fed into the ContinueGate:

```ts
import { createCoherenceScheduler } from '@claude-flow/guidance/coherence';

const scheduler = createCoherenceScheduler();

function computeCoherence(): number {
  const score = scheduler.computeScore(recentEvents);
  return score.overall; // 0-1
}
```

The coherence score combines:
- **Violation rate** — How often gates fire
- **Rework ratio** — How much work is redone
- **Intent drift** — Whether the agent's actions match its declared intent

## Step 6: Combining with Economic Governor

Use the `EconomicGovernor` to track budgets and compute remaining capacity:

```ts
import { createEconomicGovernor } from '@claude-flow/guidance/coherence';

const econ = createEconomicGovernor({
  tokenLimit: 50000,
  toolCallLimit: 200,
  timeLimitMs: 300000,
});

// After each step:
econ.recordUsage({ tokens: result.tokensUsed, toolCalls: 1 });

// Feed into ContinueGate context:
const usage = econ.getUsage();
gate.evaluate({
  tokensUsed: usage.tokens.used,
  tokenBudget: usage.tokens.limit,
  toolCallsUsed: usage.toolCalls.used,
  toolCallBudget: usage.toolCalls.limit,
  // ...
});
```

## Complete Example

```ts
import { createContinueGate } from '@claude-flow/guidance/continue-gate';
import { createCoherenceScheduler, createEconomicGovernor } from '@claude-flow/guidance/coherence';
import { createProofChain } from '@claude-flow/guidance/proof';

const gate = createContinueGate();
const coherence = createCoherenceScheduler();
const econ = createEconomicGovernor({ tokenLimit: 50000, toolCallLimit: 200 });
const proof = createProofChain('audit-key');

let step = 0;
let reworkCount = 0;
const t0 = Date.now();

while (true) {
  step++;
  const usage = econ.getUsage();

  const decision = gate.evaluate({
    stepNumber: step,
    tokensUsed: usage.tokens.used,
    tokenBudget: usage.tokens.limit,
    toolCallsUsed: usage.toolCalls.used,
    toolCallBudget: usage.toolCalls.limit,
    timeMs: Date.now() - t0,
    timeBudgetMs: 300000,
    coherenceScore: coherence.getLatestScore()?.overall ?? 1.0,
    uncertaintyScore: 0.3,
    reworkCount,
  });

  if (decision.decision === 'stop') {
    console.log(`Stopped at step ${step}: ${decision.reason}`);
    break;
  }

  if (decision.decision === 'checkpoint') {
    await saveCheckpoint();
  }

  if (decision.decision === 'pause') {
    await requestHumanReview(decision.reason);
  }

  // Execute step
  const result = await agent.executeStep();
  econ.recordUsage({ tokens: result.tokensUsed, toolCalls: 1 });
  if (result.isRework) reworkCount++;

  // Record in proof chain
  proof.appendEvent(result.event, result.toolCalls, result.memOps);
}

// Final verification
console.log(`Proof chain valid: ${proof.verify()}`);
console.log(`Gate stats:`, gate.getStats());
```
