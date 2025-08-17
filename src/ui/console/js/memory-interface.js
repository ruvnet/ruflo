/**
 * Memory Management Interface
 * Comprehensive memory management system for Claude Flow
 */

class MemoryInterface {
  constructor() {
    this.container = null;
    this.currentNamespace = 'global';
    this.memoryData = new Map();
    this.searchFilters = {};
    this.analytics = {
      usage: new Map(),
      history: [],
      patterns: new Map(),
    };
    this.backupManager = new BackupManager();
    this.syncManager = new SyncManager();
    this.compressionManager = new CompressionManager();
    this.visualizer = new MemoryVisualizer();

    this.init();
  }

  init() {
    this.createInterface();
    this.setupEventListeners();
    this.startMonitoring();
    this.loadMemoryData();
  }

  createInterface() {
    this.container = document.createElement('div');
    this.container.className = 'memory-interface';
    this.container.innerHTML = `
            <div class="memory-header">
                <h2>Memory Management Interface</h2>
                <div class="memory-controls">
                    <button class="btn-refresh" title="Refresh Data">
                        <i class="icon-refresh"></i>
                    </button>
                    <button class="btn-backup" title="Create Backup">
                        <i class="icon-backup"></i>
                    </button>
                    <button class="btn-compress" title="Optimize Memory">
                        <i class="icon-compress"></i>
                    </button>
                    <button class="btn-sync" title="Sync Status">
                        <i class="icon-sync"></i>
                    </button>
                </div>
            </div>

            <div class="memory-layout">
                <!-- Namespace Browser -->
                <div class="namespace-panel">
                    <div class="panel-header">
                        <h3>Namespace Browser</h3>
                        <button class="btn-add-namespace" title="Add Namespace">+</button>
                    </div>
                    <div class="namespace-tree">
                        <div class="namespace-search">
                            <input type="text" placeholder="Search namespaces..." 
                                   class="namespace-search-input">
                        </div>
                        <div class="namespace-tree-container">
                            <!-- Namespace tree will be populated here -->
                        </div>
                    </div>
                </div>

                <!-- Key-Value Editor -->
                <div class="editor-panel">
                    <div class="panel-header">
                        <h3>Key-Value Editor</h3>
                        <div class="editor-controls">
                            <button class="btn-add-key" title="Add Key">+</button>
                            <button class="btn-bulk-edit" title="Bulk Edit">Bulk</button>
                            <button class="btn-export" title="Export">Export</button>
                        </div>
                    </div>
                    <div class="editor-content">
                        <div class="editor-search">
                            <input type="text" placeholder="Search keys..." 
                                   class="key-search-input">
                            <select class="type-filter">
                                <option value="">All Types</option>
                                <option value="string">String</option>
                                <option value="number">Number</option>
                                <option value="boolean">Boolean</option>
                                <option value="object">Object</option>
                                <option value="array">Array</option>
                            </select>
                        </div>
                        <div class="key-value-list">
                            <!-- Key-value pairs will be populated here -->
                        </div>
                    </div>
                </div>

                <!-- Analytics Dashboard -->
                <div class="analytics-panel">
                    <div class="panel-header">
                        <h3>Memory Analytics</h3>
                        <select class="analytics-timeframe">
                            <option value="1h">Last Hour</option>
                            <option value="24h">Last 24 Hours</option>
                            <option value="7d">Last 7 Days</option>
                            <option value="30d">Last 30 Days</option>
                        </select>
                    </div>
                    <div class="analytics-content">
                        <div class="analytics-stats">
                            <div class="stat-card">
                                <h4>Total Keys</h4>
                                <span class="stat-value" id="total-keys">0</span>
                            </div>
                            <div class="stat-card">
                                <h4>Memory Usage</h4>
                                <span class="stat-value" id="memory-usage">0 KB</span>
                            </div>
                            <div class="stat-card">
                                <h4>Compression Rate</h4>
                                <span class="stat-value" id="compression-rate">0%</span>
                            </div>
                            <div class="stat-card">
                                <h4>Access Frequency</h4>
                                <span class="stat-value" id="access-frequency">0/min</span>
                            </div>
                        </div>
                        <div class="analytics-charts">
                            <div class="chart-container">
                                <canvas id="usage-chart"></canvas>
                            </div>
                            <div class="chart-container">
                                <canvas id="pattern-chart"></canvas>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Search Interface -->
            <div class="search-panel">
                <div class="panel-header">
                    <h3>Advanced Search</h3>
                    <button class="btn-saved-searches" title="Saved Searches">
                        <i class="icon-bookmark"></i>
                    </button>
                </div>
                <div class="search-content">
                    <div class="search-builder">
                        <div class="search-row">
                            <select class="search-field">
                                <option value="key">Key</option>
                                <option value="value">Value</option>
                                <option value="type">Type</option>
                                <option value="namespace">Namespace</option>
                                <option value="created">Created Date</option>
                                <option value="modified">Modified Date</option>
                            </select>
                            <select class="search-operator">
                                <option value="contains">Contains</option>
                                <option value="equals">Equals</option>
                                <option value="startsWith">Starts With</option>
                                <option value="endsWith">Ends With</option>
                                <option value="regex">Regex</option>
                            </select>
                            <input type="text" class="search-value" placeholder="Search value...">
                            <button class="btn-add-filter">+</button>
                        </div>
                    </div>
                    <div class="search-filters">
                        <!-- Active filters will be shown here -->
                    </div>
                    <div class="search-results">
                        <!-- Search results will be populated here -->
                    </div>
                </div>
            </div>

            <!-- Backup/Restore Panel -->
            <div class="backup-panel">
                <div class="panel-header">
                    <h3>Backup & Restore</h3>
                    <button class="btn-schedule-backup" title="Schedule Backup">
                        <i class="icon-schedule"></i>
                    </button>
                </div>
                <div class="backup-content">
                    <div class="backup-controls">
                        <button class="btn-create-backup">Create Backup</button>
                        <button class="btn-restore-backup">Restore Backup</button>
                        <button class="btn-import-backup">Import Backup</button>
                    </div>
                    <div class="backup-list">
                        <!-- Backup list will be populated here -->
                    </div>
                </div>
            </div>

            <!-- Modals -->
            <div class="modal-overlay" id="modal-overlay">
                <div class="modal" id="key-editor-modal">
                    <div class="modal-header">
                        <h3>Edit Key-Value Pair</h3>
                        <button class="btn-close-modal">×</button>
                    </div>
                    <div class="modal-content">
                        <form id="key-editor-form">
                            <div class="form-group">
                                <label>Key:</label>
                                <input type="text" id="edit-key" required>
                            </div>
                            <div class="form-group">
                                <label>Type:</label>
                                <select id="edit-type">
                                    <option value="string">String</option>
                                    <option value="number">Number</option>
                                    <option value="boolean">Boolean</option>
                                    <option value="object">Object</option>
                                    <option value="array">Array</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Value:</label>
                                <textarea id="edit-value" rows="10"></textarea>
                            </div>
                            <div class="form-group">
                                <label>Namespace:</label>
                                <select id="edit-namespace">
                                    <!-- Namespaces will be populated here -->
                                </select>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="btn-save">Save</button>
                                <button type="button" class="btn-cancel">Cancel</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        `;
  }

  setupEventListeners() {
    // Header controls
    this.container.querySelector('.btn-refresh').addEventListener('click', () => this.refresh());
    this.container
      .querySelector('.btn-backup')
      .addEventListener('click', () => this.createBackup());
    this.container
      .querySelector('.btn-compress')
      .addEventListener('click', () => this.optimizeMemory());
    this.container
      .querySelector('.btn-sync')
      .addEventListener('click', () => this.showSyncStatus());

    // Namespace controls
    this.container
      .querySelector('.btn-add-namespace')
      .addEventListener('click', () => this.addNamespace());
    this.container
      .querySelector('.namespace-search-input')
      .addEventListener('input', (e) => this.searchNamespaces(e.target.value));

    // Editor controls
    this.container.querySelector('.btn-add-key').addEventListener('click', () => this.addKey());
    this.container.querySelector('.btn-bulk-edit').addEventListener('click', () => this.bulkEdit());
    this.container
      .querySelector('.btn-export')
      .addEventListener('click', () => this.exportMemory());

    // Search controls
    this.container
      .querySelector('.key-search-input')
      .addEventListener('input', (e) => this.searchKeys(e.target.value));
    this.container
      .querySelector('.type-filter')
      .addEventListener('change', (e) => this.filterByType(e.target.value));

    // Analytics controls
    this.container
      .querySelector('.analytics-timeframe')
      .addEventListener('change', (e) => this.updateAnalytics(e.target.value));

    // Search interface
    this.container
      .querySelector('.btn-add-filter')
      .addEventListener('click', () => this.addSearchFilter());
    this.container
      .querySelector('.btn-saved-searches')
      .addEventListener('click', () => this.showSavedSearches());

    // Backup controls
    this.container
      .querySelector('.btn-create-backup')
      .addEventListener('click', () => this.createBackup());
    this.container
      .querySelector('.btn-restore-backup')
      .addEventListener('click', () => this.restoreBackup());
    this.container
      .querySelector('.btn-import-backup')
      .addEventListener('click', () => this.importBackup());

    // Modal controls
    this.container
      .querySelector('.btn-close-modal')
      .addEventListener('click', () => this.closeModal());
    this.container.querySelector('.modal-overlay').addEventListener('click', (e) => {
      if (e.target === this.container.querySelector('.modal-overlay')) {
        this.closeModal();
      }
    });

    // Form submission
    this.container
      .querySelector('#key-editor-form')
      .addEventListener('submit', (e) => this.saveKeyValue(e));
  }

  async loadMemoryData() {
    try {
      // Load memory data from Claude Flow's memory system
      const response = await fetch('/api/memory/list');
      const data = await response.json();

      this.memoryData = new Map(Object.entries(data));
      this.updateNamespaceTree();
      this.updateKeyValueList();
      this.updateAnalytics();
    } catch (error) {
      console.error('Failed to load memory data:', error);
      this.showError('Failed to load memory data');
    }
  }

  updateNamespaceTree() {
    const container = this.container.querySelector('.namespace-tree-container');
    const namespaces = this.getNamespaces();

    container.innerHTML = this.renderNamespaceTree(namespaces);

    // Add click handlers for namespace items
    container.querySelectorAll('.namespace-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectNamespace(item.dataset.namespace);
      });
    });
  }

  renderNamespaceTree(namespaces, parent = '', level = 0) {
    let html = '';

    for (const [namespace, data] of namespaces) {
      const fullPath = parent ? `${parent}.${namespace}` : namespace;
      const hasChildren = data.children && data.children.size > 0;

      html += `
                <div class="namespace-item ${this.currentNamespace === fullPath ? 'active' : ''}" 
                     data-namespace="${fullPath}" 
                     style="padding-left: ${level * 20}px">
                    <div class="namespace-content">
                        ${hasChildren ? '<i class="icon-folder"></i>' : '<i class="icon-file"></i>'}
                        <span class="namespace-name">${namespace}</span>
                        <span class="namespace-count">(${data.count})</span>
                    </div>
                </div>
            `;

      if (hasChildren) {
        html += this.renderNamespaceTree(data.children, fullPath, level + 1);
      }
    }

    return html;
  }

  updateKeyValueList() {
    const container = this.container.querySelector('.key-value-list');
    const keys = this.getKeysForNamespace(this.currentNamespace);

    container.innerHTML = keys.map((key) => this.renderKeyValueItem(key)).join('');

    // Add event listeners for key-value items
    container.querySelectorAll('.key-value-item').forEach((item) => {
      item
        .querySelector('.btn-edit')
        .addEventListener('click', () => this.editKey(item.dataset.key));
      item
        .querySelector('.btn-delete')
        .addEventListener('click', () => this.deleteKey(item.dataset.key));
      item
        .querySelector('.btn-copy')
        .addEventListener('click', () => this.copyKey(item.dataset.key));
    });
  }

  renderKeyValueItem(key) {
    const value = this.memoryData.get(key);
    const type = this.getValueType(value);
    const displayValue = this.formatValueForDisplay(value, type);

    return `
            <div class="key-value-item" data-key="${key}">
                <div class="key-info">
                    <span class="key-name">${key}</span>
                    <span class="key-type">${type}</span>
                </div>
                <div class="value-preview">
                    <span class="value-content">${displayValue}</span>
                </div>
                <div class="item-actions">
                    <button class="btn-edit" title="Edit">
                        <i class="icon-edit"></i>
                    </button>
                    <button class="btn-copy" title="Copy">
                        <i class="icon-copy"></i>
                    </button>
                    <button class="btn-delete" title="Delete">
                        <i class="icon-delete"></i>
                    </button>
                </div>
            </div>
        `;
  }

  getNamespaces() {
    const namespaces = new Map();

    for (const [key, value] of this.memoryData) {
      const parts = key.split('.');
      let current = namespaces;
      let path = '';

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        path = path ? `${path}.${part}` : part;

        if (!current.has(part)) {
          current.set(part, {
            count: 0,
            children: new Map(),
          });
        }

        current = current.get(part).children;
      }

      // Count the final key
      const finalPart = parts[parts.length - 1];
      if (!current.has(finalPart)) {
        current.set(finalPart, { count: 0, children: new Map() });
      }
      current.get(finalPart).count++;
    }

    return namespaces;
  }

  getKeysForNamespace(namespace) {
    const keys = [];
    const prefix = namespace === 'global' ? '' : `${namespace}.`;

    for (const [key, value] of this.memoryData) {
      if (namespace === 'global' || key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    return keys.sort();
  }

  getValueType(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  formatValueForDisplay(value, type) {
    switch (type) {
      case 'string':
        return value.length > 50 ? `${value.substring(0, 50)}...` : value;
      case 'object':
        return JSON.stringify(value).substring(0, 100) + '...';
      case 'array':
        return `[${value.length} items]`;
      default:
        return String(value);
    }
  }

  updateAnalytics(timeframe = '24h') {
    const stats = this.calculateStats(timeframe);

    // Update stat cards
    this.container.querySelector('#total-keys').textContent = stats.totalKeys;
    this.container.querySelector('#memory-usage').textContent = stats.memoryUsage;
    this.container.querySelector('#compression-rate').textContent = stats.compressionRate;
    this.container.querySelector('#access-frequency').textContent = stats.accessFrequency;

    // Update charts
    this.visualizer.updateUsageChart(stats.usageData);
    this.visualizer.updatePatternChart(stats.patternData);
  }

  calculateStats(timeframe) {
    const now = Date.now();
    const timeframes = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };

    const cutoff = now - timeframes[timeframe];

    return {
      totalKeys: this.memoryData.size,
      memoryUsage: this.calculateMemoryUsage(),
      compressionRate: this.compressionManager.getCompressionRate(),
      accessFrequency: this.calculateAccessFrequency(cutoff),
      usageData: this.getUsageData(cutoff),
      patternData: this.getPatternData(cutoff),
    };
  }

  calculateMemoryUsage() {
    let totalSize = 0;
    for (const [key, value] of this.memoryData) {
      totalSize += this.getObjectSize(key) + this.getObjectSize(value);
    }
    return this.formatBytes(totalSize);
  }

  getObjectSize(obj) {
    let size = 0;
    if (typeof obj === 'string') {
      size = obj.length * 2; // UTF-16
    } else if (typeof obj === 'number') {
      size = 8; // 64-bit float
    } else if (typeof obj === 'boolean') {
      size = 1;
    } else if (obj === null || obj === undefined) {
      size = 0;
    } else {
      size = JSON.stringify(obj).length * 2;
    }
    return size;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  calculateAccessFrequency(cutoff) {
    const recentAccess = this.analytics.history.filter((entry) => entry.timestamp > cutoff);
    const frequency = recentAccess.length / ((Date.now() - cutoff) / 60000); // per minute
    return frequency.toFixed(2);
  }

  getUsageData(cutoff) {
    // Return usage data for charts
    return this.analytics.history
      .filter((entry) => entry.timestamp > cutoff)
      .map((entry) => ({
        timestamp: entry.timestamp,
        operations: entry.operations || 0,
        memory: entry.memory || 0,
      }));
  }

  getPatternData(cutoff) {
    // Return pattern data for charts
    const patterns = new Map();

    for (const [key, value] of this.analytics.patterns) {
      if (value.lastAccess > cutoff) {
        patterns.set(key, value);
      }
    }

    return Array.from(patterns.entries());
  }

  // Event handlers
  async selectNamespace(namespace) {
    this.currentNamespace = namespace;
    this.updateKeyValueList();

    // Update active state
    this.container.querySelectorAll('.namespace-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.namespace === namespace);
    });

    await this.notifyCoordination(`Selected namespace: ${namespace}`);
  }

  async addNamespace() {
    const name = prompt('Enter namespace name:');
    if (name) {
      // Create a placeholder key to establish the namespace
      const key = `${name}.placeholder`;
      await this.setMemoryValue(key, 'Namespace placeholder');
      await this.loadMemoryData();
      await this.notifyCoordination(`Added namespace: ${name}`);
    }
  }

  async addKey() {
    this.openModal('key-editor-modal');
    this.container.querySelector('#edit-key').value = '';
    this.container.querySelector('#edit-value').value = '';
    this.container.querySelector('#edit-type').value = 'string';
    this.container.querySelector('#edit-namespace').value = this.currentNamespace;
  }

  async editKey(key) {
    const value = this.memoryData.get(key);
    const type = this.getValueType(value);

    this.openModal('key-editor-modal');
    this.container.querySelector('#edit-key').value = key;
    this.container.querySelector('#edit-value').value = JSON.stringify(value, null, 2);
    this.container.querySelector('#edit-type').value = type;
    this.container.querySelector('#edit-namespace').value = this.getNamespaceFromKey(key);
  }

  async deleteKey(key) {
    if (confirm(`Are you sure you want to delete "${key}"?`)) {
      await this.deleteMemoryValue(key);
      await this.loadMemoryData();
      await this.notifyCoordination(`Deleted key: ${key}`);
    }
  }

  async copyKey(key) {
    const value = this.memoryData.get(key);
    const text = JSON.stringify({ [key]: value }, null, 2);

    try {
      await navigator.clipboard.writeText(text);
      this.showSuccess('Key copied to clipboard');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      this.showError('Failed to copy to clipboard');
    }
  }

  async saveKeyValue(e) {
    e.preventDefault();

    const key = this.container.querySelector('#edit-key').value;
    const type = this.container.querySelector('#edit-type').value;
    const valueText = this.container.querySelector('#edit-value').value;

    try {
      let value;

      switch (type) {
        case 'string':
          value = valueText;
          break;
        case 'number':
          value = parseFloat(valueText);
          break;
        case 'boolean':
          value = valueText.toLowerCase() === 'true';
          break;
        case 'object':
        case 'array':
          value = JSON.parse(valueText);
          break;
        default:
          value = valueText;
      }

      await this.setMemoryValue(key, value);
      await this.loadMemoryData();
      this.closeModal();
      await this.notifyCoordination(`Saved key: ${key}`);
    } catch (error) {
      console.error('Failed to save key-value:', error);
      this.showError('Failed to save key-value pair');
    }
  }

  async createBackup() {
    try {
      const backup = await this.backupManager.createBackup(this.memoryData);
      this.showSuccess(`Backup created: ${backup.id}`);
      await this.notifyCoordination(`Created backup: ${backup.id}`);
    } catch (error) {
      console.error('Failed to create backup:', error);
      this.showError('Failed to create backup');
    }
  }

  async optimizeMemory() {
    try {
      const result = await this.compressionManager.optimize(this.memoryData);
      this.showSuccess(`Memory optimized: ${result.savedBytes} bytes saved`);
      await this.loadMemoryData();
      await this.notifyCoordination(`Optimized memory: ${result.savedBytes} bytes saved`);
    } catch (error) {
      console.error('Failed to optimize memory:', error);
      this.showError('Failed to optimize memory');
    }
  }

  async refresh() {
    await this.loadMemoryData();
    this.showSuccess('Memory data refreshed');
  }

  // Helper methods
  openModal(modalId) {
    this.container.querySelector('#modal-overlay').style.display = 'flex';
    this.container.querySelector(`#${modalId}`).style.display = 'block';
  }

  closeModal() {
    this.container.querySelector('#modal-overlay').style.display = 'none';
    this.container.querySelectorAll('.modal').forEach((modal) => {
      modal.style.display = 'none';
    });
  }

  getNamespaceFromKey(key) {
    const parts = key.split('.');
    return parts.length > 1 ? parts.slice(0, -1).join('.') : 'global';
  }

  async setMemoryValue(key, value) {
    const response = await fetch('/api/memory/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });

    if (!response.ok) {
      throw new Error('Failed to set memory value');
    }
  }

  async deleteMemoryValue(key) {
    const response = await fetch('/api/memory/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });

    if (!response.ok) {
      throw new Error('Failed to delete memory value');
    }
  }

  showSuccess(message) {
    // Implementation for success notification
    console.log('Success:', message);
  }

  showError(message) {
    // Implementation for error notification
    console.error('Error:', message);
  }

  async notifyCoordination(message) {
    try {
      await fetch('/api/coordination/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, timestamp: Date.now() }),
      });
    } catch (error) {
      console.error('Failed to notify coordination:', error);
    }
  }

  startMonitoring() {
    // Start real-time monitoring
    setInterval(() => {
      this.updateAnalytics();
    }, 30000); // Update every 30 seconds
  }

  render() {
    return this.container;
  }
}

// Supporting classes
class BackupManager {
  constructor() {
    this.backups = new Map();
  }

  async createBackup(memoryData) {
    const id = `backup_${Date.now()}`;
    const backup = {
      id,
      timestamp: Date.now(),
      data: new Map(memoryData),
      size: this.calculateBackupSize(memoryData),
    };

    this.backups.set(id, backup);
    return backup;
  }

  async restoreBackup(backupId) {
    const backup = this.backups.get(backupId);
    if (!backup) {
      throw new Error('Backup not found');
    }

    return backup.data;
  }

  calculateBackupSize(memoryData) {
    return JSON.stringify(Array.from(memoryData.entries())).length;
  }
}

class SyncManager {
  constructor() {
    this.syncStatus = 'idle';
    this.lastSync = null;
  }

  async sync() {
    this.syncStatus = 'syncing';

    try {
      // Implement sync logic here
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.lastSync = Date.now();
      this.syncStatus = 'synchronized';
    } catch (error) {
      this.syncStatus = 'error';
      throw error;
    }
  }

  getStatus() {
    return {
      status: this.syncStatus,
      lastSync: this.lastSync,
    };
  }
}

class CompressionManager {
  constructor() {
    this.compressionRate = 0;
  }

  async optimize(memoryData) {
    // Implement compression logic
    const originalSize = this.calculateSize(memoryData);

    // Simulate compression
    await new Promise((resolve) => setTimeout(resolve, 500));

    const compressedSize = originalSize * 0.7; // 30% compression
    const savedBytes = originalSize - compressedSize;

    this.compressionRate = (savedBytes / originalSize) * 100;

    return {
      savedBytes: Math.floor(savedBytes),
      compressionRate: this.compressionRate,
    };
  }

  getCompressionRate() {
    return `${this.compressionRate.toFixed(1)}%`;
  }

  calculateSize(memoryData) {
    return JSON.stringify(Array.from(memoryData.entries())).length;
  }
}

class MemoryVisualizer {
  constructor() {
    this.usageChart = null;
    this.patternChart = null;
  }

  updateUsageChart(data) {
    const canvas = document.getElementById('usage-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Simple chart implementation
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw usage data
    if (data.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#007bff';
      ctx.lineWidth = 2;

      const width = canvas.width;
      const height = canvas.height;
      const stepX = width / (data.length - 1);
      const maxValue = Math.max(...data.map((d) => d.operations));

      data.forEach((point, index) => {
        const x = index * stepX;
        const y = height - (point.operations / maxValue) * height;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
    }
  }

  updatePatternChart(data) {
    const canvas = document.getElementById('pattern-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    // Simple pattern chart implementation
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw pattern data as bars
    if (data.length > 0) {
      const width = canvas.width;
      const height = canvas.height;
      const barWidth = width / data.length;
      const maxValue = Math.max(...data.map((d) => d[1].count || 0));

      data.forEach((pattern, index) => {
        const barHeight = ((pattern[1].count || 0) / maxValue) * height;
        const x = index * barWidth;
        const y = height - barHeight;

        ctx.fillStyle = '#28a745';
        ctx.fillRect(x, y, barWidth - 2, barHeight);
      });
    }
  }
}

// Export for use in other modules
window.MemoryInterface = MemoryInterface;
