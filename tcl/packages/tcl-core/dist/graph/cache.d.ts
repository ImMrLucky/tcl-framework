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
export type CacheEntry = {
    v: number;
    exp?: number;
    quote?: string;
};
export type CacheRecord = {
    key: string;
    entry: CacheEntry;
};
export type CacheConfig = {
    namespace: string;
    version: string;
    model: string;
    ttlSeconds?: number;
    persistPath?: string;
    maxEntries?: number;
};
export declare class SemanticCache {
    private cfg;
    private map;
    private dirty;
    private loaded;
    constructor(cfg: CacheConfig);
    private nowMs;
    private norm;
    private sha256;
    makeKey(task: "ent" | "con" | "gnd", a: string, b: string): any;
    loadIfNeeded(): Promise<void>;
    get(key: string): CacheEntry | undefined;
    set(key: string, value: number, quote?: string): void;
    flush(): Promise<void>;
}
