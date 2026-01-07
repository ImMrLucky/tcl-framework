/**
 * ClaimResult - Canonical Per-Claim Output Model
 *
 * Compute once, reuse everywhere. All counts, scores, and issues must derive from this.
 */
/**
 * Compute finalTruthState from edges and thresholds
 */
export function computeFinalTruthState(claimResult, config) {
    const { edges, grounding, verification } = claimResult;
    // Use contradictedThreshold if set, otherwise use contradictionThreshold
    const contradictedThresh = config.contradictedThreshold ?? config.contradictionThreshold;
    // Check for contradictions above threshold
    if (edges.maxContradictionWeight >= contradictedThresh) {
        return 'Contradicted';
    }
    // Check for support above threshold
    if (edges.maxSupportWeight >= config.supportThreshold) {
        return 'Supported';
    }
    // Check grounding based on mode
    if (config.mode === 'transcript_only') {
        // In transcript-only mode, transcript evidence = not ungrounded
        if (grounding.kind === 'transcript') {
            return 'Inconclusive'; // Has transcript evidence but no strong support/contradiction
        }
        if (grounding.kind === 'none') {
            return 'Ungrounded';
        }
    }
    else {
        // In external-doc mode, check verification
        if (verification.kind === 'external_verified') {
            return 'Supported'; // Verified externally
        }
        if (grounding.kind === 'none') {
            return 'Ungrounded';
        }
        if (verification.kind === 'transcript_only') {
            return 'Inconclusive'; // Has transcript but not verified externally
        }
    }
    return 'Inconclusive';
}
/**
 * Create ClaimResult from claim and graph data
 */
export function createClaimResult(claim, graphData, config) {
    const maxSupport = graphData.supportEdges.length > 0
        ? Math.max(...graphData.supportEdges.map(e => e.weight))
        : 0;
    const maxContradiction = graphData.contradictionEdges.length > 0
        ? Math.max(...graphData.contradictionEdges.map(e => e.weight))
        : 0;
    // Determine grounding kind
    let groundingKind = 'none';
    if (graphData.evidenceIds && graphData.evidenceIds.length > 0) {
        // Check if any evidence is from external sources
        // This is simplified - in practice, you'd check source types
        groundingKind = 'transcript'; // Default to transcript for now
    }
    // Determine verification kind
    let verificationKind = 'unknown';
    if (config.mode === 'with_external_docs') {
        if (graphData.evidenceIds && graphData.evidenceIds.length > 0) {
            verificationKind = 'external_verified'; // Simplified
        }
        else if (groundingKind === 'transcript') {
            verificationKind = 'transcript_only';
        }
    }
    else {
        if (groundingKind === 'transcript') {
            verificationKind = 'transcript_only';
        }
    }
    // Extract speaker from meta, defaulting to UNKNOWN
    let speaker = 'UNKNOWN';
    if (claim.meta?.speaker) {
        const speakerUpper = claim.meta.speaker.toUpperCase();
        if (speakerUpper === 'AGENT' || speakerUpper === 'CUSTOMER' || speakerUpper === 'SYSTEM') {
            speaker = speakerUpper;
        }
    }
    const result = {
        claimId: claim.id,
        speaker,
        text: claim.text,
        turnIndex: claim.meta?.turnIndex,
        grounding: {
            kind: groundingKind,
            evidenceIds: graphData.evidenceIds || [],
            groundingScore: (graphData.groundingEdges && graphData.groundingEdges.length > 0)
                ? Math.max(...graphData.groundingEdges.map(e => e.weight))
                : 0,
        },
        verification: {
            kind: verificationKind,
        },
        edges: {
            maxSupportWeight: maxSupport,
            maxContradictionWeight: maxContradiction,
            supportEdges: graphData.supportEdges,
            contradictionEdges: graphData.contradictionEdges,
        },
        finalTruthState: 'Inconclusive', // Will be computed below
        originalClaim: claim,
    };
    // Compute final truth state
    result.finalTruthState = computeFinalTruthState(result, config);
    return result;
}
