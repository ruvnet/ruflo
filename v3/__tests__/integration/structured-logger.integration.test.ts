/**
 * Structured Logger Integration Tests
 *
 * Tests the new Phase 4 StructuredLogger: JSON output, correlation IDs, child loggers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StructuredLogger,
  createStructuredLogger,
  withCorrelationId,
} from '../../@claude-flow/integrations/src/mcp/structured-logger.js';

describe('StructuredLogger Integration', () => {
  let captured: string[];
  let logger: StructuredLogger;

  beforeEach(() => {
    captured = [];
    logger = createStructuredLogger({
      level: 'debug',
      serviceName: 'test-service',
      output: (line: string) => captured.push(line),
    });
  });

  it('should emit JSON log lines', () => {
    logger.info('hello world');

    expect(captured).toHaveLength(1);
    const entry = JSON.parse(captured[0]);

    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello world');
    expect(entry.serviceName).toBe('test-service');
    expect(entry.timestamp).toBeDefined();
  });

  it('should include data in log entries', () => {
    logger.info('request', { method: 'GET', path: '/api' });

    const entry = JSON.parse(captured[0]);
    expect(entry.data.method).toBe('GET');
    expect(entry.data.path).toBe('/api');
  });

  it('should filter by log level', () => {
    const warnLogger = createStructuredLogger({
      level: 'warn',
      output: (line: string) => captured.push(line),
    });

    warnLogger.debug('should be filtered');
    warnLogger.info('should be filtered');
    warnLogger.warn('should appear');
    warnLogger.error('should appear');

    expect(captured).toHaveLength(2);
  });

  it('should create child loggers with correlation IDs', () => {
    const child = logger.child('req-123');

    child.info('child message');

    const entry = JSON.parse(captured[0]);
    expect(entry.correlationId).toBe('req-123');
  });

  it('should propagate parent correlation ID to children', () => {
    const parent = logger.child('parent-id');
    const child = parent.child('child-id');

    child.info('nested message');

    const entry = JSON.parse(captured[0]);
    expect(entry.correlationId).toBe('child-id');
    expect(entry.parentCorrelationId).toBe('parent-id');
  });

  it('should gracefully handle non-structured loggers in withCorrelationId', () => {
    const plainLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = withCorrelationId(plainLogger, 'test-id');

    // Should return the original logger unchanged
    expect(result).toBe(plainLogger);
  });

  it('should return a child logger when using withCorrelationId on StructuredLogger', () => {
    const result = withCorrelationId(logger, 'test-id');

    expect(result).not.toBe(logger);
    (result as StructuredLogger).info('with correlation');

    const entry = JSON.parse(captured[0]);
    expect(entry.correlationId).toBe('test-id');
  });

  it('should serialize Error objects cleanly', () => {
    const error = new Error('something broke');
    logger.error('failure', error);

    const entry = JSON.parse(captured[0]);
    expect(entry.data.name).toBe('Error');
    expect(entry.data.message).toBe('something broke');
    expect(entry.data.stack).toBeDefined();
  });
});
