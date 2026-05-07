/**
 * Speaker Role Mapper
 *
 * Normalizes transcript speakers to canonical roles (REPRESENTATIVE | CUSTOMER | THIRD_PARTY | UNKNOWN)
 *
 * This is the single source of truth for role assignment per conversation.
 * The mapping is computed once and stored in conversation.metadata.speakerRoleMap.
 */
import { mapSpeakerToRole } from '../ingestion/speaker-role.js';
/**
 * Build speaker role map for a conversation
 *
 * Priority (STRICT ORDER):
 * 1. Explicit labels (agent, rep, customer, client, etc.)
 * 2. Template defaults (optional future use)
 * 3. Two-speaker heuristic (if exactly 2 speakers)
 * 4. Fallback to UNKNOWN
 */
export function buildSpeakerRoleMap(transcriptTurns, templateId) {
    const speakerRoleMap = {};
    const speakers = new Set();
    const speakerTexts = {};
    // Collect all speakers and their texts
    for (const turn of transcriptTurns) {
        const speaker = turn.speaker.trim();
        if (!speaker)
            continue;
        speakers.add(speaker);
        if (!speakerTexts[speaker]) {
            speakerTexts[speaker] = [];
        }
        speakerTexts[speaker].push(turn.text);
    }
    // Step 1: Explicit label matching
    for (const speaker of speakers) {
        const role = inferRoleFromLabel(speaker);
        if (role !== 'UNKNOWN') {
            speakerRoleMap[speaker] = role;
        }
    }
    // Step 2: Template defaults (future use - for now, skip)
    // Could add template-specific rules here, e.g., legal template: "Attorney" -> REPRESENTATIVE
    // Step 3: Two-speaker heuristic
    const unmappedSpeakers = Array.from(speakers).filter(s => !speakerRoleMap[s]);
    if (unmappedSpeakers.length === 2 && speakers.size === 2) {
        // Exactly two speakers, both unmapped
        const [speaker1, speaker2] = unmappedSpeakers;
        const role1 = inferRoleFromContent(speakerTexts[speaker1], speakerTexts[speaker2]);
        const role2 = role1 === 'REPRESENTATIVE' ? 'CUSTOMER' : 'REPRESENTATIVE';
        speakerRoleMap[speaker1] = role1;
        speakerRoleMap[speaker2] = role2;
    }
    else {
        // Step 4: Fallback to UNKNOWN for unmapped speakers
        for (const speaker of unmappedSpeakers) {
            speakerRoleMap[speaker] = 'UNKNOWN';
        }
    }
    return speakerRoleMap;
}
/**
 * Infer role from speaker label (explicit patterns)
 */
function inferRoleFromLabel(speaker) {
    const mapped = mapSpeakerToRole(speaker);
    if (mapped.role === 'agent' || mapped.role === 'supervisor')
        return 'REPRESENTATIVE';
    if (mapped.role === 'customer')
        return 'CUSTOMER';
    if (mapped.role === 'bot' || mapped.role === 'system')
        return 'THIRD_PARTY';
    return 'UNKNOWN';
}
/**
 * Infer role from content when two speakers are present
 * Chooses REPRESENTATIVE as the speaker with more policy/commitment language or longer turns
 */
function inferRoleFromContent(texts1, texts2) {
    const avgLength1 = texts1.reduce((sum, t) => sum + t.length, 0) / texts1.length;
    const avgLength2 = texts2.reduce((sum, t) => sum + t.length, 0) / texts2.length;
    // Count policy/commitment language indicators
    const policyPatterns = [
        /\b(?:policy|procedure|process|guideline|rule|regulation)\b/i,
        /\b(?:can|will|shall|must|should|guarantee|promise|commit)\b/i,
        /\b(?:according\s*to|per|as\s*per|based\s*on)\b/i,
        /\b(?:let\s*me|i\s*can|i\s*will|i\s*'ll)\b/i,
    ];
    let policyCount1 = 0;
    let policyCount2 = 0;
    for (const text of texts1) {
        for (const pattern of policyPatterns) {
            if (pattern.test(text)) {
                policyCount1++;
                break;
            }
        }
    }
    for (const text of texts2) {
        for (const pattern of policyPatterns) {
            if (pattern.test(text)) {
                policyCount2++;
                break;
            }
        }
    }
    // Choose REPRESENTATIVE based on:
    // 1. More policy language (stronger signal)
    // 2. Longer average turns (if policy counts are equal)
    if (policyCount1 > policyCount2) {
        return 'REPRESENTATIVE';
    }
    else if (policyCount2 > policyCount1) {
        return 'CUSTOMER'; // speaker2 is rep, so speaker1 is customer
    }
    else if (avgLength1 > avgLength2) {
        return 'REPRESENTATIVE';
    }
    else {
        return 'CUSTOMER'; // speaker2 is rep, so speaker1 is customer
    }
}
/**
 * Get role for a speaker from the map, with fallback
 */
export function getRoleForSpeaker(speaker, speakerRoleMap) {
    return speakerRoleMap[speaker] || 'UNKNOWN';
}
