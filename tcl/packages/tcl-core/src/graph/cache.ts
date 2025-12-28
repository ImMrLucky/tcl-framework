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

export interface CacheLike {
  loadIfNeeded(): Promise<void>;
  flush(): Promise<void>;
  get(key: string): CacheEntry | undefined;
  set(key: string, value: number, quote?: string): void;
  getStats(): { hits: number; misses: number; total: number; hitRate: number };
  makeKey(task: "ent"|"con"|"gnd", a: string, b: string): string;
}

// Type guard to check if cache implements CacheLike
export function isCacheLike(cache: any): cache is CacheLike {
  return cache && 
    typeof cache.loadIfNeeded === 'function' &&
    typeof cache.flush === 'function' &&
    typeof cache.get === 'function' &&
    typeof cache.set === 'function' &&
    typeof cache.getStats === 'function' &&
    typeof cache.makeKey === 'function';
}

export class SemanticCache implements CacheLike {
  private map = new Map<string, CacheEntry>();
  private dirty: CacheRecord[] = [];
  private loaded = false;
  private hits = 0;
  private misses = 0;

  constructor(private cfg: CacheConfig) {}

  getStats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      total,
      hitRate: total > 0 ? (this.hits / total) * 100 : 0
    };
  }

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
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (e.exp && this.nowMs() > e.exp) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
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

// No-op cache for when caching is disabled
export class NoopCache implements CacheLike {
  private makeKeyFn: (task: "ent"|"con"|"gnd", a: string, b: string) => string;
  
  constructor(makeKeyFn: (task: "ent"|"con"|"gnd", a: string, b: string) => string) {
    this.makeKeyFn = makeKeyFn;
  }
  
  loadIfNeeded = async () => {};
  flush = async () => {};
  get = (_: string) => undefined;
  set = (_: string, __: number, ___?: string) => {};
  getStats = () => ({ hits: 0, misses: 0, total: 0, hitRate: 0 });
  makeKey = (task: "ent"|"con"|"gnd", a: string, b: string) => this.makeKeyFn(task, a, b);
}
