/**
 * SPARC Memory Bank - Namespace Manager
 * Provides session isolation and access control for memory items
 */

import { EventEmitter } from 'events';
import { MemoryBackend, MemoryNamespace, NamespacePermissions } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface NamespaceSession {
  id: string;
  namespaceId: string;
  userId: string;
  permissions: string[];
  createdAt: number;
  expiresAt?: number;
}

interface NamespaceStats {
  totalNamespaces: number;
  activeSessions: number;
  itemsByNamespace: Map<string, number>;
}

export class NamespaceManager extends EventEmitter {
  private backend: MemoryBackend;
  private namespaces: Map<string, MemoryNamespace> = new Map();
  private sessions: Map<string, NamespaceSession> = new Map();
  private userSessions: Map<string, Set<string>> = new Map();

  constructor(options: { backend: MemoryBackend }) {
    super();
    this.backend = options.backend;
  }

  async initialize(): Promise<void> {
    // Create default namespace
    await this.createNamespace({
      id: 'default',
      name: 'Default Namespace',
      description: 'Default namespace for unscoped memory items',
      permissions: {
        read: ['*'],
        write: ['*'],
        delete: ['*'],
        admin: ['system']
      }
    });

    // Load existing namespaces from backend
    await this.loadNamespaces();

    // Start session cleanup interval
    setInterval(() => this.cleanupExpiredSessions(), 60000); // Every minute

    this.emit('initialized');
  }

  /**
   * Create a new namespace
   */
  async createNamespace(namespace: Partial<MemoryNamespace>): Promise<MemoryNamespace> {
    const fullNamespace: MemoryNamespace = {
      id: namespace.id || uuidv4(),
      name: namespace.name || 'Unnamed Namespace',
      description: namespace.description,
      permissions: namespace.permissions || {
        read: [],
        write: [],
        delete: [],
        admin: []
      },
      metadata: namespace.metadata || {}
    };

    // Validate namespace doesn't already exist
    if (this.namespaces.has(fullNamespace.id)) {
      throw new Error(`Namespace ${fullNamespace.id} already exists`);
    }

    // Store namespace
    this.namespaces.set(fullNamespace.id, fullNamespace);
    await this.persistNamespaces();

    this.emit('namespace-created', fullNamespace);
    return fullNamespace;
  }

  /**
   * Get namespace by ID
   */
  getNamespace(id: string): MemoryNamespace | null {
    return this.namespaces.get(id) || null;
  }

  /**
   * List all namespaces
   */
  listNamespaces(): MemoryNamespace[] {
    return Array.from(this.namespaces.values());
  }

  /**
   * Update namespace
   */
  async updateNamespace(
    id: string, 
    updates: Partial<MemoryNamespace>
  ): Promise<MemoryNamespace> {
    const namespace = this.namespaces.get(id);
    if (!namespace) {
      throw new Error(`Namespace ${id} not found`);
    }

    const updated = {
      ...namespace,
      ...updates,
      id: namespace.id // Prevent ID changes
    };

    this.namespaces.set(id, updated);
    await this.persistNamespaces();

    this.emit('namespace-updated', updated);
    return updated;
  }

  /**
   * Delete namespace
   */
  async deleteNamespace(id: string): Promise<boolean> {
    if (id === 'default') {
      throw new Error('Cannot delete default namespace');
    }

    const namespace = this.namespaces.get(id);
    if (!namespace) {
      return false;
    }

    // Delete all items in namespace
    const items = await this.backend.query({ namespace: id });
    for (const item of items) {
      await this.backend.delete(item.category, item.key);
    }

    // Delete namespace
    this.namespaces.delete(id);
    await this.persistNamespaces();

    // Revoke all sessions for this namespace
    for (const [sessionId, session] of this.sessions) {
      if (session.namespaceId === id) {
        this.sessions.delete(sessionId);
      }
    }

    this.emit('namespace-deleted', { id });
    return true;
  }

  /**
   * Create session for a namespace
   */
  createSession(
    namespaceId: string, 
    userId: string, 
    permissions?: string[],
    ttl?: number
  ): string {
    const namespace = this.namespaces.get(namespaceId);
    if (!namespace) {
      throw new Error(`Namespace ${namespaceId} not found`);
    }

    // Validate permissions
    const validPermissions = this.validatePermissions(
      namespace, 
      userId, 
      permissions || ['read']
    );

    const session: NamespaceSession = {
      id: uuidv4(),
      namespaceId,
      userId,
      permissions: validPermissions,
      createdAt: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : undefined
    };

    this.sessions.set(session.id, session);

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId)!.add(session.id);

    this.emit('session-created', session);
    return session.id;
  }

  /**
   * Validate session and check permissions
   */
  validateSession(
    sessionId: string, 
    requiredPermission: 'read' | 'write' | 'delete' | 'admin'
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Check expiration
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }

    // Check permission
    return session.permissions.includes(requiredPermission) || 
           session.permissions.includes('*');
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): NamespaceSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Revoke session
   */
  revokeSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    this.sessions.delete(sessionId);

    // Remove from user sessions
    const userSessions = this.userSessions.get(session.userId);
    if (userSessions) {
      userSessions.delete(sessionId);
      if (userSessions.size === 0) {
        this.userSessions.delete(session.userId);
      }
    }

    this.emit('session-revoked', { sessionId });
    return true;
  }

  /**
   * Get all sessions for a user
   */
  getUserSessions(userId: string): NamespaceSession[] {
    const sessionIds = this.userSessions.get(userId);
    if (!sessionIds) {
      return [];
    }

    const sessions: NamespaceSession[] = [];
    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Get namespace statistics
   */
  getStats(): NamespaceStats {
    const itemsByNamespace = new Map<string, number>();
    
    // This would be more efficient with a dedicated query in production
    for (const namespace of this.namespaces.keys()) {
      itemsByNamespace.set(namespace, 0); // Placeholder
    }

    return {
      totalNamespaces: this.namespaces.size,
      activeSessions: this.sessions.size,
      itemsByNamespace
    };
  }

  /**
   * Clone namespace with all its items
   */
  async cloneNamespace(
    sourceId: string, 
    targetId: string, 
    targetName: string
  ): Promise<MemoryNamespace> {
    const source = this.namespaces.get(sourceId);
    if (!source) {
      throw new Error(`Source namespace ${sourceId} not found`);
    }

    // Create new namespace
    const target = await this.createNamespace({
      id: targetId,
      name: targetName,
      description: `Cloned from ${source.name}`,
      permissions: { ...source.permissions },
      metadata: {
        ...source.metadata,
        clonedFrom: sourceId,
        clonedAt: Date.now()
      }
    });

    // Copy all items
    const items = await this.backend.query({ namespace: sourceId });
    for (const item of items) {
      const clonedItem = {
        ...item,
        id: uuidv4(),
        metadata: {
          ...item.metadata,
          namespace: targetId,
          clonedFrom: item.id
        }
      };
      await this.backend.store(clonedItem);
    }

    this.emit('namespace-cloned', { source: sourceId, target: targetId });
    return target;
  }

  /**
   * Merge namespaces
   */
  async mergeNamespaces(
    sourceIds: string[], 
    targetId: string,
    conflictResolution: 'skip' | 'overwrite' | 'rename' = 'skip'
  ): Promise<number> {
    const target = this.namespaces.get(targetId);
    if (!target) {
      throw new Error(`Target namespace ${targetId} not found`);
    }

    let mergedCount = 0;

    for (const sourceId of sourceIds) {
      if (sourceId === targetId) continue;

      const source = this.namespaces.get(sourceId);
      if (!source) continue;

      const items = await this.backend.query({ namespace: sourceId });
      
      for (const item of items) {
        const existingKey = `${item.category}:${item.key}`;
        const existing = await this.backend.get(item.category, item.key);

        if (existing && existing.metadata?.namespace === targetId) {
          // Handle conflict
          switch (conflictResolution) {
            case 'skip':
              continue;
            case 'overwrite':
              // Will overwrite below
              break;
            case 'rename':
              item.key = `${item.key}_${sourceId}`;
              break;
          }
        }

        // Store in target namespace
        const mergedItem = {
          ...item,
          id: uuidv4(),
          metadata: {
            ...item.metadata,
            namespace: targetId,
            mergedFrom: sourceId
          }
        };

        await this.backend.store(mergedItem);
        mergedCount++;
      }
    }

    this.emit('namespaces-merged', { 
      sources: sourceIds, 
      target: targetId, 
      count: mergedCount 
    });

    return mergedCount;
  }

  /**
   * Validate user permissions for namespace
   */
  private validatePermissions(
    namespace: MemoryNamespace,
    userId: string,
    requestedPermissions: string[]
  ): string[] {
    const validPermissions: string[] = [];

    for (const permission of requestedPermissions) {
      if (permission === '*' && namespace.permissions?.admin?.includes(userId)) {
        return ['*'];
      }

      if (permission === 'read' && 
          (namespace.permissions?.read?.includes(userId) || 
           namespace.permissions?.read?.includes('*'))) {
        validPermissions.push('read');
      }

      if (permission === 'write' && 
          (namespace.permissions?.write?.includes(userId) || 
           namespace.permissions?.write?.includes('*'))) {
        validPermissions.push('write');
      }

      if (permission === 'delete' && 
          (namespace.permissions?.delete?.includes(userId) || 
           namespace.permissions?.delete?.includes('*'))) {
        validPermissions.push('delete');
      }

      if (permission === 'admin' && 
          namespace.permissions?.admin?.includes(userId)) {
        validPermissions.push('admin');
      }
    }

    return validPermissions;
  }

  /**
   * Load namespaces from backend
   */
  private async loadNamespaces(): Promise<void> {
    try {
      const namespaceItems = await this.backend.query({
        categories: ['system-namespace']
      });

      for (const item of namespaceItems) {
        if (item.value && typeof item.value === 'object') {
          this.namespaces.set(item.key, item.value as MemoryNamespace);
        }
      }
    } catch (error) {
      // No existing namespaces
    }
  }

  /**
   * Persist namespaces to backend
   */
  private async persistNamespaces(): Promise<void> {
    for (const [id, namespace] of this.namespaces) {
      await this.backend.store({
        id: `namespace-${id}`,
        category: 'system-namespace',
        key: id,
        value: namespace,
        metadata: {
          timestamp: Date.now()
        }
      });
    }
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt && now > session.expiresAt) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.revokeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      this.emit('sessions-cleaned', { count: expiredSessions.length });
    }
  }
}