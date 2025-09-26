export class SwarmVisualizer {
    constructor(container, componentLibrary){
        this.container = container;
        this.components = componentLibrary;
        this.swarmData = null;
        this.agents = new Map();
        this.connections = new Map();
        this.topology = 'mesh';
        this.updateInterval = null;
        this.isActive = false;
        this.canvas = null;
        this.ctx = null;
        this.canvasSize = {
            width: 800,
            height: 600
        };
        this.animationFrame = null;
        this.particles = [];
        this.init();
    }
    init() {
        this.createUI();
        this.setupEventHandlers();
        console.log('🌊 Swarm Visualizer initialized');
    }
    createUI() {
        const mainPanel = this.components.createToolPanel({
            title: 'Swarm Visualizer',
            description: 'Real-time swarm topology and agent monitoring'
        });
        const controlPanel = this.createControlPanel();
        mainPanel.append(controlPanel);
        const statsPanel = this.createStatsPanel();
        mainPanel.append(statsPanel);
        const canvasContainer = this.createTopologyCanvas();
        mainPanel.append(canvasContainer);
        const agentPanel = this.createAgentPanel();
        mainPanel.append(agentPanel);
        this.container.appendChild(mainPanel.element);
        this.elements = {
            mainPanel,
            controlPanel,
            statsPanel,
            canvasContainer,
            agentPanel
        };
    }
    createControlPanel() {
        const panel = document.createElement('div');
        panel.className = 'swarm-control-panel';
        const startBtn = this.components.createActionButton({
            type: 'primary',
            text: 'Start Monitoring',
            icon: '▶️',
            onclick: ()=>this.startMonitoring()
        });
        const stopBtn = this.components.createActionButton({
            type: 'secondary',
            text: 'Stop',
            icon: '⏹️',
            onclick: ()=>this.stopMonitoring()
        });
        const topologySelect = document.createElement('select');
        topologySelect.id = 'topology-selector';
        topologySelect.innerHTML = `
      <option value="mesh">Mesh Network</option>
      <option value="hierarchical">Hierarchical</option>
      <option value="ring">Ring Topology</option>
      <option value="star">Star Network</option>
    `;
        topologySelect.addEventListener('change', (e)=>{
            this.topology = e.target.value;
            this.redrawTopology();
        });
        const refreshSelect = document.createElement('select');
        refreshSelect.id = 'refresh-rate';
        refreshSelect.innerHTML = `
      <option value="1000">1 second</option>
      <option value="2000" selected>2 seconds</option>
      <option value="5000">5 seconds</option>
      <option value="10000">10 seconds</option>
    `;
        panel.appendChild(startBtn.element);
        panel.appendChild(stopBtn.element);
        panel.appendChild(this.createLabel('Topology:', topologySelect));
        panel.appendChild(this.createLabel('Refresh Rate:', refreshSelect));
        this.controlElements = {
            startBtn,
            stopBtn,
            topologySelect,
            refreshSelect
        };
        return panel;
    }
    createStatsPanel() {
        const panel = document.createElement('div');
        panel.className = 'swarm-stats-panel';
        panel.style.display = 'flex';
        panel.style.gap = '16px';
        panel.style.flexWrap = 'wrap';
        this.statsCards = {
            totalAgents: this.components.createStatsCard({
                icon: '🤖',
                value: '0',
                label: 'Total Agents'
            }),
            activeAgents: this.components.createStatsCard({
                icon: '✅',
                value: '0',
                label: 'Active'
            }),
            busyAgents: this.components.createStatsCard({
                icon: '⚙️',
                value: '0',
                label: 'Busy'
            }),
            idleAgents: this.components.createStatsCard({
                icon: '💤',
                value: '0',
                label: 'Idle'
            }),
            errorAgents: this.components.createStatsCard({
                icon: '❌',
                value: '0',
                label: 'Errors'
            }),
            throughput: this.components.createStatsCard({
                icon: '📊',
                value: '0/min',
                label: 'Task Throughput'
            })
        };
        Object.values(this.statsCards).forEach((card)=>{
            panel.appendChild(card.element);
        });
        return panel;
    }
    createTopologyCanvas() {
        const container = document.createElement('div');
        container.className = 'topology-canvas-container';
        container.style.cssText = `
      position: relative;
      background: #1a1a1a;
      border: 1px solid #444;
      border-radius: 8px;
      margin: 16px 0;
      overflow: hidden;
    `;
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvasSize.width;
        this.canvas.height = this.canvasSize.height;
        this.canvas.style.display = 'block';
        this.ctx = this.canvas.getContext('2d');
        this.canvas.addEventListener('click', (e)=>this.handleCanvasClick(e));
        this.canvas.addEventListener('mousemove', (e)=>this.handleCanvasHover(e));
        container.appendChild(this.canvas);
        return container;
    }
    createAgentPanel() {
        const panel = document.createElement('div');
        panel.className = 'agent-details-panel';
        panel.style.cssText = `
      background: #2a2a2a;
      border: 1px solid #444;
      border-radius: 8px;
      padding: 16px;
      margin: 8px 0;
      min-height: 200px;
    `;
        const title = document.createElement('h3');
        title.textContent = 'Agent Details';
        title.style.color = '#00d4ff';
        title.style.marginBottom = '12px';
        const content = document.createElement('div');
        content.id = 'agent-details-content';
        content.innerHTML = '<p style="color: #888;">Click on an agent to view details</p>';
        panel.appendChild(title);
        panel.appendChild(content);
        this.agentDetailsContent = content;
        return panel;
    }
    async startMonitoring() {
        if (this.isActive) return;
        this.isActive = true;
        this.controlElements.startBtn.setDisabled(true);
        this.controlElements.stopBtn.setDisabled(false);
        const refreshRate = parseInt(this.controlElements.refreshSelect.value);
        this.updateInterval = setInterval(()=>{
            this.updateSwarmData();
        }, refreshRate);
        this.startAnimation();
        await this.updateSwarmData();
        console.log('🔄 Swarm monitoring started');
    }
    stopMonitoring() {
        if (!this.isActive) return;
        this.isActive = false;
        this.controlElements.startBtn.setDisabled(false);
        this.controlElements.stopBtn.setDisabled(true);
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        console.log('⏹️ Swarm monitoring stopped');
    }
    async updateSwarmData() {
        try {
            const response = await fetch('/api/claude-flow/swarm/status');
            if (response.ok) {
                this.swarmData = await response.json();
                this.processSwarmData();
                this.updateStats();
                this.redrawTopology();
            }
        } catch (error) {
            console.warn('Failed to fetch swarm data:', error);
            this.generateMockData();
            this.processSwarmData();
            this.updateStats();
            this.redrawTopology();
        }
    }
    generateMockData() {
        const agentTypes = [
            'coder',
            'researcher',
            'analyzer',
            'reviewer',
            'tester'
        ];
        const statuses = [
            'active',
            'busy',
            'idle',
            'error'
        ];
        const agentCount = Math.floor(Math.random() * 8) + 3;
        this.swarmData = {
            id: `swarm_${Date.now()}`,
            topology: this.topology,
            agents: [],
            connections: [],
            metrics: {
                totalTasks: Math.floor(Math.random() * 100),
                completedTasks: Math.floor(Math.random() * 80),
                failedTasks: Math.floor(Math.random() * 5),
                averageResponseTime: Math.random() * 1000 + 500,
                throughput: Math.floor(Math.random() * 20) + 5
            }
        };
        for(let i = 0; i < agentCount; i++){
            const agent = {
                id: `agent_${i}`,
                type: agentTypes[Math.floor(Math.random() * agentTypes.length)],
                status: statuses[Math.floor(Math.random() * statuses.length)],
                capabilities: [
                    'task_processing',
                    'memory_access'
                ],
                currentTask: Math.random() > 0.5 ? `Task ${Math.floor(Math.random() * 100)}` : null,
                metrics: {
                    tasksCompleted: Math.floor(Math.random() * 50),
                    successRate: Math.random() * 100,
                    averageTime: Math.random() * 2000 + 200,
                    memoryUsage: Math.random() * 100
                },
                position: this.calculateAgentPosition(i, agentCount)
            };
            this.swarmData.agents.push(agent);
        }
        this.generateConnections();
    }
    calculateAgentPosition(index, total) {
        const centerX = this.canvasSize.width / 2;
        const centerY = this.canvasSize.height / 2;
        const radius = Math.min(centerX, centerY) * 0.7;
        switch(this.topology){
            case 'mesh':
            case 'ring':
                const angle = index * 2 * Math.PI / total;
                return {
                    x: centerX + radius * Math.cos(angle),
                    y: centerY + radius * Math.sin(angle)
                };
            case 'hierarchical':
                const levels = Math.ceil(Math.log2(total));
                const level = Math.floor(Math.log2(index + 1));
                const positionInLevel = index - (Math.pow(2, level) - 1);
                const levelWidth = Math.pow(2, level);
                return {
                    x: centerX + (positionInLevel - levelWidth / 2 + 0.5) * (this.canvasSize.width / (levelWidth + 1)),
                    y: 100 + level * (this.canvasSize.height - 200) / (levels - 1)
                };
            case 'star':
                if (index === 0) {
                    return {
                        x: centerX,
                        y: centerY
                    };
                } else {
                    const starAngle = (index - 1) * 2 * Math.PI / (total - 1);
                    return {
                        x: centerX + radius * Math.cos(starAngle),
                        y: centerY + radius * Math.sin(starAngle)
                    };
                }
            default:
                return {
                    x: Math.random() * (this.canvasSize.width - 100) + 50,
                    y: Math.random() * (this.canvasSize.height - 100) + 50
                };
        }
    }
    generateConnections() {
        if (!this.swarmData || !this.swarmData.agents) return;
        const agents = this.swarmData.agents;
        this.swarmData.connections = [];
        switch(this.topology){
            case 'mesh':
                for(let i = 0; i < agents.length; i++){
                    for(let j = i + 1; j < agents.length; j++){
                        this.swarmData.connections.push({
                            from: agents[i].id,
                            to: agents[j].id,
                            strength: Math.random(),
                            latency: Math.random() * 100 + 10
                        });
                    }
                }
                break;
            case 'ring':
                for(let i = 0; i < agents.length; i++){
                    const next = (i + 1) % agents.length;
                    this.swarmData.connections.push({
                        from: agents[i].id,
                        to: agents[next].id,
                        strength: Math.random(),
                        latency: Math.random() * 50 + 5
                    });
                }
                break;
            case 'star':
                if (agents.length > 0) {
                    for(let i = 1; i < agents.length; i++){
                        this.swarmData.connections.push({
                            from: agents[0].id,
                            to: agents[i].id,
                            strength: Math.random(),
                            latency: Math.random() * 30 + 5
                        });
                    }
                }
                break;
            case 'hierarchical':
                for(let i = 1; i < agents.length; i++){
                    const parent = Math.floor((i - 1) / 2);
                    this.swarmData.connections.push({
                        from: agents[parent].id,
                        to: agents[i].id,
                        strength: Math.random(),
                        latency: Math.random() * 40 + 5
                    });
                }
                break;
        }
    }
    processSwarmData() {
        if (!this.swarmData) return;
        this.agents.clear();
        this.swarmData.agents?.forEach((agent)=>{
            this.agents.set(agent.id, agent);
        });
        this.connections.clear();
        this.swarmData.connections?.forEach((conn)=>{
            this.connections.set(`${conn.from}-${conn.to}`, conn);
        });
    }
    updateStats() {
        if (!this.swarmData) return;
        const agents = Array.from(this.agents.values());
        const statusCounts = agents.reduce((acc, agent)=>{
            acc[agent.status] = (acc[agent.status] || 0) + 1;
            return acc;
        }, {});
        this.statsCards.totalAgents.setValue(agents.length.toString());
        this.statsCards.activeAgents.setValue((statusCounts.active || 0).toString());
        this.statsCards.busyAgents.setValue((statusCounts.busy || 0).toString());
        this.statsCards.idleAgents.setValue((statusCounts.idle || 0).toString());
        this.statsCards.errorAgents.setValue((statusCounts.error || 0).toString());
        if (this.swarmData.metrics) {
            this.statsCards.throughput.setValue(`${this.swarmData.metrics.throughput || 0}/min`);
        }
    }
    redrawTopology() {
        if (!this.ctx || !this.swarmData) return;
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvasSize.width, this.canvasSize.height);
        this.drawGrid();
        this.drawConnections();
        this.drawAgents();
        this.updateParticles();
    }
    drawGrid() {
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([
            2,
            4
        ]);
        const gridSize = 50;
        for(let x = 0; x < this.canvasSize.width; x += gridSize){
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvasSize.height);
            this.ctx.stroke();
        }
        for(let y = 0; y < this.canvasSize.height; y += gridSize){
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvasSize.width, y);
            this.ctx.stroke();
        }
        this.ctx.setLineDash([]);
    }
    drawConnections() {
        this.connections.forEach((conn, key)=>{
            const fromAgent = this.agents.get(conn.from);
            const toAgent = this.agents.get(conn.to);
            if (fromAgent && toAgent && fromAgent.position && toAgent.position) {
                this.ctx.strokeStyle = `rgba(0, 212, 255, ${conn.strength * 0.6 + 0.2})`;
                this.ctx.lineWidth = Math.max(1, conn.strength * 3);
                this.ctx.setLineDash([]);
                this.ctx.beginPath();
                this.ctx.moveTo(fromAgent.position.x, fromAgent.position.y);
                this.ctx.lineTo(toAgent.position.x, toAgent.position.y);
                this.ctx.stroke();
                const midX = (fromAgent.position.x + toAgent.position.x) / 2;
                const midY = (fromAgent.position.y + toAgent.position.y) / 2;
                this.ctx.fillStyle = '#666';
                this.ctx.font = '10px monospace';
                this.ctx.fillText(`${Math.round(conn.latency)}ms`, midX + 5, midY - 5);
            }
        });
    }
    drawAgents() {
        this.agents.forEach((agent)=>{
            if (!agent.position) return;
            const { x, y } = agent.position;
            const radius = 25;
            const statusColors = {
                active: '#22c55e',
                busy: '#f59e0b',
                idle: '#6b7280',
                error: '#ef4444'
            };
            this.ctx.fillStyle = statusColors[agent.status] || '#6b7280';
            this.ctx.beginPath();
            this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.strokeStyle = '#fff';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
            this.ctx.fillStyle = '#fff';
            this.ctx.font = 'bold 12px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(this.getAgentIcon(agent.type), x, y + 4);
            this.ctx.fillStyle = '#fff';
            this.ctx.font = '10px monospace';
            this.ctx.fillText(agent.id, x, y + radius + 15);
            if (agent.currentTask) {
                this.ctx.fillStyle = '#00d4ff';
                this.ctx.beginPath();
                this.ctx.arc(x + radius - 5, y - radius + 5, 5, 0, 2 * Math.PI);
                this.ctx.fill();
            }
        });
    }
    getAgentIcon(type) {
        const icons = {
            coder: '💻',
            researcher: '🔍',
            analyzer: '📊',
            reviewer: '✅',
            tester: '🧪',
            coordinator: '🎯',
            optimizer: '⚡'
        };
        return icons[type] || '🤖';
    }
    updateParticles() {
        this.particles = this.particles.filter((p)=>p.life > 0);
        if (Math.random() < 0.3) {
            this.connections.forEach((conn, key)=>{
                const fromAgent = this.agents.get(conn.from);
                const toAgent = this.agents.get(conn.to);
                if (fromAgent?.status === 'busy' && toAgent && fromAgent.position && toAgent.position) {
                    this.particles.push({
                        x: fromAgent.position.x,
                        y: fromAgent.position.y,
                        targetX: toAgent.position.x,
                        targetY: toAgent.position.y,
                        progress: 0,
                        life: 1,
                        speed: 0.02,
                        color: conn.strength > 0.7 ? '#00d4ff' : '#888'
                    });
                }
            });
        }
        this.particles.forEach((particle)=>{
            particle.progress += particle.speed;
            particle.life -= 0.01;
            const currentX = particle.x + (particle.targetX - particle.x) * particle.progress;
            const currentY = particle.y + (particle.targetY - particle.y) * particle.progress;
            this.ctx.fillStyle = particle.color;
            this.ctx.globalAlpha = particle.life;
            this.ctx.beginPath();
            this.ctx.arc(currentX, currentY, 3, 0, 2 * Math.PI);
            this.ctx.fill();
            this.ctx.globalAlpha = 1;
        });
    }
    handleCanvasClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const clickedAgent = Array.from(this.agents.values()).find((agent)=>{
            if (!agent.position) return false;
            const distance = Math.sqrt(Math.pow(x - agent.position.x, 2) + Math.pow(y - agent.position.y, 2));
            return distance <= 25;
        });
        if (clickedAgent) {
            this.showAgentDetails(clickedAgent);
        }
    }
    handleCanvasHover(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hoveredAgent = Array.from(this.agents.values()).find((agent)=>{
            if (!agent.position) return false;
            const distance = Math.sqrt(Math.pow(x - agent.position.x, 2) + Math.pow(y - agent.position.y, 2));
            return distance <= 25;
        });
        this.canvas.style.cursor = hoveredAgent ? 'pointer' : 'default';
    }
    showAgentDetails(agent) {
        const metrics = agent.metrics || {};
        const capabilities = agent.capabilities || [];
        this.agentDetailsContent.innerHTML = `
      <div class="agent-details">
        <div class="agent-header">
          <h4>${this.getAgentIcon(agent.type)} ${agent.id}</h4>
          <span class="status-badge status-${agent.status}">${agent.status}</span>
        </div>
        
        <div class="agent-info">
          <div class="info-row">
            <label>Type:</label>
            <span>${agent.type}</span>
          </div>
          <div class="info-row">
            <label>Current Task:</label>
            <span>${agent.currentTask || 'None'}</span>
          </div>
          <div class="info-row">
            <label>Capabilities:</label>
            <span>${capabilities.join(', ')}</span>
          </div>
        </div>

        <div class="agent-metrics">
          <h5>Performance Metrics</h5>
          <div class="metrics-grid">
            <div class="metric">
              <label>Tasks Completed:</label>
              <span>${metrics.tasksCompleted || 0}</span>
            </div>
            <div class="metric">
              <label>Success Rate:</label>
              <span>${Math.round(metrics.successRate || 0)}%</span>
            </div>
            <div class="metric">
              <label>Avg Response Time:</label>
              <span>${Math.round(metrics.averageTime || 0)}ms</span>
            </div>
            <div class="metric">
              <label>Memory Usage:</label>
              <span>${Math.round(metrics.memoryUsage || 0)}MB</span>
            </div>
          </div>
        </div>
      </div>
    `;
    }
    startAnimation() {
        const animate = ()=>{
            if (this.isActive) {
                this.redrawTopology();
                this.animationFrame = requestAnimationFrame(animate);
            }
        };
        animate();
    }
    createLabel(text, element) {
        const label = document.createElement('label');
        label.textContent = text;
        label.appendChild(element);
        label.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: #fff;
      font-size: 14px;
      margin: 0 8px;
    `;
        return label;
    }
    setupEventHandlers() {
        window.addEventListener('resize', ()=>{
            this.redrawTopology();
        });
    }
    async storeProgress() {
        const progress = {
            isActive: this.isActive,
            topology: this.topology,
            agentCount: this.agents.size,
            connectionCount: this.connections.size,
            timestamp: Date.now()
        };
        try {
            const response = await fetch('/api/claude-flow/memory/set', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    namespace: 'swarm_1756475726467_c9ey1p9vm',
                    key: 'frontend/swarm_visualizer',
                    value: JSON.stringify(progress)
                })
            });
        } catch (error) {
            console.warn('Failed to store progress:', error);
        }
    }
    destroy() {
        this.stopMonitoring();
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
export default SwarmVisualizer;

//# sourceMappingURL=swarm-visualizer.js.map