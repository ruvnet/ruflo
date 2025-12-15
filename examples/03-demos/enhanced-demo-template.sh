#!/bin/bash
# Enhanced Demo Template - Shows proper error handling and fallback behavior

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Demo configuration
DEMO_NAME="Enhanced Claude-Flow Demo"
OUTPUT_DIR="./output/demo-results"
CLAUDE_FLOW_CMD="../claude-flow"
DEMO_MODE=false

# Function to print colored output
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to check prerequisites
check_prerequisites() {
    print_color "$BLUE" "🔍 Checking prerequisites..."
    
    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        print_color "$GREEN" "  ✅ Node.js found: $NODE_VERSION"
    else
        print_color "$RED" "  ❌ Node.js not found. Please install Node.js 18+"
        exit 1
    fi
    
    # Check Claude-Flow
    if [ -f "$CLAUDE_FLOW_CMD" ] || command -v claude-flow &> /dev/null; then
        print_color "$GREEN" "  ✅ Claude-Flow found"
    else
        print_color "$YELLOW" "  ⚠️  Claude-Flow not found. Running in demo mode..."
        DEMO_MODE=true
    fi
    
    # Check output directory
    if [ ! -d "$OUTPUT_DIR" ]; then
        mkdir -p "$OUTPUT_DIR"
        print_color "$GREEN" "  ✅ Created output directory: $OUTPUT_DIR"
    fi
}

# Function to simulate swarm output in demo mode
simulate_swarm_output() {
    local task=$1
    
    print_color "$YELLOW" "\n[DEMO MODE - Simulated Output]"
    
    # Simulate agent initialization
    sleep 1
    print_color "$BLUE" "🚀 Initializing swarm system..."
    
    # Simulate agent activities
    local agents=("Architect" "Developer" "Tester" "Reviewer" "Documenter")
    local activities=(
        "Analyzing requirements"
        "Designing system architecture"
        "Implementing core features"
        "Creating test suite"
        "Reviewing code quality"
        "Generating documentation"
    )
    
    for i in {0..5}; do
        sleep 0.5
        agent=${agents[$((i % ${#agents[@]}))]}
        activity=${activities[$i]}
        print_color "$GREEN" "  ✅ Agent '$agent': $activity"
    done
    
    # Simulate file creation
    sleep 1
    print_color "$BLUE" "\n📁 Generated files (simulated):"
    cat <<EOF
  - index.js (main application)
  - package.json (dependencies)
  - README.md (documentation)
  - test.spec.js (test suite)
  - .gitignore (git configuration)
  - config.json (app configuration)
EOF
    
    # Create actual demo files
    create_demo_files
}

# Function to create demo files
create_demo_files() {
    local demo_app_dir="$OUTPUT_DIR/demo-app"
    mkdir -p "$demo_app_dir"
    
    # Create a simple index.js
    cat > "$demo_app_dir/index.js" <<'EOF'
// Demo application created by Claude-Flow
console.log('🚀 Claude-Flow Demo Application');
console.log('This is a simulated output for demonstration purposes');

// Example function
function greet(name) {
    return `Hello, ${name}! Welcome to Claude-Flow.`;
}

// Export for testing
module.exports = { greet };

// Run if called directly
if (require.main === module) {
    console.log(greet('Developer'));
}
EOF

    # Create package.json
    cat > "$demo_app_dir/package.json" <<'EOF'
{
  "name": "claude-flow-demo-app",
  "version": "1.0.0",
  "description": "Demo application created by Claude-Flow",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "node test.spec.js"
  },
  "keywords": ["demo", "claude-flow", "example"],
  "author": "Claude-Flow",
  "license": "MIT"
}
EOF

    # Create test file
    cat > "$demo_app_dir/test.spec.js" <<'EOF'
// Demo test suite
const { greet } = require('./index');

console.log('Running tests...');

// Test 1
const result = greet('Tester');
if (result === 'Hello, Tester! Welcome to Claude-Flow.') {
    console.log('✅ Test 1 passed: greet function works correctly');
} else {
    console.log('❌ Test 1 failed');
}

console.log('All tests completed!');
EOF

    # Create README
    cat > "$demo_app_dir/README.md" <<'EOF'
# Claude-Flow Demo Application

This is a demonstration application created by Claude-Flow.

## Installation
```bash
npm install
```

## Usage
```bash
npm start
```

## Testing
```bash
npm test
```

## About
This application was generated as part of the Claude-Flow demo.
In a real scenario, Claude-Flow would create a fully functional application based on your requirements.
EOF
    
    print_color "$GREEN" "\n✅ Demo files created in: $demo_app_dir"
}

# Function to run actual swarm
run_actual_swarm() {
    local task=$1
    
    print_color "$BLUE" "🚀 Running Claude-Flow swarm..."
    
    # Prepare command with error handling
    local cmd="$CLAUDE_FLOW_CMD swarm create \"$task\" --output \"$OUTPUT_DIR\" --agents 3"
    
    # Execute with timeout and error handling
    if timeout 60s bash -c "$cmd"; then
        print_color "$GREEN" "✅ Swarm completed successfully!"
    else
        local exit_code=$?
        print_color "$YELLOW" "⚠️  Swarm command failed with exit code: $exit_code"
        print_color "$BLUE" "Falling back to demo mode..."
        DEMO_MODE=true
        simulate_swarm_output "$task"
    fi
}

# Function to verify output
verify_output() {
    print_color "$BLUE" "\n🔍 Verifying output..."
    
    if [ -d "$OUTPUT_DIR" ]; then
        print_color "$GREEN" "✅ Output directory exists"
        
        # List files
        print_color "$BLUE" "\n📁 Files in output directory:"
        find "$OUTPUT_DIR" -type f -name "*.js" -o -name "*.json" -o -name "*.md" | head -10
        
        # Try to run the demo app if it exists
        local app_dir="$OUTPUT_DIR/demo-app"
        if [ -f "$app_dir/index.js" ]; then
            print_color "$BLUE" "\n🚀 Running demo application..."
            (cd "$app_dir" && node index.js) || print_color "$YELLOW" "Could not run application"
            
            print_color "$BLUE" "\n🧪 Running tests..."
            (cd "$app_dir" && node test.spec.js) || print_color "$YELLOW" "Could not run tests"
        fi
    else
        print_color "$RED" "❌ Output directory not found"
    fi
}

# Function to show next steps
show_next_steps() {
    print_color "$BLUE" "\n📚 Next Steps:"
    cat <<EOF
1. Explore the generated files in: $OUTPUT_DIR
2. Try modifying the task to create different applications
3. Use --config flag to customize behavior
4. Run with --monitor to see real-time progress
5. Check logs for detailed agent interactions

Example commands:
  $CLAUDE_FLOW_CMD swarm create "Build a REST API" --agents 5
  $CLAUDE_FLOW_CMD swarm create "Create a CLI tool" --strategy development
  $CLAUDE_FLOW_CMD sparc tdd "implement user authentication"
EOF
}

# Main demo flow
main() {
    print_color "$BLUE" "==================================="
    print_color "$BLUE" "    $DEMO_NAME"
    print_color "$BLUE" "==================================="
    echo
    
    # Check prerequisites
    check_prerequisites
    
    # Define the task
    local task="Build a simple task management CLI application with add, list, and complete features"
    print_color "$BLUE" "📋 Task: $task"
    
    # Run swarm or simulate
    if [ "$DEMO_MODE" = true ]; then
        simulate_swarm_output "$task"
    else
        run_actual_swarm "$task"
    fi
    
    # Verify output
    verify_output
    
    # Show next steps
    show_next_steps
    
    print_color "$GREEN" "\n✨ Demo completed!"
}

# Handle script interruption
trap 'print_color "$RED" "\n❌ Demo interrupted. Cleaning up..."; exit 1' INT TERM

# Run the demo
main "$@"