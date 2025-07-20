/**
 * Q-Learning Agent with Neural Networks - Real reinforcement learning for autonomous agents
 */

import * as tf from '@tensorflow/tfjs-node';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface QLearningState {
  features: number[];
  hash: string;
}

export interface QLearningAction {
  id: string;
  name: string;
  parameters?: Record<string, any>;
}

export interface Experience {
  state: QLearningState;
  action: QLearningAction;
  reward: number;
  nextState: QLearningState;
  done: boolean;
  timestamp: Date;
}

export interface QLearningConfig {
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
  explorationDecay: number;
  minExplorationRate: number;
  memorySize: number;
  batchSize: number;
  targetUpdateFrequency: number;
  networkArchitecture: {
    hiddenLayers: number[];
    activation: string;
    outputActivation: string;
  };
}

export class QLearningAgent extends EventEmitter {
  private qNetwork: tf.LayersModel;
  private targetNetwork: tf.LayersModel;
  private memory: Experience[] = [];
  private config: QLearningConfig;
  private trainingStep: number = 0;
  private totalReward: number = 0;
  private episodeCount: number = 0;

  constructor(
    private stateSize: number,
    private actionSpace: QLearningAction[],
    config?: Partial<QLearningConfig>
  ) {
    super();
    
    this.config = {
      learningRate: 0.001,
      discountFactor: 0.95,
      explorationRate: 1.0,
      explorationDecay: 0.995,
      minExplorationRate: 0.01,
      memorySize: 10000,
      batchSize: 32,
      targetUpdateFrequency: 100,
      networkArchitecture: {
        hiddenLayers: [128, 128, 64],
        activation: 'relu',
        outputActivation: 'linear'
      },
      ...config
    };

    this.initializeNetworks();
    logger.info(`Q-Learning agent initialized with ${actionSpace.length} actions`);
  }

  /**
   * Initialize Q-Network and Target Network
   */
  private initializeNetworks(): void {
    // Create Q-Network
    this.qNetwork = this.buildNetwork();
    
    // Create Target Network (copy of Q-Network)
    this.targetNetwork = this.buildNetwork();
    this.updateTargetNetwork();

    logger.info('Q-Learning networks initialized');
  }

  /**
   * Build neural network for Q-value estimation
   */
  private buildNetwork(): tf.LayersModel {
    const model = tf.sequential();

    // Input layer
    model.add(tf.layers.dense({
      inputShape: [this.stateSize],
      units: this.config.networkArchitecture.hiddenLayers[0],
      activation: this.config.networkArchitecture.activation
    }));

    // Hidden layers
    for (let i = 1; i < this.config.networkArchitecture.hiddenLayers.length; i++) {
      model.add(tf.layers.dense({
        units: this.config.networkArchitecture.hiddenLayers[i],
        activation: this.config.networkArchitecture.activation
      }));
      
      // Add dropout for regularization
      model.add(tf.layers.dropout({ rate: 0.2 }));
    }

    // Output layer (Q-values for each action)
    model.add(tf.layers.dense({
      units: this.actionSpace.length,
      activation: this.config.networkArchitecture.outputActivation
    }));

    // Compile model
    model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'meanSquaredError',
      metrics: ['mae']
    });

    return model;
  }

  /**
   * Select action using epsilon-greedy policy with neural network Q-values
   */
  async selectAction(state: QLearningState): Promise<QLearningAction> {
    // Exploration vs Exploitation
    if (Math.random() < this.config.explorationRate) {
      // Explore: random action
      const randomIndex = Math.floor(Math.random() * this.actionSpace.length);
      const action = this.actionSpace[randomIndex];
      
      this.emit('action:selected', { 
        state, 
        action, 
        type: 'exploration',
        explorationRate: this.config.explorationRate 
      });
      
      return action;
    } else {
      // Exploit: action with highest Q-value
      const action = await this.getBestAction(state);
      
      this.emit('action:selected', { 
        state, 
        action, 
        type: 'exploitation',
        explorationRate: this.config.explorationRate 
      });
      
      return action;
    }
  }

  /**
   * Get action with highest Q-value from neural network
   */
  private async getBestAction(state: QLearningState): Promise<QLearningAction> {
    const stateTensor = tf.tensor2d([state.features]);
    
    try {
      const qValues = this.qNetwork.predict(stateTensor) as tf.Tensor;
      const qValuesData = await qValues.data();
      
      // Find action with maximum Q-value
      let maxIndex = 0;
      let maxValue = qValuesData[0];
      
      for (let i = 1; i < qValuesData.length; i++) {
        if (qValuesData[i] > maxValue) {
          maxValue = qValuesData[i];
          maxIndex = i;
        }
      }

      // Cleanup tensors
      stateTensor.dispose();
      qValues.dispose();

      return this.actionSpace[maxIndex];
    } catch (error) {
      stateTensor.dispose();
      throw error;
    }
  }

  /**
   * Learn from experience using Deep Q-Learning (DQN)
   */
  async learn(experience: Experience): Promise<void> {
    // Store experience in replay buffer
    this.addExperience(experience);

    // Update total reward
    this.totalReward += experience.reward;

    // If episode is done, increment episode count
    if (experience.done) {
      this.episodeCount++;
      this.emit('episode:completed', {
        episode: this.episodeCount,
        totalReward: this.totalReward,
        explorationRate: this.config.explorationRate
      });
      this.totalReward = 0;
    }

    // Train network if we have enough experiences
    if (this.memory.length >= this.config.batchSize) {
      await this.trainNetwork();
    }

    // Update target network periodically
    if (this.trainingStep % this.config.targetUpdateFrequency === 0) {
      this.updateTargetNetwork();
    }

    // Decay exploration rate
    this.decayExploration();

    this.emit('learning:step', {
      experience,
      memorySize: this.memory.length,
      trainingStep: this.trainingStep,
      explorationRate: this.config.explorationRate
    });
  }

  /**
   * Train neural network using experience replay
   */
  private async trainNetwork(): Promise<void> {
    // Sample random batch from memory
    const batch = this.sampleBatch();
    
    // Prepare training data
    const states = batch.map(exp => exp.state.features);
    const nextStates = batch.map(exp => exp.nextState.features);
    
    // Convert to tensors
    const statesTensor = tf.tensor2d(states);
    const nextStatesTensor = tf.tensor2d(nextStates);

    try {
      // Get current Q-values
      const currentQValues = this.qNetwork.predict(statesTensor) as tf.Tensor;
      
      // Get next Q-values from target network
      const nextQValues = this.targetNetwork.predict(nextStatesTensor) as tf.Tensor;
      
      // Get data arrays
      const currentQData = await currentQValues.data();
      const nextQData = await nextQValues.data();
      
      // Reshape to 2D arrays
      const currentQ = this.reshapeToMatrix(currentQData, batch.length, this.actionSpace.length);
      const nextQ = this.reshapeToMatrix(nextQData, batch.length, this.actionSpace.length);

      // Calculate target Q-values using Bellman equation
      const targetQ = currentQ.map((qRow, i) => {
        const experience = batch[i];
        const actionIndex = this.actionSpace.findIndex(a => a.id === experience.action.id);
        
        const newQRow = [...qRow];
        
        if (experience.done) {
          // Terminal state: Q-value = reward
          newQRow[actionIndex] = experience.reward;
        } else {
          // Non-terminal: Q-value = reward + discount * max(next Q-values)
          const maxNextQ = Math.max(...nextQ[i]);
          newQRow[actionIndex] = experience.reward + this.config.discountFactor * maxNextQ;
        }
        
        return newQRow;
      });

      // Convert target to tensor
      const targetTensor = tf.tensor2d(targetQ);

      // Train the network
      await this.qNetwork.fit(statesTensor, targetTensor, {
        epochs: 1,
        verbose: 0,
        batchSize: this.config.batchSize
      });

      // Cleanup tensors
      currentQValues.dispose();
      nextQValues.dispose();
      targetTensor.dispose();
      
      this.trainingStep++;

      this.emit('network:trained', {
        trainingStep: this.trainingStep,
        batchSize: batch.length,
        memorySize: this.memory.length
      });

    } finally {
      statesTensor.dispose();
      nextStatesTensor.dispose();
    }
  }

  /**
   * Add experience to replay buffer
   */
  private addExperience(experience: Experience): void {
    this.memory.push(experience);
    
    // Remove old experiences if buffer is full
    if (this.memory.length > this.config.memorySize) {
      this.memory.shift();
    }
  }

  /**
   * Sample random batch from experience replay buffer
   */
  private sampleBatch(): Experience[] {
    const batch: Experience[] = [];
    
    for (let i = 0; i < Math.min(this.config.batchSize, this.memory.length); i++) {
      const randomIndex = Math.floor(Math.random() * this.memory.length);
      batch.push(this.memory[randomIndex]);
    }
    
    return batch;
  }

  /**
   * Update target network with current Q-network weights
   */
  private updateTargetNetwork(): void {
    // Copy weights from Q-network to target network
    const weights = this.qNetwork.getWeights();
    this.targetNetwork.setWeights(weights);
    
    logger.debug('Target network updated');
  }

  /**
   * Decay exploration rate
   */
  private decayExploration(): void {
    this.config.explorationRate = Math.max(
      this.config.minExplorationRate,
      this.config.explorationRate * this.config.explorationDecay
    );
  }

  /**
   * Get Q-values for a given state
   */
  async getQValues(state: QLearningState): Promise<number[]> {
    const stateTensor = tf.tensor2d([state.features]);
    
    try {
      const qValues = this.qNetwork.predict(stateTensor) as tf.Tensor;
      const qValuesData = await qValues.data();
      
      // Cleanup tensors
      stateTensor.dispose();
      qValues.dispose();
      
      return Array.from(qValuesData);
    } catch (error) {
      stateTensor.dispose();
      throw error;
    }
  }

  /**
   * Get policy (action probabilities) for a state
   */
  async getPolicy(state: QLearningState, temperature: number = 1.0): Promise<number[]> {
    const qValues = await this.getQValues(state);
    
    // Apply softmax with temperature for policy
    const scaledQValues = qValues.map(q => q / temperature);
    const maxQ = Math.max(...scaledQValues);
    const expValues = scaledQValues.map(q => Math.exp(q - maxQ));
    const sumExp = expValues.reduce((sum, val) => sum + val, 0);
    
    return expValues.map(val => val / sumExp);
  }

  /**
   * Evaluate agent performance
   */
  async evaluate(
    testEpisodes: number,
    maxStepsPerEpisode: number,
    getInitialState: () => QLearningState,
    stepEnvironment: (state: QLearningState, action: QLearningAction) => Promise<{
      nextState: QLearningState;
      reward: number;
      done: boolean;
    }>
  ): Promise<{
    averageReward: number;
    averageSteps: number;
    successRate: number;
    episodes: { reward: number; steps: number; success: boolean }[];
  }> {
    const results: { reward: number; steps: number; success: boolean }[] = [];
    const originalExplorationRate = this.config.explorationRate;
    
    // Disable exploration for evaluation
    this.config.explorationRate = 0;

    try {
      for (let episode = 0; episode < testEpisodes; episode++) {
        let state = getInitialState();
        let totalReward = 0;
        let steps = 0;
        let done = false;

        while (!done && steps < maxStepsPerEpisode) {
          const action = await this.selectAction(state);
          const result = await stepEnvironment(state, action);
          
          totalReward += result.reward;
          state = result.nextState;
          done = result.done;
          steps++;
        }

        const success = done && totalReward > 0; // Define success criteria
        results.push({ reward: totalReward, steps, success });
      }

      const averageReward = results.reduce((sum, r) => sum + r.reward, 0) / results.length;
      const averageSteps = results.reduce((sum, r) => sum + r.steps, 0) / results.length;
      const successRate = results.filter(r => r.success).length / results.length;

      return {
        averageReward,
        averageSteps,
        successRate,
        episodes: results
      };

    } finally {
      // Restore exploration rate
      this.config.explorationRate = originalExplorationRate;
    }
  }

  /**
   * Save agent model and memory
   */
  async save(filepath: string): Promise<void> {
    try {
      // Save Q-network
      await this.qNetwork.save(`file://${filepath}/q_network`);
      
      // Save target network
      await this.targetNetwork.save(`file://${filepath}/target_network`);
      
      // Save agent state
      const agentState = {
        config: this.config,
        trainingStep: this.trainingStep,
        totalReward: this.totalReward,
        episodeCount: this.episodeCount,
        memory: this.memory.slice(-1000), // Save recent experiences only
        actionSpace: this.actionSpace
      };
      
      const fs = await import('fs/promises');
      await fs.writeFile(
        `${filepath}/agent_state.json`,
        JSON.stringify(agentState, null, 2)
      );
      
      logger.info(`Q-Learning agent saved to ${filepath}`);
    } catch (error) {
      logger.error('Failed to save Q-Learning agent:', error);
      throw error;
    }
  }

  /**
   * Load agent model and memory
   */
  async load(filepath: string): Promise<void> {
    try {
      // Load Q-network
      this.qNetwork.dispose();
      this.qNetwork = await tf.loadLayersModel(`file://${filepath}/q_network/model.json`);
      
      // Load target network
      this.targetNetwork.dispose();
      this.targetNetwork = await tf.loadLayersModel(`file://${filepath}/target_network/model.json`);
      
      // Load agent state
      const fs = await import('fs/promises');
      const agentStateContent = await fs.readFile(`${filepath}/agent_state.json`, 'utf-8');
      const agentState = JSON.parse(agentStateContent);
      
      this.config = agentState.config;
      this.trainingStep = agentState.trainingStep;
      this.totalReward = agentState.totalReward;
      this.episodeCount = agentState.episodeCount;
      this.memory = agentState.memory;
      
      logger.info(`Q-Learning agent loaded from ${filepath}`);
    } catch (error) {
      logger.error('Failed to load Q-Learning agent:', error);
      throw error;
    }
  }

  /**
   * Create state from feature vector
   */
  createState(features: number[]): QLearningState {
    return {
      features,
      hash: this.hashFeatures(features)
    };
  }

  /**
   * Hash feature vector for state identification
   */
  private hashFeatures(features: number[]): string {
    // Simple hash for state identification
    return features.map(f => f.toFixed(3)).join(',');
  }

  /**
   * Reshape 1D array to 2D matrix
   */
  private reshapeToMatrix(data: TypedArray, rows: number, cols: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < rows; i++) {
      matrix.push(Array.from(data.slice(i * cols, (i + 1) * cols)));
    }
    return matrix;
  }

  /**
   * Get agent statistics
   */
  getStatistics(): {
    episodeCount: number;
    trainingStep: number;
    explorationRate: number;
    memorySize: number;
    config: QLearningConfig;
  } {
    return {
      episodeCount: this.episodeCount,
      trainingStep: this.trainingStep,
      explorationRate: this.config.explorationRate,
      memorySize: this.memory.length,
      config: this.config
    };
  }

  /**
   * Reset agent (clear memory and reset counters)
   */
  reset(): void {
    this.memory = [];
    this.trainingStep = 0;
    this.totalReward = 0;
    this.episodeCount = 0;
    this.config.explorationRate = 1.0;
    
    // Reinitialize networks
    this.qNetwork.dispose();
    this.targetNetwork.dispose();
    this.initializeNetworks();
    
    logger.info('Q-Learning agent reset');
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.qNetwork.dispose();
    this.targetNetwork.dispose();
    this.memory = [];
    logger.info('Q-Learning agent disposed');
  }
}