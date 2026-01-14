/**
 * Truth State Derivation
 *
 * CRITICAL: Truth states are DERIVED from graph topology, NEVER assigned directly.
 *
 * Truth States:
 * - SUPPORTED: Has ≥1 valid support edge to external evidence or authoritative fact
 * - CONTRADICTED: Has ≥1 contradiction edge on the same subject slot
 * - UNVERIFIED: Grounded in transcript but lacks external evidence
 * - UNGROUNDED: Isolated node (no grounding, no evidence)
 */
import { getTemplateConfig } from './template-config.js';
// =============================================================================
// MAIN DERIVATION FUNCTION
// =============================================================================
export function deriveTruthStatesFromGraph(graph) {
    const config = getTemplateConfig();
    const truthConfig = config.truthDerivation;
    const results = [];
    const summary = {
        supported: 0,
        contradicted: 0,
        unverified: 0,
        ungrounded: 0,
        total: graph.nodes.claims.length,
    };
    // Build edge indexes for efficient lookup
    const edgesByFrom = buildEdgeIndex(graph.edges, 'from');
    const edgesByTo = buildEdgeIndex(graph.edges, 'to');
    for (const claim of graph.nodes.claims) {
        const result = deriveTruthStateForClaim(claim, edgesByFrom, edgesByTo, graph.nodes.evidence, truthConfig);
        results.push(result);
        // Update summary
        switch (result.truthState) {
            case 'SUPPORTED':
                summary.supported++;
                break;
            case 'CONTRADICTED':
                summary.contradicted++;
                break;
            case 'UNVERIFIED':
                summary.unverified++;
                break;
            case 'UNGROUNDED':
                summary.ungrounded++;
                break;
        }
    }
    // CONSISTENCY CHECK: If contradiction edges exist above threshold but none were applied,
    // this indicates a weight mismatch or threshold misalignment
    const contradictionEdges = graph.edges.contradiction || [];
    const contradictionThreshold = config.truthDerivation.minContradictionWeight;
    const contradictionsAboveThreshold = contradictionEdges.filter(e => e.weight >= contradictionThreshold).length;
    // Add diagnostics warning if contradictions exist but none applied
    // This will be picked up by the caller to mark the graph as degraded
    const diagnostics = [];
    if (contradictionsAboveThreshold > 0 && summary.contradicted === 0) {
        diagnostics.push('CONTRADICTIONS_PRESENT_BUT_NONE_APPLIED');
    }
    return { results, summary, diagnostics };
}
// =============================================================================
// PER-CLAIM DERIVATION
// =============================================================================
function deriveTruthStateForClaim(claim, edgesByFrom, edgesByTo, evidenceNodes, config) {
    // Get all edges touching this claim
    const edgesFrom = edgesByFrom.get(claim.id) || [];
    const edgesTo = edgesByTo.get(claim.id) || [];
    const allEdges = [...edgesFrom, ...edgesTo];
    // Categorize edges
    const contradictionEdges = allEdges.filter(e => e.type === 'CONTRADICTION' && e.weight >= config.minContradictionWeight);
    const supportEdges = allEdges.filter(e => e.type === 'SUPPORT' && e.weight >= config.minSupportWeight);
    const groundingEdges = allEdges.filter(e => e.type === 'GROUNDING');
    // Rule 1: Check for contradictions (highest priority)
    if (contradictionEdges.length > 0) {
        return {
            claimId: claim.id,
            truthState: 'CONTRADICTED',
            derivedFrom: {
                supportEdges: supportEdges.map(e => e.id),
                contradictionEdges: contradictionEdges.map(e => e.id),
                groundingEdges: groundingEdges.map(e => e.id),
            },
            confidence: Math.max(...contradictionEdges.map(e => e.weight)),
        };
    }
    // Rule 2: Check for support to external evidence
    const externalSupportEdges = supportEdges.filter(e => {
        // Find the evidence node this edge points to
        const evidenceId = e.to === claim.id ? e.from : e.to;
        const evidence = evidenceNodes.find(ev => ev.id === evidenceId);
        // External evidence = non-transcript
        return evidence && evidence.evidenceKind !== 'transcript';
    });
    if (externalSupportEdges.length > 0) {
        return {
            claimId: claim.id,
            truthState: 'SUPPORTED',
            derivedFrom: {
                supportEdges: supportEdges.map(e => e.id),
                contradictionEdges: [],
                groundingEdges: groundingEdges.map(e => e.id),
            },
            confidence: Math.max(...externalSupportEdges.map(e => e.weight)),
        };
    }
    // Rule 3: Check for claim-to-claim support (if allowed)
    if (config.allowClaimToClaimSupport) {
        const claimSupportEdges = supportEdges.filter(e => {
            const otherId = e.to === claim.id ? e.from : e.to;
            // It's claim-to-claim if the other ID is not in evidence nodes
            return !evidenceNodes.some(ev => ev.id === otherId);
        });
        // Only count as supported if the supporting claim itself is supported
        // (This prevents circular support chains from creating false SUPPORTED states)
        // For now, we're conservative and don't count this
        // A full implementation would trace the chain
    }
    // Rule 4: Check for grounding (transcript traceability)
    if (groundingEdges.length > 0) {
        return {
            claimId: claim.id,
            truthState: 'UNVERIFIED',
            derivedFrom: {
                supportEdges: [],
                contradictionEdges: [],
                groundingEdges: groundingEdges.map(e => e.id),
            },
            confidence: Math.max(...groundingEdges.map(e => e.weight)),
        };
    }
    // Rule 5: No edges = ungrounded
    return {
        claimId: claim.id,
        truthState: 'UNGROUNDED',
        derivedFrom: {
            supportEdges: [],
            contradictionEdges: [],
            groundingEdges: [],
        },
        confidence: 0,
    };
}
// =============================================================================
// EDGE INDEX BUILDER
// =============================================================================
function buildEdgeIndex(edges, by) {
    const index = new Map();
    const allEdges = [
        ...edges.support,
        ...edges.contradiction,
        ...edges.grounding,
        ...edges.actionResult,
        ...edges.correction,
    ];
    for (const edge of allEdges) {
        const key = by === 'from' ? edge.from : edge.to;
        if (!index.has(key)) {
            index.set(key, []);
        }
        index.get(key).push(edge);
        // For undirected edges (contradiction), add reverse lookup
        if (edge.type === 'CONTRADICTION') {
            const reverseKey = by === 'from' ? edge.to : edge.from;
            if (!index.has(reverseKey)) {
                index.set(reverseKey, []);
            }
            // Only add if not already present
            if (!index.get(reverseKey).includes(edge)) {
                index.get(reverseKey).push(edge);
            }
        }
    }
    return index;
}
export function computeTruthScores(derivation, hasExternalEvidence = false) {
    const { summary } = derivation;
    const total = summary.total;
    // CRITICAL: If no claims exist, we cannot compute meaningful scores
    // Return null for all scores (not fake 100s) - let blendScores handle it
    if (total === 0) {
        return {
            transcriptGrounding: 0,
            externalVerification: 0,
            consistency: null, // No claims = cannot compute consistency (not 100)
            auditTruth: null, // No claims = cannot compute truth (not 0)
            modeAware: {
                consistencyScore: null, // No claims = cannot compute (not 100)
                groundingScore: 0,
                evidenceScore: 0,
            },
        };
    }
    // Transcript grounding: supported + unverified (they have grounding edges)
    const groundedCount = summary.supported + summary.unverified;
    const transcriptGrounding = (groundedCount / total) * 100;
    // External verification: only supported claims
    const externalVerification = (summary.supported / total) * 100;
    // Consistency: inverse of contradiction rate
    const contradictionRate = summary.contradicted / total;
    const consistency = Math.round((1 - contradictionRate) * 100);
    // Mode-aware scoring: separate scores for clarity
    const consistencyScore = consistency;
    const groundingScore = Math.round(transcriptGrounding);
    const evidenceScore = hasExternalEvidence ? Math.round(externalVerification) : 0;
    // Mode-aware truth score blending
    // Transcript-only: weight grounding+consistency higher, evidence lower/0
    // Evidence-backed: include evidence score
    let auditTruth;
    if (hasExternalEvidence) {
        // Evidence-backed mode: include evidence score
        // Weight: evidence 40%, consistency 35%, grounding 25%
        auditTruth = Math.round(evidenceScore * 0.4 +
            consistencyScore * 0.35 +
            groundingScore * 0.25);
    }
    else {
        // Transcript-only mode: weight grounding+consistency higher, evidence lower/0
        // Weight: consistency 50%, grounding 50% (no evidence penalty)
        // Transcript-only doesn't produce harsh truth penalties for "no external evidence"
        auditTruth = Math.round(consistencyScore * 0.5 +
            groundingScore * 0.5);
    }
    // Enforce saturation rule: truth=100 only when truly perfect
    // Truth score should reflect: contradictions (high impact), ungrounded claims (medium), risky commitments (high)
    // Truth=100 requires: no contradictions, high grounding, decent support signals
    if (auditTruth >= 100) {
        // Check if all conditions for perfect score are met
        const hasNoContradictions = summary.contradicted === 0;
        const hasHighGrounding = transcriptGrounding >= 80; // At least 80% of claims grounded
        const hasDecentSupport = hasExternalEvidence
            ? externalVerification > 0 // In evidence mode, need external verification
            : transcriptGrounding >= 90; // In transcript-only, need very high grounding
        const hasLowUngrounded = summary.ungrounded / total <= 0.1; // Less than 10% ungrounded
        if (!hasNoContradictions || !hasHighGrounding || !hasDecentSupport || !hasLowUngrounded) {
            // Cap at 99 if conditions not met (prevents false perfect scores)
            // This ensures truth score cannot saturate unless truly perfect
            auditTruth = 99;
        }
    }
    // Also ensure truth cannot be 0 unless truly no grounding and contradictions
    // (Prevents false negatives)
    if (auditTruth <= 0 && (transcriptGrounding > 0 || summary.contradicted === 0)) {
        // If there's any grounding or no contradictions, truth should be > 0
        auditTruth = Math.max(1, Math.round(transcriptGrounding * 0.3 + consistency * 0.2));
    }
    return {
        transcriptGrounding: Math.round(transcriptGrounding),
        externalVerification: Math.round(externalVerification),
        consistency,
        auditTruth,
        modeAware: {
            consistencyScore,
            groundingScore,
            evidenceScore,
        },
    };
}
// =============================================================================
// APPLY TRUTH STATES TO CLAIMS (Mutates claims)
// =============================================================================
export function applyTruthStatesToClaims(claims, derivation) {
    const resultMap = new Map(derivation.results.map(r => [r.claimId, r]));
    for (const claim of claims) {
        const result = resultMap.get(claim.id);
        if (result) {
            claim.truthState = result.truthState;
            claim.truthConfidence = result.confidence;
            claim.truthDerivedFrom = result.derivedFrom;
        }
    }
}
