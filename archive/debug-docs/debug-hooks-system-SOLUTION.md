# Hooks System "require is not defined" Error - SOLUTION

## Problem
The ruv-swarm hooks system was failing with `require is not defined` error when running commands like:
```bash
npx ruv-swarm hook pre-task --description "task"
```

## Root Cause Analysis
The issue was a **CommonJS vs ES Modules compatibility conflict**:

1. **Package Configuration**: The `ruv-swarm` npm package is configured as ES modules with `"type": "module"` in `package.json`
2. **Legacy Code**: The hooks system was still using CommonJS syntax (`require()` and `module.exports`)
3. **Import Conflicts**: ES modules projects cannot use `require()` directly without dynamic imports

## Files Affected
- `/workspaces/ruv-FANN/ruv-swarm/npm/bin/ruv-swarm-clean.js` (lines 756, 765, 800, 828)
- `/workspaces/ruv-FANN/ruv-swarm/npm/src/hooks/cli.js` (lines 8, 22, 76-80)
- `/workspaces/ruv-FANN/ruv-swarm/npm/src/hooks/index.js` (lines 6-12, 1705-1709)

## Solution Implementation

### 1. Fixed Main CLI Binary
**File**: `bin/ruv-swarm-clean.js`

**Before** (CommonJS):
```javascript
async function handleHook(args) {
    const hooksCLI = require('../src/hooks/cli');
    return hooksCLI.main();
}
```

**After** (ES Modules):
```javascript
async function handleHook(args) {
    const { main: hooksCLIMain } = await import('../src/hooks/cli.js');
    return hooksCLIMain();
}
```

### 2. Converted Hooks CLI Module
**File**: `src/hooks/cli.js`

**Before** (CommonJS):
```javascript
const hooks = require('./index');
// ...
module.exports = { main };
```

**After** (ES Modules):
```javascript
import { handleHook } from './index.js';
// ...
export { main };
```

### 3. Converted Hooks Implementation
**File**: `src/hooks/index.js`

**Before** (CommonJS):
```javascript
const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
// ...
module.exports = new RuvSwarmHooks();
```

**After** (ES Modules):
```javascript
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ...
const hooksInstance = new RuvSwarmHooks();
export const handleHook = (hookType, options) => hooksInstance.handleHook(hookType, options);
export default hooksInstance;
```

## Key Changes Made

1. **Dynamic Imports**: Replaced `require()` with `await import()` for ES module compatibility
2. **Import Statements**: Converted all `require()` statements to ES6 `import` statements
3. **Export Statements**: Converted `module.exports` to ES6 `export` statements
4. **Path Handling**: Added proper `__filename` and `__dirname` handling for ES modules
5. **File Extensions**: Added `.js` extensions to relative imports

## Testing & Validation

All hooks now work correctly:

```bash
# Notification hook
npx ruv-swarm hook notification --message "Test hook fix"
✅ Returns: {"continue": true, "notification": {...}, "handled": true}

# Pre-task hook
npx ruv-swarm hook pre-task --description "Debug test" --auto-spawn-agents false
✅ Returns: {"continue": true, "reason": "Task prepared", "metadata": {...}}

# Post-edit hook
npx ruv-swarm hook post-edit --file "test.js" --auto-format true --train-patterns true
✅ Returns: {"continue": true, "formatted": false, "training": {...}}

# Post-task completion
npx ruv-swarm hook post-task --task-id "debug-hooks-system" --analyze-performance true
✅ Returns: {"continue": true, "performance": {...}, "metadata": {...}}
```

## Impact
- ✅ **Fixed**: All hook commands now function correctly
- ✅ **Compatible**: ES modules compliance maintained throughout
- ✅ **Robust**: Error handling preserved in ES module conversion
- ✅ **Performance**: No performance degradation detected

## Future Prevention
To prevent similar issues:

1. **Consistency**: Ensure all new modules use ES syntax when `"type": "module"` is set
2. **Linting**: Add ESLint rules to catch CommonJS syntax in ES module projects
3. **Testing**: Include hook system tests in CI/CD pipeline
4. **Documentation**: Update development guides with ES module requirements

## Technical Notes
- ES modules require explicit file extensions (`.js`) in imports
- `__dirname` and `__filename` are not available by default in ES modules
- Dynamic imports return promises and must be awaited
- Export syntax changes from `module.exports = x` to `export { x }` or `export default x`

---
**Resolution Status**: ✅ COMPLETE  
**Testing Status**: ✅ VERIFIED  
**Documentation**: ✅ UPDATED  