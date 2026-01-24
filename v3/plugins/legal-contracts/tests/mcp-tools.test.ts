/**
 * Legal Contracts Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers with mock data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clauseExtractTool,
  riskAssessTool,
  contractCompareTool,
  obligationTrackTool,
  playbookMatchTool,
  legalContractsTools,
  getTool,
  getToolNames,
} from '../src/mcp-tools.js';

// Mock bridges
vi.mock('../src/bridges/dag-bridge.js', () => ({
  LegalDAGBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    extractClauses: vi.fn().mockResolvedValue([
      {
        id: 'clause-1',
        type: 'indemnification',
        text: 'The Contractor shall indemnify...',
        position: { start: 100, end: 250 },
        confidence: 0.92,
      },
      {
        id: 'clause-2',
        type: 'termination',
        text: 'Either party may terminate...',
        position: { start: 500, end: 650 },
        confidence: 0.88,
      },
    ]),
    analyzeRisks: vi.fn().mockResolvedValue([
      {
        id: 'risk-1',
        category: 'financial',
        severity: 'high',
        description: 'Unlimited liability exposure',
        clause: 'indemnification',
        recommendation: 'Add cap on liability',
      },
    ]),
    compareContracts: vi.fn().mockResolvedValue({
      similarity: 0.75,
      differences: [
        {
          type: 'modification',
          baseText: 'Original clause text',
          compareText: 'Modified clause text',
          significance: 'high',
        },
      ],
    }),
    extractObligations: vi.fn().mockResolvedValue([
      {
        id: 'obl-1',
        type: 'payment',
        description: 'Payment due within 30 days',
        party: 'Buyer',
        deadline: '30 days from invoice',
        status: 'pending',
      },
    ]),
    matchPlaybook: vi.fn().mockResolvedValue({
      matchScore: 0.68,
      deviations: [
        {
          position: 'indemnification',
          expected: 'Mutual indemnification',
          actual: 'One-sided indemnification',
          severity: 'high',
        },
      ],
    }),
  })),
}));

vi.mock('../src/bridges/mincut-bridge.js', () => ({
  LegalMinCutBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock context for testing
const createMockContext = (overrides = {}) => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  userId: 'test-user',
  userRoles: ['partner'],
  auditLogger: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  matterContext: {
    matterId: 'matter-001',
    clientId: 'client-001',
  },
  ...overrides,
});

describe('Legal Contracts MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(legalContractsTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = legalContractsTools.map(t => t.name);
      expect(toolNames).toContain('legal/clause-extract');
      expect(toolNames).toContain('legal/risk-assess');
      expect(toolNames).toContain('legal/contract-compare');
      expect(toolNames).toContain('legal/obligation-track');
      expect(toolNames).toContain('legal/playbook-match');
    });

    it('should have category legal', () => {
      for (const tool of legalContractsTools) {
        expect(tool.category).toBe('legal');
      }
    });

    it('should have version 1.0.0', () => {
      for (const tool of legalContractsTools) {
        expect(tool.version).toBe('1.0.0');
      }
    });

    it('should get tool by name', () => {
      const tool = getTool('legal/clause-extract');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('legal/clause-extract');
    });

    it('should return undefined for unknown tool', () => {
      const tool = getTool('legal/unknown');
      expect(tool).toBeUndefined();
    });

    it('should get all tool names', () => {
      const names = getToolNames();
      expect(names).toHaveLength(5);
      expect(names).toContain('legal/clause-extract');
    });
  });

  describe('legal/clause-extract', () => {
    it('should have correct tool definition', () => {
      expect(clauseExtractTool.name).toBe('legal/clause-extract');
      expect(clauseExtractTool.inputSchema.required).toContain('document');
      expect(clauseExtractTool.cacheable).toBe(true);
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'This Agreement is entered into between Party A and Party B. The Contractor shall indemnify the Client against all claims...',
        clauseTypes: ['indemnification', 'termination'],
        jurisdiction: 'US',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.clauses).toBeDefined();
      expect(data.extractionTime).toBeDefined();
    });

    it('should use default options', async () => {
      const input = {
        document: 'Contract text here...',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.jurisdiction).toBe('US'); // default
    });

    it('should handle matter context', async () => {
      const input = {
        document: 'Contract text...',
        matterContext: {
          matterId: 'matter-123',
          clientId: 'client-456',
        },
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['client'], // No access to clause-extract
      });

      const input = {
        document: 'Contract text...',
      };

      const result = await clauseExtractTool.handler(input, context);

      expect(result.isError).toBe(true);
    });

    it('should reject document exceeding size limit', async () => {
      const input = {
        document: 'a'.repeat(10_000_001),
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('legal/risk-assess', () => {
    it('should have correct tool definition', () => {
      expect(riskAssessTool.name).toBe('legal/risk-assess');
      expect(riskAssessTool.inputSchema.required).toContain('document');
      expect(riskAssessTool.inputSchema.required).toContain('partyRole');
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'This Agreement contains various provisions...',
        partyRole: 'buyer',
        riskCategories: ['financial', 'legal'],
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.risks).toBeDefined();
      expect(data.overallRiskScore).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should handle industry context', async () => {
      const input = {
        document: 'Contract text...',
        partyRole: 'seller',
        industryContext: 'Healthcare',
        threshold: 'high',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject missing partyRole', async () => {
      const input = {
        document: 'Contract text...',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject invalid partyRole', async () => {
      const input = {
        document: 'Contract text...',
        partyRole: 'invalid_role',
      };

      const result = await riskAssessTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should handle all party roles', async () => {
      const roles = ['buyer', 'seller', 'licensor', 'licensee', 'employer', 'employee'] as const;

      for (const partyRole of roles) {
        const input = {
          document: 'Contract text...',
          partyRole,
        };

        const result = await riskAssessTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });
  });

  describe('legal/contract-compare', () => {
    it('should have correct tool definition', () => {
      expect(contractCompareTool.name).toBe('legal/contract-compare');
      expect(contractCompareTool.inputSchema.required).toContain('baseDocument');
      expect(contractCompareTool.inputSchema.required).toContain('compareDocument');
    });

    it('should handle valid input', async () => {
      const input = {
        baseDocument: 'Original contract version...',
        compareDocument: 'Modified contract version...',
        comparisonMode: 'full',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.similarity).toBeDefined();
      expect(data.differences).toBeDefined();
      expect(data.comparisonTime).toBeDefined();
    });

    it('should use default comparison mode', async () => {
      const input = {
        baseDocument: 'Base contract...',
        compareDocument: 'Compare contract...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.mode).toBe('full'); // default
    });

    it('should handle focus clause types', async () => {
      const input = {
        baseDocument: 'Base contract...',
        compareDocument: 'Compare contract...',
        focusClauseTypes: ['termination', 'indemnification'],
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all comparison modes', async () => {
      const modes = ['structural', 'semantic', 'full'] as const;

      for (const comparisonMode of modes) {
        const input = {
          baseDocument: 'Base...',
          compareDocument: 'Compare...',
          comparisonMode,
        };

        const result = await contractCompareTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should reject missing base document', async () => {
      const input = {
        compareDocument: 'Compare contract...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject documents exceeding size limit', async () => {
      const input = {
        baseDocument: 'a'.repeat(10_000_001),
        compareDocument: 'Compare...',
      };

      const result = await contractCompareTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('legal/obligation-track', () => {
    it('should have correct tool definition', () => {
      expect(obligationTrackTool.name).toBe('legal/obligation-track');
      expect(obligationTrackTool.inputSchema.required).toContain('document');
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'Agreement with obligations...',
        party: 'Vendor Inc.',
        obligationTypes: ['payment', 'delivery'],
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.obligations).toBeDefined();
      expect(data.timeline).toBeDefined();
    });

    it('should handle minimal input', async () => {
      const input = {
        document: 'Contract with obligations...',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle timeframe filter', async () => {
      const input = {
        document: 'Contract text...',
        timeframe: 'next 30 days',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all obligation types', async () => {
      const types = [
        'payment', 'delivery', 'notification', 'approval', 'compliance',
        'reporting', 'confidentiality', 'performance', 'insurance',
        'renewal', 'termination',
      ];

      const input = {
        document: 'Contract text...',
        obligationTypes: types,
      };

      const result = await obligationTrackTool.handler(input, createMockContext());
      expect(result.isError).toBeUndefined();
    });

    it('should reject missing document', async () => {
      const input = {
        party: 'Test Party',
      };

      const result = await obligationTrackTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('legal/playbook-match', () => {
    it('should have correct tool definition', () => {
      expect(playbookMatchTool.name).toBe('legal/playbook-match');
      expect(playbookMatchTool.inputSchema.required).toContain('document');
      expect(playbookMatchTool.inputSchema.required).toContain('playbook');
    });

    it('should handle valid input', async () => {
      const input = {
        document: 'Contract to evaluate...',
        playbook: '{"positions": [{"clause": "indemnification", "requirement": "mutual"}]}',
        strictness: 'moderate',
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.matchScore).toBeDefined();
      expect(data.deviations).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should use default strictness', async () => {
      const input = {
        document: 'Contract...',
        playbook: '{}',
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.strictness).toBe('moderate'); // default
    });

    it('should handle priority clauses', async () => {
      const input = {
        document: 'Contract...',
        playbook: '{}',
        prioritizeClauses: ['indemnification', 'liability'],
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should handle all strictness levels', async () => {
      const levels = ['strict', 'moderate', 'flexible'] as const;

      for (const strictness of levels) {
        const input = {
          document: 'Contract...',
          playbook: '{}',
          strictness,
        };

        const result = await playbookMatchTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should reject unauthorized access (playbook-match is partner only)', async () => {
      const context = createMockContext({
        userRoles: ['associate'], // No access to playbook-match
      });

      const input = {
        document: 'Contract...',
        playbook: '{}',
      };

      const result = await playbookMatchTool.handler(input, context);

      expect(result.isError).toBe(true);
    });

    it('should reject playbook exceeding size limit', async () => {
      const input = {
        document: 'Contract...',
        playbook: 'a'.repeat(1_000_001),
      };

      const result = await playbookMatchTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('Authorization & Role Permissions', () => {
    it('should allow partner access to all tools', async () => {
      const context = createMockContext({
        userRoles: ['partner'],
      });

      // All tools should be accessible
      const tools = [
        { tool: clauseExtractTool, input: { document: 'Contract...' } },
        { tool: riskAssessTool, input: { document: 'Contract...', partyRole: 'buyer' } },
        { tool: contractCompareTool, input: { baseDocument: 'Base...', compareDocument: 'Compare...' } },
        { tool: obligationTrackTool, input: { document: 'Contract...' } },
        { tool: playbookMatchTool, input: { document: 'Contract...', playbook: '{}' } },
      ];

      for (const { tool, input } of tools) {
        const result = await tool.handler(input, context);
        expect(result.isError).toBeUndefined();
      }
    });

    it('should restrict paralegal access', async () => {
      const context = createMockContext({
        userRoles: ['paralegal'],
      });

      // Paralegal can access clause-extract and obligation-track
      const r1 = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(r1.isError).toBeUndefined();

      const r2 = await obligationTrackTool.handler({ document: 'Contract...' }, context);
      expect(r2.isError).toBeUndefined();

      // Paralegal cannot access risk-assess
      const r3 = await riskAssessTool.handler({ document: 'Contract...', partyRole: 'buyer' }, context);
      expect(r3.isError).toBe(true);
    });

    it('should deny client access to all tools', async () => {
      const context = createMockContext({
        userRoles: ['client'],
      });

      const r1 = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(r1.isError).toBe(true);
    });

    it('should allow access without roles (no RBAC)', async () => {
      const context = createMockContext({
        userRoles: undefined,
      });

      const result = await clauseExtractTool.handler({ document: 'Contract...' }, context);
      expect(result.isError).toBeUndefined();
    });
  });

  describe('Matter Isolation', () => {
    it('should include matter context in audit logs', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({
        auditLogger,
        matterContext: { matterId: 'matter-001', clientId: 'client-001' },
      });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          matterId: 'matter-001',
        })
      );
    });
  });

  describe('Audit Logging', () => {
    it('should log successful operations', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'clause-extract',
          userId: 'test-user',
          success: true,
        })
      );
    });

    it('should include document hash in audit', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          documentHash: expect.any(String),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle validation errors gracefully', async () => {
      const input = {
        document: '', // Empty document
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text!);
      expect(data.error).toBe(true);
    });

    it('should include error code in response', async () => {
      const context = createMockContext({
        userRoles: ['client'], // Unauthorized
      });

      const result = await clauseExtractTool.handler({ document: 'Contract...' }, context);

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text!);
      expect(data.code).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should include analysis time in results', async () => {
      const input = {
        document: 'Contract text for extraction...',
      };

      const result = await clauseExtractTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.extractionTime).toBeDefined();
      expect(typeof data.extractionTime).toBe('number');
    });
  });
});
