/**
 * Export Functions for Issue Narratives
 * 
 * Exports QA-Manager Grade findings in CSV, JSON, and PDF-ready HTML formats.
 */

import type { IssueNarrative } from "../types.js";

export interface IssueNarrativesExport {
  narratives: IssueNarrative[];
  summary: {
    totalIssues: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    topCategories: string[];
  };
  reproducibility?: {
    inputHash: string;
    configHash: string;
    codeVersion: string;
    engineVersion: string;
    modelFingerprint: any;
  };
}

/**
 * Export issue narratives as CSV (one row per issue).
 */
export function exportNarrativesAsCSV(exportData: IssueNarrativesExport): string {
  const headers = [
    "id",
    "title",
    "category",
    "subcategory",
    "severity",
    "confidence",
    "status",
    "riskScore",
    "impactScore",
    "fixabilityScore",
    "compositeScore",
    "whatIsWrong",
    "whyWrong",
    "whyItMatters",
    "recommendedActions",
    "evidenceQuotes",
    "contradictionPairs",
    "claimCount",
    "turnRange",
    "speakerFocus",
    "tags",
  ];
  
  const rows = exportData.narratives.map(narrative => [
    narrative.issueId,
    `"${narrative.title.replace(/"/g, '""')}"`,
    narrative.category,
    narrative.subcategory || "",
    narrative.severity,
    narrative.confidence,
    narrative.status,
    narrative.scoring.riskScore,
    narrative.scoring.impactScore,
    narrative.scoring.fixabilityScore,
    narrative.scoring.compositeScore,
    `"${narrative.whatIsWrong.replace(/"/g, '""')}"`,
    `"${narrative.whyWrong.join("; ").replace(/"/g, '""')}"`,
    `"${narrative.whyItMatters.join("; ").replace(/"/g, '""')}"`,
    `"${narrative.recommendedActions.map(a => a.action).join("; ").replace(/"/g, '""')}"`,
    `"${narrative.evidenceQuotes.map(e => `${e.speaker}: "${e.text}"`).join(" | ").replace(/"/g, '""')}"`,
    narrative.contradictionPairs ? `"${narrative.contradictionPairs.map(p => `${p.claimAId} vs ${p.claimBId}`).join("; ").replace(/"/g, '""')}"` : "",
    narrative.scope.claimIds.length,
    `${narrative.scope.turnRange[0]}-${narrative.scope.turnRange[1]}`,
    narrative.scope.speakerFocus,
    `"${(narrative as any).tags?.join(", ") || ""}"`,
  ]);
  
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}

/**
 * Export issue narratives as JSON (full audit pack).
 */
export function exportNarrativesAsJSON(exportData: IssueNarrativesExport): string {
  return JSON.stringify(exportData, null, 2);
}

/**
 * Export issue narratives as HTML report (printable/PDF-ready).
 */
export function exportNarrativesAsHTML(exportData: IssueNarrativesExport): string {
  const { narratives, summary, reproducibility } = exportData;
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ProtectQA Audit Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
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
    .problem { color: #4a4e69; margin-bottom: 15px; line-height: 1.6; }
    .evidence { background: #f9fafb; padding: 15px; border-radius: 6px; margin: 10px 0; border-left: 3px solid #4a4e69; }
    .evidence-quote { font-style: italic; color: #374151; margin-top: 5px; }
    .evidence-speaker { font-weight: 600; color: #6b7280; margin-bottom: 5px; }
    .contradiction-pair { background: #fef2f2; padding: 12px; border-radius: 6px; margin: 10px 0; border-left: 3px solid #dc2626; }
    .section-title { font-weight: 600; color: #1a1a2e; margin: 15px 0 8px 0; }
    ul { margin: 0; padding-left: 20px; }
    li { margin-bottom: 5px; color: #4a4e69; line-height: 1.5; }
    .meta { font-size: 0.8em; color: #9ca3af; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    .scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 15px 0; }
    .score-item { text-align: center; padding: 8px; background: #f9fafb; border-radius: 4px; }
    .score-label { font-size: 0.75em; color: #6b7280; }
    .score-value { font-size: 1.2em; font-weight: bold; color: #1a1a2e; }
    @media print { .issue { break-inside: avoid; page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>🛡️ ProtectQA Audit Report</h1>
  
  <div class="summary">
    <h2 style="margin-top: 0;">Executive Summary</h2>
    <div class="summary-grid">
      <div class="stat">
        <div class="stat-value">${summary.totalIssues}</div>
        <div class="stat-label">Total Issues</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #991b1b;">${(summary.bySeverity.CRITICAL || 0) + (summary.bySeverity.HIGH || 0)}</div>
        <div class="stat-label">High/Critical</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #3730a3;">${summary.bySeverity.MEDIUM || 0}</div>
        <div class="stat-label">Medium</div>
      </div>
      <div class="stat">
        <div class="stat-value" style="color: #065f46;">${summary.bySeverity.LOW || 0}</div>
        <div class="stat-label">Low</div>
      </div>
    </div>
    <p style="margin-top: 15px; color: #6c6c80;">
      Primary risk categories: ${summary.topCategories.join(", ") || "None identified"}
    </p>
  </div>
  
  <h2>Problem Statements (Ranked by Risk)</h2>
  
  ${narratives.map(narrative => `
  <div class="issue">
    <div class="issue-header">
      <span class="severity ${narrative.severity}">${narrative.severity}</span>
      <span class="issue-title">${escapeHtml(narrative.title)}</span>
      <span style="margin-left: auto; font-size: 0.85em; color: #9ca3af;">
        ${narrative.category}${narrative.subcategory ? ` · ${narrative.subcategory}` : ""}
      </span>
    </div>
    
    <div class="scores">
      <div class="score-item">
        <div class="score-label">Risk Score</div>
        <div class="score-value">${narrative.scoring.riskScore}</div>
      </div>
      <div class="score-item">
        <div class="score-label">Impact Score</div>
        <div class="score-value">${narrative.scoring.impactScore}</div>
      </div>
      <div class="score-item">
        <div class="score-label">Fixability</div>
        <div class="score-value">${narrative.scoring.fixabilityScore}</div>
      </div>
      <div class="score-item">
        <div class="score-label">Composite</div>
        <div class="score-value">${narrative.scoring.compositeScore}</div>
      </div>
    </div>
    
    <p class="problem"><strong>What's Wrong:</strong> ${escapeHtml(narrative.whatIsWrong)}</p>
    
    <div class="section-title">Why This Is Wrong</div>
    <ul>
      ${narrative.whyWrong.map(w => `<li>${escapeHtml(w)}</li>`).join("\n")}
    </ul>
    
    <div class="section-title">Why It Matters</div>
    <ul>
      ${narrative.whyItMatters.map(w => `<li>${escapeHtml(w)}</li>`).join("\n")}
    </ul>
    
    ${narrative.contradictionPairs && narrative.contradictionPairs.length > 0 ? `
    <div class="section-title">Contradiction Pairs</div>
    ${narrative.contradictionPairs.map(pair => `
    <div class="contradiction-pair">
      <strong>Claim ${pair.claimAId} vs Claim ${pair.claimBId}</strong> (Score: ${pair.score.toFixed(2)})<br>
      ${escapeHtml(pair.explanation)}
    </div>
    `).join("\n")}
    ` : ""}
    
    <div class="section-title">Evidence Quotes</div>
    ${narrative.evidenceQuotes.map(e => `
    <div class="evidence">
      <div class="evidence-speaker">${e.speaker} (Turn ${e.turnIndex + 1}${e.evidenceRef ? ` · ${e.evidenceRef.ref}` : ""})</div>
      <div class="evidence-quote">"${escapeHtml(e.text)}"</div>
    </div>
    `).join("\n")}
    
    <div class="section-title">Recommended Actions</div>
    <ul>
      ${narrative.recommendedActions.map(a => `<li><strong>${a.type}:</strong> ${escapeHtml(a.action)}</li>`).join("\n")}
    </ul>
    
    <div style="margin-top: 15px; font-size: 0.85em; color: #9ca3af;">
      Confidence: ${narrative.confidence} · 
      Claims: ${narrative.scope.claimIds.length} · 
      Turns: ${narrative.scope.turnRange[0] + 1}-${narrative.scope.turnRange[1] + 1} · 
      Focus: ${narrative.scope.speakerFocus}
    </div>
    
    ${narrative.scoring.rationale.length > 0 ? `
    <div class="section-title">Score Rationale</div>
    <ul>
      ${narrative.scoring.rationale.map(r => `<li>${escapeHtml(r)}</li>`).join("\n")}
    </ul>
    ` : ""}
  </div>
  `).join("\n")}
  
  ${reproducibility ? `
  <div class="meta">
    <strong>Audit Information</strong><br>
    Input Hash: ${reproducibility.inputHash}<br>
    Config Hash: ${reproducibility.configHash}<br>
    Code Version: ${reproducibility.codeVersion}<br>
    Engine Version: ${reproducibility.engineVersion}<br>
    Model Fingerprint: ${JSON.stringify(reproducibility.modelFingerprint, null, 2)}<br>
    Generated: ${new Date().toISOString()}
  </div>
  ` : ""}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

