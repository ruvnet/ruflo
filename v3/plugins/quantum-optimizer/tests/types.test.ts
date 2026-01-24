/**
 * Quantum Optimizer Plugin - Types Tests
 *
 * Tests for Zod schemas and type validation
 */

import { describe, it, expect } from 'vitest';
import {
  AnnealingSolveInputSchema,
  QAOAOptimizeInputSchema,
  GroverSearchInputSchema,
  DependencyResolveInputSchema,
  ScheduleOptimizeInputSchema,
  successResult,
  errorResult,
  RESOURCE_LIMITS,
  ALLOWED_ORACLE_OPS,
} from '../src/types.js';

describe('AnnealingSolveInputSchema', () => {
  it('should validate valid annealing input', () => {
    const validInput = {
      problem: {
        type: 'qubo',
        variables: 10,
        linear: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      },
      parameters: {
        numReads: 100,
        annealingTime: 20,
        chainStrength: 1.0,
        temperature: {
          initial: 100,
          final: 0.01,
          type: 'exponential',
        },
      },
      embedding: 'auto',
    };

    const result = AnnealingSolveInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all problem types', () => {
    const types = ['qubo', 'ising', 'sat', 'max_cut', 'tsp', 'dependency'] as const;

    for (const type of types) {
      const input = {
        problem: { type, variables: 5 },
      };
      const result = AnnealingSolveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all embedding types', () => {
    const embeddings = ['auto', 'minor', 'pegasus', 'chimera'] as const;

    for (const embedding of embeddings) {
      const input = {
        problem: { type: 'qubo', variables: 5 },
        embedding,
      };
      const result = AnnealingSolveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should use default embedding', () => {
    const input = {
      problem: { type: 'qubo', variables: 5 },
    };

    const result = AnnealingSolveInputSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.embedding).toBe('auto');
    }
  });

  it('should reject variables exceeding max', () => {
    const result = AnnealingSolveInputSchema.safeParse({
      problem: { type: 'qubo', variables: 15000 },
    });
    expect(result.success).toBe(false);
  });

  it('should reject numReads below 1', () => {
    const result = AnnealingSolveInputSchema.safeParse({
      problem: { type: 'qubo', variables: 10 },
      parameters: { numReads: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative chain strength', () => {
    const result = AnnealingSolveInputSchema.safeParse({
      problem: { type: 'qubo', variables: 10 },
      parameters: { chainStrength: -0.5 },
    });
    expect(result.success).toBe(false);
  });
});

describe('QAOAOptimizeInputSchema', () => {
  it('should validate valid QAOA input', () => {
    const validInput = {
      problem: {
        type: 'max_cut',
        graph: {
          nodes: 5,
          edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]],
          weights: [1.0, 1.0, 1.0, 1.0, 1.0],
        },
      },
      circuit: {
        depth: 3,
        optimizer: 'cobyla',
        initialParams: 'heuristic',
      },
      shots: 1024,
    };

    const result = QAOAOptimizeInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all problem types', () => {
    const types = ['max_cut', 'portfolio', 'scheduling', 'routing'] as const;

    for (const type of types) {
      const input = {
        problem: {
          type,
          graph: { nodes: 3, edges: [[0, 1], [1, 2]] },
        },
      };
      const result = QAOAOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all optimizer types', () => {
    const optimizers = ['cobyla', 'bfgs', 'adam', 'nelder-mead'] as const;

    for (const optimizer of optimizers) {
      const input = {
        problem: {
          type: 'max_cut',
          graph: { nodes: 3, edges: [[0, 1]] },
        },
        circuit: { optimizer },
      };
      const result = QAOAOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should reject circuit depth exceeding max', () => {
    const result = QAOAOptimizeInputSchema.safeParse({
      problem: {
        type: 'max_cut',
        graph: { nodes: 3, edges: [[0, 1]] },
      },
      circuit: { depth: 25 },
    });
    expect(result.success).toBe(false);
  });

  it('should reject shots below minimum', () => {
    const result = QAOAOptimizeInputSchema.safeParse({
      problem: {
        type: 'max_cut',
        graph: { nodes: 3, edges: [[0, 1]] },
      },
      shots: 50,
    });
    expect(result.success).toBe(false);
  });
});

describe('GroverSearchInputSchema', () => {
  it('should validate valid Grover search input', () => {
    const validInput = {
      searchSpace: {
        size: 1000,
        oracle: 'x == target',
        structure: 'unstructured',
      },
      targets: 1,
      iterations: 'optimal',
      amplification: {
        method: 'standard',
      },
    };

    const result = GroverSearchInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all structure types', () => {
    const structures = ['unstructured', 'database', 'tree', 'graph'] as const;

    for (const structure of structures) {
      const input = {
        searchSpace: {
          size: 100,
          oracle: 'x == 1',
          structure,
        },
      };
      const result = GroverSearchInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all iteration strategies', () => {
    const strategies = ['optimal', 'fixed', 'adaptive'] as const;

    for (const iterations of strategies) {
      const input = {
        searchSpace: {
          size: 100,
          oracle: 'x == 1',
          structure: 'unstructured',
        },
        iterations,
      };
      const result = GroverSearchInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all amplification methods', () => {
    const methods = ['standard', 'fixed_point', 'robust'] as const;

    for (const method of methods) {
      const input = {
        searchSpace: {
          size: 100,
          oracle: 'x == 1',
          structure: 'unstructured',
        },
        amplification: { method },
      };
      const result = GroverSearchInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should reject search space size exceeding max', () => {
    const result = GroverSearchInputSchema.safeParse({
      searchSpace: {
        size: 2_000_000_000,
        oracle: 'x == 1',
        structure: 'unstructured',
      },
    });
    expect(result.success).toBe(false);
  });

  it('should reject oracle exceeding max length', () => {
    const result = GroverSearchInputSchema.safeParse({
      searchSpace: {
        size: 100,
        oracle: 'x'.repeat(10001),
        structure: 'unstructured',
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('DependencyResolveInputSchema', () => {
  it('should validate valid dependency resolve input', () => {
    const validInput = {
      packages: [
        {
          name: 'react',
          version: '18.0.0',
          dependencies: { 'react-dom': '^18.0.0' },
          conflicts: [],
        },
        {
          name: 'react-dom',
          version: '18.0.0',
          dependencies: {},
          conflicts: [],
        },
      ],
      constraints: {
        minimize: 'versions',
        includePeer: true,
        timeout: 30000,
      },
      solver: 'hybrid',
    };

    const result = DependencyResolveInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should require at least one package', () => {
    const result = DependencyResolveInputSchema.safeParse({
      packages: [],
    });
    expect(result.success).toBe(false);
  });

  it('should accept all minimize objectives', () => {
    const objectives = ['versions', 'size', 'vulnerabilities', 'depth'] as const;

    for (const minimize of objectives) {
      const input = {
        packages: [{ name: 'pkg', version: '1.0.0' }],
        constraints: { minimize },
      };
      const result = DependencyResolveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should accept all solver types', () => {
    const solvers = ['quantum_annealing', 'qaoa', 'hybrid'] as const;

    for (const solver of solvers) {
      const input = {
        packages: [{ name: 'pkg', version: '1.0.0' }],
        solver,
      };
      const result = DependencyResolveInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should reject timeout below minimum', () => {
    const result = DependencyResolveInputSchema.safeParse({
      packages: [{ name: 'pkg', version: '1.0.0' }],
      constraints: { timeout: 500 },
    });
    expect(result.success).toBe(false);
  });
});

describe('ScheduleOptimizeInputSchema', () => {
  it('should validate valid schedule input', () => {
    const validInput = {
      tasks: [
        { id: 'task-1', duration: 10, dependencies: [], resources: ['cpu'] },
        { id: 'task-2', duration: 20, dependencies: ['task-1'], resources: ['cpu', 'memory'] },
      ],
      resources: [
        { id: 'cpu', capacity: 4, cost: 1 },
        { id: 'memory', capacity: 8, cost: 0.5 },
      ],
      objective: 'makespan',
    };

    const result = ScheduleOptimizeInputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should accept all objectives', () => {
    const objectives = ['makespan', 'cost', 'utilization', 'weighted'] as const;

    for (const objective of objectives) {
      const input = {
        tasks: [{ id: 't1', duration: 10 }],
        resources: [{ id: 'r1', capacity: 1, cost: 1 }],
        objective,
      };
      const result = ScheduleOptimizeInputSchema.safeParse(input);
      expect(result.success).toBe(true);
    }
  });

  it('should require at least one task', () => {
    const result = ScheduleOptimizeInputSchema.safeParse({
      tasks: [],
      resources: [{ id: 'r1', capacity: 1, cost: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('should require at least one resource', () => {
    const result = ScheduleOptimizeInputSchema.safeParse({
      tasks: [{ id: 't1', duration: 10 }],
      resources: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject resource capacity below 1', () => {
    const result = ScheduleOptimizeInputSchema.safeParse({
      tasks: [{ id: 't1', duration: 10 }],
      resources: [{ id: 'r1', capacity: 0, cost: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('should accept resource availability windows', () => {
    const input = {
      tasks: [{ id: 't1', duration: 10 }],
      resources: [
        {
          id: 'r1',
          capacity: 1,
          cost: 1,
          availability: [
            { start: 0, end: 100 },
            { start: 200, end: 300 },
          ],
        },
      ],
    };
    const result = ScheduleOptimizeInputSchema.safeParse(input);
    expect(result.success).toBe(true);
  });
});

describe('successResult', () => {
  it('should create success result with JSON data', () => {
    const data = {
      solution: { energy: -10.5, optimal: true },
      iterations: 1000,
    };
    const result = successResult(data);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBeUndefined();

    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.solution.energy).toBe(-10.5);
  });
});

describe('errorResult', () => {
  it('should create error result from Error', () => {
    const result = errorResult(new Error('Optimization timeout'));

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.error).toBe(true);
    expect(parsed.message).toBe('Optimization timeout');
  });

  it('should create error result from string', () => {
    const result = errorResult('Invalid problem configuration');

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.message).toBe('Invalid problem configuration');
  });
});

describe('RESOURCE_LIMITS', () => {
  it('should have valid limits', () => {
    expect(RESOURCE_LIMITS.MAX_VARIABLES).toBeGreaterThan(0);
    expect(RESOURCE_LIMITS.MAX_ITERATIONS).toBeGreaterThan(0);
    expect(RESOURCE_LIMITS.MAX_MEMORY_BYTES).toBeGreaterThan(0);
    expect(RESOURCE_LIMITS.MAX_CPU_TIME_MS).toBeGreaterThan(0);
    expect(RESOURCE_LIMITS.MAX_CIRCUIT_DEPTH).toBeGreaterThan(0);
    expect(RESOURCE_LIMITS.MAX_QUBITS).toBeGreaterThan(0);
  });

  it('should have reasonable max values', () => {
    expect(RESOURCE_LIMITS.MAX_VARIABLES).toBe(10000);
    expect(RESOURCE_LIMITS.MAX_CIRCUIT_DEPTH).toBe(20);
    expect(RESOURCE_LIMITS.MAX_QUBITS).toBe(50);
  });
});

describe('ALLOWED_ORACLE_OPS', () => {
  it('should include comparison operators', () => {
    expect(ALLOWED_ORACLE_OPS).toContain('==');
    expect(ALLOWED_ORACLE_OPS).toContain('!=');
    expect(ALLOWED_ORACLE_OPS).toContain('<');
    expect(ALLOWED_ORACLE_OPS).toContain('>');
  });

  it('should include logical operators', () => {
    expect(ALLOWED_ORACLE_OPS).toContain('&&');
    expect(ALLOWED_ORACLE_OPS).toContain('||');
    expect(ALLOWED_ORACLE_OPS).toContain('!');
  });

  it('should include arithmetic operators', () => {
    expect(ALLOWED_ORACLE_OPS).toContain('+');
    expect(ALLOWED_ORACLE_OPS).toContain('-');
    expect(ALLOWED_ORACLE_OPS).toContain('*');
    expect(ALLOWED_ORACLE_OPS).toContain('/');
    expect(ALLOWED_ORACLE_OPS).toContain('%');
  });
});
