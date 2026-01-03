/**
 * Config Loader - Single source of truth for all thresholds, weights, templates
 *
 * NO HARD-CODED VALUES - everything comes from config files.
 */
export interface ScoringConfig {
    thresholds: {
        truthTau: number;
        severity: {
            low: number;
            medium: number;
            high: number;
            critical: number;
        };
        confidence: {
            low: number;
            medium: number;
            high: number;
        };
        contradictionWeight: number;
        supportWeight: number;
        groundingWeight: number;
        minContradictionScore: number;
        minSupportScore: number;
        minGroundingScore: number;
    };
    weights: {
        issueComposite: {
            risk: number;
            impact: number;
            fixability: number;
        };
        riskScore: {
            severity: number;
            contradictionStrength: number;
            topicRiskMultiplier: number;
            regulatorySensitivity: number;
        };
        impactScore: {
            category: number;
            customerHarmPotential: number;
            regulatorySensitivity: number;
        };
        fixabilityScore: {
            clarity: number;
            claimCount: number;
            turnSpan: number;
            groundedness: number;
        };
    };
    categoryRiskMultipliers: Record<string, number>;
    customerHarmIndicators: Record<string, number>;
}
export interface TemplatesConfig {
    contradiction: {
        title: string;
        whatIsWrong: string;
        whyWrong: string[];
        whyItMatters: string[];
        recommendedActions: Array<{
            type: string;
            action: string;
        }>;
    };
    ungrounded: {
        title: string;
        whatIsWrong: string;
        whyWrong: string[];
        whyItMatters: string[];
        recommendedActions: Array<{
            type: string;
            action: string;
        }>;
    };
    circular: {
        title: string;
        whatIsWrong: string;
        whyWrong: string[];
        whyItMatters: string[];
        recommendedActions: Array<{
            type: string;
            action: string;
        }>;
    };
    default: {
        title: string;
        whatIsWrong: string;
        whyWrong: string[];
        whyItMatters: string[];
        recommendedActions: Array<{
            type: string;
            action: string;
        }>;
    };
}
export interface TaxonomyConfig {
    categories: Record<string, {
        label: string;
        subcategories: string[];
        regulatorySensitivity: number;
        customerHarmPotential: number;
    }>;
    subcategoryMapping: Record<string, string>;
}
/**
 * Get scoring configuration (cached)
 */
export declare function getScoringConfig(): ScoringConfig;
/**
 * Get templates configuration (cached)
 */
export declare function getTemplatesConfig(): TemplatesConfig;
/**
 * Get taxonomy configuration (cached)
 */
export declare function getTaxonomyConfig(): TaxonomyConfig;
/**
 * Compute hash of config bundle for reproducibility
 */
export declare function computeConfigHash(): string;
/**
 * Template string substitution
 */
export declare function renderTemplate(template: string, vars: Record<string, string | number>): string;
