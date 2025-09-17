/**
 * Governance Access Control Unit Tests
 * Tests for role-based access control, permissions, and policy enforcement
 */

import { GovernanceEngine, Role, Permission, Policy, AccessRequest } from '../../../src/governance';

describe('Governance Access Control', () => {
  let governance: GovernanceEngine;
  let mockUser: any;
  let mockResource: any;

  beforeEach(() => {
    governance = new GovernanceEngine({
      strictMode: true,
      auditEnabled: true,
      cacheTTL: 300
    });

    mockUser = global.testUtils.createMockUser({
      id: 'user-123',
      role: 'analyst',
      permissions: ['read:data', 'write:reports']
    });

    mockResource = {
      id: 'resource-456',
      type: 'database',
      classification: 'sensitive',
      owner: 'user-123'
    };
  });

  describe('Role Management', () => {
    test('should create and manage roles', () => {
      const role = new Role({
        name: 'data-scientist',
        permissions: ['read:data', 'write:models', 'execute:queries'],
        level: 3
      });

      governance.addRole(role);

      const retrievedRole = governance.getRole('data-scientist');
      expect(retrievedRole).toBeDefined();
      expect(retrievedRole.name).toBe('data-scientist');
      expect(retrievedRole.permissions).toContain('read:data');
    });

    test('should validate role hierarchy', () => {
      const adminRole = new Role({ name: 'admin', level: 5 });
      const userRole = new Role({ name: 'user', level: 1 });

      governance.addRole(adminRole);
      governance.addRole(userRole);

      expect(governance.isRoleHigher('admin', 'user')).toBe(true);
      expect(governance.isRoleHigher('user', 'admin')).toBe(false);
    });

    test('should handle role inheritance', () => {
      const baseRole = new Role({
        name: 'base',
        permissions: ['read:basic']
      });

      const extendedRole = new Role({
        name: 'extended',
        inherits: ['base'],
        permissions: ['write:advanced']
      });

      governance.addRole(baseRole);
      governance.addRole(extendedRole);

      const effectivePermissions = governance.getEffectivePermissions('extended');
      expect(effectivePermissions).toContain('read:basic');
      expect(effectivePermissions).toContain('write:advanced');
    });
  });

  describe('Permission Validation', () => {
    test('should validate user permissions', () => {
      expect(governance.hasPermission(mockUser, 'read:data')).toBe(true);
      expect(governance.hasPermission(mockUser, 'delete:data')).toBe(false);
    });

    test('should handle wildcard permissions', () => {
      const adminUser = global.testUtils.createMockUser({
        permissions: ['*:*', 'admin:*']
      });

      expect(governance.hasPermission(adminUser, 'read:anything')).toBe(true);
      expect(governance.hasPermission(adminUser, 'admin:users')).toBe(true);
    });

    test('should validate resource-specific permissions', () => {
      const resource = { type: 'reports', id: 'report-123' };
      const permission = 'write:reports';

      expect(governance.hasResourcePermission(mockUser, permission, resource)).toBe(true);

      const restrictedResource = { type: 'admin', id: 'admin-panel' };
      expect(governance.hasResourcePermission(mockUser, 'access:admin', restrictedResource)).toBe(false);
    });
  });

  describe('Policy Enforcement', () => {
    test('should enforce access policies', async () => {
      const policy = new Policy({
        name: 'sensitive-data-access',
        conditions: [
          { field: 'resource.classification', operator: 'equals', value: 'sensitive' },
          { field: 'user.role', operator: 'in', value: ['analyst', 'admin'] }
        ],
        action: 'allow'
      });

      governance.addPolicy(policy);

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(true);
      expect(result.policy).toBe('sensitive-data-access');
    });

    test('should handle policy conflicts', async () => {
      const allowPolicy = new Policy({
        name: 'allow-policy',
        priority: 1,
        conditions: [{ field: 'user.role', operator: 'equals', value: 'analyst' }],
        action: 'allow'
      });

      const denyPolicy = new Policy({
        name: 'deny-policy',
        priority: 2, // Higher priority
        conditions: [{ field: 'resource.classification', operator: 'equals', value: 'sensitive' }],
        action: 'deny'
      });

      governance.addPolicy(allowPolicy);
      governance.addPolicy(denyPolicy);

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(false); // Deny policy has higher priority
      expect(result.policy).toBe('deny-policy');
    });

    test('should evaluate complex policy conditions', async () => {
      const complexPolicy = new Policy({
        name: 'complex-access',
        conditions: [
          {
            operator: 'and',
            conditions: [
              { field: 'user.department', operator: 'equals', value: 'analytics' },
              { field: 'time.hour', operator: 'between', value: [9, 17] }
            ]
          },
          {
            operator: 'or',
            conditions: [
              { field: 'user.level', operator: 'gte', value: 3 },
              { field: 'request.emergency', operator: 'equals', value: true }
            ]
          }
        ],
        action: 'allow'
      });

      governance.addPolicy(complexPolicy);

      const user = global.testUtils.createMockUser({
        department: 'analytics',
        level: 4
      });

      const accessRequest = new AccessRequest({
        user,
        resource: mockResource,
        action: 'read',
        context: { time: { hour: 14 } }
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    test('should log access attempts', async () => {
      const auditSpy = jest.spyOn(governance, 'logAuditEvent');

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      await governance.evaluateAccess(accessRequest);

      expect(auditSpy).toHaveBeenCalledWith({
        type: 'access_attempt',
        user: mockUser.id,
        resource: mockResource.id,
        action: 'read',
        result: expect.any(Object),
        timestamp: expect.any(Date)
      });
    });

    test('should track permission changes', () => {
      const auditSpy = jest.spyOn(governance, 'logAuditEvent');

      governance.grantPermission(mockUser.id, 'admin:users');

      expect(auditSpy).toHaveBeenCalledWith({
        type: 'permission_granted',
        subject: mockUser.id,
        permission: 'admin:users',
        grantedBy: expect.any(String),
        timestamp: expect.any(Date)
      });
    });

    test('should maintain audit trail', () => {
      governance.grantPermission(mockUser.id, 'new:permission');
      governance.revokePermission(mockUser.id, 'old:permission');

      const auditTrail = governance.getAuditTrail(mockUser.id);
      expect(auditTrail).toHaveLength(2);
      expect(auditTrail[0].type).toBe('permission_granted');
      expect(auditTrail[1].type).toBe('permission_revoked');
    });
  });

  describe('Data Classification', () => {
    test('should classify data sensitivity', () => {
      const publicData = { type: 'public', content: 'general information' };
      const sensitiveData = { type: 'sensitive', content: 'PII data', pii: true };

      expect(governance.classifyData(publicData)).toBe('public');
      expect(governance.classifyData(sensitiveData)).toBe('sensitive');
    });

    test('should apply classification-based policies', async () => {
      const classificationPolicy = new Policy({
        name: 'pii-protection',
        conditions: [
          { field: 'data.classification', operator: 'equals', value: 'pii' },
          { field: 'user.clearance', operator: 'lt', value: 'high' }
        ],
        action: 'deny'
      });

      governance.addPolicy(classificationPolicy);

      const piiData = { classification: 'pii', content: 'SSN: 123-45-6789' };
      const lowClearanceUser = global.testUtils.createMockUser({ clearance: 'low' });

      const accessRequest = new AccessRequest({
        user: lowClearanceUser,
        resource: piiData,
        action: 'read'
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(false);
    });
  });

  describe('Dynamic Permissions', () => {
    test('should handle context-based permissions', async () => {
      const contextPolicy = new Policy({
        name: 'location-based-access',
        conditions: [
          { field: 'context.location', operator: 'in', value: ['office', 'vpn'] },
          { field: 'context.device', operator: 'equals', value: 'trusted' }
        ],
        action: 'allow'
      });

      governance.addPolicy(contextPolicy);

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read',
        context: {
          location: 'office',
          device: 'trusted',
          ipAddress: '192.168.1.100'
        }
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(true);
    });

    test('should evaluate time-based restrictions', async () => {
      const timePolicy = new Policy({
        name: 'business-hours-only',
        conditions: [
          { field: 'time.dayOfWeek', operator: 'between', value: [1, 5] }, // Monday-Friday
          { field: 'time.hour', operator: 'between', value: [8, 18] } // 8 AM - 6 PM
        ],
        action: 'allow'
      });

      governance.addPolicy(timePolicy);

      // Mock current time to be during business hours
      const businessHoursRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read',
        context: {
          time: {
            dayOfWeek: 3, // Wednesday
            hour: 14 // 2 PM
          }
        }
      });

      const result = await governance.evaluateAccess(businessHoursRequest);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Performance and Caching', () => {
    test('should cache policy evaluations', async () => {
      const evaluateSpy = jest.spyOn(governance, 'evaluatePolicyConditions');

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      // First evaluation
      await governance.evaluateAccess(accessRequest);
      // Second evaluation (should use cache)
      await governance.evaluateAccess(accessRequest);

      expect(evaluateSpy).toHaveBeenCalledTimes(1); // Only evaluated once due to caching
    });

    test('should handle cache invalidation', async () => {
      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      await governance.evaluateAccess(accessRequest);

      // Change user permissions (should invalidate cache)
      governance.grantPermission(mockUser.id, 'new:permission');

      const evaluateSpy = jest.spyOn(governance, 'evaluatePolicyConditions');
      await governance.evaluateAccess(accessRequest);

      expect(evaluateSpy).toHaveBeenCalledTimes(1); // Re-evaluated after cache invalidation
    });
  });

  describe('Error Handling', () => {
    test('should handle policy evaluation errors gracefully', async () => {
      const faultyPolicy = new Policy({
        name: 'faulty-policy',
        conditions: [
          { field: 'invalid.field', operator: 'unknown', value: 'test' }
        ],
        action: 'allow'
      });

      governance.addPolicy(faultyPolicy);

      const accessRequest = new AccessRequest({
        user: mockUser,
        resource: mockResource,
        action: 'read'
      });

      const result = await governance.evaluateAccess(accessRequest);
      expect(result.allowed).toBe(false); // Fail secure
      expect(result.error).toBeDefined();
    });

    test('should validate policy syntax', () => {
      const invalidPolicy = {
        name: 'invalid',
        conditions: 'not-an-array',
        action: 'invalid-action'
      };

      expect(() => governance.addPolicy(invalidPolicy)).toThrow('Invalid policy format');
    });
  });

  describe('Hive Mind Integration', () => {
    test('should share governance decisions across nodes', async () => {
      const decision = {
        user: mockUser.id,
        resource: mockResource.id,
        action: 'read',
        allowed: true,
        policy: 'test-policy'
      };

      await governance.shareDecision(decision);

      const sharedDecisions = await governance.getSharedDecisions();
      expect(sharedDecisions).toContainEqual(decision);
    });

    test('should synchronize policies across hive', async () => {
      const policy = new Policy({
        name: 'hive-policy',
        conditions: [{ field: 'user.role', operator: 'equals', value: 'member' }],
        action: 'allow'
      });

      await governance.syncPolicyWithHive(policy);

      const hivePolicies = await governance.getHivePolicies();
      expect(hivePolicies).toContainEqual(expect.objectContaining({ name: 'hive-policy' }));
    });
  });
});