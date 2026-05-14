/**
 * Agent Studio — app-level encryption helpers for BYOK provider keys
 * and other sensitive credentials.
 *
 * We use AES-256-GCM keyed by `AGENT_STUDIO_ENC_KEY`. The key must be
 * either:
 *   - 64 hex chars (32 bytes), or
 *   - 44 base64 chars decoding to 32 bytes.
 *
 * Per Agent Studio spec: BYOK key storage MUST live as an app-level
 * encrypted column, never plain JSON. See docs/specs/agent-studio.md.
 *
 * Storage shape (one row per secret):
 *   ciphertext: bytea
 *   iv:         bytea (12 bytes)
 *   tag:        bytea (16 bytes)
 *   alg:        text  (always 'aes-256-gcm' today; bumped if we rotate)
 *   version:    int   (KMS-style key version — defaults 1)
 *
 * Decryption fails closed if the key is missing or the wrong length.
 */

import * as crypto from 'crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.AGENT_STUDIO_ENC_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      'AGENT_STUDIO_ENC_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  let buf: Buffer | null = null;

  if (/^[0-9a-fA-F]{64}$/.test(raw.trim())) {
    buf = Buffer.from(raw.trim(), 'hex');
  } else {
    try {
      const candidate = Buffer.from(raw.trim(), 'base64');
      if (candidate.length === KEY_LEN) {
        buf = candidate;
      }
    } catch {
      // fall through
    }
  }

  if (!buf || buf.length !== KEY_LEN) {
    throw new Error(
      `AGENT_STUDIO_ENC_KEY must decode to exactly ${KEY_LEN} bytes ` +
        `(got ${buf?.length ?? 0}). Use 64 hex chars or a 32-byte base64 string.`
    );
  }

  cachedKey = buf;
  return buf;
}

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  alg: string;
  version: number;
}

/**
 * Encrypt a UTF-8 plaintext into a structured blob suitable for storage
 * in the `*_ciphertext`, `*_iv`, `*_tag` columns.
 */
export function encryptString(plaintext: string): EncryptedBlob {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag, alg: ALG, version: 1 };
}

/**
 * Decrypt a stored blob back into the original plaintext.
 * Throws if the GCM auth tag check fails (tampering / wrong key).
 */
export function decryptString(blob: {
  ciphertext: Buffer | Uint8Array;
  iv: Buffer | Uint8Array;
  tag: Buffer | Uint8Array;
  alg?: string;
}): string {
  const key = loadKey();
  const alg = blob.alg || ALG;
  if (alg !== ALG) {
    throw new Error(`Unsupported encryption algorithm: ${alg}`);
  }
  const decipher = crypto.createDecipheriv(ALG, key, Buffer.from(blob.iv));
  decipher.setAuthTag(Buffer.from(blob.tag));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext)),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Encrypt a JSON-serializable value.
 */
export function encryptJson(value: unknown): EncryptedBlob {
  return encryptString(JSON.stringify(value));
}

/**
 * Decrypt and parse a previously-encrypted JSON value.
 */
export function decryptJson<T = unknown>(blob: {
  ciphertext: Buffer | Uint8Array;
  iv: Buffer | Uint8Array;
  tag: Buffer | Uint8Array;
  alg?: string;
}): T {
  return JSON.parse(decryptString(blob)) as T;
}

/**
 * Build a redacted preview of a secret (last 4 chars only) for safe display.
 */
export function redact(value: string, visible: number = 4): string {
  if (!value) return '';
  if (value.length <= visible) return '*'.repeat(value.length);
  return '*'.repeat(Math.min(8, value.length - visible)) + value.slice(-visible);
}

/**
 * Generate a fresh AES-256 key as base64 — useful for `npm run` helpers and
 * for documentation. Not used at runtime.
 */
export function generateEncryptionKeyBase64(): string {
  return crypto.randomBytes(KEY_LEN).toString('base64');
}

/**
 * For tests / dev: clear the cached key after rotating env vars.
 */
export function _resetCachedKeyForTests(): void {
  cachedKey = null;
}
