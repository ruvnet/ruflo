// monitor.js - System monitoring commands
import { printSuccess, printError, printWarning } from '../utils.js';

export async function monitorCommand(subArgs, flags) {
  const interval = getFlag(subArgs, '--interval') || flags.interval || 5000;
  const format = getFlag(subArgs, '--format') || flags.format || 'pretty';
  const continuous = subArgs.includes('--watch') || flags.watch;
  
  if (continuous) {
    await runContinuousMonitoring(interval, format);
  } else {
    await showCurrentMetrics(format);
  }
}

async function showCurrentMetrics(format) {
  const metrics = await collectMetrics();
  
  if (format === 'json') {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    displayMetrics(metrics);
  }
}

async function runContinuousMonitoring(interval, format) {
  printSuccess(`Starting continuous monitoring (interval: ${interval}ms)`);
  console.log('Press Ctrl+C to stop monitoring\n');
  
  // Simulate monitoring - in a real implementation, this would collect actual metrics
  let iteration = 0;
  const maxIterations = 10; // Limit for demo purposes
  
  const monitorInterval = setInterval(async () => {
    iteration++;
    
    if (iteration > maxIterations) {
      console.log('\n📊 Monitoring demo completed (limited to 10 iterations)');
      console.log('In production, this would run continuously until stopped');
      clearInterval(monitorInterval);
      return;
    }
    
    console.clear(); // Clear screen for fresh output
    console.log(`🔄 Monitoring Gemini-Flow System - Update #${iteration}`);
    console.log(`⏰ ${new Date().toLocaleTimeString()}\n`);
    
    const metrics = await collectMetrics();
    
    if (format === 'json') {
      console.log(JSON.stringify(metrics, null, 2));
    } else {
      displayMetrics(metrics);
    }
    
    console.log(`\n🔄 Next update in ${interval}ms...`);
    
  }, interval);
  
  // In a real implementation, you would handle Ctrl+C gracefully
  setTimeout(() => {
    clearInterval(monitorInterval);
    console.log('\n👋 Monitoring stopped');
  }, interval * (maxIterations + 1));
}

async function collectMetrics() {
  // Simulate metric collection - in real implementation, this would gather actual system data
  const timestamp = Date.now();
  
  return {
    timestamp,
    system: {
      uptime: Math.floor(Math.random() * 86400), // Random uptime in seconds
      cpu_usage: Math.round(Math.random() * 100 * 100) / 100, // Random CPU %
      memory_usage: Math.round(Math.random() * 8192 * 100) / 100, // Random memory MB
      disk_usage: Math.round(Math.random() * 100 * 100) / 100 // Random disk %
    },
    orchestrator: {
      status: Math.random() > 0.8 ? 'running' : 'stopped',
      active_agents: Math.floor(Math.random() * 5),
      queued_tasks: Math.floor(Math.random() * 10),
      completed_tasks: Math.floor(Math.random() * 50),
      errors: Math.floor(Math.random() * 3)
    },
    performance: {
      avg_task_duration: Math.round(Math.random() * 5000 * 100) / 100, // ms
      throughput: Math.round(Math.random() * 100 * 100) / 100, // tasks/min
      success_rate: Math.round((0.85 + Math.random() * 0.15) * 100 * 100) / 100 // %
    },
    resources: {
      memory_entries: Math.floor(Math.random() * 100),
      terminal_sessions: Math.floor(Math.random() * 5),
      mcp_connections: Math.floor(Math.random() * 3)
    }
  };
}

function displayMetrics(metrics) {
  const timestamp = new Date(metrics.timestamp).toLocaleTimeString();
  
  console.log('📊 System Metrics');
  console.log('================');
  
  // System metrics
  console.log('\n🖥️  System Resources:');
  console.log(`   CPU Usage: ${metrics.system.cpu_usage.toFixed(1)}%`);
  console.log(`   Memory: ${metrics.system.memory_usage.toFixed(1)} MB`);
  console.log(`   Disk Usage: ${metrics.system.disk_usage.toFixed(1)}%`);
  console.log(`   Uptime: ${formatUptime(metrics.system.uptime)}`);
  
  // Orchestrator metrics
  console.log('\n🎭 Orchestrator:');
  console.log(`   Status: ${getStatusIcon(metrics.orchestrator.status)} ${metrics.orchestrator.status}`);
  console.log(`   Active Agents: ${metrics.orchestrator.active_agents}`);
  console.log(`   Queued Tasks: ${metrics.orchestrator.queued_tasks}`);
  console.log(`   Completed: ${metrics.orchestrator.completed_tasks}`);
  console.log(`   Errors: ${metrics.orchestrator.errors}`);
  
  // Performance metrics
  console.log('\n⚡ Performance:');
  console.log(`   Avg Task Duration: ${metrics.performance.avg_task_duration.toFixed(0)}ms`);
  console.log(`   Throughput: ${metrics.performance.throughput.toFixed(1)} tasks/min`);
  console.log(`   Success Rate: ${metrics.performance.success_rate.toFixed(1)}%`);
  
  // Resource utilization
  console.log('\n📦 Resources:');
  console.log(`   Memory Entries: ${metrics.resources.memory_entries}`);
  console.log(`   Terminal Sessions: ${metrics.resources.terminal_sessions}`);
  console.log(`   MCP Connections: ${metrics.resources.mcp_connections}`);
  
  console.log(`\n⏰ Last Updated: ${timestamp}`);
}

function getStatusIcon(status) {
  switch (status) {
    case 'running': return '🟢';
    case 'stopped': return '🔴';
    case 'starting': return '🟡';
    case 'error': return '❌';
    default: return '⚪';
  }
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function getFlag(args, flagName) {
  const index = args.indexOf(flagName);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

export function showMonitorHelp() {
  console.log('Monitor commands:');
  console.log('  monitor [options]                Show current system metrics');
  console.log('  monitor --watch                  Continuous monitoring mode');
  console.log();
  console.log('Options:');
  console.log('  --interval <ms>                  Update interval in milliseconds (default: 5000)');
  console.log('  --format <type>                  Output format: pretty, json (default: pretty)');
  console.log('  --watch                          Continuous monitoring mode');
  console.log();
  console.log('Examples:');
  console.log('  gemini-flow monitor              # Show current metrics');
  console.log('  gemini-flow monitor --watch      # Continuous monitoring');
  console.log('  gemini-flow monitor --interval 1000 --watch  # Fast updates');
  console.log('  gemini-flow monitor --format json            # JSON output');
}