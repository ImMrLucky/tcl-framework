/**
 * Narrative Templates Configuration
 *
 * All issue narrative text generation uses these templates.
 * Templates support variable substitution: {{variableName}}
 *
 * NO hard-coded narrative text in code - everything comes from here.
 */
export const DEFAULT_TEMPLATES = {
    titles: {
        contradiction: "Conflicting {{subcategory}} information",
        ungrounded: "Ungrounded {{subcategory}} statement",
        unverified: "Unverified {{subcategory}} claim",
        circular: "Circular support chain in {{subcategory}}",
        policyViolation: "Policy violation: {{subcategory}}",
        generic: "Issue with {{subcategory}} information",
    },
    whatIsWrong: {
        contradiction: "The agent provided conflicting information about {{subcategory}}. Statement A (turn {{turnA}}) contradicts Statement B (turn {{turnB}}).",
        ungrounded: "The agent made a statement about {{subcategory}} that is not supported by evidence in the transcript or policy documents.",
        unverified: "The agent made a claim about {{subcategory}} that could not be verified against available evidence sources.",
        circular: "Multiple claims about {{subcategory}} form a circular support chain without external grounding.",
        policyViolation: "The agent's statement about {{subcategory}} conflicts with established policy or terms of service.",
        generic: "An issue was identified with {{subcategory}} information provided during the call.",
    },
    whyWrong: {
        contradiction: [
            "These statements cannot both be true without clarification.",
            "The contradiction creates confusion about the actual terms or policy.",
            "No resolution or clarification was provided during the call.",
        ],
        ungrounded: [
            "The statement lacks supporting evidence from transcript or policy.",
            "No verification or confirmation was provided.",
            "Customer may rely on unverified information.",
        ],
        unverified: [
            "The claim could not be verified against available evidence.",
            "No policy or knowledge base reference was provided.",
            "Risk of misinformation if customer relies on this claim.",
        ],
        circular: [
            "Claims support each other without external grounding.",
            "No independent verification exists.",
            "Circular reasoning creates false confidence.",
        ],
        policyViolation: [
            "The statement conflicts with established policy.",
            "May create compliance or legal risk.",
            "Customer may have been given incorrect information.",
        ],
        generic: [
            "The information provided may be inaccurate or incomplete.",
            "Further verification is recommended.",
        ],
    },
    whyItMatters: {
        contradiction: [
            "May lead to billing disputes and customer escalations.",
            "Creates compliance risk if customer relies on incorrect terms.",
            "Damages trust and may result in churn or complaints.",
            "Could result in regulatory violations if not addressed.",
        ],
        ungrounded: [
            "Customer may make decisions based on unverified information.",
            "Creates liability if promises are not fulfilled.",
            "May lead to disputes and escalations.",
            "Reduces audit trail and defensibility.",
        ],
        unverified: [
            "Risk of misinformation spreading to other customers.",
            "May create compliance gaps.",
            "Reduces quality and trust in agent communications.",
        ],
        circular: [
            "False confidence in unverified claims.",
            "May propagate misinformation.",
            "Reduces auditability and traceability.",
        ],
        policyViolation: [
            "Direct compliance and legal risk.",
            "May result in regulatory penalties.",
            "Creates liability for the organization.",
            "Damages brand reputation and trust.",
        ],
        generic: [
            "May impact customer satisfaction and trust.",
            "Could lead to escalations or disputes.",
        ],
    },
    recommendedActions: {
        contradiction: [
            { type: "COACHING", action: "Coach agent to confirm terms in the service agreement and restate clearly." },
            { type: "COACHING", action: "Train agent to verify information before making statements." },
            { type: "PROCESS", action: "Add verification step before making commitments or stating terms." },
            { type: "COMPLIANCE", action: "Review policy documents to ensure clarity and consistency." },
        ],
        ungrounded: [
            { type: "COACHING", action: "Train agent to reference policy documents when making statements." },
            { type: "PROCESS", action: "Require agents to verify claims against knowledge base before stating." },
            { type: "SYSTEM_FIX", action: "Improve knowledge base accessibility and searchability." },
        ],
        unverified: [
            { type: "COACHING", action: "Train agent to verify claims against available evidence sources." },
            { type: "PROCESS", action: "Implement verification workflow for sensitive claims." },
            { type: "COMPLIANCE", action: "Review and update knowledge base with accurate information." },
        ],
        circular: [
            { type: "COACHING", action: "Train agent to ground statements in external evidence." },
            { type: "PROCESS", action: "Require external verification for all claims." },
            { type: "SYSTEM_FIX", action: "Improve evidence retrieval and grounding mechanisms." },
        ],
        policyViolation: [
            { type: "COACHING", action: "Immediate coaching required on policy compliance." },
            { type: "COMPLIANCE", action: "Escalate to compliance team for review." },
            { type: "PROCESS", action: "Update training materials with correct policy information." },
        ],
        generic: [
            { type: "COACHING", action: "Review call with agent to identify improvement opportunities." },
            { type: "PROCESS", action: "Consider process improvements to prevent similar issues." },
        ],
    },
    scoreRationale: {
        highRisk: [
            "High contradiction strength or policy violation detected.",
            "Multiple claims involved with strong evidence of conflict.",
            "Significant business impact potential.",
        ],
        mediumRisk: [
            "Moderate contradiction or ungrounded claim detected.",
            "Some evidence of inconsistency or lack of verification.",
            "Moderate business impact potential.",
        ],
        lowRisk: [
            "Minor inconsistency or ungrounded claim.",
            "Limited evidence of significant impact.",
            "Low business impact potential.",
        ],
    },
};
/**
 * Get templates, allowing environment or custom overrides.
 */
export function getTemplates(custom) {
    if (!custom) {
        return DEFAULT_TEMPLATES;
    }
    return {
        titles: { ...DEFAULT_TEMPLATES.titles, ...custom.titles },
        whatIsWrong: { ...DEFAULT_TEMPLATES.whatIsWrong, ...custom.whatIsWrong },
        whyWrong: { ...DEFAULT_TEMPLATES.whyWrong, ...custom.whyWrong },
        whyItMatters: { ...DEFAULT_TEMPLATES.whyItMatters, ...custom.whyItMatters },
        recommendedActions: { ...DEFAULT_TEMPLATES.recommendedActions, ...custom.recommendedActions },
        scoreRationale: { ...DEFAULT_TEMPLATES.scoreRationale, ...custom.scoreRationale },
    };
}
/**
 * Substitute variables in a template string.
 * Supports {{variableName}} syntax.
 */
export function substituteTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(regex, String(value));
    }
    return result;
}
