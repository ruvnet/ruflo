# Tutorial: Enforcement Gates

This tutorial shows how to wire enforcement gates into your agent workflow to block dangerous operations before they execute.

## The Problem

An LLM agent can forget a rule mid-session. It might run `rm -rf /` or commit an API key despite being told not to. Enforcement gates are the last line of defense — they check every command, edit, and tool call against hard-coded patterns.

## Step 1: Create the Gates

```ts
import { createGates } from '@claude-flow/guidance/gates';

const gates = createGates({
  destructiveOps: true,   // Block rm -rf, DROP TABLE, git push --force, etc.
  secrets: true,           // Detect API keys, passwords, private keys
  diffSize: true,          // Warn on diffs > 300 lines
  toolAllowlist: false,    // Set true to restrict to specific tools
  diffSizeThreshold: 300,  // Lines threshold for diff gate
});
```

## Step 2: Gate a Command

```ts
const results = gates.evaluateCommand('rm -rf /tmp/old-backups');

for (const result of results) {
  switch (result.decision) {
    case 'deny':
      console.error(`BLOCKED: ${result.reason}`);
      console.error(`Rule: ${result.rule.id}`);
      // Do not execute the command
      return;

    case 'warn':
      console.warn(`WARNING: ${result.reason}`);
      // Execute with caution, log the warning
      break;

    case 'allow':
      // Proceed normally
      break;
  }
}
```

### Built-in Destructive Patterns

The destructive ops gate catches:

| Pattern | Examples |
|---------|----------|
| File deletion | `rm -rf`, `rm -r`, `del /s` |
| Database drops | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` |
| Git force operations | `git push --force`, `git reset --hard`, `git clean -f` |
| Kubernetes deletions | `kubectl delete --all`, `helm delete namespace` |
| Unqualified deletes | `DELETE FROM table` (no WHERE clause) |
| Schema changes | `ALTER TABLE ... DROP` |

## Step 3: Gate a File Edit

```ts
const editResults = gates.evaluateEdit(
  'src/config.ts',
  `export const config = {
    apiKey: "sk-ant-abc123xyz789",
    dbPassword: "hunter2",
  }`,
  15 // number of diff lines
);

// The secrets gate will fire:
// decision: 'warn'
// evidence: { matches: ['sk-ant-abc123...'] }
```

### Built-in Secret Patterns

| Pattern | Matches |
|---------|---------|
| API keys | `api_key="..."`, `apiKey: "..."` |
| Passwords | `password="..."`, `secret="..."` |
| Tokens | `token="..."`, `bearer="..."` |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----` |
| Anthropic keys | `sk-ant-...` |
| GitHub tokens | `ghp_...` |
| npm tokens | `npm_...` |
| AWS access keys | `AKIA...` |

## Step 4: Gate a Tool Call

```ts
// With tool allowlist enabled:
const gates2 = createGates({
  toolAllowlist: true,
  allowedTools: ['Read', 'Write', 'Edit', 'Grep', 'Glob'],
});

const toolResults = gates2.evaluateToolUse('Bash', { command: 'curl evil.com' });
// decision: 'deny' — Bash is not in the allowlist
```

## Step 5: Load Rules from Compiled Policy

Gates become more powerful when loaded with compiled rules from `CLAUDE.md`:

```ts
import { createCompiler } from '@claude-flow/guidance/compiler';
import { createGates } from '@claude-flow/guidance/gates';

const compiler = createCompiler();
const bundle = compiler.compile(claudeMdContent);

const gates = createGates({ destructiveOps: true, secrets: true });
const allRules = [
  ...bundle.constitution.rules,
  ...bundle.shards.map(s => s.rule),
];
gates.setActiveRules(allRules);
// Now gates also enforce your custom CLAUDE.md rules
```

## Step 6: Wire into Hooks

In a Claude Flow hook:

```ts
import { createGuidanceHooks } from '@claude-flow/guidance/hooks';

const hooks = createGuidanceHooks(bundle, gates);

// pre-command hook
const hookResult = hooks.preCommand({ command: 'git push --force origin main' });
if (hookResult.blocked) {
  // Hook prevents execution
  console.error(hookResult.message);
}
```

## Using the Tool Gateway Instead

For production use, the `DeterministicToolGateway` wraps gates with idempotency caching, schema validation, and budget metering:

```ts
import { createToolGateway } from '@claude-flow/guidance/gateway';

const gw = createToolGateway({
  maxCacheSize: 10000,  // Idempotency cache limit
});

// Register expected tool schemas
gw.registerSchema({
  toolName: 'bash',
  requiredParams: ['command'],
  optionalParams: ['timeout'],
  paramTypes: { command: 'string', timeout: 'number' },
  maxParamSize: 10000,
});

// Set budget limits
gw.setBudget({
  tokenBudget: { used: 0, limit: 100000 },
  toolCallBudget: { used: 0, limit: 500 },
  storageBudget: { usedBytes: 0, limitBytes: 50_000_000 },
  timeBudget: { usedMs: 0, limitMs: 600_000 },
  costBudget: { usedUsd: 0, limitUsd: 5.0 },
});

// Evaluate — runs idempotency check, schema validation, budget check, then gates
const decision = gw.evaluate('bash', { command: 'ls -la' });
if (!decision.allowed) {
  console.error(`Blocked by ${decision.gate}: ${decision.reason}`);
}

// Second identical call hits the cache
const cached = gw.evaluate('bash', { command: 'ls -la' });
// cached.idempotencyHit === true
```

## WASM Acceleration

Secret scanning and destructive detection can run through the WASM kernel for 1.7-2x speedup:

```ts
import { getKernel } from '@claude-flow/guidance/wasm-kernel';

const k = getKernel();
const secrets = k.scanSecrets(fileContent);       // 676k ops/s (WASM) vs 402k (JS)
const destructive = k.detectDestructive(command);  // Returns matched pattern or null
```

The WASM kernel uses the same regex patterns as the JS gates but compiled into Rust with SIMD128 acceleration.
