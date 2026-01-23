/**
 * Beads SPARC Integration Tests
 *
 * TDD London School tests for BeadsSparc.
 * Tests focus on behavior verification through mocks, testing how SPARC phases
 * interact with Beads issue creation and dependency management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BeadsSparc,
  type Specification,
  type Architecture,
  type TddResult,
  type RefinementResult,
  type CompletionResult
} from '../../src/beads/sparc.js';
import type { BeadsCliWrapper } from '../../src/beads/cli-wrapper.js';
import type { BeadsIssue } from '../../src/beads/types.js';

describe('BeadsSparc', () => {
  let sparc: BeadsSparc;
  let mockWrapper: Partial<BeadsCliWrapper>;
  let issueIdCounter: number;

  beforeEach(() => {
    issueIdCounter = 0;
    mockWrapper = {
      create: vi.fn().mockImplementation(() => {
        issueIdCounter++;
        return Promise.resolve({
          success: true,
          exitCode: 0,
          data: {
            id: `bd-${issueIdCounter}`,
            title: 'Created Issue',
            status: 'open',
            priority: 1,
            type: 'task',
            labels: [],
            dependencies: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as BeadsIssue
        });
      }),
      depAdd: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      close: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      list: vi.fn().mockResolvedValue({ success: true, exitCode: 0, data: [] }),
    };
    sparc = new BeadsSparc(mockWrapper as BeadsCliWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('onSpecificationComplete', () => {
    it('should create epic from specification', async () => {
      const spec: Specification = {
        name: 'Auth System',
        summary: 'User authentication and authorization system',
        requirements: [],
      };

      await sparc.onSpecificationComplete(spec);

      expect(mockWrapper.create).toHaveBeenCalledWith({
        title: 'Auth System',
        description: 'User authentication and authorization system',
        type: 'epic',
        priority: 1,
        labels: ['sparc', 'specification'],
      });
    });

    it('should create child tasks from requirements', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [
          { name: 'Login', acceptance_criteria: 'Users can login with email/password' },
          { name: 'Logout', acceptance_criteria: 'Users can logout and session is cleared' },
        ],
      };

      await sparc.onSpecificationComplete(spec);

      // Should create epic + 2 tasks = 3 create calls
      expect(mockWrapper.create).toHaveBeenCalledTimes(3);
    });

    it('should add dependencies from tasks to epic', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [
          { name: 'Login', acceptance_criteria: 'Can login' },
        ],
      };

      await sparc.onSpecificationComplete(spec);

      expect(mockWrapper.depAdd).toHaveBeenCalledWith({
        from_id: 'bd-2', // Task
        to_id: 'bd-1',   // Epic
        type: 'parent-child',
      });
    });

    it('should include acceptance criteria in task description', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [
          { name: 'Login', acceptance_criteria: 'Users can login with email/password' },
        ],
      };

      await sparc.onSpecificationComplete(spec);

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Login',
          description: expect.stringContaining('Users can login with email/password'),
        })
      );
    });

    it('should set task type for requirements', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [
          { name: 'Login', acceptance_criteria: 'Can login' },
        ],
      };

      await sparc.onSpecificationComplete(spec);

      // Second call is for the task
      expect(mockWrapper.create).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          type: 'task',
          labels: expect.arrayContaining(['sparc', 'requirement']),
        })
      );
    });

    it('should return the created epic', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [],
      };

      const epic = await sparc.onSpecificationComplete(spec);

      expect(epic).toBeDefined();
      expect(epic?.id).toBe('bd-1');
    });

    it('should return null on creation failure', async () => {
      (mockWrapper.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        exitCode: 1,
        error: 'Failed to create'
      });

      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [],
      };

      const epic = await sparc.onSpecificationComplete(spec);

      expect(epic).toBeNull();
    });

    it('should handle empty requirements', async () => {
      const spec: Specification = {
        name: 'Auth',
        summary: 'Auth system',
        requirements: [],
      };

      await sparc.onSpecificationComplete(spec);

      // Only epic should be created
      expect(mockWrapper.create).toHaveBeenCalledTimes(1);
      expect(mockWrapper.depAdd).not.toHaveBeenCalled();
    });
  });

  describe('onPseudocodeComplete', () => {
    it('should create tasks for pseudocode modules', async () => {
      const pseudocode = {
        modules: [
          { name: 'AuthModule', description: 'Handles authentication', steps: ['1. Validate input', '2. Check credentials'] },
          { name: 'SessionModule', description: 'Manages sessions', steps: ['1. Create session', '2. Store token'] },
        ],
      };

      await sparc.onPseudocodeComplete(pseudocode);

      expect(mockWrapper.create).toHaveBeenCalledTimes(2);
      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('AuthModule'),
          labels: expect.arrayContaining(['sparc', 'pseudocode']),
        })
      );
    });

    it('should include steps in task description', async () => {
      const pseudocode = {
        modules: [
          { name: 'AuthModule', description: 'Auth handling', steps: ['Validate input', 'Check credentials'] },
        ],
      };

      await sparc.onPseudocodeComplete(pseudocode);

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining('Validate input'),
        })
      );
    });

    it('should link to epic if provided', async () => {
      const pseudocode = {
        modules: [
          { name: 'AuthModule', description: 'Auth', steps: [] },
        ],
        epic_id: 'bd-epic-1',
      };

      await sparc.onPseudocodeComplete(pseudocode);

      expect(mockWrapper.depAdd).toHaveBeenCalledWith({
        from_id: 'bd-1',
        to_id: 'bd-epic-1',
        type: 'parent-child',
      });
    });
  });

  describe('onArchitectureComplete', () => {
    it('should create component issues', async () => {
      const arch: Architecture = {
        components: [
          { name: 'AuthService', specification: 'Handles user authentication', layer: 'service' },
          { name: 'UserRepository', specification: 'Data access for users', layer: 'repository' },
        ],
      };

      await sparc.onArchitectureComplete(arch);

      expect(mockWrapper.create).toHaveBeenCalledTimes(2);
    });

    it('should include component details in issue', async () => {
      const arch: Architecture = {
        components: [
          { name: 'AuthService', specification: 'Handles user authentication', layer: 'service' },
        ],
      };

      await sparc.onArchitectureComplete(arch);

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Implement AuthService',
          description: expect.stringContaining('Handles user authentication'),
          labels: expect.arrayContaining(['sparc', 'architecture', 'service']),
        })
      );
    });

    it('should add layer label to issue', async () => {
      const arch: Architecture = {
        components: [
          { name: 'UserRepository', specification: 'Data access', layer: 'repository' },
        ],
      };

      await sparc.onArchitectureComplete(arch);

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: expect.arrayContaining(['repository']),
        })
      );
    });

    it('should handle component dependencies', async () => {
      const arch: Architecture = {
        components: [
          { name: 'AuthService', specification: 'Auth', layer: 'service', depends_on: ['UserRepository'] },
          { name: 'UserRepository', specification: 'Users', layer: 'repository' },
        ],
      };

      await sparc.onArchitectureComplete(arch);

      // AuthService (bd-1) depends on UserRepository (bd-2)
      expect(mockWrapper.depAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'blocks',
        })
      );
    });

    it('should link to epic if provided', async () => {
      const arch: Architecture = {
        components: [
          { name: 'AuthService', specification: 'Auth', layer: 'service' },
        ],
        epic_id: 'bd-epic-1',
      };

      await sparc.onArchitectureComplete(arch);

      expect(mockWrapper.depAdd).toHaveBeenCalledWith({
        from_id: 'bd-1',
        to_id: 'bd-epic-1',
        type: 'parent-child',
      });
    });

    it('should return created issue ids', async () => {
      const arch: Architecture = {
        components: [
          { name: 'AuthService', specification: 'Auth', layer: 'service' },
          { name: 'UserRepository', specification: 'Users', layer: 'repository' },
        ],
      };

      const result = await sparc.onArchitectureComplete(arch);

      expect(result).toContain('bd-1');
      expect(result).toContain('bd-2');
    });
  });

  describe('onRefinementComplete', () => {
    it('should update related issues with refinement notes', async () => {
      const refinement: RefinementResult = {
        issue_ids: ['bd-1', 'bd-2'],
        changes: [
          { issue_id: 'bd-1', change: 'Added error handling' },
          { issue_id: 'bd-2', change: 'Optimized query' },
        ],
      };

      await sparc.onRefinementComplete(refinement);

      expect(mockWrapper.update).toHaveBeenCalledTimes(2);
      expect(mockWrapper.update).toHaveBeenCalledWith({
        id: 'bd-1',
        notes: expect.stringContaining('Added error handling'),
        labels: expect.arrayContaining(['refined']),
      });
    });

    it('should add refinement label to issues', async () => {
      const refinement: RefinementResult = {
        issue_ids: ['bd-1'],
        changes: [
          { issue_id: 'bd-1', change: 'Refined implementation' },
        ],
      };

      await sparc.onRefinementComplete(refinement);

      expect(mockWrapper.update).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: expect.arrayContaining(['refined']),
        })
      );
    });
  });

  describe('onTddComplete', () => {
    it('should create issues for coverage gaps', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'AuthService.login', percentage: 45 },
          { area: 'UserRepository.findById', percentage: 30 },
        ],
      };

      await sparc.onTddComplete(tdd);

      expect(mockWrapper.create).toHaveBeenCalledTimes(2);
    });

    it('should include coverage percentage in issue', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'AuthService.login', percentage: 45 },
        ],
      };

      await sparc.onTddComplete(tdd);

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('AuthService.login'),
          description: expect.stringContaining('45%'),
          labels: expect.arrayContaining(['sparc', 'tdd', 'coverage-gap']),
        })
      );
    });

    it('should set priority based on coverage percentage', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'Critical', percentage: 10 },  // Very low - should be high priority
          { area: 'Medium', percentage: 50 },    // Medium coverage
          { area: 'High', percentage: 80 },      // Good coverage - lower priority
        ],
      };

      await sparc.onTddComplete(tdd);

      // Lower coverage = higher priority (lower number)
      expect(mockWrapper.create).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          priority: 0, // Critical priority for <20%
        })
      );
      expect(mockWrapper.create).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          priority: 2, // Normal priority for 40-60%
        })
      );
      expect(mockWrapper.create).toHaveBeenNthCalledWith(3,
        expect.objectContaining({
          priority: 4, // Low priority for >70%
        })
      );
    });

    it('should link to epic if provided', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'AuthService.login', percentage: 45 },
        ],
        epic_id: 'bd-epic-1',
      };

      await sparc.onTddComplete(tdd);

      expect(mockWrapper.depAdd).toHaveBeenCalledWith({
        from_id: 'bd-1',
        to_id: 'bd-epic-1',
        type: 'parent-child',
      });
    });

    it('should not create issues for gaps above threshold', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'WellCovered', percentage: 95 },
        ],
        threshold: 90,
      };

      await sparc.onTddComplete(tdd);

      expect(mockWrapper.create).not.toHaveBeenCalled();
    });

    it('should return created issue ids', async () => {
      const tdd: TddResult = {
        coverage_gaps: [
          { area: 'AuthService', percentage: 45 },
        ],
      };

      const result = await sparc.onTddComplete(tdd);

      expect(result).toContain('bd-1');
    });
  });

  describe('onCompletionPhase', () => {
    it('should close related issues', async () => {
      const completion: CompletionResult = {
        issue_ids: ['bd-1', 'bd-2', 'bd-3'],
        summary: 'All requirements implemented and tested',
      };

      await sparc.onCompletionPhase(completion);

      expect(mockWrapper.close).toHaveBeenCalledTimes(3);
    });

    it('should include completion summary in close reason', async () => {
      const completion: CompletionResult = {
        issue_ids: ['bd-1'],
        summary: 'Feature completed successfully',
      };

      await sparc.onCompletionPhase(completion);

      expect(mockWrapper.close).toHaveBeenCalledWith({
        id: 'bd-1',
        reason: expect.stringContaining('Feature completed successfully'),
      });
    });

    it('should handle empty issue list', async () => {
      const completion: CompletionResult = {
        issue_ids: [],
        summary: 'Nothing to close',
      };

      await sparc.onCompletionPhase(completion);

      expect(mockWrapper.close).not.toHaveBeenCalled();
    });

    it('should close epic last if included', async () => {
      const completion: CompletionResult = {
        issue_ids: ['bd-task-1', 'bd-task-2'],
        epic_id: 'bd-epic-1',
        summary: 'Epic completed',
      };

      await sparc.onCompletionPhase(completion);

      const closeCalls = (mockWrapper.close as ReturnType<typeof vi.fn>).mock.calls;
      const lastCall = closeCalls[closeCalls.length - 1];
      expect(lastCall[0].id).toBe('bd-epic-1');
    });
  });

  describe('createSparcWorkflow', () => {
    it('should create full SPARC workflow with epic', async () => {
      const workflow = await sparc.createSparcWorkflow({
        name: 'Auth System',
        description: 'Complete authentication system',
      });

      expect(mockWrapper.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'epic',
          labels: expect.arrayContaining(['sparc', 'workflow']),
        })
      );
      expect(workflow.epic_id).toBe('bd-1');
    });

    it('should create phase tasks for SPARC phases', async () => {
      const workflow = await sparc.createSparcWorkflow({
        name: 'Auth System',
        description: 'Auth system',
      });

      // Epic + 5 phase tasks (S, P, A, R, C)
      expect(mockWrapper.create).toHaveBeenCalledTimes(6);
    });

    it('should create dependencies between phases', async () => {
      await sparc.createSparcWorkflow({
        name: 'Auth',
        description: 'Auth',
      });

      // Should have dependencies: P->S, A->P, R->A, C->R
      expect(mockWrapper.depAdd).toHaveBeenCalledTimes(9); // 4 phase deps + 5 parent-child
    });

    it('should return phase issue ids', async () => {
      const workflow = await sparc.createSparcWorkflow({
        name: 'Auth',
        description: 'Auth',
      });

      expect(workflow.phases).toHaveProperty('specification');
      expect(workflow.phases).toHaveProperty('pseudocode');
      expect(workflow.phases).toHaveProperty('architecture');
      expect(workflow.phases).toHaveProperty('refinement');
      expect(workflow.phases).toHaveProperty('completion');
    });
  });
});

describe('BeadsSparc Integration Patterns', () => {
  let sparc: BeadsSparc;
  let mockWrapper: Partial<BeadsCliWrapper>;
  let issueIdCounter: number;

  beforeEach(() => {
    issueIdCounter = 0;
    mockWrapper = {
      create: vi.fn().mockImplementation(() => {
        issueIdCounter++;
        return Promise.resolve({
          success: true,
          exitCode: 0,
          data: { id: `bd-${issueIdCounter}` }
        });
      }),
      depAdd: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      update: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      close: vi.fn().mockResolvedValue({ success: true, exitCode: 0 }),
      list: vi.fn().mockResolvedValue({ success: true, exitCode: 0, data: [] }),
    };
    sparc = new BeadsSparc(mockWrapper as BeadsCliWrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support full SPARC workflow: spec -> arch -> tdd -> completion', async () => {
    // Specification phase
    const spec: Specification = {
      name: 'Auth System',
      summary: 'Authentication system',
      requirements: [
        { name: 'Login', acceptance_criteria: 'Users can login' },
      ],
    };
    const epic = await sparc.onSpecificationComplete(spec);
    expect(epic).toBeDefined();

    // Architecture phase
    const arch: Architecture = {
      components: [
        { name: 'AuthService', specification: 'Auth logic', layer: 'service' },
      ],
      epic_id: epic!.id,
    };
    const archIssues = await sparc.onArchitectureComplete(arch);
    expect(archIssues.length).toBeGreaterThan(0);

    // TDD phase
    const tdd: TddResult = {
      coverage_gaps: [
        { area: 'AuthService.login', percentage: 50 },
      ],
      epic_id: epic!.id,
    };
    const tddIssues = await sparc.onTddComplete(tdd);
    expect(tddIssues.length).toBeGreaterThan(0);

    // Completion phase
    const completion: CompletionResult = {
      issue_ids: [...archIssues, ...tddIssues],
      epic_id: epic!.id,
      summary: 'Auth system completed',
    };
    await sparc.onCompletionPhase(completion);

    expect(mockWrapper.close).toHaveBeenCalled();
  });

  it('should track all issues created during SPARC workflow', async () => {
    const workflow = await sparc.createSparcWorkflow({
      name: 'Feature',
      description: 'New feature',
    });

    // Verify workflow structure
    expect(workflow.epic_id).toBeDefined();
    expect(Object.keys(workflow.phases)).toHaveLength(5);
  });
});
