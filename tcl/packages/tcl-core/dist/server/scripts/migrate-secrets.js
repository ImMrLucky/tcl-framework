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
import { supabaseAdmin } from '../supabase.js';
import { encryptSecret, decryptSecret } from '../security/secret-crypto.js';
async function migrateSecrets() {
    if (!supabaseAdmin) {
        console.error('Supabase not configured');
        process.exit(1);
    }
    // Check if encryption key is set
    if (!process.env.INTEGRATIONS_ENCRYPTION_KEY) {
        console.error('INTEGRATIONS_ENCRYPTION_KEY environment variable is not set');
        process.exit(1);
    }
    console.log('Starting secret migration...');
    // Get all secrets that are not encrypted (don't start with v1:)
    const { data: secrets, error } = await supabaseAdmin
        .from('integration_secrets')
        .select('id, org_id, integration_kind, key, ciphertext');
    if (error) {
        console.error('Failed to fetch secrets:', error);
        process.exit(1);
    }
    if (!secrets || secrets.length === 0) {
        console.log('No secrets found to migrate');
        return;
    }
    console.log(`Found ${secrets.length} secrets to check`);
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    for (const secret of secrets) {
        // Check if already encrypted
        if (secret.ciphertext.startsWith('v1:')) {
            skipped++;
            continue;
        }
        try {
            // Verify we can read it (should work with ALLOW_PLAINTEXT_SECRETS=true)
            const plaintext = decryptSecret(secret.ciphertext);
            // Encrypt it
            const encrypted = encryptSecret(plaintext);
            // Update in database
            const { error: updateError } = await supabaseAdmin
                .from('integration_secrets')
                .update({ ciphertext: encrypted })
                .eq('id', secret.id);
            if (updateError) {
                console.error(`Failed to update secret ${secret.id} (${secret.integration_kind}/${secret.key}):`, updateError);
                errors++;
            }
            else {
                console.log(`✓ Migrated ${secret.integration_kind}/${secret.key} for org ${secret.org_id}`);
                migrated++;
            }
        }
        catch (error) {
            console.error(`Failed to migrate secret ${secret.id} (${secret.integration_kind}/${secret.key}):`, error.message);
            errors++;
        }
    }
    console.log('\nMigration complete:');
    console.log(`  Migrated: ${migrated}`);
    console.log(`  Skipped (already encrypted): ${skipped}`);
    console.log(`  Errors: ${errors}`);
    if (errors > 0) {
        console.warn('\n⚠ Some secrets failed to migrate. Review errors above.');
        process.exit(1);
    }
    else {
        console.log('\n✓ All secrets migrated successfully!');
    }
}
// Run migration
migrateSecrets().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
