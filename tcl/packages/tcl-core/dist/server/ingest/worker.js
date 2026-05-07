/**
 * Background Job Worker
 * Processes ingestion jobs asynchronously
 */
import { supabaseAdmin } from '../supabase.js';
import { downloadFileFromSupabase } from './storage-supabase.js';
import { readAsset } from './storage.js'; // Keep for backward compatibility
import { normalizeTranscriptBuffer } from '../transcripts/normalize.js';
import { transcribeAudio } from '../transcription.js';
import { buildSpeakerRoleMap } from '../../graph/speaker-role-mapper.js';
import { normalizeTranscript } from '../../graph/transcript-normalizer.js';
import { computeVerificationDiff } from '../verify/diff.js';
import { withTranscriptionSlot } from '../asr/limit.js';
import { resolveEvidenceSet } from '../evidence/service.js';
/**
 * Read asset content (from Supabase Storage or local filesystem for backward compatibility)
 */
async function readAssetContent(asset) {
    // Prefer Supabase Storage if bucket/object_path are available
    if (asset.bucket && asset.object_path) {
        try {
            return await downloadFileFromSupabase(asset.bucket, asset.object_path);
        }
        catch (error) {
            console.error(`[Worker] Failed to download from Supabase Storage (${asset.bucket}/${asset.object_path}):`, error);
            throw error;
        }
    }
    // Fallback to local filesystem (backward compatibility)
    if (asset.storage_url) {
        try {
            return await readAsset(asset.storage_url);
        }
        catch (error) {
            console.error(`[Worker] Failed to read from local storage (${asset.storage_url}):`, error);
            throw error;
        }
    }
    throw new Error(`Asset ${asset.id} has no storage location (missing bucket/object_path and storage_url)`);
}
// In-memory job queue (simple implementation)
const jobQueue = [];
let isProcessing = false;
/**
 * Enqueue a job for processing
 */
export async function enqueueJob(jobId) {
    if (!jobQueue.includes(jobId)) {
        jobQueue.push(jobId);
    }
    // Start processing if not already running
    if (!isProcessing) {
        processJobQueue().catch(err => {
            console.error('Job queue processing error:', err);
            isProcessing = false;
        });
    }
}
/**
 * Process jobs from the queue
 */
async function processJobQueue() {
    if (isProcessing)
        return;
    isProcessing = true;
    while (jobQueue.length > 0) {
        const jobId = jobQueue.shift();
        if (!jobId)
            break;
        try {
            await processJob(jobId);
        }
        catch (error) {
            console.error(`Error processing job ${jobId}:`, error);
            await updateJobStatus(jobId, 'FAILED', {
                code: 'PROCESSING_ERROR',
                message: error.message || 'Unknown error',
            });
        }
    }
    isProcessing = false;
}
/**
 * Process a single job
 */
async function processJob(jobId) {
    if (!supabaseAdmin) {
        throw new Error('Database not configured');
    }
    // Get job
    const { data: job, error: jobError } = await supabaseAdmin
        .from('ingestion_jobs')
        .select('*')
        .eq('id', jobId)
        .single();
    if (jobError || !job) {
        throw new Error('Job not found');
    }
    // Skip if job is not in a processing state (READY jobs must be started via /start endpoint)
    if (job.status === 'READY' || job.status === 'UPLOADED') {
        console.log(`[Worker] Skipping job ${jobId} - status is ${job.status}, waiting for /start`);
        return;
    }
    // Get assets for this job (use asset_id fields from ingestion_jobs)
    let audioAsset = null;
    let transcriptAsset = null;
    if (job.audio_asset_id) {
        const { data: audio, error: audioError } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', job.audio_asset_id)
            .single();
        if (audioError) {
            console.error(`[Worker] Failed to fetch audio asset ${job.audio_asset_id}:`, audioError);
        }
        else {
            audioAsset = audio;
        }
    }
    if (job.transcript_asset_id) {
        const { data: transcript, error: transcriptError } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('id', job.transcript_asset_id)
            .single();
        if (transcriptError) {
            console.error(`[Worker] Failed to fetch transcript asset ${job.transcript_asset_id}:`, transcriptError);
        }
        else {
            transcriptAsset = transcript;
        }
    }
    // Fallback: also check legacy job_id-based assets for backward compatibility
    if (!audioAsset || !transcriptAsset) {
        const { data: assets, error: assetsError } = await supabaseAdmin
            .from('assets')
            .select('*')
            .eq('job_id', jobId)
            .order('created_at', { ascending: true });
        if (!assetsError && assets) {
            if (!audioAsset) {
                audioAsset = assets.find((a) => a.kind === 'audio' || a.type === 'AUDIO');
            }
            if (!transcriptAsset) {
                transcriptAsset = assets.find((a) => a.kind === 'transcript' || a.type === 'TRANSCRIPT_UPLOADED');
            }
        }
    }
    // Process based on mode and status
    if (job.mode === 'TRANSCRIPT_ONLY') {
        if (!transcriptAsset) {
            throw new Error('Transcript asset required for TRANSCRIPT_ONLY mode');
        }
        await processTranscriptOnly(job, transcriptAsset);
    }
    else if (job.mode === 'AUDIO_ONLY') {
        if (!audioAsset) {
            throw new Error('Audio asset required for AUDIO_ONLY mode');
        }
        if (job.status === 'TRANSCRIBING') {
            await processAudioOnly(job, audioAsset);
        }
        else {
            throw new Error(`Invalid status ${job.status} for AUDIO_ONLY mode`);
        }
    }
    else if (job.mode === 'AUDIO_PLUS_TRANSCRIPT') {
        if (!transcriptAsset) {
            throw new Error('Transcript asset required for AUDIO_PLUS_TRANSCRIPT mode');
        }
        await processAudioPlusTranscript(job, audioAsset, transcriptAsset);
    }
}
/**
 * Process TRANSCRIPT_ONLY mode
 */
async function processTranscriptOnly(job, transcriptAsset) {
    // Read and normalize transcript
    const transcriptBuffer = await readAssetContent(transcriptAsset);
    const normalized = await normalizeTranscriptBuffer(transcriptBuffer, transcriptAsset.metadata_json?.filename || 'transcript.txt');
    // Update progress
    await updateJobProgress(job.id, 'ANALYZING', 30);
    // Build speakerRoleMap from transcript
    const normalizedTurns = normalizeTranscript(normalized.text);
    const turns = normalizedTurns.map(t => ({
        speaker: t.speakerLabelRaw,
        text: t.text
    }));
    const speakerRoleMap = buildSpeakerRoleMap(turns);
    // Create conversation
    const conversationId = await createConversation(job.org_id, job.project_id, job.env, normalized.text, job.created_by_user_id, job.representative_id, speakerRoleMap);
    // Get conversation-level evidence items (attached to this job/conversation)
    let conversationEvidenceIds = [];
    try {
        const { data: evidenceItems } = await supabaseAdmin
            .from('evidence_items')
            .select('id')
            .eq('org_id', job.org_id)
            .eq('conversation_id', job.id) // Evidence attached to this job
            .eq('scope', 'CONVERSATION')
            .eq('status', 'APPROVED'); // Only approved evidence
        if (evidenceItems) {
            conversationEvidenceIds = evidenceItems.map(item => item.id);
        }
    }
    catch (evidenceError) {
        console.warn(`[Worker] Failed to fetch conversation evidence for job ${job.id}:`, evidenceError);
    }
    // Run analysis
    await updateJobProgress(job.id, 'ANALYZING', 50);
    // Rule 0: Build provenance for TRANSCRIPT_ONLY mode
    const provenance = {
        ingestionMode: 'TRANSCRIPT_ONLY',
        transcriptSource: 'USER_PROVIDED',
        hasAudio: false,
        alignmentAvailable: false,
        transcriptFingerprint: transcriptAsset.sha256 || transcriptAsset.content_hash,
    };
    const evaluationId = await runAnalysis({
        orgId: job.org_id,
        projectId: job.project_id,
        env: job.env,
        conversationId,
        transcript: normalized.text,
        normalizedConversation: normalized.normalizedConversation, // Pass structured turns with speaker info
        userId: job.created_by_user_id,
        verificationLevel: 'TRANSCRIPT_ONLY',
        transcriptAssetId: transcriptAsset.id,
        jobId: job.id,
        ingestionMode: 'TRANSCRIPT_ONLY',
        provenance,
        conversationEvidenceIds, // Pass conversation-level evidence
    });
    // Store normalized transcript asset
    const normalizedBuffer = Buffer.from(normalized.text, 'utf-8');
    const { data: normalizedAsset, error: assetError } = await supabaseAdmin
        .from('assets')
        .insert({
        org_id: job.org_id,
        job_id: job.id,
        type: 'TRANSCRIPT_NORMALIZED',
        storage_url: transcriptAsset.storage_url, // Reuse storage
        content_hash: transcriptAsset.content_hash,
        mime_type: 'text/plain',
        metadata_json: normalized.metadata || {},
    })
        .select('id')
        .single();
    // Update job as complete
    await updateJobStatus(job.id, 'COMPLETE', null, {
        analysisRunId: evaluationId,
        verificationReportId: null,
    });
}
/**
 * Process AUDIO_ONLY mode
 */
async function processAudioOnly(job, audioAsset) {
    // Update progress
    await updateJobProgress(job.id, 'TRANSCRIBING', 20);
    console.log(`[Worker] Starting transcription for job ${job.id}, audio size: ${audioAsset.size_bytes} bytes`);
    // Transcribe audio (with concurrency limit and timeout)
    const audioBuffer = await readAssetContent(audioAsset);
    // Add timeout to transcription (30 minutes for large files)
    const transcriptionTimeout = 30 * 60 * 1000; // 30 minutes
    const transcriptionPromise = withTranscriptionSlot(async () => {
        return await transcribeAudio(audioBuffer, audioAsset.metadata_json?.filename || 'audio.wav');
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Transcription timeout after ${transcriptionTimeout / 1000 / 60} minutes`)), transcriptionTimeout));
    let transcriptionResult;
    try {
        transcriptionResult = await Promise.race([transcriptionPromise, timeoutPromise]);
        console.log(`[Worker] Transcription completed for job ${job.id}`);
    }
    catch (error) {
        console.error(`[Worker] Transcription failed for job ${job.id}:`, error.message);
        throw error;
    }
    // Store ASR transcript asset
    const transcriptText = transcriptionResult.transcript || transcriptionResult.text || '';
    const transcriptBuffer = Buffer.from(transcriptText, 'utf-8');
    const { data: asrAsset, error: asrError } = await supabaseAdmin
        .from('assets')
        .insert({
        org_id: job.org_id,
        job_id: job.id,
        type: 'TRANSCRIPT_ASR',
        storage_url: audioAsset.storage_url.replace(/\.(wav|mp3|m4a)$/, '.txt'), // Placeholder
        content_hash: require('crypto').createHash('sha256').update(transcriptBuffer).digest('hex'),
        mime_type: 'text/plain',
        metadata_json: {
            language: transcriptionResult.language,
            durationMs: transcriptionResult.durationMs,
            vadStats: transcriptionResult.vadStats,
        },
    })
        .select('id')
        .single();
    if (asrError) {
        throw new Error(`Failed to store ASR transcript: ${asrError.message}`);
    }
    // Update progress
    await updateJobProgress(job.id, 'ANALYZING', 60);
    // Build speakerRoleMap from transcript
    const normalizedTurns = normalizeTranscript(transcriptText);
    const turns = normalizedTurns.map(t => ({
        speaker: t.speakerLabelRaw,
        text: t.text
    }));
    const speakerRoleMap = buildSpeakerRoleMap(turns);
    // Create conversation
    const conversationId = await createConversation(job.org_id, job.project_id, job.env, transcriptText, job.created_by_user_id, job.representative_id, speakerRoleMap);
    // Rule 0: Build provenance for AUDIO_ONLY_TRANSCRIBED mode
    const provenance = {
        ingestionMode: 'AUDIO_ONLY_TRANSCRIBED',
        transcriptSource: 'AUTO_TRANSCRIBED',
        hasAudio: true,
        audioFingerprint: audioAsset.sha256 || audioAsset.content_hash,
        transcriptFingerprint: asrAsset.content_hash,
        alignmentAvailable: transcriptionResult.segments && transcriptionResult.segments.length > 0,
    };
    // Rule 2: Build transcript quality from ASR results
    const transcriptQuality = {
        asrConfidence01: transcriptionResult.confidence ? Math.min(1.0, Math.max(0.0, transcriptionResult.confidence)) : undefined,
        diarizationConfidence01: transcriptionResult.diarizationConfidence ? Math.min(1.0, Math.max(0.0, transcriptionResult.diarizationConfidence)) : undefined,
        alignmentCoverage01: provenance.alignmentAvailable ? 1.0 : 0.0,
        noisyAudioFlag: transcriptionResult.vadStats?.noiseRatio && transcriptionResult.vadStats.noiseRatio > 0.3,
    };
    // Get conversation-level evidence items (attached to this job/conversation)
    let conversationEvidenceIds = [];
    try {
        const { data: evidenceItems } = await supabaseAdmin
            .from('evidence_items')
            .select('id')
            .eq('org_id', job.org_id)
            .eq('conversation_id', job.id) // Evidence attached to this job
            .eq('scope', 'CONVERSATION')
            .eq('status', 'APPROVED'); // Only approved evidence
        if (evidenceItems) {
            conversationEvidenceIds = evidenceItems.map(item => item.id);
        }
    }
    catch (evidenceError) {
        console.warn(`[Worker] Failed to fetch conversation evidence for job ${job.id}:`, evidenceError);
    }
    // Run analysis
    const evaluationId = await runAnalysis({
        orgId: job.org_id,
        projectId: job.project_id,
        env: job.env,
        conversationId,
        transcript: transcriptText,
        userId: job.created_by_user_id,
        verificationLevel: 'TRANSCRIPT_ONLY', // Still transcript-only, but with provenance
        transcriptAssetId: asrAsset.id,
        jobId: job.id,
        ingestionMode: 'AUDIO_ONLY_TRANSCRIBED',
        provenance: {
            ...provenance,
            transcriptQuality,
        },
        conversationEvidenceIds, // Pass conversation-level evidence
    });
    // Update job as complete
    await updateJobStatus(job.id, 'COMPLETE', null, {
        analysisRunId: evaluationId,
        verificationReportId: null,
    });
}
/**
 * Process AUDIO_PLUS_TRANSCRIPT mode
 */
async function processAudioPlusTranscript(job, audioAsset, transcriptAsset) {
    // Step 1: Analyze uploaded transcript immediately
    await updateJobProgress(job.id, 'ANALYZING', 20);
    const transcriptBuffer = await readAssetContent(transcriptAsset);
    const normalized = await normalizeTranscriptBuffer(transcriptBuffer, transcriptAsset.metadata_json?.filename || 'transcript.txt');
    // Build speakerRoleMap from transcript
    const normalizedTurns = normalizeTranscript(normalized.text);
    const turns = normalizedTurns.map(t => ({
        speaker: t.speakerLabelRaw,
        text: t.text
    }));
    const speakerRoleMap = buildSpeakerRoleMap(turns);
    // Create conversation
    const conversationId = await createConversation(job.org_id, job.project_id, job.env, normalized.text, job.created_by_user_id, job.representative_id, speakerRoleMap);
    // Get conversation-level evidence items (attached to this job/conversation)
    let conversationEvidenceIds = [];
    try {
        const { data: evidenceItems } = await supabaseAdmin
            .from('evidence_items')
            .select('id')
            .eq('org_id', job.org_id)
            .eq('conversation_id', job.id) // Evidence attached to this job
            .eq('scope', 'CONVERSATION')
            .eq('status', 'APPROVED'); // Only approved evidence
        if (evidenceItems) {
            conversationEvidenceIds = evidenceItems.map(item => item.id);
        }
    }
    catch (evidenceError) {
        console.warn(`[Worker] Failed to fetch conversation evidence for job ${job.id}:`, evidenceError);
    }
    // Rule 0: Build provenance for AUDIO_AND_TRANSCRIPT mode
    const provenance = {
        ingestionMode: 'AUDIO_AND_TRANSCRIPT',
        transcriptSource: 'USER_PROVIDED', // User provided transcript, audio is for verification
        hasAudio: true,
        audioFingerprint: audioAsset?.sha256 || audioAsset?.content_hash,
        transcriptFingerprint: transcriptAsset.sha256 || transcriptAsset.content_hash,
        alignmentAvailable: false, // Will be set after audio transcription if available
    };
    // Run analysis on uploaded transcript
    const evaluationId = await runAnalysis({
        orgId: job.org_id,
        projectId: job.project_id,
        env: job.env,
        conversationId,
        transcript: normalized.text,
        normalizedConversation: normalized.normalizedConversation, // Pass structured turns with speaker info
        userId: job.created_by_user_id,
        verificationLevel: 'TRANSCRIPT_ONLY', // Analysis uses transcript, audio is for verification
        transcriptAssetId: transcriptAsset.id,
        jobId: job.id,
        ingestionMode: 'AUDIO_AND_TRANSCRIPT',
        provenance,
        conversationEvidenceIds, // Pass conversation-level evidence
    });
    // Step 2: Transcribe audio in background (optional - don't block on failure)
    // Evaluation is already complete, so audio transcription/verification is optional
    let verificationReportId = null;
    if (audioAsset) {
        try {
            await updateJobProgress(job.id, 'VERIFYING', 50);
            const audioBuffer = await readAssetContent(audioAsset);
            const transcriptionResult = await withTranscriptionSlot(async () => {
                return await transcribeAudio(audioBuffer, audioAsset.metadata_json?.filename || 'audio.wav');
            });
            // Store ASR transcript
            const asrText = transcriptionResult.transcript || transcriptionResult.text || '';
            const asrBuffer = Buffer.from(asrText, 'utf-8');
            const { data: asrAssetData, error: asrError } = await supabaseAdmin
                .from('assets')
                .insert({
                org_id: job.org_id,
                job_id: job.id,
                kind: 'transcript',
                type: 'TRANSCRIPT_ASR',
                storage_url: audioAsset.storage_url?.replace(/\.(wav|mp3|m4a)$/, '.txt') || null,
                content_hash: require('crypto').createHash('sha256').update(asrBuffer).digest('hex'),
                mime_type: 'text/plain',
                metadata_json: {
                    language: transcriptionResult.language,
                    durationMs: transcriptionResult.durationMs,
                    vadStats: transcriptionResult.vadStats,
                },
            })
                .select('id')
                .single();
            if (asrError) {
                console.warn(`[Worker] Failed to store ASR transcript for job ${job.id}:`, asrError.message);
            }
            else {
                // Step 3: Compute verification diff
                await updateJobProgress(job.id, 'VERIFYING', 80);
                const verificationReport = await computeVerificationDiff(job.org_id, job.id, transcriptAsset.id, asrAssetData.id, normalized.text, asrText);
                verificationReportId = verificationReport.id;
                // Check if mismatch is beyond threshold
                const mismatchThreshold = parseFloat(process.env.VERIFY_MISMATCH_THRESHOLD || '0.20');
                if (verificationReport.summary_json.mismatchScore > mismatchThreshold) {
                    // Update evaluation with mismatch flag
                    await supabaseAdmin
                        .from('evaluations')
                        .update({ verification_level: 'MISMATCH_FLAGGED' })
                        .eq('id', evaluationId);
                }
            }
        }
        catch (audioError) {
            // Audio transcription/verification failed, but evaluation is already complete
            console.warn(`[Worker] Audio transcription/verification failed for job ${job.id}, but evaluation is complete:`, audioError.message);
        }
    }
    // Update job as complete (evaluation is already done, audio verification is optional)
    await updateJobStatus(job.id, 'COMPLETE', null, {
        analysisRunId: evaluationId,
        verificationReportId: verificationReportId,
    });
}
/**
 * Helper: Create conversation
 */
async function createConversation(orgId, projectId, env, content, userId, representativeId, speakerRoleMap) {
    const metadata = {};
    if (speakerRoleMap) {
        metadata.speakerRoleMap = speakerRoleMap;
    }
    const { data, error } = await supabaseAdmin
        .from('conversations')
        .insert({
        org_id: orgId,
        project_id: projectId,
        env,
        content,
        created_by: userId,
        representative_id: representativeId || null,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })
        .select('id')
        .single();
    if (error) {
        throw new Error(`Failed to create conversation: ${error.message}`);
    }
    return data.id;
}
/**
 * Helper: Run analysis from transcript
 * Extracts claims and runs the full analysis pipeline
 */
export async function runAnalysis(input) {
    // Use the existing validate function to run the full pipeline
    // This ensures consistency with the /validate endpoint
    const { validate } = await import('../../orchestrator.js');
    // 2.1: Fix "support edges empty" - pass docs from ingestion
    // Get org-level policies and per-conversation sources
    const orgPolicySources = [];
    const conversationSources = [];
    // Fetch active org-level policies
    if (supabaseAdmin) {
        try {
            const { data: policies } = await supabaseAdmin
                .from('policies')
                .select('id, content, name')
                .eq('org_id', input.orgId)
                .eq('status', 'active')
                .order('activated_at', { ascending: false });
            if (policies) {
                for (const policy of policies) {
                    orgPolicySources.push({
                        id: `policy-${policy.id}`,
                        text: policy.content,
                    });
                }
            }
        }
        catch (policyError) {
            console.warn(`[Worker] Failed to fetch org policies for job ${input.jobId}:`, policyError);
        }
    }
    // TODO: Fetch per-conversation attachments/documents from assets table
    // For now, conversationSources is empty, but structure is ready
    // ============================================================================
    // EVIDENCE SYSTEM: Resolve evidence set for this evaluation
    // ============================================================================
    let evidenceSet = null;
    let evidenceDiagnostics = {};
    try {
        evidenceSet = await resolveEvidenceSet(input.orgId, input.projectId, input.templateId, input.conversationId, input.simulationMode || false, input.includeOrgEvidence !== false, // Default: true
        input.includeProjectEvidence !== false, // Default: true
        input.includeTemplateEvidence !== false // Default: true
        );
        // Add conversation-level evidence IDs if provided
        if (evidenceSet && input.conversationEvidenceIds && input.conversationEvidenceIds.length > 0) {
            evidenceSet.conversationEvidenceIds = input.conversationEvidenceIds;
            // Add to resolvedEvidenceIds
            evidenceSet.resolvedEvidenceIds = [
                ...(evidenceSet.resolvedEvidenceIds || []),
                ...input.conversationEvidenceIds,
            ];
        }
        // Collect diagnostics (check for indexing failures, missing approvals, etc.)
        if (evidenceSet && supabaseAdmin) {
            try {
                // Check for evidence items with indexing failures
                const { data: failedIndexing } = await supabaseAdmin
                    .from('evidence_items')
                    .select('id, title, index_error')
                    .eq('org_id', input.orgId)
                    .eq('index_status', 'FAILED')
                    .in('id', evidenceSet.resolvedEvidenceIds || []);
                if (failedIndexing && failedIndexing.length > 0) {
                    evidenceDiagnostics.indexingFailures = failedIndexing.map(item => ({
                        evidenceItemId: item.id,
                        error: item.index_error || 'Unknown indexing error',
                    }));
                }
            }
            catch (diagError) {
                console.warn(`[Worker] Failed to collect evidence diagnostics:`, diagError);
            }
        }
    }
    catch (evidenceError) {
        console.warn(`[Worker] Failed to resolve evidence set for job ${input.jobId}:`, evidenceError);
        // Continue without evidence - evaluation can still run
        evidenceDiagnostics = {
            indexingFailures: [],
        };
    }
    const allSources = [
        ...conversationSources,
        ...orgPolicySources,
    ];
    // 3.2: Evidence mode must be derived from actual evidence presence
    const hasExternalSources = allSources.length > 0;
    const evidenceMode = hasExternalSources ? 'TRANSCRIPT_PLUS_EXTERNAL' : 'TRANSCRIPT_ONLY';
    // Get speakerRoleMap from conversation metadata if available
    let speakerRoleMap;
    if (supabaseAdmin) {
        try {
            const { data: conversation } = await supabaseAdmin
                .from('conversations')
                .select('metadata')
                .eq('id', input.conversationId)
                .single();
            if (conversation?.metadata?.speakerRoleMap) {
                speakerRoleMap = conversation.metadata.speakerRoleMap;
            }
        }
        catch (error) {
            console.warn(`[Worker] Failed to fetch conversation metadata for speakerRoleMap:`, error);
        }
    }
    const validateInput = {
        question: input.transcript,
        answer: '',
        sources: allSources,
        options: {
            conversationId: input.conversationId,
            evidenceMode, // Pass evidence mode to orchestrator
            normalizedConversation: input.normalizedConversation, // CRITICAL: Pass structured turns with speaker info
            speakerRoleMap, // Pass speaker role map to graph builder
        },
    };
    const validateOutput = await validate(validateInput);
    // The validate function does NOT create evaluations - we need to create it ourselves
    // Format scores for database (similar to /validate endpoint)
    const s = validateOutput.scores;
    const scoresForDb = {
        tcl: s.tcl ?? s.overall ?? null,
        truth: s.truth ?? null,
        transcriptGrounding: s.transcriptGrounding ?? null,
        compliance: s.compliance ?? null,
        hallucination: s.hallucination ?? null,
        drift: s.drift ?? null,
        consistency: s.consistency ?? null,
        coherence: s.coherence ?? null,
        evidenceSupport: s.evidenceSupport ?? null,
        speakerConfidence: s.speakerConfidence ?? null,
        businessValue: s.businessValue ?? null,
        overall: s.overall ?? null,
    };
    // Build proper IssueV2 objects using expandIssueCandidates and rankIssuesV2
    // This matches what the /validate endpoint does
    let allIssuesV2 = [];
    let topIssuesV2 = [];
    let issueSummaryV2 = null;
    let reportWithIssues = null;
    let evalMode = null;
    try {
        const { expandIssueCandidates } = await import('../../analysis/issue-expansion.js');
        const { rankIssuesV2 } = await import('../../analysis/risk-ranking.js');
        // Get graph data from report
        const graphData = validateOutput.report?.graph;
        const graphSupports = graphData?.supports || [];
        const graphContradictions = graphData?.contradictions || [];
        const graphGrounding = graphData?.grounding || [];
        // Map claims to format expected by expandIssueCandidates
        // CRITICAL: Preserve all speaker information (speaker, speakerType, speakerLabel) 
        // so issues can correctly identify who made the claim
        const claimsForIssues = (validateOutput.report?.claims || []).map((c) => ({
            id: c.id,
            text: c.text,
            confidence: c.confidenceMetrics?.groundingScore ?? c.confidence ?? 0,
            evidence: c.evidence || [],
            evidenceRefs: c.evidenceRefs || [],
            meta: {
                speaker: c.meta?.speaker,
                speakerType: c.meta?.speakerType,
                speakerLabel: c.meta?.speakerLabel,
                turnIndex: c.meta?.turnIndex
            },
            claimType: c.claimType,
            claimKind: c.claimKind,
            isAuditable: c.isAuditable,
            topicTags: c.topicTags || [],
            hasAbsoluteLanguage: c.hasAbsoluteLanguage || false,
            hasMoney: c.hasMoney || false
        }));
        // Determine evidence mode based on verification level
        const evidenceMode = input.verificationLevel === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' : 'TRANSCRIPT_PLUS_EXTERNAL';
        // Expand issues from graph (creates proper IssueV2 format)
        const expansionResult = expandIssueCandidates({
            claims: claimsForIssues,
            contradictions: graphContradictions,
            supports: graphSupports,
            grounding: graphGrounding,
            runId: 'pending', // Will be updated after evaluation is created
            conversationId: input.conversationId,
            evidenceMode,
            audit: {
                engineVersion: validateOutput.engineVersion || process.env.ENGINE_VERSION || '0.2.0',
                scorerId: validateOutput.scorerId || 'unified-graph-v1',
                modelFingerprint: validateOutput.report?.manifest?.modelFingerprint,
                configHash: validateOutput.report?.manifest?.configHash,
                inputHash: validateOutput.report?.manifest?.inputHash,
            },
        });
        // D: Detect compliance issues (PCI, recording consent, PII)
        const { detectComplianceIssues } = await import('../../analysis/compliance-detectors.js');
        const complianceResult = detectComplianceIssues(claimsForIssues, 'pending', input.conversationId, evidenceMode);
        // Combine graph issues with compliance issues AND the new moat detectors
        // (final-expense, hallucination, drift, cross-turn, domain packs) which are
        // produced inside the orchestrator's runUnifiedGraphPath and surfaced via
        // report.allIssuesV2.
        const orchestratorDetectorIssues = validateOutput.report?.allIssuesV2 ?? [];
        const allAtomicIssues = [
            ...expansionResult.allIssues,
            ...complianceResult.issues,
            ...orchestratorDetectorIssues,
        ];
        // Rank issues (deterministic) with scoring context
        const scoringContext = {
            mode: (evidenceMode === 'TRANSCRIPT_ONLY' ? 'transcript_only' : 'with_evidence'),
            numSources: 0, // No external sources for ingestion jobs
            graphStatus: graphData?.debug?.graphStatus,
            templateId: validateOutput.report?.manifest?.templateId,
            isRegulatedTemplate: false,
        };
        const rankedResult = rankIssuesV2(allAtomicIssues, undefined, scoringContext);
        // C2-C3: Aggregate issues into clusters
        // Use collapseIssuesToClusters which returns GroupedIssue[] with rollup structure
        const { collapseIssuesToClusters } = await import('../../analysis/issue-cluster-collapse.js');
        const groupedIssues = collapseIssuesToClusters(rankedResult.allIssues);
        allIssuesV2 = rankedResult.allIssues;
        // Use grouped issues for topIssuesV2 (they have the rollup structure the UI expects)
        topIssuesV2 = groupedIssues.slice(0, 10); // Top 10 grouped issues
        issueSummaryV2 = rankedResult.summary;
        // C4: Keep all grouped issues for the report
        const allGroupedIssues = groupedIssues;
        // Set evalMode for report
        const evalMode = {
            verificationLevel: evidenceMode === 'TRANSCRIPT_ONLY' ? 'TRANSCRIPT_ONLY' :
                'DOC_BACKED',
            hasExternalEvidence: evidenceMode === 'TRANSCRIPT_PLUS_EXTERNAL',
            evidenceCoverage01: 0, // TODO: compute from actual evidence coverage
            transcriptOnlyReasonCodes: evidenceMode === 'TRANSCRIPT_ONLY' ? ['NO_EXTERNAL_EVIDENCE'] : [],
        };
        // Build report with issues (similar to /validate endpoint)
        // CRITICAL: Use canonical structure with issues.atomic and issues.grouped
        reportWithIssues = {
            ...validateOutput.report,
            // Canonical structure: issues.atomic and issues.grouped
            issues: {
                atomic: allIssuesV2,
                grouped: allGroupedIssues, // Grouped/clustered issues with rollup structure for UI
            },
            // Legacy fields for backwards compatibility
            allIssuesV2,
            topIssuesV2, // Top grouped issues (has rollup structure)
            issueSummaryV2,
            // Carry the moat-pipeline outputs through to persistence
            crossTurn: validateOutput.report?.crossTurn,
            drift: validateOutput.report?.drift,
            domainPacksApplied: validateOutput.report?.domainPacksApplied,
            executiveSummary: validateOutput?.executiveSummary,
            diagnostics: validateOutput?.diagnostics,
            risk: validateOutput?.risk,
            productContext: validateOutput?.productContext,
            dashboardSummary: validateOutput?.dashboardSummary,
            claimsAnalysis: validateOutput?.claimsAnalysis,
            evidenceDependencyGraph: validateOutput?.evidenceDependencyGraph,
            issuesBySeverity: validateOutput?.issuesBySeverity,
            businessInsights: validateOutput?.businessInsights,
            recommendedActions: validateOutput?.recommendedActions,
            enhancedClientScores: validateOutput?.scores,
            enhancedScores: validateOutput?.enhancedScores,
            // A1: Add EvalMode to report
            evalMode,
            // Rule 0: Add provenance to report
            provenance: input.provenance || {
                ingestionMode: input.ingestionMode || 'TRANSCRIPT_ONLY',
                transcriptSource: 'UNKNOWN',
                hasAudio: false,
                alignmentAvailable: false,
            },
        };
    }
    catch (issueError) {
        console.error(`[Worker] Failed to expand/rank issues, using fallback:`, issueError);
        // Fallback: use destructiveClaims if expansion fails
        allIssuesV2 = validateOutput.report?.destructiveClaims || [];
        topIssuesV2 = (validateOutput.report?.destructiveClaims || []).slice(0, 10);
        // Build report with fallback issues
        reportWithIssues = {
            ...validateOutput.report,
            allIssuesV2,
            topIssuesV2,
            issueSummaryV2: null,
        };
    }
    // Get representative_id from conversation
    let representativeId = null;
    if (input.conversationId && supabaseAdmin) {
        try {
            const { data: conversation } = await supabaseAdmin
                .from('conversations')
                .select('representative_id')
                .eq('id', input.conversationId)
                .single();
            if (conversation?.representative_id) {
                representativeId = conversation.representative_id;
            }
        }
        catch (error) {
            console.warn(`[Worker] Failed to fetch conversation representative_id:`, error);
        }
    }
    // Create the evaluation in the database
    const { data: insertedEvaluation, error: dbError } = await supabaseAdmin
        .from('evaluations')
        .insert({
        org_id: input.orgId,
        project_id: input.projectId || null,
        conversation_id: input.conversationId || null,
        representative_id: representativeId,
        env: input.env,
        scores: scoresForDb,
        refusal: validateOutput.refusal || false,
        scorer_id: validateOutput.scorerId || null,
        engine_version: process.env.ENGINE_VERSION || '0.2.0',
        latency_ms: validateOutput.latency || 0,
        report: reportWithIssues || {
            ...validateOutput.report,
            allIssuesV2: allIssuesV2 || [],
            topIssuesV2: topIssuesV2 || [],
            issueSummaryV2: issueSummaryV2 || null,
        },
        job_id: input.jobId,
        transcript_asset_id: input.transcriptAssetId,
        verification_level: input.verificationLevel,
        // Evidence system fields
        template_id: input.templateId || null,
        simulation_mode: input.simulationMode || false,
        evidence_set: evidenceSet || {
            orgEvidenceIds: [],
            projectEvidenceIds: [],
            conversationEvidenceIds: [],
            templateEvidenceIds: [],
            resolvedEvidenceIds: [],
        },
        evidence_diagnostics: evidenceDiagnostics,
    })
        .select('id')
        .single();
    if (dbError) {
        throw new Error(`Failed to create evaluation: ${dbError.message}`);
    }
    if (!insertedEvaluation) {
        throw new Error(`Failed to create evaluation: no ID returned`);
    }
    // Update runId in allIssuesV2 and topIssuesV2 if they exist (similar to /validate endpoint)
    if (insertedEvaluation.id && (allIssuesV2.length > 0 || topIssuesV2.length > 0)) {
        const { createHash } = await import('crypto');
        const updateRunId = (issue) => {
            if (issue && issue.runId === 'pending') {
                issue.runId = insertedEvaluation.id;
                // Regenerate issueId with correct runId
                const hash = createHash('sha256')
                    .update(`${insertedEvaluation.id}:${issue.issueKey}`)
                    .digest('hex')
                    .substring(0, 16);
                issue.issueId = `issue_${hash}`;
            }
            return issue;
        };
        allIssuesV2 = allIssuesV2.map(updateRunId);
        topIssuesV2 = topIssuesV2.map(updateRunId);
        // Update the report in the database with the corrected runIds
        const updatedReport = {
            ...(reportWithIssues || {}),
            allIssuesV2,
            topIssuesV2,
        };
        await supabaseAdmin
            .from('evaluations')
            .update({ report: updatedReport })
            .eq('id', insertedEvaluation.id);
    }
    return insertedEvaluation.id;
}
/**
 * Helper: Update job progress
 */
async function updateJobProgress(jobId, stage, pct) {
    await supabaseAdmin
        .from('ingestion_jobs')
        .update({
        progress_json: { stage, pct },
    })
        .eq('id', jobId);
}
/**
 * Helper: Update job status
 */
async function updateJobStatus(jobId, status, error, result) {
    const update = {
        status,
        progress_json: { stage: status, pct: 100 },
    };
    if (error) {
        update.error_code = error.code;
        update.error_message = error.message;
    }
    if (result) {
        update.result_json = result;
    }
    await supabaseAdmin
        .from('ingestion_jobs')
        .update(update)
        .eq('id', jobId);
}
