/**
 * Gas Town Bridge Type Schema Tests
 *
 * Tests for Zod schema validation of Gas Town types including
 * Bead, Formula, Convoy, and related structures.
 * Uses London School TDD approach with mock-first design.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ============================================================================
// Zod Schemas
// ============================================================================

// Bead status enum
const BeadStatusSchema = z.enum(['open', 'in_progress', 'closed']);

// Bead schema (matching Gas Town's beads.db schema)
const BeadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).default(''),
  status: BeadStatusSchema.default('open'),
  priority: z.number().int().min(0).max(4).default(2),
  labels: z.array(z.string()).default([]),
  parent_id: z.string().optional(),
  created_at: z.string().datetime().or(z.date()),
  updated_at: z.string().datetime().or(z.date()),
  assignee: z.string().optional(),
  rig: z.string().optional(),
});

// Create bead options schema
const CreateBeadOptionsSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  priority: z.number().int().min(0).max(4).optional(),
  labels: z.array(z.string()).optional(),
  parent: z.string().optional(),
});

// Formula type enum
const FormulaTypeSchema = z.enum(['convoy', 'workflow', 'expansion', 'aspect']);

// Formula step schema
const StepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  needs: z.array(z.string()).optional(),
});

// Formula leg schema (for convoy formulas)
const LegSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  focus: z.string(),
  description: z.string().default(''),
});

// Formula variable schema
const VarSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'array']).default('string'),
  default: z.unknown().optional(),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

// Synthesis schema
const SynthesisSchema = z.object({
  template: z.string(),
  vars: z.record(z.string(), z.string()).optional(),
});

// Template schema (for expansion formulas)
const TemplateSchema = z.object({
  id: z.string(),
  content: z.string(),
  vars: z.array(z.string()).optional(),
});

// Aspect schema
const AspectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  applies_to: z.array(z.string()).optional(),
});

// Full Formula schema
const FormulaSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/i),
  description: z.string().max(1000).default(''),
  type: FormulaTypeSchema,
  version: z.number().int().positive().default(1),
  // Convoy-specific
  legs: z.array(LegSchema).optional(),
  synthesis: SynthesisSchema.optional(),
  // Workflow-specific
  steps: z.array(StepSchema).optional(),
  vars: z.record(z.string(), VarSchema).optional(),
  // Expansion-specific
  template: z.array(TemplateSchema).optional(),
  // Aspect-specific
  aspects: z.array(AspectSchema).optional(),
});

// Convoy progress schema
const ConvoyProgressSchema = z.object({
  total: z.number().int().min(0),
  closed: z.number().int().min(0),
  in_progress: z.number().int().min(0),
});

// Convoy status enum
const ConvoyStatusSchema = z.enum(['active', 'landed', 'failed', 'paused']);

// Full Convoy schema
const ConvoySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  tracked_issues: z.array(z.string()),
  status: ConvoyStatusSchema.default('active'),
  started_at: z.string().datetime().or(z.date()),
  completed_at: z.string().datetime().or(z.date()).optional(),
  progress: ConvoyProgressSchema,
});

// Agent role enum
const AgentRoleSchema = z.enum([
  'mayor',
  'polecat',
  'refinery',
  'witness',
  'deacon',
  'dog',
  'crew',
]);

// Agent schema
const AgentSchema = z.object({
  id: z.string().min(1),
  role: AgentRoleSchema,
  status: z.enum(['active', 'idle', 'busy', 'error']),
  rig: z.string().optional(),
  current_bead: z.string().optional(),
  started_at: z.string().datetime().or(z.date()).optional(),
});

// Cooked formula schema (after variable substitution)
const CookedFormulaSchema = FormulaSchema.extend({
  cooked_at: z.string().datetime().or(z.date()),
  vars_applied: z.record(z.string(), z.string()),
});

// ============================================================================
// Tests - BeadSchema
// ============================================================================

describe('BeadSchema', () => {
  describe('valid beads', () => {
    it('should accept minimal valid bead', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test Bead',
        description: '',
        status: 'open',
        priority: 2,
        labels: [],
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should accept full bead with all fields', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Complete Bead',
        description: 'A detailed description',
        status: 'in_progress',
        priority: 1,
        labels: ['urgent', 'bug', 'backend'],
        parent_id: 'gt-parent1',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T12:00:00Z',
        assignee: 'developer-1',
        rig: 'town',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should accept Date objects for timestamps', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test Bead',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should apply default values', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test Bead',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.parse(bead);
      expect(result.description).toBe('');
      expect(result.status).toBe('open');
      expect(result.priority).toBe(2);
      expect(result.labels).toEqual([]);
    });
  });

  describe('invalid beads', () => {
    it('should reject empty id', () => {
      const bead = {
        id: '',
        title: 'Test',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject empty title', () => {
      const bead = {
        id: 'gt-abc12',
        title: '',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject title exceeding max length', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'x'.repeat(501),
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        status: 'invalid_status',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject invalid priority', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        priority: 5, // Max is 4
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject negative priority', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        priority: -1,
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });

    it('should reject invalid datetime format', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        created_at: 'not-a-date',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Tests - CreateBeadOptionsSchema
// ============================================================================

describe('CreateBeadOptionsSchema', () => {
  it('should accept minimal create options', () => {
    const opts = { title: 'New Task' };
    const result = CreateBeadOptionsSchema.safeParse(opts);
    expect(result.success).toBe(true);
  });

  it('should accept full create options', () => {
    const opts = {
      title: 'New Task',
      description: 'Task description',
      priority: 1,
      labels: ['urgent', 'backend'],
      parent: 'gt-parent1',
    };

    const result = CreateBeadOptionsSchema.safeParse(opts);
    expect(result.success).toBe(true);
  });

  it('should reject missing title', () => {
    const opts = { description: 'No title' };
    const result = CreateBeadOptionsSchema.safeParse(opts);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests - FormulaSchema
// ============================================================================

describe('FormulaSchema', () => {
  describe('valid formulas', () => {
    it('should accept workflow formula with steps', () => {
      const formula = {
        name: 'feature-workflow',
        description: 'Standard feature workflow',
        type: 'workflow',
        version: 1,
        steps: [
          { id: 'design', title: 'Design', description: 'Design the feature' },
          { id: 'implement', title: 'Implement', description: 'Write code', needs: ['design'] },
          { id: 'test', title: 'Test', description: 'Write tests', needs: ['implement'] },
        ],
        vars: {
          feature_name: { type: 'string', required: true },
          branch_prefix: { type: 'string', default: 'feature/' },
        },
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(true);
    });

    it('should accept convoy formula with legs', () => {
      const formula = {
        name: 'release-convoy',
        description: 'Release convoy',
        type: 'convoy',
        version: 1,
        legs: [
          { id: 'prepare', title: 'Prepare Release', focus: 'changelog', description: 'Update changelog' },
          { id: 'build', title: 'Build', focus: 'artifacts', description: 'Build artifacts' },
        ],
        synthesis: {
          template: 'Release {{version}}',
          vars: { version: '1.0.0' },
        },
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(true);
    });

    it('should accept expansion formula with templates', () => {
      const formula = {
        name: 'component-expansion',
        type: 'expansion',
        version: 1,
        template: [
          { id: 'component', content: 'Create {{name}} component', vars: ['name'] },
          { id: 'test', content: 'Add tests for {{name}}', vars: ['name'] },
        ],
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(true);
    });

    it('should accept aspect formula', () => {
      const formula = {
        name: 'security-aspect',
        type: 'aspect',
        version: 1,
        aspects: [
          { id: 'auth', name: 'Authentication', description: 'Auth checks', applies_to: ['api'] },
          { id: 'validate', name: 'Validation', applies_to: ['input'] },
        ],
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid formulas', () => {
    it('should reject formula without name', () => {
      const formula = {
        type: 'workflow',
        version: 1,
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(false);
    });

    it('should reject formula with invalid name format', () => {
      const formula = {
        name: '123-invalid', // Must start with letter
        type: 'workflow',
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(false);
    });

    it('should reject formula with special chars in name', () => {
      const formula = {
        name: 'my;formula',
        type: 'workflow',
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(false);
    });

    it('should reject invalid formula type', () => {
      const formula = {
        name: 'my-formula',
        type: 'invalid_type',
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(false);
    });

    it('should reject non-positive version', () => {
      const formula = {
        name: 'my-formula',
        type: 'workflow',
        version: 0,
      };

      const result = FormulaSchema.safeParse(formula);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Tests - ConvoySchema
// ============================================================================

describe('ConvoySchema', () => {
  describe('valid convoys', () => {
    it('should accept active convoy', () => {
      const convoy = {
        id: 'conv-abc123',
        name: 'Feature Sprint',
        tracked_issues: ['gt-1', 'gt-2', 'gt-3'],
        status: 'active',
        started_at: '2026-01-24T10:00:00Z',
        progress: {
          total: 3,
          closed: 1,
          in_progress: 1,
        },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(true);
    });

    it('should accept completed convoy', () => {
      const convoy = {
        id: 'conv-def456',
        name: 'Completed Work',
        tracked_issues: ['gt-1', 'gt-2'],
        status: 'landed',
        started_at: '2026-01-20T10:00:00Z',
        completed_at: '2026-01-24T15:00:00Z',
        progress: {
          total: 2,
          closed: 2,
          in_progress: 0,
        },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(true);
    });

    it('should apply default status', () => {
      const convoy = {
        id: 'conv-ghi789',
        name: 'New Convoy',
        tracked_issues: ['gt-1'],
        started_at: '2026-01-24T10:00:00Z',
        progress: { total: 1, closed: 0, in_progress: 0 },
      };

      const result = ConvoySchema.parse(convoy);
      expect(result.status).toBe('active');
    });
  });

  describe('invalid convoys', () => {
    it('should reject missing name', () => {
      const convoy = {
        id: 'conv-abc123',
        tracked_issues: ['gt-1'],
        started_at: '2026-01-24T10:00:00Z',
        progress: { total: 1, closed: 0, in_progress: 0 },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const convoy = {
        id: 'conv-abc123',
        name: 'Test',
        tracked_issues: [],
        status: 'invalid_status',
        started_at: '2026-01-24T10:00:00Z',
        progress: { total: 0, closed: 0, in_progress: 0 },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(false);
    });

    it('should reject negative progress counts', () => {
      const convoy = {
        id: 'conv-abc123',
        name: 'Test',
        tracked_issues: [],
        started_at: '2026-01-24T10:00:00Z',
        progress: { total: -1, closed: 0, in_progress: 0 },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Tests - AgentSchema
// ============================================================================

describe('AgentSchema', () => {
  describe('valid agents', () => {
    it('should accept mayor agent', () => {
      const agent = {
        id: 'mayor-1',
        role: 'mayor',
        status: 'active',
        rig: 'town',
      };

      const result = AgentSchema.safeParse(agent);
      expect(result.success).toBe(true);
    });

    it('should accept polecat with current work', () => {
      const agent = {
        id: 'polecat-abc12',
        role: 'polecat',
        status: 'busy',
        current_bead: 'gt-task123',
        started_at: '2026-01-24T10:00:00Z',
      };

      const result = AgentSchema.safeParse(agent);
      expect(result.success).toBe(true);
    });

    it('should accept all valid roles', () => {
      const roles = ['mayor', 'polecat', 'refinery', 'witness', 'deacon', 'dog', 'crew'];

      for (const role of roles) {
        const agent = { id: `${role}-1`, role, status: 'idle' };
        const result = AgentSchema.safeParse(agent);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid agents', () => {
    it('should reject invalid role', () => {
      const agent = {
        id: 'invalid-1',
        role: 'invalid_role',
        status: 'active',
      };

      const result = AgentSchema.safeParse(agent);
      expect(result.success).toBe(false);
    });

    it('should reject invalid status', () => {
      const agent = {
        id: 'mayor-1',
        role: 'mayor',
        status: 'invalid_status',
      };

      const result = AgentSchema.safeParse(agent);
      expect(result.success).toBe(false);
    });
  });
});

// ============================================================================
// Tests - StepSchema
// ============================================================================

describe('StepSchema', () => {
  it('should accept step with dependencies', () => {
    const step = {
      id: 'implement',
      title: 'Implementation',
      description: 'Write the code',
      needs: ['design', 'spec'],
    };

    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should accept step without dependencies', () => {
    const step = {
      id: 'design',
      title: 'Design Phase',
    };

    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(true);
  });

  it('should apply default description', () => {
    const step = { id: 'test', title: 'Test' };
    const result = StepSchema.parse(step);
    expect(result.description).toBe('');
  });

  it('should reject missing id', () => {
    const step = { title: 'No ID' };
    const result = StepSchema.safeParse(step);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests - CookedFormulaSchema
// ============================================================================

describe('CookedFormulaSchema', () => {
  it('should accept cooked formula with applied vars', () => {
    const cooked = {
      name: 'feature-workflow',
      type: 'workflow',
      version: 1,
      steps: [
        { id: 'implement', title: 'Implement auth module' },
      ],
      cooked_at: '2026-01-24T10:00:00Z',
      vars_applied: {
        feature_name: 'auth',
        branch_prefix: 'feature/',
      },
    };

    const result = CookedFormulaSchema.safeParse(cooked);
    expect(result.success).toBe(true);
  });

  it('should require cooked_at timestamp', () => {
    const cooked = {
      name: 'test',
      type: 'workflow',
      vars_applied: {},
    };

    const result = CookedFormulaSchema.safeParse(cooked);
    expect(result.success).toBe(false);
  });

  it('should require vars_applied record', () => {
    const cooked = {
      name: 'test',
      type: 'workflow',
      cooked_at: '2026-01-24T10:00:00Z',
    };

    const result = CookedFormulaSchema.safeParse(cooked);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests - VarSchema
// ============================================================================

describe('VarSchema', () => {
  it('should accept string variable', () => {
    const v = {
      type: 'string',
      default: 'value',
      required: true,
      description: 'A string var',
    };

    const result = VarSchema.safeParse(v);
    expect(result.success).toBe(true);
  });

  it('should accept number variable', () => {
    const v = { type: 'number', default: 42 };
    const result = VarSchema.safeParse(v);
    expect(result.success).toBe(true);
  });

  it('should accept boolean variable', () => {
    const v = { type: 'boolean', default: true };
    const result = VarSchema.safeParse(v);
    expect(result.success).toBe(true);
  });

  it('should accept array variable', () => {
    const v = { type: 'array', default: ['a', 'b'] };
    const result = VarSchema.safeParse(v);
    expect(result.success).toBe(true);
  });

  it('should apply defaults', () => {
    const v = {};
    const result = VarSchema.parse(v);
    expect(result.type).toBe('string');
    expect(result.required).toBe(false);
  });

  it('should reject invalid type', () => {
    const v = { type: 'invalid' };
    const result = VarSchema.safeParse(v);
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// Tests - Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  describe('unicode handling', () => {
    it('should accept unicode in bead title', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Fix bug in \u4e2d\u6587 module',
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should accept emoji in labels', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        labels: ['bug', 'urgent'],
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });
  });

  describe('boundary values', () => {
    it('should accept maximum length title', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'x'.repeat(500),
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should accept priority boundaries', () => {
      for (const priority of [0, 1, 2, 3, 4]) {
        const bead = {
          id: 'gt-abc12',
          title: 'Test',
          priority,
          created_at: '2026-01-24T10:00:00Z',
          updated_at: '2026-01-24T10:00:00Z',
        };

        const result = BeadSchema.safeParse(bead);
        expect(result.success).toBe(true);
      }
    });

    it('should accept maximum description length', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        description: 'x'.repeat(10000),
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should reject description exceeding max', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        description: 'x'.repeat(10001),
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(false);
    });
  });

  describe('empty arrays', () => {
    it('should accept empty labels array', () => {
      const bead = {
        id: 'gt-abc12',
        title: 'Test',
        labels: [],
        created_at: '2026-01-24T10:00:00Z',
        updated_at: '2026-01-24T10:00:00Z',
      };

      const result = BeadSchema.safeParse(bead);
      expect(result.success).toBe(true);
    });

    it('should accept empty tracked_issues in convoy', () => {
      const convoy = {
        id: 'conv-abc123',
        name: 'Empty Convoy',
        tracked_issues: [],
        started_at: '2026-01-24T10:00:00Z',
        progress: { total: 0, closed: 0, in_progress: 0 },
      };

      const result = ConvoySchema.safeParse(convoy);
      expect(result.success).toBe(true);
    });
  });
});
