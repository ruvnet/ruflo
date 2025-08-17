/**
 * Settings Manager for Claude Code Console
 * Handles configuration and preferences
 */

export class SettingsManager {
  constructor() {
    this.settings = this.loadSettings();
    this.settingsPanel = null;
    this.isVisible = false;

    // Default settings
    this.defaults = {
      // Connection settings
      serverUrl: 'ws://localhost:3000/ws',
      authToken: '',
      autoConnect: true,

      // Appearance settings
      theme: 'dark',
      fontSize: 14,
      lineHeight: 1.4,
      fontFamily: 'JetBrains Mono',

      // Behavior settings
      autoScroll: true,
      showTimestamps: true,
      enableSounds: false,
      maxLines: 1000,

      // Claude Flow settings
      defaultMode: 'coder',
      swarmStrategy: 'development',
      coordinationMode: 'centralized',

      // Advanced settings
      reconnectAttempts: 5,
      heartbeatInterval: 30000,
      commandTimeout: 30000,
    };

    // Merge defaults with loaded settings
    this.settings = { ...this.defaults, ...this.settings };

    this.setupEventListeners();
  }

  /**
   * Initialize settings panel
   */
  init() {
    this.settingsPanel = document.getElementById('settingsPanel');
    this.setupSettingsPanel();
    this.applySettings();
  }

  /**
   * Setup settings panel event listeners
   */
  setupSettingsPanel() {
    // Toggle button
    const settingsToggle = document.getElementById('settingsToggle');
    if (settingsToggle) {
      settingsToggle.addEventListener('click', () => this.toggle());
    }

    // Close button
    const closeButton = document.getElementById('closeSettings');
    if (closeButton) {
      closeButton.addEventListener('click', () => this.hide());
    }

    // Settings form elements
    this.setupFormElements();

    // Action buttons
    this.setupActionButtons();

    // Click outside to close
    document.addEventListener('click', (event) => {
      if (
        this.isVisible &&
        !this.settingsPanel.contains(event.target) &&
        !document.getElementById('settingsToggle').contains(event.target)
      ) {
        this.hide();
      }
    });

    // ESC key to close
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isVisible) {
        this.hide();
      }
    });
  }

  /**
   * Setup form element listeners
   */
  setupFormElements() {
    // Connection settings
    this.bindSetting('serverUrl', 'input');
    this.bindSetting('authToken', 'input');

    // Appearance settings
    this.bindSetting('fontSize', 'change', (value) => {
      this.applyFontSize(parseInt(value));
    });

    this.bindSetting('theme', 'change', (value) => {
      this.applyTheme(value);
    });

    this.bindSetting('lineHeight', 'change', (value) => {
      this.applyLineHeight(parseFloat(value));
    });

    // Behavior settings
    this.bindSetting('autoScroll', 'change', (value) => {
      localStorage.setItem('console_auto_scroll', value);
    });

    this.bindSetting('showTimestamps', 'change', (value) => {
      localStorage.setItem('console_show_timestamps', value);
    });

    this.bindSetting('enableSounds', 'change');

    this.bindSetting('maxLines', 'input', (value) => {
      const maxLines = parseInt(value);
      if (maxLines >= 100 && maxLines <= 10000) {
        this.emit('max_lines_changed', maxLines);
      }
    });

    // Claude Flow settings
    this.bindSetting('defaultMode', 'change');
    this.bindSetting('swarmStrategy', 'change');
    this.bindSetting('coordinationMode', 'change');
  }

  /**
   * Setup action buttons
   */
  setupActionButtons() {
    const connectButton = document.getElementById('connectButton');
    const disconnectButton = document.getElementById('disconnectButton');

    if (connectButton) {
      connectButton.addEventListener('click', () => {
        this.emit('connect_requested', {
          url: this.get('serverUrl'),
          token: this.get('authToken'),
        });
      });
    }

    if (disconnectButton) {
      disconnectButton.addEventListener('click', () => {
        this.emit('disconnect_requested');
      });
    }

    // Add reset button
    const resetButton = document.createElement('button');
    resetButton.className = 'reset-settings';
    resetButton.textContent = 'Reset to Defaults';
    resetButton.addEventListener('click', () => {
      if (confirm('Reset all settings to defaults? This cannot be undone.')) {
        this.resetToDefaults();
      }
    });

    const settingsContent = document.querySelector('.settings-content');
    if (settingsContent) {
      settingsContent.appendChild(resetButton);
    }
  }

  /**
   * Bind setting to form element
   */
  bindSetting(settingName, eventType, callback) {
    const element = document.getElementById(settingName);
    if (!element) return;

    // Set initial value
    const value = this.get(settingName);
    if (element.type === 'checkbox') {
      element.checked = value;
    } else {
      element.value = value;
    }

    // Listen for changes
    element.addEventListener(eventType, (event) => {
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

  /**
   * Show settings panel
   */
  show() {
    if (this.settingsPanel) {
      this.settingsPanel.classList.add('visible');
      this.isVisible = true;

      // Focus first input
      const firstInput = this.settingsPanel.querySelector('input, select');
      if (firstInput) {
        firstInput.focus();
      }
    }
  }

  /**
   * Hide settings panel
   */
  hide() {
    if (this.settingsPanel) {
      this.settingsPanel.classList.remove('visible');
      this.isVisible = false;
    }
  }

  /**
   * Toggle settings panel
   */
  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Get setting value
   */
  get(key) {
    return this.settings[key];
  }

  /**
   * Set setting value
   */
  set(key, value) {
    this.settings[key] = value;
    this.saveSettings();
    this.emit('setting_changed', { key, value });
  }

  /**
   * Get all settings
   */
  getAll() {
    return { ...this.settings };
  }

  /**
   * Set multiple settings
   */
  setAll(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    this.updateFormElements();
    this.applySettings();
  }

  /**
   * Reset to default settings
   */
  resetToDefaults() {
    this.settings = { ...this.defaults };
    this.saveSettings();
    this.updateFormElements();
    this.applySettings();
    this.emit('settings_reset');
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const stored = localStorage.getItem('claude_console_settings');
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error('Failed to load settings:', error);
      return {};
    }
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      localStorage.setItem('claude_console_settings', JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  /**
   * Apply all settings to the UI
   */
  applySettings() {
    this.applyTheme(this.get('theme'));
    this.applyFontSize(this.get('fontSize'));
    this.applyLineHeight(this.get('lineHeight'));

    // Set individual localStorage items for terminal
    localStorage.setItem('console_auto_scroll', this.get('autoScroll'));
    localStorage.setItem('console_show_timestamps', this.get('showTimestamps'));
  }

  /**
   * Apply theme
   */
  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('console_theme', theme);
  }

  /**
   * Apply font size
   */
  applyFontSize(fontSize) {
    document.documentElement.style.setProperty('--font-size-base', `${fontSize}px`);
  }

  /**
   * Apply line height
   */
  applyLineHeight(lineHeight) {
    document.documentElement.style.setProperty('--line-height', lineHeight);
  }

  /**
   * Update form elements with current settings
   */
  updateFormElements() {
    Object.keys(this.settings).forEach((key) => {
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

  /**
   * Export settings
   */
  exportSettings() {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      settings: this.getAll(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
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

  /**
   * Import settings
   */
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

  /**
   * Validate setting value
   */
  validateSetting(key, value) {
    const validators = {
      fontSize: (v) => v >= 10 && v <= 24,
      lineHeight: (v) => v >= 1.0 && v <= 2.0,
      maxLines: (v) => v >= 100 && v <= 10000,
      theme: (v) => ['dark', 'light', 'classic', 'matrix'].includes(v),
      defaultMode: (v) =>
        [
          'coder',
          'architect',
          'analyst',
          'researcher',
          'reviewer',
          'tester',
          'debugger',
          'documenter',
          'optimizer',
          'designer',
        ].includes(v),
      swarmStrategy: (v) =>
        ['development', 'research', 'analysis', 'testing', 'optimization', 'maintenance'].includes(
          v,
        ),
      coordinationMode: (v) =>
        ['centralized', 'hierarchical', 'distributed', 'mesh', 'hybrid'].includes(v),
    };

    const validator = validators[key];
    return validator ? validator(value) : true;
  }

  /**
   * Update connection status in settings
   */
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

    // Update connection info if it exists
    this.updateConnectionInfo(status);
  }

  /**
   * Update connection info display
   */
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

    const statusClass = status.connected
      ? 'connected'
      : status.connecting
        ? 'connecting'
        : 'disconnected';

    infoElement.className = `connection-info ${statusClass}`;

    const title = status.connected
      ? 'Connected'
      : status.connecting
        ? 'Connecting...'
        : 'Disconnected';

    const details = status.connected
      ? `Connected to ${status.url}\nPending requests: ${status.pendingRequests}\nQueued messages: ${status.queuedMessages}`
      : status.connecting
        ? `Attempting to connect to ${status.url}`
        : status.reconnectAttempts > 0
          ? `Disconnected. Reconnect attempts: ${status.reconnectAttempts}`
          : 'Not connected';

    infoElement.innerHTML = `
      <div class="connection-info-title">${title}</div>
      <div class="connection-info-details">${details}</div>
    `;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Listen for theme changes from system
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        if (this.get('theme') === 'auto') {
          this.applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }

    // Listen for font size changes from browser zoom
    window.addEventListener('resize', () => {
      this.applyFontSize(this.get('fontSize'));
    });
  }

  /**
   * Event emitter functionality
   */
  on(event, callback) {
    if (!this.eventListeners) {
      this.eventListeners = new Map();
    }

    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }

    this.eventListeners.get(event).push(callback);
  }

  /**
   * Emit event
   */
  emit(event, data) {
    if (!this.eventListeners || !this.eventListeners.has(event)) {
      return;
    }

    this.eventListeners.get(event).forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error('Error in settings event listener:', error);
      }
    });
  }

  /**
   * Get Claude Flow configuration
   */
  getClaudeFlowConfig() {
    return {
      defaultMode: this.get('defaultMode'),
      swarmStrategy: this.get('swarmStrategy'),
      coordinationMode: this.get('coordinationMode'),
    };
  }

  /**
   * Get connection configuration
   */
  getConnectionConfig() {
    return {
      url: this.get('serverUrl'),
      token: this.get('authToken'),
      autoConnect: this.get('autoConnect'),
      reconnectAttempts: this.get('reconnectAttempts'),
      heartbeatInterval: this.get('heartbeatInterval'),
      commandTimeout: this.get('commandTimeout'),
    };
  }
}
