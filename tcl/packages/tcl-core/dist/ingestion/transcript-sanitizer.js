import { isRecognizedTranscriptSpeaker } from "./speaker-role.js";
const INLINE_SPEAKER_BOUNDARY = /[ \t]+(Agent|Customer|Rep|Caller|Client|Prospect):/g;
const SPEAKER_PREFIX = /^([A-Za-z][A-Za-z0-9_ -]{0,30})\s*:\s*(.*)$/;
const ANNOTATION_PREFIXES = [
    "Risk Flag:",
    "Issue:",
    "Truthfulness:",
    "Safer Version:",
    "Safer Language:",
    "Clear Truths",
    "Risky / Misleading Claims",
    "High-Risk Compliance Language",
    "TCL Test Summary",
    "Call Type:",
    "Purpose:",
    "Scenario:",
    "Safer Version",
    "Risk Flag",
    "Issue",
    "Truthfulness",
];
const CONTAMINATION_PATTERNS = [
    /\bRisk Flag:/i,
    /\bTruthfulness:/i,
    /\bSafer Version:/i,
    /\bIssue:/i,
    /\bCustomer:/i,
    /\bAgent:/i,
    /\bRep:/i,
    /\bCaller:/i,
];
export function sanitizeTranscriptForScoring(input) {
    let normalizedInlineSpeakerBoundaries = 0;
    const withBoundaries = input.replace(INLINE_SPEAKER_BOUNDARY, (_match, speaker) => {
        normalizedInlineSpeakerBoundaries++;
        return `\n${speaker}:`;
    });
    const diagnostics = [];
    const kept = [];
    let removedAnnotationLines = 0;
    let unknownSpeakerLines = 0;
    let hasValidTurn = false;
    for (const rawLine of withBoundaries.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line)
            continue;
        if (/^(#{1,6}\s|---+$|```)/.test(line)) {
            removedAnnotationLines++;
            continue;
        }
        if (ANNOTATION_PREFIXES.some(prefix => line.toLowerCase().startsWith(prefix.toLowerCase()))) {
            removedAnnotationLines++;
            continue;
        }
        const speakerMatch = line.match(SPEAKER_PREFIX);
        if (speakerMatch) {
            const speaker = speakerMatch[1].trim();
            if (isRecognizedTranscriptSpeaker(speaker)) {
                kept.push(line);
                hasValidTurn = true;
            }
            else {
                unknownSpeakerLines++;
                diagnostics.push(`Dropped unrecognized speaker line: ${speaker}`);
                hasValidTurn = false;
            }
            continue;
        }
        if (hasValidTurn) {
            kept.push(line);
        }
        else {
            unknownSpeakerLines++;
        }
    }
    if (removedAnnotationLines > 0)
        diagnostics.push(`Removed ${removedAnnotationLines} annotation/non-transcript lines`);
    if (normalizedInlineSpeakerBoundaries > 0)
        diagnostics.push(`Normalized ${normalizedInlineSpeakerBoundaries} inline speaker boundaries`);
    if (unknownSpeakerLines > 0)
        diagnostics.push(`Dropped ${unknownSpeakerLines} unknown speaker/non-turn lines`);
    return {
        text: kept.join("\n"),
        removedAnnotationLines,
        normalizedInlineSpeakerBoundaries,
        unknownSpeakerLines,
        diagnostics,
    };
}
export function isContaminatedClaimText(text) {
    return CONTAMINATION_PATTERNS.some(pattern => pattern.test(text));
}
export function countSpeakerLabelsInClaim(text) {
    const matches = text.match(/\b(?:Agent|Customer|Rep|Caller|Client|Prospect|Lead|Representative):/gi);
    return matches?.length ?? 0;
}
