/**
 * Confidence Computation
 * 
 * Computes mode-dependent confidence from issue features and verification level.
 * Confidence represents how certain we are about the issue, not its severity.
 */

import type { ConfidenceBand, VerificationLevel } from '../contracts/issue.contract.js';
import type { IssueSignals } from '../contracts/issue.contract.js';
import { getScoringDefaults } from '../config/scoring.defaults.js';

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
export function computeConfidence(
  signals: IssueSignals,
  verificationLevel: VerificationLevel,
  type: string
): number {
  let confidence = 0.5; // Base confidence

  // Mode-dependent confidence adjustments
  switch (verificationLevel) {
    case 'EXTERNALLY_VERIFIED':
      // Highest confidence: verified source edges
      if (signals.hasSupportEdge && signals.supportStrength) {
        confidence = 0.7 + (signals.supportStrength * 0.3); // 0.7-1.0
      } else {
        confidence = 0.75; // Externally verified but no explicit support edge
      }
      break;

    case 'DOC_BACKED':
      // Medium-high confidence: doc grounding
      if (signals.hasSupportEdge && signals.supportStrength) {
        confidence = 0.5 + (signals.supportStrength * 0.3); // 0.5-0.8
      } else {
        confidence = 0.6; // Doc-backed but no explicit support edge
      }
      break;

    case 'TRANSCRIPT_ONLY':
      // Mode-dependent: contradictions boost confidence, unsupported claims reduce it
      if (signals.hasContradictionEdge && signals.contradictionStrength) {
        // Contradictions with high strength → medium/high confidence
        if (signals.contradictionStrength > 0.7) {
          confidence = 0.6 + (signals.contradictionStrength * 0.2); // 0.6-0.8
        } else if (signals.contradictionStrength > 0.5) {
          confidence = 0.5 + (signals.contradictionStrength * 0.2); // 0.5-0.7
        } else {
          confidence = 0.4 + (signals.contradictionStrength * 0.2); // 0.4-0.6
        }
      } else if (type === 'UNSUPPORTED_CLAIM' || type === 'UNVERIFIED_CLAIM') {
        // Unsupported claims with no evidence → low confidence
        confidence = 0.3;
      } else {
        // Default transcript-only confidence
        confidence = 0.4;
      }
      break;
  }

  // Spectral signals boost confidence (all modes)
  if (signals.spectralEnergy && signals.spectralEnergy > 0.7) {
    confidence = Math.min(1.0, confidence + 0.1);
  }

  // Centrality boosts confidence (all modes)
  if (signals.centrality && signals.centrality > 0.7) {
    confidence = Math.min(1.0, confidence + 0.05);
  }

  // Clamp to [0..1]
  return Math.max(0, Math.min(1, confidence));
}

/**
 * Compute confidence band from confidence value
 */
export function computeConfidenceBand(confidence: number): ConfidenceBand {
  const config = getScoringDefaults();
  const { confidenceThresholds } = config;

  if (confidence >= confidenceThresholds.high) {
    return 'high';
  } else if (confidence >= confidenceThresholds.medium) {
    return 'medium';
  } else {
    return 'low';
  }
}

