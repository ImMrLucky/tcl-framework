/**
 * RunFingerprint - Single Source of Truth for Run Metadata
 *
 * All report sections must reference this object (by value or by pointer).
 * No re-derivation of versions, hashes, or IDs.
 */
import { createHash } from 'crypto';
/**
 * Create a config hash from an EngineConfig object
 */
export function computeConfigHash(config) {
    // Sort keys for deterministic hashing
    const sorted = JSON.stringify(config, Object.keys(config).sort());
    return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
}
/**
 * Create an input hash from input data
 */
export function computeInputHash(question, answer, sources) {
    const input = {
        question: question.trim(),
        answer: answer?.trim() || '',
        sources: sources?.map(s => ({ type: s.type, text: s.text?.substring(0, 100) || '' })) || [],
    };
    const sorted = JSON.stringify(input, Object.keys(input).sort());
    return createHash('sha256').update(sorted).digest('hex').substring(0, 16);
}
/**
 * Create a RunFingerprint from available data
 */
export function createRunFingerprint(params) {
    return {
        runId: params.runId,
        engineVersion: params.engineVersion || process.env.ENGINE_VERSION || '0.2.0',
        codeVersion: params.codeVersion || process.env.CODE_VERSION || 'unknown',
        configHash: computeConfigHash(params.config),
        inputHash: computeInputHash(params.question, params.answer, params.sources),
        scorerId: params.scorerId,
        nliModelId: params.nliModelId,
        embeddingModelId: params.embeddingModelId,
        claimExtractorVersion: params.claimExtractorVersion || '1.0.0',
        ruleEngineVersion: params.ruleEngineVersion || '1.0.0',
        factExtractorVersion: params.factExtractorVersion || '1.0.0',
    };
}
