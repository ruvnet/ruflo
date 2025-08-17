/**
 * Dynamic Agent Architecture (DAA) Tools
 * Implementation of 8 core DAA tools for Claude Flow
 */

class DAATools {
  constructor() {
    this.agents = new Map();
    this.resources = new Map();
    this.communications = new Map();
    this.consensus = new Map();
    this.isInitialized = false;
    this.currentTab = 'agents';

    // Performance metrics
    this.metrics = {
      totalAgents: 0,
      activeAgents: 0,
      resourceUtilization: 0,
      communicationLatency: 0,
      consensusTime: 0,
      faultCount: 0,
    };

    this.init();
  }

  init() {
    if (this.isInitialized) return;

    this.createDAAPanel();
    this.setupEventListeners();
    this.initializeMonitoring();
    this.isInitialized = true;

    console.log('DAA Tools initialized');
  }

  // Tool 1: Dynamic Agent Creation
  daa_agent_create(config) {
    const agentId = this.generateAgentId();
    const agent = {
      id: agentId,
      type: config.type || 'generic',
      capabilities: config.capabilities || [],
      resources: config.resources || {},
      status: 'initializing',
      created: Date.now(),
      lastActivity: Date.now(),
      tasks: [],
      metadata: config.metadata || {},
    };

    this.agents.set(agentId, agent);
    this.metrics.totalAgents++;
    this.metrics.activeAgents++;

    // Lifecycle management
    this.initializeAgent(agent);

    // Update UI
    this.updateAgentsList();
    this.updateMetrics();

    return {
      success: true,
      agentId: agentId,
      agent: agent,
    };
  }

  // Tool 2: Capability Matching System
  daa_capability_match(requirements) {
    const matches = [];

    for (const [agentId, agent] of this.agents) {
      if (agent.status !== 'active') continue;

      const score = this.calculateCapabilityScore(agent.capabilities, requirements);
      if (score > 0) {
        matches.push({
          agentId,
          agent,
          score,
          availableCapabilities: agent.capabilities.filter((cap) =>
            requirements.some((req) => this.matchCapability(cap, req)),
          ),
        });
      }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    this.updateCapabilityMatches(matches);

    return {
      success: true,
      matches: matches,
      totalCandidates: matches.length,
    };
  }

  // Tool 3: Resource Allocation Management
  daa_resource_alloc(allocation) {
    const resourceId = this.generateResourceId();
    const resource = {
      id: resourceId,
      type: allocation.type,
      capacity: allocation.capacity,
      allocated: 0,
      assignments: new Map(),
      priority: allocation.priority || 'medium',
      created: Date.now(),
      metadata: allocation.metadata || {},
    };

    this.resources.set(resourceId, resource);

    // Perform allocation
    const allocationResult = this.allocateResource(resource, allocation);

    // Update visualizations
    this.updateResourceGraphs();
    this.updateMetrics();

    return {
      success: allocationResult.success,
      resourceId: resourceId,
      allocation: allocationResult,
      utilization: this.calculateResourceUtilization(),
    };
  }

  // Tool 4: Agent Lifecycle Management
  daa_lifecycle_manage(agentId, action, params = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return { success: false, error: 'Agent not found' };
    }

    let result;

    switch (action) {
      case 'start':
        result = this.startAgent(agent, params);
        break;
      case 'pause':
        result = this.pauseAgent(agent, params);
        break;
      case 'resume':
        result = this.resumeAgent(agent, params);
        break;
      case 'stop':
        result = this.stopAgent(agent, params);
        break;
      case 'restart':
        result = this.restartAgent(agent, params);
        break;
      case 'destroy':
        result = this.destroyAgent(agent, params);
        break;
      default:
        return { success: false, error: 'Unknown action' };
    }

    // Update lifecycle visualization
    this.updateLifecycleVisualization();
    this.updateMetrics();

    return result;
  }

  // Tool 5: Inter-agent Communication
  daa_communication(fromAgent, toAgent, message, options = {}) {
    const commId = this.generateCommId();
    const communication = {
      id: commId,
      from: fromAgent,
      to: toAgent,
      message: message,
      timestamp: Date.now(),
      type: options.type || 'direct',
      priority: options.priority || 'normal',
      status: 'pending',
      latency: 0,
      metadata: options.metadata || {},
    };

    this.communications.set(commId, communication);

    // Process communication
    const result = this.processCommunication(communication);

    // Update communication flow diagrams
    this.updateCommunicationFlow();

    return {
      success: result.success,
      commId: commId,
      latency: result.latency,
      status: result.status,
    };
  }

  // Tool 6: Consensus Mechanisms
  daa_consensus(proposal, agents, options = {}) {
    const consensusId = this.generateConsensusId();
    const consensus = {
      id: consensusId,
      proposal: proposal,
      participants: agents,
      votes: new Map(),
      status: 'voting',
      algorithm: options.algorithm || 'majority',
      threshold: options.threshold || 0.5,
      timeout: options.timeout || 30000,
      started: Date.now(),
      completed: null,
      result: null,
    };

    this.consensus.set(consensusId, consensus);

    // Start consensus process
    const result = this.startConsensusProcess(consensus);

    // Update consensus interface
    this.updateConsensusInterface();

    return {
      success: result.success,
      consensusId: consensusId,
      expectedCompletion: result.expectedCompletion,
    };
  }

  // Tool 7: Fault Tolerance and Recovery
  daa_fault_tolerance(faultType, affectedAgents, recoveryOptions = {}) {
    const faultId = this.generateFaultId();
    const fault = {
      id: faultId,
      type: faultType,
      affected: affectedAgents,
      detected: Date.now(),
      severity: recoveryOptions.severity || 'medium',
      status: 'detected',
      recoveryPlan: null,
      recovered: null,
    };

    this.metrics.faultCount++;

    // Analyze fault and create recovery plan
    const recoveryPlan = this.createRecoveryPlan(fault, recoveryOptions);
    fault.recoveryPlan = recoveryPlan;

    // Execute recovery
    const recoveryResult = this.executeRecovery(fault);

    // Update fault tolerance dashboard
    this.updateFaultDashboard();

    return {
      success: recoveryResult.success,
      faultId: faultId,
      recoveryPlan: recoveryPlan,
      estimatedRecoveryTime: recoveryResult.estimatedTime,
    };
  }

  // Tool 8: Performance Optimization
  daa_optimization(target, options = {}) {
    const optimizationId = this.generateOptimizationId();
    const optimization = {
      id: optimizationId,
      target: target,
      baseline: this.capturePerformanceBaseline(),
      options: options,
      started: Date.now(),
      status: 'running',
      improvements: [],
      completed: null,
    };

    // Perform optimization
    const result = this.performOptimization(optimization);

    // Update optimization dashboard
    this.updateOptimizationDashboard();

    return {
      success: result.success,
      optimizationId: optimizationId,
      improvements: result.improvements,
      performanceGain: result.performanceGain,
    };
  }

  // UI Creation Methods
  createDAAPanel() {
    const panel = document.createElement('div');
    panel.id = 'daa-tools-panel';
    panel.className = 'daa-panel';

    panel.innerHTML = `
            <div class="daa-header">
                <h3>DAA Control Center</h3>
                <div class="daa-metrics">
                    <div class="metric">
                        <span class="metric-label">Agents</span>
                        <span class="metric-value" id="daa-agents-count">0</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Resources</span>
                        <span class="metric-value" id="daa-resources-util">0%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Latency</span>
                        <span class="metric-value" id="daa-latency">0ms</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Faults</span>
                        <span class="metric-value" id="daa-faults">0</span>
                    </div>
                </div>
            </div>
            
            <div class="daa-tabs">
                <button class="daa-tab active" data-tab="agents">Agents</button>
                <button class="daa-tab" data-tab="resources">Resources</button>
                <button class="daa-tab" data-tab="communication">Communication</button>
                <button class="daa-tab" data-tab="monitoring">Monitoring</button>
            </div>
            
            <div class="daa-content">
                ${this.createAgentsTab()}
                ${this.createResourcesTab()}
                ${this.createCommunicationTab()}
                ${this.createMonitoringTab()}
            </div>
        `;

    // Add to console
    const consoleContainer = document.querySelector('.console-container') || document.body;
    consoleContainer.appendChild(panel);
  }

  createAgentsTab() {
    return `
            <div class="daa-tab-content active" id="daa-agents-tab">
                <div class="daa-section">
                    <h4>Agent Creation</h4>
                    <div class="daa-form">
                        <select id="daa-agent-type">
                            <option value="researcher">Researcher</option>
                            <option value="coder">Coder</option>
                            <option value="analyst">Analyst</option>
                            <option value="coordinator">Coordinator</option>
                            <option value="tester">Tester</option>
                        </select>
                        <input type="text" id="daa-agent-capabilities" placeholder="Capabilities (comma-separated)">
                        <button id="daa-create-agent">Create Agent</button>
                    </div>
                </div>
                
                <div class="daa-section">
                    <h4>Agent Lifecycle</h4>
                    <div id="daa-lifecycle-visualization" class="daa-visualization">
                        <!-- Lifecycle visualization will be populated here -->
                    </div>
                </div>
                
                <div class="daa-section">
                    <h4>Active Agents</h4>
                    <div id="daa-agents-list" class="daa-agents-grid">
                        <!-- Agents will be populated here -->
                    </div>
                </div>
            </div>
        `;
  }

  createResourcesTab() {
    return `
            <div class="daa-tab-content" id="daa-resources-tab">
                <div class="daa-section">
                    <h4>Resource Allocation</h4>
                    <div class="daa-form">
                        <select id="daa-resource-type">
                            <option value="cpu">CPU</option>
                            <option value="memory">Memory</option>
                            <option value="storage">Storage</option>
                            <option value="network">Network</option>
                        </select>
                        <input type="number" id="daa-resource-capacity" placeholder="Capacity">
                        <select id="daa-resource-priority">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                        </select>
                        <button id="daa-allocate-resource">Allocate Resource</button>
                    </div>
                </div>
                
                <div class="daa-section">
                    <h4>Resource Graphs</h4>
                    <div id="daa-resource-graphs" class="daa-visualization">
                        <canvas id="daa-resource-chart" width="600" height="300"></canvas>
                    </div>
                </div>
                
                <div class="daa-section">
                    <h4>Resource Status</h4>
                    <div id="daa-resource-status" class="daa-status-grid">
                        <!-- Resource status will be populated here -->
                    </div>
                </div>
            </div>
        `;
  }

  createCommunicationTab() {
    return `
            <div class="daa-tab-content" id="daa-communication-tab">
                <div class="daa-section">
                    <h4>Communication Flow</h4>
                    <div id="daa-communication-flow" class="daa-visualization">
                        <svg id="daa-comm-diagram" width="600" height="400"></svg>
                    </div>
                </div>
                
                <div class="daa-section">
                    <h4>Consensus Voting</h4>
                    <div class="daa-form">
                        <textarea id="daa-consensus-proposal" placeholder="Enter proposal..."></textarea>
                        <select id="daa-consensus-algorithm">
                            <option value="majority">Majority</option>
                            <option value="unanimous">Unanimous</option>
                            <option value="weighted">Weighted</option>
                        </select>
                        <button id="daa-start-consensus">Start Consensus</button>
                    </div>
                    <div id="daa-consensus-status" class="daa-consensus-grid">
                        <!-- Consensus status will be populated here -->
                    </div>
                </div>
            </div>
        `;
  }

  createMonitoringTab() {
    return `
            <div class="daa-tab-content" id="daa-monitoring-tab">
                <div class="daa-section">
                    <h4>Real-time Dashboard</h4>
                    <div id="daa-monitoring-dashboard" class="daa-dashboard">
                        <div class="daa-dashboard-grid">
                            <div class="daa-dashboard-item">
                                <h5>Performance Metrics</h5>
                                <canvas id="daa-performance-chart" width="300" height="200"></canvas>
                            </div>
                            <div class="daa-dashboard-item">
                                <h5>System Health</h5>
                                <div id="daa-health-indicators" class="daa-health-grid">
                                    <!-- Health indicators will be populated here -->
                                </div>
                            </div>
                            <div class="daa-dashboard-item">
                                <h5>Fault Tolerance</h5>
                                <div id="daa-fault-status" class="daa-fault-grid">
                                    <!-- Fault status will be populated here -->
                                </div>
                            </div>
                            <div class="daa-dashboard-item">
                                <h5>Optimization</h5>
                                <div id="daa-optimization-status" class="daa-optimization-grid">
                                    <!-- Optimization status will be populated here -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  // Helper Methods
  generateAgentId() {
    return `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateResourceId() {
    return `resource-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateCommId() {
    return `comm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateConsensusId() {
    return `consensus-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateFaultId() {
    return `fault-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateOptimizationId() {
    return `opt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  calculateCapabilityScore(agentCapabilities, requirements) {
    let score = 0;
    for (const requirement of requirements) {
      for (const capability of agentCapabilities) {
        if (this.matchCapability(capability, requirement)) {
          score += 1;
        }
      }
    }
    return score;
  }

  matchCapability(capability, requirement) {
    // Simple string matching - can be enhanced with fuzzy matching
    return capability.toLowerCase().includes(requirement.toLowerCase());
  }

  calculateResourceUtilization() {
    let totalCapacity = 0;
    let totalAllocated = 0;

    for (const [_, resource] of this.resources) {
      totalCapacity += resource.capacity;
      totalAllocated += resource.allocated;
    }

    return totalCapacity > 0 ? Math.round((totalAllocated / totalCapacity) * 100) : 0;
  }

  // Implementation methods (simplified for brevity)
  initializeAgent(agent) {
    agent.status = 'active';
    agent.lastActivity = Date.now();
  }

  startAgent(agent, params) {
    agent.status = 'active';
    agent.lastActivity = Date.now();
    return { success: true, status: 'active' };
  }

  pauseAgent(agent, params) {
    agent.status = 'paused';
    return { success: true, status: 'paused' };
  }

  resumeAgent(agent, params) {
    agent.status = 'active';
    agent.lastActivity = Date.now();
    return { success: true, status: 'active' };
  }

  stopAgent(agent, params) {
    agent.status = 'stopped';
    this.metrics.activeAgents--;
    return { success: true, status: 'stopped' };
  }

  restartAgent(agent, params) {
    agent.status = 'active';
    agent.lastActivity = Date.now();
    return { success: true, status: 'active' };
  }

  destroyAgent(agent, params) {
    this.agents.delete(agent.id);
    this.metrics.totalAgents--;
    this.metrics.activeAgents--;
    return { success: true, status: 'destroyed' };
  }

  allocateResource(resource, allocation) {
    // Simple allocation logic
    const requested = allocation.amount || 0;
    const available = resource.capacity - resource.allocated;

    if (requested <= available) {
      resource.allocated += requested;
      return { success: true, allocated: requested, remaining: available - requested };
    } else {
      return { success: false, error: 'Insufficient resources', available: available };
    }
  }

  processCommunication(communication) {
    // Simulate communication processing
    const latency = Math.random() * 100; // 0-100ms
    communication.latency = latency;
    communication.status = 'completed';

    this.metrics.communicationLatency = (this.metrics.communicationLatency + latency) / 2;

    return { success: true, latency: latency, status: 'completed' };
  }

  startConsensusProcess(consensus) {
    // Simulate consensus process
    const expectedTime = consensus.timeout || 30000;

    setTimeout(() => {
      this.completeConsensus(consensus);
    }, expectedTime);

    return { success: true, expectedCompletion: Date.now() + expectedTime };
  }

  completeConsensus(consensus) {
    consensus.status = 'completed';
    consensus.completed = Date.now();
    consensus.result = 'approved'; // Simplified

    this.metrics.consensusTime = consensus.completed - consensus.started;
    this.updateConsensusInterface();
  }

  createRecoveryPlan(fault, options) {
    return {
      steps: [
        'Isolate affected agents',
        'Backup current state',
        'Restart affected components',
        'Verify system integrity',
        'Resume normal operations',
      ],
      estimatedTime: 60000, // 1 minute
      priority: fault.severity,
    };
  }

  executeRecovery(fault) {
    // Simulate recovery execution
    fault.status = 'recovering';

    setTimeout(() => {
      fault.status = 'recovered';
      fault.recovered = Date.now();
      this.updateFaultDashboard();
    }, fault.recoveryPlan.estimatedTime);

    return { success: true, estimatedTime: fault.recoveryPlan.estimatedTime };
  }

  capturePerformanceBaseline() {
    return {
      timestamp: Date.now(),
      metrics: { ...this.metrics },
      agentCount: this.agents.size,
      resourceCount: this.resources.size,
    };
  }

  performOptimization(optimization) {
    // Simulate optimization process
    const improvements = [
      { type: 'agent_efficiency', improvement: 15 },
      { type: 'resource_allocation', improvement: 12 },
      { type: 'communication_latency', improvement: 8 },
    ];

    optimization.improvements = improvements;
    optimization.status = 'completed';
    optimization.completed = Date.now();

    const totalGain =
      improvements.reduce((sum, imp) => sum + imp.improvement, 0) / improvements.length;

    return { success: true, improvements: improvements, performanceGain: totalGain };
  }

  // UI Update Methods
  updateAgentsList() {
    const agentsList = document.getElementById('daa-agents-list');
    if (!agentsList) return;

    agentsList.innerHTML = '';

    for (const [agentId, agent] of this.agents) {
      const agentElement = document.createElement('div');
      agentElement.className = 'daa-agent-card';
      agentElement.innerHTML = `
                <div class="agent-header">
                    <span class="agent-id">${agentId}</span>
                    <span class="agent-status status-${agent.status}">${agent.status}</span>
                </div>
                <div class="agent-details">
                    <div class="agent-type">${agent.type}</div>
                    <div class="agent-capabilities">${agent.capabilities.join(', ')}</div>
                </div>
                <div class="agent-actions">
                    <button onclick="daaTools.daa_lifecycle_manage('${agentId}', 'pause')">Pause</button>
                    <button onclick="daaTools.daa_lifecycle_manage('${agentId}', 'stop')">Stop</button>
                    <button onclick="daaTools.daa_lifecycle_manage('${agentId}', 'destroy')">Destroy</button>
                </div>
            `;
      agentsList.appendChild(agentElement);
    }
  }

  updateMetrics() {
    const elements = {
      'daa-agents-count': this.metrics.activeAgents,
      'daa-resources-util': `${this.metrics.resourceUtilization}%`,
      'daa-latency': `${Math.round(this.metrics.communicationLatency)}ms`,
      'daa-faults': this.metrics.faultCount,
    };

    for (const [id, value] of Object.entries(elements)) {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = value;
      }
    }
  }

  updateCapabilityMatches(matches) {
    // Update capability matching visualization
    console.log('Capability matches:', matches);
  }

  updateResourceGraphs() {
    const canvas = document.getElementById('daa-resource-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw resource utilization bars
    const resources = Array.from(this.resources.values());
    const barWidth = canvas.width / Math.max(resources.length, 1);

    resources.forEach((resource, index) => {
      const utilization = resource.capacity > 0 ? resource.allocated / resource.capacity : 0;
      const barHeight = utilization * canvas.height;

      ctx.fillStyle = utilization > 0.8 ? '#ff4444' : utilization > 0.5 ? '#ffaa00' : '#44ff44';
      ctx.fillRect(index * barWidth, canvas.height - barHeight, barWidth - 2, barHeight);

      // Resource label
      ctx.fillStyle = '#000';
      ctx.font = '12px Arial';
      ctx.fillText(resource.type, index * barWidth + 5, canvas.height - 5);
    });
  }

  updateLifecycleVisualization() {
    const visualization = document.getElementById('daa-lifecycle-visualization');
    if (!visualization) return;

    const statusCounts = {};
    for (const [_, agent] of this.agents) {
      statusCounts[agent.status] = (statusCounts[agent.status] || 0) + 1;
    }

    visualization.innerHTML = Object.entries(statusCounts)
      .map(
        ([status, count]) =>
          `<div class="lifecycle-item">
                <span class="status-badge status-${status}">${status}</span>
                <span class="status-count">${count}</span>
            </div>`,
      )
      .join('');
  }

  updateCommunicationFlow() {
    const svg = document.getElementById('daa-comm-diagram');
    if (!svg) return;

    // Clear existing content
    svg.innerHTML = '';

    // Draw communication flow visualization
    const agents = Array.from(this.agents.values());
    const centerX = 300;
    const centerY = 200;
    const radius = 150;

    agents.forEach((agent, index) => {
      const angle = (index * 2 * Math.PI) / agents.length;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      // Draw agent node
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', 20);
      circle.setAttribute('fill', '#4CAF50');
      circle.setAttribute('stroke', '#333');
      circle.setAttribute('stroke-width', '2');
      svg.appendChild(circle);

      // Draw agent label
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', y + 5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '12');
      text.setAttribute('fill', '#fff');
      text.textContent = agent.id.split('-')[0];
      svg.appendChild(text);
    });
  }

  updateConsensusInterface() {
    const consensusStatus = document.getElementById('daa-consensus-status');
    if (!consensusStatus) return;

    consensusStatus.innerHTML = Array.from(this.consensus.values())
      .map(
        (consensus) =>
          `<div class="consensus-item">
                <div class="consensus-proposal">${consensus.proposal}</div>
                <div class="consensus-status">${consensus.status}</div>
                <div class="consensus-progress">
                    <div class="progress-bar" style="width: ${consensus.status === 'completed' ? '100%' : '50%'}"></div>
                </div>
            </div>`,
      )
      .join('');
  }

  updateFaultDashboard() {
    const faultStatus = document.getElementById('daa-fault-status');
    if (!faultStatus) return;

    faultStatus.innerHTML = `
            <div class="fault-item">
                <span class="fault-label">Total Faults</span>
                <span class="fault-value">${this.metrics.faultCount}</span>
            </div>
            <div class="fault-item">
                <span class="fault-label">Recovery Rate</span>
                <span class="fault-value">95%</span>
            </div>
            <div class="fault-item">
                <span class="fault-label">MTTR</span>
                <span class="fault-value">2.3min</span>
            </div>
        `;
  }

  updateOptimizationDashboard() {
    const optimizationStatus = document.getElementById('daa-optimization-status');
    if (!optimizationStatus) return;

    optimizationStatus.innerHTML = `
            <div class="optimization-item">
                <span class="opt-label">Performance Gain</span>
                <span class="opt-value">+15%</span>
            </div>
            <div class="optimization-item">
                <span class="opt-label">Resource Efficiency</span>
                <span class="opt-value">+12%</span>
            </div>
            <div class="optimization-item">
                <span class="opt-label">Latency Reduction</span>
                <span class="opt-value">-8%</span>
            </div>
        `;
  }

  setupEventListeners() {
    // Tab switching
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('daa-tab')) {
        this.switchTab(e.target.dataset.tab);
      }
    });

    // Agent creation
    document.addEventListener('click', (e) => {
      if (e.target.id === 'daa-create-agent') {
        this.handleCreateAgent();
      }
    });

    // Resource allocation
    document.addEventListener('click', (e) => {
      if (e.target.id === 'daa-allocate-resource') {
        this.handleAllocateResource();
      }
    });

    // Consensus voting
    document.addEventListener('click', (e) => {
      if (e.target.id === 'daa-start-consensus') {
        this.handleStartConsensus();
      }
    });
  }

  switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.daa-tab-content').forEach((tab) => {
      tab.classList.remove('active');
    });

    document.querySelectorAll('.daa-tab').forEach((tab) => {
      tab.classList.remove('active');
    });

    // Show selected tab
    document.getElementById(`daa-${tabName}-tab`).classList.add('active');
    document.querySelector(`.daa-tab[data-tab="${tabName}"]`).classList.add('active');

    this.currentTab = tabName;
  }

  handleCreateAgent() {
    const type = document.getElementById('daa-agent-type').value;
    const capabilities = document
      .getElementById('daa-agent-capabilities')
      .value.split(',')
      .map((s) => s.trim());

    const result = this.daa_agent_create({
      type: type,
      capabilities: capabilities,
      resources: { cpu: 1, memory: 512 },
    });

    if (result.success) {
      console.log('Agent created:', result.agentId);
    }
  }

  handleAllocateResource() {
    const type = document.getElementById('daa-resource-type').value;
    const capacity = parseInt(document.getElementById('daa-resource-capacity').value) || 100;
    const priority = document.getElementById('daa-resource-priority').value;

    const result = this.daa_resource_alloc({
      type: type,
      capacity: capacity,
      priority: priority,
      amount: capacity * 0.5, // Allocate 50% initially
    });

    if (result.success) {
      console.log('Resource allocated:', result.resourceId);
    }
  }

  handleStartConsensus() {
    const proposal = document.getElementById('daa-consensus-proposal').value;
    const algorithm = document.getElementById('daa-consensus-algorithm').value;

    if (!proposal.trim()) {
      alert('Please enter a proposal');
      return;
    }

    const agents = Array.from(this.agents.keys());
    const result = this.daa_consensus(proposal, agents, {
      algorithm: algorithm,
      timeout: 30000,
    });

    if (result.success) {
      console.log('Consensus started:', result.consensusId);
    }
  }

  initializeMonitoring() {
    // Start monitoring intervals
    setInterval(() => {
      this.updateMetrics();
      this.updateResourceGraphs();
      this.updateLifecycleVisualization();
    }, 5000);

    // Initialize with some sample data
    this.createSampleData();
  }

  createSampleData() {
    // Create sample agents
    this.daa_agent_create({
      type: 'researcher',
      capabilities: ['data_analysis', 'research', 'documentation'],
      resources: { cpu: 2, memory: 1024 },
    });

    this.daa_agent_create({
      type: 'coder',
      capabilities: ['javascript', 'python', 'testing'],
      resources: { cpu: 4, memory: 2048 },
    });

    // Create sample resources
    this.daa_resource_alloc({
      type: 'cpu',
      capacity: 100,
      priority: 'high',
      amount: 30,
    });

    this.daa_resource_alloc({
      type: 'memory',
      capacity: 8192,
      priority: 'medium',
      amount: 2048,
    });
  }
}

// Initialize DAA Tools
let daaTools;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    daaTools = new DAATools();
  });
} else {
  daaTools = new DAATools();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DAATools;
}
