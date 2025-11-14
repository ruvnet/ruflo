export class VersionNegotiationError extends Error {
    code;
    constructor(message, code){
        super(message), this.code = code;
        this.name = 'VersionNegotiationError';
    }
}
export class VersionNegotiator {
    logger;
    supportedVersions = [
        '2025-11',
        '2024-11'
    ];
    serverVersion = '2025-11';
    serverCapabilities = [
        'async',
        'registry',
        'code_exec',
        'stream'
    ];
    constructor(logger){
        this.logger = logger;
    }
    async negotiate(clientHandshake) {
        this.logger.info('Starting version negotiation', {
            clientVersion: clientHandshake.mcp_version,
            serverVersion: this.serverVersion,
            clientCapabilities: clientHandshake.capabilities
        });
        if (!this.isValidHandshake(clientHandshake)) {
            return {
                success: false,
                agreed_version: this.serverVersion,
                agreed_capabilities: [],
                error: 'Invalid handshake structure'
            };
        }
        const versionResult = this.checkVersionCompatibility(clientHandshake.mcp_version);
        if (!versionResult.compatible) {
            return {
                success: false,
                agreed_version: this.serverVersion,
                agreed_capabilities: [],
                error: versionResult.error
            };
        }
        const agreedCapabilities = this.negotiateCapabilities(clientHandshake.capabilities);
        this.logger.info('Version negotiation successful', {
            agreedVersion: versionResult.version,
            agreedCapabilities
        });
        return {
            success: true,
            agreed_version: versionResult.version,
            agreed_capabilities: agreedCapabilities
        };
    }
    isValidHandshake(handshake) {
        return !!(handshake.mcp_version && handshake.transport && Array.isArray(handshake.capabilities));
    }
    checkVersionCompatibility(clientVersion) {
        if (clientVersion === this.serverVersion) {
            return {
                compatible: true,
                version: clientVersion
            };
        }
        if (this.supportedVersions.includes(clientVersion)) {
            this.logger.warn('Client using older version, but compatible', {
                clientVersion,
                serverVersion: this.serverVersion
            });
            return {
                compatible: true,
                version: clientVersion
            };
        }
        const clientDate = this.parseVersion(clientVersion);
        const serverDate = this.parseVersion(this.serverVersion);
        const monthsDiff = this.getMonthsDifference(clientDate, serverDate);
        if (Math.abs(monthsDiff) > 1) {
            return {
                compatible: false,
                version: this.serverVersion,
                error: `Version mismatch: client ${clientVersion}, server ${this.serverVersion}. Difference exceeds 1 cycle.`
            };
        }
        this.logger.warn('Version close enough, accepting', {
            clientVersion,
            serverVersion: this.serverVersion,
            monthsDiff
        });
        return {
            compatible: true,
            version: this.serverVersion
        };
    }
    negotiateCapabilities(clientCapabilities) {
        return clientCapabilities.filter((cap)=>this.serverCapabilities.includes(cap));
    }
    parseVersion(version) {
        const [year, month] = version.split('-').map(Number);
        return new Date(year, month - 1, 1);
    }
    getMonthsDifference(date1, date2) {
        const months = (date2.getFullYear() - date1.getFullYear()) * 12;
        return months + date2.getMonth() - date1.getMonth();
    }
    createServerHandshake(serverId, transport, metadata) {
        return {
            mcp_version: this.serverVersion,
            server_id: serverId,
            transport,
            capabilities: this.serverCapabilities,
            metadata
        };
    }
    getServerVersion() {
        return this.serverVersion;
    }
    getServerCapabilities() {
        return [
            ...this.serverCapabilities
        ];
    }
    hasCapability(capability) {
        return this.serverCapabilities.includes(capability);
    }
    addCapability(capability) {
        if (!this.serverCapabilities.includes(capability)) {
            this.serverCapabilities.push(capability);
            this.logger.info('Capability added', {
                capability
            });
        }
    }
    removeCapability(capability) {
        const index = this.serverCapabilities.indexOf(capability);
        if (index > -1) {
            this.serverCapabilities.splice(index, 1);
            this.logger.info('Capability removed', {
                capability
            });
        }
    }
}
export class BackwardCompatibilityAdapter {
    logger;
    constructor(logger){
        this.logger = logger;
    }
    isLegacyRequest(request) {
        return !request.mcp_version || request.version;
    }
    convertToModern(legacyRequest) {
        this.logger.info('Converting legacy request to MCP 2025-11 format');
        return {
            mcp_version: '2025-11',
            client_id: legacyRequest.clientId || 'legacy-client',
            transport: legacyRequest.transport || 'stdio',
            capabilities: legacyRequest.capabilities || [],
            metadata: {
                name: legacyRequest.name || 'Legacy Client',
                version: legacyRequest.version || '1.0.0'
            }
        };
    }
    convertToLegacy(modernResponse, requestedLegacy) {
        if (!requestedLegacy) {
            return modernResponse;
        }
        this.logger.info('Converting response to legacy format');
        return {
            version: modernResponse.mcp_version,
            serverId: modernResponse.server_id,
            capabilities: modernResponse.capabilities,
            ...modernResponse
        };
    }
}

//# sourceMappingURL=version-negotiation.js.map