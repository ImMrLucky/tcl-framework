/**
 * Issue Cluster Collapse Module
 *
 * Collapses atomic issues into grouped/clustered issues for "Top Issues (Grouped)" table.
 * Groups all issues with the same clusterId into a single rollup row.
 *
 * Spec: Rename "Atomic vs Grouped" + Implement topIssuesV2 Cluster Collapsing
 */
import type { IssueV2, GroupedIssue } from '../types.js';
/**
 * Collapse atomic issues into grouped clusters
 * Groups by clusterId and creates one GroupedIssue per cluster
 */
export declare function collapseIssuesToClusters(atomicIssues: IssueV2[]): GroupedIssue[];
