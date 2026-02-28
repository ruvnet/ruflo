/**
 * Enterprise-grade batch request processor for Claude Flow V3
 * Handles concurrent processing with rate limiting, metrics, and robust error handling
 */

import { Semaphore, SemaphoreFactory } from './semaphore.js';
import { RateLimiter, RateLimiterFactory, MultiTierRateLimiter, RateLimitResult } from './rate-limiter.js';
import { MetricsCollector, BatchMetrics, RequestMetrics } from './metrics-collector.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcBatchRequest extends Array<JsonRpcRequest> {}
export interface JsonRpcBatchResponse extends Array<JsonRpcResponse> {}

export interface BatchProcessorConfig {
  /** Maximum concurrent requests */
  maxConcurrency?: number;
  /** Maximum batch size */
  maxBatchSize?: number;
  /** Request timeout in ms */
  requestTimeout?: number;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry backoff factor */
  retryBackoffFactor?: number;
  /** Maximum retry delay in ms */
  maxRetryDelay?: number;
  /** Enable request ordering preservation */
  preserveOrder?: boolean;
  /** Rate limiting configuration */
  rateLimiting?: {
    requestsPerSecond?: number;
    requestsPerMinute?: number;
    requestsPerHour?: number;
  };
  /** Enable metrics collection */
  enableMetrics?: boolean;
  /** Custom request processor function */
  requestProcessor?: (request: JsonRpcRequest) => Promise<JsonRpcResponse>;
  /** Error handler function */
  errorHandler?: (error: Error, request: JsonRpcRequest, attempt: number) => Promise<boolean>;
  /** Request validator function */
  requestValidator?: (request: JsonRpcRequest) => Promise<void>;
  /** Response transformer function */
  responseTransformer?: (response: JsonRpcResponse, request: JsonRpcRequest) => Promise<JsonRpcResponse>;
}

export interface BatchProcessingResult {
  /** Batch ID */
  batchId: string;
  /** Processed responses in order */
  responses: JsonRpcBatchResponse;
  /** Processing metrics */
  metrics: BatchMetrics;
  /** Any processing errors */
  errors: ProcessingError[];
  /** Processing duration */
  duration: number;
  /** Success rate percentage */
  successRate: number;
}

export interface ProcessingError {
  /** Request that failed */
  request: JsonRpcRequest;
  /** Error details */
  error: Error;
  /** Retry attempts made */
  retryCount: number;
  /** Final status */
  status: 'failed' | 'timeout' | 'rate-limited' | 'validation-failed';
}

export interface ProcessingContext {
  /** Request being processed */
  request: JsonRpcRequest;
  /** Request index in batch */
  index: number;
  /** Attempt number */
  attempt: number;
  /** Start timestamp */
  startTime: number;
  /** Tags for metrics */
  tags: Record<string, string>;
}

/**
 * Enterprise-grade batch request processor with comprehensive error handling,
 * rate limiting, metrics collection, and concurrent execution
 */
export class BatchRequestProcessor {
  private readonly config: Required<BatchProcessorConfig>;
  private readonly concurrencySemaphore: Semaphore;
  private readonly rateLimiter: MultiTierRateLimiter;
  private readonly metricsCollector: MetricsCollector;
  private readonly activeBatches = new Map<string, Promise<BatchProcessingResult>>();

  constructor(config: BatchProcessorConfig = {}) {
    this.config = {
      maxConcurrency: 10,
      maxBatchSize: 100,
      requestTimeout: 30000,
      maxRetries: 3,
      retryBackoffFactor: 2,
      maxRetryDelay: 30000,
      preserveOrder: true,
      rateLimiting: {
        requestsPerSecond: 50,
        requestsPerMinute: 1000,
        requestsPerHour: 10000
      },
      enableMetrics: true,
      requestProcessor: this.defaultRequestProcessor.bind(this),
      errorHandler: this.defaultErrorHandler.bind(this),
      requestValidator: this.defaultRequestValidator.bind(this),
      responseTransformer: this.defaultResponseTransformer.bind(this),
      ...config
    };

    // Initialize components
    this.concurrencySemaphore = SemaphoreFactory.forBatchProcessing(this.config.maxConcurrency);
    this.rateLimiter = this.createRateLimiter();
    this.metricsCollector = new MetricsCollector({
      trackRequests: this.config.enableMetrics,
      trackResources: this.config.enableMetrics,
      maxRequestHistory: this.config.maxBatchSize * 10,
      maxBatchHistory: 100
    });
  }

  /**
   * Process a batch of JSON-RPC requests
   */
  async processBatch(requests: JsonRpcBatchRequest): Promise<BatchProcessingResult> {
    const batchId = this.generateBatchId();
    const startTime = Date.now();

    // Validate batch size
    if (requests.length > this.config.maxBatchSize) {
      throw new Error(`Batch size ${requests.length} exceeds maximum ${this.config.maxBatchSize}`);
    }

    // Validate requests
    await this.validateBatchRequests(requests);

    // Start metrics collection
    if (this.config.enableMetrics) {
      this.metricsCollector.startBatch(batchId, requests.length);
    }

    try {
      // Process requests with concurrency control
      const processingPromise = this.config.preserveOrder
        ? this.processOrderedBatch(requests, batchId)
        : this.processUnorderedBatch(requests, batchId);

      // Store active batch
      this.activeBatches.set(batchId, processingPromise);

      const result = await processingPromise;
      return result;

    } finally {
      // Clean up
      this.activeBatches.delete(batchId);

      // End metrics collection
      if (this.config.enableMetrics) {
        this.metricsCollector.endBatch(batchId);
      }
    }
  }

  /**
   * Process a single request (public method for direct use)
   */
  async processRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const batchId = this.generateBatchId();
    const result = await this.processBatch([request]);

    if (result.responses.length === 0) {
      throw new Error('No response received for request');
    }

    return result.responses[0];
  }

  /**
   * Get processing metrics for a specific batch
   */
  getBatchMetrics(batchId: string): BatchMetrics | undefined {
    return this.metricsCollector.getBatchMetrics(batchId);
  }

  /**
   * Get aggregate processing metrics
   */
  getAggregateMetrics(startTime?: number, endTime?: number) {
    return this.metricsCollector.getAggregateMetrics(startTime, endTime);
  }

  /**
   * Get current resource utilization
   */
  getResourceMetrics() {
    return this.metricsCollector.getCurrentResourceUsage();
  }

  /**
   * Get active batch count
   */
  getActiveBatchCount(): number {
    return this.activeBatches.size;
  }

  /**
   * Cancel all active batches
   */
  async cancelAllBatches(): Promise<void> {
    const batches = Array.from(this.activeBatches.values());
    await Promise.allSettled(batches);
    this.activeBatches.clear();
  }

  /**
   * Shutdown processor gracefully
   */
  async shutdown(): Promise<void> {
    await this.cancelAllBatches();
    this.concurrencySemaphore.clearQueue();
    this.metricsCollector.destroy();
  }

  /**
   * Process batch preserving request order
   */
  private async processOrderedBatch(
    requests: JsonRpcBatchRequest,
    batchId: string
  ): Promise<BatchProcessingResult> {
    const startTime = Date.now();
    const responses: JsonRpcBatchResponse = new Array(requests.length);
    const errors: ProcessingError[] = [];
    let successCount = 0;

    // Process all requests concurrently but maintain order
    const processingPromises = requests.map(async (request, index) => {
      try {
        const response = await this.processRequestWithRetry(request, index, batchId);
        responses[index] = response;
        successCount++;
      } catch (error) {
        const processingError: ProcessingError = {
          request,
          error: error as Error,
          retryCount: this.config.maxRetries,
          status: this.determineErrorStatus(error as Error)
        };
        errors.push(processingError);

        // Create error response
        responses[index] = this.createErrorResponse(request, error as Error);
      }
    });

    await Promise.allSettled(processingPromises);

    const duration = Date.now() - startTime;
    const successRate = (successCount / requests.length) * 100;
    const metrics = this.metricsCollector.getBatchMetrics(batchId)!;

    return {
      batchId,
      responses: responses.filter(Boolean), // Remove any undefined responses
      metrics,
      errors,
      duration,
      successRate
    };
  }

  /**
   * Process batch without preserving order (faster)
   */
  private async processUnorderedBatch(
    requests: JsonRpcBatchRequest,
    batchId: string
  ): Promise<BatchProcessingResult> {
    const startTime = Date.now();
    const responses: JsonRpcBatchResponse = [];
    const errors: ProcessingError[] = [];
    let successCount = 0;

    // Process all requests concurrently
    const results = await Promise.allSettled(
      requests.map((request, index) =>
        this.processRequestWithRetry(request, index, batchId)
      )
    );

    // Collect results
    results.forEach((result, index) => {
      const request = requests[index];

      if (result.status === 'fulfilled') {
        responses.push(result.value);
        successCount++;
      } else {
        const error = result.reason as Error;
        const processingError: ProcessingError = {
          request,
          error,
          retryCount: this.config.maxRetries,
          status: this.determineErrorStatus(error)
        };
        errors.push(processingError);

        // Create error response
        responses.push(this.createErrorResponse(request, error));
      }
    });

    const duration = Date.now() - startTime;
    const successRate = (successCount / requests.length) * 100;
    const metrics = this.metricsCollector.getBatchMetrics(batchId)!;

    return {
      batchId,
      responses,
      metrics,
      errors,
      duration,
      successRate
    };
  }

  /**
   * Process single request with retry logic
   */
  private async processRequestWithRetry(
    request: JsonRpcRequest,
    index: number,
    batchId: string
  ): Promise<JsonRpcResponse> {
    const requestId = `${batchId}-${index}`;
    let lastError: Error;
    let attempt = 0;

    while (attempt <= this.config.maxRetries) {
      try {
        // Start request metrics
        if (this.config.enableMetrics) {
          const requestSize = JSON.stringify(request).length;
          this.metricsCollector.startRequest(requestId, requestSize, {
            batchId,
            method: request.method,
            attempt: attempt.toString()
          });
        }

        // Wait for concurrency permit
        await this.concurrencySemaphore.acquire();

        try {
          // Check rate limits
          await this.checkRateLimits(request);

          // Validate request
          await this.config.requestValidator(request);

          // Process request with timeout
          const response = await this.processWithTimeout(request);

          // Transform response
          const transformedResponse = await this.config.responseTransformer(response, request);

          // Record success metrics
          if (this.config.enableMetrics) {
            const responseSize = JSON.stringify(transformedResponse).length;
            this.metricsCollector.endRequest(requestId, 200, responseSize);
          }

          return transformedResponse;

        } finally {
          this.concurrencySemaphore.release();
        }

      } catch (error) {
        lastError = error as Error;
        attempt++;

        // Record retry metrics
        if (this.config.enableMetrics && attempt <= this.config.maxRetries) {
          this.metricsCollector.retryRequest(requestId);
        }

        // Check if we should retry
        if (attempt <= this.config.maxRetries) {
          const shouldRetry = await this.config.errorHandler(lastError, request, attempt);

          if (shouldRetry) {
            // Calculate backoff delay
            const delay = Math.min(
              1000 * Math.pow(this.config.retryBackoffFactor, attempt - 1),
              this.config.maxRetryDelay
            );

            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }

        // Record failure metrics
        if (this.config.enableMetrics) {
          const errorCategory = this.categorizeError(lastError);
          this.metricsCollector.endRequest(requestId, 500, 0, {
            code: lastError.name || 'UnknownError',
            message: lastError.message,
            category: errorCategory
          });
        }

        throw lastError;
      }
    }

    throw lastError!;
  }

  /**
   * Process request with timeout
   */
  private async processWithTimeout(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.requestTimeout}ms`));
      }, this.config.requestTimeout);

      this.config.requestProcessor(request)
        .then(response => {
          clearTimeout(timeoutId);
          resolve(response);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Check rate limits before processing
   */
  private async checkRateLimits(request: JsonRpcRequest): Promise<void> {
    // Check per-second rate limit
    const perSecondResult = this.rateLimiter.checkLimit('per-second');
    if (!perSecondResult.allowed) {
      const error = new Error(`Rate limit exceeded: ${perSecondResult.retryAfter}ms`);
      (error as any).code = 'RATE_LIMIT_EXCEEDED';
      (error as any).retryAfter = perSecondResult.retryAfter;
      throw error;
    }

    // Check per-minute rate limit
    const perMinuteResult = this.rateLimiter.checkLimit('per-minute');
    if (!perMinuteResult.allowed) {
      const error = new Error(`Rate limit exceeded: ${perMinuteResult.retryAfter}ms`);
      (error as any).code = 'RATE_LIMIT_EXCEEDED';
      (error as any).retryAfter = perMinuteResult.retryAfter;
      throw error;
    }

    // Check per-hour rate limit
    const perHourResult = this.rateLimiter.checkLimit('per-hour');
    if (!perHourResult.allowed) {
      const error = new Error(`Rate limit exceeded: ${perHourResult.retryAfter}ms`);
      (error as any).code = 'RATE_LIMIT_EXCEEDED';
      (error as any).retryAfter = perHourResult.retryAfter;
      throw error;
    }
  }

  /**
   * Validate batch requests
   */
  private async validateBatchRequests(requests: JsonRpcBatchRequest): Promise<void> {
    if (!Array.isArray(requests)) {
      throw new Error('Batch requests must be an array');
    }

    if (requests.length === 0) {
      throw new Error('Batch cannot be empty');
    }

    // Validate each request
    for (let i = 0; i < requests.length; i++) {
      try {
        await this.config.requestValidator(requests[i]);
      } catch (error) {
        throw new Error(`Request ${i} validation failed: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Create rate limiter configuration
   */
  private createRateLimiter(): MultiTierRateLimiter {
    const { rateLimiting } = this.config;

    return new MultiTierRateLimiter({
      'per-second': {
        maxRequests: rateLimiting.requestsPerSecond!,
        windowMs: 1000,
        strategy: 'sliding-window'
      },
      'per-minute': {
        maxRequests: rateLimiting.requestsPerMinute!,
        windowMs: 60 * 1000,
        strategy: 'token-bucket'
      },
      'per-hour': {
        maxRequests: rateLimiting.requestsPerHour!,
        windowMs: 60 * 60 * 1000,
        strategy: 'fixed-window'
      }
    });
  }

  /**
   * Default request processor
   */
  private async defaultRequestProcessor(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    // This is a placeholder - in real implementation, this would
    // make HTTP calls, invoke services, etc.
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        message: 'Default processor response',
        method: request.method,
        params: request.params
      }
    };
  }

  /**
   * Default error handler
   */
  private async defaultErrorHandler(
    error: Error,
    request: JsonRpcRequest,
    attempt: number
  ): Promise<boolean> {
    // Retry on network errors, timeouts, and server errors
    const retryableErrors = ['ENOTFOUND', 'ECONNRESET', 'TIMEOUT', 'RATE_LIMIT_EXCEEDED'];
    const isRetryable = retryableErrors.some(code =>
      error.message.includes(code) || (error as any).code === code
    );

    return isRetryable && attempt <= this.config.maxRetries;
  }

  /**
   * Default request validator
   */
  private async defaultRequestValidator(request: JsonRpcRequest): Promise<void> {
    if (typeof request !== 'object' || request === null) {
      throw new Error('Request must be an object');
    }

    if (request.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version');
    }

    if (typeof request.method !== 'string' || request.method === '') {
      throw new Error('Method must be a non-empty string');
    }

    if (request.id === undefined || request.id === null) {
      throw new Error('Request ID is required');
    }
  }

  /**
   * Default response transformer
   */
  private async defaultResponseTransformer(
    response: JsonRpcResponse,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    return response;
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    return `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create error response for failed request
   */
  private createErrorResponse(request: JsonRpcRequest, error: Error): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603, // Internal error
        message: error.message,
        data: {
          name: error.name,
          stack: error.stack
        }
      }
    };
  }

  /**
   * Categorize error for metrics
   */
  private categorizeError(error: Error): RequestMetrics['error']['category'] {
    const message = error.message.toLowerCase();
    const code = (error as any).code;

    if (code === 'RATE_LIMIT_EXCEEDED' || message.includes('rate limit')) {
      return 'rate-limit';
    }

    if (message.includes('timeout') || code === 'TIMEOUT') {
      return 'timeout';
    }

    if (message.includes('validation') || message.includes('invalid')) {
      return 'validation';
    }

    if (message.includes('network') || message.includes('connection') ||
        code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return 'network';
    }

    return 'processing';
  }

  /**
   * Determine error status for reporting
   */
  private determineErrorStatus(error: Error): ProcessingError['status'] {
    const code = (error as any).code;
    const message = error.message.toLowerCase();

    if (code === 'RATE_LIMIT_EXCEEDED') return 'rate-limited';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('validation')) return 'validation-failed';
    return 'failed';
  }
}

/**
 * Factory for creating preconfigured batch processors
 */
export class BatchProcessorFactory {
  /**
   * Create processor for high-throughput scenarios
   */
  static forHighThroughput(): BatchRequestProcessor {
    return new BatchRequestProcessor({
      maxConcurrency: 50,
      maxBatchSize: 1000,
      preserveOrder: false,
      rateLimiting: {
        requestsPerSecond: 100,
        requestsPerMinute: 5000,
        requestsPerHour: 100000
      }
    });
  }

  /**
   * Create processor for reliable processing
   */
  static forReliability(): BatchRequestProcessor {
    return new BatchRequestProcessor({
      maxConcurrency: 5,
      maxBatchSize: 50,
      maxRetries: 5,
      preserveOrder: true,
      requestTimeout: 60000,
      rateLimiting: {
        requestsPerSecond: 10,
        requestsPerMinute: 500,
        requestsPerHour: 10000
      }
    });
  }

  /**
   * Create processor for development/testing
   */
  static forDevelopment(): BatchRequestProcessor {
    return new BatchRequestProcessor({
      maxConcurrency: 2,
      maxBatchSize: 10,
      maxRetries: 1,
      requestTimeout: 10000,
      enableMetrics: true,
      rateLimiting: {
        requestsPerSecond: 5,
        requestsPerMinute: 100,
        requestsPerHour: 1000
      }
    });
  }
}