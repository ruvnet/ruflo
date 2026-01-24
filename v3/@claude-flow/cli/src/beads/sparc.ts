/**
 * Beads SPARC Integration
 * Creates Beads issues from SPARC methodology phases
 *
 * SPARC Methodology:
 * - S: Specification - Define requirements and acceptance criteria
 * - P: Pseudocode - Outline implementation approach
 * - A: Architecture - Design component structure
 * - R: Refinement - Iterate and improve
 * - C: Completion - Finalize and close
 *
 * @see https://github.com/steveyegge/beads
 */

import type { BeadsCliWrapper } from './cli-wrapper.js';
import type { BeadsIssue, BeadsIssuePriority } from './types.js';

/**
 * Specification phase input
 */
export interface Specification {
  name: string;
  summary: string;
  requirements: Array<{
    name: string;
    acceptance_criteria: string;
  }>;
}

/**
 * Pseudocode phase input
 */
export interface Pseudocode {
  modules: Array<{
    name: string;
    description: string;
    steps: string[];
  }>;
  epic_id?: string;
}

/**
 * Architecture phase input
 */
export interface Architecture {
  components: Array<{
    name: string;
    specification: string;
    layer: string;
    depends_on?: string[];
  }>;
  epic_id?: string;
}

/**
 * Refinement phase input
 */
export interface RefinementResult {
  issue_ids: string[];
  changes: Array<{
    issue_id: string;
    change: string;
  }>;
}

/**
 * TDD phase input
 */
export interface TddResult {
  coverage_gaps: Array<{
    area: string;
    percentage: number;
  }>;
  epic_id?: string;
  threshold?: number;
}

/**
 * Completion phase input
 */
export interface CompletionResult {
  issue_ids: string[];
  epic_id?: string;
  summary: string;
}

/**
 * SPARC workflow configuration
 */
export interface SparcWorkflowConfig {
  name: string;
  description: string;
}

/**
 * SPARC workflow result
 */
export interface SparcWorkflow {
  epic_id: string;
  phases: {
    specification: string;
    pseudocode: string;
    architecture: string;
    refinement: string;
    completion: string;
  };
}

/**
 * BeadsSparc manages the integration between SPARC methodology
 * and Beads issue tracking
 */
export class BeadsSparc {
  private wrapper: BeadsCliWrapper;

  constructor(wrapper: BeadsCliWrapper) {
    this.wrapper = wrapper;
  }

  /**
   * Handle completion of the Specification phase
   * Creates an epic and child tasks for requirements
   *
   * @param spec - The specification data
   * @returns The created epic issue, or null on failure
   */
  async onSpecificationComplete(spec: Specification): Promise<BeadsIssue | null> {
    // Create epic for the specification
    const epicResult = await this.wrapper.create({
      title: spec.name,
      description: spec.summary,
      type: 'epic',
      priority: 1,
      labels: ['sparc', 'specification'],
    });

    if (!epicResult.success || !epicResult.data) {
      return null;
    }

    const epicId = epicResult.data.id;

    // Create tasks for each requirement
    for (const req of spec.requirements) {
      const taskResult = await this.wrapper.create({
        title: req.name,
        description: `Acceptance Criteria:\n${req.acceptance_criteria}`,
        type: 'task',
        priority: 2,
        labels: ['sparc', 'requirement'],
      });

      if (taskResult.success && taskResult.data) {
        // Link task to epic
        await this.wrapper.depAdd({
          from_id: taskResult.data.id,
          to_id: epicId,
          type: 'parent-child',
        });
      }
    }

    return epicResult.data;
  }

  /**
   * Handle completion of the Pseudocode phase
   * Creates tasks for each module
   *
   * @param pseudocode - The pseudocode data
   */
  async onPseudocodeComplete(pseudocode: Pseudocode): Promise<string[]> {
    const issueIds: string[] = [];

    for (const module of pseudocode.modules) {
      const stepsText = module.steps.length > 0
        ? `\n\nSteps:\n${module.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : '';

      const result = await this.wrapper.create({
        title: `Implement ${module.name}`,
        description: `${module.description}${stepsText}`,
        type: 'task',
        priority: 2,
        labels: ['sparc', 'pseudocode'],
      });

      if (result.success && result.data) {
        issueIds.push(result.data.id);

        // Link to epic if provided
        if (pseudocode.epic_id) {
          await this.wrapper.depAdd({
            from_id: result.data.id,
            to_id: pseudocode.epic_id,
            type: 'parent-child',
          });
        }
      }
    }

    return issueIds;
  }

  /**
   * Handle completion of the Architecture phase
   * Creates issues for each component
   *
   * @param arch - The architecture data
   * @returns Array of created issue IDs
   */
  async onArchitectureComplete(arch: Architecture): Promise<string[]> {
    const issueIds: string[] = [];
    const componentIdMap: Map<string, string> = new Map();

    // First pass: create all component issues
    for (const component of arch.components) {
      const result = await this.wrapper.create({
        title: `Implement ${component.name}`,
        description: `${component.specification}\n\nLayer: ${component.layer}`,
        type: 'task',
        priority: 2,
        labels: ['sparc', 'architecture', component.layer],
      });

      if (result.success && result.data) {
        issueIds.push(result.data.id);
        componentIdMap.set(component.name, result.data.id);

        // Link to epic if provided
        if (arch.epic_id) {
          await this.wrapper.depAdd({
            from_id: result.data.id,
            to_id: arch.epic_id,
            type: 'parent-child',
          });
        }
      }
    }

    // Second pass: add dependencies between components
    for (const component of arch.components) {
      if (component.depends_on && component.depends_on.length > 0) {
        const fromId = componentIdMap.get(component.name);
        if (!fromId) continue;

        for (const depName of component.depends_on) {
          const toId = componentIdMap.get(depName);
          if (toId) {
            await this.wrapper.depAdd({
              from_id: fromId,
              to_id: toId,
              type: 'blocks',
            });
          }
        }
      }
    }

    return issueIds;
  }

  /**
   * Handle completion of the Refinement phase
   * Updates related issues with refinement notes
   *
   * @param refinement - The refinement data
   */
  async onRefinementComplete(refinement: RefinementResult): Promise<void> {
    for (const change of refinement.changes) {
      await this.wrapper.update({
        id: change.issue_id,
        notes: `Refinement: ${change.change}`,
        labels: ['refined'],
      });
    }
  }

  /**
   * Handle completion of TDD phase
   * Creates issues for coverage gaps
   *
   * @param tdd - The TDD results
   * @returns Array of created issue IDs
   */
  async onTddComplete(tdd: TddResult): Promise<string[]> {
    const issueIds: string[] = [];
    const threshold = tdd.threshold ?? 100; // Default: create issues for all gaps

    for (const gap of tdd.coverage_gaps) {
      // Skip if coverage is above threshold
      if (gap.percentage >= threshold) {
        continue;
      }

      const priority = this.calculatePriorityFromCoverage(gap.percentage);

      const result = await this.wrapper.create({
        title: `Improve test coverage: ${gap.area}`,
        description: `Current coverage: ${gap.percentage}%\n\nIncrease test coverage for this area.`,
        type: 'task',
        priority,
        labels: ['sparc', 'tdd', 'coverage-gap'],
      });

      if (result.success && result.data) {
        issueIds.push(result.data.id);

        // Link to epic if provided
        if (tdd.epic_id) {
          await this.wrapper.depAdd({
            from_id: result.data.id,
            to_id: tdd.epic_id,
            type: 'parent-child',
          });
        }
      }
    }

    return issueIds;
  }

  /**
   * Handle completion phase
   * Closes all related issues
   *
   * @param completion - The completion data
   */
  async onCompletionPhase(completion: CompletionResult): Promise<void> {
    // Close all task issues first
    for (const issueId of completion.issue_ids) {
      await this.wrapper.close({
        id: issueId,
        reason: `SPARC Completion: ${completion.summary}`,
      });
    }

    // Close epic last if provided
    if (completion.epic_id) {
      await this.wrapper.close({
        id: completion.epic_id,
        reason: `SPARC Completion: ${completion.summary}`,
      });
    }
  }

  /**
   * Create a full SPARC workflow with epic and phase tasks
   *
   * @param config - Workflow configuration
   * @returns The created workflow structure
   */
  async createSparcWorkflow(config: SparcWorkflowConfig): Promise<SparcWorkflow> {
    // Create epic
    const epicResult = await this.wrapper.create({
      title: config.name,
      description: config.description,
      type: 'epic',
      priority: 1,
      labels: ['sparc', 'workflow'],
    });

    const epicId = epicResult.data?.id ?? 'unknown';

    // Create phase tasks
    const phases = [
      { key: 'specification', name: 'Specification', desc: 'Define requirements and acceptance criteria' },
      { key: 'pseudocode', name: 'Pseudocode', desc: 'Outline implementation approach' },
      { key: 'architecture', name: 'Architecture', desc: 'Design component structure' },
      { key: 'refinement', name: 'Refinement', desc: 'Iterate and improve implementation' },
      { key: 'completion', name: 'Completion', desc: 'Finalize, test, and close' },
    ];

    const phaseIds: Record<string, string> = {};
    let previousPhaseId: string | null = null;

    for (const phase of phases) {
      const result = await this.wrapper.create({
        title: `[${phase.name}] ${config.name}`,
        description: phase.desc,
        type: 'task',
        priority: 2,
        labels: ['sparc', 'phase', phase.key],
      });

      if (result.success && result.data) {
        phaseIds[phase.key] = result.data.id;

        // Link to epic
        await this.wrapper.depAdd({
          from_id: result.data.id,
          to_id: epicId,
          type: 'parent-child',
        });

        // Link to previous phase (sequential dependency)
        if (previousPhaseId) {
          await this.wrapper.depAdd({
            from_id: result.data.id,
            to_id: previousPhaseId,
            type: 'blocks',
          });
        }

        previousPhaseId = result.data.id;
      }
    }

    return {
      epic_id: epicId,
      phases: {
        specification: phaseIds['specification'] ?? '',
        pseudocode: phaseIds['pseudocode'] ?? '',
        architecture: phaseIds['architecture'] ?? '',
        refinement: phaseIds['refinement'] ?? '',
        completion: phaseIds['completion'] ?? '',
      },
    };
  }

  /**
   * Calculate priority based on coverage percentage
   * Lower coverage = higher priority (lower number)
   */
  private calculatePriorityFromCoverage(percentage: number): BeadsIssuePriority {
    if (percentage < 20) return 0;  // Critical
    if (percentage < 40) return 1;  // High
    if (percentage < 60) return 2;  // Normal
    if (percentage < 80) return 3;  // Low
    return 4;                        // Nice-to-have
  }
}

/**
 * Factory function to create a BeadsSparc instance
 */
export function createBeadsSparc(wrapper: BeadsCliWrapper): BeadsSparc {
  return new BeadsSparc(wrapper);
}
