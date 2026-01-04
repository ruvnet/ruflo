/**
 * V3 Hook Registry
 * Central registry for hook registration and lookup
 */

import type {
  HookType,
  HookRegistration,
  HookFilter,
  HookContext,
  HookStatistics,
  HookValidationError
} from './types.js';

/**
 * Hook registry for managing hook registrations
 */
export class HookRegistry {
  /** Hooks organized by type */
  private hooksByType: Map<HookType, HookRegistration[]> = new Map();

  /** All hooks by ID for quick lookup */
  private hooksById: Map<string, HookRegistration> = new Map();

  /** Hook statistics */
  private statistics: Map<string, HookStatistics> = new Map();

  /** Tags index for filtering */
  private hooksByTag: Map<string, Set<string>> = new Map();

  /**
   * Register a new hook
   */
  register(registration: HookRegistration): void {
    // Validate registration
    this.validateRegistration(registration);

    const { id, type } = registration;

    // Check for duplicate ID
    if (this.hooksById.has(id)) {
      throw new Error(`Hook with ID '${id}' is already registered`);
    }

    // Initialize type list if needed
    if (!this.hooksByType.has(type)) {
      this.hooksByType.set(type, []);
    }

    // Add to type list, maintaining priority order
    const hookList = this.hooksByType.get(type)!;
    const insertIndex = hookList.findIndex(h => h.priority < registration.priority);

    if (insertIndex === -1) {
      hookList.push(registration);
    } else {
      hookList.splice(insertIndex, 0, registration);
    }

    // Add to ID map
    this.hooksById.set(id, registration);

    // Index tags
    if (registration.tags) {
      for (const tag of registration.tags) {
        if (!this.hooksByTag.has(tag)) {
          this.hooksByTag.set(tag, new Set());
        }
        this.hooksByTag.get(tag)!.add(id);
      }
    }

    // Initialize statistics
    this.statistics.set(id, {
      hookId: id,
      hookType: type,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageDuration: 0,
      p50Duration: 0,
      p95Duration: 0,
      p99Duration: 0,
      cacheHitRate: 0
    });
  }

  /**
   * Unregister a hook by ID
   */
  unregister(hookId: string): boolean {
    const registration = this.hooksById.get(hookId);

    if (!registration) {
      return false;
    }

    // Remove from type list
    const hookList = this.hooksByType.get(registration.type);
    if (hookList) {
      const index = hookList.findIndex(h => h.id === hookId);
      if (index !== -1) {
        hookList.splice(index, 1);
      }

      // Clean up empty type list
      if (hookList.length === 0) {
        this.hooksByType.delete(registration.type);
      }
    }

    // Remove from ID map
    this.hooksById.delete(hookId);

    // Remove from tag index
    if (registration.tags) {
      for (const tag of registration.tags) {
        const tagSet = this.hooksByTag.get(tag);
        if (tagSet) {
          tagSet.delete(hookId);
          if (tagSet.size === 0) {
            this.hooksByTag.delete(tag);
          }
        }
      }
    }

    // Remove statistics
    this.statistics.delete(hookId);

    return true;
  }

  /**
   * Get all hooks for a specific type
   */
  getByType(type: HookType): HookRegistration[] {
    return [...(this.hooksByType.get(type) || [])];
  }

  /**
   * Get hooks matching a filter
   */
  getByFilter(type: HookType, filter: HookFilter, context?: HookContext): HookRegistration[] {
    const hooks = this.getByType(type);

    return hooks.filter(hook => {
      // Skip disabled hooks
      if (!hook.enabled) {
        return false;
      }

      // No filter on hook = matches all
      if (!hook.filter) {
        return true;
      }

      return this.matchesFilter(hook.filter, filter, context);
    });
  }

  /**
   * Get hook by ID
   */
  getById(hookId: string): HookRegistration | undefined {
    return this.hooksById.get(hookId);
  }

  /**
   * Get hooks by tag
   */
  getByTag(tag: string): HookRegistration[] {
    const hookIds = this.hooksByTag.get(tag);
    if (!hookIds) {
      return [];
    }

    return Array.from(hookIds)
      .map(id => this.hooksById.get(id))
      .filter((h): h is HookRegistration => h !== undefined);
  }

  /**
   * Check if hook exists
   */
  has(hookId: string): boolean {
    return this.hooksById.has(hookId);
  }

  /**
   * Set hook enabled state
   */
  setEnabled(hookId: string, enabled: boolean): boolean {
    const hook = this.hooksById.get(hookId);
    if (!hook) {
      return false;
    }

    hook.enabled = enabled;
    return true;
  }

  /**
   * Get all registered hook types
   */
  getTypes(): HookType[] {
    return Array.from(this.hooksByType.keys());
  }

  /**
   * Get all hooks
   */
  getAll(): HookRegistration[] {
    return Array.from(this.hooksById.values());
  }

  /**
   * Get hook count by type
   */
  getCountByType(): Map<HookType, number> {
    const counts = new Map<HookType, number>();
    for (const [type, hooks] of this.hooksByType) {
      counts.set(type, hooks.length);
    }
    return counts;
  }

  /**
   * Get total hook count
   */
  getCount(): number {
    return this.hooksById.size;
  }

  /**
   * Get hook statistics
   */
  getStatistics(hookId?: string): HookStatistics | HookStatistics[] | undefined {
    if (hookId) {
      return this.statistics.get(hookId);
    }
    return Array.from(this.statistics.values());
  }

  /**
   * Update hook statistics
   */
  updateStatistics(
    hookId: string,
    update: Partial<Pick<HookStatistics, 'totalExecutions' | 'successfulExecutions' | 'failedExecutions'>> & {
      duration?: number;
      cacheHit?: boolean;
    }
  ): void {
    const stats = this.statistics.get(hookId);
    if (!stats) return;

    if (update.totalExecutions !== undefined) {
      stats.totalExecutions += update.totalExecutions;
    }

    if (update.successfulExecutions !== undefined) {
      stats.successfulExecutions += update.successfulExecutions;
    }

    if (update.failedExecutions !== undefined) {
      stats.failedExecutions += update.failedExecutions;
    }

    if (update.duration !== undefined) {
      // Update average duration (running average)
      const n = stats.totalExecutions;
      stats.averageDuration = ((stats.averageDuration * (n - 1)) + update.duration) / n;
    }

    stats.lastExecutedAt = Date.now();
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooksByType.clear();
    this.hooksById.clear();
    this.hooksByTag.clear();
    this.statistics.clear();
  }

  /**
   * Export registry state for persistence
   */
  export(): { hooks: HookRegistration[]; statistics: HookStatistics[] } {
    return {
      hooks: this.getAll().map(h => ({
        ...h,
        // Exclude non-serializable handler
        handler: undefined as any
      })),
      statistics: Array.from(this.statistics.values())
    };
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Validate hook registration
   */
  private validateRegistration(registration: HookRegistration): void {
    if (!registration.id || typeof registration.id !== 'string') {
      throw this.createValidationError('id', 'Hook ID is required and must be a string', registration.id);
    }

    if (!registration.type) {
      throw this.createValidationError('type', 'Hook type is required', registration.type);
    }

    if (typeof registration.handler !== 'function') {
      throw this.createValidationError('handler', 'Hook handler must be a function', typeof registration.handler);
    }

    if (typeof registration.priority !== 'number' || registration.priority < 0) {
      throw this.createValidationError('priority', 'Hook priority must be a non-negative number', registration.priority);
    }

    if (registration.options?.timeout !== undefined && registration.options.timeout <= 0) {
      throw this.createValidationError('options.timeout', 'Timeout must be a positive number', registration.options.timeout);
    }

    if (registration.options?.retries !== undefined && registration.options.retries < 0) {
      throw this.createValidationError('options.retries', 'Retries must be a non-negative number', registration.options.retries);
    }
  }

  /**
   * Check if a hook filter matches the given filter and context
   */
  private matchesFilter(hookFilter: HookFilter, filter: HookFilter, context?: HookContext): boolean {
    // Check agent types
    if (hookFilter.agentTypes && filter.agentTypes) {
      const hasMatch = hookFilter.agentTypes.some(t => filter.agentTypes!.includes(t));
      if (!hasMatch) return false;
    }

    // Check task types
    if (hookFilter.taskTypes && filter.taskTypes) {
      const hasMatch = hookFilter.taskTypes.some(t => filter.taskTypes!.includes(t));
      if (!hasMatch) return false;
    }

    // Check namespaces
    if (hookFilter.namespaces && filter.namespaces) {
      const hasMatch = hookFilter.namespaces.some(n => filter.namespaces!.includes(n));
      if (!hasMatch) return false;
    }

    // Check providers
    if (hookFilter.providers && filter.providers) {
      const hasMatch = hookFilter.providers.some(p => filter.providers!.includes(p));
      if (!hasMatch) return false;
    }

    // Check custom filter
    if (hookFilter.custom && context) {
      if (!hookFilter.custom(context)) return false;
    }

    return true;
  }

  /**
   * Create validation error
   */
  private createValidationError(field: string, message: string, value?: unknown): HookValidationError {
    const error = new Error(message) as HookValidationError;
    error.name = 'HookValidationError';
    error.field = field;
    error.value = value;
    return error;
  }
}

// Export singleton instance
export const hookRegistry = new HookRegistry();
