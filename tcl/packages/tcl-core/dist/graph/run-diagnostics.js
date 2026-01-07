/**
 * Run Diagnostics
 *
 * Replaces boolean "refusal" with structured run status.
 *
 * Status:
 * - OK: Graph is healthy, spectral analysis is meaningful
 * - DEGRADED: Graph has issues, spectral results may be unreliable
 * - FAILED: Graph construction failed, results should not be used
 */
import { getTemplateConfig } from './template-config.js';
// =============================================================================
// DIAGNOSTIC REASONS (String constants for UI)
// =============================================================================
export const DIAGNOSTIC_REASONS = {
    PAIR_BUDGET_STARVED: 'Candidate pair budget was exhausted; some claims may not have been compared',
    NO_SUPPORT_EVIDENCE: 'No external evidence (policies, facts) provided; cannot verify claims',
    TOPIC_SEGMENTATION_LOW_CONF: 'Topic segmentation had low confidence; edge gating may be unreliable',
    TOO_FEW_CLAIMS: 'Too few claims extracted for meaningful analysis',
    TOO_MANY_UNGROUNDED: 'High percentage of ungrounded claims; transcript parsing may have issues',
    HIGH_CONTRADICTION_RATE: 'Unusually high contradiction rate; check edge classification thresholds',
    NO_GROUNDING_EDGES: 'No grounding edges created; claims may not be linked to transcript',
    SPECTRAL_SKIPPED: 'Spectral analysis was skipped; global coherence metrics unavailable',
    EMPTY_GRAPH: 'Graph has no edges; analysis is not meaningful',
    CONFIG_MISMATCH: 'Configuration inconsistencies detected',
};
export function buildRunDiagnostics(input) {
    const config = getTemplateConfig();
    const reasons = [];
    const counters = {};
    // Track counters
    counters.totalClaims = input.truthSummary.total;
    counters.totalCandidates = input.candidateDiagnostics.totalCandidatesGenerated;
    counters.edgesCreated = input.edgeDiagnostics.edgesCreated;
    counters.rejectedBySlotGating = input.edgeDiagnostics.rejectedBySlotGating;
    counters.rejectedByPolarityGating = input.edgeDiagnostics.rejectedByPolarityGating;
    counters.rejectedByThreshold = input.edgeDiagnostics.rejectedByThreshold;
    counters.supported = input.truthSummary.supported;
    counters.contradicted = input.truthSummary.contradicted;
    counters.unverified = input.truthSummary.unverified;
    counters.ungrounded = input.truthSummary.ungrounded;
    // Check for issues
    // 1. Pair budget exhaustion
    if (input.candidateDiagnostics.budgetExhausted) {
        reasons.push(DIAGNOSTIC_REASONS.PAIR_BUDGET_STARVED);
    }
    // 2. No external evidence
    if (!input.hasExternalEvidence) {
        reasons.push(DIAGNOSTIC_REASONS.NO_SUPPORT_EVIDENCE);
    }
    // 3. Too few claims
    if (input.truthSummary.total < 3) {
        reasons.push(DIAGNOSTIC_REASONS.TOO_FEW_CLAIMS);
    }
    // 4. High ungrounded rate
    const ungroundedRate = input.truthSummary.total > 0
        ? input.truthSummary.ungrounded / input.truthSummary.total
        : 0;
    if (ungroundedRate > 0.5 && input.truthSummary.total > 5) {
        reasons.push(DIAGNOSTIC_REASONS.TOO_MANY_UNGROUNDED);
    }
    // 5. High contradiction rate
    const contradictionRate = input.truthSummary.total > 0
        ? input.truthSummary.contradicted / input.truthSummary.total
        : 0;
    if (contradictionRate > 0.5 && input.truthSummary.total > 5) {
        reasons.push(DIAGNOSTIC_REASONS.HIGH_CONTRADICTION_RATE);
    }
    // 6. No grounding edges
    if (input.truthSummary.unverified === 0 && input.truthSummary.supported === 0 && input.truthSummary.total > 0) {
        reasons.push(DIAGNOSTIC_REASONS.NO_GROUNDING_EDGES);
    }
    // 7. Spectral skipped
    if (input.spectralSkipped) {
        reasons.push(DIAGNOSTIC_REASONS.SPECTRAL_SKIPPED);
    }
    // 8. Empty graph
    if (input.edgeDiagnostics.edgesCreated === 0 && input.truthSummary.total > 2) {
        reasons.push(DIAGNOSTIC_REASONS.EMPTY_GRAPH);
    }
    // Determine status
    let status;
    // FAILED conditions
    if (input.truthSummary.total === 0 ||
        (input.edgeDiagnostics.edgesCreated === 0 && input.truthSummary.total > 2)) {
        status = 'FAILED';
    }
    // DEGRADED conditions
    else if (reasons.length > 0) {
        status = 'DEGRADED';
    }
    // OK
    else {
        status = 'OK';
    }
    return {
        status,
        reasons,
        counters,
        timestamp: new Date().toISOString(),
    };
}
export function validateGraphIntegrity(graph) {
    const violations = [];
    // Check 1: All contradiction edges must have same slotType/entityKey
    for (const edge of graph.edges.contradiction) {
        if (!edge.slot || edge.slot.slotType === 'unknown') {
            violations.push(`Contradiction edge ${edge.id} missing valid slot information`);
        }
    }
    // Check 2: All edges must have rationale
    const allEdges = [
        ...graph.edges.support,
        ...graph.edges.contradiction,
        ...graph.edges.grounding,
        ...graph.edges.actionResult,
        ...graph.edges.correction,
    ];
    for (const edge of allEdges) {
        if (!edge.rationale || !edge.rationale.method) {
            violations.push(`Edge ${edge.id} missing rationale`);
        }
    }
    // Check 3: All edges must have provenance
    for (const edge of allEdges) {
        if (!edge.provenance) {
            violations.push(`Edge ${edge.id} missing provenance`);
        }
    }
    // Check 4: Edge IDs must be unique
    const seenIds = new Set();
    for (const edge of allEdges) {
        if (seenIds.has(edge.id)) {
            violations.push(`Duplicate edge ID: ${edge.id}`);
        }
        seenIds.add(edge.id);
    }
    // Check 5: Edges must reference existing nodes
    const nodeIds = new Set([
        ...graph.nodes.claims.map(c => c.id),
        ...graph.nodes.evidence.map(e => e.id),
        ...graph.nodes.actions.map(a => a.id),
        ...graph.nodes.topics.map(t => t.id),
    ]);
    for (const edge of allEdges) {
        if (!nodeIds.has(edge.from)) {
            violations.push(`Edge ${edge.id} references non-existent node: ${edge.from}`);
        }
        if (!nodeIds.has(edge.to)) {
            violations.push(`Edge ${edge.id} references non-existent node: ${edge.to}`);
        }
    }
    return {
        isValid: violations.length === 0,
        violations,
    };
}
export function formatDiagnosticsForUI(diagnostics) {
    const statusLabels = {
        'OK': 'Analysis Complete',
        'DEGRADED': 'Analysis Complete with Warnings',
        'FAILED': 'Analysis Failed',
    };
    const statusDescriptions = {
        'OK': 'The claim graph was built successfully and spectral analysis is reliable.',
        'DEGRADED': 'The analysis completed but some aspects may be unreliable. Review the warnings below.',
        'FAILED': 'The analysis could not be completed. The results should not be used.',
    };
    return {
        status: diagnostics.status,
        statusLabel: statusLabels[diagnostics.status],
        statusDescription: statusDescriptions[diagnostics.status],
        reasons: diagnostics.reasons.map(r => ({
            code: Object.entries(DIAGNOSTIC_REASONS).find(([k, v]) => v === r)?.[0] || 'UNKNOWN',
            message: r,
        })),
        counters: {
            totalClaims: { label: 'Total Claims', value: diagnostics.counters.totalClaims || 0 },
            edgesCreated: { label: 'Edges Created', value: diagnostics.counters.edgesCreated || 0 },
            supported: { label: 'Supported Claims', value: diagnostics.counters.supported || 0 },
            contradicted: { label: 'Contradicted Claims', value: diagnostics.counters.contradicted || 0 },
            unverified: { label: 'Unverified Claims', value: diagnostics.counters.unverified || 0 },
            ungrounded: { label: 'Ungrounded Claims', value: diagnostics.counters.ungrounded || 0 },
        },
    };
}
