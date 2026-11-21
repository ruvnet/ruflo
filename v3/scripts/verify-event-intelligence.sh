#!/usr/bin/env bash
# Reproducible event gateway verification against the pinned V3 pnpm lockfile.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  printf 'Node.js 22 or newer required for this verification profile, got %s\n' "$(node --version)" >&2
  exit 2
fi

PNPM_VERSION="$(corepack pnpm --version)"
if [[ "$PNPM_VERSION" != 8.* ]]; then
  printf 'Expected pnpm 8 from packageManager, got %s\n' "$PNPM_VERSION" >&2
  exit 2
fi

corepack pnpm install --filter '@claude-flow/cli...' --frozen-lockfile --ignore-scripts
corepack pnpm exec tsc --build \
  ./@claude-flow/cli-core/tsconfig.json \
  ./@claude-flow/swarm/tsconfig.json \
  ./@claude-flow/shared/tsconfig.json \
  ./@claude-flow/memory/tsconfig.json \
  ./@claude-flow/neural/tsconfig.json
corepack pnpm exec tsc --noEmit --project ./@claude-flow/cli/tsconfig.json
corepack pnpm exec tsc --project ./@claude-flow/cli/tsconfig.json
(
  cd @claude-flow/cli
  corepack pnpm exec vitest run \
    __tests__/event-gateway.test.ts \
    __tests__/event-gateway-cli.test.ts \
    __tests__/event-gateway-benchmark.test.ts \
    --maxWorkers=1
)
