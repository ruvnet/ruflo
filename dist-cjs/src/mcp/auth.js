import { createHash, timingSafeEqual } from 'node:crypto';
export class AuthManager {
    config;
    logger;
    revokedTokens = new Set();
    tokenStore = new Map();
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
        if (config.enabled) {
            setInterval(()=>{
                this.cleanupExpiredTokens();
            }, 300000);
        }
    }
    async authenticate(credentials) {
        if (!this.config.enabled) {
            return {
                success: true,
                user: 'anonymous',
                permissions: [
                    '*'
                ]
            };
        }
        this.logger.debug('Authenticating credentials', {
            method: this.config.method,
            hasCredentials: !!credentials
        });
        try {
            switch(this.config.method){
                case 'token':
                    return await this.authenticateToken(credentials);
                case 'basic':
                    return await this.authenticateBasic(credentials);
                case 'oauth':
                    return await this.authenticateOAuth(credentials);
                default:
                    return {
                        success: false,
                        error: `Unsupported authentication method: ${this.config.method}`
                    };
            }
        } catch (error) {
            this.logger.error('Authentication error', error);
            return {
                success: false,
                error: error instanceof Error ? error instanceof Error ? error.message : String(error) : 'Authentication failed'
            };
        }
    }
    authorize(session, permission) {
        if (!this.config.enabled || !session.authenticated) {
            return !this.config.enabled;
        }
        const permissions = session.authData?.permissions || [];
        if (permissions.includes('*')) {
            return true;
        }
        if (permissions.includes(permission)) {
            return true;
        }
        for (const perm of permissions){
            if (perm.endsWith('*') && permission.startsWith(perm.slice(0, -1))) {
                return true;
            }
        }
        this.logger.warn('Authorization denied', {
            sessionId: session.id,
            user: session.authData?.user,
            permission,
            userPermissions: permissions
        });
        return false;
    }
    async validateToken(token) {
        if (this.revokedTokens.has(token)) {
            return {
                valid: false,
                error: 'Token has been revoked'
            };
        }
        const tokenData = this.tokenStore.get(token);
        if (!tokenData) {
            return {
                valid: false,
                error: 'Invalid token'
            };
        }
        if (tokenData.expiresAt < new Date()) {
            this.tokenStore.delete(token);
            return {
                valid: false,
                error: 'Token has expired'
            };
        }
        return {
            valid: true,
            user: tokenData.user,
            permissions: tokenData.permissions,
            expiresAt: tokenData.expiresAt
        };
    }
    async generateToken(userId, permissions) {
        const token = this.createSecureToken();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (this.config.sessionTimeout || 3600000));
        this.tokenStore.set(token, {
            user: userId,
            permissions,
            createdAt: now,
            expiresAt
        });
        this.logger.info('Token generated', {
            userId,
            permissions,
            expiresAt
        });
        return token;
    }
    async revokeToken(token) {
        this.revokedTokens.add(token);
        this.tokenStore.delete(token);
        this.logger.info('Token revoked', {
            token: token.substring(0, 8) + '...'
        });
    }
    async authenticateToken(credentials) {
        const token = this.extractToken(credentials);
        if (!token) {
            return {
                success: false,
                error: 'Token not provided'
            };
        }
        const validation = await this.validateToken(token);
        if (validation.valid) {
            return {
                success: true,
                user: validation.user,
                permissions: validation.permissions,
                token
            };
        }
        if (this.config.tokens && this.config.tokens.length > 0) {
            const isValid = this.config.tokens.some((validToken)=>{
                return this.timingSafeEqual(token, validToken);
            });
            if (isValid) {
                return {
                    success: true,
                    user: 'token-user',
                    permissions: [
                        '*'
                    ],
                    token
                };
            }
        }
        return {
            success: false,
            error: 'Invalid token'
        };
    }
    async authenticateBasic(credentials) {
        const { username, password } = this.extractBasicAuth(credentials);
        if (!username || !password) {
            return {
                success: false,
                error: 'Username and password required'
            };
        }
        if (!this.config.users || this.config.users.length === 0) {
            return {
                success: false,
                error: 'No users configured'
            };
        }
        const user = this.config.users.find((u)=>u.username === username);
        if (!user) {
            return {
                success: false,
                error: 'Invalid username or password'
            };
        }
        const isValidPassword = this.verifyPassword(password, user.password);
        if (!isValidPassword) {
            return {
                success: false,
                error: 'Invalid username or password'
            };
        }
        const token = await this.generateToken(username, user.permissions);
        return {
            success: true,
            user: username,
            permissions: user.permissions,
            token
        };
    }
    async authenticateOAuth(credentials) {
        this.logger.warn('OAuth authentication not yet implemented');
        return {
            success: false,
            error: 'OAuth authentication not implemented'
        };
    }
    extractToken(credentials) {
        if (typeof credentials === 'string') {
            return credentials;
        }
        if (typeof credentials === 'object' && credentials !== null) {
            const creds = credentials;
            if (typeof creds.token === 'string') {
                return creds.token;
            }
            if (typeof creds.authorization === 'string') {
                const match = creds.authorization.match(/^Bearer\s+(.+)$/i);
                return match ? match[1] : null;
            }
        }
        return null;
    }
    extractBasicAuth(credentials) {
        if (typeof credentials === 'object' && credentials !== null) {
            const creds = credentials;
            if (typeof creds.username === 'string' && typeof creds.password === 'string') {
                return {
                    username: creds.username,
                    password: creds.password
                };
            }
            if (typeof creds.authorization === 'string') {
                const match = creds.authorization.match(/^Basic\s+(.+)$/i);
                if (match) {
                    try {
                        const decoded = atob(match[1]);
                        const colonIndex = decoded.indexOf(':');
                        if (colonIndex >= 0) {
                            return {
                                username: decoded.substring(0, colonIndex),
                                password: decoded.substring(colonIndex + 1)
                            };
                        }
                    } catch  {}
                }
            }
        }
        return {};
    }
    verifyPassword(providedPassword, storedPassword) {
        const hashedProvided = this.hashPassword(providedPassword);
        const hashedStored = this.hashPassword(storedPassword);
        return this.timingSafeEqual(hashedProvided, hashedStored);
    }
    hashPassword(password) {
        return createHash('sha256').update(password).digest('hex');
    }
    timingSafeEqual(a, b) {
        const encoder = new TextEncoder();
        const bufferA = encoder.encode(a);
        const bufferB = encoder.encode(b);
        if (bufferA.length !== bufferB.length) {
            return false;
        }
        return timingSafeEqual(bufferA, bufferB);
    }
    createSecureToken() {
        const timestamp = Date.now().toString(36);
        const random1 = Math.random().toString(36).substring(2, 15);
        const random2 = Math.random().toString(36).substring(2, 15);
        const hash = createHash('sha256').update(`${timestamp}${random1}${random2}`).digest('hex').substring(0, 32);
        return `mcp_${timestamp}_${hash}`;
    }
    cleanupExpiredTokens() {
        const now = new Date();
        let cleaned = 0;
        for (const [token, data] of this.tokenStore.entries()){
            if (data.expiresAt < now) {
                this.tokenStore.delete(token);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.debug('Cleaned up expired tokens', {
                count: cleaned
            });
        }
    }
}
export const Permissions = {
    SYSTEM_INFO: 'system.info',
    SYSTEM_HEALTH: 'system.health',
    SYSTEM_METRICS: 'system.metrics',
    TOOLS_LIST: 'tools.list',
    TOOLS_INVOKE: 'tools.invoke',
    TOOLS_DESCRIBE: 'tools.describe',
    AGENTS_LIST: 'agents.list',
    AGENTS_SPAWN: 'agents.spawn',
    AGENTS_TERMINATE: 'agents.terminate',
    AGENTS_INFO: 'agents.info',
    TASKS_LIST: 'tasks.list',
    TASKS_CREATE: 'tasks.create',
    TASKS_CANCEL: 'tasks.cancel',
    TASKS_STATUS: 'tasks.status',
    MEMORY_READ: 'memory.read',
    MEMORY_WRITE: 'memory.write',
    MEMORY_QUERY: 'memory.query',
    MEMORY_DELETE: 'memory.delete',
    ADMIN_CONFIG: 'admin.config',
    ADMIN_LOGS: 'admin.logs',
    ADMIN_SESSIONS: 'admin.sessions',
    ALL: '*'
};

//# sourceMappingURL=auth.js.map