/**
 * Model Management System - Production ML model lifecycle management
 */

import * as tf from '@tensorflow/tfjs-node';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { LearningModel, ModelType, ModelPerformance } from '../types';
import { ProductionMLEngine } from './production-ml-engine';
import { logger } from '../utils/logger';

export interface ModelVersion {
  id: string;
  modelId: string;
  version: string;
  createdAt: Date;
  performance: ModelPerformance;
  metadata: Record<string, any>;
  filePath: string;
  isActive: boolean;
  tags: string[];
}

export interface ModelDeployment {
  id: string;
  modelId: string;
  versionId: string;
  environment: 'development' | 'staging' | 'production';
  endpoint: string;
  status: 'active' | 'inactive' | 'failed';
  deployedAt: Date;
  healthCheck: {
    lastCheck: Date;
    status: 'healthy' | 'unhealthy';
    responseTime: number;
    errorRate: number;
  };
  scaling: {
    minInstances: number;
    maxInstances: number;
    currentInstances: number;
    autoScale: boolean;
  };
}

export interface ModelMetrics {
  modelId: string;
  timestamp: Date;
  predictions: number;
  errors: number;
  averageLatency: number;
  throughput: number;
  memoryUsage: number;
  cpuUsage: number;
}

export interface ABTestConfig {
  id: string;
  name: string;
  modelA: string;
  modelB: string;
  trafficSplit: number; // 0-1, percentage for model A
  startDate: Date;
  endDate?: Date;
  metrics: string[];
  status: 'active' | 'completed' | 'stopped';
}

export class ModelManagementSystem extends EventEmitter {
  private models: Map<string, LearningModel> = new Map();
  private versions: Map<string, ModelVersion[]> = new Map();
  private deployments: Map<string, ModelDeployment> = new Map();
  private metrics: Map<string, ModelMetrics[]> = new Map();
  private abTests: Map<string, ABTestConfig> = new Map();
  private registryPath: string;

  constructor(
    private mlEngine: ProductionMLEngine,
    registryPath: string = './model_registry'
  ) {
    super();
    this.registryPath = registryPath;
    this.initializeRegistry();
    this.startMetricsCollection();
  }

  /**
   * Initialize model registry
   */
  private async initializeRegistry(): Promise<void> {
    try {
      await fs.mkdir(this.registryPath, { recursive: true });
      await fs.mkdir(path.join(this.registryPath, 'models'), { recursive: true });
      await fs.mkdir(path.join(this.registryPath, 'versions'), { recursive: true });
      await fs.mkdir(path.join(this.registryPath, 'deployments'), { recursive: true });
      
      // Load existing models
      await this.loadRegistry();
      
      logger.info('Model registry initialized');
    } catch (error) {
      logger.error('Failed to initialize model registry:', error);
    }
  }

  /**
   * Register a new model
   */
  async registerModel(model: LearningModel): Promise<void> {
    this.models.set(model.id, model);
    
    // Create initial version
    const version: ModelVersion = {
      id: uuidv4(),
      modelId: model.id,
      version: model.version,
      createdAt: new Date(),
      performance: model.performance,
      metadata: {
        type: model.type,
        architecture: model.architecture,
        parameters: model.parameters
      },
      filePath: path.join(this.registryPath, 'models', model.id),
      isActive: true,
      tags: ['initial']
    };

    if (!this.versions.has(model.id)) {
      this.versions.set(model.id, []);
    }
    this.versions.get(model.id)!.push(version);

    // Save to registry
    await this.saveModelToRegistry(model, version);

    this.emit('model:registered', { model, version });
    logger.info(`Model registered: ${model.name} (${model.id})`);
  }

  /**
   * Create new model version
   */
  async createVersion(
    modelId: string,
    newModel: LearningModel,
    tags: string[] = []
  ): Promise<ModelVersion> {
    const existingVersions = this.versions.get(modelId) || [];
    
    // Deactivate previous versions
    existingVersions.forEach(v => v.isActive = false);

    const version: ModelVersion = {
      id: uuidv4(),
      modelId,
      version: newModel.version,
      createdAt: new Date(),
      performance: newModel.performance,
      metadata: {
        type: newModel.type,
        architecture: newModel.architecture,
        parameters: newModel.parameters
      },
      filePath: path.join(this.registryPath, 'versions', `${modelId}_${newModel.version}`),
      isActive: true,
      tags: ['latest', ...tags]
    };

    existingVersions.push(version);
    this.versions.set(modelId, existingVersions);
    this.models.set(modelId, newModel);

    // Save to registry
    await this.saveModelToRegistry(newModel, version);

    this.emit('model:version_created', { modelId, version });
    logger.info(`New version created: ${newModel.name} v${newModel.version}`);

    return version;
  }

  /**
   * Deploy model to environment
   */
  async deployModel(
    modelId: string,
    versionId: string,
    environment: 'development' | 'staging' | 'production',
    config?: {
      minInstances?: number;
      maxInstances?: number;
      autoScale?: boolean;
    }
  ): Promise<ModelDeployment> {
    const model = this.models.get(modelId);
    const versions = this.versions.get(modelId) || [];
    const version = versions.find(v => v.id === versionId);

    if (!model || !version) {
      throw new Error(`Model or version not found: ${modelId}/${versionId}`);
    }

    // Create deployment
    const deployment: ModelDeployment = {
      id: uuidv4(),
      modelId,
      versionId,
      environment,
      endpoint: this.generateEndpoint(modelId, environment),
      status: 'active',
      deployedAt: new Date(),
      healthCheck: {
        lastCheck: new Date(),
        status: 'healthy',
        responseTime: 0,
        errorRate: 0
      },
      scaling: {
        minInstances: config?.minInstances || 1,
        maxInstances: config?.maxInstances || 3,
        currentInstances: 1,
        autoScale: config?.autoScale || false
      }
    };

    this.deployments.set(deployment.id, deployment);

    // Initialize metrics tracking
    if (!this.metrics.has(modelId)) {
      this.metrics.set(modelId, []);
    }

    // Save deployment info
    await this.saveDeploymentToRegistry(deployment);

    this.emit('model:deployed', { deployment });
    logger.info(`Model deployed: ${model.name} to ${environment}`);

    return deployment;
  }

  /**
   * Start A/B testing between two models
   */
  async startABTest(
    name: string,
    modelA: string,
    modelB: string,
    trafficSplit: number = 0.5,
    duration: number = 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    metrics: string[] = ['accuracy', 'latency', 'error_rate']
  ): Promise<ABTestConfig> {
    const abTest: ABTestConfig = {
      id: uuidv4(),
      name,
      modelA,
      modelB,
      trafficSplit,
      startDate: new Date(),
      endDate: new Date(Date.now() + duration),
      metrics,
      status: 'active'
    };

    this.abTests.set(abTest.id, abTest);

    this.emit('ab_test:started', { abTest });
    logger.info(`A/B test started: ${name}`);

    return abTest;
  }

  /**
   * Route prediction request based on A/B test configuration
   */
  async routePrediction(
    input: number[] | number[][],
    abTestId?: string
  ): Promise<{
    prediction: any;
    modelId: string;
    latency: number;
    abTestInfo?: { testId: string; variant: 'A' | 'B' };
  }> {
    const startTime = Date.now();
    let selectedModel: string;
    let abTestInfo: { testId: string; variant: 'A' | 'B' } | undefined;

    if (abTestId) {
      const abTest = this.abTests.get(abTestId);
      if (abTest && abTest.status === 'active') {
        // Route based on traffic split
        const useModelA = Math.random() < abTest.trafficSplit;
        selectedModel = useModelA ? abTest.modelA : abTest.modelB;
        abTestInfo = {
          testId: abTestId,
          variant: useModelA ? 'A' : 'B'
        };
      } else {
        throw new Error(`A/B test not found or inactive: ${abTestId}`);
      }
    } else {
      // Use the first available model (should be improved with proper routing logic)
      selectedModel = Array.from(this.models.keys())[0];
      if (!selectedModel) {
        throw new Error('No models available for prediction');
      }
    }

    try {
      // Make prediction
      const prediction = await this.mlEngine.predict(selectedModel, input);
      const latency = Date.now() - startTime;

      // Record metrics
      await this.recordPredictionMetrics(selectedModel, latency, true);

      this.emit('prediction:completed', {
        modelId: selectedModel,
        latency,
        abTestInfo
      });

      return {
        prediction,
        modelId: selectedModel,
        latency,
        abTestInfo
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      
      // Record error metrics
      await this.recordPredictionMetrics(selectedModel, latency, false);

      this.emit('prediction:failed', {
        modelId: selectedModel,
        error,
        latency
      });

      throw error;
    }
  }

  /**
   * Monitor model performance and trigger retraining if needed
   */
  async monitorModelPerformance(modelId: string): Promise<{
    health: 'healthy' | 'degraded' | 'critical';
    recommendations: string[];
    metrics: ModelMetrics;
  }> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    const recentMetrics = this.getRecentMetrics(modelId, 24 * 60 * 60 * 1000); // Last 24 hours
    const deployment = this.getActiveDeployment(modelId);

    if (!recentMetrics.length) {
      return {
        health: 'healthy',
        recommendations: ['No recent metrics available'],
        metrics: this.createEmptyMetrics(modelId)
      };
    }

    // Calculate aggregated metrics
    const avgMetrics = this.aggregateMetrics(recentMetrics);
    
    // Assess health
    let health: 'healthy' | 'degraded' | 'critical' = 'healthy';
    const recommendations: string[] = [];

    // Check error rate
    if (avgMetrics.errorRate > 0.1) {
      health = 'critical';
      recommendations.push('High error rate detected - consider model retraining');
    } else if (avgMetrics.errorRate > 0.05) {
      health = 'degraded';
      recommendations.push('Elevated error rate - monitor closely');
    }

    // Check latency
    if (avgMetrics.averageLatency > 1000) {
      health = health === 'healthy' ? 'degraded' : health;
      recommendations.push('High latency detected - consider model optimization');
    }

    // Check resource usage
    if (avgMetrics.memoryUsage > 80) {
      recommendations.push('High memory usage - consider scaling up');
    }

    // Update deployment health check
    if (deployment) {
      deployment.healthCheck = {
        lastCheck: new Date(),
        status: health === 'healthy' ? 'healthy' : 'unhealthy',
        responseTime: avgMetrics.averageLatency,
        errorRate: avgMetrics.errorRate
      };
    }

    this.emit('model:health_checked', {
      modelId,
      health,
      recommendations,
      metrics: avgMetrics
    });

    return {
      health,
      recommendations,
      metrics: avgMetrics
    };
  }

  /**
   * Auto-scale model deployment based on load
   */
  async autoScaleDeployment(deploymentId: string): Promise<void> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || !deployment.scaling.autoScale) {
      return;
    }

    const recentMetrics = this.getRecentMetrics(deployment.modelId, 5 * 60 * 1000); // Last 5 minutes
    if (!recentMetrics.length) return;

    const avgMetrics = this.aggregateMetrics(recentMetrics);
    const currentInstances = deployment.scaling.currentInstances;

    // Scale up if high latency or throughput
    if (avgMetrics.averageLatency > 500 || avgMetrics.throughput > 100) {
      if (currentInstances < deployment.scaling.maxInstances) {
        deployment.scaling.currentInstances++;
        logger.info(`Scaled up deployment ${deploymentId} to ${deployment.scaling.currentInstances} instances`);
        this.emit('deployment:scaled_up', { deploymentId, instances: deployment.scaling.currentInstances });
      }
    }
    // Scale down if low utilization
    else if (avgMetrics.averageLatency < 100 && avgMetrics.throughput < 10) {
      if (currentInstances > deployment.scaling.minInstances) {
        deployment.scaling.currentInstances--;
        logger.info(`Scaled down deployment ${deploymentId} to ${deployment.scaling.currentInstances} instances`);
        this.emit('deployment:scaled_down', { deploymentId, instances: deployment.scaling.currentInstances });
      }
    }
  }

  /**
   * Analyze A/B test results
   */
  async analyzeABTest(abTestId: string): Promise<{
    testConfig: ABTestConfig;
    results: {
      modelA: { name: string; metrics: Record<string, number> };
      modelB: { name: string; metrics: Record<string, number> };
      winner: 'A' | 'B' | 'inconclusive';
      significance: number;
    };
    recommendations: string[];
  }> {
    const abTest = this.abTests.get(abTestId);
    if (!abTest) {
      throw new Error(`A/B test not found: ${abTestId}`);
    }

    // Get metrics for both models during test period
    const modelAMetrics = this.getMetricsDuringPeriod(
      abTest.modelA,
      abTest.startDate,
      abTest.endDate || new Date()
    );
    const modelBMetrics = this.getMetricsDuringPeriod(
      abTest.modelB,
      abTest.startDate,
      abTest.endDate || new Date()
    );

    // Calculate aggregated metrics
    const avgMetricsA = this.aggregateMetrics(modelAMetrics);
    const avgMetricsB = this.aggregateMetrics(modelBMetrics);

    // Determine winner based on primary metric (accuracy or error rate)
    let winner: 'A' | 'B' | 'inconclusive' = 'inconclusive';
    const errorRateDiff = avgMetricsA.errorRate - avgMetricsB.errorRate;
    const latencyDiff = avgMetricsA.averageLatency - avgMetricsB.averageLatency;

    if (Math.abs(errorRateDiff) > 0.01) { // 1% difference threshold
      winner = errorRateDiff < 0 ? 'A' : 'B';
    } else if (Math.abs(latencyDiff) > 50) { // 50ms difference threshold
      winner = latencyDiff < 0 ? 'A' : 'B';
    }

    // Simple significance calculation (would be improved with proper statistical testing)
    const significance = Math.min(Math.abs(errorRateDiff) * 100, Math.abs(latencyDiff) / 10);

    const recommendations: string[] = [];
    if (winner !== 'inconclusive') {
      const winnerModel = winner === 'A' ? abTest.modelA : abTest.modelB;
      recommendations.push(`Deploy model ${winner} (${winnerModel}) to production`);
    } else {
      recommendations.push('No significant difference found - extend test duration or check test configuration');
    }

    const modelA = this.models.get(abTest.modelA);
    const modelB = this.models.get(abTest.modelB);

    return {
      testConfig: abTest,
      results: {
        modelA: {
          name: modelA?.name || 'Model A',
          metrics: {
            errorRate: avgMetricsA.errorRate,
            latency: avgMetricsA.averageLatency,
            throughput: avgMetricsA.throughput
          }
        },
        modelB: {
          name: modelB?.name || 'Model B',
          metrics: {
            errorRate: avgMetricsB.errorRate,
            latency: avgMetricsB.averageLatency,
            throughput: avgMetricsB.throughput
          }
        },
        winner,
        significance
      },
      recommendations
    };
  }

  // Private helper methods

  private async saveModelToRegistry(model: LearningModel, version: ModelVersion): Promise<void> {
    try {
      const modelPath = path.join(this.registryPath, 'models', `${model.id}.json`);
      const versionPath = path.join(this.registryPath, 'versions', `${version.id}.json`);

      await fs.writeFile(modelPath, JSON.stringify(model, null, 2));
      await fs.writeFile(versionPath, JSON.stringify(version, null, 2));
    } catch (error) {
      logger.error('Failed to save model to registry:', error);
    }
  }

  private async saveDeploymentToRegistry(deployment: ModelDeployment): Promise<void> {
    try {
      const deploymentPath = path.join(this.registryPath, 'deployments', `${deployment.id}.json`);
      await fs.writeFile(deploymentPath, JSON.stringify(deployment, null, 2));
    } catch (error) {
      logger.error('Failed to save deployment to registry:', error);
    }
  }

  private async loadRegistry(): Promise<void> {
    try {
      // Load models
      const modelsDir = path.join(this.registryPath, 'models');
      const modelFiles = await fs.readdir(modelsDir).catch(() => []);
      
      for (const file of modelFiles) {
        if (file.endsWith('.json')) {
          const modelData = await fs.readFile(path.join(modelsDir, file), 'utf-8');
          const model = JSON.parse(modelData);
          this.models.set(model.id, model);
        }
      }

      // Load versions
      const versionsDir = path.join(this.registryPath, 'versions');
      const versionFiles = await fs.readdir(versionsDir).catch(() => []);
      
      for (const file of versionFiles) {
        if (file.endsWith('.json')) {
          const versionData = await fs.readFile(path.join(versionsDir, file), 'utf-8');
          const version = JSON.parse(versionData);
          
          if (!this.versions.has(version.modelId)) {
            this.versions.set(version.modelId, []);
          }
          this.versions.get(version.modelId)!.push(version);
        }
      }

      // Load deployments
      const deploymentsDir = path.join(this.registryPath, 'deployments');
      const deploymentFiles = await fs.readdir(deploymentsDir).catch(() => []);
      
      for (const file of deploymentFiles) {
        if (file.endsWith('.json')) {
          const deploymentData = await fs.readFile(path.join(deploymentsDir, file), 'utf-8');
          const deployment = JSON.parse(deploymentData);
          this.deployments.set(deployment.id, deployment);
        }
      }

      logger.info(`Loaded ${this.models.size} models, ${Array.from(this.versions.values()).flat().length} versions, ${this.deployments.size} deployments`);
    } catch (error) {
      logger.error('Failed to load registry:', error);
    }
  }

  private generateEndpoint(modelId: string, environment: string): string {
    return `https://api.${environment}.example.com/models/${modelId}/predict`;
  }

  private async recordPredictionMetrics(
    modelId: string,
    latency: number,
    success: boolean
  ): Promise<void> {
    if (!this.metrics.has(modelId)) {
      this.metrics.set(modelId, []);
    }

    const metrics: ModelMetrics = {
      modelId,
      timestamp: new Date(),
      predictions: 1,
      errors: success ? 0 : 1,
      averageLatency: latency,
      throughput: 1,
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
      cpuUsage: process.cpuUsage().user / 1000000 // Convert to seconds
    };

    this.metrics.get(modelId)!.push(metrics);

    // Keep only recent metrics (last 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recentMetrics = this.metrics.get(modelId)!.filter(m => m.timestamp.getTime() > cutoff);
    this.metrics.set(modelId, recentMetrics);
  }

  private getRecentMetrics(modelId: string, timeWindow: number): ModelMetrics[] {
    const allMetrics = this.metrics.get(modelId) || [];
    const cutoff = Date.now() - timeWindow;
    return allMetrics.filter(m => m.timestamp.getTime() > cutoff);
  }

  private getMetricsDuringPeriod(modelId: string, start: Date, end: Date): ModelMetrics[] {
    const allMetrics = this.metrics.get(modelId) || [];
    return allMetrics.filter(m => 
      m.timestamp >= start && m.timestamp <= end
    );
  }

  private aggregateMetrics(metrics: ModelMetrics[]): ModelMetrics {
    if (metrics.length === 0) {
      return this.createEmptyMetrics('');
    }

    const totalPredictions = metrics.reduce((sum, m) => sum + m.predictions, 0);
    const totalErrors = metrics.reduce((sum, m) => sum + m.errors, 0);
    const totalLatency = metrics.reduce((sum, m) => sum + m.averageLatency, 0);
    const totalThroughput = metrics.reduce((sum, m) => sum + m.throughput, 0);
    const totalMemory = metrics.reduce((sum, m) => sum + m.memoryUsage, 0);
    const totalCPU = metrics.reduce((sum, m) => sum + m.cpuUsage, 0);

    return {
      modelId: metrics[0].modelId,
      timestamp: new Date(),
      predictions: totalPredictions,
      errors: totalErrors,
      averageLatency: totalLatency / metrics.length,
      throughput: totalThroughput / metrics.length,
      memoryUsage: totalMemory / metrics.length,
      cpuUsage: totalCPU / metrics.length,
      errorRate: totalErrors / totalPredictions
    } as ModelMetrics & { errorRate: number };
  }

  private createEmptyMetrics(modelId: string): ModelMetrics {
    return {
      modelId,
      timestamp: new Date(),
      predictions: 0,
      errors: 0,
      averageLatency: 0,
      throughput: 0,
      memoryUsage: 0,
      cpuUsage: 0
    };
  }

  private getActiveDeployment(modelId: string): ModelDeployment | undefined {
    return Array.from(this.deployments.values()).find(d => 
      d.modelId === modelId && d.status === 'active'
    );
  }

  private startMetricsCollection(): void {
    // Start periodic metrics collection and auto-scaling
    setInterval(() => {
      this.performMaintenanceTasks();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  private async performMaintenanceTasks(): Promise<void> {
    try {
      // Auto-scale deployments
      for (const deployment of this.deployments.values()) {
        if (deployment.scaling.autoScale) {
          await this.autoScaleDeployment(deployment.id);
        }
      }

      // Check A/B tests for completion
      for (const abTest of this.abTests.values()) {
        if (abTest.status === 'active' && abTest.endDate && abTest.endDate < new Date()) {
          abTest.status = 'completed';
          this.emit('ab_test:completed', { abTest });
        }
      }
    } catch (error) {
      logger.error('Error in maintenance tasks:', error);
    }
  }

  // Public API methods

  getModels(): LearningModel[] {
    return Array.from(this.models.values());
  }

  getModel(modelId: string): LearningModel | undefined {
    return this.models.get(modelId);
  }

  getModelVersions(modelId: string): ModelVersion[] {
    return this.versions.get(modelId) || [];
  }

  getDeployments(): ModelDeployment[] {
    return Array.from(this.deployments.values());
  }

  getActiveABTests(): ABTestConfig[] {
    return Array.from(this.abTests.values()).filter(test => test.status === 'active');
  }

  async shutdown(): Promise<void> {
    // Save current state
    for (const [deploymentId, deployment] of this.deployments) {
      await this.saveDeploymentToRegistry(deployment);
    }
    
    logger.info('Model management system shutdown complete');
  }
}