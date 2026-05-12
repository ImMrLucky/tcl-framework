function clamp(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}
function isProtectqaCritical(t) {
    return t.startsWith("PROTECTQA_") && /GUARANTEE|NO_RISK|APPROVAL_BEFORE|DAY_ONE|GUARANTEED_PAYOUT|HEALTH_DOES|AI_FINAL_APPROVAL/i.test(t);
}
export function computeRiskAdjustedScores(input) {
    const profile = input.profile ?? "generic";
    const disclosureCoverageRaw = clamp(input.disclosureCoverage ?? 100);
    const evidenceSupportRaw = clamp(input.evidenceSupport ?? 55);
    const speakerConfidenceRaw = clamp(input.speakerConfidence ?? 95);
    const businessValueScoreRaw = clamp(input.businessValueScore ?? 42);
    const unknownSpeakerRatio = input.unknownSpeakerRatio ?? 0;
    const criticalCount = input.issues.filter(i => i.severity === "critical").length;
    const highCount = input.issues.filter(i => i.severity === "high").length;
    const mediumCount = input.issues.filter(i => i.severity === "medium").length;
    const lowCount = input.issues.filter(i => i.severity === "low").length;
    const protectqaCriticalCount = input.issues.filter(i => isProtectqaCritical(i.type) && i.severity === "critical").length;
    const criticalHallucination = input.issues.some(i => i.severity === "critical" && /HALLUCIN|AI_HALLUCINATION|AI_UNSUPPORTED|HALLUCINATED_AUTHORITY/i.test(i.type));
    const missingCarrierDisclosure = input.issues.some(i => i.type === "PROTECTQA_MISSING_CARRIER_APPROVAL_DISCLOSURE" || /MISSING.*CARRIER|carrier approval disclosure/i.test(i.what.issueSummary));
    const guaranteedApprovalOrPayout = input.issues.some(i => i.severity === "critical" &&
        /GUARANTEED_APPROVAL|GUARANTEED_PAYOUT|PROTECTQA_GUARANTEED_APPROVAL|PROTECTQA_GUARANTEED_PAYOUT|PROTECTQA_NO_RISK_OF_DENIAL/i.test(i.type));
    const scoringCapsApplied = [];
    let factualTruth = clamp(input.factualTruth);
    let compliance = clamp(input.compliance);
    let disclosureCoverage = disclosureCoverageRaw;
    let evidenceSupport = evidenceSupportRaw;
    const speakerConfidence = speakerConfidenceRaw;
    const businessValue = businessValueScoreRaw;
    const consistency = clamp(input.consistency);
    const coherence = input.coherence === null ? null : clamp(input.coherence);
    let hallucination = clamp(input.hallucination);
    const drift = clamp(input.drift);
    const transcriptGrounding = clamp(input.transcriptGrounding);
    let tcl;
    if (profile === "protectqa") {
        tcl = Math.round(compliance * 0.35 +
            factualTruth * 0.25 +
            disclosureCoverage * 0.15 +
            evidenceSupport * 0.1 +
            drift * 0.1 +
            speakerConfidence * 0.05);
    }
    else {
        tcl = Math.round(compliance * 0.3 +
            factualTruth * 0.25 +
            evidenceSupport * 0.15 +
            consistency * 0.1 +
            hallucination * 0.1 +
            drift * 0.05 +
            (coherence ?? consistency) * 0.05);
    }
    const speakerDegraded = unknownSpeakerRatio > 0.2 || speakerConfidence < 55;
    if (protectqaCriticalCount >= 2) {
        tcl = Math.min(tcl, 30);
        factualTruth = Math.min(factualTruth, 45);
        compliance = Math.min(compliance, 30);
        scoringCapsApplied.push("PROTECTQA_CRITICAL_GE_2");
    }
    else if (protectqaCriticalCount === 1 || criticalCount >= 2) {
        tcl = Math.min(tcl, criticalCount >= 2 ? 30 : 45);
        factualTruth = Math.min(factualTruth, criticalCount >= 2 ? 40 : 55);
        compliance = Math.min(compliance, criticalCount >= 2 ? 25 : 45);
        scoringCapsApplied.push(criticalCount >= 2 ? "CRITICAL_ISSUES_GE_2" : "CRITICAL_ISSUES_EQ_1");
    }
    if (highCount >= 3) {
        tcl = Math.min(tcl, 55);
        factualTruth = Math.min(factualTruth, 65);
        compliance = Math.min(compliance, 55);
        scoringCapsApplied.push("HIGH_ISSUES_GE_3");
    }
    if (criticalHallucination) {
        hallucination = Math.min(hallucination, 45);
        tcl = Math.min(tcl, 60);
        scoringCapsApplied.push("CRITICAL_HALLUCINATION_CAP");
    }
    if (input.contaminatedClaims > 0) {
        tcl = Math.min(tcl, 60);
        scoringCapsApplied.push("CONTAMINATED_CLAIMS");
    }
    if (speakerDegraded) {
        tcl = Math.min(tcl, 65);
        scoringCapsApplied.push("SPEAKER_ATTRIBUTION_DEGRADED");
    }
    if (missingCarrierDisclosure) {
        compliance = Math.min(compliance, 60);
        scoringCapsApplied.push("MISSING_CARRIER_DISCLOSURE_COMPLIANCE_CAP");
    }
    if (guaranteedApprovalOrPayout) {
        compliance = Math.min(compliance, 35);
        scoringCapsApplied.push("GUARANTEED_APPROVAL_OR_PAYOUT_COMPLIANCE_CAP");
    }
    const level = criticalCount > 0 || tcl <= 35 ? "critical" : highCount > 0 || tcl <= 55 ? "high" : mediumCount > 0 || tcl <= 75 ? "medium" : "low";
    const top = [...input.issues].sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0))[0];
    const primaryRisk = top?.what.issueSummary ?? (level === "low" ? "No primary risk flagged" : "Conversation risk detected");
    const recommendedAction = top?.what.recommendedActionLabel ?? (level === "low" ? "No action needed" : "Compliance review");
    const businessImpact = top?.what.businessImpact ?? "Review recommended";
    return {
        scores: {
            transcriptGrounding,
            factualTruth,
            compliance,
            disclosureCoverage,
            evidenceSupport,
            speakerConfidence,
            businessValue,
            consistency,
            coherence,
            hallucination,
            drift,
            tcl: clamp(tcl),
            overall: clamp(tcl),
        },
        scoringCapsApplied,
        risk: {
            level,
            criticalCount,
            highCount,
            mediumCount,
            lowCount,
            reviewRequired: criticalCount > 0 || highCount > 0 || guaranteedApprovalOrPayout || level === "critical",
            primaryRisk,
            recommendedAction,
            businessImpact,
        },
    };
}
