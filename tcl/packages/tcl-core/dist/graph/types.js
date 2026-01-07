/**
 * ProtectQA Canonical Graph Types
 *
 * This file defines the core data model for the Claim-Evidence-Action Graph.
 * All analysis, spectral metrics, and truth states are derived from this graph.
 *
 * INVARIANTS:
 * - Graph is the single source of truth
 * - Edges are evidence-bearing objects (explainable and traceable)
 * - Support ≠ transcript quote (transcript creates GROUNDING, not SUPPORT)
 * - Contradictions require same subject slot
 * - All thresholds and weights are config-driven
 */
// =============================================================================
// HELPER: Check if two slots match
// =============================================================================
export function slotsMatch(a, b) {
    return a.slotType === b.slotType && a.entityKey === b.entityKey;
}
// =============================================================================
// HELPER: Check if two slots are compatible (for support edges)
// =============================================================================
export function slotsCompatible(a, b) {
    // Same slot type is required
    if (a.slotType !== b.slotType)
        return false;
    // Entity keys can be different if they're in the same category
    // This allows "router_fee" to support "monthly_fee" claims
    return true;
}
