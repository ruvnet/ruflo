/**
 * @claude-flow/mcp - Structured JSON Logger
 *
 * Lightweight structured logger with correlation ID support for MCP server.
 * Outputs JSON lines to a configurable output (default: process.stderr)
 * to avoid interfering with stdio transport on stdout.
 *
 * Zero external dependencies.
 */

import { randomUUID } from 'crypto';
import type { ILogger, LogLevel } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface StructuredLoggerConfig {
  /** Minimum log level to emit. Defaults to 'info'. */
  level?: LogLevel;
  /** Output sink for JSON lines. Defaults to process.stderr.write. */
  output?: (line: string) => void;
  /** Service name included in every log entry. */
  serviceName?: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  parentCorrelationId?: string;
  serviceName?: string;
  data?: unknown;
}

// ============================================================================
// Constants
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_OUTPUT = (line: string): void => {
  process.stderr.write(line + '\n');
};

// ============================================================================
// StructuredLogger
// ============================================================================

export class StructuredLogger implements ILogger {
  private readonly minLevel: number;
  private readonly output: (line: string) => void;
  private readonly serviceName?: string;
  private readonly correlationId?: string;
  private readonly parentCorrelationId?: string;

  constructor(config?: StructuredLoggerConfig);
  constructor(
    config: StructuredLoggerConfig | undefined,
    correlationId: string,
    parentCorrelationId?: string
  );
  constructor(
    config?: StructuredLoggerConfig,
    correlationId?: string,
    parentCorrelationId?: string
  ) {
    this.minLevel = LOG_LEVEL_PRIORITY[config?.level ?? 'info'];
    this.output = config?.output ?? DEFAULT_OUTPUT;
    this.serviceName = config?.serviceName;
    this.correlationId = correlationId;
    this.parentCorrelationId = parentCorrelationId;
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Create a child logger that inherits this logger's correlation ID as its parent
   * and generates a new correlation ID for the child scope.
   */
  child(correlationId?: string): StructuredLogger {
    const childId = correlationId ?? randomUUID();
    return new StructuredLogger(
      {
        level: this.getLevelFromPriority(),
        output: this.output,
        serviceName: this.serviceName,
      },
      childId,
      this.correlationId
    );
  }

  /**
   * Returns the current correlation ID, if set.
   */
  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) {
      return;
    }

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.correlationId !== undefined) {
      entry.correlationId = this.correlationId;
    }

    if (this.parentCorrelationId !== undefined) {
      entry.parentCorrelationId = this.parentCorrelationId;
    }

    if (this.serviceName !== undefined) {
      entry.serviceName = this.serviceName;
    }

    if (data !== undefined) {
      entry.data = this.sanitizeData(data);
    }

    try {
      this.output(JSON.stringify(entry));
    } catch {
      // Fallback for circular references or serialization failures
      const fallback: StructuredLogEntry = {
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
      };
      if (entry.correlationId) fallback.correlationId = entry.correlationId;
      if (entry.serviceName) fallback.serviceName = entry.serviceName;
      fallback.data = '[unserializable]';
      this.output(JSON.stringify(fallback));
    }
  }

  private sanitizeData(data: unknown): unknown {
    if (data instanceof Error) {
      return {
        name: data.name,
        message: data.message,
        stack: data.stack,
      };
    }
    return data;
  }

  private getLevelFromPriority(): LogLevel {
    for (const [level, priority] of Object.entries(LOG_LEVEL_PRIORITY)) {
      if (priority === this.minLevel) {
        return level as LogLevel;
      }
    }
    return 'info';
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new StructuredLogger instance with optional configuration.
 */
export function createStructuredLogger(config?: StructuredLoggerConfig): StructuredLogger {
  return new StructuredLogger(config);
}

// ============================================================================
// Helper
// ============================================================================

/**
 * Returns a child logger with the given correlation ID.
 * If the logger is a StructuredLogger, uses its child() method to inherit context.
 * Otherwise returns the original logger unchanged (graceful degradation).
 */
export function withCorrelationId(
  logger: ILogger,
  correlationId?: string
): ILogger {
  if (logger instanceof StructuredLogger) {
    return logger.child(correlationId);
  }
  return logger;
}
