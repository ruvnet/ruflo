# Windows Installation Guide for Claude Flow

## Overview

Claude Flow uses SQLite for persistent storage, which requires native bindings that can be challenging to install on Windows. This guide provides multiple solutions to get Claude Flow working on Windows systems.

## Quick Start (Recommended)

The easiest way to use Claude Flow on Windows is with the automatic fallback mode:

```bash
npx -y claude-flow@alpha init
```

This will automatically use in-memory storage if SQLite fails to load. Your data won't persist between sessions, but all features will work.

## Persistent Storage Options

### Option 1: Windows Build Tools (Recommended for Developers)

Install the necessary build tools to compile native modules:

1. **Install Node.js** (version 18 or higher)
   - Download from: https://nodejs.org/

2. **Install Windows Build Tools**
   
   Run PowerShell as Administrator:
   ```powershell
   npm install --global windows-build-tools
   ```
   
   Or install manually:
   - Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - Python 3.x: https://www.python.org/downloads/

3. **Configure npm for Python**
   ```bash
   npm config set python python3
   ```

4. **Install Claude Flow locally**
   ```bash
   npm install claude-flow@alpha
   npx claude-flow init
   ```

### Option 2: Pre-built Binaries

Use pre-built SQLite binaries to avoid compilation:

```bash
# Set npm to use pre-built binaries
npm config set build-from-source false

# Install with pre-built binaries
npm install claude-flow@alpha --build-from-source=false
```

### Option 3: Windows Subsystem for Linux (WSL)

WSL provides a full Linux environment on Windows:

1. **Install WSL**
   
   In PowerShell as Administrator:
   ```powershell
   wsl --install
   ```

2. **Install Node.js in WSL**
   ```bash
   # In WSL terminal
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Use Claude Flow in WSL**
   ```bash
   npx -y claude-flow@alpha init
   ```

### Option 4: Docker

Use Claude Flow in a containerized environment:

1. **Install Docker Desktop for Windows**
   - Download from: https://www.docker.com/products/docker-desktop/

2. **Run Claude Flow in Docker**
   ```bash
   docker run -it node:18 npx -y claude-flow@alpha init
   ```

## Troubleshooting

### Common Errors

#### "Could not locate the bindings file"
This means better-sqlite3 couldn't find or load its native bindings. Solutions:
- Use the automatic fallback (no action needed)
- Install Windows Build Tools (Option 1)
- Use WSL or Docker (Options 3 or 4)

#### "The specified module could not be found"
Windows can't load the SQLite DLL. Solutions:
- Install Visual C++ Redistributables: https://aka.ms/vs/17/release/vc_redist.x64.exe
- Use pre-built binaries (Option 2)

#### Permission Errors
If you get EPERM or access denied errors:
- Run your terminal as Administrator
- Use a different directory (avoid system directories)
- Check antivirus software isn't blocking file creation

### Verifying Installation

Check if SQLite is working:

```javascript
// test-sqlite.js
const Database = require('better-sqlite3');
try {
  const db = new Database(':memory:');
  console.log('✅ SQLite is working!');
  db.close();
} catch (error) {
  console.log('❌ SQLite failed:', error.message);
}
```

Run with: `node test-sqlite.js`

## Performance Considerations

- **In-Memory Mode**: Fastest performance, no persistence
- **SQLite Mode**: Slower operations, full persistence
- **WSL**: Near-native Linux performance
- **Docker**: Slight overhead, consistent environment

## Integration with IDEs

### Visual Studio Code
- Works well with WSL Remote extension
- Native Windows terminal may need build tools

### JetBrains IDEs
- Configure Node.js interpreter correctly
- May need to set npm proxy settings

## Advanced Configuration

### Custom Memory Store Path

Set a custom path for the SQLite database:

```javascript
// .claude/config.json
{
  "memory": {
    "type": "sqlite",
    "path": "C:\\Users\\YourName\\AppData\\Local\\claude-flow\\memory.db"
  }
}
```

### Force In-Memory Mode

Always use in-memory storage:

```javascript
// .claude/config.json
{
  "memory": {
    "type": "in-memory"
  }
}
```

## Security Notes

- Windows Defender may scan SQLite operations
- Some antivirus software blocks native modules
- Add exceptions for `.claude` and `node_modules` directories

## Getting Help

- GitHub Issues: https://github.com/ruvnet/claude-code-flow/issues
- Discord: [Join our community]
- Documentation: https://claude-flow.dev/docs

## Summary

| Method | Persistence | Setup Difficulty | Performance |
|--------|-------------|------------------|-------------|
| Fallback (Default) | ❌ | ⭐ Easy | ⚡ Fast |
| Build Tools | ✅ | ⭐⭐⭐ Hard | ⚡ Fast |
| Pre-built | ✅ | ⭐⭐ Medium | ⚡ Fast |
| WSL | ✅ | ⭐⭐ Medium | ⚡ Fast |
| Docker | ✅ | ⭐⭐ Medium | 🔄 Good |

Choose the method that best fits your needs. For most users, the automatic fallback mode works perfectly for trying out Claude Flow.