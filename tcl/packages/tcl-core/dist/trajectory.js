/**
 * Trajectory scoring for call transcripts
 *
 * Segments transcripts into windows and validates each segment,
 * producing a timeline of risk and identifying moments of instability.
 */
export async function computeTrajectory(input, validateOnce, adapter, options) {
    const windowTurns = options?.windowTurns ?? 3;
    const maxSegments = options?.maxSegments ?? 20;
    // Check if this is a transcript (has Agent:/Customer: markers)
    const isTranscript = /^(Agent|Customer|Rep|Caller):/im.test(input.question);
    if (!isTranscript) {
        return {
            enabled: false,
            segments: [],
            summary: {
                worstSegmentIndex: null,
                worstOverallScore: null,
                instability: 0,
                peakRiskImportanceSum: 0
            }
        };
    }
    // Split transcript into turns
    const turns = splitTurns(input.question);
    if (turns.length === 0) {
        return {
            enabled: false,
            segments: [],
            summary: {
                worstSegmentIndex: null,
                worstOverallScore: null,
                instability: 0,
                peakRiskImportanceSum: 0
            }
        };
    }
    // Create segments (windows of consecutive turns)
    const segments = [];
    const numSegments = Math.min(Math.ceil(turns.length / windowTurns), maxSegments);
    for (let segIdx = 0; segIdx < numSegments; segIdx++) {
        const startTurn = segIdx * windowTurns;
        const endTurn = Math.min(startTurn + windowTurns, turns.length);
        const segmentTurns = turns.slice(startTurn, endTurn);
        if (segmentTurns.length === 0)
            break;
        // Reconstruct segment text
        const segmentText = segmentTurns
            .map(t => `${t.speaker}: ${t.text}`)
            .join("\n");
        const textPreview = segmentText.length > 150
            ? segmentText.substring(0, 150) + "..."
            : segmentText;
        // Validate this segment
        const segmentInput = {
            question: segmentText,
            answer: "", // Empty answer so claim extraction uses question as transcript
            sources: input.sources,
            options: {
                ...input.options,
                spectral: input.options?.spectral ?? true
                // spectralMode removed - always uses /spectral/analyze
            }
        };
        try {
            const segmentResult = await validateOnce(segmentInput, adapter);
            const segment = {
                segmentIndex: segIdx,
                startTurn,
                endTurn: endTurn - 1,
                textPreview,
                scores: segmentResult.scores,
                spectral: segmentResult.report.spectral ? {
                    coherenceScore: segmentResult.report.spectral.coherenceScore,
                    contradictionEnergy: segmentResult.report.spectral.contradictionEnergy,
                    supportEnergy: segmentResult.report.spectral.supportEnergy,
                    circularityScore: segmentResult.report.spectral.circularityScore,
                    spectralGap: segmentResult.report.spectral.spectralGap,
                    cycleMass: segmentResult.report.spectral.cycleMass ?? 0,
                    heatTrace: segmentResult.report.spectral.heatTrace ?? [],
                    fingerprint: segmentResult.report.spectral.fingerprint
                } : undefined,
                destructiveClaimsTop: segmentResult.report.destructiveClaims?.slice(0, 5)
            };
            segments.push(segment);
        }
        catch (error) {
            console.error(`Error validating trajectory segment ${segIdx}:`, error);
            // Continue with next segment
        }
    }
    // Compute summary
    const overallScores = segments.map(s => s.scores.overall).filter(s => s !== null && s !== undefined);
    let worstSegmentIndex = null;
    let worstOverallScore = null;
    if (overallScores.length > 0) {
        worstOverallScore = Math.min(...overallScores);
        worstSegmentIndex = segments.findIndex(s => s.scores.overall === worstOverallScore);
    }
    // Compute instability (standard deviation of overall scores)
    let instability = 0;
    if (overallScores.length > 1) {
        const mean = overallScores.reduce((a, b) => a + b, 0) / overallScores.length;
        const variance = overallScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / overallScores.length;
        instability = Math.sqrt(variance);
    }
    // Compute peak risk importance sum
    let peakRiskImportanceSum = 0;
    for (const segment of segments) {
        if (segment.destructiveClaimsTop) {
            const sum = segment.destructiveClaimsTop.reduce((acc, dc) => acc + dc.importance, 0);
            peakRiskImportanceSum = Math.max(peakRiskImportanceSum, sum);
        }
    }
    return {
        enabled: true,
        segments,
        summary: {
            worstSegmentIndex,
            worstOverallScore,
            instability,
            peakRiskImportanceSum
        }
    };
}
function splitTurns(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const turns = [];
    let t = 0;
    for (const ln of lines) {
        let speaker = "Other";
        let body = ln;
        if (/^agent:/i.test(ln)) {
            speaker = "Agent";
            body = ln.replace(/^agent:\s*/i, "");
        }
        else if (/^customer:/i.test(ln)) {
            speaker = "Customer";
            body = ln.replace(/^customer:\s*/i, "");
        }
        else if (/^rep:/i.test(ln) || /^caller:/i.test(ln)) {
            speaker = "Agent"; // Treat rep/caller as agent
            body = ln.replace(/^(rep|caller):\s*/i, "");
        }
        if (body.length > 0) {
            turns.push({ speaker, turnIndex: t++, text: body });
        }
    }
    return turns;
}
