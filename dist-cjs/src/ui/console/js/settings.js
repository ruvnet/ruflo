export class SettingsManager {
    constructor(){
        this.settings = this.loadSettings();
        this.settingsPanel = null;
        this.isVisible = false;
        this.defaults = {
            serverUrl: 'ws://localhost:3000/ws',
            authToken: '',
            autoConnect: true,
            theme: 'dark',
            fontSize: 14,
            lineHeight: 1.4,
            fontFamily: 'JetBrains Mono',
            autoScroll: true,
            showTimestamps: true,
            enableSounds: false,
            maxLines: 1000,
            defaultMode: 'coder',
            swarmStrategy: 'development',
            coordinationMode: 'centralized',
            reconnectAttempts: 5,
            heartbeatInterval: 30000,
            commandTimeout: 30000
        };
        this.settings = {
            ...this.defaults,
            ...this.settings
        };
        this.setupEventListeners();
    }
    init() {
        this.settingsPanel = document.getElementById('settingsPanel');
        this.setupSettingsPanel();
        this.applySettings();
    }
    setupSettingsPanel() {
        const settingsToggle = document.getElementById('settingsToggle');
        if (settingsToggle) {
            settingsToggle.addEventListener('click', ()=>this.toggle());
        }
        const closeButton = document.getElementById('closeSettings');
        if (closeButton) {
            closeButton.addEventListener('click', ()=>this.hide());
        }
        this.setupFormElements();
        this.setupActionButtons();
        document.addEventListener('click', (event)=>{
            if (this.isVisible && !this.settingsPanel.contains(event.target) && !document.getElementById('settingsToggle').contains(event.target)) {
                this.hide();
            }
        });
        document.addEventListener('keydown', (event)=>{
            if (event.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }
    setupFormElements() {
        this.bindSetting('serverUrl', 'input');
        this.bindSetting('authToken', 'input');
        this.bindSetting('fontSize', 'change', (value)=>{
            this.applyFontSize(parseInt(value));
        });
        this.bindSetting('theme', 'change', (value)=>{
            this.applyTheme(value);
        });
        this.bindSetting('lineHeight', 'change', (value)=>{
            this.applyLineHeight(parseFloat(value));
        });
        this.bindSetting('autoScroll', 'change', (value)=>{
            localStorage.setItem('console_auto_scroll', value);
        });
        this.bindSetting('showTimestamps', 'change', (value)=>{
            localStorage.setItem('console_show_timestamps', value);
        });
        this.bindSetting('enableSounds', 'change');
        this.bindSetting('maxLines', 'input', (value)=>{
            const maxLines = parseInt(value);
            if (maxLines >= 100 && maxLines <= 10000) {
                this.emit('max_lines_changed', maxLines);
            }
        });
        this.bindSetting('defaultMode', 'change');
        this.bindSetting('swarmStrategy', 'change');
        this.bindSetting('coordinationMode', 'change');
    }
    setupActionButtons() {
        const connectButton = document.getElementById('connectButton');
        const disconnectButton = document.getElementById('disconnectButton');
        if (connectButton) {
            connectButton.addEventListener('click', ()=>{
                this.emit('connect_requested', {
                    url: this.get('serverUrl'),
                    token: this.get('authToken')
                });
            });
        }
        if (disconnectButton) {
            disconnectButton.addEventListener('click', ()=>{
                this.emit('disconnect_requested');
            });
        }
        const resetButton = document.createElement('button');
        resetButton.className = 'reset-settings';
        resetButton.textContent = 'Reset to Defaults';
        resetButton.addEventListener('click', ()=>{
            if (confirm('Reset all settings to defaults? This cannot be undone.')) {
                this.resetToDefaults();
            }
        });
        const settingsContent = document.querySelector('.settings-content');
        if (settingsContent) {
            settingsContent.appendChild(resetButton);
        }
    }
    bindSetting(settingName, eventType, callback) {
        const element = document.getElementById(settingName);
        if (!element) return;
        const value = this.get(settingName);
        if (element.type === 'checkbox') {
            element.checked = value;
        } else {
            element.value = value;
        }
        element.addEventListener(eventType, (event)=>{
            let newValue;
            if (element.type === 'checkbox') {
                newValue = element.checked;
            } else if (element.type === 'number') {
                newValue = parseFloat(element.value);
            } else {
                newValue = element.value;
            }
            this.set(settingName, newValue);
            if (callback) {
                callback(newValue);
            }
        });
    }
    show() {
        if (this.settingsPanel) {
            this.settingsPanel.classList.add('visible');
            this.isVisible = true;
            const firstInput = this.settingsPanel.querySelector('input, select');
            if (firstInput) {
                firstInput.focus();
            }
        }
    }
    hide() {
        if (this.settingsPanel) {
            this.settingsPanel.classList.remove('visible');
            this.isVisible = false;
        }
    }
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }
    get(key) {
        return this.settings[key];
    }
    set(key, value) {
        this.settings[key] = value;
        this.saveSettings();
        this.emit('setting_changed', {
            key,
            value
        });
    }
    getAll() {
        return {
            ...this.settings
        };
    }
    setAll(newSettings) {
        this.settings = {
            ...this.settings,
            ...newSettings
        };
        this.saveSettings();
        this.updateFormElements();
        this.applySettings();
    }
    resetToDefaults() {
        this.settings = {
            ...this.defaults
        };
        this.saveSettings();
        this.updateFormElements();
        this.applySettings();
        this.emit('settings_reset');
    }
    loadSettings() {
        try {
            const stored = localStorage.getItem('claude_console_settings');
            return stored ? JSON.parse(stored) : {};
        } catch (error) {
            console.error('Failed to load settings:', error);
            return {};
        }
    }
    saveSettings() {
        try {
            localStorage.setItem('claude_console_settings', JSON.stringify(this.settings));
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }
    applySettings() {
        this.applyTheme(this.get('theme'));
        this.applyFontSize(this.get('fontSize'));
        this.applyLineHeight(this.get('lineHeight'));
        localStorage.setItem('console_auto_scroll', this.get('autoScroll'));
        localStorage.setItem('console_show_timestamps', this.get('showTimestamps'));
    }
    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('console_theme', theme);
    }
    applyFontSize(fontSize) {
        document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
    }
    applyLineHeight(lineHeight) {
        document.documentElement.style.setProperty('--line-height', lineHeight);
    }
    updateFormElements() {
        Object.keys(this.settings).forEach((key)=>{
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = this.get(key);
                } else {
                    element.value = this.get(key);
                }
            }
        });
    }
    exportSettings() {
        const exportData = {
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            settings: this.getAll()
        };
        const blob = new Blob([
            JSON.stringify(exportData, null, 2)
        ], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `claude-console-settings-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    async importSettings(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (data.settings) {
                this.setAll(data.settings);
                return true;
            } else {
                throw new Error('Invalid settings file format');
            }
        } catch (error) {
            console.error('Failed to import settings:', error);
            return false;
        }
    }
    validateSetting(key, value) {
        const validators = {
            fontSize: (v)=>v >= 10 && v <= 24,
            lineHeight: (v)=>v >= 1.0 && v <= 2.0,
            maxLines: (v)=>v >= 100 && v <= 10000,
            theme: (v)=>[
                    'dark',
                    'light',
                    'classic',
                    'matrix'
                ].includes(v),
            defaultMode: (v)=>[
                    'coder',
                    'architect',
                    'analyst',
                    'researcher',
                    'reviewer',
                    'tester',
                    'debugger',
                    'documenter',
                    'optimizer',
                    'designer'
                ].includes(v),
            swarmStrategy: (v)=>[
                    'development',
                    'research',
                    'analysis',
                    'testing',
                    'optimization',
                    'maintenance'
                ].includes(v),
            coordinationMode: (v)=>[
                    'centralized',
                    'hierarchical',
                    'distributed',
                    'mesh',
                    'hybrid'
                ].includes(v)
        };
        const validator = validators[key];
        return validator ? validator(value) : true;
    }
    updateConnectionStatus(status) {
        const connectButton = document.getElementById('connectButton');
        const disconnectButton = document.getElementById('disconnectButton');
        if (connectButton && disconnectButton) {
            if (status.connected) {
                connectButton.disabled = true;
                disconnectButton.disabled = false;
            } else {
                connectButton.disabled = false;
                disconnectButton.disabled = true;
            }
        }
        this.updateConnectionInfo(status);
    }
    updateConnectionInfo(status) {
        let infoElement = document.getElementById('connectionInfo');
        if (!infoElement) {
            infoElement = document.createElement('div');
            infoElement.id = 'connectionInfo';
            infoElement.className = 'connection-info';
            const connectionSection = document.querySelector('.setting-group');
            if (connectionSection) {
                connectionSection.appendChild(infoElement);
            }
        }
        const statusClass = status.connected ? 'connected' : status.connecting ? 'connecting' : 'disconnected';
        infoElement.className = `connection-info ${statusClass}`;
        const title = status.connected ? 'Connected' : status.connecting ? 'Connecting...' : 'Disconnected';
        const details = status.connected ? `Connected to ${status.url}\nPending requests: ${status.pendingRequests}\nQueued messages: ${status.queuedMessages}` : status.connecting ? `Attempting to connect to ${status.url}` : status.reconnectAttempts > 0 ? `Disconnected. Reconnect attempts: ${status.reconnectAttempts}` : 'Not connected';
        infoElement.innerHTML = `
      <div class="connection-info-title">${title}</div>
      <div class="connection-info-details">${details}</div>
    `;
    }
    setupEventListeners() {
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', (e)=>{
                if (this.get('theme') === 'auto') {
                    this.applyTheme(e.matches ? 'dark' : 'light');
                }
            });
        }
        window.addEventListener('resize', ()=>{
            this.applyFontSize(this.get('fontSize'));
        });
    }
    on(event, callback) {
        if (!this.eventListeners) {
            this.eventListeners = new Map();
        }
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    emit(event, data) {
        if (!this.eventListeners || !this.eventListeners.has(event)) {
            return;
        }
        this.eventListeners.get(event).forEach((callback)=>{
            try {
                callback(data);
            } catch (error) {
                console.error('Error in settings event listener:', error);
            }
        });
    }
    getClaudeFlowConfig() {
        return {
            defaultMode: this.get('defaultMode'),
            swarmStrategy: this.get('swarmStrategy'),
            coordinationMode: this.get('coordinationMode')
        };
    }
    getConnectionConfig() {
        return {
            url: this.get('serverUrl'),
            token: this.get('authToken'),
            autoConnect: this.get('autoConnect'),
            reconnectAttempts: this.get('reconnectAttempts'),
            heartbeatInterval: this.get('heartbeatInterval'),
            commandTimeout: this.get('commandTimeout')
        };
    }
}

//# sourceMappingURL=settings.js.map