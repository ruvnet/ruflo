#!/usr/bin/env node
/**
 * Maestro JavaScript to TypeScript Migration Script
 * 
 * This script converts maestro.js to TypeScript with proper type annotations,
 * interface definitions, and SOLID principle compliance.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const sourceFile = path.join(projectRoot, 'src/cli/simple-commands/maestro.js');
const targetFile = path.join(projectRoot, 'src/cli/simple-commands/maestro.ts');

/**
 * Migration transformations to apply
 */
const transformations = [
  // Add TypeScript header and imports
  {
    pattern: /^(\/\/#!.*?\n)(\/\*\*[\s\S]*?\*\/\n)/,
    replacement: `$1$2
// TypeScript type imports
import type { ILogger } from '../../core/logger.js';
import type { IEventBus } from '../../core/event-bus.js';
import type { IMemoryManager } from '../../hive-mind/core/memory-manager.js';
import type { AgentCapability, TaskSubmitOptions } from '../../hive-mind/types.js';

`
  },

  // Add interface definitions before classes
  {
    pattern: /(\/\/ Performance metrics interface\nexport class PerformanceMonitor)/,
    replacement: `// ===== INTERFACES =====

/**
 * Performance metric entry
 */
interface IPerformanceMetric {
  operation: string;
  duration: number;
  success: boolean;
  timestamp: number;
  memoryUsage: number | null;
  error: string | null;
}

/**
 * Performance monitor interface
 */
interface IPerformanceMonitor {
  recordMetric(operation: string, duration: number, success: boolean, error?: string | null, memoryUsage?: number | null): Promise<void>;
  getMetrics(): IPerformanceMetric[];
  getAveragePerformance(operation: string): { avgDuration: number; successRate: number; totalOperations: number } | null;
}

/**
 * Swarm coordinator interface
 */
interface ISwarmCoordinator {
  submitTask(taskDescription: string, options?: any): Promise<any>;
  spawnSwarm(objective: string, options?: any): Promise<any>;
  getWorkflowState(featureName: string): Promise<any>;
}

/**
 * Maestro configuration interface
 */
interface IMaestroConfig {
  enablePerformanceMonitoring?: boolean;
  initializationTimeout?: number;
  cacheEnabled?: boolean;
  logLevel?: 'info' | 'debug' | 'error';
  enableSwarmCoordination?: boolean;
  enableConsensusValidation?: boolean;
}

/**
 * Task result interface
 */
interface ITaskResult {
  id: string;
  description: string;
  phase: string;
  agents: string[];
  consensus: boolean;
  [key: string]: any;
}

/**
 * Spec result interface
 */
interface ISpecResult {
  featureDir?: string;
  task?: ITaskResult;
  [key: string]: any;
}

// ===== IMPLEMENTATIONS =====

$1`
  },

  // Add type annotations to PerformanceMonitor class
  {
    pattern: /export class PerformanceMonitor {/,
    replacement: 'export class PerformanceMonitor implements IPerformanceMonitor {'
  },

  // Add type annotations to constructor and properties
  {
    pattern: /(constructor\(\) {\s+this\.metrics = \[\];\s+this\.enabled = true;\s+})/,
    replacement: `private metrics: IPerformanceMetric[] = [];
  private enabled: boolean = true;

  constructor() {
    this.metrics = [];
    this.enabled = true;
  }`
  },

  // Add type annotations to recordMetric method
  {
    pattern: /(async recordMetric\(operation, duration, success, error = null, memoryUsage = null\) {)/,
    replacement: 'async recordMetric(operation: string, duration: number, success: boolean, error: string | null = null, memoryUsage: number | null = null): Promise<void> {'
  },

  // Add type annotations to getMetrics method
  {
    pattern: /(getMetrics\(\) {\s+return this\.metrics;\s+})/,
    replacement: 'getMetrics(): IPerformanceMetric[] {\n    return this.metrics;\n  }'
  },

  // Add type annotations to getAveragePerformance method
  {
    pattern: /(getAveragePerformance\(operation\) {)/,
    replacement: 'getAveragePerformance(operation: string): { avgDuration: number; successRate: number; totalOperations: number } | null {'
  },

  // Add type annotations to MaestroUnifiedBridge class
  {
    pattern: /export class MaestroUnifiedBridge extends EventEmitter {/,
    replacement: 'export class MaestroUnifiedBridge extends EventEmitter {'
  },

  // Add type annotations to constructor
  {
    pattern: /(constructor\(config = {}\) {\s+super\(\);)/,
    replacement: `private config: IMaestroConfig;
  private baseDir: string;
  private specsDir: string;
  private steeringDir: string;
  private performanceMonitor: IPerformanceMonitor;
  private swarmCoordinator: ISwarmCoordinator | null = null;
  private initialized: boolean = false;
  private initializationCache: Map<string, any> = new Map();
  private logger: any;

  constructor(config: IMaestroConfig = {}) {
    super();`
  },

  // Add type annotations to methods
  {
    pattern: /(createLogger\(\) {)/,
    replacement: 'createLogger(): any {'
  },

  // Add type annotations to initializeSwarmCoordinator
  {
    pattern: /(async initializeSwarmCoordinator\(\) {)/,
    replacement: 'async initializeSwarmCoordinator(): Promise<ISwarmCoordinator> {'
  },

  // Add type annotations to executeWithSwarmCoordination
  {
    pattern: /(async executeWithSwarmCoordination\(operation, fn, options = {}\) {)/,
    replacement: 'async executeWithSwarmCoordination<T>(operation: string, fn: () => Promise<T>, options: any = {}): Promise<T> {'
  },

  // Add type annotations to file operation methods
  {
    pattern: /(async ensureDirectories\(\) {)/,
    replacement: 'async ensureDirectories(): Promise<void> {'
  },

  {
    pattern: /(async fileExists\(filePath\) {)/,
    replacement: 'async fileExists(filePath: string): Promise<boolean> {'
  },

  // Add type annotations to workflow methods
  {
    pattern: /(async createSpec\(featureName, request, options = {}\) {)/,
    replacement: 'async createSpec(featureName: string, request: string, options: any = {}): Promise<ISpecResult> {'
  },

  {
    pattern: /(async generateDesign\(featureName, options = {}\) {)/,
    replacement: 'async generateDesign(featureName: string, options: any = {}): Promise<ISpecResult | false> {'
  },

  {
    pattern: /(async generateTasks\(featureName, options = {}\) {)/,
    replacement: 'async generateTasks(featureName: string, options: any = {}): Promise<ISpecResult | false> {'
  },

  {
    pattern: /(async implementTask\(featureName, taskId, options = {}\) {)/,
    replacement: 'async implementTask(featureName: string, taskId: string, options: any = {}): Promise<ISpecResult | false> {'
  },

  {
    pattern: /(async showStatus\(featureName, options = {}\) {)/,
    replacement: 'async showStatus(featureName: string, options: any = {}): Promise<any> {'
  },

  {
    pattern: /(async runWorkflow\(featureName, request, options = {}\) {)/,
    replacement: 'async runWorkflow(featureName: string, request: string, options: any = {}): Promise<any> {'
  },

  {
    pattern: /(async initSteering\(domain = 'general', options = {}\) {)/,
    replacement: 'async initSteering(domain: string = \'general\', options: any = {}): Promise<string> {'
  },

  {
    pattern: /(async showHelp\(\) {)/,
    replacement: 'async showHelp(): Promise<void> {'
  },

  // Add type annotations to CLI handler
  {
    pattern: /(export async function maestroUnifiedAction\(args, flags\) {)/,
    replacement: 'export async function maestroUnifiedAction(args: string[], flags?: any): Promise<void> {'
  },

  // Update variable declarations to use const/let appropriately
  {
    pattern: /var (\w+)/g,
    replacement: 'let $1'
  },

  // Add type assertion for chalk usage
  {
    pattern: /(console\.log\(chalk\.(red|green|blue|yellow|cyan|gray|white)\(`)/g,
    replacement: 'console.log(chalk.$2(`'
  }
];

/**
 * Apply transformations to convert JS to TS
 */
async function applyTransformations(content) {
  let transformedContent = content;
  
  for (const transformation of transformations) {
    if (transformation.pattern instanceof RegExp) {
      transformedContent = transformedContent.replace(transformation.pattern, transformation.replacement);
    }
  }
  
  return transformedContent;
}

/**
 * Additional TypeScript-specific fixes
 */
function addTypeScriptFixes(content) {
  // Add proper imports at the top
  const imports = `#!/usr/bin/env node
/**
 * Maestro Unified Bridge - TypeScript Implementation
 * 
 * Migrated from JavaScript with full type safety and SOLID principles.
 * Native hive mind integration with comprehensive type annotations.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

`;

  // Remove old shebang and imports, replace with new ones
  const withoutOldImports = content.replace(/^#!\/usr\/bin\/env node\n[\s\S]*?import \{ fileURLToPath \} from 'url';\n\n/, '');
  
  return imports + withoutOldImports;
}

/**
 * Main migration function
 */
async function migrateMaestroToTypeScript() {
  try {
    console.log('🚀 Starting Maestro JavaScript to TypeScript migration...');
    
    // Read source file
    console.log('📖 Reading source file:', sourceFile);
    const sourceContent = await fs.readFile(sourceFile, 'utf8');
    
    // Apply transformations
    console.log('🔄 Applying TypeScript transformations...');
    let transformedContent = await applyTransformations(sourceContent);
    
    // Apply additional TypeScript fixes
    console.log('🔧 Applying TypeScript-specific fixes...');
    transformedContent = addTypeScriptFixes(transformedContent);
    
    // Write target file
    console.log('💾 Writing TypeScript file:', targetFile);
    await fs.writeFile(targetFile, transformedContent, 'utf8');
    
    console.log('✅ Migration completed successfully!');
    console.log('📊 Migration summary:');
    console.log(`   Source: ${sourceFile} (${sourceContent.length} characters)`);
    console.log(`   Target: ${targetFile} (${transformedContent.length} characters)`);
    console.log('');
    console.log('🔍 Next steps:');
    console.log('   1. Review the generated TypeScript file');
    console.log('   2. Fix any remaining TypeScript compilation errors');
    console.log('   3. Test the migrated implementation');
    console.log('   4. Update imports and references');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateMaestroToTypeScript();
}

export { migrateMaestroToTypeScript };