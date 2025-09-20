/**
 * Update Hierarchical Progress MCP Tool
 * 
 * Provides MCP tool interface for updating progress at any hierarchy level
 * in the AIME hierarchical progress management system.
 * 
 * @module UpdateHierarchicalProgressTool
 */

import { hierarchicalProgress } from './hierarchical-progress-manager.js';

/**
 * MCP Tool Definition for updateHierarchicalProgress
 */
export const updateHierarchicalProgressTool = {
  name: 'updateHierarchicalProgress',
  description: 'Update progress at any level of the AIME mission hierarchy (mission, phase, task, or subtask)',
  inputSchema: {
    type: 'object',
    properties: {
      entityId: {
        type: 'string',
        description: 'The ID of the entity to update (mission, phase, task, or subtask)'
      },
      progress: {
        type: 'number',
        description: 'Progress percentage (0-100)',
        minimum: 0,
        maximum: 100
      },
      level: {
        type: 'string',
        description: 'Hierarchy level (optional - auto-detected if not provided)',
        enum: ['mission', 'phase', 'task', 'subtask', 'auto'],
        default: 'auto'
      },
      metadata: {
        type: 'object',
        description: 'Additional metadata for the progress update',
        properties: {
          milestone: {
            type: 'string',
            description: 'Milestone reached'
          },
          blockers: {
            type: 'array',
            description: 'Current blockers',
            items: { type: 'string' }
          },
          notes: {
            type: 'string',
            description: 'Additional notes'
          }
        }
      },
      updateChildren: {
        type: 'boolean',
        description: 'Whether to update child entities based on this progress',
        default: false
      }
    },
    required: ['entityId', 'progress']
  }
};

/**
 * MCP Tool handler for updateHierarchicalProgress
 */
export async function handleUpdateHierarchicalProgress(args) {
  try {
    const {
      entityId,
      progress,
      level = 'auto',
      metadata = {},
      updateChildren = false
    } = args;
    
    // Validate progress value
    if (typeof progress !== 'number' || progress < 0 || progress > 100) {
      throw new Error('Progress must be a number between 0 and 100');
    }
    
    // Update progress
    const result = await hierarchicalProgress.updateProgress(entityId, progress, level);
    
    // Handle child updates if requested
    if (updateChildren) {
      await updateChildrenProgress(entityId, progress, level);
    }
    
    // Get updated hierarchy view
    const missionId = await findMissionForEntity(entityId, level);
    const hierarchy = missionId ? await hierarchicalProgress.getHierarchy(missionId) : null;
    
    // Emit real-time update event
    if (global.dashboardServer) {
      global.dashboardServer.emitProgressUpdate({
        entityId,
        level: result.level || level,
        progress,
        metadata,
        hierarchy,
        timestamp: Date.now()
      });
    }
    
    return {
      success: true,
      entityId,
      level: result.level || level,
      previousProgress: result.previousProgress,
      currentProgress: progress,
      propagated: result.propagated || false,
      hierarchy: hierarchy ? {
        missionProgress: hierarchy.mission.progress,
        criticalPath: hierarchy.criticalPath,
        summary: generateProgressSummary(hierarchy)
      } : null,
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      entityId: args.entityId,
      timestamp: Date.now()
    };
  }
}

/**
 * Update children entities based on parent progress
 */
async function updateChildrenProgress(entityId, parentProgress, level) {
  try {
    // Determine actual level if auto
    const actualLevel = level === 'auto' 
      ? await hierarchicalProgress.detectEntityLevel(entityId)
      : level;
    
    switch (actualLevel) {
      case 'mission':
        // Update all phases proportionally
        const mission = await hierarchicalProgress.missionLevel.getMission(entityId);
        if (mission && mission.phases) {
          for (const phaseId of mission.phases) {
            await hierarchicalProgress.updateProgress(phaseId, parentProgress, 'phase');
          }
        }
        break;
        
      case 'phase':
        // Update all tasks proportionally
        const phase = await hierarchicalProgress.phaseLevel.getPhase(entityId);
        if (phase && phase.tasks) {
          for (const taskId of phase.tasks) {
            await hierarchicalProgress.updateProgress(taskId, parentProgress, 'task');
          }
        }
        break;
        
      case 'task':
        // Update all subtasks proportionally
        const task = await hierarchicalProgress.taskLevel.getTask(entityId);
        if (task && task.subtasks) {
          for (const subtaskId of task.subtasks) {
            await hierarchicalProgress.updateProgress(subtaskId, parentProgress, 'subtask');
          }
        }
        break;
    }
  } catch (error) {
    console.error('Error updating children progress:', error);
  }
}

/**
 * Find mission ID for any entity
 */
async function findMissionForEntity(entityId, level) {
  try {
    const actualLevel = level === 'auto' 
      ? await hierarchicalProgress.detectEntityLevel(entityId)
      : level;
    
    switch (actualLevel) {
      case 'mission':
        return entityId;
        
      case 'phase':
        return await hierarchicalProgress.phaseLevel.getParentMission(entityId);
        
      case 'task':
        const phaseId = await hierarchicalProgress.taskLevel.getParentPhase(entityId);
        return phaseId ? await hierarchicalProgress.phaseLevel.getParentMission(phaseId) : null;
        
      case 'subtask':
        const taskId = await hierarchicalProgress.subtaskLevel.getParentTask(entityId);
        if (taskId) {
          const parentPhaseId = await hierarchicalProgress.taskLevel.getParentPhase(taskId);
          return parentPhaseId ? await hierarchicalProgress.phaseLevel.getParentMission(parentPhaseId) : null;
        }
        return null;
        
      default:
        return null;
    }
  } catch (error) {
    console.error('Error finding mission for entity:', error);
    return null;
  }
}

/**
 * Generate progress summary from hierarchy
 */
function generateProgressSummary(hierarchy) {
  const stats = {
    totalPhases: hierarchy.phases.length,
    completedPhases: 0,
    totalTasks: 0,
    completedTasks: 0,
    totalSubtasks: 0,
    completedSubtasks: 0,
    criticalPathTasks: 0,
    blockedTasks: 0
  };
  
  // Count entities
  hierarchy.phases.forEach(phase => {
    if (phase.progress >= 100) stats.completedPhases++;
    
    stats.totalTasks += phase.tasks?.length || 0;
    phase.tasks?.forEach(task => {
      if (task.progress >= 100) stats.completedTasks++;
      if (task.status === 'blocked') stats.blockedTasks++;
      if (hierarchy.criticalPath.includes(task.id)) stats.criticalPathTasks++;
      
      stats.totalSubtasks += task.subtasks?.length || 0;
      task.subtasks?.forEach(subtask => {
        if (subtask.progress >= 100) stats.completedSubtasks++;
      });
    });
  });
  
  return {
    overallProgress: hierarchy.mission.progress,
    phaseCompletion: stats.totalPhases > 0 
      ? Math.round((stats.completedPhases / stats.totalPhases) * 100) 
      : 0,
    taskCompletion: stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0,
    criticalPathStatus: stats.criticalPathTasks > 0
      ? `${stats.criticalPathTasks} tasks on critical path`
      : 'No critical path defined',
    blockers: stats.blockedTasks > 0
      ? `${stats.blockedTasks} tasks blocked`
      : 'No blockers',
    stats
  };
}

/**
 * Additional MCP tools for hierarchy management
 */

/**
 * Get hierarchy view tool
 */
export const getHierarchyTool = {
  name: 'getHierarchy',
  description: 'Get complete hierarchy view for a mission',
  inputSchema: {
    type: 'object',
    properties: {
      missionId: {
        type: 'string',
        description: 'Mission ID to get hierarchy for'
      },
      includeDependencies: {
        type: 'boolean',
        description: 'Include dependency graph',
        default: false
      }
    },
    required: ['missionId']
  }
};

export async function handleGetHierarchy(args) {
  try {
    const hierarchy = await hierarchicalProgress.getHierarchy(
      args.missionId,
      { includeDependencies: args.includeDependencies }
    );
    
    return {
      success: true,
      hierarchy,
      summary: generateProgressSummary(hierarchy),
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      missionId: args.missionId,
      timestamp: Date.now()
    };
  }
}

/**
 * Get critical path tool
 */
export const getCriticalPathTool = {
  name: 'getCriticalPath',
  description: 'Calculate and get critical path for a mission',
  inputSchema: {
    type: 'object',
    properties: {
      missionId: {
        type: 'string',
        description: 'Mission ID to calculate critical path for'
      }
    },
    required: ['missionId']
  }
};

export async function handleGetCriticalPath(args) {
  try {
    const criticalPath = await hierarchicalProgress.updateCriticalPath(args.missionId);
    
    return {
      success: true,
      missionId: args.missionId,
      criticalPath: criticalPath.nodes,
      duration: criticalPath.duration,
      metadata: criticalPath.metadata,
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      missionId: args.missionId,
      timestamp: Date.now()
    };
  }
}

/**
 * Get coordination protocol tool
 */
export const getCoordinationProtocolTool = {
  name: 'getCoordinationProtocol',
  description: 'Get real-time coordination protocol for a mission',
  inputSchema: {
    type: 'object',
    properties: {
      missionId: {
        type: 'string',
        description: 'Mission ID to get coordination protocol for'
      }
    },
    required: ['missionId']
  }
};

export async function handleGetCoordinationProtocol(args) {
  try {
    const protocol = await hierarchicalProgress.getCoordinationProtocol(args.missionId);
    
    return {
      success: true,
      missionId: args.missionId,
      protocol,
      timestamp: Date.now()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      missionId: args.missionId,
      timestamp: Date.now()
    };
  }
}