/**
 * ProtectQA Template Configuration
 *
 * All thresholds, budgets, and weights are config-driven.
 * No hard-coded constants in code paths.
 *
 * Templates are domain-specific (telco, loans, ai_chat, generic)
 * but the graph construction logic is universal.
 */
// =============================================================================
// DEFAULT TEMPLATE (Generic - works for any domain)
// =============================================================================
export const DEFAULT_TEMPLATE_CONFIG = {
    templateId: 'generic',
    entityPacks: ['money', 'dates', 'actions'],
    slotLexicon: {
        // These are examples - domain-specific templates will override
        'fee': { slotType: 'fee', entityKey: 'generic_fee', synonyms: ['charge', 'cost', 'price', 'rate', 'amount'] },
        'date': { slotType: 'date', entityKey: 'generic_date', synonyms: ['when', 'time', 'day', 'month', 'year'] },
        'action': { slotType: 'action', entityKey: 'generic_action', synonyms: ['do', 'done', 'performed', 'completed'] },
        'policy': { slotType: 'policy', entityKey: 'generic_policy', synonyms: ['rule', 'regulation', 'requirement', 'guideline'] },
        'status': { slotType: 'status', entityKey: 'generic_status', synonyms: ['state', 'condition', 'situation'] },
    },
    budgets: {
        perClaim: {
            contradictionPairs: 20,
            supportClaimPairs: 10,
            supportEvidencePairs: 10,
            groundingPairs: 5,
        },
        global: {
            maxPairsTotal: 5000,
        },
    },
    thresholds: {
        support: 0.5,
        contradiction: 0.55,
        grounding: 0.4,
        slotMatch: 0.8,
        semanticSimilarity: 0.6,
    },
    weights: {
        retrieval: {
            slotMatch: 0.4,
            entityOverlap: 0.25,
            semanticSimilarity: 0.2,
            temporalProximity: 0.1,
            speakerRole: 0.05,
        },
        calibration: {
            nliScore: 0.4,
            entityMatch: 0.25,
            polarityMatch: 0.2,
            modalityWeight: 0.15,
        },
        evidenceStrength: {
            policy: 1.0,
            system_fact: 1.0,
            document: 0.9,
            kb: 0.8,
            tool_log: 0.7,
            transcript: 0.3, // Low - transcript is GROUNDING, not SUPPORT
        },
    },
    gating: {
        allowCrossTopicSupportOnlyOnStrictSlotMatch: true,
        contradictionRequiresSameTopic: true,
        contradictionRequiresSameSlot: true,
        contradictionRequiresOpposingPolarity: true,
    },
    topicSegmentation: {
        method: 'hybrid',
        turnWindow: 10,
        minClaimsPerTopic: 2,
    },
    truthDerivation: {
        allowClaimToClaimSupport: false, // Conservative default
        minSupportWeight: 0.5,
        minContradictionWeight: 0.55,
    },
};
// =============================================================================
// TELCO TEMPLATE
// =============================================================================
export const TELCO_TEMPLATE_CONFIG = {
    ...DEFAULT_TEMPLATE_CONFIG,
    templateId: 'telco',
    entityPacks: ['money', 'dates', 'actions', 'telco_plans', 'telco_fees'],
    slotLexicon: {
        // Fees
        'router_fee': { slotType: 'fee', entityKey: 'router_fee', synonyms: ['router charge', 'equipment fee', 'router cost'] },
        'late_fee': { slotType: 'fee', entityKey: 'late_fee', synonyms: ['late payment', 'past due charge', 'late charge'] },
        'early_termination_fee': { slotType: 'fee', entityKey: 'early_termination_fee', synonyms: ['etf', 'cancellation fee', 'termination charge'] },
        'activation_fee': { slotType: 'fee', entityKey: 'activation_fee', synonyms: ['setup fee', 'installation fee'] },
        'streaming_addon': { slotType: 'addon', entityKey: 'streaming_plus', synonyms: ['streaming plus', 'streaming service', 'streaming add-on'] },
        // Contract terms
        'contract_term': { slotType: 'contract', entityKey: 'contract_duration', synonyms: ['agreement length', 'contract length', 'term'] },
        'contract_start': { slotType: 'contract', entityKey: 'contract_start_date', synonyms: ['start date', 'effective date'] },
        'price_lock': { slotType: 'contract', entityKey: 'price_lock', synonyms: ['rate guarantee', 'price guarantee', 'locked rate'] },
        // Promotions
        'promo_credit': { slotType: 'promo', entityKey: 'promo_credit', synonyms: ['promotional credit', 'discount', 'credit'] },
        'promo_duration': { slotType: 'promo', entityKey: 'promo_duration', synonyms: ['promo period', 'promotional period'] },
        // Plans
        'plan_name': { slotType: 'plan', entityKey: 'plan_name', synonyms: ['package', 'bundle', 'service plan'] },
        'plan_rate': { slotType: 'plan', entityKey: 'monthly_rate', synonyms: ['monthly cost', 'monthly charge', 'monthly price'] },
        // Payments
        'payment_date': { slotType: 'payment', entityKey: 'due_date', synonyms: ['bill due', 'payment due', 'due by'] },
        'payment_amount': { slotType: 'payment', entityKey: 'payment_amount', synonyms: ['amount due', 'balance due', 'total due'] },
        // Service
        'service_status': { slotType: 'service', entityKey: 'service_status', synonyms: ['account status', 'service state'] },
        'service_address': { slotType: 'service', entityKey: 'service_address', synonyms: ['installation address', 'service location'] },
    },
};
// =============================================================================
// LOANS TEMPLATE
// =============================================================================
export const LOANS_TEMPLATE_CONFIG = {
    ...DEFAULT_TEMPLATE_CONFIG,
    templateId: 'loans',
    entityPacks: ['money', 'dates', 'actions', 'loan_terms', 'underwriting'],
    slotLexicon: {
        // Loan amounts
        'loan_amount': { slotType: 'loan', entityKey: 'principal_amount', synonyms: ['principal', 'loan principal', 'borrowed amount'] },
        'interest_rate': { slotType: 'rate', entityKey: 'interest_rate', synonyms: ['apr', 'rate', 'interest'] },
        'monthly_payment': { slotType: 'payment', entityKey: 'monthly_payment', synonyms: ['payment amount', 'installment'] },
        // Underwriting
        'dscr': { slotType: 'underwriting', entityKey: 'dscr', synonyms: ['debt service coverage', 'debt service coverage ratio'] },
        'ltv': { slotType: 'underwriting', entityKey: 'ltv', synonyms: ['loan to value', 'loan-to-value ratio'] },
        'credit_score': { slotType: 'underwriting', entityKey: 'credit_score', synonyms: ['fico', 'credit rating'] },
        // Terms
        'loan_term': { slotType: 'term', entityKey: 'loan_term', synonyms: ['term length', 'loan duration', 'repayment period'] },
        'maturity_date': { slotType: 'term', entityKey: 'maturity_date', synonyms: ['payoff date', 'loan end date'] },
        // Fees
        'origination_fee': { slotType: 'fee', entityKey: 'origination_fee', synonyms: ['processing fee', 'loan fee'] },
        'prepayment_penalty': { slotType: 'fee', entityKey: 'prepayment_penalty', synonyms: ['early payoff penalty', 'prepay penalty'] },
        // Status
        'approval_status': { slotType: 'status', entityKey: 'approval_status', synonyms: ['loan status', 'application status'] },
        'disclosure_sent': { slotType: 'action', entityKey: 'disclosure_sent', synonyms: ['disclosures', 'loan disclosure'] },
    },
};
// =============================================================================
// AI CHAT TEMPLATE
// =============================================================================
export const AI_CHAT_TEMPLATE_CONFIG = {
    ...DEFAULT_TEMPLATE_CONFIG,
    templateId: 'ai_chat',
    entityPacks: ['money', 'dates', 'actions', 'ai_actions'],
    slotLexicon: {
        // AI Actions
        'ticket_created': { slotType: 'action', entityKey: 'ticket_created', synonyms: ['created ticket', 'opened ticket', 'filed ticket'] },
        'escalated': { slotType: 'action', entityKey: 'escalated', synonyms: ['escalation', 'transferred', 'handed off'] },
        'tool_called': { slotType: 'action', entityKey: 'tool_called', synonyms: ['api call', 'function call', 'tool invocation'] },
        // Responses
        'response_given': { slotType: 'response', entityKey: 'response_content', synonyms: ['answered', 'replied', 'responded'] },
        'hallucination': { slotType: 'issue', entityKey: 'hallucination', synonyms: ['made up', 'incorrect info', 'false claim'] },
        // User intent
        'user_intent': { slotType: 'intent', entityKey: 'user_intent', synonyms: ['user wants', 'user asking', 'user needs'] },
        'satisfaction': { slotType: 'outcome', entityKey: 'satisfaction', synonyms: ['resolved', 'unresolved', 'satisfied'] },
    },
    gating: {
        ...DEFAULT_TEMPLATE_CONFIG.gating,
        // AI chats may have more cross-topic connections
        contradictionRequiresSameTopic: false,
    },
};
// =============================================================================
// TEMPLATE REGISTRY
// =============================================================================
const TEMPLATE_REGISTRY = {
    'generic': DEFAULT_TEMPLATE_CONFIG,
    'telco': TELCO_TEMPLATE_CONFIG,
    'loans': LOANS_TEMPLATE_CONFIG,
    'ai_chat': AI_CHAT_TEMPLATE_CONFIG,
};
// =============================================================================
// GET TEMPLATE (with environment/runtime override support)
// =============================================================================
let _activeTemplate = DEFAULT_TEMPLATE_CONFIG;
export function getTemplateConfig() {
    return _activeTemplate;
}
export function setTemplateConfig(templateIdOrConfig) {
    if (typeof templateIdOrConfig === 'string') {
        const template = TEMPLATE_REGISTRY[templateIdOrConfig];
        if (!template) {
            throw new Error(`Unknown template: ${templateIdOrConfig}. Available: ${Object.keys(TEMPLATE_REGISTRY).join(', ')}`);
        }
        _activeTemplate = template;
    }
    else {
        _activeTemplate = templateIdOrConfig;
    }
}
export function registerTemplate(config) {
    TEMPLATE_REGISTRY[config.templateId] = config;
}
export function getAvailableTemplates() {
    return Object.keys(TEMPLATE_REGISTRY);
}
// =============================================================================
// MERGE CONFIG (for runtime overrides)
// =============================================================================
export function mergeTemplateConfig(overrides) {
    const base = getTemplateConfig();
    return {
        ...base,
        ...overrides,
        budgets: {
            ...base.budgets,
            ...overrides.budgets,
            perClaim: {
                ...base.budgets.perClaim,
                ...overrides.budgets?.perClaim,
            },
        },
        thresholds: {
            ...base.thresholds,
            ...overrides.thresholds,
        },
        weights: {
            ...base.weights,
            ...overrides.weights,
            retrieval: {
                ...base.weights.retrieval,
                ...overrides.weights?.retrieval,
            },
            calibration: {
                ...base.weights.calibration,
                ...overrides.weights?.calibration,
            },
            evidenceStrength: {
                ...base.weights.evidenceStrength,
                ...overrides.weights?.evidenceStrength,
            },
        },
        gating: {
            ...base.gating,
            ...overrides.gating,
        },
        topicSegmentation: {
            ...base.topicSegmentation,
            ...overrides.topicSegmentation,
        },
        truthDerivation: {
            ...base.truthDerivation,
            ...overrides.truthDerivation,
        },
    };
}
