/**
 * Learning-related MCP tools
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { LearningEngine } from '../core/learning-engine';
import { ProductionMLEngine } from '../core/production-ml-engine';
import { ModelManagementSystem } from '../core/model-management';
import { MLPipeline } from '../core/ml-pipeline';
import {
  LearningTrainSchema,
  LearningPredictSchema,
  ToolResponse,
  ModelType
} from '../types';
import { logger } from '../utils/logger';

export class LearningTools {
  constructor(
    private learningEngine: LearningEngine,
    private productionMLEngine?: ProductionMLEngine,
    private modelManager?: ModelManagementSystem,
    private mlPipeline?: MLPipeline
  ) {}

  /**
   * Get all learning-related tools
   */
  getTools(): Tool[] {
    const basicTools = [
      this.getLearningTrainTool(),
      this.getLearningPredictTool(),
      this.getModelListTool(),
      this.getModelStatusTool(),
      this.getModelMetricsTool(),
      this.getModelExportTool(),
      this.getModelImportTool(),
      this.getModelDeleteTool()
    ];

    // Add production ML tools if available
    if (this.productionMLEngine) {
      basicTools.push(
        this.getProductionTrainTool(),
        this.getHyperparameterOptimizationTool(),
        this.getModelEvaluationTool(),
        this.getDriftDetectionTool()
      );
    }

    // Add model management tools if available
    if (this.modelManager) {
      basicTools.push(
        this.getModelDeploymentTool(),
        this.getABTestTool(),
        this.getModelMonitoringTool()
      );
    }

    // Add pipeline tools if available
    if (this.mlPipeline) {
      basicTools.push(
        this.getPipelineCreateTool(),
        this.getPipelineExecuteTool(),
        this.getPipelineStatusTool()
      );
    }

    return basicTools;
  }

  /**
   * Learning train tool
   */
  private getLearningTrainTool(): Tool {
    return {
      name: 'learning_train',
      description: 'Train a machine learning model with provided data',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of existing model to retrain (optional)'
          },
          type: {
            type: 'string',
            enum: Object.values(ModelType),
            description: 'Type of model to train'
          },
          data: {
            type: 'object',
            properties: {
              features: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' }
                },
                description: 'Training features (2D array)'
              },
              labels: {
                type: 'array',
                description: 'Training labels'
              }
            },
            required: ['features', 'labels'],
            description: 'Training data'
          },
          parameters: {
            type: 'object',
            properties: {
              epochs: {
                type: 'number',
                minimum: 1,
                maximum: 1000,
                description: 'Number of training epochs'
              },
              batchSize: {
                type: 'number',
                minimum: 1,
                maximum: 512,
                description: 'Batch size for training'
              },
              learningRate: {
                type: 'number',
                minimum: 0.0001,
                maximum: 1,
                description: 'Learning rate'
              },
              validationSplit: {
                type: 'number',
                minimum: 0,
                maximum: 0.5,
                description: 'Fraction of data to use for validation'
              }
            },
            description: 'Training parameters'
          },
          name: {
            type: 'string',
            description: 'Name for the model'
          }
        },
        required: ['type', 'data']
      }
    };
  }

  /**
   * Learning predict tool
   */
  private getLearningPredictTool(): Tool {
    return {
      name: 'learning_predict',
      description: 'Make predictions using a trained model',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model to use for prediction'
          },
          input: {
            oneOf: [
              {
                type: 'array',
                items: { type: 'number' },
                description: 'Single input vector'
              },
              {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' }
                },
                description: 'Multiple input vectors'
              }
            ],
            description: 'Input data for prediction'
          }
        },
        required: ['modelId', 'input']
      }
    };
  }

  /**
   * Model list tool
   */
  private getModelListTool(): Tool {
    return {
      name: 'model_list',
      description: 'List all trained models or filter by type',
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: Object.values(ModelType),
            description: 'Filter models by type'
          }
        }
      }
    };
  }

  /**
   * Model status tool
   */
  private getModelStatusTool(): Tool {
    return {
      name: 'model_status',
      description: 'Get detailed information about a model',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model'
          }
        },
        required: ['modelId']
      }
    };
  }

  /**
   * Model metrics tool
   */
  private getModelMetricsTool(): Tool {
    return {
      name: 'model_metrics',
      description: 'Get performance metrics for a model',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model'
          }
        },
        required: ['modelId']
      }
    };
  }

  /**
   * Model export tool
   */
  private getModelExportTool(): Tool {
    return {
      name: 'model_export',
      description: 'Export a trained model for external use',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model to export'
          },
          format: {
            type: 'string',
            enum: ['json', 'binary'],
            default: 'json',
            description: 'Export format'
          }
        },
        required: ['modelId']
      }
    };
  }

  /**
   * Model import tool
   */
  private getModelImportTool(): Tool {
    return {
      name: 'model_import',
      description: 'Import a model from external source',
      inputSchema: {
        type: 'object',
        properties: {
          data: {
            type: 'string',
            description: 'Serialized model data'
          },
          name: {
            type: 'string',
            description: 'Name for the imported model'
          }
        },
        required: ['data']
      }
    };
  }

  /**
   * Model delete tool
   */
  private getModelDeleteTool(): Tool {
    return {
      name: 'model_delete',
      description: 'Delete a trained model and its data',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model to delete'
          }
        },
        required: ['modelId']
      }
    };
  }

  /**
   * Handle tool calls
   */
  async handleToolCall(name: string, args: any): Promise<ToolResponse> {
    try {
      switch (name) {
        case 'learning_train':
          return await this.handleLearningTrain(args);
        case 'learning_predict':
          return await this.handleLearningPredict(args);
        case 'model_list':
          return await this.handleModelList(args);
        case 'model_status':
          return await this.handleModelStatus(args);
        case 'model_metrics':
          return await this.handleModelMetrics(args);
        case 'model_export':
          return await this.handleModelExport(args);
        case 'model_import':
          return await this.handleModelImport(args);
        case 'model_delete':
          return await this.handleModelDelete(args);
        default:
          throw new Error(`Unknown learning tool: ${name}`);
      }
    } catch (error) {
      logger.error(`Learning tool error: ${name} - ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Handle model training
   */
  private async handleLearningTrain(args: any): Promise<ToolResponse> {
    const validated = LearningTrainSchema.parse(args);

    // Validate training data
    if (validated.data.features.length !== validated.data.labels.length) {
      throw new Error('Features and labels must have the same length');
    }

    if (validated.data.features.length === 0) {
      throw new Error('Training data cannot be empty');
    }

    // Use production ML engine if available, otherwise fallback to basic engine
    const model = this.productionMLEngine 
      ? await this.productionMLEngine.trainModel(
          validated.type,
          validated.data,
          validated.parameters,
          validated.modelId
        )
      : await this.learningEngine.trainModel(
          validated.type,
          validated.data,
          validated.parameters,
          validated.modelId
        );

    return {
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          type: model.type,
          version: model.version,
          performance: model.performance,
          trainingData: {
            size: model.trainingData.size,
            features: model.trainingData.features,
            labels: model.trainingData.labels
          },
          parameters: model.parameters,
          createdAt: model.createdAt,
          lastTrained: model.lastTrained
        }
      },
      metadata: {
        operation: 'learning_train',
        timestamp: new Date().toISOString(),
        trainingTime: model.lastTrained.getTime() - model.createdAt.getTime()
      }
    };
  }

  /**
   * Handle model prediction
   */
  private async handleLearningPredict(args: any): Promise<ToolResponse> {
    const validated = LearningPredictSchema.parse(args);

    const prediction = await this.learningEngine.predict(
      validated.modelId,
      validated.input
    );

    const model = this.learningEngine.getModel(validated.modelId);
    if (!model) {
      throw new Error(`Model ${validated.modelId} not found`);
    }

    return {
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          type: model.type
        },
        prediction,
        confidence: this.calculateConfidence(prediction, model.type),
        metadata: {
          inputShape: Array.isArray(validated.input[0]) ? 
            [validated.input.length, validated.input[0].length] : 
            [validated.input.length],
          predictionTime: new Date().toISOString()
        }
      },
      metadata: {
        operation: 'learning_predict',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle model listing
   */
  private async handleModelList(args: any): Promise<ToolResponse> {
    let models = this.learningEngine.getAllModels();

    // Apply type filter
    if (args.type) {
      models = models.filter(model => model.type === args.type);
    }

    const modelSummaries = models.map(model => ({
      id: model.id,
      name: model.name,
      type: model.type,
      version: model.version,
      performance: model.performance,
      dataSize: model.trainingData.size,
      createdAt: model.createdAt,
      lastTrained: model.lastTrained,
      age: Date.now() - model.lastTrained.getTime()
    }));

    // Sort by last trained (most recent first)
    modelSummaries.sort((a, b) => b.lastTrained.getTime() - a.lastTrained.getTime());

    return {
      success: true,
      data: {
        models: modelSummaries,
        count: modelSummaries.length,
        summary: {
          byType: this.groupBy(models, 'type'),
          averagePerformance: this.calculateAveragePerformance(models),
          totalDataSize: models.reduce((sum, model) => sum + model.trainingData.size, 0)
        }
      },
      metadata: {
        operation: 'model_list',
        timestamp: new Date().toISOString(),
        filters: { type: args.type }
      }
    };
  }

  /**
   * Handle model status
   */
  private async handleModelStatus(args: any): Promise<ToolResponse> {
    const model = this.learningEngine.getModel(args.modelId);
    if (!model) {
      throw new Error(`Model ${args.modelId} not found`);
    }

    const recommendations = this.generateModelRecommendations(model);
    const health = this.assessModelHealth(model);

    return {
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          type: model.type,
          version: model.version,
          architecture: model.architecture,
          parameters: model.parameters,
          trainingData: model.trainingData,
          performance: model.performance,
          createdAt: model.createdAt,
          lastTrained: model.lastTrained
        },
        analysis: {
          health,
          recommendations,
          modelAge: Date.now() - model.lastTrained.getTime(),
          performanceGrade: this.gradePerformance(model),
          complexity: this.assessComplexity(model)
        }
      },
      metadata: {
        operation: 'model_status',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle model metrics
   */
  private async handleModelMetrics(args: any): Promise<ToolResponse> {
    const model = this.learningEngine.getModel(args.modelId);
    if (!model) {
      throw new Error(`Model ${args.modelId} not found`);
    }

    const detailedMetrics = this.calculateDetailedMetrics(model);
    const benchmarks = this.getBenchmarkComparisons(model);

    return {
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          type: model.type
        },
        performance: model.performance,
        detailed: detailedMetrics,
        benchmarks,
        trends: this.calculateTrends(model)
      },
      metadata: {
        operation: 'model_metrics',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle model export
   */
  private async handleModelExport(args: any): Promise<ToolResponse> {
    const model = this.learningEngine.getModel(args.modelId);
    if (!model) {
      throw new Error(`Model ${args.modelId} not found`);
    }

    const exportData = this.learningEngine.exportModel(args.modelId);
    
    // For binary format, we'd return a download link or base64 data
    // For now, we'll just return metadata about the export
    const response = {
      modelId: model.id,
      name: model.name,
      format: args.format || 'json',
      size: exportData.length,
      checksum: this.calculateChecksum(exportData),
      exportedAt: new Date().toISOString()
    };

    if (args.format === 'json') {
      // Include the actual data for JSON format
      (response as any)['data'] = exportData;
    }

    return {
      success: true,
      data: response,
      metadata: {
        operation: 'model_export',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle model import
   */
  private async handleModelImport(args: any): Promise<ToolResponse> {
    const model = this.learningEngine.importModel(args.data);
    
    // Update name if provided
    if (args.name) {
      model.name = args.name;
    }

    return {
      success: true,
      data: {
        model: {
          id: model.id,
          name: model.name,
          type: model.type,
          version: model.version,
          performance: model.performance,
          importedAt: new Date().toISOString()
        }
      },
      metadata: {
        operation: 'model_import',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Handle model deletion
   */
  private async handleModelDelete(args: any): Promise<ToolResponse> {
    const model = this.learningEngine.getModel(args.modelId);
    if (!model) {
      throw new Error(`Model ${args.modelId} not found`);
    }

    this.learningEngine.deleteModel(args.modelId);

    return {
      success: true,
      data: {
        deletedModel: {
          id: model.id,
          name: model.name,
          type: model.type
        }
      },
      metadata: {
        operation: 'model_delete',
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Calculate prediction confidence
   */
  private calculateConfidence(prediction: any, modelType: ModelType): number {
    switch (modelType) {
      case ModelType.CLASSIFICATION:
        if (prediction.probabilities) {
          return Math.max(...prediction.probabilities.map((p: any) => p.probability));
        }
        return 0.5;
      
      case ModelType.REGRESSION:
        // For regression, confidence could be based on prediction variance
        return 0.8; // Simplified
      
      default:
        return 0.7; // Default confidence
    }
  }

  /**
   * Group models by property
   */
  private groupBy<T>(array: T[], property: keyof T): Record<string, number> {
    return array.reduce((groups, item) => {
      const key = String(item[property]);
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {} as Record<string, number>);
  }

  /**
   * Calculate average performance across models
   */
  private calculateAveragePerformance(models: any[]): Record<string, number> {
    if (models.length === 0) return {};

    const metrics = ['accuracy', 'loss', 'precision', 'recall', 'f1Score'];
    const averages: Record<string, number> = {};

    for (const metric of metrics) {
      const values = models
        .map(model => model.performance[metric])
        .filter(value => value !== undefined);
      
      if (values.length > 0) {
        averages[metric] = values.reduce((sum, val) => sum + val, 0) / values.length;
      }
    }

    return averages;
  }

  /**
   * Generate model recommendations
   */
  private generateModelRecommendations(model: any): string[] {
    const recommendations: string[] = [];

    // Age-based recommendations
    const age = Date.now() - model.lastTrained.getTime();
    if (age > 30 * 24 * 60 * 60 * 1000) { // 30 days
      recommendations.push('Consider retraining the model with fresh data');
    }

    // Performance-based recommendations
    if (model.performance.accuracy && model.performance.accuracy < 0.8) {
      recommendations.push('Model accuracy is below 80%, consider data augmentation or architecture changes');
    }

    if (model.performance.loss && model.performance.loss > 0.5) {
      recommendations.push('High loss value suggests the model may be underfitting');
    }

    // Data size recommendations
    if (model.trainingData.size < 1000) {
      recommendations.push('Small training dataset, consider gathering more data');
    }

    // Architecture recommendations
    if (model.architecture.layers.length < 3) {
      recommendations.push('Consider adding more layers for better representation learning');
    }

    return recommendations;
  }

  /**
   * Assess model health
   */
  private assessModelHealth(model: any): 'excellent' | 'good' | 'fair' | 'poor' {
    let score = 0;

    // Performance scoring
    if (model.performance.accuracy >= 0.9) score += 25;
    else if (model.performance.accuracy >= 0.8) score += 20;
    else if (model.performance.accuracy >= 0.7) score += 15;
    else score += 10;

    // Data size scoring
    if (model.trainingData.size >= 10000) score += 25;
    else if (model.trainingData.size >= 1000) score += 20;
    else score += 10;

    // Age scoring
    const age = Date.now() - model.lastTrained.getTime();
    if (age < 7 * 24 * 60 * 60 * 1000) score += 25; // Less than 1 week
    else if (age < 30 * 24 * 60 * 60 * 1000) score += 20; // Less than 1 month
    else score += 10;

    // Architecture scoring
    if (model.architecture.layers.length >= 5) score += 25;
    else if (model.architecture.layers.length >= 3) score += 20;
    else score += 15;

    if (score >= 85) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 55) return 'fair';
    return 'poor';
  }

  /**
   * Grade model performance
   */
  private gradePerformance(model: any): string {
    const accuracy = model.performance.accuracy || 0;
    
    if (accuracy >= 0.95) return 'A+';
    if (accuracy >= 0.9) return 'A';
    if (accuracy >= 0.85) return 'B+';
    if (accuracy >= 0.8) return 'B';
    if (accuracy >= 0.75) return 'C+';
    if (accuracy >= 0.7) return 'C';
    if (accuracy >= 0.65) return 'D+';
    if (accuracy >= 0.6) return 'D';
    return 'F';
  }

  /**
   * Assess model complexity
   */
  private assessComplexity(model: any): 'low' | 'medium' | 'high' {
    let complexity = 0;
    
    complexity += model.architecture.layers.length * 10;
    complexity += model.trainingData.features.length * 2;
    complexity += model.parameters.epochs * 0.1;

    if (complexity < 50) return 'low';
    if (complexity < 150) return 'medium';
    return 'high';
  }

  /**
   * Calculate detailed metrics
   */
  private calculateDetailedMetrics(model: any): Record<string, any> {
    const detailed: Record<string, any> = {
      ...model.performance
    };

    // Add derived metrics
    if (detailed.precision && detailed.recall) {
      detailed.f1Score = 2 * (detailed.precision * detailed.recall) / (detailed.precision + detailed.recall);
    }

    // Add model-specific metrics
    detailed.parameterCount = this.estimateParameterCount(model);
    detailed.memoryUsage = this.estimateMemoryUsage(model);
    detailed.inferenceSpeed = this.estimateInferenceSpeed(model);

    return detailed;
  }

  /**
   * Get benchmark comparisons
   */
  private getBenchmarkComparisons(model: any): Record<string, any> {
    // Simplified benchmark data
    const benchmarks: Record<string, any> = {
      industry_average: {},
      best_in_class: {},
      relative_performance: {}
    };

    // Industry averages by model type
    const industryAverages: Record<string, any> = {
      [ModelType.CLASSIFICATION]: { accuracy: 0.85, precision: 0.82, recall: 0.84 },
      [ModelType.REGRESSION]: { mae: 0.1, mse: 0.05 },
      [ModelType.CLUSTERING]: { silhouette_score: 0.6 }
    };

    benchmarks.industry_average = industryAverages[model.type] || {};

    // Calculate relative performance
    for (const [metric, value] of Object.entries(model.performance)) {
      const benchmark = benchmarks.industry_average[metric];
      if (benchmark && typeof value === 'number') {
        benchmarks.relative_performance[metric] = value / benchmark;
      }
    }

    return benchmarks;
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(model: any): Record<string, string> {
    // Simplified trend calculation
    return {
      accuracy: 'stable',
      loss: 'improving',
      overall: 'stable'
    };
  }

  /**
   * Calculate checksum for exported data
   */
  private calculateChecksum(data: string): string {
    // Simple hash function for demonstration
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Estimate parameter count
   */
  private estimateParameterCount(model: any): number {
    // Simplified parameter count estimation
    let count = 0;
    for (const layer of model.architecture.layers) {
      if (layer.units) {
        count += layer.units * 100; // Rough estimation
      }
    }
    return count;
  }

  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(model: any): string {
    const paramCount = this.estimateParameterCount(model);
    const bytes = paramCount * 4; // 4 bytes per parameter (float32)
    
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Estimate inference speed
   */
  private estimateInferenceSpeed(model: any): string {
    const complexity = this.assessComplexity(model);
    
    switch (complexity) {
      case 'low': return '< 1ms';
      case 'medium': return '1-10ms';
      case 'high': return '10-100ms';
    }
  }

  // Production ML Tools

  /**
   * Production training tool with real TensorFlow.js
   */
  private getProductionTrainTool(): Tool {
    return {
      name: 'production_train',
      description: 'Train a model using production TensorFlow.js with real neural networks',
      inputSchema: {
        type: 'object',
        properties: {
          modelType: {
            type: 'string',
            enum: Object.values(ModelType),
            description: 'Type of model to train'
          },
          data: {
            type: 'object',
            properties: {
              features: {
                type: 'array',
                items: {
                  type: 'array',
                  items: { type: 'number' }
                },
                description: 'Training features (2D array)'
              },
              labels: {
                type: 'array',
                description: 'Training labels'
              }
            },
            required: ['features', 'labels']
          },
          parameters: {
            type: 'object',
            properties: {
              epochs: { type: 'number', minimum: 1, maximum: 1000 },
              batchSize: { type: 'number', minimum: 1, maximum: 512 },
              learningRate: { type: 'number', minimum: 0.0001, maximum: 1 },
              architecture: {
                type: 'object',
                properties: {
                  layers: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        units: { type: 'number' },
                        activation: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          },
          enableNormalization: {
            type: 'boolean',
            default: true,
            description: 'Enable feature normalization'
          }
        },
        required: ['modelType', 'data']
      }
    };
  }

  /**
   * Hyperparameter optimization tool
   */
  private getHyperparameterOptimizationTool(): Tool {
    return {
      name: 'hyperparameter_optimization',
      description: 'Optimize model hyperparameters using grid search',
      inputSchema: {
        type: 'object',
        properties: {
          modelType: {
            type: 'string',
            enum: Object.values(ModelType)
          },
          data: {
            type: 'object',
            properties: {
              features: { type: 'array' },
              labels: { type: 'array' }
            },
            required: ['features', 'labels']
          },
          searchSpace: {
            type: 'object',
            properties: {
              learningRate: {
                type: 'array',
                items: { type: 'number' }
              },
              batchSize: {
                type: 'array', 
                items: { type: 'number' }
              },
              epochs: {
                type: 'array',
                items: { type: 'number' }
              }
            }
          },
          maxTrials: {
            type: 'number',
            default: 10,
            minimum: 1,
            maximum: 100
          }
        },
        required: ['modelType', 'data', 'searchSpace']
      }
    };
  }

  /**
   * Model evaluation tool
   */
  private getModelEvaluationTool(): Tool {
    return {
      name: 'model_evaluation',
      description: 'Evaluate model performance on test data',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model to evaluate'
          },
          testData: {
            type: 'object',
            properties: {
              features: { type: 'array' },
              labels: { type: 'array' }
            },
            required: ['features', 'labels']
          },
          metrics: {
            type: 'array',
            items: { type: 'string' },
            default: ['accuracy', 'loss', 'precision', 'recall']
          }
        },
        required: ['modelId', 'testData']
      }
    };
  }

  /**
   * Drift detection tool
   */
  private getDriftDetectionTool(): Tool {
    return {
      name: 'drift_detection',
      description: 'Detect data drift in model performance',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: {
            type: 'string',
            description: 'ID of the model to check for drift'
          },
          newData: {
            type: 'object',
            properties: {
              features: { type: 'array' },
              labels: { type: 'array' }
            },
            required: ['features', 'labels']
          },
          threshold: {
            type: 'number',
            default: 0.1,
            minimum: 0,
            maximum: 1,
            description: 'Drift detection threshold'
          }
        },
        required: ['modelId', 'newData']
      }
    };
  }

  /**
   * Model deployment tool
   */
  private getModelDeploymentTool(): Tool {
    return {
      name: 'model_deployment',
      description: 'Deploy model to production environment',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: { type: 'string' },
          environment: {
            type: 'string',
            enum: ['development', 'staging', 'production']
          },
          autoScale: {
            type: 'boolean',
            default: false
          },
          minInstances: {
            type: 'number',
            default: 1,
            minimum: 1
          },
          maxInstances: {
            type: 'number',
            default: 3,
            minimum: 1
          }
        },
        required: ['modelId', 'environment']
      }
    };
  }

  /**
   * A/B testing tool
   */
  private getABTestTool(): Tool {
    return {
      name: 'ab_test',
      description: 'Setup A/B test between two models',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          modelA: { type: 'string' },
          modelB: { type: 'string' },
          trafficSplit: {
            type: 'number',
            default: 0.5,
            minimum: 0,
            maximum: 1
          },
          duration: {
            type: 'number',
            default: 604800000,
            description: 'Duration in milliseconds'
          },
          metrics: {
            type: 'array',
            items: { type: 'string' },
            default: ['accuracy', 'latency', 'error_rate']
          }
        },
        required: ['name', 'modelA', 'modelB']
      }
    };
  }

  /**
   * Model monitoring tool
   */
  private getModelMonitoringTool(): Tool {
    return {
      name: 'model_monitoring',
      description: 'Monitor model performance and health',
      inputSchema: {
        type: 'object',
        properties: {
          modelId: { type: 'string' },
          timeWindow: {
            type: 'string',
            enum: ['1h', '6h', '24h', '7d'],
            default: '24h'
          },
          includeRecommendations: {
            type: 'boolean',
            default: true
          }
        },
        required: ['modelId']
      }
    };
  }

  /**
   * Pipeline creation tool
   */
  private getPipelineCreateTool(): Tool {
    return {
      name: 'pipeline_create',
      description: 'Create ML pipeline for automated training and deployment',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          stages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['data_collection', 'preprocessing', 'feature_engineering', 
                         'training', 'validation', 'deployment', 'monitoring']
                },
                config: { type: 'object' }
              },
              required: ['name', 'type']
            }
          },
          schedule: {
            type: 'object',
            properties: {
              cron: { type: 'string' },
              timezone: { type: 'string' }
            }
          }
        },
        required: ['name', 'stages']
      }
    };
  }

  /**
   * Pipeline execution tool
   */
  private getPipelineExecuteTool(): Tool {
    return {
      name: 'pipeline_execute',
      description: 'Execute ML pipeline',
      inputSchema: {
        type: 'object',
        properties: {
          pipelineId: { type: 'string' },
          trigger: {
            type: 'string',
            default: 'manual'
          },
          inputs: {
            type: 'object',
            description: 'Input parameters for pipeline execution'
          }
        },
        required: ['pipelineId']
      }
    };
  }

  /**
   * Pipeline status tool
   */
  private getPipelineStatusTool(): Tool {
    return {
      name: 'pipeline_status',
      description: 'Get pipeline execution status and results',
      inputSchema: {
        type: 'object',
        properties: {
          executionId: { type: 'string' }
        },
        required: ['executionId']
      }
    };
  }
}