/**
 * Truth Engine - Main entry point for deterministic truth graph generation.
 *
 * Replaces NLI-based edge generation with:
 * 1. Claim extraction (enhanced with modality/polarity)
 * 2. Fact normalization (structured semantic content)
 * 3. Rule-based edge generation (deterministic, auditable)
 * 4. Graph assembly (for spectral.py)
 *
 * Same input + config = identical output (reproducible).
 * No ML/NLI calls.
 */
import { createHash } from "crypto";
import { DEFAULT_CONFIG } from "./config/types.js";
import { extractEnhancedClaims, extractFacts } from "./facts/fact-extractor.js";
import { runRuleEngine } from "./rules/rule-engine.js";
const CODE_VERSION = "1.0.0";
/**
 * Run the deterministic truth engine on a transcript.
 */
export function runTruthEngine(input) {
    const startTime = Date.now();
    const config = input.config || DEFAULT_CONFIG;
    // Stage 1: Claim Extraction
    const claimStart = Date.now();
    const claims = extractEnhancedClaims(input.transcript, config);
    const claimTime = Date.now() - claimStart;
    console.log(`📋 Truth Engine: Extracted ${claims.length} claims (${claimTime}ms)`);
    // Stage 2: Fact Normalization
    const factStart = Date.now();
    const facts = extractFacts(claims, config);
    const factTime = Date.now() - factStart;
    console.log(`📊 Truth Engine: Extracted ${facts.length} facts (${factTime}ms)`);
    // Stage 3: Rule-based Edge Generation
    const ruleStart = Date.now();
    const ruleResult = runRuleEngine(claims, facts, config);
    const ruleTime = Date.now() - ruleStart;
    console.log(`🔗 Truth Engine: Generated ${ruleResult.contradictionEdges.length} contradiction, ${ruleResult.supportEdges.length} support, ${ruleResult.structureEdges.length} structure edges (${ruleTime}ms)`);
    console.log(`   Rules applied: ${ruleResult.rulesApplied.join(', ')}`);
    // Stage 4: Graph Assembly
    const inputHash = createHash('sha256').update(input.transcript).digest('hex').substring(0, 16);
    const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex').substring(0, 16);
    // Sort for determinism
    const sortedClaims = [...claims].sort((a, b) => a.turnIndex - b.turnIndex || a.id.localeCompare(b.id));
    const sortedFacts = [...facts].sort((a, b) => a.turnIndex - b.turnIndex || a.id.localeCompare(b.id));
    const sortEdges = (edges) => [...edges].sort((a, b) => b.weight - a.weight || a.srcId.localeCompare(b.srcId) || a.dstId.localeCompare(b.dstId));
    const totalTime = Date.now() - startTime;
    const graph = {
        claims: sortedClaims,
        facts: sortedFacts,
        contradictionEdges: sortEdges(ruleResult.contradictionEdges),
        supportEdges: sortEdges(ruleResult.supportEdges),
        groundingEdges: [], // No grounding without evidence corpus
        structureEdges: sortEdges(ruleResult.structureEdges),
        inputHash,
        configHash,
        codeVersion: CODE_VERSION,
        generatedAt: new Date().toISOString(),
        stats: {
            claimCount: claims.length,
            factCount: facts.length,
            edgeCounts: {
                contradiction: ruleResult.contradictionEdges.length,
                support: ruleResult.supportEdges.length,
                grounding: 0,
                structure: ruleResult.structureEdges.length,
            },
            rulesApplied: ruleResult.rulesApplied,
            processingTimeMs: totalTime,
        },
    };
    // Build spectral.py compatible input
    // Grounding semantics: in transcript_only mode, no claims are "grounded" (they're unverified)
    // In evidence_corpus mode, only claims with grounding edges are grounded
    const evidenceMode = config.analysis?.evidenceMode ?? 'transcript_only';
    const groundedClaimIds = evidenceMode === 'transcript_only'
        ? [] // No claims are grounded in transcript-only mode (they're unverified)
        : graph.groundingEdges.map(e => e.srcId);
    const spectralInput = {
        claims: sortedClaims.map(c => ({ id: c.id, text: c.text })),
        supports: ruleResult.supportEdges.map(e => ({
            claimA: e.srcId,
            claimB: e.dstId,
            weight: e.weight,
        })),
        contradictions: ruleResult.contradictionEdges.map(e => ({
            claimA: e.srcId,
            claimB: e.dstId,
            weight: e.weight,
        })),
        grounded: groundedClaimIds, // Empty in transcript_only mode
    };
    console.log(`✅ Truth Engine complete: ${totalTime}ms`);
    return {
        graph,
        spectralInput,
        timings: {
            claimExtraction: claimTime,
            factExtraction: factTime,
            ruleEngine: ruleTime,
            total: totalTime,
        },
    };
}
/**
 * Convert Truth Engine output to legacy graph format for compatibility.
 */
export function toLegacyGraph(output) {
    return {
        supports: output.spectralInput.supports,
        contradictions: output.spectralInput.contradictions,
        grounding: output.graph.groundingEdges.map(e => ({
            claimId: e.srcId,
            sourceId: e.dstId,
            weight: e.weight,
            quote: e.metadata?.srcText,
        })),
        groundedClaimIds: output.graph.claims.map(c => c.id), // All grounded in transcript mode
        debug: {
            engine: 'truth-engine-v1',
            nli: false,
            rulesApplied: output.graph.stats.rulesApplied,
            processingTimeMs: output.timings.total,
            inputHash: output.graph.inputHash,
            configHash: output.graph.configHash,
        },
    };
}
/**
 * Build issues from truth graph for UI display.
 * Clusters contradictions by topic/subject for manager-grade problem statements.
 */
export function buildIssuesFromGraph(graph) {
    const issues = [];
    // Create claim map for quick lookup
    const claimMap = new Map(graph.claims.map(c => [c.id, c]));
    // Cluster contradictions by topic/subject for better grouping
    const clusters = new Map();
    for (const edge of graph.contradictionEdges) {
        // Only include direct contradictions (skip low_overlap, topic_mismatch)
        if (edge.contradictionType && edge.contradictionType !== 'direct') {
            continue;
        }
        const srcClaim = claimMap.get(edge.srcId);
        const dstClaim = claimMap.get(edge.dstId);
        if (!srcClaim || !dstClaim)
            continue;
        // Cluster key: topic + subject from metadata
        const topic = edge.metadata?.topic || srcClaim.topics[0] || 'general';
        const subject = edge.metadata?.subject || 'unknown';
        const clusterKey = `${topic}|${subject}`;
        const existing = clusters.get(clusterKey) || [];
        existing.push(edge);
        clusters.set(clusterKey, existing);
    }
    // Build issues from clusters (one issue per cluster, or per edge if cluster is small)
    for (const [clusterKey, edges] of clusters) {
        const [topic, subject] = clusterKey.split('|');
        // If cluster has multiple edges, create one aggregated issue
        if (edges.length > 1) {
            // Find the strongest edge in the cluster
            const strongest = edges.reduce((max, e) => e.weight > max.weight ? e : max);
            const allClaimIds = new Set();
            const turnIndices = [];
            for (const edge of edges) {
                allClaimIds.add(edge.srcId);
                allClaimIds.add(edge.dstId);
                const srcClaim = claimMap.get(edge.srcId);
                const dstClaim = claimMap.get(edge.dstId);
                if (srcClaim)
                    turnIndices.push(srcClaim.turnIndex);
                if (dstClaim)
                    turnIndices.push(dstClaim.turnIndex);
            }
            // Determine severity from strongest edge
            let severity = 'medium';
            if (strongest.ruleId.includes('AGENT_SELF_CONTRADICTION')) {
                severity = 'critical';
            }
            else if (strongest.ruleId.includes('POLARITY_CONFLICT')) {
                severity = 'high';
            }
            else if (strongest.ruleId.includes('TIMEFRAME_CONFLICT')) {
                severity = 'medium';
            }
            if (strongest.weight > 0.9 && severity === 'high') {
                severity = 'critical';
            }
            const minTurn = Math.min(...turnIndices);
            const maxTurn = Math.max(...turnIndices);
            issues.push({
                issueId: `issue_cluster_${clusterKey.replace(/[^a-zA-Z0-9]/g, '_')}`,
                claimId: strongest.dstId,
                type: strongest.ruleId.split('.')[0],
                severity,
                description: `${edges.length} contradictions about ${subject} (${topic}): ${strongest.reason}`,
                ruleId: strongest.ruleId,
                relatedClaims: Array.from(allClaimIds),
                topic,
                subject,
                turnRange: [minTurn, maxTurn],
            });
        }
        else {
            // Single edge = single issue
            const edge = edges[0];
            const srcClaim = claimMap.get(edge.srcId);
            const dstClaim = claimMap.get(edge.dstId);
            let severity = 'medium';
            if (edge.ruleId.includes('AGENT_SELF_CONTRADICTION')) {
                severity = 'critical';
            }
            else if (edge.ruleId.includes('POLARITY_CONFLICT')) {
                severity = 'high';
            }
            else if (edge.ruleId.includes('TIMEFRAME_CONFLICT')) {
                severity = 'medium';
            }
            if (edge.weight > 0.9 && severity === 'high') {
                severity = 'critical';
            }
            issues.push({
                issueId: `issue_${edge.id}`,
                claimId: edge.dstId,
                type: edge.ruleId.split('.')[0],
                severity,
                description: edge.reason,
                ruleId: edge.ruleId,
                relatedClaims: [edge.srcId, edge.dstId],
                topic,
                subject,
                turnRange: srcClaim && dstClaim ? [
                    Math.min(srcClaim.turnIndex, dstClaim.turnIndex),
                    Math.max(srcClaim.turnIndex, dstClaim.turnIndex)
                ] : undefined,
            });
        }
    }
    // Sort by severity then weight (use strongest edge weight for clusters)
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    issues.sort((a, b) => {
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0)
            return severityDiff;
        // Find max weight for each issue's related claims
        const aMaxWeight = Math.max(...graph.contradictionEdges
            .filter(e => a.relatedClaims.includes(e.srcId) || a.relatedClaims.includes(e.dstId))
            .map(e => e.weight), 0);
        const bMaxWeight = Math.max(...graph.contradictionEdges
            .filter(e => b.relatedClaims.includes(e.srcId) || b.relatedClaims.includes(e.dstId))
            .map(e => e.weight), 0);
        return bMaxWeight - aMaxWeight;
    });
    return issues;
}
