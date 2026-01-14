#!/bin/bash
# ============================================================================
# Supabase Storage Cleanup Script
# ============================================================================
# 
# This script clears all files from Supabase Storage buckets
# 
# Prerequisites:
#   - Supabase CLI installed and authenticated
#   - Project linked: `supabase link --project-ref YOUR_PROJECT_REF`
#
# Usage:
#   chmod +x scripts/cleanup-storage.sh
#   ./scripts/cleanup-storage.sh
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Supabase Storage Cleanup${NC}"
echo "================================"
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI is not installed${NC}"
    echo "Install it with: npm install -g supabase"
    exit 1
fi

# Buckets to clean
BUCKETS=(
    "protectqa-audio"
    "protectqa-transcripts"
    "protectqa-evidence"
    "protectqa-exports"
)

echo -e "${YELLOW}Warning: This will delete ALL files from the following buckets:${NC}"
for bucket in "${BUCKETS[@]}"; do
    echo "  - $bucket"
done
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo "Cleaning storage buckets..."

# Clean each bucket
for bucket in "${BUCKETS[@]}"; do
    echo -e "${YELLOW}Cleaning bucket: $bucket${NC}"
    
    # List all files in the bucket
    FILES=$(supabase storage ls "$bucket" --recursive 2>/dev/null || echo "")
    
    if [ -z "$FILES" ]; then
        echo -e "${GREEN}  ✓ Bucket '$bucket' is already empty${NC}"
        continue
    fi
    
    # Delete all files (this is a workaround - Supabase CLI doesn't have a direct "delete all" command)
    # We'll need to list and delete each file
    echo "$FILES" | while read -r file; do
        if [ -n "$file" ]; then
            echo "  Deleting: $file"
            supabase storage rm "$bucket/$file" 2>/dev/null || true
        fi
    done
    
    echo -e "${GREEN}  ✓ Bucket '$bucket' cleaned${NC}"
done

echo ""
echo -e "${GREEN}Storage cleanup complete!${NC}"

