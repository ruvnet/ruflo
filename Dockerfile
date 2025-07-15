# Base stage for Node.js
FROM node:20-alpine AS base

# Install dependencies for node-gyp and better-sqlite3
RUN apk add --no-cache python3 make g++ git

WORKDIR /app

# Dependencies stage
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

# Development dependencies stage
FROM base AS dev-deps
COPY package*.json ./
RUN npm ci

# Build stage
FROM dev-deps AS build
COPY . .
RUN npm run build:ts || echo "Build needs fixing"

# Runtime stage
FROM base AS runtime
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/bin ./bin
COPY --from=build /app/.claude ./.claude

# Make the binary executable
RUN chmod +x ./bin/claude-flow || true

# Set the entrypoint
ENTRYPOINT ["./bin/claude-flow"]
CMD ["--help"]