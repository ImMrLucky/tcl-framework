/**
 * Commitment-Strength Scoring
 *
 * Scores how committed an agent claim is on a 0..1 scale, regardless of topic.
 * Used as the backbone of:
 *  - Drift detection (commitment escalation over time)
 *  - Disclosure-omission detection (high commitment without later qualifiers)
 *  - Compliance scoring (absolute language without evidence is high risk)
 *
 * The scorer is rule-based but ordered so that the strongest signal wins.
 */
import type { Claim } from "../types.js";
export interface CommitmentScore {
    claimId: string;
    turnIndex?: number;
    text: string;
    strength: number;
    band: "hedged" | "qualified" | "asserted" | "promised" | "absolute";
    cues: string[];
    speakerType: "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";
}
export declare function scoreCommitmentStrength(claim: Claim): CommitmentScore;
export declare function scoreCommitmentStrengthMany(claims: Claim[]): CommitmentScore[];
/**
 * Map a claim to a coarse topic key. Topic keys are intentionally simple and
 * extensible via domain packs; we only need them to detect intra-topic drift.
 */
export declare function topicKey(text: string): string;
