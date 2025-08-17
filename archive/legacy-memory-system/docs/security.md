# Security Guide

This guide covers security features, best practices, and configurations for the SPARC Memory Bank system.

## Security Architecture

### Defense in Depth

The SPARC Memory Bank implements multiple layers of security:

```
┌─────────────────────────────────────────────┐
│                 Application Layer           │
│  • Input validation                         │
│  • Rate limiting                            │
│  • Authentication & authorization           │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│                 Data Layer                  │
│  • Encryption at rest                       │
│  • Data integrity checks                    │
│  • Secure key management                    │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│                 Storage Layer               │
│  • File system permissions                  │
│  • Database access controls                 │
│  • Audit logging                            │
└─────────────────────────────────────────────┘
┌─────────────────────────────────────────────┐
│                 Network Layer               │
│  • TLS encryption                           │
│  • Certificate validation                   │
│  • Network segmentation                     │
└─────────────────────────────────────────────┘
```

## Encryption

### Encryption at Rest

The memory bank supports multiple encryption algorithms for data at rest:

```typescript
// AES-256-GCM encryption (recommended)
const secureConfig = {
  backend: 'sqlite',
  storage: { path: './secure.db' },
  security: {
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm', // Authenticated encryption
      keyDerivation: 'argon2',   // Strong key derivation
      keyDerivationOptions: {
        memory: 65536,            // 64MB memory cost
        iterations: 3,            // Time cost
        parallelism: 1,           // Parallelism
        saltLength: 32            // 256-bit salt
      },
      rotateKeys: true,
      keyRotationInterval: 30 * 24 * 60 * 60 * 1000 // 30 days
    }
  }
};

// Alternative: ChaCha20-Poly1305 for high-performance environments
const highPerfConfig = {
  security: {
    encryption: {
      enabled: true,
      algorithm: 'chacha20-poly1305', // Fast authenticated encryption
      keyDerivation: 'scrypt',
      keyDerivationOptions: {
        memory: 32768,            // 32MB memory cost
        iterations: 1,            // Lower iteration count
        parallelism: 1,
        saltLength: 32
      }
    }
  }
};
```

### Key Management

```typescript
// Environment-based key management
class EnvironmentKeyManager implements KeyManager {
  async getKey(keyId: string): Promise<Buffer> {
    const key = process.env[`MEMORY_KEY_${keyId.toUpperCase()}`];
    if (!key) {
      throw new Error(`Key not found: ${keyId}`);
    }
    return Buffer.from(key, 'base64');
  }
  
  async rotateKey(keyId: string): Promise<Buffer> {
    const newKey = crypto.randomBytes(32);
    // Store new key securely (implementation depends on your key storage)
    await this.storeKey(keyId, newKey);
    return newKey;
  }
}

// HashiCorp Vault integration
class VaultKeyManager implements KeyManager {
  constructor(private vaultClient: VaultClient) {}
  
  async getKey(keyId: string): Promise<Buffer> {
    const response = await this.vaultClient.read(`secret/memory-keys/${keyId}`);
    return Buffer.from(response.data.key, 'base64');
  }
  
  async rotateKey(keyId: string): Promise<Buffer> {
    const newKey = crypto.randomBytes(32);
    await this.vaultClient.write(`secret/memory-keys/${keyId}`, {
      key: newKey.toString('base64'),
      created: new Date().toISOString()
    });
    return newKey;
  }
}

// AWS KMS integration
class KMSKeyManager implements KeyManager {
  constructor(private kmsClient: KMSClient) {}
  
  async getKey(keyId: string): Promise<Buffer> {
    const command = new DecryptCommand({
      CiphertextBlob: Buffer.from(keyId, 'base64')
    });
    const response = await this.kmsClient.send(command);
    return Buffer.from(response.Plaintext!);
  }
  
  async generateDataKey(): Promise<{ keyId: string; key: Buffer }> {
    const command = new GenerateDataKeyCommand({
      KeyId: 'alias/memory-bank-key',
      KeySpec: 'AES_256'
    });
    const response = await this.kmsClient.send(command);
    
    return {
      keyId: Buffer.from(response.CiphertextBlob!).toString('base64'),
      key: Buffer.from(response.Plaintext!)
    };
  }
}
```

### Field-Level Encryption

```typescript
// Encrypt sensitive fields individually
class FieldEncryption {
  constructor(private keyManager: KeyManager) {}
  
  async encryptSensitiveData(item: MemoryItem): Promise<MemoryItem> {
    const encryptedItem = { ...item };
    
    // Encrypt content if it contains sensitive data
    if (this.isSensitive(item.content)) {
      encryptedItem.content = await this.encrypt(item.content, 'content-key');
      encryptedItem.metadata = {
        ...item.metadata,
        encrypted: ['content']
      };
    }
    
    // Encrypt sensitive metadata fields
    if (item.metadata) {
      const sensitiveFields = ['ssn', 'creditCard', 'password', 'apiKey'];
      const encryptedMetadata = { ...item.metadata };
      const encryptedFields: string[] = [];
      
      for (const field of sensitiveFields) {
        if (encryptedMetadata[field]) {
          encryptedMetadata[field] = await this.encrypt(
            String(encryptedMetadata[field]), 
            `metadata-${field}-key`
          );
          encryptedFields.push(field);
        }
      }
      
      if (encryptedFields.length > 0) {
        encryptedMetadata.encrypted = [
          ...(encryptedMetadata.encrypted || []),
          ...encryptedFields
        ];
      }
      
      encryptedItem.metadata = encryptedMetadata;
    }
    
    return encryptedItem;
  }
  
  private isSensitive(content: string): boolean {
    const sensitivePatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/,      // SSN pattern
      /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // Credit card pattern
      /(?:password|pwd|passwd)[:=]\s*\S+/i,     // Password patterns
      /(?:api[_-]?key|token)[:=]\s*\S+/i        // API key patterns
    ];
    
    return sensitivePatterns.some(pattern => pattern.test(content));
  }
  
  private async encrypt(data: string, keyId: string): Promise<string> {
    const key = await this.keyManager.getKey(keyId);
    const iv = crypto.randomBytes(12); // 96-bit IV for GCM
    const cipher = crypto.createCipher('aes-256-gcm', key, { iv });
    
    let encrypted = cipher.update(data, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    
    // Combine IV, auth tag, and encrypted data
    const combined = Buffer.concat([iv, authTag, Buffer.from(encrypted, 'base64')]);
    return combined.toString('base64');
  }
}
```

## Access Control

### Authentication

```typescript
// JWT-based authentication
interface AuthConfig {
  enabled: boolean;
  method: 'jwt' | 'certificate' | 'api-key' | 'custom';
  jwt?: {
    secret: string;
    algorithm: 'HS256' | 'RS256' | 'ES256';
    issuer: string;
    audience: string;
    expiresIn: string;
    clockTolerance: number;
  };
  certificate?: {
    ca: string;
    cert: string;
    key: string;
    passphrase?: string;
  };
  apiKey?: {
    headerName: string;
    prefix?: string;
    validation: (key: string) => Promise<boolean>;
  };
}

class JWTAuthenticator implements Authenticator {
  constructor(private config: AuthConfig['jwt']) {}
  
  async authenticate(token: string): Promise<AuthContext> {
    try {
      const payload = jwt.verify(token, this.config!.secret, {
        algorithms: [this.config!.algorithm],
        issuer: this.config!.issuer,
        audience: this.config!.audience,
        clockTolerance: this.config!.clockTolerance
      }) as JWTPayload;
      
      return {
        authenticated: true,
        agentId: payload.sub,
        roles: payload.roles || [],
        permissions: payload.permissions || [],
        namespace: payload.namespace,
        expiresAt: new Date(payload.exp * 1000)
      };
    } catch (error) {
      throw new SecurityError('Invalid token', 'INVALID_TOKEN', { error });
    }
  }
  
  async generateToken(agentId: string, options: TokenOptions): Promise<string> {
    const payload: JWTPayload = {
      sub: agentId,
      iss: this.config!.issuer,
      aud: this.config!.audience,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + this.parseExpiration(this.config!.expiresIn),
      roles: options.roles || [],
      permissions: options.permissions || [],
      namespace: options.namespace
    };
    
    return jwt.sign(payload, this.config!.secret, {
      algorithm: this.config!.algorithm
    });
  }
}

// Certificate-based authentication
class CertificateAuthenticator implements Authenticator {
  constructor(private config: AuthConfig['certificate']) {}
  
  async authenticate(certificate: X509Certificate): Promise<AuthContext> {
    // Verify certificate chain
    if (!this.verifyCertificateChain(certificate)) {
      throw new SecurityError('Invalid certificate chain', 'INVALID_CERTIFICATE');
    }
    
    // Extract agent information from certificate
    const subject = certificate.subject;
    const agentId = subject.getField('CN').value;
    const roles = this.extractRoles(certificate);
    
    return {
      authenticated: true,
      agentId,
      roles,
      permissions: this.resolvePermissions(roles),
      expiresAt: certificate.validTo
    };
  }
  
  private verifyCertificateChain(certificate: X509Certificate): boolean {
    // Implementation depends on your PKI setup
    const ca = fs.readFileSync(this.config!.ca);
    return certificate.verify(ca);
  }
  
  private extractRoles(certificate: X509Certificate): string[] {
    // Extract roles from certificate extensions or subject
    const organizationalUnit = certificate.subject.getField('OU')?.value;
    return organizationalUnit ? organizationalUnit.split(',') : [];
  }
}
```

### Role-Based Access Control (RBAC)

```typescript
// Define roles and permissions
interface Role {
  name: string;
  permissions: Permission[];
  description: string;
}

interface Permission {
  resource: string;
  actions: string[];
  conditions?: Condition[];
}

interface Condition {
  field: string;
  operator: 'equals' | 'in' | 'regex';
  value: any;
}

const predefinedRoles: Role[] = [
  {
    name: 'admin',
    description: 'Full system access',
    permissions: [
      {
        resource: '*',
        actions: ['*']
      }
    ]
  },
  {
    name: 'agent',
    description: 'Standard agent access',
    permissions: [
      {
        resource: 'memory',
        actions: ['read', 'write', 'delete'],
        conditions: [
          {
            field: 'namespace',
            operator: 'equals',
            value: '${auth.namespace}'
          }
        ]
      }
    ]
  },
  {
    name: 'reader',
    description: 'Read-only access',
    permissions: [
      {
        resource: 'memory',
        actions: ['read']
      }
    ]
  },
  {
    name: 'researcher',
    description: 'Research data access',
    permissions: [
      {
        resource: 'memory',
        actions: ['read', 'write'],
        conditions: [
          {
            field: 'category',
            operator: 'in',
            value: ['research', 'analysis', 'findings']
          }
        ]
      }
    ]
  }
];

class RBACAuthorizer implements Authorizer {
  constructor(private roles: Map<string, Role>) {}
  
  async authorize(
    auth: AuthContext,
    action: string,
    resource: MemoryItem | MemoryQuery
  ): Promise<boolean> {
    // Check if user has required roles
    for (const roleName of auth.roles) {
      const role = this.roles.get(roleName);
      if (!role) continue;
      
      for (const permission of role.permissions) {
        if (this.matchesPermission(permission, action, resource, auth)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  private matchesPermission(
    permission: Permission,
    action: string,
    resource: any,
    auth: AuthContext
  ): boolean {
    // Check resource match
    if (permission.resource !== '*' && permission.resource !== 'memory') {
      return false;
    }
    
    // Check action match
    if (!permission.actions.includes('*') && !permission.actions.includes(action)) {
      return false;
    }
    
    // Check conditions
    if (permission.conditions) {
      return permission.conditions.every(condition =>
        this.evaluateCondition(condition, resource, auth)
      );
    }
    
    return true;
  }
  
  private evaluateCondition(
    condition: Condition,
    resource: any,
    auth: AuthContext
  ): boolean {
    let value = this.resolveValue(condition.value, auth);
    let resourceValue = this.getResourceValue(resource, condition.field);
    
    switch (condition.operator) {
      case 'equals':
        return resourceValue === value;
      case 'in':
        return Array.isArray(value) && value.includes(resourceValue);
      case 'regex':
        return new RegExp(value).test(String(resourceValue));
      default:
        return false;
    }
  }
  
  private resolveValue(value: any, auth: AuthContext): any {
    if (typeof value === 'string' && value.startsWith('${')) {
      const path = value.slice(2, -1); // Remove ${ and }
      return this.getNestedValue(auth, path);
    }
    return value;
  }
  
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
  
  private getResourceValue(resource: any, field: string): any {
    return this.getNestedValue(resource, field);
  }
}
```

### Namespace Isolation

```typescript
// Enforce namespace-based access control
class NamespaceSecurityManager {
  constructor(
    private config: NamespaceConfig,
    private authorizer: Authorizer
  ) {}
  
  async enforceNamespaceAccess(
    auth: AuthContext,
    operation: string,
    target: MemoryItem | MemoryQuery
  ): Promise<void> {
    if (!this.config.enabled) return;
    
    const targetNamespace = this.extractNamespace(target);
    
    // Check if agent has access to the namespace
    if (!await this.hasNamespaceAccess(auth, targetNamespace, operation)) {
      throw new SecurityError(
        `Access denied to namespace: ${targetNamespace}`,
        'NAMESPACE_ACCESS_DENIED',
        { namespace: targetNamespace, operation }
      );
    }
    
    // Apply namespace restrictions to queries
    if (operation === 'query' && target && typeof target === 'object') {
      this.restrictQueryToNamespaces(target as MemoryQuery, auth);
    }
  }
  
  private async hasNamespaceAccess(
    auth: AuthContext,
    namespace: string,
    operation: string
  ): Promise<boolean> {
    const permissions = this.config.permissions?.[namespace];
    if (!permissions) {
      // Use default namespace permissions
      return this.hasNamespaceAccess(auth, this.config.defaultNamespace, operation);
    }
    
    // Check public access
    if (operation === 'read' && permissions.public) {
      return true;
    }
    
    // Check specific permissions
    const requiredList = this.getRequiredPermissionList(permissions, operation);
    return requiredList.includes('*') || requiredList.includes(auth.agentId);
  }
  
  private getRequiredPermissionList(
    permissions: NamespacePermissions[string],
    operation: string
  ): string[] {
    switch (operation) {
      case 'read':
      case 'query':
        return permissions.read;
      case 'write':
      case 'store':
      case 'update':
        return permissions.write;
      case 'delete':
      case 'admin':
        return permissions.admin;
      default:
        return [];
    }
  }
  
  private extractNamespace(target: MemoryItem | MemoryQuery): string {
    if ('namespace' in target && target.namespace) {
      return target.namespace;
    }
    return this.config.defaultNamespace;
  }
  
  private restrictQueryToNamespaces(query: MemoryQuery, auth: AuthContext): void {
    const allowedNamespaces = this.getAllowedNamespaces(auth);
    
    if (query.namespace) {
      // Verify the requested namespace is allowed
      if (!allowedNamespaces.includes(query.namespace)) {
        throw new SecurityError(
          `Access denied to namespace: ${query.namespace}`,
          'NAMESPACE_ACCESS_DENIED'
        );
      }
    } else if (query.namespaces) {
      // Filter to only allowed namespaces
      query.namespaces = query.namespaces.filter(ns => allowedNamespaces.includes(ns));
    } else {
      // Restrict to allowed namespaces
      query.namespaces = allowedNamespaces;
    }
  }
  
  private getAllowedNamespaces(auth: AuthContext): string[] {
    const allowed: string[] = [];
    
    if (this.config.permissions) {
      for (const [namespace, permissions] of Object.entries(this.config.permissions)) {
        if (permissions.public || 
            permissions.read.includes('*') || 
            permissions.read.includes(auth.agentId)) {
          allowed.push(namespace);
        }
      }
    }
    
    return allowed.length > 0 ? allowed : [this.config.defaultNamespace];
  }
}
```

## Data Integrity

### Checksums and Validation

```typescript
// Data integrity verification
class IntegrityManager {
  constructor(private config: SecurityConfig['checksums']) {}
  
  async calculateChecksum(data: string | Buffer): Promise<string> {
    if (!this.config?.enabled) return '';
    
    const hash = crypto.createHash(this.config.algorithm);
    hash.update(data);
    return `${this.config.algorithm}:${hash.digest('hex')}`;
  }
  
  async verifyChecksum(data: string | Buffer, expectedChecksum: string): Promise<boolean> {
    if (!this.config?.enabled || !expectedChecksum) return true;
    
    const actualChecksum = await this.calculateChecksum(data);
    return actualChecksum === expectedChecksum;
  }
  
  async verifyItem(item: MemoryItem): Promise<IntegrityResult> {
    const result: IntegrityResult = {
      valid: true,
      errors: []
    };
    
    // Verify content checksum
    if (item.checksum && this.config?.verifyOnRead) {
      const contentValid = await this.verifyChecksum(item.content, item.checksum);
      if (!contentValid) {
        result.valid = false;
        result.errors.push('Content checksum mismatch');
        
        if (this.config.repairCorruption) {
          await this.attemptRepair(item);
        }
      }
    }
    
    // Verify metadata integrity
    if (item.metadata && item.vectorClock) {
      const metadataValid = this.verifyMetadataIntegrity(item);
      if (!metadataValid) {
        result.valid = false;
        result.errors.push('Metadata integrity check failed');
      }
    }
    
    return result;
  }
  
  private verifyMetadataIntegrity(item: MemoryItem): boolean {
    // Check required fields
    const requiredFields = ['id', 'category', 'content', 'created', 'updated'];
    for (const field of requiredFields) {
      if (!(field in item) || item[field as keyof MemoryItem] === null || item[field as keyof MemoryItem] === undefined) {
        return false;
      }
    }
    
    // Check timestamp consistency
    if (item.updated < item.created) {
      return false;
    }
    
    // Check version consistency
    if (item.version < 1) {
      return false;
    }
    
    return true;
  }
  
  private async attemptRepair(item: MemoryItem): Promise<void> {
    // Log corruption for investigation
    console.warn(`Data corruption detected for item ${item.id}`);
    
    // Attempt to reconstruct from backup or replica
    // Implementation depends on your backup/replication strategy
  }
}

interface IntegrityResult {
  valid: boolean;
  errors: string[];
}
```

### Secure Deletion

```typescript
// Secure deletion implementation
class SecureDeletion {
  constructor(private config: SecurityConfig) {}
  
  async secureDelete(backend: MemoryBackend, itemId: string): Promise<boolean> {
    const item = await backend.retrieve(itemId);
    if (!item) return false;
    
    try {
      // Overwrite sensitive data before deletion
      if (this.config.checksums?.enabled && this.config.secureDelete) {
        await this.overwriteData(backend, item);
      }
      
      // Perform actual deletion
      const deleted = await backend.delete(itemId);
      
      // Log secure deletion
      if (this.config.auditLog?.enabled) {
        await this.logSecureDeletion(itemId, item);
      }
      
      return deleted;
    } catch (error) {
      console.error(`Secure deletion failed for item ${itemId}:`, error);
      return false;
    }
  }
  
  private async overwriteData(backend: MemoryBackend, item: MemoryItem): Promise<void> {
    // Overwrite with random data multiple times
    const overwritePasses = 3;
    
    for (let pass = 0; pass < overwritePasses; pass++) {
      const randomContent = crypto.randomBytes(item.content.length).toString('base64');
      const overwriteItem: MemoryItem = {
        ...item,
        content: randomContent,
        checksum: await this.calculateChecksum(randomContent),
        updated: Date.now()
      };
      
      await backend.update(item.id, overwriteItem);
    }
  }
  
  private async logSecureDeletion(itemId: string, item: MemoryItem): Promise<void> {
    const auditEvent = {
      timestamp: new Date(),
      operation: 'secure_delete',
      itemId,
      category: item.category,
      namespace: item.namespace,
      agent: 'system' // Or extract from current context
    };
    
    // Write to audit log
    console.log('AUDIT:', JSON.stringify(auditEvent));
  }
  
  private async calculateChecksum(data: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    hash.update(data);
    return `sha256:${hash.digest('hex')}`;
  }
}
```

## Audit Logging

### Comprehensive Audit Trail

```typescript
// Audit logging system
class AuditLogger {
  constructor(
    private config: SecurityConfig['auditLog'],
    private storage: AuditStorage
  ) {}
  
  async logOperation(event: AuditEvent): Promise<void> {
    if (!this.config?.enabled) return;
    
    const enrichedEvent: EnrichedAuditEvent = {
      ...event,
      timestamp: new Date(),
      id: crypto.randomUUID(),
      sessionId: this.getCurrentSessionId(),
      level: this.determineLogLevel(event),
      checksum: await this.calculateEventChecksum(event)
    };
    
    // Include data payload if configured
    if (this.config.includeData && event.data) {
      enrichedEvent.data = this.sanitizeData(event.data);
    }
    
    await this.storage.write(enrichedEvent);
    
    // Real-time monitoring alerts
    if (this.isSecurityEvent(event)) {
      await this.sendSecurityAlert(enrichedEvent);
    }
  }
  
  private determineLogLevel(event: AuditEvent): 'info' | 'warning' | 'error' {
    if (event.operation.includes('delete') || event.operation.includes('admin')) {
      return 'warning';
    }
    if (event.success === false) {
      return 'error';
    }
    return 'info';
  }
  
  private sanitizeData(data: any): any {
    // Remove sensitive information from audit logs
    const sanitized = JSON.parse(JSON.stringify(data));
    
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
    const sanitizeObject = (obj: any) => {
      if (typeof obj !== 'object' || obj === null) return;
      
      for (const key of Object.keys(obj)) {
        if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      }
    };
    
    sanitizeObject(sanitized);
    return sanitized;
  }
  
  private isSecurityEvent(event: AuditEvent): boolean {
    const securityOperations = [
      'authentication_failed',
      'authorization_denied',
      'admin_operation',
      'security_violation',
      'data_corruption_detected'
    ];
    
    return securityOperations.includes(event.operation);
  }
  
  private async sendSecurityAlert(event: EnrichedAuditEvent): Promise<void> {
    // Implementation depends on your alerting system
    console.warn('SECURITY ALERT:', {
      operation: event.operation,
      agent: event.agentId,
      timestamp: event.timestamp,
      details: event.details
    });
  }
  
  private async calculateEventChecksum(event: AuditEvent): Promise<string> {
    const eventString = JSON.stringify(event, Object.keys(event).sort());
    const hash = crypto.createHash('sha256');
    hash.update(eventString);
    return hash.digest('hex');
  }
  
  private getCurrentSessionId(): string {
    // Implementation depends on your session management
    return crypto.randomUUID();
  }
}

interface AuditEvent {
  operation: string;
  agentId?: string;
  namespace?: string;
  itemId?: string;
  success: boolean;
  details?: Record<string, any>;
  data?: any;
}

interface EnrichedAuditEvent extends AuditEvent {
  id: string;
  timestamp: Date;
  sessionId: string;
  level: 'info' | 'warning' | 'error';
  checksum: string;
}

// File-based audit storage
class FileAuditStorage implements AuditStorage {
  constructor(
    private logPath: string,
    private rotateSize: number = 100 * 1024 * 1024 // 100MB
  ) {}
  
  async write(event: EnrichedAuditEvent): Promise<void> {
    const logLine = JSON.stringify(event) + '\n';
    
    // Check if rotation is needed
    await this.checkRotation();
    
    // Append to current log file
    await fs.appendFile(this.logPath, logLine, { encoding: 'utf8' });
  }
  
  private async checkRotation(): Promise<void> {
    try {
      const stats = await fs.stat(this.logPath);
      if (stats.size >= this.rotateSize) {
        await this.rotateLog();
      }
    } catch (error) {
      // File doesn't exist yet, that's fine
    }
  }
  
  private async rotateLog(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedPath = `${this.logPath}.${timestamp}`;
    
    await fs.rename(this.logPath, rotatedPath);
    
    // Compress old log file
    const gzip = createGzip();
    const source = createReadStream(rotatedPath);
    const destination = createWriteStream(`${rotatedPath}.gz`);
    
    await pipeline(source, gzip, destination);
    await fs.unlink(rotatedPath);
  }
}
```

## Rate Limiting

### Request Rate Limiting

```typescript
// Rate limiting implementation
class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map();
  
  constructor(private config: SecurityConfig['rateLimiting']) {}
  
  async checkRateLimit(agentId: string, operation: string): Promise<RateLimitResult> {
    if (!this.config?.enabled) {
      return { allowed: true, remaining: Infinity, resetTime: null };
    }
    
    const bucketKey = `${agentId}:${operation}`;
    let bucket = this.buckets.get(bucketKey);
    
    if (!bucket) {
      bucket = new TokenBucket(
        this.getOperationLimit(operation),
        this.config.windowSize || 60000 // 1 minute default
      );
      this.buckets.set(bucketKey, bucket);
    }
    
    const allowed = bucket.consume();
    
    if (!allowed) {
      // Log rate limit violation
      console.warn(`Rate limit exceeded for agent ${agentId}, operation ${operation}`);
    }
    
    return {
      allowed,
      remaining: bucket.tokens,
      resetTime: bucket.resetTime
    };
  }
  
  private getOperationLimit(operation: string): number {
    // Different limits for different operations
    const operationLimits: Record<string, number> = {
      'store': this.config?.perAgentLimit || 100,
      'query': (this.config?.perAgentLimit || 100) * 2, // Queries can be more frequent
      'retrieve': (this.config?.perAgentLimit || 100) * 5, // Retrievals are lighter
      'delete': Math.floor((this.config?.perAgentLimit || 100) / 10) // Deletions are limited
    };
    
    return operationLimits[operation] || this.config?.perAgentLimit || 100;
  }
}

class TokenBucket {
  public tokens: number;
  public resetTime: Date;
  
  constructor(
    private capacity: number,
    private windowMs: number
  ) {
    this.tokens = capacity;
    this.resetTime = new Date(Date.now() + windowMs);
    
    // Schedule token refill
    this.scheduleRefill();
  }
  
  consume(): boolean {
    if (this.tokens > 0) {
      this.tokens--;
      return true;
    }
    return false;
  }
  
  private scheduleRefill(): void {
    const timeToRefill = this.resetTime.getTime() - Date.now();
    
    setTimeout(() => {
      this.tokens = this.capacity;
      this.resetTime = new Date(Date.now() + this.windowMs);
      this.scheduleRefill();
    }, timeToRefill);
  }
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date | null;
}
```

## Security Best Practices

### Secure Configuration

```typescript
// Production security configuration template
const productionSecurityConfig: MemoryConfig = {
  backend: 'sqlite',
  storage: {
    path: process.env.MEMORY_DB_PATH || '/var/lib/memory/production.db',
    options: {
      // Security-focused database settings
      foreignKeys: true,
      secureDelete: true,
      journalMode: 'WAL',
      synchronous: 'FULL' // Prioritize data integrity
    }
  },
  security: {
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      keyDerivation: 'argon2',
      keyDerivationOptions: {
        memory: 65536,      // 64MB memory cost
        iterations: 3,      // Time cost
        parallelism: 1,     // Parallelism
        saltLength: 32      // 256-bit salt
      },
      rotateKeys: true,
      keyRotationInterval: 30 * 24 * 60 * 60 * 1000 // 30 days
    },
    checksums: {
      enabled: true,
      algorithm: 'blake3', // Fast and secure
      verifyOnRead: true,
      repairCorruption: false // Don't auto-repair in production
    },
    authentication: {
      enabled: true,
      method: 'certificate', // Most secure for production
      certificateConfig: {
        ca: process.env.MEMORY_CA_CERT_PATH!,
        cert: process.env.MEMORY_CLIENT_CERT_PATH!,
        key: process.env.MEMORY_CLIENT_KEY_PATH!
      }
    },
    auditLog: {
      enabled: true,
      level: 'standard',
      destination: 'file',
      logFile: '/var/log/memory/audit.log',
      rotateSize: 100 * 1024 * 1024, // 100MB
      retentionDays: 90,
      includeData: false // Don't include sensitive data
    },
    rateLimiting: {
      enabled: true,
      globalLimit: 10000,   // 10k ops/sec globally
      perAgentLimit: 1000,  // 1k ops/sec per agent
      burstAllowance: 100,  // Allow bursts
      windowSize: 60000     // 1 minute window
    }
  },
  namespaces: {
    enabled: true,
    defaultNamespace: 'default',
    enforcePermissions: true,
    strictIsolation: true,
    allowGlobalSearch: false // Prevent cross-namespace data leaks
  }
};
```

### Security Checklist

#### Deployment Security

- [ ] **Encryption**: Enable encryption at rest with strong algorithms
- [ ] **Key Management**: Use secure key storage (Vault, KMS, etc.)
- [ ] **Authentication**: Implement certificate-based auth for production
- [ ] **Authorization**: Configure role-based access control
- [ ] **Audit Logging**: Enable comprehensive audit trails
- [ ] **Rate Limiting**: Implement request rate limiting
- [ ] **Network Security**: Use TLS for all communications
- [ ] **File Permissions**: Restrict file system permissions

#### Operational Security

- [ ] **Regular Updates**: Keep dependencies updated
- [ ] **Security Scanning**: Regular vulnerability scans
- [ ] **Monitoring**: Real-time security monitoring
- [ ] **Backup Security**: Encrypt and secure backups
- [ ] **Incident Response**: Have incident response procedures
- [ ] **Key Rotation**: Regular key rotation schedules
- [ ] **Access Reviews**: Regular access permission reviews
- [ ] **Security Training**: Team security awareness

#### Development Security

- [ ] **Secure Coding**: Follow secure coding practices
- [ ] **Input Validation**: Validate all inputs
- [ ] **Error Handling**: Don't leak sensitive information
- [ ] **Testing**: Include security in testing procedures
- [ ] **Code Review**: Security-focused code reviews
- [ ] **Dependency Scanning**: Scan for vulnerable dependencies
- [ ] **Secret Management**: Never commit secrets
- [ ] **Least Privilege**: Follow principle of least privilege

### Common Security Vulnerabilities

#### Prevention Strategies

```typescript
// Input validation to prevent injection attacks
class InputValidator {
  static validateMemoryItem(item: Partial<MemoryItem>): ValidationResult {
    const errors: string[] = [];
    
    // Validate required fields
    if (!item.category || typeof item.category !== 'string') {
      errors.push('Category is required and must be a string');
    }
    
    if (!item.content || typeof item.content !== 'string') {
      errors.push('Content is required and must be a string');
    }
    
    // Validate content length to prevent DoS
    if (item.content && item.content.length > 1024 * 1024) { // 1MB limit
      errors.push('Content too large (max 1MB)');
    }
    
    // Validate tags
    if (item.tags) {
      if (!Array.isArray(item.tags)) {
        errors.push('Tags must be an array');
      } else if (item.tags.length > 100) {
        errors.push('Too many tags (max 100)');
      } else if (item.tags.some(tag => typeof tag !== 'string')) {
        errors.push('All tags must be strings');
      }
    }
    
    // Validate namespace
    if (item.namespace && !/^[a-zA-Z0-9_-]+$/.test(item.namespace)) {
      errors.push('Invalid namespace format');
    }
    
    // Validate metadata
    if (item.metadata) {
      if (typeof item.metadata !== 'object') {
        errors.push('Metadata must be an object');
      } else {
        const metadataSize = JSON.stringify(item.metadata).length;
        if (metadataSize > 64 * 1024) { // 64KB limit
          errors.push('Metadata too large (max 64KB)');
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}
```

This comprehensive security guide covers all major aspects of securing the SPARC Memory Bank system, from encryption and access control to audit logging and best practices. The implementation provides multiple layers of security to protect against various threats and vulnerabilities.