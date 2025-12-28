/**
 * Compute ranked destructive claims with importance scoring
 *
 * This module identifies and ranks claims that are most problematic,
 * using spectral analysis, contradiction pressure, confidence metrics,
 * and policy violations.
 */
import type { Claim, GroundingEdge, ContradictionEdge, Violation, DestructiveClaim } from "./types.js";
export declare function computeDestructiveClaims(args: {
    claims: Claim[];
    contradictions: ContradictionEdge[];
    grounding: GroundingEdge[];
    customRuleViolations: Violation[];
    spectral?: {
        truthVector?: number[];
        truthStates?: string[];
        nodeBlameNorm?: number[];
    };
}): DestructiveClaim[];
