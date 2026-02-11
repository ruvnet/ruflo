/**
 * V3 Neural/Learning System
 *
 * Complete pattern learning module with Pattern learning modes,
 * ReasoningBank integration, pattern learning, and RL algorithms.
 *
 * Performance Targets:
 * - SONA adaptation: <0.05ms
 * - Pattern matching: <1ms
 * - Learning step: <10ms
 *
 * @module @claude-flow/patterns
 */
export type { PatternMode, PatternModeConfig, ModeOptimizations, Trajectory, TrajectoryStep, TrajectoryVerdict, DistilledMemory, Pattern, PatternMatch, PatternEvolution, RLAlgorithm, RLConfig, PPOConfig, DQNConfig, DecisionTransformerConfig, CuriosityConfig, LoRAConfig, LoRAWeights, EWCConfig, EWCState, PatternStats, PatternEvent, PatternEventListener, } from './types.js';
export { PatternManager, createPatternManager, getModeConfig, getModeOptimizations, } from './pattern-manager.js';
export type { ModeImplementation } from './modes/index.js';
export { BaseModeImplementation, RealTimeMode, BalancedMode, ResearchMode, EdgeMode, BatchMode, } from './modes/index.js';
export { PatternLearningEngine, createPatternLearningEngine, } from './pattern-integration.js';
export type { Context, AdaptedBehavior, SONAStats, JsLearnedPattern, JsSonaConfig, } from './pattern-integration.js';
export { ReasoningBank, createReasoningBank, createInitializedReasoningBank, } from './reasoning-bank.js';
export type { ReasoningBankConfig, RetrievalResult, ConsolidationResult, } from './reasoning-bank.js';
export { PatternLearner, createPatternLearner, } from './pattern-learner.js';
export type { PatternLearnerConfig } from './pattern-learner.js';
export { PPOAlgorithm, createPPO, DEFAULT_PPO_CONFIG, DQNAlgorithm, createDQN, DEFAULT_DQN_CONFIG, A2CAlgorithm, createA2C, DEFAULT_A2C_CONFIG, DecisionTransformer, createDecisionTransformer, DEFAULT_DT_CONFIG, QLearning, createQLearning, DEFAULT_QLEARNING_CONFIG, SARSAAlgorithm, createSARSA, DEFAULT_SARSA_CONFIG, CuriosityModule, createCuriosity, DEFAULT_CURIOSITY_CONFIG, createAlgorithm, getDefaultConfig, } from './algorithms/index.js';
export type { A2CConfig, QLearningConfig, SARSAConfig, } from './algorithms/index.js';
import { PatternManager, createPatternManager } from './pattern-manager.js';
import { ReasoningBank, createReasoningBank } from './reasoning-bank.js';
import { PatternLearner, createPatternLearner } from './pattern-learner.js';
import { PatternLearningEngine, createPatternLearningEngine } from './pattern-integration.js';
import type { PatternMode, PatternEventListener } from './types.js';
/**
 * Pattern Learning System - Complete integrated learning module
 */
export declare class PatternLearningSystem {
    private sona;
    private reasoningBank;
    private patternLearner;
    private initialized;
    constructor(mode?: PatternMode);
    /**
     * Initialize the learning system
     */
    initialize(): Promise<void>;
    /**
     * Get SONA manager
     */
    getPatternManager(): PatternManager;
    /**
     * Get ReasoningBank
     */
    getReasoningBank(): ReasoningBank;
    /**
     * Get Pattern Learner
     */
    getPatternLearner(): PatternLearner;
    /**
     * Change learning mode
     */
    setMode(mode: PatternMode): Promise<void>;
    /**
     * Begin tracking a task
     */
    beginTask(context: string, domain?: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general'): string;
    /**
     * Record a step in the current task
     */
    recordStep(trajectoryId: string, action: string, reward: number, stateEmbedding: Float32Array): void;
    /**
     * Complete a task and trigger learning
     */
    completeTask(trajectoryId: string, quality?: number): Promise<void>;
    /**
     * Find similar patterns for a task
     */
    findPatterns(queryEmbedding: Float32Array, k?: number): Promise<import('./types.js').PatternMatch[]>;
    /**
     * Retrieve relevant memories
     */
    retrieveMemories(queryEmbedding: Float32Array, k?: number): Promise<import('./reasoning-bank.js').RetrievalResult[]>;
    /**
     * Trigger learning cycle
     */
    triggerLearning(): Promise<void>;
    /**
     * Get comprehensive statistics
     */
    getStats(): {
        sona: import('./types.js').PatternStats;
        reasoningBank: Record<string, number>;
        patternLearner: Record<string, number>;
    };
    /**
     * Add event listener
     */
    addEventListener(listener: PatternEventListener): void;
    /**
     * Cleanup resources
     */
    cleanup(): Promise<void>;
}
/**
 * Create a complete pattern learning system
 */
export declare function createPatternLearningSystem(mode?: PatternMode): PatternLearningSystem;
declare const _default: {
    createPatternManager: typeof createPatternManager;
    createReasoningBank: typeof createReasoningBank;
    createPatternLearner: typeof createPatternLearner;
    createPatternLearningSystem: typeof createPatternLearningSystem;
    createPatternLearningEngine: typeof createPatternLearningEngine;
    PatternManager: typeof PatternManager;
    ReasoningBank: typeof ReasoningBank;
    PatternLearner: typeof PatternLearner;
    PatternLearningSystem: typeof PatternLearningSystem;
    PatternLearningEngine: typeof PatternLearningEngine;
};
export default _default;
//# sourceMappingURL=index.d.ts.map