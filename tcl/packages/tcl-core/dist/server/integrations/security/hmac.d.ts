/**
 * HMAC Signature Verification for Webhooks
 * Implements X-ProtectQA-Signature and X-ProtectQA-Timestamp validation
 */
export interface WebhookHeaders {
    'x-protectqa-timestamp': string;
    'x-protectqa-signature': string;
}
/**
 * Verify webhook signature
 * Signature format: sha256=<hex>
 * Algorithm: HMAC_SHA256(secret, timestamp + "." + raw_body)
 */
export declare function verifyWebhookSignature(secret: string, timestamp: string, signature: string, rawBody: string): boolean;
/**
 * Generate webhook signature (for testing/outbound)
 */
export declare function generateWebhookSignature(secret: string, timestamp: string, rawBody: string): string;
