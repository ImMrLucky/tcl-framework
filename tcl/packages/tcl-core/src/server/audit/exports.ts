import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

/**
 * Export Claims CSV
 */
export async function exportClaimsCSV(
  evaluationId: string,
  orgId: string,
  projectId: string,
  env: string,
  supabaseAdmin: SupabaseClient
): Promise<{ artifactId: string; downloadUrl: string; checksum: string }> {
  // Fetch evaluation
  const { data: evaluation, error: evalError } = await supabaseAdmin
    .from('evaluations')
    .select('report')
    .eq('id', evaluationId)
    .eq('org_id', orgId)
    .single();
  
  if (evalError || !evaluation) {
    throw new Error('Evaluation not found');
  }
  
  const report = evaluation.report as any;
  const claims = report.inputs?.claims || [];
  
  // Build CSV
  const headers = ['Claim ID', 'Text', 'Speaker', 'Turn Index', 'Truth State', 'Importance', 'Issue Type'];
  const rows = claims.map((claim: { id: string; text: string; speaker?: string; turnStartIdx?: number; [key: string]: any }) => {
    const issue = report.issues?.find((i: any) => i.claimId === claim.id);
    return [
      claim.id,
      `"${claim.text.replace(/"/g, '""')}"`, // Escape quotes
      claim.speaker || '',
      claim.turnStartIdx ?? '',
      issue?.truthState || '',
      issue?.importance?.toFixed(3) || '',
      issue?.issueType || ''
    ];
  });
  
  const csv = [
    headers.join(','),
    ...rows.map((row: string[]) => row.join(','))
  ].join('\n');
  
  // Compute checksum
  const checksum = createHash('sha256').update(csv).digest('hex');
  
  // Store in Supabase Storage
  const filename = `claims-${evaluationId}-${Date.now()}.csv`;
  const bucket = 'exports';
  const path = `${orgId}/${projectId}/${env}/${filename}`;
  
  // Upload to storage (using storage API)
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, csv, {
      contentType: 'text/csv',
      upsert: false
    });
  
  if (uploadError) {
    // If bucket doesn't exist, create it or use a different approach
    console.warn('Storage upload failed, storing as artifact only:', uploadError);
  }
  
  // Get public URL if available
  const { data: urlData } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 3600); // 1 hour expiry
  
  const downloadUrl = urlData?.signedUrl || '';
  
  // Create artifact record
  const { data: artifact, error: artifactError } = await supabaseAdmin
    .from('conversation_artifacts')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env: env,
      conversation_id: report.run?.conversationId || null,
      evaluation_id: evaluationId,
      artifact_type: 'attachment',
      content_type: 'text/csv',
      filename: filename,
      storage_ref: {
        provider: 'supabase',
        bucket: bucket,
        path: path
      },
      content_json: {
        export: {
          type: 'claims_csv',
          scope: 'evaluation',
          evaluation_id: evaluationId,
          checksum: checksum
        }
      }
    })
    .select('id')
    .single();
  
  if (artifactError) {
    throw new Error(`Failed to create artifact: ${artifactError.message}`);
  }
  
  return {
    artifactId: artifact.id,
    downloadUrl,
    checksum
  };
}

/**
 * Export Run JSON Bundle
 */
export async function exportRunJSON(
  evaluationId: string,
  orgId: string,
  projectId: string,
  env: string,
  supabaseAdmin: SupabaseClient
): Promise<{ artifactId: string; downloadUrl: string; checksum: string }> {
  // Fetch evaluation
  const { data: evaluation, error: evalError } = await supabaseAdmin
    .from('evaluations')
    .select('*')
    .eq('id', evaluationId)
    .eq('org_id', orgId)
    .single();
  
  if (evalError || !evaluation) {
    throw new Error('Evaluation not found');
  }
  
  // Build JSON bundle
  const bundle = {
    evaluation: {
      id: evaluation.id,
      conversationId: evaluation.conversation_id,
      createdAt: evaluation.created_at,
      scores: evaluation.scores,
      engineVersion: evaluation.engine_version,
      latency: evaluation.latency_ms
    },
    report: evaluation.report
  };
  
  const json = JSON.stringify(bundle, null, 2);
  
  // Compute checksum
  const checksum = createHash('sha256').update(json).digest('hex');
  
  // Store in Supabase Storage
  const filename = `run-${evaluationId}-${Date.now()}.json`;
  const bucket = 'exports';
  const path = `${orgId}/${projectId}/${env}/${filename}`;
  
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, json, {
      contentType: 'application/json',
      upsert: false
    });
  
  if (uploadError) {
    console.warn('Storage upload failed, storing as artifact only:', uploadError);
  }
  
  // Get public URL if available
  const { data: urlData } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  
  const downloadUrl = urlData?.signedUrl || '';
  
  // Create artifact record
  const { data: artifact, error: artifactError } = await supabaseAdmin
    .from('conversation_artifacts')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env: env,
      conversation_id: evaluation.conversation_id,
      evaluation_id: evaluationId,
      artifact_type: 'attachment',
      content_type: 'application/json',
      filename: filename,
      storage_ref: {
        provider: 'supabase',
        bucket: bucket,
        path: path
      },
      content_json: {
        export: {
          type: 'run_json',
          scope: 'evaluation',
          evaluation_id: evaluationId,
          checksum: checksum
        }
      }
    })
    .select('id')
    .single();
  
  if (artifactError) {
    throw new Error(`Failed to create artifact: ${artifactError.message}`);
  }
  
  return {
    artifactId: artifact.id,
    downloadUrl,
    checksum
  };
}

/**
 * Export Single Issue PDF
 */
export async function exportIssuePDF(
  evaluationId: string,
  claimId: string,
  orgId: string,
  projectId: string,
  env: string,
  supabaseAdmin: SupabaseClient
): Promise<{ artifactId: string; downloadUrl: string; checksum: string }> {
  // Fetch evaluation
  const { data: evaluation, error: evalError } = await supabaseAdmin
    .from('evaluations')
    .select('report')
    .eq('id', evaluationId)
    .eq('org_id', orgId)
    .single();
  
  if (evalError || !evaluation) {
    throw new Error('Evaluation not found');
  }
  
  const report = evaluation.report as any;
  const issue = report.issues?.find((i: any) => i.claimId === claimId);
  const claim = report.inputs?.claims?.find((c: any) => c.id === claimId);
  
  if (!issue || !claim) {
    throw new Error('Issue or claim not found');
  }
  
  // Fetch conversation for transcript context
  const { data: conversation } = await supabaseAdmin
    .from('conversations')
    .select('raw_text, title')
    .eq('id', report.run?.conversationId)
    .single();
  
  // Build PDF content (simplified - in production, use a PDF library like pdfkit or puppeteer)
  // For MVP, we'll generate a text-based PDF-like document
  const pdfContent = buildPDFContent({
    orgId,
    projectId,
    env,
    evaluationId,
    createdAt: report.run?.createdAt,
    engineVersion: report.run?.engineVersion,
    codeVersion: report.run?.codeVersion,
    modelFingerprint: report.run?.modelFingerprint,
    inputHash: report.run?.inputHash,
    configHash: report.run?.configHash,
    claim,
    issue,
    transcript: conversation?.raw_text || ''
  });
  
  // Compute checksum
  const checksum = createHash('sha256').update(pdfContent).digest('hex');
  
  // Store in Supabase Storage
  const filename = `issue-${claimId}-${Date.now()}.pdf`;
  const bucket = 'exports';
  const path = `${orgId}/${projectId}/${env}/${filename}`;
  
  // For MVP, store as text (in production, generate actual PDF)
  const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, pdfContent, {
      contentType: 'application/pdf',
      upsert: false
    });
  
  if (uploadError) {
    console.warn('Storage upload failed, storing as artifact only:', uploadError);
  }
  
  // Get public URL if available
  const { data: urlData } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(path, 3600);
  
  const downloadUrl = urlData?.signedUrl || '';
  
  // Create artifact record
  const { data: artifact, error: artifactError } = await supabaseAdmin
    .from('conversation_artifacts')
    .insert({
      org_id: orgId,
      project_id: projectId,
      env: env,
      conversation_id: report.run?.conversationId || null,
      evaluation_id: evaluationId,
      artifact_type: 'attachment',
      content_type: 'application/pdf',
      filename: filename,
      storage_ref: {
        provider: 'supabase',
        bucket: bucket,
        path: path
      },
      content_json: {
        export: {
          type: 'issue_pdf',
          scope: 'claim',
          evaluation_id: evaluationId,
          claim_id: claimId,
          checksum: checksum
        }
      }
    })
    .select('id')
    .single();
  
  if (artifactError) {
    throw new Error(`Failed to create artifact: ${artifactError.message}`);
  }
  
  return {
    artifactId: artifact.id,
    downloadUrl,
    checksum
  };
}

/**
 * Build PDF content (text-based for MVP)
 */
function buildPDFContent(params: {
  orgId: string;
  projectId: string;
  env: string;
  evaluationId: string;
  createdAt?: string;
  engineVersion?: string;
  codeVersion?: string;
  modelFingerprint?: any;
  inputHash?: string;
  configHash?: string;
  claim: any;
  issue: any;
  transcript: string;
}): string {
  const {
    orgId,
    projectId,
    env,
    evaluationId,
    createdAt,
    engineVersion,
    codeVersion,
    modelFingerprint,
    inputHash,
    configHash,
    claim,
    issue,
    transcript
  } = params;
  
  // Build text-based PDF content (in production, use pdfkit or puppeteer)
  const lines = [
    'PROTECTQA - SINGLE ISSUE REPORT',
    '='.repeat(50),
    '',
    `Organization: ${orgId}`,
    `Project: ${projectId}`,
    `Environment: ${env}`,
    `Evaluation ID: ${evaluationId}`,
    `Created: ${createdAt || 'N/A'}`,
    '',
    'REPRODUCIBILITY MANIFEST',
    '-'.repeat(50),
    `Engine Version: ${engineVersion || 'N/A'}`,
    `Code Version: ${codeVersion || 'N/A'}`,
    `Model Fingerprint: ${JSON.stringify(modelFingerprint || {})}`,
    `Input Hash: ${inputHash || 'N/A'}`,
    `Config Hash: ${configHash || 'N/A'}`,
    '',
    'ISSUE DETAILS',
    '-'.repeat(50),
    `Claim ID: ${claim.id}`,
    `Claim Text: ${claim.text}`,
    `Speaker: ${claim.speaker || 'UNKNOWN'}`,
    `Turn Index: ${claim.turnStartIdx ?? 'N/A'}`,
    '',
    `Truth State: ${issue.truthState}`,
    `Node Blame (Normalized): ${issue.nodeBlameNorm?.toFixed(3) || 'N/A'}`,
    `Importance: ${issue.importance?.toFixed(3) || 'N/A'}`,
    `Issue Type: ${issue.issueType}`,
    '',
    'RELATED EVIDENCE',
    '-'.repeat(50),
    ...(issue.relatedEdges?.topBadContradictions?.slice(0, 3).map((e: any) => 
      `Contradiction: ${e.claimAId} <-> ${e.claimBId} (weight: ${e.weight?.toFixed(3)})`
    ) || []),
    ...(issue.relatedEdges?.topBadSupports?.slice(0, 3).map((e: any) => 
      `Support: ${e.claimAId} <-> ${e.claimBId} (weight: ${e.weight?.toFixed(3)})`
    ) || []),
    '',
    'PRIMARY EVIDENCE',
    '-'.repeat(50),
    ...(issue.primaryEvidence ? [
      `Turn Index: ${issue.primaryEvidence.turnIdx}`,
      `Speaker: ${issue.primaryEvidence.speaker}`,
      `Excerpt: ${issue.primaryEvidence.excerpt}`
    ] : ['No primary evidence available']),
    '',
    'TRANSCRIPT CONTEXT',
    '-'.repeat(50),
    transcript.substring(0, 2000) + (transcript.length > 2000 ? '...' : ''),
    '',
    '='.repeat(50),
    'Generated by ProtectQA',
    'Reproducible manifest included above.',
    `Generated: ${new Date().toISOString()}`
  ];
  
  return lines.join('\n');
}

