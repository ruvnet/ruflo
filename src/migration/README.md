# Gemini-Flow Migration System

A comprehensive migration system for existing gemini-flow projects to adopt optimized prompts and configurations.

## Overview

The migration system provides tools to:
- Analyze existing projects for migration readiness
- Migrate projects using different strategies (full, selective, merge)
- Create automatic backups for safe rollback
- Validate successful migrations
- Handle edge cases and conflicts gracefully

## Quick Start

```bash
# Analyze your project
npx gemini-flow migrate analyze

# Run migration with dry-run preview
npx gemini-flow migrate --dry-run --verbose

# Migrate with selective strategy (recommended)
npx gemini-flow migrate --strategy selective --preserve-custom

# Rollback if needed
npx gemini-flow migrate rollback
```

## Architecture

### Core Components

1. **MigrationAnalyzer** - Analyzes project structure and detects conflicts
2. **MigrationRunner** - Executes migration strategies
3. **RollbackManager** - Handles backup creation and restoration  
4. **MigrationValidator** - Validates successful migrations
5. **ProgressReporter** - Provides visual feedback during operations

### Migration Strategies

#### Full Strategy
- **Use Case**: New projects or complete overhaul
- **Behavior**: Replaces entire `.claude` folder
- **Risk Level**: High (with backup)
- **Command**: `--strategy full`

#### Selective Strategy  
- **Use Case**: Projects with custom commands (default)
- **Behavior**: Updates core files, preserves customizations
- **Risk Level**: Medium
- **Command**: `--strategy selective --preserve-custom`

#### Merge Strategy
- **Use Case**: Complex projects with custom configurations
- **Behavior**: Merges configurations, preserves custom commands
- **Risk Level**: Low
- **Command**: `--strategy merge`

## CLI Commands

### Analysis Commands

```bash
# Basic analysis
gemini-flow migrate analyze

# Detailed analysis with output file
gemini-flow migrate analyze --detailed --output analysis.json

# Check specific project
gemini-flow migrate analyze /path/to/project
```

### Migration Commands

```bash
# Preview changes (safe)
gemini-flow migrate --dry-run --verbose

# Full migration
gemini-flow migrate --strategy full

# Selective migration (recommended)
gemini-flow migrate --strategy selective --preserve-custom

# Merge migration for complex projects
gemini-flow migrate --strategy merge

# Force migration without prompts
gemini-flow migrate --force

# Skip post-migration validation
gemini-flow migrate --skip-validation
```

### Backup & Rollback Commands

```bash
# List available backups
gemini-flow migrate rollback --list

# Rollback to latest backup
gemini-flow migrate rollback

# Rollback to specific backup
gemini-flow migrate rollback --timestamp 2024-01-01T12:00:00

# Force rollback without confirmation
gemini-flow migrate rollback --force
```

### Validation Commands

```bash
# Validate migration
gemini-flow migrate validate

# Detailed validation report
gemini-flow migrate validate --verbose

# Check project status
gemini-flow migrate status
```

## Configuration

### Migration Manifest

The system uses a manifest file (`migration-manifest.json`) to define:
- File mappings and transformations
- Strategy configurations
- Validation requirements
- Rollback settings

```json
{
  "version": "1.0.0",
  "files": {
    "commands": {
      "sparc.md": {
        "source": ".claude/commands/sparc.md",
        "target": ".claude/commands/sparc.md",
        "transform": "replace",
        "priority": 1
      }
    }
  },
  "strategies": {
    "selective": {
      "preserveCustom": true,
      "backupRequired": true,
      "riskLevel": "medium"
    }
  }
}
```

### Project Configuration

Projects can include migration preferences in `CLAUDE.md`:

```markdown
## Migration Configuration
- strategy: selective
- preserveCustom: true
- customCommands: ['my-command', 'special-workflow']
```

## API Usage

### Programmatic Migration

```typescript
import { MigrationRunner, MigrationAnalyzer } from 'gemini-flow/migration';

// Analyze project
const analyzer = new MigrationAnalyzer();
const analysis = await analyzer.analyze('./my-project');

// Run migration
const runner = new MigrationRunner({
  projectPath: './my-project',
  strategy: 'selective',
  preserveCustom: true,
  dryRun: false
});

const result = await runner.run();
console.log(`Migration ${result.success ? 'succeeded' : 'failed'}`);
```

### Backup Management

```typescript
import { RollbackManager } from 'gemini-flow/migration';

const rollback = new RollbackManager('./my-project');

// Create backup
const backup = await rollback.createBackup({
  type: 'pre-migration',
  description: 'Before optimization update'
});

// List backups
const backups = await rollback.listBackups();

// Rollback
await rollback.rollback(backup.metadata.backupId);
```

## Migration Scenarios

### Scenario 1: Fresh Project Setup

```bash
# For new projects without existing customizations
gemini-flow migrate --strategy full
```

**Result**: Clean installation of all optimized prompts and configurations.

### Scenario 2: Existing Project with Custom Commands

```bash
# Analyze first
gemini-flow migrate analyze --detailed

# Selective migration preserving customizations
gemini-flow migrate --strategy selective --preserve-custom
```

**Result**: Core files updated, custom commands preserved.

### Scenario 3: Complex Project with Configurations

```bash
# Use merge strategy for complex setups
gemini-flow migrate --strategy merge --preserve-custom

# Validate after migration
gemini-flow migrate validate --verbose
```

**Result**: Configurations merged, custom content preserved.

### Scenario 4: Safe Preview Before Migration

```bash
# Preview all changes
gemini-flow migrate --dry-run --verbose

# Run actual migration if satisfied
gemini-flow migrate --strategy selective
```

**Result**: Risk-free preview of all changes before applying.

### Scenario 5: Batch Migration

```bash
# Find and migrate multiple projects
find . -name ".claude" -type d | while read dir; do
  project_path=$(dirname "$dir")
  echo "Migrating $project_path"
  gemini-flow migrate "$project_path" --strategy selective --force
done
```

**Result**: Multiple projects migrated with consistent strategy.

## Risk Management

### Automatic Backups

Every migration creates automatic backups:
- **Location**: `.claude-backup/` directory
- **Format**: Timestamped folders with full file content
- **Retention**: Configurable (default: 30 days, max 10 backups)
- **Validation**: Checksums for integrity verification

### Conflict Detection

The analyzer detects potential conflicts:
- **Custom Commands**: Commands not in standard set
- **Modified Files**: Files with custom modifications
- **Configuration Conflicts**: Incompatible settings
- **Permission Issues**: Read-only files or directories

### Rollback Safety

Multiple rollback options:
- **Automatic**: Failed migrations auto-rollback
- **Manual**: User-initiated rollback to any backup
- **Validation**: Checksum verification during restore
- **Recovery**: Pre-rollback backups for safety

## Troubleshooting

### Common Issues

#### Migration Fails with Permission Errors
```bash
# Check and fix permissions
chmod -R u+w .claude/
gemini-flow migrate --strategy selective
```

#### Custom Commands Not Preserved
```bash
# Use preserve-custom flag
gemini-flow migrate --strategy selective --preserve-custom
```

#### Validation Failures
```bash
# Run detailed validation
gemini-flow migrate validate --verbose

# Check for missing files or corruption
ls -la .claude/commands/
```

#### Rollback Not Working
```bash
# List available backups
gemini-flow migrate rollback --list

# Check backup integrity
cat .claude-backup/*/backup-manifest.json
```

### Debug Mode

Enable detailed logging:
```bash
export DEBUG=true
gemini-flow migrate --verbose
```

### Log Files

Migration logs are stored in:
- **Development**: Console output
- **Production**: `logs/migration.log`

## Advanced Usage

### Custom Migration Scripts

Create custom migration scripts using the API:

```typescript
import { MigrationRunner } from 'gemini-flow/migration';

class CustomMigration extends MigrationRunner {
  async customTransform(content: string): Promise<string> {
    // Apply custom transformations
    return content.replace(/old-pattern/g, 'new-pattern');
  }
}
```

### Extending Validation

Add custom validation rules:

```typescript
import { MigrationValidator } from 'gemini-flow/migration';

class ProjectValidator extends MigrationValidator {
  async validateCustomRules(projectPath: string): Promise<ValidationResult> {
    // Custom validation logic
    return super.validate(projectPath);
  }
}
```

### Integration with CI/CD

Automate migrations in CI/CD pipelines:

```yaml
# .github/workflows/migrate.yml
steps:
  - name: Analyze Migration
    run: gemini-flow migrate analyze --output analysis.json
  
  - name: Run Migration
    run: gemini-flow migrate --strategy selective --force
  
  - name: Validate Migration  
    run: gemini-flow migrate validate
```

## Performance Considerations

### Optimization Tips

1. **Use Selective Strategy**: Faster than full migration
2. **Skip Validation**: Use `--skip-validation` for speed (not recommended for production)
3. **Dry Run First**: Preview changes without file I/O
4. **Batch Operations**: Group multiple small migrations

### Benchmarks

Typical performance metrics:
- **Analysis**: ~100ms for standard project
- **Full Migration**: ~500ms for complete replacement
- **Selective Migration**: ~200ms preserving customizations
- **Validation**: ~150ms for standard checks
- **Backup Creation**: ~100ms for typical project

## Security Considerations

### File Safety

- **Checksums**: All files verified with SHA-256
- **Permissions**: Original permissions preserved
- **Isolation**: Migrations run in project scope only
- **Validation**: Content integrity verified

### Backup Security

- **Local Storage**: Backups stored locally only
- **No Network**: No external dependencies
- **Encryption**: Optional backup encryption available
- **Access Control**: Respects file system permissions

## Contributing

### Development Setup

```bash
# Clone and setup
git clone https://github.com/ruvnet/gemini-flow
cd gemini-flow
npm install

# Run migration tests
npm test src/migration/

# Build migration system
npm run build:migration
```

### Testing

```bash
# Unit tests
npm test src/migration/tests/

# Integration tests  
npm run test:integration

# End-to-end tests
npm run test:e2e
```

### Adding New Features

1. **Analyzers**: Extend `MigrationAnalyzer` for new detection rules
2. **Strategies**: Add new migration strategies to `MigrationRunner`
3. **Validators**: Create custom validation rules in `MigrationValidator`
4. **Transformers**: Add file transformation logic

## License

This migration system is part of gemini-flow and follows the same license terms.

## Support

- **Documentation**: Full API docs available
- **Issues**: Report bugs via GitHub issues
- **Community**: Join discussions in project forums
- **Enterprise**: Commercial support available

---

For more information, see the [main gemini-flow documentation](../../README.md).