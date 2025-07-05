// enhanced-templates.js - Generate Claude Flow v2.0.0 enhanced templates
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load template files
const loadTemplate = (filename) => {
  try {
    return readFileSync(join(__dirname, filename), 'utf8');
  } catch (error) {
    console.error(`Failed to load template ${filename}:`, error);
    return null;
  }
};

export function createEnhancedClaudeMd() {
  const template = loadTemplate('CLAUDE.md');
  if (!template) {
    // Fallback to hardcoded if template file not found
    return createEnhancedClaudeMdFallback();
  }
  return template;
}

export function createEnhancedSettingsJson() {
  const template = loadTemplate('settings.json');
  if (!template) {
    return createEnhancedSettingsJsonFallback();
  }
  return template;
}

export function createWrapperScript(type = 'unix') {
  const filename = type === 'unix' ? 'claude-flow' : 
                   type === 'windows' ? 'claude-flow.bat' : 
                   'claude-flow.ps1';
  
  const template = loadTemplate(filename);
  if (!template) {
    return createWrapperScriptFallback(type);
  }
  return template;
}

export function createCommandDoc(category, command) {
  const template = loadTemplate(`commands/${category}/${command}.md`);
  if (!template) {
    return createCommandDocFallback(category, command);
  }
  return template;
}

// Command categories and their commands
export const COMMAND_STRUCTURE = {
  analysis: ['bottleneck-detect', 'token-usage', 'performance-report'],
  automation: ['auto-agent', 'smart-spawn', 'workflow-select'],
  coordination: ['swarm-init', 'agent-spawn', 'task-orchestrate'],
  github: ['github-swarm', 'repo-analyze', 'pr-enhance', 'issue-triage', 'code-review'],
  hooks: ['pre-task', 'post-task', 'pre-edit', 'post-edit', 'session-end'],
  memory: ['memory-usage', 'memory-persist', 'memory-search'],
  monitoring: ['swarm-monitor', 'agent-metrics', 'real-time-view'],
  optimization: ['topology-optimize', 'parallel-execute', 'cache-manage'],
  training: ['neural-train', 'pattern-learn', 'model-update'],
  workflows: ['workflow-create', 'workflow-execute', 'workflow-export']
};

// Helper script content
export function createHelperScript(name) {
  const scripts = {
    'setup-mcp.sh': `#!/bin/bash
# Setup MCP server for Claude Flow

echo "🚀 Setting up Claude Flow MCP server..."

# Check if claude command exists
if ! command -v claude &> /dev/null; then
    echo "❌ Error: Claude Code CLI not found"
    echo "Please install Claude Code first"
    exit 1
fi

# Add MCP server
echo "📦 Adding Claude Flow MCP server..."
claude mcp add claude-flow npx claude-flow mcp start

echo "✅ MCP server setup complete!"
echo "🎯 You can now use mcp__claude-flow__ tools in Claude Code"
`,
    'quick-start.sh': `#!/bin/bash
# Quick start guide for Claude Flow

echo "🚀 Claude Flow Quick Start"
echo "=========================="
echo ""
echo "1. Initialize a swarm:"
echo "   npx claude-flow swarm init --topology hierarchical"
echo ""
echo "2. Spawn agents:"
echo "   npx claude-flow agent spawn --type coder --name \"API Developer\""
echo ""
echo "3. Orchestrate tasks:"
echo "   npx claude-flow task orchestrate --task \"Build REST API\""
echo ""
echo "4. Monitor progress:"
echo "   npx claude-flow swarm monitor"
echo ""
echo "📚 For more examples, see .claude/commands/"
`,
    'github-setup.sh': `#!/bin/bash
# Setup GitHub integration for Claude Flow

echo "🔗 Setting up GitHub integration..."

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo "⚠️  GitHub CLI (gh) not found"
    echo "Install from: https://cli.github.com/"
    echo "Continuing without GitHub features..."
else
    echo "✅ GitHub CLI found"
    
    # Check auth status
    if gh auth status &> /dev/null; then
        echo "✅ GitHub authentication active"
    else
        echo "⚠️  Not authenticated with GitHub"
        echo "Run: gh auth login"
    fi
fi

echo ""
echo "📦 GitHub swarm commands available:"
echo "  - npx claude-flow github swarm"
echo "  - npx claude-flow repo analyze"
echo "  - npx claude-flow pr enhance"
echo "  - npx claude-flow issue triage"
`
  };
  
  return scripts[name] || '';
}

// Fallback functions for when templates can't be loaded
function createEnhancedClaudeMdFallback() {
  return `# Claude Code Configuration for Claude Flow

## 🚀 IMPORTANT: Claude Flow AI-Driven Development

### Claude Code Handles:
- ✅ **ALL file operations** (Read, Write, Edit, MultiEdit)
- ✅ **ALL code generation** and development tasks
- ✅ **ALL bash commands** and system operations
- ✅ **ALL actual implementation** work
- ✅ **Project navigation** and code analysis

### Claude Flow MCP Tools Handle:
- 🧠 **Coordination only** - Orchestrating Claude Code's actions
- 💾 **Memory management** - Persistent state across sessions
- 🤖 **Neural features** - Cognitive patterns and learning
- 📊 **Performance tracking** - Monitoring and metrics
- 🐝 **Swarm orchestration** - Multi-agent coordination
- 🔗 **GitHub integration** - Advanced repository management

### ⚠️ Key Principle:
**MCP tools DO NOT create content or write code.** They coordinate and enhance Claude Code's native capabilities.

## Quick Start

1. Add MCP server: \`claude mcp add claude-flow npx claude-flow mcp start\`
2. Initialize swarm: \`mcp__claude-flow__swarm_init { topology: "hierarchical" }\`
3. Spawn agents: \`mcp__claude-flow__agent_spawn { type: "coder" }\`
4. Orchestrate: \`mcp__claude-flow__task_orchestrate { task: "Build feature" }\`

See full documentation in \`.claude/commands/\`
`;
}

function createEnhancedSettingsJsonFallback() {
  return JSON.stringify({
    env: {
      CLAUDE_FLOW_AUTO_COMMIT: "false",
      CLAUDE_FLOW_AUTO_PUSH: "false",
      CLAUDE_FLOW_HOOKS_ENABLED: "true",
      CLAUDE_FLOW_TELEMETRY_ENABLED: "true",
      CLAUDE_FLOW_REMOTE_EXECUTION: "true",
      CLAUDE_FLOW_GITHUB_INTEGRATION: "true"
    },
    permissions: {
      allow: [
        "Bash(npx claude-flow *)",
        "Bash(npm run lint)",
        "Bash(npm run test:*)",
        "Bash(npm test *)",
        "Bash(git status)",
        "Bash(git diff *)",
        "Bash(git log *)",
        "Bash(git add *)",
        "Bash(git commit *)",
        "Bash(git push)",
        "Bash(git config *)",
        "Bash(gh *)",
        "Bash(node *)",
        "Bash(which *)",
        "Bash(pwd)",
        "Bash(ls *)"
      ],
      deny: [
        "Bash(rm -rf /)",
        "Bash(curl * | bash)",
        "Bash(wget * | sh)",
        "Bash(eval *)"
      ]
    },
    hooks: {
      preEdit: {
        enabled: true,
        actions: ["auto-assign-agents", "validate-syntax", "load-context"]
      },
      postEdit: {
        enabled: true,
        actions: ["format-code", "update-memory", "train-neural", "analyze-performance"]
      },
      preCommand: {
        enabled: true,
        actions: ["validate-safety", "prepare-resources", "optimize-execution"]
      },
      postCommand: {
        enabled: true,
        actions: ["track-metrics", "store-results", "update-telemetry"]
      },
      sessionEnd: {
        enabled: true,
        actions: ["generate-summary", "persist-state", "export-metrics"]
      }
    },
    mcpServers: {
      "claude-flow": {
        command: "npx",
        args: ["claude-flow", "mcp", "start"],
        env: {
          CLAUDE_FLOW_HOOKS_ENABLED: "true",
          CLAUDE_FLOW_TELEMETRY_ENABLED: "true",
          CLAUDE_FLOW_REMOTE_READY: "true",
          CLAUDE_FLOW_GITHUB_INTEGRATION: "true"
        }
      }
    },
    includeCoAuthoredBy: true,
    features: {
      autoTopologySelection: true,
      parallelExecution: true,
      neuralTraining: true,
      bottleneckAnalysis: true,
      smartAutoSpawning: true,
      selfHealingWorkflows: true,
      crossSessionMemory: true,
      githubIntegration: true
    },
    performance: {
      maxAgents: 10,
      defaultTopology: "hierarchical",
      executionStrategy: "parallel",
      tokenOptimization: true,
      cacheEnabled: true,
      telemetryLevel: "detailed"
    }
  }, null, 2);
}

function createWrapperScriptFallback(type) {
  if (type === 'unix') {
    return `#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const cliPath = path.resolve(__dirname, 'dist', 'index.js');
const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, CLAUDE_FLOW_CLI: 'true' }
});

child.on('exit', (code) => process.exit(code));
child.on('error', (err) => {
  console.error('Failed to start Claude Flow:', err);
  process.exit(1);
});`;
  } else if (type === 'windows') {
    return `@echo off
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    exit /b 1
)
node "%~dp0claude-flow" %*`;
  } else {
    return `#!/usr/bin/env pwsh
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is not installed"
    exit 1
}
& node "$PSScriptRoot\\claude-flow" @Arguments
exit $LASTEXITCODE`;
  }
}

function createCommandDocFallback(category, command) {
  return `# ${command}

Command documentation for ${category}/${command}

## Usage

\`\`\`bash
npx claude-flow ${command.replace('-', ' ')} [options]
\`\`\`

## Description

This command is part of the ${category} category in Claude Flow.

## Options

Run with --help for available options:
\`\`\`bash
npx claude-flow ${command.replace('-', ' ')} --help
\`\`\`

## Examples

See .claude/commands/${category}/ for more examples.
`;
}