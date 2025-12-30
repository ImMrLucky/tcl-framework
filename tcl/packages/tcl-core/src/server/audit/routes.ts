import express from "express";
import { supabaseAdmin, logAudit, trackUsage, verifyApiKeyExtended } from "../supabase.js";
import { extractClaims } from "../../claim_extractor.js";
import { buildClaimGraph } from "../../graph/edge_builder.js";
import { runEvaluation } from "./evaluation-run.js";
import { processArtifacts } from "../integrations/artifacts/processor.js";
import type { ConversationArtifact } from "../integrations/types.js";
import { exportClaimsCSV, exportRunJSON, exportIssuePDF } from "./exports.js";

/**
 * Get organization context from request (API key or JWT)
 */
async function getOrgContext(req: express.Request): Promise<{ orgId: string; projectId: string; env: string; userId?: string } | null> {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const key = authHeader.substring(7);
    const verified = await verifyApiKeyExtended(key);
    if (verified) {
      return {
        orgId: verified.orgId,
        projectId: verified.projectId,
        env: verified.env
      };
    }
  }
  // TODO: Check for user session JWT from Supabase auth
  return null;
}

/**
 * Setup audit-grade analysis routes
 */
export function setupAuditRoutes(app: express.Application) {
  // ============================================================================
  // INGESTION: POST /api/conversations/ingest
  // ============================================================================
  
  app.post("/api/conversations/ingest", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { transcript, title, channel = "call", externalId, metadata = {} } = req.body;
      
      if (!transcript || typeof transcript !== 'string') {
        return res.status(400).json({ error: "transcript is required and must be a string" });
      }
      
      // Create conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .insert({
          org_id: context.orgId,
          project_id: context.projectId || null,
          env: context.env,
          external_id: externalId || null,
          title: title || null,
          raw_text: transcript,
          content: transcript, // Legacy field
          channel: channel,
          metadata: metadata
        })
        .select('id, org_id, project_id, env, title, created_at')
        .single();
      
      if (convError) {
        return res.status(500).json({ error: `Failed to create conversation: ${convError.message}` });
      }
      
      // Extract turns for normalized storage
      const turns = extractTurns(transcript);
      
      // Store transcript as artifact
      const artifacts: ConversationArtifact[] = [{
        type: 'transcript_text',
        text: transcript,
        content_type: 'text/plain'
      }];
      
      await processArtifacts(
        context.orgId,
        context.projectId || '',
        context.env as 'sandbox' | 'production',
        conversation.id,
        artifacts
      );
      
      // Also store normalized turns if available
      if (turns.length > 0) {
        const { error: turnsError } = await supabaseAdmin
          .from('conversation_artifacts')
          .insert({
            org_id: context.orgId,
            project_id: context.projectId || null,
            env: context.env,
            conversation_id: conversation.id,
            artifact_type: 'attachment', // Using attachment for normalized transcript
            content_type: 'application/json',
            filename: 'normalized_transcript.json',
            content_json: { turns }
          });
        
        if (turnsError) {
          console.warn('Failed to store normalized turns:', turnsError);
        }
      }
      
      // Track usage
      await trackUsage(context.orgId, context.projectId, context.env, 'conversation');
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'conversation.create',
        targetType: 'conversation',
        targetId: conversation.id,
        meta: { projectId: context.projectId, env: context.env, channel }
      });
      
      res.json({ 
        conversationId: conversation.id,
        conversation 
      });
    } catch (e: any) {
      console.error("Ingest error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // EVALUATION RUN: POST /api/evaluations/run
  // ============================================================================
  
  app.post("/api/evaluations/run", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { conversationId, claims, supports, contradictions, grounded, config, sources } = req.body;
      
      if (!conversationId) {
        return res.status(400).json({ error: "conversationId is required" });
      }
      
      if (!claims || !Array.isArray(claims) || claims.length === 0) {
        return res.status(400).json({ error: "claims array is required and must not be empty" });
      }
      
      // Run evaluation with manifest
      const result = await runEvaluation(
        {
          conversationId,
          claims,
          supports: supports || [],
          contradictions: contradictions || [],
          grounded: grounded || [],
          config,
          sources
        },
        context,
        supabaseAdmin
      );
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'RUN_CREATED',
        targetType: 'evaluation',
        targetId: result.evaluationId,
        meta: {
          conversationId,
          inputHash: result.inputHash,
          configHash: result.configHash,
          latency: result.latency
        }
      });
      
      res.json(result);
    } catch (e: any) {
      console.error("Evaluation run error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // GET EVALUATION: GET /api/evaluations/:id
  // ============================================================================
  
  app.get("/api/evaluations/:id", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { id } = req.params;
      
      const { data: evaluation, error } = await supabaseAdmin
        .from('evaluations')
        .select('*')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();
      
      if (error) {
        return res.status(404).json({ error: "Evaluation not found" });
      }
      
      res.json({ evaluation });
    } catch (e: any) {
      console.error("Get evaluation error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // GET ISSUES: GET /api/evaluations/:id/issues
  // ============================================================================
  
  app.get("/api/evaluations/:id/issues", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { id } = req.params;
      
      const { data: evaluation, error } = await supabaseAdmin
        .from('evaluations')
        .select('report')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();
      
      if (error) {
        return res.status(404).json({ error: "Evaluation not found" });
      }
      
      const issues = (evaluation.report as any)?.issues || [];
      
      res.json({ issues });
    } catch (e: any) {
      console.error("Get issues error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // GET CONVERSATION TRANSCRIPT: GET /api/conversations/:id/transcript
  // ============================================================================
  
  app.get("/api/conversations/:id/transcript", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { id } = req.params;
      
      // Get conversation
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('raw_text, id')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();
      
      if (convError || !conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      // Get normalized turns from artifacts
      const { data: artifacts } = await supabaseAdmin
        .from('conversation_artifacts')
        .select('content_json')
        .eq('conversation_id', id)
        .eq('artifact_type', 'attachment')
        .eq('filename', 'normalized_transcript.json')
        .single();
      
      const turns = artifacts?.content_json?.turns || [];
      
      res.json({
        raw_text: conversation.raw_text,
        turns: turns
      });
    } catch (e: any) {
      console.error("Get transcript error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // UPDATE ISSUE STATUS: PATCH /api/evaluations/:id/issues/:claimId
  // ============================================================================
  
  app.patch("/api/evaluations/:id/issues/:claimId", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { id, claimId } = req.params;
      const { status } = req.body;
      
      if (!status || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_POSITIVE'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be OPEN, ACKNOWLEDGED, RESOLVED, or FALSE_POSITIVE" });
      }
      
      // Get evaluation
      const { data: evaluation, error: evalError } = await supabaseAdmin
        .from('evaluations')
        .select('report')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();
      
      if (evalError || !evaluation) {
        return res.status(404).json({ error: "Evaluation not found" });
      }
      
      const report = evaluation.report as any;
      const issues = report.issues || [];
      
      // Update issue status
      const issueIndex = issues.findIndex((i: any) => i.claimId === claimId);
      if (issueIndex === -1) {
        return res.status(404).json({ error: "Issue not found" });
      }
      
      issues[issueIndex].status = status;
      
      // Update evaluation report
      const { error: updateError } = await supabaseAdmin
        .from('evaluations')
        .update({ report: { ...report, issues } })
        .eq('id', id);
      
      if (updateError) {
        return res.status(500).json({ error: `Failed to update issue status: ${updateError.message}` });
      }
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'ISSUE_STATUS_CHANGED',
        targetType: 'evaluation',
        targetId: id,
        meta: {
          claimId,
          oldStatus: issues[issueIndex].status,
          newStatus: status
        }
      });
      
      res.json({ success: true, issue: issues[issueIndex] });
    } catch (e: any) {
      console.error("Update issue status error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // EXPORTS: POST /api/exports/claims-csv
  // ============================================================================
  
  app.post("/api/exports/claims-csv", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { evaluation_id } = req.body;
      
      if (!evaluation_id) {
        return res.status(400).json({ error: "evaluation_id is required" });
      }
      
      const result = await exportClaimsCSV(
        evaluation_id,
        context.orgId,
        context.projectId || '',
        context.env,
        supabaseAdmin
      );
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'EXPORT_CREATED',
        targetType: 'evaluation',
        targetId: evaluation_id,
        meta: {
          artifact_id: result.artifactId,
          export_type: 'claims_csv',
          checksum: result.checksum,
          storage_path: `exports/${context.orgId}/${context.projectId}/${context.env}`
        }
      });
      
      res.json(result);
    } catch (e: any) {
      console.error("Export claims CSV error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // EXPORTS: POST /api/exports/run-json
  // ============================================================================
  
  app.post("/api/exports/run-json", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { evaluation_id } = req.body;
      
      if (!evaluation_id) {
        return res.status(400).json({ error: "evaluation_id is required" });
      }
      
      const result = await exportRunJSON(
        evaluation_id,
        context.orgId,
        context.projectId || '',
        context.env,
        supabaseAdmin
      );
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'EXPORT_CREATED',
        targetType: 'evaluation',
        targetId: evaluation_id,
        meta: {
          artifact_id: result.artifactId,
          export_type: 'run_json',
          checksum: result.checksum,
          storage_path: `exports/${context.orgId}/${context.projectId}/${context.env}`
        }
      });
      
      res.json(result);
    } catch (e: any) {
      console.error("Export run JSON error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // EXPORTS: POST /api/exports/issue-pdf
  // ============================================================================
  
  app.post("/api/exports/issue-pdf", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context) {
        return res.status(401).json({ error: "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { evaluation_id, claim_id } = req.body;
      
      if (!evaluation_id || !claim_id) {
        return res.status(400).json({ error: "evaluation_id and claim_id are required" });
      }
      
      const result = await exportIssuePDF(
        evaluation_id,
        claim_id,
        context.orgId,
        context.projectId || '',
        context.env,
        supabaseAdmin
      );
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'EXPORT_CREATED',
        targetType: 'evaluation',
        targetId: evaluation_id,
        meta: {
          artifact_id: result.artifactId,
          export_type: 'issue_pdf',
          claim_id: claim_id,
          checksum: result.checksum,
          storage_path: `exports/${context.orgId}/${context.projectId}/${context.env}`
        }
      });
      
      res.json(result);
    } catch (e: any) {
      console.error("Export issue PDF error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
}

/**
 * Helper: Extract turns from transcript text
 */
function extractTurns(text: string): Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> {
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const turns: Array<{ idx: number; speaker: string; text: string; startMs?: number; endMs?: number }> = [];
  let idx = 0;
  
  for (const ln of lines) {
    let speaker = "UNKNOWN";
    let body = ln;
    
    if (/^agent:/i.test(ln)) {
      speaker = "AGENT";
      body = ln.replace(/^agent:\s*/i, "");
    } else if (/^customer:/i.test(ln)) {
      speaker = "CUSTOMER";
      body = ln.replace(/^customer:\s*/i, "");
    } else if (/^(rep|caller):/i.test(ln)) {
      speaker = "AGENT";
      body = ln.replace(/^(rep|caller):\s*/i, "");
    }
    
    if (body.length > 0) {
      turns.push({ idx: idx++, speaker, text: body });
    }
  }
  
  return turns;
}
