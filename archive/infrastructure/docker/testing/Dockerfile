# Multi-stage Dockerfile for claude-code-flow testing
# Optimized for both development and production environments

# =================== BASE STAGE ===================
FROM node:20-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    py3-pip \
    make \
    g++ \
    sqlite \
    bash \
    curl \
    deno \
    npm \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./

# =================== DEPENDENCIES STAGE ===================
FROM base AS dependencies

# Install production dependencies
RUN npm ci --only=production && npm cache clean --force

# Install development dependencies in separate layer
RUN npm ci --include=dev

# =================== DEVELOPMENT STAGE ===================
FROM base AS development

# Copy dependencies from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy source code
COPY . .

# Create necessary directories
RUN mkdir -p \
    /app/dist \
    /app/bin \
    /app/logs \
    /app/test-results \
    /app/coverage \
    /app/docker-test/volumes/claude-flow \
    /app/docker-test/volumes/ruv-swarm \
    /app/docker-test/volumes/shared

# Build the application
RUN npm run build

# Set environment variables
ENV NODE_ENV=development
ENV DEBUG=claude-flow:*

# Expose ports for development
EXPOSE 3000 3001 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Default command for development
CMD ["npm", "run", "dev"]

# =================== TESTING STAGE ===================
FROM development AS testing

# Copy test configuration
COPY jest.config.js ./
COPY jest.setup.js ./
COPY tsconfig.json ./
COPY tests/ ./tests/

# Install test-specific dependencies
RUN npm install --save-dev @types/jest jest ts-jest

# Create test output directories
RUN mkdir -p \
    /app/test-results/unit \
    /app/test-results/integration \
    /app/test-results/e2e \
    /app/coverage

# Set test environment
ENV NODE_ENV=test
ENV CI=true

# Run tests by default
CMD ["npm", "test"]

# =================== PRODUCTION STAGE ===================
FROM node:20-alpine AS production

# Install only runtime dependencies
RUN apk add --no-cache \
    bash \
    curl \
    sqlite \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy production dependencies
COPY --from=dependencies /app/node_modules ./node_modules

# Copy built application
COPY --from=development /app/dist ./dist
COPY --from=development /app/bin ./bin
COPY --from=development /app/cli.js ./cli.js

# Copy configuration files
COPY package*.json ./
COPY .claude/ ./.claude/

# Create runtime user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S claude -u 1001 -G nodejs

# Set ownership
RUN chown -R claude:nodejs /app

# Switch to runtime user
USER claude

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Production command
CMD ["node", "cli.js", "start"]

# =================== SWARM INTEGRATION STAGE ===================
FROM development AS swarm-integration

# Copy ruv-swarm from local directory
COPY --from=base /app/ruv-swarm ./ruv-swarm

# Install ruv-swarm globally for MCP integration
RUN cd ruv-swarm && npm install -g .

# Set up MCP configuration
RUN mkdir -p ~/.config/claude-code && \
    echo '{"mcpServers": {"ruv-swarm": {"command": "ruv-swarm", "args": ["mcp", "start"]}}}' > ~/.config/claude-code/mcp.json

# Environment for swarm testing
ENV SWARM_MODE=true
ENV MCP_ENABLED=true

# Command for swarm testing
CMD ["npm", "run", "test:swarm"]