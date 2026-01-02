/**
 * Issues Module
 * 
 * Manager-grade QA deliverables: Problem Statements ranked by risk.
 * This is the PRIMARY output users consume.
 */

// Types
export type {
  Issue,
  IssueCategory,
  IssueSeverity,
  IssueConfidence,
  IssueMetrics,
  EvidenceSnippet,
  Edge,
  EdgeType,
  Speaker,
  ClaimForClustering,
  RunSummary,
  RunReproducibility,
  IssueAnalysisOutput,
} from "./types.js";

// Analyzer (main entry point)
export { 
  analyzeForIssues, 
  exportAsJSON, 
  exportAsCSV, 
  exportAsHTML,
  type AnalyzeInput 
} from "./analyzer.js";

// Clustering (for advanced use)
export { clusterClaims, generateIssues } from "./clustering.js";

