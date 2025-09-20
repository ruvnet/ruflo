/**
 * Stream Processor for Claude Flow Alpha 85
 * Handles real-time JSON streaming, automatic stream wiring, and pipeline automation
 */

import { EventEmitter } from 'node:events';
import { Readable, Writable, Transform, pipeline } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Logger } from '../core/logger.js';
import {
  StreamMessage,
  StreamConfig,
  PipelineConfig,
  PipelineStage,
  StreamMessageBuilder,
  StreamSerializer,
  DEFAULT_STREAM_CONFIGS,
  PIPELINE_TEMPLATES,
} from './stream-formats.js';

export interface StreamConnection {
  id: string;
  source: string;
  target: string;
  config: StreamConfig;
  readable: Readable;
  writable: Writable;
  active: boolean;
  metrics: StreamMetrics;
}

export interface StreamMetrics {
  messagesProcessed: number;
  bytesTransferred: number;
  errorsCount: number;
  averageLatency: number;
  throughput: number;
  startTime: number;
  lastActivity: number;
}

export interface PipelineInstance {
  id: string;
  config: PipelineConfig;
  stages: Map<string, StageInstance>;
  connections: Map<string, StreamConnection>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  startTime: number;
  endTime?: number;
  metrics: PipelineMetrics;
}

export interface StageInstance {
  id: string;
  config: PipelineStage;
  agentId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  input: Readable;
  output: Writable;
  metrics: StageMetrics;
}

export interface StageMetrics {
  inputMessages: number;
  outputMessages: number;
  processingTime: number;
  errorCount: number;
  startTime?: number;
  endTime?: number;
}

export interface PipelineMetrics {
  totalMessages: number;
  totalProcessingTime: number;
  stagesCompleted: number; 
  stagesFailed: number;
  throughput: number;
  efficiency: number;
}

/**
 * Core stream processor that manages real-time JSON streaming and pipeline automation
 */
export class StreamProcessor extends EventEmitter {
  private connections = new Map<string, StreamConnection>();
  private pipelines = new Map<string, PipelineInstance>();
  private transforms = new Map<string, Transform>();
  private logger: Logger;
  private autoWireEnabled = true;
  private heartbeatInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.startHeartbeat();
    this.startMetricsCollection();
  }

  /**
   * Create a stream connection between two agents
   */
  async createConnection(
    sourceId: string,
    targetId: string,
    config: StreamConfig = DEFAULT_STREAM_CONFIGS['json-stream']
  ): Promise<StreamConnection> {
    const connectionId = `${sourceId}->${targetId}`;
    
    const readable = new Readable({
      objectMode: true,
      read() {
        // Will be fed by source agent
      },
    });

    const writable = new Writable({
      objectMode: true,
      write(chunk: StreamMessage, encoding, callback) {
        this.emit('data', chunk);
        callback();
      },
    });

    const connection: StreamConnection = {
      id: connectionId,
      source: sourceId,
      target: targetId,
      config,
      readable,
      writable,
      active: true,
      metrics: {
        messagesProcessed: 0,
        bytesTransferred: 0,
        errorsCount: 0,
        averageLatency: 0,
        throughput: 0,
        startTime: Date.now(),
        lastActivity: Date.now(),
      },
    };

    // Set up streaming pipeline with transforms
    const transformStream = this.createTransformStream(config);
    
    pipeline(
      readable,
      transformStream,
      writable,
      (error) => {
        if (error) {
          this.logger.error('Stream pipeline error', { connectionId, error: error.message });
          connection.metrics.errorsCount++;
          this.emit('connectionError', connection, error);
        } else {
          this.logger.info('Stream pipeline completed', { connectionId });
          this.emit('connectionCompleted', connection);
        }
      }
    );

    this.connections.set(connectionId, connection);
    
    this.logger.info('Stream connection created', {
      connectionId,
      source: sourceId,
      target: targetId,
      format: config.format,
    });

    this.emit('connectionCreated', connection);
    return connection;
  }

  /**
   * Send a message through a stream connection
   */
  async sendMessage(
    connectionId: string,
    message: StreamMessage
  ): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.active) {
      throw new Error(`Connection not found or inactive: ${connectionId}`);
    }

    try {
      connection.readable.push(message);
      connection.metrics.messagesProcessed++;
      connection.metrics.lastActivity = Date.now();
      
      const serialized = StreamSerializer.serialize(message, connection.config);
      connection.metrics.bytesTransferred += Buffer.byteLength(serialized);

      this.logger.debug('Message sent through stream', {
        connectionId,
        messageId: message.id,
        messageType: message.type,
      });

      this.emit('messageSent', connection, message);
    } catch (error) {
      connection.metrics.errorsCount++;
      this.logger.error('Failed to send message', {
        connectionId,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a pipeline from configuration
   */
  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    const pipeline: PipelineInstance = {
      id: config.id,
      config,
      stages: new Map(),
      connections: new Map(),
      status: 'pending',
      startTime: Date.now(),
      metrics: {
        totalMessages: 0,
        totalProcessingTime: 0,
        stagesCompleted: 0,
        stagesFailed: 0,
        throughput: 0,
        efficiency: 0,
      },
    };

    // Create stage instances
    for (const stageConfig of config.stages) {
      const stage: StageInstance = {
        id: stageConfig.id,
        config: stageConfig,
        status: 'pending',
        input: new Readable({ objectMode: true, read() {} }),
        output: new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            this.emit('data', chunk);
            callback();
          },
        }),
        metrics: {
          inputMessages: 0,
          outputMessages: 0,
          processingTime: 0,
          errorCount: 0,
        },
      };

      pipeline.stages.set(stageConfig.id, stage);
    }

    // Auto-wire stages if enabled
    if (config.autoWire) {
      await this.autoWireStages(pipeline);
    }

    this.pipelines.set(config.id, pipeline);
    
    this.logger.info('Pipeline created', {
      pipelineId: config.id,
      stagesCount: config.stages.length,
      autoWire: config.autoWire,
    });

    this.emit('pipelineCreated', pipeline);
    return pipeline;
  }

  /**
   * Execute a pipeline with the given input
   */
  async executePipeline(
    pipelineId: string,
    input: StreamMessage | StreamMessage[]
  ): Promise<StreamMessage[]> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline not found: ${pipelineId}`);
    }

    pipeline.status = 'running';
    pipeline.startTime = Date.now();

    this.logger.info('Pipeline execution started', {
      pipelineId,
      inputMessages: Array.isArray(input) ? input.length : 1,
    });

    try {
      // Find entry stages (stages with no dependencies)
      const entryStages = Array.from(pipeline.stages.values())
        .filter(stage => stage.config.dependencies.length === 0);

      if (entryStages.length === 0) {
        throw new Error('No entry stages found in pipeline');
      }

      // Send input to entry stages
      const inputs = Array.isArray(input) ? input : [input];
      for (const stage of entryStages) {
        for (const message of inputs) {
          stage.input.push(message);
          stage.metrics.inputMessages++;
        }
      }

      // Wait for pipeline completion
      const results = await this.waitForPipelineCompletion(pipeline);
      
      pipeline.status = 'completed';
      pipeline.endTime = Date.now();
      pipeline.metrics.totalProcessingTime = pipeline.endTime - pipeline.startTime;

      this.logger.info('Pipeline execution completed', {
        pipelineId,
        outputMessages: results.length,
        processingTime: pipeline.metrics.totalProcessingTime,
      });

      this.emit('pipelineCompleted', pipeline, results);
      return results;

    } catch (error) {
      pipeline.status = 'failed';
      pipeline.endTime = Date.now();
      
      this.logger.error('Pipeline execution failed', {
        pipelineId,
        error: error instanceof Error ? error.message : String(error),
      });

      this.emit('pipelineFailed', pipeline, error);
      throw error;
    }
  }

  /**
   * Create a pipeline from template
   */
  async createPipelineFromTemplate(
    templateName: string,
    customConfig?: Partial<PipelineConfig>
  ): Promise<PipelineInstance> {
    const template = PIPELINE_TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Pipeline template not found: ${templateName}`);
    }

    const config: PipelineConfig = {
      ...template,
      ...customConfig,
      id: customConfig?.id || `${template.id}-${Date.now()}`,
    };

    return this.createPipeline(config);
  }

  /**
   * Automatically wire stages based on dependencies
   */
  private async autoWireStages(pipeline: PipelineInstance): Promise<void> {
    for (const stage of pipeline.stages.values()) {
      if (stage.config.dependencies.length === 0) continue;

      for (const depId of stage.config.dependencies) {
        const depStage = pipeline.stages.get(depId);
        if (!depStage) {
          throw new Error(`Dependency stage not found: ${depId}`);
        }

        // Create connection between dependency output and current stage input
        const connectionId = `${depId}->${stage.id}`;
        const connection = await this.createConnection(
          depId,
          stage.id,
          stage.config.inputFormat
        );

        pipeline.connections.set(connectionId, connection);

        // Wire the streams
        depStage.output.on('data', (message: StreamMessage) => {
          stage.input.push(message);
          stage.metrics.inputMessages++;
        });
      }
    }

    this.logger.info('Pipeline stages auto-wired', {
      pipelineId: pipeline.id,
      connectionsCount: pipeline.connections.size,
    });
  }

  /**
   * Create a transform stream for the given configuration
   */
  private createTransformStream(config: StreamConfig): Transform {
    return new Transform({
      objectMode: true,
      transform(chunk: StreamMessage, encoding, callback) {
        try {
          // Apply any transformations based on config
          if (config.compression === 'gzip') {
            // Compress data if needed (placeholder)
          }

          // Validate message format
          if (!chunk.id || !chunk.timestamp || !chunk.source) {
            throw new Error('Invalid stream message format');
          }

          callback(null, chunk);
        } catch (error) {
          callback(error);
        }
      },
    });
  }

  /**
   * Wait for pipeline completion by monitoring stage outputs
   */
  private async waitForPipelineCompletion(
    pipeline: PipelineInstance,
    timeoutMs: number = 300000
  ): Promise<StreamMessage[]> {
    return new Promise((resolve, reject) => {
      const results: StreamMessage[] = [];
      const timeout = setTimeout(() => {
        reject(new Error(`Pipeline execution timeout: ${pipeline.id}`));
      }, timeoutMs);

      // Find exit stages (stages with no dependents)
      const exitStages = this.findExitStages(pipeline);
      let completedExitStages = 0;

      for (const stage of exitStages) {
        stage.output.on('data', (message: StreamMessage) => {
          results.push(message);
          stage.metrics.outputMessages++;
        });

        stage.output.on('end', () => {
          completedExitStages++;
          pipeline.metrics.stagesCompleted++;

          if (completedExitStages === exitStages.length) {
            clearTimeout(timeout);
            resolve(results);
          }
        });

        stage.output.on('error', (error) => {
          clearTimeout(timeout);
          pipeline.metrics.stagesFailed++;
          reject(error);
        });
      }
    });
  }

  /**
   * Find stages that have no dependents (exit stages)
   */
  private findExitStages(pipeline: PipelineInstance): StageInstance[] {
    const allStageIds = new Set(pipeline.stages.keys());
    const dependentStageIds = new Set<string>();

    // Collect all stages that are dependencies of others
    for (const stage of pipeline.stages.values()) {
      for (const depId of stage.config.dependencies) {
        dependentStageIds.add(depId);
      }
    }

    // Exit stages are those not depended upon by others
    const exitStageIds = [...allStageIds].filter(id => !dependentStageIds.has(id));
    return exitStageIds.map(id => pipeline.stages.get(id)!);
  }

  /**
   * Start heartbeat for connection monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const connection of this.connections.values()) {
        if (connection.active) {
          const heartbeat = StreamMessageBuilder.heartbeat(connection.source);
          this.sendMessage(connection.id, heartbeat).catch(error => {
            this.logger.error('Heartbeat failed', {
              connectionId: connection.id,
              error: error.message,
            });
          });
        }
      }
    }, 30000); // 30 seconds
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(() => {
      this.calculateConnectionMetrics();
      this.calculatePipelineMetrics();
      this.emit('metricsUpdated', this.getSystemMetrics());
    }, 5000); // 5 seconds
  }

  /**
   * Calculate connection metrics
   */
  private calculateConnectionMetrics(): void {
    for (const connection of this.connections.values()) {
      const now = Date.now();
      const duration = (now - connection.metrics.startTime) / 1000; // seconds
      
      if (duration > 0) {
        connection.metrics.throughput = connection.metrics.messagesProcessed / duration;
      }
    }
  }

  /**
   * Calculate pipeline metrics
   */
  private calculatePipelineMetrics(): void {
    for (const pipeline of this.pipelines.values()) {
      const totalMessages = Array.from(pipeline.stages.values())
        .reduce((sum, stage) => sum + stage.metrics.inputMessages, 0);
      
      pipeline.metrics.totalMessages = totalMessages;
      
      if (pipeline.status === 'completed' && pipeline.endTime) {
        const duration = (pipeline.endTime - pipeline.startTime) / 1000;
        if (duration > 0) {
          pipeline.metrics.throughput = totalMessages / duration;
        }
        
        const totalStages = pipeline.stages.size;
        if (totalStages > 0) {
          pipeline.metrics.efficiency = pipeline.metrics.stagesCompleted / totalStages;
        }
      }
    }
  }

  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): any {
    const connectionMetrics = Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      source: conn.source,
      target: conn.target,
      active: conn.active,
      metrics: conn.metrics,
    }));

    const pipelineMetrics = Array.from(this.pipelines.values()).map(pipeline => ({
      id: pipeline.id,
      status: pipeline.status,
      stages: pipeline.stages.size,
      connections: pipeline.connections.size,
      metrics: pipeline.metrics,
    }));

    return {
      connections: connectionMetrics,
      pipelines: pipelineMetrics,
      totalConnections: this.connections.size,
      totalPipelines: this.pipelines.size,
      timestamp: Date.now(),
    };
  }

  /**
   * Close connection
   */
  async closeConnection(connectionId: string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) return;

    connection.active = false;
    connection.readable.destroy();
    connection.writable.destroy();
    
    this.connections.delete(connectionId);
    this.emit('connectionClosed', connection);
    
    this.logger.info('Stream connection closed', { connectionId });
  }

  /**
   * Close pipeline and all its connections
   */
  async closePipeline(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return;

    pipeline.status = 'completed';
    pipeline.endTime = Date.now();

    // Close all connections
    for (const connection of pipeline.connections.values()) {
      await this.closeConnection(connection.id);
    }

    // Clean up stages
    for (const stage of pipeline.stages.values()) {
      stage.input.destroy();
      stage.output.destroy();
    }

    this.pipelines.delete(pipelineId);
    this.emit('pipelineClosed', pipeline);
    
    this.logger.info('Pipeline closed', { pipelineId });
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Close all connections
    for (const connectionId of this.connections.keys()) {
      await this.closeConnection(connectionId);
    }

    // Close all pipelines
    for (const pipelineId of this.pipelines.keys()) {
      await this.closePipeline(pipelineId);
    }

    this.logger.info('Stream processor cleanup completed');
  }
}

/**
 * Utility functions for stream chaining
 */
export class StreamChainUtils {
  /**
   * Detect task dependencies from descriptions
   */
  static detectDependencies(tasks: Array<{ id: string; description: string }>): Map<string, string[]> {
    const dependencies = new Map<string, string[]>();
    
    for (const task of tasks) {
      const deps: string[] = [];
      const description = task.description.toLowerCase();
      
      // Look for dependency keywords
      for (const otherTask of tasks) {
        if (otherTask.id === task.id) continue;
        
        const otherDesc = otherTask.description.toLowerCase();
        
        // Check for explicit references
        if (description.includes(otherTask.id) || 
            description.includes(`after ${otherDesc}`) ||
            description.includes(`depends on ${otherDesc}`) ||
            description.includes(`requires ${otherDesc}`)) {
          deps.push(otherTask.id);
        }
        
        // Check for implicit dependencies based on output/input relationships
        if (this.hasOutputInputRelationship(otherDesc, description)) {
          deps.push(otherTask.id);
        }
      }
      
      dependencies.set(task.id, deps);
    }
    
    return dependencies;
  }

  /**
   * Check if one task's output might be another's input
   */
  private static hasOutputInputRelationship(producer: string, consumer: string): boolean {
    const outputKeywords = ['generate', 'create', 'produce', 'build', 'write', 'design'];
    const inputKeywords = ['analyze', 'review', 'test', 'validate', 'improve', 'refine'];
    
    const hasOutput = outputKeywords.some(keyword => producer.includes(keyword));
    const hasInput = inputKeywords.some(keyword => consumer.includes(keyword));
    
    return hasOutput && hasInput;
  }

  /**
   * Auto-detect best pipeline template for a set of tasks
   */
  static suggestPipelineTemplate(tasks: Array<{ type: string; description: string }>): string {
    const taskTypes = tasks.map(t => t.type.toLowerCase());
    const descriptions = tasks.map(t => t.description.toLowerCase()).join(' ');
    
    // Look for generate → critique → revise pattern
    if (taskTypes.includes('coding') && taskTypes.includes('review')) {
      return 'generate-critique-revise';
    }
    
    // Look for analysis → scoring → synthesis pattern
    if (descriptions.includes('analyze') && descriptions.includes('score')) {
      return 'analyze-score-synthesize';
    }
    
    // Look for research → implement → test pattern
    if (taskTypes.includes('research') && taskTypes.includes('coding') && taskTypes.includes('testing')) {
      return 'research-implement-test';
    }
    
    // Look for parallel analysis pattern
    if (tasks.length >= 3 && taskTypes.filter(t => t.includes('analysis')).length >= 2) {
      return 'parallel-analysis';
    }
    
    // Default to generate-critique-revise for most cases
    return 'generate-critique-revise';
  }
}