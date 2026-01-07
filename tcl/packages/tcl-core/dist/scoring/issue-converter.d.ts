/**
 * Issue Converter
 *
 * Converts IssueV2 to TclIssueV3 (contract V3) with backwards compatibility.
 */
import type { IssueV2 } from '../types.js';
import type { TclIssueV3 } from '../contracts/issue.contract.js';
/**
 * Convert IssueV2 to TclIssueV3
 *
 * @param issue - IssueV2 (legacy format)
 * @param templateId - Optional template ID for stable ID generation
 * @param topicId - Optional topic ID for stable ID generation
 * @returns TclIssueV3 (contract V3)
 */
export declare function convertIssueV2ToV3(issue: IssueV2, templateId?: string, topicId?: string): TclIssueV3;
/**
 * Backwards compatibility: Convert TclIssueV3 back to IssueV2 format
 */
export declare function convertIssueV3ToV2(issue: TclIssueV3): IssueV2;
