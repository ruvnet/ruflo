/**
 * Production ML Engine - Real machine learning training and inference
 */

import * as tf from '@tensorflow/tfjs-node';
import { Matrix } from 'ml-matrix';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LearningModel,
  ModelType,
  ModelArchitecture,
  ModelParameters,
  TrainingData,
  ModelPerformance,
  Layer
} from '../types';
import { logger } from '../utils/logger';

export interface MLModel {
  tfModel: tf.LayersModel;
  metadata: LearningModel;
  scaler?: {
    mean: number[];
    std: number[];
  };
}

export interface TrainingMetrics {
  epoch: number;
  loss: number;
  accuracy?: number;
  valLoss?: number;
  valAccuracy?: number;
  learningRate: number;
}

export interface HyperparameterConfig {
  learningRate?: number[];
  batchSize?: number[];
  epochs?: number[];
  layers?: number[][];
  dropout?: number[];
}

export class ProductionMLEngine extends EventEmitter {
  private models: Map<string, MLModel> = new Map();
  private trainingJobs: Map<string, TrainingJob> = new Map();
  private modelStorage: string = './models';

  constructor() {
    super();
    this.initializeModelStorage();
  }

  private async initializeModelStorage(): Promise<void> {
    try {
      await fs.mkdir(this.modelStorage, { recursive: true });
      logger.info('Model storage initialized');
    } catch (error) {
      logger.error('Failed to initialize model storage:', error);
    }
  }

  /**
   * Train a neural network model with real TensorFlow.js
   */
  async trainModel(
    type: ModelType,
    data: { features: number[][]; labels: any[] },
    parameters?: Partial<ModelParameters>,
    modelId?: string
  ): Promise<LearningModel> {
    // Validate input data
    this.validateTrainingData(data);

    // Get or create model metadata
    let modelMetadata: LearningModel;
    if (modelId && this.models.has(modelId)) {
      modelMetadata = this.models.get(modelId)!.metadata;
      modelMetadata.version = this.incrementVersion(modelMetadata.version);
    } else {
      modelMetadata = this.createModelMetadata(type, parameters);
    }

    // Create training job
    const job: TrainingJob = {
      id: uuidv4(),
      modelId: modelMetadata.id,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      data,
      parameters: modelMetadata.parameters,
      metrics: []
    };

    this.trainingJobs.set(job.id, job);
    logger.info(`Training job created: ${job.id} for model ${modelMetadata.name}`);

    try {
      // Execute real training
      const mlModel = await this.executeRealTraining(modelMetadata, job);
      
      // Store the trained model
      this.models.set(modelMetadata.id, mlModel);
      
      // Save model to disk
      await this.saveModelToDisk(mlModel);
      
      job.status = 'completed';
      job.completedAt = new Date();
      modelMetadata.lastTrained = new Date();

      this.emit('training:complete', { model: modelMetadata, job });
      logger.info(`Training completed for model ${modelMetadata.name}`);

      return modelMetadata;
    } catch (error) {
      job.status = 'failed';
      job.error = error as Error;
      logger.error(`Training failed for model ${modelMetadata.name}:`, error);
      this.emit('training:failed', { model: modelMetadata, job, error });
      throw error;
    }
  }

  /**
   * Execute real neural network training
   */
  private async executeRealTraining(
    modelMetadata: LearningModel,
    job: TrainingJob
  ): Promise<MLModel> {
    job.status = 'running';
    this.emit('training:started', { model: modelMetadata, job });

    // Prepare and normalize data
    const { trainData, validationData, testData, scaler } = await this.prepareTrainingData(
      job.data,
      modelMetadata.trainingData.splits
    );

    // Build TensorFlow model
    const tfModel = await this.buildTensorFlowModel(modelMetadata);

    // Compile model
    this.compileModel(tfModel, modelMetadata);

    // Setup training callbacks
    const callbacks = this.createTrainingCallbacks(job, modelMetadata);

    // Convert data to tensors
    const trainTensors = this.dataToTensors(trainData);
    const valTensors = validationData ? this.dataToTensors(validationData) : undefined;

    try {
      // Train the model
      const history = await tfModel.fit(trainTensors.features, trainTensors.labels, {
        epochs: modelMetadata.parameters.epochs,
        batchSize: modelMetadata.parameters.batchSize,
        validationData: valTensors ? [valTensors.features, valTensors.labels] : undefined,
        callbacks,
        verbose: 1
      });

      // Evaluate on test data if available
      if (testData) {
        const testTensors = this.dataToTensors(testData);
        const evaluation = await tfModel.evaluate(testTensors.features, testTensors.labels) as tf.Scalar[];
        
        modelMetadata.performance = await this.calculatePerformanceMetrics(
          evaluation,
          history,
          modelMetadata.type
        );

        // Cleanup test tensors
        testTensors.features.dispose();
        testTensors.labels.dispose();
      }

      // Cleanup training tensors
      trainTensors.features.dispose();
      trainTensors.labels.dispose();
      if (valTensors) {
        valTensors.features.dispose();
        valTensors.labels.dispose();
      }

      // Update model metadata
      modelMetadata.trainingData.size = job.data.features.length;
      modelMetadata.trainingData.features = this.extractFeatureNames(job.data.features[0]);
      modelMetadata.trainingData.labels = this.extractLabelNames(job.data.labels);

      return {
        tfModel,
        metadata: modelMetadata,
        scaler
      };

    } catch (error) {
      // Cleanup tensors on error
      trainTensors.features.dispose();
      trainTensors.labels.dispose();
      if (valTensors) {
        valTensors.features.dispose();
        valTensors.labels.dispose();
      }
      throw error;
    }
  }

  /**
   * Build TensorFlow.js model from architecture
   */
  private async buildTensorFlowModel(modelMetadata: LearningModel): Promise<tf.LayersModel> {
    const { architecture } = modelMetadata;
    const model = tf.sequential();

    // Add layers based on architecture
    for (let i = 0; i < architecture.layers.length; i++) {
      const layer = architecture.layers[i];
      const isFirstLayer = i === 0;

      switch (layer.type) {
        case 'dense':
          const denseConfig: tf.layers.DenseLayerArgs = {
            units: layer.units!,
            activation: layer.activation as tf.Activation,
            ...layer.config
          };

          if (isFirstLayer) {
            // Infer input shape from first layer config or use default
            denseConfig.inputShape = layer.config.inputShape || [modelMetadata.trainingData.features.length];
          }

          model.add(tf.layers.dense(denseConfig));
          break;

        case 'dropout':
          model.add(tf.layers.dropout({
            rate: layer.config.rate || 0.2
          }));
          break;

        case 'conv2d':
          model.add(tf.layers.conv2d({
            filters: layer.units || 32,
            kernelSize: layer.config.kernelSize || 3,
            activation: layer.activation as tf.Activation,
            ...layer.config
          }));
          break;

        case 'maxPooling2d':
          model.add(tf.layers.maxPooling2d({
            poolSize: layer.config.poolSize || 2,
            ...layer.config
          }));
          break;

        case 'flatten':
          model.add(tf.layers.flatten());
          break;

        case 'lstm':
          model.add(tf.layers.lstm({
            units: layer.units!,
            returnSequences: layer.config.returnSequences || false,
            ...layer.config
          }));
          break;

        default:
          logger.warn(`Unknown layer type: ${layer.type}`);
      }
    }

    return model;
  }

  /**
   * Compile TensorFlow model
   */
  private compileModel(model: tf.LayersModel, modelMetadata: LearningModel): void {
    const { architecture } = modelMetadata;

    // Get optimizer
    let optimizer: tf.Optimizer;
    switch (architecture.optimizer) {
      case 'adam':
        optimizer = tf.train.adam(modelMetadata.parameters.learningRate);
        break;
      case 'sgd':
        optimizer = tf.train.sgd(modelMetadata.parameters.learningRate);
        break;
      case 'rmsprop':
        optimizer = tf.train.rmsprop(modelMetadata.parameters.learningRate);
        break;
      default:
        optimizer = tf.train.adam(modelMetadata.parameters.learningRate);
    }

    // Get loss function
    let loss: string | tf.LossOrMetricFn;
    switch (architecture.lossFunction) {
      case 'categorical_crossentropy':
        loss = 'categoricalCrossentropy';
        break;
      case 'binary_crossentropy':
        loss = 'binaryCrossentropy';
        break;
      case 'sparse_categorical_crossentropy':
        loss = 'sparseCategoricalCrossentropy';
        break;
      case 'mse':
        loss = 'meanSquaredError';
        break;
      case 'mae':
        loss = 'meanAbsoluteError';
        break;
      default:
        loss = 'meanSquaredError';
    }

    // Compile model
    model.compile({
      optimizer,
      loss,
      metrics: architecture.metrics || ['accuracy']
    });
  }

  /**
   * Create training callbacks
   */
  private createTrainingCallbacks(
    job: TrainingJob,
    modelMetadata: LearningModel
  ): tf.CustomCallback[] {
    const callbacks: tf.CustomCallback[] = [];

    // Progress callback
    callbacks.push({
      onEpochEnd: async (epoch: number, logs?: tf.Logs) => {
        const progress = ((epoch + 1) / modelMetadata.parameters.epochs) * 100;
        job.progress = progress;

        const metrics: TrainingMetrics = {
          epoch: epoch + 1,
          loss: logs?.loss || 0,
          accuracy: logs?.acc || logs?.accuracy,
          valLoss: logs?.val_loss,
          valAccuracy: logs?.val_acc || logs?.val_accuracy,
          learningRate: modelMetadata.parameters.learningRate
        };

        job.metrics.push(metrics);
        this.emit('training:progress', { model: modelMetadata, job, epoch, metrics });
      }
    });

    // Early stopping callback
    if (modelMetadata.parameters.earlyStopping) {
      const earlyStopping = modelMetadata.parameters.earlyStopping;
      let bestValue = earlyStopping.mode === 'min' ? Infinity : -Infinity;
      let patienceCount = 0;

      callbacks.push({
        onEpochEnd: async (epoch: number, logs?: tf.Logs) => {
          const currentValue = logs?.[earlyStopping.monitor] as number;
          if (currentValue === undefined) return;

          const improved = earlyStopping.mode === 'min' 
            ? currentValue < (bestValue - earlyStopping.minDelta)
            : currentValue > (bestValue + earlyStopping.minDelta);

          if (improved) {
            bestValue = currentValue;
            patienceCount = 0;
          } else {
            patienceCount++;
          }

          if (patienceCount >= earlyStopping.patience) {
            logger.info(`Early stopping at epoch ${epoch + 1}`);
            // Note: TensorFlow.js doesn't support stopping training mid-way
            // This would need to be implemented at a higher level
          }
        }
      });
    }

    return callbacks;
  }

  /**
   * Prepare and normalize training data
   */
  private async prepareTrainingData(
    data: { features: number[][]; labels: any[] },
    splits: { train: number; validation: number; test: number }
  ): Promise<{
    trainData: { features: number[][]; labels: any[] };
    validationData?: { features: number[][]; labels: any[] };
    testData?: { features: number[][]; labels: any[] };
    scaler: { mean: number[]; std: number[] };
  }> {
    // Split data
    const { trainData, validationData, testData } = this.splitData(data, splits);

    // Calculate normalization parameters from training data
    const features = new Matrix(trainData.features);
    const mean = features.mean('row');
    const std = features.standardDeviation('row', true);

    // Normalize features
    const normalizeFeatures = (featureMatrix: number[][]): number[][] => {
      const matrix = new Matrix(featureMatrix);
      return matrix.subRowVector(mean).divRowVector(std).to2DArray();
    };

    const normalizedTrainData = {
      features: normalizeFeatures(trainData.features),
      labels: trainData.labels
    };

    const normalizedValidationData = validationData ? {
      features: normalizeFeatures(validationData.features),
      labels: validationData.labels
    } : undefined;

    const normalizedTestData = testData ? {
      features: normalizeFeatures(testData.features),
      labels: testData.labels
    } : undefined;

    return {
      trainData: normalizedTrainData,
      validationData: normalizedValidationData,
      testData: normalizedTestData,
      scaler: {
        mean: mean.to1DArray(),
        std: std.to1DArray()
      }
    };
  }

  /**
   * Convert data to TensorFlow tensors
   */
  private dataToTensors(data: { features: number[][]; labels: any[] }): {
    features: tf.Tensor;
    labels: tf.Tensor;
  } {
    const features = tf.tensor2d(data.features);
    
    // Handle different label types
    let labels: tf.Tensor;
    if (typeof data.labels[0] === 'number') {
      // Numerical labels (regression or integer classification)
      labels = tf.tensor1d(data.labels as number[]);
    } else if (Array.isArray(data.labels[0])) {
      // One-hot encoded labels
      labels = tf.tensor2d(data.labels as number[][]);
    } else {
      // String labels - convert to integers
      const uniqueLabels = Array.from(new Set(data.labels));
      const labelMap = new Map(uniqueLabels.map((label, index) => [label, index]));
      const intLabels = data.labels.map(label => labelMap.get(label)!);
      labels = tf.tensor1d(intLabels);
    }

    return { features, labels };
  }

  /**
   * Make predictions with trained model
   */
  async predict(modelId: string, input: number[] | number[][]): Promise<any> {
    const mlModel = this.models.get(modelId);
    if (!mlModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Normalize input if scaler is available
    let normalizedInput = Array.isArray(input[0]) ? input as number[][] : [input as number[]];
    
    if (mlModel.scaler) {
      const matrix = new Matrix(normalizedInput);
      const meanVector = new Matrix([mlModel.scaler.mean]);
      const stdVector = new Matrix([mlModel.scaler.std]);
      normalizedInput = matrix.subRowVector(meanVector.getRow(0)).divRowVector(stdVector.getRow(0)).to2DArray();
    }

    // Convert to tensor
    const inputTensor = tf.tensor2d(normalizedInput);

    try {
      // Make prediction
      const prediction = mlModel.tfModel.predict(inputTensor) as tf.Tensor;
      const predictionData = await prediction.data();
      const predictionArray = Array.from(predictionData);

      // Format prediction based on model type
      const result = this.formatPrediction(
        predictionArray,
        mlModel.metadata.type,
        mlModel.metadata.trainingData.labels
      );

      // Cleanup tensors
      inputTensor.dispose();
      prediction.dispose();

      this.emit('prediction:made', { model: mlModel.metadata, input, prediction: result });

      return Array.isArray(input[0]) ? result : result[0];
    } catch (error) {
      inputTensor.dispose();
      throw error;
    }
  }

  /**
   * Format prediction output based on model type
   */
  private formatPrediction(
    prediction: number[],
    modelType: ModelType,
    labels: string[]
  ): any[] {
    switch (modelType) {
      case ModelType.CLASSIFICATION:
        // For classification, convert to probabilities and class predictions
        const softmax = this.softmax(prediction);
        const maxIndex = softmax.indexOf(Math.max(...softmax));
        
        return [{
          class: labels[maxIndex] || `class_${maxIndex}`,
          probabilities: softmax.map((prob, i) => ({
            class: labels[i] || `class_${i}`,
            probability: prob
          }))
        }];

      case ModelType.REGRESSION:
        // For regression, return the predicted values
        return prediction;

      default:
        return prediction;
    }
  }

  /**
   * Save model to disk for persistence
   */
  private async saveModelToDisk(mlModel: MLModel): Promise<void> {
    const modelPath = path.join(this.modelStorage, mlModel.metadata.id);
    
    try {
      // Save TensorFlow model
      await mlModel.tfModel.save(`file://${modelPath}`);
      
      // Save metadata and scaler
      const metadataPath = path.join(modelPath, 'metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify({
        metadata: mlModel.metadata,
        scaler: mlModel.scaler
      }, null, 2));

      logger.info(`Model saved to disk: ${modelPath}`);
    } catch (error) {
      logger.error(`Failed to save model to disk: ${error}`);
      throw error;
    }
  }

  /**
   * Load model from disk
   */
  async loadModelFromDisk(modelId: string): Promise<MLModel> {
    const modelPath = path.join(this.modelStorage, modelId);
    
    try {
      // Load TensorFlow model
      const tfModel = await tf.loadLayersModel(`file://${modelPath}/model.json`);
      
      // Load metadata and scaler
      const metadataPath = path.join(modelPath, 'metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const { metadata, scaler } = JSON.parse(metadataContent);

      const mlModel: MLModel = {
        tfModel,
        metadata,
        scaler
      };

      this.models.set(modelId, mlModel);
      logger.info(`Model loaded from disk: ${modelPath}`);

      return mlModel;
    } catch (error) {
      logger.error(`Failed to load model from disk: ${error}`);
      throw error;
    }
  }

  /**
   * Hyperparameter optimization using grid search
   */
  async optimizeHyperparameters(
    type: ModelType,
    data: { features: number[][]; labels: any[] },
    config: HyperparameterConfig,
    maxTrials: number = 10
  ): Promise<{ bestParams: ModelParameters; bestScore: number; results: any[] }> {
    const results: any[] = [];
    let bestScore = -Infinity;
    let bestParams: ModelParameters = this.getDefaultParameters(type);

    // Generate parameter combinations
    const paramCombinations = this.generateParameterCombinations(config, maxTrials);

    for (const params of paramCombinations) {
      try {
        logger.info(`Testing hyperparameters: ${JSON.stringify(params)}`);
        
        // Train model with these parameters
        const model = await this.trainModel(type, data, params);
        const score = model.performance.accuracy || model.performance.loss || 0;

        results.push({
          parameters: params,
          score,
          performance: model.performance
        });

        if (score > bestScore) {
          bestScore = score;
          bestParams = { ...this.getDefaultParameters(type), ...params };
        }

        // Clean up the test model
        this.deleteModel(model.id);
      } catch (error) {
        logger.warn(`Hyperparameter trial failed: ${error}`);
      }
    }

    return {
      bestParams,
      bestScore,
      results: results.sort((a, b) => b.score - a.score)
    };
  }

  /**
   * Generate parameter combinations for grid search
   */
  private generateParameterCombinations(
    config: HyperparameterConfig,
    maxTrials: number
  ): Partial<ModelParameters>[] {
    const combinations: Partial<ModelParameters>[] = [];
    
    const learningRates = config.learningRate || [0.001];
    const batchSizes = config.batchSize || [32];
    const epochs = config.epochs || [50];

    // Generate all combinations (limited by maxTrials)
    for (const lr of learningRates) {
      for (const batchSize of batchSizes) {
        for (const epoch of epochs) {
          if (combinations.length >= maxTrials) break;
          
          combinations.push({
            learningRate: lr,
            batchSize,
            epochs: epoch
          });
        }
        if (combinations.length >= maxTrials) break;
      }
      if (combinations.length >= maxTrials) break;
    }

    return combinations;
  }

  /**
   * Model drift detection
   */
  async detectModelDrift(
    modelId: string,
    newData: { features: number[][]; labels: any[] },
    threshold: number = 0.1
  ): Promise<{
    hasDrift: boolean;
    driftScore: number;
    recommendations: string[];
  }> {
    const mlModel = this.models.get(modelId);
    if (!mlModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Make predictions on new data
    const predictions = await this.predict(modelId, newData.features);
    
    // Calculate performance on new data
    const newPerformance = await this.evaluateModel(modelId, newData);
    
    // Compare with original performance
    const originalPerformance = mlModel.metadata.performance;
    const performanceDrop = (originalPerformance.accuracy || 0) - (newPerformance.accuracy || 0);
    
    const hasDrift = performanceDrop > threshold;
    const driftScore = Math.abs(performanceDrop);

    const recommendations: string[] = [];
    if (hasDrift) {
      recommendations.push('Model performance has degraded significantly');
      recommendations.push('Consider retraining with new data');
      recommendations.push('Review data distribution changes');
    }

    return {
      hasDrift,
      driftScore,
      recommendations
    };
  }

  /**
   * Evaluate model performance on test data
   */
  async evaluateModel(
    modelId: string,
    testData: { features: number[][]; labels: any[] }
  ): Promise<ModelPerformance> {
    const mlModel = this.models.get(modelId);
    if (!mlModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Prepare test data
    const { features, labels } = this.dataToTensors(testData);

    try {
      // Evaluate model
      const evaluation = await mlModel.tfModel.evaluate(features, labels) as tf.Scalar[];
      
      // Get evaluation metrics
      const loss = await evaluation[0].data();
      const accuracy = evaluation.length > 1 ? await evaluation[1].data() : undefined;

      // Calculate additional metrics for classification
      let precision, recall, f1Score;
      if (mlModel.metadata.type === ModelType.CLASSIFICATION) {
        const predictions = await this.predict(modelId, testData.features);
        ({ precision, recall, f1Score } = this.calculateClassificationMetrics(
          testData.labels,
          predictions
        ));
      }

      // Cleanup tensors
      features.dispose();
      labels.dispose();
      evaluation.forEach(tensor => tensor.dispose());

      return {
        accuracy: accuracy ? accuracy[0] : undefined,
        loss: loss[0],
        precision,
        recall,
        f1Score,
        customMetrics: {}
      };
    } catch (error) {
      features.dispose();
      labels.dispose();
      throw error;
    }
  }

  /**
   * Calculate classification metrics
   */
  private calculateClassificationMetrics(
    trueLabels: any[],
    predictions: any[]
  ): { precision: number; recall: number; f1Score: number } {
    // Simplified classification metrics calculation
    let correct = 0;
    let totalPositives = 0;
    let truePositives = 0;
    let falsePositives = 0;

    for (let i = 0; i < trueLabels.length; i++) {
      const predicted = predictions[i].class || predictions[i];
      const actual = trueLabels[i];

      if (predicted === actual) {
        correct++;
        if (actual === 1 || actual === true) {
          truePositives++;
        }
      } else if (predicted === 1 || predicted === true) {
        falsePositives++;
      }

      if (actual === 1 || actual === true) {
        totalPositives++;
      }
    }

    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / totalPositives || 0;
    const f1Score = 2 * (precision * recall) / (precision + recall) || 0;

    return { precision, recall, f1Score };
  }

  // Utility methods from original engine
  private validateTrainingData(data: { features: number[][]; labels: any[] }): void {
    if (!data.features || !data.labels) {
      throw new Error('Training data must contain features and labels');
    }

    if (data.features.length !== data.labels.length) {
      throw new Error('Features and labels must have the same length');
    }

    if (data.features.length === 0) {
      throw new Error('Training data cannot be empty');
    }

    // Check for consistent feature dimensions
    const featureLength = data.features[0].length;
    for (const feature of data.features) {
      if (feature.length !== featureLength) {
        throw new Error('All feature vectors must have the same dimension');
      }
    }
  }

  private createModelMetadata(
    type: ModelType,
    parameters?: Partial<ModelParameters>
  ): LearningModel {
    const architecture = this.getDefaultArchitecture(type);
    const defaultParams = this.getDefaultParameters(type);

    return {
      id: uuidv4(),
      name: `${type}-model-${Date.now()}`,
      type,
      architecture,
      parameters: { ...defaultParams, ...parameters },
      trainingData: {
        datasetId: uuidv4(),
        features: [],
        labels: [],
        size: 0,
        splits: { train: 0.8, validation: 0.1, test: 0.1 }
      },
      performance: { customMetrics: {} },
      version: '1.0.0',
      createdAt: new Date(),
      lastTrained: new Date()
    };
  }

  private getDefaultArchitecture(type: ModelType): ModelArchitecture {
    const architectures: Record<ModelType, ModelArchitecture> = {
      [ModelType.CLASSIFICATION]: {
        layers: [
          { type: 'dense', units: 128, activation: 'relu', config: {} },
          { type: 'dropout', config: { rate: 0.3 } },
          { type: 'dense', units: 64, activation: 'relu', config: {} },
          { type: 'dropout', config: { rate: 0.3 } },
          { type: 'dense', units: 10, activation: 'softmax', config: {} }
        ],
        optimizer: 'adam',
        lossFunction: 'categorical_crossentropy',
        metrics: ['accuracy']
      },
      [ModelType.REGRESSION]: {
        layers: [
          { type: 'dense', units: 64, activation: 'relu', config: {} },
          { type: 'dense', units: 32, activation: 'relu', config: {} },
          { type: 'dense', units: 1, activation: 'linear', config: {} }
        ],
        optimizer: 'adam',
        lossFunction: 'mse',
        metrics: ['mae']
      },
      [ModelType.CLUSTERING]: {
        layers: [
          { type: 'dense', units: 128, activation: 'relu', config: {} },
          { type: 'dense', units: 64, activation: 'relu', config: {} },
          { type: 'dense', units: 32, config: {} }
        ],
        optimizer: 'adam',
        lossFunction: 'mse',
        metrics: []
      },
      [ModelType.REINFORCEMENT]: {
        layers: [
          { type: 'dense', units: 256, activation: 'relu', config: {} },
          { type: 'dense', units: 128, activation: 'relu', config: {} },
          { type: 'dense', units: 4, activation: 'linear', config: {} }
        ],
        optimizer: 'adam',
        lossFunction: 'mse',
        metrics: []
      },
      [ModelType.GENERATIVE]: {
        layers: [
          { type: 'dense', units: 128, activation: 'relu', config: {} },
          { type: 'dense', units: 256, activation: 'relu', config: {} },
          { type: 'dense', units: 128, activation: 'tanh', config: {} }
        ],
        optimizer: 'adam',
        lossFunction: 'binary_crossentropy',
        metrics: []
      }
    };

    return architectures[type];
  }

  private getDefaultParameters(type: ModelType): ModelParameters {
    return {
      epochs: 100,
      batchSize: 32,
      learningRate: 0.001,
      validationSplit: 0.2,
      earlyStopping: {
        monitor: 'val_loss',
        patience: 10,
        minDelta: 0.001,
        mode: 'min'
      }
    };
  }

  private splitData(
    data: { features: number[][]; labels: any[] },
    splits: { train: number; validation: number; test: number }
  ): {
    trainData: { features: number[][]; labels: any[] };
    validationData?: { features: number[][]; labels: any[] };
    testData?: { features: number[][]; labels: any[] };
  } {
    const totalSize = data.features.length;
    const trainSize = Math.floor(totalSize * splits.train);
    const validationSize = Math.floor(totalSize * splits.validation);

    // Shuffle data
    const indices = Array.from({ length: totalSize }, (_, i) => i);
    this.shuffle(indices);

    // Split indices
    const trainIndices = indices.slice(0, trainSize);
    const validationIndices = indices.slice(trainSize, trainSize + validationSize);
    const testIndices = indices.slice(trainSize + validationSize);

    return {
      trainData: {
        features: trainIndices.map(i => data.features[i]),
        labels: trainIndices.map(i => data.labels[i])
      },
      validationData: validationIndices.length > 0 ? {
        features: validationIndices.map(i => data.features[i]),
        labels: validationIndices.map(i => data.labels[i])
      } : undefined,
      testData: testIndices.length > 0 ? {
        features: testIndices.map(i => data.features[i]),
        labels: testIndices.map(i => data.labels[i])
      } : undefined
    };
  }

  private async calculatePerformanceMetrics(
    evaluation: tf.Scalar[],
    history: tf.History,
    modelType: ModelType
  ): Promise<ModelPerformance> {
    const loss = await evaluation[0].data();
    const accuracy = evaluation.length > 1 ? await evaluation[1].data() : undefined;

    const performance: ModelPerformance = {
      loss: loss[0],
      accuracy: accuracy ? accuracy[0] : undefined,
      customMetrics: {}
    };

    // Add history-based metrics
    if (history.history.val_loss) {
      const valLosses = history.history.val_loss as number[];
      performance.customMetrics.final_val_loss = valLosses[valLosses.length - 1];
    }

    if (history.history.val_acc || history.history.val_accuracy) {
      const valAccuracies = (history.history.val_acc || history.history.val_accuracy) as number[];
      performance.customMetrics.final_val_accuracy = valAccuracies[valAccuracies.length - 1];
    }

    return performance;
  }

  private extractFeatureNames(sample: number[]): string[] {
    return sample.map((_, i) => `feature_${i}`);
  }

  private extractLabelNames(labels: any[]): string[] {
    const unique = Array.from(new Set(labels));
    return unique.map(label => String(label));
  }

  private softmax(values: number[]): number[] {
    const max = Math.max(...values);
    const exp = values.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(e => e / sum);
  }

  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2]) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  // Public API methods
  getModel(modelId: string): LearningModel | undefined {
    const mlModel = this.models.get(modelId);
    return mlModel?.metadata;
  }

  getAllModels(): LearningModel[] {
    return Array.from(this.models.values()).map(mlModel => mlModel.metadata);
  }

  getModelsByType(type: ModelType): LearningModel[] {
    return this.getAllModels().filter(model => model.type === type);
  }

  deleteModel(modelId: string): void {
    const mlModel = this.models.get(modelId);
    if (!mlModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Dispose TensorFlow model
    mlModel.tfModel.dispose();
    
    // Remove from memory
    this.models.delete(modelId);

    logger.info(`Model deleted: ${mlModel.metadata.name} (${modelId})`);
    this.emit('model:deleted', modelId);
  }

  exportModel(modelId: string): string {
    const mlModel = this.models.get(modelId);
    if (!mlModel) {
      throw new Error(`Model ${modelId} not found`);
    }

    // For export, we serialize the metadata and model path
    return JSON.stringify({
      metadata: mlModel.metadata,
      scaler: mlModel.scaler,
      modelPath: path.join(this.modelStorage, modelId)
    });
  }

  // Cleanup on shutdown
  async shutdown(): Promise<void> {
    // Dispose all TensorFlow models
    for (const mlModel of this.models.values()) {
      mlModel.tfModel.dispose();
    }
    this.models.clear();
    logger.info('Production ML Engine shutdown complete');
  }
}

interface TrainingJob {
  id: string;
  modelId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  data: { features: number[][]; labels: any[] };
  parameters: ModelParameters;
  metrics: TrainingMetrics[];
  error?: Error;
}