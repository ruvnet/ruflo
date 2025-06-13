# Claude-Flow VS Code Extension Demo

## Quick Start

### 1. Install and Setup

```bash
# Install dependencies
npm install

# Build the extension
npm run build

# Open VS Code
code .
```

### 2. Run the Extension

Press `F5` to launch a new VS Code window with the extension loaded.

## Demo Scenarios

### Scenario 1: Simple Chat Mode

1. Open Claude Flow: `Ctrl+Alt+C`
2. In Chat mode, ask a question:
   ```
   "What is the difference between async and await in JavaScript?"
   ```
3. Claude will provide a detailed explanation with code examples

### Scenario 2: Pair Programming Mode

1. Switch to "Pair Programming" mode
2. Open a JavaScript file
3. Type in the chat:
   ```
   "Help me refactor this function to use modern JavaScript features"
   ```
4. Claude will analyze your code and suggest improvements

### Scenario 3: Code Review Mode

1. Switch to "Code Review" mode
2. Select some code in the editor
3. Right-click and choose "Claude Flow: Ask Claude"
4. The selected code will be reviewed for:
   - Security issues
   - Performance improvements
   - Best practices
   - Potential bugs

### Scenario 4: Plan & Reflect Mode (Advanced)

1. Switch to "Plan & Reflect" mode
2. Request a complex task:
   ```
   "Create a user authentication system with JWT tokens, password hashing, and rate limiting"
   ```
3. Watch as multiple agents coordinate:
   - **Coordinator**: Plans the implementation steps
   - **Implementer**: Writes the code
   - **Tester**: Creates unit tests
   - **Reviewer**: Validates the implementation

### Scenario 5: TDD Development

1. In Plan & Reflect mode, type:
   ```
   "Use TDD to implement a binary search tree with insert, search, and delete operations"
   ```
2. The system will:
   - Write test specifications first
   - Create failing tests
   - Implement code to pass tests
   - Refactor for optimization

## UI Features Demo

### Multi-Tab Conversations
- Click "+" to create a new chat tab
- Switch between different conversations
- Each tab maintains its own context

### Agent Visualization
- Open the sidebar to see active agents
- Watch agent status change:
  - 🟢 Active (working on task)
  - 🟡 Idle (waiting for input)
  - 🔴 Error (encountered issue)

### Task Progress
- View hierarchical task breakdown
- Track completion status
- See which agent is assigned to each task

### Tool Execution Logs
- When agents run commands, see:
  - The exact command executed
  - Output or results
  - Execution time
  - Success/failure status

## Advanced Features

### Memory System
```typescript
// Store project context
"Remember that we're building an e-commerce platform with React and Node.js"

// Later, ask about it
"What kind of project are we building?"
```

### Swarm Mode
```typescript
// Activate multiple specialized agents
"Using a swarm of agents, analyze and optimize our entire codebase for performance"
```

### Integration with VS Code
- **File Operations**: Agents can read/write files
- **Terminal Commands**: Execute build, test, and deploy commands
- **Git Integration**: Create commits with descriptive messages
- **Code Navigation**: Jump to definitions and implementations

## Tips and Tricks

1. **Keyboard Shortcuts**
   - `Ctrl+Alt+C`: Open Claude Flow
   - `Ctrl+Enter`: Send message (in input box)
   - `Esc`: Close current panel

2. **Context Management**
   - Use "Remember..." to store important context
   - Clear chat history when switching projects
   - Use specific mode for better results

3. **Performance**
   - For large codebases, be specific about files
   - Use streaming for faster feedback
   - Close unused tabs to save memory

4. **Best Practices**
   - Start with simple tasks and build complexity
   - Review agent suggestions before applying
   - Use Plan & Reflect for complex features
   - Keep conversations focused on single topics

## Troubleshooting

### "Claude-Flow CLI not found"
```bash
npm install -g claude-code-flow
```

### "API Key not set"
1. Run command: "Claude Flow: Set API Key"
2. Enter your Anthropic API key

### "No response from Claude"
1. Check your internet connection
2. Verify API key is valid
3. Check VS Code output panel for errors

## Example Outputs

### Chat Mode Response
```markdown
**Async/Await Explanation:**

`async` and `await` are modern JavaScript features for handling asynchronous operations...

\`\`\`javascript
// Using async/await
async function fetchData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}
\`\`\`
```

### Code Review Output
```markdown
**Security Review Results:**

✅ No SQL injection vulnerabilities found
⚠️ Missing input validation on line 23
❌ Hardcoded API key detected on line 45

**Recommendations:**
1. Add input sanitization for user data
2. Move API keys to environment variables
3. Implement rate limiting for API endpoints
```

### Plan & Reflect Output
```markdown
**Implementation Plan:**

1. **Setup Project Structure** ✅
   - Initialize Node.js project
   - Install dependencies (express, jsonwebtoken, bcrypt)
   
2. **Create User Model** ✅
   - Define schema with email and password
   - Add password hashing middleware
   
3. **Implement Auth Routes** 🔄
   - POST /auth/register
   - POST /auth/login
   - POST /auth/refresh
   
4. **Add Middleware** ⏳
   - JWT verification
   - Rate limiting
   - Error handling
```

---

This demo showcases the power of combining Claude's AI capabilities with VS Code's development environment through the Claude-Flow orchestration system.