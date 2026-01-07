/**
 * Issue DTOs
 *
 * Explicit data transfer objects for IssueV2 API responses.
 * Maps to the IssueV2 interface expected by the UI.
 *
 * IMPORTANT: Never spread raw issue objects into DTOs.
 * Always explicitly map fields to match UI contract.
 */
import type { IssueV2 } from '../../types.js';
/**
 * Extended IssueV2 with workflow fields (matches UI contract)
 */
export interface IssueV2Dto extends IssueV2 {
    status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_POSITIVE';
    assigneeUserId?: string | null;
    workflowUpdatedAt?: string | null;
    evaluationId?: string;
    evaluationCreatedAt?: string;
}
/**
 * Convert raw issue (from report or database) to IssueV2 DTO
 *
 * Handles legacy issue formats and ensures all required fields are present.
 *
 * @param rawIssue - Raw issue from report or database
 * @param evaluationId - Optional evaluation ID to attach
 * @param evaluationCreatedAt - Optional evaluation creation date
 * @returns IssueV2Dto (extends IssueV2 with workflow fields)
 */
export declare function toIssueDto(rawIssue: any, evaluationId?: string, evaluationCreatedAt?: string): IssueV2Dto;
/**
 * Convert array of raw issues to IssueV2Dto array
 */
export declare function toIssueDtoArray(rawIssues: any[], evaluationId?: string, evaluationCreatedAt?: string): IssueV2Dto[];
