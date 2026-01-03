/**
 * Issue Analyzer
 *
 * Main entry point for generating manager-grade QA deliverables.
 * Orchestrates: extraction → clustering → scoring → narrative → export
 */
import { createHash, randomUUID } from "crypto";
import { clusterClaims, generateIssues } from "./clustering.js";
import { getRiskModelConfig } from "../config/risk.model.js";
import { buildIssueNarratives } from "./narratives.js";
import { computeConfigHash } from "../config/loader.js";
/**
 * Main entry point: analyze claims and generate manager-grade output.
 */
export function analyzeForIssues(input) {
    const startTime = Date.now();
    const config = input.config
        ? { ...getRiskModelConfig(), ...input.config }
        : getRiskModelConfig();
    // 1. Convert claims to clustering format
    const claimsForClustering = convertClaims(input.claims, input.transcript);
    // 2. Convert edges to unified format
    const edges = convertEdges(input.edges);
    // 3. Cluster claims into issue groups
    const clusters = clusterClaims(claimsForClustering, edges, config);
    console.log(`📊 Issue Analyzer: ${claimsForClustering.length} claims → ${clusters.length} clusters`);
    // 4. Generate full Issue objects
    const issues = generateIssues(clusters, claimsForClustering, edges, config);
    console.log(`📋 Generated ${issues.length} issues`);
    // 4b. Generate IssueNarratives (QA-manager-grade format)
    // Convert clusters to format expected by narrative builder
    const narrativeClusters = clusters.map(cluster => {
        // Extract top contradictions for this cluster
        const clusterEdgeIds = new Set(cluster.edgeIds);
        const clusterContradictions = edges
            .filter(e => e.type === 'CONTRADICTION' && clusterEdgeIds.has(e.id))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(e => ({
            claimAId: e.fromClaimId,
            claimBId: e.toClaimId,
            score: e.score,
            edgeId: e.id
        }));
        // Extract ungrounded claims (claims with no grounding edges)
        const clusterClaimIds = new Set(cluster.claimIds);
        const groundingEdges = edges.filter(e => e.type === 'GROUNDING' && clusterClaimIds.has(e.fromClaimId));
        const groundedClaimIds = new Set(groundingEdges.map(e => e.fromClaimId));
        const topUngrounded = cluster.claimIds.filter(id => !groundedClaimIds.has(id));
        return {
            id: cluster.id,
            claimIds: cluster.claimIds,
            edgeIds: cluster.edgeIds,
            category: 'OTHER', // Will be determined by narrative builder from topics
            subcategory: undefined, // Will be determined by narrative builder
            turnRange: [cluster.turnRange.min, cluster.turnRange.max],
            contradictionMass: cluster.contradictionMass,
            supportMass: cluster.supportMass,
            groundingMass: cluster.groundingMass,
            topContradictions: clusterContradictions,
            topUngrounded: topUngrounded.slice(0, 5)
        };
    });
    // Extract spectral data if available (will be passed from orchestrator)
    const narratives = buildIssueNarratives(narrativeClusters, input.claims, edges, undefined // spectralData - will be passed from orchestrator
    );
    console.log(`📝 Generated ${narratives.length} issue narratives`);
    // 5. Generate summary
    const summary = generateSummary(issues);
    // 6. Generate reproducibility metadata (with all hashes)
    const reproducibility = generateReproducibility(input.transcript, config);
    const processingTimeMs = Date.now() - startTime;
    return {
        summary,
        issues,
        narratives, // NEW: QA-manager-grade narratives
        claims: claimsForClustering,
        edges,
        reproducibility,
        processingTimeMs,
    };
}
// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================
function convertClaims(claims, transcript) {
    return claims.map(claim => {
        // Detect speaker from meta or text
        let speaker = "AGENT";
        if (claim.meta?.speaker) {
            speaker = claim.meta.speaker.toUpperCase();
        }
        // Extract topics from text
        const topics = extractTopicsFromText(claim.text);
        return {
            id: claim.id,
            speaker,
            text: claim.text,
            turnIndex: claim.meta?.turnIndex || 0,
            topics,
            normalizedText: claim.text.toLowerCase().trim(),
        };
    });
}
function convertEdges(edges) {
    const result = [];
    let edgeIndex = 0;
    for (const c of edges.contradictions) {
        result.push({
            id: `edge_contra_${edgeIndex++}`,
            type: "CONTRADICTION",
            fromClaimId: c.claimA,
            toClaimId: c.claimB,
            score: c.weight,
            rationale: c.reason || "Contradiction detected",
        });
    }
    for (const s of edges.supports) {
        result.push({
            id: `edge_support_${edgeIndex++}`,
            type: "SUPPORT",
            fromClaimId: s.claimA,
            toClaimId: s.claimB,
            score: s.weight,
            rationale: "Support relationship",
        });
    }
    for (const g of edges.grounding) {
        result.push({
            id: `edge_ground_${edgeIndex++}`,
            type: "GROUNDING",
            fromClaimId: g.claimId,
            toClaimId: g.sourceId,
            score: g.weight,
            rationale: g.quote ? `Grounded: "${g.quote.substring(0, 50)}..."` : "Grounded",
        });
    }
    return result;
}
function extractTopicsFromText(text) {
    const topics = [];
    const lower = text.toLowerCase();
    const topicPatterns = {
        billing: ["bill", "billing", "charge", "payment", "rate", "cost", "price"],
        fees: ["fee", "penalty", "surcharge", "extra"],
        cancellation: ["cancel", "terminate", "end", "close"],
        plan: ["plan", "package", "subscription", "service"],
        refund: ["refund", "credit", "reimburse", "money back"],
        account: ["account", "profile", "settings"],
        email: ["email", "send", "write", "confirmation"],
        promise: ["will", "i'll", "we'll", "guarantee", "promise"],
    };
    for (const [topic, keywords] of Object.entries(topicPatterns)) {
        for (const keyword of keywords) {
            if (lower.includes(keyword)) {
                topics.push(topic);
                break;
            }
        }
    }
    return topics;
}
// ============================================================================
// SUMMARY GENERATION
// ============================================================================
function generateSummary(issues) {
    const bySeverity = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        CRITICAL: 0,
    };
    const byCategory = {
        BILLING: 0,
        DISCLOSURE: 0,
        MISREPRESENTATION: 0,
        PRIVACY: 0,
        SECURITY: 0,
        PROCESS: 0,
        CUSTOMER_HARM: 0,
        REGULATORY: 0,
        PROMISE_BREACH: 0,
        OTHER: 0,
    };
    for (const issue of issues) {
        bySeverity[issue.severity]++;
        byCategory[issue.category]++;
    }
    // Find top 3 categories
    const sortedCategories = Object.entries(byCategory)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);
    return {
        totalIssues: issues.length,
        bySeverity,
        byCategory,
        primaryRiskCategories: sortedCategories,
        auditReady: true, // Will be false if hashes are missing
        auditReadyReason: undefined,
    };
}
// ============================================================================
// REPRODUCIBILITY
// ============================================================================
function generateReproducibility(transcript, config) {
    // Compute input hash (normalized transcript)
    const normalizedTranscript = transcript.trim().toLowerCase();
    const inputHash = createHash("sha256")
        .update(normalizedTranscript)
        .digest("hex")
        .substring(0, 16);
    // Compute config hash (from config loader - includes scoring, templates, taxonomy)
    const configHash = computeConfigHash();
    // Get code version (must be injected at build time)
    const codeVersion = process.env.GIT_COMMIT ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.RAILWAY_GIT_COMMIT_SHA ||
        "development";
    // Engine version
    const engineVersion = process.env.ENGINE_VERSION || "2.0.0";
    // Model fingerprint (should include all models used)
    const modelFingerprint = [
        `truth-engine:${engineVersion}`,
        `claim-extractor:v1`,
        `config:${configHash.substring(0, 8)}`
    ].join("|");
    return {
        runId: randomUUID(),
        inputHash,
        configHash,
        codeVersion,
        engineVersion,
        modelFingerprint,
        createdAt: new Date().toISOString(),
    };
}
// ============================================================================
// EXPORTS
// ============================================================================
/**
 * Export issues as JSON (for analytics).
 */
export function exportAsJSON(output) {
    return JSON.stringify(output, null, 2);
}
/**
 * Export issues as CSV (one row per issue).
 */
export function exportAsCSV(output) {
    const headers = [
        "id",
        "title",
        "severity",
        "category",
        "riskScore",
        "confidence",
        "problemStatement",
        "topEvidence",
        "claimCount",
        "tags",
    ];
    const rows = output.issues.map(issue => [
        issue.id,
        `"${issue.title.replace(/"/g, '""')}"`,
        issue.severity,
        issue.category,
        issue.metrics.riskScore,
        issue.confidence,
        `"${issue.problemStatement.replace(/"/g, '""')}"`,
        `"${(issue.primaryEvidence[0]?.quote || "").substring(0, 100).replace(/"/g, '""')}"`,
        issue.metrics.claimCount,
        `"${issue.tags.join(", ")}"`,
    ]);
    return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}
/**
 * Export as HTML report (printable/PDF-ready).
 */
export function exportAsHTML(output) {
    const { summary, issues, reproducibility } = output;
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ProtectQA Issue Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #4a4e69; padding-bottom: 10px; }
    h2 { color: #4a4e69; margin-top: 30px; }
    .summary { background: #f7f7f8; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .stat { text-align: center; }
    .stat-value { font-size: 2em; font-weight: bold; color: #1a1a2e; }
    .stat-label { color: #6c6c80; font-size: 0.9em; }
    .issue { background: white; border: 1px solid #e0e0e5; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .issue-header { display: flex; align-items: center; gap: 12px; margin-bottom: 15px; }
    .severity { padding: 4px 12px; border-radius: 4px; font-weight: 600; font-size: 0.85em; }
    .severity.CRITICAL { background: #fee2e2; color: #991b1b; }
    .severity.HIGH { background: #fef3c7; color: #92400e; }
    .severity.MEDIUM { background: #e0e7ff; color: #3730a3; }
    .severity.LOW { background: #d1fae5; color: #065f46; }
    .issue-title { font-size: 1.2em; font-weight: 600; color: #1a1a2e; }
    .problem { color: #4a4e69; margin-bottom: 15px; }
    .evidence { background: #f9fafb; padding: 15px; border-radius: 6px; margin: 10px 0; }
    .evidence-quote { font-style: italic; color: #374151; }
    .evidence-speaker { font-weight: 600; color: #6b7280; margin-bottom: 5px; }
    .section-title { font-weight: 600; color: #1a1a2e; margin: 15px 0 8px 0; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 5px; color: #4a4e69; }
    .meta { font-size: 0.8em; color: #9ca3af; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    @media print { .issue { break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>🛡️ ProtectQA Issue Report</h1>
  
  <div class="summary">
    <h2 style="margin-top: 0;">Executive Summary</h2>
    <div class="summary-grid">
      <div class="stat">
        <div class="stat-value">${summary.totalIssues}</div>
        <div class="stat-label">Total Issues</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #991b1b;">${summary.bySeverity.CRITICAL + summary.bySeverity.HIGH}</div>
        <div class="stat-label">High/Critical</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #3730a3;">${summary.bySeverity.MEDIUM}</div>
        <div class="stat-label">Medium</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #065f46;">${summary.bySeverity.LOW}</div>
        <div class="stat-label">Low</div>
      </div>
    </div>
    <p style="margin-top: 15px; color: #6c6c80;">
      Primary risk categories: ${summary.primaryRiskCategories.join(", ") || "None identified"}
    </p>
  </div>
  
  <h2>Issues (Ranked by Risk)</h2>
  
  ${issues.map(issue => `
  <div class="issue">
    <div class="issue-header">
      <span class="severity ${issue.severity}">${issue.severity}</span>
      <span class="issue-title">${escapeHtml(issue.title)}</span>
    </div>
    
    <p class="problem">${escapeHtml(issue.problemStatement)}</p>
    
    <div class="section-title">Why This Matters</div>
    <ul>
      ${issue.whyWrong.map(w => `<li>${escapeHtml(w)}</li>`).join("\n")}
    </ul>
    
    <div class="section-title">Evidence</div>
    ${issue.primaryEvidence.slice(0, 2).map(e => `
    <div class="evidence">
      <div class="evidence-speaker">${e.speaker} (Turn ${e.turnIndex})</div>
      <div class="evidence-quote">"${escapeHtml(e.quote)}"</div>
    </div>
    `).join("\n")}
    
    <div class="section-title">Recommended Action</div>
    <ul>
      ${issue.recommendedAction.map(a => `<li>${escapeHtml(a)}</li>`).join("\n")}
    </ul>
    
    <div style="margin-top: 15px; font-size: 0.85em; color: #9ca3af;">
      Confidence: ${issue.confidence} · Risk Score: ${issue.metrics.riskScore} · Tags: ${issue.tags.join(", ")}
    </div>
  </div>
  `).join("\n")}
  
  <div class="meta">
    <strong>Audit Information</strong><br>
    Run ID: ${reproducibility.runId}<br>
    Input Hash: ${reproducibility.inputHash}<br>
    Config Hash: ${reproducibility.configHash}<br>
    Engine Version: ${reproducibility.engineVersion}<br>
    Generated: ${reproducibility.createdAt}
  </div>
</body>
</html>`;
}
function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
