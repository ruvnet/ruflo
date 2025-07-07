# 🔧 CRITICAL ERROR FIX SCRIPT

## PHASE 1: IMMEDIATE DEPENDENCY FIXES (URGENT - 30 minutes)

### Step 1: Install Missing Dependencies
```bash
# Install chalk for CLI coloring
npm install chalk@4.1.2 @types/chalk@4.1.2

# Install cli-table3 for table formatting
npm install cli-table3@0.6.3 @types/cli-table3@0.6.3

# Install commander.js for CLI commands
npm install commander@9.4.1 @types/commander@9.4.1

# Install other missing dependencies
npm install inquirer@8.2.5 @types/inquirer@8.2.5
```

### Step 2: Fix Critical Import Errors

#### Fix `src/cli/node-repl.ts`
```typescript
// Add at top of file
import chalk from 'chalk';
import { Interface } from 'readline';

// Fix line 388: Add completer property
interface ExtendedInterface extends Interface {
  completer?: (line: string) => [string[], string];
}
```

#### Fix `src/cli/simple-cli.ts`
```typescript
// Define proper CLI options interface
interface CliOptions {
  name?: string;
  tools?: boolean;
  noPermissions?: boolean;
  config?: string;
  mode?: string;
  parallel?: boolean;
  research?: boolean;
  coverage?: boolean;
  commit?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
}

// Replace {} with CliOptions throughout file
```

### Step 3: Fix Table Constructor Issues
```typescript
// Fix all files using cli-table3
import Table from 'cli-table3';

// Replace:
const table = new Table();

// With:
const table = new Table({
  head: ['Column1', 'Column2'],
  colWidths: [20, 20]
});
```

## PHASE 2: TYPE DEFINITION FIXES (HIGH PRIORITY - 3 hours)

### Step 1: Create Missing Type Definitions

#### Create `src/types/executor.ts`
```typescript
export interface ClaudeExecutionOptions {
  timeout?: number;
  maxRetries?: number;
  dangerouslySkipPermissions?: boolean;
  appliedDefaults?: string[];
}

export interface ClaudeExecutionOptionsV2 extends ClaudeExecutionOptions {
  logger?: any;
  createExecutionContext?: () => any;
}

export interface TaskExecutor {
  execute(task: any, options?: ClaudeExecutionOptions): Promise<ExecutionResult>;
}

export interface ExecutionConfig {
  timeout: number;
  maxRetries: number;
  skipPermissions: boolean;
}

export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: number;
}
```

#### Create `src/types/swarm.ts`
```typescript
export enum SwarmMode {
  PARALLEL = 'parallel',
  SEQUENTIAL = 'sequential',
  HYBRID = 'hybrid'
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export enum AgentStatus {
  IDLE = 'idle',
  ACTIVE = 'active',
  BUSY = 'busy',
  ERROR = 'error'
}

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assignedAt?: number;
  assignedAgent?: string;
  startTime?: number;
  endTime?: number;
  metadata?: any;
}

export interface AgentState {
  id: string;
  status: AgentStatus;
  currentTask?: string;
  completedTasks: number;
  errorCount: number;
  lastActivity: number;
}
```

#### Create `src/types/migration.ts`
```typescript
export interface MigrationBackup {
  id: string;
  timestamp: number;
  version: string;
  files: string[];
  metadata: any;
}

export interface ResourceUsage {
  cpu: number;
  memory: number;
  disk: number;
  network: number;
}
```

### Step 2: Fix Import Statements

#### Fix `src/swarm/executor-v2.ts`
```typescript
import { ClaudeExecutionOptions, ClaudeExecutionOptionsV2, TaskExecutor, ExecutionConfig, ExecutionResult } from '../types/executor.js';
import { createLogger } from '../core/logger.js';
```

#### Fix `src/swarm/strategies/research.ts`
```typescript
import { SwarmMode, TaskStatus, AgentStatus } from '../types/swarm.js';
```

### Step 3: Fix Enum Compatibility Issues

#### Fix `src/cli/commands/swarm-new.ts`
```typescript
// Fix line 399: Replace 'parallel' with SwarmMode.PARALLEL
mode: SwarmMode.PARALLEL

// Fix status comparisons
if (task.status === TaskStatus.IN_PROGRESS) {
  // ...
}
if (task.status === TaskStatus.PENDING) {
  // ...
}

// Fix agent status comparisons
if (agent.status === AgentStatus.ACTIVE) {
  // ...
}
```

## PHASE 3: PROPERTY FIXES (MEDIUM PRIORITY - 2 hours)

### Step 1: Fix Missing Properties

#### Fix Task Statistics
```typescript
// Add missing properties to task stats
interface TaskStats {
  total: number;
  completed: number;
  failed: number;
  inProgress: number;
  pending: number;
}

interface AgentStats {
  total: number;
  active: number;
  idle: number;
  busy: number;
  error: number;
}
```

#### Fix File Operations
```typescript
// Fix writeFileSync options
fs.writeFileSync(filePath, content, { 
  encoding: 'utf8',
  flag: 'w' // Remove 'append' property
});
```

### Step 2: Fix Commander.js Issues

#### Fix `src/cli/commands/task.ts`
```typescript
// Fix command definition
command
  .argument('<task-id>', 'Task ID to query')
  .action((taskId) => {
    // Implementation
  });
```

#### Fix `src/cli/commands/workflow.ts`
```typescript
// Fix subcommand definitions
const listCmd = command
  .command('list')
  .description('List all workflows')
  .action(() => {
    // Implementation
  });
```

## PHASE 4: COMPATIBILITY FIXES (LOW PRIORITY - 1 hour)

### Step 1: Fix Buffer Type Issues
```typescript
// Fix Buffer to string conversion
const content = buffer.toString('utf8');
```

### Step 2: Fix Import Meta Issues
```typescript
// Fix import.meta usage
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

### Step 3: Fix Timeout Type Issues
```typescript
// Fix timeout type
let timeoutId: NodeJS.Timeout | undefined;
```

## EXECUTION ORDER

1. **Run Phase 1 first** - Install dependencies and fix imports
2. **Run Phase 2 next** - Create type definitions and fix major type issues
3. **Run Phase 3 then** - Fix property access and interface issues
4. **Run Phase 4 last** - Fix compatibility and minor issues

## VALIDATION COMMANDS

After each phase, run:
```bash
# Check for remaining errors
npx tsc --noEmit

# Count remaining errors
npx tsc --noEmit 2>&1 | grep -c "error TS"

# Target: 0 errors for alpha release
```

## SUCCESS CRITERIA

- ✅ All 819 TypeScript errors resolved
- ✅ All CLI commands functional
- ✅ All swarm operations working
- ✅ All migration tools operational
- ✅ Clean TypeScript compilation

---

**Priority**: 🔴 CRITICAL - Alpha release blocked
**Estimated Time**: 6.5 hours total
**Success Rate**: 100% required for alpha release