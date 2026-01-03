/**
 * Narrative Templates Configuration
 *
 * All issue narrative text generation uses these templates.
 * Templates support variable substitution: {{variableName}}
 *
 * NO hard-coded narrative text in code - everything comes from here.
 */
export interface NarrativeTemplates {
    /** Title templates by issue type */
    titles: {
        contradiction: string;
        ungrounded: string;
        unverified: string;
        circular: string;
        policyViolation: string;
        generic: string;
    };
    /** "What's wrong" templates */
    whatIsWrong: {
        contradiction: string;
        ungrounded: string;
        unverified: string;
        circular: string;
        policyViolation: string;
        generic: string;
    };
    /** "Why wrong" bullet templates */
    whyWrong: {
        contradiction: string[];
        ungrounded: string[];
        unverified: string[];
        circular: string[];
        policyViolation: string[];
        generic: string[];
    };
    /** "Why it matters" bullet templates */
    whyItMatters: {
        contradiction: string[];
        ungrounded: string[];
        unverified: string[];
        circular: string[];
        policyViolation: string[];
        generic: string[];
    };
    /** Recommended action templates */
    recommendedActions: {
        contradiction: Array<{
            type: string;
            action: string;
        }>;
        ungrounded: Array<{
            type: string;
            action: string;
        }>;
        unverified: Array<{
            type: string;
            action: string;
        }>;
        circular: Array<{
            type: string;
            action: string;
        }>;
        policyViolation: Array<{
            type: string;
            action: string;
        }>;
        generic: Array<{
            type: string;
            action: string;
        }>;
    };
    /** Score rationale templates */
    scoreRationale: {
        highRisk: string[];
        mediumRisk: string[];
        lowRisk: string[];
    };
}
export declare const DEFAULT_TEMPLATES: NarrativeTemplates;
/**
 * Get templates, allowing environment or custom overrides.
 */
export declare function getTemplates(custom?: Partial<NarrativeTemplates>): NarrativeTemplates;
/**
 * Substitute variables in a template string.
 * Supports {{variableName}} syntax.
 */
export declare function substituteTemplate(template: string, vars: Record<string, string | number>): string;
