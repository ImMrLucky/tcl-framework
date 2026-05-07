import type { BusinessInsight, Claim, DashboardSummary, IssueV2 } from "../types.js";
import type { DriftDetectionResult } from "./drift-detector.js";
export declare function buildDashboardSummary(input: {
    tclScore: number;
    mode: "protectqa" | "tcl";
    transcriptHint: string;
    claims: Claim[];
    insights: BusinessInsight[];
    issues: IssueV2[];
    drift?: DriftDetectionResult;
    topUnsupported: Array<{
        claimText: string;
        missing: string[];
    }>;
    nextActions: string[];
}): DashboardSummary;
