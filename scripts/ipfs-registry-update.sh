#!/bin/bash
# IPFS Registry Update Script for teammate-plugin
# Uses Pinata API to upload updated plugin registry

PINATA_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIzNWE4MDE3Zi01N2IzLTRlYzUtOGIxMS04MDA5NDhlZjFmODQiLCJlbWFpbCI6InJ1dkBydXYubmV0IiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBpbl9wb2xpY3kiOnsicmVnaW9ucyI6W3siZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiRlJBMSJ9LHsiZGVzaXJlZFJlcGxpY2F0aW9uQ291bnQiOjEsImlkIjoiTllDMSJ9XSwidmVyc2lvbiI6MX0sIm1mYV9lbmFibGVkIjpmYWxzZSwic3RhdHVzIjoiQUNUSVZFIn0sImF1dGhlbnRpY2F0aW9uVHlwZSI6InNjb3BlZEtleSIsInNjb3BlZEtleUtleSI6ImQ5MGEwNTU0N2JjYzBiNzkwODI1Iiwic2NvcGVkS2V5U2VjcmV0IjoiMzVlMTUyNjRiZDY2YmU2YTA3NTFjNWMzMzY5MzQ3M2Y0MzE1NTJmNmQ1ZDQ5MGQ4NWVkODBhMjAyOGU2ODg2MCIsImV4cCI6MTgwMDgwMzUxNn0.P8yUavU2zgrGzTy_cUAvpNZg-S2lopH_SduLyUlYHtI"

# Create the updated registry JSON
cat > /tmp/plugin-registry.json << 'EOF'
{
  "version": "1.0.1",
  "type": "plugins",
  "updatedAt": "2026-01-25T15:30:00.000Z",
  "ipnsName": "",
  "plugins": [
    {
      "id": "@claude-flow/teammate-plugin",
      "name": "@claude-flow/teammate-plugin",
      "displayName": "Teammate Plugin",
      "description": "Native TeammateTool integration for Claude Code v2.1.19+ with BMSSP WASM acceleration, rate limiting, circuit breaker, and 21 MCP tools",
      "version": "1.0.0-alpha.1",
      "size": 125000,
      "checksum": "sha256:teammate123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai", "development"],
      "tags": ["teammate", "claude-code", "mcp", "swarm", "bmssp"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-25T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": ["pre-task", "post-task"],
      "commands": ["teammate-status", "teammate-spawn"],
      "permissions": ["memory", "network", "filesystem"],
      "exports": ["TeammateManager", "TeammateBridge", "MCPServer"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/embeddings",
      "name": "@claude-flow/embeddings",
      "displayName": "Vector Embeddings",
      "description": "Vector embeddings with HNSW indexing, 150x-12,500x faster search",
      "version": "3.0.0-alpha.1",
      "size": 320000,
      "checksum": "sha256:embeddings123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["embeddings", "vectors", "hnsw"],
      "downloads": 2684,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": ["embeddings:embed", "embeddings:search"],
      "commands": ["embed", "search"],
      "permissions": ["memory", "filesystem"],
      "exports": ["EmbeddingService", "HNSWIndex"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-agentic-qe",
      "name": "@claude-flow/plugin-agentic-qe",
      "displayName": "Agentic QE",
      "description": "Quality Engineering with autonomous testing agents",
      "version": "3.0.0-alpha.4",
      "size": 95000,
      "checksum": "sha256:agenticqe123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "testing"],
      "tags": ["testing", "qa", "automation"],
      "downloads": 289,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": ["pre-test", "post-test"],
      "commands": ["qe-run"],
      "permissions": ["filesystem", "network"],
      "exports": ["QERunner"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-prime-radiant",
      "name": "@claude-flow/plugin-prime-radiant",
      "displayName": "Prime Radiant",
      "description": "Foundation AI planning and psychohistory modeling",
      "version": "0.1.5",
      "size": 120000,
      "checksum": "sha256:primeradiant123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["planning", "prediction", "foundation"],
      "downloads": 216,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["predict", "plan"],
      "permissions": ["memory"],
      "exports": ["PrimeRadiant"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/claims",
      "name": "@claude-flow/claims",
      "displayName": "Claims Authorization",
      "description": "Claims-based authorization system for agent permissions",
      "version": "3.0.0-alpha.8",
      "size": 65000,
      "checksum": "sha256:claims123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "security"],
      "tags": ["claims", "authorization"],
      "downloads": 156,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": [],
      "commands": ["claims-check"],
      "permissions": ["memory"],
      "exports": ["ClaimsService"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-gastown-bridge",
      "name": "@claude-flow/plugin-gastown-bridge",
      "displayName": "Gas Town Bridge",
      "description": "Bridge integration for Gas Town AI commerce",
      "version": "3.0.0-alpha.1",
      "size": 45000,
      "checksum": "sha256:gastown123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "commerce"],
      "tags": ["gastown", "payments", "beads"],
      "downloads": 150,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": ["pre-task", "post-task"],
      "commands": ["gastown-status"],
      "permissions": ["network", "memory"],
      "exports": ["GasTownBridge"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/neural",
      "name": "@claude-flow/neural",
      "displayName": "Neural Intelligence",
      "description": "SONA neural learning with pattern recognition",
      "version": "3.0.0-alpha.7",
      "size": 180000,
      "checksum": "sha256:neural123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["neural", "sona", "learning"],
      "downloads": 94,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": ["neural:train"],
      "commands": ["neural-train"],
      "permissions": ["memory", "filesystem"],
      "exports": ["NeuralService"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugins",
      "name": "@claude-flow/plugins",
      "displayName": "Plugin Manager",
      "description": "Plugin management and lifecycle",
      "version": "3.0.0-alpha.1",
      "size": 55000,
      "checksum": "sha256:plugins123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official"],
      "tags": ["plugins", "management"],
      "downloads": 44,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": [],
      "commands": ["plugins"],
      "permissions": ["filesystem"],
      "exports": ["PluginManager"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/security",
      "name": "@claude-flow/security",
      "displayName": "Security Module",
      "description": "Security with CVE remediation, input validation",
      "version": "3.0.0-alpha.1",
      "size": 85000,
      "checksum": "sha256:security123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "security"],
      "tags": ["security", "validation", "cve"],
      "downloads": 520,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": ["pre-command"],
      "commands": ["security-scan"],
      "permissions": ["filesystem"],
      "exports": ["InputValidator", "PathValidator"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/performance",
      "name": "@claude-flow/performance",
      "displayName": "Performance",
      "description": "Performance profiling and optimization",
      "version": "3.0.0-alpha.1",
      "size": 75000,
      "checksum": "sha256:performance123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official"],
      "tags": ["performance", "profiling"],
      "downloads": 22,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "command",
      "hooks": [],
      "commands": ["benchmark"],
      "permissions": ["memory"],
      "exports": ["Profiler"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-healthcare-clinical",
      "name": "@claude-flow/plugin-healthcare-clinical",
      "displayName": "Healthcare Clinical",
      "description": "Clinical decision support and medical analysis",
      "version": "0.1.0",
      "size": 200000,
      "checksum": "sha256:healthcare123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "healthcare"],
      "tags": ["healthcare", "clinical", "medical"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["clinical-analyze"],
      "permissions": ["memory", "network"],
      "exports": ["ClinicalAnalyzer"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-financial-risk",
      "name": "@claude-flow/plugin-financial-risk",
      "displayName": "Financial Risk",
      "description": "Financial risk assessment and modeling",
      "version": "0.1.0",
      "size": 150000,
      "checksum": "sha256:financial123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "finance"],
      "tags": ["finance", "risk", "modeling"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["risk-assess"],
      "permissions": ["memory", "network"],
      "exports": ["RiskAssessor"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-legal-contracts",
      "name": "@claude-flow/plugin-legal-contracts",
      "displayName": "Legal Contracts",
      "description": "Legal contract analysis and generation",
      "version": "0.1.0",
      "size": 130000,
      "checksum": "sha256:legal123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "legal"],
      "tags": ["legal", "contracts", "analysis"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["contract-analyze"],
      "permissions": ["memory", "filesystem"],
      "exports": ["ContractAnalyzer"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-code-intelligence",
      "name": "@claude-flow/plugin-code-intelligence",
      "displayName": "Code Intelligence",
      "description": "Advanced code analysis and intelligence",
      "version": "0.1.0",
      "size": 180000,
      "checksum": "sha256:codeintel123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "development"],
      "tags": ["code", "intelligence", "analysis"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": ["pre-edit", "post-edit"],
      "commands": ["code-analyze"],
      "permissions": ["filesystem"],
      "exports": ["CodeIntelligence"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-test-intelligence",
      "name": "@claude-flow/plugin-test-intelligence",
      "displayName": "Test Intelligence",
      "description": "Intelligent test generation and coverage",
      "version": "0.1.0",
      "size": 140000,
      "checksum": "sha256:testintel123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "testing"],
      "tags": ["testing", "intelligence", "coverage"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["test-generate"],
      "permissions": ["filesystem"],
      "exports": ["TestIntelligence"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-perf-optimizer",
      "name": "@claude-flow/plugin-perf-optimizer",
      "displayName": "Performance Optimizer",
      "description": "AI-powered performance optimization",
      "version": "0.1.0",
      "size": 160000,
      "checksum": "sha256:perfopt123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official"],
      "tags": ["performance", "optimization"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["perf-optimize"],
      "permissions": ["memory", "filesystem"],
      "exports": ["PerfOptimizer"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-neural-coordinator",
      "name": "@claude-flow/plugin-neural-coordinator",
      "displayName": "Neural Coordinator",
      "description": "Multi-agent neural coordination",
      "version": "0.1.0",
      "size": 190000,
      "checksum": "sha256:neuralcoord123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["neural", "coordination", "multi-agent"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["neural-coord"],
      "permissions": ["memory", "network"],
      "exports": ["NeuralCoordinator"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-cognitive-kernel",
      "name": "@claude-flow/plugin-cognitive-kernel",
      "displayName": "Cognitive Kernel",
      "description": "Core cognitive processing kernel",
      "version": "0.1.0",
      "size": 250000,
      "checksum": "sha256:cognitive123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["cognitive", "kernel", "core"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "core",
      "hooks": [],
      "commands": ["cognitive-process"],
      "permissions": ["memory"],
      "exports": ["CognitiveKernel"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-quantum-optimizer",
      "name": "@claude-flow/plugin-quantum-optimizer",
      "displayName": "Quantum Optimizer",
      "description": "Quantum-inspired optimization algorithms",
      "version": "0.1.0",
      "size": 170000,
      "checksum": "sha256:quantum123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["quantum", "optimization"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["quantum-optimize"],
      "permissions": ["memory"],
      "exports": ["QuantumOptimizer"],
      "verified": true,
      "trustLevel": "official"
    },
    {
      "id": "@claude-flow/plugin-hyperbolic-reasoning",
      "name": "@claude-flow/plugin-hyperbolic-reasoning",
      "displayName": "Hyperbolic Reasoning",
      "description": "Hyperbolic space reasoning for hierarchical data",
      "version": "0.1.0",
      "size": 140000,
      "checksum": "sha256:hyperbolic123",
      "author": {
        "id": "claude-flow-team",
        "displayName": "Claude Flow Team",
        "verified": true
      },
      "license": "MIT",
      "categories": ["official", "ai"],
      "tags": ["hyperbolic", "reasoning", "hierarchical"],
      "downloads": 0,
      "rating": 5,
      "lastUpdated": "2026-01-24T15:30:00.000Z",
      "minClaudeFlowVersion": "3.0.0",
      "type": "integration",
      "hooks": [],
      "commands": ["hyperbolic-reason"],
      "permissions": ["memory"],
      "exports": ["HyperbolicReasoner"],
      "verified": true,
      "trustLevel": "official"
    }
  ],
  "categories": [
    {"id": "official", "name": "Official", "description": "Official Claude Flow plugins", "pluginCount": 20},
    {"id": "ai", "name": "AI & ML", "description": "AI and machine learning plugins", "pluginCount": 8},
    {"id": "security", "name": "Security", "description": "Security and validation plugins", "pluginCount": 2},
    {"id": "commerce", "name": "Commerce", "description": "Payment and commerce integrations", "pluginCount": 1},
    {"id": "testing", "name": "Testing", "description": "Testing and QA plugins", "pluginCount": 2},
    {"id": "healthcare", "name": "Healthcare", "description": "Healthcare and medical plugins", "pluginCount": 1},
    {"id": "finance", "name": "Finance", "description": "Financial plugins", "pluginCount": 1},
    {"id": "legal", "name": "Legal", "description": "Legal and compliance plugins", "pluginCount": 1},
    {"id": "development", "name": "Development", "description": "Development tools", "pluginCount": 2}
  ],
  "totalPlugins": 20,
  "totalDownloads": 4175,
  "featured": ["@claude-flow/teammate-plugin", "@claude-flow/embeddings", "@claude-flow/plugin-gastown-bridge", "@claude-flow/neural"],
  "trending": ["@claude-flow/embeddings", "@claude-flow/security", "@claude-flow/plugin-agentic-qe"],
  "newest": ["@claude-flow/teammate-plugin", "@claude-flow/plugin-gastown-bridge", "@claude-flow/plugin-hyperbolic-reasoning"],
  "official": ["@claude-flow/teammate-plugin", "@claude-flow/embeddings", "@claude-flow/plugin-agentic-qe", "@claude-flow/plugin-prime-radiant", "@claude-flow/claims", "@claude-flow/plugin-gastown-bridge", "@claude-flow/neural", "@claude-flow/plugins", "@claude-flow/security", "@claude-flow/performance", "@claude-flow/plugin-healthcare-clinical", "@claude-flow/plugin-financial-risk", "@claude-flow/plugin-legal-contracts", "@claude-flow/plugin-code-intelligence", "@claude-flow/plugin-test-intelligence", "@claude-flow/plugin-perf-optimizer", "@claude-flow/plugin-neural-coordinator", "@claude-flow/plugin-cognitive-kernel", "@claude-flow/plugin-quantum-optimizer", "@claude-flow/plugin-hyperbolic-reasoning"]
}
EOF

echo "Registry JSON created at /tmp/plugin-registry.json"
echo "Uploading to Pinata..."

# Upload to Pinata
RESPONSE=$(curl -s -X POST "https://api.pinata.cloud/pinning/pinJSONToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -H "Content-Type: application/json" \
  -d @/tmp/plugin-registry.json)

echo "Pinata Response:"
echo "$RESPONSE"

# Extract CID
NEW_CID=$(echo "$RESPONSE" | grep -o '"IpfsHash":"[^"]*"' | cut -d'"' -f4)

if [ -n "$NEW_CID" ]; then
  echo ""
  echo "======================================"
  echo "SUCCESS! New IPFS CID: $NEW_CID"
  echo "======================================"
  echo ""
  echo "Update LIVE_REGISTRY_CID in discovery.ts to:"
  echo "  const LIVE_REGISTRY_CID = '$NEW_CID';"
  echo ""
  echo "Gateway URL: https://gateway.pinata.cloud/ipfs/$NEW_CID"
else
  echo "ERROR: Failed to extract CID from response"
fi
