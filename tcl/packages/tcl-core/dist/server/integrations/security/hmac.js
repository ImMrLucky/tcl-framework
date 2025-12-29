/**
 * HMAC Signature Verification for Webhooks
 * Implements X-ProtectQA-Signature and X-ProtectQA-Timestamp validation
 */
import crypto from 'crypto';
/**
 * Verify webhook signature
 * Signature format: sha256=<hex>
 * Algorithm: HMAC_SHA256(secret, timestamp + "." + raw_body)
 */
export function verifyWebhookSignature(secret, timestamp, signature, rawBody) {
    // Reject if timestamp is older than 5 minutes
    const timestampMs = parseInt(timestamp, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (now - timestampMs > fiveMinutes) {
        return false;
    }
    // Extract hex from signature (format: sha256=<hex>)
    const match = signature.match(/^sha256=(.+)$/);
    if (!match) {
        return false;
    }
    const expectedHex = match[1];
    // Compute HMAC
    const payload = timestamp + '.' + rawBody;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const computedHex = hmac.digest('hex');
    // Constant-time comparison
    return crypto.timingSafeEqual(Buffer.from(computedHex, 'hex'), Buffer.from(expectedHex, 'hex'));
}
/**
 * Generate webhook signature (for testing/outbound)
 */
export function generateWebhookSignature(secret, timestamp, rawBody) {
    const payload = timestamp + '.' + rawBody;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const hex = hmac.digest('hex');
    return `sha256=${hex}`;
}
