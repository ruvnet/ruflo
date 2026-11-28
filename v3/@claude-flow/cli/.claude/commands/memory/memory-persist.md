# memory-persist

Persist memory across sessions.

## Usage
```bash
npx @claude-flow/cli@latest memory export --output <file> [options]
npx @claude-flow/cli@latest memory import --input <file> [options]
```

## Options
- `--output <file>` - JSON export output file
- `--input <file>` - JSON export file to import
- `--namespace <namespace>` (export) - Limit the export to one namespace
- `--namespace <namespace>` (import) - Store every imported entry under this namespace, overriding namespaces in the export
- `--merge` - Merge is the default; update (overwrite) entries with the same key in the target namespace
- `--no-merge` - Leave entries whose key already exists in the target namespace unchanged and report them as failed

Exports are JSON; embeddings are not included (the import re-embeds).

## Examples
```bash
# Export memory
npx @claude-flow/cli@latest memory export --output memory-backup.json

# Import memory
npx @claude-flow/cli@latest memory import --input memory-backup.json
```
