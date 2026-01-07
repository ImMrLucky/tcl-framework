/**
 * RunFingerprint - Single Source of Truth for Run Metadata
 *
 * All report sections must reference this object (by value or by pointer).
 * No re-derivation of versions, hashes, or IDs.
 */
export interface RunFingerprint {
    /**
     * Unique run ID (UUID)
     */
    runId: string;
    /**
     * Engine version (e.g., "0.2.0")
     */
    engineVersion: string;
    /**
     * Code version (git SHA or version tag)
     */
    codeVersion: string;
    /**
     * Hash of the config used for this run
     */
    configHash: string;
    /**
     * Hash of the input (question + answer + sources)
     */
    inputHash: string;
    /**
     * Scorer/NLI model identifier
     */
    scorerId?: string;
    /**
     * NLI model identifier (if used)
     */
    nliModelId?: string;
    /**
     * Embedding model identifier (if used)
     */
    embeddingModelId?: string;
    /**
     * Claim extractor version
     */
    claimExtractorVersion?: string;
    /**
     * Rule engine version
     */
    ruleEngineVersion?: string;
    /**
     * Fact extractor version
     */
    factExtractorVersion?: string;
}
/**
 * Create a config hash from an EngineConfig object
 */
export declare function computeConfigHash(config: any): string;
/**
 * Create an input hash from input data
 */
export declare function computeInputHash(question: string, answer: string, sources?: any[]): string;
/**
 * Create a RunFingerprint from available data
 */
export declare function createRunFingerprint(params: {
    runId: string;
    config: any;
    question: string;
    answer: string;
    sources?: any[];
    engineVersion?: string;
    codeVersion?: string;
    scorerId?: string;
    nliModelId?: string;
    embeddingModelId?: string;
    claimExtractorVersion?: string;
    ruleEngineVersion?: string;
    factExtractorVersion?: string;
}): RunFingerprint;
