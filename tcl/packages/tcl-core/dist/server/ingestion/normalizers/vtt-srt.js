/**
 * VTT/SRT Normalizer
 *
 * Parses WebVTT (.vtt) and SubRip (.srt) subtitle formats.
 * These are commonly exported from contact center recording systems.
 *
 * Format examples:
 *
 * SRT:
 *   1
 *   00:00:01,000 --> 00:00:04,000
 *   Thank you for calling support.
 *
 * VTT:
 *   WEBVTT
 *
 *   00:00:01.000 --> 00:00:04.000
 *   Thank you for calling support.
 */
import { NORMALIZED_SCHEMA_VERSION, mapSpeakerToRole, generateChecksum, } from "../types.js";
/**
 * Parse VTT/SRT timestamp to milliseconds
 * Supports: 00:00:01.000 (VTT) and 00:00:01,000 (SRT)
 */
function parseTimestamp(timestamp) {
    // Normalize comma to period
    const normalized = timestamp.trim().replace(",", ".");
    // Parse HH:MM:SS.mmm or MM:SS.mmm
    const parts = normalized.split(":");
    let hours = 0, minutes = 0, secondsAndMs = "0";
    if (parts.length === 3) {
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
        secondsAndMs = parts[2];
    }
    else if (parts.length === 2) {
        minutes = parseInt(parts[0], 10);
        secondsAndMs = parts[1];
    }
    const [secondsStr, msStr = "0"] = secondsAndMs.split(".");
    const seconds = parseInt(secondsStr, 10);
    const ms = parseInt(msStr.padEnd(3, "0").substring(0, 3), 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;
}
/**
 * Detect speaker from text (common patterns)
 * Returns { speaker, cleanText }
 */
function extractSpeaker(text) {
    // Check for speaker prefix patterns
    const patterns = [
        /^<v\s+([^>]+)>\s*(.*)$/i, // VTT voice span: <v Speaker>text
        /^\[([A-Za-z][^:\]]{0,30})\]:\s*(.*)$/, // [Speaker]: text
        /^([A-Z][a-zA-Z]{0,20}):\s*(.+)$/, // Speaker: text (capitalized)
        /^-\s*([A-Za-z]+):\s*(.+)$/, // - Speaker: text
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return { speaker: match[1].trim(), cleanText: match[2].trim() };
        }
    }
    return { cleanText: text.trim() };
}
export class VTTSRTNormalizer {
    name = "vtt-srt";
    extensions = [".vtt", ".srt"];
    canHandle(fileMeta, headBytes) {
        const ext = fileMeta.filename.toLowerCase();
        if (!ext.endsWith(".vtt") && !ext.endsWith(".srt"))
            return false;
        const head = headBytes.toString("utf-8").substring(0, 500);
        // Check for VTT header
        if (head.includes("WEBVTT"))
            return true;
        // Check for SRT format (starts with number + timestamp)
        if (/^\s*\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(head))
            return true;
        return false;
    }
    async normalize(content, options) {
        const text = typeof content === "string" ? content : content.toString("utf-8");
        const warnings = [];
        // Detect format
        const isVTT = text.includes("WEBVTT");
        const sourceFormat = isVTT ? "vtt" : "srt";
        // Parse cues
        const cues = this.parseCues(text, isVTT);
        if (cues.length === 0) {
            warnings.push("No valid cues found in subtitle file");
            return {
                normalized: this.createEmptyConversation(content, sourceFormat),
                warnings,
                success: false,
            };
        }
        // Convert cues to turns
        const turns = [];
        const participantsMap = new Map();
        for (const cue of cues) {
            const { speaker, cleanText } = extractSpeaker(cue.text);
            // Skip empty cues
            if (!cleanText)
                continue;
            // Determine role
            let role = "unknown";
            let mappingDecision = "no speaker detected";
            if (speaker) {
                if (options.speakerOverrides?.[speaker]) {
                    role = options.speakerOverrides[speaker];
                    mappingDecision = `override: ${role}`;
                }
                else {
                    const mapping = mapSpeakerToRole(speaker);
                    role = mapping.role;
                    mappingDecision = mapping.mappingDecision;
                }
            }
            // Get or create participant
            const speakerLabel = speaker || "Speaker";
            const participantId = this.getOrCreateParticipant(participantsMap, speakerLabel, role);
            const turn = {
                turnIndex: turns.length,
                participantId,
                role,
                speakerLabel,
                text: cleanText,
                startTimeMs: cue.startMs,
                endTimeMs: cue.endMs,
                lineStart: cue.lineStart,
                lineEnd: cue.lineEnd,
                meta: {
                    rawSpeaker: speaker,
                    mappingDecision,
                    rawFields: {
                        cueIndex: cue.index,
                    },
                },
            };
            turns.push(turn);
        }
        // Merge consecutive turns from same speaker
        const mergedTurns = this.mergeConsecutiveTurns(turns, participantsMap);
        // Renumber turn indices
        mergedTurns.forEach((t, i) => t.turnIndex = i);
        const normalized = {
            schemaVersion: NORMALIZED_SCHEMA_VERSION,
            channel: "call",
            sourceFormat: sourceFormat,
            language: options.defaultLanguage || "en",
            timezone: options.defaultTimezone || "UTC",
            conversation: {},
            participants: Array.from(participantsMap.values()),
            turns: mergedTurns,
            attachments: [],
            raw: {
                checksum: generateChecksum(content),
                byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
                ingestedAt: new Date().toISOString(),
                originalFilename: "",
                heuristicsApplied: ["subtitle-parsing", sourceFormat],
            },
        };
        return {
            normalized,
            warnings,
            success: true,
        };
    }
    parseCues(text, isVTT) {
        const cues = [];
        const lines = text.split("\n");
        let currentCue = null;
        let cueTextLines = [];
        let cueLineStart = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const lineNumber = i + 1;
            // Skip VTT header and metadata
            if (isVTT && (line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE"))) {
                continue;
            }
            // Check for timestamp line
            const timestampMatch = line.match(/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
            if (timestampMatch) {
                // Save previous cue
                if (currentCue && cueTextLines.length > 0) {
                    cues.push({
                        index: currentCue.index || cues.length + 1,
                        startMs: currentCue.startMs || 0,
                        endMs: currentCue.endMs || 0,
                        text: cueTextLines.join(" ").trim(),
                        lineStart: cueLineStart,
                        lineEnd: lineNumber - 1,
                    });
                }
                // Start new cue
                currentCue = {
                    index: cues.length + 1,
                    startMs: parseTimestamp(timestampMatch[1]),
                    endMs: parseTimestamp(timestampMatch[2]),
                };
                cueTextLines = [];
                cueLineStart = lineNumber;
                continue;
            }
            // Check for SRT index line (just a number)
            if (!isVTT && /^\d+$/.test(line) && !currentCue) {
                // This is an SRT index, wait for timestamp
                continue;
            }
            // Empty line ends a cue
            if (!line) {
                if (currentCue && cueTextLines.length > 0) {
                    cues.push({
                        index: currentCue.index || cues.length + 1,
                        startMs: currentCue.startMs || 0,
                        endMs: currentCue.endMs || 0,
                        text: cueTextLines.join(" ").trim(),
                        lineStart: cueLineStart,
                        lineEnd: lineNumber - 1,
                    });
                }
                currentCue = null;
                cueTextLines = [];
                continue;
            }
            // Accumulate cue text
            if (currentCue) {
                // Strip non-voice HTML; keep WebVTT voice spans (<v Agent>...) for extractSpeaker().
                let textLine = line;
                if (!isVTT || !/^\s*<v\s/i.test(line)) {
                    textLine = line.replace(/<[^>]+>/g, "");
                }
                const trimmed = textLine.trim();
                if (trimmed) {
                    cueTextLines.push(trimmed);
                }
            }
        }
        // Don't forget last cue
        if (currentCue && cueTextLines.length > 0) {
            cues.push({
                index: currentCue.index || cues.length + 1,
                startMs: currentCue.startMs || 0,
                endMs: currentCue.endMs || 0,
                text: cueTextLines.join(" ").trim(),
                lineStart: cueLineStart,
                lineEnd: lines.length,
            });
        }
        return cues;
    }
    mergeConsecutiveTurns(turns, participantsMap) {
        if (turns.length <= 1)
            return turns;
        const merged = [];
        let current = turns[0];
        for (let i = 1; i < turns.length; i++) {
            const next = turns[i];
            // Merge if same speaker and within 2 seconds
            if (current.participantId === next.participantId &&
                current.endTimeMs !== undefined &&
                next.startTimeMs !== undefined &&
                next.startTimeMs - current.endTimeMs < 2000) {
                // Merge
                current = {
                    ...current,
                    text: current.text + " " + next.text,
                    endTimeMs: next.endTimeMs,
                    lineEnd: next.lineEnd,
                };
            }
            else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
        return merged;
    }
    getOrCreateParticipant(map, displayName, role) {
        for (const [id, p] of map) {
            if (p.displayName.toLowerCase() === displayName.toLowerCase()) {
                return id;
            }
        }
        const participantId = `p_${role}_${map.size + 1}`;
        map.set(participantId, {
            participantId,
            displayName,
            role,
        });
        return participantId;
    }
    createEmptyConversation(content, format) {
        return {
            schemaVersion: NORMALIZED_SCHEMA_VERSION,
            channel: "call",
            sourceFormat: format,
            language: "en",
            timezone: "UTC",
            conversation: {},
            participants: [],
            turns: [],
            attachments: [],
            raw: {
                checksum: generateChecksum(content),
                byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
                ingestedAt: new Date().toISOString(),
                originalFilename: "",
            },
        };
    }
}
export const vttSrtNormalizer = new VTTSRTNormalizer();
