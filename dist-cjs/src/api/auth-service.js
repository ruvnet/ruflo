import { AuthenticationError } from '../utils/errors.js';
import { nanoid } from 'nanoid';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
const ROLE_PERMISSIONS = {
    admin: [
        'swarm.create',
        'swarm.read',
        'swarm.update',
        'swarm.delete',
        'swarm.scale',
        'agent.spawn',
        'agent.read',
        'agent.terminate',
        'task.create',
        'task.read',
        'task.cancel',
        'metrics.read',
        'system.admin',
        'api.access'
    ],
    operator: [
        'swarm.create',
        'swarm.read',
        'swarm.update',
        'swarm.scale',
        'agent.spawn',
        'agent.read',
        'agent.terminate',
        'task.create',
        'task.read',
        'task.cancel',
        'metrics.read',
        'api.access'
    ],
    developer: [
        'swarm.read',
        'agent.read',
        'task.create',
        'task.read',
        'task.cancel',
        'metrics.read',
        'api.access'
    ],
    viewer: [
        'swarm.read',
        'agent.read',
        'task.read',
        'metrics.read',
        'api.access'
    ],
    service: [
        'api.access'
    ]
};
export class AuthService {
    config;
    logger;
    users = new Map();
    sessions = new Map();
    apiKeys = new Map();
    loginAttempts = new Map();
    constructor(config, logger){
        this.config = config;
        this.logger = logger;
        this.initializeDefaultUsers();
    }
    async authenticateUser(email, password, clientInfo) {
        try {
            await this.checkRateLimit(email);
            const user = Array.from(this.users.values()).find((u)=>u.email === email);
            if (!user) {
                await this.recordFailedLogin(email);
                throw new AuthenticationError('Invalid credentials');
            }
            if (user.lockedUntil && user.lockedUntil > new Date()) {
                throw new AuthenticationError('Account locked due to too many failed attempts');
            }
            if (!user.isActive) {
                throw new AuthenticationError('Account is disabled');
            }
            const isValid = await this.verifyPassword(password, user.passwordHash);
            if (!isValid) {
                await this.recordFailedLogin(email);
                throw new AuthenticationError('Invalid credentials');
            }
            this.loginAttempts.delete(email);
            user.loginAttempts = 0;
            user.lockedUntil = undefined;
            user.lastLogin = new Date();
            const session = await this.createSession(user.id, clientInfo);
            const token = await this.generateJWT(user, session.id);
            this.logger.info('User authenticated successfully', {
                userId: user.id,
                email: user.email,
                sessionId: session.id
            });
            return {
                user,
                token,
                session
            };
        } catch (error) {
            this.logger.error('Authentication failed', {
                email,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async authenticateApiKey(apiKey) {
        try {
            const keyHash = this.hashApiKey(apiKey);
            const storedKey = Array.from(this.apiKeys.values()).find((k)=>this.constantTimeCompare(k.keyHash, keyHash));
            if (!storedKey) {
                throw new AuthenticationError('Invalid API key');
            }
            if (!storedKey.isActive) {
                throw new AuthenticationError('API key is disabled');
            }
            if (storedKey.expiresAt && storedKey.expiresAt < new Date()) {
                throw new AuthenticationError('API key has expired');
            }
            storedKey.lastUsed = new Date();
            const user = Array.from(this.users.values()).find((u)=>u.apiKeys.some((k)=>k.id === storedKey.id));
            this.logger.info('API key authenticated successfully', {
                keyId: storedKey.id,
                keyName: storedKey.name,
                userId: user?.id
            });
            return {
                key: storedKey,
                user
            };
        } catch (error) {
            this.logger.error('API key authentication failed', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    async verifyJWT(token) {
        try {
            const payload = this.decodeJWT(token);
            if (!payload.userId || !payload.sessionId) {
                throw new AuthenticationError('Invalid token payload');
            }
            const session = this.sessions.get(payload.sessionId);
            if (!session || !session.isActive) {
                throw new AuthenticationError('Invalid or expired session');
            }
            if (session.expiresAt < new Date()) {
                session.isActive = false;
                throw new AuthenticationError('Session expired');
            }
            const user = this.users.get(payload.userId);
            if (!user || !user.isActive) {
                throw new AuthenticationError('User not found or inactive');
            }
            session.updatedAt = new Date();
            return {
                user,
                session
            };
        } catch (error) {
            this.logger.error('JWT verification failed', {
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            throw error;
        }
    }
    hasPermission(userOrPermissions, requiredPermission) {
        const permissions = Array.isArray(userOrPermissions) ? userOrPermissions : userOrPermissions.permissions;
        return permissions.includes(requiredPermission) || permissions.includes('system.admin');
    }
    async createUser(userData) {
        const existingUser = Array.from(this.users.values()).find((u)=>u.email === userData.email);
        if (existingUser) {
            throw new AuthenticationError('Email already exists');
        }
        const userId = `user_${Date.now()}_${nanoid(8)}`;
        const passwordHash = await this.hashPassword(userData.password);
        const permissions = ROLE_PERMISSIONS[userData.role] || [];
        const user = {
            id: userId,
            email: userData.email,
            passwordHash,
            role: userData.role,
            permissions,
            apiKeys: [],
            isActive: userData.isActive ?? true,
            loginAttempts: 0,
            mfaEnabled: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.users.set(userId, user);
        this.logger.info('User created', {
            userId,
            email: userData.email,
            role: userData.role
        });
        return user;
    }
    async createApiKey(userId, keyData) {
        const user = this.users.get(userId);
        if (!user) {
            throw new AuthenticationError('User not found');
        }
        const key = this.generateApiKey();
        const keyHash = this.hashApiKey(key);
        const keyId = `key_${Date.now()}_${nanoid(8)}`;
        const permissions = keyData.permissions || user.permissions;
        const apiKey = {
            id: keyId,
            key: key.substring(0, 8) + '...',
            keyHash,
            name: keyData.name,
            permissions,
            expiresAt: keyData.expiresAt,
            isActive: true,
            createdAt: new Date()
        };
        user.apiKeys.push(apiKey);
        this.apiKeys.set(keyId, apiKey);
        this.logger.info('API key created', {
            userId,
            keyId,
            keyName: keyData.name
        });
        return {
            apiKey,
            key
        };
    }
    async revokeApiKey(keyId) {
        const apiKey = this.apiKeys.get(keyId);
        if (!apiKey) {
            throw new AuthenticationError('API key not found');
        }
        apiKey.isActive = false;
        const user = Array.from(this.users.values()).find((u)=>u.apiKeys.some((k)=>k.id === keyId));
        if (user) {
            user.apiKeys = user.apiKeys.filter((k)=>k.id !== keyId);
        }
        this.logger.info('API key revoked', {
            keyId,
            keyName: apiKey.name,
            userId: user?.id
        });
    }
    async invalidateSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isActive = false;
            this.logger.info('Session invalidated', {
                sessionId,
                userId: session.userId
            });
        }
    }
    async cleanupSessions() {
        const now = new Date();
        let cleaned = 0;
        for (const [sessionId, session] of this.sessions){
            if (!session.isActive || session.expiresAt < now) {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.info('Cleaned up expired sessions', {
                count: cleaned
            });
        }
    }
    getUser(userId) {
        return this.users.get(userId);
    }
    listUsers() {
        return Array.from(this.users.values());
    }
    async checkRateLimit(email) {
        const attempts = this.loginAttempts.get(email);
        const maxAttempts = this.config.maxLoginAttempts || 5;
        const lockoutDuration = this.config.lockoutDuration || 900000;
        if (attempts && attempts.count >= maxAttempts) {
            const timeSinceLastAttempt = Date.now() - attempts.lastAttempt.getTime();
            if (timeSinceLastAttempt < lockoutDuration) {
                throw new AuthenticationError('Too many failed login attempts. Please try again later.');
            } else {
                this.loginAttempts.delete(email);
            }
        }
    }
    async recordFailedLogin(email) {
        const attempts = this.loginAttempts.get(email) || {
            count: 0,
            lastAttempt: new Date()
        };
        attempts.count++;
        attempts.lastAttempt = new Date();
        this.loginAttempts.set(email, attempts);
    }
    async createSession(userId, clientInfo) {
        const sessionId = `session_${Date.now()}_${nanoid(16)}`;
        const sessionTimeout = this.config.sessionTimeout || 3600000;
        const expiresAt = new Date(Date.now() + sessionTimeout);
        const session = {
            id: sessionId,
            userId,
            token: nanoid(32),
            clientInfo,
            isActive: true,
            expiresAt,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    async generateJWT(user, sessionId) {
        const payload = {
            userId: user.id,
            email: user.email,
            role: user.role,
            permissions: user.permissions,
            sessionId,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60
        };
        const header = {
            alg: 'HS256',
            typ: 'JWT'
        };
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        const signature = createHmac('sha256', this.config.jwtSecret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
        return `${encodedHeader}.${encodedPayload}.${signature}`;
    }
    decodeJWT(token) {
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new AuthenticationError('Invalid token format');
        }
        const [encodedHeader, encodedPayload, signature] = parts;
        const expectedSignature = createHmac('sha256', this.config.jwtSecret).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
        if (!this.constantTimeCompare(signature, expectedSignature)) {
            throw new AuthenticationError('Invalid token signature');
        }
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            throw new AuthenticationError('Token expired');
        }
        return payload;
    }
    generateApiKey() {
        const length = this.config.apiKeyLength || 32;
        return nanoid(length);
    }
    hashApiKey(key) {
        return createHash('sha256').update(key).digest('hex');
    }
    async hashPassword(password) {
        return createHash('sha256').update(password + 'salt').digest('hex');
    }
    async verifyPassword(password, hash) {
        const passwordHash = createHash('sha256').update(password + 'salt').digest('hex');
        return this.constantTimeCompare(passwordHash, hash);
    }
    constantTimeCompare(a, b) {
        if (a.length !== b.length) {
            return false;
        }
        const bufferA = Buffer.from(a, 'hex');
        const bufferB = Buffer.from(b, 'hex');
        return timingSafeEqual(bufferA, bufferB);
    }
    initializeDefaultUsers() {
        const adminId = 'admin_default';
        const adminUser = {
            id: adminId,
            email: 'admin@claude-flow.local',
            passwordHash: createHash('sha256').update('admin123' + 'salt').digest('hex'),
            role: 'admin',
            permissions: ROLE_PERMISSIONS.admin,
            apiKeys: [],
            isActive: true,
            loginAttempts: 0,
            mfaEnabled: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.users.set(adminId, adminUser);
        const serviceId = 'service_default';
        const serviceUser = {
            id: serviceId,
            email: 'service@claude-flow.local',
            passwordHash: createHash('sha256').update('service123' + 'salt').digest('hex'),
            role: 'service',
            permissions: ROLE_PERMISSIONS.service,
            apiKeys: [],
            isActive: true,
            loginAttempts: 0,
            mfaEnabled: false,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.users.set(serviceId, serviceUser);
        this.logger.info('Default users initialized', {
            admin: adminUser.email,
            service: serviceUser.email
        });
    }
}

//# sourceMappingURL=auth-service.js.map