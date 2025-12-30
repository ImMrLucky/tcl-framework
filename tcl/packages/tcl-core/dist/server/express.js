import express from "express";
import { supabaseAdmin, verifyApiKeyExtended, provisionUser, getUserOrgs, getUserRole, checkUserPermission, getOrgProjects, getProjectEnvs, generateApiKey, logAudit, trackUsage } from "./supabase.js";
import { inviteMember, updateMemberRole, removeMember, listMembers } from "./member-management.js";
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: 'application/json', limit: '10mb' })); // For HMAC webhook verification
app.use(express.urlencoded({ extended: true })); // Enable query string parsing
// Health check endpoint - must work even if other imports fail
app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "tcl-core" });
});
// Lazy load these to avoid startup crashes
let validate;
let OpenAIAdapter;
async function loadModules() {
    try {
        console.log("Starting to load modules...");
        const orchestrator = await import("../orchestrator.js");
        console.log("Orchestrator imported");
        validate = orchestrator.validate;
        console.log("Validate function assigned");
        const adapter = await import("../adapters/openai_adapter.js");
        console.log("Adapter imported");
        OpenAIAdapter = adapter.OpenAIAdapter;
        console.log("OpenAIAdapter assigned");
        console.log("✅ Modules loaded successfully");
    }
    catch (error) {
        console.error("❌ Failed to load modules:", error);
        console.error("Error message:", error?.message);
        console.error("Error stack:", error?.stack);
        throw error;
    }
}
// Don't load modules on startup - let server start first, then load modules
// This ensures health check works even if modules fail to load
// Extract org/project/env from request (API key or user session)
async function getOrgContext(req) {
    // Check for API key in Authorization header
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
    // For now, return null (anonymous validation)
    return null;
}
/**
 * Check if user has permission for an org
 * Returns { hasPermission: boolean, role: string | null }
 */
async function checkPermission(userId, orgId, permission) {
    if (!supabaseAdmin)
        return { hasPermission: false, role: null };
    const hasPerm = await checkUserPermission(userId, orgId, permission);
    const role = await getUserRole(userId, orgId);
    return {
        hasPermission: hasPerm,
        role
    };
}
app.post("/validate", async (req, res) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).json({ error: "Request timeout" });
        }
    }, 300000); // 5 minute timeout
    try {
        // Ensure modules are loaded
        if (!validate) {
            await loadModules();
            if (!validate) {
                clearTimeout(timeout);
                return res.status(503).json({ error: "Service initializing, please try again" });
            }
        }
        console.log("Received validate request");
        console.log("Request body:", JSON.stringify(req.body, null, 2));
        const input = req.body;
        // Validate question (required)
        if (!input.question || typeof input.question !== 'string' || input.question.trim().length === 0) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "question is required and must be a non-empty string" });
        }
        // Validate answer - allow empty string for call center QA, but ensure it's a string
        if (input.answer === undefined || input.answer === null) {
            input.answer = "";
        }
        // Ensure answer is a string
        if (typeof input.answer !== 'string') {
            input.answer = String(input.answer);
        }
        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
        if (apiKey && !input.options?.llmAdapter && OpenAIAdapter) {
            input.options = input.options ?? {};
            input.options.llmAdapter = new OpenAIAdapter({ apiKey, model });
        }
        console.log("Starting validation...");
        const startTime = Date.now();
        const out = await validate(input);
        const latency = Date.now() - startTime;
        console.log("Validation complete");
        // Store validation in Supabase if configured
        const context = await getOrgContext(req);
        if (context && supabaseAdmin) {
            try {
                const { error: dbError } = await supabaseAdmin
                    .from('evaluations')
                    .insert({
                    org_id: context.orgId,
                    project_id: context.projectId || null,
                    env: context.env,
                    scores: out.scores || {},
                    refusal: out.refusal || false,
                    scorer_id: out.scorerId || null,
                    engine_version: process.env.ENGINE_VERSION || '0.2.0',
                    latency_ms: latency,
                    report: out.report || {}
                });
                if (dbError) {
                    console.error('Failed to store evaluation:', dbError);
                }
                else {
                    // Track usage
                    await trackUsage(context.orgId, context.projectId, context.env, 'evaluation');
                    // Log audit event
                    await logAudit({
                        orgId: context.orgId,
                        action: 'evaluation.create',
                        targetType: 'evaluation',
                        meta: { question: input.question.substring(0, 100), latency, env: context.env }
                    });
                }
            }
            catch (dbErr) {
                console.error('Database error (non-fatal):', dbErr);
            }
        }
        clearTimeout(timeout);
        res.json(out);
    }
    catch (e) {
        clearTimeout(timeout);
        console.error("Validation error:", e);
        console.error("Error stack:", e?.stack);
        res.status(500).json({
            error: e?.message ?? "unknown error",
            stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
        });
    }
});
// Batch validation endpoint
// Supports both use cases:
// 1. Batch QA: question + answer pairs (general QA validation)
// 2. Batch Call Transcripts: question only (call center QA - answer can be empty or omitted)
app.post("/validate/batch", async (req, res) => {
    const timeout = setTimeout(() => {
        if (!res.headersSent) {
            res.status(504).json({ error: "Request timeout" });
        }
    }, 600000); // 10 minute timeout for batch
    try {
        // Ensure modules are loaded
        if (!validate) {
            await loadModules();
            if (!validate) {
                clearTimeout(timeout);
                return res.status(503).json({ error: "Service initializing, please try again" });
            }
        }
        console.log("Received batch validate request");
        const input = req.body;
        // Validate input
        if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "items is required and must be a non-empty array" });
        }
        if (input.items.length > 100) {
            clearTimeout(timeout);
            return res.status(400).json({ error: "Maximum 100 items per batch request" });
        }
        // Validate each item
        // Note: answer is optional - empty answer means call transcript mode
        for (let i = 0; i < input.items.length; i++) {
            const item = input.items[i];
            if (!item.question || typeof item.question !== 'string' || item.question.trim().length === 0) {
                clearTimeout(timeout);
                return res.status(400).json({ error: `Item ${i + 1}: question is required and must be a non-empty string` });
            }
            // answer is optional - if missing/empty, will be treated as call transcript
            if (item.answer === undefined || item.answer === null) {
                item.answer = "";
            }
            if (typeof item.answer !== 'string') {
                item.answer = String(item.answer);
            }
        }
        // Merge shared options with item-specific options
        const apiKey = process.env.OPENAI_API_KEY;
        const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
        const sharedOptions = input.options || {};
        // Process all items in parallel (with concurrency limit)
        const concurrency = 10; // Process 10 at a time
        const results = [];
        const latencies = [];
        for (let i = 0; i < input.items.length; i += concurrency) {
            const batch = input.items.slice(i, i + concurrency);
            const batchResults = await Promise.all(batch.map(async (item) => {
                const startTime = Date.now();
                try {
                    // Merge shared options with item options
                    const itemOptions = {
                        ...sharedOptions,
                        ...item.options
                    };
                    // Add adapter if available
                    if (apiKey && !itemOptions.llmAdapter && OpenAIAdapter) {
                        itemOptions.llmAdapter = new OpenAIAdapter({ apiKey, model });
                    }
                    const result = await validate({
                        ...item,
                        options: itemOptions
                    });
                    const latency = Date.now() - startTime;
                    latencies.push(latency);
                    return result;
                }
                catch (error) {
                    console.error(`Error validating item ${i + batch.indexOf(item) + 1}:`, error);
                    const latency = Date.now() - startTime;
                    latencies.push(latency);
                    // Return error result instead of failing entire batch
                    return {
                        answer: item.answer || "",
                        refusal: true,
                        scores: { truth: 0, consistency: 0, coherence: 0, overall: 0 },
                        error: error?.message || "Validation failed",
                        report: {
                            claims: [],
                            violations: [],
                            missingEvidence: [],
                            contradictions: []
                        }
                    };
                }
            }));
            results.push(...batchResults);
        }
        // Calculate summary
        const passed = results.filter(r => !r.refusal && !r.error).length;
        const failed = results.length - passed;
        const averageScore = results
            .filter(r => r.scores && !r.error)
            .reduce((sum, r) => sum + (r.scores?.overall || 0), 0) / Math.max(1, results.filter(r => !r.error).length);
        const averageLatency = latencies.length > 0
            ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length
            : 0;
        const output = {
            results,
            summary: {
                total: results.length,
                passed,
                failed,
                averageScore: Math.round(averageScore),
                averageLatency: Math.round(averageLatency)
            }
        };
        clearTimeout(timeout);
        res.json(output);
    }
    catch (e) {
        clearTimeout(timeout);
        console.error("Batch validation error:", e);
        console.error("Error stack:", e?.stack);
        res.status(500).json({
            error: e?.message ?? "unknown error",
            stack: process.env.NODE_ENV === "development" ? e?.stack : undefined
        });
    }
});
// Auth provision endpoint (called after user signs up/logs in)
app.post("/auth/provision", async (req, res) => {
    try {
        const { userId, email } = req.body;
        if (!userId || !email) {
            return res.status(400).json({ error: "userId and email are required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        console.log(`Provision request for user: ${userId} (${email})`);
        const result = await provisionUser(userId, email);
        if (!result) {
            console.error(`Provision failed for user: ${userId}`);
            // Check if user has an org anyway (partial success)
            if (supabaseAdmin) {
                // First check org_members
                const { data: existingOrgs } = await supabaseAdmin
                    .from('org_members')
                    .select('org_id')
                    .eq('user_id', userId)
                    .limit(1)
                    .maybeSingle();
                if (existingOrgs?.org_id) {
                    console.log(`Partial success: User has org ${existingOrgs.org_id}, returning it`);
                    return res.json({
                        orgId: existingOrgs.org_id,
                        projectId: '',
                        warning: 'Provision partially completed - some steps may have failed'
                    });
                }
                // If no org_members, check if org was created but member wasn't added
                // Find orgs where user's email matches (since org name = email)
                const { data: orgsByEmail } = await supabaseAdmin
                    .from('organizations')
                    .select('id, name')
                    .eq('name', email)
                    .limit(1)
                    .maybeSingle();
                if (orgsByEmail?.id) {
                    console.log(`Partial success: Found org ${orgsByEmail.id} by email, returning it`);
                    return res.json({
                        orgId: orgsByEmail.id,
                        projectId: '',
                        warning: 'Provision partially completed - org exists but member not added'
                    });
                }
            }
            return res.status(500).json({
                error: "Failed to provision user",
                details: "Check server logs for details. User may still be able to use the app if profile and org exist."
            });
        }
        console.log(`✅ Provision successful: orgId=${result.orgId}, projectId=${result.projectId}`);
        res.json({ orgId: result.orgId, projectId: result.projectId });
    }
    catch (e) {
        console.error("Provision error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get user's organizations
app.post("/me/orgs", async (req, res) => {
    try {
        // Get userId from request body
        const userId = req.body.userId;
        if (!userId || userId.trim() === '') {
            return res.status(400).json({ error: "userId required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const orgs = await getUserOrgs(userId);
        res.json({ orgs });
    }
    catch (e) {
        console.error("Get orgs error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// ============================================
// Member Management Endpoints
// ============================================
// List members of an organization
app.get("/orgs/:orgId/members", async (req, res) => {
    try {
        const { orgId } = req.params;
        const userId = req.body.userId || req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // Check if user has view permission (all members can view)
        const canView = await checkUserPermission(userId, orgId, 'view');
        if (!canView) {
            return res.status(403).json({ error: "Insufficient permissions" });
        }
        const members = await listMembers(orgId);
        res.json({ members });
    }
    catch (e) {
        console.error("List members error:", e);
        res.status(500).json({ error: e?.message ?? "unknown error" });
    }
});
// Invite a member to an organization
app.post("/orgs/:orgId/members/invite", async (req, res) => {
    try {
        const { orgId } = req.params;
        const { email, role } = req.body;
        const userId = req.body.userId || req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }
        if (!email || !role) {
            return res.status(400).json({ error: "email and role are required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const result = await inviteMember(userId, orgId, email, role);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }
        // Log audit event
        await logAudit({
            orgId,
            actorUserId: userId,
            action: 'member.invite',
            targetType: 'org_member',
            targetId: result.userId,
            meta: { email, role }
        });
        res.json(result);
    }
    catch (e) {
        console.error("Invite member error:", e);
        res.status(500).json({ error: e?.message ?? "unknown error" });
    }
});
// Update a member's role
app.patch("/orgs/:orgId/members/:memberUserId", async (req, res) => {
    try {
        const { orgId, memberUserId } = req.params;
        const { role } = req.body;
        const userId = req.body.userId || req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }
        if (!role) {
            return res.status(400).json({ error: "role is required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const result = await updateMemberRole(userId, orgId, memberUserId, role);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }
        // Log audit event
        await logAudit({
            orgId,
            actorUserId: userId,
            action: 'member.update_role',
            targetType: 'org_member',
            targetId: memberUserId,
            meta: { newRole: role }
        });
        res.json(result);
    }
    catch (e) {
        console.error("Update member role error:", e);
        res.status(500).json({ error: e?.message ?? "unknown error" });
    }
});
// Remove a member from an organization
app.delete("/orgs/:orgId/members/:memberUserId", async (req, res) => {
    try {
        const { orgId, memberUserId } = req.params;
        const userId = req.body.userId || req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const result = await removeMember(userId, orgId, memberUserId);
        if (!result.success) {
            return res.status(400).json({ error: result.message });
        }
        // Log audit event
        await logAudit({
            orgId,
            actorUserId: userId,
            action: 'member.remove',
            targetType: 'org_member',
            targetId: memberUserId
        });
        res.json(result);
    }
    catch (e) {
        console.error("Remove member error:", e);
        res.status(500).json({ error: e?.message ?? "unknown error" });
    }
});
// API Key management endpoints
app.post("/orgs/:orgId/api-keys", async (req, res) => {
    try {
        const { orgId } = req.params;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: "name is required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // TODO: Verify user has admin/owner role for orgId
        const { key, prefix, hash } = generateApiKey();
        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .insert({
            org_id: orgId,
            name,
            key_hash: hash,
            prefix,
            scopes: ['validate:write', 'validate:read']
        })
            .select('id, name, prefix, created_at')
            .single();
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        // Return key only once (never again)
        res.json({
            id: data.id,
            name: data.name,
            prefix: data.prefix,
            key, // Only returned on creation
            createdAt: data.created_at
        });
        // Log audit
        await logAudit({
            orgId,
            action: 'apikey.create',
            targetType: 'api_key',
            targetId: data.id,
            meta: { name }
        });
    }
    catch (e) {
        console.error("Create API key error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
app.get("/orgs/:orgId/projects/:projectId/api-keys", async (req, res) => {
    try {
        const { orgId, projectId } = req.params;
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // TODO: Verify user has admin/owner role for orgId
        const { data, error } = await supabaseAdmin
            .from('api_keys')
            .select('id, name, prefix, env, scopes, is_active, created_at, revoked_at')
            .eq('org_id', orgId)
            .eq('project_id', projectId)
            .order('created_at', { ascending: false });
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ keys: data || [] });
    }
    catch (e) {
        console.error("Get API keys error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get evaluations for an org/project
app.get("/evaluations", async (req, res) => {
    try {
        const context = await getOrgContext(req);
        if (!context) {
            return res.status(401).json({ error: "Authorization required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const projectId = req.query.projectId || context.projectId;
        const env = req.query.env || context.env;
        let query = supabaseAdmin
            .from('evaluations')
            .select('*')
            .eq('org_id', context.orgId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (projectId) {
            query = query.eq('project_id', projectId);
        }
        if (env) {
            query = query.eq('env', env);
        }
        const { data, error } = await query;
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ evaluations: data || [] });
    }
    catch (e) {
        console.error("Get evaluations error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get projects for an org
app.get("/orgs/:orgId/projects", async (req, res) => {
    try {
        const { orgId } = req.params;
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // TODO: Verify user has access to this org
        const projects = await getOrgProjects(orgId);
        res.json({ projects });
    }
    catch (e) {
        console.error("Get projects error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get project environments
app.get("/projects/:projectId/envs", async (req, res) => {
    try {
        const { projectId } = req.params;
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // TODO: Verify user has access to this project
        const envs = await getProjectEnvs(projectId);
        res.json({ envs });
    }
    catch (e) {
        console.error("Get project envs error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Revoke API key
app.post("/orgs/:orgId/projects/:projectId/api-keys/:keyId/revoke", async (req, res) => {
    try {
        const { orgId, projectId, keyId } = req.params;
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        // TODO: Verify user has admin/owner role for orgId
        const { error } = await supabaseAdmin
            .from('api_keys')
            .update({
            is_active: false,
            revoked_at: new Date().toISOString()
        })
            .eq('id', keyId)
            .eq('org_id', orgId)
            .eq('project_id', projectId);
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ success: true });
        // Log audit
        await logAudit({
            orgId,
            action: 'apikey.revoke',
            targetType: 'api_key',
            targetId: keyId,
            meta: { projectId }
        });
    }
    catch (e) {
        console.error("Revoke API key error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Create conversation (ingest transcript)
app.post("/conversations", async (req, res) => {
    try {
        const context = await getOrgContext(req);
        if (!context) {
            return res.status(401).json({ error: "Authorization required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const { title, content, externalId, metadata = {} } = req.body;
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: "content is required and must be a string" });
        }
        // TODO: Extract userId from JWT if user session
        const { data, error } = await supabaseAdmin
            .from('conversations')
            .insert({
            org_id: context.orgId,
            project_id: context.projectId || null,
            env: context.env,
            external_id: externalId || null,
            title: title || null,
            content: content,
            metadata: metadata
        })
            .select('id, org_id, project_id, env, title, created_at')
            .single();
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        // Track usage
        await trackUsage(context.orgId, context.projectId, context.env, 'conversation');
        // Log audit
        await logAudit({
            orgId: context.orgId,
            action: 'conversation.create',
            targetType: 'conversation',
            targetId: data.id,
            meta: { projectId: context.projectId, env: context.env }
        });
        res.json({ conversation: data });
    }
    catch (e) {
        console.error("Create conversation error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get conversations
app.get("/conversations", async (req, res) => {
    try {
        const context = await getOrgContext(req);
        if (!context) {
            return res.status(401).json({ error: "Authorization required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const projectId = req.query.projectId || context.projectId;
        const env = req.query.env || context.env;
        let query = supabaseAdmin
            .from('conversations')
            .select('id, org_id, project_id, env, external_id, title, created_at')
            .eq('org_id', context.orgId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (projectId) {
            query = query.eq('project_id', projectId);
        }
        if (env) {
            query = query.eq('env', env);
        }
        const { data, error } = await query;
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ conversations: data || [] });
    }
    catch (e) {
        console.error("Get conversations error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Get evaluations for a conversation
app.get("/conversations/:conversationId/evaluations", async (req, res) => {
    try {
        const context = await getOrgContext(req);
        const { conversationId } = req.params;
        if (!context) {
            return res.status(401).json({ error: "Authorization required" });
        }
        if (!supabaseAdmin) {
            return res.status(503).json({ error: "Supabase not configured" });
        }
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;
        const { data, error } = await supabaseAdmin
            .from('evaluations')
            .select('*')
            .eq('org_id', context.orgId)
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) {
            return res.status(500).json({ error: error.message });
        }
        res.json({ evaluations: data || [] });
    }
    catch (e) {
        console.error("Get conversation evaluations error:", e);
        res.status(500).json({
            error: e?.message ?? "unknown error"
        });
    }
});
// Railway sets PORT automatically, but we default to 8787
const port = Number(process.env.PORT || 8787);
console.log(`Starting server...`);
console.log(`PORT environment variable: ${process.env.PORT || 'not set'}`);
console.log(`Using port: ${port}`);
// Start server with error handling
try {
    const server = app.listen(port, '0.0.0.0', () => {
        console.log(`✅ TCL-Core listening on ${port}`);
        console.log(`Health check available at http://0.0.0.0:${port}/health`);
        console.log(`Environment: PORT=${process.env.PORT || 'default (8787)'}, NODE_ENV=${process.env.NODE_ENV || 'not set'}`);
        // Verify server is actually listening
        const address = server.address();
        if (address && typeof address === 'object') {
            console.log(`Server bound to ${address.address}:${address.port}`);
        }
        // Try to load modules after server starts
        loadModules().catch((err) => {
            console.error("Module loading failed (non-critical for health check):", err?.message);
        });
    });
    server.on('error', (error) => {
        console.error('Server error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`Port ${port} is already in use`);
        }
    });
}
catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
}
// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
