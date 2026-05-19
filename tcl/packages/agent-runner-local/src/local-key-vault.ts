import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RUNNER_HOME } from './config.js';

const VAULT_PATH = join(RUNNER_HOME, 'vault.json');
const VAULT_ENC_PATH = join(RUNNER_HOME, 'vault.enc');

export interface VaultEntry {
  provider: string;
  label: string;
  localKeyRef: string;
  keyPreview: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  updatedAt: string;
}

interface VaultFile {
  version: 1;
  encrypted: boolean;
  entries: VaultEntry[];
}

function vaultPassphrase(): string | null {
  return process.env['PROTECTQA_VAULT_PASSPHRASE'] ?? null;
}

function deriveKey(passphrase: string): Buffer {
  const salt = createHash('sha256').update('protectqa-agent-runner-vault').digest();
  return scryptSync(passphrase, salt, 32);
}

function encryptPayload(plain: string, passphrase: string): string {
  const iv = randomBytes(12);
  const key = deriveKey(passphrase);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptPayload(blob: string, passphrase: string): string {
  const buf = Buffer.from(blob, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const key = deriveKey(passphrase);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function ensureVaultDir(): void {
  mkdirSync(RUNNER_HOME, { recursive: true });
}

function readVaultRaw(): VaultFile {
  ensureVaultDir();
  const pass = vaultPassphrase();
  if (existsSync(VAULT_ENC_PATH) && pass) {
    const blob = readFileSync(VAULT_ENC_PATH, 'utf8');
    const json = decryptPayload(blob, pass);
    return JSON.parse(json) as VaultFile;
  }
  if (existsSync(VAULT_PATH)) {
    return JSON.parse(readFileSync(VAULT_PATH, 'utf8')) as VaultFile;
  }
  return { version: 1, encrypted: false, entries: [] };
}

function writeVaultRaw(vault: VaultFile): void {
  ensureVaultDir();
  const pass = vaultPassphrase();
  const json = JSON.stringify(vault, null, 2);
  if (pass) {
    vault.encrypted = true;
    writeFileSync(VAULT_ENC_PATH, encryptPayload(json, pass), { mode: 0o600 });
    if (existsSync(VAULT_PATH)) {
      writeFileSync(VAULT_PATH, JSON.stringify({ version: 1, encrypted: true, entries: [] }), {
        mode: 0o600,
      });
    }
  } else {
    vault.encrypted = false;
    writeFileSync(VAULT_PATH, json, { mode: 0o600 });
  }
  try {
    chmodSync(RUNNER_HOME, 0o700);
  } catch {
    /* windows */
  }
}

export function listVaultEntries(): VaultEntry[] {
  return readVaultRaw().entries;
}

export function getVaultEntry(provider: string, label = 'default'): VaultEntry | undefined {
  return readVaultRaw().entries.find((e) => e.provider === provider && e.label === label);
}

export function setVaultApiKey(
  provider: string,
  apiKey: string,
  opts?: { label?: string; baseUrl?: string; defaultModel?: string }
): VaultEntry {
  const label = opts?.label ?? 'default';
  const localKeyRef = `vault://${provider}/${label}`;
  const preview =
    apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '••••';
  const vault = readVaultRaw();
  const next: VaultEntry = {
    provider,
    label,
    localKeyRef,
    keyPreview: preview,
    apiKey,
    baseUrl: opts?.baseUrl,
    defaultModel: opts?.defaultModel,
    updatedAt: new Date().toISOString(),
  };
  const idx = vault.entries.findIndex((e) => e.provider === provider && e.label === label);
  if (idx >= 0) vault.entries[idx] = next;
  else vault.entries.push(next);
  writeVaultRaw(vault);
  return next;
}

export function removeVaultEntry(provider: string, label = 'default'): boolean {
  const vault = readVaultRaw();
  const before = vault.entries.length;
  vault.entries = vault.entries.filter((e) => !(e.provider === provider && e.label === label));
  if (vault.entries.length < before) {
    writeVaultRaw(vault);
    return true;
  }
  return false;
}
