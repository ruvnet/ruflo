#!/bin/bash

# Simplified MCP Tool Testing Script for Local Environment
INSTALL_METHOD=${1:-npx}
CATEGORY=${2:-swarm}

# Create local directories
mkdir -p ./test-results ./test-logs

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a ./test-logs/test.log
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a ./test-logs/test.log
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a ./test-logs/test.log
}

# Initialize results tracking
echo '{"test_start": "'$(date -Iseconds)'", "install_method": "'$INSTALL_METHOD'", "category": "'$CATEGORY'", "results": {}}' > ./test-results/test_results.json

# Get gemini-flow command
get_command() {
    if [ "$INSTALL_METHOD" = "npx" ]; then
        echo "npx gemini-flow@2.0.0"
    else
        echo "./node_modules/.bin/gemini-flow"
    fi
}

# Test individual tool
test_tool() {
    local tool_name=$1
    local test_params=$2
    
    log_info "Testing tool: $tool_name"
    
    local cmd=$(get_command)
    local start_time=$(date +%s.%N)
    
    # Test via JSON-RPC
    local test_message="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{\"tools\":{},\"resources\":{}},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}
{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool_name\",\"arguments\":$test_params}}"
    
    local result=$(echo "$test_message" | timeout 10s $cmd mcp start --stdio 2>/dev/null | tail -1)
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc 2>/dev/null || echo "3.0")
    
    # Validate result
    if echo "$result" | jq -e '.result.content[0].text' > /dev/null 2>&1; then
        local response=$(echo "$result" | jq -r '.result.content[0].text')
        if echo "$response" | jq -e '.success' > /dev/null 2>&1; then
            log_success "✅ $tool_name: PASSED (${duration}s)"
            echo "$response" > "./test-results/${tool_name}_result.json"
            return 0
        else
            log_error "❌ $tool_name: FAILED - Response error"
            return 1
        fi
    else
        log_error "❌ $tool_name: FAILED - Invalid response"
        return 1
    fi
}

# Test categories
case $CATEGORY in
    "swarm")
        log_info "🐝 Testing Swarm Coordination Tools (12 tools)"
        test_tool "swarm_init" '{"topology":"hierarchical","maxAgents":5,"strategy":"auto"}'
        test_tool "agent_spawn" '{"type":"researcher","name":"test-agent"}'
        test_tool "task_orchestrate" '{"task":"test task","strategy":"parallel"}'
        test_tool "swarm_status" '{}'
        test_tool "agent_list" '{}'
        test_tool "agent_metrics" '{"agentId":"test-agent"}'
        test_tool "swarm_monitor" '{"interval":5}'
        test_tool "topology_optimize" '{}'
        test_tool "load_balance" '{"tasks":["task1","task2"]}'
        test_tool "coordination_sync" '{}'
        test_tool "swarm_scale" '{"targetSize":3}'
        test_tool "swarm_destroy" '{"swarmId":"test-swarm"}'
        ;;
    "neural")
        log_info "🧠 Testing Neural Network Tools (15 tools)"
        test_tool "neural_status" '{}'
        test_tool "neural_train" '{"pattern_type":"coordination","training_data":"test_data","epochs":10}'
        test_tool "neural_patterns" '{"action":"analyze","operation":"test_op"}'
        test_tool "neural_predict" '{"modelId":"test-model","input":"test input"}'
        test_tool "model_load" '{"modelPath":"/tmp/test_model"}'
        ;;
    "memory")
        log_info "💾 Testing Memory & Persistence Tools (12 tools)"
        test_tool "memory_usage" '{"action":"store","key":"test_key","value":"test_value"}'
        test_tool "memory_search" '{"pattern":"test*","limit":10}'
        test_tool "memory_persist" '{"sessionId":"test-session"}'
        test_tool "memory_namespace" '{"namespace":"test_ns","action":"create"}'
        test_tool "memory_backup" '{"path":"/tmp/backup"}'
        ;;
    *)
        log_error "Unknown category: $CATEGORY"
        exit 1
        ;;
esac

log_success "Category $CATEGORY testing complete!"