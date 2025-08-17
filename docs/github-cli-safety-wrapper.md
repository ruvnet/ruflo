# GitHub CLI Safety Wrapper

A comprehensive, production-ready wrapper around GitHub CLI commands that provides robust security, error handling, and reliability features.

## Features

- **🛡️ Injection Attack Prevention**: Validates and sanitizes all inputs to prevent command injection
- **⏱️ Timeout Handling**: Configurable timeouts with graceful process cleanup
- **🔄 Retry Logic**: Exponential backoff retry mechanism for transient failures
- **📊 Rate Limiting**: Built-in rate limiting to prevent API abuse
- **🗂️ Secure Temp Files**: Safe temporary file handling with proper permissions
- **📈 Monitoring**: Comprehensive statistics and active process tracking
- **🚨 Error Recovery**: Robust error handling with custom error types
- **🧪 Validation**: Input validation with size limits and pattern detection

## Installation

The wrapper is part of the Claude Flow project and can be imported directly:

```javascript
import { GitHubCliSafe, githubCli } from './src/utils/github-cli-safety-wrapper.js';
```

## Quick Start

### Using the Singleton Instance

```javascript
import { githubCli } from './src/utils/github-cli-safety-wrapper.js';

// Create an issue
const result = await githubCli.createIssue({
  title: 'Bug Report: Login fails with special characters',
  body: 'Steps to reproduce:\n1. Enter `username@domain.com`\n2. Use password with $(special) characters',
  labels: ['bug', 'high-priority'],
  assignees: ['maintainer1', 'maintainer2']
});

console.log('Issue created:', result.stdout);
```

### Creating a Custom Instance

```javascript
import { GitHubCliSafe } from './src/utils/github-cli-safety-wrapper.js';

const ghSafe = new GitHubCliSafe({
  timeout: 60000,           // 60 seconds
  maxRetries: 5,            // Retry failed operations 5 times
  enableRateLimit: true,    // Enable rate limiting
  enableLogging: true       // Enable debug logging
});
```

## API Reference

### GitHubCliSafe Class

#### Constructor Options

```javascript
const options = {
  timeout: 30000,              // Default timeout in milliseconds
  maxRetries: 3,               // Maximum retry attempts
  retryDelay: 1000,            // Base retry delay in milliseconds
  enableRateLimit: true,       // Enable rate limiting
  enableLogging: true,         // Enable logging
  tempDir: '/tmp',             // Temporary file directory
  maxRequestsPerWindow: 50,    // Rate limit: requests per window
  rateLimitWindow: 60000       // Rate limit: window size in milliseconds
};
```

#### Core Methods

##### `execute(command, options)`

Execute a GitHub CLI command with full safety features.

```javascript
const result = await ghSafe.execute('issue create', {
  title: 'My Issue',
  body: 'Issue description with `code` and special chars',
  labels: ['bug', 'needs-triage'],
  assignees: ['reviewer1'],
  flags: {
    milestone: 'v2.0.0',
    project: 'Main Project'
  }
});
```

**Parameters:**
- `command` (string): The GitHub CLI command (e.g., 'issue create', 'pr comment')
- `options` (object): Configuration options
  - `title` (string): Title for issues/PRs
  - `body` (string): Body content (uses secure temp files)
  - `labels` (array): Array of label names
  - `assignees` (array): Array of assignee usernames
  - `flags` (object): Additional CLI flags
  - `timeout` (number): Override default timeout
  - `env` (object): Environment variables
  - `cwd` (string): Working directory

**Returns:** Promise resolving to:
```javascript
{
  stdout: string,     // Command output
  stderr: string,     // Error output
  code: number,       // Exit code
  duration: number,   // Execution time in ms
  command: string     // Full command executed
}
```

#### High-Level Methods

##### `createIssue(params)`

Create a GitHub issue with safe handling.

```javascript
const result = await ghSafe.createIssue({
  title: 'Feature Request: Add dark mode',
  body: `
## Description
Add dark mode support to the application.

## Code Example
\`\`\`javascript
const theme = getTheme() === 'dark' ? darkTheme : lightTheme;
\`\`\`

## Implementation Notes
- Use CSS custom properties
- Store preference in localStorage
- Handle system preference changes
`,
  labels: ['enhancement', 'ui'],
  assignees: ['frontend-team']
});
```

##### `createPR(params)`

Create a pull request with safe handling.

```javascript
const result = await ghSafe.createPR({
  title: 'Fix: Handle special characters in user input',
  body: `
## Changes
- Added input sanitization for user data
- Fixed XSS vulnerability in comment system
- Updated tests for edge cases

## Testing
\`\`\`bash
npm test
npm run security-audit
\`\`\`

## Breaking Changes
None
`,
  base: 'main',
  head: 'fix/input-sanitization',
  draft: false
});
```

##### `addIssueComment(issueNumber, body, options)`

Add a comment to an existing issue.

```javascript
const result = await ghSafe.addIssueComment(
  123, 
  `
## Update
Fixed the issue in commit abc123.

### Test Results
\`\`\`
✅ All tests passing
✅ Security scan clean
✅ Performance within limits
\`\`\`
`,
  { timeout: 15000 }
);
```

##### `addPRComment(prNumber, body, options)`

Add a comment to a pull request.

```javascript
const result = await ghSafe.addPRComment(
  456,
  `
## Code Review

The changes look good! A few suggestions:

1. Consider adding error handling for the API call
2. The regex pattern could be more specific: \`/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/\`

**Approved** ✅
`
);
```

##### `createRelease(params)`

Create a GitHub release.

```javascript
const result = await ghSafe.createRelease({
  tag: 'v2.1.0',
  title: 'Version 2.1.0 - Enhanced Security',
  body: `
## 🚀 Features
- Added GitHub CLI safety wrapper
- Enhanced input validation
- Improved error handling

## 🛡️ Security
- Fixed potential command injection vulnerability
- Added rate limiting protection
- Improved temp file handling

## 📈 Performance
- Reduced memory usage by 15%
- Faster command execution
- Better timeout handling

## 🐛 Bug Fixes
- Fixed issue with special characters in comments
- Resolved timeout problems with large files
- Fixed race condition in process cleanup

## ⚠️ Breaking Changes
None

## 📖 Documentation
- Updated API documentation
- Added security best practices guide
- Improved error handling examples
`,
  prerelease: false,
  draft: false
});
```

#### Utility Methods

##### `checkGitHubCli()`

Check if GitHub CLI is available and accessible.

```javascript
const isAvailable = await ghSafe.checkGitHubCli();
if (!isAvailable) {
  console.error('GitHub CLI not found. Please install: https://cli.github.com/');
}
```

##### `checkAuthentication()`

Verify GitHub CLI authentication status.

```javascript
const isAuthenticated = await ghSafe.checkAuthentication();
if (!isAuthenticated) {
  console.error('Not authenticated. Run: gh auth login');
}
```

##### `getStats()`

Get execution statistics.

```javascript
const stats = ghSafe.getStats();
console.log('GitHub CLI Usage Stats:', {
  total: stats.totalRequests,
  successful: stats.successfulRequests,
  failed: stats.failedRequests,
  timeouts: stats.timeoutRequests,
  retries: stats.retriedRequests
});
```

##### `cleanup()`

Clean up all active processes (useful for graceful shutdown).

```javascript
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await ghSafe.cleanup();
  process.exit(0);
});
```

## Error Handling

The wrapper provides custom error types for better error handling:

### Error Types

#### `GitHubCliError`

Base error class for all GitHub CLI operations.

```javascript
try {
  await ghSafe.execute('invalid command');
} catch (error) {
  if (error instanceof GitHubCliError) {
    console.error('GitHub CLI Error:', {
      message: error.message,
      code: error.code,
      details: error.details,
      timestamp: error.timestamp
    });
  }
}
```

#### `GitHubCliTimeoutError`

Thrown when operations exceed the configured timeout.

```javascript
try {
  await ghSafe.execute('issue create', { 
    title: 'Test',
    timeout: 1000  // Very short timeout
  });
} catch (error) {
  if (error instanceof GitHubCliTimeoutError) {
    console.error(`Operation timed out after ${error.details.timeout}ms`);
  }
}
```

#### `GitHubCliValidationError`

Thrown when input validation fails.

```javascript
try {
  await ghSafe.execute('issue create', {
    title: 'Test $(rm -rf /)',  // Dangerous input
    body: 'Description'
  });
} catch (error) {
  if (error instanceof GitHubCliValidationError) {
    console.error('Validation failed:', {
      field: error.details.field,
      value: error.details.value,
      message: error.message
    });
  }
}
```

#### `GitHubCliRateLimitError`

Thrown when rate limits are exceeded.

```javascript
try {
  // Multiple rapid requests
  for (let i = 0; i < 100; i++) {
    await ghSafe.execute('auth status');
  }
} catch (error) {
  if (error instanceof GitHubCliRateLimitError) {
    console.error('Rate limited. Please wait before making more requests.');
  }
}
```

## Security Features

### Input Validation

The wrapper automatically validates and sanitizes all inputs to prevent injection attacks:

```javascript
// ❌ These inputs are automatically blocked:
const dangerousInputs = [
  '$(rm -rf /)',           // Command substitution
  '`malicious command`',   // Backtick execution
  'test && rm file',       // Command chaining
  'test | sh',             // Pipe to shell
  'eval("code")',          // Eval execution
  'test <(echo hack)',     // Process substitution
];

// ✅ These inputs are allowed:
const safeInputs = [
  'Normal comment text',
  'Code: console.log("hello")',
  'Path: /src/components/Button.jsx',
  'Version: v1.2.3',
  'Special chars: @#$%^&*()_+-=[]{}|'
];
```

### Secure Temp Files

Temporary files are created with restricted permissions (600 - owner read/write only):

```javascript
// Automatically handled - no manual temp file management needed
await ghSafe.createIssue({
  title: 'Issue with sensitive data',
  body: 'This content is written to a secure temp file with mode 600'
});
```

### Process Isolation

All GitHub CLI commands are executed with:
- `shell: false` to prevent shell injection
- Isolated environment variables
- Proper signal handling for cleanup

## Advanced Usage

### Custom Configuration

```javascript
const enterpriseGhSafe = new GitHubCliSafe({
  timeout: 120000,                    // 2 minutes for slow enterprise
  maxRetries: 5,                      // More retries for reliability
  retryDelay: 2000,                   // Longer delay between retries
  enableRateLimit: true,              // Always enable rate limiting
  maxRequestsPerWindow: 30,           // Conservative rate limit
  rateLimitWindow: 60000,             // 1 minute window
  enableLogging: true,                // Enable detailed logging
  tempDir: '/secure/temp',            // Custom secure temp directory
});
```

### Error Recovery Patterns

```javascript
async function createIssueWithFallback(issueData) {
  try {
    return await ghSafe.createIssue(issueData);
  } catch (error) {
    if (error instanceof GitHubCliTimeoutError) {
      console.log('Timeout, retrying with longer timeout...');
      return await ghSafe.createIssue({
        ...issueData,
        timeout: 60000
      });
    }
    
    if (error instanceof GitHubCliRateLimitError) {
      console.log('Rate limited, waiting 60 seconds...');
      await new Promise(resolve => setTimeout(resolve, 60000));
      return await ghSafe.createIssue(issueData);
    }
    
    throw error; // Re-throw unhandled errors
  }
}
```

### Monitoring and Logging

```javascript
// Enable detailed logging
const monitoredGhSafe = new GitHubCliSafe({
  enableLogging: true
});

// Periodic stats logging
setInterval(() => {
  const stats = monitoredGhSafe.getStats();
  const activeProcesses = monitoredGhSafe.getActiveProcessCount();
  
  console.log('GitHub CLI Wrapper Stats:', {
    ...stats,
    activeProcesses,
    successRate: (stats.successfulRequests / stats.totalRequests * 100).toFixed(2) + '%'
  });
}, 60000); // Every minute
```

## Migration Guide

### From Legacy `github-cli-safe.js`

```javascript
// Old way (deprecated)
import { gh, safeGhCommand } from './github-cli-safe.js';

await gh.issueComment(123, 'Comment');
await safeGhCommand('pr comment', '456', 'PR comment');

// New way (recommended)
import { githubCli } from './github-cli-safety-wrapper.js';

await githubCli.addIssueComment(123, 'Comment');
await githubCli.addPRComment(456, 'PR comment');
```

### From Direct `gh` CLI Usage

```javascript
// Old way (unsafe)
import { execSync } from 'child_process';
execSync(`gh issue comment 123 --body "${unsafeBody}"`);

// New way (safe)
import { githubCli } from './github-cli-safety-wrapper.js';
await githubCli.addIssueComment(123, unsafeBody);
```

## Best Practices

### 1. Always Use Proper Error Handling

```javascript
try {
  const result = await githubCli.createPR({
    title: 'Feature: New component',
    body: prBody
  });
  console.log('PR created successfully:', result.stdout);
} catch (error) {
  console.error('Failed to create PR:', error.message);
  
  // Log for debugging
  if (error.details) {
    console.debug('Error details:', error.details);
  }
}
```

### 2. Validate Inputs Before Processing

```javascript
async function createIssueFromUserInput(userInput) {
  // Validate required fields
  if (!userInput.title || !userInput.body) {
    throw new Error('Title and body are required');
  }
  
  // The wrapper will handle sanitization, but you can add business logic validation
  if (userInput.title.length > 256) {
    throw new Error('Title too long (max 256 characters)');
  }
  
  return await githubCli.createIssue(userInput);
}
```

### 3. Use Appropriate Timeouts

```javascript
// Short timeout for simple operations
await githubCli.execute('auth status', { timeout: 5000 });

// Longer timeout for complex operations
await githubCli.createPR({
  title: 'Large refactor',
  body: veryLargeBody,
  timeout: 60000  // 1 minute
});
```

### 4. Monitor Usage and Performance

```javascript
// Set up monitoring
const ghSafe = new GitHubCliSafe({ enableLogging: true });

// Periodic health checks
setInterval(async () => {
  try {
    await ghSafe.checkAuthentication();
    console.log('✅ GitHub CLI health check passed');
  } catch (error) {
    console.error('❌ GitHub CLI health check failed:', error.message);
  }
}, 300000); // Every 5 minutes
```

## Troubleshooting

### Common Issues

#### Authentication Problems

```bash
# Check authentication status
gh auth status

# Re-authenticate if needed
gh auth login
```

#### Permission Issues

```bash
# Ensure proper scopes
gh auth refresh -s repo -s admin:org
```

#### Rate Limiting

```javascript
// Use custom rate limits for high-volume usage
const ghSafe = new GitHubCliSafe({
  enableRateLimit: true,
  maxRequestsPerWindow: 10,  // Very conservative
  rateLimitWindow: 60000     // 1 minute
});
```

#### Timeout Issues

```javascript
// Increase timeout for slow networks or large operations
const result = await githubCli.createPR({
  title: 'Large PR',
  body: largeBody,
  timeout: 300000  // 5 minutes
});
```

### Debug Mode

Enable detailed logging to troubleshoot issues:

```javascript
const debugGhSafe = new GitHubCliSafe({
  enableLogging: true,
  timeout: 30000
});

// This will log detailed information about execution
await debugGhSafe.execute('issue create', { 
  title: 'Debug test',
  body: 'Testing debug mode'
});
```

## Contributing

When contributing to the GitHub CLI Safety Wrapper:

1. **Add tests** for any new functionality
2. **Update documentation** for API changes
3. **Follow security best practices** - all inputs must be validated
4. **Maintain backward compatibility** where possible
5. **Add proper error handling** for new error scenarios

### Running Tests

```bash
npm test -- --testPathPattern=github-cli-safety-wrapper.test.js
```

### Security Considerations

- Never bypass input validation
- Always use secure temp file handling
- Implement proper cleanup for all resources
- Test with malicious inputs to ensure safety
- Monitor for new injection attack vectors

## License

MIT License - see the main project LICENSE file for details.