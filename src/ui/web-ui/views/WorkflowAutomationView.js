/**
 * Workflow & Automation View - Interface for workflow and automation tools
 * Handles workflow creation, automation rules, pipelines, scheduling, and SPARC modes
 */

class WorkflowAutomationView {
  constructor(container, eventBus, viewConfig) {
    this.container = container;
    this.eventBus = eventBus;
    this.viewConfig = viewConfig;
    this.componentLibrary = null;
    this.workflows = new Map();
    this.pipelines = new Map();
    this.automationRules = new Map();
    this.scheduledTasks = new Map();
    this.currentTab = 'overview';
    this.isInitialized = false;
    this.draggedElement = null;
    this.dropZones = new Set();
  }

  /**
   * Initialize the workflow & automation view
   */
  async initialize() {
    if (this.isInitialized) return;

    // Get component library from event bus
    this.eventBus.emit('component-library:get', (library) => {
      this.componentLibrary = library;
    });

    // Setup event handlers
    this.setupEventHandlers();

    this.isInitialized = true;
  }

  /**
   * Render the view with given parameters
   */
  async render(params = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
      this.createWorkflowInterface();
    } else {
      // Terminal mode
      this.renderTerminalMode(params);
    }
  }

  /**
   * Create workflow interface for browser
   */
  createWorkflowInterface() {
    // Create tab container
    const tabs = [
      { label: '📊 Overview', content: this.createOverviewTab() },
      { label: '🔄 Workflows', content: this.createWorkflowsTab() },
      { label: '⚡ Automation', content: this.createAutomationTab() },
      { label: '🚀 Pipelines', content: this.createPipelinesTab() },
      { label: '📅 Scheduler', content: this.createSchedulerTab() },
      { label: '🎯 SPARC Modes', content: this.createSparcModesTab() },
      { label: '📦 Batch & Parallel', content: this.createBatchTab() },
    ];

    if (this.componentLibrary) {
      const tabContainer = this.componentLibrary.getComponent('TabContainer')(tabs);
      this.container.appendChild(tabContainer.element);
    } else {
      // Fallback without component library
      this.createFallbackInterface();
    }
  }

  /**
   * Create overview tab content
   */
  createOverviewTab() {
    return `
      <div class="workflow-overview">
        <div class="stats-grid">
          <div id="workflows-stat" class="stat-card">
            <div class="stat-icon">🔄</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Active Workflows</div>
            </div>
          </div>
          <div id="pipelines-stat" class="stat-card">
            <div class="stat-icon">🚀</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Running Pipelines</div>
            </div>
          </div>
          <div id="rules-stat" class="stat-card">
            <div class="stat-icon">⚡</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Automation Rules</div>
            </div>
          </div>
          <div id="scheduled-stat" class="stat-card">
            <div class="stat-icon">📅</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Scheduled Tasks</div>
            </div>
          </div>
        </div>
        
        <div class="workflow-tools">
          <h3>🔧 Quick Actions</h3>
          <div class="tool-buttons">
            <button onclick="this.createNewWorkflow()" class="workflow-btn primary">
              🔄 Create Workflow
            </button>
            <button onclick="this.setupAutomation()" class="workflow-btn secondary">
              ⚡ Setup Automation
            </button>
            <button onclick="this.createPipeline()" class="workflow-btn secondary">
              🚀 New Pipeline
            </button>
            <button onclick="this.runSparcMode()" class="workflow-btn secondary">
              🎯 Run SPARC Mode
            </button>
          </div>
        </div>

        <div class="recent-activity">
          <h3>📈 Recent Activity</h3>
          <div id="workflow-activity-log" class="activity-list">
            <div class="activity-item">
              <span class="activity-time">--:--</span>
              <span class="activity-desc">No recent activity</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create workflows tab content with visual builder
   */
  createWorkflowsTab() {
    return `
      <div class="workflow-management">
        <div class="workflow-builder">
          <h3>🔄 Visual Workflow Builder</h3>
          
          <div class="builder-container">
            <div class="builder-sidebar">
              <h4>📦 Workflow Components</h4>
              <div class="component-palette">
                <div class="draggable-component" draggable="true" data-type="trigger">
                  <span class="component-icon">🎯</span>
                  <span class="component-label">Trigger</span>
                </div>
                <div class="draggable-component" draggable="true" data-type="action">
                  <span class="component-icon">⚡</span>
                  <span class="component-label">Action</span>
                </div>
                <div class="draggable-component" draggable="true" data-type="condition">
                  <span class="component-icon">🔀</span>
                  <span class="component-label">Condition</span>
                </div>
                <div class="draggable-component" draggable="true" data-type="loop">
                  <span class="component-icon">🔁</span>
                  <span class="component-label">Loop</span>
                </div>
                <div class="draggable-component" draggable="true" data-type="parallel">
                  <span class="component-icon">🔀</span>
                  <span class="component-label">Parallel</span>
                </div>
                <div class="draggable-component" draggable="true" data-type="sparc">
                  <span class="component-icon">🎯</span>
                  <span class="component-label">SPARC Mode</span>
                </div>
              </div>
            </div>
            
            <div class="builder-canvas" id="workflow-canvas">
              <div class="canvas-grid">
                <div class="drop-zone" data-position="start">
                  <span class="drop-hint">Drop to start workflow</span>
                </div>
              </div>
            </div>
            
            <div class="builder-properties">
              <h4>⚙️ Properties</h4>
              <div id="component-properties" class="properties-panel">
                <p class="properties-hint">Select a component to configure</p>
              </div>
            </div>
          </div>
          
          <div class="workflow-controls">
            <button onclick="this.saveWorkflow()" class="workflow-btn primary">
              💾 Save Workflow
            </button>
            <button onclick="this.testWorkflow()" class="workflow-btn secondary">
              🧪 Test Run
            </button>
            <button onclick="this.exportWorkflow()" class="workflow-btn secondary">
              📥 Export
            </button>
            <button onclick="this.clearCanvas()" class="workflow-btn danger">
              🗑️ Clear
            </button>
          </div>
        </div>
        
        <div class="workflow-list">
          <h3>📋 Saved Workflows</h3>
          <div id="workflows-list" class="workflows-grid">
            <!-- Workflow cards will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create automation tab content
   */
  createAutomationTab() {
    return `
      <div class="automation-management">
        <div class="automation-rules">
          <h3>⚡ Automation Rules</h3>
          
          <div class="rule-builder">
            <h4>Create New Rule</h4>
            
            <div class="form-group">
              <label>Rule Name:</label>
              <input type="text" id="rule-name" placeholder="Enter rule name...">
            </div>
            
            <div class="form-group">
              <label>Trigger Event:</label>
              <select id="trigger-event">
                <option value="">Select trigger...</option>
                <option value="file_change">File Change</option>
                <option value="task_complete">Task Complete</option>
                <option value="error_detected">Error Detected</option>
                <option value="schedule">Scheduled Time</option>
                <option value="webhook">Webhook</option>
                <option value="github_event">GitHub Event</option>
                <option value="memory_threshold">Memory Threshold</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Conditions (optional):</label>
              <textarea id="rule-conditions" placeholder="Define conditions in JSON format..."></textarea>
            </div>
            
            <div class="form-group">
              <label>Actions:</label>
              <div class="action-builder">
                <div id="rule-actions" class="actions-list">
                  <!-- Actions will be added here -->
                </div>
                <button onclick="this.addRuleAction()" class="workflow-btn small">
                  ➕ Add Action
                </button>
              </div>
            </div>
            
            <button onclick="this.createAutomationRule()" class="workflow-btn primary">
              ⚡ Create Rule
            </button>
          </div>
        </div>
        
        <div class="automation-list">
          <h3>📋 Active Rules</h3>
          <div id="automation-rules-list" class="rules-grid">
            <!-- Automation rules will be populated here -->
          </div>
        </div>
        
        <div class="trigger-setup">
          <h3>🎯 Event Triggers</h3>
          
          <div class="trigger-form">
            <div class="form-group">
              <label>Events to Monitor:</label>
              <div class="event-checkboxes">
                <label><input type="checkbox" value="file_created"> File Created</label>
                <label><input type="checkbox" value="file_modified"> File Modified</label>
                <label><input type="checkbox" value="git_push"> Git Push</label>
                <label><input type="checkbox" value="pr_opened"> PR Opened</label>
                <label><input type="checkbox" value="issue_created"> Issue Created</label>
                <label><input type="checkbox" value="test_failed"> Test Failed</label>
                <label><input type="checkbox" value="build_complete"> Build Complete</label>
              </div>
            </div>
            
            <button onclick="this.setupEventTriggers()" class="workflow-btn primary">
              🎯 Setup Triggers
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create pipelines tab content
   */
  createPipelinesTab() {
    return `
      <div class="pipeline-management">
        <div class="pipeline-builder">
          <h3>🚀 CI/CD Pipeline Builder</h3>
          
          <div class="pipeline-form">
            <div class="form-group">
              <label>Pipeline Name:</label>
              <input type="text" id="pipeline-name" placeholder="Enter pipeline name...">
            </div>
            
            <div class="form-group">
              <label>Pipeline Type:</label>
              <select id="pipeline-type">
                <option value="ci">Continuous Integration</option>
                <option value="cd">Continuous Deployment</option>
                <option value="ci_cd">CI/CD</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            
            <div class="pipeline-stages">
              <h4>Pipeline Stages</h4>
              <div id="pipeline-stages-list" class="stages-list">
                <div class="pipeline-stage">
                  <input type="text" placeholder="Stage name..." value="Build">
                  <textarea placeholder="Stage commands...">npm install
npm run build</textarea>
                </div>
                <div class="pipeline-stage">
                  <input type="text" placeholder="Stage name..." value="Test">
                  <textarea placeholder="Stage commands...">npm test
npm run lint</textarea>
                </div>
              </div>
              <button onclick="this.addPipelineStage()" class="workflow-btn small">
                ➕ Add Stage
              </button>
            </div>
            
            <button onclick="this.createPipeline()" class="workflow-btn primary">
              🚀 Create Pipeline
            </button>
          </div>
        </div>
        
        <div class="pipeline-monitor">
          <h3>📊 Pipeline Monitor</h3>
          <div id="pipeline-monitor-grid" class="monitor-grid">
            <!-- Pipeline status cards will be populated here -->
          </div>
        </div>
        
        <div class="pipeline-history">
          <h3>📋 Execution History</h3>
          <div id="pipeline-history-list" class="history-list">
            <!-- Pipeline execution history will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create scheduler tab content
   */
  createSchedulerTab() {
    return `
      <div class="scheduler-management">
        <div class="schedule-creator">
          <h3>📅 Task Scheduler</h3>
          
          <div class="schedule-form">
            <div class="form-group">
              <label>Task Name:</label>
              <input type="text" id="schedule-task-name" placeholder="Enter task name...">
            </div>
            
            <div class="form-group">
              <label>Task Type:</label>
              <select id="schedule-task-type">
                <option value="workflow">Execute Workflow</option>
                <option value="pipeline">Run Pipeline</option>
                <option value="sparc">SPARC Mode</option>
                <option value="script">Run Script</option>
                <option value="backup">Backup</option>
                <option value="cleanup">Cleanup</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Schedule Type:</label>
              <select id="schedule-type" onchange="this.updateScheduleOptions()">
                <option value="once">Once</option>
                <option value="recurring">Recurring</option>
                <option value="cron">Cron Expression</option>
              </select>
            </div>
            
            <div id="schedule-options" class="schedule-options">
              <div class="form-group">
                <label>Date & Time:</label>
                <input type="datetime-local" id="schedule-datetime">
              </div>
            </div>
            
            <div class="form-group">
              <label>Task Configuration:</label>
              <textarea id="schedule-config" placeholder="Task configuration in JSON format..."></textarea>
            </div>
            
            <button onclick="this.createScheduledTask()" class="workflow-btn primary">
              📅 Schedule Task
            </button>
          </div>
        </div>
        
        <div class="schedule-calendar">
          <h3>📆 Schedule Calendar</h3>
          <div id="schedule-calendar-view" class="calendar-view">
            <!-- Calendar view will be rendered here -->
          </div>
        </div>
        
        <div class="scheduled-tasks">
          <h3>📋 Scheduled Tasks</h3>
          <div id="scheduled-tasks-list" class="tasks-grid">
            <!-- Scheduled tasks will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create SPARC modes tab content
   */
  createSparcModesTab() {
    return `
      <div class="sparc-modes-management">
        <div class="sparc-launcher">
          <h3>🎯 SPARC Development Modes</h3>
          
          <div class="sparc-form">
            <div class="form-group">
              <label>Select SPARC Mode:</label>
              <select id="sparc-mode" onchange="this.updateSparcDescription()">
                <option value="">Choose a mode...</option>
                <option value="architect">🏗️ Architect - System Design</option>
                <option value="code">💻 Code - Implementation</option>
                <option value="tdd">🧪 TDD - Test-Driven Development</option>
                <option value="debug">🐛 Debug - Issue Resolution</option>
                <option value="security-review">🔒 Security Review</option>
                <option value="docs-writer">📝 Documentation Writer</option>
                <option value="integration">🔗 Integration Specialist</option>
                <option value="monitoring">📊 Post-Deployment Monitoring</option>
                <option value="optimization">⚡ Refinement & Optimization</option>
                <option value="devops">🔧 DevOps Engineer</option>
                <option value="mcp">🎛️ MCP Tool Specialist</option>
                <option value="swarm">🐝 Swarm Orchestrator</option>
                <option value="ask">❓ Interactive Assistant</option>
                <option value="tutorial">🎓 Tutorial Creator</option>
                <option value="generic">🔨 Generic Task Handler</option>
              </select>
            </div>
            
            <div id="sparc-description" class="sparc-description">
              <p>Select a SPARC mode to see its description and capabilities.</p>
            </div>
            
            <div class="form-group">
              <label>Task Description:</label>
              <textarea id="sparc-task" placeholder="Describe the task you want to accomplish..."></textarea>
            </div>
            
            <div class="form-group">
              <label>Options:</label>
              <div class="sparc-options">
                <label><input type="checkbox" id="sparc-parallel"> Run in Parallel</label>
                <label><input type="checkbox" id="sparc-non-interactive"> Non-Interactive Mode</label>
                <label><input type="checkbox" id="sparc-memory"> Use Memory Context</label>
              </div>
            </div>
            
            <button onclick="this.executeSparcMode()" class="workflow-btn primary">
              🚀 Execute SPARC Mode
            </button>
          </div>
        </div>
        
        <div class="sparc-orchestration">
          <h3>🎭 Multi-Mode Orchestration</h3>
          
          <div class="orchestration-builder">
            <h4>Boomerang Pattern</h4>
            <p>Create an iterative development flow where results from one phase inform the next.</p>
            
            <div class="boomerang-phases">
              <div class="phase-item">
                <span class="phase-number">1</span>
                <select class="phase-mode">
                  <option value="ask">Research Phase</option>
                </select>
              </div>
              <div class="phase-arrow">→</div>
              <div class="phase-item">
                <span class="phase-number">2</span>
                <select class="phase-mode">
                  <option value="architect">Design Phase</option>
                </select>
              </div>
              <div class="phase-arrow">→</div>
              <div class="phase-item">
                <span class="phase-number">3</span>
                <select class="phase-mode">
                  <option value="code">Implementation Phase</option>
                </select>
              </div>
              <div class="phase-arrow">→</div>
              <div class="phase-item">
                <span class="phase-number">4</span>
                <select class="phase-mode">
                  <option value="tdd">Testing Phase</option>
                </select>
              </div>
              <div class="phase-arrow">→</div>
              <div class="phase-item">
                <span class="phase-number">5</span>
                <select class="phase-mode">
                  <option value="optimization">Refinement Phase</option>
                </select>
              </div>
              <div class="phase-arrow">↩️</div>
            </div>
            
            <button onclick="this.executeBoomerangPattern()" class="workflow-btn primary">
              🔄 Execute Boomerang Pattern
            </button>
          </div>
        </div>
        
        <div class="sparc-history">
          <h3>📋 SPARC Execution History</h3>
          <div id="sparc-history-list" class="history-list">
            <!-- SPARC execution history will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create batch & parallel tab content
   */
  createBatchTab() {
    return `
      <div class="batch-parallel-management">
        <div class="batch-processor">
          <h3>📦 Batch Processing</h3>
          
          <div class="batch-form">
            <div class="form-group">
              <label>Batch Operation:</label>
              <select id="batch-operation">
                <option value="">Select operation...</option>
                <option value="file_process">File Processing</option>
                <option value="data_transform">Data Transformation</option>
                <option value="code_refactor">Code Refactoring</option>
                <option value="test_execution">Test Execution</option>
                <option value="deployment">Deployment</option>
                <option value="custom">Custom Operation</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Items to Process:</label>
              <textarea id="batch-items" placeholder="Enter items to process (one per line)..."></textarea>
            </div>
            
            <div class="form-group">
              <label>Batch Size:</label>
              <input type="number" id="batch-size" value="10" min="1" max="100">
            </div>
            
            <button onclick="this.executeBatchProcess()" class="workflow-btn primary">
              📦 Execute Batch
            </button>
          </div>
        </div>
        
        <div class="parallel-executor">
          <h3>⚡ Parallel Execution</h3>
          
          <div class="parallel-form">
            <div class="form-group">
              <label>Parallel Tasks:</label>
              <div id="parallel-tasks-list" class="parallel-tasks">
                <div class="parallel-task-item">
                  <input type="text" placeholder="Task description..." class="task-input">
                  <select class="task-type">
                    <option value="workflow">Workflow</option>
                    <option value="sparc">SPARC Mode</option>
                    <option value="script">Script</option>
                  </select>
                </div>
              </div>
              <button onclick="this.addParallelTask()" class="workflow-btn small">
                ➕ Add Task
              </button>
            </div>
            
            <div class="form-group">
              <label>Max Parallel:</label>
              <input type="number" id="max-parallel" value="3" min="1" max="10">
            </div>
            
            <button onclick="this.executeParallelTasks()" class="workflow-btn primary">
              ⚡ Execute Parallel
            </button>
          </div>
        </div>
        
        <div class="execution-monitor">
          <h3>📊 Execution Monitor</h3>
          <div id="execution-monitor-grid" class="monitor-grid">
            <!-- Execution status will be displayed here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create fallback interface without component library
   */
  createFallbackInterface() {
    this.container.innerHTML = `
      <div class="workflow-automation-fallback">
        <h2>🔄 Workflow & Automation Tools</h2>
        <p>Comprehensive workflow automation with 11 integrated tools</p>
        
        <div class="tool-sections">
          <div class="tool-section">
            <h3>🔄 Workflow Management</h3>
            <button onclick="this.quickAction('workflow_create')">Create Workflow</button>
            <button onclick="this.quickAction('workflow_execute')">Execute Workflow</button>
            <button onclick="this.quickAction('workflow_template')">Manage Templates</button>
            <button onclick="this.quickAction('workflow_export')">Export Workflow</button>
          </div>
          
          <div class="tool-section">
            <h3>⚡ Automation & Pipelines</h3>
            <button onclick="this.quickAction('automation_setup')">Setup Automation</button>
            <button onclick="this.quickAction('pipeline_create')">Create Pipeline</button>
            <button onclick="this.quickAction('trigger_setup')">Configure Triggers</button>
            <button onclick="this.quickAction('scheduler_manage')">Manage Scheduler</button>
          </div>
          
          <div class="tool-section">
            <h3>🎯 Execution Modes</h3>
            <button onclick="this.quickAction('sparc_mode')">SPARC Modes</button>
            <button onclick="this.quickAction('batch_process')">Batch Processing</button>
            <button onclick="this.quickAction('parallel_execute')">Parallel Execution</button>
            <button onclick="this.quickAction('task_orchestrate')">Task Orchestration</button>
          </div>
        </div>
        
        <div id="workflow-output" class="output-area">
          <h3>📊 Output</h3>
          <pre id="output-content">Ready for workflow operations...</pre>
        </div>
      </div>
    `;
  }

  /**
   * Render terminal mode
   */
  renderTerminalMode(params) {
    console.log('\n🔄 Workflow & Automation Tools');
    console.log('═'.repeat(50));
    console.log('Available Tools (11):');
    console.log('  🔄 workflow_create  - Create custom workflows');
    console.log('  ▶️ workflow_execute - Execute workflows');
    console.log('  ⚡ automation_setup - Setup automation rules');
    console.log('  🚀 pipeline_create  - Create CI/CD pipelines');
    console.log('  📅 scheduler_manage - Manage task scheduling');
    console.log('  🎯 trigger_setup    - Configure event triggers');
    console.log('  📋 workflow_template- Manage templates');
    console.log('  📦 batch_process    - Batch processing');
    console.log('  ⚡ parallel_execute - Parallel execution');
    console.log('  🎯 sparc_mode       - SPARC development modes');
    console.log('  🎭 task_orchestrate - Task orchestration');
    console.log('═'.repeat(50));

    if (params.tool) {
      console.log(`\n🔧 Executing: ${params.tool}`);
      this.quickAction(params.tool, params);
    }
  }

  /**
   * Quick action handler
   */
  async quickAction(toolName, params = {}) {
    try {
      console.log(`🔧 Executing ${toolName}...`);

      // Emit tool execution event
      this.eventBus.emit('tool:execute', {
        tool: toolName,
        params: params,
        source: 'workflow-view',
      });

      // Handle specific tool actions
      switch (toolName) {
        case 'workflow_create':
          await this.handleWorkflowCreate(params);
          break;
        case 'automation_setup':
          await this.handleAutomationSetup(params);
          break;
        case 'sparc_mode':
          await this.handleSparcMode(params);
          break;
        default:
          console.log(`Tool ${toolName} executed`);
      }
    } catch (error) {
      console.error(`❌ Error executing ${toolName}:`, error);
    }
  }

  /**
   * Handle workflow creation
   */
  async handleWorkflowCreate(params) {
    const workflowParams = {
      name: params.name || 'New Workflow',
      steps: params.steps || [],
      triggers: params.triggers || [],
    };

    console.log('🔄 Creating workflow with parameters:', workflowParams);

    // Update UI if in browser mode
    if (this.container) {
      const listEl = document.getElementById('workflows-list');
      if (listEl) {
        const workflowCard = this.createWorkflowCard(workflowParams);
        listEl.appendChild(workflowCard);
      }
    }
  }

  /**
   * Handle automation setup
   */
  async handleAutomationSetup(params) {
    const automationParams = {
      rules: params.rules || [],
    };

    console.log('⚡ Setting up automation with parameters:', automationParams);

    // Update UI if in browser mode
    if (this.container) {
      const listEl = document.getElementById('automation-rules-list');
      if (listEl) {
        const ruleCard = this.createRuleCard(automationParams);
        listEl.appendChild(ruleCard);
      }
    }
  }

  /**
   * Handle SPARC mode execution
   */
  async handleSparcMode(params) {
    const sparcParams = {
      mode: params.mode || 'code',
      task_description: params.task_description || 'Build feature',
      options: params.options || {},
    };

    console.log('🎯 Executing SPARC mode with parameters:', sparcParams);

    // Update UI if in browser mode
    if (this.container) {
      const historyEl = document.getElementById('sparc-history-list');
      if (historyEl) {
        const historyItem = this.createSparcHistoryItem(sparcParams);
        historyEl.appendChild(historyItem);
      }
    }
  }

  /**
   * Create workflow card element
   */
  createWorkflowCard(workflow) {
    const card = document.createElement('div');
    card.className = 'workflow-card';
    card.innerHTML = `
      <div class="workflow-header">
        <h4>${workflow.name}</h4>
        <span class="workflow-status">Active</span>
      </div>
      <div class="workflow-stats">
        <span>${workflow.steps.length} steps</span>
        <span>${workflow.triggers.length} triggers</span>
      </div>
      <div class="workflow-actions">
        <button class="workflow-btn small">Execute</button>
        <button class="workflow-btn small">Edit</button>
      </div>
    `;
    return card;
  }

  /**
   * Create rule card element
   */
  createRuleCard(rule) {
    const card = document.createElement('div');
    card.className = 'rule-card';
    card.innerHTML = `
      <div class="rule-header">
        <h4>Automation Rule</h4>
        <span class="rule-status">Active</span>
      </div>
      <div class="rule-info">
        <span>${rule.rules.length} conditions</span>
      </div>
      <div class="rule-actions">
        <button class="workflow-btn small">Toggle</button>
        <button class="workflow-btn small">Edit</button>
      </div>
    `;
    return card;
  }

  /**
   * Create SPARC history item
   */
  createSparcHistoryItem(execution) {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <span class="history-time">${new Date().toLocaleTimeString()}</span>
      <span class="history-mode">${execution.mode}</span>
      <span class="history-task">${execution.task_description.substring(0, 50)}...</span>
    `;
    return item;
  }

  /**
   * Initialize drag and drop for workflow builder
   */
  initializeDragDrop() {
    if (!this.container) return;

    // Setup draggable components
    const draggables = this.container.querySelectorAll('.draggable-component');
    draggables.forEach((draggable) => {
      draggable.addEventListener('dragstart', this.handleDragStart.bind(this));
      draggable.addEventListener('dragend', this.handleDragEnd.bind(this));
    });

    // Setup drop zones
    const canvas = document.getElementById('workflow-canvas');
    if (canvas) {
      canvas.addEventListener('dragover', this.handleDragOver.bind(this));
      canvas.addEventListener('drop', this.handleDrop.bind(this));
    }
  }

  /**
   * Handle drag start
   */
  handleDragStart(e) {
    this.draggedElement = e.target;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('componentType', e.target.dataset.type);
  }

  /**
   * Handle drag end
   */
  handleDragEnd(e) {
    e.target.classList.remove('dragging');
    this.draggedElement = null;
  }

  /**
   * Handle drag over
   */
  handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  /**
   * Handle drop
   */
  handleDrop(e) {
    e.preventDefault();
    const componentType = e.dataTransfer.getData('componentType');
    this.addWorkflowComponent(componentType, e);
  }

  /**
   * Add workflow component to canvas
   */
  addWorkflowComponent(type, event) {
    const canvas = document.getElementById('workflow-canvas');
    if (!canvas) return;

    const component = document.createElement('div');
    component.className = 'workflow-component';
    component.dataset.type = type;

    const icons = {
      trigger: '🎯',
      action: '⚡',
      condition: '🔀',
      loop: '🔁',
      parallel: '🔀',
      sparc: '🎯',
    };

    component.innerHTML = `
      <div class="component-header">
        <span class="component-icon">${icons[type]}</span>
        <span class="component-type">${type}</span>
      </div>
      <div class="component-body">
        <input type="text" placeholder="Configure ${type}..." class="component-config">
      </div>
      <div class="component-connectors">
        <div class="connector input"></div>
        <div class="connector output"></div>
      </div>
    `;

    canvas.appendChild(component);
  }

  /**
   * Update SPARC mode description
   */
  updateSparcDescription() {
    const modeSelect = document.getElementById('sparc-mode');
    const descriptionEl = document.getElementById('sparc-description');

    if (!modeSelect || !descriptionEl) return;

    const descriptions = {
      architect: '🏗️ Design system architecture and create technical specifications',
      code: '💻 Implement features with clean, maintainable code',
      tdd: '🧪 Write tests first, then implement functionality',
      debug: '🐛 Identify and fix bugs systematically',
      'security-review': '🔒 Analyze code for security vulnerabilities',
      'docs-writer': '📝 Create comprehensive documentation',
      integration: '🔗 Connect systems and APIs seamlessly',
      monitoring: '📊 Setup monitoring and observability',
      optimization: '⚡ Improve performance and efficiency',
      devops: '🔧 Automate deployment and infrastructure',
      mcp: '🎛️ Integrate MCP tools and protocols',
      swarm: '🐝 Orchestrate multi-agent workflows',
      ask: '❓ Interactive problem-solving assistant',
      tutorial: '🎓 Create step-by-step tutorials',
      generic: '🔨 Handle any development task',
    };

    const selectedMode = modeSelect.value;
    descriptionEl.innerHTML = `<p>${descriptions[selectedMode] || 'Select a SPARC mode to see its description.'}</p>`;
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Listen for tool results
    this.eventBus.on('tool:executed', (data) => {
      if (data.source === 'workflow-view') {
        this.handleToolResult(data);
      }
    });

    // Listen for real-time updates
    this.eventBus.on('ui:real-time:update', () => {
      this.updateStats();
    });

    // Listen for theme changes
    this.eventBus.on('ui:theme:changed', (theme) => {
      this.updateTheme(theme);
    });

    // Initialize drag and drop when view is rendered
    this.eventBus.on('view:rendered', () => {
      this.initializeDragDrop();
    });
  }

  /**
   * Handle tool execution results
   */
  handleToolResult(data) {
    console.log(`✅ Tool ${data.tool} completed:`, data.result);

    // Update UI based on result
    if (this.container) {
      this.updateUIWithResult(data.tool, data.result);
    }
  }

  /**
   * Update UI with tool results
   */
  updateUIWithResult(toolName, result) {
    // Update activity log
    const activityLog = document.getElementById('workflow-activity-log');
    if (activityLog) {
      const activityItem = document.createElement('div');
      activityItem.className = 'activity-item';
      activityItem.innerHTML = `
        <span class="activity-time">${new Date().toLocaleTimeString()}</span>
        <span class="activity-desc">${toolName} executed successfully</span>
      `;
      activityLog.insertBefore(activityItem, activityLog.firstChild);
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    // Update workflow count
    const workflowsStatEl = document.getElementById('workflows-stat');
    if (workflowsStatEl) {
      const valueEl = workflowsStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.workflows.size;
    }

    // Update pipeline count
    const pipelinesStatEl = document.getElementById('pipelines-stat');
    if (pipelinesStatEl) {
      const valueEl = pipelinesStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.pipelines.size;
    }

    // Update automation rules count
    const rulesStatEl = document.getElementById('rules-stat');
    if (rulesStatEl) {
      const valueEl = rulesStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.automationRules.size;
    }

    // Update scheduled tasks count
    const scheduledStatEl = document.getElementById('scheduled-stat');
    if (scheduledStatEl) {
      const valueEl = scheduledStatEl.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.scheduledTasks.size;
    }
  }

  /**
   * Update theme
   */
  updateTheme(theme) {
    if (this.container) {
      this.container.classList.remove('theme-dark', 'theme-light');
      this.container.classList.add(`theme-${theme}`);
    }
  }

  /**
   * Destroy view and cleanup
   */
  destroy() {
    // Clear any intervals or timeouts
    // Remove event listeners
    // Clean up resources
    console.log('🔄 Workflow & Automation View destroyed');
  }
}

// Add workflow specific styles
if (typeof document !== 'undefined') {
  const workflowStyles = document.createElement('style');
  workflowStyles.textContent = `
    .workflow-overview {
      padding: 20px;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .stat-card {
      display: flex;
      align-items: center;
      background: #2a2a2a;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #444;
    }
    
    .stat-icon {
      font-size: 24px;
      margin-right: 12px;
    }
    
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #00d4ff;
    }
    
    .stat-label {
      color: #888;
      font-size: 14px;
    }
    
    .workflow-tools {
      margin: 24px 0;
    }
    
    .tool-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .workflow-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .workflow-btn.primary {
      background: #00d4ff;
      color: #000;
    }
    
    .workflow-btn.primary:hover {
      background: #00b8e6;
    }
    
    .workflow-btn.secondary {
      background: #444;
      color: #fff;
    }
    
    .workflow-btn.secondary:hover {
      background: #555;
    }
    
    .workflow-btn.small {
      padding: 6px 12px;
      font-size: 14px;
    }
    
    .workflow-btn.danger {
      background: #ff4444;
      color: #fff;
    }
    
    .builder-container {
      display: grid;
      grid-template-columns: 200px 1fr 250px;
      gap: 16px;
      height: 500px;
      margin: 20px 0;
    }
    
    .builder-sidebar {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      overflow-y: auto;
    }
    
    .component-palette {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .draggable-component {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 8px 12px;
      cursor: move;
      transition: all 0.2s ease;
    }
    
    .draggable-component:hover {
      background: #333;
      border-color: #00d4ff;
    }
    
    .draggable-component.dragging {
      opacity: 0.5;
    }
    
    .builder-canvas {
      background: #1a1a1a;
      border: 2px dashed #444;
      border-radius: 8px;
      padding: 16px;
      overflow: auto;
      position: relative;
    }
    
    .canvas-grid {
      min-height: 100%;
      position: relative;
    }
    
    .drop-zone {
      border: 2px dashed #666;
      border-radius: 8px;
      padding: 40px;
      text-align: center;
      color: #888;
      transition: all 0.2s ease;
    }
    
    .drop-zone.drag-over {
      border-color: #00d4ff;
      background: rgba(0, 212, 255, 0.1);
    }
    
    .workflow-component {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 12px;
      margin: 8px 0;
      position: relative;
    }
    
    .component-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    
    .component-config {
      width: 100%;
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .builder-properties {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      overflow-y: auto;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 4px;
      color: #fff;
      font-weight: 500;
    }
    
    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 8px 12px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .form-group textarea {
      height: 100px;
      resize: vertical;
    }
    
    .sparc-description {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }
    
    .boomerang-phases {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 20px 0;
      padding: 20px;
      background: #2a2a2a;
      border-radius: 8px;
      overflow-x: auto;
    }
    
    .phase-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    
    .phase-number {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: #00d4ff;
      color: #000;
      border-radius: 50%;
      font-weight: bold;
    }
    
    .phase-arrow {
      font-size: 24px;
      color: #00d4ff;
    }
    
    .phase-mode {
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .pipeline-stage {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    
    .pipeline-stage input {
      width: 100%;
      margin-bottom: 8px;
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .pipeline-stage textarea {
      width: 100%;
      height: 60px;
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
      resize: vertical;
    }
    
    .monitor-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    
    .workflows-grid,
    .rules-grid,
    .tasks-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
    }
    
    .workflow-card,
    .rule-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
    }
    
    .workflow-header,
    .rule-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .workflow-status,
    .rule-status {
      font-size: 12px;
      padding: 4px 8px;
      background: #00d4ff;
      color: #000;
      border-radius: 4px;
    }
    
    .activity-list,
    .history-list {
      max-height: 300px;
      overflow-y: auto;
    }
    
    .activity-item,
    .history-item {
      display: flex;
      gap: 12px;
      padding: 8px;
      border-bottom: 1px solid #333;
    }
    
    .activity-time,
    .history-time {
      color: #888;
      font-size: 14px;
    }
    
    .event-checkboxes {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .event-checkboxes label {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #fff;
    }
    
    .parallel-tasks {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .parallel-task-item {
      display: flex;
      gap: 8px;
    }
    
    .task-input {
      flex: 1;
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
    
    .task-type {
      padding: 6px;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      color: #fff;
    }
  `;
  document.head.appendChild(workflowStyles);
}

export default WorkflowAutomationView;
export { WorkflowAutomationView };
