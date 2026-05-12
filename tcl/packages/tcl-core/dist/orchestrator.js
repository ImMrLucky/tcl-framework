import { extractClaims, extractClaimsWithTypes, classifyClaimType, isAuditableClaimType, extractTopics, hasAbsoluteLanguage, hasMoney } from "./claim_extractor.js";
import { attachEvidenceAndFindViolations } from "./evidence.js";
import { findLogicViolations } from "./logic.js";
import { blendScores, assessRunQuality } from "./scoring.js";
import { collectFailingClaimIds, repairOnce } from "./repair.js";
import { buildClaimGraph, HttpNliScorer, TokenHeuristicScorer } from "./graph/edge_builder.js";
import { TransformersNliScorer } from "./graph/transformers_scorer.js";
import { SpectralNliScorer } from "./graph/spectral_nli_scorer.js";
import { calculateAllClaimConfidences } from "./confidence.js";
import { generateSuggestions } from "./suggestions.js";
import { validateCustomRules } from "./custom_rules.js";
import { computeDestructiveClaims } from "./destructive.js";
import { computeTrajectory } from "./trajectory.js";
import { generateSourcesFromRawTranscript, retrieveEvidenceForClaims } from "./evidence_sources.js";
import { startPipelineTimer } from "./pipeline_timer.js";
// NEW: Deterministic Truth Engine (replaces NLI)
import { runTruthEngine, toLegacyGraph, buildIssuesFromGraph } from "./engine/index.js";
import { generateReproducibilityMetadata, getEngineVersion } from "./analysis/reproducibility.js";
import { computeTruthFromGraph } from "./analysis/compute-truth-from-graph.js";
import { getEngineConfig } from "./config/engine-config.js";
import { log } from "./server/utils/logger.js";
import { mapSpeakerToRole, speakerRoleToDisplay } from "./ingestion/speaker-role.js";
import { countSpeakerLabelsInClaim, isContaminatedClaimText, sanitizeTranscriptForScoring } from "./ingestion/transcript-sanitizer.js";
import { detectFinalExpenseComplianceIssues } from "./analysis/domain/final-expense-detectors.js";
import { detectHallucinations } from "./analysis/hallucination-detector.js";
import { evaluateFactualTruth } from "./analysis/factual-truth-detector.js";
import { detectDrift } from "./analysis/drift-detector.js";
import { computeRiskAdjustedScores } from "./analysis/risk-adjusted-scoring.js";
import { runCrossTurnConsistency } from "./analysis/cross-turn-consistency.js";
import { selectDomainPacks, runDomainPacks } from "./domain-packs/registry.js";
import { buildExecutiveSummary } from "./analysis/executive-summary.js";
import { mineBusinessInsights } from "./analysis/business-value-mining.js";
import { buildEvidenceDependencyGraph, averageEvidenceSupportScore, evidenceGapCount } from "./analysis/evidence-dependency-graph.js";
import { detectAiConversationIssues } from "./analysis/ai-conversation-detectors.js";
import { buildDashboardSummary } from "./analysis/dashboard-summary-builder.js";
// NEW: Unified Graph Builder (3-stage pipeline with subject slots)
import { buildGraph as buildUnifiedGraph, buildGraphAsync as buildUnifiedGraphAsync, toSpectralInput, setTemplateConfig } from "./graph/graph-builder.js";
import { getTemplateConfig } from "./graph/template-config.js";
import { getIndustryTemplate } from "./templates/template-registry.js";
import { resolveGraphTemplateId } from "./templates/graph-template-resolve.js";
import { buildAnalysisResultPayload } from "./scoring/analysis-result-builder.js";
// Cache for scorer to avoid re-initialization on every request
let cachedScorer = null;
const SCORER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
function getGraphBuilderMode() {
    const envMode = process.env.TCL_GRAPH_BUILDER?.toLowerCase();
    // Explicit mode selection
    if (envMode === "legacy")
        return "legacy";
    if (envMode === "truth-engine" || envMode === "truth_engine")
        return "truth-engine";
    if (envMode === "unified")
        return "unified";
    // Legacy environment variables for backward compatibility
    if (process.env.TCL_USE_TRUTH_ENGINE === "true")
        return "truth-engine";
    if (process.env.TCL_USE_LEGACY_GRAPH === "true")
        return "legacy";
    // DEFAULT: Unified Graph Builder (produces best edges for spectral)
    return "unified";
}
const GRAPH_BUILDER_MODE = getGraphBuilderMode();
console.log(`📊 Graph Builder Mode: ${GRAPH_BUILDER_MODE}`);
async function callSpectralService(spectralServiceUrl, claims, supports, contradictions, groundedClaimIds) {
    const url = `${spectralServiceUrl.replace(/\/$/, "")}/spectral/score`;
    log('debug', 'Orchestrator', `Spectral request URL: ${url}`);
    log('debug', 'Orchestrator', `Spectral request payload`, {
        claimsCount: claims.length,
        supportsCount: supports.length,
        contradictionsCount: contradictions.length,
        groundedCount: groundedClaimIds.length
    });
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claims, supports, contradictions, grounded: groundedClaimIds })
    });
    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        log('error', 'Orchestrator', `Spectral service HTTP error ${res.status}: ${errorText}`);
        throw new Error(`Spectral service error: ${res.status} - ${errorText}`);
    }
    const result = await res.json();
    log('debug', 'Orchestrator', `Spectral response received`, { coherence: result?.coherenceScore });
    return result;
}
async function callSpectralAnalyzeService(spectralServiceUrl, claims, supports, contradictions, groundedClaimIds, options) {
    const url = `${spectralServiceUrl.replace(/\/$/, "")}/spectral/analyze`;
    log('debug', 'Orchestrator', `Spectral analyze request URL: ${url}`);
    const payload = {
        claims,
        supports,
        contradictions,
        grounded: groundedClaimIds,
        w_support: options?.wSupport,
        w_contradiction: options?.wContradiction,
        w_circularity: options?.wCircularity,
        cycle_max_len: options?.cycleMaxLen
    };
    log('debug', 'Orchestrator', `Spectral analyze request payload`, {
        claimsCount: claims.length,
        supportsCount: supports.length,
        contradictionsCount: contradictions.length,
        groundedCount: groundedClaimIds.length
    });
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        log('error', 'Orchestrator', `Spectral analyze service HTTP error ${res.status}: ${errorText}`);
        throw new Error(`Spectral analyze service error: ${res.status} - ${errorText}`);
    }
    const result = await res.json();
    log('debug', 'Orchestrator', `Spectral analyze response received`, {
        coherenceScore: result.coherenceScore,
        truthVectorLength: result.truthVector?.length || 0,
        truthStatesLength: result.truthStates?.length || 0,
        nodeBlameNormLength: result.nodeBlameNorm?.length || 0,
        topBadContradictions: result.topBadContradictions?.length || 0,
        topBadSupports: result.topBadSupports?.length || 0
    });
    return result;
}
// =============================================================================
// UNIFIED GRAPH PATH (DEFAULT - Best for spectral.py)
// =============================================================================
// Uses the 3-stage pipeline with Subject Slots:
// 1. Candidate Generation (per-claim budgets)
// 2. Edge Classification (slot-first gating)
// 3. Weight Calibration
// =============================================================================
async function runUnifiedGraphPath(input, timer, validationStartTime, adapter) {
    const { question, answer, sources: externalSources, options } = input;
    timer.start('unified_graph');
    console.log("🏗️ Using Unified Graph Builder (slot-first edges)");
    // Determine the transcript
    const rawTranscript = answer && answer.trim().length > 0 ? answer : question;
    const sanitizerResult = sanitizeTranscriptForScoring(rawTranscript);
    const transcript = sanitizerResult.text || rawTranscript;
    const industryTemplateId = options?.analysisTemplateId ??
        options?.industryTemplateId ??
        "general_conversation_integrity";
    const industry = getIndustryTemplate(industryTemplateId);
    const graphTemplateIdResolved = resolveGraphTemplateId({
        industry,
        rawTemplateOption: options?.template,
        detectFromTranscript: () => detectTemplate(transcript),
    });
    const templateId = graphTemplateIdResolved;
    setTemplateConfig(templateId);
    log("debug", "Orchestrator", `Industry: ${industryTemplateId}, graph template: ${templateId}`);
    // Extract claims - use normalized turns if available (preserves speaker info), otherwise fall back to text parsing
    timer.start('claim_extraction');
    let extractedClaims = [];
    const normalizedConversation = options?.normalizedConversation;
    if (normalizedConversation?.turns && Array.isArray(normalizedConversation.turns) && normalizedConversation.turns.length > 0) {
        // CRITICAL: Use normalized turns directly - they have proper speaker information
        log('debug', 'Orchestrator', `Using normalized turns (${normalizedConversation.turns.length} turns) with speaker info`);
        // Extract claims from normalized turns, preserving speaker information
        let claimIdx = 1;
        for (const turn of normalizedConversation.turns) {
            if (!turn.text || turn.text.trim().length < 8)
                continue;
            // Get participant info for speaker attribution
            const participant = normalizedConversation.participants?.find((p) => p.id === turn.participantId || p.participantId === turn.participantId);
            let speakerRole = turn.role || turn.speakerType || participant?.role || participant?.speakerType || 'unknown';
            const speakerLabel = turn.speakerLabel || turn.speakerLabelRaw || participant?.displayName || turn.meta?.rawSpeaker;
            const rawSpeaker = turn.meta?.rawSpeaker || speakerLabel;
            if ((speakerRole === 'unknown' || !speakerRole) && speakerLabel) {
                speakerRole = mapSpeakerToRole(speakerLabel).role;
            }
            // Map role to speaker string format
            const normalizedRole = typeof speakerRole === 'string' ? speakerRole.toLowerCase() : 'unknown';
            const speaker = speakerRoleToDisplay(normalizedRole === 'agent' || normalizedRole === 'customer' || normalizedRole === 'supervisor' || normalizedRole === 'bot' || normalizedRole === 'system'
                ? normalizedRole
                : normalizedRole === 'caller'
                    ? 'customer'
                    : 'unknown');
            const sentences = turn.text
                .replace(/\s+/g, ' ')
                .split(/(?<=[.!?])\s+/)
                .map((s) => s.trim())
                .filter((s) => s.length >= 8);
            for (const sentence of sentences) {
                if (isContaminatedClaimText(sentence) || countSpeakerLabelsInClaim(sentence) > 0)
                    continue;
                const claimType = classifyClaimType(sentence, speaker);
                const isAuditable = isAuditableClaimType(claimType);
                if (isAuditable) {
                    extractedClaims.push({
                        id: `c${claimIdx++}`,
                        text: sentence,
                        confidence: 0, // Will be computed from graph
                        evidence: [],
                        meta: {
                            speaker,
                            speakerType: speakerRole === 'agent' || speakerRole === 'customer' || speakerRole === 'supervisor' || speakerRole === 'bot' || speakerRole === 'system' ? speakerRole : 'unknown',
                            speakerLabel,
                            rawSpeaker,
                            turnIndex: turn.turnIndex,
                            participantId: turn.participantId,
                        },
                        claimType,
                        isAuditable: true,
                        topicTags: extractTopics(sentence),
                        hasAbsoluteLanguage: hasAbsoluteLanguage(sentence),
                        hasMoney: hasMoney(sentence),
                    });
                }
            }
        }
        log('debug', 'Orchestrator', `Extracted ${extractedClaims.length} claims from normalized turns`);
    }
    else {
        // Fallback: parse from plain text (loses speaker info)
        const isCallTranscript = transcript.includes('Agent:') || transcript.includes('Customer:') ||
            transcript.includes('AGENT:') || transcript.includes('CUSTOMER:');
        const extractResult = extractClaimsWithTypes(transcript);
        extractedClaims = extractResult.claims;
        log('debug', 'Orchestrator', `Extracted ${extractedClaims.length} claims from plain text (no normalized turns available)`);
    }
    timer.end('claim_extraction');
    if (extractedClaims.length === 0) {
        log('warn', 'Orchestrator', 'No claims extracted, returning empty result');
        timer.end('unified_graph');
        return createEmptyResult(input, timer, validationStartTime);
    }
    const contaminatedClaims = extractedClaims.filter(c => isContaminatedClaimText(c.text) || countSpeakerLabelsInClaim(c.text) > 0).length;
    extractedClaims = extractedClaims.filter(c => !isContaminatedClaimText(c.text) && countSpeakerLabelsInClaim(c.text) === 0);
    // Convert to raw claims format for graph builder
    const rawClaims = extractedClaims.map((c, i) => ({
        id: c.id || `c${i}`,
        text: c.text,
        speakerRole: c.meta?.speakerType === 'agent' || c.meta?.speakerType === 'supervisor' ? 'agent' :
            c.meta?.speakerType === 'customer' ? 'customer' :
                c.meta?.speakerType === 'bot' || c.meta?.speakerType === 'system' ? 'system' :
                    normalizeSpeaker(c.meta?.speaker),
        span: {
            turnId: `turn-${c.meta?.turnIndex ?? i}`,
            startChar: 0,
            endChar: c.text.length
        },
        modality: undefined, // Will be detected by graph builder
        meta: c.meta, // CRITICAL: Preserve all meta including speakerType and speakerLabel
    }));
    const claimTypeLookup = new Map();
    for (const ec of extractedClaims) {
        if (ec.id)
            claimTypeLookup.set(ec.id, ec.claimType);
    }
    // Build the unified graph
    // CRITICAL: Pass transcript so graph-builder can create transcript EvidenceNodes for grounding
    // Use spaCy-enhanced extraction if available (better entity quality → better edges)
    timer.start('graph_build');
    const useSpacy = process.env.ENABLE_SPACY !== 'false' && process.env.TCL_NLP_URL;
    const speakerRoleMap = options?.speakerRoleMap;
    const graphResult = useSpacy
        ? await buildUnifiedGraphAsync({
            transcript, // ✅ Required for grounding edges
            rawClaims,
            evidence: externalSources?.map(s => ({
                id: s.id,
                kind: 'document',
                content: s.text,
            })),
            template: templateId,
            conversationId: options?.conversationId,
            speakerRoleMap, // Pass speaker role map to graph builder
        })
        : buildUnifiedGraph({
            transcript, // ✅ Required for grounding edges
            rawClaims,
            evidence: externalSources?.map(s => ({
                id: s.id,
                kind: 'document',
                content: s.text,
            })),
            template: templateId,
            conversationId: options?.conversationId,
            speakerRoleMap, // Pass speaker role map to graph builder
        });
    timer.end('graph_build');
    if (useSpacy) {
        log('debug', 'Orchestrator', 'Graph built with spaCy-enhanced entities');
    }
    log('debug', 'Orchestrator', `Graph built`, {
        totalEdges: graphResult.metrics.totalEdges,
        duration: timer.duration('graph_build'),
        status: graphResult.graph.diagnostics.status,
        reasons: graphResult.graph.diagnostics.reasons
    });
    // Build grounding lookup: claimId -> grounding edges
    const groundingByClaimId = new Map();
    for (const g of graphResult.legacy.grounding) {
        const existing = groundingByClaimId.get(g.claimId) || [];
        existing.push(g);
        groundingByClaimId.set(g.claimId, existing);
    }
    // Convert claims to the expected Claim type WITH evidenceRefs from grounding
    const claims = graphResult.graph.nodes.claims.map(c => {
        const claimGrounding = groundingByClaimId.get(c.id) || [];
        // Build evidenceRefs from grounding edges
        const evidenceRefs = claimGrounding.map(g => {
            // Find the evidence node to get the quote and anchor
            const evidenceNode = graphResult.graph.nodes.evidence.find(e => e.id === g.sourceId);
            // Extract turn index from evidence node anchor (not from sourceId)
            // Anchor ref format: "turn-12" (correct)
            // SourceId format: "e-transcript-12" (for lookup only)
            let turnIndex;
            if (evidenceNode?.anchors && evidenceNode.anchors.length > 0) {
                const anchorRef = evidenceNode.anchors[0].ref;
                const turnMatch = anchorRef?.match(/turn-(\d+)/);
                turnIndex = turnMatch ? parseInt(turnMatch[1], 10) : undefined;
            }
            // Fallback: try to extract from sourceId if anchor not available
            if (turnIndex === undefined && g.sourceId) {
                const fallbackMatch = g.sourceId.match(/e-transcript-(\d+)/);
                turnIndex = fallbackMatch ? parseInt(fallbackMatch[1], 10) : undefined;
            }
            return {
                sourceId: g.sourceId,
                quote: g.quote || evidenceNode?.content?.substring(0, 200),
                turnIndex,
                weight: g.weight,
            };
        });
        // Get truth state from derivation
        const truthResult = graphResult.truthDerivation.results.find(r => r.claimId === c.id);
        // Preserve speaker information from graph node meta (which came from original extracted claims)
        // CRITICAL: Preserve speakerType and speakerLabel so issues can correctly identify speakers
        // Derive from multiple sources: nodeMeta, speakerRole, or fallback to 'unknown'
        const nodeMeta = c.meta || {};
        // Try to get speakerType from meta first, then derive from speakerRole or speaker string
        let speakerType = nodeMeta.speakerType;
        if (!speakerType) {
            if (c.speakerRole === 'agent' || c.speakerRole === 'customer' || c.speakerRole === 'system') {
                speakerType = c.speakerRole;
            }
            else if (nodeMeta.speaker) {
                // Derive from speaker string (e.g., "Agent" -> "agent", "Customer" -> "customer")
                speakerType = mapSpeakerToRole(nodeMeta.speaker).role;
            }
            else {
                speakerType = 'unknown';
            }
        }
        // Preserve speakerLabel from meta, or derive from speaker if available
        const speakerLabel = nodeMeta.speakerLabel ||
            (nodeMeta.speaker && nodeMeta.speaker !== 'Agent' && nodeMeta.speaker !== 'Customer' ? nodeMeta.speaker : undefined);
        // Set speaker in standard format (Agent/Customer/undefined)
        const speaker = nodeMeta.speaker ||
            speakerRoleToDisplay(speakerType);
        return {
            id: c.id,
            text: c.text,
            confidence: c.confidence ?? 0.7,
            evidence: [], // Legacy field
            evidenceRefs, // NEW: Actual grounding refs
            truthState: truthResult?.truthState,
            meta: {
                speaker,
                speakerType,
                speakerLabel,
                rawSpeaker: nodeMeta.rawSpeaker || speakerLabel,
                turnIndex: parseInt(c.span.turnId.replace(/[^\d]/g, ''), 10) || 0,
                participantId: nodeMeta.participantId,
                claimType: claimTypeLookup.get(c.id) ?? claimTypeLookup.get(`${c.id}`),
            },
            claimKind: c.modality === 'question' ? 'question' :
                c.modality === 'promise' ? 'promise' :
                    c.modality === 'deny' ? 'assertion' : 'assertion',
        };
    });
    // Call spectral with the unified graph
    const spectralEnabled = options?.spectral !== false;
    const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
    let spectral;
    let coherenceScore = null;
    // Check grounding status BEFORE calling spectral
    const groundingEdgeCount = graphResult.legacy.grounding.length;
    const hasRealGrounding = groundingEdgeCount > 0;
    let spectralDegraded = false;
    let spectralDegradedReason = null;
    if (!hasRealGrounding) {
        console.warn(`⚠️ No grounding edges created. Marking as DEGRADED.`);
        console.warn(`   Transcript evidence nodes: ${graphResult.graph.nodes.evidence.filter(e => e.evidenceKind === 'transcript').length}`);
        console.warn(`   Grounding candidates processed: ${graphResult.metrics.candidateGeneration?.totalCandidatesGenerated ?? 'unknown'}`);
        spectralDegraded = true;
        spectralDegradedReason = 'NO_GROUNDING_EDGES';
        // Update graph diagnostics to reflect degraded status
        if (graphResult.graph.diagnostics.status === 'OK') {
            graphResult.graph.diagnostics.status = 'DEGRADED';
        }
        if (!graphResult.graph.diagnostics.reasons.includes('NO_GROUNDING_EDGES')) {
            graphResult.graph.diagnostics.reasons.push('NO_GROUNDING_EDGES');
        }
    }
    if (contaminatedClaims > 0) {
        graphResult.graph.diagnostics.status = 'DEGRADED';
        if (!graphResult.graph.diagnostics.reasons.includes('CONTAMINATED_CLAIMS_DROPPED')) {
            graphResult.graph.diagnostics.reasons.push('CONTAMINATED_CLAIMS_DROPPED');
        }
    }
    const sanitizedLineCount = Math.max(1, transcript.split(/\n+/).filter(Boolean).length + sanitizerResult.unknownSpeakerLines);
    if (sanitizerResult.unknownSpeakerLines / sanitizedLineCount > 0.2) {
        graphResult.graph.diagnostics.status = 'DEGRADED';
        if (!graphResult.graph.diagnostics.reasons.includes('LOW_SPEAKER_CONFIDENCE')) {
            graphResult.graph.diagnostics.reasons.push('LOW_SPEAKER_CONFIDENCE');
        }
    }
    if (spectralEnabled && spectralServiceUrl && claims.length > 0) {
        timer.start('spectral');
        try {
            const spectralInput = toSpectralInput(graphResult);
            // Use ONLY real grounded claims - NO synthetic grounding
            const groundedForSpectral = spectralInput.grounded;
            if (groundedForSpectral.length === 0) {
                // Log warning but DO NOT fabricate grounding
                console.warn(`⚠️ Spectral: 0 grounded claims. Results may be less meaningful.`);
                console.warn(`   Run will proceed with degraded quality indicator.`);
            }
            else {
                log('debug', 'Orchestrator', `Spectral: ${groundedForSpectral.length} claims grounded from transcript`);
            }
            spectral = await callSpectralAnalyzeService(spectralServiceUrl, spectralInput.claims, spectralInput.supports, spectralInput.contradictions, groundedForSpectral, {});
            coherenceScore = spectral.coherenceScore;
            // Mark spectral as degraded if no grounding
            if (spectralDegraded) {
                spectral.degraded = true;
                spectral.degradedReason = spectralDegradedReason;
            }
            timer.end('spectral');
            log('debug', 'Orchestrator', `Spectral: coherence=${coherenceScore}${spectralDegraded ? ' (DEGRADED)' : ''}`, { duration: timer.duration('spectral') });
        }
        catch (error) {
            timer.end('spectral');
            console.error("❌ Spectral error:", error?.message);
            spectral = { spectralSkipped: true, debugReason: `spectral_error: ${error?.message}` };
        }
    }
    timer.end('unified_graph');
    // Build the result
    const totalLatency = Date.now() - validationStartTime;
    const hasExternalEvidence = (externalSources?.length ?? 0) > 0;
    // Compute risk-adjusted scores. Transcript grounding is audit traceability, not factual truth.
    const runId = options?.runId || options?.evaluationId || 'pending';
    const conversationId = options?.conversationId || '';
    const evidenceMode = hasExternalEvidence ? 'TRANSCRIPT_PLUS_EXTERNAL' : 'TRANSCRIPT_ONLY';
    const explicitPackIds = options?.domainPackIds ?? [];
    const inferredPackIds = inferDomainPackIds(transcript, industryTemplateId);
    const mergedPackIds = explicitPackIds.length > 0
        ? [...new Set([...explicitPackIds, ...inferredPackIds])]
        : [...new Set([...inferredPackIds, ...industry.additionalDomainPackIds])];
    const domainPacks = mergedPackIds.length > 0 ? selectDomainPacks({ packIds: mergedPackIds }) : selectDomainPacks({ templateId });
    const domainPackIssues = runDomainPacks(domainPacks, claims, { runId, conversationId, evidenceMode });
    const finalExpenseIssues = domainPacks.length === 0
        ? detectFinalExpenseComplianceIssues(claims, { runId, conversationId, evidenceMode })
        : [];
    const hallucinationResult = detectHallucinations(claims, { runId, conversationId, hasExternalEvidence, evidenceMode });
    const driftResult = detectDrift(claims, { runId, conversationId, evidenceMode });
    const crossTurnResult = runCrossTurnConsistency(claims, { runId, conversationId, evidenceMode });
    const aiConversationIssues = detectAiConversationIssues(claims, {
        runId,
        conversationId,
        evidenceMode,
        toolResultsByTurn: options?.toolResultsByTurn instanceof Set ? options.toolResultsByTurn : undefined,
    });
    const detectorIssues = [
        ...domainPackIssues,
        ...finalExpenseIssues,
        ...hallucinationResult.issues,
        ...driftResult.driftIssues,
        ...crossTurnResult.issues,
        ...aiConversationIssues,
    ];
    const factualTruthResult = evaluateFactualTruth(claims, detectorIssues, { hasExternalEvidence });
    const criticalComplianceIssues = detectorIssues.filter(i => i.category === 'compliance' && i.severity === 'critical').length;
    const highComplianceIssues = detectorIssues.filter(i => i.category === 'compliance' && i.severity === 'high').length;
    const complianceScore = Math.max(0, Math.round(100 - criticalComplianceIssues * 28 - highComplianceIssues * 11));
    const graphConsistency = graphResult.truthScores.consistency ?? 0;
    const consistencyScore = Math.round((graphConsistency + crossTurnResult.consistencyScore) / 2);
    const disclosureMissCount = detectorIssues.filter(i => /MISSING|DISCLOSURE/i.test(i.type) ||
        /disclosure|carrier approval|waiting period|policy terms/i.test(`${i.what.issueSummary} ${i.type}`)).length;
    const disclosureCoverage = Math.max(0, Math.min(100, 100 - disclosureMissCount * 14));
    const evidenceNodes = buildEvidenceDependencyGraph(claims, detectorIssues, { hasExternalEvidence });
    const evidenceSupport = averageEvidenceSupportScore(evidenceNodes, hasExternalEvidence);
    const evGapCount = evidenceGapCount(evidenceNodes);
    const { insights: businessInsights, businessValueScore } = mineBusinessInsights(claims);
    const sanitizedLineCountGraph = Math.max(1, transcript.split(/\n+/).filter(Boolean).length + sanitizerResult.unknownSpeakerLines);
    const unknownSpeakerRatio = sanitizerResult.unknownSpeakerLines / sanitizedLineCountGraph;
    const agentClaimCount = claims.filter(c => c.meta?.speakerType === 'agent' || c.meta?.speaker === 'Agent').length;
    const customerClaimCount = claims.filter(c => c.meta?.speakerType === 'customer' || c.meta?.speaker === 'Customer').length;
    const aiClaimCount = claims.filter(c => c.meta?.speakerType === 'bot').length;
    const systemClaimCount = claims.filter(c => c.meta?.speakerType === 'system').length;
    const mappedClaimCount = claims.filter(c => c.meta?.speakerType && c.meta.speakerType !== 'unknown').length;
    const speakerMappingConfidence = claims.length > 0 ? Math.round((mappedClaimCount / claims.length) * 100) : 100;
    const riskProfile = domainPacks.some(p => p.id === "protectqa_final_expense") ? "protectqa" : "generic";
    const riskAdjusted = computeRiskAdjustedScores({
        profile: riskProfile,
        transcriptGrounding: graphResult.truthScores.transcriptGrounding,
        factualTruth: factualTruthResult.factualTruthScore,
        compliance: complianceScore,
        disclosureCoverage,
        evidenceSupport,
        speakerConfidence: speakerMappingConfidence,
        businessValueScore,
        consistency: consistencyScore,
        coherence: coherenceScore,
        hallucination: hallucinationResult.hallucinationScore,
        drift: driftResult.driftScore,
        issues: detectorIssues,
        contaminatedClaims,
        unknownSpeakerRatio,
    });
    const truthScore = riskAdjusted.scores.factualTruth;
    const tclScore = riskAdjusted.scores.tcl;
    const overall = tclScore;
    const diagStatus = graphResult.graph.diagnostics.status === "FAILED"
        ? "failed"
        : graphResult.graph.diagnostics.status === "DEGRADED" || contaminatedClaims > 0 || unknownSpeakerRatio > 0.2
            ? "degraded"
            : "ok";
    const claimsAnalysis = claims.map(c => {
        const node = evidenceNodes.find(n => n.claimId === c.id);
        return {
            id: c.id,
            speaker: c.meta?.speaker,
            speakerType: c.meta?.speakerType,
            turnIndex: c.meta?.turnIndex,
            text: c.text,
            claimType: c.meta?.claimType ?? classifyClaimType(c.text, c.meta?.speaker ?? ""),
            truthState: c.truthState,
            evidenceStatus: node?.status ?? "unverifiable",
            requiredEvidence: node?.requiredEvidenceTypes ?? [],
            missingEvidence: node?.missingEvidenceTypes ?? [],
            riskScore: detectorIssues.filter(i => i.what.primaryClaimId === c.id).length * 12,
            businessValueTags: businessInsights.filter(ins => ins.turnIndex === c.meta?.turnIndex).map(i => i.type),
        };
    });
    const issuesBySeverity = {
        critical: detectorIssues.filter(i => i.severity === "critical"),
        high: detectorIssues.filter(i => i.severity === "high"),
        medium: detectorIssues.filter(i => i.severity === "medium"),
        low: detectorIssues.filter(i => i.severity === "low"),
    };
    const unsupportedForDashboard = evidenceNodes
        .filter(n => n.status === "unsupported" || n.status === "unverifiable" || n.missingEvidenceTypes.length > 1)
        .map(n => ({
        claimText: n.claimText,
        missing: n.missingEvidenceTypes,
    }));
    const topicProbe = claims.length > 0 ? claims.map(c => c.text).join("\n").slice(0, 2500) : transcript.slice(0, 400);
    const dashboardSummary = buildDashboardSummary({
        tclScore,
        mode: domainPacks.some(p => p.id === "protectqa_final_expense") ? "protectqa" : "tcl",
        transcriptHint: topicProbe,
        claims,
        insights: businessInsights,
        issues: detectorIssues,
        drift: driftResult,
        topUnsupported: unsupportedForDashboard,
        nextActions: [
            ...new Set(detectorIssues
                .map(i => i.what.recommendedActionLabel)
                .filter((x) => Boolean(x))
                .slice(0, 8)),
        ],
    });
    const recommendedActions = [
        ...(riskAdjusted.risk.recommendedAction ? [{ label: riskAdjusted.risk.recommendedAction, rationale: riskAdjusted.risk.primaryRisk }] : []),
        ...businessInsights.slice(0, 4).map(ins => ({ label: ins.recommendedAction, rationale: ins.summary })),
    ];
    // Assess run quality
    const runQualityResult = assessRunQuality(tclScore, truthScore, consistencyScore, {
        claimsCount: claims.length,
        supportsCount: graphResult.legacy.supports.length,
        contradictionsCount: graphResult.legacy.contradictions.length,
        groundingCount: graphResult.legacy.grounding.length,
        hasExternalEvidence, // NEW: Pass whether external docs were provided
    }, options?.thresholds);
    const { refusal } = runQualityResult;
    // Compute destructive claims from spectral
    const destructiveClaims = spectral?.nodeBlameNorm
        ? computeDestructiveClaims({
            claims,
            contradictions: graphResult.legacy.contradictions,
            grounding: graphResult.legacy.grounding,
            customRuleViolations: [],
            spectral,
        })
        : [];
    const transcriptLines = Math.max(1, transcript.split(/\n+/).filter(Boolean).length + sanitizerResult.unknownSpeakerLines);
    const analysisResult = buildAnalysisResultPayload({
        industry,
        graphTemplateId: templateId,
        domainPackIds: domainPacks.map(p => p.id),
        riskAdjusted,
        truthSummary: graphResult.truthDerivation.summary,
        claims,
        detectorIssues,
        hasExternalEvidence,
        contradictionEdges: graphResult.legacy.contradictions.length,
        crossTurnPairs: crossTurnResult.pairs?.length ?? 0,
        driftScore: driftResult.driftScore,
        driftIssues: driftResult.driftIssues.length,
        hallucinationIssues: hallucinationResult.issues.length,
        transcriptQuality01: Math.max(0, Math.min(1, 1 - sanitizerResult.unknownSpeakerLines / transcriptLines)),
        speakerConfidence01: speakerMappingConfidence / 100,
        contradictionClarity01: Math.min(1, graphResult.legacy.contradictions.length / Math.max(1, claims.length)),
    });
    return {
        answer: input.answer,
        refusal,
        scores: {
            truth: truthScore,
            consistency: consistencyScore,
            coherence: coherenceScore,
            overall,
            tcl: tclScore,
            transcriptGrounding: riskAdjusted.scores.transcriptGrounding,
            compliance: riskAdjusted.scores.compliance,
            hallucination: riskAdjusted.scores.hallucination,
            drift: riskAdjusted.scores.drift,
            evidenceSupport: riskAdjusted.scores.evidenceSupport,
            speakerConfidence: riskAdjusted.scores.speakerConfidence,
            businessValue: riskAdjusted.scores.businessValue,
        },
        enhancedScores: {
            groundednessScore: graphResult.truthScores.transcriptGrounding,
            transcriptGrounding: riskAdjusted.scores.transcriptGrounding,
            factualTruth: riskAdjusted.scores.factualTruth,
            compliance: riskAdjusted.scores.compliance,
            hallucination: riskAdjusted.scores.hallucination,
            drift: riskAdjusted.scores.drift,
            verificationScore: graphResult.truthScores.externalVerification,
            consistencyScore: graphResult.truthScores.consistency,
            coherenceScore,
            truth: truthScore,
            consistency: consistencyScore,
            coherence: coherenceScore,
            overall,
            tcl: tclScore,
            evidenceSupport: riskAdjusted.scores.evidenceSupport,
            speakerConfidence: riskAdjusted.scores.speakerConfidence,
            businessValue: riskAdjusted.scores.businessValue,
            disclosureCoverage: riskAdjusted.scores.disclosureCoverage,
            modeAware: graphResult.truthScores.modeAware,
        },
        diagnostics: {
            status: diagStatus,
            sanitizedTranscript: sanitizerResult.text !== rawTranscript,
            removedAnnotationLines: sanitizerResult.removedAnnotationLines,
            normalizedInlineSpeakerBoundaries: sanitizerResult.normalizedInlineSpeakerBoundaries,
            contaminatedClaims,
            unknownSpeakerLines: sanitizerResult.unknownSpeakerLines,
            speakerConfidence: speakerMappingConfidence,
            speakerMappingConfidence,
            claimContaminationIndex: claims.length > 0 ? contaminatedClaims / claims.length : 0,
            agentClaimCount,
            customerClaimCount,
            aiClaimCount,
            systemClaimCount,
            evidenceGapCount: evGapCount,
            complianceIssueCount: domainPackIssues.length + finalExpenseIssues.length,
            hallucinationIssueCount: hallucinationResult.issues.length,
            driftIssueCount: driftResult.driftIssues.length,
            crossTurnIssueCount: crossTurnResult.issues.length,
            domainPacksApplied: domainPacks.map(p => `${p.id}@${p.version}`),
            scoringCapsApplied: riskAdjusted.scoringCapsApplied,
        },
        risk: riskAdjusted.risk,
        productContext: {
            positioning: "TCL turns conversations into defensible truth, compliance, hallucination drift, and business-value intelligence.",
            defaultDomain: domainPacks[0]?.id ?? "general_conversation_integrity",
            domainPacksApplied: domainPacks.map(p => p.id),
        },
        businessInsights,
        recommendedActions,
        dashboardSummary,
        claimsAnalysis,
        issuesBySeverity,
        analysisResult,
        evidenceDependencyGraph: evidenceNodes,
        executiveSummary: buildExecutiveSummary({
            scores: {
                transcriptGrounding: riskAdjusted.scores.transcriptGrounding,
                factualTruth: riskAdjusted.scores.factualTruth,
                compliance: riskAdjusted.scores.compliance,
                consistency: consistencyScore,
                coherence: coherenceScore,
                hallucination: riskAdjusted.scores.hallucination,
                drift: riskAdjusted.scores.drift,
                overall: riskAdjusted.scores.tcl,
                tcl: riskAdjusted.scores.tcl,
                disclosureCoverage: riskAdjusted.scores.disclosureCoverage,
                evidenceSupport: riskAdjusted.scores.evidenceSupport,
                businessValue: riskAdjusted.scores.businessValue,
            },
            risk: riskAdjusted.risk,
            issues: detectorIssues,
            claims,
            scoringCapsApplied: riskAdjusted.scoringCapsApplied,
            diagnostics: { contaminatedClaims, unknownSpeakerLines: sanitizerResult.unknownSpeakerLines, speakerMappingConfidence },
        }),
        summaryStats: {
            totalClaims: claims.length,
            groundedClaims: graphResult.truthDerivation.summary.unverified + graphResult.truthDerivation.summary.supported,
            verifiedClaims: graphResult.truthDerivation.summary.supported,
            directContradictions: graphResult.legacy.contradictions.length,
            needsReviewCount: destructiveClaims.length,
            hasExternalEvidence: (externalSources?.length ?? 0) > 0,
        },
        scorerId: 'unified-graph-v1',
        latency: totalLatency,
        engineVersion: getEngineVersion(),
        report: {
            claims,
            violations: [],
            missingEvidence: [],
            contradictions: graphResult.legacy.contradictions.map(c => ({
                claimA: c.claimA,
                claimB: c.claimB,
                reason: `Contradiction with weight ${c.weight.toFixed(2)}`,
            })),
            spectral,
            graph: {
                supports: graphResult.legacy.supports,
                contradictions: graphResult.legacy.contradictions,
                grounding: graphResult.legacy.grounding,
                // FIX D: Add grounded claim IDs for consistency
                grounded: graphResult.legacy.grounding.map(g => g.claimId),
                groundedClaimIds: graphResult.legacy.grounding.map(g => g.claimId),
                debug: {
                    numClaims: claims.length,
                    numSources: externalSources?.length ?? 0,
                    transcriptEvidenceNodes: graphResult.graph.nodes.evidence.filter(e => e.evidenceKind === 'transcript').length,
                    annEnabled: false,
                    cacheEnabled: false,
                    spectralEnabled,
                    spectralDegraded,
                    spectralDegradedReason: spectralDegradedReason ?? undefined,
                    graphBuilderMode: 'unified',
                    graphStatus: graphResult.graph.diagnostics.status,
                    graphReasons: graphResult.graph.diagnostics.reasons,
                    supportThreshold: getTemplateConfig().thresholds.support,
                    contradictionThreshold: getTemplateConfig().thresholds.contradiction,
                    groundingThreshold: getTemplateConfig().thresholds.grounding,
                    // Candidate generation stats
                    pairsGenerated: graphResult.metrics.candidateGeneration?.totalCandidatesGenerated ?? 0,
                    claimsWithZeroCandidates: graphResult.metrics.candidateGeneration?.claimsWithZeroCandidates ?? 0,
                    // Edge classification stats (NOT just scoring - this is where gating happens)
                    pairsScored: graphResult.metrics.edgeClassification?.candidatesProcessed ?? 0,
                    edgesCreated: graphResult.metrics.edgeClassification?.edgesCreated ?? 0,
                    // Rejection breakdown (WHY pairs were filtered in edge-classification.ts)
                    rejectionBreakdown: {
                        bySlotGating: graphResult.metrics.edgeClassification?.rejectedBySlotGating ?? 0,
                        byTopicGating: graphResult.metrics.edgeClassification?.rejectedByTopicGating ?? 0,
                        byPolarityGating: graphResult.metrics.edgeClassification?.rejectedByPolarityGating ?? 0,
                        byThreshold: graphResult.metrics.edgeClassification?.rejectedByThreshold ?? 0,
                    },
                    // Sample of first 10 rejected pairs for debugging
                    sampleRejections: graphResult.metrics.edgeClassification?.sampleRejections?.slice(0, 10) ?? [],
                    edges: {
                        supportsAdded: graphResult.legacy.supports.length,
                        contradictionsAdded: graphResult.legacy.contradictions.length,
                        groundingAdded: graphResult.legacy.grounding.length,
                    },
                    model: {
                        scorerId: 'unified-graph-v1',
                    },
                    reasonIfEmptyGraph: graphResult.metrics.totalEdges === 0
                        ? 'Check sampleRejections for why pairs were filtered; check transcriptEvidenceNodes for grounding'
                        : null,
                },
            },
            destructiveClaims,
            issues: {
                atomic: detectorIssues,
            },
            allIssuesV2: detectorIssues,
            drift: {
                driftScore: driftResult.driftScore,
                driftTimeline: driftResult.driftTimeline,
            },
            crossTurn: {
                consistencyScore: crossTurnResult.consistencyScore,
                events: crossTurnResult.events,
                pairs: crossTurnResult.pairs,
            },
            domainPacksApplied: domainPacks.map(p => ({ id: p.id, version: p.version })),
            analysisResult,
            suggestions: generateSuggestions(claims, [], // violations
            graphResult.legacy.contradictions.map(c => ({
                claimA: c.claimA,
                claimB: c.claimB,
                reason: `Contradiction (weight ${c.weight.toFixed(2)})`
            })), [], // missingEvidence
            graphResult.legacy.supports, undefined, // customRules
            undefined, // importanceByClaimId
            graphResult.legacy.grounding),
            // Manifest for reproducibility and schema versioning
            manifest: {
                schemaVersion: '2.0.0',
                engineVersion: getEngineVersion(),
                graphBuilderMode: 'unified',
                templateId,
                industryTemplateId,
                domainPackIds: domainPacks.map(p => p.id),
                inputHash: graphResult.graph.meta.inputHash,
                configHash: graphResult.graph.meta.configHash,
                timestamp: new Date().toISOString(),
                // FIX C: Add evidenceMode to manifest
                evidenceMode: hasExternalEvidence ? 'TRANSCRIPT_PLUS_EXTERNAL' : 'TRANSCRIPT_ONLY',
                diagnostics: {
                    status: graphResult.graph.diagnostics.status,
                    reasons: graphResult.graph.diagnostics.reasons,
                    transcriptEvidenceNodes: graphResult.graph.nodes.evidence.filter(e => e.evidenceKind === 'transcript').length,
                    supportsAdded: graphResult.legacy.supports.length,
                    groundingAdded: graphResult.legacy.grounding.length,
                    groundedClaimCount: graphResult.legacy.grounding.length,
                    contradictionsAdded: graphResult.legacy.contradictions.length,
                    spectralDegraded,
                    spectralDegradedReason,
                    // FIX E: Add notes for transcript-only mode
                    notes: !hasExternalEvidence ? ['TRANSCRIPT_ONLY_NO_EXTERNAL'] : [],
                },
                truthDerivationSummary: {
                    supported: graphResult.truthDerivation.summary.supported,
                    contradicted: graphResult.truthDerivation.summary.contradicted,
                    unverified: graphResult.truthDerivation.summary.unverified,
                    ungrounded: graphResult.truthDerivation.summary.ungrounded,
                    total: graphResult.truthDerivation.summary.total,
                },
            },
        },
    };
}
// Helper: Detect template from transcript content
function detectTemplate(transcript) {
    const lower = transcript.toLowerCase();
    // Telco indicators (word-boundary matched)
    if (/\b(router|billing plan|streaming|cable|internet plan|wifi)\b/.test(lower)) {
        return 'telco';
    }
    // Loans indicators
    if (/\b(loan|mortgage|interest rate|apr|principal balance|underwriting officer)\b/.test(lower)) {
        return 'loans';
    }
    // AI chat indicators (word-boundary matched to avoid "wait", "claim", etc. triggering)
    if (/\b(ai assistant|chatbot|chat bot|virtual assistant|tool call|prompt|llm)\b/.test(lower)) {
        return 'ai_chat';
    }
    return 'generic';
}
/**
 * Infer which domain packs to apply based on transcript content. This is
 * decoupled from `detectTemplate` (which feeds template-config) so we can add
 * vertical packs without touching the template registry.
 */
function inferDomainPackIds(transcript, explicitTemplateId) {
    const lower = transcript.toLowerCase();
    const packs = new Set();
    if (/\b(ai assistant|chatbot|chat bot|virtual assistant|tool call|prompt injection|llm|i am a (?:doctor|attorney|financial advisor))\b/.test(lower)) {
        packs.add('ai_chatbot');
    }
    if (/\b(support ticket|refund policy|tracking number|escalat)\b/.test(lower))
        packs.add('customer_support');
    if (/\b(soc 2|soc2|hipaa|integration|sales demo)\b/.test(lower))
        packs.add('saas_sales');
    if (/\b(diagnos|prescription|clinical|intake)\b/.test(lower))
        packs.add('healthcare');
    if (/\b(loan|apr|investment return|portfolio)\b/.test(lower))
        packs.add('financial_services');
    if (explicitTemplateId === 'final_expense' || explicitTemplateId === 'insurance' || explicitTemplateId === 'protectqa')
        packs.add('protectqa_final_expense');
    if (explicitTemplateId === 'ai_chat' || explicitTemplateId === 'chatbot' || explicitTemplateId === 'assistant')
        packs.add('ai_chatbot');
    return Array.from(packs);
}
// Helper: Normalize speaker to SpeakerRole
function normalizeSpeaker(speaker) {
    if (!speaker)
        return 'unknown';
    const lower = speaker.toLowerCase();
    if (lower === 'agent')
        return 'agent';
    if (lower === 'customer')
        return 'customer';
    if (lower === 'system')
        return 'system';
    if (lower === 'assistant')
        return 'assistant';
    return 'unknown';
}
// Helper: Create empty result
function createEmptyResult(input, timer, startTime) {
    return {
        answer: input.answer,
        refusal: false,
        scores: { truth: null, consistency: null, coherence: null, overall: null },
        report: {
            claims: [],
            violations: [],
            missingEvidence: [],
            contradictions: [],
        },
    };
}
async function validateOnce(input, adapter, startTime) {
    const timer = startPipelineTimer();
    const validationStartTime = startTime ?? Date.now();
    try {
        const { question, answer, sources: externalSources, options } = input;
        // =========================================================================
        // GRAPH BUILDER MODE SELECTION
        // =========================================================================
        // Options can override the default mode:
        //   options.graphBuilder = "unified" | "legacy" | "truth-engine"
        //   options.useTruthEngine = true (legacy: equivalent to truth-engine)
        //   options.useLegacyGraph = true (legacy: equivalent to legacy)
        // =========================================================================
        let graphMode = GRAPH_BUILDER_MODE;
        // Check options for explicit mode override
        if (options?.graphBuilder) {
            graphMode = options.graphBuilder;
        }
        else if (options?.useTruthEngine) {
            graphMode = "truth-engine";
        }
        else if (options?.useLegacyGraph) {
            graphMode = "legacy";
        }
        console.log(`📊 Using graph builder: ${graphMode}`);
        // =========================================================================
        // PATH 1: UNIFIED GRAPH BUILDER (DEFAULT - Best for spectral.py)
        // =========================================================================
        if (graphMode === "unified") {
            return await runUnifiedGraphPath(input, timer, validationStartTime, adapter);
        }
        // =========================================================================
        // PATH 2: TRUTH ENGINE (Deterministic, rule-based)
        // =========================================================================
        if (graphMode === "truth-engine") {
            log('info', 'Orchestrator', 'Using deterministic Truth Engine (NLI disabled)');
            // Run the Truth Engine
            const transcript = answer && answer.trim().length > 0 ? answer : question;
            const engineResult = runTruthEngine({
                transcript,
                conversationId: options?.conversationId ?? "inline"
            });
            // Convert to legacy graph format
            const legacyGraph = toLegacyGraph(engineResult);
            // Build issues
            const issues = buildIssuesFromGraph(engineResult.graph);
            // Build claims in expected format (must match Claim type)
            const claims = engineResult.graph.claims.map(c => ({
                id: c.id,
                text: c.text,
                evidence: [], // No external evidence in transcript-only mode
                meta: {
                    speaker: c.speaker,
                    turnIndex: c.turnIndex,
                },
                confidence: 0.7, // Will be refined by spectral
            }));
            // Call spectral with the rule-based graph
            const spectralEnabled = options?.spectral !== false;
            const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
            let spectral;
            let coherenceScore = null;
            if (spectralEnabled && spectralServiceUrl && claims.length > 0) {
                try {
                    log('debug', 'Orchestrator', `Calling Spectral with rule-based graph`, {
                        contradictions: legacyGraph.contradictions.length,
                        supports: legacyGraph.supports.length
                    });
                    spectral = await callSpectralAnalyzeService(spectralServiceUrl, claims.map(c => ({ id: c.id, text: c.text })), legacyGraph.supports, legacyGraph.contradictions, legacyGraph.groundedClaimIds, {});
                    coherenceScore = spectral.coherenceScore;
                    log('debug', 'Orchestrator', `Spectral complete`, { coherence: coherenceScore });
                }
                catch (e) {
                    log('error', 'Orchestrator', 'Spectral error', { message: e.message });
                    spectral = { spectralSkipped: true, debugReason: `spectral_error: ${e.message}` };
                }
            }
            // Calculate scores
            const consistencyScore = legacyGraph.contradictions.length === 0 ? 100 :
                Math.max(0, 100 - legacyGraph.contradictions.length * 15);
            const finalCoherence = coherenceScore !== null ? Math.round(coherenceScore * 100) : null;
            const overall = finalCoherence !== null
                ? Math.round((consistencyScore + finalCoherence) / 2)
                : consistencyScore;
            // Generate reproducibility metadata (reuse transcript from above)
            const reproMetadata = generateReproducibilityMetadata(transcript);
            // Build manifest with full reproducibility
            const manifest = {
                inputHash: reproMetadata.inputHash,
                configHash: reproMetadata.configHash,
                artifactId: options?.artifactId,
                claimExtractorVersion: "truth-engine-v1",
                nliModelId: "none-rules-only",
                nliThresholds: { support: 0, contradiction: 0, grounding: 0 },
                embeddingModel: "none",
                retrievalK: 0,
                spectralEngineVersion: spectral && !spectral.spectralSkipped ? "v1.0.0" : undefined,
                codeVersion: reproMetadata.codeVersion,
                engineVersion: reproMetadata.engineVersion,
                modelFingerprint: reproMetadata.modelFingerprint,
                createdAt: engineResult.graph.generatedAt,
                transcriptSourcesCount: 0,
                graphHealth: {
                    supportEdges: legacyGraph.supports.length,
                    contradictionEdges: legacyGraph.contradictions.length,
                    groundingEdges: legacyGraph.grounding.length,
                    totalEdges: legacyGraph.supports.length + legacyGraph.contradictions.length + legacyGraph.grounding.length,
                    healthy: legacyGraph.contradictions.length > 0 || legacyGraph.supports.length > 0,
                    reason: undefined,
                },
            };
            console.log(`✅ Truth Engine complete: ${engineResult.timings.total}ms (vs ~100s with NLI)`);
            timer.logSummary();
            // Map contradictions with reasons for the report (different from graph edges)
            const reportContradictions = engineResult.graph.contradictionEdges.map(e => ({
                claimA: e.srcId,
                claimB: e.dstId,
                reason: e.reason,
            }));
            // Build debug info matching GraphDebugInfo type
            const debugInfo = {
                numClaims: engineResult.graph.claims.length,
                numSources: 0,
                transcriptSourcesGenerated: 0,
                annEnabled: false,
                cacheEnabled: false,
                spectralEnabled: spectralEnabled,
                neighborK: 0,
                supportThreshold: 0,
                contradictionThreshold: 0,
                groundingThreshold: 0,
                pairsGenerated: 0,
                pairsScored: 0,
                edges: {
                    supportsAdded: legacyGraph.supports.length,
                    contradictionsAdded: legacyGraph.contradictions.length,
                    groundingAdded: 0,
                },
                filtered: {
                    belowSupportThreshold: 0,
                    belowContradictionThreshold: 0,
                    belowGroundingThreshold: 0,
                    droppedByMaxEdges: 0,
                },
                model: {
                    scorerId: "truth-engine-rules-v1",
                },
                reasonIfEmptyGraph: legacyGraph.contradictions.length === 0 && legacyGraph.supports.length === 0
                    ? "no_edges_from_rules"
                    : null,
            };
            return {
                answer: answer || transcript,
                refusal: false,
                scores: {
                    truth: null,
                    consistency: consistencyScore,
                    coherence: finalCoherence,
                    overall,
                },
                scorerId: "truth-engine-v1",
                latency: engineResult.timings.total,
                engineVersion: engineResult.graph.codeVersion,
                report: {
                    claims,
                    violations: [],
                    missingEvidence: [],
                    contradictions: reportContradictions,
                    spectral,
                    graph: {
                        supports: legacyGraph.supports,
                        contradictions: legacyGraph.contradictions,
                        grounding: legacyGraph.grounding,
                        debug: debugInfo,
                    },
                    suggestions: [],
                    manifest,
                },
            };
        }
        // =========================================================================
        // PATH 3: LEGACY NLI-based edge generation
        // Not recommended - uses ML model calls, slower, less reproducible
        // To use: set TCL_GRAPH_BUILDER=legacy or options.graphBuilder="legacy"
        // =========================================================================
        console.log("⚠️ Using Legacy NLI-based edge generation. Consider using unified graph builder (default) for better edges.");
        // Spectral is the CORE VALUE of the app - enabled by default
        // Only disable if explicitly set to false
        const spectralEnabled = options?.spectral !== false;
        const spectralServiceUrl = options?.spectralServiceUrl ?? process.env.TCL_SPECTRAL_URL ?? "";
        // Configuration for this run
        const retrievalK = options?.annNeighborK ?? 8; // Top-k chunks per claim for NLI
        const conversationId = options?.conversationId ?? "inline";
        const artifactId = options?.artifactId;
        // 1) claims
        timer.start('claim_extract');
        let claims = [];
        if (adapter) {
            const art = await adapter.extractArtifacts({ question, answer, sources: externalSources });
            claims = art.claims;
        }
        else {
            const textToExtract = answer && answer.trim().length > 0 ? answer : question;
            claims = extractClaims(textToExtract);
        }
        timer.end('claim_extract');
        timer.set('num_claims', claims.length);
        console.log(`📋 Claims extracted: ${claims.length} (${timer.duration('claim_extract')}ms)`);
        if (claims.length === 0) {
            console.error(`❌ ERROR: No claims extracted!`);
        }
        // 2) CRITICAL: Generate transcript sources for grounding
        timer.start('source_gen');
        let sources = [...(externalSources || [])];
        let transcriptSourcesCount = 0;
        const isCallTranscript = !answer || answer.trim().length === 0;
        if (isCallTranscript && question.trim().length > 0) {
            const transcriptSources = generateSourcesFromRawTranscript(question, conversationId);
            sources = [...sources, ...transcriptSources];
            transcriptSourcesCount = transcriptSources.length;
        }
        else if (sources.length === 0 && answer && answer.trim().length > 0) {
            const answerSources = generateSourcesFromRawTranscript(answer, conversationId);
            sources = [...sources, ...answerSources];
            transcriptSourcesCount = answerSources.length;
        }
        timer.end('source_gen');
        timer.set('num_sources', sources.length);
        console.log(`📝 Sources generated: ${sources.length} (${timer.duration('source_gen')}ms)`);
        // 3) Retrieve evidence for each claim BEFORE NLI (MANDATORY)
        timer.start('retrieval');
        const evidencePerClaim = retrieveEvidenceForClaims(claims, sources, retrievalK);
        let totalEvidenceHits = 0;
        for (const [, hits] of evidencePerClaim) {
            totalEvidenceHits += hits.length;
        }
        timer.end('retrieval');
        timer.set('num_evidence_chunks', totalEvidenceHits);
        console.log(`🔍 Evidence retrieved: ${totalEvidenceHits} hits (${timer.duration('retrieval')}ms)`);
        // 4) grounding (legacy MVP evidence check)
        const evidenceRes = attachEvidenceAndFindViolations(claims, sources);
        // 3) logic (legacy MVP contradiction check)
        const logicRes = findLogicViolations(evidenceRes.claims);
        // 4) production graph build
        // Scorer priority:
        //   1. Spectral NLI (if TCL_SPECTRAL_URL configured - uses Python transformers, no native deps)
        //   2. Custom NLI endpoint (if TCL_NLI_ENDPOINT configured)
        //   3. Mistral API (if MISTRAL_API_KEY configured)
        //   4. Local Transformers (may fail in containers)
        //   5. TokenHeuristicScorer (fallback)
        timer.start('scorer_init');
        const spectralUrl = options?.spectralServiceUrl || process.env.TCL_SPECTRAL_URL || "";
        const nliEndpoint = options?.nliEndpoint || process.env.TCL_NLI_ENDPOINT || "";
        const nliApiKey = options?.nliApiKey || process.env.TCL_NLI_API_KEY;
        const nliModelId = options?.nliModelId || process.env.TCL_NLI_MODEL_ID || "nli-default";
        const mistralApiKey = options?.mistralApiKey || process.env.MISTRAL_API_KEY;
        const mistralModel = options?.mistralModel || process.env.MISTRAL_MODEL;
        const useLocalNli = options?.useLocalNli ?? (process.env.TCL_USE_LOCAL_NLI === "true");
        let scorer;
        // OPTIMIZATION: Cache scorer to avoid re-testing on every request
        if (cachedScorer && cachedScorer.url === spectralUrl && (Date.now() - cachedScorer.timestamp) < SCORER_CACHE_TTL) {
            scorer = cachedScorer.scorer;
            console.log(`⚡ Using cached scorer: ${scorer.id} (cache hit)`);
        }
        else if (spectralUrl && !nliEndpoint) {
            // Priority 1: Spectral NLI (Python service)
            try {
                const spectralScorer = new SpectralNliScorer({ endpoint: spectralUrl });
                // Quick test - only once per cache period
                console.log(`🔌 Testing Spectral NLI connection...`);
                const testScore = await spectralScorer.entailment("The sky is blue.", "The sky has a blue color.");
                if (testScore > 0.3) {
                    scorer = spectralScorer;
                    cachedScorer = { scorer, url: spectralUrl, timestamp: Date.now() };
                    console.log(`✅ Scorer: ${scorer.id} (test: ${testScore.toFixed(3)})`);
                }
                else {
                    throw new Error(`Test score too low: ${testScore}`);
                }
            }
            catch (error) {
                console.warn(`⚠️ Spectral NLI failed: ${error.message}`);
            }
        }
        if (!scorer && nliEndpoint) {
            scorer = new HttpNliScorer({ endpoint: nliEndpoint, apiKey: nliApiKey, modelId: nliModelId });
        }
        if (!scorer && mistralApiKey) {
            const { MistralNliScorer } = await import("./graph/edge_builder.js");
            scorer = new MistralNliScorer({ apiKey: mistralApiKey, model: mistralModel });
        }
        if (!scorer && useLocalNli) {
            try {
                const transformersScorer = new TransformersNliScorer({});
                const testScore = await transformersScorer.entailment("The sky is blue.", "The sky has color.");
                if (testScore >= 0)
                    scorer = transformersScorer;
            }
            catch (error) {
                console.warn(`⚠️ Local NLI failed: ${error.message}`);
            }
        }
        if (!scorer) {
            scorer = new TokenHeuristicScorer();
            console.log(`⚠️ Using fallback scorer: ${scorer.id}`);
        }
        timer.end('scorer_init');
        console.log(`🔧 Scorer init: ${timer.duration('scorer_init')}ms`);
        // Determine threshold values BEFORE graph building (hoisted for use in manifest)
        // These need to be accessible throughout the function
        const hasConversationalPatterns = question.includes('Agent:') || question.includes('Customer:') ||
            question.includes('Agent:') || question.includes('Customer:') ||
            (question.split('?').length > 3);
        const isHeuristic = scorer.id === "token-heuristic-v1" || scorer.id === "token-heuristic";
        const isLocalTransformers = scorer.id.includes("transformers");
        const isSpectralNli = scorer.id.includes("spectral-nli");
        const isRealNli = isLocalTransformers || isSpectralNli; // Real NLI model
        const transcriptMultiplier = (isCallTranscript || hasConversationalPatterns) ? 0.85 : 1.0;
        let defaultSupportThreshold;
        let defaultContradictionThreshold;
        let defaultGroundingThreshold;
        if (isHeuristic) {
            // Heuristic scorer - lower thresholds since it's not as accurate
            defaultSupportThreshold = 0.30 * transcriptMultiplier;
            defaultContradictionThreshold = 0.40 * transcriptMultiplier;
            defaultGroundingThreshold = 0.30 * transcriptMultiplier;
        }
        else if (isRealNli) {
            // Real NLI model (local transformers or spectral service) - use optimal thresholds
            // Lower for conversational text which has more noise
            defaultSupportThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.25 : 0.35;
            defaultContradictionThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.35 : 0.45;
            defaultGroundingThreshold = (isCallTranscript || hasConversationalPatterns) ? 0.25 : 0.35;
            console.log(`🔬 Using real NLI scorer: ${scorer.id} with optimized thresholds`);
        }
        else {
            // Unknown scorer - use moderate thresholds
            defaultSupportThreshold = 0.45 * transcriptMultiplier;
            defaultContradictionThreshold = 0.55 * transcriptMultiplier;
            defaultGroundingThreshold = 0.45 * transcriptMultiplier;
        }
        // OPTIMIZATION: Limit candidate pairs using top-K instead of all-vs-all
        // For N claims and M sources:
        //   - Old: N*M grounding pairs + N*(N-1)/2 claim pairs = O(N*M + N²)
        //   - New: N*K grounding pairs + N*K claim pairs = O(N*K) where K << M
        // 
        // FIX: The old MAX_CLAIM_PAIRS=100 was WAY too low for N=62 claims.
        // This caused 0 support edges because almost no pairs got scored.
        // New approach: per-claim budget, not global cap.
        const MAX_GROUNDING_PAIRS_PER_CLAIM = 15; // Ground against top 15 sources per claim
        const PAIRS_PER_CLAIM = 10; // Score top 10 claim pairs per claim
        const numClaims = evidenceRes.claims.length;
        // Total pairs = N * PAIRS_PER_CLAIM, capped at N*(N-1)/2 (all pairs)
        const maxPossiblePairs = numClaims > 1 ? (numClaims * (numClaims - 1)) / 2 : 0;
        const MAX_CLAIM_PAIRS = Math.min(numClaims * PAIRS_PER_CLAIM, maxPossiblePairs, 5000); // Cap at 5000 for very large transcripts
        let graph;
        timer.start('graph_build');
        timer.start('nli_total');
        try {
            console.log(`🔨 Building claim graph: ${evidenceRes.claims.length} claims, ${sources?.length || 0} sources`);
            console.log(`   Thresholds: sup=${(options?.supportThreshold ?? defaultSupportThreshold).toFixed(2)}, con=${(options?.contradictionThreshold ?? defaultContradictionThreshold).toFixed(2)}, gnd=${(options?.groundingThreshold ?? defaultGroundingThreshold).toFixed(2)}`);
            graph = await buildClaimGraph(evidenceRes.claims, sources, {
                scorer,
                supportThreshold: options?.supportThreshold ?? defaultSupportThreshold,
                contradictionThreshold: options?.contradictionThreshold ?? defaultContradictionThreshold,
                groundingThreshold: options?.groundingThreshold ?? defaultGroundingThreshold,
                maxPairwiseEdges: options?.maxPairwiseEdges ?? MAX_CLAIM_PAIRS,
                batchSize: options?.batchSize ?? 256, // Large batches = fewer HTTP calls
                ann: {
                    index: "bruteforce",
                    neighborK: options?.annNeighborK ?? options?.neighborK ?? Math.min(MAX_GROUNDING_PAIRS_PER_CLAIM, evidenceRes.claims.length - 1)
                },
                cache: {
                    enabled: options?.cache ?? false,
                    persistPath: options?.cachePersistPath
                },
                // Pass timer for NLI tracking
                timer
            });
            timer.end('nli_total');
            timer.end('graph_build');
            timer.set('edges_support', graph.supports.length);
            timer.set('edges_contra', graph.contradictions.length);
            timer.set('edges_ground', graph.grounding.length);
            console.log(`📊 Graph: ${graph.supports.length} sup, ${graph.contradictions.length} con, ${graph.grounding.length} gnd (${timer.duration('graph_build')}ms)`);
        }
        catch (error) {
            console.error("Error building claim graph:", error);
            timer.end('nli_total');
            timer.end('graph_build');
            graph = { supports: [], contradictions: [], grounding: [], groundedClaimIds: [] };
        }
        // 4.5) Custom rule validation (domain-specific rules)
        const customRuleViolations = options?.customRules
            ? validateCustomRules(evidenceRes.claims, input, options.customRules)
            : [];
        // Create canonical contradiction list (unified representation)
        // Merge graph contradictions (NLI-based, weighted) and logic contradictions (rule-based, weight=1.0)
        const canonicalContradictions = [];
        // Add graph contradictions (NLI-based)
        for (const cont of graph.contradictions) {
            canonicalContradictions.push({
                claimA: cont.claimA,
                claimB: cont.claimB,
                weight: cont.weight,
                source: 'nli'
            });
        }
        // Add logic contradictions (rule-based, weight=1.0)
        for (const cont of logicRes.contradictions) {
            canonicalContradictions.push({
                claimA: cont.claimA,
                claimB: cont.claimB,
                weight: 1.0,
                source: 'rule'
            });
        }
        // Dedupe contradictions (keep highest weight)
        const contradictionMap = new Map();
        for (const cont of canonicalContradictions) {
            const key1 = `${cont.claimA}::${cont.claimB}`;
            const key2 = `${cont.claimB}::${cont.claimA}`;
            const existing = contradictionMap.get(key1) || contradictionMap.get(key2);
            if (!existing || cont.weight > existing.weight) {
                contradictionMap.delete(key1);
                contradictionMap.delete(key2);
                contradictionMap.set(key1, cont);
            }
        }
        const uniqueContradictions = Array.from(contradictionMap.values());
        // Calculate consistency score using weighted sum (not just count)
        const contradictionWeight = uniqueContradictions.reduce((sum, c) => sum + c.weight, 0);
        const base = 100;
        const penalty = Math.min(100, contradictionWeight * 20); // 20 points per unit weight (was 25 per count)
        const consistencyScore = Math.max(0, base - penalty);
        console.log(`Consistency: ${uniqueContradictions.length} unique contradictions (weight=${contradictionWeight.toFixed(2)}, ${logicRes.contradictions.length} from logic, ${graph.contradictions.length} from graph), score: ${consistencyScore}`);
        // 5) spectral - WITH GRAPH HEALTH GATING
        let spectral;
        let coherenceScore = null;
        const envSpectralUrl = process.env.TCL_SPECTRAL_URL || "";
        const urlToUse = spectralServiceUrl || envSpectralUrl;
        // Calculate graph health metrics
        const supportEdgeCount = graph.supports.length;
        const contradictionEdgeCount = uniqueContradictions.length;
        const groundingEdgeCount = graph.grounding.length;
        const totalEdges = supportEdgeCount + contradictionEdgeCount + groundingEdgeCount;
        // Graph health diagnostic
        const graphHealthDiagnostic = {
            supportEdges: supportEdgeCount,
            contradictionEdges: contradictionEdgeCount,
            groundingEdges: groundingEdgeCount,
            totalEdges,
            claimsCount: evidenceRes.claims.length,
            sourcesCount: sources.length,
            transcriptSourcesGenerated: transcriptSourcesCount,
            retrievalK,
            nliModelId: scorer.id,
            thresholds: {
                support: options?.supportThreshold ?? defaultSupportThreshold,
                contradiction: options?.contradictionThreshold ?? defaultContradictionThreshold,
                grounding: options?.groundingThreshold ?? defaultGroundingThreshold
            }
        };
        // Debug logging
        console.log(`📊 Graph Health Check:`);
        console.log(`  - Claims: ${evidenceRes.claims.length}`);
        console.log(`  - Sources: ${sources.length} (${transcriptSourcesCount} from transcript)`);
        console.log(`  - Edges: ${totalEdges} total (support=${supportEdgeCount}, contradiction=${contradictionEdgeCount}, grounding=${groundingEdgeCount})`);
        console.log(`  - NLI Model: ${scorer.id}`);
        console.log(`  - Thresholds: support=${graphHealthDiagnostic.thresholds.support.toFixed(2)}, contradiction=${graphHealthDiagnostic.thresholds.contradiction.toFixed(2)}, grounding=${graphHealthDiagnostic.thresholds.grounding.toFixed(2)}`);
        // CRITICAL: Gate spectral on graph health
        // Spectral on an empty graph produces mathematically valid but semantically meaningless results
        const graphIsHealthy = totalEdges > 0 || groundingEdgeCount > 0;
        if (spectralEnabled) {
            if (!urlToUse) {
                console.warn("⚠️ Spectral enabled but no spectralServiceUrl/TCL_SPECTRAL_URL configured. Skipping Spectral analysis.");
                console.warn("Please set TCL_SPECTRAL_URL environment variable in Railway.");
                spectral = {
                    spectralSkipped: true,
                    debugReason: "no_spectral_url_configured",
                    graphHealthDiagnostic
                };
                coherenceScore = null;
            }
            else if (evidenceRes.claims.length === 0) {
                console.warn("⚠️ Spectral enabled but no claims to analyze. Skipping Spectral analysis.");
                spectral = {
                    spectralSkipped: true,
                    debugReason: "no_claims_for_spectral",
                    graphHealthDiagnostic
                };
                coherenceScore = null;
            }
            else {
                // ALWAYS run spectral - but surface diagnostics if graph is empty
                // Empty graphs will still produce results (identifying ungrounded claims)
                if (totalEdges === 0) {
                    console.warn("⚠️ DIAGNOSTIC: Graph has ZERO edges - spectral will run but results may be limited.");
                    console.warn("   This is NOT a silent failure - investigate root cause:");
                    console.warn(`   - NLI Model: ${scorer.id}`);
                    console.warn(`   - Claims: ${evidenceRes.claims.length}`);
                    console.warn(`   - Sources: ${sources.length} (${transcriptSourcesCount} from transcript)`);
                    console.warn(`   - Thresholds: support=${graphHealthDiagnostic.thresholds.support.toFixed(2)}, contradiction=${graphHealthDiagnostic.thresholds.contradiction.toFixed(2)}`);
                    console.warn(`   - Possible causes:`);
                    console.warn(`     1. NLI label mapping failure (check LABEL_0/1/2 → ENTAILMENT/etc)`);
                    console.warn(`     2. Thresholds too high for this content`);
                    console.warn(`     3. No transcript sources generated`);
                    console.warn(`     4. Claims too dissimilar`);
                }
                // If no grounding detected, synthetically ground agent claims
                // This gives spectral a starting point for truth flow
                let groundedForSpectral = [...graph.groundedClaimIds];
                if (groundedForSpectral.length === 0) {
                    // Ground claims from the agent (they have some authority)
                    const agentClaims = evidenceRes.claims
                        .filter((c) => c.meta?.speaker === 'Agent' || c.meta?.speaker === 'AGENT')
                        .slice(0, 3) // Limit to first 3 agent claims
                        .map((c) => c.id);
                    if (agentClaims.length > 0) {
                        groundedForSpectral = agentClaims;
                        console.log(`📌 No grounding detected, synthetically grounding ${agentClaims.length} agent claims: ${agentClaims.join(', ')}`);
                    }
                    else {
                        // If no agent claims, ground the first claim as a baseline
                        if (evidenceRes.claims.length > 0) {
                            groundedForSpectral = [evidenceRes.claims[0].id];
                            console.log(`📌 No grounding detected, synthetically grounding first claim: ${evidenceRes.claims[0].id}`);
                        }
                    }
                }
                try {
                    timer.start('spectral');
                    console.log(`📡 Calling Spectral: ${urlToUse}/spectral/analyze`);
                    spectral = await callSpectralAnalyzeService(urlToUse, evidenceRes.claims.map((c) => ({ id: c.id, text: c.text })), graph.supports, uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })), groundedForSpectral, {});
                    timer.end('spectral');
                    coherenceScore = spectral.coherenceScore;
                    console.log(`✅ Spectral: coherence=${coherenceScore}, truthVector=${spectral.truthVector?.length || 0} (${timer.duration('spectral')}ms)`);
                }
                catch (error) {
                    timer.end('spectral');
                    console.error("❌ Spectral error:", error?.message);
                    spectral = { spectralSkipped: true, debugReason: `spectral_error: ${error?.message}` };
                    coherenceScore = null;
                }
            }
        }
        else {
            console.log("Spectral disabled in options");
        }
        // 6) scores - compute truth score incorporating contradictions
        // FIX: Use graph-based truth score that incorporates contradictions
        let truthScore = null;
        try {
            const engineConfig = getEngineConfig();
            const mode = sources && sources.length > 0 ? 'with_external_docs' : 'transcript_only';
            const graphBasedTruth = computeTruthFromGraph(evidenceRes.claims, uniqueContradictions, graph.supports, graph.grounding, mode);
            // Use graph-based truth score (incorporates contradictions)
            if (graphBasedTruth.truth !== undefined && !isNaN(graphBasedTruth.truth)) {
                truthScore = graphBasedTruth.truth;
            }
        }
        catch (error) {
            console.warn('Error computing graph-based truth score, falling back:', error);
        }
        // Fallback to evidenceRes.truthScore if graph-based computation failed
        if (truthScore === null && evidenceRes.truthScore !== undefined) {
            truthScore = Math.max(0, Math.min(100, Math.round(evidenceRes.truthScore)));
        }
        const pairsScored = graph.debug?.pairsScored || 0;
        const finalConsistencyScore = pairsScored > 0 && consistencyScore !== undefined
            ? Math.max(0, Math.min(100, Math.round(consistencyScore)))
            : null; // null if no pairs scored (unknown)
        const finalCoherenceScore = coherenceScore !== null
            ? Math.max(0, Math.min(100, Math.round(coherenceScore)))
            : null; // null if Spectral skipped or failed
        const overall = blendScores(truthScore ?? null, finalConsistencyScore ?? null, finalCoherenceScore);
        // Assess run quality with detailed reasons (replaces simple boolean refusal)
        const hasExternalEvidenceLegacy = (externalSources?.length ?? 0) > 0;
        const runQuality = assessRunQuality(overall, truthScore ?? null, finalConsistencyScore ?? null, {
            supportsCount: graph.supports.length,
            contradictionsCount: uniqueContradictions.length,
            groundingCount: graph.grounding.length,
            claimsCount: evidenceRes.claims.length,
            hasExternalEvidence: hasExternalEvidenceLegacy, // NEW: Pass whether external docs were provided
        }, options?.thresholds);
        const refusal = runQuality.refusal; // Legacy compatibility
        console.log(`Final scores: truth=${truthScore}, consistency=${finalConsistencyScore}, coherence=${finalCoherenceScore}, overall=${overall}`);
        console.log(`Run quality: status=${runQuality.status}, reasons=${runQuality.degradedReasons.join(', ') || 'none'}`);
        // Calculate latency
        const latency = Date.now() - validationStartTime;
        // Get cache hit rate from graph
        const cacheHitRate = graph.cacheStats?.hitRate;
        // Get engine version (from package.json or git)
        const engineVersion = process.env.TCL_ENGINE_VERSION || process.env.GIT_COMMIT || 'v0.2.0';
        // 7) Calculate confidence metrics for claims (if enabled)
        let claimsWithConfidence = evidenceRes.claims;
        if (options?.includeConfidenceMetrics !== false) { // Default: true
            const confidenceMetrics = calculateAllClaimConfidences(evidenceRes.claims, graph.supports, uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })), graph.grounding);
            claimsWithConfidence = evidenceRes.claims.map(claim => {
                const metrics = confidenceMetrics.get(claim.id);
                return {
                    ...claim,
                    confidenceMetrics: metrics || undefined // Only include if computed, no fallback
                };
            });
        }
        // 8) Compute destructive claims (ranked by importance)
        const destructiveClaims = computeDestructiveClaims({
            claims: claimsWithConfidence,
            contradictions: uniqueContradictions.map(c => ({ claimA: c.claimA, claimB: c.claimB, weight: c.weight })),
            grounding: graph.grounding,
            customRuleViolations: [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations].filter(v => v.type === "CUSTOM_RULE"),
            spectral: spectral ? {
                truthVector: spectral.truthVector,
                truthStates: spectral.truthStates,
                nodeBlameNorm: spectral.nodeBlameNorm
            } : undefined
        });
        // Build importance map for suggestions
        const importanceByClaimId = new Map();
        destructiveClaims.forEach(dc => {
            importanceByClaimId.set(dc.claimId, dc.importance);
        });
        // 9) Generate suggestions (if enabled)
        // Use canonical contradictions for suggestions
        const allContradictionsForSuggestions = uniqueContradictions.map(c => ({
            claimA: c.claimA,
            claimB: c.claimB,
            reason: `Contradiction detected (${c.source}, weight=${c.weight.toFixed(2)})`
        }));
        const suggestions = (options?.includeSuggestions !== false) // Default: true
            ? generateSuggestions(claimsWithConfidence, [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations], allContradictionsForSuggestions, evidenceRes.missing, graph.supports, options?.customRules, importanceByClaimId, graph.grounding)
            : undefined;
        // 10) Compute trajectory (if enabled and transcript detected)
        const trajectory = options?.trajectory && (!answer || answer.trim().length === 0) &&
            (question.includes("Agent:") || question.includes("Customer:"))
            ? await computeTrajectory(input, validateOnce, // Pass the function itself
            adapter, {
                windowTurns: options?.trajectoryWindowTurns ?? 3,
                maxSegments: options?.maxTrajectorySegments ?? 20
            })
            : undefined;
        // Generate reproducibility metadata
        const transcriptForRepro = answer || question;
        const reproMetadata = generateReproducibilityMetadata(transcriptForRepro);
        // Build run manifest for audit
        const runManifest = {
            inputHash: reproMetadata.inputHash,
            configHash: reproMetadata.configHash,
            artifactId,
            claimExtractorVersion: "v1.0.0", // TODO: Extract from package.json
            nliModelId: scorer.id,
            nliThresholds: {
                support: options?.supportThreshold ?? defaultSupportThreshold,
                contradiction: options?.contradictionThreshold ?? defaultContradictionThreshold,
                grounding: options?.groundingThreshold ?? defaultGroundingThreshold
            },
            embeddingModel: "simple-ngram-v1", // Our built-in embedding
            retrievalK,
            spectralEngineVersion: spectralEnabled && spectral && !spectral.spectralSkipped ? "v1.0.0" : undefined,
            codeVersion: reproMetadata.codeVersion,
            engineVersion: reproMetadata.engineVersion,
            modelFingerprint: reproMetadata.modelFingerprint,
            createdAt: new Date().toISOString(),
            transcriptSourcesCount,
            graphHealth: {
                supportEdges: supportEdgeCount,
                contradictionEdges: contradictionEdgeCount,
                groundingEdges: groundingEdgeCount,
                totalEdges,
                healthy: graphIsHealthy,
                reason: !graphIsHealthy ? "zero_edges" : undefined
            }
        };
        // Log performance summary
        timer.set('num_issues', destructiveClaims?.length || 0);
        timer.logSummary();
        const result = {
            answer,
            refusal, // Legacy boolean (deprecated)
            runQuality: {
                status: runQuality.status,
                degradedReasons: runQuality.degradedReasons
            },
            scores: { truth: truthScore, consistency: finalConsistencyScore, coherence: finalCoherenceScore, overall },
            scorerId: scorer.id,
            latency,
            cacheHitRate,
            engineVersion,
            // Include performance metrics in response for debugging
            performanceMs: {
                total: timer.total(),
                claimExtract: timer.duration('claim_extract'),
                graphBuild: timer.duration('graph_build'),
                nliTotal: timer.duration('nli_total'),
                spectral: timer.duration('spectral'),
                nliCalls: timer.get('num_nli_calls'),
                nliPairs: timer.get('num_nli_pairs')
            },
            report: {
                claims: claimsWithConfidence,
                violations: [...evidenceRes.violations, ...logicRes.violations, ...customRuleViolations],
                missingEvidence: evidenceRes.missing,
                contradictions: allContradictionsForSuggestions,
                spectral,
                graph: {
                    supports: graph.supports,
                    contradictions: graph.contradictions,
                    grounding: graph.grounding,
                    debug: graph.debug ? {
                        ...graph.debug,
                        spectralEnabled: spectralEnabled,
                        numSources: sources.length,
                        transcriptSourcesGenerated: transcriptSourcesCount
                    } : undefined
                },
                suggestions,
                destructiveClaims: destructiveClaims.length > 0 ? destructiveClaims : undefined,
                trajectory,
                manifest: runManifest
            }
        };
        return result;
    }
    catch (error) {
        console.error("validateOnce error:", error);
        throw error;
    }
}
export async function validate(input) {
    const startTime = Date.now();
    try {
        const adapter = input.options?.llmAdapter;
        const first = await validateOnce(input, adapter, startTime);
        const repairEnabled = !!input.options?.repair && !!adapter;
        const hasSources = !!input.sources?.length;
        const requireCitations = input.options?.requireCitations ?? hasSources;
        const failingClaimIds = collectFailingClaimIds(first.report);
        const needsRepair = repairEnabled &&
            failingClaimIds.length > 0 &&
            (first.refusal || (first.scores.truth !== null && first.scores.truth < (input.options?.thresholds?.truth ?? 60)));
        if (!needsRepair)
            return first;
        const repaired = await repairOnce({
            adapter: adapter,
            question: input.question,
            originalAnswer: input.answer,
            claims: first.report.claims,
            sources: input.sources,
            failingClaimIds,
            requireCitations
        });
        const second = await validateOnce({ ...input, answer: repaired.repairedAnswer, options: { ...input.options, repair: false } }, adapter, startTime);
        return second;
    }
    catch (error) {
        console.error("Validate function error:", error);
        throw error;
    }
}
