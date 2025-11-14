export class MCPRegistryClient {
    config;
    logger;
    getTools;
    getCapabilities;
    getHealth;
    registryUrl;
    healthCheckInterval;
    constructor(config, logger, getTools, getCapabilities, getHealth){
        this.config = config;
        this.logger = logger;
        this.getTools = getTools;
        this.getCapabilities = getCapabilities;
        this.getHealth = getHealth;
        this.registryUrl = config.registryUrl || 'https://registry.mcp.anthropic.com/api/v1';
    }
    async register() {
        if (!this.config.enabled) {
            this.logger.info('Registry registration disabled');
            return;
        }
        try {
            const entry = await this.buildRegistryEntry();
            this.logger.info('Registering server with MCP Registry', {
                server_id: entry.server_id,
                endpoint: entry.endpoint,
                capabilities: entry.capabilities
            });
            const response = await fetch(`${this.registryUrl}/servers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.apiKey && {
                        'Authorization': `Bearer ${this.config.apiKey}`
                    }
                },
                body: JSON.stringify(entry)
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Registration failed: ${response.status} - ${error}`);
            }
            const result = await response.json();
            this.logger.info('Server registered successfully', {
                server_id: result.server_id
            });
            this.startHealthReporting();
        } catch (error) {
            this.logger.error('Failed to register with MCP Registry', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async updateMetadata(updates) {
        if (!this.config.enabled) {
            return;
        }
        try {
            this.logger.info('Updating server metadata in registry', {
                server_id: this.config.serverId
            });
            const response = await fetch(`${this.registryUrl}/servers/${this.config.serverId}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.apiKey && {
                        'Authorization': `Bearer ${this.config.apiKey}`
                    }
                },
                body: JSON.stringify(updates)
            });
            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Update failed: ${response.status} - ${error}`);
            }
            this.logger.info('Server metadata updated successfully');
        } catch (error) {
            this.logger.error('Failed to update metadata', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async reportHealth() {
        if (!this.config.enabled) {
            return;
        }
        try {
            const health = await this.getHealth();
            const response = await fetch(`${this.registryUrl}/servers/${this.config.serverId}/health`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.apiKey && {
                        'Authorization': `Bearer ${this.config.apiKey}`
                    }
                },
                body: JSON.stringify({
                    status: health.status,
                    last_check: new Date().toISOString(),
                    latency_ms: health.latency_ms
                })
            });
            if (!response.ok) {
                this.logger.warn('Health report failed', {
                    status: response.status
                });
            }
        } catch (error) {
            this.logger.error('Failed to report health', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async searchServers(query) {
        try {
            const params = new URLSearchParams();
            if (query.category) {
                params.set('category', query.category);
            }
            if (query.tags) {
                params.set('tags', query.tags.join(','));
            }
            if (query.capabilities) {
                params.set('capabilities', query.capabilities.join(','));
            }
            if (query.limit) {
                params.set('limit', query.limit.toString());
            }
            const response = await fetch(`${this.registryUrl}/servers?${params}`);
            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }
            const results = await response.json();
            return results.servers || [];
        } catch (error) {
            this.logger.error('Failed to search servers', {
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    async unregister() {
        if (!this.config.enabled) {
            return;
        }
        this.stopHealthReporting();
        try {
            this.logger.info('Unregistering from MCP Registry', {
                server_id: this.config.serverId
            });
            const response = await fetch(`${this.registryUrl}/servers/${this.config.serverId}`, {
                method: 'DELETE',
                headers: {
                    ...this.config.apiKey && {
                        'Authorization': `Bearer ${this.config.apiKey}`
                    }
                }
            });
            if (!response.ok) {
                this.logger.warn('Unregistration failed', {
                    status: response.status
                });
            } else {
                this.logger.info('Server unregistered successfully');
            }
        } catch (error) {
            this.logger.error('Failed to unregister', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async buildRegistryEntry() {
        const tools = await this.getTools();
        const capabilities = this.getCapabilities();
        const health = await this.getHealth();
        return {
            server_id: this.config.serverId,
            version: '2025-11',
            endpoint: this.config.serverEndpoint,
            tools,
            auth: this.config.authMethod,
            capabilities,
            metadata: this.config.metadata,
            health: {
                status: health.status,
                last_check: new Date().toISOString(),
                latency_ms: health.latency_ms
            }
        };
    }
    startHealthReporting() {
        const interval = this.config.healthCheckInterval || 60000;
        this.healthCheckInterval = setInterval(async ()=>{
            await this.reportHealth();
        }, interval);
        this.logger.info('Health reporting started', {
            interval_ms: interval
        });
    }
    stopHealthReporting() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
            this.logger.info('Health reporting stopped');
        }
    }
}

//# sourceMappingURL=mcp-registry-client-2025.js.map