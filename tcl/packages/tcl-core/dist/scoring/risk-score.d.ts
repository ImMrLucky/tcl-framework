/**
 * Risk Score Computation
 *
 * Production-grade scoring math (deterministic + calibrated).
 * Risk score represents expected harm and is mode-safe.
 */
import type { Severity } from '../contracts/issue.contract.js';
import type { IssueSignals } from '../contracts/issue.contract.js';
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
export declare function computeRiskScore(impactSeverity: Severity, confidence: number, signals: IssueSignals): number;
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
export declare function computeRankScore(riskScore: number, signals: IssueSignals): number;
