/**
 * Security Scan Tool Tests
 *
 * Tests for the aqe/security-scan MCP tool that provides
 * SAST/DAST security scanning with compliance checking.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mock Types
// ============================================================================

interface SecurityScanInput {
  targetPath: string;
  scanType?: 'sast' | 'dast' | 'both';
  compliance?: string[];
  options?: {
    severity?: 'low' | 'medium' | 'high' | 'critical';
    maxFindings?: number;
    includeRemediation?: boolean;
    timeout?: number;
  };
}

interface SecurityFinding {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  cwe?: string;
  owasp?: string;
  file?: string;
  line?: number;
  code?: string;
  remediation?: string;
  confidence: number;
}

interface ComplianceResult {
  standard: string;
  passed: number;
  failed: number;
  notApplicable: number;
  findings: string[];
}

interface SecurityScanOutput {
  success: boolean;
  findings: SecurityFinding[];
  compliance: ComplianceResult[];
  summary: {
    totalFindings: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    scanDuration: number;
    filesScanned: number;
    passedCompliance: boolean;
  };
  errors?: string[];
}

// ============================================================================
// Mock Implementation
// ============================================================================

class MockSecurityScanTool {
  private knownVulnerabilities: SecurityFinding[] = [
    {
      id: 'SEC-001',
      title: 'SQL Injection',
      description: 'Potential SQL injection vulnerability detected',
      severity: 'critical',
      type: 'injection',
      cwe: 'CWE-89',
      owasp: 'A03:2021',
      file: 'src/db/queries.ts',
      line: 45,
      code: 'db.query(`SELECT * FROM users WHERE id = ${userId}`)',
      remediation: 'Use parameterized queries instead of string interpolation',
      confidence: 0.95,
    },
    {
      id: 'SEC-002',
      title: 'Cross-Site Scripting (XSS)',
      description: 'Potential XSS vulnerability in user input rendering',
      severity: 'high',
      type: 'xss',
      cwe: 'CWE-79',
      owasp: 'A03:2021',
      file: 'src/components/UserProfile.tsx',
      line: 23,
      code: '<div dangerouslySetInnerHTML={{ __html: userInput }} />',
      remediation: 'Sanitize user input before rendering or avoid dangerouslySetInnerHTML',
      confidence: 0.9,
    },
    {
      id: 'SEC-003',
      title: 'Hardcoded Secret',
      description: 'Hardcoded API key detected',
      severity: 'high',
      type: 'secrets',
      cwe: 'CWE-798',
      owasp: 'A02:2021',
      file: 'src/config.ts',
      line: 12,
      code: 'const API_KEY = "sk-1234567890abcdef"',
      remediation: 'Move secrets to environment variables',
      confidence: 0.99,
    },
    {
      id: 'SEC-004',
      title: 'Insecure Direct Object Reference',
      description: 'Potential IDOR vulnerability',
      severity: 'medium',
      type: 'access-control',
      cwe: 'CWE-639',
      owasp: 'A01:2021',
      file: 'src/api/users.ts',
      line: 67,
      code: 'getUser(req.params.id)',
      remediation: 'Verify user authorization before accessing resources',
      confidence: 0.7,
    },
    {
      id: 'SEC-005',
      title: 'Missing Rate Limiting',
      description: 'API endpoint without rate limiting',
      severity: 'low',
      type: 'dos',
      cwe: 'CWE-770',
      owasp: 'A04:2021',
      file: 'src/api/auth.ts',
      line: 15,
      remediation: 'Implement rate limiting middleware',
      confidence: 0.6,
    },
  ];

  async execute(input: SecurityScanInput): Promise<SecurityScanOutput> {
    const startTime = Date.now();

    // Validate input
    const errors = this.validateInput(input);
    if (errors.length > 0) {
      return this.createErrorResponse(errors);
    }

    // Filter findings based on options
    let findings = this.filterFindings(input);

    // Add remediation if requested
    if (input.options?.includeRemediation === false) {
      findings = findings.map((f) => {
        const { remediation, ...rest } = f;
        return rest as SecurityFinding;
      });
    }

    // Limit findings
    if (input.options?.maxFindings) {
      findings = findings.slice(0, input.options.maxFindings);
    }

    // Check compliance
    const compliance = this.checkCompliance(findings, input.compliance ?? []);

    const duration = Date.now() - startTime;

    return {
      success: true,
      findings,
      compliance,
      summary: this.generateSummary(findings, compliance, duration),
    };
  }

  private validateInput(input: SecurityScanInput): string[] {
    const errors: string[] = [];

    if (!input.targetPath) {
      errors.push('targetPath is required');
    }

    if (input.targetPath && !input.targetPath.match(/^[./]/)) {
      errors.push('targetPath must be a valid path');
    }

    if (input.options?.timeout && input.options.timeout < 1000) {
      errors.push('timeout must be at least 1000ms');
    }

    if (input.options?.maxFindings !== undefined && input.options.maxFindings < 1) {
      errors.push('maxFindings must be at least 1');
    }

    return errors;
  }

  private filterFindings(input: SecurityScanInput): SecurityFinding[] {
    let findings = [...this.knownVulnerabilities];

    // Filter by scan type
    if (input.scanType === 'sast') {
      findings = findings.filter((f) => f.file !== undefined);
    } else if (input.scanType === 'dast') {
      // DAST focuses on runtime vulnerabilities
      findings = findings.filter((f) => ['injection', 'xss', 'access-control'].includes(f.type));
    }

    // Filter by severity
    if (input.options?.severity) {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const minSeverity = severityOrder[input.options.severity];
      findings = findings.filter((f) => severityOrder[f.severity] <= minSeverity);
    }

    return findings;
  }

  private checkCompliance(
    findings: SecurityFinding[],
    standards: string[]
  ): ComplianceResult[] {
    const results: ComplianceResult[] = [];

    for (const standard of standards) {
      const result = this.checkStandard(standard, findings);
      results.push(result);
    }

    return results;
  }

  private checkStandard(standard: string, findings: SecurityFinding[]): ComplianceResult {
    const standardLower = standard.toLowerCase();

    if (standardLower.includes('owasp')) {
      const owaspFindings = findings.filter((f) => f.owasp);
      return {
        standard,
        passed: 10 - owaspFindings.length,
        failed: owaspFindings.length,
        notApplicable: 0,
        findings: owaspFindings.map((f) => f.id),
      };
    }

    if (standardLower.includes('sans')) {
      const criticalFindings = findings.filter(
        (f) => f.severity === 'critical' || f.severity === 'high'
      );
      return {
        standard,
        passed: 25 - criticalFindings.length,
        failed: criticalFindings.length,
        notApplicable: 0,
        findings: criticalFindings.map((f) => f.id),
      };
    }

    // Generic compliance check
    return {
      standard,
      passed: 20 - findings.length,
      failed: findings.length,
      notApplicable: 0,
      findings: findings.map((f) => f.id),
    };
  }

  private generateSummary(
    findings: SecurityFinding[],
    compliance: ComplianceResult[],
    duration: number
  ): SecurityScanOutput['summary'] {
    const criticalCount = findings.filter((f) => f.severity === 'critical').length;
    const highCount = findings.filter((f) => f.severity === 'high').length;
    const mediumCount = findings.filter((f) => f.severity === 'medium').length;
    const lowCount = findings.filter((f) => f.severity === 'low').length;

    const passedCompliance = compliance.every((c) => c.failed === 0);

    return {
      totalFindings: findings.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      scanDuration: duration,
      filesScanned: 42, // Mock value
      passedCompliance,
    };
  }

  private createErrorResponse(errors: string[]): SecurityScanOutput {
    return {
      success: false,
      findings: [],
      compliance: [],
      summary: {
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        scanDuration: 0,
        filesScanned: 0,
        passedCompliance: false,
      },
      errors,
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('SecurityScanTool', () => {
  let tool: MockSecurityScanTool;

  beforeEach(() => {
    tool = new MockSecurityScanTool();
  });

  describe('input validation', () => {
    it('should require targetPath', async () => {
      const result = await tool.execute({ targetPath: '' });

      expect(result.success).toBe(false);
      expect(result.errors).toContain('targetPath is required');
    });

    it('should validate targetPath format', async () => {
      const result = await tool.execute({ targetPath: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('valid path'))).toBe(true);
    });

    it('should accept valid paths', async () => {
      const relativeResult = await tool.execute({ targetPath: './src' });
      const absoluteResult = await tool.execute({ targetPath: '/workspace/src' });

      expect(relativeResult.success).toBe(true);
      expect(absoluteResult.success).toBe(true);
    });

    it('should validate timeout minimum', async () => {
      const result = await tool.execute({
        targetPath: './src',
        options: { timeout: 500 },
      });

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('timeout'))).toBe(true);
    });

    it('should validate maxFindings minimum', async () => {
      const result = await tool.execute({
        targetPath: './src',
        options: { maxFindings: 0 },
      });

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.includes('maxFindings'))).toBe(true);
    });
  });

  describe('finding detection', () => {
    it('should detect security findings', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.success).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('should include finding ID', async () => {
      const result = await tool.execute({ targetPath: './src' });

      for (const finding of result.findings) {
        expect(finding.id).toBeTruthy();
        expect(finding.id).toMatch(/^SEC-/);
      }
    });

    it('should include finding title and description', async () => {
      const result = await tool.execute({ targetPath: './src' });

      for (const finding of result.findings) {
        expect(finding.title).toBeTruthy();
        expect(finding.description).toBeTruthy();
      }
    });

    it('should include severity level', async () => {
      const result = await tool.execute({ targetPath: './src' });

      for (const finding of result.findings) {
        expect(['low', 'medium', 'high', 'critical']).toContain(finding.severity);
      }
    });

    it('should include CWE reference when available', async () => {
      const result = await tool.execute({ targetPath: './src' });

      const findingsWithCwe = result.findings.filter((f) => f.cwe);
      expect(findingsWithCwe.length).toBeGreaterThan(0);

      for (const finding of findingsWithCwe) {
        expect(finding.cwe).toMatch(/^CWE-\d+$/);
      }
    });

    it('should include OWASP reference when available', async () => {
      const result = await tool.execute({ targetPath: './src' });

      const findingsWithOwasp = result.findings.filter((f) => f.owasp);
      expect(findingsWithOwasp.length).toBeGreaterThan(0);
    });

    it('should include file and line for SAST findings', async () => {
      const result = await tool.execute({
        targetPath: './src',
        scanType: 'sast',
      });

      for (const finding of result.findings) {
        expect(finding.file).toBeTruthy();
        expect(finding.line).toBeGreaterThan(0);
      }
    });

    it('should include confidence score', async () => {
      const result = await tool.execute({ targetPath: './src' });

      for (const finding of result.findings) {
        expect(finding.confidence).toBeGreaterThan(0);
        expect(finding.confidence).toBeLessThanOrEqual(1);
      }
    });

    it('should include remediation by default', async () => {
      const result = await tool.execute({ targetPath: './src' });

      const findingsWithRemediation = result.findings.filter((f) => f.remediation);
      expect(findingsWithRemediation.length).toBeGreaterThan(0);
    });

    it('should exclude remediation when disabled', async () => {
      const result = await tool.execute({
        targetPath: './src',
        options: { includeRemediation: false },
      });

      const findingsWithRemediation = result.findings.filter((f) => f.remediation);
      expect(findingsWithRemediation.length).toBe(0);
    });
  });

  describe('scan type filtering', () => {
    it('should default to both scan types', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('should filter for SAST only', async () => {
      const result = await tool.execute({
        targetPath: './src',
        scanType: 'sast',
      });

      // All findings should have file references
      expect(result.findings.every((f) => f.file !== undefined)).toBe(true);
    });

    it('should filter for DAST only', async () => {
      const result = await tool.execute({
        targetPath: './src',
        scanType: 'dast',
      });

      // DAST focuses on runtime vulnerabilities
      const dastTypes = ['injection', 'xss', 'access-control'];
      expect(result.findings.every((f) => dastTypes.includes(f.type))).toBe(true);
    });
  });

  describe('severity filtering', () => {
    it('should filter by severity threshold', async () => {
      const criticalResult = await tool.execute({
        targetPath: './src',
        options: { severity: 'critical' },
      });

      const highResult = await tool.execute({
        targetPath: './src',
        options: { severity: 'high' },
      });

      expect(criticalResult.findings.length).toBeLessThanOrEqual(highResult.findings.length);
      expect(criticalResult.findings.every((f) => f.severity === 'critical')).toBe(true);
    });

    it('should include critical and high for high threshold', async () => {
      const result = await tool.execute({
        targetPath: './src',
        options: { severity: 'high' },
      });

      expect(result.findings.every((f) => f.severity === 'critical' || f.severity === 'high')).toBe(
        true
      );
    });
  });

  describe('compliance checking', () => {
    it('should check OWASP compliance', async () => {
      const result = await tool.execute({
        targetPath: './src',
        compliance: ['owasp-top-10'],
      });

      expect(result.compliance.length).toBe(1);
      expect(result.compliance[0].standard).toBe('owasp-top-10');
      expect(result.compliance[0].passed).toBeDefined();
      expect(result.compliance[0].failed).toBeDefined();
    });

    it('should check SANS compliance', async () => {
      const result = await tool.execute({
        targetPath: './src',
        compliance: ['sans-25'],
      });

      expect(result.compliance.length).toBe(1);
      expect(result.compliance[0].standard).toBe('sans-25');
    });

    it('should check multiple standards', async () => {
      const result = await tool.execute({
        targetPath: './src',
        compliance: ['owasp-top-10', 'sans-25'],
      });

      expect(result.compliance.length).toBe(2);
    });

    it('should link findings to compliance failures', async () => {
      const result = await tool.execute({
        targetPath: './src',
        compliance: ['owasp-top-10'],
      });

      expect(result.compliance[0].findings).toBeDefined();
      expect(Array.isArray(result.compliance[0].findings)).toBe(true);
    });
  });

  describe('summary generation', () => {
    it('should include total finding count', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.summary.totalFindings).toBe(result.findings.length);
    });

    it('should count findings by severity', async () => {
      const result = await tool.execute({ targetPath: './src' });

      const critical = result.findings.filter((f) => f.severity === 'critical').length;
      const high = result.findings.filter((f) => f.severity === 'high').length;
      const medium = result.findings.filter((f) => f.severity === 'medium').length;
      const low = result.findings.filter((f) => f.severity === 'low').length;

      expect(result.summary.criticalCount).toBe(critical);
      expect(result.summary.highCount).toBe(high);
      expect(result.summary.mediumCount).toBe(medium);
      expect(result.summary.lowCount).toBe(low);
    });

    it('should report scan duration', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.summary.scanDuration).toBeGreaterThanOrEqual(0);
    });

    it('should report files scanned', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.summary.filesScanned).toBeGreaterThan(0);
    });

    it('should report compliance status', async () => {
      const result = await tool.execute({
        targetPath: './src',
        compliance: ['owasp-top-10'],
      });

      expect(typeof result.summary.passedCompliance).toBe('boolean');
    });
  });

  describe('finding limits', () => {
    it('should respect maxFindings limit', async () => {
      const result = await tool.execute({
        targetPath: './src',
        options: { maxFindings: 2 },
      });

      expect(result.findings.length).toBeLessThanOrEqual(2);
    });

    it('should return all findings when no limit', async () => {
      const result = await tool.execute({ targetPath: './src' });

      expect(result.findings.length).toBeGreaterThan(2);
    });
  });
});

describe('SecurityScanTool Common Vulnerabilities', () => {
  let tool: MockSecurityScanTool;

  beforeEach(() => {
    tool = new MockSecurityScanTool();
  });

  it('should detect SQL injection', async () => {
    const result = await tool.execute({ targetPath: './src' });

    const sqlInjection = result.findings.find(
      (f) => f.type === 'injection' && f.title.includes('SQL')
    );
    expect(sqlInjection).toBeDefined();
    expect(sqlInjection?.severity).toBe('critical');
    expect(sqlInjection?.cwe).toBe('CWE-89');
  });

  it('should detect XSS vulnerabilities', async () => {
    const result = await tool.execute({ targetPath: './src' });

    const xss = result.findings.find((f) => f.type === 'xss');
    expect(xss).toBeDefined();
    expect(xss?.cwe).toBe('CWE-79');
  });

  it('should detect hardcoded secrets', async () => {
    const result = await tool.execute({ targetPath: './src' });

    const secrets = result.findings.find((f) => f.type === 'secrets');
    expect(secrets).toBeDefined();
    expect(secrets?.confidence).toBeGreaterThan(0.9);
  });

  it('should detect access control issues', async () => {
    const result = await tool.execute({ targetPath: './src' });

    const accessControl = result.findings.find((f) => f.type === 'access-control');
    expect(accessControl).toBeDefined();
  });
});

describe('SecurityScanTool Performance', () => {
  let tool: MockSecurityScanTool;

  beforeEach(() => {
    tool = new MockSecurityScanTool();
  });

  it('should complete scan in reasonable time', async () => {
    const startTime = performance.now();

    const result = await tool.execute({ targetPath: './src' });

    const duration = performance.now() - startTime;

    expect(result.success).toBe(true);
    // Should complete in under 100ms for mock
    expect(duration).toBeLessThan(100);
  });

  it('should report scan duration in summary', async () => {
    const result = await tool.execute({ targetPath: './src' });

    expect(result.summary.scanDuration).toBeGreaterThanOrEqual(0);
  });
});
