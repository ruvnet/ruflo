# Data Model Specification

## Database Schema Design

### PostgreSQL Schema

```sql
-- Users and Authentication
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_last_seen ON users(last_seen_at);

-- Dashboards
CREATE TABLE dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    is_public BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1,
    settings JSONB DEFAULT '{}'::jsonb,
    layout JSONB DEFAULT '[]'::jsonb,
    
    -- Full-text search
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B')
    ) STORED
);

CREATE INDEX idx_dashboards_owner ON dashboards(owner_id);
CREATE INDEX idx_dashboards_search ON dashboards USING GIN(search_vector);
CREATE INDEX idx_dashboards_updated ON dashboards(updated_at DESC);

-- Dashboard Collaborators
CREATE TABLE dashboard_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
    invited_by UUID REFERENCES users(id),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP WITH TIME ZONE,
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    permissions JSONB DEFAULT '[]'::jsonb,
    
    UNIQUE(dashboard_id, user_id)
);

CREATE INDEX idx_collaborators_dashboard ON dashboard_collaborators(dashboard_id);
CREATE INDEX idx_collaborators_user ON dashboard_collaborators(user_id);

-- Dashboard Widgets
CREATE TABLE widgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL,
    title VARCHAR(255),
    position JSONB NOT NULL, -- {x, y, width, height}
    config JSONB DEFAULT '{}'::jsonb,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    version INTEGER DEFAULT 1,
    is_locked BOOLEAN DEFAULT false
);

CREATE INDEX idx_widgets_dashboard ON widgets(dashboard_id);
CREATE INDEX idx_widgets_type ON widgets(type);

-- Operations Log (for OT)
CREATE TABLE operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    operation_type VARCHAR(50) NOT NULL,
    target_id UUID, -- Widget or element ID
    operation JSONB NOT NULL,
    version INTEGER NOT NULL,
    client_version INTEGER,
    server_version INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Partitioning by dashboard_id and time for performance
    CONSTRAINT operations_pkey PRIMARY KEY (id, dashboard_id, created_at)
) PARTITION BY RANGE (created_at);

-- Create monthly partitions for operations
CREATE TABLE operations_2024_01 PARTITION OF operations
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE INDEX idx_operations_dashboard_version ON operations(dashboard_id, version);
CREATE INDEX idx_operations_created ON operations(created_at DESC);

-- Document Checkpoints
CREATE TABLE checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dashboard_id UUID NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    state JSONB NOT NULL,
    operations_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    is_major BOOLEAN DEFAULT false,
    
    UNIQUE(dashboard_id, version)
);

CREATE INDEX idx_checkpoints_dashboard_version ON checkpoints(dashboard_id, version DESC);

-- User Sessions
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    device_info JSONB DEFAULT '{}'::jsonb,
    ip_address INET,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT true
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Audit Trail
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    dashboard_id UUID REFERENCES dashboards(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_dashboard ON audit_logs(dashboard_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
```

### Redis Data Structures

```typescript
// Connection Management
interface RedisConnectionData {
  // Active connections by user
  'connections:{userId}': Set<connectionId>;
  
  // Connection details
  'connection:{connectionId}': {
    userId: string;
    sessionId: string;
    serverId: string;
    roomIds: string[];
    lastPing: number;
  };
  
  // Room participants
  'room:{roomId}:participants': Set<userId>;
  
  // Room connection mapping
  'room:{roomId}:connections': Set<connectionId>;
}

// Presence Data
interface RedisPresenceData {
  // User presence in room
  'presence:{roomId}:{userId}': {
    cursor: { x: number; y: number };
    selection: Range[];
    viewport: { x: number; y: number; width: number; height: number };
    color: string;
    lastUpdate: number;
  };
  
  // Presence expiry tracking
  'presence:expiry': SortedSet<{userId: string, score: timestamp}>;
}

// Operation Queue
interface RedisOperationData {
  // Operation queue per dashboard
  'operations:{dashboardId}:queue': List<Operation>;
  
  // Operation processing lock
  'operations:{dashboardId}:lock': string; // Server ID holding lock
  
  // Version tracking
  'dashboard:{dashboardId}:version': number;
  
  // Recent operations cache
  'operations:{dashboardId}:recent': List<{
    operation: Operation;
    userId: string;
    timestamp: number;
  }>;
}

// Session Management
interface RedisSessionData {
  // Active sessions
  'session:{sessionId}': {
    userId: string;
    token: string;
    expires: number;
    deviceId: string;
  };
  
  // Session-to-user mapping
  'user:{userId}:sessions': Set<sessionId>;
}

// Rate Limiting
interface RedisRateLimitData {
  // Per-user rate limits
  'ratelimit:{userId}:cursor': number; // Count with TTL
  'ratelimit:{userId}:operations': number;
  'ratelimit:{userId}:connections': number;
  
  // Global rate limits
  'ratelimit:global:operations': number;
  'ratelimit:global:connections': number;
}

// Caching
interface RedisCacheData {
  // User profile cache
  'cache:user:{userId}': UserProfile; // TTL: 1 hour
  
  // Dashboard metadata cache
  'cache:dashboard:{dashboardId}': DashboardMetadata; // TTL: 5 minutes
  
  // Permission cache
  'cache:permissions:{userId}:{dashboardId}': Permission[]; // TTL: 15 minutes
}
```

## TypeScript Models

### Core Domain Models

```typescript
// User Model
interface User {
  id: string;
  email: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt?: Date;
  isActive: boolean;
  metadata: Record<string, any>;
}

// Dashboard Model
interface Dashboard {
  id: string;
  title: string;
  description?: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  isPublic: boolean;
  isArchived: boolean;
  version: number;
  settings: DashboardSettings;
  layout: WidgetLayout[];
}

interface DashboardSettings {
  theme?: 'light' | 'dark' | 'auto';
  gridSize?: number;
  snapToGrid?: boolean;
  showGrid?: boolean;
  autoSave?: boolean;
  collaborationMode?: 'realtime' | 'manual';
}

interface WidgetLayout {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  isLocked?: boolean;
}

// Widget Model
interface Widget {
  id: string;
  dashboardId: string;
  type: WidgetType;
  title?: string;
  position: WidgetPosition;
  config: WidgetConfig;
  data: any;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string;
  version: number;
  isLocked: boolean;
}

type WidgetType = 'text' | 'chart' | 'table' | 'image' | 'video' | 'embed' | 'custom';

interface WidgetPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
}

interface WidgetConfig {
  // Base config for all widgets
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  padding?: number;
  
  // Type-specific config
  [key: string]: any;
}

// Collaboration Models
interface Collaborator {
  id: string;
  dashboardId: string;
  userId: string;
  role: 'viewer' | 'editor' | 'admin';
  invitedBy?: string;
  invitedAt: Date;
  acceptedAt?: Date;
  lastAccessedAt?: Date;
  isActive: boolean;
  permissions: Permission[];
}

interface Permission {
  action: 'read' | 'write' | 'delete' | 'share' | 'admin';
  resource: 'dashboard' | 'widget' | 'settings' | 'collaborators';
  conditions?: {
    widgetTypes?: WidgetType[];
    timeRange?: { start: Date; end: Date };
    ipWhitelist?: string[];
  };
}

// Operation Models (for OT)
interface Operation {
  id: string;
  type: OperationType;
  targetId?: string;
  path?: string[];
  value?: any;
  oldValue?: any;
  position?: number;
  length?: number;
  attributes?: Record<string, any>;
}

type OperationType = 
  | 'insert' 
  | 'delete' 
  | 'update' 
  | 'move' 
  | 'resize' 
  | 'format' 
  | 'addWidget' 
  | 'removeWidget';

// Presence Models
interface Presence {
  userId: string;
  user: {
    id: string;
    username: string;
    avatarUrl?: string;
    color: string;
  };
  cursor?: CursorPosition;
  selection?: SelectionRange[];
  viewport?: Viewport;
  isActive: boolean;
  lastUpdate: Date;
}

interface CursorPosition {
  x: number;
  y: number;
  elementId?: string;
  offset?: number;
}

interface SelectionRange {
  startElementId: string;
  startOffset: number;
  endElementId: string;
  endOffset: number;
}

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

// Session Models
interface Session {
  id: string;
  userId: string;
  token: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  isActive: boolean;
}

interface DeviceInfo {
  userAgent: string;
  platform?: string;
  browser?: string;
  version?: string;
  isMobile?: boolean;
}

// Audit Models
interface AuditLog {
  id: string;
  userId?: string;
  dashboardId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: Date;
}
```

## Data Access Patterns

### Query Patterns

```typescript
// Common query patterns optimized with indexes

// 1. Get user's dashboards
const getUserDashboards = `
  SELECT d.*, 
    COUNT(DISTINCT dc.user_id) as collaborator_count,
    MAX(o.created_at) as last_modified
  FROM dashboards d
  LEFT JOIN dashboard_collaborators dc ON d.id = dc.dashboard_id
  LEFT JOIN operations o ON d.id = o.dashboard_id
  WHERE d.owner_id = $1 OR dc.user_id = $1
  GROUP BY d.id
  ORDER BY last_modified DESC
  LIMIT $2 OFFSET $3
`;

// 2. Get dashboard with widgets
const getDashboardWithWidgets = `
  SELECT 
    d.*,
    json_agg(
      json_build_object(
        'id', w.id,
        'type', w.type,
        'title', w.title,
        'position', w.position,
        'config', w.config,
        'data', w.data,
        'version', w.version
      ) ORDER BY w.created_at
    ) as widgets
  FROM dashboards d
  LEFT JOIN widgets w ON d.id = w.dashboard_id
  WHERE d.id = $1
  GROUP BY d.id
`;

// 3. Get operations since version
const getOperationsSinceVersion = `
  SELECT * FROM operations
  WHERE dashboard_id = $1 AND version > $2
  ORDER BY version ASC
  LIMIT 1000
`;

// 4. Get active collaborators
const getActiveCollaborators = `
  SELECT 
    u.id, u.username, u.avatar_url,
    dc.role, dc.last_accessed_at,
    EXISTS(
      SELECT 1 FROM sessions s 
      WHERE s.user_id = u.id 
      AND s.expires_at > NOW()
    ) as is_online
  FROM dashboard_collaborators dc
  JOIN users u ON dc.user_id = u.id
  WHERE dc.dashboard_id = $1 AND dc.is_active = true
`;
```

### Caching Strategy

```typescript
// Multi-level caching approach

class CacheManager {
  // L1: In-memory cache (Node.js process)
  private memoryCache = new LRUCache<string, any>({
    max: 1000,
    ttl: 1000 * 60 * 5 // 5 minutes
  });
  
  // L2: Redis cache
  private redisCache: Redis;
  
  // L3: PostgreSQL
  private db: Database;
  
  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    // Check L1
    const memResult = this.memoryCache.get(key);
    if (memResult) return memResult;
    
    // Check L2
    const redisResult = await this.redisCache.get(key);
    if (redisResult) {
      this.memoryCache.set(key, redisResult);
      return JSON.parse(redisResult);
    }
    
    // Fetch from L3
    const dbResult = await fetcher();
    
    // Populate caches
    await this.redisCache.setex(key, 300, JSON.stringify(dbResult));
    this.memoryCache.set(key, dbResult);
    
    return dbResult;
  }
}
```

## Data Migration Strategy

### Version Control for Schema Changes

```sql
-- Migration tracking table
CREATE TABLE schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    checksum VARCHAR(64),
    execution_time_ms INTEGER
);

-- Example migration
-- Version: 2024_01_15_add_dashboard_templates
BEGIN;

CREATE TABLE dashboard_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),
    thumbnail_url VARCHAR(500),
    layout JSONB NOT NULL,
    default_widgets JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_public BOOLEAN DEFAULT true
);

INSERT INTO schema_migrations (version, checksum) 
VALUES ('2024_01_15_add_dashboard_templates', 'abc123...');

COMMIT;
```

### Data Consistency Guarantees

1. **ACID Transactions** for critical operations
2. **Event Sourcing** for operation history
3. **Optimistic Locking** with version numbers
4. **Eventual Consistency** for presence data
5. **Strong Consistency** for permissions