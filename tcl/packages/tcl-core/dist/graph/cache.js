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
export class SemanticCache {
    cfg;
    map = new Map();
    dirty = [];
    loaded = false;
    hits = 0;
    misses = 0;
    constructor(cfg) {
        this.cfg = cfg;
    }
    getStats() {
        const total = this.hits + this.misses;
        return {
            hits: this.hits,
            misses: this.misses,
            total,
            hitRate: total > 0 ? (this.hits / total) * 100 : 0
        };
    }
    nowMs() { return Date.now(); }
    norm(s) {
        return s.toLowerCase().replace(/\s+/g, " ").trim();
    }
    sha256(s) {
        return createHash("sha256").update(s).digest("hex");
    }
    makeKey(task, a, b) {
        const payload = `${this.cfg.namespace}|${this.cfg.version}|${this.cfg.model}|${task}|${this.norm(a)}|${this.norm(b)}`;
        return this.sha256(payload);
    }
    async loadIfNeeded() {
        if (this.loaded)
            return;
        this.loaded = true;
        if (!this.cfg.persistPath)
            return;
        try {
            const data = await fs.readFile(this.cfg.persistPath, "utf-8");
            const lines = data.split(/\n/).filter(Boolean);
            for (const ln of lines) {
                try {
                    const rec = JSON.parse(ln);
                    if (rec?.key && rec?.entry)
                        this.map.set(rec.key, rec.entry);
                }
                catch { }
            }
        }
        catch {
            // ignore missing file
        }
    }
    get(key) {
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
    set(key, value, quote) {
        const ttl = this.cfg.ttlSeconds;
        const exp = ttl ? this.nowMs() + ttl * 1000 : undefined;
        const entry = { v: value, exp, quote };
        this.map.set(key, entry);
        if (this.cfg.persistPath)
            this.dirty.push({ key, entry });
        // naive cap
        const max = this.cfg.maxEntries ?? 200000;
        if (this.map.size > max) {
            // evict ~1% oldest-ish by iteration order
            const drop = Math.max(1, Math.floor(max * 0.01));
            for (let i = 0; i < drop; i++) {
                const k = this.map.keys().next().value;
                if (!k)
                    break;
                this.map.delete(k);
            }
        }
    }
    async flush() {
        if (!this.cfg.persistPath || this.dirty.length === 0)
            return;
        await this.loadIfNeeded();
        const chunk = this.dirty.splice(0, this.dirty.length);
        const lines = chunk.map((r) => JSON.stringify(r)).join("\n") + "\n";
        await fs.mkdir(require("path").dirname(this.cfg.persistPath), { recursive: true }).catch(() => { });
        await fs.appendFile(this.cfg.persistPath, lines, "utf-8");
    }
}
