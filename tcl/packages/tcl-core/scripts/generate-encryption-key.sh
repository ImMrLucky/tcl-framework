#!/bin/bash
# Generate a secure encryption key for INTEGRATIONS_ENCRYPTION_KEY
# This creates a 32-byte (256-bit) random key and encodes it in base64

echo "Generating INTEGRATIONS_ENCRYPTION_KEY..."
KEY=$(openssl rand -base64 32)
echo ""
echo "Add this to your environment variables:"
echo "INTEGRATIONS_ENCRYPTION_KEY=$KEY"
echo ""
echo "⚠️  IMPORTANT: Store this key securely! If you lose it, you cannot decrypt existing secrets."
echo "⚠️  Do NOT commit this key to version control!"

