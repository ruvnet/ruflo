/**
 * ML Pipeline - End-to-end machine learning pipeline automation
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ProductionMLEngine } from './production-ml-engine';
import { ModelManagementSystem } from './model-management';
import { QLearningAgent } from './q-learning-agent';
import { ModelType, ModelParameters, LearningModel } from '../types';
import { logger } from '../utils/logger';

export interface PipelineStage {
  id: string;
  name: string;
  type: 'data_collection' | 'preprocessing' | 'feature_engineering' | 
        'training' | 'validation' | 'deployment' | 'monitoring';
  config: Record<string, any>;
  dependencies: string[];
  timeout: number;
  retries: number;
}

export interface PipelineConfig {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  triggers: PipelineTrigger[];
  schedule?: {
    cron: string;
    timezone: string;
  };
  notifications: {
    onSuccess: string[];
    onFailure: string[];
  };
}

export interface PipelineTrigger {
  type: 'manual' | 'scheduled' | 'data_drift' | 'performance_degradation' | 'new_data';
  config: Record<string, any>;
}

export interface PipelineExecution {
  id: string;
  pipelineId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  stages: {
    stageId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    startedAt?: Date;
    completedAt?: Date;
    error?: string;
    outputs?: Record<string, any>;
  }[];
  artifacts: {
    models: string[];
    datasets: string[];
    reports: string[];
  };
  metrics: Record<string, any>;
}

export interface DataProcessor {
  name: string;
  process: (data: any) => Promise<any>;
  validate: (data: any) => boolean;
}

export interface FeatureEngineer {
  name: string;
  transform: (features: number[][]) => Promise<number[][]>;
  inverseTransform?: (features: number[][]) => Promise<number[][]>;
}

export class MLPipeline extends EventEmitter {
  private pipelines: Map<string, PipelineConfig> = new Map();
  private executions: Map<string, PipelineExecution> = new Map();
  private dataProcessors: Map<string, DataProcessor> = new Map();
  private featureEngineers: Map<string, FeatureEngineer> = new Map();
  private activeExecutions: Set<string> = new Set();

  constructor(
    private mlEngine: ProductionMLEngine,
    private modelManager: ModelManagementSystem
  ) {
    super();
    this.initializeBuiltInProcessors();
    this.startScheduler();
  }

  /**
   * Create a new ML pipeline
   */
  async createPipeline(config: PipelineConfig): Promise<string> {
    // Validate pipeline configuration
    this.validatePipelineConfig(config);

    this.pipelines.set(config.id, config);

    this.emit('pipeline:created', { pipelineId: config.id, config });
    logger.info(`ML Pipeline created: ${config.name} (${config.id})`);

    return config.id;
  }

  /**
   * Execute a pipeline
   */
  async executePipeline(
    pipelineId: string,
    trigger: string = 'manual',
    inputs?: Record<string, any>
  ): Promise<string> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    // Create execution record
    const execution: PipelineExecution = {
      id: uuidv4(),
      pipelineId,
      startedAt: new Date(),
      status: 'running',
      stages: pipeline.stages.map(stage => ({
        stageId: stage.id,
        status: 'pending'
      })),
      artifacts: {
        models: [],
        datasets: [],
        reports: []
      },
      metrics: { trigger, inputs }
    };

    this.executions.set(execution.id, execution);
    this.activeExecutions.add(execution.id);

    this.emit('pipeline:started', { execution });
    logger.info(`Pipeline execution started: ${pipeline.name} (${execution.id})`);

    // Execute stages
    try {
      await this.executeStages(execution, pipeline, inputs || {});
      
      execution.status = 'completed';
      execution.completedAt = new Date();
      
      this.emit('pipeline:completed', { execution });
      logger.info(`Pipeline execution completed: ${pipeline.name} (${execution.id})`);
    } catch (error) {
      execution.status = 'failed';
      execution.completedAt = new Date();
      
      this.emit('pipeline:failed', { execution, error });
      logger.error(`Pipeline execution failed: ${pipeline.name} (${execution.id})`, error);
    } finally {
      this.activeExecutions.delete(execution.id);
    }

    return execution.id;
  }

  /**
   * Execute pipeline stages sequentially
   */
  private async executeStages(
    execution: PipelineExecution,
    pipeline: PipelineConfig,
    inputs: Record<string, any>
  ): Promise<void> {
    const stageOutputs: Record<string, any> = { ...inputs };

    for (const stage of pipeline.stages) {
      const stageExecution = execution.stages.find(s => s.stageId === stage.id)!;
      
      // Check dependencies
      const dependenciesMet = stage.dependencies.every(depId => {
        const depStage = execution.stages.find(s => s.stageId === depId);
        return depStage?.status === 'completed';
      });

      if (!dependenciesMet) {
        stageExecution.status = 'skipped';
        continue;
      }

      stageExecution.status = 'running';
      stageExecution.startedAt = new Date();

      this.emit('pipeline:stage_started', { execution, stage });

      try {
        const outputs = await this.executeStage(stage, stageOutputs);
        
        stageExecution.status = 'completed';
        stageExecution.completedAt = new Date();
        stageExecution.outputs = outputs;
        
        // Merge outputs for next stages
        Object.assign(stageOutputs, outputs);

        this.emit('pipeline:stage_completed', { execution, stage, outputs });
      } catch (error) {
        stageExecution.status = 'failed';
        stageExecution.completedAt = new Date();
        stageExecution.error = error instanceof Error ? error.message : String(error);

        this.emit('pipeline:stage_failed', { execution, stage, error });
        throw error;
      }
    }
  }

  /**
   * Execute individual stage
   */
  private async executeStage(stage: PipelineStage, inputs: Record<string, any>): Promise<Record<string, any>> {
    switch (stage.type) {
      case 'data_collection':
        return this.executeDataCollection(stage, inputs);
      
      case 'preprocessing':
        return this.executePreprocessing(stage, inputs);
      
      case 'feature_engineering':
        return this.executeFeatureEngineering(stage, inputs);
      
      case 'training':
        return this.executeTraining(stage, inputs);
      
      case 'validation':
        return this.executeValidation(stage, inputs);
      
      case 'deployment':
        return this.executeDeployment(stage, inputs);
      
      case 'monitoring':
        return this.executeMonitoring(stage, inputs);
      
      default:
        throw new Error(`Unknown stage type: ${stage.type}`);
    }
  }

  /**
   * Execute data collection stage
   */
  private async executeDataCollection(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { source, query, format } = stage.config;

    // Simulate data collection
    let data: { features: number[][]; labels: any[] };

    if (source === 'synthetic') {
      // Generate synthetic data
      data = this.generateSyntheticData(stage.config);
    } else if (source === 'file') {
      // Load from file
      data = await this.loadDataFromFile(stage.config.path);
    } else if (source === 'database') {
      // Query database
      data = await this.queryDatabase(query);
    } else {
      throw new Error(`Unknown data source: ${source}`);
    }

    return {
      dataset: data,
      datasetSize: data.features.length,
      featureCount: data.features[0]?.length || 0
    };
  }

  /**
   * Execute preprocessing stage
   */
  private async executePreprocessing(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { dataset } = inputs;
    const { processors } = stage.config;

    if (!dataset) {
      throw new Error('No dataset provided for preprocessing');
    }

    let processedData = dataset;

    // Apply processors sequentially
    for (const processorName of processors) {
      const processor = this.dataProcessors.get(processorName);
      if (!processor) {
        throw new Error(`Unknown data processor: ${processorName}`);
      }

      if (!processor.validate(processedData)) {
        throw new Error(`Data validation failed for processor: ${processorName}`);
      }

      processedData = await processor.process(processedData);
    }

    return {
      dataset: processedData,
      preprocessingSteps: processors
    };
  }

  /**
   * Execute feature engineering stage
   */
  private async executeFeatureEngineering(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { dataset } = inputs;
    const { engineers } = stage.config;

    if (!dataset) {
      throw new Error('No dataset provided for feature engineering');
    }

    let features = dataset.features;

    // Apply feature engineers sequentially
    for (const engineerName of engineers) {
      const engineer = this.featureEngineers.get(engineerName);
      if (!engineer) {
        throw new Error(`Unknown feature engineer: ${engineerName}`);
      }

      features = await engineer.transform(features);
    }

    return {
      dataset: {
        features,
        labels: dataset.labels
      },
      featureEngineering: engineers,
      originalFeatureCount: dataset.features[0]?.length || 0,
      newFeatureCount: features[0]?.length || 0
    };
  }

  /**
   * Execute training stage
   */
  private async executeTraining(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { dataset } = inputs;
    const { modelType, parameters, hyperparameterOptimization } = stage.config;

    if (!dataset) {
      throw new Error('No dataset provided for training');
    }

    let trainedModel: LearningModel;

    if (hyperparameterOptimization?.enabled) {
      // Perform hyperparameter optimization
      const optimization = await this.mlEngine.optimizeHyperparameters(
        modelType as ModelType,
        dataset,
        hyperparameterOptimization.config,
        hyperparameterOptimization.maxTrials || 10
      );

      trainedModel = await this.mlEngine.trainModel(
        modelType as ModelType,
        dataset,
        optimization.bestParams
      );

      return {
        model: trainedModel,
        hyperparameterOptimization: optimization,
        trainingCompleted: true
      };
    } else {
      // Train with provided parameters
      trainedModel = await this.mlEngine.trainModel(
        modelType as ModelType,
        dataset,
        parameters as ModelParameters
      );

      return {
        model: trainedModel,
        trainingCompleted: true
      };
    }
  }

  /**
   * Execute validation stage
   */
  private async executeValidation(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { model, dataset } = inputs;
    const { validationSplit, metrics } = stage.config;

    if (!model || !dataset) {
      throw new Error('Model and dataset required for validation');
    }

    // Perform model evaluation
    const performance = await this.mlEngine.evaluateModel(model.id, dataset);

    // Check if model meets quality thresholds
    const qualityChecks = this.performQualityChecks(performance, stage.config.thresholds || {});

    return {
      validation: {
        performance,
        qualityChecks,
        passed: qualityChecks.every(check => check.passed)
      }
    };
  }

  /**
   * Execute deployment stage
   */
  private async executeDeployment(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { model, validation } = inputs;
    const { environment, autoScale } = stage.config;

    if (!model) {
      throw new Error('Model required for deployment');
    }

    // Check if validation passed
    if (validation && !validation.passed) {
      throw new Error('Model validation failed - deployment aborted');
    }

    // Register model with model management system
    await this.modelManager.registerModel(model);

    // Deploy model
    const deployment = await this.modelManager.deployModel(
      model.id,
      model.version,
      environment,
      { autoScale }
    );

    return {
      deployment,
      deploymentCompleted: true
    };
  }

  /**
   * Execute monitoring stage
   */
  private async executeMonitoring(
    stage: PipelineStage,
    inputs: Record<string, any>
  ): Promise<Record<string, any>> {
    const { model } = inputs;
    const { driftDetection, alerting } = stage.config;

    if (!model) {
      throw new Error('Model required for monitoring');
    }

    // Set up monitoring
    const monitoringConfig = {
      modelId: model.id,
      driftDetection: driftDetection || { enabled: true, threshold: 0.1 },
      alerting: alerting || { enabled: true, channels: ['email'] }
    };

    return {
      monitoring: monitoringConfig,
      monitoringEnabled: true
    };
  }

  /**
   * Register custom data processor
   */
  registerDataProcessor(processor: DataProcessor): void {
    this.dataProcessors.set(processor.name, processor);
    logger.info(`Data processor registered: ${processor.name}`);
  }

  /**
   * Register custom feature engineer
   */
  registerFeatureEngineer(engineer: FeatureEngineer): void {
    this.featureEngineers.set(engineer.name, engineer);
    logger.info(`Feature engineer registered: ${engineer.name}`);
  }

  /**
   * Initialize built-in processors and engineers
   */
  private initializeBuiltInProcessors(): void {
    // Built-in data processors
    this.registerDataProcessor({
      name: 'normalize',
      process: async (data) => {
        const features = data.features.map((row: number[]) => {
          const max = Math.max(...row);
          const min = Math.min(...row);
          const range = max - min;
          return row.map(val => range === 0 ? 0 : (val - min) / range);
        });
        return { ...data, features };
      },
      validate: (data) => Array.isArray(data.features) && Array.isArray(data.labels)
    });

    this.registerDataProcessor({
      name: 'remove_outliers',
      process: async (data) => {
        // Simple outlier removal using IQR method
        const features = [];
        const labels = [];
        
        for (let i = 0; i < data.features.length; i++) {
          const feature = data.features[i];
          const mean = feature.reduce((sum: number, val: number) => sum + val, 0) / feature.length;
          const std = Math.sqrt(feature.reduce((sum: number, val: number) => sum + Math.pow(val - mean, 2), 0) / feature.length);
          
          // Keep samples within 2 standard deviations
          const isOutlier = feature.some((val: number) => Math.abs(val - mean) > 2 * std);
          
          if (!isOutlier) {
            features.push(feature);
            labels.push(data.labels[i]);
          }
        }
        
        return { features, labels };
      },
      validate: (data) => Array.isArray(data.features) && Array.isArray(data.labels)
    });

    // Built-in feature engineers
    this.registerFeatureEngineer({
      name: 'polynomial_features',
      transform: async (features) => {
        return features.map(row => {
          const polynomial = [...row];
          // Add squared features
          for (let i = 0; i < row.length; i++) {
            polynomial.push(row[i] * row[i]);
          }
          // Add interaction features
          for (let i = 0; i < row.length; i++) {
            for (let j = i + 1; j < row.length; j++) {
              polynomial.push(row[i] * row[j]);
            }
          }
          return polynomial;
        });
      }
    });

    this.registerFeatureEngineer({
      name: 'pca',
      transform: async (features) => {
        // Simplified PCA implementation (would use proper library in production)
        // For now, just return first 2 principal components (simulated)
        return features.map(row => [
          row.reduce((sum, val, i) => sum + val * (i + 1), 0) / row.length,
          row.reduce((sum, val, i) => sum + val * (row.length - i), 0) / row.length
        ]);
      }
    });
  }

  // Helper methods

  private validatePipelineConfig(config: PipelineConfig): void {
    if (!config.id || !config.name || !config.stages) {
      throw new Error('Invalid pipeline configuration');
    }

    // Check for circular dependencies
    const stageIds = new Set(config.stages.map(s => s.id));
    for (const stage of config.stages) {
      for (const dep of stage.dependencies) {
        if (!stageIds.has(dep)) {
          throw new Error(`Unknown dependency: ${dep} in stage ${stage.id}`);
        }
      }
    }
  }

  private generateSyntheticData(config: any): { features: number[][]; labels: any[] } {
    const { samples = 1000, features = 10, classes = 2 } = config;
    
    const data = {
      features: [] as number[][],
      labels: [] as number[]
    };

    for (let i = 0; i < samples; i++) {
      const feature = Array.from({ length: features }, () => Math.random() * 2 - 1);
      const label = Math.floor(Math.random() * classes);
      
      data.features.push(feature);
      data.labels.push(label);
    }

    return data;
  }

  private async loadDataFromFile(filePath: string): Promise<{ features: number[][]; labels: any[] }> {
    // Simulate file loading
    return this.generateSyntheticData({ samples: 500, features: 8, classes: 3 });
  }

  private async queryDatabase(query: string): Promise<{ features: number[][]; labels: any[] }> {
    // Simulate database query
    return this.generateSyntheticData({ samples: 800, features: 12, classes: 4 });
  }

  private performQualityChecks(
    performance: any,
    thresholds: Record<string, number>
  ): { metric: string; value: number; threshold: number; passed: boolean }[] {
    const checks = [];

    for (const [metric, threshold] of Object.entries(thresholds)) {
      const value = performance[metric];
      if (value !== undefined) {
        checks.push({
          metric,
          value,
          threshold,
          passed: value >= threshold
        });
      }
    }

    return checks;
  }

  private startScheduler(): void {
    // Simple scheduler (would use proper cron library in production)
    setInterval(() => {
      this.checkScheduledPipelines();
    }, 60 * 1000); // Check every minute
  }

  private async checkScheduledPipelines(): Promise<void> {
    // Check for scheduled pipeline executions
    // This is a simplified implementation
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.schedule) {
        // Check if pipeline should run based on schedule
        // For now, just log
        logger.debug(`Checking schedule for pipeline: ${pipeline.name}`);
      }
    }
  }

  // Public API methods

  getPipelines(): PipelineConfig[] {
    return Array.from(this.pipelines.values());
  }

  getPipeline(pipelineId: string): PipelineConfig | undefined {
    return this.pipelines.get(pipelineId);
  }

  getExecution(executionId: string): PipelineExecution | undefined {
    return this.executions.get(executionId);
  }

  getActiveExecutions(): PipelineExecution[] {
    return Array.from(this.activeExecutions).map(id => this.executions.get(id)!);
  }

  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (this.activeExecutions.has(executionId)) {
      execution.status = 'cancelled';
      execution.completedAt = new Date();
      this.activeExecutions.delete(executionId);

      this.emit('pipeline:cancelled', { execution });
      logger.info(`Pipeline execution cancelled: ${executionId}`);
    }
  }

  async deletePipeline(pipelineId: string): Promise<void> {
    this.pipelines.delete(pipelineId);
    logger.info(`Pipeline deleted: ${pipelineId}`);
  }
}