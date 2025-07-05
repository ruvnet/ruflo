# Claude Flow Migration Test Suite

Comprehensive test suite for validating the Claude Flow migration from Deno to pure Node.js/npm.

## Test Categories

### 1. Local Execution Tests (`local/`)
Tests that Claude Flow works correctly with pure Node.js without any Deno dependencies.

**Coverage:**
- CLI executable without Deno
- All commands function properly
- Generated files contain no Deno references
- Cross-platform script execution
- Environment variable handling

### 2. Remote NPX Tests (`remote/`)
Validates that `npx claude-flow@latest` works correctly.

**Coverage:**
- NPX execution without installation
- Cross-platform NPX compatibility
- NPX with specific versions
- NPX caching behavior
- Global vs local precedence

### 3. Docker Tests (`docker/`)
Tests containerized execution and deployment.

**Coverage:**
- Docker image builds correctly
- Container runs all commands
- Volume mounting works
- Environment variables pass through
- Multi-stage build optimization
- Health checks function

### 4. Integration Tests (`integration/`)
Tests integration with external systems and services.

**Coverage:**
- ruv-swarm MCP integration
- GitHub API functionality
- Cross-platform compatibility
- Swarm coordination
- Memory persistence
- Task management
- Error handling

### 5. Performance Tests (`performance/`)
Validates performance meets or exceeds requirements.

**Coverage:**
- Command execution times
- Memory usage
- Concurrent operations
- Large data handling
- Performance benchmarks

## Running Tests

### Run All Tests
```bash
./test/migration/run-all-tests.sh
```

### Run Individual Test Categories
```bash
# Local execution tests
node test/migration/local/test-local-execution.js

# Remote NPX tests
node test/migration/remote/test-remote-npx.js

# Docker tests (requires Docker)
node test/migration/docker/test-docker-execution.js

# Integration tests
node test/migration/integration/test-integration.js

# Performance tests
node test/migration/performance/test-performance.js
```

### CI/CD Integration
Tests are automatically run on:
- Push to main or claude-flow-v2.0.0 branches
- Pull requests
- Manual workflow dispatch

See `.github/workflows/migration-tests.yml` for CI configuration.

## Test Results

Each test generates a JSON results file:
- `local/local-test-results.json`
- `remote/remote-npx-test-results.json`
- `docker/docker-test-results.json`
- `integration/integration-test-results.json`
- `performance/performance-test-results.json`

## Docker Setup

### Building the Docker Image
```bash
docker build -t claude-flow:latest -f Docker/Dockerfile .
```

### Running with Docker Compose
```bash
docker-compose up -d
```

### Testing in Docker
```bash
docker run --rm claude-flow:latest --help
docker run --rm claude-flow:latest init -y
```

## Performance Thresholds

| Operation | Threshold | Description |
|-----------|-----------|-------------|
| init | 5000ms | Project initialization |
| help | 500ms | Help command display |
| config | 1000ms | Configuration operations |
| swarmInit | 3000ms | Swarm initialization |
| agentSpawn | 2000ms | Agent spawning |
| memory | 500ms | Memory operations |
| task | 1000ms | Task operations |
| mcp | 5000ms | MCP server startup |

## Troubleshooting

### Docker Tests Failing
- Ensure Docker daemon is running
- Check Docker permissions
- Verify port availability

### NPX Tests Failing
- Clear npm cache: `npm cache clean --force`
- Check npm registry connectivity
- Ensure package.json is valid

### Performance Tests Failing
- Close other applications
- Check system resources
- Run tests individually

## Contributing

When adding new tests:
1. Follow the existing test structure
2. Use consistent error handling
3. Generate JSON results
4. Update this README
5. Add to CI workflow if needed