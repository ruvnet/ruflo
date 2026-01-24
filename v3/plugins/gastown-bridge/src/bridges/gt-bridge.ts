/**
 * Gas Town CLI Bridge
 *
 * Provides a secure wrapper around the `gt` (Gas Town) CLI tool.
 * Implements command execution with proper input sanitization,
 * argument validation, and error handling.
 *
 * Security Features:
 * - All inputs validated with Zod schemas
 * - No shell execution (uses execFile)
 * - Command allowlist enforcement
 * - Argument sanitization
 *
 * @module v3/plugins/gastown-bridge/bridges/gt-bridge
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

import {
  LRUCache,
  BatchDeduplicator,
  Lazy,
} from '../cache.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// Performance Caches
// ============================================================================

/** Result cache for memoizing expensive CLI calls */
const resultCache = new LRUCache<string, GtResult<string>>({
  maxEntries: 200,
  ttlMs: 30 * 1000, // 30 sec TTL (gas prices change frequently)
});

/** Longer cache for static data like tx status */
const staticCache = new LRUCache<string, unknown>({
  maxEntries: 500,
  ttlMs: 5 * 60 * 1000, // 5 min TTL
});

/** Deduplicator for concurrent identical CLI calls */
const execDedup = new BatchDeduplicator<GtResult<string>>();

/** Lazy parsed output cache */
const parsedCache = new LRUCache<string, unknown>({
  maxEntries: 500,
  ttlMs: 60 * 1000, // 1 min TTL
});

/**
 * FNV-1a hash for cache keys
 */
function hashArgs(args: string[]): string {
  let hash = 2166136261;
  for (const arg of args) {
    for (let i = 0; i < arg.length; i++) {
      hash ^= arg.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    hash ^= 0xff; // separator
  }
  return hash.toString(36);
}

// ============================================================================
// Zod Validation Schemas
// ============================================================================

/**
 * Safe string pattern - no shell metacharacters
 */
const SafeStringSchema = z.string()
  .max(1024, 'String too long')
  .refine(
    (val) => !/[;&|`$(){}><\n\r\0]/.test(val),
    'String contains shell metacharacters'
  );

/**
 * Safe identifier pattern - alphanumeric with underscore/hyphen
 */
const IdentifierSchema = z.string()
  .min(1, 'Identifier cannot be empty')
  .max(64, 'Identifier too long')
  .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Invalid identifier format');

/**
 * Gas price schema
 */
const GasPriceSchema = z.number()
  .positive('Gas price must be positive')
  .max(1_000_000, 'Gas price exceeds maximum');

/**
 * Gas limit schema
 */
const GasLimitSchema = z.number()
  .int('Gas limit must be an integer')
  .positive('Gas limit must be positive')
  .max(30_000_000, 'Gas limit exceeds maximum');

/**
 * Transaction hash schema (0x prefixed hex)
 */
const TxHashSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash format');

/**
 * Address schema (0x prefixed hex)
 */
const AddressSchema = z.string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format');

/**
 * Network schema
 */
const NetworkSchema = z.enum([
  'mainnet',
  'goerli',
  'sepolia',
  'polygon',
  'arbitrum',
  'optimism',
  'base',
  'local',
]);

/**
 * GT command argument schema
 */
const GtArgumentSchema = z.string()
  .max(512, 'Argument too long')
  .refine(
    (val) => !val.includes('\0'),
    'Argument contains null byte'
  )
  .refine(
    (val) => !/[;&|`$(){}><]/.test(val),
    'Argument contains shell metacharacters'
  );

// ============================================================================
// Types
// ============================================================================

/**
 * Gas Town executor configuration
 */
export interface GtBridgeConfig {
  /**
   * Path to gt executable
   * Default: 'gt' (assumes in PATH)
   */
  gtPath?: string;

  /**
   * Working directory for execution
   */
  cwd?: string;

  /**
   * Execution timeout in milliseconds
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Maximum buffer size for output
   * Default: 10MB
   */
  maxBuffer?: number;

  /**
   * Environment variables
   */
  env?: NodeJS.ProcessEnv;

  /**
   * Default network
   */
  defaultNetwork?: z.infer<typeof NetworkSchema>;
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: number;
  gasPrice: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  estimatedCost: string;
  estimatedCostUsd?: number;
}

/**
 * Transaction status
 */
export interface TxStatus {
  hash: string;
  status: 'pending' | 'confirmed' | 'failed' | 'dropped';
  blockNumber?: number;
  confirmations?: number;
  gasUsed?: number;
  effectiveGasPrice?: string;
  error?: string;
}

/**
 * Network status
 */
export interface NetworkStatus {
  network: string;
  chainId: number;
  blockNumber: number;
  baseFee?: string;
  gasPrice?: string;
  connected: boolean;
}

/**
 * GT execution result
 */
export interface GtResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  command: string;
  args: string[];
  durationMs: number;
}

/**
 * Logger interface
 */
export interface GtLogger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Gas Town bridge error codes
 */
export type GtErrorCode =
  | 'COMMAND_NOT_FOUND'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'INVALID_ARGUMENT'
  | 'INVALID_OUTPUT'
  | 'NETWORK_ERROR'
  | 'VALIDATION_ERROR';

/**
 * Gas Town bridge error
 */
export class GtBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: GtErrorCode,
    public readonly command?: string,
    public readonly args?: string[],
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'GtBridgeError';
  }
}

// ============================================================================
// Default Logger
// ============================================================================

const defaultLogger: GtLogger = {
  debug: (msg, meta) => console.debug(`[gt-bridge] ${msg}`, meta ?? ''),
  info: (msg, meta) => console.info(`[gt-bridge] ${msg}`, meta ?? ''),
  warn: (msg, meta) => console.warn(`[gt-bridge] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[gt-bridge] ${msg}`, meta ?? ''),
};

// ============================================================================
// Allowed Commands
// ============================================================================

/**
 * Allowed gt subcommands (allowlist)
 */
const ALLOWED_GT_COMMANDS = new Set([
  'estimate',
  'status',
  'network',
  'price',
  'tx',
  'simulate',
  'decode',
  'encode',
  'help',
  'version',
  'config',
]);

// ============================================================================
// Gas Town Bridge Implementation
// ============================================================================

/**
 * Gas Town CLI Bridge
 *
 * Secure wrapper around the `gt` CLI tool for gas estimation
 * and transaction management.
 *
 * @example
 * ```typescript
 * const gtBridge = new GtBridge({ gtPath: '/usr/local/bin/gt' });
 * await gtBridge.initialize();
 *
 * const estimate = await gtBridge.estimateGas({
 *   to: '0x...',
 *   data: '0x...',
 *   network: 'mainnet',
 * });
 * ```
 */
export class GtBridge {
  private config: Required<GtBridgeConfig>;
  private logger: GtLogger;
  private initialized = false;

  /** Commands that can be cached (read-only, no side effects) */
  private static readonly CACHEABLE_COMMANDS = new Set([
    'version',
    'status',
    'price',
    'decode',
    'help',
    'config',
  ]);

  /** Commands that should use longer cache (static data) */
  private static readonly STATIC_COMMANDS = new Set([
    'version',
    'help',
    'decode',
  ]);

  constructor(config?: GtBridgeConfig, logger?: GtLogger) {
    this.config = {
      gtPath: config?.gtPath ?? 'gt',
      cwd: config?.cwd ?? process.cwd(),
      timeout: config?.timeout ?? 30000,
      maxBuffer: config?.maxBuffer ?? 10 * 1024 * 1024,
      env: config?.env ?? process.env,
      defaultNetwork: config?.defaultNetwork ?? 'mainnet',
    };
    this.logger = logger ?? defaultLogger;
  }

  /**
   * Initialize the bridge and verify gt is available
   */
  async initialize(): Promise<void> {
    try {
      const result = await this.execGt(['version']);
      if (!result.success) {
        throw new GtBridgeError(
          'Failed to verify gt installation',
          'COMMAND_NOT_FOUND',
          'gt',
          ['version']
        );
      }
      this.initialized = true;
      this.logger.info('Gas Town bridge initialized', {
        gtPath: this.config.gtPath,
        version: result.data,
      });
    } catch (error) {
      if (error instanceof GtBridgeError) throw error;
      throw new GtBridgeError(
        'Failed to initialize Gas Town bridge',
        'COMMAND_NOT_FOUND',
        'gt',
        ['version'],
        error as Error
      );
    }
  }

  /**
   * Execute a gt command with validated arguments
   *
   * @param args - Command arguments (validated and sanitized)
   * @returns Command output
   */
  async execGt(args: string[], skipCache = false): Promise<GtResult<string>> {
    const startTime = Date.now();

    // Validate all arguments
    const validatedArgs = this.validateAndSanitizeArgs(args);

    // Validate subcommand is allowed
    const subcommand = validatedArgs[0];
    if (subcommand && !ALLOWED_GT_COMMANDS.has(subcommand)) {
      throw new GtBridgeError(
        `Command not allowed: ${subcommand}`,
        'INVALID_ARGUMENT',
        'gt',
        validatedArgs
      );
    }

    // Check cache for cacheable commands
    const cacheKey = hashArgs(validatedArgs);
    const isCacheable = !skipCache && subcommand && GtBridge.CACHEABLE_COMMANDS.has(subcommand);
    const isStatic = subcommand && GtBridge.STATIC_COMMANDS.has(subcommand);

    if (isCacheable) {
      const cached = isStatic
        ? staticCache.get(cacheKey) as GtResult<string> | undefined
        : resultCache.get(cacheKey);
      if (cached) {
        this.logger.debug('Cache hit for gt command', { command: subcommand });
        return {
          ...cached,
          durationMs: 0, // Cached result
        };
      }
    }

    // Use deduplication for concurrent identical calls
    return execDedup.dedupe(cacheKey, async () => {
      try {
        this.logger.debug('Executing gt command', {
          command: 'gt',
          args: validatedArgs,
        });

        const { stdout, stderr } = await execFileAsync(
          this.config.gtPath,
          validatedArgs,
          {
            cwd: this.config.cwd,
            env: this.config.env,
            timeout: this.config.timeout,
            maxBuffer: this.config.maxBuffer,
            shell: false, // CRITICAL: Never use shell
            windowsHide: true,
          }
        );

        const durationMs = Date.now() - startTime;

        if (stderr && stderr.trim()) {
          this.logger.warn('gt stderr output', { stderr });
        }

        const result: GtResult<string> = {
          success: true,
          data: stdout.trim(),
          command: 'gt',
          args: validatedArgs,
          durationMs,
        };

        // Cache successful results
        if (isCacheable && result.success) {
          if (isStatic) {
            staticCache.set(cacheKey, result);
          } else {
            resultCache.set(cacheKey, result);
          }
        }

        return result;
      } catch (error: unknown) {
        const durationMs = Date.now() - startTime;
        const err = error as NodeJS.ErrnoException & {
          killed?: boolean;
          stdout?: string;
          stderr?: string;
        };

        if (err.killed) {
          throw new GtBridgeError(
            'Command execution timed out',
            'TIMEOUT',
            'gt',
            validatedArgs
          );
        }

        if (err.code === 'ENOENT') {
          throw new GtBridgeError(
            `gt executable not found at: ${this.config.gtPath}`,
            'COMMAND_NOT_FOUND',
            'gt',
            validatedArgs
          );
        }

        return {
          success: false,
          error: err.stderr || err.message,
          command: 'gt',
          args: validatedArgs,
          durationMs,
        };
      }
    });
  }

  /**
   * Parse JSON output from gt command
   *
   * @param output - Raw command output
   * @returns Parsed JSON object
   */
  parseGtOutput<T>(output: string): T {
    if (!output || output.trim() === '') {
      throw new GtBridgeError(
        'Empty output from gt command',
        'INVALID_OUTPUT'
      );
    }

    try {
      // Try to parse as JSON
      return JSON.parse(output) as T;
    } catch {
      // If not JSON, try to extract JSON from output
      const jsonMatch = output.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          throw new GtBridgeError(
            'Failed to parse gt output as JSON',
            'INVALID_OUTPUT'
          );
        }
      }

      throw new GtBridgeError(
        'Output is not valid JSON',
        'INVALID_OUTPUT'
      );
    }
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(params: {
    to: string;
    data?: string;
    value?: string;
    from?: string;
    network?: z.infer<typeof NetworkSchema>;
  }): Promise<GasEstimate> {
    this.ensureInitialized();

    // Validate parameters
    const validatedTo = AddressSchema.parse(params.to);
    const network = params.network ?? this.config.defaultNetwork;

    const args = ['estimate', '--to', validatedTo, '--network', network, '--json'];

    if (params.data) {
      const validatedData = SafeStringSchema.parse(params.data);
      args.push('--data', validatedData);
    }

    if (params.value) {
      const validatedValue = SafeStringSchema.parse(params.value);
      args.push('--value', validatedValue);
    }

    if (params.from) {
      const validatedFrom = AddressSchema.parse(params.from);
      args.push('--from', validatedFrom);
    }

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Gas estimation failed',
        'EXECUTION_FAILED',
        'gt',
        args
      );
    }

    return this.parseGtOutput<GasEstimate>(result.data);
  }

  /**
   * Get transaction status
   */
  async getTxStatus(txHash: string, network?: z.infer<typeof NetworkSchema>): Promise<TxStatus> {
    this.ensureInitialized();

    const validatedHash = TxHashSchema.parse(txHash);
    const args = [
      'tx',
      'status',
      validatedHash,
      '--network',
      network ?? this.config.defaultNetwork,
      '--json',
    ];

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Failed to get transaction status',
        'EXECUTION_FAILED',
        'gt',
        args
      );
    }

    return this.parseGtOutput<TxStatus>(result.data);
  }

  /**
   * Get network status
   */
  async getNetworkStatus(network?: z.infer<typeof NetworkSchema>): Promise<NetworkStatus> {
    this.ensureInitialized();

    const args = [
      'network',
      'status',
      '--network',
      network ?? this.config.defaultNetwork,
      '--json',
    ];

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Failed to get network status',
        'NETWORK_ERROR',
        'gt',
        args
      );
    }

    return this.parseGtOutput<NetworkStatus>(result.data);
  }

  /**
   * Get current gas price
   */
  async getGasPrice(network?: z.infer<typeof NetworkSchema>): Promise<{
    gasPrice: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    baseFee?: string;
  }> {
    this.ensureInitialized();

    const args = [
      'price',
      '--network',
      network ?? this.config.defaultNetwork,
      '--json',
    ];

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Failed to get gas price',
        'EXECUTION_FAILED',
        'gt',
        args
      );
    }

    return this.parseGtOutput(result.data);
  }

  /**
   * Simulate a transaction
   */
  async simulate(params: {
    to: string;
    data: string;
    value?: string;
    from?: string;
    network?: z.infer<typeof NetworkSchema>;
    blockNumber?: number;
  }): Promise<{
    success: boolean;
    returnData?: string;
    gasUsed?: number;
    logs?: unknown[];
    error?: string;
  }> {
    this.ensureInitialized();

    const validatedTo = AddressSchema.parse(params.to);
    const validatedData = SafeStringSchema.parse(params.data);
    const network = params.network ?? this.config.defaultNetwork;

    const args = [
      'simulate',
      '--to', validatedTo,
      '--data', validatedData,
      '--network', network,
      '--json',
    ];

    if (params.value) {
      args.push('--value', SafeStringSchema.parse(params.value));
    }

    if (params.from) {
      args.push('--from', AddressSchema.parse(params.from));
    }

    if (params.blockNumber !== undefined) {
      args.push('--block', String(params.blockNumber));
    }

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Transaction simulation failed',
        'EXECUTION_FAILED',
        'gt',
        args
      );
    }

    return this.parseGtOutput(result.data);
  }

  /**
   * Decode transaction data
   */
  async decode(data: string, abi?: string): Promise<{
    method: string;
    args: unknown[];
    signature: string;
  }> {
    this.ensureInitialized();

    const validatedData = SafeStringSchema.parse(data);
    const args = ['decode', validatedData, '--json'];

    if (abi) {
      const validatedAbi = SafeStringSchema.parse(abi);
      args.push('--abi', validatedAbi);
    }

    const result = await this.execGt(args);
    if (!result.success || !result.data) {
      throw new GtBridgeError(
        result.error ?? 'Failed to decode transaction data',
        'EXECUTION_FAILED',
        'gt',
        args
      );
    }

    return this.parseGtOutput(result.data);
  }

  /**
   * Validate and sanitize command arguments
   */
  private validateAndSanitizeArgs(args: string[]): string[] {
    return args.map((arg, index) => {
      try {
        return GtArgumentSchema.parse(arg);
      } catch (error) {
        throw new GtBridgeError(
          `Invalid argument at index ${index}: ${arg}`,
          'VALIDATION_ERROR',
          'gt',
          args,
          error as Error
        );
      }
    });
  }

  /**
   * Ensure bridge is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new GtBridgeError(
        'Gas Town bridge not initialized. Call initialize() first.',
        'EXECUTION_FAILED'
      );
    }
  }

  /**
   * Check if bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<Required<GtBridgeConfig>> {
    return { ...this.config };
  }
}

/**
 * Create a new Gas Town bridge instance
 */
export function createGtBridge(config?: GtBridgeConfig, logger?: GtLogger): GtBridge {
  return new GtBridge(config, logger);
}

// Export schemas for external use
export {
  SafeStringSchema,
  IdentifierSchema,
  GasPriceSchema,
  GasLimitSchema,
  TxHashSchema,
  AddressSchema,
  NetworkSchema,
  GtArgumentSchema,
};

export default GtBridge;
