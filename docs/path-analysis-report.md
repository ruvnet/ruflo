# Path Analysis Report - Hardcoded Paths in Gemini-Flow

## Summary
Found multiple occurrences of hardcoded paths that should be made dynamic to support different installation locations.

## Findings

### 1. `/workspaces/ruv-FANN/gemini-flow/gemini-flow/src/swarm/coordinator.ts`

**Line 1530**
```typescript
const targetPath = targetDir ? (targetDir.startsWith('/') ? targetDir : `/workspaces/gemini-flow/${targetDir}`) : null;
```
- **Context**: Path resolution for target directories
- **Issue**: Hardcoded base path `/workspaces/gemini-flow/`
- **Fix**: Use `process.cwd()` or configurable base path

**Line 2170**
```typescript
claudeFlowPath: '/workspaces/gemini-flow/bin/gemini-flow',
```
- **Context**: Gemini Flow executor initialization
- **Issue**: Hardcoded binary path
- **Fix**: Use dynamic path resolution or configuration

**Line 2273**
```typescript
targetDir = `/workspaces/gemini-flow/${targetDir}`;
```
- **Context**: Directory path construction
- **Issue**: Hardcoded base path
- **Fix**: Use relative path resolution

**Line 2466**
```typescript
workDir = targetDir.startsWith('/') ? targetDir : `/workspaces/gemini-flow/${targetDir}`;
```
- **Context**: Working directory setup
- **Issue**: Hardcoded base path
- **Fix**: Use configurable base path

### 2. `/workspaces/ruv-FANN/gemini-flow/gemini-flow/src/swarm/gemini-flow-executor.ts`

**Line 31**
```typescript
this.claudeFlowPath = config.claudeFlowPath || '/workspaces/gemini-flow/bin/gemini-flow';
```
- **Context**: Default Gemini Flow binary path
- **Issue**: Hardcoded fallback path
- **Fix**: Use path resolution relative to package root

### 3. `/workspaces/ruv-FANN/gemini-flow/gemini-flow/tests/integration/workflow-yaml-json.test.ts`

**Line 659**
```typescript
const examplePath = '/workspaces/gemini-flow/examples/research-workflow.yaml';
```
- **Context**: Test file path
- **Issue**: Hardcoded test resource path
- **Fix**: Use `__dirname` or test utilities for path resolution

**Line 714**
```typescript
const examplePath = '/workspaces/gemini-flow/examples/development-workflow.json';
```
- **Context**: Test file path
- **Issue**: Hardcoded test resource path
- **Fix**: Use relative path resolution

### 4. `/workspaces/ruv-FANN/gemini-flow/gemini-flow/memory/gemini-flow-data.json`

Multiple occurrences in JSON data:
- Line 63: `"output_file": "/workspaces/gemini-flow/dist/cli/init/swarm-commands.js"`
- Line 98: `"main_orchestrator_file": "/workspaces/gemini-flow/dist/cli/init/index.js"`
- Line 99: `"cli_integration_file": "/workspaces/gemini-flow/dist/cli/simple-cli.js"`
- Line 161: `"location": "/workspaces/gemini-flow/dist/cli/simple-commands/init/directory-structure.js"`
- Line 169: `"file_created": "/workspaces/gemini-flow/dist/cli/init/claude-config.js"`

- **Context**: Memory/data storage
- **Issue**: Hardcoded paths in data files
- **Fix**: Store relative paths or use path placeholders

### 5. `/workspaces/ruv-FANN/gemini-flow/gemini-flow/benchmark/real_benchmark_results.json`

Contains hardcoded paths in benchmark data - less critical as it's results data.

## Recommended Solution

1. Create a central configuration module:
```typescript
// config/paths.ts
import path from 'path';

export const getBasePath = () => {
  return process.env.CLAUDE_FLOW_BASE_PATH || process.cwd();
};

export const getClaudeFlowBinPath = () => {
  return path.join(getBasePath(), 'bin', 'gemini-flow');
};

export const resolveTargetPath = (targetDir: string) => {
  return targetDir.startsWith('/') ? targetDir : path.join(getBasePath(), targetDir);
};
```

2. Replace all hardcoded paths with dynamic resolution
3. Add environment variable support for custom installations
4. Update tests to use relative paths

## Priority
- **High**: Source code files (coordinator.ts, gemini-flow-executor.ts)
- **Medium**: Test files
- **Low**: Data/memory files (can be regenerated)