/**
 * Risk Score Computation
 *
 * Production-grade scoring math (deterministic + calibrated).
 * Risk score represents expected harm and is mode-safe.
 */
import { getScoringDefaults } from '../config/scoring.defaults.js';
import { getSeverityWeight } from './impact-severity.js';
/**
 * Compute risk score (mode-safe)
 *
 * Formula:
 * riskScore = severityWeight(impactSeverity) * confidence * (1 + k1*spectralEnergy) * (1 + k2*centrality)
 *
 * @param impactSeverity - Impact severity (mode-independent)
 * @param confidence - Confidence value (0..1, mode-dependent)
 * @param signals - Issue signals
 * @returns Risk score (0..1, clamped)
 */
export function computeRiskScore(impactSeverity, confidence, signals) {
    const config = getScoringDefaults();
    const { riskScoreMultipliers } = config;
    // Base: severity weight * confidence
    const severityWeight = getSeverityWeight(impactSeverity);
    let riskScore = severityWeight * confidence;
    // Apply spectral energy multiplier (k1)
    if (signals.spectralEnergy !== undefined) {
        const spectralBoost = 1 + (riskScoreMultipliers.spectralEnergy * signals.spectralEnergy);
        riskScore *= spectralBoost;
    }
    // Apply centrality multiplier (k2)
    if (signals.centrality !== undefined) {
        const centralityBoost = 1 + (riskScoreMultipliers.centrality * signals.centrality);
        riskScore *= centralityBoost;
    }
    // Clamp to [0..1]
    return Math.max(0, Math.min(1, riskScore));
}
/**
 * Compute rank score (for triage/manager utility)
 *
 * Formula:
 * rankScore = 0.55*riskScore + 0.25*contradictionStrength + 0.20*spectralEnergy
 *
 * @param riskScore - Risk score (0..1)
 * @param signals - Issue signals
 * @returns Rank score (0..1, clamped)
 */
export function computeRankScore(riskScore, signals) {
    const config = getScoringDefaults();
    const { rankScoreWeights } = config;
    let rankScore = rankScoreWeights.riskScore * riskScore;
    // Add contradiction strength component
    if (signals.contradictionStrength !== undefined) {
        rankScore += rankScoreWeights.contradictionStrength * signals.contradictionStrength;
    }
    // Add spectral energy component
    if (signals.spectralEnergy !== undefined) {
        rankScore += rankScoreWeights.spectralEnergy * signals.spectralEnergy;
    }
    // Clamp to [0..1]
    return Math.max(0, Math.min(1, rankScore));
}
