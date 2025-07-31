/**
 * Simple jscodeshift transform to add basic TypeScript annotations
 */

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Add type imports at the top
  function addTypeImports() {
    const typeImports = [
      "import type { ILogger } from '../../core/logger.js';",
      "import type { IEventBus } from '../../core/event-bus.js';",
      "import type { AgentCapability, TaskSubmitOptions } from '../../hive-mind/types.js';"
    ];

    // Find the first import statement
    const firstImport = root.find(j.ImportDeclaration).at(0);
    if (firstImport.length > 0) {
      // Add type imports after the existing imports
      const lastImport = root.find(j.ImportDeclaration).at(-1);
      lastImport.forEach(path => {
        typeImports.forEach(importStr => {
          const parsed = j(importStr).find(j.ImportDeclaration).at(0).get().value;
          path.insertAfter(parsed);
        });
      });
    }
  }

  // Add interface definitions
  function addInterfaces() {
    const interfaceDefinitions = `
interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: number;
  memoryUsage?: number;
  error?: string;
}

interface MaestroConfig {
  enablePerformanceMonitoring?: boolean;
  initializationTimeout?: number;
  cacheEnabled?: boolean;
  logLevel?: string;
  enableSwarmCoordination?: boolean;
  enableConsensusValidation?: boolean;
}
`;

    // Add interfaces after imports
    const lastImport = root.find(j.ImportDeclaration).at(-1);
    if (lastImport.length > 0) {
      lastImport.forEach(path => {
        // Insert the interfaces as raw text
        path.insertAfter(`\n${interfaceDefinitions}\n`);
      });
    }
  }

  // Add type annotations to variables where obvious
  function addBasicTypes() {
    // Find variable declarations with obvious types
    root.find(j.VariableDeclarator).forEach(path => {
      const { id, init } = path.value;
      
      if (id.type === 'Identifier' && init) {
        // Add comments with type hints for now (easier than AST manipulation)
        if (init.type === 'ArrayExpression') {
          path.value.id.name = `${id.name}: any[]`;
        } else if (init.type === 'ObjectExpression') {
          path.value.id.name = `${id.name}: Record<string, any>`;
        } else if (init.type === 'Literal') {
          if (typeof init.value === 'boolean') {
            path.value.id.name = `${id.name}: boolean`;
          } else if (typeof init.value === 'string') {
            path.value.id.name = `${id.name}: string`;
          } else if (typeof init.value === 'number') {
            path.value.id.name = `${id.name}: number`;
          }
        }
      }
    });
  }

  // Apply simple transformations
  addTypeImports();
  addInterfaces();

  return root.toSource({
    quote: 'single'
  });
};