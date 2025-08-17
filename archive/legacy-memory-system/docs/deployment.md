# Deployment Guide

This guide covers deploying SPARC Memory Bank in various environments, from development to large-scale production.

## Quick Start Deployment

### Local Development

```bash
# Clone the repository
git clone https://github.com/sparc/memory-bank.git
cd memory-bank

# Install dependencies
npm install

# Start with default configuration
npm run dev
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Start the application
CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  memory-bank:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - NODE_ENV=production
      - MEMORY_BACKEND=sqlite
      - MEMORY_STORAGE_PATH=/app/data/memory.db
      - MEMORY_CACHE_SIZE=500MB
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Production Deployment

### System Requirements

#### Minimum Requirements
- **CPU**: 2 cores (2.0 GHz)
- **RAM**: 4 GB
- **Storage**: 20 GB SSD
- **Network**: 100 Mbps

#### Recommended Requirements
- **CPU**: 4+ cores (2.5+ GHz)
- **RAM**: 8+ GB
- **Storage**: 100+ GB NVMe SSD
- **Network**: 1+ Gbps

#### High-Performance Requirements
- **CPU**: 8+ cores (3.0+ GHz)
- **RAM**: 32+ GB
- **Storage**: 500+ GB NVMe SSD with high IOPS
- **Network**: 10+ Gbps

### Database Optimization

#### SQLite Production Configuration

```typescript
const productionConfig = {
  backend: 'sqlite',
  storage: {
    path: '/var/lib/memory/production.db',
    options: {
      // Performance settings
      journalMode: 'WAL',
      synchronous: 'NORMAL',
      cacheSize: 20000,           // 20k pages ≈ 80MB
      mmapSize: 1073741824,       // 1GB memory mapping
      tempStore: 'MEMORY',
      
      // Connection management
      maxConnections: 50,
      busyTimeout: 60000,
      idleTimeout: 300000,
      
      // WAL optimization
      enableWalCheckpoint: true,
      walCheckpointInterval: 300000, // 5 minutes
      walCheckpointPages: 10000,
      
      // Maintenance
      pragmaOptimize: true,
      optimizeInterval: 3600000,  // 1 hour
      autoVacuum: 'INCREMENTAL',
      
      // Security
      foreignKeys: true,
      secureDelete: true
    }
  },
  cache: {
    enabled: true,
    maxSize: 2 * 1024 * 1024 * 1024, // 2GB
    strategy: 'adaptive',
    ttl: 3600000,                    // 1 hour
    compressionEnabled: true
  }
};
```

#### PostgreSQL Integration (Custom Backend)

```typescript
// Custom PostgreSQL backend for enterprise deployment
const postgresConfig = {
  backend: new PostgreSQLBackend({
    host: 'postgres.internal',
    port: 5432,
    database: 'memory_bank',
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    ssl: {
      rejectUnauthorized: false,
      ca: fs.readFileSync('./certs/ca.pem').toString(),
      cert: fs.readFileSync('./certs/client.pem').toString(),
      key: fs.readFileSync('./certs/client.key').toString()
    },
    pool: {
      min: 10,
      max: 100,
      acquireTimeoutMillis: 60000,
      createTimeoutMillis: 30000,
      destroyTimeoutMillis: 5000,
      idleTimeoutMillis: 30000
    }
  })
};
```

### Kubernetes Deployment

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: memory-bank
  labels:
    name: memory-bank

---
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: memory-config
  namespace: memory-bank
data:
  config.json: |
    {
      "backend": "sqlite",
      "storage": {
        "path": "/data/memory.db",
        "options": {
          "journalMode": "WAL",
          "synchronous": "NORMAL",
          "cacheSize": 10000,
          "maxConnections": 20
        }
      },
      "cache": {
        "enabled": true,
        "maxSize": 1073741824,
        "strategy": "lru"
      }
    }

---
# k8s/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: memory-storage
  namespace: memory-bank
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: fast-ssd

---
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: memory-bank
  namespace: memory-bank
  labels:
    app: memory-bank
spec:
  replicas: 3
  selector:
    matchLabels:
      app: memory-bank
  template:
    metadata:
      labels:
        app: memory-bank
    spec:
      containers:
      - name: memory-bank
        image: sparc/memory-bank:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: CONFIG_PATH
          value: "/config/config.json"
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: memory-secrets
              key: openai-api-key
        volumeMounts:
        - name: config-volume
          mountPath: /config
        - name: data-volume
          mountPath: /data
        resources:
          requests:
            memory: "2Gi"
            cpu: "1000m"
          limits:
            memory: "4Gi"
            cpu: "2000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: config-volume
        configMap:
          name: memory-config
      - name: data-volume
        persistentVolumeClaim:
          claimName: memory-storage

---
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: memory-bank-service
  namespace: memory-bank
spec:
  selector:
    app: memory-bank
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP

---
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: memory-bank-ingress
  namespace: memory-bank
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
  - hosts:
    - memory.example.com
    secretName: memory-bank-tls
  rules:
  - host: memory.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: memory-bank-service
            port:
              number: 80
```

### Load Balancing and High Availability

#### Multi-Instance Deployment

```yaml
# docker-compose-ha.yml
version: '3.8'
services:
  memory-bank-1:
    build: .
    environment:
      - INSTANCE_ID=1
      - MEMORY_STORAGE_PATH=/data/memory-1.db
    volumes:
      - ./data:/data
    networks:
      - memory-network
  
  memory-bank-2:
    build: .
    environment:
      - INSTANCE_ID=2
      - MEMORY_STORAGE_PATH=/data/memory-2.db
    volumes:
      - ./data:/data
    networks:
      - memory-network
  
  memory-bank-3:
    build: .
    environment:
      - INSTANCE_ID=3
      - MEMORY_STORAGE_PATH=/data/memory-3.db
    volumes:
      - ./data:/data
    networks:
      - memory-network
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    depends_on:
      - memory-bank-1
      - memory-bank-2
      - memory-bank-3
    networks:
      - memory-network

networks:
  memory-network:
    driver: bridge
```

#### NGINX Load Balancer Configuration

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream memory_backend {
        least_conn;
        server memory-bank-1:8080 max_fails=3 fail_timeout=30s;
        server memory-bank-2:8080 max_fails=3 fail_timeout=30s;
        server memory-bank-3:8080 max_fails=3 fail_timeout=30s;
    }
    
    # Health check endpoint
    upstream memory_health {
        server memory-bank-1:8080;
        server memory-bank-2:8080;
        server memory-bank-3:8080;
    }
    
    # SSL configuration
    ssl_certificate /etc/ssl/memory.crt;
    ssl_certificate_key /etc/ssl/memory.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    
    server {
        listen 80;
        server_name memory.example.com;
        return 301 https://$server_name$request_uri;
    }
    
    server {
        listen 443 ssl http2;
        server_name memory.example.com;
        
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
        
        # Proxy settings
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Health check
        location /health {
            proxy_pass http://memory_health;
            access_log off;
        }
        
        # API endpoints
        location / {
            proxy_pass http://memory_backend;
            proxy_timeout 60s;
            proxy_read_timeout 60s;
            proxy_connect_timeout 60s;
            
            # WebSocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
        
        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";
    }
}
```

### Monitoring and Observability

#### Prometheus Metrics

```yaml
# monitoring/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'memory-bank'
    static_configs:
      - targets: ['memory-bank-1:8080', 'memory-bank-2:8080', 'memory-bank-3:8080']
    metrics_path: /metrics
    scrape_interval: 10s
    
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
```

#### Grafana Dashboard

```json
{
  "dashboard": {
    "title": "SPARC Memory Bank Metrics",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(memory_requests_total[5m])",
            "legendFormat": "{{instance}}"
          }
        ]
      },
      {
        "title": "Cache Hit Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "memory_cache_hit_rate",
            "legendFormat": "Hit Rate"
          }
        ]
      },
      {
        "title": "Storage Size",
        "type": "graph",
        "targets": [
          {
            "expr": "memory_storage_size_bytes",
            "legendFormat": "{{instance}}"
          }
        ]
      }
    ]
  }
}
```

### Backup and Recovery

#### Automated Backup Script

```bash
#!/bin/bash
# backup.sh

set -euo pipefail

# Configuration
BACKUP_DIR="/var/backups/memory-bank"
REPOSITORY="s3:backup-bucket/memory-bank"
RETENTION_DAYS=30
DATA_DIR="/var/lib/memory"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="memory-bank_$TIMESTAMP"

# SQLite backup (if using SQLite)
if [ -f "$DATA_DIR/memory.db" ]; then
    echo "Creating SQLite backup..."
    sqlite3 "$DATA_DIR/memory.db" ".backup $BACKUP_DIR/$BACKUP_NAME.db"
fi

# Compress backup
echo "Compressing backup..."
tar -czf "$BACKUP_DIR/$BACKUP_NAME.tar.gz" -C "$DATA_DIR" .

# Upload to remote storage (using restic)
echo "Uploading backup..."
restic -r "$REPOSITORY" backup "$BACKUP_DIR/$BACKUP_NAME.tar.gz" \
    --tag "memory-bank" \
    --tag "$TIMESTAMP"

# Cleanup old local backups
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete

# Cleanup old remote backups
restic -r "$REPOSITORY" forget \
    --keep-daily 7 \
    --keep-weekly 4 \
    --keep-monthly 6 \
    --tag "memory-bank" \
    --prune

echo "Backup completed: $BACKUP_NAME"
```

#### Recovery Procedure

```bash
#!/bin/bash
# restore.sh

set -euo pipefail

BACKUP_ID="$1"
REPOSITORY="s3:backup-bucket/memory-bank"
DATA_DIR="/var/lib/memory"
TEMP_DIR="/tmp/memory-restore"

if [ -z "$BACKUP_ID" ]; then
    echo "Usage: $0 <backup_id>"
    echo "Available backups:"
    restic -r "$REPOSITORY" snapshots --tag "memory-bank"
    exit 1
fi

# Stop the service
sudo systemctl stop memory-bank

# Create temporary directory
mkdir -p "$TEMP_DIR"

# Restore backup
echo "Restoring backup $BACKUP_ID..."
restic -r "$REPOSITORY" restore "$BACKUP_ID" --target "$TEMP_DIR"

# Extract backup
echo "Extracting backup..."
tar -xzf "$TEMP_DIR"/*.tar.gz -C "$TEMP_DIR"

# Backup current data
if [ -d "$DATA_DIR" ]; then
    echo "Backing up current data..."
    mv "$DATA_DIR" "${DATA_DIR}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Restore data
echo "Restoring data..."
mv "$TEMP_DIR" "$DATA_DIR"

# Fix permissions
chown -R memory-bank:memory-bank "$DATA_DIR"
chmod -R 750 "$DATA_DIR"

# Start the service
sudo systemctl start memory-bank

# Verify restoration
echo "Verifying restoration..."
sudo systemctl status memory-bank

echo "Restoration completed successfully"
```

### Security Considerations

#### SSL/TLS Configuration

```bash
# Generate SSL certificates
openssl req -new -newkey rsa:4096 -days 365 -nodes -x509 \
    -subj "/C=US/ST=CA/L=SF/O=SPARC/CN=memory.example.com" \
    -keyout memory.key \
    -out memory.crt

# Set proper permissions
chmod 600 memory.key
chmod 644 memory.crt
```

#### Firewall Configuration

```bash
# UFW firewall rules
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow from 10.0.0.0/8 to any port 8080  # Internal API access
sudo ufw enable
```

#### Environment Secrets

```bash
# Use HashiCorp Vault for secrets management
vault kv put secret/memory-bank \
    openai_api_key="sk-..." \
    encryption_key="base64_encoded_key" \
    db_password="secure_password"

# Retrieve secrets in deployment
export OPENAI_API_KEY=$(vault kv get -field=openai_api_key secret/memory-bank)
export ENCRYPTION_KEY=$(vault kv get -field=encryption_key secret/memory-bank)
```

### Performance Tuning

#### Operating System Optimization

```bash
# /etc/sysctl.conf
# Network optimization
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 65536 134217728
net.ipv4.tcp_wmem = 4096 65536 134217728
net.ipv4.tcp_congestion_control = bbr

# File system optimization
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288

# Memory optimization
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# Apply changes
sudo sysctl -p
```

#### Storage Optimization

```bash
# Mount options for database storage
# /etc/fstab
/dev/nvme0n1 /var/lib/memory ext4 noatime,data=writeback,barrier=0 0 2

# Set I/O scheduler for NVMe
echo none > /sys/block/nvme0n1/queue/scheduler
```

### Troubleshooting

#### Common Issues

```bash
# Check service status
sudo systemctl status memory-bank

# View logs
sudo journalctl -u memory-bank -f

# Check disk space
df -h /var/lib/memory

# Check memory usage
free -h

# Check database integrity (SQLite)
sqlite3 /var/lib/memory/memory.db "PRAGMA integrity_check;"

# Check open file descriptors
lsof -p $(pgrep memory-bank)

# Monitor real-time performance
top -p $(pgrep memory-bank)
iotop -p $(pgrep memory-bank)
```

#### Performance Debugging

```typescript
// Enable debug logging
const memory = new MemoryManager({
  // ... other config
  system: {
    logging: {
      level: 'debug',
      enableQueryProfiling: true,
      enableSlowQueryLog: true,
      slowQueryThreshold: 1000 // ms
    }
  }
});

// Monitor performance metrics
setInterval(async () => {
  const stats = await memory.getStatistics();
  console.log('Performance Stats:', {
    averageQueryTime: stats.performance.averageQueryTime,
    cacheHitRate: stats.cacheStats.hitRate,
    totalItems: stats.totalItems
  });
}, 60000); // Every minute
```