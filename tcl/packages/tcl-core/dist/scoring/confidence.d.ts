/**
 * Confidence Computation
 *
 * Computes mode-dependent confidence from issue features and verification level.
 * Confidence represents how certain we are about the issue, not its severity.
 */
import type { ConfidenceBand, VerificationLevel } from '../contracts/issue.contract.js';
import type { IssueSignals } from '../contracts/issue.contract.js';
/**
 * Compute confidence from issue features and mode
 *
 * Rules:
 * - TRANSCRIPT_ONLY:
 *   - Contradictions with high contradictionStrength → medium/high confidence
 *   - Unsupported claims with no evidence → low confidence
 * - DOC_BACKED:
 *   - supportStrength from doc grounding → increase confidence
 * - EXTERNALLY_VERIFIED:
 *   - Verified source edges → highest confidence
 *
 * Important: confidence is not a severity cap.
 *
 * @param signals - Issue signals
 * @param verificationLevel - Verification level (mode-dependent)
 * @param type - Issue type
 * @returns Confidence value (0..1)
 */
export declare function computeConfidence(signals: IssueSignals, verificationLevel: VerificationLevel, type: string): number;
/**
 * Compute confidence band from confidence value
 */
export declare function computeConfidenceBand(confidence: number): ConfidenceBand;
