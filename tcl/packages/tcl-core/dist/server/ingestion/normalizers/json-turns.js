/**
 * JSON Turns Normalizer
 *
 * Parses JSON files with turn-based or message-based data.
 * Supports various common formats:
 *   - { turns: [...] }
 *   - { messages: [...] }
 *   - { transcript: { segments: [...] } }
 *   - Amazon Connect format
 *   - Array of turn objects
 */
import { NORMALIZED_SCHEMA_VERSION, mapSpeakerToRole, generateChecksum, } from "../types.js";
/**
 * Common field name mappings
 */
const TEXT_FIELDS = ["text", "content", "message", "utterance", "body", "transcript"];
const SPEAKER_FIELDS = ["speaker", "participant", "author", "from", "role", "sender", "user", "name", "participantId"];
const TIME_FIELDS = ["timestamp", "time", "start", "startTime", "start_time", "beginTime", "startMs"];
/**
 * Find a value in an object using multiple possible keys
 */
function findField(obj, keys) {
    for (const key of keys) {
        if (obj[key] !== undefined)
            return obj[key];
        // Try case-insensitive
        const lowerKey = key.toLowerCase();
        for (const objKey of Object.keys(obj)) {
            if (objKey.toLowerCase() === lowerKey)
                return obj[objKey];
        }
    }
    return undefined;
}
/**
 * Parse time value to milliseconds
 */
function parseTime(val) {
    if (typeof val === "number") {
        if (!Number.isFinite(val))
            return undefined;
        // Fractional values are seconds (e.g. 1.25 → 1250ms).
        if (val % 1 !== 0)
            return Math.round(val * 1000);
        // Integer offsets in JSON fixtures are relative milliseconds (1000 = 1s into the call).
        return Math.round(val);
    }
    if (typeof val === "string") {
        const num = parseFloat(val);
        if (!isNaN(num)) {
            return num < 100000 ? Math.round(num * 1000) : Math.round(num);
        }
        try {
            return new Date(val).getTime();
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
export class JSONTurnsNormalizer {
    name = "json-turns";
    extensions = [".json"];
    canHandle(fileMeta, headBytes) {
        const ext = fileMeta.filename.toLowerCase();
        if (!ext.endsWith(".json"))
            return false;
        try {
            const text = headBytes.toString("utf-8");
            JSON.parse(text);
            return true;
        }
        catch {
            // Try to detect if it's truncated JSON
            return headBytes.toString("utf-8").trim().startsWith("{") ||
                headBytes.toString("utf-8").trim().startsWith("[");
        }
    }
    async normalize(content, options) {
        const text = typeof content === "string" ? content : content.toString("utf-8");
        const warnings = [];
        let data;
        try {
            data = JSON.parse(text);
        }
        catch (e) {
            return {
                normalized: this.createEmptyConversation(content),
                warnings: [`Failed to parse JSON: ${e.message}`],
                success: false,
            };
        }
        // Detect structure and extract turns
        const { turns: rawTurns, format } = this.extractTurns(data);
        if (rawTurns.length === 0) {
            warnings.push("No turns/messages found in JSON structure");
            return {
                normalized: this.createEmptyConversation(content),
                warnings,
                success: false,
            };
        }
        const turns = [];
        const participantsMap = new Map();
        for (let i = 0; i < rawTurns.length; i++) {
            const rawTurn = rawTurns[i];
            const turnText = findField(rawTurn, TEXT_FIELDS);
            if (!turnText || typeof turnText !== "string")
                continue;
            const rawSpeaker = findField(rawTurn, SPEAKER_FIELDS);
            const speakerStr = typeof rawSpeaker === "string" ? rawSpeaker :
                typeof rawSpeaker === "object" && rawSpeaker?.name ? rawSpeaker.name :
                    String(rawSpeaker || "Unknown");
            // Determine role
            let role;
            let mappingDecision;
            if (options.speakerOverrides?.[speakerStr]) {
                role = options.speakerOverrides[speakerStr];
                mappingDecision = `override: ${role}`;
            }
            else {
                const mapping = mapSpeakerToRole(speakerStr);
                role = mapping.role;
                mappingDecision = mapping.mappingDecision;
            }
            // Get or create participant
            const participantId = this.getOrCreateParticipant(participantsMap, speakerStr, role);
            // Parse time
            const timeVal = findField(rawTurn, TIME_FIELDS);
            const startTimeMs = parseTime(timeVal);
            const turn = {
                turnIndex: turns.length,
                participantId,
                role,
                speakerLabel: speakerStr,
                text: turnText.trim(),
                startTimeMs,
                meta: {
                    rawSpeaker: speakerStr,
                    rawFields: rawTurn,
                    mappingDecision,
                },
            };
            // Handle index if present
            if (rawTurn.index !== undefined || rawTurn.turnIndex !== undefined) {
                turn.meta.rawFields = { ...turn.meta.rawFields, originalIndex: rawTurn.index ?? rawTurn.turnIndex };
            }
            turns.push(turn);
        }
        // Extract conversation metadata
        const conversationMeta = this.extractConversationMeta(data);
        const normalized = {
            schemaVersion: NORMALIZED_SCHEMA_VERSION,
            channel: this.detectChannel(data),
            sourceFormat: format,
            language: data.language || options.defaultLanguage || "en",
            timezone: data.timezone || options.defaultTimezone || "UTC",
            conversation: conversationMeta,
            participants: Array.from(participantsMap.values()),
            turns,
            attachments: [],
            raw: {
                checksum: generateChecksum(content),
                byteSize: typeof content === "string" ? Buffer.byteLength(content) : content.length,
                ingestedAt: new Date().toISOString(),
                originalFilename: "",
                heuristicsApplied: [`json-format:${format}`],
            },
        };
        return {
            normalized,
            warnings,
            success: true,
        };
    }
    extractTurns(data) {
        // Check for array at root
        if (Array.isArray(data)) {
            return { turns: data, format: "json" };
        }
        // Check common nested structures
        if (data.turns && Array.isArray(data.turns)) {
            return { turns: data.turns, format: "json" };
        }
        if (data.messages && Array.isArray(data.messages)) {
            return { turns: data.messages, format: "json" };
        }
        if (data.transcript?.segments && Array.isArray(data.transcript.segments)) {
            return { turns: data.transcript.segments, format: "vendor:amazon_connect" };
        }
        if (data.Transcript?.Segments && Array.isArray(data.Transcript.Segments)) {
            // Amazon Connect format
            return {
                turns: data.Transcript.Segments.map((s) => ({
                    text: s.Content,
                    speaker: s.ParticipantId,
                    startTime: s.BeginOffsetMillis,
                    endTime: s.EndOffsetMillis,
                })),
                format: "vendor:amazon_connect"
            };
        }
        if (data.conversation?.turns && Array.isArray(data.conversation.turns)) {
            return { turns: data.conversation.turns, format: "json" };
        }
        if (data.dialogue && Array.isArray(data.dialogue)) {
            return { turns: data.dialogue, format: "json" };
        }
        return { turns: [], format: "json" };
    }
    extractConversationMeta(data) {
        const meta = {};
        if (data.id || data.conversationId || data.sessionId) {
            meta.externalId = data.id || data.conversationId || data.sessionId;
        }
        if (data.title || data.name || data.subject) {
            meta.title = data.title || data.name || data.subject;
        }
        if (data.startTime || data.startedAt || data.createdAt) {
            const dt = data.startTime || data.startedAt || data.createdAt;
            meta.startedAt = typeof dt === "string" ? dt : new Date(dt).toISOString();
        }
        if (data.endTime || data.endedAt) {
            const dt = data.endTime || data.endedAt;
            meta.endedAt = typeof dt === "string" ? dt : new Date(dt).toISOString();
        }
        return meta;
    }
    detectChannel(data) {
        const channelHints = [data.channel, data.type, data.source, data.medium].filter(Boolean);
        for (const hint of channelHints) {
            const lower = String(hint).toLowerCase();
            if (lower.includes("call") || lower.includes("voice") || lower.includes("phone")) {
                return "call";
            }
            if (lower.includes("chat") || lower.includes("message") || lower.includes("web")) {
                return "chat";
            }
            if (lower.includes("email")) {
                return "email";
            }
        }
        return "other";
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
    createEmptyConversation(content) {
        return {
            schemaVersion: NORMALIZED_SCHEMA_VERSION,
            channel: "other",
            sourceFormat: "json",
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
export const jsonTurnsNormalizer = new JSONTurnsNormalizer();
