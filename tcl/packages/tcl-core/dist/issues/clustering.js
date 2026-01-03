/**
 * Issue Clustering
 *
 * Groups raw claims into Issues/Problem Statements.
 * Uses semantic similarity, shared entities/topics, and graph connectivity.
 *
 * Output is deterministic: stable sorting, intermediate outputs stored.
 */
import { createHash } from "crypto";
import { getRiskModelConfig } from "../config/risk.model.js";
/**
 * Cluster claims into groups that will become Issues.
 */
export function clusterClaims(claims, edges, config) {
    const cfg = config || getRiskModelConfig();
    const clusters = [];
    // Build adjacency maps
    const claimMap = new Map(claims.map(c => [c.id, c]));
    const claimEdges = new Map();
    for (const edge of edges) {
        const fromEdges = claimEdges.get(edge.fromClaimId) || [];
        fromEdges.push(edge);
        claimEdges.set(edge.fromClaimId, fromEdges);
        const toEdges = claimEdges.get(edge.toClaimId) || [];
        toEdges.push(edge);
        claimEdges.set(edge.toClaimId, toEdges);
    }
    // Group claims by shared topics/entities first
    const topicGroups = groupByTopics(claims);
    // For each topic group, find connected components via edges
    const visited = new Set();
    for (const [topic, topicClaimIds] of topicGroups) {
        for (const startId of topicClaimIds) {
            if (visited.has(startId))
                continue;
            // BFS to find connected component
            const component = new Set();
            const queue = [startId];
            while (queue.length > 0) {
                const currentId = queue.shift();
                if (visited.has(currentId))
                    continue;
                visited.add(currentId);
                component.add(currentId);
                // Add connected claims via edges
                const currentEdges = claimEdges.get(currentId) || [];
                for (const edge of currentEdges) {
                    const neighborId = edge.fromClaimId === currentId ? edge.toClaimId : edge.fromClaimId;
                    if (!visited.has(neighborId) && topicClaimIds.includes(neighborId)) {
                        queue.push(neighborId);
                    }
                }
            }
            // Only create cluster if meets minimum size
            if (component.size >= cfg.clustering.minClaimsPerIssue) {
                const cluster = createCluster(Array.from(component), claims, edges, claimMap);
                clusters.push(cluster);
            }
        }
    }
    // Handle orphan claims (not in any topic group)
    const allClustered = new Set(clusters.flatMap(c => c.claimIds));
    const orphans = claims.filter(c => !allClustered.has(c.id));
    // Group orphans by edge connectivity
    const orphanVisited = new Set();
    for (const orphan of orphans) {
        if (orphanVisited.has(orphan.id))
            continue;
        const component = new Set();
        const queue = [orphan.id];
        while (queue.length > 0) {
            const currentId = queue.shift();
            if (orphanVisited.has(currentId))
                continue;
            orphanVisited.add(currentId);
            component.add(currentId);
            const currentEdges = claimEdges.get(currentId) || [];
            for (const edge of currentEdges) {
                const neighborId = edge.fromClaimId === currentId ? edge.toClaimId : edge.fromClaimId;
                if (!orphanVisited.has(neighborId) && orphans.some(o => o.id === neighborId)) {
                    queue.push(neighborId);
                }
            }
        }
        if (component.size >= cfg.clustering.minClaimsPerIssue) {
            const cluster = createCluster(Array.from(component), claims, edges, claimMap);
            clusters.push(cluster);
        }
    }
    // Sort clusters by contradiction mass (highest first) for stable ordering
    clusters.sort((a, b) => b.contradictionMass - a.contradictionMass);
    return clusters;
}
function groupByTopics(claims) {
    const groups = new Map();
    for (const claim of claims) {
        const topics = claim.topics || [];
        for (const topic of topics) {
            const existing = groups.get(topic) || [];
            existing.push(claim.id);
            groups.set(topic, existing);
        }
    }
    return groups;
}
function createCluster(claimIds, allClaims, allEdges, claimMap) {
    const claimSet = new Set(claimIds);
    // Find edges within this cluster
    const clusterEdges = allEdges.filter(e => claimSet.has(e.fromClaimId) && claimSet.has(e.toClaimId));
    // Compute masses
    let contradictionMass = 0;
    let supportMass = 0;
    let groundingMass = 0;
    for (const edge of clusterEdges) {
        if (edge.type === "CONTRADICTION")
            contradictionMass += edge.score;
        else if (edge.type === "SUPPORT")
            supportMass += edge.score;
        else if (edge.type === "GROUNDING")
            groundingMass += edge.score;
    }
    // Collect topics and speakers
    const topics = new Set();
    const speakers = new Set();
    let minTurn = Infinity;
    let maxTurn = -Infinity;
    for (const claimId of claimIds) {
        const claim = claimMap.get(claimId);
        if (claim) {
            for (const topic of claim.topics || []) {
                topics.add(topic);
            }
            speakers.add(claim.speaker);
            minTurn = Math.min(minTurn, claim.turnIndex);
            maxTurn = Math.max(maxTurn, claim.turnIndex);
        }
    }
    return {
        id: generateClusterId(claimIds),
        claimIds,
        edgeIds: clusterEdges.map(e => e.id),
        topics,
        speakers,
        turnRange: { min: minTurn, max: maxTurn === -Infinity ? 0 : maxTurn },
        contradictionMass,
        supportMass,
        groundingMass,
    };
}
function generateClusterId(claimIds) {
    const sorted = [...claimIds].sort().join(":");
    return createHash("sha256").update(sorted).digest("hex").substring(0, 12);
}
// ============================================================================
// ISSUE GENERATION FROM CLUSTERS
// ============================================================================
/**
 * Convert clusters into full Issue objects.
 */
export function generateIssues(clusters, claims, edges, config) {
    const cfg = config || getRiskModelConfig();
    const claimMap = new Map(claims.map(c => [c.id, c]));
    const issues = [];
    for (let i = 0; i < Math.min(clusters.length, cfg.clustering.maxIssues); i++) {
        const cluster = clusters[i];
        const issue = clusterToIssue(cluster, claimMap, edges, i + 1, cfg);
        issues.push(issue);
    }
    return issues;
}
function clusterToIssue(cluster, claimMap, edges, rank, config) {
    // Get claims for this cluster
    const clusterClaims = cluster.claimIds
        .map(id => claimMap.get(id))
        .filter((c) => c !== undefined);
    // Detect category from topics and keywords
    const category = detectCategory(clusterClaims, config);
    // Detect flags
    const flags = detectFlags(clusterClaims, config);
    // Calculate risk score and severity
    const { riskScore, severity, drivers } = calculateRiskScore(cluster, flags, config);
    // Calculate confidence
    const { confidence, explanation } = calculateConfidence(cluster, edges);
    // Select evidence snippets
    const { primary, supporting } = selectEvidence(clusterClaims, cluster, config);
    // Generate narrative
    const narrative = generateNarrative(clusterClaims, cluster, category, flags);
    // Generate tags from topics
    const tags = Array.from(cluster.topics).slice(0, 5);
    // Calculate metrics
    const metrics = {
        contradictionMass: cluster.contradictionMass,
        supportMass: cluster.supportMass,
        groundingMass: cluster.groundingMass,
        centrality: calculateCentrality(cluster, edges),
        claimCount: cluster.claimIds.length,
        turnSpan: cluster.turnRange.max - cluster.turnRange.min + 1,
        recencyWeight: calculateRecency(cluster),
        riskScore,
        rank,
        drivers,
    };
    return {
        id: `issue_${cluster.id}`,
        title: narrative.title,
        category,
        severity,
        confidence,
        problemStatement: narrative.problemStatement,
        whyWrong: narrative.whyWrong,
        impact: narrative.impact,
        recommendedAction: narrative.recommendedAction,
        confidenceExplanation: explanation,
        primaryEvidence: primary,
        supportingEvidence: supporting,
        relatedClaimIds: cluster.claimIds,
        relatedEdgeIds: cluster.edgeIds,
        metrics,
        tags,
        createdAt: new Date().toISOString(),
        flags,
    };
}
// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================
function detectCategory(claims, config) {
    const scores = {};
    for (const claim of claims) {
        const text = claim.text.toLowerCase();
        for (const [category, keywords] of Object.entries(config.topicKeywords)) {
            for (const keyword of keywords) {
                if (text.includes(keyword.toLowerCase())) {
                    scores[category] = (scores[category] || 0) + 1;
                }
            }
        }
    }
    // Find highest scoring category
    let maxCategory = "OTHER";
    let maxScore = 0;
    for (const [category, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            maxCategory = category;
        }
    }
    return maxCategory;
}
function detectFlags(claims, config) {
    const flags = {};
    const allText = claims.map(c => c.text).join(" ");
    // Check red flag patterns
    for (const pattern of config.redFlagPatterns) {
        for (const regex of pattern.patterns) {
            if (new RegExp(regex, "i").test(allText)) {
                if (pattern.category === "PRIVACY" || pattern.category === "SECURITY") {
                    flags.sensitiveData = true;
                }
                if (pattern.category === "REGULATORY") {
                    flags.regulatoryRisk = true;
                }
            }
        }
    }
    // Check for financial impact
    const financialPatterns = /\$\d+|fee|charge|refund|payment|bill/i;
    if (financialPatterns.test(allText)) {
        flags.financialImpact = true;
    }
    // Check for explicit commitments
    const commitmentPatterns = /\bguarantee\b|\bpromise\b|\bwill never\b|\bwon't\b/i;
    if (commitmentPatterns.test(allText)) {
        flags.explicitCommitment = true;
    }
    return flags;
}
// ============================================================================
// RISK SCORING
// ============================================================================
function calculateRiskScore(cluster, flags, config) {
    const drivers = [];
    let score = 0;
    // Base score from contradiction mass
    score += cluster.contradictionMass * 20;
    if (cluster.contradictionMass > 0) {
        drivers.push(`${cluster.contradictionMass.toFixed(1)} contradiction mass`);
    }
    // Penalty for lack of grounding
    if (cluster.groundingMass === 0) {
        score += 15;
        drivers.push("Ungrounded claims");
    }
    // Apply flag multipliers
    if (flags?.sensitiveData) {
        score *= config.signalMultipliers.sensitiveData;
        drivers.push("Sensitive data detected");
    }
    if (flags?.financialImpact) {
        score *= config.signalMultipliers.financialImpact;
        drivers.push("Financial impact");
    }
    if (flags?.policyConflict) {
        score *= config.signalMultipliers.policyConflict;
        drivers.push("Policy conflict");
    }
    if (flags?.regulatoryRisk) {
        score *= config.signalMultipliers.regulatoryRisk;
        drivers.push("Regulatory risk");
    }
    if (flags?.explicitCommitment) {
        score *= config.signalMultipliers.explicitCommitment;
        drivers.push("Explicit commitment language");
    }
    // Agent statements carry more weight
    if (cluster.speakers.has("AGENT")) {
        score *= config.signalMultipliers.agentStatement;
    }
    // Cap at 100
    score = Math.min(100, Math.round(score));
    // Map to severity using thresholds
    let severity;
    if (score >= config.severityThresholds.critical) {
        severity = "CRITICAL";
    }
    else if (score >= config.severityThresholds.high) {
        severity = "HIGH";
    }
    else if (score >= config.severityThresholds.medium) {
        severity = "MEDIUM";
    }
    else {
        severity = "LOW";
    }
    // Apply escalation rules
    for (const rule of config.escalationRules) {
        const conditions = rule.conditions;
        let matches = true;
        if (conditions.sensitiveData !== undefined && flags?.sensitiveData !== conditions.sensitiveData) {
            matches = false;
        }
        if (conditions.financialImpact !== undefined && flags?.financialImpact !== conditions.financialImpact) {
            matches = false;
        }
        if (conditions.policyConflict !== undefined && flags?.policyConflict !== conditions.policyConflict) {
            matches = false;
        }
        if (conditions.regulatoryRisk !== undefined && flags?.regulatoryRisk !== conditions.regulatoryRisk) {
            matches = false;
        }
        if (conditions.ungrounded !== undefined && (cluster.groundingMass === 0) !== conditions.ungrounded) {
            matches = false;
        }
        if (conditions.contradictionMassMin !== undefined && cluster.contradictionMass < conditions.contradictionMassMin) {
            matches = false;
        }
        if (matches) {
            const severityOrder = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
            if (severityOrder[rule.minSeverity] > severityOrder[severity]) {
                severity = rule.minSeverity;
                drivers.push(`Escalated by rule: ${rule.description}`);
            }
        }
    }
    return { riskScore: score, severity, drivers };
}
function calculateConfidence(cluster, edges) {
    // Confidence based on evidence strength
    const hasContradictions = cluster.contradictionMass > 0;
    const hasMultipleClaims = cluster.claimIds.length >= 3;
    const hasEdges = cluster.edgeIds.length > 0;
    let confidenceScore = 0.5; // Base
    if (hasContradictions)
        confidenceScore += 0.25;
    if (hasMultipleClaims)
        confidenceScore += 0.15;
    if (hasEdges)
        confidenceScore += 0.1;
    let confidence;
    let explanation;
    if (confidenceScore >= 0.75) {
        confidence = "HIGH";
        explanation = "High confidence: direct contradiction between statements with strong evidence.";
    }
    else if (confidenceScore >= 0.45) {
        confidence = "MEDIUM";
        explanation = "Medium confidence: pattern detected but limited corroborating evidence.";
    }
    else {
        confidence = "LOW";
        explanation = "Low confidence: weak signals, recommend manual review.";
    }
    return { confidence, explanation };
}
function calculateCentrality(cluster, edges) {
    // Simple degree centrality
    const claimSet = new Set(cluster.claimIds);
    const clusterEdges = edges.filter(e => claimSet.has(e.fromClaimId) || claimSet.has(e.toClaimId));
    return cluster.claimIds.length > 0
        ? clusterEdges.length / cluster.claimIds.length
        : 0;
}
function calculateRecency(cluster) {
    // Higher recency for later turns
    return cluster.turnRange.max / Math.max(cluster.turnRange.max, 1);
}
// ============================================================================
// EVIDENCE SELECTION
// ============================================================================
function selectEvidence(claims, cluster, config) {
    // Sort claims by turn index for consistent ordering
    const sorted = [...claims].sort((a, b) => a.turnIndex - b.turnIndex);
    const primary = [];
    const supporting = [];
    for (let i = 0; i < sorted.length; i++) {
        const claim = sorted[i];
        const snippet = {
            speaker: claim.speaker,
            quote: claim.text,
            turnIndex: claim.turnIndex,
            timestampMs: claim.startMs,
            claimId: claim.id,
        };
        if (i < config.clustering.maxEvidenceSnippets) {
            primary.push(snippet);
        }
        else {
            supporting.push(snippet);
        }
    }
    return { primary, supporting };
}
function generateNarrative(claims, cluster, category, flags) {
    const topics = Array.from(cluster.topics).slice(0, 2);
    const topicStr = topics.length > 0 ? topics.join(" and ") : "conversation";
    // Title: "<Issue Type> about <Topic>"
    const categoryLabels = {
        BILLING: "Billing discrepancy",
        DISCLOSURE: "Missing disclosure",
        MISREPRESENTATION: "Conflicting information",
        PRIVACY: "Privacy concern",
        SECURITY: "Security issue",
        PROCESS: "Process gap",
        CUSTOMER_HARM: "Customer impact",
        REGULATORY: "Compliance risk",
        PROMISE_BREACH: "Unverified commitment",
        OTHER: "Issue identified",
    };
    const title = `${categoryLabels[category]} about ${topicStr}`;
    // Problem statement
    const hasContradiction = cluster.contradictionMass > 0;
    const hasMultipleSpeakers = cluster.speakers.size > 1;
    const turnSpan = cluster.turnRange.max - cluster.turnRange.min + 1;
    let problemStatement;
    if (hasContradiction) {
        problemStatement = `Conflicting statements were made about ${topicStr} across ${turnSpan} conversation turns. `;
        if (hasMultipleSpeakers) {
            problemStatement += `Both agent and customer made related statements that appear inconsistent.`;
        }
        else {
            problemStatement += `The agent made statements that appear to contradict each other.`;
        }
    }
    else {
        problemStatement = `Statements about ${topicStr} may require review. `;
        problemStatement += `Found ${cluster.claimIds.length} related claims across ${turnSpan} turns.`;
    }
    // Why wrong
    const whyWrong = [];
    if (hasContradiction) {
        whyWrong.push("Statements contain conflicting information that may confuse the customer.");
    }
    if (cluster.groundingMass === 0) {
        whyWrong.push("Claims are not grounded in policy documentation or knowledge base.");
    }
    if (flags?.explicitCommitment) {
        whyWrong.push("Explicit commitment language was used that may create binding expectations.");
    }
    if (flags?.financialImpact) {
        whyWrong.push("Financial terms were discussed that may have compliance implications.");
    }
    if (whyWrong.length === 0) {
        whyWrong.push("Pattern detected that warrants manual review.");
    }
    // Impact
    let impact = `This issue may affect customer trust and `;
    if (flags?.financialImpact) {
        impact += "could have financial implications for the customer or company.";
    }
    else if (flags?.regulatoryRisk) {
        impact += "may have regulatory compliance implications.";
    }
    else {
        impact += "could lead to customer confusion or escalation.";
    }
    // Recommended action
    const recommendedAction = [];
    if (hasContradiction) {
        recommendedAction.push("Review statements for accuracy and provide coaching on consistent messaging.");
    }
    if (cluster.groundingMass === 0) {
        recommendedAction.push("Link claims to relevant policy documentation or knowledge base articles.");
    }
    if (flags?.explicitCommitment) {
        recommendedAction.push("Coach agent on appropriate language for commitments and guarantees.");
    }
    recommendedAction.push("Document resolution and update training materials if pattern repeats.");
    return {
        title,
        problemStatement,
        whyWrong,
        impact,
        recommendedAction,
    };
}
