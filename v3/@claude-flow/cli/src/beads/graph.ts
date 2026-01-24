/**
 * Beads Dependency Graph Visualization
 *
 * Generates visual representations of task dependencies in multiple formats:
 * - ASCII art for terminal display
 * - Mermaid for documentation and GitHub rendering
 * - DOT (Graphviz) for advanced graph rendering
 *
 * Features:
 * - Critical path detection
 * - Blocked task highlighting
 * - Topological sorting
 * - Cycle detection
 */

import type {
  BeadsIssue,
  BeadsIssueStatus,
  BeadsIssuePriority,
} from './types.js';

// ============================================
// Types
// ============================================

/**
 * Node in the dependency graph
 */
export interface GraphNode {
  /** Issue ID */
  id: string;
  /** Issue title */
  title: string;
  /** Current status */
  status: BeadsIssueStatus;
  /** Priority level */
  priority: BeadsIssuePriority;
  /** IDs of issues this depends on */
  dependsOn: string[];
  /** IDs of issues that depend on this */
  dependedBy: string[];
  /** Whether this node is on the critical path */
  isCritical: boolean;
  /** Whether this node is blocked */
  isBlocked: boolean;
  /** Depth in the graph (distance from root) */
  depth: number;
  /** Estimated effort (for critical path calculation) */
  effort: number;
  /** Earliest start time */
  earliestStart: number;
  /** Earliest finish time */
  earliestFinish: number;
  /** Latest start time */
  latestStart: number;
  /** Latest finish time */
  latestFinish: number;
  /** Slack time (latestStart - earliestStart) */
  slack: number;
}

/**
 * Edge in the dependency graph
 */
export interface GraphEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
  /** Whether this edge is on the critical path */
  isCritical: boolean;
}

/**
 * Options for graph output
 */
export interface GraphOptions {
  /** Include closed tasks */
  includeClosed?: boolean;
  /** Show critical path highlighting */
  showCriticalPath?: boolean;
  /** Show blocked tasks */
  showBlocked?: boolean;
  /** Show task status */
  showStatus?: boolean;
  /** Show priority */
  showPriority?: boolean;
  /** Maximum depth to render (-1 for unlimited) */
  maxDepth?: number;
  /** Root node ID (for subtree rendering) */
  rootId?: string;
  /** Graph direction for Mermaid/DOT */
  direction?: 'TB' | 'BT' | 'LR' | 'RL';
}

/**
 * Graph statistics
 */
export interface GraphStats {
  /** Total number of nodes */
  totalNodes: number;
  /** Number of edges */
  totalEdges: number;
  /** Number of root nodes (no dependencies) */
  rootNodes: number;
  /** Number of leaf nodes (nothing depends on them) */
  leafNodes: number;
  /** Number of blocked nodes */
  blockedNodes: number;
  /** Number of nodes on critical path */
  criticalNodes: number;
  /** Maximum depth */
  maxDepth: number;
  /** Length of critical path */
  criticalPathLength: number;
  /** Whether cycles were detected */
  hasCycles: boolean;
  /** IDs of nodes involved in cycles */
  cycleNodes: string[];
}

// ============================================
// Default Options
// ============================================

const DEFAULT_OPTIONS: GraphOptions = {
  includeClosed: false,
  showCriticalPath: true,
  showBlocked: true,
  showStatus: true,
  showPriority: false,
  maxDepth: -1,
  direction: 'TB',
};

// ============================================
// DependencyGraph Class
// ============================================

/**
 * Dependency graph for Beads issues
 *
 * Provides analysis and visualization of task dependencies including:
 * - Topological sorting
 * - Critical path detection
 * - Blocked task identification
 * - Multiple output formats
 */
export class DependencyGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: GraphEdge[] = [];
  private options: GraphOptions;
  private cycleNodes: Set<string> = new Set();

  constructor(issues: BeadsIssue[], options?: Partial<GraphOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.buildGraph(issues);
    this.calculateDepths();
    this.detectCycles();
    this.calculateCriticalPath();
    this.identifyBlockedNodes();
  }

  // ============================================
  // Graph Building
  // ============================================

  /**
   * Build the graph from issues
   */
  private buildGraph(issues: BeadsIssue[]): void {
    // Filter issues based on options
    const filteredIssues = issues.filter((issue) => {
      if (!this.options.includeClosed && issue.status === 'closed') {
        return false;
      }
      return true;
    });

    // Create nodes
    for (const issue of filteredIssues) {
      const node: GraphNode = {
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        dependsOn: [],
        dependedBy: [],
        isCritical: false,
        isBlocked: false,
        depth: 0,
        effort: this.estimateEffort(issue),
        earliestStart: 0,
        earliestFinish: 0,
        latestStart: Infinity,
        latestFinish: Infinity,
        slack: 0,
      };
      this.nodes.set(issue.id, node);
    }

    // Create edges from dependencies
    for (const issue of filteredIssues) {
      const dependencies = issue.dependencies || [];
      for (const dep of dependencies) {
        // Only add edge if both nodes exist
        if (
          dep.type === 'blocks' &&
          this.nodes.has(issue.id) &&
          this.nodes.has(dep.to_id)
        ) {
          // This issue depends on dep.to_id
          const node = this.nodes.get(issue.id)!;
          const targetNode = this.nodes.get(dep.to_id)!;

          node.dependsOn.push(dep.to_id);
          targetNode.dependedBy.push(issue.id);

          this.edges.push({
            from: dep.to_id,
            to: issue.id,
            isCritical: false,
          });
        }
      }
    }
  }

  /**
   * Estimate effort based on priority
   */
  private estimateEffort(issue: BeadsIssue): number {
    // Higher priority = potentially more critical work
    // Priority 0 = 5 units, Priority 4 = 1 unit
    return 5 - issue.priority;
  }

  // ============================================
  // Graph Analysis
  // ============================================

  /**
   * Calculate depths using BFS from root nodes
   */
  private calculateDepths(): void {
    const visited = new Set<string>();
    const queue: Array<{ id: string; depth: number }> = [];

    // Find root nodes (no dependencies)
    for (const [id, node] of this.nodes) {
      if (node.dependsOn.length === 0) {
        queue.push({ id, depth: 0 });
      }
    }

    // BFS to calculate depths
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;

      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id)!;
      node.depth = Math.max(node.depth, depth);

      // Add dependents to queue
      for (const depId of node.dependedBy) {
        if (!visited.has(depId)) {
          queue.push({ id: depId, depth: depth + 1 });
        }
      }
    }
  }

  /**
   * Detect cycles using DFS
   */
  private detectCycles(): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) return false;

      for (const depId of node.dependsOn) {
        if (!visited.has(depId)) {
          if (dfs(depId)) {
            this.cycleNodes.add(nodeId);
            return true;
          }
        } else if (recursionStack.has(depId)) {
          this.cycleNodes.add(nodeId);
          this.cycleNodes.add(depId);
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const [id] of this.nodes) {
      if (!visited.has(id)) {
        dfs(id);
      }
    }
  }

  /**
   * Calculate critical path using CPM (Critical Path Method)
   */
  private calculateCriticalPath(): void {
    if (this.cycleNodes.size > 0) {
      // Cannot calculate critical path with cycles
      return;
    }

    // Get topologically sorted nodes
    const sorted = this.topologicalSort();
    if (sorted.length === 0) return;

    // Forward pass - calculate earliest times
    for (const nodeId of sorted) {
      const node = this.nodes.get(nodeId)!;

      if (node.dependsOn.length === 0) {
        node.earliestStart = 0;
      } else {
        node.earliestStart = Math.max(
          ...node.dependsOn.map((depId) => {
            const dep = this.nodes.get(depId);
            return dep ? dep.earliestFinish : 0;
          })
        );
      }

      node.earliestFinish = node.earliestStart + node.effort;
    }

    // Find project end time
    const projectEnd = Math.max(
      ...Array.from(this.nodes.values()).map((n) => n.earliestFinish)
    );

    // Backward pass - calculate latest times
    for (let i = sorted.length - 1; i >= 0; i--) {
      const nodeId = sorted[i];
      const node = this.nodes.get(nodeId)!;

      if (node.dependedBy.length === 0) {
        node.latestFinish = projectEnd;
      } else {
        node.latestFinish = Math.min(
          ...node.dependedBy.map((depId) => {
            const dep = this.nodes.get(depId);
            return dep ? dep.latestStart : projectEnd;
          })
        );
      }

      node.latestStart = node.latestFinish - node.effort;
      node.slack = node.latestStart - node.earliestStart;

      // Node is on critical path if slack is 0
      if (Math.abs(node.slack) < 0.001) {
        node.isCritical = true;
      }
    }

    // Mark critical edges
    for (const edge of this.edges) {
      const fromNode = this.nodes.get(edge.from);
      const toNode = this.nodes.get(edge.to);
      if (fromNode?.isCritical && toNode?.isCritical) {
        edge.isCritical = true;
      }
    }
  }

  /**
   * Identify blocked nodes
   */
  private identifyBlockedNodes(): void {
    for (const [, node] of this.nodes) {
      // A node is blocked if any of its dependencies are not closed
      node.isBlocked = node.dependsOn.some((depId) => {
        const dep = this.nodes.get(depId);
        return dep && dep.status !== 'closed';
      });
    }
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  public topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const queue: string[] = [];
    const result: string[] = [];

    // Initialize in-degrees
    for (const [id, node] of this.nodes) {
      inDegree.set(id, node.dependsOn.length);
      if (node.dependsOn.length === 0) {
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      const node = this.nodes.get(nodeId)!;
      for (const depId of node.dependedBy) {
        const newDegree = (inDegree.get(depId) || 0) - 1;
        inDegree.set(depId, newDegree);
        if (newDegree === 0) {
          queue.push(depId);
        }
      }
    }

    return result;
  }

  /**
   * Get critical path nodes in order
   */
  public getCriticalPath(): GraphNode[] {
    const sorted = this.topologicalSort();
    return sorted
      .map((id) => this.nodes.get(id)!)
      .filter((node) => node.isCritical);
  }

  /**
   * Get blocked nodes
   */
  public getBlockedNodes(): GraphNode[] {
    return Array.from(this.nodes.values()).filter((node) => node.isBlocked);
  }

  /**
   * Get graph statistics
   */
  public getStats(): GraphStats {
    const nodes = Array.from(this.nodes.values());
    const rootNodes = nodes.filter((n) => n.dependsOn.length === 0);
    const leafNodes = nodes.filter((n) => n.dependedBy.length === 0);
    const criticalNodes = nodes.filter((n) => n.isCritical);
    const blockedNodes = nodes.filter((n) => n.isBlocked);
    const maxDepth = Math.max(...nodes.map((n) => n.depth), 0);

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.length,
      rootNodes: rootNodes.length,
      leafNodes: leafNodes.length,
      blockedNodes: blockedNodes.length,
      criticalNodes: criticalNodes.length,
      maxDepth,
      criticalPathLength: criticalNodes.length,
      hasCycles: this.cycleNodes.size > 0,
      cycleNodes: Array.from(this.cycleNodes),
    };
  }

  // ============================================
  // Output Formats
  // ============================================

  /**
   * Generate ASCII art representation
   */
  public toASCII(): string {
    const lines: string[] = [];
    const sorted = this.topologicalSort();

    if (sorted.length === 0) {
      if (this.cycleNodes.size > 0) {
        lines.push('ERROR: Dependency cycle detected!');
        lines.push(`Nodes in cycle: ${Array.from(this.cycleNodes).join(', ')}`);
      } else {
        lines.push('No tasks to display.');
      }
      return lines.join('\n');
    }

    // Header
    lines.push('='.repeat(60));
    lines.push('DEPENDENCY GRAPH');
    lines.push('='.repeat(60));
    lines.push('');

    // Stats
    const stats = this.getStats();
    lines.push(`Total Tasks: ${stats.totalNodes}`);
    lines.push(`Dependencies: ${stats.totalEdges}`);
    lines.push(`Critical Path Length: ${stats.criticalPathLength}`);
    if (stats.blockedNodes > 0) {
      lines.push(`Blocked Tasks: ${stats.blockedNodes}`);
    }
    lines.push('');

    // Legend
    lines.push('Legend:');
    lines.push('  [*] Critical path');
    lines.push('  [!] Blocked');
    lines.push('  [+] Closed');
    lines.push('  [ ] Open');
    lines.push('');

    // Tasks by depth
    const maxDepth = this.options.maxDepth === -1 ? stats.maxDepth : Math.min(this.options.maxDepth!, stats.maxDepth);

    for (let depth = 0; depth <= maxDepth; depth++) {
      const nodesAtDepth = sorted
        .map((id) => this.nodes.get(id)!)
        .filter((n) => n.depth === depth);

      if (nodesAtDepth.length === 0) continue;

      lines.push(`--- Level ${depth} ---`);

      for (const node of nodesAtDepth) {
        const marker = this.getASCIIMarker(node);
        const indent = '  '.repeat(depth);
        const title = this.truncate(node.title, 40);
        const deps = node.dependsOn.length > 0
          ? ` <- [${node.dependsOn.join(', ')}]`
          : '';

        lines.push(`${indent}${marker} ${node.id}: ${title}${deps}`);
      }

      lines.push('');
    }

    // Critical path summary
    if (this.options.showCriticalPath) {
      const criticalPath = this.getCriticalPath();
      if (criticalPath.length > 0) {
        lines.push('--- CRITICAL PATH ---');
        lines.push(criticalPath.map((n) => n.id).join(' -> '));
        lines.push('');
      }
    }

    // Blocked tasks summary
    if (this.options.showBlocked) {
      const blocked = this.getBlockedNodes();
      if (blocked.length > 0) {
        lines.push('--- BLOCKED TASKS ---');
        for (const node of blocked) {
          const blockers = node.dependsOn
            .filter((depId) => {
              const dep = this.nodes.get(depId);
              return dep && dep.status !== 'closed';
            })
            .join(', ');
          lines.push(`  ${node.id}: blocked by [${blockers}]`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get ASCII marker for a node
   */
  private getASCIIMarker(node: GraphNode): string {
    if (node.status === 'closed') return '[+]';
    if (node.isBlocked) return '[!]';
    if (node.isCritical) return '[*]';
    return '[ ]';
  }

  /**
   * Generate Mermaid diagram
   */
  public toMermaid(): string {
    const lines: string[] = [];
    const direction = this.options.direction || 'TB';

    lines.push(`graph ${direction}`);

    // Add nodes with styling
    for (const [id, node] of this.nodes) {
      const label = this.escapeLabel(this.truncate(node.title, 30));
      const shape = this.getMermaidShape(node);
      lines.push(`    ${this.sanitizeId(id)}${shape.open}"${label}"${shape.close}`);
    }

    lines.push('');

    // Add edges
    for (const edge of this.edges) {
      const fromId = this.sanitizeId(edge.from);
      const toId = this.sanitizeId(edge.to);
      const arrow = edge.isCritical ? '==>' : '-->';
      lines.push(`    ${fromId} ${arrow} ${toId}`);
    }

    lines.push('');

    // Add styling classes
    lines.push('    %% Styling');
    lines.push('    classDef critical fill:#ff6b6b,stroke:#c92a2a,stroke-width:3px');
    lines.push('    classDef blocked fill:#ffd43b,stroke:#f59f00,stroke-width:2px');
    lines.push('    classDef closed fill:#51cf66,stroke:#2f9e44,stroke-width:2px');
    lines.push('    classDef inProgress fill:#74c0fc,stroke:#1971c2,stroke-width:2px');

    // Apply classes to nodes
    const criticalNodes = Array.from(this.nodes.values())
      .filter((n) => n.isCritical && n.status !== 'closed')
      .map((n) => this.sanitizeId(n.id));
    const blockedNodes = Array.from(this.nodes.values())
      .filter((n) => n.isBlocked && !n.isCritical)
      .map((n) => this.sanitizeId(n.id));
    const closedNodes = Array.from(this.nodes.values())
      .filter((n) => n.status === 'closed')
      .map((n) => this.sanitizeId(n.id));
    const inProgressNodes = Array.from(this.nodes.values())
      .filter((n) => n.status === 'in_progress' && !n.isCritical && !n.isBlocked)
      .map((n) => this.sanitizeId(n.id));

    if (criticalNodes.length > 0) {
      lines.push(`    class ${criticalNodes.join(',')} critical`);
    }
    if (blockedNodes.length > 0) {
      lines.push(`    class ${blockedNodes.join(',')} blocked`);
    }
    if (closedNodes.length > 0) {
      lines.push(`    class ${closedNodes.join(',')} closed`);
    }
    if (inProgressNodes.length > 0) {
      lines.push(`    class ${inProgressNodes.join(',')} inProgress`);
    }

    return lines.join('\n');
  }

  /**
   * Get Mermaid shape for a node
   */
  private getMermaidShape(node: GraphNode): { open: string; close: string } {
    if (node.status === 'closed') {
      return { open: '([', close: '])' }; // Stadium shape
    }
    if (node.isBlocked) {
      return { open: '{{', close: '}}' }; // Hexagon
    }
    if (node.isCritical) {
      return { open: '[[', close: ']]' }; // Subroutine
    }
    return { open: '[', close: ']' }; // Rectangle
  }

  /**
   * Generate DOT (Graphviz) format
   */
  public toDOT(): string {
    const lines: string[] = [];
    const direction = this.options.direction === 'LR' || this.options.direction === 'RL'
      ? 'LR'
      : 'TB';

    lines.push('digraph DependencyGraph {');
    lines.push(`    rankdir=${direction};`);
    lines.push('    node [fontname="Arial", fontsize=10];');
    lines.push('    edge [fontname="Arial", fontsize=9];');
    lines.push('');

    // Graph attributes
    lines.push('    // Graph styling');
    lines.push('    graph [');
    lines.push('        label="Task Dependency Graph"');
    lines.push('        labelloc=t');
    lines.push('        fontsize=14');
    lines.push('        fontname="Arial Bold"');
    lines.push('        splines=ortho');
    lines.push('    ];');
    lines.push('');

    // Node definitions with styling
    lines.push('    // Nodes');
    for (const [id, node] of this.nodes) {
      const label = this.escapeLabel(this.truncate(node.title, 25));
      const attrs = this.getDOTNodeAttrs(node);
      lines.push(`    "${this.sanitizeId(id)}" [label="${label}" ${attrs}];`);
    }
    lines.push('');

    // Edge definitions
    lines.push('    // Edges');
    for (const edge of this.edges) {
      const fromId = this.sanitizeId(edge.from);
      const toId = this.sanitizeId(edge.to);
      const attrs = edge.isCritical
        ? 'color="#c92a2a" penwidth=3 style=bold'
        : 'color="#868e96"';
      lines.push(`    "${fromId}" -> "${toId}" [${attrs}];`);
    }

    // Subgraphs for depth levels
    lines.push('');
    lines.push('    // Depth levels');
    const stats = this.getStats();
    for (let depth = 0; depth <= stats.maxDepth; depth++) {
      const nodesAtDepth = Array.from(this.nodes.values())
        .filter((n) => n.depth === depth)
        .map((n) => `"${this.sanitizeId(n.id)}"`);

      if (nodesAtDepth.length > 0) {
        lines.push(`    { rank=same; ${nodesAtDepth.join('; ')}; }`);
      }
    }

    lines.push('}');

    return lines.join('\n');
  }

  /**
   * Get DOT attributes for a node
   */
  private getDOTNodeAttrs(node: GraphNode): string {
    const attrs: string[] = [];

    if (node.status === 'closed') {
      attrs.push('shape=ellipse');
      attrs.push('style=filled');
      attrs.push('fillcolor="#d3f9d8"');
      attrs.push('color="#2f9e44"');
    } else if (node.isBlocked) {
      attrs.push('shape=hexagon');
      attrs.push('style=filled');
      attrs.push('fillcolor="#fff3bf"');
      attrs.push('color="#f59f00"');
    } else if (node.isCritical) {
      attrs.push('shape=box');
      attrs.push('style="filled,bold"');
      attrs.push('fillcolor="#ffe3e3"');
      attrs.push('color="#c92a2a"');
      attrs.push('penwidth=3');
    } else if (node.status === 'in_progress') {
      attrs.push('shape=box');
      attrs.push('style=filled');
      attrs.push('fillcolor="#d0ebff"');
      attrs.push('color="#1971c2"');
    } else {
      attrs.push('shape=box');
      attrs.push('style=filled');
      attrs.push('fillcolor="#f8f9fa"');
      attrs.push('color="#495057"');
    }

    return attrs.join(' ');
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Truncate string to max length
   */
  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  /**
   * Escape label for graph output
   */
  private escapeLabel(str: string): string {
    return str
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Sanitize ID for graph output
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Get all nodes
   */
  public getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get all edges
   */
  public getEdges(): GraphEdge[] {
    return [...this.edges];
  }

  /**
   * Get a specific node
   */
  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }
}

// ============================================
// Factory Functions
// ============================================

/**
 * Create a dependency graph from issues
 */
export function createDependencyGraph(
  issues: BeadsIssue[],
  options?: Partial<GraphOptions>
): DependencyGraph {
  return new DependencyGraph(issues, options);
}

/**
 * Generate ASCII graph from issues
 */
export function generateASCIIGraph(
  issues: BeadsIssue[],
  options?: Partial<GraphOptions>
): string {
  const graph = new DependencyGraph(issues, options);
  return graph.toASCII();
}

/**
 * Generate Mermaid diagram from issues
 */
export function generateMermaidGraph(
  issues: BeadsIssue[],
  options?: Partial<GraphOptions>
): string {
  const graph = new DependencyGraph(issues, options);
  return graph.toMermaid();
}

/**
 * Generate DOT graph from issues
 */
export function generateDOTGraph(
  issues: BeadsIssue[],
  options?: Partial<GraphOptions>
): string {
  const graph = new DependencyGraph(issues, options);
  return graph.toDOT();
}
