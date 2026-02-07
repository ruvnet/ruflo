# ADR-027 Supplement: @openai/codex Package Deep Analysis

## Package Overview

**Package**: `@openai/codex@0.98.0`
**License**: Apache-2.0
**Repository**: https://github.com/openai/codex
**Type**: ESM module with native binary wrapper

## Architecture

### Package Structure

```
@openai/codex/
├── package.json          # Package manifest
├── README.md            # Installation instructions
├── bin/
│   ├── codex.js         # Node.js entry point (177 lines)
│   └── rg               # dotslash manifest for ripgrep
└── vendor/              # Pre-compiled native binaries
    ├── aarch64-apple-darwin/      # macOS ARM64
    ├── x86_64-apple-darwin/       # macOS x86_64
    ├── aarch64-unknown-linux-musl/ # Linux ARM64
    ├── x86_64-unknown-linux-musl/  # Linux x86_64
    ├── aarch64-pc-windows-msvc/   # Windows ARM64
    └── x86_64-pc-windows-msvc/    # Windows x86_64
```

### Binary Sizes

| Platform | Codex Binary | ripgrep | Total |
|----------|--------------|---------|-------|
| Linux x86_64 | 73 MB | 6.6 MB | ~80 MB |
| Linux ARM64 | 60 MB | 5.2 MB | ~65 MB |
| macOS x86_64 | 62 MB | 5.2 MB | ~67 MB |
| macOS ARM64 | 54 MB | 4.4 MB | ~58 MB |
| Windows x86_64 | 81 MB + helpers | 5.4 MB | ~88 MB |
| Windows ARM64 | 68 MB + helpers | 4.2 MB | ~74 MB |

**Total package size**: ~450 MB (all platforms included)

### Windows-Specific Binaries

Windows builds include additional helper executables:
- `codex-command-runner.exe` (~600 KB) - Command execution helper
- `codex-windows-sandbox-setup.exe` (~600 KB) - Sandbox configuration

## Entry Point Analysis (`bin/codex.js`)

### Platform Detection

```javascript
const { platform, arch } = process;
// Maps Node.js platform/arch to Rust target triples:
// - linux/x64    → x86_64-unknown-linux-musl
// - linux/arm64  → aarch64-unknown-linux-musl
// - darwin/x64   → x86_64-apple-darwin
// - darwin/arm64 → aarch64-apple-darwin
// - win32/x64    → x86_64-pc-windows-msvc
// - win32/arm64  → aarch64-pc-windows-msvc
```

### Execution Flow

1. Detect platform and architecture
2. Locate vendor binary path
3. Prepend vendor `path/` directory to `PATH` (for ripgrep)
4. Set package manager environment variable (`CODEX_MANAGED_BY_NPM` or `CODEX_MANAGED_BY_BUN`)
5. Spawn native binary with stdio inherited
6. Forward signals (SIGINT, SIGTERM, SIGHUP) to child
7. Mirror child exit code/signal

### Key Implementation Details

```javascript
// ESM module with async top-level await
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: "inherit",  // Full stdio passthrough
  env,               // Modified PATH for ripgrep
});

// Signal forwarding for graceful shutdown
["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
  process.on(sig, () => forwardSignal(sig));
});

// Exit code mirroring
if (childResult.type === "signal") {
  process.kill(process.pid, childResult.signal);
} else {
  process.exit(childResult.exitCode);
}
```

## CLI Commands Reference

### Core Commands

| Command | Description | Aliases |
|---------|-------------|---------|
| `codex [PROMPT]` | Interactive terminal UI | - |
| `codex exec` | Non-interactive execution | `e` |
| `codex review` | Code review mode | - |
| `codex resume` | Continue previous session | - |
| `codex fork` | Branch from existing session | - |
| `codex apply` | Apply cloud task diffs | `a` |
| `codex cloud` | Browse Codex Cloud tasks | - |

### MCP Integration

| Command | Description |
|---------|-------------|
| `codex mcp list` | List configured MCP servers |
| `codex mcp get <name>` | Get server configuration |
| `codex mcp add <name>` | Add new MCP server |
| `codex mcp remove <name>` | Remove MCP server |
| `codex mcp login <name>` | OAuth login for server |
| `codex mcp logout <name>` | Logout from server |
| `codex mcp-server` | Run Codex as MCP server |

### Authentication

| Command | Description |
|---------|-------------|
| `codex login` | Authenticate (ChatGPT OAuth or API key) |
| `codex logout` | Remove stored credentials |

### Utility Commands

| Command | Description |
|---------|-------------|
| `codex features list` | Show feature flags |
| `codex features enable <flag>` | Enable feature |
| `codex features disable <flag>` | Disable feature |
| `codex completion <shell>` | Generate shell completions |
| `codex sandbox <cmd>` | Run command in sandbox |
| `codex debug` | Debugging tools |

## Feature Flags

### Stable Features (Default: ON)

| Feature | Description |
|---------|-------------|
| `shell_tool` | Default shell command tool |
| `unified_exec` | PTY-backed exec tool |
| `request_rule` | Smart approvals |
| `enable_request_compression` | Compress requests |
| `skill_mcp_dependency_install` | Auto-install skill dependencies |
| `steer` | Steering controls |
| `collaboration_modes` | Collaboration mode selection |
| `personality` | Personality customization |

### Experimental Features (Default: OFF)

| Feature | Description |
|---------|-------------|
| `shell_snapshot` | Cache shell environment |
| `child_agents_md` | Nested AGENTS.md support |
| `apply_patch_freeform` | Freeform patch application |
| `collab` | Collaboration features |
| `apps` | App integrations |

### Under Development (Default: varies)

| Feature | Default | Description |
|---------|---------|-------------|
| `exec_policy` | ON | Enforce policy rules |
| `remote_compaction` | ON | Remote history compression |
| `remote_models` | ON | Refresh model list |
| `runtime_metrics` | OFF | Performance metrics |
| `sqlite` | OFF | SQLite integration |
| `use_linux_sandbox_bwrap` | OFF | Bubblewrap sandboxing |

## Configuration Options

### Command Line Flags

| Flag | Values | Description |
|------|--------|-------------|
| `-c, --config` | `key=value` | Override config.toml values |
| `-m, --model` | string | Select model |
| `-s, --sandbox` | `read-only`, `workspace-write`, `danger-full-access` | Sandbox mode |
| `-a, --ask-for-approval` | `untrusted`, `on-failure`, `on-request`, `never` | Approval policy |
| `-p, --profile` | string | Load config profile |
| `-C, --cd` | path | Working directory |
| `-i, --image` | paths | Attach images |
| `--oss` | - | Use local OSS provider |
| `--local-provider` | `lmstudio`, `ollama` | OSS provider selection |
| `--full-auto` | - | Low-friction automatic mode |
| `--dangerously-bypass-approvals-and-sandbox` | - | YOLO mode |
| `--search` | - | Enable live web search |
| `--add-dir` | path | Additional writable directories |

### Exec-Specific Options

| Flag | Description |
|------|-------------|
| `--json` | Output JSONL events |
| `-o, --output-last-message` | Write final message to file |
| `--output-schema` | JSON Schema for response validation |
| `--skip-git-repo-check` | Allow non-Git directories |
| `--color` | `always`, `never`, `auto` |

## Vendored Dependencies

### ripgrep (`rg`)

Codex includes pre-built ripgrep binaries for fast file searching.

**Version**: 14.1.1 (most platforms), 13.0.0-13 (Windows ARM64)

The `bin/rg` file uses [dotslash](https://dotslash-cli.com/) format:

```json
{
  "name": "rg",
  "platforms": {
    "macos-aarch64": {
      "hash": "blake3",
      "digest": "8d9942032585...",
      "format": "tar.gz",
      "path": "ripgrep-14.1.1-aarch64-apple-darwin/rg",
      "providers": [{
        "url": "https://github.com/BurntSushi/ripgrep/releases/..."
      }]
    }
    // ... other platforms
  }
}
```

## Integration with Claude Flow

### Parallels

| Claude Flow | Codex | Notes |
|-------------|-------|-------|
| `CLAUDE.md` | `AGENTS.md` | Project instructions |
| `CLAUDE.local.md` | `AGENTS.override.md` | Local overrides |
| `.claude/skills/*.md` | `.agents/skills/*/SKILL.md` | Skills |
| `.claude/settings.json` | `~/.codex/config.toml` | Configuration |
| `.mcp.json` | `config.toml [mcp_servers]` | MCP config |
| Hooks system | Automations | Background tasks |
| `claude -p` | `codex exec` | Non-interactive |
| Permission modes | Approval policies | Safety |

### Recommended Integration Points

1. **MCP Server Mode**
   - Codex can run as MCP server (`codex mcp-server`)
   - Claude Flow can connect to Codex as MCP client
   - Enables cross-platform agent orchestration

2. **Skills Conversion**
   - Convert `.claude/skills/*.md` to `.agents/skills/*/SKILL.md`
   - Maintain bidirectional sync

3. **Configuration Translation**
   - Map `settings.json` hooks to `config.toml` features
   - Translate approval policies

4. **Session Interop**
   - Codex sessions use `codex resume`/`codex fork`
   - Claude Flow uses session persistence
   - Consider session format translation

## Security Considerations

### Sandbox Modes

| Mode | File Access | Network | Use Case |
|------|-------------|---------|----------|
| `read-only` | Read only | Blocked | Safe exploration |
| `workspace-write` | Workspace only | Limited | Normal development |
| `danger-full-access` | Unrestricted | Unrestricted | Trusted environments |

### Approval Policies

| Policy | Behavior | Risk Level |
|--------|----------|------------|
| `untrusted` | Only trusted commands | Low |
| `on-failure` | Approve on failure | Medium |
| `on-request` | Model decides | Medium-High |
| `never` | No approval | High |

### Dangerous Flag

```bash
--dangerously-bypass-approvals-and-sandbox
```

This flag bypasses ALL safety checks. Only use in:
- Externally sandboxed environments (containers, VMs)
- CI/CD pipelines with proper isolation
- Automated testing infrastructure

## Implementation Recommendations

### For `init --codex`

1. **Generate AGENTS.md** from project analysis
2. **Create `.agents/skills/`** directory with converted skills
3. **Generate `config.toml`** with:
   - MCP server configuration for claude-flow
   - Skill enablement
   - Default approval policy (`on-request`)
   - Default sandbox mode (`workspace-write`)

4. **Create `.codex/` for local overrides** (gitignored)

### For Dual-Mode Support

1. **Keep both configurations in sync**
2. **Use `.claude-flow/` as shared runtime**
3. **Generate platform-specific skills**
4. **Map hooks ↔ automations**

### For MCP Integration

```toml
# Claude Flow as MCP server for Codex
[mcp_servers.claude-flow]
command = "npx"
args = ["-y", "@claude-flow/cli@latest"]
enabled = true
tool_timeout_sec = 120
```

## Undocumented Features (Binary Analysis)

The following features were discovered through binary string analysis and are not documented in official sources.

### Undocumented Environment Variables

| Variable | Purpose | Claude Flow Use Case |
|----------|---------|---------------------|
| `CODEX_HOME` | Override config directory (default: `~/.codex`) | Custom config locations |
| `CODEX_API_KEY` | Alternative to `OPENAI_API_KEY` | API key management |
| `CODEX_OSS_BASE_URL` | Override OSS provider URL | Local model integration |
| `CODEX_OSS_PORT` | Override OSS provider port | Local model integration |
| `CODEX_SANDBOX_NETWORK_DISABLED` | Disable network in sandbox | Security hardening |
| `CODEX_CLOUD_TASKS_FORCE_INTERNAL` | Force internal cloud tasks mode | Testing |
| `CODEX_CLOUD_TASKS_MODE` | Cloud tasks mode override | CI/CD integration |
| `CODEX_CLOUD_TASKS_BASE_URL` | Override cloud tasks URL | Enterprise deployment |
| `CODEX_REFRESH_TOKEN_URL_OVERRIDE` | Override token refresh URL | Custom auth |
| `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` | Override originator header | Telemetry |
| `CODEX_BWRAP_ENABLE_FFI` | Enable bubblewrap FFI sandbox | Linux sandboxing |
| `CODEX_APPLY_GIT_CFG` | Custom git config for apply | Git integration |
| `CODEX_TUI_ROUNDED` | TUI rounded corners | UI customization |
| `CODEX_TUI_RECORD_SESSION` | Record TUI session | Debugging |
| `CODEX_TUI_SESSION_LOG_PATH` | Session log path | Debugging |
| `CODEX_CONNECTORS_TOKEN` | MCP connectors token | MCP auth |
| `CODEX_GITHUB_PERSONAL_ACCESS_TOKEN` | GitHub PAT for MCP | GitHub integration |
| `CODEX_STARTING_DIFF` | Initial diff for sessions | Session preloading |
| `CODEX_CI` | CI mode flag | CI/CD pipelines |

### Hidden API Endpoints

```
/api/codex/apps              # App management
/api/codex/config/requirements  # Config requirements
/api/codex/environments      # Environment management
/api/codex/tasks             # Task management
/api/codex/tasks/list        # List tasks
/api/codex/usage             # Usage statistics
/api/accounts                # Account management
/api/version                 # Version info
```

### Internal JSON-RPC Methods

These methods are available via the MCP server or app-server protocol:

#### Skills Management
```javascript
"skills/remote/read"    // Read remote skill
"skills/remote/write"   // Write remote skill
"skills/config/write"   // Write skill config
"skills/list"           // List available skills
```

#### Thread Operations
```javascript
"thread/start"          // Start new thread
"thread/resume"         // Resume existing thread
"thread/fork"           // Fork thread
"thread/archive"        // Archive thread
"thread/name/set"       // Set thread name
"thread/compact/start"  // Start compaction
"thread/rollback"       // Rollback thread
"thread/loaded/list"    // List loaded threads
"thread/read"           // Read thread data
```

#### Collaboration (Experimental)
```javascript
"collaborationMode/list"      // List collaboration modes
"mock/experimentalMethod"     // Test experimental features
```

#### Account & Auth
```javascript
"account/login/start"         // Start login flow
"account/login/cancel"        // Cancel login
"account/logout"              // Logout
"account/rateLimits/read"     // Read rate limits
"account/read"                // Read account info
```

#### Configuration
```javascript
"config/read"                 // Read config
"config/value/write"          // Write config value
"config/batchWrite"           // Batch write config
"configRequirements/read"     // Read requirements
"config/mcpServer/reload"     // Reload MCP server
```

#### Review & Execution
```javascript
"review/start"                // Start code review
"turn/start"                  // Start turn
"turn/interrupt"              // Interrupt turn
"command/exec"                // Execute command
"feedback/upload"             // Upload feedback
```

### Hidden CLI Commands

| Command | Purpose | Usage |
|---------|---------|-------|
| `debug-config` | Show config layer stack and sources | `codex debug-config` |
| `setup-elevated-sandbox` | Windows elevated sandbox setup | Windows only |
| `test-approval` | Test approval request flow | Testing |
| `rollout` | Print rollout file path | Debugging |

### Experimental Internal Features

| Feature | Description | Potential Use |
|---------|-------------|---------------|
| `experimentalApi` | Enable experimental API methods | Advanced integrations |
| `experimentalRawEvents` | Emit raw response items on stream | Event processing |
| `subAgentThreadSpawn` | Spawn sub-agent threads | Multi-agent coordination |
| `subAgentCompact` | Compact sub-agent history | Memory management |
| `ghostSnapshot` | Repository state snapshots | Version control |
| `dynamicTools` | Runtime tool registration | Plugin system |

### Internal Data Structures

#### CollabAgentToolCall
Multi-agent collaboration with fields:
- `senderThreadId` - Originating agent
- `receiverThreadIds` - Target agents
- `agentsStates` - Agent state tracking

#### GhostCommit
Repository snapshots:
- Creates temporary commits for state preservation
- Uses `codex snapshot@codex.local` as author
- Enables undo/rollback operations

#### DynamicToolCall
Runtime tool registration:
- Allows tools to be added at runtime
- Supports custom schemas
- Enables plugin architecture

### Model Information

The binary confirms GPT-5 model usage:
```
"You are Codex, based on GPT-5. You are running as a coding
agent in the Codex CLI on a user's computer."
```

Available models include:
- `gpt-5.3-codex` (latest)
- `gpt-5.2-codex`
- `gpt-5-codex`

## Claude Flow Integration Opportunities

### Using Undocumented Features

1. **Session Recording**
   ```bash
   CODEX_TUI_RECORD_SESSION=1 CODEX_TUI_SESSION_LOG_PATH=/tmp/codex.log codex
   ```
   Use for debugging and learning pattern extraction.

2. **CI Mode**
   ```bash
   CODEX_CI=1 codex exec --json "task description"
   ```
   Optimized for pipeline execution.

3. **Custom Config Location**
   ```bash
   CODEX_HOME=/project/.codex codex
   ```
   Project-specific configurations.

4. **Network Isolation**
   ```bash
   CODEX_SANDBOX_NETWORK_DISABLED=1 codex
   ```
   Maximum security for sensitive operations.

5. **Sub-Agent Spawning**
   Via JSON-RPC: `thread/fork` with collaboration mode for multi-agent workflows.

6. **Dynamic Tools**
   Register claude-flow tools at runtime via the MCP protocol.

### Programmatic Control via JSON-RPC

```typescript
// Example: Programmatic Codex control
const codexSession = {
  // Start a session
  start: { method: "thread/start", params: { prompt: "...", cwd: "..." } },

  // Fork for parallel work
  fork: { method: "thread/fork", params: { threadId: "...", prompt: "..." } },

  // Read rate limits
  limits: { method: "account/rateLimits/read", params: {} },

  // Batch config update
  config: { method: "config/batchWrite", params: { values: [...] } }
};
```

### Ghost Snapshots for Undo

Codex creates "ghost commits" for state management:
```bash
# Internal git operations
git commit-tree -p HEAD "codex snapshot"
```

Claude-flow could use similar patterns for swarm state management.

## Conclusion

The `@openai/codex` package is a well-designed native binary wrapper that:

1. **Is lightweight** - The Node.js wrapper is only 177 lines
2. **Is cross-platform** - Supports all major OS/arch combinations
3. **Includes dependencies** - Bundles ripgrep for file search
4. **Follows standards** - Uses AGENTS.md, Skills, MCP
5. **Is actively developed** - 27+ feature flags indicate rapid iteration
6. **Has rich internals** - Many undocumented features for advanced use

The undocumented features provide significant opportunities for deep integration:
- **Environment variables** for configuration and debugging
- **JSON-RPC methods** for programmatic control
- **Sub-agent collaboration** for multi-agent workflows
- **Ghost snapshots** for state management
- **Dynamic tools** for runtime extensibility

The package architecture is similar to Claude Code's approach, making it straightforward to create a compatible Codex integration in claude-flow.

## @claude-flow/codex Package

Based on this analysis, we've created the `@claude-flow/codex` package as the first step in the coflow rebranding initiative.

### Package Location

```
v3/@claude-flow/codex/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Main exports
    ├── types.ts              # TypeScript definitions
    ├── cli.ts                # CLI entry point
    ├── initializer.ts        # CodexInitializer class
    ├── generators/
    │   ├── index.ts
    │   ├── agents-md.ts      # AGENTS.md generator
    │   ├── skill-md.ts       # SKILL.md generator
    │   └── config-toml.ts    # config.toml generator
    ├── templates/
    │   └── index.ts          # Built-in templates and skills
    ├── validators/
    │   └── index.ts          # Validation functions
    └── migrations/
        └── index.ts          # Claude Code → Codex migration
```

### Key Features

| Feature | Description |
|---------|-------------|
| AGENTS.md Generator | Full/default/minimal/enterprise templates |
| SKILL.md Generator | 6 built-in skills + custom skill support |
| config.toml Generator | Profile support, MCP servers, features |
| Migration Tools | Claude Code to Codex migration with analysis |
| Validators | Validate AGENTS.md, SKILL.md, config.toml |
| Dual Mode | Generate both Claude Code and Codex configs |

### CLI Commands

```bash
# Initialize new Codex project
npx @claude-flow/codex init --template default

# Generate custom skill
npx @claude-flow/codex generate-skill --name my-skill

# Validate configuration
npx @claude-flow/codex validate

# Migrate from Claude Code
npx @claude-flow/codex migrate --from CLAUDE.md

# List available templates
npx @claude-flow/codex templates

# List built-in skills
npx @claude-flow/codex skills
```

### Future: coflow Umbrella

This package is the first step in transitioning from `claude-flow` to `coflow`:

```bash
# Current
npx @claude-flow/codex init

# Future (after umbrella rebrand)
npx coflow init --codex
```
