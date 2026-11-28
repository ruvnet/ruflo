# memory-usage

Manage persistent memory storage.

## Usage
```bash
npx @claude-flow/cli@latest memory store --key <key> --value <data> [--namespace <namespace>]
npx @claude-flow/cli@latest memory retrieve --key <key> [--namespace <namespace>]
npx @claude-flow/cli@latest memory list [--namespace <namespace>] [--limit <n>]
npx @claude-flow/cli@latest memory delete --key <key> [--namespace <namespace>] [--force]
npx @claude-flow/cli@latest memory purge --namespace <namespace> [--dry-run] [--force]
```

`memory purge` permanently deletes every entry in a namespace.

## Options
- `--key <key>` - Memory key for store, retrieve, or delete
- `--value <data>` - Data to store
- `--namespace <namespace>` - Memory namespace
- `--limit <n>` - Maximum entries to list
- `--force` - Delete without confirmation
- `--dry-run` - Report how many entries a purge would permanently delete without deleting them

## Examples
```bash
# Store memory
npx @claude-flow/cli@latest memory store --key "project-config" --value '{"api": "v2"}'

# Retrieve memory
npx @claude-flow/cli@latest memory retrieve --key "project-config"

# List entries
npx @claude-flow/cli@latest memory list --limit 20

# Delete one key
npx @claude-flow/cli@latest memory delete --key "project-config" --force

# Preview permanently deleting every entry in a namespace
npx @claude-flow/cli@latest memory purge --namespace "stale-cache" --dry-run
```
