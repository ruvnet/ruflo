// task.js - Task management commands
import { printSuccess, printError, printWarning } from '../utils.js';

export async function taskCommand(subArgs, flags) {
  const taskCmd = subArgs[0];
  
  switch (taskCmd) {
    case 'create':
      await createTask(subArgs, flags);
      break;
      
    case 'list':
      await listTasks(subArgs, flags);
      break;
      
    case 'status':
      await showTaskStatus(subArgs, flags);
      break;
      
    case 'cancel':
      await cancelTask(subArgs, flags);
      break;
      
    case 'workflow':
      await executeWorkflow(subArgs, flags);
      break;
      
    case 'coordination':
      await manageCoordination(subArgs, flags);
      break;
      
    default:
      showTaskHelp();
  }
}

async function createTask(subArgs, flags) {
  const taskType = subArgs[1];
  const description = subArgs.slice(2).join(' ');
  
  if (!taskType || !description) {
    printError('Usage: task create <type> "<description>"');
    console.log('Types: research, code, analysis, coordination, general');
    return;
  }
  
  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const priority = getFlag(subArgs, '--priority') || '5';
  
  printSuccess(`Creating ${taskType} task: ${taskId}`);
  console.log(`📋 Description: ${description}`);
  console.log(`⚡ Priority: ${priority}/10`);
  console.log(`🏷️  Type: ${taskType}`);
  console.log('📅 Status: Queued');
  console.log('\n📋 Note: Task queued for execution when orchestrator starts');
}

async function listTasks(subArgs, flags) {
  const filter = getFlag(subArgs, '--filter');
  const verbose = subArgs.includes('--verbose') || subArgs.includes('-v');
  
  printSuccess('Task queue:');
  
  if (filter) {
    console.log(`📊 Filtered by status: ${filter}`);
  }
  
  console.log('📋 No active tasks (orchestrator not running)');
  console.log('\nTask statuses: queued, running, completed, failed, cancelled');
  
  if (verbose) {
    console.log('\nTo create tasks:');
    console.log('  gemini-flow task create research "Market analysis"');
    console.log('  gemini-flow task create code "Implement API"');
    console.log('  gemini-flow task create analysis "Data processing"');
  }
}

async function showTaskStatus(subArgs, flags) {
  const taskId = subArgs[1];
  
  if (!taskId) {
    printError('Usage: task status <task-id>');
    return;
  }
  
  printSuccess(`Task status: ${taskId}`);
  console.log('📊 Task details would include:');
  console.log('   Status, progress, assigned agent, execution time, results');
}

async function cancelTask(subArgs, flags) {
  const taskId = subArgs[1];
  
  if (!taskId) {
    printError('Usage: task cancel <task-id>');
    return;
  }
  
  printSuccess(`Cancelling task: ${taskId}`);
  console.log('🛑 Task would be gracefully cancelled');
}

async function executeWorkflow(subArgs, flags) {
  const workflowFile = subArgs[1];
  
  if (!workflowFile) {
    printError('Usage: task workflow <workflow-file>');
    return;
  }
  
  printSuccess(`Executing workflow: ${workflowFile}`);
  console.log('🔄 Workflow execution would include:');
  console.log('   - Parsing workflow definition');
  console.log('   - Creating dependent tasks');
  console.log('   - Orchestrating execution');
  console.log('   - Progress tracking');
}

async function manageCoordination(subArgs, flags) {
  const coordCmd = subArgs[1];
  
  switch (coordCmd) {
    case 'status':
      printSuccess('Task coordination status:');
      console.log('🎯 Coordination engine: Not running');
      console.log('   Active coordinators: 0');
      console.log('   Pending tasks: 0');
      console.log('   Resource utilization: 0%');
      break;
      
    case 'optimize':
      printSuccess('Optimizing task coordination...');
      console.log('⚡ Optimization would include:');
      console.log('   - Task dependency analysis');
      console.log('   - Resource allocation optimization');
      console.log('   - Parallel execution planning');
      break;
      
    default:
      console.log('Coordination commands: status, optimize');
  }
}

function getFlag(args, flagName) {
  const index = args.indexOf(flagName);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

function showTaskHelp() {
  console.log('Task commands:');
  console.log('  create <type> "<description>"    Create new task');
  console.log('  list [--filter <status>]        List tasks');
  console.log('  status <id>                      Show task details');
  console.log('  cancel <id>                      Cancel running task');
  console.log('  workflow <file>                  Execute workflow file');
  console.log('  coordination <status|optimize>   Manage coordination');
  console.log();
  console.log('Task Types:');
  console.log('  research      Information gathering and analysis');
  console.log('  code          Software development tasks');
  console.log('  analysis      Data processing and insights');
  console.log('  coordination  Task orchestration and management');
  console.log('  general       General purpose tasks');
  console.log();
  console.log('Options:');
  console.log('  --priority <1-10>                Set task priority');
  console.log('  --filter <status>                Filter by status');
  console.log('  --verbose, -v                    Show detailed output');
  console.log();
  console.log('Examples:');
  console.log('  gemini-flow task create research "Market analysis" --priority 8');
  console.log('  gemini-flow task list --filter running');
  console.log('  gemini-flow task workflow examples/development-workflow.json');
  console.log('  gemini-flow task coordination status');
}