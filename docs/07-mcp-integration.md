# MCP Integration Guide for External Tools

Model Context Protocol (MCP) integration enables Gemini-Flow to seamlessly connect with external tools, services, and systems, dramatically expanding its capabilities. This comprehensive guide covers MCP server setup, tool integration, security, and advanced usage patterns.

## MCP Server Configuration

### Basic MCP Setup

**Initialize MCP Configuration:**
```bash
# Initialize MCP with default settings
claude-flow mcp init

# Initialize with custom configuration
claude-flow mcp init --config custom-mcp-config.json

# Start MCP server
claude-flow mcp start --transport stdio --port 3000

# Start with advanced options
claude-flow mcp start \
  --transport http \
  --port 3000 \
  --tls-enabled \
  --auth-required \
  --log-level debug
```

**Check MCP Server Status:**
```bash
# Basic status check
claude-flow mcp status

# Detailed status with metrics
claude-flow mcp status --detailed --metrics

# Health check with diagnostics
claude-flow mcp health-check --comprehensive
```

### MCP Configuration File

**Complete MCP Configuration (mcp-config.json):**
```json
{
  "server": {
    "transport": "stdio",
    "port": 3000,
    "host": "localhost",
    "tlsEnabled": false,
    "maxConnections": 100,
    "requestTimeout": 30000,
    "maxRequestSize": "10MB",
    "compression": {
      "enabled": true,
      "algorithm": "gzip",
      "threshold": "1KB"
    }
  },
  "security": {
    "authentication": {
      "enabled": true,
      "method": "token",
      "tokenValidation": "strict",
      "tokenExpiry": "24h",
      "refreshTokens": true
    },
    "authorization": {
      "enabled": true,
      "defaultPolicy": "deny",
      "policies": [
        {
          "name": "agent-access",
          "resources": ["tools/*", "files/read", "files/write"],
          "principals": ["agent:*"],
          "actions": ["read", "write", "execute"],
          "conditions": {
            "time": "business-hours",
            "rate-limit": "100/hour"
          }
        },
        {
          "name": "admin-access",
          "resources": ["*"],
          "principals": ["role:admin"],
          "actions": ["*"]
        }
      ]
    },
    "encryption": {
      "enabled": false,
      "algorithm": "AES-256-GCM",
      "keyRotationInterval": "24h",
      "keyStorage": "environment"
    },
    "rateLimit": {
      "enabled": true,
      "requestsPerMinute": 100,
      "burstSize": 20,
      "keyBy": "client-id"
    }
  },
  "tools": {
    "registry": {
      "autoDiscover": true,
      "discoveryPaths": ["./tools", "./plugins", "./custom-tools"],
      "remoteRegistries": [
        {
          "name": "official-tools",
          "url": "https://registry.claude-flow.dev/tools",
          "authToken": "${MCP_REGISTRY_TOKEN}"
        }
      ],
      "cacheEnabled": true,
      "cacheTTL": "1h"
    },
    "validation": {
      "enabled": true,
      "strictMode": false,
      "schemaValidation": true,
      "sandboxing": true
    },
    "execution": {
      "timeout": "5m",
      "retries": 3,
      "parallelLimit": 10,
      "resourceLimits": {
        "memory": "512MB",
        "cpu": "1000m",
        "diskIO": "100MB/s"
      }
    }
  },
  "monitoring": {
    "metrics": {
      "enabled": true,
      "endpoint": "/metrics",
      "format": "prometheus"
    },
    "logging": {
      "level": "info",
      "format": "json",
      "audit": true,
      "auditLevel": "all",
      "destination": "file",
      "file": "logs/mcp-server.log"
    },
    "tracing": {
      "enabled": true,
      "sampler": "probabilistic",
      "samplerParam": 0.1,
      "endpoint": "http://jaeger:14268/api/traces"
    }
  }
}
```

### Transport Configuration

**STDIO Transport (Default):**
```json
{
  "transport": {
    "type": "stdio",
    "bufferSize": "64KB",
    "encoding": "utf-8",
    "heartbeat": {
      "enabled": true,
      "interval": "30s"
    }
  }
}
```

**HTTP Transport:**
```json
{
  "transport": {
    "type": "http",
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "enabled": true,
      "origins": ["http://localhost:3000", "https://app.company.com"],
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "allowCredentials": true
    },
    "middleware": ["auth", "rate-limit", "logging"]
  }
}
```

**WebSocket Transport:**
```json
{
  "transport": {
    "type": "websocket",
    "port": 3001,
    "path": "/mcp-ws",
    "pingInterval": "30s",
    "pongTimeout": "5s",
    "maxMessageSize": "10MB"
  }
}
```

## Built-in Tools

### File System Tools

**File Operations:**
```bash
# Read file content
claude-flow mcp invoke filesystem read_file \
  --path "/project/src/main.py" \
  --encoding "utf-8"

# Write file content
claude-flow mcp invoke filesystem write_file \
  --path "/project/output/results.txt" \
  --content "Analysis results: Performance improved by 25%" \
  --create-dirs true

# List directory contents
claude-flow mcp invoke filesystem list_directory \
  --path "/project/src" \
  --recursive true \
  --filter "*.py,*.js"

# Copy files
claude-flow mcp invoke filesystem copy_file \
  --source "/project/templates/config.yaml" \
  --destination "/project/config/app-config.yaml"
```

**File Search and Analysis:**
```bash
# Search for files by pattern
claude-flow mcp invoke filesystem search_files \
  --pattern "*.py" \
  --directory "/project" \
  --exclude "node_modules,__pycache__"

# Grep text in files
claude-flow mcp invoke filesystem grep \
  --pattern "function.*main" \
  --files "*.py" \
  --directory "/project/src" \
  --context-lines 3

# File statistics
claude-flow mcp invoke filesystem file_stats \
  --path "/project" \
  --recursive true \
  --include-hidden false
```

### Web Tools

**Web Scraping and Data Extraction:**
```bash
# Simple web scraping
claude-flow mcp invoke web scrape_url \
  --url "https://example.com/api/docs" \
  --format "markdown" \
  --extract-links true

# Advanced scraping with selectors
claude-flow mcp invoke web scrape_advanced \
  --url "https://news.ycombinator.com" \
  --selectors '{"titles": ".titleline > a", "scores": ".score"}' \
  --output-format "json"

# Download web content
claude-flow mcp invoke web download_file \
  --url "https://example.com/data.csv" \
  --output "/project/data/external-data.csv" \
  --verify-ssl true
```

**API Interactions:**
```bash
# REST API calls
claude-flow mcp invoke web api_request \
  --method "POST" \
  --url "https://api.example.com/v1/data" \
  --headers '{"Authorization": "Bearer ${API_TOKEN}", "Content-Type": "application/json"}' \
  --body '{"query": "performance metrics", "timeframe": "7d"}' \
  --timeout 30

# GraphQL queries
claude-flow mcp invoke web graphql_query \
  --endpoint "https://api.github.com/graphql" \
  --query "query { viewer { login repositories(first: 10) { nodes { name } } } }" \
  --headers '{"Authorization": "Bearer ${GITHUB_TOKEN}"}'

# Webhook setup
claude-flow mcp invoke web setup_webhook \
  --url "https://api.service.com/webhooks" \
  --events "push,pull_request" \
  --callback-url "https://ourapp.com/webhook-handler"
```

### Development Tools

**Git Operations:**
```bash
# Repository status
claude-flow mcp invoke git status \
  --repository "/project" \
  --porcelain false

# Commit changes
claude-flow mcp invoke git commit \
  --repository "/project" \
  --message "feat: implement user authentication with JWT tokens" \
  --add-all true \
  --sign true

# Branch operations
claude-flow mcp invoke git branch \
  --repository "/project" \
  --action "create" \
  --branch-name "feature/user-dashboard" \
  --from "main"

# Push to remote
claude-flow mcp invoke git push \
  --repository "/project" \
  --remote "origin" \
  --branch "feature/user-dashboard" \
  --set-upstream true
```

**Code Analysis:**
```bash
# Static code analysis
claude-flow mcp invoke code analyze \
  --path "/project/src" \
  --language "python" \
  --rules "pep8,security,complexity" \
  --output-format "json"

# Code formatting
claude-flow mcp invoke code format \
  --path "/project/src" \
  --formatter "black" \
  --config ".black.toml" \
  --check-only false

# Dependency analysis
claude-flow mcp invoke code dependencies \
  --path "/project" \
  --package-manager "npm" \
  --check-vulnerabilities true \
  --update-available true
```

**Testing Tools:**
```bash
# Run test suites
claude-flow mcp invoke test run \
  --framework "pytest" \
  --path "/project/tests" \
  --coverage true \
  --parallel true \
  --output "test-results.xml"

# Test coverage analysis
claude-flow mcp invoke test coverage \
  --source-dir "/project/src" \
  --test-dir "/project/tests" \
  --format "html" \
  --output "/project/coverage-report"

# Load testing
claude-flow mcp invoke test load \
  --target "http://localhost:8000/api" \
  --users 100 \
  --duration "5m" \
  --ramp-up "30s"
```

## Custom Tool Development

### Tool Schema Definition

**Basic Tool Schema:**
```json
{
  "name": "database-query",
  "version": "1.2.0",
  "description": "Execute database queries and return structured results",
  "author": "Engineering Team",
  "category": "database",
  "schema": {
    "type": "object",
    "properties": {
      "connection": {
        "type": "string",
        "description": "Database connection string or alias",
        "examples": ["postgresql://user:pass@localhost/db", "production-db"]
      },
      "query": {
        "type": "string",
        "description": "SQL query to execute",
        "minLength": 1,
        "maxLength": 10000
      },
      "parameters": {
        "type": "object",
        "description": "Query parameters for parameterized queries",
        "additionalProperties": true
      },
      "timeout": {
        "type": "number",
        "description": "Query timeout in seconds",
        "default": 30,
        "minimum": 1,
        "maximum": 300
      },
      "read_only": {
        "type": "boolean",
        "description": "Enforce read-only mode",
        "default": true
      }
    },
    "required": ["connection", "query"],
    "additionalProperties": false
  },
  "output": {
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean",
        "description": "Whether the query executed successfully"
      },
      "rows": {
        "type": "array",
        "description": "Query results as array of objects"
      },
      "rowCount": {
        "type": "number",
        "description": "Number of rows returned"
      },
      "executionTime": {
        "type": "number",
        "description": "Query execution time in milliseconds"
      },
      "columns": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Column names"
      }
    }
  },
  "security": {
    "sandbox": true,
    "allowedConnections": ["production-readonly", "staging", "development"],
    "blockedQueries": ["DROP.*", "DELETE.*", "UPDATE.*", "INSERT.*"],
    "auditLog": true
  }
}
```

### Tool Implementation Examples

**Python Tool Implementation:**
```python
#!/usr/bin/env python3
"""
Database Query Tool for Gemini-Flow MCP
Executes database queries with security and performance monitoring
"""

import json
import sys
import time
import psycopg2
import psycopg2.extras
from typing import Dict, Any, List
import logging
import re

class DatabaseQueryTool:
    def __init__(self):
        self.name = "database-query"
        self.version = "1.2.0"
        self.logger = logging.getLogger(__name__)
        
        # Security: Define allowed connection aliases
        self.allowed_connections = {
            "production-readonly": "postgresql://readonly:${RO_PASS}@prod-db:5432/app",
            "staging": "postgresql://user:${STAGING_PASS}@staging-db:5432/app",
            "development": "postgresql://dev:${DEV_PASS}@localhost:5432/app_dev"
        }
        
        # Security: Define blocked query patterns
        self.blocked_patterns = [
            r"DROP\s+",
            r"DELETE\s+",
            r"UPDATE\s+",
            r"INSERT\s+",
            r"TRUNCATE\s+",
            r"ALTER\s+",
            r"CREATE\s+",
            r"GRANT\s+",
            r"REVOKE\s+"
        ]
    
    def validate_query(self, query: str, read_only: bool = True) -> bool:
        """Validate query for security compliance"""
        if read_only:
            for pattern in self.blocked_patterns:
                if re.search(pattern, query, re.IGNORECASE):
                    raise ValueError(f"Query contains blocked pattern: {pattern}")
        return True
    
    def get_connection_string(self, connection: str) -> str:
        """Get connection string from alias or validate direct connection"""
        if connection in self.allowed_connections:
            return self.allowed_connections[connection]
        
        # For direct connection strings, validate format
        if connection.startswith(('postgresql://', 'postgres://')):
            return connection
        
        raise ValueError(f"Invalid connection: {connection}")
    
    def execute_query(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Execute database query with security and performance monitoring"""
        try:
            # Extract and validate parameters
            connection_alias = params["connection"]
            query = params["query"]
            query_params = params.get("parameters", {})
            timeout = params.get("timeout", 30)
            read_only = params.get("read_only", True)
            
            # Security validation
            self.validate_query(query, read_only)
            connection_string = self.get_connection_string(connection_alias)
            
            # Performance monitoring
            start_time = time.time()
            
            # Execute query
            with psycopg2.connect(
                connection_string,
                cursor_factory=psycopg2.extras.RealDictCursor,
                connect_timeout=timeout
            ) as conn:
                if read_only:
                    conn.set_session(readonly=True)
                
                with conn.cursor() as cursor:
                    cursor.execute(query, query_params)
                    
                    if cursor.description:
                        # SELECT query - fetch results
                        rows = cursor.fetchall()
                        columns = [desc[0] for desc in cursor.description]
                        result_rows = [dict(row) for row in rows]
                        row_count = len(result_rows)
                    else:
                        # Non-SELECT query
                        result_rows = []
                        columns = []
                        row_count = cursor.rowcount
            
            execution_time = (time.time() - start_time) * 1000
            
            result = {
                "success": True,
                "rows": result_rows,
                "rowCount": row_count,
                "executionTime": round(execution_time, 2),
                "columns": columns,
                "metadata": {
                    "connection": connection_alias,
                    "queryHash": hash(query),
                    "timestamp": time.time()
                }
            }
            
            # Audit logging
            self.logger.info(f"Query executed successfully", extra={
                "connection": connection_alias,
                "rowCount": row_count,
                "executionTime": execution_time,
                "queryHash": hash(query)
            })
            
            return result
            
        except psycopg2.Error as e:
            error_result = {
                "success": False,
                "error": str(e),
                "errorCode": e.pgcode if hasattr(e, 'pgcode') else None,
                "rows": [],
                "rowCount": 0,
                "executionTime": 0
            }
            
            self.logger.error(f"Database error: {e}", extra={
                "connection": connection_alias,
                "error": str(e)
            })
            
            return error_result
            
        except Exception as e:
            error_result = {
                "success": False,
                "error": str(e),
                "rows": [],
                "rowCount": 0,
                "executionTime": 0
            }
            
            self.logger.error(f"Tool error: {e}")
            return error_result

def main():
    """Main entry point for MCP tool"""
    tool = DatabaseQueryTool()
    
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        # Execute tool
        result = tool.execute_query(input_data)
        
        # Output result
        print(json.dumps(result, indent=2))
        
    except json.JSONDecodeError as e:
        error_output = {
            "success": False,
            "error": f"Invalid JSON input: {e}",
            "rows": [],
            "rowCount": 0
        }
        print(json.dumps(error_output))
        sys.exit(1)
        
    except Exception as e:
        error_output = {
            "success": False,
            "error": f"Tool execution failed: {e}",
            "rows": [],
            "rowCount": 0
        }
        print(json.dumps(error_output))
        sys.exit(1)

if __name__ == "__main__":
    main()
```

**Node.js Tool Implementation:**
```javascript
#!/usr/bin/env node
/**
 * API Testing Tool for Gemini-Flow MCP
 * Performs comprehensive API testing with performance metrics
 */

const axios = require('axios');
const { performance } = require('perf_hooks');

class APITestingTool {
    constructor() {
        this.name = 'api-testing';
        this.version = '1.0.0';
    }

    async executeTest(params) {
        try {
            const {
                url,
                method = 'GET',
                headers = {},
                body = null,
                timeout = 30000,
                followRedirects = true,
                validateSSL = true,
                expectedStatus = [200],
                assertions = []
            } = params;

            const startTime = performance.now();

            // Configure axios
            const config = {
                method,
                url,
                headers,
                data: body,
                timeout,
                maxRedirects: followRedirects ? 5 : 0,
                validateStatus: () => true, // Don't throw on any status
                httpsAgent: validateSSL ? undefined : new (require('https').Agent)({
                    rejectUnauthorized: false
                })
            };

            // Execute request
            const response = await axios(config);
            const endTime = performance.now();
            const responseTime = Math.round(endTime - startTime);

            // Validate response
            const validations = this.validateResponse(response, {
                expectedStatus,
                assertions
            });

            const result = {
                success: validations.success,
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    data: response.data,
                    size: JSON.stringify(response.data).length
                },
                performance: {
                    responseTime,
                    timestamp: new Date().toISOString()
                },
                validations,
                metadata: {
                    url,
                    method,
                    userAgent: headers['User-Agent'] || 'Gemini-Flow-MCP/1.0'
                }
            };

            return result;

        } catch (error) {
            return {
                success: false,
                error: error.message,
                errorCode: error.code,
                response: null,
                performance: {
                    responseTime: 0,
                    timestamp: new Date().toISOString()
                }
            };
        }
    }

    validateResponse(response, criteria) {
        const validations = {
            success: true,
            checks: [],
            failures: []
        };

        // Status code validation
        if (criteria.expectedStatus && !criteria.expectedStatus.includes(response.status)) {
            validations.failures.push({
                type: 'status',
                expected: criteria.expectedStatus,
                actual: response.status
            });
            validations.success = false;
        } else {
            validations.checks.push({
                type: 'status',
                result: 'pass'
            });
        }

        // Custom assertions
        if (criteria.assertions) {
            for (const assertion of criteria.assertions) {
                try {
                    const result = this.evaluateAssertion(response, assertion);
                    if (result.success) {
                        validations.checks.push({
                            type: 'assertion',
                            description: assertion.description,
                            result: 'pass'
                        });
                    } else {
                        validations.failures.push({
                            type: 'assertion',
                            description: assertion.description,
                            expected: assertion.expected,
                            actual: result.actual
                        });
                        validations.success = false;
                    }
                } catch (error) {
                    validations.failures.push({
                        type: 'assertion',
                        description: assertion.description,
                        error: error.message
                    });
                    validations.success = false;
                }
            }
        }

        return validations;
    }

    evaluateAssertion(response, assertion) {
        const { path, operator, expected } = assertion;
        
        // Extract value from response using path
        const actual = this.getValueByPath(response.data, path);
        
        // Evaluate assertion
        switch (operator) {
            case 'equals':
                return { success: actual === expected, actual };
            case 'contains':
                return { success: JSON.stringify(actual).includes(expected), actual };
            case 'length':
                return { success: Array.isArray(actual) && actual.length === expected, actual: actual?.length };
            case 'exists':
                return { success: actual !== undefined, actual };
            default:
                throw new Error(`Unknown assertion operator: ${operator}`);
        }
    }

    getValueByPath(obj, path) {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }
}

async function main() {
    const tool = new APITestingTool();
    
    try {
        // Read input from stdin
        const input = await new Promise((resolve, reject) => {
            let data = '';
            process.stdin.on('data', chunk => data += chunk);
            process.stdin.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });

        // Execute tool
        const result = await tool.executeTest(input);
        
        // Output result
        console.log(JSON.stringify(result, null, 2));
        
    } catch (error) {
        const errorOutput = {
            success: false,
            error: error.message,
            response: null
        };
        console.log(JSON.stringify(errorOutput, null, 2));
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
```

### Tool Registration

**Register Custom Tools:**
```bash
# Register Python tool
claude-flow mcp tools register \
  --name "database-query" \
  --executable "/tools/database-query.py" \
  --schema "database-query-schema.json" \
  --category "database" \
  --version "1.2.0"

# Register Node.js tool
claude-flow mcp tools register \
  --name "api-testing" \
  --executable "/tools/api-testing.js" \
  --schema "api-testing-schema.json" \
  --category "testing" \
  --permissions "network-access"

# Register tool with dependencies
claude-flow mcp tools register \
  --name "ml-analysis" \
  --executable "/tools/ml-analysis.py" \
  --schema "ml-analysis-schema.json" \
  --dependencies "requirements.txt" \
  --install-deps true
```

**Tool Testing:**
```bash
# Test tool functionality
claude-flow mcp tools test database-query \
  --input "test-inputs/db-query-test.json" \
  --validate-output true

# Performance testing
claude-flow mcp tools benchmark api-testing \
  --iterations 100 \
  --concurrent 10 \
  --report "performance-report.json"

# Integration testing
claude-flow mcp tools integration-test \
  --suite "database-tools" \
  --environment "staging"
```

## Remote Tool Integration

### Tool Registry Management

**Registry Configuration:**
```bash
# Add remote tool registry
claude-flow mcp registry add \
  --name "company-tools" \
  --url "https://tools.company.com/registry" \
  --auth-token "${COMPANY_TOOLS_TOKEN}" \
  --verify-ssl true

# Browse available tools
claude-flow mcp registry browse \
  --registry "company-tools" \
  --category "development" \
  --search "kubernetes"

# Install tools from registry
claude-flow mcp registry install \
  --registry "company-tools" \
  --tool "k8s-manager" \
  --version "2.1.0" \
  --auto-update true
```

**Registry Tool Manifest:**
```json
{
  "registry": "company-tools",
  "tools": [
    {
      "name": "k8s-manager",
      "version": "2.1.0",
      "description": "Kubernetes cluster management tool",
      "category": "infrastructure",
      "author": "DevOps Team",
      "license": "MIT",
      "tags": ["kubernetes", "infrastructure", "deployment"],
      "requirements": {
        "os": ["linux", "darwin"],
        "arch": ["amd64", "arm64"],
        "dependencies": ["kubectl", "helm"]
      },
      "installation": {
        "type": "binary",
        "downloadUrl": "https://tools.company.com/releases/k8s-manager-v2.1.0",
        "checksum": "sha256:abc123...",
        "postInstall": ["chmod +x k8s-manager", "./k8s-manager --verify"]
      },
      "configuration": {
        "schema": "k8s-manager-schema.json",
        "defaults": "k8s-manager-defaults.json"
      }
    }
  ]
}
```

### Tool Proxying and Federation

**API Gateway Integration:**
```bash
# Set up tool proxy for internal APIs
claude-flow mcp proxy create \
  --name "internal-api-gateway" \
  --target "https://api.internal.company.com" \
  --auth "oauth2" \
  --tools "user-management,billing,analytics,reporting" \
  --rate-limit "1000/hour"

# Use proxied tools
claude-flow mcp invoke internal-api-gateway:user-management get_user \
  --user_id 12345 \
  --include_profile true

claude-flow mcp invoke internal-api-gateway:billing get_usage \
  --account_id 67890 \
  --period "2024-12"
```

**Tool Federation Setup:**
```json
{
  "federation": {
    "enabled": true,
    "clusters": [
      {
        "name": "development-cluster",
        "endpoint": "https://dev-mcp.company.com:3000",
        "auth": "mutual-tls",
        "tools": ["dev-*", "test-*"],
        "priority": 1
      },
      {
        "name": "production-cluster", 
        "endpoint": "https://prod-mcp.company.com:3000",
        "auth": "mutual-tls",
        "tools": ["prod-*", "monitoring-*"],
        "priority": 2
      }
    ],
    "routing": {
      "strategy": "tool-prefix",
      "fallback": "local",
      "cache": true
    }
  }
}
```

## Security and Access Control

### Authentication and Authorization

**Token-Based Authentication:**
```bash
# Generate MCP access token for agent
claude-flow mcp auth generate-token \
  --agent-id <agent-id> \
  --permissions "tools:read,tools:execute,files:read" \
  --expiry "24h" \
  --scope "project:web-app"

# Revoke access token
claude-flow mcp auth revoke-token \
  --token-id <token-id> \
  --reason "security-rotation"

# List active tokens with details
claude-flow mcp auth list-tokens \
  --agent-id <agent-id> \
  --include-permissions true \
  --format "table"
```

**Role-Based Access Control:**
```json
{
  "rbac": {
    "roles": [
      {
        "name": "developer",
        "permissions": [
          "tools:execute:development-*",
          "tools:execute:testing-*",
          "files:read:/project/src/*",
          "files:write:/project/src/*"
        ],
        "restrictions": {
          "timeOfDay": "06:00-22:00",
          "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"],
          "ipRanges": ["10.0.0.0/8", "192.168.0.0/16"]
        }
      },
      {
        "name": "admin",
        "permissions": ["*"],
        "restrictions": {
          "requireMFA": true,
          "sessionTimeout": "4h"
        }
      }
    ],
    "assignments": [
      {
        "principal": "agent:developer-bot",
        "role": "developer",
        "conditions": {
          "project": "web-application"
        }
      }
    ]
  }
}
```

### Tool Permissions and Sandboxing

**Tool Permission Configuration:**
```bash
# Grant specific tool permissions
claude-flow mcp permissions grant \
  --agent-id <agent-id> \
  --tool "filesystem" \
  --actions "read,write" \
  --resources "/project/*,/tmp/*" \
  --exclude "/project/secrets/*"

# Check agent permissions
claude-flow mcp permissions check \
  --agent-id <agent-id> \
  --tool "web" \
  --action "api_request" \
  --resource "https://api.external.com"

# Audit tool usage
claude-flow mcp audit \
  --agent-id <agent-id> \
  --time-range "24h" \
  --tools "filesystem,web" \
  --format "detailed"
```

**Sandboxing Configuration:**
```json
{
  "sandbox": {
    "enabled": true,
    "type": "container",
    "settings": {
      "networkAccess": "restricted",
      "allowedDomains": ["*.company.com", "api.github.com"],
      "fileSystemAccess": "restricted",
      "allowedPaths": ["/project", "/tmp", "/usr/local/bin"],
      "resourceLimits": {
        "memory": "512MB",
        "cpu": "0.5",
        "diskIO": "100MB/s",
        "networkIO": "10MB/s"
      },
      "timeouts": {
        "execution": "5m",
        "idle": "30s"
      }
    }
  }
}
```

## Advanced MCP Features

### Tool Chaining and Workflows

**Tool Chain Definition:**
```bash
# Create tool chain
claude-flow mcp chain create "data-processing-pipeline" \
  --steps "web:fetch_data,filesystem:save_file,database-query:insert_data,api-testing:validate_api" \
  --config "data-pipeline-config.json"

# Execute tool chain
claude-flow mcp chain execute "data-processing-pipeline" \
  --input "chain-input.json" \
  --output "chain-output.json" \
  --monitor true
```

**Tool Chain Configuration:**
```json
{
  "name": "data-processing-pipeline",
  "description": "ETL pipeline for processing external data",
  "steps": [
    {
      "id": "fetch-data",
      "tool": "web",
      "action": "api_request",
      "config": {
        "url": "${input.data_source_url}",
        "method": "GET",
        "headers": {
          "Authorization": "Bearer ${secrets.api_token}"
        }
      },
      "output": "raw_data"
    },
    {
      "id": "transform-data",
      "tool": "data-processor",
      "action": "transform",
      "config": {
        "input": "${steps.fetch-data.output}",
        "transformation": "normalize_schema",
        "schema": "target-schema.json"
      },
      "output": "transformed_data"
    },
    {
      "id": "save-data",
      "tool": "database-query",
      "action": "insert",
      "config": {
        "connection": "staging-db",
        "table": "processed_data",
        "data": "${steps.transform-data.output}"
      },
      "output": "insert_results"
    },
    {
      "id": "validate-results",
      "tool": "api-testing",
      "action": "test_endpoint",
      "config": {
        "url": "http://localhost:8000/api/data/latest",
        "assertions": [
          {
            "path": "count",
            "operator": "greater_than",
            "expected": 0
          }
        ]
      }
    }
  ],
  "error_handling": {
    "strategy": "stop_on_error",
    "cleanup": ["delete_temp_files", "rollback_db_changes"]
  }
}
```

### Batch Operations and Parallel Execution

**Batch Tool Execution:**
```bash
# Execute multiple tools in parallel
claude-flow mcp batch execute \
  --tools "filesystem:read_file,web:api_request,database-query:select" \
  --inputs "batch-inputs.json" \
  --parallel 5 \
  --timeout 60s \
  --output "batch-results.json"

# Batch file processing
claude-flow mcp batch filesystem process_files \
  --pattern "/project/data/*.csv" \
  --action "validate_csv" \
  --parallel 10 \
  --progress true
```

**Batch Input Configuration:**
```json
{
  "batch_operations": [
    {
      "tool": "filesystem",
      "action": "read_file",
      "params": {
        "path": "/project/config/app.json"
      },
      "id": "read-config"
    },
    {
      "tool": "web",
      "action": "api_request",
      "params": {
        "url": "https://api.service.com/status",
        "method": "GET"
      },
      "id": "check-api-status"
    },
    {
      "tool": "database-query",
      "action": "execute",
      "params": {
        "connection": "production-readonly",
        "query": "SELECT COUNT(*) FROM users WHERE last_login > NOW() - INTERVAL '1 day'"
      },
      "id": "active-users-count"
    }
  ]
}
```

### Tool Monitoring and Analytics

**Performance Monitoring:**
```bash
# Monitor tool performance
claude-flow mcp monitor \
  --tools "database-query,api-testing" \
  --metrics "latency,success_rate,error_count,resource_usage" \
  --real-time true \
  --dashboard true

# Set up performance alerts
claude-flow mcp alerts create \
  --tool "database-query" \
  --condition "avg_latency > 5s OR error_rate > 5%" \
  --action "notify-ops-team" \
  --severity "warning"

# Generate performance reports
claude-flow mcp report performance \
  --time-range "7d" \
  --tools "all" \
  --format "pdf" \
  --output "tool-performance-report.pdf"
```

**Usage Analytics:**
```bash
# Tool usage statistics
claude-flow mcp analytics usage \
  --time-range "30d" \
  --group-by "tool,agent,hour-of-day" \
  --export "usage-analytics.json"

# Cost analysis
claude-flow mcp analytics cost \
  --tools "external-api-*" \
  --billing-period "monthly" \
  --cost-model "api-calls.json"

# Optimization recommendations
claude-flow mcp analytics optimize \
  --focus "performance,cost,reliability" \
  --recommendations true \
  --auto-tune false
```

This comprehensive MCP integration guide provides all the tools and patterns needed to extend Gemini-Flow with powerful external capabilities while maintaining security and performance standards.