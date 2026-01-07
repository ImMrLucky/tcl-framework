/**
 * Issue Converter
 *
 * Converts IssueV2 to TclIssueV3 (contract V3) with backwards compatibility.
 */
import { createHash } from 'crypto';
import { computeImpactSeverity } from './impact-severity.js';
import { computeConfidence, computeConfidenceBand } from './confidence.js';
import { computeRiskScore, computeRankScore } from './risk-score.js';
/**
 * Extract issue signals from IssueV2
 */
function extractSignals(issue) {
    const signals = {
        hasContradictionEdge: false,
        hasSupportEdge: false,
    };
    // Graph signals
    if (issue.evidence?.edges) {
        for (const edge of issue.evidence.edges) {
            if (edge.kind === 'contradiction') {
                signals.hasContradictionEdge = true;
                signals.contradictionStrength = edge.weight;
            }
            else if (edge.kind === 'support') {
                signals.hasSupportEdge = true;
                signals.supportStrength = edge.weight;
            }
        }
    }
    // Legacy: check conflictsWith for contradictions
    if (issue.conflictsWith && Array.isArray(issue.conflictsWith) && issue.conflictsWith.length > 0) {
        signals.hasContradictionEdge = true;
        const maxWeight = Math.max(...issue.conflictsWith.map((c) => c.weight || c.edgeWeight || 0));
        signals.contradictionStrength = maxWeight;
    }
    // Spectral signals (from report if available)
    if (issue.spectralEnergy !== undefined) {
        signals.spectralEnergy = issue.spectralEnergy;
    }
    if (issue.spectralGap !== undefined) {
        signals.spectralGap = issue.spectralGap;
    }
    if (issue.cycleMass !== undefined) {
        signals.cycleMass = issue.cycleMass;
    }
    // Centrality (from spectral if available)
    if (issue.centrality !== undefined) {
        signals.centrality = issue.centrality;
    }
    // Compliance flags
    if (issue.compliance?.tags && issue.compliance.tags.length > 0) {
        signals.complianceFlags = issue.compliance.tags;
    }
    // Amounts detected (parse from claim text if available)
    // TODO: Implement amount extraction from claim text
    // For now, check if category suggests money
    if (issue.category === 'billing' || issue.category === 'compliance') {
        // Placeholder: would extract actual amounts from claim text
        signals.amountsDetected = [];
    }
    // Language detection (placeholder: would use NLP)
    signals.hasGuaranteeLanguage = false;
    signals.hasContractLanguage = false;
    return signals;
}
/**
 * Map VerificationLevelV2 to VerificationLevel (contract V3)
 */
function mapVerificationLevel(level) {
    if (level === 'EXTERNAL_VERIFIED') {
        return 'EXTERNALLY_VERIFIED';
    }
    if (level === 'TRANSCRIPT_ONLY') {
        return 'TRANSCRIPT_ONLY';
    }
    // Default: assume transcript-only if not specified
    return 'TRANSCRIPT_ONLY';
}
/**
 * Generate stable issue ID
 *
 * Formula: hash(templateId + topicId + sortedClaimIds + issueType)
 *
 * For backwards compatibility, if templateId/topicId not available, use runId + issueKey
 */
function generateStableIssueId(issue, templateId, topicId) {
    const claimIds = issue.what?.relatedClaimIds
        ? [issue.what.primaryClaimId, ...issue.what.relatedClaimIds].sort()
        : [issue.what?.primaryClaimId || issue.issueId].sort();
    // Use templateId + topicId if available, otherwise fall back to runId + issueKey
    const stableKey = templateId && topicId
        ? `${templateId}:${topicId}:${claimIds.join(',')}:${issue.type}`
        : `${issue.runId}:${issue.issueKey}`;
    const hash = createHash('sha256')
        .update(stableKey)
        .digest('hex')
        .substring(0, 16);
    return `issue_${hash}`;
}
/**
 * Convert IssueV2 to TclIssueV3
 *
 * @param issue - IssueV2 (legacy format)
 * @param templateId - Optional template ID for stable ID generation
 * @param topicId - Optional topic ID for stable ID generation
 * @returns TclIssueV3 (contract V3)
 */
export function convertIssueV2ToV3(issue, templateId, topicId) {
    // Extract signals
    const signals = extractSignals(issue);
    // Map verification level
    const verificationLevel = mapVerificationLevel(issue.verification?.level || 'TRANSCRIPT_ONLY');
    // Compute impact severity (mode-invariant)
    const impactSeverity = computeImpactSeverity(issue.type, issue.category, signals);
    // Compute confidence (mode-dependent)
    const confidence = computeConfidence(signals, verificationLevel, issue.type);
    const confidenceBand = computeConfidenceBand(confidence);
    // Compute risk score (mode-safe)
    const riskScore = computeRiskScore(impactSeverity, confidence, signals);
    // Compute rank score (for triage)
    const rankScore = computeRankScore(riskScore, signals);
    // Generate stable ID
    const id = generateStableIssueId(issue, templateId, topicId);
    // Extract reason codes (required for high/critical)
    const reasonCodes = [];
    if (impactSeverity === 'high' || impactSeverity === 'critical') {
        if (signals.hasContradictionEdge) {
            reasonCodes.push('CONTRADICTION_DETECTED');
        }
        if (signals.complianceFlags && signals.complianceFlags.length > 0) {
            reasonCodes.push(...signals.complianceFlags.map(f => `COMPLIANCE_${f}`));
        }
        if (issue.category === 'billing' || issue.category === 'compliance') {
            reasonCodes.push(`HIGH_IMPACT_CATEGORY:${issue.category}`);
        }
        if (issue.type === 'CONTRADICTION') {
            reasonCodes.push('CONTRADICTION_TYPE');
        }
    }
    // Generate explanation
    const explanation = generateExplanation(issue, impactSeverity, confidence, signals);
    // Build trace
    const trace = {
        claimIds: issue.what?.relatedClaimIds
            ? [issue.what.primaryClaimId, ...issue.what.relatedClaimIds]
            : [issue.what?.primaryClaimId || ''],
        edgeIds: issue.evidence?.edges?.map((e, i) => `edge_${i}`),
        evidenceNodeIds: issue.evidence?.refs?.map(r => r.sourceId),
        topicId: topicId,
        transcriptSpans: issue.who?.turnIndex !== undefined
            ? [{ start: issue.who.turnIndex, end: issue.who.turnIndex }]
            : undefined,
    };
    return {
        id,
        type: issue.type,
        category: issue.category,
        impactSeverity,
        confidence,
        confidenceBand,
        verificationLevel,
        rankScore,
        riskScore,
        reasonCodes,
        explanation,
        trace,
        signals,
        createdAt: issue.audit?.createdAt || new Date().toISOString(),
    };
}
/**
 * Generate natural language explanation
 */
function generateExplanation(issue, impactSeverity, confidence, signals) {
    const parts = [];
    if (signals.hasContradictionEdge) {
        parts.push('Contradiction detected');
    }
    if (issue.type === 'UNVERIFIED_CLAIM') {
        parts.push('Unverified claim');
    }
    if (issue.type === 'UNSUPPORTED_CLAIM') {
        parts.push('Unsupported claim');
    }
    if (signals.complianceFlags && signals.complianceFlags.length > 0) {
        parts.push(`Compliance flags: ${signals.complianceFlags.join(', ')}`);
    }
    if (issue.category === 'billing') {
        parts.push('Billing-related issue');
    }
    const confidenceDesc = confidence >= 0.7 ? 'high confidence' : confidence >= 0.4 ? 'medium confidence' : 'low confidence';
    parts.push(`${impactSeverity} impact with ${confidenceDesc}`);
    return parts.join('. ');
}
/**
 * Backwards compatibility: Convert TclIssueV3 back to IssueV2 format
 */
export function convertIssueV3ToV2(issue) {
    // Map verification level back
    const verificationLevelV2 = issue.verificationLevel === 'EXTERNALLY_VERIFIED'
        ? 'EXTERNAL_VERIFIED'
        : issue.verificationLevel === 'DOC_BACKED'
            ? 'TRANSCRIPT_ONLY' // DOC_BACKED maps to TRANSCRIPT_ONLY in V2
            : 'TRANSCRIPT_ONLY';
    return {
        issueId: issue.id,
        issueKey: issue.id, // Use ID as key
        runId: '', // Will be set by caller
        conversationId: '', // Will be set by caller
        type: issue.type,
        category: issue.category,
        severity: issue.impactSeverity, // Map impactSeverity to severity
        severityDisplay: issue.impactSeverity === 'critical' ? 'high' : issue.impactSeverity, // Map for display
        impact: issue.impactSeverity === 'critical' ? 'high' : issue.impactSeverity === 'high' ? 'high' : issue.impactSeverity === 'medium' ? 'medium' : 'low',
        riskScore: issue.riskScore,
        score: Math.round(issue.riskScore * 100),
        confidence: issue.confidence,
        reviewRequired: issue.impactSeverity === 'high' || issue.impactSeverity === 'critical',
        verification: {
            level: verificationLevelV2,
            reasonCodes: issue.reasonCodes,
        },
        who: {
            speaker: 'UNKNOWN',
            turnIndex: issue.trace.transcriptSpans?.[0]?.start,
        },
        what: {
            primaryClaimId: issue.trace.claimIds[0] || '',
            relatedClaimIds: issue.trace.claimIds.slice(1),
            issueSummary: issue.explanation,
            issueDetail: issue.explanation,
        },
        evidence: {
            refs: issue.trace.evidenceNodeIds?.map(id => ({
                sourceType: 'TRANSCRIPT',
                sourceId: id,
                quote: '',
            })) || [],
            edges: issue.trace.edgeIds?.map((id, i) => ({
                kind: issue.signals.hasContradictionEdge ? 'contradiction' : 'support',
                claimA: issue.trace.claimIds[0] || '',
                claimB: issue.trace.claimIds[i + 1],
                weight: issue.signals.contradictionStrength || issue.signals.supportStrength || 0,
            })),
        },
        compliance: {
            tags: issue.signals.complianceFlags || [],
            disclaimers: [],
        },
        audit: {
            createdAt: issue.createdAt || new Date().toISOString(),
            engineVersion: '',
            scorerId: '',
        },
    };
}
