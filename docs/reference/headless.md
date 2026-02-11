# Headless Background Instances (claude -p)

## Basic Usage

```bash
claude -p "Analyze the authentication module for security issues"
claude -p --model haiku "Format this config file"
claude -p --output-format json "List all TODO comments in src/"
claude -p --max-budget-usd 0.50 "Run comprehensive security audit"
claude -p --allowedTools "Read,Grep,Glob" "Find all files that import auth"
```

## Parallel Execution

```bash
claude -p "Analyze src/auth/ for vulnerabilities" &
claude -p "Write tests for src/api/endpoints.ts" &
claude -p "Review src/models/ for performance issues" &
wait
```

## Session Continuation

```bash
claude -p --session-id "abc-123" "Start analyzing the codebase"
claude -p --resume "abc-123" "Continue with the test files"
```

## Key Flags

| Flag | Purpose |
|------|---------|
| `-p, --print` | Non-interactive mode |
| `--model <model>` | Select model (haiku, sonnet, opus) |
| `--output-format <fmt>` | text, json, stream-json |
| `--max-budget-usd <amt>` | Spending cap |
| `--allowedTools <tools>` | Restrict tools |
| `--resume <id>` | Continue previous session |
| `--permission-mode <mode>` | Permission level |
