# Abstract Subagent Architecture - Deployment Guide

## Deployment Overview

This guide provides comprehensive instructions for deploying the Abstract Subagent Architecture in various environments, from development to production. The system supports multiple deployment models including single-instance, multi-instance, and distributed deployments.

## Prerequisites

### System Requirements

#### Minimum Requirements
- **Node.js**: Version 18.0.0 or higher
- **Memory**: 2GB RAM minimum, 4GB recommended
- **Storage**: 10GB free disk space
- **Network**: Stable internet connection for AI provider APIs

#### Recommended Requirements
- **Node.js**: Version 20.0.0 or higher
- **Memory**: 8GB RAM or higher
- **Storage**: 50GB SSD storage
- **CPU**: 4+ cores
- **Network**: High-speed internet connection

### Software Dependencies

#### Core Dependencies
```json
{
  "dependencies": {
    "@claude-flow/core": "^2.0.0",
    "@claude-flow/abstract-agents": "^1.0.0",
    "typescript": "^5.0.0",
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "compression": "^1.7.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.0",
    "jest": "^29.0.0",
    "ts-node": "^10.9.0"
  }
}
```

#### AI Provider Dependencies
```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.9.0",
    "openai": "^4.0.0",
    "@google/generative-ai": "^0.2.0",
    "axios": "^1.6.0"
  }
}
```

### Environment Variables

#### Required Environment Variables
```bash
# Claude-Flow Configuration
CLAUDE_FLOW_ENV=production
CLAUDE_FLOW_LOG_LEVEL=info
CLAUDE_FLOW_CONFIG_PATH=/etc/claude-flow/config

# AI Provider API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
CURSOR_API_KEY=cursor_...

# Database Configuration
DATABASE_URL=postgresql://user:password@localhost:5432/claude_flow
REDIS_URL=redis://localhost:6379

# Security Configuration
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key

# Monitoring Configuration
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
```

#### Optional Environment Variables
```bash
# Performance Tuning
MAX_CONCURRENT_TASKS=100
TASK_TIMEOUT=30000
HEALTH_CHECK_INTERVAL=30000

# Logging Configuration
LOG_FORMAT=json
LOG_FILE_PATH=/var/log/claude-flow/abstract-agents.log

# Feature Flags
ENABLE_METRICS=true
ENABLE_TRACING=true
ENABLE_PROFILING=false
```

## Installation Methods

### 1. NPM Installation

#### Global Installation
```bash
# Install globally
npm install -g @claude-flow/abstract-agents

# Verify installation
claude-flow --version
claude-flow agent --help
```

#### Local Installation
```bash
# Create project directory
mkdir my-claude-flow-project
cd my-claude-flow-project

# Initialize project
npm init -y

# Install dependencies
npm install @claude-flow/abstract-agents

# Create configuration file
touch claude-flow.config.js
```

### 2. Docker Installation

#### Dockerfile
```dockerfile
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S claude-flow -u 1001

# Change ownership
RUN chown -R claude-flow:nodejs /app
USER claude-flow

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["npm", "start"]
```

#### Docker Compose
```yaml
version: '3.8'

services:
  abstract-agents:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - GOOGLE_API_KEY=${GOOGLE_API_KEY}
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
    depends_on:
      - redis
      - postgres
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    ports:
      - "5432:5432"
    environment:
      - POSTGRES_DB=claude_flow
      - POSTGRES_USER=claude_flow
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
    restart: unless-stopped

volumes:
  redis_data:
  postgres_data:
  prometheus_data:
  grafana_data:
```

### 3. Kubernetes Installation

#### Namespace
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: claude-flow
```

#### ConfigMap
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: abstract-agents-config
  namespace: claude-flow
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  MAX_CONCURRENT_TASKS: "100"
  TASK_TIMEOUT: "30000"
  HEALTH_CHECK_INTERVAL: "30000"
```

#### Secret
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: abstract-agents-secrets
  namespace: claude-flow
type: Opaque
data:
  ANTHROPIC_API_KEY: <base64-encoded-key>
  OPENAI_API_KEY: <base64-encoded-key>
  GOOGLE_API_KEY: <base64-encoded-key>
  JWT_SECRET: <base64-encoded-secret>
  ENCRYPTION_KEY: <base64-encoded-key>
```

#### Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: abstract-agents
  namespace: claude-flow
spec:
  replicas: 3
  selector:
    matchLabels:
      app: abstract-agents
  template:
    metadata:
      labels:
        app: abstract-agents
    spec:
      containers:
      - name: abstract-agents
        image: claude-flow/abstract-agents:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: abstract-agents-config
        - secretRef:
            name: abstract-agents-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

#### Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: abstract-agents-service
  namespace: claude-flow
spec:
  selector:
    app: abstract-agents
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

#### Ingress
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: abstract-agents-ingress
  namespace: claude-flow
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - api.claude-flow.com
    secretName: claude-flow-tls
  rules:
  - host: api.claude-flow.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: abstract-agents-service
            port:
              number: 3000
```

## Configuration

### Configuration File Structure

#### claude-flow.config.js
```javascript
module.exports = {
  // Core configuration
  core: {
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },

  // Agent configuration
  agents: {
    defaultProvider: 'anthropic-claude-code',
    maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS) || 100,
    taskTimeout: parseInt(process.env.TASK_TIMEOUT) || 30000,
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000
  },

  // Provider configuration
  providers: {
    'anthropic-claude-code': {
      baseUrl: 'https://api.anthropic.com',
      authentication: {
        type: 'api_key',
        credentials: {
          apiKey: process.env.ANTHROPIC_API_KEY
        }
      },
      limits: {
        requestsPerMinute: 60,
        tokensPerMinute: 100000
      }
    },
    'openai-codex': {
      baseUrl: 'https://api.openai.com/v1',
      authentication: {
        type: 'api_key',
        credentials: {
          apiKey: process.env.OPENAI_API_KEY
        }
      },
      limits: {
        requestsPerMinute: 60,
        tokensPerMinute: 150000
      }
    },
    'google-gemini': {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      authentication: {
        type: 'api_key',
        credentials: {
          apiKey: process.env.GOOGLE_API_KEY
        }
      },
      limits: {
        requestsPerMinute: 60,
        tokensPerMinute: 200000
      }
    }
  },

  // Database configuration
  database: {
    url: process.env.DATABASE_URL,
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createRetryIntervalMillis: 200
    }
  },

  // Redis configuration
  redis: {
    url: process.env.REDIS_URL,
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true
  },

  // Security configuration
  security: {
    jwtSecret: process.env.JWT_SECRET,
    encryptionKey: process.env.ENCRYPTION_KEY,
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      credentials: true
    }
  },

  // Monitoring configuration
  monitoring: {
    prometheus: {
      enabled: process.env.ENABLE_METRICS === 'true',
      port: parseInt(process.env.PROMETHEUS_PORT) || 9090
    },
    tracing: {
      enabled: process.env.ENABLE_TRACING === 'true',
      jaeger: {
        endpoint: process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces'
      }
    }
  }
};
```

### Environment-Specific Configuration

#### Development Configuration
```javascript
// config/development.js
module.exports = {
  ...require('./base'),
  core: {
    environment: 'development',
    logLevel: 'debug',
    port: 3000
  },
  agents: {
    maxConcurrentTasks: 10,
    taskTimeout: 10000
  },
  monitoring: {
    prometheus: { enabled: false },
    tracing: { enabled: false }
  }
};
```

#### Production Configuration
```javascript
// config/production.js
module.exports = {
  ...require('./base'),
  core: {
    environment: 'production',
    logLevel: 'info',
    port: process.env.PORT || 3000
  },
  agents: {
    maxConcurrentTasks: 100,
    taskTimeout: 30000
  },
  monitoring: {
    prometheus: { enabled: true },
    tracing: { enabled: true }
  }
};
```

## Deployment Strategies

### 1. Single Instance Deployment

#### Development Environment
```bash
# Clone repository
git clone https://github.com/ruvnet/claude-flow.git
cd claude-flow

# Install dependencies
npm install

# Set environment variables
export ANTHROPIC_API_KEY="your-api-key"
export OPENAI_API_KEY="your-api-key"
export GOOGLE_API_KEY="your-api-key"

# Start development server
npm run dev
```

#### Production Environment
```bash
# Build application
npm run build

# Start production server
npm start
```

### 2. Multi-Instance Deployment

#### Load Balancer Configuration
```nginx
# nginx.conf
upstream claude_flow_backend {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    listen 80;
    server_name api.claude-flow.com;

    location / {
        proxy_pass http://claude_flow_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### Process Manager Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'claude-flow-1',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
      INSTANCE_ID: 'claude-flow-1'
    }
  }, {
    name: 'claude-flow-2',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3002,
      INSTANCE_ID: 'claude-flow-2'
    }
  }, {
    name: 'claude-flow-3',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3003,
      INSTANCE_ID: 'claude-flow-3'
    }
  }]
};
```

### 3. Distributed Deployment

#### Microservices Architecture
```yaml
# docker-compose.distributed.yml
version: '3.8'

services:
  # API Gateway
  api-gateway:
    image: claude-flow/api-gateway:latest
    ports:
      - "80:80"
    environment:
      - UPSTREAM_SERVICES=agent-service,coordinator-service,config-service
    depends_on:
      - agent-service
      - coordinator-service
      - config-service

  # Agent Service
  agent-service:
    image: claude-flow/agent-service:latest
    environment:
      - SERVICE_NAME=agent-service
      - SERVICE_PORT=3001
    depends_on:
      - redis
      - postgres

  # Coordinator Service
  coordinator-service:
    image: claude-flow/coordinator-service:latest
    environment:
      - SERVICE_NAME=coordinator-service
      - SERVICE_PORT=3002
    depends_on:
      - redis
      - postgres

  # Configuration Service
  config-service:
    image: claude-flow/config-service:latest
    environment:
      - SERVICE_NAME=config-service
      - SERVICE_PORT=3003
    depends_on:
      - postgres

  # Shared Services
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=claude_flow
      - POSTGRES_USER=claude_flow
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  redis_data:
  postgres_data:
```

## Monitoring and Observability

### Prometheus Configuration

#### prometheus.yml
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "rules/*.yml"

scrape_configs:
  - job_name: 'claude-flow-abstract-agents'
    static_configs:
      - targets: ['localhost:9090']
    metrics_path: /metrics
    scrape_interval: 5s

  - job_name: 'claude-flow-agents'
    static_configs:
      - targets: ['localhost:3001', 'localhost:3002', 'localhost:3003']
    metrics_path: /metrics
    scrape_interval: 10s

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
```

#### Alert Rules
```yaml
# rules/claude-flow.yml
groups:
- name: claude-flow
  rules:
  - alert: HighErrorRate
    expr: rate(http_requests_total{status=~"5.."}[5m]) > 0.1
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
      description: "Error rate is {{ $value }} errors per second"

  - alert: HighResponseTime
    expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 5
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High response time detected"
      description: "95th percentile response time is {{ $value }} seconds"

  - alert: AgentDown
    expr: up{job="claude-flow-agents"} == 0
    for: 1m
    labels:
      severity: critical
    annotations:
      summary: "Agent is down"
      description: "Agent {{ $labels.instance }} is down"
```

### Grafana Dashboard

#### Dashboard Configuration
```json
{
  "dashboard": {
    "title": "Claude Flow Abstract Agents",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{route}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])",
            "legendFormat": "5xx errors"
          }
        ]
      },
      {
        "title": "Active Agents",
        "type": "stat",
        "targets": [
          {
            "expr": "claude_flow_agents_active",
            "legendFormat": "Active Agents"
          }
        ]
      }
    ]
  }
}
```

## Security Configuration

### SSL/TLS Configuration

#### Nginx SSL Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name api.claude-flow.com;

    ssl_certificate /etc/ssl/certs/claude-flow.crt;
    ssl_certificate_key /etc/ssl/private/claude-flow.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    location / {
        proxy_pass http://claude_flow_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Firewall Configuration

#### UFW Configuration
```bash
# Enable UFW
sudo ufw enable

# Allow SSH
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow application ports
sudo ufw allow 3000:3003/tcp

# Allow monitoring ports
sudo ufw allow 9090/tcp
sudo ufw allow 3001/tcp

# Deny all other traffic
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

## Backup and Recovery

### Database Backup

#### Automated Backup Script
```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/var/backups/claude-flow"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="claude_flow"

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup PostgreSQL database
pg_dump $DATABASE_URL > $BACKUP_DIR/claude_flow_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/claude_flow_$DATE.sql

# Remove backups older than 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: claude_flow_$DATE.sql.gz"
```

#### Cron Job
```bash
# Add to crontab
0 2 * * * /path/to/backup.sh
```

### Configuration Backup

#### Configuration Backup Script
```bash
#!/bin/bash
# config-backup.sh

CONFIG_DIR="/etc/claude-flow"
BACKUP_DIR="/var/backups/claude-flow/config"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup configuration files
tar -czf $BACKUP_DIR/config_$DATE.tar.gz -C $CONFIG_DIR .

# Remove backups older than 30 days
find $BACKUP_DIR -name "config_*.tar.gz" -mtime +30 -delete

echo "Configuration backup completed: config_$DATE.tar.gz"
```

## Troubleshooting

### Common Issues

#### 1. Agent Registration Fails
**Symptoms**: Agents fail to register with coordinator
**Causes**: Configuration errors, authentication failures, network issues
**Solutions**:
```bash
# Check agent configuration
claude-flow agent config validate

# Test agent connectivity
claude-flow agent test <agentId>

# Check logs
tail -f /var/log/claude-flow/abstract-agents.log
```

#### 2. High Memory Usage
**Symptoms**: High memory usage, system slowdown
**Causes**: Memory leaks, large result caching, inefficient data structures
**Solutions**:
```bash
# Monitor memory usage
htop
free -h

# Check for memory leaks
node --inspect dist/index.js

# Restart services
systemctl restart claude-flow
```

#### 3. API Rate Limit Exceeded
**Symptoms**: API requests fail with rate limit errors
**Causes**: Exceeding provider rate limits, inefficient request patterns
**Solutions**:
```bash
# Check rate limit status
claude-flow provider status <providerId>

# Adjust rate limiting
claude-flow config set providers.<providerId>.limits.requestsPerMinute 30

# Implement request queuing
claude-flow config set agents.requestQueuing true
```

#### 4. Database Connection Issues
**Symptoms**: Database connection errors, slow queries
**Causes**: Database overload, network issues, connection pool exhaustion
**Solutions**:
```bash
# Check database status
pg_isready -h localhost -p 5432

# Check connection pool
claude-flow db status

# Restart database
systemctl restart postgresql
```

### Debugging Tools

#### 1. Health Check Endpoints
```bash
# Check overall health
curl http://localhost:3000/health

# Check agent health
curl http://localhost:3000/agents/health

# Check provider health
curl http://localhost:3000/providers/health
```

#### 2. Metrics Endpoints
```bash
# Prometheus metrics
curl http://localhost:9090/metrics

# Application metrics
curl http://localhost:3000/metrics
```

#### 3. Log Analysis
```bash
# Real-time log monitoring
tail -f /var/log/claude-flow/abstract-agents.log

# Error log analysis
grep "ERROR" /var/log/claude-flow/abstract-agents.log

# Performance log analysis
grep "SLOW" /var/log/claude-flow/abstract-agents.log
```

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2024-01-XX | System Architect | Initial deployment guide |

## References

- [Requirements Document](./REQUIREMENTS.md)
- [Technical Specifications](./SPECIFICATIONS.md)
- [Architecture Design Document](./ARCHITECTURE.md)
- [API Documentation](./API.md)
- [Integration Guide](./INTEGRATION.md)
- [Testing Strategy](./TESTING.md)
- [Claude-Flow Core Documentation](../../../README.md)