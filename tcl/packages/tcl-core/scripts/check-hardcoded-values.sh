#!/bin/bash
# Hard-Coded Values Checker (Shell version)
# 
# Simple grep-based check for hard-coded thresholds and clamps.
# Can be run in CI/CD pipelines without TypeScript compilation.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../src"
VIOLATIONS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔍 Checking for hard-coded thresholds and clamps..."
echo ""

# Check for hard-coded threshold values in orchestrator outputs
check_pattern() {
  local pattern="$1"
  local message="$2"
  local exclude="$3"
  
  local matches=$(grep -rn "$pattern" "$SRC_DIR" --include="*.ts" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=__tests__ --exclude-dir=test --exclude-dir=tests --exclude="$exclude" 2>/dev/null || true)
  
  if [ -n "$matches" ]; then
    echo -e "${RED}❌ $message${NC}"
    echo "$matches" | while IFS= read -r line; do
      echo "   $line"
    done
    echo ""
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
}

# Check 1: Hard-coded supportThreshold
check_pattern "supportThreshold:\\s*0\\.(6[0-9]|7[0-9]|8[0-9]|9[0-9])" \
  "Hard-coded supportThreshold found. Use config.thresholds.support instead." \
  "template-config.ts"

# Check 2: Hard-coded contradictionThreshold
check_pattern "contradictionThreshold:\\s*0\\.(5[5-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9])" \
  "Hard-coded contradictionThreshold found. Use config.thresholds.contradiction instead." \
  "template-config.ts"

# Check 3: Hard-coded groundingThreshold
check_pattern "groundingThreshold:\\s*0\\.(2[0-9]|3[0-9]|4[0-9]|5[0-9]|6[0-9])" \
  "Hard-coded groundingThreshold found. Use config.thresholds.grounding instead." \
  "template-config.ts"

# Check 4: Hard-coded clamps (Math.min with config.thresholds)
check_pattern "Math\\.min\\(config\\.thresholds\\.[^,]+,\\s*0\\.[0-9]+\\)" \
  "Hard-coded clamp found. Use config-based clamping instead." \
  "template-config.ts"

# Check 5: Hard-coded clamps (Math.max with config.thresholds)
check_pattern "Math\\.max\\(config\\.thresholds\\.[^,]+,\\s*0\\.[0-9]+\\)" \
  "Hard-coded clamp found. Use config-based clamping instead." \
  "template-config.ts"

# Check 6: Common hard-coded threshold values (0.65, 0.70, 0.60, etc.)
# Exclude test files and comments
check_pattern "\\b(0\\.65|0\\.70|0\\.60|0\\.75|0\\.80)\\s*[;,\\)]" \
  "Hard-coded threshold value found. Use config values instead." \
  "template-config.ts|*.test.ts|*.spec.ts"

if [ $VIOLATIONS -eq 0 ]; then
  echo -e "${GREEN}✅ No hard-coded values found!${NC}"
  exit 0
else
  echo -e "${RED}❌ Found $VIOLATIONS violation(s)${NC}"
  echo ""
  echo -e "${YELLOW}💡 Fix: Replace hard-coded values with config-based values from template-config.ts${NC}"
  exit 1
fi

