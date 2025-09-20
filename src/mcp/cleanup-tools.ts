/**
 * MCP Cleanup Tools for Claude Flow
 * 
 * Provides tools for cleaning up swarms, agents, and managing TTL
 */

import type { MCPTool, MCPContext } from '../utils/types.js';
import type { ILogger } from '../core/logger.js';
import type { AutonomousLifecycleManager } from '../agents/autonomous-lifecycle-manager.js';
import type { HiveMindSessionManager } from '../cli/simple-commands/hive-mind/session-manager.js';

export interface CleanupToolContext extends MCPContext {
  swarmCoordinator?: any;
  agentManager?: any;
  lifecycleManager?: AutonomousLifecycleManager;
  sessionManager?: HiveMindSessionManager;
}

export function createCleanupTools(logger: ILogger): MCPTool[] {
  return [
    {
      name: 'swarm_cleanup',
      description: 'Clean up entire swarm and all its agents. Terminates all processes and releases resources.',
      inputSchema: {
        type: 'object',
        properties: {
          swarmId: {
            type: 'string',
            description: 'Swarm ID to clean up (optional, defaults to current swarm)'
          },
          force: {
            type: 'boolean',
            description: 'Force cleanup even if agents are busy',
            default: false
          },
          gracePeriod: {
            type: 'number',
            description: 'Grace period in milliseconds before force termination',
            default: 5000
          }
        }
      },
      handler: async (input: any, context?: CleanupToolContext) => {
        const { swarmId, force, gracePeriod } = input;
        const targetSwarmId = swarmId || process.env['CLAUDE_SWARM_ID'] || 'default-swarm';

        logger.info('Starting swarm cleanup', { swarmId: targetSwarmId, force });

        try {
          const results = {
            swarmId: targetSwarmId,
            agentsTerminated: 0,
            resourcesReleased: 0,
            errors: [] as string[],
            startTime: Date.now()
          };

          // Stop all agents in the swarm
          if (context?.agentManager) {
            try {
              const agents = await context.agentManager.getAllAgents();
              const swarmAgents = agents.filter((agent: any) => 
                agent.swarmId === targetSwarmId || !agent.swarmId
              );

              for (const agent of swarmAgents) {
                try {
                  if (force || agent.status !== 'busy') {
                    await context.agentManager.terminateAgent(agent.id, gracePeriod);
                    results.agentsTerminated++;
                  }
                } catch (error) {
                  const errorMsg = `Failed to terminate agent ${agent.id}: ${error}`;
                  logger.error(errorMsg);
                  results.errors.push(errorMsg);
                }
              }
            } catch (error) {
              logger.error('Failed to get agents for cleanup', error);
              results.errors.push(`Agent cleanup failed: ${error}`);
            }
          }

          // Clean up swarm coordinator
          if (context?.swarmCoordinator) {
            try {
              await context.swarmCoordinator.cleanup(targetSwarmId);
              results.resourcesReleased++;
            } catch (error) {
              logger.error('Failed to cleanup swarm coordinator', error);
              results.errors.push(`Swarm coordinator cleanup failed: ${error}`);
            }
          }

          // Clean up lifecycle manager
          if (context?.lifecycleManager) {
            try {
              const cleanedCount = await context.lifecycleManager.cleanupExpiredAgents();
              results.agentsTerminated += cleanedCount;
            } catch (error) {
              logger.error('Failed to cleanup lifecycle manager', error);
              results.errors.push(`Lifecycle cleanup failed: ${error}`);
            }
          }

          // Clean up session manager
          if (context?.sessionManager) {
            try {
              const orphanedCount = context.sessionManager.cleanupOrphanedProcesses();
              results.resourcesReleased += orphanedCount;
            } catch (error) {
              logger.error('Failed to cleanup session manager', error);
              results.errors.push(`Session cleanup failed: ${error}`);
            }
          }

          const duration = Date.now() - results.startTime;
          
          return {
            success: results.errors.length === 0,
            ...results,
            duration: `${duration}ms`,
            message: `Cleaned up swarm ${targetSwarmId}: ${results.agentsTerminated} agents terminated, ${results.resourcesReleased} resources released`
          };
        } catch (error) {
          logger.error('Swarm cleanup failed', error);
          throw error;
        }
      }
    },

    {
      name: 'agent_terminate',
      description: 'Gracefully terminate a specific agent with TTL enforcement',
      inputSchema: {
        type: 'object',
        properties: {
          agentId: {
            type: 'string',
            description: 'ID of the agent to terminate'
          },
          reason: {
            type: 'string',
            description: 'Reason for termination',
            default: 'Manual termination'
          },
          force: {
            type: 'boolean',
            description: 'Force immediate termination without grace period',
            default: false
          },
          gracePeriod: {
            type: 'number',
            description: 'Grace period in milliseconds',
            default: 5000
          }
        },
        required: ['agentId']
      },
      handler: async (input: any, context?: CleanupToolContext) => {
        const { agentId, reason, force, gracePeriod } = input;

        logger.info('Terminating agent', { agentId, reason, force });

        try {
          const results = {
            agentId,
            reason,
            terminated: false,
            tasksSaved: 0,
            statePreserved: false,
            duration: 0
          };

          const startTime = Date.now();

          if (context?.agentManager) {
            // Get agent details
            const agent = await context.agentManager.getAgent(agentId);
            if (!agent) {
              throw new Error(`Agent ${agentId} not found`);
            }

            // Save agent state if not forcing
            if (!force && agent.state) {
              try {
                await context.agentManager.saveAgentState(agentId, agent.state);
                results.statePreserved = true;
              } catch (error) {
                logger.error('Failed to save agent state', error);
              }
            }

            // Transfer incomplete tasks if possible
            if (!force && agent.tasks && agent.tasks.length > 0) {
              const incompleteTasks = agent.tasks.filter((task: any) => 
                task.status !== 'completed' && task.status !== 'failed'
              );
              
              for (const task of incompleteTasks) {
                try {
                  await context.agentManager.transferTask(task, agentId, null);
                  results.tasksSaved++;
                } catch (error) {
                  logger.error('Failed to transfer task', error);
                }
              }
            }

            // Terminate the agent
            if (force) {
              await context.agentManager.forceTerminateAgent(agentId);
            } else {
              await context.agentManager.terminateAgent(agentId, gracePeriod);
            }
            
            results.terminated = true;
          }

          // Update lifecycle manager
          if (context?.lifecycleManager) {
            try {
              await context.lifecycleManager.retireAgent(agentId, reason);
            } catch (error) {
              logger.error('Failed to update lifecycle manager', error);
            }
          }

          results.duration = Date.now() - startTime;

          return {
            success: true,
            ...results,
            message: `Agent ${agentId} terminated successfully. ${results.tasksSaved} tasks saved, state ${results.statePreserved ? 'preserved' : 'not preserved'}`
          };
        } catch (error) {
          logger.error('Agent termination failed', error);
          throw error;
        }
      }
    },

    {
      name: 'swarm_set_ttl',
      description: 'Configure time-to-live (TTL) for swarms and agents',
      inputSchema: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['swarm', 'agent', 'global'],
            description: 'Scope of TTL configuration'
          },
          targetId: {
            type: 'string',
            description: 'ID of swarm or agent (not needed for global)'
          },
          ttl: {
            type: 'number',
            description: 'TTL in milliseconds (0 to disable)',
            minimum: 0
          },
          autoRetire: {
            type: 'boolean',
            description: 'Enable automatic retirement when TTL expires',
            default: true
          },
          inheritFromParent: {
            type: 'boolean',
            description: 'Whether child agents inherit TTL from parent',
            default: true
          }
        },
        required: ['scope', 'ttl']
      },
      handler: async (input: any, context?: CleanupToolContext) => {
        const { scope, targetId, ttl, autoRetire, inheritFromParent } = input;

        logger.info('Setting TTL configuration', { scope, targetId, ttl });

        try {
          const results = {
            scope,
            targetId,
            previousTTL: null as number | null,
            newTTL: ttl,
            autoRetire,
            affectedCount: 0
          };

          if (context?.lifecycleManager) {
            const config = context.lifecycleManager.getConfig();
            
            switch (scope) {
              case 'global':
                // Update global TTL configuration
                results.previousTTL = config.agentTTL;
                await context.lifecycleManager.updateConfig({
                  agentTTL: ttl,
                  autoRetire,
                  inheritTTL: inheritFromParent
                });
                results.affectedCount = await context.agentManager?.getAllAgents()?.length || 0;
                break;

              case 'swarm':
                if (!targetId) {
                  throw new Error('targetId required for swarm scope');
                }
                // Update swarm-specific TTL
                if (context?.swarmCoordinator) {
                  await context.swarmCoordinator.setSwarmTTL(targetId, ttl, autoRetire);
                  const agents = await context.agentManager?.getAllAgents() || [];
                  results.affectedCount = agents.filter((a: any) => a.swarmId === targetId).length;
                }
                break;

              case 'agent':
                if (!targetId) {
                  throw new Error('targetId required for agent scope');
                }
                // Update agent-specific TTL
                if (context?.agentManager) {
                  const agent = await context.agentManager.getAgent(targetId);
                  if (!agent) {
                    throw new Error(`Agent ${targetId} not found`);
                  }
                  results.previousTTL = agent.ttl || config.agentTTL;
                  await context.agentManager.setAgentTTL(targetId, ttl, autoRetire);
                  results.affectedCount = 1;
                }
                break;
            }

            // Schedule cleanup if needed
            if (ttl > 0 && autoRetire) {
              context.lifecycleManager.scheduleCleanup();
            }
          } else {
            throw new Error('Lifecycle manager not available');
          }

          return {
            success: true,
            ...results,
            message: `TTL configuration updated for ${scope}${targetId ? ` ${targetId}` : ''}: ${ttl}ms TTL, auto-retire ${autoRetire ? 'enabled' : 'disabled'}, ${results.affectedCount} entities affected`
          };
        } catch (error) {
          logger.error('TTL configuration failed', error);
          throw error;
        }
      }
    },

    {
      name: 'swarm_get_cleanup_status',
      description: 'Get current cleanup and TTL status for swarms and agents',
      inputSchema: {
        type: 'object',
        properties: {
          includeAgents: {
            type: 'boolean',
            description: 'Include detailed agent status',
            default: false
          }
        }
      },
      handler: async (input: any, context?: CleanupToolContext) => {
        const { includeAgents } = input;

        try {
          const status: any = {
            timestamp: new Date(),
            lifecycle: {},
            swarms: {},
            agents: {},
            orphanedProcesses: 0
          };

          // Get lifecycle configuration
          if (context?.lifecycleManager) {
            const config = context.lifecycleManager.getConfig();
            status.lifecycle = {
              globalTTL: config.agentTTL,
              autoRetire: config.autoRetire,
              maxAgents: config.maxAgents,
              cleanupInterval: config.cleanupInterval || 60000
            };
          }

          // Get swarm status
          if (context?.swarmCoordinator) {
            const swarmStatus = await context.swarmCoordinator.getSwarmStatus();
            status.swarms = {
              active: swarmStatus.activeSwarms || 0,
              total: swarmStatus.totalSwarms || 0
            };
          }

          // Get agent status
          if (context?.agentManager) {
            const agents = await context.agentManager.getAllAgents();
            const now = Date.now();
            
            status.agents = {
              total: agents.length,
              active: agents.filter((a: any) => a.status === 'active').length,
              expired: agents.filter((a: any) => {
                const ttl = a.ttl || context?.lifecycleManager?.getConfig().agentTTL || 3600000;
                return now - a.createdAt > ttl;
              }).length
            };

            if (includeAgents) {
              status.agents.details = agents.map((agent: any) => {
                const ttl = agent.ttl || context?.lifecycleManager?.getConfig().agentTTL || 3600000;
                const age = now - agent.createdAt;
                const remaining = Math.max(0, ttl - age);
                
                return {
                  id: agent.id,
                  type: agent.type,
                  status: agent.status,
                  age: `${Math.floor(age / 1000)}s`,
                  ttl: `${Math.floor(ttl / 1000)}s`,
                  remaining: `${Math.floor(remaining / 1000)}s`,
                  expired: age > ttl
                };
              });
            }
          }

          // Check for orphaned processes
          if (context?.sessionManager) {
            status.orphanedProcesses = context.sessionManager.getOrphanedProcessCount();
          }

          return {
            success: true,
            status,
            recommendations: generateCleanupRecommendations(status)
          };
        } catch (error) {
          logger.error('Failed to get cleanup status', error);
          throw error;
        }
      }
    }
  ];
}

function generateCleanupRecommendations(status: any): string[] {
  const recommendations: string[] = [];

  if (status.agents.expired > 0) {
    recommendations.push(`${status.agents.expired} agents have exceeded their TTL and should be cleaned up`);
  }

  if (status.orphanedProcesses > 0) {
    recommendations.push(`${status.orphanedProcesses} orphaned processes detected - run swarm_cleanup`);
  }

  if (status.agents.total > 50) {
    recommendations.push('High agent count detected - consider reducing maxAgents or decreasing TTL');
  }

  if (!status.lifecycle.autoRetire) {
    recommendations.push('Auto-retire is disabled - manual cleanup will be required');
  }

  return recommendations;
}