/**
 * Examples of using enhanced memory features
 */

import { enhancedMemory } from './enhanced-memory.js';

// Initialize enhanced memory
await enhancedMemory.initialize();

// === 1. Session Management Example ===
async function exampleSessionManagement() {
  console.log('\n=== Session Management ===');

  // Save current session state
  const sessionId = `session-${Date.now()}`;
  await enhancedMemory.saveSessionState(sessionId, {
    state: 'active',
    context: {
      currentTask: 'Implementing authentication',
      openFiles: ['src/auth.js', 'src/middleware/auth.js'],
      cursorPositions: { 'src/auth.js': { line: 45, column: 12 } },
      activeAgents: ['AuthExpert', 'SecurityReviewer'],
      completedSteps: ['Design API', 'Create models'],
      nextSteps: ['Implement JWT', 'Add tests'],
    },
  });

  console.log('Session saved:', sessionId);

  // Later, resume the session
  const resumed = await enhancedMemory.resumeSession(sessionId);
  console.log('Resumed context:', resumed.context);
}

// === 2. MCP Tool Usage Tracking ===
async function exampleToolTracking() {
  console.log('\n=== Tool Usage Tracking ===');

  const startTime = Date.now();

  // Track a successful tool usage
  await enhancedMemory.trackToolUsage(
    'memory_usage',
    { action: 'store', key: 'test', value: 'data' },
    { success: true, stored: true },
    Date.now() - startTime,
    true,
  );

  // Track a failed tool usage
  await enhancedMemory.trackToolUsage(
    'swarm_init',
    { topology: 'invalid' },
    null,
    150,
    false,
    'Invalid topology specified',
  );

  // Get tool statistics
  const stats = await enhancedMemory.getToolStats();
  console.log('Tool effectiveness:', stats);
}

// === 3. Training Data Collection ===
async function exampleTrainingData() {
  console.log('\n=== Training Data ===');

  // Record a successful code fix
  await enhancedMemory.recordTrainingExample(
    'error_fix',
    {
      error: 'TypeError: Cannot read property of undefined',
      code: 'const result = user.profile.name;',
      context: 'User object might be null',
    },
    {
      fix: 'const result = user?.profile?.name || "Anonymous";',
      explanation: 'Added optional chaining and default value',
    },
    {
      errorResolved: true,
      testsPass: true,
    },
    0.95,
    'Good defensive programming practice',
  );

  // Get training examples
  const examples = await enhancedMemory.getTrainingData('error_fix', 5);
  console.log('Training examples:', examples.length);
}

// === 4. Code Pattern Recognition ===
async function exampleCodePatterns() {
  console.log('\n=== Code Patterns ===');

  // Record a frequently used pattern
  await enhancedMemory.recordCodePattern(
    'src/utils/api.js',
    'error_handler',
    `
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      throw new ApiError(error.message, error.status);
    }
    `,
    'javascript',
  );

  // Find similar patterns
  const patterns = await enhancedMemory.findSimilarPatterns('javascript', 5);
  console.log(
    'Found patterns:',
    patterns.map((p) => p.pattern_name),
  );
}

// === 5. Agent Collaboration ===
async function exampleAgentCollaboration() {
  console.log('\n=== Agent Collaboration ===');

  const taskId = 'task-auth-001';

  // Record agent interactions
  await enhancedMemory.recordAgentInteraction(
    'Coordinator',
    'AuthExpert',
    'request',
    { action: 'design', component: 'JWT middleware' },
    taskId,
  );

  await enhancedMemory.recordAgentInteraction(
    'AuthExpert',
    'Coordinator',
    'response',
    {
      design: 'JWT with refresh tokens',
      estimatedTime: '2 hours',
      dependencies: ['jsonwebtoken', 'bcrypt'],
    },
    taskId,
  );

  // Get conversation history
  const conversation = await enhancedMemory.getAgentConversation(taskId);
  console.log('Agent conversation:', conversation.length, 'messages');
}

// === 6. Knowledge Graph ===
async function exampleKnowledgeGraph() {
  console.log('\n=== Knowledge Graph ===');

  // Add entities and relationships
  await enhancedMemory.addKnowledgeEntity(
    'module',
    'AuthModule',
    'src/auth/index.js',
    ['UserModel', 'JWTService', 'AuthMiddleware'],
    {
      exports: ['authenticate', 'authorize', 'refreshToken'],
      dependencies: 4,
      complexity: 'medium',
    },
  );

  await enhancedMemory.addKnowledgeEntity(
    'service',
    'JWTService',
    'src/auth/jwt.service.js',
    ['AuthModule', 'ConfigService'],
    {
      methods: ['sign', 'verify', 'decode'],
      tokenExpiry: '1h',
    },
  );

  // Find related entities
  const related = await enhancedMemory.findRelatedEntities('AuthModule');
  console.log(
    'Related entities:',
    related.map((e) => e.entity_name),
  );
}

// === 7. Error Learning ===
async function exampleErrorLearning() {
  console.log('\n=== Error Learning ===');

  // Record an error and its resolution
  await enhancedMemory.recordError(
    'DatabaseError',
    'Connection timeout',
    'at Database.connect (db.js:45)',
    {
      operation: 'startup',
      config: { host: 'localhost', port: 5432 },
    },
    'Increased connection timeout to 30s and added retry logic',
  );

  // Later, get solutions for similar errors
  const solutions = await enhancedMemory.getErrorSolutions('DatabaseError');
  console.log(
    'Known solutions:',
    solutions.map((s) => s.resolution),
  );
}

// === 8. Performance Monitoring ===
async function examplePerformanceTracking() {
  console.log('\n=== Performance Tracking ===');

  // Record performance metrics
  await enhancedMemory.recordPerformance(
    'file_analysis',
    { files: 150, totalSize: '45MB' },
    3420, // duration in ms
    125.5, // memory in MB
    45.2, // CPU %
  );

  // Get performance trends
  const trends = await enhancedMemory.getPerformanceTrends('file_analysis', 7);
  console.log('Performance trends:', trends);
}

// === 9. User Preference Learning ===
async function examplePreferenceLearning() {
  console.log('\n=== Preference Learning ===');

  // Learn from user actions
  await enhancedMemory.learnPreference(
    'indent_style',
    'spaces',
    'coding_style',
    'inferred',
    0.95, // high confidence based on consistent usage
  );

  await enhancedMemory.learnPreference(
    'test_framework',
    'jest',
    'tool_usage',
    'explicit',
    1.0, // user explicitly stated preference
  );

  // Get learned preferences
  const codingPrefs = await enhancedMemory.getPreferences('coding_style');
  console.log('Coding preferences:', codingPrefs);
}

// === 10. Comprehensive Session Export ===
async function exampleSessionExport() {
  console.log('\n=== Session Export ===');

  const sessionId = 'session-example';
  const exportData = await enhancedMemory.exportSessionData(sessionId);

  console.log('Exported data includes:');
  console.log('- Session state:', exportData.session ? 'Yes' : 'No');
  console.log('- Tool usage:', exportData.tools.length, 'records');
  console.log('- Performance:', exportData.performance.length, 'benchmarks');
  console.log('- Interactions:', exportData.interactions.length, 'messages');
}

// Run all examples
async function runAllExamples() {
  await exampleSessionManagement();
  await exampleToolTracking();
  await exampleTrainingData();
  await exampleCodePatterns();
  await exampleAgentCollaboration();
  await exampleKnowledgeGraph();
  await exampleErrorLearning();
  await examplePerformanceTracking();
  await examplePreferenceLearning();
  await exampleSessionExport();

  // Show database statistics
  const stats = await enhancedMemory.getDatabaseStats();
  console.log('\n=== Database Statistics ===');
  console.log(stats);

  enhancedMemory.close();
}

// Export for testing
export {
  exampleSessionManagement,
  exampleToolTracking,
  exampleTrainingData,
  exampleCodePatterns,
  exampleAgentCollaboration,
  exampleKnowledgeGraph,
  exampleErrorLearning,
  examplePerformanceTracking,
  examplePreferenceLearning,
  exampleSessionExport,
  runAllExamples,
};
