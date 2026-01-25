# @claude-flow/teammate-plugin

Native **TeammateTool** integration plugin for Claude Flow. Bridges Claude Code v2.1.19+ multi-agent orchestration capabilities with Claude Flow's swarm system.

[![npm version](https://badge.fury.io/js/%40claude-flow%2Fteammate-plugin.svg)](https://badge.fury.io/js/%40claude-flow%2Fteammate-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Requirements

| Requirement | Minimum Version | Recommended |
|-------------|-----------------|-------------|
| **Claude Code** | **>= 2.1.19** | Latest |
| Node.js | >= 18.0.0 | >= 20.0.0 |
| npm | >= 9.0.0 | >= 10.0.0 |

> **IMPORTANT:** This plugin requires Claude Code version **2.1.19 or higher**. The TeammateTool functionality was introduced in this version and is not available in earlier releases.

### Version Check

```bash
# Check your Claude Code version
claude --version

# Should output: 2.1.19 or higher
```

If your version is below 2.1.19, update Claude Code:

```bash
claude update
```

## Installation

### Via Claude Code CLI (Recommended)

Install directly using Claude Code's plugin system:

```bash
# Install from npm registry
claude plugins install @claude-flow/teammate-plugin

# Or install from Claude Flow plugin registry (IPFS-backed)
claude plugins install teammate-plugin --registry claude-flow
```

### Via npm

```bash
npm install @claude-flow/teammate-plugin
```

Or with pnpm:

```bash
pnpm add @claude-flow/teammate-plugin
```

### Via Claude Flow CLI

```bash
# Install via claude-flow plugin manager
npx @claude-flow/cli@latest plugins install teammate-plugin

# Or add to your claude-flow.config.json
npx @claude-flow/cli@latest config set plugins.teammate-plugin.enabled true
```

### Verify Installation

```bash
# Check plugin is loaded
claude plugins list

# Or via claude-flow
npx @claude-flow/cli@latest plugins list
```

## Quick Start

```typescript
import { createTeammateBridge } from '@claude-flow/teammate-plugin';

// Initialize the bridge
const bridge = await createTeammateBridge();

// Check compatibility
const version = bridge.getVersionInfo();
console.log(`Claude Code: ${version.claudeCode}`);
console.log(`Compatible: ${version.compatible}`);

if (!version.compatible) {
  console.error('Please upgrade Claude Code to >= 2.1.19');
  process.exit(1);
}

// Create a team
const team = await bridge.spawnTeam({
  name: 'my-dev-team',
  topology: 'hierarchical',
  maxTeammates: 6,
  planModeRequired: true,
});

// Spawn teammates (returns AgentInput for Claude Code Task tool)
const coder = await bridge.spawnTeammate({
  name: 'coder-1',
  role: 'coder',
  prompt: 'Implement the authentication feature using JWT',
  teamName: 'my-dev-team',
  model: 'sonnet',
  allowedTools: ['Edit', 'Write', 'Read', 'Bash'],
});

// The agentInput can be passed to Claude Code's Task tool
const agentInput = bridge.buildAgentInput({
  name: 'tester-1',
  role: 'tester',
  prompt: 'Write tests for the authentication feature',
  teamName: 'my-dev-team',
  model: 'haiku',
});

console.log('Pass this to Task tool:', agentInput);
```

## Features

### Core Features (from TeammateTool)

| Feature | Description | TeammateTool Operation |
|---------|-------------|------------------------|
| Team Management | Create, discover, load teams | `spawnTeam`, `discoverTeams` |
| Teammate Spawning | Spawn agents with native support | `AgentInput` schema |
| Join/Leave Workflow | Request-approve-reject pattern | `requestJoin`, `approveJoin`, `rejectJoin` |
| Messaging | Direct and broadcast messages | `write`, `broadcast` |
| Plan Approval | Submit, vote, execute plans | `approvePlan`, `rejectPlan` |
| Swarm Launch | Launch multi-agent execution | `launchSwarm`, `teammateCount` |
| Shutdown | Graceful teammate termination | `requestShutdown`, `approveShutdown` |

### Extended Features (Plugin Additions)

| Feature | Description |
|---------|-------------|
| Delegation | Delegate authority between teammates |
| Team Context | Shared variables, permissions, environment |
| Permission Updates | Dynamic permission changes mid-execution |
| Session Memory | Persist teammate context across sessions |
| Remote Sync | Push team to Claude.ai (experimental) |
| Transcript Sharing | Share message history between teammates |
| Teleport | Resume teams across terminal instances |
| Plan Control | Pause, resume, modify plans mid-execution |

## API Reference

### TeammateBridge

The main class for interacting with TeammateTool.

#### Initialization

```typescript
import { createTeammateBridge, TeammateBridge } from '@claude-flow/teammate-plugin';

// Factory function (recommended)
const bridge = await createTeammateBridge({
  fallbackToMCP: true,  // Fallback to MCP if TeammateTool unavailable
  memory: {
    autoPersist: true,
    persistIntervalMs: 60000,
  },
});

// Or direct instantiation
const bridge = new TeammateBridge(config);
await bridge.initialize();
```

#### Team Management

```typescript
// Create team
const team = await bridge.spawnTeam({
  name: 'my-team',
  topology: 'hierarchical',  // 'flat' | 'hierarchical' | 'mesh'
  maxTeammates: 8,
  planModeRequired: true,
  autoApproveJoin: true,
  delegationEnabled: true,
});

// Discover existing teams
const teams = await bridge.discoverTeams();
// ['team-1', 'team-2', ...]

// Load existing team
const existingTeam = await bridge.loadTeam('team-1');

// Get team state
const state = bridge.getTeamState('my-team');
```

#### Teammate Spawning

```typescript
// Spawn teammate
const teammate = await bridge.spawnTeammate({
  name: 'coder-1',
  role: 'coder',
  prompt: 'Implement feature X',
  teamName: 'my-team',
  model: 'sonnet',  // 'sonnet' | 'opus' | 'haiku'
  allowedTools: ['Edit', 'Write', 'Read'],
  mode: 'default',  // 'default' | 'plan' | 'delegate' | etc.
});

// Build AgentInput for Task tool
const agentInput = bridge.buildAgentInput({
  name: 'reviewer-1',
  role: 'reviewer',
  prompt: 'Review code changes',
  teamName: 'my-team',
});
// Pass agentInput to Claude Code's Task tool
```

#### Messaging

```typescript
// Send direct message
const message = await bridge.sendMessage(
  'my-team',
  'sender-id',
  'recipient-id',
  {
    type: 'task',
    payload: { action: 'implement', target: 'auth' },
    priority: 'high',
  }
);

// Broadcast to all teammates
await bridge.broadcast('my-team', 'coordinator-id', {
  type: 'status',
  payload: { phase: 'implementation' },
});

// Read mailbox
const messages = await bridge.readMailbox('my-team', 'teammate-id');
```

#### Plan Approval

```typescript
// Submit plan
const plan = await bridge.submitPlan('my-team', {
  description: 'Implement authentication feature',
  proposedBy: 'coordinator-id',
  steps: [
    { order: 1, action: 'Create user model', tools: ['Edit'], assignee: 'coder-1' },
    { order: 2, action: 'Add JWT middleware', tools: ['Edit'], assignee: 'coder-1' },
    { order: 3, action: 'Write unit tests', tools: ['Edit'], assignee: 'tester-1' },
  ],
  requiredApprovals: 2,
});

// Approve plan
await bridge.approvePlan('my-team', plan.id, 'reviewer-id');

// Launch swarm (after approval)
const exitPlanInput = await bridge.launchSwarm('my-team', plan.id, 3);
// Pass exitPlanInput to ExitPlanMode tool
```

#### Delegation

```typescript
// Delegate authority
const delegation = await bridge.delegateToTeammate(
  'my-team',
  'lead-id',
  'dev-id',
  ['approve_plan', 'spawn_teammate']
);

// Revoke delegation
await bridge.revokeDelegation('my-team', 'lead-id', 'dev-id');
```

#### Team Context

```typescript
// Update context
await bridge.updateTeamContext('my-team', {
  sharedVariables: {
    apiEndpoint: 'https://api.example.com',
    version: '1.0.0',
  },
  inheritedPermissions: ['read', 'write'],
  environmentVariables: {
    NODE_ENV: 'development',
  },
});

// Get context
const context = bridge.getTeamContext('my-team');
```

#### Session Memory

```typescript
// Save teammate memory
await bridge.saveTeammateMemory('my-team', 'teammate-id');

// Load teammate memory
const memory = await bridge.loadTeammateMemory('my-team', 'teammate-id');

// Share transcript
await bridge.shareTranscript('my-team', 'from-id', 'to-id', {
  start: 0,
  end: 10,
});
```

#### Teleport

```typescript
// Check if teleport is possible
const { canTeleport, blockers } = await bridge.canTeleport('my-team', {
  workingDirectory: '/path/to/new/dir',
  gitBranch: 'feature/auth',
});

// Teleport team
if (canTeleport) {
  const result = await bridge.teleportTeam('my-team', {
    workingDirectory: '/path/to/new/dir',
    gitBranch: 'feature/auth',
  });
}
```

### MCP Tools

The plugin provides 16 MCP tools for use with Claude Code's MCP server:

```typescript
import { TEAMMATE_MCP_TOOLS, handleMCPTool } from '@claude-flow/teammate-plugin';

// List all tools
console.log(TEAMMATE_MCP_TOOLS.map(t => t.name));
// [
//   'teammate_spawn_team',
//   'teammate_discover_teams',
//   'teammate_spawn',
//   'teammate_send_message',
//   'teammate_broadcast',
//   'teammate_submit_plan',
//   'teammate_approve_plan',
//   'teammate_launch_swarm',
//   'teammate_delegate',
//   'teammate_update_context',
//   'teammate_save_memory',
//   'teammate_share_transcript',
//   'teammate_push_remote',
//   'teammate_teleport',
//   'teammate_get_status',
//   'teammate_cleanup',
// ]

// Handle tool call
const result = await handleMCPTool(bridge, 'teammate_spawn_team', {
  name: 'my-team',
  topology: 'hierarchical',
});
```

## Events

The bridge emits events for all operations:

```typescript
bridge.on('team:spawned', ({ team, config }) => {
  console.log(`Team ${team} created`);
});

bridge.on('teammate:spawned', ({ teammate, agentInput }) => {
  console.log(`Teammate ${teammate.name} spawned`);
});

bridge.on('plan:approved', ({ team, plan }) => {
  console.log(`Plan ${plan.id} approved`);
});

bridge.on('delegate:granted', ({ team, from, to, permissions }) => {
  console.log(`${from} delegated to ${to}: ${permissions.join(', ')}`);
});

bridge.on('teleport:completed', ({ team, result }) => {
  console.log(`Team ${team} teleported successfully`);
});
```

## Error Handling

```typescript
import { TeammateError, TeammateErrorCode } from '@claude-flow/teammate-plugin';

try {
  await bridge.launchSwarm('my-team', 'plan-id');
} catch (error) {
  if (error instanceof TeammateError) {
    switch (error.code) {
      case TeammateErrorCode.PLAN_NOT_APPROVED:
        console.log('Plan needs approval first');
        break;
      case TeammateErrorCode.TEAM_NOT_FOUND:
        console.log(`Team not found: ${error.teamName}`);
        break;
      case TeammateErrorCode.VERSION_INCOMPATIBLE:
        console.log('Claude Code version too old');
        break;
    }
  }
}
```

## Configuration

```typescript
import { createTeammateBridge, DEFAULT_PLUGIN_CONFIG } from '@claude-flow/teammate-plugin';

const bridge = await createTeammateBridge({
  autoInitialize: true,
  fallbackToMCP: true,

  recovery: {
    maxRetries: 3,
    retryDelayMs: 1000,
    exponentialBackoff: true,
    fallbackToMCP: true,
    autoCleanupOnError: true,
  },

  delegation: {
    maxDepth: 3,
    autoExpireMs: 3600000,  // 1 hour
    requireApproval: false,
  },

  remoteSync: {
    enabled: false,
    autoSync: false,
    syncInterval: 30000,
    preserveOnDisconnect: true,
  },

  teleport: {
    autoResume: true,
    gitAware: true,
    preserveMailbox: true,
    preserveMemory: true,
  },

  memory: {
    autoPersist: true,
    persistIntervalMs: 60000,
    maxSizeMb: 100,
  },

  mailbox: {
    pollingIntervalMs: 1000,
    maxMessages: 1000,
    retentionMs: 3600000,
  },
});
```

## Integration with Claude Flow

```typescript
import { createTeammateBridge } from '@claude-flow/teammate-plugin';
import { UnifiedSwarmCoordinator } from '@claude-flow/swarm';

// Create bridge
const bridge = await createTeammateBridge();

// Map Claude Flow topology to team config
const teamConfig = {
  name: 'cf-team',
  topology: 'hierarchical',  // Maps to Claude Flow's hierarchical
  maxTeammates: 8,
  planModeRequired: true,
};

// Create team
const team = await bridge.spawnTeam(teamConfig);

// Map Claude Flow agent types to teammate configs
const agentMapping = {
  'coder': { role: 'coder', tools: ['Edit', 'Write', 'Read', 'Bash'] },
  'tester': { role: 'tester', tools: ['Read', 'Bash', 'Glob'] },
  'reviewer': { role: 'reviewer', tools: ['Read', 'Grep', 'Glob'] },
  'architect': { role: 'architect', tools: ['Read', 'Glob', 'Grep'] },
};

// Spawn teammates with Claude Flow agent types
for (const [type, config] of Object.entries(agentMapping)) {
  await bridge.spawnTeammate({
    name: `${type}-1`,
    role: config.role,
    prompt: `You are a ${type}...`,
    teamName: 'cf-team',
    allowedTools: config.tools,
  });
}
```

## File Structure

Teams are stored in `~/.claude/teams/`:

```
~/.claude/teams/
├── my-team/
│   ├── config.json        # Team configuration
│   ├── state.json         # Team state (teammates, plans)
│   ├── remote.json        # Remote session info (if synced)
│   ├── mailbox/
│   │   ├── teammate-1.json
│   │   └── teammate-2.json
│   └── memory/
│       ├── teammate-1.json
│       └── teammate-2.json
└── other-team/
    └── ...
```

## Environment Variables

The plugin uses these Claude Code environment variables:

```bash
CLAUDE_CODE_TEAM_NAME          # Current team context
CLAUDE_CODE_PLAN_MODE_REQUIRED # Require plan approval
CLAUDE_CODE_TMUX_SESSION       # tmux session name
CLAUDE_CODE_TMUX_PREFIX        # tmux prefix key
CLAUDE_CODE_TEAMMATE_COMMAND   # Custom spawn command
```

## Troubleshooting

### Plugin reports TeammateTool not available

```typescript
const version = bridge.getVersionInfo();
if (!version.compatible) {
  console.log(`Claude Code version: ${version.claudeCode}`);
  console.log(`Required: >= 2.1.19`);
  console.log('Run: claude update');
}
```

### Mailbox messages not received

Check that mailbox polling is running:

```typescript
// Mailbox is polled automatically, but you can read manually
const messages = await bridge.readMailbox('my-team', 'teammate-id');
```

### Plan approval stuck

Ensure enough teammates have voted:

```typescript
const team = bridge.getTeamState('my-team');
const plan = team.activePlans.find(p => p.id === planId);

console.log(`Approvals: ${plan.approvals.length}/${plan.requiredApprovals}`);
console.log(`Rejections: ${plan.rejections.length}`);
```

## Testing the Plugin

### Run Unit Tests

```bash
cd v3/plugins/teammate-plugin

# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

### Verify Plugin Functionality

```typescript
import { createTeammateBridge, TEAMMATE_MCP_TOOLS } from '@claude-flow/teammate-plugin';

async function verifyPlugin() {
  console.log('=== Plugin Verification ===\n');

  // 1. Check MCP tools are exported
  console.log(`✓ MCP Tools available: ${TEAMMATE_MCP_TOOLS.length}`);

  // 2. Initialize bridge
  const bridge = await createTeammateBridge();
  console.log('✓ Bridge initialized');

  // 3. Check version compatibility
  const version = bridge.getVersionInfo();
  console.log(`✓ Claude Code version: ${version.claudeCode || 'not detected'}`);
  console.log(`✓ Plugin version: ${version.plugin}`);
  console.log(`✓ Compatible: ${version.compatible}`);

  // 4. Test team creation (if compatible)
  if (version.compatible) {
    const team = await bridge.spawnTeam({ name: 'test-team' });
    console.log(`✓ Team created: ${team.name}`);

    // Cleanup
    await bridge.cleanup('test-team');
    console.log('✓ Cleanup successful');
  }

  console.log('\n=== All checks passed! ===');
}

verifyPlugin().catch(console.error);
```

### Verify via CLI

```bash
# Check plugin is registered
npx @claude-flow/cli@latest plugins list | grep teammate

# Check plugin info
npx @claude-flow/cli@latest plugins info teammate-plugin

# Test MCP tools
npx @claude-flow/cli@latest mcp tools | grep teammate
```

## Plugin Registry (IPFS)

This plugin is published to the Claude Flow Plugin Registry on IPFS for decentralized distribution.

### Registry Entry

```json
{
  "name": "teammate-plugin",
  "package": "@claude-flow/teammate-plugin",
  "version": "1.0.0-alpha.1",
  "description": "Native TeammateTool integration for Claude Code v2.1.19+",
  "author": "Claude Flow Team",
  "license": "MIT",
  "repository": "https://github.com/ruvnet/claude-flow",
  "keywords": ["claude-code", "teammate", "multi-agent", "swarm"],
  "requirements": {
    "claudeCode": ">=2.1.19",
    "node": ">=18.0.0"
  },
  "mcpTools": 21,
  "features": [
    "team-management",
    "teammate-spawning",
    "messaging",
    "plan-approval",
    "delegation",
    "remote-sync",
    "bmssp-optimization"
  ]
}
```

### Install from Registry

```bash
# Install from IPFS-backed registry
npx @claude-flow/cli@latest plugins install teammate-plugin --registry ipfs

# Or specify registry CID directly
npx @claude-flow/cli@latest plugins install teammate-plugin --cid <registry-cid>
```

### Verify Registry Integrity

```bash
# Check plugin hash matches registry
npx @claude-flow/cli@latest plugins verify teammate-plugin

# View registry metadata
npx @claude-flow/cli@latest plugins registry info
```

## License

MIT

## Related

- [Claude Flow](https://github.com/ruvnet/claude-flow) - Multi-agent orchestration framework
- [Claude Code](https://github.com/anthropics/claude-code) - Anthropic's CLI for Claude
- [ADR-027](../implementation/adrs/ADR-027-teammate-tool-integration.md) - Architecture decision record
