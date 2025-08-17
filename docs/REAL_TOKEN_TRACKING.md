# Real Token Usage Tracking for Claude Flow

This guide explains how to enable real token usage tracking in Claude Flow, integrating with Claude Code's monitoring capabilities.

## Overview

Claude Flow can now track actual token usage from Claude Code sessions instead of showing simulated data. This provides:

- Real-time token consumption metrics
- Accurate cost calculations based on Anthropic pricing
- Agent-level breakdown of token usage
- CSV export of usage data
- Optimization recommendations based on actual usage patterns

## Setup Instructions

### 1. Enable Claude Code Telemetry

Set the environment variable to enable OpenTelemetry monitoring:

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
```

Add this to your shell profile (`.bashrc`, `.zshrc`, etc.) to make it permanent.

### 2. Configure Metrics Storage

Claude Flow looks for metrics in these locations (in order):

1. **OpenTelemetry metrics** (when `CLAUDE_CODE_ENABLE_TELEMETRY=1`)
2. **Local metrics file**: `~/.claude/metrics/usage.json`
3. **Project metrics**: `.claude-flow/token-usage.json`

### 3. Manual Token Tracking (Alternative)

If you want to track tokens manually without OpenTelemetry, create a `.claude-flow/token-usage.json` file:

```json
{
  "total": 156234,
  "input": 98456,
  "output": 57778,
  "byAgent": {
    "coordinator": 42430,
    "developer": 68965,
    "researcher": 28734,
    "analyzer": 16105
  }
}
```

## Usage

Once configured, the token usage command will show real data:

```bash
# Basic usage
claude-flow analysis token-usage

# With agent breakdown
claude-flow analysis token-usage --breakdown

# With cost analysis
claude-flow analysis token-usage --cost-analysis

# Filter by agent type
claude-flow analysis token-usage --agent developer --breakdown
```

## Metrics Format

### Claude Code Metrics Schema

The system expects metrics in this format from `~/.claude/metrics/usage.json`:

```json
{
  "sessions": [
    {
      "sessionId": "session-123",
      "timestamp": "2024-01-20T10:30:00Z",
      "agentType": "developer",
      "tokenUsage": {
        "total": 5234,
        "input": 3140,
        "output": 2094
      }
    }
  ]
}
```

### OpenTelemetry Integration

When `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set, Claude Code exports metrics including:

- `claude_code_api_request_cost` - API request costs
- `claude_code_tokens_used` - Token consumption
- `claude_code_session_count` - Number of sessions
- `claude_code_lines_modified` - Code changes

## Cost Calculation

Token costs are calculated using Anthropic's pricing:

- **Claude 3 Opus**: $15/$75 per million tokens (input/output)
- **Claude 3 Sonnet**: $3/$15 per million tokens (default for Claude Code)
- **Claude 3 Haiku**: $0.25/$1.25 per million tokens

## Features

### Real-Time Analysis
- Shows actual token consumption from your Claude Code sessions
- Breaks down usage by agent type (coordinator, developer, researcher, etc.)
- Calculates real costs based on current Anthropic pricing

### Optimization Suggestions
- Identifies high-usage agents that could benefit from prompt optimization
- Suggests caching strategies for repetitive tasks
- Recommends using Claude Haiku for non-critical operations

### CSV Export
- Generates detailed CSV reports in `./analysis-reports/`
- Includes timestamp, agent type, token counts, and costs
- Useful for billing, budgeting, and optimization analysis

## Troubleshooting

### No Token Data Available

If you see "Token usage is within optimal range" with 0 tokens:

1. Check that `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set
2. Ensure you've run Claude Code sessions after enabling telemetry
3. Verify metrics files exist in the expected locations
4. Try creating a manual `.claude-flow/token-usage.json` file

### Fallback to Simulated Data

The system falls back to simulated data when:
- No real metrics are available
- File permissions prevent reading metrics
- Metrics files are corrupted

You'll see "(Simulated)" in the output when using fallback data.

## Best Practices

1. **Enable telemetry early**: Start tracking from the beginning of your project
2. **Regular analysis**: Run token analysis weekly to identify trends
3. **Agent optimization**: Focus on optimizing high-usage agent types
4. **Cost monitoring**: Use `--cost-analysis` flag for budget tracking
5. **Export reports**: Generate CSV reports for detailed analysis

## Future Enhancements

Planned improvements include:
- Direct integration with Claude Code's telemetry pipeline
- Real-time token tracking during execution
- Historical trend analysis and visualization
- Budget alerts and thresholds
- Multi-project token aggregation