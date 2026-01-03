/**
 * Issue Taxonomy Configuration
 *
 * Defines categories, subcategories, and their risk multipliers.
 * All category mappings must come from here - NO hard-coded categories.
 */
export interface CategoryDefinition {
    /** Display name */
    label: string;
    /** Risk multiplier (0-2, where 1.0 is baseline) */
    riskMultiplier: number;
    /** Subcategories */
    subcategories: Record<string, {
        label: string;
        riskMultiplier: number;
    }>;
}
export interface IssueTaxonomy {
    categories: Record<string, CategoryDefinition>;
    /** Severity thresholds (0-100) */
    severity: {
        low: number;
        medium: number;
        high: number;
        critical: number;
    };
    /** Confidence thresholds (0-1) */
    confidence: {
        low: number;
        medium: number;
        high: number;
    };
    /** Issue type definitions */
    issueTypes: {
        contradiction: string;
        ungrounded: string;
        unverified: string;
        circular: string;
        policyViolation: string;
        generic: string;
    };
}
export declare const DEFAULT_TAXONOMY: IssueTaxonomy;
/**
 * Get taxonomy, allowing custom overrides.
 */
export declare function getTaxonomy(custom?: Partial<IssueTaxonomy>): IssueTaxonomy;
/**
 * Map numeric risk score to severity label.
 */
export declare function getSeverity(riskScore: number, taxonomy?: IssueTaxonomy): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
/**
 * Map numeric confidence to confidence label.
 */
export declare function getConfidence(confidenceScore: number, taxonomy?: IssueTaxonomy): "LOW" | "MEDIUM" | "HIGH";
/**
 * Get risk multiplier for a category/subcategory.
 */
export declare function getRiskMultiplier(category: string, subcategory?: string, taxonomy?: IssueTaxonomy): number;
