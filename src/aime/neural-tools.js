/**
 * AIME Neural Engine Tools
 * Real neural pattern learning, recognition, and optimization tools
 */

/**
 * Neural Pattern Learning Tool
 * Learns patterns from agent behavior and outcomes
 */
export function createNeuralPatternLearningTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_learn_pattern',
    description: 'Learn neural patterns from agent behavior and outcomes for optimization',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['coordination', 'optimization', 'prediction', 'adaptation'],
          description: 'Type of pattern to learn'
        },
        context: {
          type: 'object',
          description: 'Context information (task type, complexity, resources, etc.)'
        },
        action: {
          type: 'object',
          description: 'Action taken (method, parameters, priority, etc.)'
        },
        outcome: {
          type: 'object',
          description: 'Outcome achieved (success, duration, quality, etc.)'
        },
        performance: {
          type: 'object',
          description: 'Performance metrics (success rate, duration, accuracy, etc.)'
        },
        agentId: {
          type: 'string',
          description: 'ID of the agent that performed the action'
        }
      },
      required: ['type', 'context', 'action', 'outcome', 'agentId']
    },
    handler: async (params) => {
      try {
        const pattern = await neuralEngine.learnPattern(params);
        
        if (pattern) {
          return {
            success: true,
            pattern: {
              id: pattern.id,
              type: pattern.type,
              confidence: pattern.confidence,
              strength: pattern.strength,
              learnedAt: pattern.learnedAt
            },
            message: `Learned ${params.type} pattern with confidence ${pattern.confidence.toFixed(3)}`
          };
        } else {
          return {
            success: false,
            reason: 'Pattern rejected due to low confidence or insufficient data',
            minConfidence: neuralEngine.minConfidence
          };
        }
      } catch (error) {
        logger.error('Neural pattern learning error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Pattern Recognition Tool
 * Recognizes applicable patterns for current context
 */
export function createNeuralPatternRecognitionTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_recognize_patterns',
    description: 'Recognize applicable neural patterns for current context and suggest actions',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'object',
          description: 'Current context to match against learned patterns'
        },
        type: {
          type: 'string',
          enum: ['coordination', 'optimization', 'prediction', 'adaptation'],
          description: 'Optional: filter patterns by type'
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 20,
          default: 5,
          description: 'Maximum number of patterns to return'
        }
      },
      required: ['context']
    },
    handler: async (params) => {
      try {
        const patterns = neuralEngine.recognizePatterns(params.context, params.type);
        const limit = params.limit || 5;
        
        return {
          success: true,
          patterns: patterns.slice(0, limit).map(p => ({
            patternId: p.patternId,
            type: p.pattern.type,
            similarity: p.similarity,
            relevanceScore: p.relevanceScore,
            confidence: p.confidence,
            successRate: p.successRate,
            suggestedAction: p.pattern.action,
            expectedOutcome: p.pattern.outcome,
            usageCount: p.pattern.usageCount,
            lastUsed: p.pattern.lastUsed
          })),
          totalFound: patterns.length,
          bestMatch: patterns.length > 0 ? {
            id: patterns[0].patternId,
            relevanceScore: patterns[0].relevanceScore,
            confidence: patterns[0].confidence
          } : null
        };
      } catch (error) {
        logger.error('Neural pattern recognition error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Pattern Application Tool
 * Apply a recognized pattern to current situation
 */
export function createNeuralPatternApplicationTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_apply_pattern',
    description: 'Apply a recognized neural pattern to current situation with adaptations',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: {
          type: 'string',
          description: 'ID of the pattern to apply'
        },
        currentContext: {
          type: 'object',
          description: 'Current context for pattern application'
        },
        agentId: {
          type: 'string',
          description: 'ID of the agent applying the pattern'
        }
      },
      required: ['patternId', 'currentContext', 'agentId']
    },
    handler: async (params) => {
      try {
        const recommendation = await neuralEngine.applyPattern(
          params.patternId,
          params.currentContext,
          params.agentId
        );
        
        return {
          success: true,
          recommendation: {
            patternId: recommendation.patternId,
            type: recommendation.type,
            suggestedAction: recommendation.suggestedAction,
            expectedOutcome: recommendation.expectedOutcome,
            confidence: recommendation.confidence,
            reasoning: recommendation.reasoning,
            adaptations: recommendation.adaptations,
            appliedAt: recommendation.metadata.appliedAt
          }
        };
      } catch (error) {
        logger.error('Neural pattern application error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Pattern Training Tool
 * Train neural patterns using historical data
 */
export function createNeuralPatternTrainingTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_train_patterns',
    description: 'Train neural patterns using historical performance data with reinforcement learning',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['coordination', 'optimization', 'prediction', 'adaptation'],
          description: 'Type of patterns to train'
        },
        data: {
          type: 'array',
          description: 'Training data with context, action, outcome, and performance',
          items: {
            type: 'object',
            properties: {
              context: { type: 'object' },
              action: { type: 'object' },
              outcome: { type: 'object' },
              performance: { type: 'object' },
              agentId: { type: 'string' }
            },
            required: ['context', 'action', 'outcome']
          }
        },
        iterations: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Number of training iterations'
        },
        learningRate: {
          type: 'number',
          minimum: 0.001,
          maximum: 1.0,
          default: 0.1,
          description: 'Learning rate for training'
        },
        validationSplit: {
          type: 'number',
          minimum: 0.1,
          maximum: 0.5,
          default: 0.2,
          description: 'Fraction of data to use for validation'
        }
      },
      required: ['type', 'data']
    },
    handler: async (params) => {
      try {
        const trainingSession = await neuralEngine.trainPatterns({
          type: params.type,
          data: params.data,
          iterations: params.iterations || 10,
          learningRate: params.learningRate || 0.1,
          validationSplit: params.validationSplit || 0.2
        });
        
        return {
          success: true,
          trainingSession: {
            id: trainingSession.id,
            type: trainingSession.type,
            startTime: trainingSession.startTime,
            endTime: trainingSession.endTime,
            iterations: trainingSession.iterations,
            patternsLearned: trainingSession.patterns.size,
            performance: {
              initialAccuracy: trainingSession.performance.initialAccuracy,
              finalAccuracy: trainingSession.performance.finalAccuracy,
              improvement: trainingSession.performance.improvement,
              converged: trainingSession.performance.convergence
            }
          }
        };
      } catch (error) {
        logger.error('Neural pattern training error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Pattern Adaptation Tool
 * Adapt existing patterns based on new performance data
 */
export function createNeuralPatternAdaptationTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_adapt_pattern',
    description: 'Adapt existing neural pattern based on new performance feedback',
    inputSchema: {
      type: 'object',
      properties: {
        patternId: {
          type: 'string',
          description: 'ID of the pattern to adapt'
        },
        performanceData: {
          type: 'object',
          description: 'New performance data for adaptation',
          properties: {
            success: { type: 'boolean' },
            duration: { type: 'number' },
            accuracy: { type: 'number' },
            quality: { type: 'number' }
          },
          required: ['success']
        }
      },
      required: ['patternId', 'performanceData']
    },
    handler: async (params) => {
      try {
        const adaptation = await neuralEngine.adaptPattern(
          params.patternId,
          params.performanceData
        );
        
        return {
          success: true,
          adaptation: {
            id: adaptation.id,
            patternId: adaptation.patternId,
            timestamp: adaptation.timestamp,
            confidenceChange: {
              old: adaptation.oldConfidence,
              new: adaptation.newConfidence,
              improvement: adaptation.improvement
            },
            strengthChange: {
              old: adaptation.oldStrength,
              new: adaptation.newStrength
            }
          }
        };
      } catch (error) {
        logger.error('Neural pattern adaptation error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Prediction Tool
 * Generate predictions based on current patterns and context
 */
export function createNeuralPredictionTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_predict',
    description: 'Generate predictions based on learned neural patterns and current context',
    inputSchema: {
      type: 'object',
      properties: {
        context: {
          type: 'object',
          description: 'Current context for prediction'
        },
        type: {
          type: 'string',
          enum: ['coordination', 'optimization', 'prediction', 'adaptation'],
          description: 'Optional: filter patterns by type for prediction'
        },
        horizon: {
          type: 'string',
          enum: ['short', 'medium', 'long'],
          default: 'short',
          description: 'Prediction time horizon'
        }
      },
      required: ['context']
    },
    handler: async (params) => {
      try {
        const prediction = neuralEngine.generatePrediction(
          params.context,
          params.type,
          params.horizon || 'short'
        );
        
        return {
          success: true,
          prediction: {
            prediction: prediction.prediction,
            confidence: prediction.confidence,
            horizon: prediction.horizon,
            reasoning: prediction.reasoning,
            contributingPatterns: prediction.contributingPatterns,
            generatedAt: prediction.generatedAt
          }
        };
      } catch (error) {
        logger.error('Neural prediction error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Neural Engine Status Tool
 * Get comprehensive neural engine status and metrics
 */
export function createNeuralEngineStatusTool(neuralEngine, logger) {
  return {
    name: 'aime_neural_status',
    description: 'Get comprehensive neural engine status, patterns, and performance metrics',
    inputSchema: {
      type: 'object',
      properties: {
        includePatterns: {
          type: 'boolean',
          default: false,
          description: 'Include detailed pattern information'
        },
        patternType: {
          type: 'string',
          enum: ['coordination', 'optimization', 'prediction', 'adaptation'],
          description: 'Filter patterns by type (if includePatterns is true)'
        }
      }
    },
    handler: async (params) => {
      try {
        const status = neuralEngine.getStatus();
        const result = {
          success: true,
          status: {
            initialized: status.initialized,
            sessionId: status.sessionId,
            patterns: status.patterns,
            statistics: status.statistics,
            configuration: status.configuration,
            performance: status.performance,
            lastActivity: status.lastActivity
          }
        };

        // Include pattern details if requested
        if (params.includePatterns) {
          const patternDetails = [];
          const patternsToCheck = params.patternType 
            ? neuralEngine.patternCategories[params.patternType] || new Map()
            : neuralEngine.patterns;

          for (const [patternId, pattern] of patternsToCheck) {
            patternDetails.push({
              id: pattern.id,
              type: pattern.type,
              confidence: pattern.confidence,
              strength: pattern.strength,
              usageCount: pattern.usageCount,
              successCount: pattern.successCount,
              successRate: pattern.usageCount > 0 ? pattern.successCount / pattern.usageCount : 0,
              learnedAt: pattern.learnedAt,
              lastUsed: pattern.lastUsed,
              agentId: pattern.agentId
            });
          }

          result.patterns = patternDetails.slice(0, 50); // Limit to prevent huge responses
          result.totalPatterns = patternDetails.length;
        }

        return result;
      } catch (error) {
        logger.error('Neural engine status error:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  };
}

/**
 * Create all neural engine tools
 */
export function createNeuralEngineTools(neuralEngine, logger) {
  if (!neuralEngine) {
    logger.warn('Neural engine not available, skipping neural tools creation');
    return [];
  }

  return [
    createNeuralPatternLearningTool(neuralEngine, logger),
    createNeuralPatternRecognitionTool(neuralEngine, logger),
    createNeuralPatternApplicationTool(neuralEngine, logger),
    createNeuralPatternTrainingTool(neuralEngine, logger),
    createNeuralPatternAdaptationTool(neuralEngine, logger),
    createNeuralPredictionTool(neuralEngine, logger),
    createNeuralEngineStatusTool(neuralEngine, logger)
  ];
}