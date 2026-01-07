/**
 * Impact Severity Computation
 * 
 * Computes mode-invariant impact severity from issue features.
 * Impact severity represents "what this would be if it were verified" - it does not depend on verification level.
 */

import type { Severity } from '../contracts/issue.contract.js';
import type { IssueSignals } from '../contracts/issue.contract.js';
import { getScoringDefaults } from '../config/scoring.defaults.js';

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
export function computeImpactSeverity(
  type: string,
  category: string,
  signals: IssueSignals
): Severity {
  const config = getScoringDefaults();
  const { impactRules } = config;

  // Critical: Compliance flags that trigger critical impact
  if (signals.complianceFlags && signals.complianceFlags.length > 0) {
    const hasCriticalFlag = signals.complianceFlags.some(flag =>
      impactRules.criticalComplianceFlags.includes(flag)
    );
    if (hasCriticalFlag) {
      return 'critical';
    }
  }

  // High: Money/refund/cancellation contradictions
  const hasMoneyAmounts = signals.amountsDetected && signals.amountsDetected.length > 0;
  const isMoneyCategory = impactRules.highImpactCategories.includes(category) &&
    (category === 'billing' || category === 'compliance' || category === 'cancellation' || category === 'refund');
  const isHighImpactType = impactRules.highImpactTypes.includes(type);
  const hasContradiction = signals.hasContradictionEdge && (signals.contradictionStrength ?? 0) > 0.5;

  if (hasContradiction && (hasMoneyAmounts || isMoneyCategory)) {
    return 'high';
  }

  if (isHighImpactType && isMoneyCategory) {
    return 'high';
  }

  // High: Strong contradictions with money or high-impact categories
  if (hasContradiction && (hasMoneyAmounts || isMoneyCategory)) {
    return 'high';
  }

  // High: Guarantee/contract language with contradictions
  if (hasContradiction && (signals.hasGuaranteeLanguage || signals.hasContractLanguage)) {
    return 'high';
  }

  // Medium: High-impact types or categories without money/contradictions
  if (isHighImpactType || isMoneyCategory) {
    // Graph + spectral may nudge to high if strong signals
    if (signals.spectralEnergy && signals.spectralEnergy > 0.7) {
      return 'high';
    }
    return 'medium';
  }

  // Medium: Medium-impact types or categories
  if (impactRules.mediumImpactTypes.includes(type) || 
      impactRules.mediumImpactCategories.includes(category)) {
    // Graph + spectral may nudge within band
    if (signals.spectralEnergy && signals.spectralEnergy > 0.8) {
      return 'high';
    }
    return 'medium';
  }

  // Low: Default for admin/communication inconsistency without harm
  // Graph + spectral may nudge to medium if strong signals
  if (signals.spectralEnergy && signals.spectralEnergy > 0.9) {
    return 'medium';
  }

  return 'low';
}

/**
 * Get severity weight for risk score computation
 */
export function getSeverityWeight(severity: Severity): number {
  const config = getScoringDefaults();
  return config.severityWeights[severity];
}

