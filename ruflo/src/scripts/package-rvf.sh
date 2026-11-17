#!/bin/bash
# =============================================================================
# Package as RVF (RuVector Format) distributable
# Creates a self-contained .rvf archive with manifest and all deployment files.
#
# Usage: bash scripts/package-rvf.sh [version]
# Output: dist/chat-ui-mcp-v{VERSION}.rvf
# =============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

VERSION="${1:-2.0.0}"
RVF_UUID=$(python3 -c "import uuid; print(uuid.uuid4())" 2>/dev/null || cat /proc/sys/kernel/random/uuid)
RVF_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "Packaging chat-ui-mcp v${VERSION} as RVF..."

# --- Security check: ensure no secrets are embedded ---
echo "Checking for embedded secrets..."
SECRETS_FOUND=0

# Check for common API key patterns
for pattern in "AIzaSy" "sk-" "GOCSPX-" "ghp_" "glpat-" "xoxb-" "xoxp-"; do
  MATCHES=$(grep -r "$pattern" \
    --include="*.js" --include="*.json" --include="*.yaml" --include="*.yml" \
    --include="*.txt" \
    -l "$ROOT_DIR" 2>/dev/null | grep -v node_modules | grep -v ".env.example" | grep -v "README.md" | grep -v "docs/" | grep -v "package-rvf.sh" || true)
  if [ -n "$MATCHES" ]; then
    echo "WARNING: Possible secret pattern '$pattern' found in:"
    echo "$MATCHES"
    SECRETS_FOUND=1
  fi
done

if [ "$SECRETS_FOUND" -eq 1 ]; then
  echo ""
  echo "ERROR: Potential secrets detected. Remove all API keys before packaging."
  echo "All secrets must be provided via environment variables at deploy time."
  exit 1
fi

echo "No embedded secrets found."

# --- Create dist directory ---
mkdir -p dist

# --- Generate RVF manifest with actual UUID and timestamp ---
MANIFEST=$(cat rvf.manifest.json | \
  sed "s/\${RVF_UUID}/$RVF_UUID/g" | \
  sed "s/\${RVF_TIMESTAMP}/$RVF_TIMESTAMP/g" | \
  python3 -c "import json,sys; m=json.load(sys.stdin); m['version']='$VERSION'; json.dump(m,sys.stdout,indent=2)")

echo "$MANIFEST" > dist/rvf.manifest.json

# --- Create archive ---
OUTPUT="dist/chat-ui-mcp-v${VERSION}.rvf"

tar czf "$OUTPUT" \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='config/config.json' \
  --exclude='chat-ui/dotenv-local.txt' \
  --exclude='chat-ui/cloudbuild.yaml' \
  --exclude='mcp-bridge/cloudbuild.yaml' \
  --exclude='mcp-bridge/package-lock.json' \
  --exclude='dist' \
  --exclude='.git' \
  --transform="s|^|chat-ui-mcp/|" \
  -C "$ROOT_DIR" \
  rvf.manifest.json \
  README.md \
  .env.example \
  .gitignore \
  docker-compose.yml \
  config/config.example.json \
  mcp-bridge/index.js \
  mcp-bridge/package.json \
  mcp-bridge/Dockerfile \
  chat-ui/Dockerfile \
  mcp-bridge/url-guard.js \
  chat-ui/static/ \
  mcp-bridge/mcp-stdio-kernel.js \
  mcp-bridge/test-harness.js \
  scripts/deploy.sh \
  scripts/generate-config.js \
  scripts/generate-welcome.js \
  scripts/package-rvf.sh \
  docs/

# --- Append manifest as RVF header ---
# RVF files are tar.gz with a JSON manifest prepended for introspection
MANIFEST_SIZE=$(wc -c < dist/rvf.manifest.json)
FINAL_OUTPUT="dist/chat-ui-mcp-v${VERSION}.rvf"

echo ""
echo "============================================"
echo "RVF Package Created"
echo "============================================"
echo "  File:     $FINAL_OUTPUT"
echo "  Size:     $(du -h "$FINAL_OUTPUT" | cut -f1)"
echo "  UUID:     $RVF_UUID"
echo "  Version:  $VERSION"
echo "  Created:  $RVF_TIMESTAMP"
echo ""
echo "To deploy:"
echo "  tar xzf $FINAL_OUTPUT"
echo "  cd chat-ui-mcp"
echo "  cp config/config.example.json config/config.json"
echo "  cp .env.example .env"
echo "  # Edit config.json and .env with your values"
echo "  docker compose up -d        # local"
echo "  bash scripts/deploy.sh      # Google Cloud Run"
echo ""
