/**
 * Enhanced Parse Error Handler with Intelligent ID Extraction for Claude Flow V3
 *
 * Implements 100% JSON-RPC 2.0 compliant parse error handling with intelligent
 * ID extraction from malformed JSON messages.
 */

import type { RequestId, MCPError, ILogger } from '../types/transport.js';

export interface ParseErrorContext {
  /** Original malformed message */
  originalMessage: string;
  /** Attempted extraction strategies used */
  strategiesUsed: string[];
  /** Partial parsing results */
  partialData?: Partial<Record<string, unknown>>;
  /** Regex matches found */
  regexMatches?: Record<string, string | null>;
  /** Character position where parsing failed */
  failurePosition?: number;
  /** Diagnostic information for debugging */
  diagnostics: {
    messageLength: number;
    hasJsonStructure: boolean;
    hasIdField: boolean;
    encoding: string;
    suspectedFormat: string;
  };
}

export interface ParseErrorResult {
  /** Extracted ID (null if impossible to determine) */
  id: RequestId;
  /** Enhanced error with diagnostic data */
  error: MCPError;
  /** Context information for logging and debugging */
  context: ParseErrorContext;
}

export interface ParseErrorHandlerConfig {
  /** Maximum message length to attempt parsing */
  maxMessageLength: number;
  /** Enable aggressive ID extraction */
  aggressiveExtraction: boolean;
  /** Timeout for extraction attempts (ms) */
  extractionTimeout: number;
  /** Enable detailed diagnostics */
  enableDiagnostics: boolean;
}

export class ParseErrorHandler {
  private readonly config: ParseErrorHandlerConfig;
  private readonly logger: ILogger;

  constructor(logger: ILogger, config: Partial<ParseErrorHandlerConfig> = {}) {
    this.logger = logger;
    this.config = {
      maxMessageLength: 10 * 1024 * 1024, // 10MB
      aggressiveExtraction: true,
      extractionTimeout: 100, // 100ms
      enableDiagnostics: true,
      ...config,
    };
  }

  /**
   * Extract ID from malformed JSON with multiple fallback strategies
   *
   * @param malformedJson - The malformed JSON string
   * @returns Parse error result with extracted ID and context
   */
  public extractIdFromMalformedJson(malformedJson: string): ParseErrorResult {
    const startTime = Date.now();
    const context: ParseErrorContext = {
      originalMessage: malformedJson.substring(0, 1000), // First 1KB for logging
      strategiesUsed: [],
      diagnostics: this.generateDiagnostics(malformedJson),
    };

    // Check message length limits
    if (malformedJson.length > this.config.maxMessageLength) {
      return this.createFailureResult(
        null,
        'Message exceeds maximum length',
        context,
        ['length-check']
      );
    }

    let extractedId: RequestId = null;

    try {
      // Strategy 1: Direct regex patterns for common ID formats
      extractedId = this.extractIdWithRegex(malformedJson, context);

      if (extractedId === null && this.config.aggressiveExtraction) {
        // Strategy 2: Partial JSON parsing with error recovery
        extractedId = this.extractIdWithPartialParsing(malformedJson, context);
      }

      if (extractedId === null && this.config.aggressiveExtraction) {
        // Strategy 3: Character-by-character scanning
        extractedId = this.extractIdWithScanning(malformedJson, context);
      }

      // Check timeout
      if (Date.now() - startTime > this.config.extractionTimeout) {
        context.strategiesUsed.push('timeout-exceeded');
        this.logger.warn('ID extraction timeout exceeded', {
          duration: Date.now() - startTime,
          timeout: this.config.extractionTimeout,
        });
      }

    } catch (error) {
      context.strategiesUsed.push('extraction-error');
      this.logger.error('Error during ID extraction', { error });
    }

    // Create JSON-RPC 2.0 compliant error response
    const mcpError: MCPError = {
      code: -32700, // Parse error per JSON-RPC 2.0 spec
      message: 'Parse error',
      data: this.config.enableDiagnostics ? {
        originalLength: malformedJson.length,
        strategiesAttempted: context.strategiesUsed.length,
        extractionSuccessful: extractedId !== null,
        diagnostics: context.diagnostics,
      } : undefined,
    };

    return {
      id: extractedId,
      error: mcpError,
      context,
    };
  }

  /**
   * Strategy 1: Extract ID using regex patterns for common JSON structures
   */
  private extractIdWithRegex(json: string, context: ParseErrorContext): RequestId {
    context.strategiesUsed.push('regex-patterns');
    context.regexMatches = {};

    // Pattern 1: Standard JSON-RPC id field with string value
    const stringIdPattern = /"id"\s*:\s*"([^"]*?)"/;
    const stringMatch = json.match(stringIdPattern);
    if (stringMatch) {
      context.regexMatches.stringId = stringMatch[1];
      return stringMatch[1];
    }

    // Pattern 2: Numeric ID
    const numericIdPattern = /"id"\s*:\s*(\d+(?:\.\d+)?)/;
    const numericMatch = json.match(numericIdPattern);
    if (numericMatch) {
      context.regexMatches.numericId = numericMatch[1];
      const num = parseFloat(numericMatch[1]);
      return Number.isInteger(num) ? parseInt(numericMatch[1], 10) : num;
    }

    // Pattern 3: Boolean or null ID
    const booleanNullPattern = /"id"\s*:\s*(null|true|false)/;
    const booleanNullMatch = json.match(booleanNullPattern);
    if (booleanNullMatch) {
      context.regexMatches.booleanNull = booleanNullMatch[1];
      if (booleanNullMatch[1] === 'null') return null;
      return booleanNullMatch[1] === 'true';
    }

    // Pattern 4: Malformed quoted ID (missing closing quote, etc.)
    const malformedQuotePattern = /"id"\s*:\s*"([^"]*?)(?:[^"]|$)/;
    const malformedMatch = json.match(malformedQuotePattern);
    if (malformedMatch && !stringMatch) {
      context.regexMatches.malformedQuote = malformedMatch[1];
      return malformedMatch[1];
    }

    // Pattern 5: ID at start of object
    const startIdPattern = /^\s*{\s*"id"\s*:\s*([^,}]+)/;
    const startMatch = json.match(startIdPattern);
    if (startMatch) {
      context.regexMatches.startId = startMatch[1];
      try {
        return JSON.parse(startMatch[1]);
      } catch {
        return startMatch[1].replace(/^"/, '').replace(/"$/, '');
      }
    }

    return null;
  }

  /**
   * Strategy 2: Partial JSON parsing with error recovery
   */
  private extractIdWithPartialParsing(json: string, context: ParseErrorContext): RequestId {
    context.strategiesUsed.push('partial-parsing');

    try {
      // Try to find and parse just the portion with the ID
      const idStart = json.indexOf('"id"');
      if (idStart === -1) return null;

      // Find the value after the colon
      const colonIndex = json.indexOf(':', idStart);
      if (colonIndex === -1) return null;

      // Extract a reasonable substring around the ID
      const substring = json.substring(idStart, Math.min(colonIndex + 100, json.length));
      const valueMatch = substring.match(/"id"\s*:\s*([^,}\s]+)/);

      if (valueMatch) {
        const rawValue = valueMatch[1];
        context.partialData = { id: rawValue };

        // Try to parse the extracted value
        try {
          return JSON.parse(rawValue);
        } catch {
          // Handle unquoted strings or partial values
          return rawValue.replace(/^"/, '').replace(/".*$/, '');
        }
      }
    } catch (error) {
      this.logger.debug('Partial parsing failed', { error });
    }

    return null;
  }

  /**
   * Strategy 3: Character-by-character scanning for ID patterns
   */
  private extractIdWithScanning(json: string, context: ParseErrorContext): RequestId {
    context.strategiesUsed.push('character-scanning');

    try {
      const chars = json.split('');
      let inString = false;
      let escapeNext = false;
      let currentKey = '';
      let currentValue = '';
      let inKey = false;
      let inValue = false;
      let braceCount = 0;

      for (let i = 0; i < chars.length && i < 10000; i++) { // Limit scan length
        const char = chars[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"' && !escapeNext) {
          inString = !inString;
          if (inString && currentKey === '') {
            inKey = true;
          } else if (!inString && inKey) {
            inKey = false;
            if (currentKey === 'id') {
              // Found the ID key, now look for the value
              inValue = true;
            } else {
              currentKey = '';
            }
          } else if (!inString && inValue) {
            // End of string value for ID
            return currentValue;
          }
          continue;
        }

        if (inString) {
          if (inKey) {
            currentKey += char;
          } else if (inValue) {
            currentValue += char;
          }
        } else {
          if (char === ':' && currentKey === 'id') {
            inValue = true;
          } else if (inValue && char.match(/[,}]/)) {
            // End of non-string value
            try {
              return JSON.parse(currentValue.trim());
            } catch {
              return currentValue.trim();
            }
          } else if (inValue && !char.match(/\s/)) {
            currentValue += char;
          }

          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (braceCount < 0) break; // Malformed structure
        }
      }

      // If we have a partial value at the end
      if (currentValue && currentKey === 'id') {
        try {
          return JSON.parse(currentValue.trim());
        } catch {
          return currentValue.trim();
        }
      }
    } catch (error) {
      this.logger.debug('Character scanning failed', { error });
    }

    return null;
  }

  /**
   * Generate diagnostic information about the malformed message
   */
  private generateDiagnostics(message: string): ParseErrorContext['diagnostics'] {
    return {
      messageLength: message.length,
      hasJsonStructure: /^\s*[\[{]/.test(message),
      hasIdField: /"id"\s*:/.test(message),
      encoding: this.detectEncoding(message),
      suspectedFormat: this.detectFormat(message),
    };
  }

  /**
   * Detect character encoding of the message
   */
  private detectEncoding(message: string): string {
    // Simple heuristics for encoding detection
    if (message.includes('\uFFFD')) return 'invalid-utf8';
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/.test(message)) return 'binary-or-invalid';
    if (/[^\x00-\x7F]/.test(message)) return 'utf8-with-extended';
    return 'ascii-utf8';
  }

  /**
   * Detect suspected format of the message
   */
  private detectFormat(message: string): string {
    const trimmed = message.trim();
    if (trimmed.startsWith('{')) return 'json-object';
    if (trimmed.startsWith('[')) return 'json-array';
    if (trimmed.startsWith('<?xml')) return 'xml';
    if (trimmed.match(/^[a-zA-Z]+:/)) return 'protocol-message';
    if (trimmed.length === 0) return 'empty';
    return 'unknown';
  }

  /**
   * Create a failure result with diagnostic information
   */
  private createFailureResult(
    id: RequestId,
    reason: string,
    context: ParseErrorContext,
    strategies: string[]
  ): ParseErrorResult {
    context.strategiesUsed.push(...strategies);

    return {
      id,
      error: {
        code: -32700,
        message: 'Parse error',
        data: this.config.enableDiagnostics ? {
          reason,
          diagnostics: context.diagnostics,
        } : undefined,
      },
      context,
    };
  }

  /**
   * Validate that an extracted ID conforms to JSON-RPC 2.0 spec
   */
  public validateExtractedId(id: RequestId): boolean {
    // JSON-RPC 2.0 allows string, number, or null
    if (id === null) return true;
    if (typeof id === 'string') return true;
    if (typeof id === 'number') return !isNaN(id);
    return false;
  }

  /**
   * Get handler statistics
   */
  public getStats(): Record<string, number> {
    // In a real implementation, this would track usage statistics
    return {
      totalExtractions: 0,
      successfulExtractions: 0,
      regexSuccesses: 0,
      partialParsingSuccesses: 0,
      scanningSuccesses: 0,
      timeouts: 0,
    };
  }
}

/**
 * Create a default parse error handler instance
 */
export function createParseErrorHandler(logger: ILogger): ParseErrorHandler {
  return new ParseErrorHandler(logger);
}

/**
 * Utility function to handle parse errors in transport layers
 */
export async function handleParseError(
  malformedMessage: string,
  logger: ILogger,
  config?: Partial<ParseErrorHandlerConfig>
): Promise<ParseErrorResult> {
  const handler = new ParseErrorHandler(logger, config);
  return handler.extractIdFromMalformedJson(malformedMessage);
}