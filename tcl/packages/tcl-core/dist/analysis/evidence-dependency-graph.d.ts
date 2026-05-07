import type { Claim, ClaimSpeakerRole, EvidenceDependencyStatus, IssueV2 } from "../types.js";
export interface EvidenceNode {
    claimId: string;
    speakerType?: ClaimSpeakerRole;
    turnIndex?: number;
    claimText: string;
    claimKind?: string;
    requiredEvidenceTypes: string[];
    presentEvidenceTypes: string[];
    missingEvidenceTypes: string[];
    status: EvidenceDependencyStatus;
}
export declare function buildEvidenceDependencyGraph(claims: Claim[], issues: IssueV2[], opts: {
    hasExternalEvidence: boolean;
}): EvidenceNode[];
export declare function averageEvidenceSupportScore(nodes: EvidenceNode[], hasExternalEvidence: boolean): number;
export declare function evidenceGapCount(nodes: EvidenceNode[]): number;
