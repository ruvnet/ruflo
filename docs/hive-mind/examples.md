# 🎯 Hive Mind Examples

## Overview

This guide provides real-world examples of using Hive Mind for various development tasks. Each example includes the command, expected output, and tips for best results.

## Table of Contents

1. [Simple Tasks](#simple-tasks)
2. [Web Applications](#web-applications)
3. [API Development](#api-development)
4. [System Architecture](#system-architecture)
5. [Code Migration](#code-migration)
6. [Performance Optimization](#performance-optimization)
7. [Enterprise Projects](#enterprise-projects)
8. [Custom Workflows](#custom-workflows)

## Simple Tasks

### Example 1: Basic CRUD API

**Task**: Create a simple CRUD API for managing books.

```bash
npx claude-flow@2.0.0 hive-mind --task "Create CRUD API for books with title, author, ISBN" --complexity low
```

**Expected Output**:
- `server.js` - Express server setup
- `routes/books.js` - CRUD endpoints
- `models/book.js` - Data model
- `tests/books.test.js` - Basic tests
- `README.md` - API documentation

**Time**: ~5 minutes

### Example 2: Authentication System

**Task**: Add JWT authentication to existing Express app.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Wizard Inputs**:
```
Task: Add JWT authentication with refresh tokens to Express app
Complexity: Medium
Features: [✓] Auth [✓] Database [✓] Tests
Timeline: Balanced
```

**Expected Output**:
- `middleware/auth.js` - Authentication middleware
- `routes/auth.js` - Login/register endpoints
- `models/user.js` - User model with bcrypt
- `utils/tokens.js` - JWT utilities
- `tests/auth.test.js` - Auth tests
- Migration scripts for database

**Time**: ~10 minutes

## Web Applications

### Example 3: Full-Stack Todo App

**Task**: Build a complete todo application with user accounts.

```bash
npx claude-flow@2.0.0 hive-mind --task "Build todo app with React frontend, Node.js backend, user accounts, and PostgreSQL" --complexity high
```

**Expected Structure**:
```
todo-app/
├── backend/
│   ├── server.js
│   ├── routes/
│   ├── models/
│   ├── middleware/
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── App.js
│   └── package.json
├── database/
│   └── migrations/
└── docker-compose.yml
```

**Features Delivered**:
- User registration/login
- Todo CRUD operations
- Real-time updates
- Responsive UI
- Database persistence
- Docker configuration

**Time**: ~25 minutes

### Example 4: E-Commerce Platform

**Task**: Create an e-commerce platform with products, cart, and checkout.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Wizard Configuration**:
```yaml
Task: "Build e-commerce platform with product catalog, shopping cart, user accounts, and payment integration"
Complexity: Very High
Features: All
Timeline: Thorough
Tech Stack:
  Backend: Node.js with Express
  Frontend: React with TypeScript
  Database: PostgreSQL
  Payment: Stripe
```

**Delivered Components**:
- Product management system
- Shopping cart with sessions
- User authentication
- Order processing
- Payment integration
- Admin dashboard
- Email notifications
- Comprehensive tests

**Time**: ~45 minutes

## API Development

### Example 5: RESTful Microservices

**Task**: Convert monolithic API to microservices architecture.

```bash
npx claude-flow@2.0.0 hive-mind --task "Split monolithic Node.js API into user, product, and order microservices with API gateway"
```

**Output Structure**:
```
microservices/
├── api-gateway/
│   ├── server.js
│   ├── routes/
│   └── middleware/
├── user-service/
│   ├── server.js
│   ├── models/
│   └── routes/
├── product-service/
│   ├── server.js
│   ├── models/
│   └── routes/
├── order-service/
│   ├── server.js
│   ├── models/
│   └── routes/
├── shared/
│   └── utils/
└── docker-compose.yml
```

**Key Features**:
- Service discovery
- Load balancing
- Centralized logging
- Health checks
- Inter-service communication
- Shared utilities

**Time**: ~30 minutes

### Example 6: GraphQL API

**Task**: Build a GraphQL API for a social media application.

```bash
npx claude-flow@2.0.0 hive-mind --task "Create GraphQL API for social media with users, posts, comments, and real-time subscriptions"
```

**Delivered**:
- GraphQL schema definitions
- Resolvers for all types
- Authentication integration
- Real-time subscriptions
- DataLoader for optimization
- GraphQL playground setup
- Comprehensive tests

**Time**: ~20 minutes

## System Architecture

### Example 7: Event-Driven Architecture

**Task**: Design event-driven system for order processing.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Configuration**:
```
Task: Design event-driven architecture for order processing with inventory, payment, and shipping services
Complexity: High
Features: [✓] API [✓] Integration [✓] Tests [✓] Docs
Tech: Node.js, RabbitMQ, PostgreSQL
```

**Architecture Delivered**:
- Message queue setup
- Event publishers
- Event consumers
- Saga pattern implementation
- Error handling
- Dead letter queues
- Monitoring setup

**Time**: ~35 minutes

### Example 8: Serverless Application

**Task**: Build serverless application on AWS.

```bash
npx claude-flow@2.0.0 hive-mind --task "Create serverless image processing API with AWS Lambda, S3, and DynamoDB"
```

**Output**:
- Lambda functions
- API Gateway configuration
- S3 bucket setup
- DynamoDB tables
- IAM roles
- CloudFormation template
- Deployment scripts
- Local testing setup

**Time**: ~25 minutes

## Code Migration

### Example 9: Framework Migration

**Task**: Migrate Express.js app to Fastify.

```bash
npx claude-flow@2.0.0 hive-mind --task "Migrate existing Express.js API to Fastify while maintaining all endpoints and functionality"
```

**Migration Process**:
1. Analyzes existing codebase
2. Maps Express patterns to Fastify
3. Converts middleware
4. Updates route handlers
5. Migrates tests
6. Ensures feature parity

**Time**: ~20 minutes

### Example 10: Language Migration

**Task**: Convert JavaScript codebase to TypeScript.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Wizard Input**:
```
Task: Convert Node.js JavaScript project to TypeScript with proper types and interfaces
Complexity: High
Timeline: Thorough
Context: Maintain backward compatibility, add strict typing
```

**Deliverables**:
- TypeScript configuration
- Type definitions
- Interface declarations
- Converted source files
- Updated build process
- Type-safe tests
- Migration guide

**Time**: ~30 minutes

## Performance Optimization

### Example 11: React App Optimization

**Task**: Optimize slow React application.

```bash
npx claude-flow@2.0.0 hive-mind --task "Optimize React app performance - reduce bundle size, improve rendering, add code splitting"
```

**Optimizations Applied**:
- Code splitting implementation
- Lazy loading components
- Memoization strategies
- Bundle size analysis
- Image optimization
- Service worker setup
- Performance monitoring

**Results**: 70%+ performance improvement

**Time**: ~15 minutes

### Example 12: Database Optimization

**Task**: Optimize database queries and structure.

```bash
npx claude-flow@2.0.0 hive-mind --task "Optimize PostgreSQL database - analyze slow queries, add indexes, optimize schema"
```

**Delivered**:
- Query analysis report
- Index recommendations
- Schema optimizations
- Query rewrites
- Connection pooling setup
- Caching strategy
- Performance benchmarks

**Time**: ~20 minutes

## Enterprise Projects

### Example 13: Multi-Tenant SaaS Platform

**Task**: Build multi-tenant SaaS application.

```bash
npx claude-flow@2.0.0 hive-mind
```

**Complex Configuration**:
```
Task: Build multi-tenant SaaS platform with tenant isolation, billing, admin panel, and API
Complexity: Very High
Features: All
Timeline: Thorough
Tech Stack:
  - Node.js/Express
  - React/TypeScript
  - PostgreSQL with RLS
  - Redis
  - Stripe
```

**Complete System Includes**:
- Tenant isolation architecture
- Role-based access control
- Billing and subscriptions
- Admin dashboard
- Tenant dashboards
- API with rate limiting
- Comprehensive documentation
- Deployment configuration

**Time**: ~60 minutes

### Example 14: Real-Time Analytics Dashboard

**Task**: Create real-time analytics dashboard.

```bash
npx claude-flow@2.0.0 hive-mind --task "Build real-time analytics dashboard with WebSockets, data visualization, and historical data"
```

**Components**:
- WebSocket server
- Real-time data pipeline
- React dashboard
- Chart components
- Data aggregation
- Historical data storage
- Export functionality
- Mobile responsive design

**Time**: ~35 minutes

## Custom Workflows

### Example 15: CI/CD Pipeline

**Task**: Set up complete CI/CD pipeline.

```bash
npx claude-flow@2.0.0 hive-mind --task "Create CI/CD pipeline with GitHub Actions for Node.js app with testing, linting, and deployment"
```

**Pipeline Includes**:
- GitHub Actions workflows
- Automated testing
- Code quality checks
- Docker builds
- Deployment scripts
- Environment management
- Rollback procedures
- Monitoring integration

**Time**: ~15 minutes

### Example 16: Documentation Generation

**Task**: Generate comprehensive documentation.

```bash
npx claude-flow@2.0.0 hive-mind --task "Generate complete documentation for existing codebase including API docs, guides, and examples"
```

**Documentation Created**:
- API reference (OpenAPI)
- Developer guides
- User documentation
- Code examples
- Architecture diagrams
- Deployment guide
- Troubleshooting guide

**Time**: ~20 minutes

## Advanced Usage Patterns

### Combining Templates

```bash
# Use template with customization
npx claude-flow@2.0.0 hive-mind --template rest-api --task "Extend with GraphQL support"
```

### Sequential Tasks

```bash
# First create the base
npx claude-flow@2.0.0 hive-mind --task "Create Express API" --export base-api.json

# Then enhance it
npx claude-flow@2.0.0 hive-mind --task "Add authentication to existing API" --import base-api.json
```

### Parallel Development

```javascript
// Use API for parallel development
const { HiveMind } = require('claude-flow');

const hiveMind = new HiveMind();

// Execute multiple related tasks
const results = await Promise.all([
  hiveMind.execute({ task: 'Create user service' }),
  hiveMind.execute({ task: 'Create product service' }),
  hiveMind.execute({ task: 'Create order service' })
]);
```

## Tips for Success

### 1. Task Description
- Be specific about requirements
- Include technology preferences
- Mention any constraints
- Specify integrations needed

### 2. Complexity Selection
- **Low**: Single feature, <1 hour traditional work
- **Medium**: Multiple features, 2-4 hours traditional work
- **High**: Complex system, 1-2 days traditional work
- **Very High**: Enterprise system, 3+ days traditional work

### 3. Feature Selection
- Select all relevant features
- Don't worry about over-selection
- Each feature gets specialized attention
- More features = better coverage

### 4. Timeline Impact
- **ASAP**: Fastest delivery, basic docs
- **Balanced**: Good documentation and tests
- **Thorough**: Comprehensive everything
- **Learning**: Includes explanations

### 5. Monitoring
- Watch agent activity
- Check memory usage
- Review discoveries
- Note any blockers

## Troubleshooting Common Issues

### Agents Not Coordinating
```bash
# Check status
npx claude-flow@2.0.0 hive-mind swarm status

# Force sync
npx claude-flow@2.0.0 hive-mind swarm sync
```

### Task Taking Too Long
```bash
# Monitor progress
npx claude-flow@2.0.0 hive-mind monitor

# Check bottlenecks
npx claude-flow@2.0.0 hive-mind analyze bottlenecks
```

### Incomplete Results
- Review task decomposition
- Check agent completion status
- Verify all dependencies met
- Look for error messages

## Next Steps

1. Try different examples
2. Combine patterns for complex projects
3. Create custom workflows
4. Share successful patterns
5. Contribute examples to the community

Remember: Hive Mind learns from each task, getting better at understanding your needs and delivering optimal results!