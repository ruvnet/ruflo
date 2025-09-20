#!/usr/bin/env node
/**
 * Stream Chaining Demo for Claude Flow Alpha 85
 * Demonstrates real-time JSON streaming and pipeline automation
 */

import { StreamProcessor, StreamChainUtils } from '../src/streaming/stream-processor.js';
import { StreamMessageBuilder, PIPELINE_TEMPLATES } from '../src/streaming/stream-formats.js';
import { Logger } from '../src/core/logger.js';

const logger = new Logger(
  { level: 'info', format: 'text', destination: 'console' },
  { component: 'StreamDemo' }
);

async function demonstrateStreamChaining() {
  console.log('🌊 Claude Flow Alpha 85 - Stream Chaining Demo');
  console.log('='.repeat(50));
  
  const processor = new StreamProcessor(logger);
  
  // Set up event listeners for demonstration
  processor.on('connectionCreated', (connection) => {
    console.log(`✅ Connection created: ${connection.id}`);
  });
  
  processor.on('pipelineCreated', (pipeline) => {
    console.log(`🔄 Pipeline created: ${pipeline.id} (${pipeline.stages.size} stages)`);
  });
  
  processor.on('pipelineCompleted', (pipeline, results) => {
    console.log(`✅ Pipeline completed: ${pipeline.id} → ${results.length} results`);
  });

  try {
    // Demo 1: Direct stream connection
    console.log('\n📡 Demo 1: Direct Stream Connection');
    console.log('-'.repeat(30));
    
    const connection = await processor.createConnection(
      'researcher-agent',
      'analyst-agent',
      {
        format: 'json-stream',
        delimiter: '\n',
        compression: 'none',
        batchSize: 1,
        flushInterval: 0,
      }
    );
    
    // Send test message
    const testMessage = StreamMessageBuilder.message(
      'researcher-agent',
      { query: 'Analyze market trends for AI agents', data: ['trend1', 'trend2', 'trend3'] },
      'analyst-agent'
    );
    
    await processor.sendMessage(connection.id, testMessage);
    console.log(`📤 Sent message: ${testMessage.id}`);

    // Demo 2: Pipeline from template
    console.log('\n🔄 Demo 2: Pipeline from Template');
    console.log('-'.repeat(30));
    
    const pipeline = await processor.createPipelineFromTemplate(
      'generate-critique-revise',
      {
        name: 'Content Improvement Pipeline',
        parallelism: 1,
      }
    );
    
    console.log(`Created pipeline: ${pipeline.id}`);
    console.log(`Template: generate-critique-revise`);
    console.log(`Stages: ${Array.from(pipeline.stages.keys()).join(' → ')}`);

    // Execute pipeline with sample input
    const pipelineInput = StreamMessageBuilder.message(
      'cli',
      {
        content: 'Write a technical blog post about stream processing in AI systems.',
        requirements: ['technical accuracy', 'clear examples', 'engaging tone'],
        targetLength: 1500,
      }
    );
    
    console.log('\n🚀 Executing pipeline...');
    const results = await processor.executePipeline(pipeline.id, pipelineInput);
    
    console.log(`📊 Execution Results:`);
    results.forEach((result, index) => {
      console.log(`  Result ${index + 1}:`);
      console.log(`    Type: ${result.type}`);
      console.log(`    Source: ${result.source}`);
      console.log(`    Timestamp: ${new Date(result.timestamp).toLocaleTimeString()}`);
    });

    // Demo 3: Auto-dependency detection
    console.log('\n🔍 Demo 3: Auto-Dependency Detection');
    console.log('-'.repeat(30));
    
    const sampleTasks = [
      {
        id: 'task1',
        type: 'research',
        description: 'Research user authentication patterns for modern web applications',
      },
      {
        id: 'task2', 
        type: 'coding',
        description: 'Implement JWT-based authentication system based on research findings',
      },
      {
        id: 'task3',
        type: 'testing',
        description: 'Create comprehensive tests for the authentication implementation',
      },
      {
        id: 'task4',
        type: 'review',
        description: 'Security review of authentication implementation and tests',
      },
    ];

    const dependencies = StreamChainUtils.detectDependencies(sampleTasks);
    const suggestedTemplate = StreamChainUtils.suggestPipelineTemplate(sampleTasks);
    
    console.log('🔗 Detected Dependencies:');
    for (const [taskId, deps] of dependencies.entries()) {
      if (deps.length > 0) {
        console.log(`  ${taskId} depends on: ${deps.join(', ')}`);
      } else {
        console.log(`  ${taskId} (entry point)`);
      }
    }
    
    console.log(`\n🤖 Suggested template: ${suggestedTemplate}`);
    const template = PIPELINE_TEMPLATES[suggestedTemplate];
    if (template) {
      console.log(`   Name: ${template.name}`);
      console.log(`   Description: ${template.description}`);
      console.log(`   Stages: ${template.stages.length}`);
    }

    // Demo 4: Parallel processing
    console.log('\n⚡ Demo 4: Parallel Analysis Pipeline');
    console.log('-'.repeat(30));
    
    const parallelPipeline = await processor.createPipelineFromTemplate(
      'parallel-analysis',
      {
        name: 'Multi-Agent Code Analysis',
        parallelism: 4,
      }
    );
    
    const codeInput = StreamMessageBuilder.message(
      'cli',
      {
        codebase: '/path/to/sample/codebase',
        language: 'typescript',
        frameworks: ['react', 'express', 'jest'],
        analysisScope: ['security', 'performance', 'quality', 'architecture'],
      }
    );
    
    console.log('🔄 Running parallel analysis...');
    const analysisResults = await processor.executePipeline(parallelPipeline.id, codeInput);
    
    console.log(`📈 Analysis Results (${analysisResults.length} analyses):`);
    analysisResults.forEach((result, index) => {
      console.log(`  Analysis ${index + 1}: ${result.source} → ${result.type}`);
    });

    // Demo 5: Real-time monitoring
    console.log('\n📊 Demo 5: System Metrics');
    console.log('-'.repeat(30));
    
    const metrics = processor.getSystemMetrics();
    console.log(`Total Connections: ${metrics.totalConnections}`);
    console.log(`Total Pipelines: ${metrics.totalPipelines}`);
    console.log('');
    
    if (metrics.connections.length > 0) {
      console.log('🔗 Connection Status:');
      metrics.connections.forEach(conn => {
        console.log(`  ${conn.id}: ${conn.metrics.messagesProcessed} msgs processed`);
      });
    }
    
    if (metrics.pipelines.length > 0) {
      console.log('\n🔄 Pipeline Status:');
      metrics.pipelines.forEach(p => {
        console.log(`  ${p.id}: ${p.status} (${p.metrics.totalMessages} msgs)`);
      });
    }

    console.log('\n✅ Stream chaining demo completed successfully!');
    console.log('\n💡 Key Features Demonstrated:');
    console.log('   • Real-time JSON streaming between agents');
    console.log('   • Automatic pipeline creation from templates');
    console.log('   • Dependency detection and auto-wiring');
    console.log('   • Parallel multi-agent processing');
    console.log('   • Real-time metrics and monitoring');
    console.log('   • Structured message format with metadata');

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
  } finally {
    // Cleanup
    await processor.cleanup();
    console.log('\n🧹 Cleanup completed');
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateStreamChaining().catch(error => {
    console.error('❌ Demo error:', error.message);
    process.exit(1);
  });
}

export { demonstrateStreamChaining };