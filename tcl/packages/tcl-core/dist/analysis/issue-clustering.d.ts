/**
 * Issue Clustering Module
 *
 * Aggregates atomic issues into clustered/root-cause issues.
 * Prevents "issue spam" by grouping related issues together.
 *
 * C2-C3: Cluster scoring and aggregation
 */
import type { IssueV2, AggregatedIssue, EvalMode } from '../types.js';
export interface ClusteringResult {
    aggregatedIssues: AggregatedIssue[];
    clusterMap: Map<string, IssueV2[]>;
}
/**
 * C2-C3: Aggregate atomic issues into clustered issues
 * Groups issues by clusterKey and computes cluster scores
 */
export declare function aggregateIssues(atomicIssues: IssueV2[], evalMode: EvalMode): ClusteringResult;
