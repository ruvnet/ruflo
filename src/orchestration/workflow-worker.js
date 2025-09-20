/**
 * Workflow Worker - Real parallel execution in worker threads
 * 
 * Executes workflow tasks in isolated worker thread context
 */

import { parentPort } from 'worker_threads';
import vm from 'vm';
import { performance } from 'perf_hooks';

// Built-in task handlers
const builtInHandlers = {
  /**
   * Execute JavaScript code
   */
  javascript: async (params, context) => {
    const { code, timeout = 30000 } = params;
    
    const sandbox = {
      console,
      context,
      require,
      process: {
        env: process.env,
        version: process.version
      },
      setTimeout,
      setInterval,
      clearTimeout,
      clearInterval,
      Promise,
      Date,
      JSON,
      Math,
      Object,
      Array,
      String,
      Number,
      Boolean,
      RegExp,
      Error
    };
    
    const script = new vm.Script(code);
    const vmContext = vm.createContext(sandbox);
    
    return script.runInContext(vmContext, { timeout });
  },
  
  /**
   * HTTP request task
   */
  http: async (params, context) => {
    const { url, method = 'GET', headers = {}, body, timeout = 30000 } = params;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers),
        data
      };
      
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  },
  
  /**
   * Data transformation task
   */
  transform: async (params, context, previousResults) => {
    const { input, operations } = params;
    
    let data = input || previousResults;
    
    for (const operation of operations) {
      switch (operation.type) {
        case 'map':
          data = data.map(item => eval(`(${operation.fn})`)(item));
          break;
          
        case 'filter':
          data = data.filter(item => eval(`(${operation.fn})`)(item));
          break;
          
        case 'reduce':
          data = data.reduce(eval(`(${operation.fn})`), operation.initial);
          break;
          
        case 'sort':
          data = data.sort(eval(`(${operation.fn})`));
          break;
          
        case 'aggregate':
          data = aggregateData(data, operation.config);
          break;
          
        default:
          throw new Error(`Unknown transform operation: ${operation.type}`);
      }
    }
    
    return data;
  },
  
  /**
   * Parallel batch processing
   */
  batch: async (params, context, previousResults) => {
    const { items, processor, batchSize = 10, concurrency = 3 } = params;
    
    const results = [];
    const batches = [];
    
    // Create batches
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    
    // Process batches with concurrency limit
    for (let i = 0; i < batches.length; i += concurrency) {
      const batchPromises = batches
        .slice(i, i + concurrency)
        .map(batch => processBatch(batch, processor, context));
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.flat());
    }
    
    return results;
  },
  
  /**
   * Conditional logic task
   */
  conditional: async (params, context, previousResults) => {
    const { condition, trueBranch, falseBranch } = params;
    
    const evalCondition = eval(`(${condition})`);
    const result = evalCondition(context, previousResults);
    
    if (result) {
      return executeBranch(trueBranch, context, previousResults);
    } else if (falseBranch) {
      return executeBranch(falseBranch, context, previousResults);
    }
    
    return null;
  },
  
  /**
   * Loop task
   */
  loop: async (params, context, previousResults) => {
    const { items, iterator, accumulator = [] } = params;
    
    const results = accumulator;
    
    for (const item of items) {
      const result = await executeIterator(iterator, item, context, results);
      results.push(result);
    }
    
    return results;
  },
  
  /**
   * Aggregation task
   */
  aggregate: async (params, context, previousResults) => {
    const { data, groupBy, operations } = params;
    
    const input = data || previousResults;
    return aggregateData(input, { groupBy, operations });
  },
  
  /**
   * Wait/delay task
   */
  wait: async (params) => {
    const { duration = 1000 } = params;
    await new Promise(resolve => setTimeout(resolve, duration));
    return { waited: duration };
  },
  
  /**
   * Validation task
   */
  validate: async (params, context, previousResults) => {
    const { schema, data } = params;
    const input = data || previousResults;
    
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = input[field];
      
      for (const rule of rules) {
        if (!validateRule(value, rule)) {
          errors.push({
            field,
            rule: rule.type,
            message: rule.message || `Validation failed for ${field}`
          });
        }
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Validation failed: ${JSON.stringify(errors)}`);
    }
    
    return { valid: true, data: input };
  }
};

// Helper functions

function aggregateData(data, config) {
  const { groupBy, operations } = config;
  const groups = new Map();
  
  // Group data
  for (const item of data) {
    const key = groupBy ? item[groupBy] : 'all';
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }
  
  // Apply operations
  const results = {};
  
  for (const [key, items] of groups) {
    results[key] = {};
    
    for (const op of operations) {
      switch (op.type) {
        case 'count':
          results[key][op.name || 'count'] = items.length;
          break;
          
        case 'sum':
          results[key][op.name || 'sum'] = items.reduce((acc, item) => 
            acc + (item[op.field] || 0), 0);
          break;
          
        case 'avg':
          const sum = items.reduce((acc, item) => acc + (item[op.field] || 0), 0);
          results[key][op.name || 'avg'] = sum / items.length;
          break;
          
        case 'min':
          results[key][op.name || 'min'] = Math.min(...items.map(item => 
            item[op.field] || Infinity));
          break;
          
        case 'max':
          results[key][op.name || 'max'] = Math.max(...items.map(item => 
            item[op.field] || -Infinity));
          break;
      }
    }
  }
  
  return results;
}

async function processBatch(batch, processor, context) {
  const fn = eval(`(${processor})`);
  return Promise.all(batch.map(item => fn(item, context)));
}

async function executeBranch(branch, context, previousResults) {
  if (typeof branch === 'function') {
    return branch(context, previousResults);
  } else if (typeof branch === 'string') {
    const fn = eval(`(${branch})`);
    return fn(context, previousResults);
  } else if (branch.handler) {
    return executeTask(branch, context, previousResults);
  }
  return branch;
}

async function executeIterator(iterator, item, context, accumulator) {
  if (typeof iterator === 'function') {
    return iterator(item, context, accumulator);
  } else if (typeof iterator === 'string') {
    const fn = eval(`(${iterator})`);
    return fn(item, context, accumulator);
  }
  return item;
}

function validateRule(value, rule) {
  switch (rule.type) {
    case 'required':
      return value !== undefined && value !== null && value !== '';
      
    case 'type':
      return typeof value === rule.expected;
      
    case 'min':
      return value >= rule.value;
      
    case 'max':
      return value <= rule.value;
      
    case 'length':
      return value.length === rule.value;
      
    case 'minLength':
      return value.length >= rule.value;
      
    case 'maxLength':
      return value.length <= rule.value;
      
    case 'pattern':
      return new RegExp(rule.value).test(value);
      
    case 'custom':
      const fn = eval(`(${rule.validator})`);
      return fn(value);
      
    default:
      return true;
  }
}

// Main task execution
async function executeTask(task, context, previousResults) {
  const startTime = performance.now();
  
  try {
    let result;
    
    // Check for built-in handler
    if (builtInHandlers[task.type]) {
      result = await builtInHandlers[task.type](task.params, context, previousResults);
    } 
    // Custom handler
    else if (task.handler) {
      if (typeof task.handler === 'string') {
        // Evaluate string handler
        const fn = eval(`(${task.handler})`);
        result = await fn(task.params, context, previousResults);
      } else {
        // Direct function call
        result = await task.handler(task.params, context, previousResults);
      }
    } else {
      throw new Error(`No handler found for task type: ${task.type}`);
    }
    
    const duration = performance.now() - startTime;
    
    return {
      success: true,
      result,
      duration,
      taskId: task.id,
      taskName: task.name
    };
    
  } catch (error) {
    const duration = performance.now() - startTime;
    
    return {
      success: false,
      error: error.message,
      stack: error.stack,
      duration,
      taskId: task.id,
      taskName: task.name
    };
  }
}

// Worker message handler
parentPort.on('message', async (message) => {
  const { type, executionId, task, context, previousResults } = message;
  
  if (type === 'execute-task') {
    try {
      const result = await executeTask(task, context, previousResults);
      
      parentPort.postMessage({
        type: 'task-result',
        executionId,
        result
      });
      
    } catch (error) {
      parentPort.postMessage({
        type: 'task-error',
        executionId,
        error: error.message
      });
    }
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Worker uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Worker unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});