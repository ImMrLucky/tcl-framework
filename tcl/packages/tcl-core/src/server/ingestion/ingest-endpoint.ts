/**
 * Ingestion Endpoint
 * 
 * Handles file uploads and normalization for ProtectQA.
 * Integrates with the existing conversation and evaluation pipeline.
 */

import express from "express";
import { normalizeFile, NormalizedConversation, NormalizerOptions } from "./normalizers/index.js";
import { extractClaimsWithAnchors, buildIssueDTOs } from "./issue-derivation.js";
import { supabaseAdmin } from "../supabase.js";
import { getOrgContext } from "../auth-context.js";

// =============================================================================
// TYPES
// =============================================================================

export interface IngestRequest {
  /** File content (base64 or text) */
  content: string;
  /** Original filename */
  filename: string;
  /** Optional: conversation ID to attach to */
  conversationId?: string;
  /** Optional: title for the conversation */
  title?: string;
  /** Optional: speaker role overrides */
  speakerOverrides?: Record<string, string>;
  /** Whether to run evaluation immediately */
  runEvaluation?: boolean;
}

export interface IngestResponse {
  success: boolean;
  /** The normalized conversation */
  normalized?: NormalizedConversation;
  /** Artifact ID */
  artifactId?: string;
  /** Conversation ID */
  conversationId?: string;
  /** Warnings from normalization */
  warnings?: string[];
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// INGEST ENDPOINT
// =============================================================================

export function registerIngestEndpoints(app: express.Express) {
  /**
   * POST /api/ingest
   * 
   * Ingest a file and normalize it to the canonical format.
   * Optionally runs evaluation immediately.
   */
  app.post("/api/ingest", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      const body = req.body as IngestRequest;
      
      if (!body.content || !body.filename) {
        return res.status(400).json({ error: "Missing content or filename" });
      }
      
      // Decode content
      let contentBuffer: Buffer;
      try {
        // Try base64 first
        if (body.content.includes("base64,")) {
          contentBuffer = Buffer.from(body.content.split("base64,")[1], "base64");
        } else if (/^[A-Za-z0-9+/=]+$/.test(body.content.replace(/\s/g, ""))) {
          contentBuffer = Buffer.from(body.content, "base64");
        } else {
          // Plain text
          contentBuffer = Buffer.from(body.content, "utf-8");
        }
      } catch (e) {
        return res.status(400).json({ error: "Invalid content encoding" });
      }
      
      // Build normalizer options
      const options: NormalizerOptions = {
        speakerOverrides: body.speakerOverrides as any,
        defaultLanguage: "en",
        defaultTimezone: "UTC",
      };
      
      // Normalize
      const result = await normalizeFile(contentBuffer, body.filename, options);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: "Normalization failed",
          warnings: result.warnings,
        });
      }
      
      // Store in database
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Database not configured" });
      }
      
      // Create or get conversation
      let conversationId = body.conversationId;
      
      if (!conversationId) {
        // Build the raw text from normalized turns
        const rawText = result.normalized.turns
          .map(t => `${t.speakerLabel}: ${t.text}`)
          .join("\n");
        
        // Match the exact schema used by /conversations POST endpoint
        const { data: conv, error: convError } = await supabaseAdmin
          .from("conversations")
          .insert({
            org_id: context.orgId,
            project_id: context.projectId || null,
            env: context.env || "production",
            external_id: null,
            title: body.title || `Ingested: ${body.filename}`,
            content: rawText,
            metadata: {
              sourceFormat: result.normalized.sourceFormat,
              originalFilename: body.filename,
              channel: result.normalized.channel,
              turnsCount: result.normalized.turns.length,
              participantsCount: result.normalized.participants.length,
            },
          })
          .select("id")
          .single();
        
        if (convError) {
          console.error("Failed to create conversation:", convError);
          console.error("Error code:", convError.code);
          console.error("Error message:", convError.message);
          console.error("Error hint:", convError.hint);
          return res.status(500).json({ 
            error: "Failed to create conversation",
            details: convError.message || convError.code,
            hint: convError.hint || undefined
          });
        }
        
        conversationId = conv.id;
      }
      
      // Create artifact - include org_id, project_id, env as required by schema
      const artifactType = result.normalized.attachments.length > 0 && 
                           result.normalized.raw.inferredValues?.isAudio
        ? "audio_recording"
        : "transcript_text";
      
      const { data: artifact, error: artifactError } = await supabaseAdmin
        .from("conversation_artifacts")
        .insert({
          org_id: context.orgId,
          project_id: context.projectId || null,
          env: context.env || "production",
          conversation_id: conversationId,
          artifact_type: artifactType,
          content_json: result.normalized,
          storage_ref: `inline:${conversationId}`, // Not stored externally, content is in content_json
        })
        .select("id")
        .single();
      
      if (artifactError) {
        console.error("Failed to create artifact:", artifactError);
        console.error("Artifact error details:", artifactError.message, artifactError.code);
        return res.status(500).json({ 
          error: "Failed to store artifact",
          details: artifactError.message || artifactError.code
        });
      }
      
      // Log ingestion - wrap in try/catch so it doesn't break the response
      try {
        await supabaseAdmin.from("audit_log").insert({
          org_id: context.orgId,
          action: "artifact_ingested",
          entity_type: "conversation_artifact",
          entity_id: artifact.id,
          actor_user_id: context.userId || null,
          metadata: {
            filename: body.filename,
            format: result.normalized.sourceFormat,
            turnsCount: result.normalized.turns.length,
            participantsCount: result.normalized.participants.length,
          },
        });
      } catch (auditErr) {
        // Don't fail the request if audit logging fails
        console.warn("Audit log insert failed:", auditErr);
      }
      
      res.json({
        success: true,
        normalized: result.normalized,
        artifactId: artifact.id,
        conversationId,
        warnings: result.warnings,
      });
      
    } catch (e: any) {
      console.error("Ingest error:", e);
      console.error("Ingest error stack:", e.stack);
      res.status(500).json({ 
        error: e.message || "Ingestion failed",
        details: process.env.NODE_ENV !== 'production' ? e.stack : undefined
      });
    }
  });
  
  /**
   * POST /api/ingest/preview
   * 
   * Preview normalization without saving to database.
   * Useful for showing user the parsed result before confirming.
   */
  app.post("/api/ingest/preview", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      const body = req.body as IngestRequest;
      
      if (!body.content || !body.filename) {
        return res.status(400).json({ error: "Missing content or filename" });
      }
      
      // Decode content
      let contentBuffer: Buffer;
      try {
        if (body.content.includes("base64,")) {
          contentBuffer = Buffer.from(body.content.split("base64,")[1], "base64");
        } else if (/^[A-Za-z0-9+/=]+$/.test(body.content.replace(/\s/g, ""))) {
          contentBuffer = Buffer.from(body.content, "base64");
        } else {
          contentBuffer = Buffer.from(body.content, "utf-8");
        }
      } catch (e) {
        return res.status(400).json({ error: "Invalid content encoding" });
      }
      
      // Build options
      const options: NormalizerOptions = {
        speakerOverrides: body.speakerOverrides as any,
        defaultLanguage: "en",
        defaultTimezone: "UTC",
      };
      
      // Normalize
      const result = await normalizeFile(contentBuffer, body.filename, options);
      
      res.json({
        success: result.success,
        normalized: result.normalized,
        warnings: result.warnings,
        preview: {
          turnsCount: result.normalized.turns.length,
          participantsCount: result.normalized.participants.length,
          participants: result.normalized.participants.map(p => ({
            displayName: p.displayName,
            role: p.role,
          })),
          sampleTurns: result.normalized.turns.slice(0, 5).map(t => ({
            turnIndex: t.turnIndex,
            speakerLabel: t.speakerLabel,
            role: t.role,
            text: t.text.substring(0, 200) + (t.text.length > 200 ? "..." : ""),
          })),
        },
      });
      
    } catch (e: any) {
      console.error("Preview error:", e);
      res.status(500).json({ error: e.message || "Preview failed" });
    }
  });
  
  /**
   * GET /conversations/:id/normalized
   * 
   * Get the normalized conversation for a given conversation ID.
   */
  app.get("/conversations/:id/normalized", async (req, res) => {
    try {
      const context = await getOrgContext(req);
      
      if (!context || context.error) {
        return res.status(401).json({ error: context?.error || "Authorization required" });
      }
      
      if (!supabaseAdmin) {
        return res.status(503).json({ error: "Database not configured" });
      }
      
      const { id } = req.params;
      
      // Get conversation artifacts
      const { data: artifacts, error } = await supabaseAdmin
        .from("conversation_artifacts")
        .select("id, artifact_type, content_json, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false });
      
      if (error) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      // Find the transcript artifact
      const transcript = artifacts.find(a => 
        a.artifact_type === "transcript_text" || 
        a.artifact_type === "chat_messages"
      );
      
      if (!transcript) {
        return res.status(404).json({ error: "No normalized transcript found" });
      }
      
      res.json({
        artifactId: transcript.id,
        normalized: transcript.content_json,
        createdAt: transcript.created_at,
      });
      
    } catch (e: any) {
      console.error("Get normalized error:", e);
      res.status(500).json({ error: e.message || "Failed to get normalized conversation" });
    }
  });
}

// =============================================================================
// EXPORT
// =============================================================================

export { normalizeFile, extractClaimsWithAnchors, buildIssueDTOs };

