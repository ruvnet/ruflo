/**
 * Dynamic Configuration for Console UI
 * Reads port configuration from server or falls back to defaults
 */

class ConfigManager {
  constructor() {
    this.config = {
      port: 3000,
      hostname: 'localhost',
      protocol: 'http',
      wsProtocol: 'ws'
    };
    this.configLoaded = false;
  }

  /**
   * Load configuration from server
   */
  async loadConfig() {
    try {
      // Try to fetch config from current server
      const response = await fetch('/api/config/port');
      if (response.ok) {
        const data = await response.json();
        this.config.port = data.port || 3000;
        console.log(`✅ Loaded port ${this.config.port} from server config`);
      }
    } catch (err) {
      // If fetch fails, check if we're running on a non-standard port
      const currentPort = window.location.port;
      if (currentPort && currentPort !== '80' && currentPort !== '443') {
        this.config.port = parseInt(currentPort);
        console.log(`📍 Using current page port: ${this.config.port}`);
      } else {
        console.log(`⚠️ Using default port: ${this.config.port}`);
      }
    }
    
    this.configLoaded = true;
    return this.config;
  }

  /**
   * Get WebSocket URL with dynamic port
   */
  getWebSocketUrl(path = '/ws') {
    const port = this.config.port;
    const hostname = this.config.hostname;
    const protocol = this.config.wsProtocol;
    return `${protocol}://${hostname}:${port}${path}`;
  }

  /**
   * Get HTTP URL with dynamic port
   */
  getHttpUrl(path = '') {
    const port = this.config.port;
    const hostname = this.config.hostname;
    const protocol = this.config.protocol;
    return `${protocol}://${hostname}:${port}${path}`;
  }

  /**
   * Get the current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates) {
    this.config = { ...this.config, ...updates };
    return this.config;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

// Auto-load config when script loads
if (typeof window !== 'undefined') {
  configManager.loadConfig().then(() => {
    console.log('🔧 Console configuration loaded:', configManager.getConfig());
  });
}

// Export for module usage
export default configManager;