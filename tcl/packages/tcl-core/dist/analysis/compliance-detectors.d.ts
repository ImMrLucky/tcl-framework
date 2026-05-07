/**
 * Compliance Detectors Module
 *
 * D: Rule-based detectors for enterprise-credible compliance issues
 * These detectors emit issues in category="compliance" with severity floor = high
 *
 * Examples:
 * - PCI: "store CVV", "save CVV", or capturing CVV in transcript
 * - Recording consent: agent denies recording while system indicates it may record
 * - PII handling based on templates (SSN collection etc.)
 */
import type { IssueV2 } from '../types.js';
export interface ComplianceDetectorResult {
    issues: IssueV2[];
}
/**
 * D: Detect compliance issues from claims
 */
export declare function detectComplianceIssues(claims: Array<{
    id: string;
    text: string;
    meta?: {
        speaker?: string;
        speakerType?: string;
        speakerLabel?: string;
        turnIndex?: number;
    };
}>, runId: string, conversationId: string, evidenceMode: 'TRANSCRIPT_ONLY' | 'TRANSCRIPT_PLUS_EXTERNAL'): ComplianceDetectorResult;
