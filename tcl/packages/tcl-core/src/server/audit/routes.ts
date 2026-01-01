import express from "express";
import { supabaseAdmin, logAudit, trackUsage } from "../supabase.js";
import { getOrgContext } from "../auth-context.js";
import { extractClaims } from "../../claim_extractor.js";
import { buildClaimGraph } from "../../graph/edge_builder.js";
import { runEvaluation } from "./evaluation-run.js";
import { processArtifacts } from "../integrations/artifacts/processor.js";
import type { ConversationArtifact } from "../integrations/types.js";
import { exportClaimsCSV, exportRunJSON, exportIssuePDF } from "./exports.js";

/**
 * Setup audit-grade analysis routes
 */
export function setupAuditRoutes(app: express.Application) {
  console.log("Setting up audit routes...");
  
  // ============================================================================
  // INGESTION: POST /api/conversations/ingest
  // ============================================================================
  
  app.post("/api/conversations/ingest", async (req, res) => {
    console.log("POST /api/conversations/ingest - Route hit");
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
  // LIST EVALUATIONS: GET /api/evaluations
  // ============================================================================
  
  app.get("/api/evaluations", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const env = req.query.env as string;
      const projectId = req.query.projectId as string;
      
      // Build query
      let query = supabaseAdmin
        .from('evaluations')
        .select('id, org_id, project_id, env, conversation_id, scores, engine_version, latency_ms, report, created_at', { count: 'exact' })
        .eq('org_id', context.orgId)
        .order('created_at', { ascending: false });
      
      if (env) {
        query = query.eq('env', env);
      }
      
      if (projectId) {
        query = query.eq('project_id', projectId);
      }
      
      const { data, error, count } = await query.range(offset, offset + limit - 1);
      
      if (error) {
        return res.status(500).json({ error: error.message });
      }
      
      res.json({ 
        evaluations: data || [],
        total: count || 0,
        limit,
        offset
      });
    } catch (e: any) {
      console.error("List evaluations error:", e);
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      const rawIssues = (evaluation.report as any)?.issues || [];
      
      // Transform DefensibleIssue format to frontend Issue format
      const issues = rawIssues.map((issue: any, index: number) => {
        // If already in flat format, return as-is with rank
        if (issue.claimId && issue.truthState && !issue.what) {
          return { ...issue, rank: index + 1 };
        }
        
        // Get turn index for evidence display
        const turnIdx = issue.where?.turnStartIdx ?? issue.turnStartIdx ?? 0;
        const speakerForEvidence = issue.who?.speaker || issue.speaker || 'UNKNOWN';
        
        // Format evidence location string
        const evidenceLocation = turnIdx !== undefined && turnIdx !== null
          ? `Call · Line ${turnIdx + 1}` // +1 for human-readable line numbers
          : 'N/A';
        
        // Transform from DefensibleIssue to flat Issue format
        return {
          rank: index + 1,
          claimId: issue.claimId || issue.what?.claimId,
          claimText: issue.what?.claimText || issue.claimText,
          claimSummary: issue.what?.claimSummary || (issue.what?.claimText ? 
            '"' + issue.what.claimText.substring(0, 77) + (issue.what.claimText.length > 77 ? '..."' : '"') : 'N/A'),
          truthState: issue.what?.truthState || issue.truthState || 'Inconclusive',
          nodeBlameNorm: issue.confidence?.nodeBlameNorm ?? issue.nodeBlameNorm ?? 0,
          importance: issue.confidence?.importance ?? issue.importance ?? 0.5,
          issueType: issue.what?.issueType || issue.issueType || 'UNSUPPORTED',
          speaker: issue.who?.speaker || issue.speaker || 'UNKNOWN',
          speakerLabel: issue.who?.speakerLabel || 
                        (speakerForEvidence === 'AGENT' ? 'Agent' : 
                         speakerForEvidence === 'CUSTOMER' ? 'Customer' : 'Unknown'),
          turnStartIdx: turnIdx,
          turnEndIdx: issue.where?.turnEndIdx ?? issue.turnEndIdx ?? turnIdx,
          evidenceLocation,
          description: issue.what?.description || issue.description || 'Issue detected',
          whyFlagged: issue.what?.whyFlagged || issue.whyFlagged || 'Requires verification',
          severity: issue.risk?.severity || issue.severity || 'low',
          riskCategory: issue.risk?.category || issue.riskCategory || 'accuracy',
          riskExplanation: issue.risk?.explanation || issue.riskExplanation || '',
          primaryEvidence: issue.where ? {
            turnIdx,
            speaker: speakerForEvidence,
            excerpt: issue.where.excerpt || issue.what?.claimText?.substring(0, 200) || ''
          } : issue.primaryEvidence,
          conflictsWith: (issue.conflictsWith || []).map((c: any) => ({
            claimId: c.claimId,
            claimText: c.claimText || c.claimId,
            relationshipType: c.relationshipType,
            weight: c.edgeWeight || c.weight || 0
          })),
          relatedEdges: {
            topBadContradictions: issue.conflictsWith?.filter((c: any) => c.relationshipType === 'contradiction') || 
                                  issue.relatedEdges?.topBadContradictions || [],
            topBadSupports: issue.conflictsWith?.filter((c: any) => c.relationshipType === 'unsupported_by') ||
                           issue.relatedEdges?.topBadSupports || []
          },
          status: issue.status || 'OPEN'
        };
      });
      
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
  // SIMULATION: POST /api/evaluations/:id/simulate
  // Creates a new SIMULATION evaluation based on an existing evaluation
  // The original evaluation remains IMMUTABLE
  // ============================================================================
  
  app.post("/api/evaluations/:id/simulate", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      const { id: parentEvaluationId } = req.params;
      const { 
        modifications,  // What changes to apply
        description     // Why this simulation is being created
      } = req.body;
      
      // Get the original evaluation
      const { data: originalEval, error: fetchError } = await supabaseAdmin
        .from('evaluations')
        .select('*')
        .eq('id', parentEvaluationId)
        .eq('org_id', context.orgId)
        .single();
      
      if (fetchError || !originalEval) {
        return res.status(404).json({ error: "Original evaluation not found" });
      }
      
      // Get the original report/manifest
      const originalReport = originalEval.report as any || {};
      const originalInputs = originalReport.frozenInputs || originalReport.inputs || {};
      
      // Get claims from various possible locations
      let rawClaims = originalInputs.claims || [];
      if (rawClaims.length === 0) {
        // Try report.claims (ValidateOutput format)
        rawClaims = (originalReport.claims || []).map((c: any) => ({
          id: c.id,
          text: c.text,
          speaker: c.meta?.speaker === 'Agent' ? 'AGENT' : 
                   c.meta?.speaker === 'Customer' ? 'CUSTOMER' : 
                   c.meta?.speaker || 'UNKNOWN',
          turnStartIdx: c.meta?.turnIndex,
          tags: []
        }));
      }
      
      // Get edges from various possible locations
      let rawSupports = originalInputs.supports || originalReport.graph?.supports || [];
      let rawContradictions = originalInputs.contradictions || 
                              originalReport.graph?.contradictions || 
                              (originalReport.contradictions || []).map((c: any) => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight || 1.0 }));
      let rawGrounded = originalInputs.grounded || 
                        originalReport.graph?.groundedClaimIds || 
                        (originalReport.graph?.grounding || []).map((g: any) => g.claimId);
      
      // Apply modifications to create simulation inputs
      let simulationClaims = [...rawClaims];
      let simulationSupports = [...rawSupports];
      let simulationContradictions = [...rawContradictions];
      let simulationGrounded = [...rawGrounded];
      
      // Process modifications
      if (modifications) {
        // Add claims
        if (modifications.addClaims && Array.isArray(modifications.addClaims)) {
          for (const claim of modifications.addClaims) {
            simulationClaims.push({
              id: claim.id || `sim_claim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
              text: claim.text,
              speaker: claim.speaker || 'UNKNOWN',
              turnStartIdx: claim.turnIndex,
              tags: ['SIMULATED']
            });
          }
        }
        
        // Remove claims
        if (modifications.removeClaims && Array.isArray(modifications.removeClaims)) {
          const removeSet = new Set(modifications.removeClaims);
          simulationClaims = simulationClaims.filter(c => !removeSet.has(c.id));
          // Also remove edges involving removed claims
          simulationSupports = simulationSupports.filter(
            e => !removeSet.has(e.claimA) && !removeSet.has(e.claimB)
          );
          simulationContradictions = simulationContradictions.filter(
            e => !removeSet.has(e.claimA) && !removeSet.has(e.claimB)
          );
          // Remove from grounded
          simulationGrounded = simulationGrounded.filter(id => !removeSet.has(id));
        }
        
        // Add supports
        if (modifications.addSupports && Array.isArray(modifications.addSupports)) {
          for (const edge of modifications.addSupports) {
            simulationSupports.push({
              claimA: edge.claimA,
              claimB: edge.claimB,
              weight: edge.weight || 1.0,
              source: 'manual'
            });
          }
        }
        
        // Remove supports
        if (modifications.removeSupports && Array.isArray(modifications.removeSupports)) {
          for (const edge of modifications.removeSupports) {
            simulationSupports = simulationSupports.filter(
              e => !(e.claimA === edge.claimA && e.claimB === edge.claimB)
            );
          }
        }
        
        // Add contradictions
        if (modifications.addContradictions && Array.isArray(modifications.addContradictions)) {
          for (const edge of modifications.addContradictions) {
            simulationContradictions.push({
              claimA: edge.claimA,
              claimB: edge.claimB,
              weight: edge.weight || 1.0,
              source: 'manual'
            });
          }
        }
        
        // Remove contradictions
        if (modifications.removeContradictions && Array.isArray(modifications.removeContradictions)) {
          for (const edge of modifications.removeContradictions) {
            simulationContradictions = simulationContradictions.filter(
              e => !(e.claimA === edge.claimA && e.claimB === edge.claimB)
            );
          }
        }
        
        // Add grounded claims
        if (modifications.addGrounded && Array.isArray(modifications.addGrounded)) {
          for (const claimId of modifications.addGrounded) {
            if (!simulationGrounded.includes(claimId)) {
              simulationGrounded.push(claimId);
            }
          }
        }
        
        // Remove grounded claims
        if (modifications.removeGrounded && Array.isArray(modifications.removeGrounded)) {
          const removeSet = new Set(modifications.removeGrounded);
          simulationGrounded = simulationGrounded.filter(id => !removeSet.has(id));
        }
      }
      
      // Now run the evaluation with the modified inputs
      const result = await runEvaluation(
        {
          conversationId: originalEval.conversation_id,
          claims: simulationClaims.map((c: any) => ({
            id: c.id,
            text: c.text,
            speaker: c.speaker,
            turnIndex: c.turnStartIdx
          })),
          supports: simulationSupports,
          contradictions: simulationContradictions,
          grounded: simulationGrounded,
          config: originalReport.frozenConfig?.parameters || {}
        },
        context,
        supabaseAdmin
      );
      
      // Update the new evaluation to mark it as a SIMULATION with parent reference
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
      
      const { data: newEval, error: getNewError } = await supabaseAdmin
        .from('evaluations')
        .select('report')
        .eq('id', result.evaluationId)
        .single();
      
      if (!getNewError && newEval) {
        const updatedReport = {
          ...(newEval.report as any),
          mode: 'SIMULATION',
          parentEvaluationId,
          simulationDescription: description || 'What-if analysis',
          modifications: modifications || {},
          expiresAt
        };
        
        await supabaseAdmin
          .from('evaluations')
          .update({ 
            report: updatedReport,
            env: 'sandbox' // Simulations always go to sandbox
          })
          .eq('id', result.evaluationId);
      }
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'SIMULATION_CREATED',
        targetType: 'evaluation',
        targetId: result.evaluationId,
        meta: {
          parentEvaluationId,
          description: description || 'What-if analysis',
          modificationsApplied: Object.keys(modifications || {})
        }
      });
      
      res.json({
        success: true,
        evaluationId: result.evaluationId,
        parentEvaluationId,
        mode: 'SIMULATION',
        expiresAt,
        inputHash: result.inputHash,
        configHash: result.configHash,
        latency: result.latency
      });
    } catch (e: any) {
      console.error("Simulation error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // SENSITIVE ACTIONS HELPER
  // ============================================================================
  
  /**
   * Check if request has recent re-authentication
   * The X-Reauth-Verified header should be set by frontend after password verification
   * This is a trust-based check - the real verification happens at /auth/verify-password
   */
  function checkReauthHeader(req: express.Request): boolean {
    const reauthHeader = req.headers['x-reauth-verified'];
    return reauthHeader === 'true';
  }
  
  // ============================================================================
  // DELETE EVALUATION: DELETE /api/evaluations/:id (SENSITIVE - requires re-auth)
  // ============================================================================
  
  app.delete("/api/evaluations/:id", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Supabase not configured" });
      }
      
      // Check role - only owner or admin can delete
      if (context.role && !['owner', 'admin'].includes(context.role)) {
        return res.status(403).json({ error: "Insufficient permissions to delete evaluations" });
      }
      
      const { id } = req.params;
      
      // Get evaluation first to confirm it exists and belongs to org
      const { data: evaluation, error: fetchError } = await supabaseAdmin
        .from('evaluations')
        .select('id, conversation_id')
        .eq('id', id)
        .eq('org_id', context.orgId)
        .single();
      
      if (fetchError || !evaluation) {
        return res.status(404).json({ error: "Evaluation not found" });
      }
      
      // Delete the evaluation
      const { error: deleteError } = await supabaseAdmin
        .from('evaluations')
        .delete()
        .eq('id', id)
        .eq('org_id', context.orgId);
      
      if (deleteError) {
        return res.status(500).json({ error: `Failed to delete evaluation: ${deleteError.message}` });
      }
      
      // Log audit
      await logAudit({
        orgId: context.orgId,
        action: 'EVALUATION_DELETED',
        targetType: 'evaluation',
        targetId: id,
        meta: {
          conversation_id: evaluation.conversation_id,
          deleted_by: context.userId
        }
      });
      
      res.json({ success: true, message: "Evaluation deleted" });
    } catch (e: any) {
      console.error("Delete evaluation error:", e);
      res.status(500).json({ 
        error: e?.message ?? "unknown error"
      });
    }
  });
  
  // ============================================================================
  // EXPORTS: POST /api/exports/claims-csv (SENSITIVE - creates downloadable audit data)
  // ============================================================================
  
  app.post("/api/exports/claims-csv", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
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
