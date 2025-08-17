# 🐳 Claude Flow v2.0.0 Docker Deployment Guide

## 📋 Table of Contents
1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Docker Images](#docker-images)
4. [Container Configuration](#container-configuration)
5. [Docker Compose](#docker-compose)
6. [Production Deployment](#production-deployment)
7. [Kubernetes Deployment](#kubernetes-deployment)
8. [Security Best Practices](#security-best-practices)
9. [Monitoring & Logging](#monitoring--logging)
10. [Troubleshooting](#troubleshooting)

## 🎯 Overview

Claude Flow v2.0.0 provides enterprise-grade Docker support with:
- **✅ Multi-stage builds** - 60% smaller images, faster deployments
- **✅ Security hardening** - Non-root user, minimal attack surface
- **✅ Health checks** - Automatic container recovery
- **✅ Orchestration ready** - Kubernetes, Docker Swarm compatible
- **✅ Development & production** - Optimized images for each environment

## 🚀 Quick Start

### Pull and Run
```bash
# Pull the latest image
docker pull ruvnet/claude-flow:2.0.0

# Run with interactive shell
docker run -it -p 3000:3000 ruvnet/claude-flow:2.0.0

# Run with volume mounting
docker run -it -v $(pwd):/app -p 3000:3000 ruvnet/claude-flow:2.0.0 init --sparc
```

### Build from Source
```bash
# Clone repository
git clone https://github.com/ruvnet/claude-code-flow.git
cd claude-code-flow

# Build Docker image
docker build -t claude-flow:local .

# Run local build
docker run -it -p 3000:3000 claude-flow:local
```

## 🏗️ Docker Images

### Available Tags
| Tag | Description | Size | Use Case |
|-----|-------------|------|----------|
| `2.0.0`, `latest` | Latest stable release | 180MB | Production |
| `2.0.0-alpine` | Alpine Linux based | 95MB | Minimal deployments |
| `2.0.0-dev` | Development image | 450MB | Development with tools |
| `2.0.0-cuda` | GPU support | 2.8GB | Neural processing |

### Multi-Architecture Support
```bash
# Available architectures
docker pull ruvnet/claude-flow:2.0.0 --platform linux/amd64
docker pull ruvnet/claude-flow:2.0.0 --platform linux/arm64
docker pull ruvnet/claude-flow:2.0.0 --platform linux/arm/v7
```

## ⚙️ Container Configuration

### Dockerfile (Production)
```dockerfile
# Multi-stage build for optimal size
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine

# Security: Create non-root user
RUN addgroup -g 1001 -S claude && \
    adduser -S claude -u 1001

# Install runtime dependencies only
RUN apk add --no-cache tini

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=claude:claude /app/dist ./dist
COPY --from=builder --chown=claude:claude /app/node_modules ./node_modules
COPY --from=builder --chown=claude:claude /app/package*.json ./

# Copy configuration templates
COPY --chown=claude:claude .claude .claude
COPY --chown=claude:claude CLAUDE.md ./

# Create necessary directories
RUN mkdir -p logs memory && chown -R claude:claude .

# Switch to non-root user
USER claude

# Expose ports
EXPOSE 3000 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

# Default command
CMD ["node", "dist/cli/index.js", "start", "--ui"]
```

### Environment Variables
```bash
# Core Configuration
CLAUDE_FLOW_PORT=3000
CLAUDE_FLOW_UI_ENABLED=true
CLAUDE_FLOW_LOG_LEVEL=info

# MCP Configuration
MCP_SERVER_ENABLED=true
MCP_SERVER_PORT=3001
MCP_TIMEOUT=30000

# Swarm Configuration
SWARM_ENABLED=true
SWARM_MAX_AGENTS=8
SWARM_DEFAULT_TOPOLOGY=hierarchical

# Memory Configuration
MEMORY_PERSISTENCE_PATH=/app/memory
MEMORY_BACKUP_ENABLED=true
MEMORY_MAX_SIZE=1GB

# Security
API_KEY_ENCRYPTION=true
AUDIT_LOGGING=true
SSL_ENABLED=false
```

## 🐙 Docker Compose

### Development Setup
```yaml
# docker-compose.yml
version: '3.8'

services:
  claude-flow:
    image: ruvnet/claude-flow:2.0.0-dev
    container_name: claude-flow-dev
    ports:
      - "3000:3000"
      - "3001:3001"
    volumes:
      - ./:/app
      - claude-memory:/app/memory
      - claude-logs:/app/logs
    environment:
      - NODE_ENV=development
      - CLAUDE_FLOW_PORT=3000
      - MCP_SERVER_PORT=3001
      - MEMORY_PERSISTENCE_PATH=/app/memory
    command: ["npm", "run", "dev"]
    networks:
      - claude-network

volumes:
  claude-memory:
  claude-logs:

networks:
  claude-network:
    driver: bridge
```

### Production Setup
```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  claude-flow:
    image: ruvnet/claude-flow:2.0.0
    container_name: claude-flow-prod
    restart: unless-stopped
    ports:
      - "80:3000"
      - "3001:3001"
    volumes:
      - claude-config:/app/.claude
      - claude-memory:/app/memory
      - claude-logs:/app/logs
    environment:
      - NODE_ENV=production
      - CLAUDE_FLOW_PORT=3000
      - MCP_SERVER_PORT=3001
      - MEMORY_PERSISTENCE_PATH=/app/memory
      - SSL_ENABLED=true
      - AUDIT_LOGGING=true
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - claude-network

  nginx:
    image: nginx:alpine
    container_name: claude-nginx
    restart: unless-stopped
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - claude-flow
    networks:
      - claude-network

volumes:
  claude-config:
    driver: local
  claude-memory:
    driver: local
  claude-logs:
    driver: local

networks:
  claude-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

### Scaling with Docker Compose
```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  claude-flow:
    image: ruvnet/claude-flow:2.0.0
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
      restart_policy:
        condition: on-failure
        delay: 5s
        max_attempts: 3
    ports:
      - target: 3000
        published: 3000
        protocol: tcp
        mode: host
    environment:
      - INSTANCE_ID={{.Task.Slot}}
      - SWARM_MODE=distributed
    networks:
      - claude-network

  load-balancer:
    image: haproxy:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    depends_on:
      - claude-flow
    networks:
      - claude-network
```

## 🚀 Production Deployment

### 1. Build Production Image
```bash
# Build with build args
docker build \
  --build-arg NODE_ENV=production \
  --build-arg VERSION=2.0.0 \
  --build-arg BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
  --build-arg VCS_REF=$(git rev-parse --short HEAD) \
  -t claude-flow:production \
  -f Dockerfile.prod .
```

### 2. Security Scanning
```bash
# Scan for vulnerabilities
docker scan claude-flow:production

# Use Trivy for detailed scanning
trivy image claude-flow:production

# Check with Snyk
snyk test --docker claude-flow:production
```

### 3. Push to Registry
```bash
# Tag for registry
docker tag claude-flow:production myregistry.com/claude-flow:2.0.0

# Push to registry
docker push myregistry.com/claude-flow:2.0.0
```

### 4. Deploy Script
```bash
#!/bin/bash
# deploy.sh

# Pull latest image
docker pull myregistry.com/claude-flow:2.0.0

# Stop existing container
docker stop claude-flow || true
docker rm claude-flow || true

# Run new container
docker run -d \
  --name claude-flow \
  --restart unless-stopped \
  -p 80:3000 \
  -v /opt/claude-flow/config:/app/.claude \
  -v /opt/claude-flow/memory:/app/memory \
  -v /opt/claude-flow/logs:/app/logs \
  -e NODE_ENV=production \
  -e CLAUDE_FLOW_PORT=3000 \
  --memory="4g" \
  --cpus="2" \
  myregistry.com/claude-flow:2.0.0
```

## ☸️ Kubernetes Deployment

### Deployment Manifest
```yaml
# claude-flow-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claude-flow
  namespace: claude-system
spec:
  replicas: 3
  selector:
    matchLabels:
      app: claude-flow
  template:
    metadata:
      labels:
        app: claude-flow
    spec:
      containers:
      - name: claude-flow
        image: ruvnet/claude-flow:2.0.0
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 3001
          name: mcp
        env:
        - name: NODE_ENV
          value: "production"
        - name: CLAUDE_FLOW_PORT
          value: "3000"
        - name: MCP_SERVER_PORT
          value: "3001"
        - name: INSTANCE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        resources:
          requests:
            memory: "2Gi"
            cpu: "1"
          limits:
            memory: "4Gi"
            cpu: "2"
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
        volumeMounts:
        - name: config
          mountPath: /app/.claude
        - name: memory
          mountPath: /app/memory
      volumes:
      - name: config
        configMap:
          name: claude-flow-config
      - name: memory
        persistentVolumeClaim:
          claimName: claude-flow-memory
---
apiVersion: v1
kind: Service
metadata:
  name: claude-flow-service
  namespace: claude-system
spec:
  selector:
    app: claude-flow
  ports:
  - port: 80
    targetPort: 3000
    name: http
  - port: 3001
    targetPort: 3001
    name: mcp
  type: LoadBalancer
```

### Helm Chart
```bash
# Install with Helm
helm repo add claude-flow https://charts.claude-flow.io
helm install claude-flow claude-flow/claude-flow \
  --namespace claude-system \
  --create-namespace \
  --set image.tag=2.0.0 \
  --set replicaCount=3 \
  --set persistence.enabled=true \
  --set ingress.enabled=true \
  --set ingress.host=claude.example.com
```

## 🔒 Security Best Practices

### 1. Image Security
```dockerfile
# Use specific versions, not latest
FROM node:20.11.0-alpine

# Run security updates
RUN apk update && apk upgrade

# Don't run as root
USER node

# Use COPY instead of ADD
COPY --chown=node:node . .

# No sensitive data in image
# Use secrets management instead
```

### 2. Runtime Security
```yaml
# docker-compose.security.yml
services:
  claude-flow:
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    read_only: true
    tmpfs:
      - /tmp
      - /app/temp
```

### 3. Network Security
```bash
# Create custom network
docker network create --driver bridge \
  --subnet=172.20.0.0/16 \
  --ip-range=172.20.240.0/20 \
  claude-secure

# Run with network isolation
docker run --network=claude-secure ...
```

## 📊 Monitoring & Logging

### 1. Prometheus Metrics
```yaml
# Add to docker-compose.yml
prometheus:
  image: prom/prometheus
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml
  ports:
    - "9090:9090"
```

### 2. Log Aggregation
```yaml
# Fluentd configuration
fluentd:
  image: fluent/fluentd
  volumes:
    - ./fluent.conf:/fluentd/etc/fluent.conf
    - claude-logs:/logs
  links:
    - claude-flow
```

### 3. Health Monitoring
```bash
# Monitor container health
docker inspect claude-flow --format='{{.State.Health.Status}}'

# View health check logs
docker inspect claude-flow --format='{{range .State.Health.Log}}{{.End}} | {{.ExitCode}} | {{.Output}}{{end}}'
```

## 🔧 Troubleshooting

### Common Issues

#### 1. Container Exits Immediately
```bash
# Check logs
docker logs claude-flow

# Run with debug
docker run -it --entrypoint /bin/sh ruvnet/claude-flow:2.0.0
```

#### 2. Permission Errors
```bash
# Fix volume permissions
docker run --rm -v $(pwd):/app alpine chown -R 1001:1001 /app

# Run with user mapping
docker run --user $(id -u):$(id -g) ...
```

#### 3. Memory Issues
```bash
# Increase memory limits
docker run --memory="8g" --memory-swap="8g" ...

# Check memory usage
docker stats claude-flow
```

#### 4. Network Connectivity
```bash
# Test from container
docker exec claude-flow ping google.com
docker exec claude-flow curl http://localhost:3000/health

# Check network
docker network inspect bridge
```

### Debugging Commands
```bash
# Interactive shell
docker exec -it claude-flow /bin/sh

# View processes
docker top claude-flow

# Export container
docker export claude-flow > claude-flow.tar

# System information
docker system df
docker system prune -a
```

## 📚 Additional Resources

- [Docker Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [Kubernetes Deployment Guide](./docs/kubernetes-deployment.md)
- [Container Security](./docs/container-security.md)
- [Performance Tuning](./docs/docker-performance.md)

---

**🎉 Claude Flow v2.0.0 - Production-Ready Docker Deployment!**