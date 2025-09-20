/**
 * UpdateProgress Tool for Dynamic Actors
 * Core AIME innovation: Real-time progress reporting during task execution
 * This tool is automatically included in every Dynamic Actor's toolkit
 */

import { ProgressManagementModule } from './progress-management.js';

export class UpdateProgressTool {
  constructor(progressManager, agentId) {
    this.progressManager = progressManager;
    this.agentId = agentId;
    this.toolName = 'UpdateProgress';
    this.description = 'Report real-time progress updates to the mission dashboard';
    this.schema = {
      type: 'function',
      function: {
        name: 'UpdateProgress',
        description: 'Update task progress with status, milestones, obstacles, or completion',
        parameters: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'The ID of the task being updated'
            },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'failed', 'blocked'],
              description: 'Current status of the task'
            },
            message: {
              type: 'string',
              description: 'Descriptive message about the current progress or issue'
            },
            type: {
              type: 'string',
              enum: ['progress', 'milestone', 'obstacle', 'completion'],
              description: 'Type of update being reported'
            },
            progressPercentage: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Percentage completion (0-100)'
            },
            milestone: {
              type: 'string',
              description: 'Name of milestone achieved (if type is milestone)'
            },
            severity: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Severity level for obstacles'
            },
            artifacts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  path: { type: 'string' },
                  url: { type: 'string' },
                  description: { type: 'string' }
                }
              },
              description: 'Files, URLs, or other artifacts produced'
            },
            contextData: {
              type: 'object',
              description: 'Additional context data relevant to the update'
            }
          },
          required: ['taskId', 'message']
        }
      }
    };
  }

  /**
   * Execute the UpdateProgress tool
   * Called autonomously by Dynamic Actors during task execution
   */
  async execute(params) {
    try {
      // Validate parameters
      this.validateParams(params);

      // Create update data structure
      const updateData = {
        type: params.type || 'progress',
        status: params.status,
        message: params.message,
        progressPercentage: params.progressPercentage,
        milestone: params.milestone,
        severity: params.severity,
        artifacts: params.artifacts || [],
        contextData: {
          ...params.contextData,
          agentId: this.agentId,
          timestamp: new Date().toISOString(),
          toolVersion: '1.0.0'
        }
      };

      // Send update to Progress Management Module
      const result = this.progressManager.updateProgress(
        this.agentId,
        params.taskId,
        updateData
      );

      // Log the update for debugging
      this.logUpdate(params.taskId, updateData, result);

      // Return success response for the agent
      return {
        success: true,
        message: `Progress update sent successfully: ${params.message}`,
        taskId: params.taskId,
        updateType: updateData.type,
        timestamp: updateData.contextData.timestamp,
        progressListUpdate: result.markdownUpdate
      };

    } catch (error) {
      console.error(`❌ UpdateProgress tool failed for agent ${this.agentId}:`, error);
      
      return {
        success: false,
        error: error.message,
        message: 'Failed to send progress update',
        taskId: params.taskId || 'unknown'
      };
    }
  }

  /**
   * Validate input parameters
   */
  validateParams(params) {
    if (!params.taskId) {
      throw new Error('taskId is required');
    }
    
    if (!params.message) {
      throw new Error('message is required');
    }
    
    if (params.progressPercentage !== undefined) {
      if (typeof params.progressPercentage !== 'number' || 
          params.progressPercentage < 0 || 
          params.progressPercentage > 100) {
        throw new Error('progressPercentage must be a number between 0 and 100');
      }
    }
    
    if (params.type === 'milestone' && !params.milestone) {
      throw new Error('milestone name is required when type is "milestone"');
    }
  }

  /**
   * Log update for debugging and audit trail
   */
  logUpdate(taskId, updateData, result) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      taskId,
      updateType: updateData.type,
      status: updateData.status,
      message: updateData.message,
      success: result.success
    };
    
    // Use stderr to prevent JSON-RPC interference
    console.error(`🔄 [${this.agentId}] Progress Update:`, logEntry);
  }

  /**
   * Generate tool description for agent context
   */
  getToolDescription() {
    return `
UpdateProgress Tool - Real-time Mission Communication

CRITICAL: Use this tool to communicate with mission command during task execution.

When to use:
- 🎯 Task started: UpdateProgress({taskId, status: "in_progress", message: "Starting task..."})
- 📈 Progress made: UpdateProgress({taskId, progressPercentage: 25, message: "Completed research phase"})
- 🏆 Milestone reached: UpdateProgress({taskId, type: "milestone", milestone: "Data extracted", message: "Successfully extracted 50 hotel options"})
- 🚧 Obstacle found: UpdateProgress({taskId, type: "obstacle", severity: "high", message: "Direct flights fully booked on target date"})
- ✅ Task complete: UpdateProgress({taskId, status: "completed", progressPercentage: 100, message: "Task completed successfully", artifacts: [...]})

Examples:
UpdateProgress({
  taskId: "research_hotels_tokyo",
  type: "milestone",
  milestone: "Research complete",
  progressPercentage: 80,
  message: "Found 3 budget-friendly hotels in Tokyo, now checking availability",
  artifacts: [
    {type: "url", path: "https://booking.com/results", description: "Hotel search results"},
    {type: "file", path: "./hotel_options.json", description: "Structured hotel data"}
  ]
})

Remember: Report immediately when encountering obstacles or achieving milestones!
    `;
  }
}

/**
 * Factory function to create UpdateProgress tool instances
 */
export function createUpdateProgressTool(progressManager, agentId) {
  return new UpdateProgressTool(progressManager, agentId);
}

export default UpdateProgressTool;