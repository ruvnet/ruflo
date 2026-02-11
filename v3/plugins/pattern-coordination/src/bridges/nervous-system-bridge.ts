/**
 * Nervous System Bridge
 *
 * Bridge to ruvector-nervous-system-wasm for neural coordination layer.
 * Provides signal propagation, state synchronization, and agent coordination.
 */

import type { Agent } from '../types.js';

/**
 * WASM module status
 */
export type WasmModuleStatus = 'unloaded' | 'loading' | 'ready' | 'error';

/**
 * Nervous system configuration
 */
export interface NervousSystemConfig {
  /** Number of neurons in the network */
  neuronCount: number;
  /** Signal propagation speed (0-1) */
  propagationSpeed: number;
  /** Signal decay rate (0-1) */
  decayRate: number;
  /** Synchronization threshold (0-1) */
  syncThreshold: number;
  /** Maximum coordination attempts */
  maxCoordinationAttempts: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: NervousSystemConfig = {
  neuronCount: 1000,
  propagationSpeed: 0.8,
  decayRate: 0.1,
  syncThreshold: 0.7,
  maxCoordinationAttempts: 10,
};

/**
 * Signal in the nervous system
 */
export interface NeuralSignal {
  source: string;
  target: string;
  strength: number;
  type: 'excitatory' | 'inhibitory';
  payload?: Float32Array;
}

/**
 * Coordination result
 */
export interface CoordinationResult {
  success: boolean;
  assignments: Map<string, string>;
  synchronizationLevel: number;
  convergenceRounds: number;
}

/**
 * WASM nervous system module interface
 */
interface NervousSystemModule {
  propagate(signals: Float32Array[], config: NervousSystemConfig): Float32Array[];
  synchronize(states: Float32Array[], threshold: number): Float32Array;
  coordinate(agents: number, capabilities: Uint8Array, tasks: Uint8Array): Uint32Array;
  measureSynchrony(states: Float32Array[]): number;
}

/**
 * Nervous System Bridge implementation
 */
export class NervousSystemBridge {
  readonly name = 'ruvector-nervous-system-wasm';
  readonly version = '0.1.0';

  private _status: WasmModuleStatus = 'unloaded';
  private _module: NervousSystemModule | null = null;
  private config: NervousSystemConfig;

  constructor(config?: Partial<NervousSystemConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get status(): WasmModuleStatus {
    return this._status;
  }

  get initialized(): boolean {
    return this._status === 'ready';
  }

  async init(): Promise<void> {
    if (this._status === 'ready') return;
    if (this._status === 'loading') return;

    this._status = 'loading';

    try {
      // Try to load the WASM module (optional dependency)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wasmModule = await (import('@ruvector/nervous-system-wasm' as any) as Promise<unknown>).catch(() => null);

      if (wasmModule) {
        this._module = wasmModule as unknown as NervousSystemModule;
      } else {
        // Use mock module for development
        this._module = this.createMockModule();
      }

      this._status = 'ready';
    } catch (error) {
      this._status = 'error';
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this._module = null;
    this._status = 'unloaded';
  }

  isReady(): boolean {
    return this._status === 'ready';
  }

  getModule(): NervousSystemModule | null {
    return this._module;
  }

  /**
   * Propagate signals through the pattern network
   */
  async propagate(signals: Float32Array[]): Promise<Float32Array[]> {
    if (!this._module) throw new Error('Nervous system module not initialized');
    return this._module.propagate(signals, this.config);
  }

  /**
   * Synchronize agent states to achieve collective coherence
   */
  async synchronize(states: Float32Array[]): Promise<Float32Array> {
    if (!this._module) throw new Error('Nervous system module not initialized');
    return this._module.synchronize(states, this.config.syncThreshold);
  }

  /**
   * Coordinate agents for task assignment
   */
  async coordinate(agents: Agent[]): Promise<CoordinationResult> {
    if (!this._module) throw new Error('Nervous system module not initialized');

    const n = agents.length;
    if (n === 0) {
      return {
        success: true,
        assignments: new Map(),
        synchronizationLevel: 1,
        convergenceRounds: 0,
      };
    }

    // Encode capabilities
    const capabilitySet = new Set<string>();
    for (const agent of agents) {
      for (const cap of agent.capabilities ?? []) {
        capabilitySet.add(cap);
      }
    }
    const capabilities = Array.from(capabilitySet);
    const capabilityIndices = new Map(capabilities.map((c, i) => [c, i]));

    // Create capability matrix
    const capabilityMatrix = new Uint8Array(n * capabilities.length);
    for (let i = 0; i < n; i++) {
      for (const cap of agents[i]?.capabilities ?? []) {
        const capIdx = capabilityIndices.get(cap);
        if (capIdx !== undefined) {
          capabilityMatrix[i * capabilities.length + capIdx] = 1;
        }
      }
    }

    // Simple task assignment (each capability is a potential task)
    const tasks = new Uint8Array(capabilities.length);
    tasks.fill(1);

    // Run coordination
    const result = this._module.coordinate(n, capabilityMatrix, tasks);

    // Build assignment map
    const assignments = new Map<string, string>();
    for (let i = 0; i < n; i++) {
      const taskIdx = result[i];
      if (taskIdx !== undefined && taskIdx < capabilities.length) {
        const capability = capabilities[taskIdx];
        if (capability) {
          assignments.set(agents[i]!.id, capability);
        }
      }
    }

    // Measure synchronization
    const states = agents
      .filter(a => a.embedding)
      .map(a => new Float32Array(a.embedding!));
    const synchronizationLevel = states.length > 0
      ? this._module.measureSynchrony(states)
      : 1;

    return {
      success: true,
      assignments,
      synchronizationLevel,
      convergenceRounds: 1,
    };
  }

  /**
   * Create mock module for development without WASM
   */
  private createMockModule(): NervousSystemModule {
    return {
      propagate(signals: Float32Array[], config: NervousSystemConfig): Float32Array[] {
        // Apply simple propagation with decay
        return signals.map(signal => {
          const output = new Float32Array(signal.length);
          for (let i = 0; i < signal.length; i++) {
            output[i] = (signal[i] ?? 0) * config.propagationSpeed * (1 - config.decayRate);
          }
          return output;
        });
      },

      synchronize(states: Float32Array[], threshold: number): Float32Array {
        if (states.length === 0) {
          return new Float32Array(0);
        }

        const dim = states[0]?.length ?? 0;
        const result = new Float32Array(dim);

        // Compute weighted average of states
        for (let d = 0; d < dim; d++) {
          let sum = 0;
          for (const state of states) {
            sum += state[d] ?? 0;
          }
          result[d] = sum / states.length;
        }

        return result;
      },

      coordinate(agents: number, capabilities: Uint8Array, tasks: Uint8Array): Uint32Array {
        const assignments = new Uint32Array(agents);
        const numTasks = tasks.length;
        const numCapabilities = numTasks;

        // Simple round-robin assignment based on capabilities
        for (let i = 0; i < agents; i++) {
          // Find first capability this agent has
          let assigned = 0;
          for (let c = 0; c < numCapabilities; c++) {
            if ((capabilities[i * numCapabilities + c] ?? 0) === 1) {
              assigned = c;
              break;
            }
          }
          assignments[i] = assigned;
        }

        return assignments;
      },

      measureSynchrony(states: Float32Array[]): number {
        if (states.length < 2) return 1;

        // Calculate average pairwise cosine similarity
        let totalSim = 0;
        let count = 0;

        for (let i = 0; i < states.length; i++) {
          for (let j = i + 1; j < states.length; j++) {
            const sim = cosineSimilarity(states[i]!, states[j]!);
            totalSim += sim;
            count++;
          }
        }

        return count > 0 ? totalSim / count : 1;
      },
    };
  }
}

/**
 * Cosine similarity helper
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) * (a[i] ?? 0);
    normB += (b[i] ?? 0) * (b[i] ?? 0);
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Create a new nervous system bridge
 */
export function createNervousSystemBridge(config?: Partial<NervousSystemConfig>): NervousSystemBridge {
  return new NervousSystemBridge(config);
}

export default NervousSystemBridge;
