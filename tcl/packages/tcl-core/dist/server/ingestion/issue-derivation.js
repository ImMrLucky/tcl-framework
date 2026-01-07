/**
 * Issue Derivation Module
 *
 * Deterministic rules for deriving "Top Claim Issues" from spectral outputs.
 *
 * This module ensures:
 * - Consistent issue type assignment based on truthState + edges
 * - Realistic severity scoring (0-100)
 * - Full traceability to evidence anchors
 * - Audit-grade reproducibility
 */
import { createHash } from "crypto";
// =============================================================================
// ISSUE TYPE DERIVATION (Deterministic Rules)
// =============================================================================
/**
 * Derive issue type from spectral outputs
 *
 * Rules (in priority order):
 * 1. If truthState == "Contradicted" => "contradiction"
 * 2. If truthState == "Ungrounded" => "ungrounded"
 * 3. If claim appears in topBadSupports => "inconsistent_support"
 * 4. If claim appears in topBadContradictions => "inconsistent_contradiction"
 * 5. If truthState == "Inconclusive" => "needs_review"
 * 6. Else: not an issue (return null)
 */
export function deriveIssueType(claimId, truthState, topBadContradictions, topBadSupports) {
    // Normalize truth state to uppercase for comparison
    const normalizedState = truthState?.toUpperCase();
    // Rule 1: Contradicted claims (handle both "Contradicted" and "CONTRADICTED")
    if (normalizedState === "CONTRADICTED") {
        return "contradiction";
    }
    // Rule 2: Ungrounded claims (NO evidence at all)
    if (normalizedState === "UNGROUNDED") {
        return "ungrounded";
    }
    // Rule 2b: Unverified claims (has transcript evidence but no external verification)
    // IMPORTANT: UNVERIFIED is not inherently an issue - it's expected in transcript-only mode
    // Only flag as issue if claim is in bad edges
    if (normalizedState === "UNVERIFIED") {
        // Check if claim is in any problematic edges
        const inBadContradictions = topBadContradictions.some(e => e.claimAId === claimId || e.claimBId === claimId);
        const inBadSupports = topBadSupports.some(e => e.claimAId === claimId || e.claimBId === claimId);
        // Only flag UNVERIFIED claims that are in problematic edges
        if (inBadContradictions) {
            return "inconsistent_contradiction";
        }
        if (inBadSupports) {
            return "inconsistent_support";
        }
        // UNVERIFIED with no bad edges is NOT an issue - it's normal for transcript-only mode
        return null;
    }
    // Rule 3: Claims in bad supports (inconsistent support relationships)
    const inBadSupports = topBadSupports.some(e => e.claimAId === claimId || e.claimBId === claimId);
    if (inBadSupports) {
        return "inconsistent_support";
    }
    // Rule 4: Claims in bad contradictions (but not fully contradicted)
    const inBadContradictions = topBadContradictions.some(e => e.claimAId === claimId || e.claimBId === claimId);
    if (inBadContradictions) {
        return "inconsistent_contradiction";
    }
    // Rule 5: Inconclusive claims
    if (normalizedState === "INCONCLUSIVE") {
        return "needs_review";
    }
    // Rule 6: SUPPORTED claims are NOT issues - they're verified
    if (normalizedState === "SUPPORTED") {
        return null;
    }
    // Not an issue
    return null;
}
// =============================================================================
// SEVERITY SCORING (0-100)
// =============================================================================
/**
 * Compute severity score (0-100)
 *
 * Formula:
 *   base = nodeBlameNorm[i] * 70
 *   edgeContribution = sum(incident bad edge badness) normalized to 0..30
 *   roleBonus = (role=agent && issueType in {contradiction, ungrounded}) ? 5 : 0
 *   final = clamp(base + edgeContribution + roleBonus, 0, 100)
 */
export function computeSeverity(claimId, nodeBlameNorm, issueType, role, topBadContradictions, topBadSupports) {
    // Base score from node blame (0-70)
    const base = nodeBlameNorm * 70;
    // Calculate edge contribution
    let totalBadness = 0;
    let edgeCount = 0;
    for (const edge of [...topBadContradictions, ...topBadSupports]) {
        if (edge.claimAId === claimId || edge.claimBId === claimId) {
            totalBadness += edge.badness ?? edge.weight ?? 0.5;
            edgeCount++;
        }
    }
    // Normalize edge contribution to 0-30
    const avgBadness = edgeCount > 0 ? totalBadness / edgeCount : 0;
    const edgeContribution = Math.min(30, avgBadness * 30);
    // Role bonus for agent issues
    const roleBonus = (role === "agent" &&
        (issueType === "contradiction" || issueType === "ungrounded")) ? 5 : 0;
    // Final score, clamped 0-100
    const final = Math.min(100, Math.max(0, Math.round(base + edgeContribution + roleBonus)));
    return final;
}
/**
 * Get severity label from score
 */
export function getSeverityLabel(score) {
    if (score >= 80)
        return "critical";
    if (score >= 60)
        return "high";
    if (score >= 40)
        return "medium";
    return "low";
}
// =============================================================================
// "WHY" EXPLANATION GENERATION
// =============================================================================
/**
 * Generate human-readable "why" explanation for an issue
 */
export function generateWhyExplanation(issueType, claimText, conflicts) {
    switch (issueType) {
        case "contradiction":
            if (conflicts.length > 0) {
                const topConflict = conflicts.find(c => c.type === "contradiction");
                if (topConflict) {
                    const conflictSummary = topConflict.claimText.length > 60
                        ? topConflict.claimText.substring(0, 57) + "..."
                        : topConflict.claimText;
                    return `Conflicts with later statement: "${conflictSummary}"`;
                }
            }
            return "Directly contradicts another statement in the conversation.";
        case "ungrounded":
            return "No supporting evidence found in documents, policies, or verified sources.";
        case "inconsistent_support":
            return "Support relationship is inconsistent with other statements.";
        case "inconsistent_contradiction":
            return "Part of a contradictory relationship chain.";
        case "needs_review":
            return "Claim could not be fully verified; manual review recommended.";
        default:
            return "Issue detected during analysis.";
    }
}
/**
 * Build IssueDTO array from spectral outputs and claims
 *
 * This is the main function that produces the "Top Claim Issues" table data.
 */
export function buildIssueDTOs(input) {
    const { claims, spectral, artifactId } = input;
    const truthStates = spectral.truthStates || [];
    const nodeBlameNorm = spectral.nodeBlameNorm || [];
    const topBadContradictions = spectral.topBadContradictions || [];
    const topBadSupports = spectral.topBadSupports || [];
    // Build claim lookup
    const claimMap = new Map(claims.map(c => [c.id, c]));
    const issues = [];
    for (let i = 0; i < claims.length; i++) {
        const claim = claims[i];
        const truthState = truthStates[i] || "Inconclusive";
        const blame = nodeBlameNorm[i] || 0;
        // Derive issue type
        const issueType = deriveIssueType(claim.id, truthState, topBadContradictions, topBadSupports);
        // Skip non-issues
        if (!issueType)
            continue;
        // Get related edges
        const relatedEdges = [];
        for (const edge of topBadContradictions) {
            if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
                relatedEdges.push({
                    type: "contradiction",
                    claimAId: edge.claimAId || "",
                    claimBId: edge.claimBId || "",
                    badness: edge.badness ?? edge.weight ?? 0.5,
                });
            }
        }
        for (const edge of topBadSupports) {
            if (edge.claimAId === claim.id || edge.claimBId === claim.id) {
                relatedEdges.push({
                    type: "support",
                    claimAId: edge.claimAId || "",
                    claimBId: edge.claimBId || "",
                    badness: edge.badness ?? edge.weight ?? 0.5,
                });
            }
        }
        // Build conflict list for "why" explanation
        const conflicts = relatedEdges.map(e => {
            const otherId = e.claimAId === claim.id ? e.claimBId : e.claimAId;
            const otherClaim = claimMap.get(otherId);
            return {
                claimId: otherId,
                claimText: otherClaim?.text || otherId,
                type: e.type,
            };
        });
        // Compute severity
        const severity = computeSeverity(claim.id, blame, issueType, claim.role, topBadContradictions, topBadSupports);
        // Generate explanation
        const why = generateWhyExplanation(issueType, claim.text, conflicts);
        const issue = {
            rank: 0, // Will be set after sorting
            issueType,
            severity,
            claimId: claim.id,
            claimText: claim.text,
            speakerRole: claim.role,
            speakerLabel: claim.speakerLabel,
            artifactId: claim.artifactId || artifactId,
            turnIndex: claim.turnIndex,
            lineStart: claim.lineStart,
            lineEnd: claim.lineEnd,
            startTimeMs: claim.startTimeMs,
            endTimeMs: claim.endTimeMs,
            why,
            relatedEdges,
            actions: ["view_evidence", "export_csv", "export_json", "add_to_audit_packet"],
        };
        issues.push(issue);
    }
    // Sort by severity (descending) and assign ranks
    issues.sort((a, b) => b.severity - a.severity);
    issues.forEach((issue, idx) => {
        issue.rank = idx + 1;
    });
    return issues;
}
// =============================================================================
// CLAIM EXTRACTION WITH ANCHORS
// =============================================================================
/**
 * Extract claims from normalized turns and add evidence anchors
 */
export function extractClaimsWithAnchors(turns, artifactId, existingClaims) {
    const claimsWithAnchors = [];
    // If we have existing claims (from LLM extraction), enhance them with anchors
    if (existingClaims && existingClaims.length > 0) {
        for (const claim of existingClaims) {
            // Find matching turn
            const turnIndex = claim.meta?.turnIndex ?? 0;
            const turn = turns.find(t => t.turnIndex === turnIndex) || turns[0];
            claimsWithAnchors.push({
                id: claim.id,
                text: claim.text,
                turnIndex: turnIndex,
                participantId: turn?.participantId || "unknown",
                role: turn?.role || "unknown",
                speakerLabel: turn?.speakerLabel || claim.meta?.speaker || "Unknown",
                artifactId,
                lineStart: turn?.lineStart,
                lineEnd: turn?.lineEnd,
                startTimeMs: turn?.startTimeMs,
                endTimeMs: turn?.endTimeMs,
                charStart: turn?.charStart,
                charEnd: turn?.charEnd,
                meta: {
                    extractorVersion: "claims.v1",
                    sentenceIndex: claim.meta?.sentenceIndex ?? 0,
                    confidence: claim.confidence,
                },
            });
        }
        return claimsWithAnchors;
    }
    // Fallback: create claims from turns (sentence splitting)
    let sentenceCounter = 0;
    for (const turn of turns) {
        // Simple sentence splitting
        const sentences = turn.text
            .split(/(?<=[.!?])\s+/)
            .map(s => s.trim())
            .filter(s => s.length > 10);
        for (let sentenceIdx = 0; sentenceIdx < sentences.length; sentenceIdx++) {
            const sentence = sentences[sentenceIdx];
            // Generate deterministic claim ID
            const id = generateDeterministicClaimId(artifactId, turn.turnIndex, sentenceIdx, sentence);
            claimsWithAnchors.push({
                id,
                text: sentence,
                turnIndex: turn.turnIndex,
                participantId: turn.participantId,
                role: turn.role,
                speakerLabel: turn.speakerLabel,
                artifactId,
                lineStart: turn.lineStart,
                lineEnd: turn.lineEnd,
                startTimeMs: turn.startTimeMs,
                endTimeMs: turn.endTimeMs,
                charStart: turn.charStart,
                charEnd: turn.charEnd,
                meta: {
                    extractorVersion: "claims.v1",
                    sentenceIndex: sentenceIdx,
                },
            });
            sentenceCounter++;
        }
    }
    return claimsWithAnchors;
}
/**
 * Generate deterministic claim ID
 */
function generateDeterministicClaimId(artifactId, turnIndex, sentenceIndex, claimText) {
    const normalized = claimText.trim().toLowerCase().replace(/\s+/g, " ");
    const input = `${artifactId}:${turnIndex}:${sentenceIndex}:${normalized}`;
    const hash = createHash("sha256").update(input).digest("hex").substring(0, 12);
    return `c_${hash}`;
}
// =============================================================================
// ISSUE TYPE LABELS
// =============================================================================
export const ISSUE_TYPE_LABELS = {
    contradiction: "Contradiction",
    ungrounded: "Ungrounded Claim",
    unverified: "Unverified (Transcript Only)",
    inconsistent_support: "Inconsistent Support",
    inconsistent_contradiction: "Inconsistent Contradiction",
    needs_review: "Needs Review",
};
