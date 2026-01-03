/**
 * Reproducibility Utilities
 *
 * Computes all reproducibility hashes and metadata required for audit-grade findings.
 */
/**
 * Get git commit SHA (code version).
 * Falls back to ENGINE_VERSION env var or "unknown" if not available.
 */
export declare function getCodeVersion(): string;
/**
 * Get engine version.
 */
export declare function getEngineVersion(): string;
/**
 * Compute hash of normalized transcript input.
 */
export declare function computeInputHash(transcript: string): string;
/**
 * Get model fingerprint (all model versions used).
 */
export declare function getModelFingerprint(): {
    nliModel?: string;
    claimExtractor?: string;
    embeddingModel?: string;
    spectralEngine?: string;
    configHash?: string;
};
/**
 * Compute full config hash (scoring + templates + taxonomy).
 */
export declare function computeFullConfigHash(): string;
/**
 * Generate complete reproducibility metadata.
 */
export declare function generateReproducibilityMetadata(transcript: string): {
    inputHash: string;
    configHash: string;
    codeVersion: string;
    engineVersion: string;
    modelFingerprint: ReturnType<typeof getModelFingerprint>;
};
