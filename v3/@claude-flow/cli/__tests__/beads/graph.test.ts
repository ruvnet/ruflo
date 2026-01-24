/**
 * Beads Dependency Graph Tests
 *
 * Tests for the dependency graph visualization module including:
 * - Graph construction
 * - Topological sorting
 * - Critical path detection
 * - Cycle detection
 * - Output formats (ASCII, Mermaid, DOT)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DependencyGraph,
  createDependencyGraph,
  generateASCIIGraph,
  generateMermaidGraph,
  generateDOTGraph,
  type GraphOptions,
} from '../../src/beads/graph.js';
import type { BeadsIssue, BeadsDependency } from '../../src/beads/types.js';

// ============================================
// Test Fixtures
// ============================================

function createTestIssue(
  id: string,
  title: string,
  status: 'open' | 'in_progress' | 'closed' = 'open',
  priority: 0 | 1 | 2 | 3 | 4 = 2,
  dependencies: BeadsDependency[] = []
): BeadsIssue {
  return {
    id,
    title,
    status,
    priority,
    type: 'task',
    labels: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    dependencies,
  };
}

function createDependency(fromId: string, toId: string): BeadsDependency {
  return {
    from_id: fromId,
    to_id: toId,
    type: 'blocks',
    created_at: new Date().toISOString(),
  };
}

// ============================================
// Graph Construction Tests
// ============================================

describe('DependencyGraph', () => {
  describe('Construction', () => {
    it('should create empty graph from no issues', () => {
      const graph = new DependencyGraph([]);
      const stats = graph.getStats();

      expect(stats.totalNodes).toBe(0);
      expect(stats.totalEdges).toBe(0);
    });

    it('should create graph from single issue', () => {
      const issues = [createTestIssue('bd-1', 'Task 1')];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.totalNodes).toBe(1);
      expect(stats.totalEdges).toBe(0);
      expect(stats.rootNodes).toBe(1);
      expect(stats.leafNodes).toBe(1);
    });

    it('should create graph with dependencies', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1'),
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
        createTestIssue('bd-3', 'Task 3', 'open', 2, [createDependency('bd-3', 'bd-2')]),
      ];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.totalNodes).toBe(3);
      expect(stats.totalEdges).toBe(2);
      expect(stats.rootNodes).toBe(1);
      expect(stats.leafNodes).toBe(1);
      expect(stats.maxDepth).toBe(2);
    });

    it('should filter closed issues by default', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1', 'open'),
        createTestIssue('bd-2', 'Task 2', 'closed'),
      ];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.totalNodes).toBe(1);
    });

    it('should include closed issues when option is set', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1', 'open'),
        createTestIssue('bd-2', 'Task 2', 'closed'),
      ];
      const graph = new DependencyGraph(issues, { includeClosed: true });
      const stats = graph.getStats();

      expect(stats.totalNodes).toBe(2);
    });
  });

  describe('Topological Sort', () => {
    it('should return nodes in topological order', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1'),
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
        createTestIssue('bd-3', 'Task 3', 'open', 2, [createDependency('bd-3', 'bd-2')]),
      ];
      const graph = new DependencyGraph(issues);
      const sorted = graph.topologicalSort();

      // bd-1 must come before bd-2, bd-2 must come before bd-3
      expect(sorted.indexOf('bd-1')).toBeLessThan(sorted.indexOf('bd-2'));
      expect(sorted.indexOf('bd-2')).toBeLessThan(sorted.indexOf('bd-3'));
    });

    it('should handle multiple root nodes', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1'),
        createTestIssue('bd-2', 'Task 2'),
        createTestIssue('bd-3', 'Task 3', 'open', 2, [
          createDependency('bd-3', 'bd-1'),
          createDependency('bd-3', 'bd-2'),
        ]),
      ];
      const graph = new DependencyGraph(issues);
      const sorted = graph.topologicalSort();

      expect(sorted.length).toBe(3);
      expect(sorted.indexOf('bd-1')).toBeLessThan(sorted.indexOf('bd-3'));
      expect(sorted.indexOf('bd-2')).toBeLessThan(sorted.indexOf('bd-3'));
    });

    it('should handle diamond dependencies', () => {
      // A -> B -> D
      // A -> C -> D
      const issues = [
        createTestIssue('A', 'Task A'),
        createTestIssue('B', 'Task B', 'open', 2, [createDependency('B', 'A')]),
        createTestIssue('C', 'Task C', 'open', 2, [createDependency('C', 'A')]),
        createTestIssue('D', 'Task D', 'open', 2, [
          createDependency('D', 'B'),
          createDependency('D', 'C'),
        ]),
      ];
      const graph = new DependencyGraph(issues);
      const sorted = graph.topologicalSort();

      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'));
      expect(sorted.indexOf('B')).toBeLessThan(sorted.indexOf('D'));
      expect(sorted.indexOf('C')).toBeLessThan(sorted.indexOf('D'));
    });
  });

  describe('Cycle Detection', () => {
    it('should detect simple cycle', () => {
      // A -> B -> A (cycle)
      const issues = [
        createTestIssue('A', 'Task A', 'open', 2, [createDependency('A', 'B')]),
        createTestIssue('B', 'Task B', 'open', 2, [createDependency('B', 'A')]),
      ];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.hasCycles).toBe(true);
      expect(stats.cycleNodes.length).toBeGreaterThan(0);
    });

    it('should detect complex cycle', () => {
      // A -> B -> C -> A (cycle)
      const issues = [
        createTestIssue('A', 'Task A', 'open', 2, [createDependency('A', 'C')]),
        createTestIssue('B', 'Task B', 'open', 2, [createDependency('B', 'A')]),
        createTestIssue('C', 'Task C', 'open', 2, [createDependency('C', 'B')]),
      ];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.hasCycles).toBe(true);
    });

    it('should not report cycles for valid DAG', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1'),
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
        createTestIssue('bd-3', 'Task 3', 'open', 2, [createDependency('bd-3', 'bd-1')]),
      ];
      const graph = new DependencyGraph(issues);
      const stats = graph.getStats();

      expect(stats.hasCycles).toBe(false);
      expect(stats.cycleNodes.length).toBe(0);
    });
  });

  describe('Critical Path', () => {
    it('should identify critical path in linear graph', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1', 'open', 0), // High priority = higher effort
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
        createTestIssue('bd-3', 'Task 3', 'open', 4, [createDependency('bd-3', 'bd-2')]),
      ];
      const graph = new DependencyGraph(issues);
      const criticalPath = graph.getCriticalPath();

      // All nodes should be on critical path in linear graph
      expect(criticalPath.length).toBe(3);
      expect(criticalPath.map((n) => n.id)).toEqual(['bd-1', 'bd-2', 'bd-3']);
    });

    it('should identify critical path in branching graph', () => {
      // Path 1: A -> B (effort: 5 + 4 = 9)
      // Path 2: A -> C -> D (effort: 5 + 3 + 3 = 11) - Critical
      const issues = [
        createTestIssue('A', 'Task A', 'open', 0), // effort 5
        createTestIssue('B', 'Task B', 'open', 1, [createDependency('B', 'A')]), // effort 4
        createTestIssue('C', 'Task C', 'open', 2, [createDependency('C', 'A')]), // effort 3
        createTestIssue('D', 'Task D', 'open', 2, [createDependency('D', 'C')]), // effort 3
      ];
      const graph = new DependencyGraph(issues);
      const criticalPath = graph.getCriticalPath();

      // A -> C -> D should be the critical path (longer total duration)
      expect(criticalPath.map((n) => n.id)).toContain('A');
      expect(criticalPath.map((n) => n.id)).toContain('C');
      expect(criticalPath.map((n) => n.id)).toContain('D');
    });

    it('should handle graph with no dependencies', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1'),
        createTestIssue('bd-2', 'Task 2'),
      ];
      const graph = new DependencyGraph(issues);
      const criticalPath = graph.getCriticalPath();

      // All independent tasks are on critical path (parallel execution)
      expect(criticalPath.length).toBe(2);
    });
  });

  describe('Blocked Node Detection', () => {
    it('should identify blocked nodes', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1', 'open'), // Not closed, so blocks bd-2
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
      ];
      const graph = new DependencyGraph(issues);
      const blocked = graph.getBlockedNodes();

      expect(blocked.length).toBe(1);
      expect(blocked[0].id).toBe('bd-2');
      expect(blocked[0].isBlocked).toBe(true);
    });

    it('should not mark node as blocked if dependency is closed', () => {
      const issues = [
        createTestIssue('bd-1', 'Task 1', 'closed'),
        createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
      ];
      const graph = new DependencyGraph(issues, { includeClosed: true });
      const blocked = graph.getBlockedNodes();

      // bd-2 is not blocked because bd-1 is closed
      expect(blocked.length).toBe(0);
    });
  });
});

// ============================================
// Output Format Tests
// ============================================

describe('Graph Output Formats', () => {
  const testIssues: BeadsIssue[] = [
    createTestIssue('bd-1', 'Set up project', 'closed', 0),
    createTestIssue('bd-2', 'Implement auth', 'in_progress', 1, [createDependency('bd-2', 'bd-1')]),
    createTestIssue('bd-3', 'Add database', 'open', 2, [createDependency('bd-3', 'bd-1')]),
    createTestIssue('bd-4', 'Build API', 'open', 1, [
      createDependency('bd-4', 'bd-2'),
      createDependency('bd-4', 'bd-3'),
    ]),
  ];

  describe('ASCII Output', () => {
    it('should generate ASCII representation', () => {
      const ascii = generateASCIIGraph(testIssues, { includeClosed: true });

      expect(ascii).toContain('DEPENDENCY GRAPH');
      expect(ascii).toContain('bd-1');
      expect(ascii).toContain('bd-2');
      expect(ascii).toContain('bd-3');
      expect(ascii).toContain('bd-4');
    });

    it('should show legend', () => {
      const ascii = generateASCIIGraph(testIssues, { includeClosed: true });

      expect(ascii).toContain('Legend');
      expect(ascii).toContain('[*] Critical path');
      expect(ascii).toContain('[!] Blocked');
      expect(ascii).toContain('[+] Closed');
    });

    it('should show levels', () => {
      const ascii = generateASCIIGraph(testIssues, { includeClosed: true });

      expect(ascii).toContain('Level 0');
      expect(ascii).toContain('Level 1');
      expect(ascii).toContain('Level 2');
    });

    it('should indicate blocked tasks', () => {
      const graph = new DependencyGraph(testIssues, { includeClosed: true });
      const ascii = graph.toASCII();

      expect(ascii).toContain('[!]'); // Blocked marker
    });

    it('should indicate closed tasks', () => {
      const graph = new DependencyGraph(testIssues, { includeClosed: true });
      const ascii = graph.toASCII();

      expect(ascii).toContain('[+]'); // Closed marker
    });

    it('should show critical path section', () => {
      const ascii = generateASCIIGraph(testIssues, { includeClosed: true });

      expect(ascii).toContain('CRITICAL PATH');
    });

    it('should handle empty graph', () => {
      const ascii = generateASCIIGraph([]);

      expect(ascii).toContain('No tasks to display');
    });

    it('should report cycles in ASCII output', () => {
      const cycleIssues = [
        createTestIssue('A', 'Task A', 'open', 2, [createDependency('A', 'B')]),
        createTestIssue('B', 'Task B', 'open', 2, [createDependency('B', 'A')]),
      ];
      const ascii = generateASCIIGraph(cycleIssues);

      expect(ascii).toContain('cycle detected');
    });
  });

  describe('Mermaid Output', () => {
    it('should generate valid Mermaid diagram', () => {
      const mermaid = generateMermaidGraph(testIssues, { includeClosed: true });

      expect(mermaid).toMatch(/^graph (TB|BT|LR|RL)/);
      expect(mermaid).toContain('bd_1'); // Sanitized ID
      expect(mermaid).toContain('-->'); // Edge syntax
    });

    it('should include styling classes', () => {
      const mermaid = generateMermaidGraph(testIssues, { includeClosed: true });

      expect(mermaid).toContain('classDef critical');
      expect(mermaid).toContain('classDef blocked');
      expect(mermaid).toContain('classDef closed');
    });

    it('should use thick arrows for critical edges', () => {
      const mermaid = generateMermaidGraph(testIssues, { includeClosed: true });

      // Check for either regular or critical edges
      expect(mermaid).toMatch(/(-->|==>)/);
    });

    it('should respect direction option', () => {
      const mermaidLR = generateMermaidGraph(testIssues, { includeClosed: true, direction: 'LR' });
      const mermaidTB = generateMermaidGraph(testIssues, { includeClosed: true, direction: 'TB' });

      expect(mermaidLR).toContain('graph LR');
      expect(mermaidTB).toContain('graph TB');
    });

    it('should escape special characters in labels', () => {
      const issueWithSpecialChars = [
        createTestIssue('bd-1', 'Task with "quotes" & <brackets>'),
      ];
      const mermaid = generateMermaidGraph(issueWithSpecialChars);

      expect(mermaid).not.toContain('<brackets>');
      expect(mermaid).toContain('&lt;brackets&gt;');
    });
  });

  describe('DOT Output', () => {
    it('should generate valid DOT format', () => {
      const dot = generateDOTGraph(testIssues, { includeClosed: true });

      expect(dot).toContain('digraph DependencyGraph');
      expect(dot).toContain('rankdir=');
      expect(dot).toContain('->');
    });

    it('should include node styling', () => {
      const dot = generateDOTGraph(testIssues, { includeClosed: true });

      expect(dot).toContain('shape=');
      expect(dot).toContain('fillcolor=');
      expect(dot).toContain('style=');
    });

    it('should style critical edges differently', () => {
      const dot = generateDOTGraph(testIssues, { includeClosed: true });

      // Critical edges should have different styling
      expect(dot).toMatch(/penwidth=\d/);
    });

    it('should include rank constraints', () => {
      const dot = generateDOTGraph(testIssues, { includeClosed: true });

      expect(dot).toContain('rank=same');
    });

    it('should include graph label', () => {
      const dot = generateDOTGraph(testIssues, { includeClosed: true });

      expect(dot).toContain('label="Task Dependency Graph"');
    });
  });
});

// ============================================
// Factory Function Tests
// ============================================

describe('Factory Functions', () => {
  const issues = [
    createTestIssue('bd-1', 'Task 1'),
    createTestIssue('bd-2', 'Task 2', 'open', 2, [createDependency('bd-2', 'bd-1')]),
  ];

  it('should create graph with createDependencyGraph', () => {
    const graph = createDependencyGraph(issues);

    expect(graph).toBeInstanceOf(DependencyGraph);
    expect(graph.getStats().totalNodes).toBe(2);
  });

  it('should pass options through factory functions', () => {
    const options: Partial<GraphOptions> = { includeClosed: true, direction: 'LR' };

    const ascii = generateASCIIGraph(issues, options);
    const mermaid = generateMermaidGraph(issues, options);
    const dot = generateDOTGraph(issues, options);

    expect(typeof ascii).toBe('string');
    expect(mermaid).toContain('graph LR');
    expect(dot).toContain('rankdir=LR');
  });
});

// ============================================
// Statistics Tests
// ============================================

describe('Graph Statistics', () => {
  it('should calculate correct statistics', () => {
    const issues = [
      createTestIssue('A', 'Root 1'),
      createTestIssue('B', 'Root 2'),
      createTestIssue('C', 'Middle', 'open', 2, [createDependency('C', 'A')]),
      createTestIssue('D', 'Leaf', 'open', 2, [
        createDependency('D', 'B'),
        createDependency('D', 'C'),
      ]),
    ];
    const graph = new DependencyGraph(issues);
    const stats = graph.getStats();

    expect(stats.totalNodes).toBe(4);
    expect(stats.totalEdges).toBe(3);
    expect(stats.rootNodes).toBe(2); // A and B
    expect(stats.leafNodes).toBe(1); // D
    expect(stats.maxDepth).toBe(2);
  });

  it('should count blocked nodes', () => {
    const issues = [
      createTestIssue('A', 'Blocker', 'open'),
      createTestIssue('B', 'Blocked 1', 'open', 2, [createDependency('B', 'A')]),
      createTestIssue('C', 'Blocked 2', 'open', 2, [createDependency('C', 'A')]),
    ];
    const graph = new DependencyGraph(issues);
    const stats = graph.getStats();

    expect(stats.blockedNodes).toBe(2);
  });
});

// ============================================
// Node and Edge Access Tests
// ============================================

describe('Node and Edge Access', () => {
  const issues = [
    createTestIssue('bd-1', 'Task 1', 'open', 1),
    createTestIssue('bd-2', 'Task 2', 'in_progress', 2, [createDependency('bd-2', 'bd-1')]),
  ];

  it('should provide access to all nodes', () => {
    const graph = new DependencyGraph(issues);
    const nodes = graph.getNodes();

    expect(nodes.length).toBe(2);
    expect(nodes.map((n) => n.id)).toContain('bd-1');
    expect(nodes.map((n) => n.id)).toContain('bd-2');
  });

  it('should provide access to all edges', () => {
    const graph = new DependencyGraph(issues);
    const edges = graph.getEdges();

    expect(edges.length).toBe(1);
    expect(edges[0].from).toBe('bd-1');
    expect(edges[0].to).toBe('bd-2');
  });

  it('should get specific node by ID', () => {
    const graph = new DependencyGraph(issues);
    const node = graph.getNode('bd-1');

    expect(node).toBeDefined();
    expect(node?.title).toBe('Task 1');
    expect(node?.priority).toBe(1);
  });

  it('should return undefined for non-existent node', () => {
    const graph = new DependencyGraph(issues);
    const node = graph.getNode('nonexistent');

    expect(node).toBeUndefined();
  });
});
