/**
 * Advanced TypeScript-aware serializer for session persistence
 * Handles complex data structures, functions, and type preservation
 * 
 * @module advanced-serializer
 */

/**
 * Enhanced serializer that handles TypeScript-specific data types
 * and complex JavaScript objects that standard JSON can't handle
 */
export class AdvancedSerializer {
  constructor(options = {}) {
    this.options = {
      enableCompression: options.enableCompression || false,
      maxDepth: options.maxDepth || 100,
      preserveUndefined: options.preserveUndefined !== false,
      preserveFunctions: options.preserveFunctions || false,
      preserveSymbols: options.preserveSymbols || false,
      customSerializers: new Map(options.customSerializers || []),
      ...options
    };
    
    // Built-in type handlers
    this.typeHandlers = new Map([
      ['Date', this._serializeDate.bind(this)],
      ['Map', this._serializeMap.bind(this)],
      ['Set', this._serializeSet.bind(this)],
      ['RegExp', this._serializeRegExp.bind(this)],
      ['Error', this._serializeError.bind(this)],
      ['BigInt', this._serializeBigInt.bind(this)],
      ['ArrayBuffer', this._serializeArrayBuffer.bind(this)],
      ['TypedArray', this._serializeTypedArray.bind(this)],
      ['Function', this._serializeFunction.bind(this)],
      ['Symbol', this._serializeSymbol.bind(this)]
    ]);

    // Deserialization handlers
    this.deserializers = new Map([
      ['__Date__', this._deserializeDate.bind(this)],
      ['__Map__', this._deserializeMap.bind(this)],
      ['__Set__', this._deserializeSet.bind(this)],
      ['__RegExp__', this._deserializeRegExp.bind(this)],
      ['__Error__', this._deserializeError.bind(this)],
      ['__BigInt__', this._deserializeBigInt.bind(this)],
      ['__ArrayBuffer__', this._deserializeArrayBuffer.bind(this)],
      ['__TypedArray__', this._deserializeTypedArray.bind(this)],
      ['__Function__', this._deserializeFunction.bind(this)],
      ['__Symbol__', this._deserializeSymbol.bind(this)],
      ['__undefined__', () => undefined],
      ['__NaN__', () => NaN],
      ['__Infinity__', () => Infinity],
      ['__-Infinity__', () => -Infinity]
    ]);
  }

  /**
   * Serialize any JavaScript/TypeScript value to a JSON-compatible string
   */
  serialize(value, context = { depth: 0, seen: new WeakSet() }) {
    try {
      const serialized = this._serializeValue(value, context);
      const result = JSON.stringify(serialized);
      
      if (this.options.enableCompression && result.length > 1024) {
        // In production, use actual compression library
        return this._compress(result);
      }
      
      return result;
    } catch (error) {
      throw new SerializationError(`Serialization failed: ${error.message}`, {
        originalError: error,
        value: this._safeStringify(value)
      });
    }
  }

  /**
   * Deserialize a string back to the original JavaScript/TypeScript value
   */
  deserialize(serialized) {
    try {
      let data = serialized;
      
      // Handle compression
      if (this.options.enableCompression && this._isCompressed(serialized)) {
        data = this._decompress(serialized);
      }
      
      const parsed = JSON.parse(data);
      return this._deserializeValue(parsed);
    } catch (error) {
      throw new DeserializationError(`Deserialization failed: ${error.message}`, {
        originalError: error,
        serialized: serialized?.substring?.(0, 200) + '...'
      });
    }
  }

  /**
   * Serialize session-specific data with enhanced TypeScript support
   */
  serializeSessionData(sessionData) {
    const startTime = Date.now();
    
    try {
      // Enhanced session data with metadata
      const enhancedData = {
        ...sessionData,
        __serializer_meta__: {
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          nodeVersion: process.version,
          platform: process.platform,
          serializer: 'AdvancedSerializer'
        }
      };

      const result = this.serialize(enhancedData);
      
      // Log performance metrics
      const duration = Date.now() - startTime;
      if (duration > 100) {
        console.warn(`[AdvancedSerializer] Slow serialization: ${duration}ms for ${result.length} bytes`);
      }
      
      return result;
    } catch (error) {
      throw new SessionSerializationError(`Session serialization failed: ${error.message}`, {
        originalError: error,
        sessionId: sessionData?.id,
        dataKeys: Object.keys(sessionData || {})
      });
    }
  }

  /**
   * Deserialize session data with validation and recovery
   */
  deserializeSessionData(serialized) {
    try {
      const data = this.deserialize(serialized);
      
      // Validate serializer metadata
      if (data.__serializer_meta__) {
        const meta = data.__serializer_meta__;
        if (meta.serializer !== 'AdvancedSerializer') {
          console.warn(`[AdvancedSerializer] Data serialized with different serializer: ${meta.serializer}`);
        }
        
        // Remove metadata before returning
        delete data.__serializer_meta__;
      }
      
      return data;
    } catch (error) {
      // Attempt fallback deserialization
      try {
        console.warn(`[AdvancedSerializer] Attempting fallback deserialization`);
        const fallbackData = JSON.parse(serialized);
        
        // Basic cleanup of common serialization issues
        return this._cleanupFallbackData(fallbackData);
      } catch (fallbackError) {
        throw new SessionDeserializationError(`Session deserialization failed: ${error.message}`, {
          originalError: error,
          fallbackError: fallbackError.message
        });
      }
    }
  }

  /**
   * Internal value serialization with type preservation
   */
  _serializeValue(value, context) {
    // Handle circular references
    if (context.depth > this.options.maxDepth) {
      return { __circular__: true };
    }

    // Handle null and primitives
    if (value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    // Handle special values
    if (value === undefined && this.options.preserveUndefined) {
      return { __type__: '__undefined__' };
    }
    if (typeof value === 'number' && isNaN(value)) {
      return { __type__: '__NaN__' };
    }
    if (value === Infinity) {
      return { __type__: '__Infinity__' };
    }
    if (value === -Infinity) {
      return { __type__: '__-Infinity__' };
    }

    // Handle objects with circular reference detection
    if (typeof value === 'object') {
      if (context.seen.has(value)) {
        return { __circular__: true };
      }
      context.seen.add(value);
    }

    // Handle typed objects
    const typeName = this._getObjectType(value);
    if (this.typeHandlers.has(typeName)) {
      return this.typeHandlers.get(typeName)(value, context);
    }

    // Handle custom serializers
    for (const [matcher, serializer] of this.options.customSerializers) {
      if (typeof matcher === 'function' && matcher(value)) {
        return serializer(value, context);
      }
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map(item => this._serializeValue(item, {
        ...context,
        depth: context.depth + 1
      }));
    }

    // Handle plain objects
    if (value && typeof value === 'object') {
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        // Handle symbol keys if enabled
        if (typeof key === 'symbol' && this.options.preserveSymbols) {
          result[`__symbol_${key.toString()}__`] = this._serializeValue(val, {
            ...context,
            depth: context.depth + 1
          });
        } else if (typeof key === 'string') {
          result[key] = this._serializeValue(val, {
            ...context,
            depth: context.depth + 1
          });
        }
      }
      return result;
    }

    // Handle functions if enabled
    if (typeof value === 'function' && this.options.preserveFunctions) {
      return this._serializeFunction(value, context);
    }

    // Fallback for unknown types
    return { __unknown__: this._safeStringify(value) };
  }

  /**
   * Internal value deserialization
   */
  _deserializeValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(item => this._deserializeValue(item));
    }

    if (value && typeof value === 'object') {
      // Handle special markers
      if (value.__circular__) {
        return '[Circular Reference]';
      }
      
      if (value.__unknown__) {
        return `[Unknown Type: ${value.__unknown__}]`;
      }

      // Handle typed values
      if (value.__type__ && this.deserializers.has(value.__type__)) {
        return this.deserializers.get(value.__type__)(value);
      }

      // Handle regular objects
      const result = {};
      for (const [key, val] of Object.entries(value)) {
        // Handle symbol keys
        if (key.startsWith('__symbol_') && key.endsWith('__')) {
          const symbolKey = Symbol.for(key.slice(9, -2));
          result[symbolKey] = this._deserializeValue(val);
        } else {
          result[key] = this._deserializeValue(val);
        }
      }
      return result;
    }

    return value;
  }

  /**
   * Type-specific serializers
   */
  _serializeDate(date) {
    return {
      __type__: '__Date__',
      value: date.toISOString()
    };
  }

  _serializeMap(map) {
    return {
      __type__: '__Map__',
      entries: Array.from(map.entries()).map(([k, v]) => [
        this._serializeValue(k, { depth: 0, seen: new WeakSet() }),
        this._serializeValue(v, { depth: 0, seen: new WeakSet() })
      ])
    };
  }

  _serializeSet(set) {
    return {
      __type__: '__Set__',
      values: Array.from(set).map(v => this._serializeValue(v, { depth: 0, seen: new WeakSet() }))
    };
  }

  _serializeRegExp(regexp) {
    return {
      __type__: '__RegExp__',
      source: regexp.source,
      flags: regexp.flags
    };
  }

  _serializeError(error) {
    return {
      __type__: '__Error__',
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? this._serializeValue(error.cause, { depth: 0, seen: new WeakSet() }) : undefined
    };
  }

  _serializeBigInt(bigint) {
    return {
      __type__: '__BigInt__',
      value: bigint.toString()
    };
  }

  _serializeArrayBuffer(buffer) {
    return {
      __type__: '__ArrayBuffer__',
      data: Array.from(new Uint8Array(buffer))
    };
  }

  _serializeTypedArray(array) {
    return {
      __type__: '__TypedArray__',
      constructor: array.constructor.name,
      data: Array.from(array)
    };
  }

  _serializeFunction(func) {
    if (!this.options.preserveFunctions) {
      return { __type__: '__Function__', name: func.name || '[Anonymous]' };
    }
    
    return {
      __type__: '__Function__',
      name: func.name,
      source: func.toString(),
      isAsync: func.constructor.name === 'AsyncFunction',
      isGenerator: func.constructor.name === 'GeneratorFunction'
    };
  }

  _serializeSymbol(symbol) {
    return {
      __type__: '__Symbol__',
      description: symbol.description,
      key: Symbol.keyFor(symbol)
    };
  }

  /**
   * Type-specific deserializers
   */
  _deserializeDate(data) {
    return new Date(data.value);
  }

  _deserializeMap(data) {
    const map = new Map();
    for (const [k, v] of data.entries) {
      map.set(this._deserializeValue(k), this._deserializeValue(v));
    }
    return map;
  }

  _deserializeSet(data) {
    return new Set(data.values.map(v => this._deserializeValue(v)));
  }

  _deserializeRegExp(data) {
    return new RegExp(data.source, data.flags);
  }

  _deserializeError(data) {
    const error = new Error(data.message);
    error.name = data.name;
    error.stack = data.stack;
    if (data.cause !== undefined) {
      error.cause = this._deserializeValue(data.cause);
    }
    return error;
  }

  _deserializeBigInt(data) {
    return BigInt(data.value);
  }

  _deserializeArrayBuffer(data) {
    return new Uint8Array(data.data).buffer;
  }

  _deserializeTypedArray(data) {
    const Constructor = globalThis[data.constructor];
    if (!Constructor) {
      throw new Error(`Unknown TypedArray constructor: ${data.constructor}`);
    }
    return new Constructor(data.data);
  }

  _deserializeFunction(data) {
    if (!this.options.preserveFunctions || !data.source) {
      return function restoredFunction() {
        throw new Error(`Function ${data.name} was not preserved during serialization`);
      };
    }

    try {
      // This is potentially unsafe - use with caution in production
      if (data.isAsync) {
        return new Function(`return (${data.source})`)();
      } else if (data.isGenerator) {
        return new Function(`return (${data.source})`)();
      } else {
        return new Function(`return (${data.source})`)();
      }
    } catch (error) {
      console.warn(`Failed to restore function ${data.name}:`, error.message);
      return function restoredFunction() {
        throw new Error(`Function ${data.name} could not be restored: ${error.message}`);
      };
    }
  }

  _deserializeSymbol(data) {
    if (data.key) {
      return Symbol.for(data.key);
    }
    return Symbol(data.description);
  }

  /**
   * Utility methods
   */
  _getObjectType(obj) {
    if (obj instanceof Date) return 'Date';
    if (obj instanceof Map) return 'Map';
    if (obj instanceof Set) return 'Set';
    if (obj instanceof RegExp) return 'RegExp';
    if (obj instanceof Error) return 'Error';
    if (typeof obj === 'bigint') return 'BigInt';
    if (obj instanceof ArrayBuffer) return 'ArrayBuffer';
    if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) return 'TypedArray';
    if (typeof obj === 'function') return 'Function';
    if (typeof obj === 'symbol') return 'Symbol';
    return 'Object';
  }

  _safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[Non-serializable]';
    }
  }

  _cleanupFallbackData(data) {
    // Basic cleanup for common serialization issues
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string') {
          // Try to parse common serialized values
          if (value === 'undefined') {
            data[key] = undefined;
          } else if (value === 'NaN') {
            data[key] = NaN;
          } else if (value === 'Infinity') {
            data[key] = Infinity;
          } else if (value === '-Infinity') {
            data[key] = -Infinity;
          }
        } else if (typeof value === 'object') {
          data[key] = this._cleanupFallbackData(value);
        }
      }
    }
    return data;
  }

  _compress(data) {
    // Placeholder for compression - implement actual compression in production
    return `__compressed__${Buffer.from(data).toString('base64')}`;
  }

  _decompress(data) {
    // Placeholder for decompression
    if (data.startsWith('__compressed__')) {
      return Buffer.from(data.substring(14), 'base64').toString();
    }
    return data;
  }

  _isCompressed(data) {
    return typeof data === 'string' && data.startsWith('__compressed__');
  }
}

/**
 * Custom error classes for better error handling
 */
export class SerializationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SerializationError';
    this.details = details;
  }
}

export class DeserializationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DeserializationError';
    this.details = details;
  }
}

export class SessionSerializationError extends SerializationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'SessionSerializationError';
  }
}

export class SessionDeserializationError extends DeserializationError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = 'SessionDeserializationError';
  }
}

/**
 * Factory function for creating pre-configured serializers
 */
export function createSessionSerializer(options = {}) {
  return new AdvancedSerializer({
    preserveUndefined: true,
    preserveFunctions: false, // Disabled for security
    preserveSymbols: false,
    enableCompression: true,
    maxDepth: 50,
    ...options
  });
}

/**
 * Utility functions for common serialization tasks
 */
export function serializeSessionCheckpoint(checkpointData) {
  const serializer = createSessionSerializer();
  return serializer.serializeSessionData(checkpointData);
}

export function deserializeSessionCheckpoint(serializedData) {
  const serializer = createSessionSerializer();
  return serializer.deserializeSessionData(serializedData);
}

export function serializeSessionMetadata(metadata) {
  const serializer = createSessionSerializer({ maxDepth: 20 });
  return serializer.serialize(metadata);
}

export function deserializeSessionMetadata(serializedMetadata) {
  const serializer = createSessionSerializer({ maxDepth: 20 });
  return serializer.deserialize(serializedMetadata);
}

// Export default instance for convenience
export default new AdvancedSerializer();