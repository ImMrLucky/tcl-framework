/**
 * Graph Builder - Unified Entry Point
 *
 * This is the main entry point for building a semantically correct Claim-Evidence-Action Graph.
 *
 * Pipeline:
 * 1. Extract claims with subject slots
 * 2. Topic segmentation
 * 3. Candidate generation (per-claim budgets)
 * 4. Edge classification (slot-first gating)
 * 5. Weight calibration
 * 6. Truth state derivation (from graph, never assigned directly)
 * 7. Return ClaimGraph + RunDiagnostics
 *
 * INVARIANTS:
 * - Graph is the single source of truth
 * - Edges are evidence-bearing objects
 * - Support ≠ transcript quote (transcript = GROUNDING, not SUPPORT)
 * - Contradictions require same subject slot
 * - All thresholds are config-driven
 */
import { extractEntities, computeSubjectSlot } from './subject-slot.js';
import { getTemplateConfig, setTemplateConfig } from './template-config.js';
// Re-export for convenience
export { setTemplateConfig, getTemplateConfig };
import { assignTopicIds } from './topic-segmentation.js';
import { generateCandidates } from './candidate-generation.js';
import { classifyEdges } from './edge-classification.js';
import { calibrateEdges } from './weight-calibration.js';
import { deriveTruthStatesFromGraph, computeTruthScores } from './truth-state-derivation.js';
import { buildRunDiagnostics, validateGraphIntegrity } from './run-diagnostics.js';
import { createHash } from 'crypto';
// =============================================================================
// MAIN GRAPH BUILDER
// =============================================================================
export function buildGraph(input) {
    const startTime = Date.now();
    const pipelineSteps = {};
    // Step 0: Set template config
    if (input.template) {
        if (typeof input.template === 'string') {
            setTemplateConfig(input.template);
        }
        else {
            setTemplateConfig({
                ...getTemplateConfig(),
                ...input.template,
            });
        }
    }
    const config = getTemplateConfig();
    // Step 1: Build ClaimNodes
    const step1Start = Date.now();
    const claimNodes = buildClaimNodes(input);
    pipelineSteps['claimNodes'] = Date.now() - step1Start;
    console.log(`📋 Graph Builder: ${claimNodes.length} claim nodes (${pipelineSteps['claimNodes']}ms)`);
    // Step 2: Build EvidenceNodes
    const step2Start = Date.now();
    const evidenceNodes = buildEvidenceNodes(input);
    pipelineSteps['evidenceNodes'] = Date.now() - step2Start;
    console.log(`📄 Graph Builder: ${evidenceNodes.length} evidence nodes (${pipelineSteps['evidenceNodes']}ms)`);
    // Step 3: Topic Segmentation
    const step3Start = Date.now();
    const segmentation = assignTopicIds(claimNodes);
    pipelineSteps['topicSegmentation'] = Date.now() - step3Start;
    console.log(`🏷️ Graph Builder: ${segmentation.clusters.length} topic clusters (${pipelineSteps['topicSegmentation']}ms)`);
    // Step 4: Candidate Generation
    const step4Start = Date.now();
    const transcriptEvidenceCount = evidenceNodes.filter(e => e.evidenceKind === 'transcript').length;
    console.log(`📊 Graph Builder: ${evidenceNodes.length} evidence nodes (${transcriptEvidenceCount} transcript)`);
    const candidates = generateCandidates(claimNodes, evidenceNodes);
    pipelineSteps['candidateGeneration'] = Date.now() - step4Start;
    console.log(`🎯 Graph Builder: ${candidates.diagnostics.totalCandidatesGenerated} candidates (${pipelineSteps['candidateGeneration']}ms)`);
    console.log(`   Breakdown: ${candidates.contradictionCandidates.length} contradiction, ${candidates.supportClaimCandidates.length} support-claim, ${candidates.supportEvidenceCandidates.length} support-evidence, ${candidates.groundingCandidates.length} grounding`);
    // Step 5: Edge Classification
    const step5Start = Date.now();
    const classified = classifyEdges(candidates.contradictionCandidates, candidates.supportClaimCandidates, candidates.supportEvidenceCandidates, candidates.groundingCandidates);
    pipelineSteps['edgeClassification'] = Date.now() - step5Start;
    console.log(`🔗 Graph Builder: ${classified.diagnostics.edgesCreated} edges created (${pipelineSteps['edgeClassification']}ms)`);
    console.log(`   Created: ${classified.contradictions.length} contradictions, ${classified.supports.length} supports, ${classified.groundings.length} groundings`);
    // Step 6: Weight Calibration
    const step6Start = Date.now();
    const claimMap = new Map(claimNodes.map(c => [c.id, c]));
    const evidenceMap = new Map(evidenceNodes.map(e => [e.id, e]));
    const calibratedSupports = calibrateEdges(classified.supports, claimMap, evidenceMap);
    const calibratedContradictions = calibrateEdges(classified.contradictions, claimMap, evidenceMap);
    const calibratedGroundings = calibrateEdges(classified.groundings, claimMap, evidenceMap);
    pipelineSteps['weightCalibration'] = Date.now() - step6Start;
    console.log(`⚖️ Graph Builder: Calibrated weights (${pipelineSteps['weightCalibration']}ms)`);
    // Step 7: Build ClaimGraph
    const inputHash = createHash('sha256')
        .update(input.transcript || JSON.stringify(input.rawClaims))
        .digest('hex')
        .substring(0, 16);
    const configHash = createHash('sha256')
        .update(JSON.stringify(config))
        .digest('hex')
        .substring(0, 16);
    const graph = {
        nodes: {
            claims: claimNodes,
            evidence: evidenceNodes,
            actions: [], // TODO: Extract actions from transcript
            topics: segmentation.topicNodes,
        },
        edges: {
            support: calibratedSupports,
            contradiction: calibratedContradictions,
            grounding: calibratedGroundings,
            actionResult: [],
            correction: [],
        },
        diagnostics: {
            status: 'OK', // Will be updated below
            reasons: [],
            counters: {},
            timestamp: new Date().toISOString(),
        },
        meta: {
            templateId: config.templateId,
            createdAt: new Date().toISOString(),
            inputHash,
            configHash,
        },
    };
    // Step 8: Truth State Derivation
    const step8Start = Date.now();
    const truthDerivation = deriveTruthStatesFromGraph(graph);
    const truthScores = computeTruthScores(truthDerivation);
    pipelineSteps['truthDerivation'] = Date.now() - step8Start;
    console.log(`✅ Graph Builder: Truth scores computed (${pipelineSteps['truthDerivation']}ms)`);
    // Step 9: Run Diagnostics
    const diagnosticsInput = {
        candidateDiagnostics: candidates.diagnostics,
        edgeDiagnostics: classified.diagnostics,
        truthSummary: truthDerivation.summary,
        hasExternalEvidence: evidenceNodes.some(e => e.evidenceKind !== 'transcript'),
        spectralSkipped: false, // Will be set by caller
    };
    graph.diagnostics = buildRunDiagnostics(diagnosticsInput);
    // Step 10: Validate Graph Integrity
    const integrity = validateGraphIntegrity(graph);
    if (!integrity.isValid) {
        console.warn(`⚠️ Graph integrity violations: ${integrity.violations.join(', ')}`);
        graph.diagnostics.reasons.push(...integrity.violations.slice(0, 3)); // Limit to first 3
        if (graph.diagnostics.status === 'OK') {
            graph.diagnostics.status = 'DEGRADED';
        }
    }
    const totalTime = Date.now() - startTime;
    pipelineSteps['total'] = totalTime;
    console.log(`🏁 Graph Builder: Complete in ${totalTime}ms`);
    // Build legacy format for backward compatibility
    const legacy = {
        supports: calibratedSupports.map(e => ({
            claimA: e.from,
            claimB: e.to,
            weight: e.weight,
        })),
        contradictions: calibratedContradictions.map(e => ({
            claimA: e.from,
            claimB: e.to,
            weight: e.weight,
        })),
        grounding: calibratedGroundings.map(e => ({
            claimId: e.from,
            sourceId: e.to,
            weight: e.weight,
            quote: e.provenance.anchors?.[0]?.text,
        })),
        groundedClaimIds: calibratedGroundings.map(e => e.from),
    };
    return {
        graph,
        truthScores,
        truthDerivation,
        topicSegmentation: segmentation,
        legacy,
        metrics: {
            totalClaims: claimNodes.length,
            totalEvidence: evidenceNodes.length,
            totalEdges: calibratedSupports.length +
                calibratedContradictions.length +
                calibratedGroundings.length,
            processingTimeMs: totalTime,
            pipelineSteps,
            // Edge classification diagnostics
            edgeClassification: {
                candidatesProcessed: classified.diagnostics.candidatesProcessed,
                edgesCreated: classified.diagnostics.edgesCreated,
                rejectedBySlotGating: classified.diagnostics.rejectedBySlotGating,
                rejectedByTopicGating: classified.diagnostics.rejectedByTopicGating,
                rejectedByPolarityGating: classified.diagnostics.rejectedByPolarityGating,
                rejectedByThreshold: classified.diagnostics.rejectedByThreshold,
                sampleRejections: classified.diagnostics.sampleRejections,
            },
            // Candidate generation diagnostics
            candidateGeneration: {
                totalCandidatesGenerated: candidates.diagnostics.totalCandidatesGenerated,
                claimsWithZeroCandidates: candidates.diagnostics.claimsWithZeroCandidates,
                budgetExhausted: candidates.diagnostics.budgetExhausted,
            },
        },
    };
}
// =============================================================================
// BUILD CLAIM NODES
// =============================================================================
function buildClaimNodes(input) {
    const claimNodes = [];
    if (input.rawClaims) {
        // Use pre-extracted claims
        for (const raw of input.rawClaims) {
            const entities = extractEntities(raw.text);
            const slot = computeSubjectSlot(raw.text, entities, raw.modality);
            const node = {
                id: raw.id,
                type: 'CLAIM',
                text: raw.text,
                speakerRole: raw.speakerRole,
                span: raw.span,
                timestamp: raw.timestamp,
                modality: raw.modality || detectModality(raw.text),
                claimType: raw.claimType,
                entities,
                normalized: {
                    amount: entities.find(e => e.type === 'MONEY')?.normalized,
                    date: entities.find(e => e.type === 'DATE')?.normalized,
                    duration: entities.find(e => e.type === 'DURATION')?.normalized,
                    percentage: entities.find(e => e.type === 'PERCENT')?.normalized,
                },
                slot,
                confidence: raw.confidence,
                createdAt: new Date().toISOString(),
                meta: raw.meta,
            };
            claimNodes.push(node);
        }
    }
    else if (input.transcript) {
        // Parse transcript into claims (simple line-based extraction)
        const lines = input.transcript.split('\n').filter(l => l.trim());
        let turnIndex = 0;
        for (const line of lines) {
            const parsed = parseTurn(line, turnIndex);
            if (!parsed) {
                turnIndex++;
                continue;
            }
            const entities = extractEntities(parsed.text);
            const slot = computeSubjectSlot(parsed.text, entities);
            const node = {
                id: `c${turnIndex}`,
                type: 'CLAIM',
                text: parsed.text,
                speakerRole: parsed.speaker,
                span: {
                    turnId: `turn-${turnIndex}`,
                    startChar: 0,
                    endChar: parsed.text.length,
                },
                modality: detectModality(parsed.text),
                entities,
                normalized: {
                    amount: entities.find(e => e.type === 'MONEY')?.normalized,
                    date: entities.find(e => e.type === 'DATE')?.normalized,
                },
                slot,
                createdAt: new Date().toISOString(),
            };
            claimNodes.push(node);
            turnIndex++;
        }
    }
    return claimNodes;
}
// =============================================================================
// BUILD EVIDENCE NODES
// =============================================================================
function buildEvidenceNodes(input) {
    const evidenceNodes = [];
    if (input.evidence) {
        for (const ev of input.evidence) {
            const node = {
                id: ev.id,
                type: 'EVIDENCE',
                evidenceKind: ev.kind,
                sourceSystem: ev.sourceSystem,
                title: ev.title,
                version: ev.version,
                effectiveDate: ev.effectiveDate,
                anchors: [],
                content: ev.content,
                fields: ev.fields,
                createdAt: new Date().toISOString(),
            };
            evidenceNodes.push(node);
        }
    }
    // Also create transcript evidence nodes for grounding
    if (input.transcript) {
        const lines = input.transcript.split('\n').filter(l => l.trim());
        let turnIndex = 0;
        for (const line of lines) {
            const parsed = parseTurn(line, turnIndex);
            if (!parsed) {
                turnIndex++;
                continue;
            }
            const node = {
                id: `e-transcript-${turnIndex}`,
                type: 'EVIDENCE',
                evidenceKind: 'transcript',
                content: parsed.text,
                anchors: [{
                        type: 'line',
                        ref: `turn-${turnIndex}`,
                        text: parsed.text,
                    }],
                createdAt: new Date().toISOString(),
            };
            evidenceNodes.push(node);
            turnIndex++;
        }
    }
    return evidenceNodes;
}
// =============================================================================
// HELPERS
// =============================================================================
function parseTurn(line, turnIndex) {
    // Common patterns: "Agent: ...", "Customer: ...", "[Agent] ...", etc.
    const patterns = [
        /^(?:Agent|AGENT|agent)\s*[:\]]\s*(.+)$/i,
        /^(?:Customer|CUSTOMER|customer)\s*[:\]]\s*(.+)$/i,
        /^(?:System|SYSTEM|system)\s*[:\]]\s*(.+)$/i,
        /^(?:Assistant|ASSISTANT|assistant)\s*[:\]]\s*(.+)$/i,
    ];
    for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
            let speaker = 'unknown';
            if (/agent/i.test(line))
                speaker = 'agent';
            else if (/customer/i.test(line))
                speaker = 'customer';
            else if (/system/i.test(line))
                speaker = 'system';
            else if (/assistant/i.test(line))
                speaker = 'assistant';
            return { speaker, text: match[1].trim() };
        }
    }
    // If no pattern matches, treat as unknown speaker
    if (line.trim().length > 10) {
        return { speaker: 'unknown', text: line.trim() };
    }
    return null;
}
function detectModality(text) {
    const lowerText = text.toLowerCase();
    // Questions
    if (text.includes('?') || /^(what|who|where|when|why|how|is|are|can|could|would|do|does|did)\b/.test(lowerText)) {
        return 'question';
    }
    // Promises
    if (/\b(i will|i'll|we will|we'll|i promise|i guarantee|i assure)\b/.test(lowerText)) {
        return 'promise';
    }
    // Denials
    if (/\b(no|not|never|don't|doesn't|didn't|won't|can't|cannot|isn't|aren't)\b/.test(lowerText)) {
        return 'deny';
    }
    // Hedges
    if (/\b(maybe|perhaps|might|could be|possibly|i think|i believe|it seems)\b/.test(lowerText)) {
        return 'hedge';
    }
    // Default to assertion
    return 'assert';
}
export function toSpectralInput(output) {
    return {
        claims: output.graph.nodes.claims.map(c => ({ id: c.id, text: c.text })),
        supports: output.legacy.supports,
        contradictions: output.legacy.contradictions,
        grounded: output.legacy.groundedClaimIds,
    };
}
// =============================================================================
// REGRESSION TEST HELPERS
// =============================================================================
export function assertGraphInvariants(graph) {
    const failures = [];
    // Invariant 1: All contradiction edges must have same slotType/entityKey
    for (const edge of graph.edges.contradiction) {
        if (!edge.slot || edge.slot.slotType === 'unknown') {
            failures.push(`Contradiction edge ${edge.id} has unknown slot`);
        }
    }
    // Invariant 2: All edges must have rationale
    const allEdges = [
        ...graph.edges.support,
        ...graph.edges.contradiction,
        ...graph.edges.grounding,
    ];
    for (const edge of allEdges) {
        if (!edge.rationale?.method) {
            failures.push(`Edge ${edge.id} missing rationale.method`);
        }
    }
    // Invariant 3: All edges must have provenance
    for (const edge of allEdges) {
        if (!edge.provenance) {
            failures.push(`Edge ${edge.id} missing provenance`);
        }
    }
    // Invariant 4: No cross-topic contradictions (if gating enabled)
    const config = getTemplateConfig();
    if (config.gating.contradictionRequiresSameTopic) {
        for (const edge of graph.edges.contradiction) {
            const claimA = graph.nodes.claims.find(c => c.id === edge.from);
            const claimB = graph.nodes.claims.find(c => c.id === edge.to);
            if (claimA?.topicId && claimB?.topicId && claimA.topicId !== claimB.topicId) {
                failures.push(`Contradiction edge ${edge.id} crosses topics: ${claimA.topicId} ≠ ${claimB.topicId}`);
            }
        }
    }
    // Invariant 5: Support edges from transcript must be GROUNDING, not SUPPORT
    for (const edge of graph.edges.support) {
        const evidence = graph.nodes.evidence.find(e => e.id === edge.to);
        if (evidence?.evidenceKind === 'transcript') {
            failures.push(`Support edge ${edge.id} points to transcript evidence (should be GROUNDING)`);
        }
    }
    return {
        passed: failures.length === 0,
        failures,
    };
}
