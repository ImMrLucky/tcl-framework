#!/usr/bin/env bash
# Publish all @protectqa packages to npm (public access, dependency order).
# Prereqs: npm login, ./scripts/build-publishable.sh, unique versions not yet on registry.
#
# Optional: DRY_RUN=1 ./scripts/publish-npm.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export NPM_CONFIG_ACCESS=public

PACKAGES=(
  packages/agent-core
  packages/agent-context
  packages/agent-orchestrator
  packages/agent-workflows
  packages/agent-mcp
  packages/agent-integrations
  packages/agent-model-router
  packages/tcl-nli-service
  packages/tcl-nli-hf
  packages/tcl-nli-local
  packages/tcl-integrations
  packages/tcl-core
  packages/tcl-sdk
  packages/agent-runner-local
  packages/tcl-browser-runner
  packages/tcl-ui
)

publish_pkg() {
  local dir="$1"
  local pkg_json="$ROOT/$dir/package.json"
  local name version
  name="$(node -pe "require('$pkg_json').name")"
  version="$(node -pe "require('$pkg_json').version")"

  echo ""
  echo "==> ${name}@${version}  (${dir})"

  if [[ "${DRY_RUN:-}" == "1" ]]; then
    npm publish --workspace="$dir" --access=public --dry-run
    return 0
  fi

  # Scoped packages must be published with public access (also set in each package.json publishConfig).
  npm publish --workspace="$dir" --access=public --registry=https://registry.npmjs.org/
}

echo "Publishing with NPM_CONFIG_ACCESS=public"
for dir in "${PACKAGES[@]}"; do
  publish_pkg "$dir"
done

echo ""
echo "Done. Verify: npm view @protectqa/agent-runner-local version"
