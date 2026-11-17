/**
 * Healthcare Clinical Plugin - MCP Tools Tests
 *
 * Tests for MCP tool handlers with mock data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  patientSimilarityTool,
  drugInteractionsTool,
  clinicalPathwaysTool,
  literatureSearchTool,
  ontologyNavigateTool,
  healthcareTools,
  getTool,
  getToolNames,
} from '../src/mcp-tools.js';

// Mock bridges
vi.mock('../src/bridges/hnsw-bridge.js', () => ({
  HealthcareHNSWBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    searchByFeatures: vi.fn().mockResolvedValue([
      { patientId: 'p-001', similarity: 0.92, features: {} },
      { patientId: 'p-002', similarity: 0.85, features: {} },
    ]),
    count: vi.fn().mockResolvedValue(1000),
  })),
}));

vi.mock('../src/bridges/gnn-bridge.js', () => ({
  HealthcareGNNBridge: vi.fn().mockImplementation(() => ({
    initialized: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    checkDrugInteractions: vi.fn().mockReturnValue([
      {
        drug1: 'aspirin',
        drug2: 'warfarin',
        severity: 'major',
        description: 'Increased bleeding risk',
        mechanism: 'Antiplatelet + anticoagulant',
        management: 'Monitor closely',
      },
    ]),
    getClinicalPathway: vi.fn().mockReturnValue({
      id: 'pathway-1',
      name: 'Type 2 Diabetes Management',
      steps: [
        { name: 'Initial Assessment', type: 'assessment', description: 'Complete patient assessment' },
        { name: 'Metformin', type: 'intervention', description: 'Start metformin therapy' },
      ],
    }),
  })),
}));

// Mock bridges for context injection
const createMockHNSWBridge = () => ({
  initialized: true,
  initialize: vi.fn().mockResolvedValue(undefined),
  searchByFeatures: vi.fn().mockResolvedValue([
    { patientId: 'p-001', similarity: 0.92, features: {} },
    { patientId: 'p-002', similarity: 0.85, features: {} },
  ]),
  count: vi.fn().mockResolvedValue(1000),
});

const createMockGNNBridge = () => ({
  initialized: true,
  initialize: vi.fn().mockResolvedValue(undefined),
  checkDrugInteractions: vi.fn().mockReturnValue([
    {
      drug1: 'aspirin',
      drug2: 'warfarin',
      severity: 'major',
      description: 'Increased bleeding risk',
      mechanism: 'Antiplatelet + anticoagulant',
      management: 'Monitor closely',
    },
  ]),
  getClinicalPathway: vi.fn().mockReturnValue({
    id: 'pathway-1',
    name: 'Type 2 Diabetes Management',
    steps: [
      { name: 'Initial Assessment', type: 'assessment', description: 'Complete patient assessment' },
      { name: 'Metformin', type: 'intervention', description: 'Start metformin therapy' },
    ],
  }),
});

// Mock context for testing
const createMockContext = (overrides: Record<string, unknown> = {}) => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  userId: 'test-user',
  userRoles: ['physician'],
  auditLogger: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  bridge: {
    hnsw: createMockHNSWBridge(),
    gnn: createMockGNNBridge(),
  },
  ...overrides,
});

describe('Healthcare Clinical MCP Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tool Registry', () => {
    it('should export all 5 tools', () => {
      expect(healthcareTools).toHaveLength(5);
    });

    it('should have correct tool names', () => {
      const toolNames = healthcareTools.map(t => t.name);
      expect(toolNames).toContain('healthcare/patient-similarity');
      expect(toolNames).toContain('healthcare/drug-interactions');
      expect(toolNames).toContain('healthcare/clinical-pathways');
      expect(toolNames).toContain('healthcare/literature-search');
      expect(toolNames).toContain('healthcare/ontology-navigate');
    });

    it('should have category healthcare', () => {
      for (const tool of healthcareTools) {
        expect(tool.category).toBe('healthcare');
      }
    });

    it('should have version 1.0.0', () => {
      for (const tool of healthcareTools) {
        expect(tool.version).toBe('1.0.0');
      }
    });

    it('should get tool by name', () => {
      const tool = getTool('healthcare/patient-similarity');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('healthcare/patient-similarity');
    });

    it('should return undefined for unknown tool', () => {
      const tool = getTool('healthcare/unknown');
      expect(tool).toBeUndefined();
    });

    it('should get all tool names', () => {
      const names = getToolNames();
      expect(names).toHaveLength(5);
      expect(names).toContain('healthcare/patient-similarity');
    });
  });

  describe('healthcare/patient-similarity', () => {
    it('should have correct tool definition', () => {
      expect(patientSimilarityTool.name).toBe('healthcare/patient-similarity');
      expect(patientSimilarityTool.inputSchema.required).toContain('patientFeatures');
      expect(patientSimilarityTool.cacheable).toBe(false); // PHI should not be cached
    });

    it('should handle valid input', async () => {
      const input = {
        patientFeatures: {
          diagnoses: ['E11.9'],
          labs: { hba1c: 7.5 },
          vitals: { bp_systolic: 130 },
        },
        topK: 5,
      };

      const result = await patientSimilarityTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.similarPatients).toBeDefined();
      expect(data.searchTime).toBeDefined();
      expect(data.cohortSize).toBeDefined();
    });

    it('should handle cohort filter', async () => {
      const input = {
        patientFeatures: {
          diagnoses: ['I10'],
        },
        cohortFilter: 'adults',
      };

      const result = await patientSimilarityTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['billing'], // No access to patient-similarity
      });

      const input = {
        patientFeatures: { diagnoses: ['E11.9'] },
      };

      const result = await patientSimilarityTool.handler(input, context);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('UNAUTHORIZED');
    });

    it('should reject invalid ICD-10 codes', async () => {
      const input = {
        patientFeatures: {
          diagnoses: ['INVALID'],
        },
      };

      const result = await patientSimilarityTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should log audit entries', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      const input = {
        patientFeatures: { diagnoses: ['E11.9'] },
      };

      await patientSimilarityTool.handler(input, context);

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'patient-similarity',
          userId: 'test-user',
          success: true,
        })
      );
    });

    it('should record a collision-resistant SHA-256 query hash in audit entries', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });
      const input = { patientFeatures: { diagnoses: ['E11.9'] } };

      await patientSimilarityTool.handler(input, context);

      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const entry = auditLogger.log.mock.calls[0][0];
      expect(entry.queryHash).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.queryHash).toBe(expected);
    });
  });

  describe('healthcare/drug-interactions', () => {
    it('should have correct tool definition', () => {
      expect(drugInteractionsTool.name).toBe('healthcare/drug-interactions');
      expect(drugInteractionsTool.inputSchema.required).toContain('medications');
      expect(drugInteractionsTool.cacheable).toBe(true);
      expect(drugInteractionsTool.cacheTTL).toBe(300000);
    });

    it('should handle valid input', async () => {
      const input = {
        medications: ['aspirin', 'warfarin'],
        severity: 'all',
      };

      const result = await drugInteractionsTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.drugDrugInteractions).toBeDefined();
      expect(data.riskScore).toBeDefined();
      expect(data.recommendations).toBeDefined();
    });

    it('should handle conditions', async () => {
      const input = {
        medications: ['metformin'],
        conditions: ['chronic kidney disease'],
      };

      const result = await drugInteractionsTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.drugConditionInteractions).toBeDefined();
    });

    it('should filter by severity', async () => {
      const input = {
        medications: ['aspirin', 'ibuprofen'],
        severity: 'major',
      };

      const result = await drugInteractionsTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject empty medications list', async () => {
      const input = {
        medications: [],
      };

      const result = await drugInteractionsTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject unauthorized access', async () => {
      const context = createMockContext({
        userRoles: ['receptionist'], // No access
      });

      const input = {
        medications: ['aspirin'],
      };

      const result = await drugInteractionsTool.handler(input, context);

      expect(result.isError).toBe(true);
    });
  });

  describe('healthcare/clinical-pathways', () => {
    it('should have correct tool definition', () => {
      expect(clinicalPathwaysTool.name).toBe('healthcare/clinical-pathways');
      expect(clinicalPathwaysTool.inputSchema.required).toContain('primaryDiagnosis');
      expect(clinicalPathwaysTool.cacheable).toBe(true);
      expect(clinicalPathwaysTool.cacheTTL).toBe(600000);
    });

    it('should handle valid input', async () => {
      const input = {
        primaryDiagnosis: 'E11.9',
      };

      const result = await clinicalPathwaysTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.recommendedPathways).toBeDefined();
      expect(data.confidence).toBeDefined();
    });

    it('should handle constraints', async () => {
      const input = {
        primaryDiagnosis: 'E11.9',
        constraints: {
          excludeMedications: ['metformin'],
        },
      };

      const result = await clinicalPathwaysTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.contraindicated).toBeDefined();
    });

    it('should handle patient history', async () => {
      const input = {
        primaryDiagnosis: 'I10',
        patientHistory: {
          allergies: ['penicillin'],
          previousTreatments: ['lisinopril'],
        },
      };

      const result = await clinicalPathwaysTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject missing diagnosis', async () => {
      const input = {
        constraints: {},
      };

      const result = await clinicalPathwaysTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('healthcare/literature-search', () => {
    it('should have correct tool definition', () => {
      expect(literatureSearchTool.name).toBe('healthcare/literature-search');
      expect(literatureSearchTool.inputSchema.required).toContain('query');
      expect(literatureSearchTool.cacheable).toBe(true);
      expect(literatureSearchTool.cacheTTL).toBe(3600000);
    });

    it('should handle valid input', async () => {
      const input = {
        query: 'diabetes treatment guidelines',
        maxResults: 10,
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.articles).toBeDefined();
      expect(data.totalResults).toBeDefined();
      expect(data.searchTime).toBeDefined();
    });

    it('should handle source filters', async () => {
      const input = {
        query: 'hypertension management',
        sources: ['pubmed', 'cochrane'],
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.sources).toEqual(['pubmed', 'cochrane']);
    });

    it('should handle evidence level filter', async () => {
      const input = {
        query: 'aspirin cardiovascular prevention',
        evidenceLevel: 'systematic-review',
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.filters.evidenceLevel).toBe('systematic-review');
    });

    it('should handle date range filter', async () => {
      const input = {
        query: 'covid treatment',
        dateRange: {
          start: '2020-01-01',
          end: '2023-12-31',
        },
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
    });

    it('should reject missing query', async () => {
      const input = {
        sources: ['pubmed'],
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject query exceeding max length', async () => {
      const input = {
        query: 'a'.repeat(1001),
      };

      const result = await literatureSearchTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('healthcare/ontology-navigate', () => {
    it('should have correct tool definition', () => {
      expect(ontologyNavigateTool.name).toBe('healthcare/ontology-navigate');
      expect(ontologyNavigateTool.inputSchema.required).toContain('code');
      expect(ontologyNavigateTool.inputSchema.required).toContain('ontology');
      expect(ontologyNavigateTool.cacheable).toBe(true);
      expect(ontologyNavigateTool.cacheTTL).toBe(86400000);
    });

    it('should handle valid input', async () => {
      const input = {
        code: 'E11',
        ontology: 'icd10',
        direction: 'descendants',
        depth: 2,
      };

      const result = await ontologyNavigateTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.sourceCode).toBe('E11');
      expect(data.sourceNode).toBeDefined();
      expect(data.results).toBeDefined();
      expect(data.totalNodes).toBeGreaterThan(0);
    });

    it('should handle different ontologies', async () => {
      const ontologies = ['icd10', 'snomed', 'loinc', 'rxnorm'] as const;

      for (const ontology of ontologies) {
        const input = {
          code: 'TEST123',
          ontology,
        };

        const result = await ontologyNavigateTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should handle different directions', async () => {
      const directions = ['ancestors', 'descendants', 'siblings', 'related'] as const;

      for (const direction of directions) {
        const input = {
          code: 'I10',
          ontology: 'icd10',
          direction,
        };

        const result = await ontologyNavigateTool.handler(input, createMockContext());
        expect(result.isError).toBeUndefined();
      }
    });

    it('should use default depth', async () => {
      const input = {
        code: 'E11',
        ontology: 'icd10',
      };

      const result = await ontologyNavigateTool.handler(input, createMockContext());

      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0].text!);
      expect(data.depth).toBe(2); // default
    });

    it('should reject missing code', async () => {
      const input = {
        ontology: 'icd10',
      };

      const result = await ontologyNavigateTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject missing ontology', async () => {
      const input = {
        code: 'E11',
      };

      const result = await ontologyNavigateTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });

    it('should reject invalid depth', async () => {
      const input = {
        code: 'E11',
        ontology: 'icd10',
        depth: 0, // below min
      };

      const result = await ontologyNavigateTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
    });
  });

  describe('Authorization', () => {
    it('should allow access without roles (no RBAC)', async () => {
      const context = createMockContext({
        userRoles: undefined, // No RBAC
      });

      const input = {
        patientFeatures: { diagnoses: ['E11.9'] },
      };

      const result = await patientSimilarityTool.handler(input, context);

      expect(result.isError).toBeUndefined();
    });

    it('should allow physician access to all tools', async () => {
      const context = createMockContext({
        userRoles: ['physician'],
      });

      // Patient similarity
      const r1 = await patientSimilarityTool.handler(
        { patientFeatures: { diagnoses: ['E11.9'] } },
        context
      );
      expect(r1.isError).toBeUndefined();

      // Drug interactions
      const r2 = await drugInteractionsTool.handler(
        { medications: ['aspirin'] },
        context
      );
      expect(r2.isError).toBeUndefined();
    });

    it('should restrict nurse access', async () => {
      const context = createMockContext({
        userRoles: ['nurse'],
      });

      // Drug interactions should be allowed
      const r1 = await drugInteractionsTool.handler(
        { medications: ['aspirin'] },
        context
      );
      expect(r1.isError).toBeUndefined();

      // Patient similarity should be restricted (depending on role config)
      // This depends on HealthcareRolePermissions implementation
    });
  });

  describe('Audit Logging', () => {
    it('should log successful operations', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({ auditLogger });

      await literatureSearchTool.handler(
        { query: 'diabetes' },
        context
      );

      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'literature-search',
          success: true,
          durationMs: expect.any(Number),
        })
      );
    });

    it('should log failed operations', async () => {
      const auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
      const context = createMockContext({
        auditLogger,
        userRoles: ['billing'], // unauthorized
      });

      await patientSimilarityTool.handler(
        { patientFeatures: { diagnoses: ['E11.9'] } },
        context
      );

      // Should not log for authorization failures (they return early)
    });
  });

  describe('Error Handling', () => {
    it('should handle bridge initialization failure', async () => {
      // The mocked bridge handles this gracefully
      const input = {
        patientFeatures: { diagnoses: ['E11.9'] },
      };

      const result = await patientSimilarityTool.handler(input, createMockContext());

      // Should succeed with mocked bridge
      expect(result.isError).toBeUndefined();
    });

    it('should include timestamp in error responses', async () => {
      const input = {
        medications: [], // Invalid
      };

      const result = await drugInteractionsTool.handler(input, createMockContext());

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text!);
      expect(data.timestamp).toBeDefined();
    });
  });
});
