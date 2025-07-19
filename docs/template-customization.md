# Template Structure and Customization Guide

## Overview

Gemini-Flow uses a modular template system that can be customized for different project types, development workflows, and team preferences. This guide covers the template structure and how to customize it effectively.

## Template Structure

### Core Template Files

```
src/cli/simple-commands/init/templates/
├── gemini-md.js              # GEMINI.md template generation
├── memory-bank-md.js         # Memory system documentation
├── coordination-md.js        # Agent coordination guide
├── readme-files.js          # Helper README templates
└── optimized/               # Optimized template variants
    ├── gemini-md-optimized.js
    ├── sparc-modes-optimized.js
    └── slash-commands-optimized.js
```

### Generated Structure

After initialization, your project will have:

```
your-project/
├── GEMINI.md                 # Main AI instructions
├── memory-bank.md           # Memory system guide
├── coordination.md          # Coordination documentation
├── .roomodes               # SPARC mode definitions
├── .gemini/
│   ├── commands/           # Gemini CLI slash commands
│   │   ├── sparc/         # SPARC-specific commands
│   │   └── ...
│   └── logs/              # Session logs
├── memory/
│   ├── agents/           # Agent-specific memory
│   ├── sessions/         # Session storage
│   └── gemini-flow-data.json
├── coordination/
│   ├── memory_bank/      # Shared memory
│   ├── subtasks/         # Task breakdown
│   └── orchestration/    # Workflow coordination
└── ./gemini-flow         # Local executable wrapper
```

## Template Types

### 1. Standard Template (`--sparc`)

**Best for:** General development projects
**Features:**
- Complete SPARC methodology support
- All 17+ development modes
- Full documentation set
- Standard performance optimizations

```bash
npx gemini-flow init --sparc
```

**Generated GEMINI.md includes:**
- Basic SPARC workflow instructions
- Standard coding guidelines
- General purpose tool configurations
- Standard memory management

### 2. Optimized Template (`--sparc --force`)

**Best for:** Performance-critical projects, production use
**Features:**
- Pre-tuned prompts for faster responses
- Reduced token usage patterns
- Enhanced code quality gates
- Stricter best practices enforcement

```bash
npx gemini-flow init --sparc --force
```

**Enhanced features:**
- Streamlined system prompts (20% fewer tokens)
- Mode-specific performance tuning
- Advanced error handling patterns
- Production-ready configurations

### 3. Minimal Template (`--minimal`)

**Best for:** Simple projects, quick prototypes
**Features:**
- Essential files only
- Basic SPARC support
- Lightweight configuration
- Faster initialization

```bash
npx gemini-flow init --minimal
```

**Minimal set includes:**
- Basic GEMINI.md
- Essential memory structure
- Core slash commands only
- Simplified workflows

## Customization Options

### Project-Specific Templates

#### Web Development Template
```javascript
// Custom template for web projects
export function createWebDevGeminiMd() {
  return `# Gemini CLI Configuration - Web Development

## Project Type: Full-Stack Web Application

### Development Stack
- Frontend: React/Vue/Angular
- Backend: Node.js/Python/Go
- Database: PostgreSQL/MongoDB
- Testing: Jest/Cypress

### SPARC Configuration
- architect: Focus on component design and API architecture
- code: Prioritize responsive design and performance
- tdd: Include unit, integration, and E2E tests
- security-review: Web security best practices (OWASP Top 10)

### Performance Requirements
- Lighthouse score: >90
- Test coverage: >85%
- Bundle size: <250KB gzipped
- API response time: <200ms

...custom instructions...
`;
}
```

#### Mobile App Template
```javascript
export function createMobileAppGeminiMd() {
  return `# Gemini CLI Configuration - Mobile Development

## Project Type: Cross-Platform Mobile App

### Development Stack
- Framework: React Native/Flutter
- State Management: Redux/MobX/Bloc
- Navigation: React Navigation/Flutter Navigation
- Testing: Detox/Flutter Driver

### SPARC Configuration
- architect: Focus on mobile-first design patterns
- code: Platform-specific optimizations
- tdd: Device testing and performance tests
- security-review: Mobile security (data storage, API security)

...mobile-specific instructions...
`;
}
```

### Custom SPARC Modes

#### Domain-Specific Modes
```json
{
  "blockchain-dev": {
    "description": "Blockchain and smart contract development",
    "systemPrompt": "You are a blockchain developer expert. Focus on security, gas optimization, and decentralized patterns...",
    "tools": ["solidity-compiler", "web3-tools", "security-analyzer"],
    "configuration": {
      "securityFocus": "high",
      "auditRequired": true,
      "gasOptimization": true
    }
  },
  "ml-engineer": {
    "description": "Machine learning model development",
    "systemPrompt": "You are an ML engineer. Focus on data quality, model performance, and MLOps practices...",
    "tools": ["jupyter", "tensorboard", "data-analyzer"],
    "configuration": {
      "dataValidation": "strict",
      "modelVersioning": true,
      "reproducibility": "required"
    }
  }
}
```

### Team-Specific Customizations

#### Code Style Enforcement
```markdown
## Coding Standards (Team-Specific)

### Code Style
- Use Prettier with config: .prettierrc.custom
- ESLint rules: extends @company/eslint-config
- TypeScript strict mode required
- Maximum file size: 300 lines

### Git Workflow
- Feature branch strategy
- PR reviews required (2 approvers)
- Conventional commits format
- Automated testing on CI
```

#### Quality Gates
```javascript
// Custom quality thresholds
export const QUALITY_THRESHOLDS = {
  testCoverage: {
    unit: 90,
    integration: 80,
    e2e: 70
  },
  performance: {
    buildTime: 120, // seconds
    bundleSize: 200, // KB
    loadTime: 2000 // ms
  },
  codeQuality: {
    maintainabilityIndex: 85,
    cyclomaticComplexity: 10,
    duplicateLines: 5 // percentage
  }
};
```

## Advanced Customization

### Multi-Template Projects

For complex projects requiring multiple configurations:

```bash
# Initialize base structure
npx gemini-flow init --sparc --force

# Add frontend-specific configuration
npx gemini-flow template add frontend --type react

# Add backend-specific configuration  
npx gemini-flow template add backend --type nodejs-api

# Add mobile configuration
npx gemini-flow template add mobile --type react-native
```

### Template Inheritance

Create template hierarchies:

```javascript
// Base template
export class BaseTemplate {
  constructor(config) {
    this.config = config;
  }
  
  generateGeminiMd() {
    return this.getBaseInstructions() + this.getSpecificInstructions();
  }
}

// Specialized template
export class WebAppTemplate extends BaseTemplate {
  getSpecificInstructions() {
    return `
### Web-Specific Instructions
- Use semantic HTML
- Implement responsive design
- Optimize for accessibility (WCAG 2.1 AA)
    `;
  }
}
```

### Dynamic Template Generation

Generate templates based on project analysis:

```javascript
export function generateDynamicTemplate(projectPath) {
  const packageJson = readPackageJson(projectPath);
  const hasReact = packageJson.dependencies?.react;
  const hasExpress = packageJson.dependencies?.express;
  
  const template = new BaseTemplate();
  
  if (hasReact) {
    template.addFrontendConfig();
  }
  
  if (hasExpress) {
    template.addBackendConfig();
  }
  
  return template.generate();
}
```

## Template Best Practices

### 1. Keep Templates Focused
- One concern per template
- Clear separation of responsibilities
- Avoid feature bloat

### 2. Use Consistent Patterns
- Follow established naming conventions
- Maintain consistent file structure
- Use standard configuration formats

### 3. Include Examples
- Provide working code examples
- Show expected outputs
- Include troubleshooting scenarios

### 4. Version Control Templates
- Track template changes
- Use semantic versioning
- Maintain backward compatibility

### 5. Test Templates
- Validate generated configurations
- Test with real projects
- Automate template testing

## Creating Custom Templates

### Step 1: Define Template Structure
```javascript
// my-custom-template.js
export function createCustomTemplate(options = {}) {
  const {
    projectType = 'generic',
    framework = 'vanilla',
    testingStrategy = 'jest'
  } = options;
  
  return {
    geminiMd: generateGeminiMd(projectType, framework),
    sparcModes: generateSparcModes(testingStrategy),
    slashCommands: generateSlashCommands(framework)
  };
}
```

### Step 2: Register Template
```javascript
// Register in template registry
import { registerTemplate } from './template-registry.js';

registerTemplate('my-custom', {
  name: 'My Custom Template',
  description: 'Template for my specific use case',
  generator: createCustomTemplate,
  options: {
    projectType: ['web', 'api', 'cli'],
    framework: ['react', 'vue', 'angular'],
    testingStrategy: ['jest', 'vitest', 'playwright']
  }
});
```

### Step 3: Use Custom Template
```bash
npx gemini-flow init --template my-custom --project-type web --framework react
```

## Template Validation

### Schema Validation
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "version": { "type": "string" },
    "templates": {
      "type": "object",
      "properties": {
        "geminiMd": { "type": "string" },
        "sparcModes": { "type": "object" },
        "slashCommands": { "type": "array" }
      },
      "required": ["geminiMd", "sparcModes"]
    }
  },
  "required": ["name", "version", "templates"]
}
```

### Automated Testing
```javascript
// Template validation tests
describe('Template Generation', () => {
  test('generates valid GEMINI.md', () => {
    const template = createCustomTemplate();
    expect(template.geminiMd).toContain('# Gemini CLI Configuration');
    expect(template.geminiMd).toContain('## SPARC Development');
  });
  
  test('includes all required SPARC modes', () => {
    const template = createCustomTemplate();
    const requiredModes = ['architect', 'code', 'tdd', 'debug'];
    requiredModes.forEach(mode => {
      expect(template.sparcModes).toHaveProperty(mode);
    });
  });
});
```

## Sharing Templates

### Template Packages
Create npm packages for reusable templates:

```json
{
  "name": "@company/gemini-flow-templates",
  "version": "1.0.0",
  "description": "Company-specific Gemini-Flow templates",
  "main": "index.js",
  "keywords": ["gemini-flow", "templates", "development"],
  "files": ["templates/", "README.md"]
}
```

### Template Registry
Contribute to the community template registry:

```bash
# Submit template for review
npx gemini-flow template submit my-template.js

# Install community template
npx gemini-flow template install @community/react-template
```

## Migration and Updates

### Template Migration
When updating templates:

1. **Backup existing configuration**
2. **Apply new template**
3. **Merge customizations**
4. **Test functionality**
5. **Update documentation**

### Automated Migration
```bash
# Migrate to new template version
npx gemini-flow template migrate --from 1.0 --to 2.0 --preserve-custom
```

## Troubleshooting Templates

### Common Issues

1. **Template not found**
   - Check template name spelling
   - Verify template is installed
   - Update template registry

2. **Generation errors**
   - Validate template syntax
   - Check required parameters
   - Review error logs

3. **Performance issues**
   - Optimize template size
   - Reduce complexity
   - Use lazy loading

### Debug Mode
```bash
# Debug template generation
npx gemini-flow init --template custom --debug --verbose
```

## Contributing Templates

See our [Template Contribution Guide](./contributing-templates.md) for:
- Template development standards
- Testing requirements
- Documentation guidelines
- Submission process

Templates help teams standardize their development workflows and improve consistency across projects. Choose the right template for your needs or create custom ones for specialized requirements.
