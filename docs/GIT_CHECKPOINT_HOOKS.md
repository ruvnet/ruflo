# Git Checkpoint Hooks for Claude

This guide shows how to use Claude's `.claude/settings.json` hooks to create automatic Git checkpoints with detailed summaries that can be easily rolled back.

## Overview

The checkpoint system automatically creates Git commits and tags at key points during Claude's operations:
- **Before editing files** - Preserves the original state
- **After editing files** - Captures the changes made
- **Before creating new files** - Marks the project state
- **At the start of user tasks** - Major checkpoints for each request
- **At session end** - Summary and final checkpoint

## Quick Setup

1. **Copy the example settings file:**
```bash
cp .claude/settings-checkpoint-example.json .claude/settings.json
```

2. **Make the checkpoint manager executable:**
```bash
chmod +x .claude/helpers/checkpoint-manager.sh
```

3. **Initialize Git in your project (if not already):**
```bash
git init
git add .
git commit -m "Initial commit before Claude checkpoints"
```

## Hook Configuration

The checkpoint system uses these hooks in `.claude/settings.json`:

### PreToolUse:Edit
Creates a checkpoint before Claude edits any file:
- Creates a stash of current changes
- Creates a checkpoint branch
- Stores checkpoint metadata in `.claude/checkpoints/`

### PostToolUse:Edit
Creates a checkpoint after Claude edits a file:
- Commits the changes with a detailed message
- Creates a Git tag for easy reference
- Includes diff summary in checkpoint metadata

### UserPromptSubmit
Creates a major checkpoint when you submit a task:
- Commits all current changes
- Can optionally create a GitHub release (set `CREATE_GH_RELEASE=true`)
- Stores task description for reference

### Stop
Creates a session summary when Claude stops:
- Generates a markdown summary of all checkpoints
- Lists all modified files
- Provides rollback instructions
- Creates a final session-end tag

## Using the Checkpoint Manager

The checkpoint manager script (`.claude/helpers/checkpoint-manager.sh`) provides easy checkpoint management:

### List all checkpoints
```bash
./.claude/helpers/checkpoint-manager.sh list
```

### Show checkpoint details
```bash
./.claude/helpers/checkpoint-manager.sh show checkpoint-20240130-143022
```

### Rollback to a checkpoint
```bash
# Soft reset (keeps changes staged)
./.claude/helpers/checkpoint-manager.sh rollback checkpoint-20240130-143022

# Hard reset (discards changes)
./.claude/helpers/checkpoint-manager.sh rollback checkpoint-20240130-143022 --hard

# Create new branch from checkpoint
./.claude/helpers/checkpoint-manager.sh rollback checkpoint-20240130-143022 --branch
```

### View changes since checkpoint
```bash
./.claude/helpers/checkpoint-manager.sh diff checkpoint-20240130-143022
```

### Clean old checkpoints
```bash
./.claude/helpers/checkpoint-manager.sh clean
```

### View session summary
```bash
./.claude/helpers/checkpoint-manager.sh summary
```

## Manual Rollback Methods

If you prefer Git commands directly:

### List checkpoint tags
```bash
git tag -l 'checkpoint-*' | sort -r
```

### Rollback to a checkpoint
```bash
# View what changed
git diff checkpoint-20240130-143022

# Soft reset (keeps changes)
git reset --soft checkpoint-20240130-143022

# Hard reset (discards changes)
git reset --hard checkpoint-20240130-143022

# Create branch from checkpoint
git checkout -b recovery checkpoint-20240130-143022
```

## GitHub Integration

To enable GitHub releases for major checkpoints:

1. **Install GitHub CLI:**
```bash
# macOS
brew install gh

# Linux
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh
```

2. **Authenticate:**
```bash
gh auth login
```

3. **Enable releases in hooks:**
```bash
export CREATE_GH_RELEASE=true
```

## Checkpoint Storage Structure

Checkpoints are stored in multiple ways:

1. **Git Tags**: `checkpoint-YYYYMMDD-HHMMSS`
2. **Git Branches**: `checkpoint/pre-edit-YYYYMMDD-HHMMSS`
3. **Metadata Files**: `.claude/checkpoints/*.json`
4. **Session Summaries**: `.claude/checkpoints/summary-*.md`

## Best Practices

1. **Regular Commits**: The checkpoint system works best with a clean working directory
2. **Meaningful Tasks**: Start each Claude session with a clear task description
3. **Periodic Cleanup**: Run `checkpoint-manager.sh clean` weekly to remove old metadata
4. **Tag Management**: Periodically push important tags to remote: `git push origin --tags`

## Customization

You can customize the checkpoint behavior by modifying the hooks:

### Change checkpoint frequency
Add conditions to check file patterns or sizes

### Add custom metadata
Modify the JSON output to include additional information

### Integration with CI/CD
Add webhook notifications or trigger builds on checkpoints

### Custom naming schemes
Modify the tag/branch naming patterns

## Troubleshooting

### Checkpoints not creating
- Ensure Git is initialized: `git init`
- Check hook permissions: `chmod +x .claude/settings.json`
- Verify jq is installed: `which jq`

### Too many checkpoints
- Adjust hooks to be more selective
- Use the clean command regularly
- Consider disabling pre-edit checkpoints for small changes

### Recovery from bad state
```bash
# Find last known good checkpoint
git reflog
git tag -l 'checkpoint-*' --sort=-creatordate | head -5

# Force recovery
git reset --hard <checkpoint-or-commit>
```

## Example Workflow

1. **Start Claude with a task:**
   ```
   "Please refactor the authentication system"
   ```
   - Creates task checkpoint: `task-20240130-140000`

2. **Claude edits auth.js:**
   - Pre-edit checkpoint: `checkpoint/pre-edit-20240130-140100`
   - Post-edit checkpoint: `checkpoint-20240130-140130`

3. **Claude creates new test file:**
   - Pre-create checkpoint: `checkpoint/pre-create-20240130-140200`

4. **Session ends:**
   - Final checkpoint: `session-end-session-20240130-141000`
   - Summary created with all changes

5. **Need to rollback:**
   ```bash
   ./.claude/helpers/checkpoint-manager.sh list
   ./.claude/helpers/checkpoint-manager.sh rollback checkpoint-20240130-140100 --branch
   ```

This system ensures you can always recover from any changes Claude makes, with full visibility into what was modified and when.