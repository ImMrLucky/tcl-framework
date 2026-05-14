import type { EncryptedBlob } from './crypto.js';

/**
 * Convert Postgres `bytea` values from Supabase JS (Buffer, Uint8Array,
 * base64 string, or `\x...` hex) into Node Buffers.
 */
export function bufFromDb(value: unknown): Buffer {
  if (value == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) {
      return Buffer.from(value.slice(2), 'hex');
    }
    return Buffer.from(value, 'base64');
  }
  return Buffer.alloc(0);
}

/** Postgres `bytea` text format for inserts/updates via Supabase. */
export function bufToDb(value: Buffer | EncryptedBlob['ciphertext']): string {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `\\x${buf.toString('hex')}`;
}
