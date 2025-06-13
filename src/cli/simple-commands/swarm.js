#!/usr/bin/env -S deno run --allow-all
/**
 * Swarm command wrapper for simple CLI
 */

export async function swarmCommand(args, flags) {
  try {
    // Import the swarm action - try .js first (for npm/dist), then .ts (for dev)
    let swarmAction;
    try {
      const module = await import('../commands/swarm-new.js');
      swarmAction = module.swarmAction;
    } catch (jsError) {
      // Fallback to .ts for development environment
      try {
        const module = await import('../commands/swarm-new.ts');
        swarmAction = module.swarmAction;
      } catch (tsError) {
        throw jsError; // Throw .js error if both fail
      }
    }
    
    // Create command context compatible with TypeScript version
    const ctx = {
      args: args || [],
      flags: flags || {},
      command: 'swarm'
    };
    
    await swarmAction(ctx);
  } catch (error) {
    console.error('Swarm command error:', error);
    
    // Fallback to comprehensive help if there's an import error
    console.log(`
🐝 Claude Flow Advanced Swarm System

USAGE:
  claude-flow swarm <objective> [options]

EXAMPLES:
  claude-flow swarm "Build a REST API" --strategy development
  claude-flow swarm "Research cloud architecture" --strategy research --ui
  claude-flow swarm "Analyze data trends" --strategy analysis --parallel
  claude-flow swarm "Optimize performance" --distributed --monitor

STRATEGIES:
  auto           Automatically determine best approach (default)
  research       Research and information gathering
  development    Software development and coding
  analysis       Data analysis and insights
  testing        Testing and quality assurance
  optimization   Performance optimization
  maintenance    System maintenance

MODES:
  centralized    Single coordinator (default)
  distributed    Multiple coordinators
  hierarchical   Tree structure coordination
  mesh           Peer-to-peer coordination
  hybrid         Mixed coordination strategies

KEY FEATURES:
  🤖 Intelligent agent management with specialized types
  ⚡ Timeout-free background task execution
  🧠 Distributed memory sharing between agents
  🔄 Work stealing and advanced load balancing
  🛡️  Circuit breaker patterns for fault tolerance
  📊 Real-time monitoring and comprehensive metrics
  🎛️  Multiple coordination strategies and algorithms
  💾 Persistent state with backup and recovery
  🔒 Security features with encryption options
  🖥️  Interactive terminal UI for management

OPTIONS:
  --strategy <type>          Execution strategy (default: auto)
  --mode <type>              Coordination mode (default: centralized)
  --max-agents <n>           Maximum agents (default: 5)
  --timeout <minutes>        Timeout in minutes (default: 60)
  --parallel                 Enable parallel execution
  --distributed              Enable distributed coordination
  --monitor                  Enable real-time monitoring
  --ui                       Launch terminal UI interface
  --background               Run in background mode
  --review                   Enable peer review
  --testing                  Enable automated testing
  --encryption               Enable encryption
  --verbose                  Enable detailed logging
  --dry-run                  Show configuration without executing

ADVANCED OPTIONS:
  --quality-threshold <n>    Quality threshold 0-1 (default: 0.8)
  --memory-namespace <name>  Memory namespace (default: swarm)
  --agent-selection <type>   Agent selection strategy
  --task-scheduling <type>   Task scheduling algorithm
  --load-balancing <type>    Load balancing method
  --fault-tolerance <type>   Fault tolerance strategy

For complete documentation and examples:
https://github.com/ruvnet/claude-code-flow/docs/swarm.md
`);
  }
}

// Allow direct execution
if (import.meta.main) {
  const args = Deno.args.slice(1); // Skip the command name
  const flags = {};
  
  // Parse basic flags
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const flagName = args[i].substring(2);
      const nextArg = args[i + 1];
      
      if (nextArg && !nextArg.startsWith('--')) {
        flags[flagName] = nextArg;
        i++; // Skip the next argument
      } else {
        flags[flagName] = true;
      }
    }
  }
  
  // Filter out flags from args to get the objective
  const objective = args.filter(arg => !arg.startsWith('--') && 
    !Object.values(flags).includes(arg)).join(' ');
  
  await swarmCommand([objective], flags);
}