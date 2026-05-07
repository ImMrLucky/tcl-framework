/**
 * Encrypt a secret value using AES-256-GCM
 *
 * Format: v1:<iv_b64>:<tag_b64>:<cipher_b64>
 *
 * @param plain - Plaintext secret to encrypt
 * @returns Encrypted string in v1 format
 * @throws Error if encryption key is not configured
 */
export declare function encryptSecret(plain: string): string;
/**
 * Decrypt a secret value from v1 format
 *
 * @param ciphertext - Encrypted string in v1 format
 * @returns Decrypted plaintext
 * @throws Error if decryption fails or format is invalid
 */
export declare function decryptSecret(ciphertext: string): string;
