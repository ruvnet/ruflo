/**
 * EventBus - Central event communication system for the Web UI
 * Enables loose coupling between components and real-time updates
 */

export class EventBus {
  constructor() {
    this.events = new Map();
    this.onceEvents = new Map();
    this.wildcardHandlers = new Map();
    this.eventHistory = [];
    this.maxHistorySize = 1000;
    this.isLogging = true;
  }

  /**
   * Subscribe to an event
   */
  on(event, handler, context = null) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const handlerInfo = {
      handler,
      context,
      id: this.generateHandlerId(),
    };

    this.events.get(event).push(handlerInfo);

    if (this.isLogging) {
      console.debug(`📡 EventBus: Subscribed to '${event}'`);
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Subscribe to an event (once only)
   */
  once(event, handler, context = null) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    if (!this.onceEvents.has(event)) {
      this.onceEvents.set(event, []);
    }

    const handlerInfo = {
      handler,
      context,
      id: this.generateHandlerId(),
    };

    this.onceEvents.get(event).push(handlerInfo);

    if (this.isLogging) {
      console.debug(`📡 EventBus: Subscribed once to '${event}'`);
    }

    // Return unsubscribe function
    return () => this.offOnce(event, handler);
  }

  /**
   * Subscribe to events with wildcard patterns
   */
  onWildcard(pattern, handler, context = null) {
    if (typeof handler !== 'function') {
      throw new Error('Event handler must be a function');
    }

    if (!this.wildcardHandlers.has(pattern)) {
      this.wildcardHandlers.set(pattern, []);
    }

    const handlerInfo = {
      handler,
      context,
      id: this.generateHandlerId(),
      regex: this.createWildcardRegex(pattern),
    };

    this.wildcardHandlers.get(pattern).push(handlerInfo);

    if (this.isLogging) {
      console.debug(`📡 EventBus: Subscribed to wildcard pattern '${pattern}'`);
    }

    // Return unsubscribe function
    return () => this.offWildcard(pattern, handler);
  }

  /**
   * Unsubscribe from an event
   */
  off(event, handler) {
    const handlers = this.events.get(event);
    if (!handlers) return false;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index === -1) return false;

    handlers.splice(index, 1);

    if (handlers.length === 0) {
      this.events.delete(event);
    }

    if (this.isLogging) {
      console.debug(`📡 EventBus: Unsubscribed from '${event}'`);
    }

    return true;
  }

  /**
   * Unsubscribe from a once event
   */
  offOnce(event, handler) {
    const handlers = this.onceEvents.get(event);
    if (!handlers) return false;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index === -1) return false;

    handlers.splice(index, 1);

    if (handlers.length === 0) {
      this.onceEvents.delete(event);
    }

    return true;
  }

  /**
   * Unsubscribe from wildcard pattern
   */
  offWildcard(pattern, handler) {
    const handlers = this.wildcardHandlers.get(pattern);
    if (!handlers) return false;

    const index = handlers.findIndex((h) => h.handler === handler);
    if (index === -1) return false;

    handlers.splice(index, 1);

    if (handlers.length === 0) {
      this.wildcardHandlers.delete(pattern);
    }

    return true;
  }

  /**
   * Emit an event
   */
  emit(event, data = null) {
    const eventInfo = {
      event,
      data,
      timestamp: Date.now(),
      id: this.generateEventId(),
    };

    // Add to history
    this.addToHistory(eventInfo);

    if (this.isLogging) {
      console.debug(`📡 EventBus: Emitting '${event}'`, data);
    }

    let handlersExecuted = 0;

    // Execute regular event handlers
    const handlers = this.events.get(event);
    if (handlers) {
      for (const handlerInfo of [...handlers]) {
        try {
          if (handlerInfo.context) {
            handlerInfo.handler.call(handlerInfo.context, data, eventInfo);
          } else {
            handlerInfo.handler(data, eventInfo);
          }
          handlersExecuted++;
        } catch (error) {
          console.error(`📡 EventBus: Error in handler for '${event}':`, error);
          this.emit('error', { event, error, handlerInfo });
        }
      }
    }

    // Execute once event handlers
    const onceHandlers = this.onceEvents.get(event);
    if (onceHandlers) {
      for (const handlerInfo of [...onceHandlers]) {
        try {
          if (handlerInfo.context) {
            handlerInfo.handler.call(handlerInfo.context, data, eventInfo);
          } else {
            handlerInfo.handler(data, eventInfo);
          }
          handlersExecuted++;
        } catch (error) {
          console.error(`📡 EventBus: Error in once handler for '${event}':`, error);
          this.emit('error', { event, error, handlerInfo });
        }
      }
      // Clear once handlers after execution
      this.onceEvents.delete(event);
    }

    // Execute wildcard handlers
    for (const [pattern, handlers] of this.wildcardHandlers) {
      for (const handlerInfo of handlers) {
        if (handlerInfo.regex.test(event)) {
          try {
            if (handlerInfo.context) {
              handlerInfo.handler.call(handlerInfo.context, data, eventInfo);
            } else {
              handlerInfo.handler(data, eventInfo);
            }
            handlersExecuted++;
          } catch (error) {
            console.error(`📡 EventBus: Error in wildcard handler for '${pattern}':`, error);
            this.emit('error', { event, error, handlerInfo, pattern });
          }
        }
      }
    }

    return handlersExecuted;
  }

  /**
   * Emit event asynchronously
   */
  async emitAsync(event, data = null) {
    const eventInfo = {
      event,
      data,
      timestamp: Date.now(),
      id: this.generateEventId(),
    };

    // Add to history
    this.addToHistory(eventInfo);

    if (this.isLogging) {
      console.debug(`📡 EventBus: Emitting async '${event}'`, data);
    }

    const promises = [];

    // Execute regular event handlers
    const handlers = this.events.get(event);
    if (handlers) {
      for (const handlerInfo of [...handlers]) {
        const promise = this.executeHandlerAsync(handlerInfo, data, eventInfo);
        promises.push(promise);
      }
    }

    // Execute once event handlers
    const onceHandlers = this.onceEvents.get(event);
    if (onceHandlers) {
      for (const handlerInfo of [...onceHandlers]) {
        const promise = this.executeHandlerAsync(handlerInfo, data, eventInfo);
        promises.push(promise);
      }
      // Clear once handlers after execution
      this.onceEvents.delete(event);
    }

    // Execute wildcard handlers
    for (const [pattern, handlers] of this.wildcardHandlers) {
      for (const handlerInfo of handlers) {
        if (handlerInfo.regex.test(event)) {
          const promise = this.executeHandlerAsync(handlerInfo, data, eventInfo);
          promises.push(promise);
        }
      }
    }

    const results = await Promise.allSettled(promises);

    // Handle any rejections
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.error(`📡 EventBus: ${failures.length} handlers failed for '${event}'`);
      failures.forEach((failure) => {
        this.emit('error', { event, error: failure.reason });
      });
    }

    return results.length;
  }

  /**
   * Execute handler asynchronously
   */
  async executeHandlerAsync(handlerInfo, data, eventInfo) {
    try {
      let result;
      if (handlerInfo.context) {
        result = handlerInfo.handler.call(handlerInfo.context, data, eventInfo);
      } else {
        result = handlerInfo.handler(data, eventInfo);
      }

      // If handler returns a promise, await it
      if (result && typeof result.then === 'function') {
        return await result;
      }

      return result;
    } catch (error) {
      console.error(`📡 EventBus: Error in async handler:`, error);
      throw error;
    }
  }

  /**
   * Wait for an event to be emitted
   */
  waitFor(event, timeout = 5000) {
    return new Promise((resolve, reject) => {
      let timeoutId;

      const unsubscribe = this.once(event, (data) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(data);
      });

      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event '${event}' after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners(event = null) {
    if (event) {
      this.events.delete(event);
      this.onceEvents.delete(event);

      // Remove matching wildcard handlers
      for (const [pattern, handlers] of this.wildcardHandlers) {
        if (pattern === event) {
          this.wildcardHandlers.delete(pattern);
        }
      }
    } else {
      this.events.clear();
      this.onceEvents.clear();
      this.wildcardHandlers.clear();
    }

    if (this.isLogging) {
      console.debug(`📡 EventBus: Removed all listeners${event ? ` for '${event}'` : ''}`);
    }
  }

  /**
   * Get event listeners count
   */
  listenerCount(event) {
    const regular = this.events.get(event)?.length || 0;
    const once = this.onceEvents.get(event)?.length || 0;

    let wildcard = 0;
    for (const [pattern, handlers] of this.wildcardHandlers) {
      const regex = this.createWildcardRegex(pattern);
      if (regex.test(event)) {
        wildcard += handlers.length;
      }
    }

    return regular + once + wildcard;
  }

  /**
   * Get all event names
   */
  eventNames() {
    const names = new Set();

    for (const event of this.events.keys()) {
      names.add(event);
    }

    for (const event of this.onceEvents.keys()) {
      names.add(event);
    }

    return Array.from(names);
  }

  /**
   * Get event history
   */
  getEventHistory(limit = 100) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get events by pattern
   */
  getEventsByPattern(pattern, limit = 100) {
    const regex = this.createWildcardRegex(pattern);
    return this.eventHistory.filter((event) => regex.test(event.event)).slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
  }

  /**
   * Enable/disable logging
   */
  setLogging(enabled) {
    this.isLogging = enabled;
  }

  /**
   * Create wildcard regex
   */
  createWildcardRegex(pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    return new RegExp(`^${escaped}$`);
  }

  /**
   * Generate unique handler ID
   */
  generateHandlerId() {
    return `handler_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique event ID
   */
  generateEventId() {
    return `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add event to history
   */
  addToHistory(eventInfo) {
    this.eventHistory.push(eventInfo);

    // Keep history size under control
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      regularEvents: this.events.size,
      onceEvents: this.onceEvents.size,
      wildcardPatterns: this.wildcardHandlers.size,
      historySize: this.eventHistory.length,
      totalHandlers:
        Array.from(this.events.values()).reduce((sum, handlers) => sum + handlers.length, 0) +
        Array.from(this.onceEvents.values()).reduce((sum, handlers) => sum + handlers.length, 0) +
        Array.from(this.wildcardHandlers.values()).reduce(
          (sum, handlers) => sum + handlers.length,
          0,
        ),
    };
  }

  /**
   * Debug information
   */
  debug() {
    const stats = this.getStats();
    console.group('📡 EventBus Debug Info');
    console.log('Statistics:', stats);
    console.log('Regular Events:', Array.from(this.events.keys()));
    console.log('Once Events:', Array.from(this.onceEvents.keys()));
    console.log('Wildcard Patterns:', Array.from(this.wildcardHandlers.keys()));
    console.log('Recent History:', this.getEventHistory(10));
    console.groupEnd();
  }
}

export default EventBus;
