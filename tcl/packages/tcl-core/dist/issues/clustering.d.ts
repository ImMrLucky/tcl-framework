/**
 * Issue Clustering
 *
 * Groups raw claims into Issues/Problem Statements.
 * Uses semantic similarity, shared entities/topics, and graph connectivity.
 *
 * Output is deterministic: stable sorting, intermediate outputs stored.
 */
import type { ClaimForClustering, Edge, Issue, Speaker } from "./types.js";
import { type RiskModelConfig } from "../config/risk.model.js";
interface ClaimCluster {
    id: string;
    claimIds: string[];
    edgeIds: string[];
    topics: Set<string>;
    speakers: Set<Speaker>;
    turnRange: {
        min: number;
        max: number;
    };
    contradictionMass: number;
    supportMass: number;
    groundingMass: number;
}
/**
 * Cluster claims into groups that will become Issues.
 */
export declare function clusterClaims(claims: ClaimForClustering[], edges: Edge[], config?: RiskModelConfig): ClaimCluster[];
/**
 * Convert clusters into full Issue objects.
 */
export declare function generateIssues(clusters: ClaimCluster[], claims: ClaimForClustering[], edges: Edge[], config?: RiskModelConfig): Issue[];
export {};
