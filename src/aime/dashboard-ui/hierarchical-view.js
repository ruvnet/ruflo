/**
 * Hierarchical Progress View Component
 * 
 * Renders 4-level hierarchy visualization for AIME missions
 * with real-time updates and critical path highlighting
 */

class HierarchicalProgressView {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.hierarchyData = null;
    this.expandedNodes = new Set();
    this.criticalPath = new Set();
    this.selectedNode = null;
  }
  
  /**
   * Render the hierarchical view
   */
  render(hierarchyData) {
    this.hierarchyData = hierarchyData;
    
    if (!this.container) return;
    
    // Update critical path set
    if (hierarchyData.criticalPath) {
      this.criticalPath = new Set(hierarchyData.criticalPath);
    }
    
    this.container.innerHTML = `
      <div class="hierarchy-view">
        <div class="hierarchy-header">
          <h3>📊 Mission Hierarchy</h3>
          <div class="hierarchy-controls">
            <button class="btn-small" onclick="hierarchyView.expandAll()">Expand All</button>
            <button class="btn-small" onclick="hierarchyView.collapseAll()">Collapse All</button>
            <button class="btn-small critical" onclick="hierarchyView.toggleCriticalPath()">
              ${this.showCriticalOnly ? 'Show All' : 'Critical Path'}
            </button>
          </div>
        </div>
        <div class="hierarchy-tree">
          ${this.renderMission(hierarchyData.mission)}
        </div>
        ${this.selectedNode ? this.renderNodeDetails() : ''}
      </div>
    `;
    
    this.attachEventListeners();
  }
  
  /**
   * Render mission level
   */
  renderMission(mission) {
    if (!mission) return '<div class="empty-state">No mission data</div>';
    
    const isCritical = this.criticalPath.has(mission.id);
    const isExpanded = this.expandedNodes.has(mission.id) || this.expandedNodes.size === 0;
    
    return `
      <div class="hierarchy-node mission-node ${isCritical ? 'critical' : ''}" 
           data-node-id="${mission.id}" data-level="mission">
        <div class="node-header" onclick="hierarchyView.toggleNode('${mission.id}')">
          <span class="node-toggle">${isExpanded ? '▼' : '▶'}</span>
          <span class="node-icon">🎯</span>
          <span class="node-name">${mission.name || mission.id}</span>
          ${this.renderProgress(mission.progress)}
        </div>
        ${isExpanded ? `
          <div class="node-children">
            ${this.hierarchyData.phases.map(phase => this.renderPhase(phase)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Render phase level
   */
  renderPhase(phase) {
    const isCritical = this.criticalPath.has(phase.id);
    const isExpanded = this.expandedNodes.has(phase.id);
    
    if (this.showCriticalOnly && !isCritical) return '';
    
    return `
      <div class="hierarchy-node phase-node ${isCritical ? 'critical' : ''}" 
           data-node-id="${phase.id}" data-level="phase">
        <div class="node-header" onclick="hierarchyView.toggleNode('${phase.id}')">
          <span class="node-toggle">${isExpanded ? '▼' : '▶'}</span>
          <span class="node-icon">📋</span>
          <span class="node-name">${phase.name || phase.id}</span>
          ${this.renderProgress(phase.progress)}
          ${phase.slack > 0 ? `<span class="slack-time">Slack: ${this.formatDuration(phase.slack)}</span>` : ''}
        </div>
        ${isExpanded ? `
          <div class="node-children">
            ${phase.tasks.map(task => this.renderTask(task)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Render task level
   */
  renderTask(task) {
    const isCritical = this.criticalPath.has(task.id);
    const isExpanded = this.expandedNodes.has(task.id);
    
    if (this.showCriticalOnly && !isCritical) return '';
    
    const statusClass = this.getStatusClass(task.status);
    
    return `
      <div class="hierarchy-node task-node ${isCritical ? 'critical' : ''} ${statusClass}" 
           data-node-id="${task.id}" data-level="task">
        <div class="node-header" onclick="hierarchyView.toggleNode('${task.id}')">
          <span class="node-toggle">${task.subtasks?.length > 0 ? (isExpanded ? '▼' : '▶') : '•'}</span>
          <span class="node-icon">${this.getTaskIcon(task.type)}</span>
          <span class="node-name">${task.name || task.id}</span>
          ${this.renderProgress(task.progress)}
          ${task.assignedAgent ? `<span class="assigned-agent">👤 ${task.assignedAgent}</span>` : ''}
        </div>
        ${isExpanded && task.subtasks?.length > 0 ? `
          <div class="node-children">
            ${task.subtasks.map(subtask => this.renderSubtask(subtask)).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  /**
   * Render subtask level
   */
  renderSubtask(subtask) {
    const statusClass = this.getStatusClass(subtask.status);
    
    return `
      <div class="hierarchy-node subtask-node ${statusClass}" 
           data-node-id="${subtask.id}" data-level="subtask">
        <div class="node-header" onclick="hierarchyView.selectNode('${subtask.id}')">
          <span class="node-toggle">•</span>
          <span class="node-icon">⚡</span>
          <span class="node-name">${subtask.name || subtask.id}</span>
          ${this.renderProgress(subtask.progress)}
          ${subtask.optional ? '<span class="optional-badge">Optional</span>' : ''}
        </div>
      </div>
    `;
  }
  
  /**
   * Render progress bar
   */
  renderProgress(progress) {
    const percentage = Math.round(progress || 0);
    return `
      <div class="node-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${percentage}%"></div>
        </div>
        <span class="progress-text">${percentage}%</span>
      </div>
    `;
  }
  
  /**
   * Render node details panel
   */
  renderNodeDetails() {
    if (!this.selectedNode) return '';
    
    const node = this.findNode(this.selectedNode);
    if (!node) return '';
    
    return `
      <div class="node-details-panel">
        <div class="details-header">
          <h4>${node.name || node.id}</h4>
          <button class="close-btn" onclick="hierarchyView.closeDetails()">×</button>
        </div>
        <div class="details-content">
          <div class="detail-item">
            <span class="detail-label">Type:</span>
            <span class="detail-value">${node.level || 'Unknown'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status:</span>
            <span class="detail-value status-${node.status}">${node.status || 'Pending'}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Progress:</span>
            <span class="detail-value">${Math.round(node.progress || 0)}%</span>
          </div>
          ${node.assignedAgent ? `
            <div class="detail-item">
              <span class="detail-label">Assigned to:</span>
              <span class="detail-value">${node.assignedAgent}</span>
            </div>
          ` : ''}
          ${node.estimatedDuration ? `
            <div class="detail-item">
              <span class="detail-label">Estimated Duration:</span>
              <span class="detail-value">${this.formatDuration(node.estimatedDuration)}</span>
            </div>
          ` : ''}
          ${node.dependencies?.length > 0 ? `
            <div class="detail-item">
              <span class="detail-label">Dependencies:</span>
              <div class="dependencies-list">
                ${node.dependencies.map(dep => `<span class="dependency">${dep}</span>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }
  
  /**
   * Toggle node expansion
   */
  toggleNode(nodeId) {
    if (this.expandedNodes.has(nodeId)) {
      this.expandedNodes.delete(nodeId);
    } else {
      this.expandedNodes.add(nodeId);
    }
    this.render(this.hierarchyData);
  }
  
  /**
   * Select node for details
   */
  selectNode(nodeId) {
    this.selectedNode = nodeId;
    this.render(this.hierarchyData);
  }
  
  /**
   * Close details panel
   */
  closeDetails() {
    this.selectedNode = null;
    this.render(this.hierarchyData);
  }
  
  /**
   * Expand all nodes
   */
  expandAll() {
    // Add all node IDs to expanded set
    this.addAllNodeIds(this.hierarchyData);
    this.render(this.hierarchyData);
  }
  
  /**
   * Collapse all nodes
   */
  collapseAll() {
    this.expandedNodes.clear();
    this.render(this.hierarchyData);
  }
  
  /**
   * Toggle critical path view
   */
  toggleCriticalPath() {
    this.showCriticalOnly = !this.showCriticalOnly;
    this.render(this.hierarchyData);
  }
  
  /**
   * Helper: Add all node IDs to expanded set
   */
  addAllNodeIds(data) {
    if (data.mission) {
      this.expandedNodes.add(data.mission.id);
    }
    
    data.phases?.forEach(phase => {
      this.expandedNodes.add(phase.id);
      phase.tasks?.forEach(task => {
        this.expandedNodes.add(task.id);
      });
    });
  }
  
  /**
   * Helper: Find node by ID
   */
  findNode(nodeId) {
    if (this.hierarchyData.mission?.id === nodeId) {
      return { ...this.hierarchyData.mission, level: 'mission' };
    }
    
    for (const phase of this.hierarchyData.phases || []) {
      if (phase.id === nodeId) {
        return { ...phase, level: 'phase' };
      }
      
      for (const task of phase.tasks || []) {
        if (task.id === nodeId) {
          return { ...task, level: 'task' };
        }
        
        for (const subtask of task.subtasks || []) {
          if (subtask.id === nodeId) {
            return { ...subtask, level: 'subtask' };
          }
        }
      }
    }
    
    return null;
  }
  
  /**
   * Helper: Get status class
   */
  getStatusClass(status) {
    const statusClasses = {
      completed: 'status-completed',
      active: 'status-active',
      in_progress: 'status-active',
      pending: 'status-pending',
      blocked: 'status-blocked',
      failed: 'status-failed',
      skipped: 'status-skipped'
    };
    
    return statusClasses[status] || 'status-pending';
  }
  
  /**
   * Helper: Get task icon
   */
  getTaskIcon(type) {
    const icons = {
      development: '💻',
      testing: '🧪',
      documentation: '📚',
      deployment: '🚀',
      review: '👀',
      research: '🔬',
      design: '🎨',
      analysis: '📊'
    };
    
    return icons[type] || '📌';
  }
  
  /**
   * Helper: Format duration
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return `${seconds}s`;
  }
  
  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Add click handlers for nodes
    const nodes = this.container.querySelectorAll('.hierarchy-node');
    nodes.forEach(node => {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        const nodeId = node.dataset.nodeId;
        const level = node.dataset.level;
        
        if (level === 'subtask') {
          this.selectNode(nodeId);
        }
      });
    });
  }
}

// Initialize global instance
const hierarchyView = new HierarchicalProgressView('hierarchy-container');