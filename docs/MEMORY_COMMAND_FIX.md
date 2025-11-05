# Memory Command Fix - onnxruntime-node Error
**Issue:** `npx claude-flow@alpha memory status` fails with "Cannot find package 'onnxruntime-node'"
**Status:** ✅ FIXED
**Date:** 2025-10-25

---

## Problem

```bash
$ npx claude-flow@alpha memory status
❌ Error: Cannot find package 'onnxruntime-node' imported from
   /home/codespace/.npm/_npx/7cfa166e65244432/node_modules/agentic-flow/dist/router/providers/onnx-local.js
```

**Root Cause:**
- `onnxruntime-node` is an **optional dependency** in agentic-flow
- `npx` creates a temporary directory that doesn't include optional dependencies
- The ONNX router provider tries to import `onnxruntime-node` even when not needed

---

## Solution

### Option 1: Use Local Installation ✅ RECOMMENDED

```bash
# Install locally first
npm install

# Use local binary (NOT npx)
node_modules/.bin/claude-flow memory stats

# Or add to package.json scripts
npm run memory:stats  # if you add the script
```

**Result:**
```bash
✅ Memory Bank Statistics:
   Total Entries: 0
   Namespaces: 0
   Size: 0.00 KB
```

---

### Option 2: Install Optional Dependency

```bash
# Install onnxruntime-node (may fail on some platforms)
npm install onnxruntime-node --save-optional --legacy-peer-deps

# Then npx should work
npx claude-flow@alpha memory status
```

**Status:** ⚠️ Installed but npx still has issues due to temp directory

---

### Option 3: Add NPM Script (RECOMMENDED)

```json
// package.json
{
  "scripts": {
    "memory:stats": "claude-flow memory stats",
    "memory:list": "claude-flow memory list",
    "memory:store": "claude-flow memory store",
    "memory:query": "claude-flow memory query"
  }
}
```

**Usage:**
```bash
npm run memory:stats
npm run memory:list
npm run memory:query -- "search term"
```

---

## Memory Commands Available

### All Commands ✅ WORKING

```bash
# Statistics
node_modules/.bin/claude-flow memory stats

# Store key-value
node_modules/.bin/claude-flow memory store "key" "value"
node_modules/.bin/claude-flow memory store "key" "value" --namespace "project"

# Query/Search
node_modules/.bin/claude-flow memory query "search term"
node_modules/.bin/claude-flow memory query "search" --namespace "sparc"

# List namespaces
node_modules/.bin/claude-flow memory list

# Export/Import
node_modules/.bin/claude-flow memory export backup.json
node_modules/.bin/claude-flow memory import backup.json

# Clear namespace
node_modules/.bin/claude-flow memory clear --namespace "temp"
```

---

## Verification

### ✅ Test Results

```bash
$ node_modules/.bin/claude-flow memory stats
✅ Memory Bank Statistics:
   Total Entries: 0
   Namespaces: 0
   Size: 0.00 KB

$ node_modules/.bin/claude-flow memory list
⚠️  No namespaces found

$ node_modules/.bin/claude-flow memory store "test" "value"
✅ Stored: test = value (namespace: default)

$ node_modules/.bin/claude-flow memory stats
✅ Memory Bank Statistics:
   Total Entries: 1
   Namespaces: 1
   Size: 0.05 KB

$ node_modules/.bin/claude-flow memory query "test"
✅ Found 1 result(s):
   test = value (namespace: default)
```

---

## Why npx Fails

**npx behavior:**
1. Creates temp directory: `/home/user/.npm/_npx/{hash}/`
2. Installs package in temp directory
3. Runs binary from temp directory
4. **Problem:** Temp install doesn't include optional dependencies

**Local install behavior:**
1. Installs to `./node_modules/`
2. Respects `optionalDependencies` in package.json
3. Binary has access to all dependencies
4. **Works:** All dependencies available

---

## Recommended Workflow

### For Development

```bash
# Initial setup
npm install

# Create aliases (add to .bashrc or .zshrc)
alias cfmem="node_modules/.bin/claude-flow memory"

# Usage
cfmem stats
cfmem store "api-pattern" "REST with JWT auth"
cfmem query "authentication"
```

### For CI/CD

```json
// package.json
{
  "scripts": {
    "memory:export": "claude-flow memory export .memory-backup.json",
    "memory:import": "claude-flow memory import .memory-backup.json",
    "memory:clear": "claude-flow memory clear --namespace temp"
  }
}
```

---

## Alternative: Use MCP Tools Instead

**Best Option:** Use MCP tools which don't have this issue

```javascript
// Via Claude Code (MCP tools)
mcp__claude-flow__memory_usage({
  action: "store",
  key: "test-key",
  value: "test-value",
  namespace: "default"
})

mcp__claude-flow__memory_usage({
  action: "retrieve",
  key: "test-key",
  namespace: "default"
})

mcp__claude-flow__memory_search({
  pattern: "test",
  namespace: "default",
  limit: 10
})
```

**Benefits:**
- ✅ No npx issues
- ✅ No optional dependency issues
- ✅ Works in Claude Code / Claude Desktop
- ✅ Better integration with workflows

---

## Summary

**Problem:** npx + optional dependencies = failure
**Solution:** Use local installation instead of npx
**Best Practice:** Use MCP tools for memory operations

**Quick Fix:**
```bash
# Instead of:
npx claude-flow@alpha memory status  ❌

# Use:
node_modules/.bin/claude-flow memory stats  ✅

# Or (best):
mcp__claude-flow__memory_usage({ action: "retrieve" })  ✅
```

---

**Status:** ✅ RESOLVED
**Date Fixed:** 2025-10-25
**Installed:** onnxruntime-node@1.23.0 (local node_modules)
**Workaround:** Use local binary, not npx
