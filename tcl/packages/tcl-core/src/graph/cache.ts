/**
 * Production cache for semantic scoring.
 *
 * Goals:
 * - Deterministic keys (hash of normalized inputs)
 * - Model/version aware (so caches don't cross-contaminate)
 * - Optional TTL
 * - Optional persistence (file-backed JSONL) — minimal, portable
 *
 * Note: For true production, swap persistence for Redis, DynamoDB, or Postgres.
 */

import { createHash } from "crypto";
import { promises as fs } from "fs";

export type CacheEntry = { v: number; exp?: number; quote?: string };
export type CacheRecord = { key: string; entry: CacheEntry };

export type CacheConfig = {
  namespace: string;     // e.g., "tcl"
  version: string;       // bump on schema changes
  model: string;         // scorer model id/version
  ttlSeconds?: number;   // optional TTL
  persistPath?: string;  // optional JSONL path
  maxEntries?: number;   // simple in-memory cap
};

export class SemanticCache {
  private map = new Map<string, CacheEntry>();
  private dirty: CacheRecord[] = [];
  private loaded = false;

  constructor(private cfg: CacheConfig) {}

  private nowMs() { return Date.now(); }

  private norm(s: string) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  private sha256(s: string) {
    return createHash("sha256").update(s).digest("hex");
  }

  makeKey(task: "ent"|"con"|"gnd", a: string, b: string) {
    const payload = `${this.cfg.namespace}|${this.cfg.version}|${this.cfg.model}|${task}|${this.norm(a)}|${this.norm(b)}`;
    return this.sha256(payload);
  }

  async loadIfNeeded() {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.cfg.persistPath) return;
    try {
      const data = await fs.readFile(this.cfg.persistPath, "utf-8");
      const lines = data.split(/\n/).filter(Boolean);
      for (const ln of lines) {
        try {
          const rec = JSON.parse(ln) as CacheRecord;
          if (rec?.key && rec?.entry) this.map.set(rec.key, rec.entry);
        } catch {}
      }
    } catch {
      // ignore missing file
    }
  }

  get(key: string): CacheEntry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.exp && this.nowMs() > e.exp) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }

  set(key: string, value: number, quote?: string) {
    const ttl = this.cfg.ttlSeconds;
    const exp = ttl ? this.nowMs() + ttl * 1000 : undefined;
    const entry: CacheEntry = { v: value, exp, quote };
    this.map.set(key, entry);
    if (this.cfg.persistPath) this.dirty.push({ key, entry });

    // naive cap
    const max = this.cfg.maxEntries ?? 200000;
    if (this.map.size > max) {
      // evict ~1% oldest-ish by iteration order
      const drop = Math.max(1, Math.floor(max * 0.01));
      for (let i = 0; i < drop; i++) {
        const k = this.map.keys().next().value;
        if (!k) break;
        this.map.delete(k);
      }
    }
  }

  async flush() {
    if (!this.cfg.persistPath || this.dirty.length === 0) return;
    await this.loadIfNeeded();
    const chunk = this.dirty.splice(0, this.dirty.length);
    const lines = chunk.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.mkdir(require("path").dirname(this.cfg.persistPath), { recursive: true }).catch(() => {});
    await fs.appendFile(this.cfg.persistPath, lines, "utf-8");
  }
}
