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
    return { results, summary };
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
export function computeTruthScores(derivation) {
    const { summary } = derivation;
    const total = summary.total;
    if (total === 0) {
        return {
            transcriptGrounding: 0,
            externalVerification: 0,
            consistency: 100,
            auditTruth: 0,
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
    // Audit truth: weighted combination
    // - External verification is most important for audit
    // - Consistency affects credibility
    // - Grounding is baseline
    const auditTruth = Math.round(externalVerification * 0.5 +
        consistency * 0.3 +
        transcriptGrounding * 0.2);
    return {
        transcriptGrounding: Math.round(transcriptGrounding),
        externalVerification: Math.round(externalVerification),
        consistency,
        auditTruth,
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
