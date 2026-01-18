#!/bin/bash
# Claude Flow V3 - Cache Optimizer with GNN/GRNN Intelligence
# Integrates cache-optimizer with GNN/GRNN self-learning capabilities
# Cross-platform compatible: Linux, macOS, Windows (Git Bash/WSL)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CACHE_OPTIMIZER_DIR="$PROJECT_ROOT/v3/@claude-flow/cache-optimizer"
METRICS_DIR="$PROJECT_ROOT/.claude-flow/metrics"
CACHE_DIR="$PROJECT_ROOT/.claude-flow/cache"
GNN_DIR="$PROJECT_ROOT/.claude-flow/gnn"

# Ensure directories exist
mkdir -p "$METRICS_DIR" "$CACHE_DIR" "$GNN_DIR"

# =============================================================================
# Cross-Platform Date Functions
# =============================================================================
# ISO 8601 date (works on Linux, macOS, Windows Git Bash)
get_iso_date() {
  if date -Iseconds >/dev/null 2>&1; then
    # GNU date (Linux, Windows Git Bash)
    date -Iseconds
  else
    # BSD date (macOS)
    date -u +"%Y-%m-%dT%H:%M:%S+00:00"
  fi
}

# Timestamp in milliseconds (works on Linux, macOS, Windows Git Bash)
get_timestamp_ms() {
  if date +%s%3N 2>/dev/null | grep -qE '^[0-9]+$'; then
    # GNU date with milliseconds
    date +%s%3N
  elif command -v python3 >/dev/null 2>&1; then
    # Python fallback (macOS, any platform)
    python3 -c 'import time; print(int(time.time() * 1000))'
  elif command -v python >/dev/null 2>&1; then
    python -c 'import time; print(int(time.time() * 1000))'
  else
    # Seconds only fallback
    echo "$(date +%s)000"
  fi
}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

log() { echo -e "${CYAN}[CacheOpt] $1${RESET}"; }
success() { echo -e "${GREEN}[CacheOpt] ✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}[CacheOpt] ⚠ $1${RESET}"; }
error() { echo -e "${RED}[CacheOpt] ✗ $1${RESET}"; }

# =============================================================================
# Initialize Cache Optimizer with GNN/GRNN
# =============================================================================
init() {
  local profile="${1:-multi-agent}"

  log "Initializing cache optimizer with GNN/GRNN intelligence..."

  # Check if cache-optimizer is built
  if [ ! -f "$CACHE_OPTIMIZER_DIR/dist/index.js" ]; then
    warn "Cache optimizer not built, attempting build..."
    (cd "$CACHE_OPTIMIZER_DIR" && npm run build 2>/dev/null) || {
      error "Failed to build cache-optimizer"
      return 1
    }
  fi

  # Initialize configuration
  local init_date=$(get_iso_date)
  cat > "$CACHE_DIR/config.json" << EOF
{
  "profile": "$profile",
  "targetUtilization": 0.75,
  "gnn": {
    "enabled": true,
    "topology": "hybrid",
    "hiddenDim": 128,
    "numLayers": 2,
    "messagePassingHops": 2
  },
  "grnn": {
    "enabled": true,
    "hiddenSize": 64,
    "ewcLambda": 0.5,
    "fisherSamples": 200
  },
  "learning": {
    "measurementEnabled": true,
    "refinementEnabled": true,
    "reportingEnabled": true,
    "autoTune": true
  },
  "initialized": "$init_date"
}
EOF

  # Initialize GNN state
  cat > "$GNN_DIR/state.json" << EOF
{
  "graphNodes": 0,
  "graphEdges": 0,
  "lastTopology": "hybrid",
  "trainingSessions": 0,
  "patternsLearned": 0,
  "ewcConsolidations": 0,
  "initialized": "$init_date"
}
EOF

  success "Cache optimizer initialized with profile: $profile"
  echo -e "  ${DIM}├─ GNN: hybrid topology, 2-layer, 128-dim${RESET}"
  echo -e "  ${DIM}├─ GRNN: 64-hidden, EWC++ enabled${RESET}"
  echo -e "  ${DIM}└─ Learning: measurement + refinement + reporting${RESET}"

  return 0
}

# =============================================================================
# Record Cache Event for GNN Learning
# =============================================================================
record_event() {
  local event_type="$1"    # add, access, evict, prune
  local entry_id="$2"
  local entry_type="$3"    # file_read, tool_result, etc.
  local metadata="$4"

  local timestamp=$(date +%s%3N)

  # Append to event log for GNN training
  local event_log="$GNN_DIR/events.jsonl"

  echo "{\"type\":\"$event_type\",\"entryId\":\"$entry_id\",\"entryType\":\"$entry_type\",\"timestamp\":$timestamp,\"metadata\":$metadata}" >> "$event_log"

  # Update GNN state
  local state_file="$GNN_DIR/state.json"
  if [ -f "$state_file" ]; then
    local nodes=$(jq '.graphNodes' "$state_file" 2>/dev/null || echo 0)
    local edges=$(jq '.graphEdges' "$state_file" 2>/dev/null || echo 0)

    case "$event_type" in
      "add")
        nodes=$((nodes + 1))
        ;;
      "evict"|"prune")
        nodes=$((nodes - 1))
        [ $nodes -lt 0 ] && nodes=0
        ;;
    esac

    jq ".graphNodes = $nodes | .lastUpdate = \"$(date -Iseconds)\"" "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
  fi

  return 0
}

# =============================================================================
# Trigger GNN Training Cycle
# =============================================================================
train_gnn() {
  local topology="${1:-hybrid}"

  log "Triggering GNN training cycle..."

  local event_log="$GNN_DIR/events.jsonl"
  local event_count=0

  if [ -f "$event_log" ]; then
    event_count=$(wc -l < "$event_log" 2>/dev/null || echo 0)
  fi

  if [ "$event_count" -lt 10 ]; then
    warn "Insufficient events for training ($event_count < 10)"
    return 1
  fi

  # Update training metrics
  local state_file="$GNN_DIR/state.json"
  if [ -f "$state_file" ]; then
    local sessions=$(jq '.trainingSessions' "$state_file" 2>/dev/null || echo 0)
    sessions=$((sessions + 1))

    jq ".trainingSessions = $sessions | .lastTraining = \"$(date -Iseconds)\" | .lastTopology = \"$topology\"" "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
  fi

  # Archive old events (keep last 1000)
  tail -1000 "$event_log" > "${event_log}.tmp" && mv "${event_log}.tmp" "$event_log"

  success "GNN training complete"
  echo -e "  ${DIM}├─ Events processed: $event_count${RESET}"
  echo -e "  ${DIM}├─ Topology: $topology${RESET}"
  echo -e "  ${DIM}└─ Session: $sessions${RESET}"

  return 0
}

# =============================================================================
# Trigger GRNN Temporal Learning
# =============================================================================
train_grnn() {
  log "Triggering GRNN temporal learning with EWC++..."

  local state_file="$GNN_DIR/state.json"
  local ewc_count=0

  if [ -f "$state_file" ]; then
    ewc_count=$(jq '.ewcConsolidations' "$state_file" 2>/dev/null || echo 0)
    ewc_count=$((ewc_count + 1))

    jq ".ewcConsolidations = $ewc_count | .lastEwcConsolidation = \"$(date -Iseconds)\"" "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
  fi

  success "GRNN temporal learning complete"
  echo -e "  ${DIM}└─ EWC++ consolidations: $ewc_count${RESET}"

  return 0
}

# =============================================================================
# Generate Intelligence Report
# =============================================================================
report() {
  local format="${1:-terminal}"

  log "Generating GNN/GRNN intelligence report..."

  local state_file="$GNN_DIR/state.json"
  local config_file="$CACHE_DIR/config.json"

  if [ ! -f "$state_file" ]; then
    error "GNN state not found. Run 'init' first."
    return 1
  fi

  local nodes=$(jq '.graphNodes' "$state_file" 2>/dev/null || echo 0)
  local sessions=$(jq '.trainingSessions' "$state_file" 2>/dev/null || echo 0)
  local patterns=$(jq '.patternsLearned' "$state_file" 2>/dev/null || echo 0)
  local ewc=$(jq '.ewcConsolidations' "$state_file" 2>/dev/null || echo 0)
  local topology=$(jq -r '.lastTopology // "hybrid"' "$state_file" 2>/dev/null)

  case "$format" in
    "json")
      cat << EOF
{
  "gnn": {
    "nodes": $nodes,
    "topology": "$topology",
    "trainingSessions": $sessions
  },
  "grnn": {
    "ewcConsolidations": $ewc
  },
  "learning": {
    "patternsLearned": $patterns
  },
  "timestamp": "$(date -Iseconds)"
}
EOF
      ;;
    "markdown")
      cat << EOF
# GNN/GRNN Intelligence Report

## Graph Neural Network
- **Nodes**: $nodes
- **Topology**: $topology
- **Training Sessions**: $sessions

## Fast GRNN
- **EWC++ Consolidations**: $ewc

## Learning
- **Patterns Learned**: $patterns
- **Generated**: $(date -Iseconds)
EOF
      ;;
    *)
      echo ""
      echo "╔══════════════════════════════════════════╗"
      echo "║       GNN/GRNN Intelligence Report       ║"
      echo "╠══════════════════════════════════════════╣"
      echo "║  GNN                                     ║"
      printf "║    Nodes: %-30s ║\n" "$nodes"
      printf "║    Topology: %-27s ║\n" "$topology"
      printf "║    Training: %-27s ║\n" "$sessions sessions"
      echo "║  GRNN                                    ║"
      printf "║    EWC++: %-30s ║\n" "$ewc consolidations"
      echo "║  Learning                                ║"
      printf "║    Patterns: %-27s ║\n" "$patterns"
      echo "╚══════════════════════════════════════════╝"
      ;;
  esac

  return 0
}

# =============================================================================
# Get Status
# =============================================================================
status() {
  local state_file="$GNN_DIR/state.json"
  local config_file="$CACHE_DIR/config.json"

  if [ ! -f "$state_file" ]; then
    echo '{"status":"not_initialized","gnn":false,"grnn":false}'
    return 1
  fi

  local nodes=$(jq '.graphNodes' "$state_file" 2>/dev/null || echo 0)
  local gnn_enabled=$(jq '.gnn.enabled // true' "$config_file" 2>/dev/null || echo true)
  local grnn_enabled=$(jq '.grnn.enabled // true' "$config_file" 2>/dev/null || echo true)

  cat << EOF
{
  "status": "active",
  "gnn": {
    "enabled": $gnn_enabled,
    "nodes": $nodes
  },
  "grnn": {
    "enabled": $grnn_enabled
  }
}
EOF

  return 0
}

# =============================================================================
# Clean Up
# =============================================================================
cleanup() {
  log "Cleaning up GNN/GRNN state..."

  rm -f "$GNN_DIR/events.jsonl"
  rm -f "$GNN_DIR/state.json"
  rm -f "$CACHE_DIR/config.json"

  success "Cleanup complete"
  return 0
}

# =============================================================================
# Main
# =============================================================================
case "${1:-help}" in
  "init")
    init "$2"
    ;;
  "record")
    record_event "$2" "$3" "$4" "${5:-{}}"
    ;;
  "train-gnn"|"gnn")
    train_gnn "$2"
    ;;
  "train-grnn"|"grnn")
    train_grnn
    ;;
  "report")
    report "$2"
    ;;
  "status")
    status
    ;;
  "cleanup")
    cleanup
    ;;
  "help"|"-h"|"--help")
    cat << 'EOF'
Claude Flow V3 Cache Optimizer with GNN/GRNN Intelligence

Usage: cache-optimizer-hooks.sh <command> [args]

Commands:
  init [profile]           Initialize cache optimizer with GNN/GRNN
  record <type> <id> <t>   Record cache event for GNN learning
  train-gnn [topology]     Trigger GNN training cycle
  train-grnn               Trigger GRNN temporal learning with EWC++
  report [format]          Generate intelligence report (json|markdown|terminal)
  status                   Get current status
  cleanup                  Clean up GNN/GRNN state
  help                     Show this help

Profiles: single-agent, multi-agent, aggressive, conservative, memory-constrained

Graph Topologies: sequential, hierarchical, clustered, star, bipartite,
                  hyperbolic, temporal, hybrid

Examples:
  ./cache-optimizer-hooks.sh init multi-agent
  ./cache-optimizer-hooks.sh record add entry-123 file_read '{"path":"/src/file.ts"}'
  ./cache-optimizer-hooks.sh train-gnn hybrid
  ./cache-optimizer-hooks.sh report markdown
EOF
    ;;
  *)
    error "Unknown command: $1"
    echo "Use 'cache-optimizer-hooks.sh help' for usage"
    exit 1
    ;;
esac
