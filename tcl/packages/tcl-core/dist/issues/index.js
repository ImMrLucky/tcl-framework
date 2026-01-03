/**
 * Issues Module
 *
 * Manager-grade QA deliverables: Problem Statements ranked by risk.
 * This is the PRIMARY output users consume.
 */
// Analyzer (main entry point)
export { analyzeForIssues, exportAsJSON, exportAsCSV, exportAsHTML } from "./analyzer.js";
// Clustering (for advanced use)
export { clusterClaims, generateIssues } from "./clustering.js";
