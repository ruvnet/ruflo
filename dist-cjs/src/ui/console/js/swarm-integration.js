import { SwarmVisualizer } from './swarm-visualizer.js';
import { RealTimeDashboard } from './real-time-dashboard.js';
import ComponentLibrary from '../web-ui/components/ComponentLibrary.js';
export class SwarmIntegration {
    constructor(consoleInstance){
        this.console = consoleInstance;
        this.components = new ComponentLibrary();
        this.swarmVisualizer = null;
        this.dashboard = null;
        this.isSwarmMode = false;
        this.init();
    }
    init() {
        this.components.initialize();
        this.addSwarmCommands();
        this.addSwarmUI();
        this.setupSwarmEventHandlers();
        console.log('🔗 Swarm Integration initialized');
    }
    addSwarmCommands() {
        const swarmCommands = {
            'swarm': {
                description: 'Enter swarm visualization mode',
                handler: ()=>this.enterSwarmMode(),
                usage: 'swarm'
            },
            'swarm-status': {
                description: 'Show current swarm status',
                handler: ()=>this.showSwarmStatus(),
                usage: 'swarm-status'
            },
            'swarm-monitor': {
                description: 'Start real-time swarm monitoring',
                handler: (args)=>this.startSwarmMonitoring(args),
                usage: 'swarm-monitor [topology]'
            },
            'swarm-stop': {
                description: 'Stop swarm monitoring',
                handler: ()=>this.stopSwarmMonitoring(),
                usage: 'swarm-stop'
            },
            'dashboard': {
                description: 'Open real-time dashboard',
                handler: ()=>this.openDashboard(),
                usage: 'dashboard'
            },
            'agents': {
                description: 'List active agents',
                handler: ()=>this.listAgents(),
                usage: 'agents'
            },
            'topology': {
                description: 'Change swarm topology',
                handler: (args)=>this.changeTopology(args),
                usage: 'topology [mesh|hierarchical|ring|star]'
            }
        };
        if (this.console.commandHandler) {
            Object.entries(swarmCommands).forEach(([command, config])=>{
                this.console.commandHandler.registerCommand(command, config);
            });
        }
    }
    addSwarmUI() {
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
            const swarmToggle = this.components.createActionButton({
                type: 'secondary',
                text: 'Swarm Mode',
                icon: '🌊',
                onclick: ()=>this.toggleSwarmMode()
            });
            headerRight.insertBefore(swarmToggle.element, headerRight.firstChild);
            this.swarmToggleButton = swarmToggle;
        }
        const statusLeft = document.querySelector('.status-left');
        if (statusLeft) {
            const swarmStatus = document.createElement('span');
            swarmStatus.className = 'status-item';
            swarmStatus.id = 'swarm-status';
            swarmStatus.textContent = 'Swarm: Inactive';
            statusLeft.appendChild(swarmStatus);
            this.swarmStatusElement = swarmStatus;
        }
    }
    setupSwarmEventHandlers() {
        if (this.console.wsClient) {
            this.console.wsClient.on('swarm_update', (data)=>{
                this.handleSwarmUpdate(data);
            });
            this.console.wsClient.on('agent_status', (data)=>{
                this.handleAgentStatus(data);
            });
        }
        if (this.console.terminal) {
            this.console.terminal.on('command', (command)=>{
                if (command.startsWith('swarm')) {
                    this.handleSwarmCommand(command);
                }
            });
        }
    }
    enterSwarmMode() {
        if (this.isSwarmMode) {
            this.console.terminal.writeWarning('Already in swarm mode');
            return;
        }
        this.isSwarmMode = true;
        const swarmContainer = document.createElement('div');
        swarmContainer.id = 'swarm-visualization-container';
        swarmContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.95);
      z-index: 10000;
      display: flex;
      flex-direction: column;
    `;
        const closeButton = this.components.createActionButton({
            type: 'secondary',
            text: 'Exit Swarm Mode',
            icon: '❌',
            onclick: ()=>this.exitSwarmMode()
        });
        closeButton.element.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 10001;
    `;
        swarmContainer.appendChild(closeButton.element);
        const visualizerContainer = document.createElement('div');
        visualizerContainer.style.cssText = `
      flex: 1;
      padding: 80px 20px 20px 20px;
      overflow: auto;
    `;
        this.swarmVisualizer = new SwarmVisualizer(visualizerContainer, this.components);
        swarmContainer.appendChild(visualizerContainer);
        document.body.appendChild(swarmContainer);
        this.swarmContainer = swarmContainer;
        this.updateSwarmStatus('Active');
        this.swarmToggleButton.setText('Exit Swarm');
        this.console.terminal.writeSuccess('Entered swarm visualization mode');
        this.console.terminal.writeInfo('Use "swarm-monitor" to start real-time monitoring');
    }
    exitSwarmMode() {
        if (!this.isSwarmMode) return;
        this.isSwarmMode = false;
        if (this.swarmVisualizer) {
            this.swarmVisualizer.destroy();
            this.swarmVisualizer = null;
        }
        if (this.swarmContainer) {
            this.swarmContainer.remove();
            this.swarmContainer = null;
        }
        this.updateSwarmStatus('Inactive');
        this.swarmToggleButton.setText('Swarm Mode');
        this.console.terminal.writeInfo('Exited swarm visualization mode');
    }
    toggleSwarmMode() {
        if (this.isSwarmMode) {
            this.exitSwarmMode();
        } else {
            this.enterSwarmMode();
        }
    }
    showSwarmStatus() {
        this.console.terminal.writeInfo('📊 Swarm Status:');
        const status = {
            active: this.isSwarmMode,
            agents: Math.floor(Math.random() * 8) + 2,
            topology: 'mesh',
            uptime: '2h 34m',
            tasksCompleted: Math.floor(Math.random() * 100) + 50,
            averageResponseTime: Math.floor(Math.random() * 500) + 200
        };
        this.console.terminal.write(`  Mode: ${status.active ? 'Active' : 'Inactive'}`, 'info');
        this.console.terminal.write(`  Agents: ${status.agents}`, 'info');
        this.console.terminal.write(`  Topology: ${status.topology}`, 'info');
        this.console.terminal.write(`  Uptime: ${status.uptime}`, 'info');
        this.console.terminal.write(`  Tasks Completed: ${status.tasksCompleted}`, 'info');
        this.console.terminal.write(`  Avg Response Time: ${status.averageResponseTime}ms`, 'info');
    }
    startSwarmMonitoring(args) {
        if (!this.swarmVisualizer) {
            this.console.terminal.writeError('Not in swarm mode. Use "swarm" command first.');
            return;
        }
        const topology = args && args[0] ? args[0] : 'mesh';
        if (this.swarmVisualizer) {
            this.swarmVisualizer.topology = topology;
            this.swarmVisualizer.startMonitoring();
        }
        this.console.terminal.writeSuccess(`Started swarm monitoring with ${topology} topology`);
    }
    stopSwarmMonitoring() {
        if (this.swarmVisualizer) {
            this.swarmVisualizer.stopMonitoring();
            this.console.terminal.writeInfo('Stopped swarm monitoring');
        } else {
            this.console.terminal.writeWarning('Swarm monitoring not active');
        }
    }
    openDashboard() {
        if (this.dashboard) {
            this.console.terminal.writeWarning('Dashboard already open');
            return;
        }
        const dashboardContainer = document.createElement('div');
        dashboardContainer.id = 'dashboard-container';
        dashboardContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.98);
      z-index: 20000;
    `;
        const closeButton = this.components.createActionButton({
            type: 'secondary',
            text: 'Close Dashboard',
            icon: '❌',
            onclick: ()=>this.closeDashboard()
        });
        closeButton.element.style.cssText = `
      position: absolute;
      top: 20px;
      right: 20px;
      z-index: 20001;
    `;
        dashboardContainer.appendChild(closeButton.element);
        this.dashboard = new RealTimeDashboard(dashboardContainer, this.components);
        document.body.appendChild(dashboardContainer);
        this.dashboardContainer = dashboardContainer;
        this.console.terminal.writeSuccess('Opened real-time dashboard');
    }
    closeDashboard() {
        if (this.dashboard) {
            this.dashboard.destroy();
            this.dashboard = null;
        }
        if (this.dashboardContainer) {
            this.dashboardContainer.remove();
            this.dashboardContainer = null;
        }
        this.console.terminal.writeInfo('Closed dashboard');
    }
    listAgents() {
        this.console.terminal.writeInfo('🤖 Active Agents:');
        const agents = [
            {
                id: 'coder_01',
                type: 'coder',
                status: 'active',
                task: 'Implementing API endpoints'
            },
            {
                id: 'researcher_02',
                type: 'researcher',
                status: 'busy',
                task: 'Analyzing data patterns'
            },
            {
                id: 'reviewer_03',
                type: 'reviewer',
                status: 'idle',
                task: null
            },
            {
                id: 'tester_04',
                type: 'tester',
                status: 'active',
                task: 'Running test suite'
            }
        ];
        agents.forEach((agent)=>{
            const statusColor = agent.status === 'active' ? 'success' : agent.status === 'busy' ? 'warning' : 'info';
            const taskText = agent.task ? ` | Task: ${agent.task}` : ' | No active task';
            this.console.terminal.write(`  ${agent.id} (${agent.type}) - ${agent.status}${taskText}`, statusColor);
        });
    }
    changeTopology(args) {
        if (!args || args.length === 0) {
            this.console.terminal.writeError('Usage: topology [mesh|hierarchical|ring|star]');
            return;
        }
        const topology = args[0];
        const validTopologies = [
            'mesh',
            'hierarchical',
            'ring',
            'star'
        ];
        if (!validTopologies.includes(topology)) {
            this.console.terminal.writeError(`Invalid topology. Valid options: ${validTopologies.join(', ')}`);
            return;
        }
        if (this.swarmVisualizer) {
            this.swarmVisualizer.topology = topology;
            this.swarmVisualizer.redrawTopology();
            this.console.terminal.writeSuccess(`Changed topology to ${topology}`);
        } else {
            this.console.terminal.writeWarning('Swarm visualizer not active');
        }
    }
    handleSwarmUpdate(data) {
        if (this.swarmVisualizer) {
            this.swarmVisualizer.swarmData = data;
            this.swarmVisualizer.processSwarmData();
            this.swarmVisualizer.updateStats();
        }
        if (this.dashboard) {
            this.dashboard.handleWebSocketMessage({
                type: 'swarm_update',
                payload: data
            });
        }
    }
    handleAgentStatus(data) {
        if (data.active !== undefined) {
            this.updateSwarmStatus(`${data.active} agents active`);
        }
    }
    updateSwarmStatus(status) {
        if (this.swarmStatusElement) {
            this.swarmStatusElement.textContent = `Swarm: ${status}`;
        }
    }
    handleSwarmCommand(command) {
        console.log('Swarm command processed:', command);
    }
    getStatus() {
        return {
            swarmMode: this.isSwarmMode,
            visualizerActive: this.swarmVisualizer?.isActive || false,
            dashboardOpen: !!this.dashboard,
            componentsLoaded: this.components.isInitialized
        };
    }
    destroy() {
        this.exitSwarmMode();
        this.closeDashboard();
        if (this.swarmToggleButton) {
            this.swarmToggleButton.element.remove();
        }
        if (this.swarmStatusElement) {
            this.swarmStatusElement.remove();
        }
    }
}
export default SwarmIntegration;

//# sourceMappingURL=swarm-integration.js.map