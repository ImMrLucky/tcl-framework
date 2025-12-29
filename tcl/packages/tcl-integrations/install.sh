#!/bin/bash
# Quick installation script for server deployment

set -e  # Exit on error

echo "🚀 Installing TCL Integrations Service..."

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Error: Node.js 18+ required. Current version: $(node -v)"
  exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Check if package.json exists
if [ ! -f "package.json" ]; then
  echo "❌ Error: package.json not found. Are you in the correct directory?"
  exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Check environment variables
echo "🔍 Checking environment variables..."
if [ -z "$SUPABASE_URL" ]; then
  echo "⚠️  Warning: SUPABASE_URL not set"
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "⚠️  Warning: SUPABASE_SERVICE_ROLE_KEY not set"
fi

# Verify build output
if [ ! -d "dist" ] || [ ! -f "dist/server/express.js" ]; then
  echo "❌ Error: Build failed. dist/server/express.js not found"
  exit 1
fi

echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "1. Set environment variables (see .env.example)"
echo "2. Run database migrations in Supabase"
echo "3. Start service: npm start"
echo ""

