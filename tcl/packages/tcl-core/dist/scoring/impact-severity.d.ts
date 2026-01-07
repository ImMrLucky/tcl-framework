/**
 * Impact Severity Computation
 *
 * Computes mode-invariant impact severity from issue features.
 * Impact severity represents "what this would be if it were verified" - it does not depend on verification level.
 */
import type { Severity } from '../contracts/issue.contract.js';
import type { IssueSignals } from '../contracts/issue.contract.js';
/**
 * Compute impact severity from issue features
 *
 * Rules:
 * - Compliance flags like PCI CVV storage → critical impact
 * - Money/refund/cancellation contradictions → high impact
 * - Admin/communication inconsistency without harm → medium/low
 * - Graph + spectral may nudge within band but cannot invent impact
 *
 * @param type - Issue type (e.g., CONTRADICTION, UNSUPPORTED, RISK_SIGNAL)
 * @param category - Issue category (e.g., billing, compliance, evidence)
 * @param signals - Issue signals (contradictions, amounts, compliance flags, etc.)
 * @returns Impact severity (mode-invariant)
 */
export declare function computeImpactSeverity(type: string, category: string, signals: IssueSignals): Severity;
/**
 * Get severity weight for risk score computation
 */
export declare function getSeverityWeight(severity: Severity): number;
