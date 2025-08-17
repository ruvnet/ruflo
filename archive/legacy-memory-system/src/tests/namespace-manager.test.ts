/**
 * SPARC Memory Bank - Namespace Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NamespaceManager } from '../namespaces/namespace-manager';
import { SqliteBackend } from '../backends/sqlite-backend';
import { MemoryNamespace } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('NamespaceManager', () => {
  let namespaceManager: NamespaceManager;
  let backend: SqliteBackend;
  const testDir = '/tmp/namespace-test';

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
    
    backend = new SqliteBackend({
      path: path.join(testDir, 'test.db')
    });
    await backend.initialize();

    namespaceManager = new NamespaceManager({ backend });
    await namespaceManager.initialize();
  });

  afterEach(async () => {
    await backend.close();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('Namespace CRUD Operations', () => {
    it('should create default namespace on initialization', () => {
      const defaultNs = namespaceManager.getNamespace('default');
      expect(defaultNs).toBeDefined();
      expect(defaultNs?.name).toBe('Default Namespace');
      expect(defaultNs?.permissions?.read).toContain('*');
    });

    it('should create new namespace', async () => {
      const namespace = await namespaceManager.createNamespace({
        name: 'Test Namespace',
        description: 'A test namespace',
        permissions: {
          read: ['user1', 'user2'],
          write: ['user1'],
          delete: ['user1'],
          admin: ['admin']
        }
      });

      expect(namespace.id).toBeDefined();
      expect(namespace.name).toBe('Test Namespace');
      expect(namespace.permissions?.read).toContain('user1');
      expect(namespace.permissions?.read).toContain('user2');
    });

    it('should prevent duplicate namespace IDs', async () => {
      await namespaceManager.createNamespace({
        id: 'duplicate-test',
        name: 'First Namespace'
      });

      await expect(
        namespaceManager.createNamespace({
          id: 'duplicate-test',
          name: 'Second Namespace'
        })
      ).rejects.toThrow('already exists');
    });

    it('should list all namespaces', async () => {
      await namespaceManager.createNamespace({ name: 'NS1' });
      await namespaceManager.createNamespace({ name: 'NS2' });

      const namespaces = namespaceManager.listNamespaces();
      expect(namespaces.length).toBeGreaterThanOrEqual(3); // default + 2 created
      expect(namespaces.some(ns => ns.name === 'NS1')).toBe(true);
      expect(namespaces.some(ns => ns.name === 'NS2')).toBe(true);
    });

    it('should update namespace', async () => {
      const namespace = await namespaceManager.createNamespace({
        name: 'Original Name'
      });

      const updated = await namespaceManager.updateNamespace(namespace.id, {
        name: 'Updated Name',
        description: 'Updated description',
        permissions: {
          read: ['new-user'],
          write: [],
          delete: [],
          admin: []
        }
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated description');
      expect(updated.permissions?.read).toContain('new-user');
      expect(updated.id).toBe(namespace.id); // ID should not change
    });

    it('should delete namespace and its items', async () => {
      const namespace = await namespaceManager.createNamespace({
        name: 'To Delete'
      });

      // Store items in namespace
      await backend.store({
        id: 'item1',
        category: 'test',
        key: 'key1',
        value: 'data',
        metadata: { namespace: namespace.id }
      });

      const deleted = await namespaceManager.deleteNamespace(namespace.id);
      expect(deleted).toBe(true);

      const retrieved = namespaceManager.getNamespace(namespace.id);
      expect(retrieved).toBeNull();

      // Items should be deleted
      const items = await backend.query({ namespace: namespace.id });
      expect(items).toHaveLength(0);
    });

    it('should prevent deletion of default namespace', async () => {
      await expect(
        namespaceManager.deleteNamespace('default')
      ).rejects.toThrow('Cannot delete default namespace');
    });
  });

  describe('Session Management', () => {
    let testNamespace: MemoryNamespace;

    beforeEach(async () => {
      testNamespace = await namespaceManager.createNamespace({
        name: 'Session Test',
        permissions: {
          read: ['user1', 'user2', '*'],
          write: ['user1'],
          delete: ['user1'],
          admin: ['admin']
        }
      });
    });

    it('should create session with valid permissions', () => {
      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['read', 'write']
      );

      expect(sessionId).toBeDefined();

      const session = namespaceManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.userId).toBe('user1');
      expect(session?.permissions).toContain('read');
      expect(session?.permissions).toContain('write');
    });

    it('should validate permissions based on namespace rules', () => {
      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'user2',
        ['read', 'write', 'delete']
      );

      const session = namespaceManager.getSession(sessionId);
      expect(session?.permissions).toContain('read');
      expect(session?.permissions).not.toContain('write'); // user2 doesn't have write
      expect(session?.permissions).not.toContain('delete'); // user2 doesn't have delete
    });

    it('should grant all permissions to admin users', () => {
      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'admin',
        ['*']
      );

      const session = namespaceManager.getSession(sessionId);
      expect(session?.permissions).toContain('*');
    });

    it('should validate session permissions', () => {
      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['read', 'write']
      );

      expect(namespaceManager.validateSession(sessionId, 'read')).toBe(true);
      expect(namespaceManager.validateSession(sessionId, 'write')).toBe(true);
      expect(namespaceManager.validateSession(sessionId, 'delete')).toBe(false);
      expect(namespaceManager.validateSession(sessionId, 'admin')).toBe(false);
    });

    it('should handle session TTL', () => {
      vi.useFakeTimers();

      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['read'],
        1000 // 1 second TTL
      );

      expect(namespaceManager.validateSession(sessionId, 'read')).toBe(true);

      // Advance time past TTL
      vi.advanceTimersByTime(1500);

      expect(namespaceManager.validateSession(sessionId, 'read')).toBe(false);
      expect(namespaceManager.getSession(sessionId)).toBeNull();

      vi.useRealTimers();
    });

    it('should revoke sessions', () => {
      const sessionId = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['read']
      );

      expect(namespaceManager.getSession(sessionId)).toBeDefined();

      const revoked = namespaceManager.revokeSession(sessionId);
      expect(revoked).toBe(true);

      expect(namespaceManager.getSession(sessionId)).toBeNull();
      expect(namespaceManager.validateSession(sessionId, 'read')).toBe(false);
    });

    it('should track user sessions', () => {
      const session1 = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['read']
      );

      const session2 = namespaceManager.createSession(
        testNamespace.id,
        'user1',
        ['write']
      );

      const userSessions = namespaceManager.getUserSessions('user1');
      expect(userSessions).toHaveLength(2);
      expect(userSessions.some(s => s.id === session1)).toBe(true);
      expect(userSessions.some(s => s.id === session2)).toBe(true);

      // Revoke one session
      namespaceManager.revokeSession(session1);

      const remainingSessions = namespaceManager.getUserSessions('user1');
      expect(remainingSessions).toHaveLength(1);
      expect(remainingSessions[0].id).toBe(session2);
    });
  });

  describe('Namespace Operations', () => {
    it('should clone namespace with items', async () => {
      const source = await namespaceManager.createNamespace({
        name: 'Source Namespace',
        permissions: {
          read: ['user1'],
          write: ['user1'],
          delete: [],
          admin: []
        }
      });

      // Add items to source namespace
      await backend.store({
        id: 'item1',
        category: 'data',
        key: 'key1',
        value: 'value1',
        metadata: { namespace: source.id }
      });

      await backend.store({
        id: 'item2',
        category: 'data',
        key: 'key2',
        value: 'value2',
        metadata: { namespace: source.id }
      });

      const target = await namespaceManager.cloneNamespace(
        source.id,
        'cloned-ns',
        'Cloned Namespace'
      );

      expect(target.name).toBe('Cloned Namespace');
      expect(target.permissions).toEqual(source.permissions);
      expect(target.metadata?.clonedFrom).toBe(source.id);

      // Check cloned items
      const clonedItems = await backend.query({ namespace: 'cloned-ns' });
      expect(clonedItems).toHaveLength(2);
      expect(clonedItems.some(i => i.key === 'key1')).toBe(true);
      expect(clonedItems.some(i => i.key === 'key2')).toBe(true);
    });

    it('should merge namespaces with skip conflict resolution', async () => {
      const target = await namespaceManager.createNamespace({
        name: 'Target Namespace'
      });

      const source1 = await namespaceManager.createNamespace({
        name: 'Source 1'
      });

      const source2 = await namespaceManager.createNamespace({
        name: 'Source 2'
      });

      // Add items to namespaces
      await backend.store({
        id: 'target-item',
        category: 'data',
        key: 'shared-key',
        value: 'target value',
        metadata: { namespace: target.id }
      });

      await backend.store({
        id: 'source1-item1',
        category: 'data',
        key: 'key1',
        value: 'source1 value1',
        metadata: { namespace: source1.id }
      });

      await backend.store({
        id: 'source1-item2',
        category: 'data',
        key: 'shared-key',
        value: 'source1 shared',
        metadata: { namespace: source1.id }
      });

      await backend.store({
        id: 'source2-item',
        category: 'data',
        key: 'key2',
        value: 'source2 value',
        metadata: { namespace: source2.id }
      });

      const mergedCount = await namespaceManager.mergeNamespaces(
        [source1.id, source2.id],
        target.id,
        'skip'
      );

      expect(mergedCount).toBe(2); // key1 and key2, shared-key skipped

      const targetItems = await backend.query({ namespace: target.id });
      expect(targetItems).toHaveLength(3);
      expect(targetItems.find(i => i.key === 'shared-key')?.value).toBe('target value');
    });

    it('should merge namespaces with rename conflict resolution', async () => {
      const target = await namespaceManager.createNamespace({
        name: 'Target Namespace'
      });

      const source = await namespaceManager.createNamespace({
        name: 'Source'
      });

      await backend.store({
        id: 'target-item',
        category: 'data',
        key: 'conflict',
        value: 'target value',
        metadata: { namespace: target.id }
      });

      await backend.store({
        id: 'source-item',
        category: 'data',
        key: 'conflict',
        value: 'source value',
        metadata: { namespace: source.id }
      });

      const mergedCount = await namespaceManager.mergeNamespaces(
        [source.id],
        target.id,
        'rename'
      );

      expect(mergedCount).toBe(1);

      const targetItems = await backend.query({ namespace: target.id });
      expect(targetItems).toHaveLength(2);
      expect(targetItems.find(i => i.key === 'conflict')?.value).toBe('target value');
      expect(targetItems.find(i => i.key === `conflict_${source.id}`)?.value).toBe('source value');
    });
  });

  describe('Statistics', () => {
    it('should provide namespace statistics', async () => {
      await namespaceManager.createNamespace({ name: 'NS1' });
      await namespaceManager.createNamespace({ name: 'NS2' });

      const stats = namespaceManager.getStats();
      expect(stats.totalNamespaces).toBeGreaterThanOrEqual(3); // default + 2
      expect(stats.activeSessions).toBe(0);
    });
  });

  describe('Event Emissions', () => {
    it('should emit events for namespace operations', async () => {
      const createdHandler = vi.fn();
      const updatedHandler = vi.fn();
      const deletedHandler = vi.fn();

      namespaceManager.on('namespace-created', createdHandler);
      namespaceManager.on('namespace-updated', updatedHandler);
      namespaceManager.on('namespace-deleted', deletedHandler);

      const namespace = await namespaceManager.createNamespace({
        name: 'Event Test'
      });
      expect(createdHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Event Test' })
      );

      await namespaceManager.updateNamespace(namespace.id, {
        name: 'Updated Event Test'
      });
      expect(updatedHandler).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Updated Event Test' })
      );

      await namespaceManager.deleteNamespace(namespace.id);
      expect(deletedHandler).toHaveBeenCalledWith({ id: namespace.id });
    });

    it('should emit session events', () => {
      const sessionCreatedHandler = vi.fn();
      const sessionRevokedHandler = vi.fn();

      namespaceManager.on('session-created', sessionCreatedHandler);
      namespaceManager.on('session-revoked', sessionRevokedHandler);

      const sessionId = namespaceManager.createSession('default', 'user1');
      expect(sessionCreatedHandler).toHaveBeenCalled();

      namespaceManager.revokeSession(sessionId);
      expect(sessionRevokedHandler).toHaveBeenCalledWith({ sessionId });
    });
  });
});