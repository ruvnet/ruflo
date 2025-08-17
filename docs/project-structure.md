# Claude Flow Project Structure

## 📁 Root Directory

The root directory has been cleaned and organized to contain only essential files:

### Configuration Files
- **package.json** - NPM package configuration
- **jest.config.js** - Jest testing configuration
- **tsconfig.json** - TypeScript configuration
- **.gitignore** - Git ignore rules
- **.npmignore** - NPM publish ignore rules
- **docker-compose.yml** - Docker configuration

### Core Files
- **README.md** - Main project documentation
- **LICENSE** - MIT license
- **CHANGELOG.md** - Version history
- **CLAUDE.md** - Claude Code integration instructions (required in root)
- **cli.js** - Main CLI entry point
- **claude-flow** - Executable wrapper script
- **start-web-ui.js** - WebUI launcher

## 📚 Documentation Structure (docs/)

All documentation has been organized into logical categories:

```
docs/
├── api/
│   └── api-reference.md
├── deployment/
│   └── docker.md
├── development/
│   └── implementation-summary.md
├── integrations/
│   └── github.md
├── technical/
│   ├── mcp-integration-summary.md
│   ├── neural-patterns.md
│   └── webui-implementation.md
├── testing/
│   ├── mcp-qa-report.md
│   ├── qa-final-report.md
│   ├── testing-guide.md
│   └── validation-report.md
├── troubleshooting/
│   └── corrected-usage.md
├── migration-guide.md
├── project-structure.md (this file)
├── setup.md
├── troubleshooting.md
├── usage-guide.md
└── webui-instructions.md
```

## 🧪 Test Structure (tests/)

All tests have been consolidated into a single organized structure:

```
tests/
├── unit/            # Unit tests for individual components
├── integration/     # Integration tests for component interactions
├── e2e/            # End-to-end tests for complete workflows
├── performance/    # Performance and load tests
├── manual/         # Manual test scenarios
│   ├── cli-tests/
│   ├── init-tests/
│   └── tool-tests/
├── scripts/        # Test automation scripts
├── fixtures/       # Test data and fixtures
├── mocks/         # Mock objects and services
├── utils/         # Test utilities and helpers
└── results/       # Test execution results
```

## 🗂️ Other Key Directories

- **src/** - Source code
- **dist/** - Build output
- **flow-2-init/** - Claude Flow v2 initialization templates
- **.claude/** - Claude Code configuration
- **.roo/** - MCP configuration
- **scripts/** - Utility scripts
- **assets/** - Static assets
- **examples/** - Usage examples

## 🎯 Benefits of This Structure

1. **Clean Root** - Only essential files in root directory
2. **Organized Docs** - Easy to find documentation by topic
3. **Unified Tests** - All tests in one place with clear categories
4. **Better Navigation** - Logical grouping makes finding files easier
5. **Easier Maintenance** - Clear structure for contributors

## 📝 Notes for Contributors

- Keep documentation in the appropriate `docs/` subdirectory
- Place all tests in the `tests/` directory using the appropriate category
- Don't add unnecessary files to the root directory
- Use the existing structure when adding new features