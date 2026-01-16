/**
 * Audit Pack Generator
 * Creates defensible export bundles (PDF + JSON + CSV) for compliance
 */

import PDFDocument from 'pdfkit';
import { createHash } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Readable } from 'stream';
import archiver from 'archiver';

export type AuditPackPreset = 'AUDIT' | 'LEGAL_HOLD' | 'CUSTOMER_DISPUTE' | 'CUSTOM';

export interface AuditPackOptions {
  evaluationId?: string;
  dateFrom?: string;
  dateTo?: string;
  projectId?: string;
  env?: string;
  includeAllIssues?: boolean;
  preset?: AuditPackPreset; // Preset type (default: CUSTOM)
}

export interface AuditPackResult {
  packId: string;
  pdfUrl: string;
  jsonUrl: string;
  csvUrl: string;
  zipUrl?: string;
  summary?: any;
  checksums: {
    pdf: string;
    json: string;
    csv: string;
    combined: string;
    zip?: string;
  };
}

/**
 * Generate audit pack (PDF + JSON + CSV bundle)
 */
export async function generateAuditPack(
  options: AuditPackOptions,
  orgId: string,
  supabaseAdmin: SupabaseClient
): Promise<AuditPackResult> {
  // Fetch evaluations based on options
  let query = supabaseAdmin
    .from('evaluations')
    .select('*')
    .eq('org_id', orgId);

  if (options.evaluationId) {
    query = query.eq('id', options.evaluationId);
  } else {
    if (options.dateFrom) {
      query = query.gte('created_at', options.dateFrom);
    }
    if (options.dateTo) {
      query = query.lte('created_at', options.dateTo);
    }
  }

  if (options.projectId) {
    query = query.eq('project_id', options.projectId);
  }
  if (options.env) {
    query = query.eq('env', options.env);
  }

  const { data: evaluations, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch evaluations: ${error.message}`);
  }

  if (!evaluations || evaluations.length === 0) {
    throw new Error('No evaluations found for the specified criteria');
  }

  // Extract all issues from evaluations
  const allIssues: any[] = [];
  let executiveSummary = {
    totalEvaluations: evaluations.length,
    totalIssues: 0,
    highCriticalCount: 0,
    verifiedCount: 0,
    transcriptOnlyCount: 0,
    unverifiedCount: 0,
    avgRiskScore: 0,
    dateRange: {
      from: evaluations[evaluations.length - 1]?.created_at,
      to: evaluations[0]?.created_at,
    },
  };

  for (const eval_ of evaluations) {
    const report = eval_.report as any;
    const issues = options.includeAllIssues
      ? (report?.allIssuesV2 || report?.topIssuesV2 || report?.issues || [])
      : (report?.topIssuesV2 || report?.issues || []);

    for (const issue of issues) {
      allIssues.push({
        ...issue,
        evaluationId: eval_.id,
        evaluationCreatedAt: eval_.created_at,
      });

      executiveSummary.totalIssues++;
      const severityDisplay = issue.severityDisplay || issue.severity;
      if (severityDisplay === 'high' || severityDisplay === 'critical') {
        executiveSummary.highCriticalCount++;
      }

      const verificationLevel = issue.verification?.level;
      if (verificationLevel === 'EXTERNAL_VERIFIED') {
        executiveSummary.verifiedCount++;
      } else if (verificationLevel === 'TRANSCRIPT_ONLY') {
        executiveSummary.transcriptOnlyCount++;
      } else {
        executiveSummary.unverifiedCount++;
      }
    }
  }

  // Fetch decisions, signoffs, and locks for all issues
  const issueIds = allIssues.map(i => i.issueId || i.issue_id).filter(Boolean);
  const decisionsMap = new Map<string, any>();
  const signoffsMap = new Map<string, any[]>();
  const locksMap = new Map<string, any>();
  const snapshotsMap = new Map<string, any[]>();

  if (issueIds.length > 0) {
    // Fetch decisions
    const { data: decisions } = await supabaseAdmin
      .from('issue_decisions')
      .select('*')
      .eq('org_id', orgId)
      .in('issue_id', issueIds);

    if (decisions) {
      for (const decision of decisions) {
        decisionsMap.set(decision.issue_id, decision);
      }
    }

    // Fetch signoffs for decisions
    if (decisions && decisions.length > 0) {
      const decisionIds = decisions.map(d => d.id);
      const { data: signoffs } = await supabaseAdmin
        .from('issue_signoffs')
        .select('*')
        .in('decision_id', decisionIds);

      if (signoffs) {
        for (const signoff of signoffs) {
          const decision = decisions.find(d => d.id === signoff.decision_id);
          if (decision) {
            if (!signoffsMap.has(decision.issue_id)) {
              signoffsMap.set(decision.issue_id, []);
            }
            signoffsMap.get(decision.issue_id)!.push(signoff);
          }
        }
      }
    }

    // Fetch locks
    const { data: locks } = await supabaseAdmin
      .from('issue_locks')
      .select('*')
      .eq('org_id', orgId)
      .in('issue_id', issueIds)
      .eq('status', 'LOCKED');

    if (locks) {
      for (const lock of locks) {
        locksMap.set(lock.issue_id, lock);
      }
    }

    // Fetch snapshots for locked issues
    if (locks && locks.length > 0) {
      const snapshotIds = locks.map(l => l.snapshot_id).filter(Boolean);
      if (snapshotIds.length > 0) {
        const { data: snapshots } = await supabaseAdmin
          .from('issue_snapshots')
          .select('*')
          .in('id', snapshotIds);

        if (snapshots) {
          for (const snapshot of snapshots) {
            const lock = locks.find(l => l.snapshot_id === snapshot.id);
            if (lock) {
              if (!snapshotsMap.has(lock.issue_id)) {
                snapshotsMap.set(lock.issue_id, []);
              }
              snapshotsMap.get(lock.issue_id)!.push(snapshot);
            }
          }
        }
      }
    }
  }

  // Enrich issues with decisions, signoffs, and locks
  const enrichedIssues = allIssues.map(issue => {
    const issueId = issue.issueId || issue.issue_id;
    const decision = decisionsMap.get(issueId);
    const signoffs = signoffsMap.get(issueId) || [];
    const lock = locksMap.get(issueId);
    const snapshots = snapshotsMap.get(issueId) || [];

    return {
      ...issue,
      decision: decision ? {
        id: decision.id,
        disposition: decision.disposition,
        severityOverride: decision.severity_override,
        assignedToUserId: decision.assigned_to_user_id,
        notes: decision.notes,
        expiresAt: decision.expires_at,
        createdAt: decision.created_at,
        updatedAt: decision.updated_at,
      } : null,
      signoffs: signoffs.map(s => ({
        id: s.id,
        role: s.role,
        signedByUserId: s.signed_by_user_id,
        signedAt: s.signed_at,
        note: s.note,
      })),
      lock: lock ? {
        id: lock.id,
        status: lock.status,
        lockedByUserId: lock.locked_by_user_id,
        lockedAt: lock.locked_at,
        reason: lock.reason,
        snapshotId: lock.snapshot_id,
      } : null,
      snapshots: snapshots.map(s => ({
        id: s.id,
        snapshotJson: s.snapshot_json,
        evidenceSetHash: s.evidence_set_hash,
        inputHash: s.input_hash,
        engineVersion: s.engine_version,
        createdAt: s.created_at,
      })),
    };
  });

  // Sort issues by riskScore (descending)
  enrichedIssues.sort((a, b) => {
    const scoreA = a.score ?? (a.riskScore ?? 0) * 100;
    const scoreB = b.score ?? (b.riskScore ?? 0) * 100;
    return scoreB - scoreA;
  });

  // Calculate average risk score
  const totalScore = enrichedIssues.reduce((sum, issue) => {
    return sum + (issue.score ?? (issue.riskScore ?? 0) * 100);
  }, 0);
  executiveSummary.avgRiskScore = enrichedIssues.length > 0 ? totalScore / enrichedIssues.length : 0;

  // Add decision counts to executive summary
  const decisionCounts = {
    open: 0,
    acknowledged: 0,
    remediated: 0,
    acceptedRisk: 0,
    falsePositive: 0,
    requiresFollowup: 0,
    escalated: 0,
  };
  const lockedCount = enrichedIssues.filter(i => i.lock).length;
  const signoffCount = enrichedIssues.reduce((sum, i) => sum + (i.signoffs?.length || 0), 0);

  for (const issue of enrichedIssues) {
    if (issue.decision) {
      const disp = issue.decision.disposition.toLowerCase();
      if (disp === 'open') decisionCounts.open++;
      else if (disp === 'acknowledged') decisionCounts.acknowledged++;
      else if (disp === 'remediated') decisionCounts.remediated++;
      else if (disp === 'accepted_risk') decisionCounts.acceptedRisk++;
      else if (disp === 'false_positive') decisionCounts.falsePositive++;
      else if (disp === 'requires_followup') decisionCounts.requiresFollowup++;
      else if (disp === 'escalated') decisionCounts.escalated++;
    }
  }

  executiveSummary.decisions = decisionCounts;
  executiveSummary.lockedCount = lockedCount;
  executiveSummary.signoffCount = signoffCount;

  // Get first evaluation for integrity info
  const firstEval = evaluations[0];
  const firstReport = firstEval.report as any;
  const runInfo = firstReport?.run || firstReport?.manifest || {};

  // Generate files
  const preset = options.preset || 'CUSTOM';
  const pdfBuffer = await generatePDF(executiveSummary, enrichedIssues, runInfo, evaluations, preset);
  const jsonContent = generateJSON(enrichedIssues, runInfo, evaluations, preset);
  const csvContent = generateCSV(enrichedIssues);

  // Compute checksums
  const pdfChecksum = createHash('sha256').update(pdfBuffer).digest('hex');
  const jsonChecksum = createHash('sha256').update(jsonContent).digest('hex');
  const csvChecksum = createHash('sha256').update(csvContent).digest('hex');
  const combinedChecksum = createHash('sha256')
    .update(pdfChecksum + jsonChecksum + csvChecksum)
    .digest('hex');

  // Generate pack ID
  const packId = `pack-${Date.now()}-${combinedChecksum.substring(0, 8)}`;

  // Upload to Supabase Storage
  const bucket = 'exports';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = `${orgId}/audit-packs/${packId}`;

  // Upload PDF
  const pdfFilename = `audit-pack-${timestamp}.pdf`;
  const pdfPath = `${basePath}/${pdfFilename}`;
  const { error: pdfError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (pdfError) {
    throw new Error(`Failed to upload PDF: ${pdfError.message}`);
  }

  // Upload JSON
  const jsonFilename = `audit-pack-${timestamp}.json`;
  const jsonPath = `${basePath}/${jsonFilename}`;
  const { error: jsonError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(jsonPath, jsonContent, {
      contentType: 'application/json',
      upsert: false,
    });

  if (jsonError) {
    throw new Error(`Failed to upload JSON: ${jsonError.message}`);
  }

  // Upload CSV
  const csvFilename = `audit-pack-${timestamp}.csv`;
  const csvPath = `${basePath}/${csvFilename}`;
  const { error: csvError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(csvPath, csvContent, {
      contentType: 'text/csv',
      upsert: false,
    });

  if (csvError) {
    throw new Error(`Failed to upload CSV: ${csvError.message}`);
  }

  // Get public URLs
  const { data: pdfUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(pdfPath);
  const { data: jsonUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(jsonPath);
  const { data: csvUrlData } = supabaseAdmin.storage.from(bucket).getPublicUrl(csvPath);

  // Create ZIP bundle
  const zipBuffer = await createZipBundle(pdfBuffer, jsonContent, csvContent, preset);
  const zipChecksum = createHash('sha256').update(zipBuffer).digest('hex');
  
  const zipFilename = `audit-pack-${timestamp}.zip`;
  const zipPath = `${basePath}/${zipFilename}`;
  const { error: zipError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(zipPath, zipBuffer, {
      contentType: 'application/zip',
      upsert: false,
    });

  if (zipError) {
    console.warn('Failed to upload ZIP, continuing with individual files:', zipError);
  }

  const { data: zipUrlData } = zipError ? { data: null } : supabaseAdmin.storage.from(bucket).getPublicUrl(zipPath);

  return {
    packId,
    pdfUrl: pdfUrlData.publicUrl,
    jsonUrl: jsonUrlData.publicUrl,
    csvUrl: csvUrlData.publicUrl,
    zipUrl: zipUrlData?.publicUrl,
    checksums: {
      pdf: pdfChecksum,
      json: jsonChecksum,
      csv: csvChecksum,
      combined: combinedChecksum,
      zip: zipChecksum,
    },
  };
}

/**
 * Create ZIP bundle from PDF, JSON, and CSV
 */
async function createZipBundle(
  pdfBuffer: Buffer,
  jsonContent: string,
  csvContent: string,
  preset: AuditPackPreset
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    // Add files to archive
    archive.append(pdfBuffer, { name: 'summary.pdf' });
    archive.append(jsonContent, { name: 'issues.json' });
    archive.append(csvContent, { name: 'issues.csv' });

    // Add summary JSON
    const summary = {
      preset,
      generatedAt: new Date().toISOString(),
      fileCount: 3,
      description: {
        AUDIT: 'Standard audit pack with all issues and decisions',
        LEGAL_HOLD: 'Legal hold pack with locked issues and snapshots',
        CUSTOMER_DISPUTE: 'Customer dispute pack with relevant evidence',
        CUSTOM: 'Custom audit pack',
      }[preset] || 'Audit pack',
    };
    archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

    archive.finalize();
  });
}

/**
 * Generate PDF document
 */
async function generatePDF(
  summary: any,
  issues: any[],
  runInfo: any,
  evaluations: any[],
  preset: AuditPackPreset = 'CUSTOM'
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const buffers: Buffer[] = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Title
    const presetTitle = {
      AUDIT: 'Audit Pack',
      LEGAL_HOLD: 'Legal Hold Pack',
      CUSTOMER_DISPUTE: 'Customer Dispute Pack',
      CUSTOM: 'Custom Audit Pack',
    }[preset] || 'Audit Pack';
    
    doc.fontSize(20).text(`ProtectQA ${presetTitle}`, { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
    doc.fontSize(10).text(`Preset: ${preset}`, { align: 'center' });
    doc.moveDown(2);

    // Executive Summary
    doc.fontSize(16).text('Executive Summary', { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Total Evaluations: ${summary.totalEvaluations}`);
    doc.text(`Total Issues: ${summary.totalIssues}`);
    doc.text(`High/Critical Issues: ${summary.highCriticalCount}`);
    const totalIssues = summary.totalIssues || 1;
    doc.text(`Verified Issues: ${summary.verifiedCount} (${((summary.verifiedCount / totalIssues) * 100).toFixed(1)}%)`);
    doc.text(`Transcript-Only Issues: ${summary.transcriptOnlyCount} (${((summary.transcriptOnlyCount / totalIssues) * 100).toFixed(1)}%)`);
    doc.text(`Unverified Issues: ${summary.unverifiedCount} (${((summary.unverifiedCount / totalIssues) * 100).toFixed(1)}%)`);
    doc.text(`Average Risk Score: ${summary.avgRiskScore.toFixed(1)}`);
    doc.text(`Date Range: ${summary.dateRange.from} to ${summary.dateRange.to}`);
    
    // Decision summary
    if (summary.decisions) {
      doc.moveDown();
      doc.fontSize(14).text('Decision Summary', { underline: true });
      doc.fontSize(11);
      doc.text(`Open: ${summary.decisions.open}`);
      doc.text(`Acknowledged: ${summary.decisions.acknowledged}`);
      doc.text(`Remediated: ${summary.decisions.remediated}`);
      doc.text(`Accepted Risk: ${summary.decisions.acceptedRisk}`);
      doc.text(`False Positive: ${summary.decisions.falsePositive}`);
      doc.text(`Requires Follow-up: ${summary.decisions.requiresFollowup}`);
      doc.text(`Escalated: ${summary.decisions.escalated}`);
    }
    
    if (summary.lockedCount > 0) {
      doc.text(`Locked Issues: ${summary.lockedCount}`);
    }
    if (summary.signoffCount > 0) {
      doc.text(`Total Signoffs: ${summary.signoffCount}`);
    }
    
    doc.moveDown(2);

    // Verification Coverage
    doc.fontSize(16).text('Verification Coverage', { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`External Verified: ${summary.verifiedCount} issues`);
    doc.text(`Transcript-Only: ${summary.transcriptOnlyCount} issues (not externally verified)`);
    doc.text(`Unverified: ${summary.unverifiedCount} issues (no evidence)`);
    doc.moveDown(2);

    // Top Issues
    doc.fontSize(16).text('Top Issues (Ranked by Risk Score)', { underline: true });
    doc.moveDown();

    const topIssues = issues.slice(0, 50); // Limit to top 50 for PDF
    for (let i = 0; i < topIssues.length; i++) {
      const issue = topIssues[i];
      const score = issue.score ?? (issue.riskScore ?? 0) * 100;

      // Issue header
      doc.fontSize(12).font('Helvetica-Bold');
      doc.text(`Issue #${i + 1}: ${issue.type} - ${issue.category}`, { continued: false });
      doc.fontSize(10).font('Helvetica');
      doc.text(`Risk Score: ${score.toFixed(1)} | Severity: ${issue.severityDisplay || issue.severity} | Verification: ${issue.verification?.level || 'NONE'}`);
      doc.moveDown(0.5);

      // What/Why/Where
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Summary:', { continued: false });
      doc.fontSize(10).font('Helvetica');
      doc.text(issue.what?.issueSummary || 'N/A', { indent: 20 });
      doc.moveDown(0.5);

      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Detail:', { continued: false });
      doc.fontSize(10).font('Helvetica');
      doc.text(issue.what?.issueDetail || 'N/A', { indent: 20 });
      doc.moveDown(0.5);

      // Score breakdown
      if (issue.scoring) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Score Breakdown:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        if (issue.scoring.components) {
          doc.text(`Impact: ${((issue.scoring.components.impact01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.impact || 0) * 100).toFixed(0)}%)`, { indent: 20 });
          doc.text(`Evidence: ${((issue.scoring.components.evidence01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.evidence || 0) * 100).toFixed(0)}%)`, { indent: 20 });
          doc.text(`Signal: ${((issue.scoring.components.signal01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.signal || 0) * 100).toFixed(0)}%)`, { indent: 20 });
          doc.text(`Category: ${((issue.scoring.components.category01 || 0) * 100).toFixed(1)}% (weight: ${((issue.scoring.weights?.category || 0) * 100).toFixed(0)}%)`, { indent: 20 });
        }
        if (issue.scoring.reasons && issue.scoring.reasons.length > 0) {
          doc.text('Reasons:', { indent: 20 });
          issue.scoring.reasons.forEach((reason: string) => {
            doc.text(`  • ${reason}`, { indent: 30 });
          });
        }
        doc.moveDown(0.5);
      }

      // Evidence quotes
      if (issue.evidence?.refs && issue.evidence.refs.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Evidence Quotes:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        issue.evidence.refs.slice(0, 3).forEach((ref: any) => {
          doc.text(`[${ref.sourceType}] ${ref.sourceId}`, { indent: 20 });
          doc.text(`"${ref.quote.substring(0, 200)}${ref.quote.length > 200 ? '...' : ''}"`, { indent: 30 });
          if (ref.turnIndex !== undefined) {
            doc.text(`Turn: ${ref.turnIndex + 1}`, { indent: 30 });
          }
        });
        doc.moveDown(0.5);
      }

      // Edges
      if (issue.evidence?.edges && issue.evidence.edges.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Graph Edges:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        issue.evidence.edges.slice(0, 3).forEach((edge: any) => {
          doc.text(`${edge.kind}: ${edge.claimA} ${edge.claimB ? '↔ ' + edge.claimB : ''} (weight: ${(edge.weight * 100).toFixed(1)}%)`, { indent: 20 });
        });
        doc.moveDown(0.5);
      }

      // Policy refs (if any)
      if (issue.compliance?.impactedPolicies && issue.compliance.impactedPolicies.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Impacted Policies:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        issue.compliance.impactedPolicies.forEach((policy: any) => {
          doc.text(`${policy.policyId}${policy.section ? ' - Section ' + policy.section : ''}`, { indent: 20 });
        });
        doc.moveDown(0.5);
      }

      // Verification level
      doc.fontSize(11).font('Helvetica-Bold');
      doc.text('Verification Level:', { continued: false });
      doc.fontSize(10).font('Helvetica');
      doc.text(`${issue.verification?.level || 'NONE'}`, { indent: 20 });
      if (issue.verification?.reasonCodes && issue.verification.reasonCodes.length > 0) {
        doc.text(`Reason Codes: ${issue.verification.reasonCodes.join(', ')}`, { indent: 20 });
      }
      doc.moveDown(0.5);

      // Decision (if exists)
      if (issue.decision) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Decision:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        doc.text(`Disposition: ${issue.decision.disposition}`, { indent: 20 });
        if (issue.decision.severityOverride) {
          doc.text(`Severity Override: ${issue.decision.severityOverride}`, { indent: 20 });
        }
        if (issue.decision.notes) {
          doc.text(`Notes: ${issue.decision.notes}`, { indent: 20 });
        }
        if (issue.decision.expiresAt) {
          doc.text(`Expires: ${issue.decision.expiresAt}`, { indent: 20 });
        }
        doc.moveDown(0.5);
      }

      // Signoffs (if exists)
      if (issue.signoffs && issue.signoffs.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Signoffs:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        issue.signoffs.forEach((signoff: any) => {
          doc.text(`${signoff.role}: Signed at ${signoff.signedAt}`, { indent: 20 });
          if (signoff.note) {
            doc.text(`  Note: ${signoff.note}`, { indent: 30 });
          }
        });
        doc.moveDown(0.5);
      }

      // Lock status (if locked)
      if (issue.lock) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Lock Status:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        doc.text(`LOCKED - Locked at ${issue.lock.lockedAt}`, { indent: 20 });
        if (issue.lock.reason) {
          doc.text(`Reason: ${issue.lock.reason}`, { indent: 20 });
        }
        if (issue.lock.snapshotId) {
          doc.text(`Snapshot ID: ${issue.lock.snapshotId}`, { indent: 20 });
        }
        doc.moveDown(0.5);
      }

      // Snapshot reference (if exists)
      if (issue.snapshots && issue.snapshots.length > 0) {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text('Snapshots:', { continued: false });
        doc.fontSize(10).font('Helvetica');
        issue.snapshots.forEach((snapshot: any) => {
          doc.text(`Snapshot ID: ${snapshot.id} (Created: ${snapshot.createdAt})`, { indent: 20 });
          if (snapshot.evidenceSetHash) {
            doc.text(`Evidence Set Hash: ${snapshot.evidenceSetHash}`, { indent: 30 });
          }
          if (snapshot.inputHash) {
            doc.text(`Input Hash: ${snapshot.inputHash}`, { indent: 30 });
          }
          if (snapshot.engineVersion) {
            doc.text(`Engine Version: ${snapshot.engineVersion}`, { indent: 30 });
          }
        });
        doc.moveDown(0.5);
      }

      doc.moveDown(1);

      // Page break if needed
      if (i < topIssues.length - 1 && doc.y > 700) {
        doc.addPage();
      }
    }

    // Run Integrity
    doc.addPage();
    doc.fontSize(16).text('Run Integrity & Reproducibility', { underline: true });
    doc.moveDown();
    doc.fontSize(11);
    doc.text(`Input Hash: ${runInfo.inputHash || 'N/A'}`);
    doc.text(`Config Hash: ${runInfo.configHash || 'N/A'}`);
    doc.text(`Engine Version: ${runInfo.engineVersion || 'N/A'}`);
    doc.text(`Model Fingerprint: ${JSON.stringify(runInfo.modelFingerprint || {})}`);
    doc.text(`Code Version: ${runInfo.codeVersion || 'N/A'}`);
    doc.text(`Evidence Mode: ${runInfo.evidenceMode || 'N/A'}`);
    doc.moveDown();
    doc.text(`Total Evaluations in Pack: ${evaluations.length}`);
    doc.text(`Evaluation IDs: ${evaluations.map((e: any) => e.id).join(', ')}`);

    doc.end();
  });
}

/**
 * Generate JSON export
 */
function generateJSON(issues: any[], runInfo: any, evaluations: any[], preset: AuditPackPreset = 'CUSTOM'): string {
  const exportData = {
    exportedAt: new Date().toISOString(),
    preset,
    packInfo: {
      totalIssues: issues.length,
      totalEvaluations: evaluations.length,
      evaluationIds: evaluations.map((e: any) => e.id),
    },
    reproducibility: {
      inputHash: runInfo.inputHash,
      configHash: runInfo.configHash,
      engineVersion: runInfo.engineVersion,
      modelFingerprint: runInfo.modelFingerprint,
      codeVersion: runInfo.codeVersion,
      evidenceMode: runInfo.evidenceMode,
    },
    issues: issues.map(issue => ({
      ...issue,
      // Ensure scoring.components and reasons are included
      scoring: issue.scoring || undefined,
      // Include decision, signoffs, lock, and snapshots
      decision: issue.decision || undefined,
      signoffs: issue.signoffs || undefined,
      lock: issue.lock || undefined,
      snapshots: issue.snapshots || undefined,
    })),
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Generate CSV export
 */
function generateCSV(issues: any[]): string {
  const headers = [
    'Rank',
    'Issue ID',
    'Issue Key',
    'Evaluation ID',
    'Type',
    'Category',
    'Severity',
    'Severity Display',
    'Impact',
    'Risk Score',
    'Score',
    'Confidence',
    'Verification Level',
    'Verification Reason Codes',
    'Speaker',
    'Turn Index',
    'Primary Claim ID',
    'Related Claim IDs',
    'Issue Summary',
    'Issue Detail',
    'Evidence Count',
    'Edge Count',
    'Compliance Tags',
    'Impacted Policies',
    'Legal Hold Suggested',
    'Disclaimers',
    'Score Impact',
    'Score Evidence',
    'Score Signal',
    'Score Category',
    'Score Reasons',
    'Created At',
  ];

  const rows = issues.map((issue, idx) => {
    const score = issue.score ?? (issue.riskScore ?? 0) * 100;
    return [
      idx + 1,
      issue.issueId || '',
      issue.issueKey || '',
      issue.evaluationId || '',
      issue.type || '',
      issue.category || '',
      issue.severity || '',
      issue.severityDisplay || '',
      issue.impact || '',
      (issue.riskScore ?? 0) * 100,
      score,
      (issue.confidence ?? 0) * 100,
      issue.verification?.level || '',
      (issue.verification?.reasonCodes || []).join('; '),
      issue.who?.speaker || '',
      issue.who?.turnIndex || '',
      issue.what?.primaryClaimId || '',
      (issue.what?.relatedClaimIds || []).join('; '),
      (issue.what?.issueSummary || '').replace(/"/g, '""'),
      (issue.what?.issueDetail || '').replace(/"/g, '""'),
      (issue.evidence?.refs || []).length,
      (issue.evidence?.edges || []).length,
      (issue.compliance?.tags || []).join('; '),
      (issue.compliance?.impactedPolicies || []).map((p: any) => `${p.policyId}${p.section ? ':' + p.section : ''}`).join('; '),
      issue.compliance?.legalHoldSuggested ? 'Yes' : 'No',
      (issue.compliance?.disclaimers || []).join('; ').replace(/"/g, '""'),
      issue.scoring?.components?.impact01 ? (issue.scoring.components.impact01 * 100).toFixed(1) : '',
      issue.scoring?.components?.evidence01 ? (issue.scoring.components.evidence01 * 100).toFixed(1) : '',
      issue.scoring?.components?.signal01 ? (issue.scoring.components.signal01 * 100).toFixed(1) : '',
      issue.scoring?.components?.category01 ? (issue.scoring.components.category01 * 100).toFixed(1) : '',
      (issue.scoring?.reasons || []).join('; '),
      issue.evaluationCreatedAt || issue.audit?.createdAt || '',
    ];
  });

  const csv = [
    headers.map((h: string) => `"${h}"`).join(','),
    ...rows.map((row: any[]) => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  return csv;
}

