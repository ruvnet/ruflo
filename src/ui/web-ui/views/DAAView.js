/**
 * Dynamic Agent Architecture (DAA) View
 * Interface for managing dynamic agents, resources, lifecycle, and communication
 * Implements all 8 DAA management tools
 */

export default class DAAView {
  constructor(container, eventBus, viewConfig) {
    this.container = container;
    this.eventBus = eventBus;
    this.viewConfig = viewConfig;
    this.componentLibrary = null;

    // DAA State Management
    this.agents = new Map();
    this.resources = new Map();
    this.communications = [];
    this.consensusHistory = [];
    this.faultEvents = [];
    this.optimizations = [];

    this.currentTab = 'overview';
    this.isInitialized = false;
  }

  /**
   * Initialize the DAA view
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
      this.createDAAInterface();
    } else {
      // Terminal mode
      this.renderTerminalMode(params);
    }
  }

  /**
   * Create DAA interface for browser
   */
  createDAAInterface() {
    // Create tab container with all DAA sections
    const tabs = [
      { label: '📊 Overview', content: this.createOverviewTab() },
      { label: '🤖 Agent Management', content: this.createAgentManagementTab() },
      { label: '🔀 Capability Matching', content: this.createCapabilityMatchingTab() },
      { label: '📦 Resource Allocation', content: this.createResourceAllocationTab() },
      { label: '🔄 Lifecycle Management', content: this.createLifecycleTab() },
      { label: '📡 Communication', content: this.createCommunicationTab() },
      { label: '🤝 Consensus', content: this.createConsensusTab() },
      { label: '🛡️ Fault Tolerance', content: this.createFaultToleranceTab() },
      { label: '⚡ Optimization', content: this.createOptimizationTab() },
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
      <div class="daa-overview">
        <div class="stats-grid">
          <div id="agents-stat" class="stat-card">
            <div class="stat-icon">🤖</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Active Agents</div>
            </div>
          </div>
          <div id="resources-stat" class="stat-card">
            <div class="stat-icon">📦</div>
            <div class="stat-content">
              <div class="stat-value">0%</div>
              <div class="stat-label">Resource Usage</div>
            </div>
          </div>
          <div id="communications-stat" class="stat-card">
            <div class="stat-icon">📡</div>
            <div class="stat-content">
              <div class="stat-value">0</div>
              <div class="stat-label">Messages/min</div>
            </div>
          </div>
          <div id="health-stat" class="stat-card">
            <div class="stat-icon">💚</div>
            <div class="stat-content">
              <div class="stat-value">100%</div>
              <div class="stat-label">System Health</div>
            </div>
          </div>
        </div>
        
        <div class="daa-tools">
          <h3>🔧 Quick Actions</h3>
          <div class="tool-buttons">
            <button onclick="this.quickCreateAgent()" class="daa-btn primary">
              🤖 Create Agent
            </button>
            <button onclick="this.quickMatchCapabilities()" class="daa-btn secondary">
              🔀 Match Capabilities
            </button>
            <button onclick="this.quickAllocateResources()" class="daa-btn secondary">
              📦 Allocate Resources
            </button>
            <button onclick="this.quickHealthCheck()" class="daa-btn secondary">
              🏥 Health Check
            </button>
          </div>
        </div>

        <div class="agent-visualization">
          <h3>🌐 Agent Network Visualization</h3>
          <div id="agent-network-viz" class="network-container">
            <canvas id="agent-canvas" width="800" height="400"></canvas>
          </div>
        </div>

        <div class="recent-activity">
          <h3>📈 Recent DAA Activity</h3>
          <div id="daa-activity-log" class="activity-list">
            <div class="activity-item">
              <span class="activity-time">--:--</span>
              <span class="activity-desc">No recent DAA activity</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create agent management tab (daa_agent_create)
   */
  createAgentManagementTab() {
    return `
      <div class="daa-agent-management">
        <div class="agent-creation-form">
          <h3>🤖 Create Dynamic Agent</h3>
          
          <div class="form-group">
            <label>Agent Type:</label>
            <select id="agent-type">
              <option value="coordinator">Coordinator</option>
              <option value="worker">Worker</option>
              <option value="analyzer">Analyzer</option>
              <option value="optimizer">Optimizer</option>
              <option value="monitor">Monitor</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Agent Name:</label>
            <input type="text" id="agent-name" placeholder="Enter agent name...">
          </div>
          
          <div class="form-group">
            <label>Capabilities (comma-separated):</label>
            <input type="text" id="agent-capabilities" placeholder="e.g., compute, analyze, coordinate">
          </div>
          
          <div class="form-group">
            <label>Initial Resources:</label>
            <div class="resource-inputs">
              <input type="number" id="cpu-allocation" placeholder="CPU %" min="0" max="100">
              <input type="number" id="memory-allocation" placeholder="Memory MB" min="0">
              <input type="number" id="priority-level" placeholder="Priority (1-10)" min="1" max="10">
            </div>
          </div>
          
          <button onclick="this.createAgent()" class="daa-btn primary">
            🚀 Create Agent
          </button>
        </div>
        
        <div class="active-agents">
          <h3>📋 Active Agents</h3>
          <div id="agents-list" class="agents-grid">
            <!-- Agent cards will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create capability matching tab (daa_capability_match)
   */
  createCapabilityMatchingTab() {
    return `
      <div class="daa-capability-matching">
        <div class="capability-matcher">
          <h3>🔀 Capability Matching</h3>
          
          <div class="form-group">
            <label>Task Requirements:</label>
            <textarea id="task-requirements" placeholder="Enter required capabilities...
Example:
- compute: high
- memory: 2GB
- skills: data_analysis, optimization
- availability: immediate"></textarea>
          </div>
          
          <div class="form-group">
            <label>Matching Strategy:</label>
            <select id="matching-strategy">
              <option value="best-fit">Best Fit</option>
              <option value="first-fit">First Available</option>
              <option value="load-balanced">Load Balanced</option>
              <option value="priority-based">Priority Based</option>
            </select>
          </div>
          
          <button onclick="this.matchCapabilities()" class="daa-btn primary">
            🔍 Find Matching Agents
          </button>
        </div>
        
        <div class="matching-results">
          <h3>📊 Matching Results</h3>
          <div id="capability-matches" class="matches-display">
            <div class="no-matches">No matches found yet</div>
          </div>
        </div>
        
        <div class="capability-matrix">
          <h3>🗂️ Capability Matrix</h3>
          <div id="capability-matrix-view" class="matrix-container">
            <!-- Capability matrix will be rendered here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create resource allocation tab (daa_resource_alloc)
   */
  createResourceAllocationTab() {
    return `
      <div class="daa-resource-allocation">
        <div class="resource-allocator">
          <h3>📦 Resource Allocation</h3>
          
          <div class="resource-overview">
            <h4>System Resources</h4>
            <div class="resource-meters">
              <div class="resource-meter">
                <label>CPU Usage</label>
                <div class="meter-bar">
                  <div id="cpu-usage-bar" class="meter-fill" style="width: 45%"></div>
                  <span class="meter-text">45%</span>
                </div>
              </div>
              <div class="resource-meter">
                <label>Memory Usage</label>
                <div class="meter-bar">
                  <div id="memory-usage-bar" class="meter-fill" style="width: 60%"></div>
                  <span class="meter-text">60%</span>
                </div>
              </div>
              <div class="resource-meter">
                <label>Network Bandwidth</label>
                <div class="meter-bar">
                  <div id="network-usage-bar" class="meter-fill" style="width: 30%"></div>
                  <span class="meter-text">30%</span>
                </div>
              </div>
            </div>
          </div>
          
          <div class="allocation-form">
            <h4>Allocate Resources</h4>
            
            <div class="form-group">
              <label>Target Agent:</label>
              <select id="allocation-target">
                <option value="">Select agent...</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Resource Type:</label>
              <select id="resource-type">
                <option value="cpu">CPU</option>
                <option value="memory">Memory</option>
                <option value="storage">Storage</option>
                <option value="network">Network</option>
                <option value="custom">Custom Resource</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Allocation Amount:</label>
              <input type="number" id="allocation-amount" placeholder="Amount to allocate">
            </div>
            
            <button onclick="this.allocateResources()" class="daa-btn primary">
              📤 Allocate Resources
            </button>
          </div>
        </div>
        
        <div class="allocation-history">
          <h3>📋 Allocation History</h3>
          <div id="allocation-history-list" class="history-list">
            <!-- Allocation history will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create lifecycle management tab (daa_lifecycle_manage)
   */
  createLifecycleTab() {
    return `
      <div class="daa-lifecycle-management">
        <div class="lifecycle-controls">
          <h3>🔄 Agent Lifecycle Management</h3>
          
          <div class="lifecycle-actions">
            <div class="form-group">
              <label>Select Agent:</label>
              <select id="lifecycle-agent">
                <option value="">Choose agent...</option>
              </select>
            </div>
            
            <div class="lifecycle-buttons">
              <button onclick="this.startAgent()" class="daa-btn success">
                ▶️ Start
              </button>
              <button onclick="this.pauseAgent()" class="daa-btn warning">
                ⏸️ Pause
              </button>
              <button onclick="this.stopAgent()" class="daa-btn danger">
                ⏹️ Stop
              </button>
              <button onclick="this.restartAgent()" class="daa-btn info">
                🔄 Restart
              </button>
              <button onclick="this.upgradeAgent()" class="daa-btn primary">
                ⬆️ Upgrade
              </button>
              <button onclick="this.hibernateAgent()" class="daa-btn secondary">
                💤 Hibernate
              </button>
            </div>
          </div>
        </div>
        
        <div class="lifecycle-visualization">
          <h3>📊 Lifecycle States</h3>
          <div id="lifecycle-diagram" class="lifecycle-viz">
            <!-- State diagram will be rendered here -->
            <svg width="600" height="400" id="lifecycle-svg">
              <!-- SVG lifecycle diagram -->
            </svg>
          </div>
        </div>
        
        <div class="lifecycle-events">
          <h3>📋 Lifecycle Events</h3>
          <div id="lifecycle-events-list" class="events-list">
            <!-- Lifecycle events will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create communication tab (daa_communication)
   */
  createCommunicationTab() {
    return `
      <div class="daa-communication">
        <div class="communication-panel">
          <h3>📡 Inter-Agent Communication</h3>
          
          <div class="message-composer">
            <h4>Compose Message</h4>
            
            <div class="form-group">
              <label>From Agent:</label>
              <select id="comm-from-agent">
                <option value="">Select sender...</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>To Agent(s):</label>
              <select id="comm-to-agents" multiple>
                <option value="broadcast">📢 Broadcast to All</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Message Type:</label>
              <select id="comm-message-type">
                <option value="command">Command</option>
                <option value="query">Query</option>
                <option value="response">Response</option>
                <option value="notification">Notification</option>
                <option value="sync">Synchronization</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Message Content:</label>
              <textarea id="comm-message-content" placeholder="Enter message content..."></textarea>
            </div>
            
            <button onclick="this.sendMessage()" class="daa-btn primary">
              📤 Send Message
            </button>
          </div>
        </div>
        
        <div class="communication-log">
          <h3>📜 Communication Log</h3>
          <div class="log-controls">
            <button onclick="this.filterMessages('all')" class="filter-btn active">All</button>
            <button onclick="this.filterMessages('commands')" class="filter-btn">Commands</button>
            <button onclick="this.filterMessages('queries')" class="filter-btn">Queries</button>
            <button onclick="this.filterMessages('notifications')" class="filter-btn">Notifications</button>
          </div>
          <div id="communication-log-list" class="comm-log">
            <!-- Communication messages will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create consensus tab (daa_consensus)
   */
  createConsensusTab() {
    return `
      <div class="daa-consensus">
        <div class="consensus-panel">
          <h3>🤝 Consensus Mechanisms</h3>
          
          <div class="consensus-proposal">
            <h4>Create Proposal</h4>
            
            <div class="form-group">
              <label>Proposal Type:</label>
              <select id="consensus-type">
                <option value="resource-allocation">Resource Allocation Change</option>
                <option value="task-assignment">Task Assignment</option>
                <option value="policy-update">Policy Update</option>
                <option value="agent-addition">Add New Agent</option>
                <option value="agent-removal">Remove Agent</option>
                <option value="custom">Custom Proposal</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Proposal Description:</label>
              <textarea id="proposal-description" placeholder="Describe the proposal..."></textarea>
            </div>
            
            <div class="form-group">
              <label>Consensus Algorithm:</label>
              <select id="consensus-algorithm">
                <option value="majority">Simple Majority</option>
                <option value="supermajority">Super Majority (2/3)</option>
                <option value="unanimous">Unanimous</option>
                <option value="weighted">Weighted Voting</option>
                <option value="raft">Raft Consensus</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Voting Timeout (seconds):</label>
              <input type="number" id="voting-timeout" value="60" min="10">
            </div>
            
            <button onclick="this.createProposal()" class="daa-btn primary">
              📋 Create Proposal
            </button>
          </div>
        </div>
        
        <div class="active-proposals">
          <h3>🗳️ Active Proposals</h3>
          <div id="proposals-list" class="proposals-container">
            <!-- Active proposals will be populated here -->
          </div>
        </div>
        
        <div class="consensus-history">
          <h3>📊 Consensus History</h3>
          <div id="consensus-history-list" class="consensus-log">
            <!-- Consensus history will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create fault tolerance tab (daa_fault_tolerance)
   */
  createFaultToleranceTab() {
    return `
      <div class="daa-fault-tolerance">
        <div class="fault-monitoring">
          <h3>🛡️ Fault Tolerance & Recovery</h3>
          
          <div class="health-overview">
            <h4>System Health Status</h4>
            <div class="health-indicators">
              <div class="health-indicator healthy">
                <span class="indicator-icon">✅</span>
                <span class="indicator-label">Healthy Agents</span>
                <span id="healthy-count" class="indicator-value">0</span>
              </div>
              <div class="health-indicator warning">
                <span class="indicator-icon">⚠️</span>
                <span class="indicator-label">Warning State</span>
                <span id="warning-count" class="indicator-value">0</span>
              </div>
              <div class="health-indicator critical">
                <span class="indicator-icon">🚨</span>
                <span class="indicator-label">Critical Issues</span>
                <span id="critical-count" class="indicator-value">0</span>
              </div>
            </div>
          </div>
          
          <div class="recovery-strategies">
            <h4>Recovery Strategies</h4>
            
            <div class="form-group">
              <label>Fault Detection Method:</label>
              <select id="fault-detection">
                <option value="heartbeat">Heartbeat Monitoring</option>
                <option value="performance">Performance Metrics</option>
                <option value="consensus">Consensus Validation</option>
                <option value="combined">Combined Detection</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Recovery Strategy:</label>
              <select id="recovery-strategy">
                <option value="restart">Automatic Restart</option>
                <option value="failover">Failover to Backup</option>
                <option value="redistribute">Redistribute Load</option>
                <option value="isolate">Isolate and Diagnose</option>
                <option value="manual">Manual Intervention</option>
              </select>
            </div>
            
            <button onclick="this.configureRecovery()" class="daa-btn primary">
              🔧 Configure Recovery
            </button>
            <button onclick="this.runHealthCheck()" class="daa-btn secondary">
              🏥 Run Health Check
            </button>
          </div>
        </div>
        
        <div class="fault-events">
          <h3>🚨 Fault Events</h3>
          <div id="fault-events-list" class="fault-log">
            <!-- Fault events will be populated here -->
          </div>
        </div>
        
        <div class="recovery-actions">
          <h3>🔧 Recovery Actions</h3>
          <div id="recovery-actions-list" class="recovery-log">
            <!-- Recovery actions will be populated here -->
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Create optimization tab (daa_optimization)
   */
  createOptimizationTab() {
    return `
      <div class="daa-optimization">
        <div class="optimization-panel">
          <h3>⚡ Performance Optimization</h3>
          
          <div class="optimization-metrics">
            <h4>Current Performance Metrics</h4>
            <div class="metrics-grid">
              <div class="metric-card">
                <div class="metric-label">Response Time</div>
                <div id="response-time" class="metric-value">-- ms</div>
                <div class="metric-trend">📈 +5%</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Throughput</div>
                <div id="throughput" class="metric-value">-- req/s</div>
                <div class="metric-trend">📉 -2%</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Resource Efficiency</div>
                <div id="efficiency" class="metric-value">--%</div>
                <div class="metric-trend">➡️ 0%</div>
              </div>
              <div class="metric-card">
                <div class="metric-label">Agent Utilization</div>
                <div id="utilization" class="metric-value">--%</div>
                <div class="metric-trend">📈 +8%</div>
              </div>
            </div>
          </div>
          
          <div class="optimization-controls">
            <h4>Optimization Options</h4>
            
            <div class="form-group">
              <label>Optimization Target:</label>
              <select id="optimization-target">
                <option value="response-time">Minimize Response Time</option>
                <option value="throughput">Maximize Throughput</option>
                <option value="resource-usage">Minimize Resource Usage</option>
                <option value="balanced">Balanced Optimization</option>
                <option value="cost">Cost Optimization</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Optimization Algorithm:</label>
              <select id="optimization-algorithm">
                <option value="genetic">Genetic Algorithm</option>
                <option value="simulated-annealing">Simulated Annealing</option>
                <option value="particle-swarm">Particle Swarm</option>
                <option value="gradient-descent">Gradient Descent</option>
                <option value="reinforcement">Reinforcement Learning</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Constraints:</label>
              <textarea id="optimization-constraints" placeholder="Define constraints...
Example:
- max_cpu_usage: 80%
- min_agents: 3
- max_response_time: 100ms"></textarea>
            </div>
            
            <button onclick="this.startOptimization()" class="daa-btn primary">
              🚀 Start Optimization
            </button>
            <button onclick="this.analyzePerformance()" class="daa-btn secondary">
              📊 Analyze Performance
            </button>
          </div>
        </div>
        
        <div class="optimization-results">
          <h3>📈 Optimization Results</h3>
          <div id="optimization-chart" class="chart-container">
            <!-- Optimization results chart will be rendered here -->
          </div>
        </div>
        
        <div class="optimization-history">
          <h3>📋 Optimization History</h3>
          <div id="optimization-history-list" class="optimization-log">
            <!-- Optimization history will be populated here -->
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
      <div class="daa-fallback">
        <h2>🤖 Dynamic Agent Architecture</h2>
        <p>Complete DAA management interface with 8 integrated tools</p>
        
        <div class="tool-sections">
          <div class="tool-section">
            <h3>🤖 Agent Management</h3>
            <button onclick="this.quickAction('daa_agent_create')">Create Agent</button>
            <button onclick="this.quickAction('daa_lifecycle_manage')">Lifecycle Management</button>
          </div>
          
          <div class="tool-section">
            <h3>📦 Resource Management</h3>
            <button onclick="this.quickAction('daa_resource_alloc')">Allocate Resources</button>
            <button onclick="this.quickAction('daa_capability_match')">Match Capabilities</button>
          </div>
          
          <div class="tool-section">
            <h3>📡 Coordination</h3>
            <button onclick="this.quickAction('daa_communication')">Agent Communication</button>
            <button onclick="this.quickAction('daa_consensus')">Consensus Mechanisms</button>
          </div>
          
          <div class="tool-section">
            <h3>🛡️ Reliability</h3>
            <button onclick="this.quickAction('daa_fault_tolerance')">Fault Tolerance</button>
            <button onclick="this.quickAction('daa_optimization')">Performance Optimization</button>
          </div>
        </div>
        
        <div id="daa-output" class="output-area">
          <h3>📊 Output</h3>
          <pre id="output-content">Ready for DAA operations...</pre>
        </div>
      </div>
    `;
  }

  /**
   * Render terminal mode
   */
  renderTerminalMode(params) {
    console.log('\n🤖 Dynamic Agent Architecture');
    console.log('═'.repeat(50));
    console.log('Available Tools (8):');
    console.log('  🤖 daa_agent_create      - Create dynamic agents');
    console.log('  🔀 daa_capability_match  - Match capabilities');
    console.log('  📦 daa_resource_alloc    - Allocate resources');
    console.log('  🔄 daa_lifecycle_manage  - Lifecycle management');
    console.log('  📡 daa_communication     - Inter-agent comm');
    console.log('  🤝 daa_consensus         - Consensus mechanisms');
    console.log('  🛡️ daa_fault_tolerance   - Fault recovery');
    console.log('  ⚡ daa_optimization      - Performance optimization');
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
        source: 'daa-view',
      });

      // Handle specific tool actions
      switch (toolName) {
        case 'daa_agent_create':
          await this.handleAgentCreate(params);
          break;
        case 'daa_capability_match':
          await this.handleCapabilityMatch(params);
          break;
        case 'daa_resource_alloc':
          await this.handleResourceAllocation(params);
          break;
        case 'daa_lifecycle_manage':
          await this.handleLifecycleManagement(params);
          break;
        case 'daa_communication':
          await this.handleCommunication(params);
          break;
        case 'daa_consensus':
          await this.handleConsensus(params);
          break;
        case 'daa_fault_tolerance':
          await this.handleFaultTolerance(params);
          break;
        case 'daa_optimization':
          await this.handleOptimization(params);
          break;
        default:
          console.log(`Tool ${toolName} executed`);
      }
    } catch (error) {
      console.error(`❌ Error executing ${toolName}:`, error);
    }
  }

  /**
   * Handle agent creation
   */
  async handleAgentCreate(params) {
    const agentParams = {
      agent_type: params.agent_type || 'worker',
      capabilities: params.capabilities || ['compute', 'analyze'],
      resources: params.resources || { cpu: 10, memory: 512 },
    };

    console.log('🤖 Creating dynamic agent with parameters:', agentParams);

    // Update UI if in browser mode
    if (this.container) {
      this.updateAgentsList({
        id: `agent-${Date.now()}`,
        type: agentParams.agent_type,
        capabilities: agentParams.capabilities,
        status: 'initializing',
      });
    }
  }

  /**
   * Handle capability matching
   */
  async handleCapabilityMatch(params) {
    const matchParams = {
      task_requirements: params.task_requirements || ['compute', 'memory'],
      available_agents: Array.from(this.agents.values()),
    };

    console.log('🔀 Matching capabilities with parameters:', matchParams);

    // Simulate matching logic
    const matches = this.findMatchingAgents(matchParams.task_requirements);

    if (this.container) {
      this.displayCapabilityMatches(matches);
    }
  }

  /**
   * Handle resource allocation
   */
  async handleResourceAllocation(params) {
    const allocParams = {
      resources: params.resources || { cpu: 20, memory: 1024 },
      agents: params.agents || [],
    };

    console.log('📦 Allocating resources with parameters:', allocParams);

    if (this.container) {
      this.updateResourceMeters(allocParams);
    }
  }

  /**
   * Handle lifecycle management
   */
  async handleLifecycleManagement(params) {
    const lifecycleParams = {
      agentId: params.agentId || 'agent-1',
      action: params.action || 'status',
    };

    console.log('🔄 Managing agent lifecycle:', lifecycleParams);

    if (this.container) {
      this.updateLifecycleStatus(lifecycleParams.agentId, lifecycleParams.action);
    }
  }

  /**
   * Handle inter-agent communication
   */
  async handleCommunication(params) {
    const commParams = {
      from: params.from || 'coordinator',
      to: params.to || 'worker-1',
      message: params.message || { type: 'command', content: 'execute_task' },
    };

    console.log('📡 Handling communication:', commParams);

    this.communications.push({
      timestamp: Date.now(),
      ...commParams,
    });

    if (this.container) {
      this.updateCommunicationLog(commParams);
    }
  }

  /**
   * Handle consensus operations
   */
  async handleConsensus(params) {
    const consensusParams = {
      agents: params.agents || Array.from(this.agents.keys()),
      proposal: params.proposal || { type: 'resource_allocation', details: {} },
    };

    console.log('🤝 Processing consensus:', consensusParams);

    if (this.container) {
      this.createConsensusProposal(consensusParams);
    }
  }

  /**
   * Handle fault tolerance
   */
  async handleFaultTolerance(params) {
    const faultParams = {
      agentId: params.agentId || 'agent-1',
      strategy: params.strategy || 'restart',
    };

    console.log('🛡️ Handling fault tolerance:', faultParams);

    this.faultEvents.push({
      timestamp: Date.now(),
      ...faultParams,
    });

    if (this.container) {
      this.updateFaultEvents(faultParams);
    }
  }

  /**
   * Handle optimization
   */
  async handleOptimization(params) {
    const optimizationParams = {
      target: params.target || 'performance',
      metrics: params.metrics || ['response_time', 'throughput'],
    };

    console.log('⚡ Running optimization:', optimizationParams);

    this.optimizations.push({
      timestamp: Date.now(),
      ...optimizationParams,
    });

    if (this.container) {
      this.updateOptimizationResults(optimizationParams);
    }
  }

  /**
   * Update agents list in UI
   */
  updateAgentsList(agent) {
    const agentsListEl = document.getElementById('agents-list');
    if (!agentsListEl) return;

    const agentCard = document.createElement('div');
    agentCard.className = 'agent-card';
    agentCard.innerHTML = `
      <div class="agent-header">
        <span class="agent-icon">🤖</span>
        <span class="agent-name">${agent.id}</span>
        <span class="agent-status ${agent.status}">${agent.status}</span>
      </div>
      <div class="agent-details">
        <div>Type: ${agent.type}</div>
        <div>Capabilities: ${agent.capabilities.join(', ')}</div>
      </div>
      <div class="agent-actions">
        <button onclick="this.manageAgent('${agent.id}')" class="mini-btn">Manage</button>
        <button onclick="this.viewAgentDetails('${agent.id}')" class="mini-btn">Details</button>
      </div>
    `;

    agentsListEl.appendChild(agentCard);

    // Update agent count
    const agentsStat = document.getElementById('agents-stat');
    if (agentsStat) {
      const valueEl = agentsStat.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.agents.size;
    }
  }

  /**
   * Display capability matches
   */
  displayCapabilityMatches(matches) {
    const matchesEl = document.getElementById('capability-matches');
    if (!matchesEl) return;

    if (matches.length === 0) {
      matchesEl.innerHTML = '<div class="no-matches">No matching agents found</div>';
      return;
    }

    matchesEl.innerHTML = matches
      .map(
        (match) => `
      <div class="match-card">
        <div class="match-agent">${match.agent.id}</div>
        <div class="match-score">Match Score: ${match.score}%</div>
        <div class="match-capabilities">
          ${match.matchedCapabilities
            .map((cap) => `<span class="capability-tag">${cap}</span>`)
            .join('')}
        </div>
        <button onclick="this.assignToAgent('${match.agent.id}')" class="mini-btn primary">
          Assign Task
        </button>
      </div>
    `,
      )
      .join('');
  }

  /**
   * Find matching agents based on requirements
   */
  findMatchingAgents(requirements) {
    const matches = [];

    for (const [agentId, agent] of this.agents) {
      const matchedCaps = requirements.filter((req) => agent.capabilities.includes(req));

      if (matchedCaps.length > 0) {
        matches.push({
          agent: agent,
          score: Math.round((matchedCaps.length / requirements.length) * 100),
          matchedCapabilities: matchedCaps,
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }

  /**
   * Update resource meters
   */
  updateResourceMeters(allocParams) {
    // Update CPU meter
    const cpuBar = document.getElementById('cpu-usage-bar');
    if (cpuBar) {
      const usage = Math.min(100, 45 + (allocParams.resources.cpu || 0));
      cpuBar.style.width = `${usage}%`;
      cpuBar.nextElementSibling.textContent = `${usage}%`;
    }

    // Update memory meter
    const memBar = document.getElementById('memory-usage-bar');
    if (memBar) {
      const usage = Math.min(100, 60 + Math.round((allocParams.resources.memory || 0) / 100));
      memBar.style.width = `${usage}%`;
      memBar.nextElementSibling.textContent = `${usage}%`;
    }
  }

  /**
   * Update lifecycle status
   */
  updateLifecycleStatus(agentId, action) {
    const eventsEl = document.getElementById('lifecycle-events-list');
    if (!eventsEl) return;

    const event = document.createElement('div');
    event.className = 'lifecycle-event';
    event.innerHTML = `
      <span class="event-time">${new Date().toLocaleTimeString()}</span>
      <span class="event-agent">${agentId}</span>
      <span class="event-action ${action}">${action}</span>
    `;

    eventsEl.insertBefore(event, eventsEl.firstChild);
  }

  /**
   * Update communication log
   */
  updateCommunicationLog(commParams) {
    const logEl = document.getElementById('communication-log-list');
    if (!logEl) return;

    const message = document.createElement('div');
    message.className = `comm-message ${commParams.message.type}`;
    message.innerHTML = `
      <div class="message-header">
        <span class="message-from">${commParams.from}</span>
        <span class="message-arrow">→</span>
        <span class="message-to">${commParams.to}</span>
        <span class="message-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content">
        <span class="message-type">[${commParams.message.type}]</span>
        ${commParams.message.content}
      </div>
    `;

    logEl.insertBefore(message, logEl.firstChild);
  }

  /**
   * Create consensus proposal UI
   */
  createConsensusProposal(consensusParams) {
    const proposalsEl = document.getElementById('proposals-list');
    if (!proposalsEl) return;

    const proposal = document.createElement('div');
    proposal.className = 'proposal-card active';
    proposal.innerHTML = `
      <div class="proposal-header">
        <span class="proposal-type">${consensusParams.proposal.type}</span>
        <span class="proposal-status">Voting in Progress</span>
      </div>
      <div class="proposal-details">
        ${JSON.stringify(consensusParams.proposal.details)}
      </div>
      <div class="proposal-votes">
        <div class="vote-progress">
          <div class="vote-bar" style="width: 0%"></div>
        </div>
        <div class="vote-count">0/${consensusParams.agents.length} votes</div>
      </div>
      <div class="proposal-actions">
        <button onclick="this.voteOnProposal('approve')" class="mini-btn success">Approve</button>
        <button onclick="this.voteOnProposal('reject')" class="mini-btn danger">Reject</button>
      </div>
    `;

    proposalsEl.insertBefore(proposal, proposalsEl.firstChild);
  }

  /**
   * Update fault events
   */
  updateFaultEvents(faultParams) {
    const eventsEl = document.getElementById('fault-events-list');
    if (!eventsEl) return;

    const event = document.createElement('div');
    event.className = 'fault-event';
    event.innerHTML = `
      <div class="fault-header">
        <span class="fault-icon">🚨</span>
        <span class="fault-agent">${faultParams.agentId}</span>
        <span class="fault-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="fault-details">
        Recovery Strategy: ${faultParams.strategy}
      </div>
    `;

    eventsEl.insertBefore(event, eventsEl.firstChild);
  }

  /**
   * Update optimization results
   */
  updateOptimizationResults(optimizationParams) {
    const historyEl = document.getElementById('optimization-history-list');
    if (!historyEl) return;

    const result = document.createElement('div');
    result.className = 'optimization-result';
    result.innerHTML = `
      <div class="opt-header">
        <span class="opt-target">${optimizationParams.target}</span>
        <span class="opt-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="opt-metrics">
        Metrics: ${optimizationParams.metrics.join(', ')}
      </div>
      <div class="opt-improvement">
        <span class="improvement-value">+12%</span> improvement
      </div>
    `;

    historyEl.insertBefore(result, historyEl.firstChild);
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    // Listen for tool results
    this.eventBus.on('tool:executed', (data) => {
      if (data.source === 'daa-view') {
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

    // Listen for agent updates
    this.eventBus.on('daa:agent:created', (agent) => {
      this.agents.set(agent.id, agent);
      if (this.container) {
        this.updateAgentsList(agent);
      }
    });

    // Listen for resource updates
    this.eventBus.on('daa:resource:allocated', (allocation) => {
      this.resources.set(allocation.id, allocation);
      if (this.container) {
        this.updateResourceMeters(allocation);
      }
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
    const activityEl = document.getElementById('daa-activity-log');
    if (activityEl) {
      const activity = document.createElement('div');
      activity.className = 'activity-item';
      activity.innerHTML = `
        <span class="activity-time">${new Date().toLocaleTimeString()}</span>
        <span class="activity-desc">${toolName} completed successfully</span>
      `;
      activityEl.insertBefore(activity, activityEl.firstChild);
    }
  }

  /**
   * Update statistics
   */
  updateStats() {
    // Update agent count
    const agentsStat = document.getElementById('agents-stat');
    if (agentsStat) {
      const valueEl = agentsStat.querySelector('.stat-value');
      if (valueEl) valueEl.textContent = this.agents.size;
    }

    // Update resource usage
    const resourcesStat = document.getElementById('resources-stat');
    if (resourcesStat) {
      const valueEl = resourcesStat.querySelector('.stat-value');
      if (valueEl) {
        const totalUsage = Array.from(this.resources.values()).reduce(
          (sum, res) => sum + (res.usage || 0),
          0,
        );
        valueEl.textContent = `${Math.round(totalUsage)}%`;
      }
    }

    // Update communication rate
    const commStat = document.getElementById('communications-stat');
    if (commStat) {
      const valueEl = commStat.querySelector('.stat-value');
      if (valueEl) {
        const recentComms = this.communications.filter(
          (c) => Date.now() - c.timestamp < 60000,
        ).length;
        valueEl.textContent = recentComms;
      }
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
   * Draw agent network visualization
   */
  drawAgentNetwork() {
    const canvas = document.getElementById('agent-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw simple network visualization
    const agents = Array.from(this.agents.values());
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = 150;

    agents.forEach((agent, index) => {
      const angle = (index / agents.length) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      // Draw agent node
      ctx.beginPath();
      ctx.arc(x, y, 20, 0, 2 * Math.PI);
      ctx.fillStyle = '#00d4ff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();

      // Draw agent label
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(agent.type, x, y + 30);
    });
  }

  /**
   * Destroy view and cleanup
   */
  destroy() {
    // Clear any intervals or timeouts
    // Remove event listeners
    // Clean up resources
    console.log('🤖 DAA View destroyed');
  }
}

// Add DAA-specific styles
if (typeof document !== 'undefined') {
  const daaStyles = document.createElement('style');
  daaStyles.textContent = `
    .daa-overview {
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
    
    .daa-tools {
      margin: 24px 0;
    }
    
    .tool-buttons {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .daa-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s ease;
    }
    
    .daa-btn.primary {
      background: #00d4ff;
      color: #000;
    }
    
    .daa-btn.primary:hover {
      background: #00b8e6;
    }
    
    .daa-btn.secondary {
      background: #444;
      color: #fff;
    }
    
    .daa-btn.secondary:hover {
      background: #555;
    }
    
    .daa-btn.success {
      background: #4caf50;
      color: #fff;
    }
    
    .daa-btn.warning {
      background: #ff9800;
      color: #fff;
    }
    
    .daa-btn.danger {
      background: #f44336;
      color: #fff;
    }
    
    .daa-btn.info {
      background: #2196f3;
      color: #fff;
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
    
    .network-container {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 20px;
      margin-top: 16px;
    }
    
    .agents-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    
    .agent-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
    }
    
    .agent-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    
    .agent-status {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;
      background: #444;
    }
    
    .agent-status.active {
      background: #4caf50;
    }
    
    .agent-status.initializing {
      background: #2196f3;
    }
    
    .agent-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    
    .mini-btn {
      padding: 4px 12px;
      font-size: 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      background: #444;
      color: #fff;
    }
    
    .mini-btn:hover {
      background: #555;
    }
    
    .mini-btn.primary {
      background: #00d4ff;
      color: #000;
    }
    
    .resource-inputs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    
    .resource-meter {
      margin-bottom: 16px;
    }
    
    .meter-bar {
      position: relative;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 4px;
      height: 24px;
      overflow: hidden;
      margin-top: 4px;
    }
    
    .meter-fill {
      height: 100%;
      background: linear-gradient(90deg, #00d4ff, #0099cc);
      transition: width 0.3s ease;
    }
    
    .meter-text {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #fff;
      font-size: 12px;
      font-weight: bold;
    }
    
    .lifecycle-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 16px;
    }
    
    .lifecycle-viz {
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 20px;
      margin-top: 16px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .comm-message {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 8px;
    }
    
    .message-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 14px;
    }
    
    .message-from {
      color: #00d4ff;
    }
    
    .message-to {
      color: #4caf50;
    }
    
    .message-time {
      margin-left: auto;
      color: #888;
      font-size: 12px;
    }
    
    .message-type {
      color: #ff9800;
      font-weight: bold;
    }
    
    .proposal-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    
    .proposal-card.active {
      border-color: #00d4ff;
    }
    
    .vote-progress {
      background: #1a1a1a;
      border-radius: 4px;
      height: 20px;
      overflow: hidden;
      margin: 8px 0;
    }
    
    .vote-bar {
      height: 100%;
      background: #4caf50;
      transition: width 0.3s ease;
    }
    
    .health-indicators {
      display: flex;
      gap: 16px;
      margin-top: 16px;
    }
    
    .health-indicator {
      flex: 1;
      text-align: center;
      padding: 16px;
      border-radius: 8px;
      background: #2a2a2a;
      border: 1px solid #444;
    }
    
    .health-indicator.healthy {
      border-color: #4caf50;
    }
    
    .health-indicator.warning {
      border-color: #ff9800;
    }
    
    .health-indicator.critical {
      border-color: #f44336;
    }
    
    .indicator-icon {
      font-size: 24px;
      display: block;
      margin-bottom: 8px;
    }
    
    .indicator-value {
      font-size: 24px;
      font-weight: bold;
      display: block;
    }
    
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    
    .metric-card {
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    
    .metric-label {
      color: #888;
      font-size: 14px;
      margin-bottom: 8px;
    }
    
    .metric-value {
      font-size: 28px;
      font-weight: bold;
      color: #00d4ff;
      margin-bottom: 4px;
    }
    
    .metric-trend {
      font-size: 14px;
      color: #888;
    }
    
    .activity-list,
    .history-list,
    .events-list,
    .fault-log,
    .recovery-log,
    .optimization-log,
    .comm-log,
    .consensus-log {
      max-height: 300px;
      overflow-y: auto;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 12px;
    }
    
    .activity-item,
    .lifecycle-event,
    .fault-event,
    .optimization-result {
      display: flex;
      align-items: center;
      padding: 8px;
      border-bottom: 1px solid #333;
    }
    
    .activity-item:last-child,
    .lifecycle-event:last-child,
    .fault-event:last-child,
    .optimization-result:last-child {
      border-bottom: none;
    }
    
    .filter-btn {
      padding: 6px 12px;
      border: 1px solid #444;
      background: transparent;
      color: #888;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 8px;
    }
    
    .filter-btn.active {
      background: #444;
      color: #fff;
    }
    
    .filter-btn:hover {
      background: #333;
      color: #fff;
    }
  `;
  document.head.appendChild(daaStyles);
}
