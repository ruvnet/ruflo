# Publishing to npm

## Rules

- Publish BOTH packages: `@claude-flow/cli` first, then `claude-flow` (umbrella)
- Update ALL dist-tags for BOTH packages
- Run verification before telling user publishing is complete

## Steps

```bash
# 1. Build and publish CLI
cd v3/@claude-flow/cli
npm version 3.0.0-alpha.XXX --no-git-tag-version
npm run build
npm publish --tag alpha
npm dist-tag add @claude-flow/cli@3.0.0-alpha.XXX latest

# 2. Publish umbrella
cd /workspaces/claude-flow
npm version 3.0.0-alpha.YYY --no-git-tag-version
npm publish --tag v3alpha

# 3. Update ALL umbrella tags
npm dist-tag add claude-flow@3.0.0-alpha.YYY latest
npm dist-tag add claude-flow@3.0.0-alpha.YYY alpha
```

## Verification

```bash
npm view @claude-flow/cli dist-tags --json
npm view claude-flow dist-tags --json
```

## All Tags

| Package | Tag | Command |
|---------|-----|---------|
| `@claude-flow/cli` | `alpha` | `npx @claude-flow/cli@alpha` |
| `@claude-flow/cli` | `latest` | `npx @claude-flow/cli@latest` |
| `claude-flow` | `alpha` | `npx claude-flow@alpha` |
| `claude-flow` | `latest` | `npx claude-flow@latest` |
| `claude-flow` | `v3alpha` | `npx claude-flow@v3alpha` |
