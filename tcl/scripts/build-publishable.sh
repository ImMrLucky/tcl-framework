#!/usr/bin/env bash
# Build all packages intended for npm publish (run from repo root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing workspace dependencies..."
npm install

PACKAGES=(
  packages/agent-core
  packages/agent-context
  packages/agent-orchestrator
  packages/agent-workflows
  packages/agent-mcp
  packages/agent-integrations
  packages/agent-model-router
  packages/tcl-core
  packages/tcl-sdk
  packages/agent-runner-local
  packages/tcl-integrations
  packages/tcl-ui
  packages/tcl-browser-runner
)

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "==> Building $pkg"
  npm run build -w "$pkg"
done

echo ""
echo "Done. NLI service packages (tcl-nli-*) ship source — no build step."
