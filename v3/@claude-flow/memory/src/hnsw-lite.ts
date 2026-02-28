export interface HnswSearchResult {
  id: string;
  score: number;
}

export class HnswLite {
  private vectors = new Map<string, Float32Array>();
  private neighbors = new Map<string, Set<string>>();
  private readonly dimensions: number;
  private readonly maxNeighbors: number;
  private readonly efConstruction: number;
  private readonly metric: string;

  constructor(dimensions: number, m: number, efConstruction: number, metric: string) {
    this.dimensions = dimensions;
    this.maxNeighbors = m;
    this.efConstruction = efConstruction;
    this.metric = metric;
  }

  get size(): number {
    return this.vectors.size;
  }

  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);

    if (this.vectors.size === 1) {
      this.neighbors.set(id, new Set());
      return;
    }

    const nearest = this.findNearest(vector, this.maxNeighbors);
    const neighborSet = new Set<string>();

    for (const n of nearest) {
      neighborSet.add(n.id);
      const nNeighbors = this.neighbors.get(n.id);
      if (nNeighbors) {
        nNeighbors.add(id);
        if (nNeighbors.size > this.maxNeighbors * 2) {
          this.pruneNeighbors(n.id);
        }
      }
    }

    this.neighbors.set(id, neighborSet);
  }

  remove(id: string): void {
    this.vectors.delete(id);
    const myNeighbors = this.neighbors.get(id);
    if (myNeighbors) {
      for (const nId of myNeighbors) {
        this.neighbors.get(nId)?.delete(id);
      }
    }
    this.neighbors.delete(id);
  }

  search(query: Float32Array, k: number, threshold?: number): HnswSearchResult[] {
    if (this.vectors.size === 0) return [];
    if (this.vectors.size <= k * 2) {
      return this.bruteForce(query, k, threshold);
    }

    const visited = new Set<string>();
    const candidates: HnswSearchResult[] = [];

    let entryId: string | undefined;
    let bestScore = -1;
    for (const [id] of this.vectors) {
      const score = this.similarity(query, this.vectors.get(id)!);
      if (score > bestScore) {
        bestScore = score;
        entryId = id;
      }
      if (visited.size >= Math.min(this.efConstruction, this.vectors.size)) break;
      visited.add(id);
      candidates.push({ id, score });
    }

    if (entryId) {
      const queue = [entryId];
      let idx = 0;

      while (idx < queue.length && visited.size < this.efConstruction * 2) {
        const currentId = queue[idx++];
        const currentNeighbors = this.neighbors.get(currentId);
        if (!currentNeighbors) continue;

        for (const nId of currentNeighbors) {
          if (visited.has(nId)) continue;
          visited.add(nId);

          const vec = this.vectors.get(nId);
          if (!vec) continue;

          const score = this.similarity(query, vec);
          candidates.push({ id: nId, score });
          queue.push(nId);
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    let filtered = candidates;
    if (threshold !== undefined) {
      filtered = filtered.filter(c => c.score >= threshold);
    }

    return filtered.slice(0, k);
  }

  private bruteForce(query: Float32Array, k: number, threshold?: number): HnswSearchResult[] {
    const results: HnswSearchResult[] = [];
    for (const [id, vec] of this.vectors) {
      const score = this.similarity(query, vec);
      if (threshold !== undefined && score < threshold) continue;
      results.push({ id, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  private findNearest(query: Float32Array, k: number): HnswSearchResult[] {
    return this.bruteForce(query, k);
  }

  private pruneNeighbors(id: string): void {
    const myNeighbors = this.neighbors.get(id);
    if (!myNeighbors) return;

    const vec = this.vectors.get(id);
    if (!vec) return;

    const scored: HnswSearchResult[] = [];
    for (const nId of myNeighbors) {
      const nVec = this.vectors.get(nId);
      if (!nVec) continue;
      scored.push({ id: nId, score: this.similarity(vec, nVec) });
    }

    scored.sort((a, b) => b.score - a.score);
    const keep = new Set(scored.slice(0, this.maxNeighbors).map(s => s.id));

    for (const nId of myNeighbors) {
      if (!keep.has(nId)) {
        myNeighbors.delete(nId);
      }
    }
  }

  private similarity(a: Float32Array, b: Float32Array): number {
    if (this.metric === 'dot') return dotProduct(a, b);
    if (this.metric === 'euclidean') return 1 / (1 + euclideanDistance(a, b));
    return cosineSimilarity(a, b);
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function euclideanDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
