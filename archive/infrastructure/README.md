# Infrastructure

This directory contains all infrastructure-related configurations and tools for Claude Flow.

## Structure

- **docker/**: Docker-related configurations and testing infrastructure
  - `Dockerfile`: Main Docker image for Claude Flow
  - `docker-compose.yml`: Docker Compose configuration for the entire stack
  - **testing/**: Docker-based testing environment
    - Test-specific Docker configurations
    - Scripts for running tests in containerized environments
    - Performance monitoring tools
    - Test results and logs

## Usage

### Running with Docker Compose

```bash
cd infrastructure/docker
docker-compose up -d
```

### Running Tests

```bash
cd infrastructure/docker/testing
./scripts/run-all-tests.sh
```

For more detailed information, see the README files in each subdirectory.