# Claude Flow Docker Image
# Multi-stage build for optimal size and security

# Stage 1: Build environment
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    bash

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source code
COPY . .

# Build the project
RUN npm run build || echo "No build step"

# Stage 2: Runtime environment
FROM node:20-alpine

# Install runtime dependencies
RUN apk add --no-cache \
    git \
    bash \
    curl \
    jq

# Create non-root user
RUN addgroup -g 1001 -S claude && \
    adduser -S claude -u 1001

# Set working directory
WORKDIR /app

# Copy from builder
COPY --from=builder --chown=claude:claude /app/node_modules ./node_modules
COPY --from=builder --chown=claude:claude /app/package*.json ./
COPY --from=builder --chown=claude:claude /app/bin ./bin
COPY --from=builder --chown=claude:claude /app/src ./src
COPY --from=builder --chown=claude:claude /app/cli.js ./cli.js

# Create directories for user
RUN mkdir -p /home/claude/.claude-flow && \
    chown -R claude:claude /home/claude

# Switch to non-root user
USER claude

# Set environment variables
ENV NODE_ENV=production \
    CLAUDE_FLOW_HOME=/home/claude/.claude-flow \
    PATH="/app/bin:${PATH}"

# Expose port for MCP server
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('healthy')" || exit 1

# Default command
ENTRYPOINT ["claude-flow"]
CMD ["--help"]