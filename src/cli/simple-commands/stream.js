// stream.js - Stream chaining command for Claude Flow Alpha 85
import process from 'node:process';
import { Logger } from '../../core/logger.js';
import { StreamProcessor, StreamChainUtils } from '../../streaming/stream-processor.js';
import { StreamMessageBuilder, PIPELINE_TEMPLATES, DEFAULT_STREAM_CONFIGS } from '../../streaming/stream-formats.js';

const logger = new Logger(
  { level: 'info', format: 'text', destination: 'console' },
  { component: 'StreamCommand' }
);

let globalStreamProcessor = null;

/**
 * Initialize global stream processor
 */
function getStreamProcessor() {
  if (!globalStreamProcessor) {
    globalStreamProcessor = new StreamProcessor(logger);
    
    // Set up event listeners for monitoring
    globalStreamProcessor.on('connectionCreated', (connection) => {
      console.log(`✅ Stream connection created: ${connection.id}`);
    });
    
    globalStreamProcessor.on('pipelineCreated', (pipeline) => {
      console.log(`🔄 Pipeline created: ${pipeline.id} (${pipeline.stages.size} stages)`);
    });
    
    globalStreamProcessor.on('pipelineCompleted', (pipeline, results) => {
      console.log(`✅ Pipeline completed: ${pipeline.id} → ${results.length} results`);
    });
    
    globalStreamProcessor.on('pipelineFailed', (pipeline, error) => {
      console.error(`❌ Pipeline failed: ${pipeline.id} - ${error.message}`);
    });
  }
  
  return globalStreamProcessor;
}

/**
 * Stream chaining command handler
 */
export async function streamCommand(args, flags) {
  const subcommand = args[0];
  
  if (!subcommand) {
    showStreamHelp();
    return;
  }

  const processor = getStreamProcessor();

  try {
    switch (subcommand) {
      case 'connect':
        await handleConnect(args.slice(1), flags, processor);
        break;
      case 'pipeline':
        await handlePipeline(args.slice(1), flags, processor);
        break;
      case 'template':
        await handleTemplate(args.slice(1), flags, processor);
        break;
      case 'execute':
        await handleExecute(args.slice(1), flags, processor);
        break;
      case 'monitor':
        await handleMonitor(args.slice(1), flags, processor);
        break;
      case 'status':
        await handleStatus(args.slice(1), flags, processor);
        break;
      case 'close':
        await handleClose(args.slice(1), flags, processor);
        break;
      case 'auto-wire':
        await handleAutoWire(args.slice(1), flags, processor);
        break;
      default:
        console.error(`❌ Unknown stream subcommand: ${subcommand}`);
        showStreamHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Stream command failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Handle stream connect command
 */
async function handleConnect(args, flags, processor) {
  if (args.length < 2) {
    console.error('❌ Usage: stream connect <source-agent-id> <target-agent-id> [--format json-stream|text] [--compression gzip|lz4|none]');
    return;
  }

  const [sourceId, targetId] = args;
  const format = flags.format || 'json-stream';
  const compression = flags.compression || 'none';

  const config = {
    ...DEFAULT_STREAM_CONFIGS[format],
    compression,
  };

  const connection = await processor.createConnection(sourceId, targetId, config);
  
  console.log(`✅ Stream connection established:`);
  console.log(`   Connection ID: ${connection.id}`);
  console.log(`   Source: ${sourceId}`);
  console.log(`   Target: ${targetId}`);
  console.log(`   Format: ${format}`);
  console.log(`   Compression: ${compression}`);
}

/**
 * Handle pipeline creation command
 */
async function handlePipeline(args, flags, processor) {
  const action = args[0];
  
  if (!action) {
    console.error('❌ Usage: stream pipeline <create|list> [options]');
    return;
  }

  switch (action) {
    case 'create':
      await handlePipelineCreate(args.slice(1), flags, processor);
      break;
    case 'list':
      await handlePipelineList(args.slice(1), flags, processor);
      break;
    default:
      console.error(`❌ Unknown pipeline action: ${action}`);
  }
}

/**
 * Handle pipeline creation
 */
async function handlePipelineCreate(args, flags, processor) {
  if (args.length < 1) {
    console.error('❌ Usage: stream pipeline create <pipeline-name> [--stages stage1,stage2,...] [--auto-wire] [--parallel N]');
    return;
  }

  const pipelineName = args[0];
  const stages = flags.stages ? flags.stages.split(',') : [];
  const autoWire = flags['auto-wire'] !== false;
  const parallelism = flags.parallel ? parseInt(flags.parallel) : 1;

  if (stages.length === 0) {
    console.error('❌ At least one stage must be specified with --stages');
    return;
  }

  // Create pipeline configuration
  const config = {
    id: `${pipelineName}-${Date.now()}`,
    name: pipelineName,
    description: `Custom pipeline: ${pipelineName}`,
    autoWire,
    parallelism,
    timeout: flags.timeout ? parseInt(flags.timeout) * 1000 : 300000,
    stages: stages.map((stageName, index) => ({
      id: `stage-${index}`,
      name: stageName,
      agentType: flags[`stage-${index}-type`] || 'coder',
      inputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
      outputFormat: DEFAULT_STREAM_CONFIGS['json-stream'],
      dependencies: index === 0 ? [] : [`stage-${index - 1}`],
    })),
  };

  const pipeline = await processor.createPipeline(config);
  
  console.log(`✅ Pipeline created:`);
  console.log(`   Pipeline ID: ${pipeline.id}`);
  console.log(`   Stages: ${pipeline.stages.size}`);
  console.log(`   Auto-wire: ${autoWire}`);
  console.log(`   Parallelism: ${parallelism}`);
}

/**
 * Handle pipeline listing
 */
async function handlePipelineList(args, flags, processor) {
  const metrics = processor.getSystemMetrics();
  
  if (metrics.pipelines.length === 0) {
    console.log('📋 No pipelines found');
    return;
  }

  console.log(`📋 Active Pipelines (${metrics.pipelines.length}):`);
  console.log('');

  for (const pipeline of metrics.pipelines) {
    console.log(`🔄 ${pipeline.id}:`);
    console.log(`   Status: ${pipeline.status}`);
    console.log(`   Stages: ${pipeline.stages}`);
    console.log(`   Connections: ${pipeline.connections}`);
    console.log(`   Messages: ${pipeline.metrics.totalMessages}`);
    console.log(`   Throughput: ${pipeline.metrics.throughput.toFixed(2)} msg/sec`);
    console.log('');
  }
}

/**
 * Handle template commands
 */
async function handleTemplate(args, flags, processor) {
  const action = args[0];
  
  if (!action) {
    console.error('❌ Usage: stream template <list|create|suggest> [options]');
    return;
  }

  switch (action) {
    case 'list':
      handleTemplateList();
      break;
    case 'create':
      await handleTemplateCreate(args.slice(1), flags, processor);
      break;
    case 'suggest':
      await handleTemplateSuggest(args.slice(1), flags);
      break;
    default:
      console.error(`❌ Unknown template action: ${action}`);
  }
}

/**
 * Handle template listing
 */
function handleTemplateList() {
  console.log('📋 Available Pipeline Templates:');
  console.log('');

  for (const [name, template] of Object.entries(PIPELINE_TEMPLATES)) {
    console.log(`🔄 ${name}:`);
    console.log(`   Name: ${template.name}`);
    console.log(`   Description: ${template.description}`);
    console.log(`   Stages: ${template.stages.length}`);
    console.log(`   Auto-wire: ${template.autoWire}`);
    console.log(`   Parallelism: ${template.parallelism || 1}`);
    console.log('');
  }
}

/**
 * Handle template creation from template
 */
async function handleTemplateCreate(args, flags, processor) {
  if (args.length < 1) {
    console.error('❌ Usage: stream template create <template-name> [--name custom-name] [--parallel N]');
    return;
  }

  const templateName = args[0];
  const customName = flags.name;
  const parallelism = flags.parallel ? parseInt(flags.parallel) : undefined;

  const customConfig = {};
  if (customName) customConfig.name = customName;
  if (parallelism) customConfig.parallelism = parallelism;

  const pipeline = await processor.createPipelineFromTemplate(templateName, customConfig);
  
  console.log(`✅ Pipeline created from template '${templateName}':`);
  console.log(`   Pipeline ID: ${pipeline.id}`);
  console.log(`   Name: ${pipeline.config.name}`);
  console.log(`   Stages: ${pipeline.stages.size}`);
  console.log(`   Template: ${templateName}`);
}

/**
 * Handle template suggestion
 */
async function handleTemplateSuggest(args, flags) {
  if (args.length === 0) {
    console.error('❌ Usage: stream template suggest <task-types> [--descriptions "desc1,desc2,desc3"]');
    console.log('❌ Example: stream template suggest coding,review,testing --descriptions "implement feature,review code,run tests"');
    return;
  }

  const taskTypes = args[0].split(',');
  const descriptions = flags.descriptions ? flags.descriptions.split(',') : taskTypes;

  const tasks = taskTypes.map((type, index) => ({
    type: type.trim(),
    description: descriptions[index] || type.trim(),
  }));

  const suggestedTemplate = StreamChainUtils.suggestPipelineTemplate(tasks);
  
  console.log(`🤖 Suggested pipeline template: ${suggestedTemplate}`);
  console.log('');
  
  const template = PIPELINE_TEMPLATES[suggestedTemplate];
  if (template) {
    console.log(`📋 Template details:`);
    console.log(`   Name: ${template.name}`);
    console.log(`   Description: ${template.description}`);
    console.log(`   Stages: ${template.stages.length}`);
    console.log('');
    console.log(`💡 To use this template:`);
    console.log(`   claude-flow stream template create ${suggestedTemplate}`);
  }
}

/**
 * Handle pipeline execution
 */
async function handleExecute(args, flags, processor) {
  if (args.length < 2) {
    console.error('❌ Usage: stream execute <pipeline-id> <input-message> [--format json|text] [--timeout 300]');
    return;
  }

  const pipelineId = args[0];
  const inputText = args[1];
  const format = flags.format || 'json';
  const timeout = flags.timeout ? parseInt(flags.timeout) * 1000 : 300000;

  // Create input message
  let inputMessage;
  if (format === 'json') {
    try {
      const inputData = JSON.parse(inputText);
      inputMessage = StreamMessageBuilder.message('cli', inputData);
    } catch (error) {
      console.error('❌ Invalid JSON input:', error.message);
      return;
    }
  } else {
    inputMessage = StreamMessageBuilder.message('cli', { text: inputText });
  }

  console.log(`🚀 Executing pipeline: ${pipelineId}`);
  console.log(`📥 Input: ${inputText}`);
  console.log('');

  try {
    const results = await processor.executePipeline(pipelineId, inputMessage);
    
    console.log(`✅ Pipeline execution completed:`);
    console.log(`📤 Results (${results.length}):`);
    console.log('');

    results.forEach((result, index) => {
      console.log(`Result ${index + 1}:`);
      if (flags.verbose) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`  Type: ${result.type}`);
        console.log(`  Source: ${result.source}`);
        console.log(`  Data: ${JSON.stringify(result.data)}`);
      }
      console.log('');
    });
  } catch (error) {
    console.error(`❌ Pipeline execution failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
  }
}

/**
 * Handle stream monitoring
 */
async function handleMonitor(args, flags, processor) {
  const interval = flags.interval ? parseInt(flags.interval) * 1000 : 5000;
  const maxUpdates = flags.count ? parseInt(flags.count) : null;
  let updateCount = 0;

  console.log(`📊 Stream monitoring started (updating every ${interval / 1000}s)`);
  console.log('Press Ctrl+C to stop');
  console.log('');

  const monitorInterval = setInterval(() => {
    const metrics = processor.getSystemMetrics();
    
    console.clear();
    console.log(`📊 Stream System Status - ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(60));
    console.log(`Connections: ${metrics.totalConnections} | Pipelines: ${metrics.totalPipelines}`);
    console.log('');

    if (metrics.connections.length > 0) {
      console.log('🔗 Active Connections:');
      metrics.connections.forEach(conn => {
        console.log(`  ${conn.id}: ${conn.metrics.messagesProcessed} msgs, ${conn.metrics.throughput.toFixed(2)} msg/sec`);
      });
      console.log('');
    }

    if (metrics.pipelines.length > 0) {
      console.log('🔄 Pipeline Status:');
      metrics.pipelines.forEach(pipeline => {
        console.log(`  ${pipeline.id}: ${pipeline.status} (${pipeline.metrics.totalMessages} msgs)`);
      });
      console.log('');
    }

    updateCount++;
    if (maxUpdates && updateCount >= maxUpdates) {
      clearInterval(monitorInterval);
      console.log('📊 Monitoring stopped');
    }
  }, interval);

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    clearInterval(monitorInterval);
    console.log('\n📊 Monitoring stopped');
    process.exit(0);
  });
}

/**
 * Handle status display
 */
async function handleStatus(args, flags, processor) {
  const metrics = processor.getSystemMetrics();
  
  console.log('📊 Stream System Status');
  console.log('='.repeat(40));
  console.log(`Total Connections: ${metrics.totalConnections}`);
  console.log(`Total Pipelines: ${metrics.totalPipelines}`);
  console.log(`Timestamp: ${new Date(metrics.timestamp).toLocaleString()}`);
  console.log('');

  if (flags.verbose || args.includes('--verbose')) {
    if (metrics.connections.length > 0) {
      console.log('🔗 Connection Details:');
      metrics.connections.forEach(conn => {
        console.log(`  ${conn.id}:`);
        console.log(`    Source: ${conn.source} → Target: ${conn.target}`);
        console.log(`    Active: ${conn.active}`);
        console.log(`    Messages: ${conn.metrics.messagesProcessed}`);
        console.log(`    Throughput: ${conn.metrics.throughput.toFixed(2)} msg/sec`);
        console.log(`    Errors: ${conn.metrics.errorsCount}`);
        console.log('');
      });
    }

    if (metrics.pipelines.length > 0) {
      console.log('🔄 Pipeline Details:');
      metrics.pipelines.forEach(pipeline => {
        console.log(`  ${pipeline.id}:`);
        console.log(`    Status: ${pipeline.status}`);
        console.log(`    Stages: ${pipeline.stages}`);
        console.log(`    Connections: ${pipeline.connections}`);
        console.log(`    Messages: ${pipeline.metrics.totalMessages}`);
        console.log(`    Throughput: ${pipeline.metrics.throughput.toFixed(2)} msg/sec`);
        console.log(`    Efficiency: ${(pipeline.metrics.efficiency * 100).toFixed(1)}%`);
        console.log('');
      });
    }
  }
}

/**
 * Handle connection/pipeline closing
 */
async function handleClose(args, flags, processor) {
  if (args.length < 2) {
    console.error('❌ Usage: stream close <connection|pipeline> <id>');
    return;
  }

  const [type, id] = args;

  try {
    if (type === 'connection') {
      await processor.closeConnection(id);
      console.log(`✅ Connection closed: ${id}`);
    } else if (type === 'pipeline') {
      await processor.closePipeline(id);
      console.log(`✅ Pipeline closed: ${id}`);
    } else {
      console.error(`❌ Unknown type: ${type}. Use 'connection' or 'pipeline'`);
    }
  } catch (error) {
    console.error(`❌ Failed to close ${type}: ${error.message}`);
  }
}

/**
 * Handle auto-wiring of tasks
 */
async function handleAutoWire(args, flags) {
  if (args.length < 1) {
    console.error('❌ Usage: stream auto-wire <task-descriptions-file.json>');
    console.log('❌ Example: stream auto-wire tasks.json');
    return;
  }

  const filePath = args[0];
  
  try {
    const fs = await import('node:fs/promises');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const tasks = JSON.parse(fileContent);

    if (!Array.isArray(tasks)) {
      console.error('❌ Tasks file must contain an array of task objects');
      return;
    }

    console.log(`🔍 Analyzing ${tasks.length} tasks for dependencies...`);
    
    const dependencies = StreamChainUtils.detectDependencies(tasks);
    const suggestedTemplate = StreamChainUtils.suggestPipelineTemplate(tasks);

    console.log('');
    console.log('🔗 Detected Dependencies:');
    for (const [taskId, deps] of dependencies.entries()) {
      if (deps.length > 0) {
        console.log(`  ${taskId} depends on: ${deps.join(', ')}`);
      } else {
        console.log(`  ${taskId} (no dependencies)`);
      }
    }

    console.log('');
    console.log(`🤖 Suggested template: ${suggestedTemplate}`);
    
    const template = PIPELINE_TEMPLATES[suggestedTemplate];
    if (template) {
      console.log(`📋 Template: ${template.name}`);
      console.log(`   ${template.description}`);
      console.log(`   Stages: ${template.stages.length}`);
    }

    console.log('');
    console.log('💡 Next steps:');
    console.log(`   1. claude-flow stream template create ${suggestedTemplate} --name my-workflow`);
    console.log(`   2. claude-flow stream execute <pipeline-id> '{"tasks": [...]}' --format json`);

  } catch (error) {
    console.error(`❌ Failed to analyze tasks: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
  }
}

/**
 * Show stream command help
 */
function showStreamHelp() {
  console.log(`
🌊 Claude-Flow Stream Chaining (Alpha 85)

USAGE:
  claude-flow stream <subcommand> [options]

🔗 STREAM CONNECTIONS:
  connect <source> <target>           Create direct stream connection
    --format json-stream|text         Stream format (default: json-stream)
    --compression gzip|lz4|none       Compression type (default: none)

🔄 PIPELINE MANAGEMENT:
  pipeline create <name>              Create custom pipeline
    --stages stage1,stage2,...        Pipeline stages
    --auto-wire                       Auto-wire stage dependencies
    --parallel N                      Parallelism level
    --timeout 300                     Timeout in seconds

  pipeline list                       List active pipelines

📋 TEMPLATE OPERATIONS:
  template list                       Show available templates
  template create <template-name>     Create pipeline from template
    --name custom-name                Custom pipeline name
    --parallel N                      Override parallelism

  template suggest <task-types>       Suggest best template
    --descriptions "desc1,desc2"      Task descriptions for analysis

🚀 EXECUTION:
  execute <pipeline-id> <input>       Execute pipeline with input
    --format json|text                Input format (default: json)
    --timeout 300                     Timeout in seconds

📊 MONITORING:
  monitor                             Real-time stream monitoring
    --interval 5                      Update interval in seconds
    --count 10                        Max number of updates

  status                              Show current status
    --verbose                         Detailed information

🔧 UTILITY:
  auto-wire <tasks.json>              Auto-detect task dependencies
  close connection <id>               Close stream connection
  close pipeline <id>                 Close pipeline

🌟 BUILT-IN TEMPLATES:
  • generate-critique-revise          Recursive content improvement
  • analyze-score-synthesize          Multi-phase analysis workflow
  • research-implement-test           Complete development cycle
  • parallel-analysis                 Concurrent multi-agent analysis

📝 EXAMPLES:
  # Create connection between agents
  claude-flow stream connect agent1 agent2 --format json-stream

  # Create pipeline from template
  claude-flow stream template create generate-critique-revise --name content-improver

  # Execute pipeline with JSON input
  claude-flow stream execute gcr-123 '{"text":"Hello world"}' --format json

  # Auto-analyze task dependencies
  claude-flow stream auto-wire my-tasks.json

  # Monitor streams in real-time
  claude-flow stream monitor --interval 3

🎯 Stream chaining enables:
  • Real-time JSON streaming between agents
  • Automatic dependency detection and wiring
  • Structured pipeline workflows
  • Token-level cognitive state flow
  • Multi-agent coordination patterns

📚 Documentation: https://github.com/ruvnet/claude-code-flow/wiki/stream-chaining
`);
}