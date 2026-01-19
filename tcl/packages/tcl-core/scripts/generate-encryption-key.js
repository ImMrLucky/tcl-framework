#!/usr/bin/env node
/**
 * Generate a secure encryption key for INTEGRATIONS_ENCRYPTION_KEY
 * This creates a 32-byte (256-bit) random key and encodes it in base64
 */

const crypto = require('crypto');

const key = crypto.randomBytes(32).toString('base64');

console.log('\n✅ Generated INTEGRATIONS_ENCRYPTION_KEY:');
console.log(key);
console.log('\n📋 Add this to your environment variables:');
console.log(`INTEGRATIONS_ENCRYPTION_KEY=${key}`);
console.log('\n⚠️  IMPORTANT:');
console.log('   - Store this key securely!');
console.log('   - If you lose it, you cannot decrypt existing secrets.');
console.log('   - Do NOT commit this key to version control!');
console.log('   - Use a secrets manager in production (Railway, AWS Secrets Manager, etc.)\n');

