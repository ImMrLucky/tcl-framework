/**
 * Case Export Functions
 * Export cases as JSON, PDF, or ZIP
 */

import { supabaseAdmin } from '../supabase.js';
import { createHash } from 'crypto';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { Readable } from 'stream';

export interface CaseExportData {
  case: any;
  issues: any[];
  decisions: any[];
  signoffs: any[];
  snapshots: any[];
  evaluations: any[];
}

/**
 * Export case as JSON
 */
export async function exportCaseAsJSON(
  caseId: string,
  orgId: string,
  supabase: typeof supabaseAdmin
): Promise<{ data: string; checksum: string; filename: string }> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  // Get case with all related data
  const exportData = await gatherCaseData(caseId, orgId, supabase);

  const jsonData = JSON.stringify(exportData, null, 2);
  const checksum = createHash('sha256').update(jsonData).digest('hex');
  const filename = `case-${caseId}-${new Date().toISOString().split('T')[0]}.json`;

  return { data: jsonData, checksum, filename };
}

/**
 * Export case as PDF
 */
export async function exportCaseAsPDF(
  caseId: string,
  orgId: string,
  supabase: typeof supabaseAdmin
): Promise<{ stream: NodeJS.ReadableStream; checksum: string; filename: string }> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const exportData = await gatherCaseData(caseId, orgId, supabase);

  const doc = new PDFDocument({ margin: 50 });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk) => chunks.push(chunk));

  // Case header
  doc.fontSize(20).text(`Case: ${exportData.case.title}`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(`Case ID: ${exportData.case.id}`);
  doc.text(`Status: ${exportData.case.status}`);
  doc.text(`Created: ${new Date(exportData.case.created_at).toLocaleString()}`);
  if (exportData.case.description) {
    doc.moveDown();
    doc.text(`Description: ${exportData.case.description}`);
  }
  doc.moveDown(2);

  // Issues section
  doc.fontSize(16).text('Issues', { underline: true });
  doc.moveDown();
  doc.fontSize(12);

  if (exportData.issues.length === 0) {
    doc.text('No issues in this case.');
  } else {
    exportData.issues.forEach((issue, idx) => {
      doc.text(`${idx + 1}. ${issue.issue_id || 'Unknown Issue'}`);
      if (issue.evaluation_id) {
        doc.fontSize(10).text(`   Evaluation: ${issue.evaluation_id}`, { indent: 20 });
      }
      doc.moveDown(0.5);
    });
  }

  doc.end();

  // Wait for PDF to finish
  await new Promise<void>((resolve) => {
    doc.on('end', resolve);
  });

  const pdfBuffer = Buffer.concat(chunks);
  const checksum = createHash('sha256').update(pdfBuffer).digest('hex');
  const filename = `case-${caseId}-${new Date().toISOString().split('T')[0]}.pdf`;

  return {
    stream: Readable.from(pdfBuffer),
    checksum,
    filename,
  };
}

/**
 * Export case as ZIP (includes JSON + PDF + supporting files)
 */
export async function exportCaseAsZIP(
  caseId: string,
  orgId: string,
  supabase: typeof supabaseAdmin
): Promise<{ stream: NodeJS.ReadableStream; checksum: string; filename: string }> {
  if (!supabase) {
    throw new Error('Supabase not configured');
  }

  const exportData = await gatherCaseData(caseId, orgId, supabase);

  // Create archive
  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk) => chunks.push(chunk));

  // Add JSON export
  const jsonExport = await exportCaseAsJSON(caseId, orgId, supabase);
  archive.append(jsonExport.data, { name: jsonExport.filename });

  // Add PDF export
  const pdfExport = await exportCaseAsPDF(caseId, orgId, supabase);
  const pdfBuffer = await streamToBuffer(pdfExport.stream);
  archive.append(pdfBuffer, { name: pdfExport.filename });

  // Add summary JSON
  const summary = {
    caseId,
    exportedAt: new Date().toISOString(),
    issueCount: exportData.issues.length,
    decisionCount: exportData.decisions.length,
    signoffCount: exportData.signoffs.length,
    snapshotCount: exportData.snapshots.length,
    checksums: {
      json: jsonExport.checksum,
      pdf: pdfExport.checksum,
    },
  };
  archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

  await archive.finalize();

  // Wait for archive to finish
  await new Promise<void>((resolve) => {
    archive.on('end', resolve);
  });

  const zipBuffer = Buffer.concat(chunks);
  const checksum = createHash('sha256').update(zipBuffer).digest('hex');
  const filename = `case-${caseId}-${new Date().toISOString().split('T')[0]}.zip`;

  return {
    stream: Readable.from(zipBuffer),
    checksum,
    filename,
  };
}

/**
 * Gather all case data for export
 */
async function gatherCaseData(
  caseId: string,
  orgId: string,
  supabase: typeof supabaseAdmin
): Promise<CaseExportData> {
  // Get case
  const { data: case_, error: caseError } = await supabase!
    .from('cases')
    .select('*')
    .eq('id', caseId)
    .eq('org_id', orgId)
    .single();

  if (caseError || !case_) {
    throw new Error('Case not found');
  }

  // Get case issues
  const { data: caseIssues } = await supabase!
    .from('case_issues')
    .select('*')
    .eq('case_id', caseId);

  const issueIds = (caseIssues || []).map((ci: any) => ci.issue_id);

  // Get decisions for these issues
  let decisions: any[] = [];
  if (issueIds.length > 0) {
    const { data: decisionsData } = await supabase!
      .from('issue_decisions')
      .select('*')
      .eq('org_id', orgId)
      .in('issue_id', issueIds);
    decisions = decisionsData || [];
  }

  // Get signoffs for these decisions
  let signoffs: any[] = [];
  if (decisions.length > 0) {
    const decisionIds = decisions.map((d: any) => d.id);
    const { data: signoffsData } = await supabase!
      .from('issue_signoffs')
      .select('*')
      .in('decision_id', decisionIds);
    signoffs = signoffsData || [];
  }

  // Get snapshots for these issues
  let snapshots: any[] = [];
  if (issueIds.length > 0) {
    const { data: snapshotsData } = await supabase!
      .from('issue_snapshots')
      .select('*')
      .eq('org_id', orgId)
      .in('issue_id', issueIds);
    snapshots = snapshotsData || [];
  }

  // Get evaluations referenced by case issues
  const evaluationIds = [...new Set((caseIssues || []).map((ci: any) => ci.evaluation_id).filter(Boolean))];
  let evaluations: any[] = [];
  if (evaluationIds.length > 0) {
    const { data: evaluationsData } = await supabase!
      .from('evaluations')
      .select('id, conversation_id, created_at, report')
      .in('id', evaluationIds);
    evaluations = evaluationsData || [];
  }

  return {
    case: case_,
    issues: caseIssues || [],
    decisions,
    signoffs,
    snapshots,
    evaluations,
  };
}

/**
 * Helper: Convert stream to buffer
 */
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

