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
export interface CacheLike {
    loadIfNeeded(): Promise<void>;
    flush(): Promise<void>;
    get(key: string): CacheEntry | undefined;
    set(key: string, value: number, quote?: string): void;
    getStats(): {
        hits: number;
        misses: number;
        total: number;
        hitRate: number;
    };
    makeKey(task: "ent" | "con" | "gnd", a: string, b: string): string;
}
export declare function isCacheLike(cache: any): cache is CacheLike;
export declare class SemanticCache implements CacheLike {
    private cfg;
    private map;
    private dirty;
    private loaded;
    private hits;
    private misses;
    constructor(cfg: CacheConfig);
    getStats(): {
        hits: number;
        misses: number;
        total: number;
        hitRate: number;
    };
    private nowMs;
    private norm;
    private sha256;
    makeKey(task: "ent" | "con" | "gnd", a: string, b: string): string;
    loadIfNeeded(): Promise<void>;
    get(key: string): CacheEntry | undefined;
    set(key: string, value: number, quote?: string): void;
    flush(): Promise<void>;
}
export declare class NoopCache implements CacheLike {
    private makeKeyFn;
    constructor(makeKeyFn: (task: "ent" | "con" | "gnd", a: string, b: string) => string);
    loadIfNeeded: () => Promise<void>;
    flush: () => Promise<void>;
    get: (_: string) => undefined;
    set: (_: string, __: number, ___?: string) => void;
    getStats: () => {
        hits: number;
        misses: number;
        total: number;
        hitRate: number;
    };
    makeKey: (task: "ent" | "con" | "gnd", a: string, b: string) => string;
}
