#!/bin/bash

# 🛡️ Claude Flow Innovation Backup Script (Updated for Latest Changes)
# This script creates comprehensive backups of ALL your unique work including latest MCP changes

set -e

echo "🚀 Starting Claude Flow Innovation Backup (Including Latest MCP Changes)..."

# Create timestamp
BACKUP_TIME=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/tmp/claude-flow-backup-$BACKUP_TIME"

echo "📂 Creating backup directory: $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"

# 1. CREATE GIT SAFETY TAGS AND BRANCHES
echo "🏷️ Creating safety tags and branches..."
git add . # Stage all current work including new files
git commit -m "🛡️ Pre-rebase backup commit with latest MCP changes" || echo "Nothing to commit"
git tag "COMPLETE-BACKUP-WITH-MCP-$BACKUP_TIME"
git branch "COMPLETE-BACKUP-$BACKUP_TIME" 2>/dev/null || true

# 2. BACKUP YOUR UNIQUE INNOVATIONS (INCLUDING LATEST)

echo "🧠 Backing up Tool Gating System..."
mkdir -p "$BACKUP_DIR/tool-gating"
# Tool gating implementation
cp -r src/gating/ "$BACKUP_DIR/tool-gating/" 2>/dev/null || echo "No gating dir found"
cp -r src/mcp/proxy/ "$BACKUP_DIR/tool-gating/proxy/" 2>/dev/null || echo "No proxy dir found"
# Tool gating documentation
cp docs/TOOL_GATING.md "$BACKUP_DIR/tool-gating/" 2>/dev/null || echo "No TOOL_GATING.md found"
cp "docs/Tool Gating & Agent Lazy Loading.md" "$BACKUP_DIR/tool-gating/" 2>/dev/null || echo "No combined doc found"
cp docs/tool-gating-proxy-optimization-report.md "$BACKUP_DIR/tool-gating/" 2>/dev/null || echo "No optimization report"

echo "⚡ Backing up MCP System Enhancements..."
mkdir -p "$BACKUP_DIR/mcp-enhancements"
# Complete MCP directory
cp -r src/mcp/ "$BACKUP_DIR/mcp-enhancements/mcp/"
# New MCP configuration and test files
cp MCP_SUCCESS_SUMMARY.md "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
cp QUICK_MCP_SETUP.md "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
cp test-mcp-config.json "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
cp test-mcp-server.mjs "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
cp test-mcp.sh "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
# MCP documentation
cp docs/MCP_CONFIGURATION.md "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true
cp docs/MCP_SERVER_TEST_REPORT.md "$BACKUP_DIR/mcp-enhancements/" 2>/dev/null || true

echo "👥 Backing up Agent Lazy Loading System..."
mkdir -p "$BACKUP_DIR/agent-system"
# Agent profiles and definitions
cp -r .claude/ "$BACKUP_DIR/agent-system/claude/"
cp -r src/agents/ "$BACKUP_DIR/agent-system/src-agents/" 2>/dev/null || echo "No src/agents found"
cp -r memory/agents/ "$BACKUP_DIR/agent-system/memory-agents/" 2>/dev/null || echo "No memory/agents found"

echo "🔄 Backing up Multi-Provider Routing..."
mkdir -p "$BACKUP_DIR/multi-provider"
cp -r src/providers/ "$BACKUP_DIR/multi-provider/providers/" 2>/dev/null || echo "No providers dir found"
cp -r src/consensus/ "$BACKUP_DIR/multi-provider/consensus/" 2>/dev/null || echo "No consensus dir found"
cp docs/multi-provider-routing-strategy.md "$BACKUP_DIR/multi-provider/" 2>/dev/null || echo "No routing strategy doc"
cp docs/multi-provider-usage-examples.md "$BACKUP_DIR/multi-provider/" 2>/dev/null || echo "No usage examples doc"
cp docs/multi-provider-integration-analysis.md "$BACKUP_DIR/multi-provider/" 2>/dev/null || echo "No integration analysis"

echo "📊 Backing up Performance & Metrics..."
mkdir -p "$BACKUP_DIR/performance"
cp -r .claude-flow/ "$BACKUP_DIR/performance/claude-flow/" 2>/dev/null || echo "No .claude-flow dir found"

echo "📚 Backing up Documentation Enhancements..."
mkdir -p "$BACKUP_DIR/documentation"
cp -r docs/ "$BACKUP_DIR/documentation/docs/"
cp WARP.md "$BACKUP_DIR/documentation/" 2>/dev/null || echo "No WARP.md found"
cp CLAUDE.md "$BACKUP_DIR/documentation/" 2>/dev/null || echo "No CLAUDE.md found"
cp README.md "$BACKUP_DIR/documentation/" 2>/dev/null || echo "No README.md found"
cp REBASE_STRATEGY.md "$BACKUP_DIR/documentation/" 2>/dev/null || true
# New documentation files
cp docs/PR_CHECKLIST.md "$BACKUP_DIR/documentation/" 2>/dev/null || true
cp docs/PR_SUMMARY.md "$BACKUP_DIR/documentation/" 2>/dev/null || true
cp docs/README_DOCS.md "$BACKUP_DIR/documentation/" 2>/dev/null || true

echo "⚙️ Backing up Configuration & Scripts..."
mkdir -p "$BACKUP_DIR/config"
cp package.json "$BACKUP_DIR/config/"
cp package-lock.json "$BACKUP_DIR/config/" 2>/dev/null || true
cp tsconfig.json "$BACKUP_DIR/config/" 2>/dev/null || true
cp -r scripts/ "$BACKUP_DIR/config/scripts/" 2>/dev/null || true

# 3. CREATE DETAILED INVENTORY
echo "📋 Creating detailed inventory..."
git diff --name-status upstream/main > "$BACKUP_DIR/file_changes_inventory.txt" 2>/dev/null || echo "upstream/main not available"
git log --oneline HEAD~50..HEAD > "$BACKUP_DIR/recent_commits.txt" 2>/dev/null || true
git status --porcelain > "$BACKUP_DIR/current_status.txt"
ls -la > "$BACKUP_DIR/directory_listing.txt"

# List all new untracked files
echo "=== NEW FILES NOT IN UPSTREAM ===" > "$BACKUP_DIR/new_files_inventory.txt"
git ls-files --others --exclude-standard >> "$BACKUP_DIR/new_files_inventory.txt"

# 4. CREATE ENHANCED RESTORATION SCRIPT
cat > "$BACKUP_DIR/RESTORE_INNOVATIONS.sh" << 'EOF'
#!/bin/bash
# 🔄 Innovation Restoration Script (Updated for MCP Changes)

BACKUP_DIR=$(dirname "$0")
TARGET_DIR="$1"

if [ -z "$TARGET_DIR" ]; then
    echo "Usage: $0 <target-claude-flow-directory>"
    exit 1
fi

echo "🔄 Restoring innovations to: $TARGET_DIR"

# Restore MCP enhancements (NEW)
echo "⚡ Restoring MCP System Enhancements..."
cp -r "$BACKUP_DIR/mcp-enhancements/mcp" "$TARGET_DIR/src/" 2>/dev/null || echo "Creating MCP directory"
cp "$BACKUP_DIR/mcp-enhancements/MCP_"*.md "$TARGET_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/mcp-enhancements/QUICK_MCP_SETUP.md" "$TARGET_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/mcp-enhancements/test-mcp"* "$TARGET_DIR/" 2>/dev/null || true
cp "$BACKUP_DIR/mcp-enhancements/"*.md "$TARGET_DIR/docs/" 2>/dev/null || true

# Restore tool gating
echo "🧠 Restoring Tool Gating System..."
cp -r "$BACKUP_DIR/tool-gating/gating" "$TARGET_DIR/src/" 2>/dev/null || true
cp -r "$BACKUP_DIR/tool-gating/proxy" "$TARGET_DIR/src/mcp/" 2>/dev/null || true
cp "$BACKUP_DIR/tool-gating/TOOL_GATING.md" "$TARGET_DIR/docs/" 2>/dev/null || true
cp "$BACKUP_DIR/tool-gating/"*.md "$TARGET_DIR/docs/" 2>/dev/null || true

# Restore agent system  
echo "👥 Restoring Agent System..."
cp -r "$BACKUP_DIR/agent-system/claude" "$TARGET_DIR/.claude" 2>/dev/null || true
cp -r "$BACKUP_DIR/agent-system/src-agents" "$TARGET_DIR/src/agents" 2>/dev/null || true

# Restore multi-provider
echo "🔄 Restoring Multi-Provider System..."
cp -r "$BACKUP_DIR/multi-provider/providers" "$TARGET_DIR/src/providers" 2>/dev/null || true
cp -r "$BACKUP_DIR/multi-provider/consensus" "$TARGET_DIR/src/consensus" 2>/dev/null || true
cp "$BACKUP_DIR/multi-provider/"*.md "$TARGET_DIR/docs/" 2>/dev/null || true

# Restore documentation
echo "📚 Restoring Documentation..."
cp -r "$BACKUP_DIR/documentation/docs/"* "$TARGET_DIR/docs/" 2>/dev/null || true
cp "$BACKUP_DIR/documentation/"*.md "$TARGET_DIR/" 2>/dev/null || true

# Restore configuration
echo "⚙️ Restoring Configuration..."
echo "⚠️  MANUAL STEP: Merge package.json versions carefully"
echo "Current backup package.json saved as package.json.backup"
cp "$BACKUP_DIR/config/package.json" "$TARGET_DIR/package.json.backup" 2>/dev/null || true

echo "✅ Restoration complete!"
echo "📋 Next steps:"
echo "   1. Check package.json.backup and merge versions"
echo "   2. Run npm install"
echo "   3. Test MCP server: ./test-mcp.sh"
EOF

chmod +x "$BACKUP_DIR/RESTORE_INNOVATIONS.sh"

# 5. CREATE UPDATED SUMMARY
cat > "$BACKUP_DIR/BACKUP_SUMMARY.md" << EOF
# 🛡️ Claude Flow Innovation Backup Summary (Updated)

**Backup Created**: $(date)
**Backup Location**: $BACKUP_DIR
**Git Safety Tag**: COMPLETE-BACKUP-WITH-MCP-$BACKUP_TIME
**Git Safety Branch**: COMPLETE-BACKUP-$BACKUP_TIME

## 📦 Backed Up Components

### ⚡ MCP System Enhancements (NEW!)
- Complete MCP directory: \`src/mcp/\`
- MCP configuration: \`test-mcp-config.json\`, \`test-mcp-server.mjs\`
- MCP test scripts: \`test-mcp.sh\`
- MCP documentation: \`MCP_SUCCESS_SUMMARY.md\`, \`QUICK_MCP_SETUP.md\`
- **Innovation**: Enhanced MCP server integration and testing

### 🧠 Tool Gating & Proxy Architecture  
- Source code: \`src/gating/\`, \`src/mcp/proxy/\`
- Documentation: \`docs/TOOL_GATING.md\`
- Optimization reports: \`tool-gating-proxy-optimization-report.md\`
- **Innovation**: Semantic tool discovery, token-based gating

### 👥 Agent Lazy Loading System  
- Agent profiles: \`.claude/agents/\` (62+ definitions)
- Source code: \`src/agents/agent-loader.ts\`, \`src/agents/agent-registry.ts\`
- **Innovation**: On-demand loading, legacy compatibility

### 🔄 Multi-Provider Routing
- Source code: \`src/providers/\`, \`src/consensus/\`
- Documentation: Multi-provider strategy guides
- Integration analysis: \`multi-provider-integration-analysis.md\`
- **Innovation**: Advanced failover, consensus mechanisms

### 📊 Performance & Metrics
- Metrics data: \`.claude-flow/metrics/\`
- **Innovation**: Real-time performance tracking

### 📚 Enhanced Documentation
- Complete \`docs/\` directory with latest improvements
- PR preparation docs: \`PR_CHECKLIST.md\`, \`PR_SUMMARY.md\`
- **Innovation**: Comprehensive technical guides and PR templates

## 🆕 Latest Changes Included
- MCP server enhancements and test scripts
- Updated documentation structure
- Performance metrics updates
- Multi-provider integration improvements
- Tool gating optimization reports

## 🔄 To Restore After Rebase

1. **Quick Restoration**:
   \`\`\`bash
   ./RESTORE_INNOVATIONS.sh /path/to/claude-flow
   \`\`\`

2. **Manual Restoration** (if needed):
   \`\`\`bash
   # Restore MCP enhancements
   cp -r mcp-enhancements/mcp /path/to/claude-flow/src/
   cp mcp-enhancements/*.md /path/to/claude-flow/
   
   # Restore other components...
   \`\`\`

## 🎯 Priority Files to Preserve

**CRITICAL** (Never lose these):
- \`src/mcp/\` directory (with your enhancements)
- \`.claude/agents/\` directory  
- \`src/agents/agent-loader.ts\`
- \`docs/TOOL_GATING.md\`
- \`test-mcp*\` files
- \`MCP_SUCCESS_SUMMARY.md\`, \`QUICK_MCP_SETUP.md\`

**Important** (Merge carefully):
- \`package.json\` (version and script updates)
- Documentation improvements
- Performance enhancements

## 📋 New Files Since Last Backup
$(cat "$BACKUP_DIR/new_files_inventory.txt" | wc -l) new files including:
- MCP configuration and test files
- Enhanced documentation
- Performance reports
- PR preparation materials

EOF

echo ""
echo "✅ UPDATED BACKUP COMPLETE!"
echo "🎯 Backup location: $BACKUP_DIR"
echo "🏷️ Safety tag: COMPLETE-BACKUP-WITH-MCP-$BACKUP_TIME"
echo "🌿 Safety branch: COMPLETE-BACKUP-$BACKUP_TIME"
echo ""
echo "🆕 NEW: MCP enhancements and latest changes included!"
echo "📋 Total files backed up: $(find "$BACKUP_DIR" -type f | wc -l)"
echo ""
echo "🚀 You're now ready to safely rebase to upstream/main!"
echo "💡 If anything goes wrong, restore with: $BACKUP_DIR/RESTORE_INNOVATIONS.sh"