/**
 * Comprehensive tests for Enhanced Parse Error Handler
 *
 * Tests all ID extraction strategies and edge cases
 */

import { ParseErrorHandler } from './parse-error-handler.js';

// Mock logger for testing
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('ParseErrorHandler', () => {
  let handler: ParseErrorHandler;

  beforeEach(() => {
    handler = new ParseErrorHandler(mockLogger, {
      aggressiveExtraction: true,
      enableDiagnostics: true,
    });
    jest.clearAllMocks();
  });

  describe('extractIdFromMalformedJson', () => {
    it('should extract string ID using regex strategy', () => {
      const malformed = '{"jsonrpc": "2.0", "id": "test-123", "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('test-123');
      expect(result.error.code).toBe(-32700);
      expect(result.context.strategiesUsed).toContain('regex-patterns');
    });

    it('should extract numeric ID using regex strategy', () => {
      const malformed = '{"jsonrpc": "2.0", "id": 42, "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe(42);
      expect(result.error.code).toBe(-32700);
      expect(result.context.strategiesUsed).toContain('regex-patterns');
    });

    it('should extract null ID using regex strategy', () => {
      const malformed = '{"jsonrpc": "2.0", "id": null, "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe(null);
      expect(result.error.code).toBe(-32700);
      expect(result.context.strategiesUsed).toContain('regex-patterns');
    });

    it('should handle malformed quoted ID', () => {
      const malformed = '{"jsonrpc": "2.0", "id": "unclosed-quote, "method": "test"}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('unclosed-quote');
      expect(result.context.strategiesUsed).toContain('regex-patterns');
    });

    it('should use partial parsing when regex fails', () => {
      const malformed = '{broken:"2.0","id":"partial-test","method":"test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('partial-test');
      expect(result.context.strategiesUsed).toContain('partial-parsing');
    });

    it('should use character scanning as fallback', () => {
      const malformed = '{very:"broken",id:scan-test,method:test';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBeDefined();
      expect(result.context.strategiesUsed).toContain('character-scanning');
    });

    it('should return null ID when extraction is impossible', () => {
      const malformed = 'completely broken message with no structure';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe(null);
      expect(result.error.code).toBe(-32700);
      expect(result.error.message).toBe('Parse error');
    });

    it('should include diagnostic information', () => {
      const malformed = '{"id": "diag-test"}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.context.diagnostics).toBeDefined();
      expect(result.context.diagnostics.messageLength).toBe(malformed.length);
      expect(result.context.diagnostics.hasJsonStructure).toBe(true);
      expect(result.context.diagnostics.hasIdField).toBe(true);
      expect(result.context.diagnostics.encoding).toBe('ascii-utf8');
      expect(result.context.diagnostics.suspectedFormat).toBe('json-object');
    });

    it('should handle messages exceeding max length', () => {
      const handler = new ParseErrorHandler(mockLogger, {
        maxMessageLength: 10,
      });

      const longMessage = '{"id": "test"}' + 'x'.repeat(100);
      const result = handler.extractIdFromMalformedJson(longMessage);

      expect(result.id).toBe(null);
      expect(result.context.strategiesUsed).toContain('length-check');
    });

    it('should respect extraction timeout', () => {
      const handler = new ParseErrorHandler(mockLogger, {
        extractionTimeout: 1, // Very short timeout
      });

      const malformed = '{"id": "timeout-test"}' + 'x'.repeat(1000);
      const result = handler.extractIdFromMalformedJson(malformed);

      // Should still extract but may warn about timeout
      expect(result).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'ID extraction timeout exceeded',
        expect.any(Object)
      );
    });

    it('should handle UTF-8 extended characters', () => {
      const malformed = '{"id": "test-üñíçødé"}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.context.diagnostics.encoding).toBe('utf8-with-extended');
    });

    it('should detect different message formats', () => {
      const testCases = [
        { input: '{"id": "json"}', expected: 'json-object' },
        { input: '[{"id": "array"}]', expected: 'json-array' },
        { input: '<?xml version="1.0"?>', expected: 'xml' },
        { input: 'HTTP/1.1 200 OK', expected: 'protocol-message' },
        { input: '', expected: 'empty' },
        { input: 'random text', expected: 'unknown' },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = handler.extractIdFromMalformedJson(input);
        expect(result.context.diagnostics.suspectedFormat).toBe(expected);
      });
    });
  });

  describe('validateExtractedId', () => {
    it('should validate string IDs', () => {
      expect(handler.validateExtractedId('valid-string')).toBe(true);
    });

    it('should validate numeric IDs', () => {
      expect(handler.validateExtractedId(42)).toBe(true);
      expect(handler.validateExtractedId(3.14)).toBe(true);
    });

    it('should validate null ID', () => {
      expect(handler.validateExtractedId(null)).toBe(true);
    });

    it('should reject invalid IDs', () => {
      expect(handler.validateExtractedId(NaN)).toBe(false);
      expect(handler.validateExtractedId(undefined as any)).toBe(false);
      expect(handler.validateExtractedId({} as any)).toBe(false);
    });
  });

  describe('Advanced extraction scenarios', () => {
    it('should handle nested JSON structures', () => {
      const malformed = '{"outer": {"id": "nested-test"}, "id": "main-test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      // Should extract the first (main) ID
      expect(result.id).toBe('main-test');
    });

    it('should handle escaped quotes in ID values', () => {
      const malformed = '{"id": "test-\\"escaped\\""}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('test-"escaped"');
    });

    it('should handle scientific notation in numeric IDs', () => {
      const malformed = '{"id": 1.23e10, "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe(12300000000);
    });

    it('should handle boolean ID values', () => {
      const malformed = '{"id": true, "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe(true);
    });

    it('should handle arrays as ID values gracefully', () => {
      const malformed = '{"id": [1, 2, 3], "method": "test"';
      const result = handler.extractIdFromMalformedJson(malformed);

      // Should attempt to extract but may not handle arrays perfectly
      expect(result.id).toBeDefined();
    });

    it('should handle multiple ID fields (should use first)', () => {
      const malformed = '{"id": "first", "otherId": "second", "id": "third"';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('first');
    });

    it('should handle trailing commas and malformed structure', () => {
      const malformed = '{"jsonrpc": "2.0",, "id": "trailing-comma",, "method": "test",}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.id).toBe('trailing-comma');
    });
  });

  describe('Error reporting and diagnostics', () => {
    it('should include comprehensive error data when diagnostics enabled', () => {
      const malformed = '{"id": "diag-test"}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.error.data).toBeDefined();
      expect(result.error.data.originalLength).toBe(malformed.length);
      expect(result.error.data.strategiesAttempted).toBeGreaterThan(0);
      expect(result.error.data.extractionSuccessful).toBe(true);
      expect(result.error.data.diagnostics).toBeDefined();
    });

    it('should exclude diagnostic data when disabled', () => {
      const handler = new ParseErrorHandler(mockLogger, {
        enableDiagnostics: false,
      });

      const malformed = '{"id": "no-diag"}';
      const result = handler.extractIdFromMalformedJson(malformed);

      expect(result.error.data).toBeUndefined();
    });
  });
});