import { WebSocketClient } from './websocket-client.js';
import { TerminalEmulator } from './terminal-emulator.js';
import { CommandHandler } from './command-handler.js';
import { SettingsManager } from './settings.js';
let ClaudeCodeConsole = class ClaudeCodeConsole {
    constructor(){
        this.wsClient = new WebSocketClient();
        this.terminal = null;
        this.commandHandler = null;
        this.settings = new SettingsManager();
        this.isInitialized = false;
        this.startTime = Date.now();
        this.messageCount = 0;
        this.activeAgents = 0;
        this.elements = {};
        this.statusInterval = null;
        this.uptimeInterval = null;
        this.setupEventListeners();
    }
    async init() {
        if (this.isInitialized) return;
        try {
            this.showLoading('Initializing Claude Code Console...');
            this.getDOMElements();
            this.terminal = new TerminalEmulator(this.elements.consoleOutput, this.elements.consoleInput);
            this.commandHandler = new CommandHandler(this.terminal, this.wsClient);
            this.settings.init();
            this.setupComponentInteractions();
            this.setupUIEventHandlers();
            this.applyInitialSettings();
            this.startStatusUpdates();
            this.hideLoading();
            this.showWelcomeMessage();
            if (this.settings.get('autoConnect')) {
                await this.autoConnect();
            }
            this.isInitialized = true;
            console.log('Claude Code Console initialized successfully');
        } catch (error) {
            console.error('Failed to initialize console:', error);
            this.showError('Failed to initialize console: ' + error.message);
        }
    }
    getDOMElements() {
        this.elements = {
            consoleOutput: document.getElementById('consoleOutput'),
            consoleInput: document.getElementById('consoleInput'),
            settingsPanel: document.getElementById('settingsPanel'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            connectionStatus: document.getElementById('connectionStatus'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            currentMode: document.getElementById('currentMode'),
            activeAgents: document.getElementById('activeAgents'),
            uptime: document.getElementById('uptime'),
            memoryUsage: document.getElementById('memoryUsage'),
            messageCount: document.getElementById('messageCount'),
            timestamp: document.getElementById('timestamp'),
            clearConsole: document.getElementById('clearConsole'),
            fullscreenToggle: document.getElementById('fullscreenToggle')
        };
        const required = [
            'consoleOutput',
            'consoleInput',
            'loadingOverlay'
        ];
        for (const elementId of required){
            if (!this.elements[elementId]) {
                throw new Error(`Required element not found: ${elementId}`);
            }
        }
    }
    setupComponentInteractions() {
        this.terminal.on('command', (command)=>{
            this.commandHandler.processCommand(command);
        });
        this.terminal.on('interrupt', ()=>{
            this.handleInterrupt();
        });
        this.wsClient.on('connected', ()=>{
            this.updateConnectionStatus(true, false);
            this.terminal.writeSuccess('Connected to Claude Code server');
            this.terminal.setPrompt('claude-flow>');
        });
        this.wsClient.on('disconnected', (info)=>{
            this.updateConnectionStatus(false, false);
            this.terminal.writeWarning('Disconnected from server');
            this.terminal.setPrompt('offline>');
            if (info && info.code !== 1000) {
                this.terminal.writeError(`Connection lost: ${info.reason || 'Unknown reason'}`);
            }
        });
        this.wsClient.on('reconnecting', (info)=>{
            this.updateConnectionStatus(false, true);
            this.terminal.writeInfo(`Reconnecting... (${info.attempt}/${this.wsClient.maxReconnectAttempts})`);
        });
        this.wsClient.on('error', (error)=>{
            this.terminal.writeError(`WebSocket error: ${error.message || 'Unknown error'}`);
        });
        this.wsClient.on('message_received', (message)=>{
            this.messageCount++;
            this.handleIncomingMessage(message);
        });
        this.wsClient.on('notification', (notification)=>{
            this.handleNotification(notification);
        });
        this.settings.on('connect_requested', async (config)=>{
            await this.connect(config.url, config.token);
        });
        this.settings.on('disconnect_requested', ()=>{
            this.disconnect();
        });
        this.settings.on('max_lines_changed', (maxLines)=>{
            this.terminal.setMaxLines(maxLines);
        });
        this.settings.on('setting_changed', ({ key, value })=>{
            this.handleSettingChange(key, value);
        });
    }
    setupUIEventHandlers() {
        if (this.elements.clearConsole) {
            this.elements.clearConsole.addEventListener('click', ()=>{
                this.terminal.clear();
            });
        }
        if (this.elements.fullscreenToggle) {
            this.elements.fullscreenToggle.addEventListener('click', ()=>{
                this.toggleFullscreen();
            });
        }
        if (this.elements.consoleOutput) {
            this.elements.consoleOutput.addEventListener('click', ()=>{
                this.terminal.focus();
            });
        }
        window.addEventListener('focus', ()=>{
            this.terminal.focus();
        });
        document.addEventListener('visibilitychange', ()=>{
            if (!document.hidden) {
                this.updateTimestamp();
            }
        });
        window.addEventListener('beforeunload', ()=>{
            this.cleanup();
        });
    }
    applyInitialSettings() {
        const maxLines = this.settings.get('maxLines');
        if (maxLines) {
            this.terminal.setMaxLines(maxLines);
        }
        this.settings.updateConnectionStatus(this.wsClient.getStatus());
    }
    showWelcomeMessage() {
        this.terminal.showWelcomeMessage();
        this.terminal.writeInfo('Console ready. Type "help" for available commands.');
        const config = this.settings.getConnectionConfig();
        if (config.url && !config.autoConnect) {
            this.terminal.writeInfo(`Use "connect" to connect to ${config.url}`);
        }
    }
    async autoConnect() {
        const config = this.settings.getConnectionConfig();
        if (config.url) {
            this.terminal.writeInfo(`Auto-connecting to ${config.url}...`);
            await this.connect(config.url, config.token);
        }
    }
    async connect(url, token = '') {
        try {
            this.updateConnectionStatus(false, true);
            await this.wsClient.connect(url, token);
            await this.wsClient.initializeSession();
            this.settings.set('serverUrl', url);
            if (token) {
                this.settings.set('authToken', token);
            }
        } catch (error) {
            this.updateConnectionStatus(false, false);
            this.terminal.writeError(`Connection failed: ${error.message}`);
        }
    }
    disconnect() {
        this.wsClient.disconnect();
        this.updateConnectionStatus(false, false);
    }
    updateConnectionStatus(connected, connecting) {
        const status = this.wsClient.getStatus();
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.className = 'status-indicator ' + (connected ? 'connected' : connecting ? 'connecting' : '');
        }
        if (this.elements.statusText) {
            this.elements.statusText.textContent = connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected';
        }
        this.settings.updateConnectionStatus(status);
    }
    handleIncomingMessage(message) {
        if (message.method === 'output/stream') {
            this.handleStreamingOutput(message.params);
        }
        if (message.method && message.method.startsWith('claude-flow/')) {
            this.handleClaudeFlowNotification(message);
        }
    }
    handleNotification(notification) {
        const { method, params } = notification;
        switch(method){
            case 'agent/status':
                this.handleAgentStatus(params);
                break;
            case 'swarm/update':
                this.handleSwarmUpdate(params);
                break;
            case 'memory/update':
                this.handleMemoryUpdate(params);
                break;
            case 'log/message':
                this.handleLogMessage(params);
                break;
            case 'connection/established':
                this.handleConnectionEstablished(params);
                break;
            default:
                console.log('Unhandled notification:', method, params);
        }
    }
    handleStreamingOutput(params) {
        if (params && params.content) {
            const type = params.type || 'output';
            if (params.streaming) {
                this.terminal.streamText(params.content, 10);
            } else {
                this.terminal.write(params.content, type);
            }
        }
    }
    handleClaudeFlowNotification(message) {
        const { method, params } = message;
        switch(method){
            case 'claude-flow/started':
                this.terminal.writeSuccess(`Claude Flow started in ${params.mode} mode`);
                break;
            case 'claude-flow/stopped':
                this.terminal.writeInfo('Claude Flow stopped');
                break;
            case 'claude-flow/error':
                this.terminal.writeError(`Claude Flow error: ${params.message}`);
                break;
            default:
                this.terminal.writeInfo(`Claude Flow: ${method} - ${JSON.stringify(params)}`);
        }
    }
    handleAgentStatus(params) {
        if (params.active !== undefined) {
            this.activeAgents = params.active;
        }
        if (params.message) {
            this.terminal.writeInfo(`Agent: ${params.message}`);
        }
    }
    handleSwarmUpdate(params) {
        if (params.message) {
            this.terminal.writeInfo(`Swarm: ${params.message}`);
        }
    }
    handleMemoryUpdate(params) {
        if (params.message) {
            this.terminal.writeInfo(`Memory: ${params.message}`);
        }
    }
    handleLogMessage(params) {
        if (params.level && params.message) {
            const type = params.level === 'error' ? 'error' : params.level === 'warn' ? 'warning' : 'info';
            this.terminal.write(`[${params.level.toUpperCase()}] ${params.message}`, type);
        }
    }
    handleConnectionEstablished(params) {
        console.log('Connection established:', params);
    }
    handleInterrupt() {
        this.terminal.writeWarning('Interrupt signal sent');
    }
    handleSettingChange(key, value) {
        switch(key){
            case 'theme':
                document.documentElement.setAttribute('data-theme', value);
                break;
            case 'fontSize':
                document.documentElement.style.setProperty('--font-size-base', `${value}px`);
                break;
            case 'lineHeight':
                document.documentElement.style.setProperty('--line-height', value);
                break;
        }
    }
    startStatusUpdates() {
        this.statusInterval = setInterval(()=>{
            this.updateStatus();
        }, 5000);
        this.uptimeInterval = setInterval(()=>{
            this.updateUptime();
            this.updateTimestamp();
        }, 1000);
        this.updateStatus();
        this.updateUptime();
        this.updateTimestamp();
    }
    updateStatus() {
        if (this.elements.activeAgents) {
            this.elements.activeAgents.textContent = `Agents: ${this.activeAgents}`;
        }
        if (this.elements.messageCount) {
            this.elements.messageCount.textContent = `Messages: ${this.messageCount}`;
        }
        if (this.elements.memoryUsage && performance.memory) {
            const used = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
            this.elements.memoryUsage.textContent = `Memory: ${used}MB`;
        }
    }
    updateUptime() {
        if (this.elements.uptime) {
            const uptime = Date.now() - this.startTime;
            const hours = Math.floor(uptime / (1000 * 60 * 60));
            const minutes = Math.floor(uptime % (1000 * 60 * 60) / (1000 * 60));
            const seconds = Math.floor(uptime % (1000 * 60) / 1000);
            this.elements.uptime.textContent = `Uptime: ${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }
    updateTimestamp() {
        if (this.elements.timestamp) {
            this.elements.timestamp.textContent = new Date().toLocaleTimeString();
        }
    }
    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch((err)=>{
                console.error('Error attempting to enable fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }
    showLoading(message = 'Loading...') {
        if (this.elements.loadingOverlay) {
            const loadingText = this.elements.loadingOverlay.querySelector('.loading-text');
            if (loadingText) {
                loadingText.textContent = message;
            }
            this.elements.loadingOverlay.classList.remove('hidden');
        }
    }
    hideLoading() {
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.classList.add('hidden');
        }
    }
    showError(message) {
        this.hideLoading();
        if (this.terminal) {
            this.terminal.writeError(message);
        } else {
            console.error(message);
            alert(message);
        }
    }
    setupEventListeners() {
        window.addEventListener('unhandledrejection', (event)=>{
            console.error('Unhandled promise rejection:', event.reason);
            if (this.terminal) {
                this.terminal.writeError(`Unhandled error: ${event.reason.message || event.reason}`);
            }
        });
        window.addEventListener('error', (event)=>{
            console.error('Global error:', event.error);
            if (this.terminal) {
                this.terminal.writeError(`Application error: ${event.error.message || event.error}`);
            }
        });
    }
    cleanup() {
        if (this.statusInterval) {
            clearInterval(this.statusInterval);
        }
        if (this.uptimeInterval) {
            clearInterval(this.uptimeInterval);
        }
        if (this.wsClient) {
            this.wsClient.disconnect();
        }
    }
    getStats() {
        return {
            initialized: this.isInitialized,
            uptime: Date.now() - this.startTime,
            messageCount: this.messageCount,
            activeAgents: this.activeAgents,
            connection: this.wsClient.getStatus(),
            terminal: this.terminal ? this.terminal.getStats() : null
        };
    }
};
document.addEventListener('DOMContentLoaded', async ()=>{
    const console1 = new ClaudeCodeConsole();
    window.claudeConsole = console1;
    await console1.init();
});
export { ClaudeCodeConsole };

//# sourceMappingURL=console.js.map