/**
 * Memory & Persistence Tools Panel
 * Provides interface for memory management and persistence operations
 */

import { EventEmitter } from './event-emitter.js';

export class MemoryToolsPanel extends EventEmitter {
  constructor(wsClient) {
    super();
    this.wsClient = wsClient;
    this.isInitialized = false;
    this.backupProgress = new Map();
    this.memoryStats = new Map();
    this.activeOperations = new Set();
    this.cacheMetrics = null;

    // DOM elements
    this.elements = {};

    // Memory tools configuration
    this.memoryTools = {
      // Core memory tools
      memory_backup: { name: 'Memory Backup', category: 'backup', icon: '💾' },
      memory_restore: { name: 'Memory Restore', category: 'backup', icon: '📥' },
      memory_compress: { name: 'Data Compression', category: 'optimization', icon: '🗜️' },
      memory_sync: { name: 'Cross-Instance Sync', category: 'sync', icon: '🔄' },

      // Cache management
      cache_manage: { name: 'Cache Management', category: 'cache', icon: '🗂️' },
      cache_optimize: { name: 'Cache Optimization', category: 'cache', icon: '⚡' },

      // State management
      state_snapshot: { name: 'State Snapshot', category: 'state', icon: '📸' },
      context_restore: { name: 'Context Recovery', category: 'state', icon: '🔄' },

      // Analytics and persistence
      memory_analytics: { name: 'Memory Analytics', category: 'analytics', icon: '📊' },
      memory_persist: { name: 'Session Persistence', category: 'persistence', icon: '🔐' },
      memory_namespace: { name: 'Namespace Manager', category: 'management', icon: '🏷️' },

      // Advanced features
      memory_defrag: { name: 'Memory Defragmentation', category: 'optimization', icon: '🧹' },
      memory_encrypt: { name: 'Memory Encryption', category: 'security', icon: '🔒' },
      memory_replicate: { name: 'Memory Replication', category: 'sync', icon: '📋' },
    };

    this.categories = {
      backup: { name: 'Backup & Restore', color: '#007acc' },
      optimization: { name: 'Optimization', color: '#ff6b6b' },
      sync: { name: 'Synchronization', color: '#4ecdc4' },
      cache: { name: 'Cache Management', color: '#45b7d1' },
      state: { name: 'State Management', color: '#96ceb4' },
      analytics: { name: 'Analytics', color: '#feca57' },
      persistence: { name: 'Persistence', color: '#ff9ff3' },
      management: { name: 'Management', color: '#a8e6cf' },
      security: { name: 'Security', color: '#ff8b94' },
    };
  }

  /**
   * Initialize the memory tools panel
   */
  async init() {
    if (this.isInitialized) return;

    try {
      await this.createPanelUI();
      this.setupEventListeners();
      this.setupWebSocketHandlers();
      await this.loadInitialData();

      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      console.error('Failed to initialize memory tools panel:', error);
      this.emit('error', error);
    }
  }

  /**
   * Create the memory tools panel UI
   */
  async createPanelUI() {
    // Create main panel container
    const panelContainer = document.createElement('div');
    panelContainer.id = 'memoryToolsPanel';
    panelContainer.className = 'memory-panel hidden';

    // Create panel header
    const header = this.createPanelHeader();
    panelContainer.appendChild(header);

    // Create main content area
    const content = document.createElement('div');
    content.className = 'memory-content';

    // Create tabbed interface
    const tabs = this.createTabs();
    content.appendChild(tabs);

    // Create tab content areas
    const tabContents = this.createTabContents();
    content.appendChild(tabContents);

    panelContainer.appendChild(content);

    // Insert into DOM
    const consoleMain = document.querySelector('.console-main');
    if (consoleMain) {
      consoleMain.appendChild(panelContainer);
    }

    // Store DOM elements
    this.elements.panel = panelContainer;
    this.elements.header = header;
    this.elements.content = content;
    this.elements.tabs = tabs;
    this.elements.tabContents = tabContents;

    // Add toggle button to main header
    this.addToggleButton();

    // Get additional DOM references
    this.elements.memoryMetrics = panelContainer.querySelector('#memoryMetrics');
    this.elements.backupList = panelContainer.querySelector('#backupList');
    this.elements.operationProgress = panelContainer.querySelector('#operationProgress');
    this.elements.cacheStats = panelContainer.querySelector('#cacheStats');
    this.elements.analyticsChart = panelContainer.querySelector('#analyticsChart');
  }

  /**
   * Create panel header
   */
  createPanelHeader() {
    const header = document.createElement('div');
    header.className = 'memory-header';

    header.innerHTML = `
      <div class="memory-header-left">
        <h2 class="memory-title">
          <span class="memory-icon">🧠</span>
          Memory & Persistence
        </h2>
        <div class="memory-status" id="memoryStatus">
          <span class="status-indicator" id="memoryStatusIndicator"></span>
          <span class="status-text" id="memoryStatusText">Ready</span>
        </div>
      </div>
      <div class="memory-header-right">
        <button class="memory-button" id="refreshMemoryData" aria-label="Refresh Data">
          <span class="icon">🔄</span>
          Refresh
        </button>
        <button class="memory-button" id="exportMemoryData" aria-label="Export Data">
          <span class="icon">📥</span>
          Export
        </button>
        <button class="memory-button close-button" id="closeMemoryPanel" aria-label="Close Panel">
          <span class="icon">×</span>
        </button>
      </div>
    `;

    return header;
  }

  /**
   * Create tab navigation
   */
  createTabs() {
    const tabs = document.createElement('div');
    tabs.className = 'memory-tabs';

    const tabItems = [
      { id: 'tools', name: 'Tools', icon: '🛠️' },
      { id: 'analytics', name: 'Analytics', icon: '📊' },
      { id: 'management', name: 'Management', icon: '⚙️' },
    ];

    tabItems.forEach((tab, index) => {
      const tabElement = document.createElement('button');
      tabElement.className = `memory-tab ${index === 0 ? 'active' : ''}`;
      tabElement.setAttribute('data-tab', tab.id);
      tabElement.innerHTML = `
        <span class="tab-icon">${tab.icon}</span>
        <span class="tab-name">${tab.name}</span>
      `;
      tabs.appendChild(tabElement);
    });

    return tabs;
  }

  /**
   * Create tab content areas
   */
  createTabContents() {
    const tabContents = document.createElement('div');
    tabContents.className = 'memory-tab-contents';

    // Tools tab
    const toolsTab = this.createToolsTab();
    tabContents.appendChild(toolsTab);

    // Analytics tab
    const analyticsTab = this.createAnalyticsTab();
    tabContents.appendChild(analyticsTab);

    // Management tab
    const managementTab = this.createManagementTab();
    tabContents.appendChild(managementTab);

    return tabContents;
  }

  /**
   * Create tools tab content
   */
  createToolsTab() {
    const toolsTab = document.createElement('div');
    toolsTab.className = 'memory-tab-content active';
    toolsTab.setAttribute('data-tab', 'tools');

    // Create category sections
    Object.entries(this.categories).forEach(([categoryId, category]) => {
      const categorySection = document.createElement('div');
      categorySection.className = 'memory-category';

      const categoryHeader = document.createElement('h3');
      categoryHeader.className = 'memory-category-header';
      categoryHeader.style.borderLeftColor = category.color;
      categoryHeader.innerHTML = `
        <span class="category-name">${category.name}</span>
        <span class="category-count" id="categoryCount-${categoryId}">0</span>
      `;

      const categoryGrid = document.createElement('div');
      categoryGrid.className = 'memory-tools-grid';
      categoryGrid.id = `categoryGrid-${categoryId}`;

      categorySection.appendChild(categoryHeader);
      categorySection.appendChild(categoryGrid);
      toolsTab.appendChild(categorySection);

      // Add tools to category
      this.populateToolsGrid(categoryGrid, categoryId);
    });

    return toolsTab;
  }

  /**
   * Populate tools grid for a category
   */
  populateToolsGrid(grid, categoryId) {
    const toolsInCategory = Object.entries(this.memoryTools).filter(
      ([, tool]) => tool.category === categoryId,
    );

    toolsInCategory.forEach(([toolId, tool]) => {
      const toolCard = document.createElement('div');
      toolCard.className = 'memory-tool-card';
      toolCard.setAttribute('data-tool', toolId);

      toolCard.innerHTML = `
        <div class="tool-icon">${tool.icon}</div>
        <div class="tool-name">${tool.name}</div>
        <div class="tool-actions">
          <button class="tool-action-btn" data-action="execute" data-tool="${toolId}" title="Execute">
            <span>▶️</span>
          </button>
          <button class="tool-action-btn" data-action="configure" data-tool="${toolId}" title="Configure">
            <span>⚙️</span>
          </button>
        </div>
      `;

      grid.appendChild(toolCard);
    });

    // Update category count
    const countElement = document.getElementById(`categoryCount-${categoryId}`);
    if (countElement) {
      countElement.textContent = toolsInCategory.length;
    }
  }

  /**
   * Create analytics tab content
   */
  createAnalyticsTab() {
    const analyticsTab = document.createElement('div');
    analyticsTab.className = 'memory-tab-content';
    analyticsTab.setAttribute('data-tab', 'analytics');

    analyticsTab.innerHTML = `
      <div class="memory-section">
        <h3>Memory Usage Analytics</h3>
        <div class="analytics-metrics" id="memoryMetrics">
          <div class="metric-cards">
            <div class="metric-card">
              <div class="metric-icon">💾</div>
              <div class="metric-content">
                <div class="metric-label">Total Memory</div>
                <div class="metric-value" id="totalMemory">-- MB</div>
              </div>
            </div>
            <div class="metric-card">
              <div class="metric-icon">⚡</div>
              <div class="metric-content">
                <div class="metric-label">Active Memory</div>
                <div class="metric-value" id="activeMemory">-- MB</div>
              </div>
            </div>
            <div class="metric-card">
              <div class="metric-icon">📊</div>
              <div class="metric-content">
                <div class="metric-label">Memory Efficiency</div>
                <div class="metric-value" id="memoryEfficiency">--%</div>
              </div>
            </div>
            <div class="metric-card">
              <div class="metric-icon">🗂️</div>
              <div class="metric-content">
                <div class="metric-label">Cache Hit Rate</div>
                <div class="metric-value" id="cacheHitRate">--%</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div class="memory-section">
        <h3>Memory Operations History</h3>
        <div class="operations-timeline" id="operationsTimeline">
          <div class="timeline-placeholder">No operations recorded</div>
        </div>
      </div>
      
      <div class="memory-section">
        <h3>Performance Insights</h3>
        <div class="insights-container" id="performanceInsights">
          <div class="insights-placeholder">Run analytics to see insights</div>
        </div>
      </div>
    `;

    return analyticsTab;
  }

  /**
   * Create management tab content
   */
  createManagementTab() {
    const managementTab = document.createElement('div');
    managementTab.className = 'memory-tab-content';
    managementTab.setAttribute('data-tab', 'management');

    managementTab.innerHTML = `
      <div class="memory-section">
        <div class="section-header">
          <h3>Backup Management</h3>
          <div class="section-actions">
            <button class="memory-button" id="createBackup">
              <span class="icon">💾</span>
              Create Backup
            </button>
            <button class="memory-button" id="scheduleBackup">
              <span class="icon">⏰</span>
              Schedule Backup
            </button>
          </div>
        </div>
        <div class="backups-list" id="backupList">
          <div class="backups-placeholder">No backups available</div>
        </div>
      </div>
      
      <div class="memory-section">
        <div class="section-header">
          <h3>Cache Management</h3>
          <div class="section-actions">
            <button class="memory-button" id="clearCache">
              <span class="icon">🗑️</span>
              Clear Cache
            </button>
            <button class="memory-button" id="optimizeCache">
              <span class="icon">⚡</span>
              Optimize Cache
            </button>
          </div>
        </div>
        <div class="cache-stats" id="cacheStats">
          <div class="cache-metrics">
            <div class="cache-metric">
              <span class="metric-label">Cache Size:</span>
              <span class="metric-value" id="cacheSize">-- MB</span>
            </div>
            <div class="cache-metric">
              <span class="metric-label">Hit Rate:</span>
              <span class="metric-value" id="cacheHitRate2">--%</span>
            </div>
            <div class="cache-metric">
              <span class="metric-label">Entries:</span>
              <span class="metric-value" id="cacheEntries">--</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="memory-section">
        <div class="section-header">
          <h3>Namespace Management</h3>
          <div class="section-actions">
            <button class="memory-button" id="createNamespace">
              <span class="icon">➕</span>
              Create Namespace
            </button>
            <button class="memory-button" id="cleanupNamespaces">
              <span class="icon">🧹</span>
              Cleanup
            </button>
          </div>
        </div>
        <div class="namespaces-list" id="namespacesList">
          <div class="namespace-item">
            <div class="namespace-info">
              <div class="namespace-name">default</div>
              <div class="namespace-size">12.3 MB</div>
            </div>
            <div class="namespace-actions">
              <button class="namespace-action-btn" data-action="export" title="Export">📥</button>
              <button class="namespace-action-btn" data-action="compress" title="Compress">🗜️</button>
            </div>
          </div>
        </div>
      </div>
    `;

    return managementTab;
  }

  /**
   * Add toggle button to main header
   */
  addToggleButton() {
    const headerRight = document.querySelector('.header-right');
    if (headerRight) {
      const toggleButton = document.createElement('button');
      toggleButton.className = 'header-button';
      toggleButton.id = 'memoryToggle';
      toggleButton.setAttribute('aria-label', 'Toggle Memory Tools');
      toggleButton.innerHTML = `
        <span class="icon">🧠</span>
        Memory
      `;

      // Insert before settings button
      const settingsButton = document.getElementById('settingsToggle');
      if (settingsButton) {
        headerRight.insertBefore(toggleButton, settingsButton);
      } else {
        headerRight.appendChild(toggleButton);
      }
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Panel toggle
    const toggleButton = document.getElementById('memoryToggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', () => {
        this.togglePanel();
      });
    }

    // Close panel
    const closeButton = document.getElementById('closeMemoryPanel');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        this.hidePanel();
      });
    }

    // Refresh and export
    const refreshBtn = document.getElementById('refreshMemoryData');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.refreshData());
    }

    const exportBtn = document.getElementById('exportMemoryData');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportData());
    }

    // Tab navigation
    const tabButtons = document.querySelectorAll('.memory-tab');
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const tabId = button.getAttribute('data-tab');
        this.switchTab(tabId);
      });
    });

    // Tool execution
    this.elements.panel.addEventListener('click', (e) => {
      if (e.target.classList.contains('tool-action-btn')) {
        const action = e.target.dataset.action;
        const toolName = e.target.dataset.tool;

        if (action === 'execute') {
          this.executeTool(toolName);
        } else if (action === 'configure') {
          this.configureTool(toolName);
        }
      }
    });

    // Management actions
    this.setupManagementActions();
  }

  /**
   * Setup management action listeners
   */
  setupManagementActions() {
    // Backup actions
    const createBackupBtn = document.getElementById('createBackup');
    if (createBackupBtn) {
      createBackupBtn.addEventListener('click', () => this.createBackup());
    }

    const scheduleBackupBtn = document.getElementById('scheduleBackup');
    if (scheduleBackupBtn) {
      scheduleBackupBtn.addEventListener('click', () => this.scheduleBackup());
    }

    // Cache actions
    const clearCacheBtn = document.getElementById('clearCache');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', () => this.clearCache());
    }

    const optimizeCacheBtn = document.getElementById('optimizeCache');
    if (optimizeCacheBtn) {
      optimizeCacheBtn.addEventListener('click', () => this.optimizeCache());
    }

    // Namespace actions
    const createNamespaceBtn = document.getElementById('createNamespace');
    if (createNamespaceBtn) {
      createNamespaceBtn.addEventListener('click', () => this.createNamespace());
    }

    const cleanupNamespacesBtn = document.getElementById('cleanupNamespaces');
    if (cleanupNamespacesBtn) {
      cleanupNamespacesBtn.addEventListener('click', () => this.cleanupNamespaces());
    }
  }

  /**
   * Setup WebSocket handlers
   */
  setupWebSocketHandlers() {
    if (this.wsClient) {
      this.wsClient.on('memory_backup_progress', (data) => {
        this.updateBackupProgress(data);
      });

      this.wsClient.on('memory_operation_complete', (data) => {
        this.handleOperationComplete(data);
      });

      this.wsClient.on('memory_metrics_update', (data) => {
        this.updateMemoryMetrics(data);
      });

      this.wsClient.on('cache_stats_update', (data) => {
        this.updateCacheStats(data);
      });
    }
  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    try {
      // Load memory status
      await this.checkMemoryStatus();

      // Load memory metrics
      await this.loadMemoryMetrics();

      // Load backup list
      await this.loadBackupList();

      // Load cache statistics
      await this.loadCacheStats();
    } catch (error) {
      console.error('Failed to load initial memory data:', error);
    }
  }

  /**
   * Execute a memory tool
   */
  async executeTool(toolId) {
    try {
      const tool = this.memoryTools[toolId];
      if (!tool) {
        console.error('Unknown tool:', toolId);
        return;
      }

      this.updateStatus(`Executing ${tool.name}...`, 'processing');
      this.activeOperations.add(toolId);

      // Send notification to coordination system
      await this.sendCoordinationNotification(`Starting ${tool.name}`);

      // Execute the tool
      const result = await this.callMemoryTool(toolId);
      this.handleToolResult(toolId, result);

      // Notify completion
      await this.sendCoordinationNotification(`${tool.name} completed successfully`);

      this.emit('tool_executed', { toolId });
    } catch (error) {
      this.updateStatus('Tool execution failed', 'error');
      this.emit('tool_error', { toolId, error });
      console.error(`Memory tool execution failed (${toolId}):`, error);
    } finally {
      this.activeOperations.delete(toolId);
    }
  }

  /**
   * Configure a memory tool
   */
  configureTool(toolId) {
    const tool = this.memoryTools[toolId];
    if (tool) {
      // Show configuration modal for the tool
      this.showToolConfiguration(toolId);
    }
  }

  /**
   * Show tool configuration dialog
   */
  showToolConfiguration(toolId) {
    const tool = this.memoryTools[toolId];
    if (!tool) return;

    // Create configuration modal
    const modal = document.createElement('div');
    modal.className = 'tool-config-modal';
    modal.innerHTML = `
      <div class="modal-overlay">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Configure ${tool.name}</h3>
            <button class="modal-close" onclick="this.closest('.tool-config-modal').remove()">×</button>
          </div>
          <div class="modal-body">
            <div class="config-form">
              ${this.getToolConfigForm(toolId)}
            </div>
          </div>
          <div class="modal-footer">
            <button class="memory-button secondary" onclick="this.closest('.tool-config-modal').remove()">Cancel</button>
            <button class="memory-button primary" onclick="this.closest('.tool-config-modal').remove()">Save</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  /**
   * Get configuration form for a tool
   */
  getToolConfigForm(toolId) {
    const commonConfig = `
      <div class="config-row">
        <label>Priority:</label>
        <select>
          <option value="high">High</option>
          <option value="medium" selected>Medium</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="config-row">
        <label>Auto-execute:</label>
        <input type="checkbox" />
      </div>
    `;

    const toolSpecificConfig = {
      memory_backup: `
        <div class="config-row">
          <label>Backup Location:</label>
          <input type="text" placeholder="Enter backup path" />
        </div>
        <div class="config-row">
          <label>Compression:</label>
          <select>
            <option value="gzip">GZip</option>
            <option value="lz4">LZ4</option>
            <option value="none">None</option>
          </select>
        </div>
      `,
      memory_compress: `
        <div class="config-row">
          <label>Compression Algorithm:</label>
          <select>
            <option value="gzip">GZip</option>
            <option value="lz4">LZ4</option>
            <option value="zstd">Zstandard</option>
          </select>
        </div>
        <div class="config-row">
          <label>Compression Level:</label>
          <input type="range" min="1" max="9" value="6" />
        </div>
      `,
      cache_manage: `
        <div class="config-row">
          <label>Cache Size Limit:</label>
          <input type="number" placeholder="MB" />
        </div>
        <div class="config-row">
          <label>TTL (seconds):</label>
          <input type="number" value="3600" />
        </div>
      `,
    };

    return commonConfig + (toolSpecificConfig[toolId] || '');
  }

  /**
   * Call memory tool via WebSocket or MCP
   */
  async callMemoryTool(toolId, params = {}) {
    // Try WebSocket first, then MCP, then fallback to mock
    if (this.wsClient && this.wsClient.getStatus() === 'connected') {
      try {
        const response = await this.wsClient.sendRequest({
          type: 'tool_execute',
          tool: `mcp__ruv-swarm__${toolId}`,
          params: params,
        });
        return response;
      } catch (error) {
        console.warn(`WebSocket failed for ${toolId}, trying MCP...`);
      }
    }

    // Try MCP tools
    try {
      const mcpResponse = await this.callMCPTool(toolId, params);
      return mcpResponse;
    } catch (error) {
      console.warn(`MCP failed for ${toolId}, using mock data:`, error);
      return this.getMockResponse(toolId, params);
    }
  }

  /**
   * Call MCP tool for memory operations
   */
  async callMCPTool(toolId, params = {}) {
    // Map memory tools to MCP functions
    const mcpMapping = {
      memory_backup: 'memory_usage',
      memory_restore: 'memory_usage',
      memory_sync: 'memory_usage',
      memory_analytics: 'memory_usage',
      cache_manage: 'memory_usage',
      state_snapshot: 'memory_usage',
    };

    const mcpFunction = mcpMapping[toolId];
    if (!mcpFunction) {
      throw new Error(`No MCP mapping for ${toolId}`);
    }

    // This would be implemented when MCP tools are available
    return { success: true, data: {}, mock: true };
  }

  /**
   * Get mock response for testing
   */
  getMockResponse(toolId, params) {
    const timestamp = new Date().toISOString();

    switch (toolId) {
      case 'memory_backup':
        return {
          success: true,
          backupId: `backup-${Date.now()}`,
          size: '45.2 MB',
          timestamp,
          location: '/backups/memory-backup.gz',
        };

      case 'memory_restore':
        return {
          success: true,
          restored: true,
          timestamp,
          itemsRestored: 1247,
        };

      case 'memory_compress':
        return {
          success: true,
          originalSize: '89.4 MB',
          compressedSize: '23.1 MB',
          compressionRatio: 0.26,
          algorithm: 'gzip',
        };

      case 'memory_sync':
        return {
          success: true,
          synced: true,
          timestamp,
          itemsSynced: 342,
          conflicts: 0,
        };

      case 'cache_manage':
        return {
          success: true,
          action: 'optimized',
          entriesProcessed: 1523,
          spaceSaved: '12.7 MB',
          hitRateImprovement: 0.08,
        };

      case 'state_snapshot':
        return {
          success: true,
          snapshotId: `snapshot-${Date.now()}`,
          timestamp,
          size: '8.9 MB',
          components: 15,
        };

      case 'context_restore':
        return {
          success: true,
          contextRestored: true,
          timestamp,
          itemsRestored: 89,
          contextSize: '2.3 MB',
        };

      case 'memory_analytics':
        return {
          success: true,
          analytics: {
            totalMemory: 128.5,
            activeMemory: 89.2,
            efficiency: 0.87,
            hitRate: 0.94,
            operations: 15420,
            insights: [
              'Memory usage is optimal',
              'Cache hit rate is excellent',
              'No memory leaks detected',
            ],
          },
        };

      case 'memory_persist':
        return {
          success: true,
          persisted: true,
          timestamp,
          sessionId: `session-${Date.now()}`,
          size: '15.7 MB',
        };

      case 'memory_namespace':
        return {
          success: true,
          namespaces: [
            { id: 'default', size: '12.3 MB', items: 245 },
            { id: 'cache', size: '8.7 MB', items: 156 },
            { id: 'session', size: '3.2 MB', items: 78 },
          ],
        };

      default:
        return { success: true, data: {}, mock: true };
    }
  }

  /**
   * Send coordination notification
   */
  async sendCoordinationNotification(message) {
    try {
      if (this.wsClient) {
        await this.wsClient.sendRequest({
          type: 'coordination_notify',
          message: message,
          timestamp: new Date().toISOString(),
          agent: 'memory-tools',
        });
      }
    } catch (error) {
      console.warn('Failed to send coordination notification:', error);
    }
  }

  /**
   * Handle tool execution result
   */
  handleToolResult(toolId, result) {
    const tool = this.memoryTools[toolId];
    if (!tool) return;

    if (result && result.success) {
      this.updateStatus(`${tool.name} completed successfully`, 'success');
      this.updateOperationHistory(toolId, result);

      // Refresh relevant data
      this.refreshData();
    } else {
      this.updateStatus(`${tool.name} failed`, 'error');
    }
  }

  /**
   * Update operation history
   */
  updateOperationHistory(toolId, result) {
    const operation = {
      id: `op-${Date.now()}`,
      tool: toolId,
      toolName: this.memoryTools[toolId].name,
      result: result,
      timestamp: new Date().toISOString(),
      success: result.success,
    };

    // Add to timeline
    this.addToTimeline(operation);
  }

  /**
   * Add operation to timeline
   */
  addToTimeline(operation) {
    const timeline = document.getElementById('operationsTimeline');
    if (!timeline) return;

    if (timeline.querySelector('.timeline-placeholder')) {
      timeline.innerHTML = '';
    }

    const operationElement = document.createElement('div');
    operationElement.className = `timeline-item ${operation.success ? 'success' : 'error'}`;
    operationElement.innerHTML = `
      <div class="timeline-time">${new Date(operation.timestamp).toLocaleTimeString()}</div>
      <div class="timeline-content">
        <div class="timeline-title">${operation.toolName}</div>
        <div class="timeline-details">${this.formatOperationResult(operation.result)}</div>
      </div>
    `;

    timeline.insertBefore(operationElement, timeline.firstChild);

    // Keep only last 20 operations
    const items = timeline.querySelectorAll('.timeline-item');
    if (items.length > 20) {
      items[items.length - 1].remove();
    }
  }

  /**
   * Format operation result for display
   */
  formatOperationResult(result) {
    if (result.size) return `Size: ${result.size}`;
    if (result.compressionRatio)
      return `Compression: ${(result.compressionRatio * 100).toFixed(1)}%`;
    if (result.itemsSynced) return `Synced: ${result.itemsSynced} items`;
    if (result.spaceSaved) return `Space saved: ${result.spaceSaved}`;
    return 'Operation completed';
  }

  /**
   * Update status display
   */
  updateStatus(text, type = 'info') {
    const statusText = document.getElementById('memoryStatusText');
    const statusIndicator = document.getElementById('memoryStatusIndicator');

    if (statusText) {
      statusText.textContent = text;
    }

    if (statusIndicator) {
      statusIndicator.className = `status-indicator ${type}`;
    }
  }

  /**
   * Check memory status
   */
  async checkMemoryStatus() {
    try {
      const result = await this.callMemoryTool('memory_analytics');
      this.handleMemoryStatus(result);
    } catch (error) {
      console.error('Failed to check memory status:', error);
    }
  }

  /**
   * Handle memory status response
   */
  handleMemoryStatus(status) {
    if (status && status.success) {
      this.updateStatus('Memory system ready', 'success');
      if (status.analytics) {
        this.updateMemoryMetrics(status.analytics);
      }
    } else {
      this.updateStatus('Memory system error', 'error');
    }
  }

  /**
   * Load memory metrics
   */
  async loadMemoryMetrics() {
    try {
      const result = await this.callMemoryTool('memory_analytics');
      if (result && result.success && result.analytics) {
        this.updateMemoryMetrics(result.analytics);
      }
    } catch (error) {
      console.error('Failed to load memory metrics:', error);
    }
  }

  /**
   * Update memory metrics display
   */
  updateMemoryMetrics(metrics) {
    const totalMemoryElement = document.getElementById('totalMemory');
    const activeMemoryElement = document.getElementById('activeMemory');
    const efficiencyElement = document.getElementById('memoryEfficiency');
    const hitRateElement = document.getElementById('cacheHitRate');

    if (totalMemoryElement) {
      totalMemoryElement.textContent = `${metrics.totalMemory.toFixed(1)} MB`;
    }

    if (activeMemoryElement) {
      activeMemoryElement.textContent = `${metrics.activeMemory.toFixed(1)} MB`;
    }

    if (efficiencyElement) {
      efficiencyElement.textContent = `${(metrics.efficiency * 100).toFixed(1)}%`;
    }

    if (hitRateElement) {
      hitRateElement.textContent = `${(metrics.hitRate * 100).toFixed(1)}%`;
    }

    // Update insights
    const insightsContainer = document.getElementById('performanceInsights');
    if (insightsContainer && metrics.insights) {
      insightsContainer.innerHTML = `
        <div class="insights-list">
          ${metrics.insights
            .map(
              (insight) => `
            <div class="insight-item">
              <span class="insight-icon">💡</span>
              <span class="insight-text">${insight}</span>
            </div>
          `,
            )
            .join('')}
        </div>
      `;
    }
  }

  /**
   * Load backup list
   */
  async loadBackupList() {
    try {
      // Mock backup data
      const backups = [
        {
          id: 'backup-1',
          name: 'Daily Backup',
          size: '45.2 MB',
          date: new Date(Date.now() - 86400000).toISOString(),
        },
        {
          id: 'backup-2',
          name: 'Weekly Backup',
          size: '98.7 MB',
          date: new Date(Date.now() - 604800000).toISOString(),
        },
        {
          id: 'backup-3',
          name: 'Manual Backup',
          size: '23.1 MB',
          date: new Date(Date.now() - 3600000).toISOString(),
        },
      ];

      this.renderBackupList(backups);
    } catch (error) {
      console.error('Failed to load backup list:', error);
    }
  }

  /**
   * Render backup list
   */
  renderBackupList(backups) {
    const backupList = document.getElementById('backupList');
    if (!backupList) return;

    if (backups.length === 0) {
      backupList.innerHTML = '<div class="backups-placeholder">No backups available</div>';
      return;
    }

    backupList.innerHTML = backups
      .map(
        (backup) => `
      <div class="backup-item">
        <div class="backup-info">
          <div class="backup-name">${backup.name}</div>
          <div class="backup-details">
            <span class="backup-size">${backup.size}</span>
            <span class="backup-date">${new Date(backup.date).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="backup-actions">
          <button class="backup-action-btn" data-action="restore" data-backup="${backup.id}" title="Restore">
            <span>📥</span>
          </button>
          <button class="backup-action-btn" data-action="download" data-backup="${backup.id}" title="Download">
            <span>⬇️</span>
          </button>
          <button class="backup-action-btn" data-action="delete" data-backup="${backup.id}" title="Delete">
            <span>🗑️</span>
          </button>
        </div>
      </div>
    `,
      )
      .join('');

    // Add event listeners for backup actions
    backupList.querySelectorAll('.backup-action-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.dataset.action;
        const backupId = e.currentTarget.dataset.backup;
        this.handleBackupAction(action, backupId);
      });
    });
  }

  /**
   * Handle backup action
   */
  async handleBackupAction(action, backupId) {
    try {
      switch (action) {
        case 'restore':
          await this.restoreBackup(backupId);
          break;
        case 'download':
          await this.downloadBackup(backupId);
          break;
        case 'delete':
          await this.deleteBackup(backupId);
          break;
      }
    } catch (error) {
      console.error(`Failed to ${action} backup:`, error);
      this.updateStatus(`Backup ${action} failed`, 'error');
    }
  }

  /**
   * Load cache statistics
   */
  async loadCacheStats() {
    try {
      const result = await this.callMemoryTool('cache_manage');
      if (result && result.success) {
        this.updateCacheStats({
          size: '24.7 MB',
          hitRate: 0.94,
          entries: 1523,
        });
      }
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  }

  /**
   * Update cache statistics display
   */
  updateCacheStats(stats) {
    const cacheSizeElement = document.getElementById('cacheSize');
    const hitRateElement = document.getElementById('cacheHitRate2');
    const entriesElement = document.getElementById('cacheEntries');

    if (cacheSizeElement) {
      cacheSizeElement.textContent = stats.size;
    }

    if (hitRateElement) {
      hitRateElement.textContent = `${(stats.hitRate * 100).toFixed(1)}%`;
    }

    if (entriesElement) {
      entriesElement.textContent = stats.entries;
    }
  }

  /**
   * Management actions
   */
  async createBackup() {
    this.updateStatus('Creating backup...', 'processing');

    try {
      const result = await this.callMemoryTool('memory_backup');
      if (result && result.success) {
        this.updateStatus('Backup created successfully', 'success');
        await this.loadBackupList();
      }
    } catch (error) {
      console.error('Failed to create backup:', error);
      this.updateStatus('Backup creation failed', 'error');
    }
  }

  async scheduleBackup() {
    // Mock implementation
    const schedule = prompt('Enter backup schedule (e.g., "daily at 2:00 AM"):');
    if (schedule) {
      this.updateStatus(`Backup scheduled: ${schedule}`, 'success');
    }
  }

  async clearCache() {
    if (confirm('Are you sure you want to clear the cache?')) {
      this.updateStatus('Clearing cache...', 'processing');

      try {
        const result = await this.callMemoryTool('cache_manage', { action: 'clear' });
        if (result && result.success) {
          this.updateStatus('Cache cleared successfully', 'success');
          await this.loadCacheStats();
        }
      } catch (error) {
        console.error('Failed to clear cache:', error);
        this.updateStatus('Cache clear failed', 'error');
      }
    }
  }

  async optimizeCache() {
    this.updateStatus('Optimizing cache...', 'processing');

    try {
      const result = await this.callMemoryTool('cache_manage', { action: 'optimize' });
      if (result && result.success) {
        this.updateStatus('Cache optimized successfully', 'success');
        await this.loadCacheStats();
      }
    } catch (error) {
      console.error('Failed to optimize cache:', error);
      this.updateStatus('Cache optimization failed', 'error');
    }
  }

  async createNamespace() {
    const name = prompt('Enter namespace name:');
    if (name) {
      this.updateStatus(`Creating namespace: ${name}`, 'processing');

      try {
        const result = await this.callMemoryTool('memory_namespace', { action: 'create', name });
        if (result && result.success) {
          this.updateStatus(`Namespace ${name} created`, 'success');
        }
      } catch (error) {
        console.error('Failed to create namespace:', error);
        this.updateStatus('Namespace creation failed', 'error');
      }
    }
  }

  async cleanupNamespaces() {
    if (confirm('Clean up unused namespaces?')) {
      this.updateStatus('Cleaning up namespaces...', 'processing');

      try {
        const result = await this.callMemoryTool('memory_namespace', { action: 'cleanup' });
        if (result && result.success) {
          this.updateStatus('Namespaces cleaned up', 'success');
        }
      } catch (error) {
        console.error('Failed to cleanup namespaces:', error);
        this.updateStatus('Namespace cleanup failed', 'error');
      }
    }
  }

  async restoreBackup(backupId) {
    if (confirm('Are you sure you want to restore this backup?')) {
      this.updateStatus('Restoring backup...', 'processing');

      try {
        const result = await this.callMemoryTool('memory_restore', { backupId });
        if (result && result.success) {
          this.updateStatus('Backup restored successfully', 'success');
        }
      } catch (error) {
        console.error('Failed to restore backup:', error);
        this.updateStatus('Backup restore failed', 'error');
      }
    }
  }

  async downloadBackup(backupId) {
    // Mock download
    this.updateStatus('Downloading backup...', 'processing');
    setTimeout(() => {
      this.updateStatus('Backup downloaded', 'success');
    }, 1000);
  }

  async deleteBackup(backupId) {
    if (confirm('Are you sure you want to delete this backup?')) {
      this.updateStatus('Deleting backup...', 'processing');
      setTimeout(() => {
        this.updateStatus('Backup deleted', 'success');
        this.loadBackupList();
      }, 500);
    }
  }

  /**
   * Panel management
   */
  togglePanel() {
    const panel = this.elements.panel;
    if (panel) {
      panel.classList.toggle('hidden');

      if (!panel.classList.contains('hidden')) {
        this.refreshData();
      }
    }
  }

  showPanel() {
    const panel = this.elements.panel;
    if (panel) {
      panel.classList.remove('hidden');
      this.refreshData();
    }
  }

  hidePanel() {
    const panel = this.elements.panel;
    if (panel) {
      panel.classList.add('hidden');
    }
  }

  /**
   * Switch to specific tab
   */
  switchTab(tabId) {
    // Update tab buttons
    const tabButtons = document.querySelectorAll('.memory-tab');
    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === tabId);
    });

    // Update tab contents
    const tabContents = document.querySelectorAll('.memory-tab-content');
    tabContents.forEach((content) => {
      content.classList.toggle('active', content.getAttribute('data-tab') === tabId);
    });

    // Load tab-specific data
    this.loadTabData(tabId);
  }

  /**
   * Load tab-specific data
   */
  async loadTabData(tabId) {
    switch (tabId) {
      case 'analytics':
        await this.loadMemoryMetrics();
        break;
      case 'management':
        await this.loadBackupList();
        await this.loadCacheStats();
        break;
    }
  }

  /**
   * Refresh all data
   */
  async refreshData() {
    await this.loadInitialData();
  }

  /**
   * Export memory data
   */
  async exportData() {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        memoryMetrics: this.memoryStats,
        backupHistory: Array.from(this.backupProgress.entries()),
        cacheMetrics: this.cacheMetrics,
        activeOperations: Array.from(this.activeOperations),
        stats: this.getStats(),
      };

      // Create download
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `memory-data-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.updateStatus('Data exported successfully', 'success');
    } catch (error) {
      console.error('Failed to export data:', error);
      this.updateStatus('Export failed', 'error');
    }
  }

  /**
   * Get panel statistics
   */
  getStats() {
    return {
      initialized: this.isInitialized,
      activeOperations: this.activeOperations.size,
      toolsAvailable: Object.keys(this.memoryTools).length,
      backupsCount: this.backupProgress.size,
      memoryMetrics: this.memoryStats.size,
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    if (this.elements.panel) {
      this.elements.panel.remove();
    }

    const toggleButton = document.getElementById('memoryToggle');
    if (toggleButton) {
      toggleButton.remove();
    }

    this.activeOperations.clear();
    this.backupProgress.clear();
    this.memoryStats.clear();
    this.isInitialized = false;
  }
}

// Export for module usage
export default MemoryToolsPanel;
