/**
 * Quantum Engine - Topology Operations
 *
 * Implements quantum topology computations including:
 * - Betti numbers (topological invariants)
 * - Persistent homology
 * - Simplicial complex analysis
 *
 * Used for analyzing agent relationship graphs and memory topology.
 */

import type {
  IQuantumEngine,
  BettiNumbers,
  PersistenceDiagram,
  PersistencePoint,
  SimplicialComplex,
  Filtration,
  TopologyResult,
  WasmModule
} from '../types.js';

/**
 * QuantumEngine - WASM wrapper for quantum topology operations
 */
export class QuantumEngine implements IQuantumEngine {
  private wasmModule: WasmModule | null = null;

  constructor(wasmModule?: WasmModule) {
    this.wasmModule = wasmModule ?? null;
  }

  /**
   * Set the WASM module after initialization
   */
  setWasmModule(module: WasmModule): void {
    this.wasmModule = module;
  }

  /**
   * Compute Betti numbers for a simplicial complex
   *
   * @param complex - Simplicial complex
   * @returns BettiNumbers value object
   */
  async computeBettiNumbers(complex: SimplicialComplex): Promise<BettiNumbers> {
    if (complex.vertices.length === 0) {
      return this.createBettiNumbers([0]);
    }

    if (this.wasmModule) {
      // Convert complex to point cloud for WASM
      const points = this.complexToPointCloud(complex);
      const n = complex.vertices.length;
      const dim = 3; // Assume 3D embedding
      const maxDim = complex.maxDimension;

      const result = this.wasmModule.quantum_betti_numbers(points, n, dim, maxDim);
      return this.createBettiNumbers(Array.from(result));
    }

    // Pure JS implementation
    return this.computeBettiNumbersJS(complex);
  }

  /**
   * Compute persistence diagram for a filtration
   *
   * @param filtration - Filtration of simplicial complex
   * @returns PersistenceDiagram
   */
  async persistenceDiagram(filtration: Filtration): Promise<PersistenceDiagram> {
    if (filtration.complex.vertices.length === 0) {
      return {
        points: [],
        maxPersistence: 0,
        totalPersistence: 0
      };
    }

    if (this.wasmModule) {
      const points = this.complexToPointCloud(filtration.complex);
      const n = filtration.complex.vertices.length;
      const dim = 3;

      const result = this.wasmModule.quantum_persistence_diagram(points, n, dim);
      return this.parsePersistenceDiagram(result);
    }

    // Pure JS implementation
    return this.computePersistenceDiagramJS(filtration);
  }

  /**
   * Compute number of homology classes
   *
   * @param complex - Simplicial complex
   * @returns Number of homology classes
   */
  async computeHomologyClasses(complex: SimplicialComplex): Promise<number> {
    const betti = await this.computeBettiNumbers(complex);

    // Sum of all Betti numbers
    return betti.values.reduce((sum, b) => sum + b, 0);
  }

  /**
   * Compute full topology result
   *
   * @param points - Point cloud as Float32Array[]
   * @param maxDimension - Maximum dimension for Betti numbers
   * @returns TopologyResult
   */
  async computeTopology(points: Float32Array[], maxDimension: number = 2): Promise<TopologyResult> {
    // Build simplicial complex from points
    const complex = this.buildRipsComplex(points, maxDimension);

    // Build filtration
    const filtration = this.buildFiltration(complex, points);

    // Compute all features
    const bettiNumbers = await this.computeBettiNumbers(complex);
    const persistenceDiagram = await this.persistenceDiagram(filtration);
    const homologyClasses = await this.computeHomologyClasses(complex);

    return {
      bettiNumbers: bettiNumbers.values,
      persistenceDiagram,
      homologyClasses
    };
  }

  /**
   * Create BettiNumbers value object
   */
  createBettiNumbers(values: number[]): BettiNumbers {
    return {
      values: [...values],
      b0: values[0] ?? 0,
      b1: values[1] ?? 0,
      b2: values[2] ?? 0,
      connected: (values[0] ?? 0) === 1,
      hasLoops: (values[1] ?? 0) > 0,
      hasVoids: (values[2] ?? 0) > 0
    };
  }

  /**
   * Pure JS implementation of Betti number computation
   * Uses rank-nullity approach on boundary matrices
   */
  private computeBettiNumbersJS(complex: SimplicialComplex): BettiNumbers {
    const values: number[] = [];

    // b0 = number of connected components
    const b0 = this.countConnectedComponents(complex);
    values.push(b0);

    // b1 = number of loops (1-cycles)
    if (complex.maxDimension >= 1) {
      const b1 = this.computeB1(complex);
      values.push(b1);
    }

    // b2 = number of voids (2-cycles)
    if (complex.maxDimension >= 2) {
      const b2 = this.computeB2(complex);
      values.push(b2);
    }

    return this.createBettiNumbers(values);
  }

  /**
   * Count connected components using union-find
   */
  private countConnectedComponents(complex: SimplicialComplex): number {
    const n = complex.vertices.length;
    if (n === 0) return 0;

    const parent = new Array(n).fill(0).map((_, i) => i);
    const rank = new Array(n).fill(0);

    const find = (x: number): number => {
      if (parent[x] !== x) {
        parent[x] = find(parent[x]);
      }
      return parent[x];
    };

    const union = (x: number, y: number): void => {
      const px = find(x);
      const py = find(y);
      if (px === py) return;
      if (rank[px] < rank[py]) {
        parent[px] = py;
      } else if (rank[px] > rank[py]) {
        parent[py] = px;
      } else {
        parent[py] = px;
        rank[px]++;
      }
    };

    // Get 1-simplices (edges)
    const edges = complex.simplices.filter(s => s.length === 2);

    for (const edge of edges) {
      const v1 = edge[0];
      const v2 = edge[1];
      if (v1 !== undefined && v2 !== undefined) {
        union(v1, v2);
      }
    }

    // Count unique components
    const components = new Set<number>();
    for (let i = 0; i < n; i++) {
      components.add(find(i));
    }

    return components.size;
  }

  /**
   * Compute b1 (number of 1-cycles / loops)
   */
  private computeB1(complex: SimplicialComplex): number {
    const vertices = complex.vertices.length;
    const edges = complex.simplices.filter(s => s.length === 2).length;
    const components = this.countConnectedComponents(complex);

    // Euler characteristic relation: V - E + F = chi
    // b1 = E - V + components (simplified for 2D)
    // This is an approximation - full computation requires boundary matrix ranks

    return Math.max(0, edges - vertices + components);
  }

  /**
   * Compute b2 (number of 2-cycles / voids)
   */
  private computeB2(complex: SimplicialComplex): number {
    const triangles = complex.simplices.filter(s => s.length === 3).length;
    const tetrahedra = complex.simplices.filter(s => s.length === 4).length;

    // Simplified approximation
    // Full computation requires boundary matrix of 3-simplices
    return Math.max(0, triangles - 3 * tetrahedra);
  }

  /**
   * Pure JS implementation of persistence diagram
   */
  private computePersistenceDiagramJS(filtration: Filtration): PersistenceDiagram {
    const points: PersistencePoint[] = [];
    const { complex, values } = filtration;

    // Sort simplices by filtration value
    const sortedSimplices = complex.simplices
      .map((simplex, idx) => ({ simplex, value: values[idx] ?? 0 }))
      .sort((a, b) => a.value - b.value);

    // Track component births and merges
    const n = complex.vertices.length;
    const parent = new Array(n).fill(0).map((_, i) => i);
    const birthTime = new Array(n).fill(0);

    const find = (x: number): number => {
      const px = parent[x];
      if (px !== undefined && px !== x) {
        parent[x] = find(px);
      }
      return parent[x] ?? x;
    };

    for (const { simplex, value } of sortedSimplices) {
      if (simplex.length === 1) {
        // Vertex - birth of component
        const v = simplex[0];
        if (v !== undefined) {
          birthTime[v] = value;
        }
      } else if (simplex.length === 2) {
        // Edge - potential merge
        const v1 = simplex[0];
        const v2 = simplex[1];
        if (v1 === undefined || v2 === undefined) continue;
        const p1 = find(v1);
        const p2 = find(v2);

        if (p1 !== p2) {
          // Merge - older component survives
          const birthP1 = birthTime[p1] ?? 0;
          const birthP2 = birthTime[p2] ?? 0;
          const older = birthP1 <= birthP2 ? p1 : p2;
          const younger = older === p1 ? p2 : p1;

          // Death of younger component
          const birth = birthTime[younger] ?? 0;
          const death = value;

          if (death > birth) {
            points.push({
              birth,
              death,
              persistence: death - birth,
              dimension: 0
            });
          }

          parent[younger] = older;
        } else {
          // Same component - creates a loop (1-cycle born)
          points.push({
            birth: value,
            death: Infinity,
            persistence: Infinity,
            dimension: 1
          });
        }
      }
    }

    // Components that never die
    const components = new Set<number>();
    for (let i = 0; i < n; i++) {
      components.add(find(i));
    }

    for (const comp of components) {
      points.push({
        birth: birthTime[comp] ?? 0,
        death: Infinity,
        persistence: Infinity,
        dimension: 0
      });
    }

    const finitePoints = points.filter(p => p.persistence !== Infinity);
    const maxPersistence = finitePoints.length > 0
      ? Math.max(...finitePoints.map(p => p.persistence))
      : 0;
    const totalPersistence = finitePoints.reduce((sum, p) => sum + p.persistence, 0);

    return {
      points,
      maxPersistence,
      totalPersistence
    };
  }

  /**
   * Parse WASM persistence diagram result
   */
  private parsePersistenceDiagram(result: Float32Array): PersistenceDiagram {
    const points: PersistencePoint[] = [];

    // Format: [numPoints, birth1, death1, dim1, birth2, death2, dim2, ...]
    const numPoints = result[0] ?? 0;

    for (let i = 0; i < numPoints; i++) {
      const birth = result[1 + i * 3] ?? 0;
      const death = result[2 + i * 3] ?? 0;
      const dimension = result[3 + i * 3] ?? 0;

      points.push({
        birth,
        death,
        persistence: death - birth,
        dimension
      });
    }

    const finitePoints = points.filter(p => Number.isFinite(p.persistence));
    const maxPersistence = finitePoints.length > 0
      ? Math.max(...finitePoints.map(p => p.persistence))
      : 0;
    const totalPersistence = finitePoints.reduce((sum, p) => sum + p.persistence, 0);

    return {
      points,
      maxPersistence,
      totalPersistence
    };
  }

  /**
   * Build Vietoris-Rips complex from point cloud
   */
  private buildRipsComplex(points: Float32Array[], maxDimension: number): SimplicialComplex {
    const n = points.length;
    const vertices = Array.from({ length: n }, (_, i) => i);
    const simplices: number[][] = [];

    // Add vertices as 0-simplices
    for (let i = 0; i < n; i++) {
      simplices.push([i]);
    }

    // Compute pairwise distances and add edges
    const threshold = this.computeThreshold(points);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const pi = points[i];
        const pj = points[j];
        if (!pi || !pj) continue;
        const dist = this.euclideanDistance(pi, pj);
        if (dist <= threshold) {
          simplices.push([i, j]);
        }
      }
    }

    // Add triangles (2-simplices) if maxDimension >= 2
    if (maxDimension >= 2) {
      const edges = simplices.filter(s => s.length === 2);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          for (let k = j + 1; k < n; k++) {
            // Check if all three edges exist
            const hasIJ = edges.some(e => (e[0] === i && e[1] === j) || (e[0] === j && e[1] === i));
            const hasJK = edges.some(e => (e[0] === j && e[1] === k) || (e[0] === k && e[1] === j));
            const hasIK = edges.some(e => (e[0] === i && e[1] === k) || (e[0] === k && e[1] === i));

            if (hasIJ && hasJK && hasIK) {
              simplices.push([i, j, k]);
            }
          }
        }
      }
    }

    return {
      vertices,
      simplices,
      maxDimension
    };
  }

  /**
   * Build filtration from complex
   */
  private buildFiltration(complex: SimplicialComplex, points: Float32Array[]): Filtration {
    const values: number[] = [];

    for (const simplex of complex.simplices) {
      if (simplex.length === 1) {
        values.push(0); // Vertices appear at time 0
      } else {
        // Edge/face appears when its diameter is reached
        let maxDist = 0;
        for (let i = 0; i < simplex.length; i++) {
          for (let j = i + 1; j < simplex.length; j++) {
            const si = simplex[i];
            const sj = simplex[j];
            if (si === undefined || sj === undefined) continue;
            const pi = points[si];
            const pj = points[sj];
            if (!pi || !pj) continue;
            const dist = this.euclideanDistance(pi, pj);
            maxDist = Math.max(maxDist, dist);
          }
        }
        values.push(maxDist);
      }
    }

    return { complex, values };
  }

  /**
   * Compute threshold for Rips complex
   */
  private computeThreshold(points: Float32Array[]): number {
    if (points.length < 2) return 0;

    // Use median of all pairwise distances
    const distances: number[] = [];
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const pi = points[i];
        const pj = points[j];
        if (!pi || !pj) continue;
        distances.push(this.euclideanDistance(pi, pj));
      }
    }

    distances.sort((a, b) => a - b);
    return distances[Math.floor(distances.length / 2)] ?? 0;
  }

  /**
   * Euclidean distance between two points
   */
  private euclideanDistance(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Convert simplicial complex to point cloud for WASM
   */
  private complexToPointCloud(complex: SimplicialComplex): Float32Array {
    // Simple embedding: use vertex index as coordinate
    const n = complex.vertices.length;
    const dim = 3;
    const points = new Float32Array(n * dim);

    for (let i = 0; i < n; i++) {
      // Create simple embedding based on vertex connectivity
      const edges = complex.simplices
        .filter(s => s.length === 2 && s.includes(i));

      points[i * dim] = i; // x = vertex index
      points[i * dim + 1] = edges.length; // y = degree
      points[i * dim + 2] = 0; // z = 0
    }

    return points;
  }
}
