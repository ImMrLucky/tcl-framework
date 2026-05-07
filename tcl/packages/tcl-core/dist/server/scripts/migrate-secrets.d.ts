/**
 * Migration script to encrypt existing plaintext secrets
 *
 * This script reads all integration_secrets that are not in v1: format
 * and encrypts them in-place.
 *
 * Usage:
 *   - Set ALLOW_PLAINTEXT_SECRETS=true temporarily
 *   - Run this script: npx tsx src/server/scripts/migrate-secrets.ts
 *   - Verify all secrets are encrypted
 *   - Set ALLOW_PLAINTEXT_SECRETS=false
 */
export {};
