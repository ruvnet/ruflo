# memory-search

Search through stored memory.

## Usage
```bash
npx @claude-flow/cli@latest memory search [options]
```

## Options
- `--query <text>` - Search query
- `--type <type>` - Search type (semantic, keyword, hybrid)
- `--limit <n>` - Result limit

## Examples
```bash
# Search memory
npx @claude-flow/cli@latest memory search --query "authentication"

# Keyword search
npx @claude-flow/cli@latest memory search --query "api" --type keyword

# Limited results
npx @claude-flow/cli@latest memory search --query "config" --limit 10
```
