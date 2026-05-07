import crypto from 'crypto';
/**
 * Encryption key for integration secrets
 * Must be a base64-encoded 32-byte key (256 bits for AES-256)
 * Set via INTEGRATIONS_ENCRYPTION_KEY environment variable
 */
const ENCRYPTION_KEY = process.env.INTEGRATIONS_ENCRYPTION_KEY
    ? Buffer.from(process.env.INTEGRATIONS_ENCRYPTION_KEY, 'base64')
    : null;
/**
 * Allow plaintext secrets for migration grace period
 * Set ALLOW_PLAINTEXT_SECRETS=true to allow reading unencrypted secrets
 * Default: false (fail closed)
 */
const ALLOW_PLAINTEXT_SECRETS = process.env.ALLOW_PLAINTEXT_SECRETS === 'true';
/**
 * Algorithm for encryption
 */
const ALGORITHM = 'aes-256-gcm';
/**
 * IV length in bytes (12 bytes recommended for GCM)
 */
const IV_LENGTH = 12;
/**
 * Tag length in bytes (16 bytes for GCM)
 */
const TAG_LENGTH = 16;
/**
 * Encrypt a secret value using AES-256-GCM
 *
 * Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
 *
 * @param plain - Plaintext secret to encrypt
 * @returns Encrypted string in v1 format
 * @throws Error if encryption key is not configured
 */
export function encryptSecret(plain) {
    if (!ENCRYPTION_KEY) {
        throw new Error('INTEGRATIONS_ENCRYPTION_KEY environment variable is not set');
    }
    if (ENCRYPTION_KEY.length !== 32) {
        throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    // Generate random IV
    const iv = crypto.randomBytes(IV_LENGTH);
    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    // Encrypt
    let ciphertext = cipher.update(plain, 'utf8');
    ciphertext = Buffer.concat([ciphertext, cipher.final()]);
    // Get authentication tag
    const tag = cipher.getAuthTag();
    // Encode components in base64
    const ivB64 = iv.toString('base64');
    const tagB64 = tag.toString('base64');
    const cipherB64 = ciphertext.toString('base64');
    // Return v1 format
    return `v1:${ivB64}:${tagB64}:${cipherB64}`;
}
/**
 * Decrypt a secret value from v1 format
 *
 * @param ciphertext - Encrypted string in v1 format
 * @returns Decrypted plaintext
 * @throws Error if decryption fails or format is invalid
 */
export function decryptSecret(ciphertext) {
    // If ciphertext doesn't match v1 format, handle based on ALLOW_PLAINTEXT_SECRETS
    if (!ciphertext.startsWith('v1:')) {
        if (ALLOW_PLAINTEXT_SECRETS) {
            // Migration grace window: treat as plaintext
            console.warn(`Warning: Reading plaintext secret (migration mode). Secret should be encrypted.`);
            return ciphertext;
        }
        else {
            throw new Error('Secret is not in encrypted format (v1:*) and ALLOW_PLAINTEXT_SECRETS is false');
        }
    }
    if (!ENCRYPTION_KEY) {
        throw new Error('INTEGRATIONS_ENCRYPTION_KEY environment variable is not set');
    }
    if (ENCRYPTION_KEY.length !== 32) {
        throw new Error('INTEGRATIONS_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    // Parse v1 format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Invalid encrypted secret format');
    }
    const [, ivB64, tagB64, cipherB64] = parts;
    try {
        // Decode components
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const encrypted = Buffer.from(cipherB64, 'base64');
        // Create decipher
        const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
        decipher.setAuthTag(tag);
        // Decrypt
        let plaintext = decipher.update(encrypted);
        plaintext = Buffer.concat([plaintext, decipher.final()]);
        return plaintext.toString('utf8');
    }
    catch (error) {
        throw new Error(`Failed to decrypt secret: ${error.message}`);
    }
}
