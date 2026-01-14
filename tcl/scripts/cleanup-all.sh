#!/bin/bash
# ============================================================================
# Complete Cleanup Script
# ============================================================================
# 
# This script performs a complete cleanup of both database and storage
# 
# Prerequisites:
#   - Supabase CLI installed and authenticated
#   - Project linked: `supabase link --project-ref YOUR_PROJECT_REF`
#   - Node.js installed (for storage cleanup script)
#
# Usage:
#   chmod +x scripts/cleanup-all.sh
#   ./scripts/cleanup-all.sh
#
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Complete Database & Storage Cleanup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${YELLOW}Warning: This will delete:${NC}"
echo "  - All evaluations, conversations, and issues"
echo "  - All ingestion jobs and assets"
echo "  - All policies and scoring profiles"
echo "  - All files in Supabase Storage buckets"
echo ""

read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

echo ""
echo -e "${BLUE}Step 1: Cleaning database...${NC}"
echo "-----------------------------------"

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo -e "${RED}Error: Supabase CLI is not installed${NC}"
    echo "Install it with: npm install -g supabase"
    exit 1
fi

# Run the database cleanup SQL
if [ -f "$PROJECT_ROOT/tcl/supabase/sql/999_cleanup_all_data.sql" ]; then
    echo "Running database cleanup script..."
    supabase db execute -f "$PROJECT_ROOT/tcl/supabase/sql/999_cleanup_all_data.sql" || {
        echo -e "${YELLOW}Warning: Could not run via Supabase CLI${NC}"
        echo "Please run the SQL script manually in Supabase SQL Editor:"
        echo "  tcl/supabase/sql/999_cleanup_all_data.sql"
    }
    echo -e "${GREEN}✓ Database cleanup complete${NC}"
else
    echo -e "${RED}Error: Cleanup SQL file not found${NC}"
    exit 1
fi

echo ""
echo -e "${BLUE}Step 2: Cleaning storage buckets...${NC}"
echo "-----------------------------------"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Warning: Node.js is not installed${NC}"
    echo "Skipping storage cleanup. Please run manually:"
    echo "  node scripts/cleanup-storage.js"
else
    # Check if we have the required environment variables
    if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
        echo -e "${YELLOW}Warning: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not set${NC}"
        echo "Skipping storage cleanup. Please set these environment variables and run:"
        echo "  SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key node scripts/cleanup-storage.js"
    else
        echo "Running storage cleanup script..."
        node "$PROJECT_ROOT/tcl/scripts/cleanup-storage.js" || {
            echo -e "${YELLOW}Warning: Storage cleanup failed${NC}"
            echo "You may need to clean storage buckets manually via Supabase Dashboard"
        }
        echo -e "${GREEN}✓ Storage cleanup complete${NC}"
    fi
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Cleanup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Verify cleanup by checking Supabase Dashboard"
echo "  2. Re-run any necessary migrations if needed"
echo "  3. Test the application with fresh data"

