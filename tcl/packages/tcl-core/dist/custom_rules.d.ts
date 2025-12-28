/**
 * Custom rule validation engine
 * Allows domain-specific validation rules (call center, legal, medical, etc.)
 * Decoupled from specific implementations - works for any domain
 */
import type { Claim, Violation, CustomRule, ValidateInput } from "./types.js";
/**
 * Validate claims against custom rules
 */
export declare function validateCustomRules(claims: Claim[], input: ValidateInput, customRules: CustomRule[]): Violation[];
/**
 * Example rule sets for common domains
 * These are examples - customers can define their own
 */
export declare const ExampleRuleSets: {
    callCenter: ({
        id: string;
        name: string;
        description: string;
        pattern: {
            type: "contains";
            value: string;
            caseSensitive: boolean;
        };
        scope: "document";
        severity: "error";
        suggestion: string;
    } | {
        id: string;
        name: string;
        description: string;
        pattern: {
            type: "regex";
            value: string;
            caseSensitive: boolean;
        };
        scope: "claim";
        severity: "warning";
        suggestion?: undefined;
    })[];
    legal: {
        id: string;
        name: string;
        description: string;
        pattern: {
            type: "contains";
            value: string;
            caseSensitive: boolean;
        };
        scope: "document";
        severity: "error";
    }[];
    medical: {
        id: string;
        name: string;
        description: string;
        pattern: {
            type: "contains";
            value: string;
            caseSensitive: boolean;
        };
        scope: "document";
        severity: "error";
    }[];
};
