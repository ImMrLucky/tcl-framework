import { mapSpeakerToRole, speakerRoleToDisplay } from "./ingestion/speaker-role.js";
import { countSpeakerLabelsInClaim, isContaminatedClaimText, sanitizeTranscriptForScoring } from "./ingestion/transcript-sanitizer.js";
// Claims that should be included in the graph for NLI/Spectral analysis
const AUDITABLE_CLAIM_TYPES = [
    "ASSERTION",
    "PROMISE",
    "POLICY_STATEMENT",
    "DISCLAIMER"
];
export function isAuditableClaimType(type) {
    return AUDITABLE_CLAIM_TYPES.includes(type);
}
// ============================================================================
// CLAIM TYPE CLASSIFICATION PATTERNS (Rule-Based, No ML Required)
// ============================================================================
// Questions and Requests (NOT auditable)
const QUESTION_PATTERNS = [
    /\?$/, // Ends with question mark
    /^(why|what|how|when|where|who|which)\s/i, // Starts with interrogative
    /^(can you|could you|would you|will you)\s/i, // Request phrases
    /^(do you|does|did|are you|is there|was)\s/i, // Yes/no question starters
];
const REQUEST_PATTERNS = [
    /^(please|can you|could you|would you|i('d| would) like)\s/i,
    /^(send me|email me|give me|tell me|show me)\s/i,
    /^(i want|i need)\s/i,
];
// Acknowledgement and Filler (NOT auditable)
const ACKNOWLEDGEMENT_PATTERNS = [
    /^(i understand|i see|i hear you|i get it|i know)\b/i,
    /^(i'm sorry|i apologize|sorry to hear|apologies)\b/i,
    /^(thank you|thanks|thank)\b/i,
    /^(okay|ok|alright|sure|right|gotcha|got it)\b/i,
    /^(yes|yeah|yep|no|nope|uh|um|hmm|ah)\b/i,
    /^(absolutely|definitely|certainly|of course)\b/i,
];
const FILLER_PATTERNS = [
    /^(hi|hello|hey|good morning|good afternoon|good evening)\b/i,
    /^(how can i help|how may i assist|what can i do)\b/i,
    /^(have a (good|great|nice) day|take care|goodbye|bye)\b/i,
    /^(let me|one moment|just a moment|give me a second)\b/i,
];
// Promise indicators (AUDITABLE - high importance)
const PROMISE_PATTERNS = [
    /\b(i will|i'll|we will|we'll)\s/i,
    /\b(i can|we can|i am able to|we are able to)\s/i,
    /\b(i('ll| will) make sure|i('ll| will) ensure)\s/i,
    /\b(i promise|i guarantee|you have my word)\b/i,
    /\b(expect to receive|you('ll| will) receive|you('ll| will) get)\b/i,
    /\b(right after this call|today|within \d+|by the end of)\b/i,
];
// Policy/Contract references (AUDITABLE - high importance)
const POLICY_PATTERNS = [
    /\b(service agreement|terms and conditions|terms of service|contract)\b/i,
    /\b(policy|policies|guidelines|rules)\b/i,
    /\b(outlined in|according to|as stated in|per the)\b/i,
    /\b(promotional period|trial period|agreement period)\b/i,
];
// Disclaimer indicators (AUDITABLE)
const DISCLAIMER_PATTERNS = [
    /\b(subject to|may apply|may vary|may change)\b/i,
    /\b(depending on|in some cases|in certain cases)\b/i,
    /\b(please note|please be aware|be advised|just to clarify)\b/i,
    /\b(exclusions|limitations|restrictions)\b/i,
    /\b(there may be|there might be|could be)\b/i,
];
// High-stakes assertion topics (billing, fees, penalties - AUDITABLE)
const HIGH_STAKES_PATTERNS = [
    /\b(fee|fees|charge|charges|cost|costs|price|payment)\b/i,
    /\b(cancel|cancellation|terminate|termination)\b/i,
    /\b(penalty|penalties|fine|fines)\b/i,
    /\b(refund|credit|billing|bill|invoice)\b/i,
    /\$[\d,]+|\d+\s*(dollars?|cents?)/i, // Money mentions
    /\b(free|no charge|no fee|no cost|at no)\b/i,
    /\b(always|never|guaranteed|definitely|absolutely)\b/i, // Absolute language
    /\b(rate|rates|plan|plans|pricing)\b/i,
    /\b(approval|approved|denied|denial|qualify|eligibility|carrier|underwriting)\b/i,
    /\b(coverage|death benefit|payout|beneficiary|premium|policy|waiting period)\b/i,
    /\b(graded|modified|guaranteed issue|level benefit|medical exam|prescription)\b/i,
    /\b(health condition|diabetes|cancer|heart attack|oxygen|hospitalization)\b/i,
    /\b(claim|contestability|lapse|licensed|state license|privacy|data sharing)\b/i,
];
// ============================================================================
// CLASSIFICATION FUNCTION
// ============================================================================
export function classifyClaimType(text, speaker) {
    const trimmed = text.trim();
    const mappedSpeaker = speaker ? mapSpeakerToRole(speaker) : undefined;
    const isAgent = mappedSpeaker?.role === "agent" || mappedSpeaker?.role === "supervisor";
    const hasHighStakesContent = HIGH_STAKES_PATTERNS.some(pattern => pattern.test(trimmed));
    // 1. Check for questions first (highest priority for non-auditable)
    for (const pattern of QUESTION_PATTERNS) {
        if (pattern.test(trimmed)) {
            return "QUESTION";
        }
    }
    // 2. Check for requests (primarily from customers)
    for (const pattern of REQUEST_PATTERNS) {
        if (pattern.test(trimmed)) {
            return "REQUEST";
        }
    }
    // 3. Check for acknowledgements (short empathy phrases)
    // Only classify as acknowledgement if the text is relatively short
    if (trimmed.length < 60 && !hasHighStakesContent) {
        for (const pattern of ACKNOWLEDGEMENT_PATTERNS) {
            if (pattern.test(trimmed)) {
                return "ACKNOWLEDGEMENT";
            }
        }
    }
    // 4. Check for filler (greetings, pleasantries)
    if (trimmed.length < 80 && !hasHighStakesContent) {
        for (const pattern of FILLER_PATTERNS) {
            if (pattern.test(trimmed)) {
                return "FILLER";
            }
        }
    }
    // --- AUDITABLE TYPES BELOW ---
    // 5. Check for promises (agent commitments)
    if (isAgent) {
        for (const pattern of PROMISE_PATTERNS) {
            if (pattern.test(trimmed)) {
                return "PROMISE";
            }
        }
    }
    // 6. Check for policy/contract references
    for (const pattern of POLICY_PATTERNS) {
        if (pattern.test(trimmed)) {
            return "POLICY_STATEMENT";
        }
    }
    // 7. Check for disclaimers
    for (const pattern of DISCLAIMER_PATTERNS) {
        if (pattern.test(trimmed)) {
            return "DISCLAIMER";
        }
    }
    // 8. Default: if it's a declarative statement (not too short), it's an assertion
    // Very short statements without high-stakes content are likely filler
    if (trimmed.length < 15 && !hasHighStakesContent) {
        return "FILLER";
    }
    // Check if it contains high-stakes content
    if (hasHighStakesContent)
        return "ASSERTION";
    // If agent makes a declarative statement, treat as assertion
    if (isAgent && trimmed.length > 20) {
        return "ASSERTION";
    }
    // Customer statements that are declarative (not questions/requests) 
    // are also assertions (e.g., "I was told...")
    if (trimmed.length > 25) {
        return "ASSERTION";
    }
    // Default to filler for short, non-specific content
    return "FILLER";
}
// Topic detection patterns
const TOPIC_PATTERNS = {
    billing: /\b(bill|billing|invoice|payment|charge|charged)\b/i,
    fee: /\b(fee|fees|cost|costs|price|pricing)\b/i,
    cancel: /\b(cancel|cancellation|terminate|termination)\b/i,
    refund: /\b(refund|credit|reimburse|reimbursement)\b/i,
    penalty: /\b(penalty|penalties|fine|fines|early termination)\b/i,
    plan: /\b(plan|plans|rate|rates|subscription)\b/i,
    promise: /\b(promise|guarantee|assured|assure)\b/i,
    account: /\b(account|profile|settings)\b/i,
    final_expense: /\b(final expense|burial|funeral|death benefit|beneficiary|payout)\b/i,
    insurance_approval: /\b(approval|approved|qualify|eligibility|denial|denied|underwriting|carrier)\b/i,
    insurance_policy: /\b(policy|premium|coverage|waiting period|graded|modified|level benefit|guaranteed issue)\b/i,
    health_underwriting: /\b(diabetes|cancer|heart attack|oxygen|hospitalization|prescription|medical exam|health condition)\b/i,
    privacy_license: /\b(licensed|state license|privacy|data sharing)\b/i,
};
export function extractTopics(text) {
    const topics = [];
    for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
        if (pattern.test(text)) {
            topics.push(topic);
        }
    }
    return topics;
}
export function hasAbsoluteLanguage(text) {
    return /\b(always|never|guaranteed|definitely|absolutely|no way|any time|100%)\b/i.test(text);
}
export function hasMoney(text) {
    return /\$[\d,]+|\d+\s*(dollars?|cents?)/i.test(text);
}
function splitSentences(text) {
    return text
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}
function splitTurns(text) {
    const sanitized = sanitizeTranscriptForScoring(text);
    const lines = sanitized.text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const turns = [];
    let t = 0;
    for (const ln of lines) {
        let speaker = "Other";
        let body = ln;
        let speakerType = "unknown";
        let speakerLabel = "Unknown";
        let rawSpeaker = "Unknown";
        const match = ln.match(/^([A-Za-z][A-Za-z0-9_ -]{0,30})\s*:\s*(.*)$/);
        if (match) {
            rawSpeaker = match[1].trim();
            body = match[2].trim();
            const mapped = mapSpeakerToRole(rawSpeaker);
            speakerType = mapped.role;
            speakerLabel = rawSpeaker;
            const display = speakerRoleToDisplay(speakerType);
            speaker = display === "Agent" || display === "Supervisor"
                ? "Agent"
                : display === "Customer"
                    ? "Customer"
                    : "Other";
        }
        if (body.length > 0) {
            turns.push({ speaker, speakerType, speakerLabel, rawSpeaker, turnIndex: t++, text: body });
        }
    }
    return turns;
}
function isTranscript(text) {
    return /^(Agent|Customer|Rep|Representative|Advisor|Producer|Caller|Client|Prospect|Lead|Consumer|Senior|Bot|System):/im.test(text);
}
/**
 * Extract claims from text with speech-act classification.
 * Returns only AUDITABLE claims by default (ASSERTION, PROMISE, POLICY_STATEMENT, DISCLAIMER).
 *
 * Key changes from original:
 * - NO hard-coded confidence values
 * - Claims are classified by type
 * - Non-auditable items (questions, acknowledgements, filler) are filtered out
 * - Topic tags and risk signals are extracted
 */
export function extractClaimsWithTypes(text) {
    const sanitized = sanitizeTranscriptForScoring(text);
    const sourceText = sanitized.text || text;
    const isTrans = isTranscript(sourceText);
    console.log(`📝 Extracting claims: isTranscript=${isTrans}, text length=${sourceText.length}`);
    const allItems = [];
    const stats = {
        total: 0,
        auditable: 0,
        filtered: 0,
        byType: {
            ASSERTION: 0,
            PROMISE: 0,
            POLICY_STATEMENT: 0,
            DISCLAIMER: 0,
            QUESTION: 0,
            REQUEST: 0,
            ACKNOWLEDGEMENT: 0,
            FILLER: 0,
        }
    };
    let claimIdx = 1;
    if (isTrans) {
        const turns = splitTurns(sourceText);
        console.log(`  Found ${turns.length} turns`);
        for (const turn of turns) {
            const sentences = splitSentences(turn.text);
            for (const sentence of sentences) {
                // Skip extremely short content
                if (sentence.length < 8)
                    continue;
                if (isContaminatedClaimText(sentence) || countSpeakerLabelsInClaim(sentence) > 0)
                    continue;
                const claimType = classifyClaimType(sentence, turn.speaker);
                const isAuditable = isAuditableClaimType(claimType);
                const topics = extractTopics(sentence);
                stats.total++;
                stats.byType[claimType]++;
                const item = {
                    id: `c${claimIdx++}`,
                    text: sentence,
                    // NO hard-coded confidence - will be computed by NLI/graph
                    confidence: 0, // Placeholder, computed later from NLI scores
                    evidence: [],
                    meta: {
                        speaker: turn.speaker,
                        speakerType: turn.speakerType,
                        speakerLabel: turn.speakerLabel,
                        rawSpeaker: turn.rawSpeaker,
                        turnIndex: turn.turnIndex
                    },
                    claimType,
                    isAuditable,
                    topicTags: topics,
                    hasAbsoluteLanguage: hasAbsoluteLanguage(sentence),
                    hasMoney: hasMoney(sentence)
                };
                allItems.push(item);
                if (isAuditable) {
                    stats.auditable++;
                }
                else {
                    stats.filtered++;
                }
            }
        }
    }
    else {
        // Non-transcript text extraction
        const sentences = splitSentences(sourceText);
        for (const sentence of sentences) {
            if (sentence.length < 8)
                continue;
            if (isContaminatedClaimText(sentence) || countSpeakerLabelsInClaim(sentence) > 0)
                continue;
            const claimType = classifyClaimType(sentence);
            const isAuditable = isAuditableClaimType(claimType);
            const topics = extractTopics(sentence);
            stats.total++;
            stats.byType[claimType]++;
            const item = {
                id: `c${claimIdx++}`,
                text: sentence,
                confidence: 0, // Computed later
                evidence: [],
                claimType,
                isAuditable,
                topicTags: topics,
                hasAbsoluteLanguage: hasAbsoluteLanguage(sentence),
                hasMoney: hasMoney(sentence)
            };
            allItems.push(item);
            if (isAuditable) {
                stats.auditable++;
            }
            else {
                stats.filtered++;
            }
        }
    }
    // Only include auditable claims in the main output
    const claims = allItems.filter(c => c.isAuditable);
    console.log(`  Extracted ${stats.total} items total`);
    console.log(`  Auditable claims: ${stats.auditable} (for graph)`);
    console.log(`  Filtered out: ${stats.filtered} (questions, acknowledgements, filler)`);
    console.log(`  Type breakdown:`, stats.byType);
    if (claims.length > 0) {
        console.log(`  First claim: "${claims[0].text.substring(0, 60)}..." (type: ${claims[0].claimType}, speaker: ${claims[0].meta?.speaker})`);
        console.log(`  Last claim: "${claims[claims.length - 1].text.substring(0, 60)}..." (type: ${claims[claims.length - 1].claimType})`);
    }
    return { claims, allItems, stats };
}
/**
 * Legacy extractClaims function for backward compatibility.
 * Returns only auditable claims (ASSERTION, PROMISE, POLICY_STATEMENT, DISCLAIMER).
 *
 * NOTE: confidence is set to 0 - it must be computed from NLI/retrieval scores.
 */
export function extractClaims(text) {
    const result = extractClaimsWithTypes(text);
    // Return only auditable claims as plain Claim objects
    return result.claims.map(c => ({
        id: c.id,
        text: c.text,
        confidence: c.confidence, // Will be 0, computed later
        evidence: c.evidence,
        meta: c.meta
    }));
}
