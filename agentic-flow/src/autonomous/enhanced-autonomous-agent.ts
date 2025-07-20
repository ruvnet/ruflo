/**
 * Enhanced Autonomous Agent with Real Q-Learning Integration
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { QLearningAgent, QLearningAction, QLearningState } from '../src/mcp/src/core/q-learning-agent';
import { ProductionMLEngine } from '../src/mcp/src/core/production-ml-engine';
import { 
  Goal, 
  Experience, 
  Capability, 
  AgentState, 
  Decision, 
  DecisionOption 
} from './autonomous-agent';

export interface EnhancedAgentConfig {
  id: string;
  name: string;
  type: string;
  capabilities: Capability[];
  qLearningConfig?: {
    learningRate?: number;
    discountFactor?: number;
    explorationRate?: number;
    explorationDecay?: number;
    memorySize?: number;
    batchSize?: number;
  };
  mlEngineEnabled?: boolean;
}

export interface AgentAction extends QLearningAction {
  type: 'goal_pursuit' | 'learning' | 'communication' | 'exploration' | 'optimization';
  context: Record<string, any>;
  expectedReward: number;
  riskLevel: number;
}

export interface EnvironmentState extends QLearningState {
  goals: Goal[];
  capabilities: Record<string, number>;
  resources: Record<string, number>;
  social: {
    teamMembers: string[];
    relationships: Record<string, number>;
    reputation: number;
  };
  performance: {
    successRate: number;
    averageReward: number;
    efficiency: number;
  };
}

export class EnhancedAutonomousAgent extends EventEmitter {
  public readonly id: string;
  public readonly name: string;
  public readonly type: string;
  
  private goals: Map<string, Goal> = new Map();
  private experiences: Experience[] = [];
  private capabilities: Map<string, Capability> = new Map();
  private state: AgentState;
  private memory: Map<string, any> = new Map();
  
  // Real ML components
  private qLearningAgent?: QLearningAgent;
  private mlEngine?: ProductionMLEngine;
  private availableActions: AgentAction[];
  private currentState: EnvironmentState;

  constructor(config: EnhancedAgentConfig, mlEngine?: ProductionMLEngine) {
    super();
    
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.mlEngine = mlEngine;
    
    // Initialize capabilities
    config.capabilities.forEach(cap => {
      this.capabilities.set(cap.name, cap);
    });
    
    // Initialize state
    this.state = {
      energy: 100,
      focus: 'general',
      mood: 'confident',
      workload: 0,
      stress: 0
    };

    // Initialize actions
    this.availableActions = this.initializeActions();
    
    // Initialize current state
    this.currentState = this.createEnvironmentState();

    // Initialize Q-Learning if ML engine is available
    if (this.mlEngine && config.qLearningConfig !== false) {
      this.initializeQLearning(config.qLearningConfig || {});
    }
    
    // Start enhanced autonomous behavior
    this.startEnhancedAutonomousBehavior();
  }

  /**
   * Initialize Q-Learning agent with real neural networks
   */
  private initializeQLearning(config: any): void {
    try {
      this.qLearningAgent = new QLearningAgent(
        this.getStateSize(),
        this.availableActions,
        config
      );

      // Set up learning event handlers
      this.qLearningAgent.on('action:selected', (data) => {
        this.emit('learning:action_selected', {
          agentId: this.id,
          ...data
        });
      });

      this.qLearningAgent.on('episode:completed', (data) => {
        this.emit('learning:episode_completed', {
          agentId: this.id,
          ...data
        });
      });

      this.qLearningAgent.on('network:trained', (data) => {
        this.emit('learning:network_trained', {
          agentId: this.id,
          ...data
        });
      });

      logger.info(`Q-Learning initialized for agent ${this.name}`);
    } catch (error) {
      logger.error(`Failed to initialize Q-Learning for agent ${this.name}:`, error);
    }
  }

  /**
   * Enhanced decision making with real Q-Learning
   */
  async makeEnhancedDecision(situation: string, options: DecisionOption[]): Promise<string> {
    if (this.qLearningAgent) {
      // Use Q-Learning for decision making
      const currentState = this.createEnvironmentState();
      
      // Map options to actions
      const actions: AgentAction[] = options.map((option, index) => ({
        id: `action_${index}`,
        name: option.action,
        type: this.classifyActionType(option.action),
        context: { situation, option },
        expectedReward: option.probability * (1 - option.risk),
        riskLevel: option.risk,
        parameters: { originalOptionId: option.id }
      }));

      // Select action using Q-Learning
      const selectedAction = await this.qLearningAgent.selectAction(currentState);
      
      // Find corresponding option
      const actionIndex = actions.findIndex(a => a.id === selectedAction.id);
      const selectedOption = actionIndex >= 0 ? options[actionIndex] : options[0];

      this.emit('decision:enhanced', {
        agentId: this.id,
        situation,
        selectedAction,
        selectedOption,
        qLearningUsed: true
      });

      return selectedOption.id;
    } else {
      // Fallback to original decision making
      return this.makeOriginalDecision(situation, options);
    }
  }

  /**
   * Learn from experience with real Q-Learning
   */
  async learnFromEnhancedExperience(
    action: string,
    context: Record<string, any>,
    outcome: 'success' | 'failure' | 'partial',
    reward: number
  ): Promise<void> {
    // Store experience in original format
    const experience: Experience = {
      id: uuidv4(),
      action,
      context,
      outcome,
      reward,
      timestamp: new Date(),
      lessons: this.extractLessons({ action, context, outcome, reward } as any)
    };

    this.experiences.push(experience);

    // Update capabilities
    this.updateCapabilities(experience);

    // Q-Learning integration
    if (this.qLearningAgent) {
      const previousState = this.currentState;
      const currentState = this.createEnvironmentState();
      
      // Create Q-Learning experience
      const qExperience = {
        state: previousState,
        action: this.findActionByName(action),
        reward: this.normalizeReward(reward, outcome),
        nextState: currentState,
        done: outcome === 'success' || outcome === 'failure',
        timestamp: new Date()
      };

      // Learn from experience
      await this.qLearningAgent.learn(qExperience);
      
      // Update current state
      this.currentState = currentState;
    }

    // Maintain experience history
    if (this.experiences.length > 1000) {
      this.experiences.shift();
    }

    this.emit('learning:enhanced_experience', {
      agentId: this.id,
      experience,
      qLearningUsed: !!this.qLearningAgent
    });
  }

  /**
   * Get learning insights and recommendations
   */
  async getLearningInsights(): Promise<{
    performance: {
      successRate: number;
      averageReward: number;
      learningProgress: number;
    };
    capabilities: {
      improved: string[];
      needsWork: string[];
      recommendations: string[];
    };
    qLearning?: {
      explorationRate: number;
      episodeCount: number;
      trainingSteps: number;
      policyQuality: number[];
    };
  }> {
    const recentExperiences = this.experiences.slice(-100);
    const successRate = recentExperiences.filter(e => e.outcome === 'success').length / recentExperiences.length;
    const averageReward = recentExperiences.reduce((sum, e) => sum + e.reward, 0) / recentExperiences.length;

    // Analyze capability improvements
    const capabilityAnalysis = this.analyzeCapabilityProgress();
    
    const insights: any = {
      performance: {
        successRate: successRate || 0,
        averageReward: averageReward || 0,
        learningProgress: this.calculateLearningProgress()
      },
      capabilities: capabilityAnalysis
    };

    // Add Q-Learning insights if available
    if (this.qLearningAgent) {
      const qStats = this.qLearningAgent.getStatistics();
      const policyQuality = await this.evaluatePolicy();
      
      insights.qLearning = {
        explorationRate: qStats.explorationRate,
        episodeCount: qStats.episodeCount,
        trainingSteps: qStats.trainingStep,
        policyQuality
      };
    }

    return insights;
  }

  /**
   * Evaluate current policy quality
   */
  private async evaluatePolicy(): Promise<number[]> {
    if (!this.qLearningAgent) return [];

    try {
      // Get Q-values for current state
      const qValues = await this.qLearningAgent.getQValues(this.currentState);
      return qValues;
    } catch (error) {
      logger.error('Error evaluating policy:', error);
      return [];
    }
  }

  /**
   * Transfer learning to another agent
   */
  async transferLearningTo(targetAgent: EnhancedAutonomousAgent): Promise<void> {
    if (!this.qLearningAgent || !targetAgent.qLearningAgent) {
      throw new Error('Both agents must have Q-Learning enabled for transfer learning');
    }

    try {
      // Save current model
      const tempPath = `/tmp/transfer_${this.id}_to_${targetAgent.id}`;
      await this.qLearningAgent.save(tempPath);

      // Load into target agent (this transfers the learned policy)
      await targetAgent.qLearningAgent.load(tempPath);

      // Share experiences
      const recentExperiences = this.experiences.slice(-100);
      targetAgent.experiences.push(...recentExperiences);

      this.emit('learning:transfer_completed', {
        sourceAgent: this.id,
        targetAgent: targetAgent.id,
        experiencesTransferred: recentExperiences.length
      });

      logger.info(`Learning transferred from ${this.name} to ${targetAgent.name}`);
    } catch (error) {
      logger.error('Transfer learning failed:', error);
      throw error;
    }
  }

  /**
   * Collaborative learning with other agents
   */
  async collaborativeLearn(agents: EnhancedAutonomousAgent[]): Promise<void> {
    const allExperiences: Experience[] = [];
    
    // Gather experiences from all agents
    for (const agent of [this, ...agents]) {
      allExperiences.push(...agent.experiences.slice(-50)); // Last 50 experiences
    }

    // Sort by timestamp
    allExperiences.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Learn from shared experiences
    for (const experience of allExperiences) {
      if (experience.outcome === 'success' && experience.reward > 0.5) {
        await this.learnFromEnhancedExperience(
          experience.action,
          experience.context,
          experience.outcome,
          experience.reward * 0.5 // Reduced reward for collaborative learning
        );
      }
    }

    this.emit('learning:collaborative_completed', {
      agentId: this.id,
      collaboratingAgents: agents.map(a => a.id),
      experiencesLearned: allExperiences.length
    });
  }

  // Helper methods

  private initializeActions(): AgentAction[] {
    return [
      {
        id: 'pursue_goal',
        name: 'Pursue Goal',
        type: 'goal_pursuit',
        context: {},
        expectedReward: 0.8,
        riskLevel: 0.2
      },
      {
        id: 'learn_new_skill',
        name: 'Learn New Skill',
        type: 'learning',
        context: {},
        expectedReward: 0.6,
        riskLevel: 0.1
      },
      {
        id: 'communicate_team',
        name: 'Communicate with Team',
        type: 'communication',
        context: {},
        expectedReward: 0.5,
        riskLevel: 0.05
      },
      {
        id: 'explore_options',
        name: 'Explore Options',
        type: 'exploration',
        context: {},
        expectedReward: 0.3,
        riskLevel: 0.3
      },
      {
        id: 'optimize_process',
        name: 'Optimize Process',
        type: 'optimization',
        context: {},
        expectedReward: 0.7,
        riskLevel: 0.15
      }
    ];
  }

  private createEnvironmentState(): EnvironmentState {
    const capabilityFeatures = Array.from(this.capabilities.values()).map(c => c.proficiency);
    const stateFeatures = [
      this.state.energy / 100,
      this.state.workload / 100,
      this.state.stress / 100,
      this.goals.size / 10, // Normalize goal count
      ...capabilityFeatures
    ];

    // Pad or truncate to fixed size
    while (stateFeatures.length < 20) {
      stateFeatures.push(0);
    }

    return {
      features: stateFeatures.slice(0, 20),
      hash: this.hashFeatures(stateFeatures),
      goals: Array.from(this.goals.values()),
      capabilities: Object.fromEntries(
        Array.from(this.capabilities.entries()).map(([name, cap]) => [name, cap.proficiency])
      ),
      resources: {
        energy: this.state.energy,
        time: 100 - this.state.workload
      },
      social: {
        teamMembers: [],
        relationships: {},
        reputation: 0.8
      },
      performance: {
        successRate: this.calculateSuccessRate(),
        averageReward: this.calculateAverageReward(),
        efficiency: this.calculateEfficiency()
      }
    };
  }

  private getStateSize(): number {
    return 20; // Fixed state size for neural network
  }

  private classifyActionType(action: string): AgentAction['type'] {
    const actionLower = action.toLowerCase();
    
    if (actionLower.includes('goal') || actionLower.includes('task')) {
      return 'goal_pursuit';
    } else if (actionLower.includes('learn') || actionLower.includes('study')) {
      return 'learning';
    } else if (actionLower.includes('communicate') || actionLower.includes('talk')) {
      return 'communication';
    } else if (actionLower.includes('explore') || actionLower.includes('search')) {
      return 'exploration';
    } else if (actionLower.includes('optimize') || actionLower.includes('improve')) {
      return 'optimization';
    }
    
    return 'exploration';
  }

  private findActionByName(actionName: string): AgentAction {
    return this.availableActions.find(a => a.name === actionName) || this.availableActions[0];
  }

  private normalizeReward(reward: number, outcome: string): number {
    let normalizedReward = reward;
    
    // Apply outcome modifiers
    switch (outcome) {
      case 'success':
        normalizedReward = Math.max(0.5, reward);
        break;
      case 'failure':
        normalizedReward = Math.min(-0.5, -Math.abs(reward));
        break;
      case 'partial':
        normalizedReward = reward * 0.5;
        break;
    }
    
    // Clamp to [-1, 1] range
    return Math.max(-1, Math.min(1, normalizedReward));
  }

  private hashFeatures(features: number[]): string {
    return features.map(f => f.toFixed(3)).join(',');
  }

  private calculateSuccessRate(): number {
    const recentExperiences = this.experiences.slice(-20);
    if (recentExperiences.length === 0) return 0.5;
    return recentExperiences.filter(e => e.outcome === 'success').length / recentExperiences.length;
  }

  private calculateAverageReward(): number {
    const recentExperiences = this.experiences.slice(-20);
    if (recentExperiences.length === 0) return 0;
    return recentExperiences.reduce((sum, e) => sum + e.reward, 0) / recentExperiences.length;
  }

  private calculateEfficiency(): number {
    // Simple efficiency calculation based on energy and stress
    return (this.state.energy - this.state.stress) / 100;
  }

  private calculateLearningProgress(): number {
    // Calculate learning progress based on improvement over time
    const oldExperiences = this.experiences.slice(0, 50);
    const newExperiences = this.experiences.slice(-50);
    
    if (oldExperiences.length === 0 || newExperiences.length === 0) return 0;
    
    const oldAvgReward = oldExperiences.reduce((sum, e) => sum + e.reward, 0) / oldExperiences.length;
    const newAvgReward = newExperiences.reduce((sum, e) => sum + e.reward, 0) / newExperiences.length;
    
    return Math.max(0, Math.min(1, (newAvgReward - oldAvgReward + 1) / 2));
  }

  private analyzeCapabilityProgress(): {
    improved: string[];
    needsWork: string[];
    recommendations: string[];
  } {
    const improved: string[] = [];
    const needsWork: string[] = [];
    const recommendations: string[] = [];

    for (const [name, capability] of this.capabilities) {
      if (capability.proficiency > 0.8) {
        improved.push(name);
      } else if (capability.proficiency < 0.5) {
        needsWork.push(name);
        recommendations.push(`Focus on improving ${name} capability`);
      }
    }

    if (improved.length === 0) {
      recommendations.push('Continue practicing to improve overall capabilities');
    }

    return { improved, needsWork, recommendations };
  }

  private startEnhancedAutonomousBehavior(): void {
    setInterval(() => {
      this.enhancedAutonomousThink();
    }, 10000); // Think every 10 seconds
  }

  private async enhancedAutonomousThink(): Promise<void> {
    // Update state
    this.updateState();
    
    // Update current environment state
    this.currentState = this.createEnvironmentState();

    // Check if we should take an action
    if (this.qLearningAgent && Math.random() < 0.3) { // 30% chance of taking action
      try {
        const action = await this.qLearningAgent.selectAction(this.currentState);
        await this.executeAction(action);
      } catch (error) {
        logger.error('Error in enhanced autonomous thinking:', error);
      }
    }
  }

  private async executeAction(action: AgentAction): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Simulate action execution
      const success = Math.random() > (action.riskLevel * 0.5); // Lower risk = higher success chance
      const reward = success ? action.expectedReward : -action.expectedReward * 0.5;
      const outcome = success ? 'success' : 'failure';

      // Learn from the action
      await this.learnFromEnhancedExperience(
        action.name,
        { actionType: action.type, context: action.context },
        outcome,
        reward
      );

      const executionTime = Date.now() - startTime;
      
      this.emit('action:executed', {
        agentId: this.id,
        action,
        outcome,
        reward,
        executionTime
      });

    } catch (error) {
      logger.error('Error executing action:', error);
    }
  }

  // Original methods for compatibility
  private makeOriginalDecision(situation: string, options: DecisionOption[]): string {
    // Simplified decision making
    return options.sort((a, b) => b.probability - a.probability)[0].id;
  }

  private extractLessons(experience: any): string[] {
    // Extract lessons from experience
    return [`Learned from ${experience.action} with outcome ${experience.outcome}`];
  }

  private updateCapabilities(experience: Experience): void {
    // Update capabilities based on experience
    for (const [name, capability] of this.capabilities) {
      if (experience.action.toLowerCase().includes(name.toLowerCase())) {
        const adjustment = experience.outcome === 'success' ? 0.01 : -0.005;
        capability.proficiency = Math.max(0, Math.min(1, capability.proficiency + adjustment));
      }
    }
  }

  private updateState(): void {
    // Update agent state
    const goalCount = this.goals.size;
    const recentFailures = this.experiences.slice(-10).filter(e => e.outcome === 'failure').length;
    
    this.state.workload = Math.min(100, goalCount * 20);
    this.state.stress = Math.min(100, recentFailures * 10);
    this.state.energy = Math.max(0, 100 - (this.state.workload + this.state.stress) / 2);
    
    if (this.state.stress > 70) {
      this.state.mood = 'frustrated';
    } else if (this.state.workload > 80) {
      this.state.mood = 'uncertain';
    } else {
      this.state.mood = 'confident';
    }
  }

  // Public API methods
  getState(): AgentState {
    return { ...this.state };
  }

  getGoals(): Goal[] {
    return Array.from(this.goals.values());
  }

  getCapabilities(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  getExperiences(limit: number = 10): Experience[] {
    return this.experiences.slice(-limit);
  }

  async saveModel(filepath: string): Promise<void> {
    if (this.qLearningAgent) {
      await this.qLearningAgent.save(`${filepath}/${this.id}_qlearning`);
      logger.info(`Agent model saved: ${this.name}`);
    }
  }

  async loadModel(filepath: string): Promise<void> {
    if (this.qLearningAgent) {
      await this.qLearningAgent.load(`${filepath}/${this.id}_qlearning`);
      logger.info(`Agent model loaded: ${this.name}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.qLearningAgent) {
      this.qLearningAgent.dispose();
    }
    logger.info(`Agent shutdown: ${this.name}`);
  }
}

// Re-export logger for compatibility
const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[ERROR] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[DEBUG] ${msg}`, ...args)
};