/**
 * jscodeshift transform to migrate JavaScript to TypeScript
 */

const path = require('path');

module.exports = function transformer(file, api) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Add TypeScript types to function parameters
  function addFunctionParameterTypes(functionPath) {
    functionPath.value.params.forEach(param => {
      if (param.type === 'Identifier' && !param.typeAnnotation) {
        // Add basic type annotation based on parameter name patterns
        let type = 'any';
        
        const name = param.name.toLowerCase();
        if (name.includes('config') || name.includes('options')) {
          type = 'any';
        } else if (name.includes('name') || name.includes('id') || name.includes('path') || name.includes('message')) {
          type = 'string';
        } else if (name.includes('count') || name.includes('timeout') || name.includes('size') || name.includes('duration')) {
          type = 'number';
        } else if (name.includes('enabled') || name.includes('flag') || name.includes('success')) {
          type = 'boolean';
        }
        
        param.typeAnnotation = j.typeAnnotation(
          j.tsTypeReference(j.identifier(type))
        );
      }
    });
  }

  // Add return type annotations to functions
  function addFunctionReturnTypes(functionPath) {
    if (!functionPath.value.returnType) {
      const isAsync = functionPath.value.async;
      const returnType = isAsync ? 'Promise<any>' : 'any';
      
      if (isAsync) {
        functionPath.value.returnType = j.typeAnnotation(
          j.tsTypeReference(
            j.tsQualifiedName(j.identifier('Promise'), j.identifier('any'))
          )
        );
      } else {
        functionPath.value.returnType = j.typeAnnotation(
          j.tsTypeReference(j.identifier('any'))
        );
      }
    }
  }

  // Add type annotations to variable declarations
  function addVariableTypes(variablePath) {
    const declarator = variablePath.value;
    if (!declarator.id.typeAnnotation && declarator.init) {
      let type = 'any';
      
      if (declarator.init.type === 'ArrayExpression') {
        type = 'any[]';
      } else if (declarator.init.type === 'ObjectExpression') {
        type = 'Record<string, any>';
      } else if (declarator.init.type === 'Literal') {
        if (typeof declarator.init.value === 'string') {
          type = 'string';
        } else if (typeof declarator.init.value === 'number') {
          type = 'number';
        } else if (typeof declarator.init.value === 'boolean') {
          type = 'boolean';
        }
      } else if (declarator.init.type === 'NewExpression') {
        if (declarator.init.callee.name === 'Map') {
          type = 'Map<string, any>';
        } else if (declarator.init.callee.name === 'Set') {
          type = 'Set<any>';
        } else if (declarator.init.callee.name) {
          type = declarator.init.callee.name;
        }
      }
      
      declarator.id.typeAnnotation = j.typeAnnotation(
        j.tsTypeReference(j.identifier(type))
      );
    }
  }

  // Add interface definitions at the top
  function addInterfaces() {
    const interfaces = [];
    
    // Check if we need performance monitoring interfaces
    const hasPerformanceMonitor = root.find(j.ClassDeclaration, {
      id: { name: 'PerformanceMonitor' }
    }).length > 0;
    
    if (hasPerformanceMonitor) {
      interfaces.push(`
interface PerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: number;
  memoryUsage?: number;
  error?: string;
}
`);
    }
    
    // Check if we need config interfaces
    const hasConfig = root.find(j.Identifier, { name: 'config' }).length > 0;
    if (hasConfig) {
      interfaces.push(`
interface MaestroConfig {
  enablePerformanceMonitoring?: boolean;
  initializationTimeout?: number;
  cacheEnabled?: boolean;
  logLevel?: string;
  enableSwarmCoordination?: boolean;
  enableConsensusValidation?: boolean;
}
`);
    }
    
    if (interfaces.length > 0) {
      // Find the last import statement
      const lastImport = root.find(j.ImportDeclaration).at(-1);
      if (lastImport.length > 0) {
        lastImport.forEach(path => {
          const interfaceNodes = interfaces.map(interfaceStr => 
            j.template.statement([interfaceStr])
          );
          path.insertAfter(interfaceNodes);
        });
      }
    }
  }

  // Transform arrow functions to have types
  root.find(j.ArrowFunctionExpression).forEach(path => {
    addFunctionParameterTypes(path);
    addFunctionReturnTypes(path);
  });

  // Transform function declarations
  root.find(j.FunctionDeclaration).forEach(path => {
    addFunctionParameterTypes(path);
    addFunctionReturnTypes(path);
  });

  // Transform function expressions
  root.find(j.FunctionExpression).forEach(path => {
    addFunctionParameterTypes(path);
    addFunctionReturnTypes(path);
  });

  // Transform class methods
  root.find(j.MethodDefinition).forEach(path => {
    if (path.value.value.type === 'FunctionExpression') {
      addFunctionParameterTypes({ value: path.value.value });
      addFunctionReturnTypes({ value: path.value.value });
    }
  });

  // Transform variable declarations
  root.find(j.VariableDeclarator).forEach(path => {
    addVariableTypes(path);
  });

  // Add class property types
  root.find(j.ClassDeclaration).forEach(classPath => {
    const classBody = classPath.value.body.body;
    
    // Add constructor parameter types
    const constructor = classBody.find(method => 
      method.type === 'MethodDefinition' && 
      method.kind === 'constructor'
    );
    
    if (constructor) {
      addFunctionParameterTypes({ value: constructor.value });
    }
  });

  // Add type imports at the top
  function addTypeImports() {
    const imports = [];
    
    // Check if we need core type imports
    const needsCoreTypes = root.find(j.Identifier, { name: 'createLogger' }).length > 0 ||
                          root.find(j.Identifier, { name: 'createEventBus' }).length > 0;
    
    if (needsCoreTypes) {
      imports.push(`import type { ILogger } from '../../core/logger.js';`);
      imports.push(`import type { IEventBus } from '../../core/event-bus.js';`);
    }
    
    // Check if we need hive mind types
    const needsHiveMindTypes = root.find(j.Identifier, { name: 'MaestroSwarmCoordinator' }).length > 0 ||
                              root.find(j.Identifier, { name: 'SpecsDrivenAgentSelector' }).length > 0;
    
    if (needsHiveMindTypes) {
      imports.push(`import type { AgentCapability, TaskSubmitOptions } from '../../hive-mind/types.js';`);
    }
    
    if (imports.length > 0) {
      const firstImport = root.find(j.ImportDeclaration).at(0);
      if (firstImport.length > 0) {
        firstImport.forEach(path => {
          imports.reverse().forEach(importStr => {
            path.insertAfter(j.template.statement([importStr]));
          });
        });
      }
    }
  }

  // Apply transformations
  addTypeImports();
  addInterfaces();

  return root.toSource({
    quote: 'single',
    trailingComma: true,
  });
};