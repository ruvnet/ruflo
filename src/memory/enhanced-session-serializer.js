/**
 * Enhanced session serializer that extends the HiveMindSessionManager
 * with advanced TypeScript-compatible serialization capabilities
 */

import {
  AdvancedSerializer,
  createSessionSerializer,
  SerializationError,
  DeserializationError
} from './advanced-serializer.js';

/**
 * Session-specific serialization utilities
 */
export class SessionSerializer {
  constructor(options = {}) {
    this.serializer = createSessionSerializer({
      preserveUndefined: true,
      preserveFunctions: false, // Security: never serialize functions in sessions
      preserveSymbols: true,
      enableCompression: options.enableCompression !== false,
      maxDepth: options.maxDepth || 50,
      ...options
    });

    this.compressionThreshold = options.compressionThreshold || 1024; // 1KB
    this.enableValidation = options.enableValidation !== false;
    this.enableMigration = options.enableMigration !== false;
  }

  /**
   * Serialize session data with enhanced TypeScript support
   */
  serializeSessionData(sessionData) {
    try {
      // Pre-process session data for better serialization
      const processedData = this._preprocessSessionData(sessionData);
      
      // Add session metadata for validation and migration
      const enhancedData = {
        ...processedData,
        __session_meta__: {
          version: '2.0.0',
          timestamp: new Date().toISOString(),
          serializer: 'SessionSerializer',
          nodeVersion: process.version,
          platform: process.platform,
          compressionEnabled: this.serializer.options.enableCompression
        }
      };

      return this.serializer.serializeSessionData(enhancedData);
    } catch (error) {
      throw new SerializationError(`Session serialization failed: ${error.message}`, {
        sessionId: sessionData?.id,
        originalError: error
      });
    }
  }

  /**
   * Deserialize session data with validation and migration support
   */
  deserializeSessionData(serializedData, options = {}) {
    try {
      const data = this.serializer.deserializeSessionData(serializedData);
      
      // Handle metadata and validation
      if (data.__session_meta__) {
        const meta = data.__session_meta__;
        
        // Version migration if needed
        if (this.enableMigration && meta.version !== '2.0.0') {
          console.log(`[SessionSerializer] Migrating session data from v${meta.version} to v2.0.0`);
          this._migrateSessionData(data, meta.version);
        }
        
        // Remove metadata
        delete data.__session_meta__;
      }

      // Post-process to restore complex types
      return this._postprocessSessionData(data, options);
    } catch (error) {
      // Attempt fallback deserialization for older formats
      if (options.allowFallback !== false) {
        try {
          console.warn('[SessionSerializer] Attempting fallback deserialization for legacy format');
          return this._deserializeLegacySession(serializedData);
        } catch (fallbackError) {
          console.error('[SessionSerializer] Fallback deserialization also failed:', fallbackError.message);
        }
      }
      
      throw new DeserializationError(`Session deserialization failed: ${error.message}`, {
        originalError: error
      });
    }
  }

  /**
   * Serialize checkpoint data with type preservation
   */
  serializeCheckpointData(checkpointData) {
    try {
      // Enhanced checkpoint with additional metadata
      const enhancedCheckpoint = {
        ...checkpointData,
        __checkpoint_meta__: {
          serializedAt: new Date().toISOString(),
          version: '2.0.0',
          type: 'checkpoint'
        }
      };

      return this.serializer.serialize(enhancedCheckpoint);
    } catch (error) {
      throw new SerializationError(`Checkpoint serialization failed: ${error.message}`, {
        checkpointName: checkpointData?.name,
        originalError: error
      });
    }
  }

  /**
   * Deserialize checkpoint data with type restoration
   */
  deserializeCheckpointData(serializedData) {
    try {
      const data = this.serializer.deserialize(serializedData);
      
      // Remove checkpoint metadata
      if (data.__checkpoint_meta__) {
        delete data.__checkpoint_meta__;
      }
      
      return data;
    } catch (error) {
      // Fallback to basic JSON parsing for legacy checkpoints
      try {
        return JSON.parse(serializedData);
      } catch (fallbackError) {
        throw new DeserializationError(`Checkpoint deserialization failed: ${error.message}`, {
          originalError: error,
          fallbackError: fallbackError.message
        });
      }
    }
  }

  /**
   * Serialize session metadata with complex type support
   */
  serializeMetadata(metadata) {
    try {
      if (!metadata || typeof metadata !== 'object') {
        return JSON.stringify(metadata);
      }

      // Use advanced serializer for complex metadata
      return this.serializer.serialize(metadata);
    } catch (error) {
      console.warn('[SessionSerializer] Metadata serialization failed, using fallback:', error.message);
      return JSON.stringify(this._simplifyMetadata(metadata));
    }
  }

  /**
   * Deserialize session metadata with type restoration
   */
  deserializeMetadata(serializedMetadata) {
    if (!serializedMetadata) return {};
    
    try {
      // Try advanced deserialization first
      return this.serializer.deserialize(serializedMetadata);
    } catch (error) {
      try {
        // Fallback to basic JSON parsing
        return JSON.parse(serializedMetadata);
      } catch (fallbackError) {
        console.warn('[SessionSerializer] Metadata deserialization failed:', error.message);
        return {};
      }
    }
  }

  /**
   * Serialize log data with structured formatting
   */
  serializeLogData(logData) {
    if (!logData) return null;
    
    try {
      // Handle different log data types
      if (typeof logData === 'string') {
        return logData;
      }
      
      // Use advanced serializer for complex log data
      return this.serializer.serialize(logData);
    } catch (error) {
      console.warn('[SessionSerializer] Log data serialization failed:', error.message);
      return JSON.stringify(this._sanitizeLogData(logData));
    }
  }

  /**
   * Deserialize log data with error recovery
   */
  deserializeLogData(serializedLogData) {
    if (!serializedLogData) return null;
    
    try {
      // Try advanced deserialization
      return this.serializer.deserialize(serializedLogData);
    } catch (error) {
      try {
        // Fallback to JSON parsing
        return JSON.parse(serializedLogData);
      } catch (fallbackError) {
        // Return as-is if all parsing fails
        return serializedLogData;
      }
    }
  }

  /**
   * Pre-process session data before serialization
   */
  _preprocessSessionData(sessionData) {
    if (!sessionData || typeof sessionData !== 'object') {
      return sessionData;
    }

    const processed = { ...sessionData };

    // Handle special session fields
    if (processed.created_at && !(processed.created_at instanceof Date)) {
      processed.created_at = new Date(processed.created_at);
    }
    
    if (processed.updated_at && !(processed.updated_at instanceof Date)) {
      processed.updated_at = new Date(processed.updated_at);
    }

    if (processed.paused_at && !(processed.paused_at instanceof Date)) {
      processed.paused_at = new Date(processed.paused_at);
    }

    if (processed.resumed_at && !(processed.resumed_at instanceof Date)) {
      processed.resumed_at = new Date(processed.resumed_at);
    }

    // Handle arrays and complex nested structures
    if (processed.agents && Array.isArray(processed.agents)) {
      processed.agents = processed.agents.map(agent => this._preprocessAgent(agent));
    }

    if (processed.tasks && Array.isArray(processed.tasks)) {
      processed.tasks = processed.tasks.map(task => this._preprocessTask(task));
    }

    if (processed.checkpoints && Array.isArray(processed.checkpoints)) {
      processed.checkpoints = processed.checkpoints.map(checkpoint => this._preprocessCheckpoint(checkpoint));
    }

    return processed;
  }

  /**
   * Post-process session data after deserialization
   */
  _postprocessSessionData(sessionData, options = {}) {
    if (!sessionData || typeof sessionData !== 'object') {
      return sessionData;
    }

    const processed = { ...sessionData };

    // Restore date objects
    const dateFields = ['created_at', 'updated_at', 'paused_at', 'resumed_at'];
    for (const field of dateFields) {
      if (processed[field] && !(processed[field] instanceof Date)) {
        processed[field] = new Date(processed[field]);
      }
    }

    // Post-process nested structures
    if (processed.agents && Array.isArray(processed.agents)) {
      processed.agents = processed.agents.map(agent => this._postprocessAgent(agent));
    }

    if (processed.tasks && Array.isArray(processed.tasks)) {
      processed.tasks = processed.tasks.map(task => this._postprocessTask(task));
    }

    if (processed.checkpoints && Array.isArray(processed.checkpoints)) {
      processed.checkpoints = processed.checkpoints.map(checkpoint => this._postprocessCheckpoint(checkpoint));
    }

    return processed;
  }

  /**
   * Agent-specific preprocessing
   */
  _preprocessAgent(agent) {
    if (!agent || typeof agent !== 'object') return agent;
    
    const processed = { ...agent };
    
    // Handle agent timestamps
    if (processed.created_at) processed.created_at = new Date(processed.created_at);
    if (processed.updated_at) processed.updated_at = new Date(processed.updated_at);
    if (processed.last_active) processed.last_active = new Date(processed.last_active);
    
    // Handle agent configuration
    if (processed.config && typeof processed.config === 'object') {
      processed.config = { ...processed.config };
    }
    
    return processed;
  }

  /**
   * Task-specific preprocessing
   */
  _preprocessTask(task) {
    if (!task || typeof task !== 'object') return task;
    
    const processed = { ...task };
    
    // Handle task timestamps
    if (processed.created_at) processed.created_at = new Date(processed.created_at);
    if (processed.updated_at) processed.updated_at = new Date(processed.updated_at);
    if (processed.started_at) processed.started_at = new Date(processed.started_at);
    if (processed.completed_at) processed.completed_at = new Date(processed.completed_at);
    
    return processed;
  }

  /**
   * Checkpoint-specific preprocessing
   */
  _preprocessCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
    
    const processed = { ...checkpoint };
    
    // Handle checkpoint timestamps
    if (processed.created_at) processed.created_at = new Date(processed.created_at);
    
    return processed;
  }

  /**
   * Agent-specific postprocessing
   */
  _postprocessAgent(agent) {
    return this._preprocessAgent(agent); // Same logic for now
  }

  /**
   * Task-specific postprocessing
   */
  _postprocessTask(task) {
    return this._preprocessTask(task); // Same logic for now
  }

  /**
   * Checkpoint-specific postprocessing
   */
  _postprocessCheckpoint(checkpoint) {
    return this._preprocessCheckpoint(checkpoint); // Same logic for now
  }

  /**
   * Migrate session data between versions
   */
  _migrateSessionData(data, fromVersion) {
    switch (fromVersion) {
      case '1.0.0':
        // Add new fields introduced in v2.0.0
        if (!data.version) data.version = '2.0.0';
        if (!data.capabilities) data.capabilities = [];
        break;
      
      default:
        console.warn(`[SessionSerializer] Unknown session version: ${fromVersion}`);
    }
  }

  /**
   * Fallback deserialization for legacy session formats
   */
  _deserializeLegacySession(serializedData) {
    try {
      const data = JSON.parse(serializedData);
      
      // Basic cleanup for common legacy issues
      return this._cleanupLegacyData(data);
    } catch (error) {
      throw new DeserializationError(`Legacy session deserialization failed: ${error.message}`);
    }
  }

  /**
   * Clean up legacy data structures
   */
  _cleanupLegacyData(data) {
    if (!data || typeof data !== 'object') return data;
    
    const cleaned = { ...data };
    
    // Convert string dates to Date objects
    const dateFields = ['created_at', 'updated_at', 'paused_at', 'resumed_at'];
    for (const field of dateFields) {
      if (cleaned[field] && typeof cleaned[field] === 'string') {
        try {
          cleaned[field] = new Date(cleaned[field]);
        } catch (error) {
          console.warn(`[SessionSerializer] Failed to parse date field ${field}:`, error.message);
        }
      }
    }
    
    // Handle stringified JSON fields
    const jsonFields = ['metadata', 'checkpoint_data'];
    for (const field of jsonFields) {
      if (cleaned[field] && typeof cleaned[field] === 'string') {
        try {
          cleaned[field] = JSON.parse(cleaned[field]);
        } catch (error) {
          console.warn(`[SessionSerializer] Failed to parse JSON field ${field}:`, error.message);
        }
      }
    }
    
    return cleaned;
  }

  /**
   * Simplify metadata for fallback serialization
   */
  _simplifyMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return metadata;
    
    const simplified = {};
    
    for (const [key, value] of Object.entries(metadata)) {
      try {
        // Only include JSON-serializable values
        JSON.stringify(value);
        simplified[key] = value;
      } catch (error) {
        simplified[key] = `[Non-serializable: ${typeof value}]`;
      }
    }
    
    return simplified;
  }

  /**
   * Sanitize log data for safe serialization
   */
  _sanitizeLogData(logData) {
    if (!logData || typeof logData !== 'object') return logData;
    
    const sanitized = {};
    
    for (const [key, value] of Object.entries(logData)) {
      if (typeof value === 'function') {
        sanitized[key] = '[Function]';
      } else if (typeof value === 'symbol') {
        sanitized[key] = `[Symbol: ${value.toString()}]`;
      } else if (value instanceof Error) {
        sanitized[key] = {
          name: value.name,
          message: value.message,
          stack: value.stack
        };
      } else {
        try {
          JSON.stringify(value);
          sanitized[key] = value;
        } catch (error) {
          sanitized[key] = `[Non-serializable: ${typeof value}]`;
        }
      }
    }
    
    return sanitized;
  }

  /**
   * Get serialization statistics
   */
  getStats() {
    return {
      compressionEnabled: this.serializer.options.enableCompression,
      compressionThreshold: this.compressionThreshold,
      maxDepth: this.serializer.options.maxDepth,
      validationEnabled: this.enableValidation,
      migrationEnabled: this.enableMigration
    };
  }
}

/**
 * Factory function for creating session serializers
 */
export function createEnhancedSessionSerializer(options = {}) {
  return new SessionSerializer(options);
}

/**
 * Global session serializer instance
 */
export const sessionSerializer = new SessionSerializer();

export default SessionSerializer;