/**
 * Stream Formats and Protocols for Claude Flow Alpha 85
 * Implements real-time JSON streaming and structured communication
 */

export interface StreamMessage {
  id: string;
  timestamp: number;
  type: 'message' | 'tool_call' | 'result' | 'error' | 'status' | 'heartbeat';
  source: string;
  target?: string;
  data: any;
  metadata?: {
    chainId?: string;
    parentId?: string;
    dependencies?: string[];
    phase?: string;
    priority?: number;
  };
}

export interface StreamConfig {
  format: 'json-stream' | 'text' | 'binary';
  delimiter: string;
  compression?: 'gzip' | 'lz4' | 'none';
  encryption?: boolean;
  batchSize?: number;
  flushInterval?: number;
}

export interface PipelineConfig {
  id: string;
  name: string;
  description: string;
  stages: PipelineStage[];
  autoWire: boolean;
  parallelism?: number;
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

export interface PipelineStage {
  id: string;
  name: string;
  agentType: string;
  inputFormat: StreamConfig;
  outputFormat: StreamConfig;
  dependencies: string[];
  transform?: TransformFunction;
  filter?: FilterFunction;
  validation?: ValidationFunction;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export type TransformFunction = (input: StreamMessage) => StreamMessage | StreamMessage[];
export type FilterFunction = (input: StreamMessage) => boolean;
export type ValidationFunction = (input: StreamMessage) => boolean;

/**
 * Default stream configurations for common patterns
 */
export const DEFAULT_STREAM_CONFIGS: Record<string, StreamConfig> = {
  'json-stream': {
    format: 'json-stream',
    delimiter: '\n',
    compression: 'none',
    batchSize: 1,
    flushInterval: 0,
  },
  'batch-json': {
    format: 'json-stream', 
    delimiter: '\n',
    compression: 'gzip',
    batchSize: 10,
    flushInterval: 1000,
  },
  'realtime': {
    format: 'json-stream',
    delimiter: '\n',
    compression: 'none',
    batchSize: 1,
    flushInterval: 0,
  }
};

/**
 * Stream message builder utilities
 */
export class StreamMessageBuilder {
  static message(source: string, data: any, target?: string): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'message',
      source,
      target,
      data,
    };
  }

  static toolCall(source: string, toolName: string, parameters: any, target?: string): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'tool_call',
      source,
      target,
      data: {
        tool: toolName,
        parameters,
      },
    };
  }

  static result(source: string, data: any, parentId?: string): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'result',
      source,
      data,
      metadata: parentId ? { parentId } : undefined,
    };
  }

  static error(source: string, error: Error | string, parentId?: string): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'error',
      source,
      data: {
        message: typeof error === 'string' ? error : error.message,
        stack: typeof error === 'object' ? error.stack : undefined,
      },
      metadata: parentId ? { parentId } : undefined,
    };
  }

  static status(source: string, status: string, details?: any): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'status',
      source,
      data: {
        status,
        details: details || {},
      },
    };
  }

  static heartbeat(source: string): StreamMessage {
    return {
      id: this.generateId(),
      timestamp: Date.now(),
      type: 'heartbeat',
      source,
      data: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };
  }

  private static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Stream format serializers and deserializers
 */
export class StreamSerializer {
  static serialize(message: StreamMessage, config: StreamConfig): string {
    switch (config.format) {
      case 'json-stream':
        return JSON.stringify(message) + config.delimiter;
      case 'text':
        return `[${message.timestamp}] ${message.source}: ${JSON.stringify(message.data)}${config.delimiter}`;
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  static deserialize(data: string, config: StreamConfig): StreamMessage[] {
    const messages: StreamMessage[] = [];
    const chunks = data.split(config.delimiter).filter(chunk => chunk.trim());

    for (const chunk of chunks) {
      try {
        switch (config.format) {
          case 'json-stream':
            messages.push(JSON.parse(chunk));
            break;
          case 'text':
            // Parse text format: [timestamp] source: data
            const match = chunk.match(/^\[(\d+)\] ([^:]+): (.+)$/);
            if (match) {
              messages.push({
                id: this.generateId(),
                timestamp: parseInt(match[1]),
                type: 'message',
                source: match[2],
                data: JSON.parse(match[3]),
              });
            }
            break;
        }
      } catch (error) {
        console.warn('Failed to parse stream chunk:', chunk, error);
      }
    }

    return messages;
  }

  private static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Built-in pipeline templates for common workflow patterns
 */
export const PIPELINE_TEMPLATES: Record<string, PipelineConfig> = {
  'generate-critique-revise': {
    id: 'gcr',
    name: 'Generate → Critique → Revise',
    description: 'Recursive refinement chain for content improvement',
    autoWire: true,
    parallelism: 1,
    timeout: 300000, // 5 minutes
    stages: [
      {
        id: 'generate',
        name: 'Content Generator',
        agentType: 'coder',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'critique',
        name: 'Content Critic',
        agentType: 'reviewer',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['generate'],
      },
      {
        id: 'revise',
        name: 'Content Reviser',
        agentType: 'coder',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['critique'],
      },
    ],
  },
  'analyze-score-synthesize': {
    id: 'ass',
    name: 'Analyze → Score → Synthesize',
    description: 'Multi-phase analysis workflow with scoring',
    autoWire: true,
    parallelism: 2,
    timeout: 600000, // 10 minutes
    stages: [
      {
        id: 'analyze',
        name: 'Data Analyzer',
        agentType: 'analyst',
        inputFormat: DEFAULT_STREAM_CONFIGS['batch-json'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'score',
        name: 'Quality Scorer',
        agentType: 'reviewer',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['analyze'],
      },
      {
        id: 'synthesize',
        name: 'Result Synthesizer',
        agentType: 'coordinator',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['score'],
      },
    ],
  },
  'research-implement-test': {
    id: 'rit',
    name: 'Research → Implement → Test',
    description: 'Complete development workflow with validation',
    autoWire: true,
    parallelism: 1,
    timeout: 900000, // 15 minutes
    stages: [
      {
        id: 'research',
        name: 'Requirements Researcher',
        agentType: 'researcher',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'implement',
        name: 'Code Implementer',
        agentType: 'coder',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['research'],
      },
      {
        id: 'test',
        name: 'Quality Tester',
        agentType: 'tester',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['implement'],
      },
    ],
  },
  'parallel-analysis': {
    id: 'parallel',
    name: 'Parallel Multi-Agent Analysis',
    description: 'Concurrent analysis by multiple specialized agents',
    autoWire: true,
    parallelism: 4,
    timeout: 300000, // 5 minutes
    stages: [
      {
        id: 'security-analysis',
        name: 'Security Analyzer',
        agentType: 'reviewer',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'performance-analysis',
        name: 'Performance Analyzer',
        agentType: 'optimizer',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'code-quality-analysis',
        name: 'Code Quality Analyzer',
        agentType: 'reviewer',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'architecture-analysis',
        name: 'Architecture Analyzer',
        agentType: 'architect',
        inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: [],
      },
      {
        id: 'synthesis',
        name: 'Results Synthesizer',
        agentType: 'coordinator', 
        inputFormat: DEFAULT_STREAM_CONFIGS['batch-json'],
        outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
        dependencies: ['security-analysis', 'performance-analysis', 'code-quality-analysis', 'architecture-analysis'],
      },
    ],
  },
};