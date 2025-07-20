/**
 * Comprehensive tests for Production ML Engine
 */

import { ProductionMLEngine } from '../core/production-ml-engine';
import { ModelManagementSystem } from '../core/model-management';
import { QLearningAgent } from '../core/q-learning-agent';
import { MLPipeline } from '../core/ml-pipeline';
import { ModelType } from '../types';

describe('Production ML Engine', () => {
  let mlEngine: ProductionMLEngine;
  let modelManager: ModelManagementSystem;
  let mlPipeline: MLPipeline;

  beforeEach(() => {
    mlEngine = new ProductionMLEngine();
    modelManager = new ModelManagementSystem(mlEngine);
    mlPipeline = new MLPipeline(mlEngine, modelManager);
  });

  afterEach(async () => {
    await mlEngine.shutdown();
    await modelManager.shutdown();
  });

  describe('Real Neural Network Training', () => {
    test('should train a classification model with real TensorFlow.js', async () => {
      // Generate synthetic classification data
      const data = generateClassificationData(1000, 10, 3);
      
      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        {
          epochs: 10,
          batchSize: 32,
          learningRate: 0.001
        }
      );

      expect(model).toBeDefined();
      expect(model.type).toBe(ModelType.CLASSIFICATION);
      expect(model.performance.accuracy).toBeGreaterThan(0);
      expect(model.performance.loss).toBeGreaterThan(0);
    }, 30000);

    test('should train a regression model with real neural network', async () => {
      // Generate synthetic regression data
      const data = generateRegressionData(500, 5);
      
      const model = await mlEngine.trainModel(
        ModelType.REGRESSION,
        data,
        {
          epochs: 15,
          batchSize: 16,
          learningRate: 0.01
        }
      );

      expect(model).toBeDefined();
      expect(model.type).toBe(ModelType.REGRESSION);
      expect(model.performance.loss).toBeGreaterThan(0);
    }, 25000);

    test('should apply data normalization during training', async () => {
      const data = {
        features: [[100, 200, 300], [1, 2, 3], [50, 100, 150]],
        labels: [1, 0, 1]
      };

      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );

      expect(model.trainingData.size).toBe(3);
      expect(model.performance).toBeDefined();
    }, 15000);

    test('should support early stopping', async () => {
      const data = generateClassificationData(100, 5, 2);
      
      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        {
          epochs: 100,
          earlyStopping: {
            monitor: 'val_loss',
            patience: 3,
            minDelta: 0.001,
            mode: 'min'
          }
        }
      );

      expect(model).toBeDefined();
      // Should complete before 100 epochs due to early stopping
    }, 20000);
  });

  describe('Real Model Inference', () => {
    let trainedModel: any;

    beforeEach(async () => {
      const data = generateClassificationData(200, 4, 2);
      trainedModel = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );
    });

    test('should make predictions on single input', async () => {
      const input = [0.5, -0.2, 0.8, 0.1];
      const prediction = await mlEngine.predict(trainedModel.id, input);

      expect(prediction).toBeDefined();
      expect(prediction.class).toBeDefined();
      expect(prediction.probabilities).toBeInstanceOf(Array);
      expect(prediction.probabilities.length).toBe(2); // 2 classes
    });

    test('should make batch predictions', async () => {
      const inputs = [
        [0.5, -0.2, 0.8, 0.1],
        [-0.3, 0.7, -0.1, 0.4],
        [0.1, 0.2, 0.3, 0.4]
      ];
      const predictions = await mlEngine.predict(trainedModel.id, inputs);

      expect(predictions).toBeInstanceOf(Array);
      expect(predictions.length).toBe(3);
      predictions.forEach(pred => {
        expect(pred.class).toBeDefined();
        expect(pred.probabilities).toBeInstanceOf(Array);
      });
    });

    test('should handle normalization during inference', async () => {
      const input = [100, 200, 300, 400]; // Large values that need normalization
      const prediction = await mlEngine.predict(trainedModel.id, input);

      expect(prediction).toBeDefined();
      expect(prediction.class).toBeDefined();
    });
  });

  describe('Hyperparameter Optimization', () => {
    test('should optimize hyperparameters using grid search', async () => {
      const data = generateClassificationData(300, 6, 2);
      
      const optimization = await mlEngine.optimizeHyperparameters(
        ModelType.CLASSIFICATION,
        data,
        {
          learningRate: [0.001, 0.01],
          batchSize: [16, 32],
          epochs: [10, 15]
        },
        4 // Max trials
      );

      expect(optimization.bestParams).toBeDefined();
      expect(optimization.bestScore).toBeGreaterThan(0);
      expect(optimization.results).toBeInstanceOf(Array);
      expect(optimization.results.length).toBeGreaterThan(0);
      expect(optimization.results[0].score).toBeGreaterThanOrEqual(optimization.results[optimization.results.length - 1].score);
    }, 60000);
  });

  describe('Model Persistence', () => {
    test('should save and load model to/from disk', async () => {
      const data = generateClassificationData(100, 3, 2);
      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );

      // Model should be automatically saved during training
      expect(model.id).toBeDefined();

      // Load model from disk
      const loadedModel = await mlEngine.loadModelFromDisk(model.id);
      expect(loadedModel.metadata.id).toBe(model.id);
      expect(loadedModel.metadata.type).toBe(model.type);
    }, 20000);
  });

  describe('Model Drift Detection', () => {
    let baseModel: any;

    beforeEach(async () => {
      const data = generateClassificationData(200, 4, 2);
      baseModel = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 10 }
      );
    });

    test('should detect significant drift', async () => {
      // Create drifted data (different distribution)
      const driftedData = {
        features: Array.from({ length: 50 }, () => 
          Array.from({ length: 4 }, () => Math.random() * 10 + 5) // Shifted distribution
        ),
        labels: Array.from({ length: 50 }, () => Math.floor(Math.random() * 2))
      };

      const driftResult = await mlEngine.detectModelDrift(
        baseModel.id,
        driftedData,
        0.05 // Low threshold
      );

      expect(driftResult.hasDrift).toBe(true);
      expect(driftResult.driftScore).toBeGreaterThan(0);
      expect(driftResult.recommendations).toBeInstanceOf(Array);
      expect(driftResult.recommendations.length).toBeGreaterThan(0);
    }, 25000);

    test('should not detect drift with similar data', async () => {
      // Create similar data
      const similarData = generateClassificationData(50, 4, 2);

      const driftResult = await mlEngine.detectModelDrift(
        baseModel.id,
        similarData,
        0.2 // Higher threshold
      );

      expect(driftResult.hasDrift).toBe(false);
      expect(driftResult.driftScore).toBeLessThan(0.2);
    }, 20000);
  });

  describe('Model Performance Evaluation', () => {
    test('should evaluate model on test data', async () => {
      const trainData = generateClassificationData(200, 5, 3);
      const testData = generateClassificationData(50, 5, 3);
      
      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        trainData,
        { epochs: 10 }
      );

      const performance = await mlEngine.evaluateModel(model.id, testData);

      expect(performance.accuracy).toBeDefined();
      expect(performance.loss).toBeDefined();
      expect(performance.accuracy).toBeGreaterThan(0);
      expect(performance.accuracy).toBeLessThanOrEqual(1);
    }, 30000);
  });
});

describe('Q-Learning Agent', () => {
  let agent: QLearningAgent;
  let actions: any[];

  beforeEach(() => {
    actions = [
      { id: 'action1', name: 'Move Up' },
      { id: 'action2', name: 'Move Down' },
      { id: 'action3', name: 'Move Left' },
      { id: 'action4', name: 'Move Right' }
    ];

    agent = new QLearningAgent(
      8, // State size
      actions,
      {
        learningRate: 0.1,
        discountFactor: 0.95,
        explorationRate: 1.0,
        explorationDecay: 0.995,
        memorySize: 1000,
        batchSize: 32
      }
    );
  });

  afterEach(() => {
    agent.dispose();
  });

  describe('Action Selection', () => {
    test('should select actions using epsilon-greedy policy', async () => {
      const state = agent.createState([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      const action = await agent.selectAction(state);

      expect(actions.map(a => a.id)).toContain(action.id);
    });

    test('should balance exploration and exploitation', async () => {
      const state = agent.createState([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      const selectedActions = [];

      // Run multiple selections
      for (let i = 0; i < 100; i++) {
        const action = await agent.selectAction(state);
        selectedActions.push(action.id);
      }

      // Should have some variety in selected actions (exploration)
      const uniqueActions = new Set(selectedActions);
      expect(uniqueActions.size).toBeGreaterThan(1);
    });
  });

  describe('Learning from Experience', () => {
    test('should learn from positive experiences', async () => {
      const state1 = agent.createState([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      const state2 = agent.createState([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);

      const experience = {
        state: state1,
        action: actions[0],
        reward: 1.0,
        nextState: state2,
        done: false,
        timestamp: new Date()
      };

      await agent.learn(experience);

      // Get Q-values before and after learning
      const qValuesBefore = await agent.getQValues(state1);
      
      // Learn multiple times with positive reward
      for (let i = 0; i < 10; i++) {
        await agent.learn(experience);
      }

      const qValuesAfter = await agent.getQValues(state1);
      
      // Q-value for the rewarded action should increase
      expect(qValuesAfter[0]).toBeGreaterThanOrEqual(qValuesBefore[0]);
    });

    test('should learn from negative experiences', async () => {
      const state1 = agent.createState([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      const state2 = agent.createState([0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]);

      const experience = {
        state: state1,
        action: actions[1],
        reward: -1.0,
        nextState: state2,
        done: true,
        timestamp: new Date()
      };

      // Learn multiple times with negative reward
      for (let i = 0; i < 20; i++) {
        await agent.learn(experience);
      }

      const qValues = await agent.getQValues(state1);
      
      // Q-value for the punished action should be negative or low
      expect(qValues[1]).toBeLessThan(0.1);
    });
  });

  describe('Policy Evaluation', () => {
    test('should provide Q-values for given state', async () => {
      const state = agent.createState([0.3, 0.6, 0.9, 0.2, 0.5, 0.8, 0.1, 0.4]);
      const qValues = await agent.getQValues(state);

      expect(qValues).toBeInstanceOf(Array);
      expect(qValues.length).toBe(actions.length);
      qValues.forEach(qValue => {
        expect(typeof qValue).toBe('number');
      });
    });

    test('should provide policy probabilities', async () => {
      const state = agent.createState([0.2, 0.4, 0.6, 0.8, 0.1, 0.3, 0.5, 0.7]);
      const policy = await agent.getPolicy(state);

      expect(policy).toBeInstanceOf(Array);
      expect(policy.length).toBe(actions.length);
      
      // Probabilities should sum to approximately 1
      const sum = policy.reduce((acc, prob) => acc + prob, 0);
      expect(sum).toBeCloseTo(1, 5);
      
      // All probabilities should be non-negative
      policy.forEach(prob => {
        expect(prob).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Model Persistence', () => {
    test('should save and load agent model', async () => {
      const filepath = './test_agent_model';
      
      // Train agent a bit
      const state = agent.createState([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
      for (let i = 0; i < 10; i++) {
        const action = await agent.selectAction(state);
        const experience = {
          state,
          action,
          reward: Math.random(),
          nextState: state,
          done: false,
          timestamp: new Date()
        };
        await agent.learn(experience);
      }

      // Save model
      await agent.save(filepath);

      // Create new agent and load model
      const newAgent = new QLearningAgent(8, actions);
      await newAgent.load(filepath);

      // Check that statistics are loaded
      const originalStats = agent.getStatistics();
      const loadedStats = newAgent.getStatistics();
      
      expect(loadedStats.trainingStep).toBe(originalStats.trainingStep);
      expect(loadedStats.memorySize).toBe(originalStats.memorySize);

      newAgent.dispose();
    }, 15000);
  });
});

describe('Model Management System', () => {
  let mlEngine: ProductionMLEngine;
  let modelManager: ModelManagementSystem;

  beforeEach(() => {
    mlEngine = new ProductionMLEngine();
    modelManager = new ModelManagementSystem(mlEngine);
  });

  afterEach(async () => {
    await modelManager.shutdown();
    await mlEngine.shutdown();
  });

  describe('Model Registration and Versioning', () => {
    test('should register model and create version', async () => {
      const data = generateClassificationData(100, 4, 2);
      const model = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );

      await modelManager.registerModel(model);

      const registeredModel = modelManager.getModel(model.id);
      expect(registeredModel).toBeDefined();
      expect(registeredModel!.id).toBe(model.id);

      const versions = modelManager.getModelVersions(model.id);
      expect(versions.length).toBe(1);
      expect(versions[0].isActive).toBe(true);
    }, 20000);

    test('should create new version when model is updated', async () => {
      const data = generateClassificationData(100, 4, 2);
      const model1 = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );

      await modelManager.registerModel(model1);

      // Train improved model
      const model2 = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 10 }
      );
      model2.version = '1.1.0';

      const newVersion = await modelManager.createVersion(
        model1.id,
        model2,
        ['improved', 'optimized']
      );

      expect(newVersion.version).toBe('1.1.0');
      expect(newVersion.tags).toContain('improved');
      expect(newVersion.tags).toContain('latest');

      const versions = modelManager.getModelVersions(model1.id);
      expect(versions.length).toBe(2);
      expect(versions.find(v => v.isActive)!.version).toBe('1.1.0');
    }, 30000);
  });

  describe('Model Deployment', () => {
    let trainedModel: any;

    beforeEach(async () => {
      const data = generateClassificationData(100, 4, 2);
      trainedModel = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );
      await modelManager.registerModel(trainedModel);
    });

    test('should deploy model to environment', async () => {
      const versions = modelManager.getModelVersions(trainedModel.id);
      const deployment = await modelManager.deployModel(
        trainedModel.id,
        versions[0].id,
        'staging',
        {
          autoScale: true,
          minInstances: 1,
          maxInstances: 5
        }
      );

      expect(deployment.environment).toBe('staging');
      expect(deployment.status).toBe('active');
      expect(deployment.scaling.autoScale).toBe(true);
      expect(deployment.scaling.minInstances).toBe(1);
      expect(deployment.scaling.maxInstances).toBe(5);
    }, 15000);
  });

  describe('A/B Testing', () => {
    let modelA: any, modelB: any;

    beforeEach(async () => {
      const data = generateClassificationData(100, 4, 2);
      
      modelA = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5, learningRate: 0.001 }
      );
      
      modelB = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 10, learningRate: 0.01 }
      );

      await modelManager.registerModel(modelA);
      await modelManager.registerModel(modelB);
    });

    test('should create A/B test configuration', async () => {
      const abTest = await modelManager.startABTest(
        'Model Performance Comparison',
        modelA.id,
        modelB.id,
        0.6, // 60% traffic to model A
        24 * 60 * 60 * 1000, // 24 hours
        ['accuracy', 'latency']
      );

      expect(abTest.name).toBe('Model Performance Comparison');
      expect(abTest.modelA).toBe(modelA.id);
      expect(abTest.modelB).toBe(modelB.id);
      expect(abTest.trafficSplit).toBe(0.6);
      expect(abTest.status).toBe('active');
    }, 20000);

    test('should route predictions based on A/B test', async () => {
      const abTest = await modelManager.startABTest(
        'Routing Test',
        modelA.id,
        modelB.id,
        0.5
      );

      const input = [0.1, 0.2, 0.3, 0.4];
      const results = [];

      // Make multiple predictions to test routing
      for (let i = 0; i < 20; i++) {
        const result = await modelManager.routePrediction(input, abTest.id);
        results.push(result.modelId);
      }

      // Should have used both models
      const uniqueModels = new Set(results);
      expect(uniqueModels.size).toBeGreaterThan(1);
      expect(uniqueModels.has(modelA.id)).toBe(true);
      expect(uniqueModels.has(modelB.id)).toBe(true);
    }, 25000);
  });

  describe('Model Monitoring', () => {
    let trainedModel: any;

    beforeEach(async () => {
      const data = generateClassificationData(100, 4, 2);
      trainedModel = await mlEngine.trainModel(
        ModelType.CLASSIFICATION,
        data,
        { epochs: 5 }
      );
      await modelManager.registerModel(trainedModel);
    });

    test('should monitor model performance', async () => {
      // Simulate some predictions to generate metrics
      const input = [0.1, 0.2, 0.3, 0.4];
      for (let i = 0; i < 10; i++) {
        await modelManager.routePrediction(input);
      }

      const monitoring = await modelManager.monitorModelPerformance(trainedModel.id);

      expect(monitoring.health).toMatch(/healthy|degraded|critical/);
      expect(monitoring.recommendations).toBeInstanceOf(Array);
      expect(monitoring.metrics).toBeDefined();
    }, 15000);
  });
});

describe('ML Pipeline', () => {
  let mlEngine: ProductionMLEngine;
  let modelManager: ModelManagementSystem;
  let mlPipeline: MLPipeline;

  beforeEach(() => {
    mlEngine = new ProductionMLEngine();
    modelManager = new ModelManagementSystem(mlEngine);
    mlPipeline = new MLPipeline(mlEngine, modelManager);
  });

  afterEach(async () => {
    await modelManager.shutdown();
    await mlEngine.shutdown();
  });

  describe('Pipeline Creation and Execution', () => {
    test('should create and execute simple training pipeline', async () => {
      const pipelineConfig = {
        id: 'test-pipeline-1',
        name: 'Basic Training Pipeline',
        description: 'Simple classification training pipeline',
        stages: [
          {
            id: 'data-collection',
            name: 'Collect Data',
            type: 'data_collection' as const,
            config: {
              source: 'synthetic',
              samples: 200,
              features: 5,
              classes: 2
            },
            dependencies: [],
            timeout: 30000,
            retries: 1
          },
          {
            id: 'preprocessing',
            name: 'Preprocess Data',
            type: 'preprocessing' as const,
            config: {
              processors: ['normalize', 'remove_outliers']
            },
            dependencies: ['data-collection'],
            timeout: 30000,
            retries: 1
          },
          {
            id: 'training',
            name: 'Train Model',
            type: 'training' as const,
            config: {
              modelType: ModelType.CLASSIFICATION,
              parameters: {
                epochs: 10,
                batchSize: 32,
                learningRate: 0.001
              }
            },
            dependencies: ['preprocessing'],
            timeout: 60000,
            retries: 1
          }
        ],
        triggers: [{ type: 'manual' as const, config: {} }],
        notifications: {
          onSuccess: [],
          onFailure: []
        }
      };

      const pipelineId = await mlPipeline.createPipeline(pipelineConfig);
      expect(pipelineId).toBe(pipelineConfig.id);

      const executionId = await mlPipeline.executePipeline(pipelineId);
      expect(executionId).toBeDefined();

      // Wait for execution to complete
      let execution = mlPipeline.getExecution(executionId);
      let attempts = 0;
      while (execution?.status === 'running' && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        execution = mlPipeline.getExecution(executionId);
        attempts++;
      }

      expect(execution?.status).toBe('completed');
      expect(execution?.stages.every(s => s.status === 'completed')).toBe(true);
    }, 120000);

    test('should handle pipeline stage failures gracefully', async () => {
      const pipelineConfig = {
        id: 'test-pipeline-fail',
        name: 'Failing Pipeline',
        description: 'Pipeline with intentional failure',
        stages: [
          {
            id: 'data-collection',
            name: 'Collect Data',
            type: 'data_collection' as const,
            config: {
              source: 'nonexistent', // This should cause failure
            },
            dependencies: [],
            timeout: 10000,
            retries: 1
          }
        ],
        triggers: [{ type: 'manual' as const, config: {} }],
        notifications: {
          onSuccess: [],
          onFailure: []
        }
      };

      const pipelineId = await mlPipeline.createPipeline(pipelineConfig);
      const executionId = await mlPipeline.executePipeline(pipelineId);

      // Wait for execution to fail
      let execution = mlPipeline.getExecution(executionId);
      let attempts = 0;
      while (execution?.status === 'running' && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        execution = mlPipeline.getExecution(executionId);
        attempts++;
      }

      expect(execution?.status).toBe('failed');
      expect(execution?.stages[0].status).toBe('failed');
      expect(execution?.stages[0].error).toBeDefined();
    }, 30000);
  });

  describe('Feature Engineering', () => {
    test('should apply feature engineering transformations', async () => {
      const pipelineConfig = {
        id: 'feature-pipeline',
        name: 'Feature Engineering Pipeline',
        description: 'Pipeline with feature engineering',
        stages: [
          {
            id: 'data-collection',
            name: 'Collect Data',
            type: 'data_collection' as const,
            config: {
              source: 'synthetic',
              samples: 100,
              features: 3,
              classes: 2
            },
            dependencies: [],
            timeout: 30000,
            retries: 1
          },
          {
            id: 'feature-engineering',
            name: 'Engineer Features',
            type: 'feature_engineering' as const,
            config: {
              engineers: ['polynomial_features']
            },
            dependencies: ['data-collection'],
            timeout: 30000,
            retries: 1
          }
        ],
        triggers: [{ type: 'manual' as const, config: {} }],
        notifications: {
          onSuccess: [],
          onFailure: []
        }
      };

      const pipelineId = await mlPipeline.createPipeline(pipelineConfig);
      const executionId = await mlPipeline.executePipeline(pipelineId);

      // Wait for execution to complete
      let execution = mlPipeline.getExecution(executionId);
      let attempts = 0;
      while (execution?.status === 'running' && attempts < 20) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        execution = mlPipeline.getExecution(executionId);
        attempts++;
      }

      expect(execution?.status).toBe('completed');
      
      // Check that feature engineering increased feature count
      const featureStage = execution?.stages.find(s => s.stageId === 'feature-engineering');
      expect(featureStage?.outputs?.newFeatureCount).toBeGreaterThan(
        featureStage?.outputs?.originalFeatureCount
      );
    }, 60000);
  });
});

// Helper functions for generating test data

function generateClassificationData(samples: number, features: number, classes: number) {
  return {
    features: Array.from({ length: samples }, () =>
      Array.from({ length: features }, () => Math.random() * 2 - 1)
    ),
    labels: Array.from({ length: samples }, () => Math.floor(Math.random() * classes))
  };
}

function generateRegressionData(samples: number, features: number) {
  return {
    features: Array.from({ length: samples }, () =>
      Array.from({ length: features }, () => Math.random() * 2 - 1)
    ),
    labels: Array.from({ length: samples }, () => Math.random() * 100)
  };
}

export {
  generateClassificationData,
  generateRegressionData
};