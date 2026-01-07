/**
 * Topic Segmentation
 *
 * Segments claims into topic clusters to enforce:
 * - CONTRADICTION edges only within the same topic
 * - SUPPORT edges across topics only with strict slot match
 *
 * This prevents nonsense edges across unrelated topics.
 */
import { getTemplateConfig } from './template-config.js';
import { slotsMatch, computeSlotSimilarity } from './subject-slot.js';
// =============================================================================
// MAIN SEGMENTATION FUNCTION
// =============================================================================
export function assignTopicIds(claims) {
    const config = getTemplateConfig();
    const method = config.topicSegmentation.method;
    switch (method) {
        case 'slot':
            return segmentBySlot(claims);
        case 'semantic':
            return segmentBySemantic(claims);
        case 'window':
            return segmentByWindow(claims, config.topicSegmentation.turnWindow);
        case 'hybrid':
        default:
            return segmentHybrid(claims, config.topicSegmentation);
    }
}
// =============================================================================
// SLOT-BASED SEGMENTATION (Primary method)
// =============================================================================
function segmentBySlot(claims) {
    const clusterMap = new Map();
    for (const claim of claims) {
        const key = `${claim.slot.slotType}`;
        if (!clusterMap.has(key)) {
            clusterMap.set(key, []);
        }
        clusterMap.get(key).push(claim);
    }
    return buildClustersFromMap(clusterMap);
}
// =============================================================================
// SEMANTIC SEGMENTATION
// =============================================================================
function segmentBySemantic(claims) {
    // Simple greedy clustering based on text similarity
    const clusters = [];
    const assigned = new Set();
    for (const claim of claims) {
        if (assigned.has(claim.id))
            continue;
        // Find or create cluster
        let bestCluster = null;
        let bestScore = 0;
        for (const cluster of clusters) {
            const avgSimilarity = computeAverageSimilarity(claim, cluster);
            if (avgSimilarity > bestScore && avgSimilarity > 0.4) {
                bestScore = avgSimilarity;
                bestCluster = cluster;
            }
        }
        if (bestCluster) {
            bestCluster.push(claim);
        }
        else {
            clusters.push([claim]);
        }
        assigned.add(claim.id);
    }
    return buildClustersFromArray(clusters);
}
// =============================================================================
// WINDOW-BASED SEGMENTATION
// =============================================================================
function segmentByWindow(claims, windowSize) {
    // Group by turn proximity
    const sorted = [...claims].sort((a, b) => {
        const turnA = parseTurnIndex(a.span.turnId);
        const turnB = parseTurnIndex(b.span.turnId);
        return turnA - turnB;
    });
    const clusters = [];
    let currentCluster = [];
    let lastTurn = -windowSize;
    for (const claim of sorted) {
        const turn = parseTurnIndex(claim.span.turnId);
        if (turn - lastTurn > windowSize && currentCluster.length > 0) {
            clusters.push(currentCluster);
            currentCluster = [];
        }
        currentCluster.push(claim);
        lastTurn = turn;
    }
    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }
    return buildClustersFromArray(clusters);
}
// =============================================================================
// HYBRID SEGMENTATION (Recommended)
// =============================================================================
function segmentHybrid(claims, config) {
    // Step 1: Initial slot-based clustering
    const slotClusters = new Map();
    for (const claim of claims) {
        const key = `${claim.slot.slotType}:${claim.slot.entityKey}`;
        if (!slotClusters.has(key)) {
            slotClusters.set(key, []);
        }
        slotClusters.get(key).push(claim);
    }
    // Step 2: Merge small clusters with compatible larger ones
    const mergedClusters = [];
    const smallClusters = [];
    for (const [key, clusterClaims] of slotClusters.entries()) {
        if (clusterClaims.length >= config.minClaimsPerTopic) {
            mergedClusters.push(clusterClaims);
        }
        else {
            smallClusters.push(clusterClaims);
        }
    }
    // Try to merge small clusters
    for (const small of smallClusters) {
        let merged = false;
        for (const large of mergedClusters) {
            // Check slot compatibility
            if (small[0].slot.slotType === large[0].slot.slotType) {
                // Check temporal proximity
                const smallTurns = small.map(c => parseTurnIndex(c.span.turnId));
                const largeTurns = large.map(c => parseTurnIndex(c.span.turnId));
                const smallMin = Math.min(...smallTurns);
                const smallMax = Math.max(...smallTurns);
                const largeMin = Math.min(...largeTurns);
                const largeMax = Math.max(...largeTurns);
                // Check if turns overlap or are within window
                if ((smallMin >= largeMin - config.turnWindow && smallMin <= largeMax + config.turnWindow) ||
                    (smallMax >= largeMin - config.turnWindow && smallMax <= largeMax + config.turnWindow)) {
                    large.push(...small);
                    merged = true;
                    break;
                }
            }
        }
        if (!merged) {
            // Create new cluster for small group
            mergedClusters.push(small);
        }
    }
    return buildClustersFromArray(mergedClusters);
}
// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
function parseTurnIndex(turnId) {
    const match = turnId.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
}
function computeAverageSimilarity(claim, cluster) {
    if (cluster.length === 0)
        return 0;
    let totalSimilarity = 0;
    for (const other of cluster) {
        totalSimilarity += computeSlotSimilarity(claim.slot, other.slot);
    }
    return totalSimilarity / cluster.length;
}
function buildClustersFromMap(clusterMap) {
    const clusters = [];
    const claimTopicMap = new Map();
    const topicNodes = [];
    let index = 0;
    for (const [key, clusterClaims] of clusterMap.entries()) {
        const clusterId = `topic-${index++}`;
        const slotTypes = [...new Set(clusterClaims.map(c => c.slot.slotType))];
        const entityKeys = [...new Set(clusterClaims.map(c => c.slot.entityKey))];
        const turns = clusterClaims.map(c => parseTurnIndex(c.span.turnId));
        const cluster = {
            id: clusterId,
            label: key,
            slotTypes,
            entityKeys,
            claimIds: clusterClaims.map(c => c.id),
            turnRange: {
                start: Math.min(...turns),
                end: Math.max(...turns),
            },
        };
        clusters.push(cluster);
        // Update claim topic IDs
        for (const claim of clusterClaims) {
            claimTopicMap.set(claim.id, clusterId);
            claim.topicId = clusterId;
        }
        // Create topic node
        topicNodes.push({
            id: clusterId,
            type: 'TOPIC',
            label: slotTypes.join(', '),
            slotTypes,
            createdAt: new Date().toISOString(),
        });
    }
    return { clusters, claimTopicMap, topicNodes };
}
function buildClustersFromArray(clusterArrays) {
    const clusters = [];
    const claimTopicMap = new Map();
    const topicNodes = [];
    for (let i = 0; i < clusterArrays.length; i++) {
        const clusterClaims = clusterArrays[i];
        if (clusterClaims.length === 0)
            continue;
        const clusterId = `topic-${i}`;
        const slotTypes = [...new Set(clusterClaims.map(c => c.slot.slotType))];
        const entityKeys = [...new Set(clusterClaims.map(c => c.slot.entityKey))];
        const turns = clusterClaims.map(c => parseTurnIndex(c.span.turnId));
        const cluster = {
            id: clusterId,
            label: slotTypes.join(' + '),
            slotTypes,
            entityKeys,
            claimIds: clusterClaims.map(c => c.id),
            turnRange: {
                start: Math.min(...turns),
                end: Math.max(...turns),
            },
        };
        clusters.push(cluster);
        // Update claim topic IDs
        for (const claim of clusterClaims) {
            claimTopicMap.set(claim.id, clusterId);
            claim.topicId = clusterId;
        }
        // Create topic node
        topicNodes.push({
            id: clusterId,
            type: 'TOPIC',
            label: slotTypes.join(', '),
            slotTypes,
            createdAt: new Date().toISOString(),
        });
    }
    return { clusters, claimTopicMap, topicNodes };
}
// =============================================================================
// TOPIC GATING
// =============================================================================
export function topicsMatch(topicA, topicB) {
    // If either topic is undefined, allow (can't gate)
    if (!topicA || !topicB)
        return true;
    return topicA === topicB;
}
export function canCreateContradictionEdge(claimA, claimB, requireSameTopic) {
    // Slot match is always required
    if (!slotsMatch(claimA.slot, claimB.slot)) {
        return false;
    }
    // Topic match if required
    if (requireSameTopic && !topicsMatch(claimA.topicId, claimB.topicId)) {
        return false;
    }
    return true;
}
export function canCreateSupportEdge(claimA, claimB, allowCrossTopicOnlyOnStrictSlotMatch) {
    // Same topic: always allowed
    if (topicsMatch(claimA.topicId, claimB.topicId)) {
        return true;
    }
    // Cross-topic: only if strict slot match
    if (allowCrossTopicOnlyOnStrictSlotMatch) {
        return slotsMatch(claimA.slot, claimB.slot);
    }
    // Cross-topic allowed without restriction
    return true;
}
