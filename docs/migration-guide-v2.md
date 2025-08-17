# Claude Flow v2.0.0 Migration Guide

## 🚀 Overview
Claude Flow v2.0.0 introduces significant improvements and integrations with ruv-swarm. This guide helps you migrate from v1.x to v2.0.0.

## 🔄 Breaking Changes

### 1. ES Module Requirements
- All imports now require `.js` extension for TypeScript files
- Module type changed to "module" in package.json

### 2. Command Structure Changes
```bash
# Old (v1.x)
claude-flow init
claude-flow swarm create mesh 5

# New (v2.0.0)
npx claude-flow init --topology=mesh --agents=5
npx ruv-swarm init mesh 5 --claude
```

### 3. Configuration File Format
- Configuration moved from `.claude-flow.json` to `.claude/settings.json`
- New hook-based architecture for automation

## 📦 Installation

### Fresh Installation
```bash
# Global installation
npm install -g claude-flow@2.0.0

# Or use npx (recommended)
npx claude-flow@latest init
```

### Upgrading from v1.x
```bash
# Backup your configuration
cp .claude-flow.json .claude-flow.json.backup

# Upgrade
npm update -g claude-flow

# Migrate configuration
npx claude-flow migrate-config
```

## 🛠️ New Features

### 1. ruv-swarm Integration
- Full swarm orchestration capabilities
- Neural network processing
- Memory persistence across sessions

### 2. Enhanced CLI
```bash
# New wizard mode
npx claude-flow init --wizard

# Preset configurations
npx claude-flow swarm create --preset=development
```

### 3. Automated Hooks
- Pre/post operation hooks
- Automatic formatting
- Performance tracking
- Session management

## 🔧 Configuration Migration

### Old Format (.claude-flow.json)
```json
{
  "swarm": {
    "type": "mesh",
    "agents": 5
  }
}
```

### New Format (.claude/settings.json)
```json
{
  "version": "2.0.0",
  "swarm": {
    "topology": "mesh",
    "maxAgents": 5,
    "strategy": "adaptive"
  },
  "hooks": {
    "pre-task": true,
    "post-edit": true,
    "auto-format": true
  }
}
```

## 🐛 Common Issues & Solutions

### Issue 1: TypeScript Compilation Errors
**Symptom**: "Cannot find module" errors
**Solution**: Add `.js` extension to all relative imports

### Issue 2: MCP Connection Failed
**Symptom**: "Failed to connect to MCP server"
**Solution**: Use stdio mode instead of TCP:
```bash
claude mcp add ruv-swarm npx ruv-swarm mcp start
```

### Issue 3: Swarm Not Initializing
**Symptom**: "Swarm initialization failed"
**Solution**: Ensure ruv-swarm is installed:
```bash
npm install -g ruv-swarm
```

## 📚 Additional Resources
- [Full Documentation](https://github.com/ruvnet/claude-code-flow)
- [ruv-swarm Integration Guide](https://github.com/ruvnet/ruv-FANN/tree/main/ruv-swarm)
- [Support & Issues](https://github.com/ruvnet/claude-code-flow/issues)

## 🆘 Getting Help
- GitHub Issues: Report bugs or request features
- Documentation: Check the docs folder
- Examples: See the examples directory