/**
 * Client for spaCy NLP service.
 *
 * Provides enhanced entity extraction with coreference resolution.
 * Falls back to regex-based extraction if service is unavailable.
 */
const DEFAULT_CONFIG = {
    endpoint: process.env.TCL_NLP_URL || process.env.SPACY_SERVICE_URL || 'http://localhost:8081',
    enabled: process.env.ENABLE_SPACY !== 'false',
    timeout: 5000,
    enableCoreference: true,
};
let config = { ...DEFAULT_CONFIG };
let serviceAvailable = null; // null = not checked yet
/**
 * Configure the spaCy client.
 */
export function configureSpacyClient(newConfig) {
    config = { ...config, ...newConfig };
    serviceAvailable = null; // Reset availability check
}
/**
 * Check if spaCy service is available.
 */
export async function isSpacyAvailable() {
    if (serviceAvailable !== null) {
        return serviceAvailable;
    }
    if (!config.enabled) {
        serviceAvailable = false;
        return false;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // Quick health check
        const response = await fetch(`${config.endpoint}/health`, {
            signal: controller.signal,
            method: 'GET',
        });
        clearTimeout(timeoutId);
        if (response.ok) {
            const data = await response.json();
            serviceAvailable = data.status === 'ok';
            return serviceAvailable;
        }
        else {
            serviceAvailable = false;
            return false;
        }
    }
    catch (error) {
        serviceAvailable = false;
        return false;
    }
}
/**
 * Extract entities using spaCy service.
 * Falls back to regex-based extraction if service unavailable.
 */
export async function extractEntitiesWithSpacy(texts, fallbackExtractor) {
    // Check if service is available
    const available = await isSpacyAvailable();
    if (!available) {
        // Fall back to regex-based extraction
        if (fallbackExtractor) {
            const entities = texts.map(text => fallbackExtractor(text));
            return { entities };
        }
        else {
            throw new Error('spaCy service unavailable and no fallback extractor provided');
        }
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);
        const response = await fetch(`${config.endpoint}/extract`, {
            signal: controller.signal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                texts,
                enable_coreference: config.enableCoreference,
            }),
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`spaCy service returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        // Convert spaCy entities to our Entity format
        const entities = data.results.map(spacyEntities => spacyEntities.map(e => ({
            type: e.type,
            value: e.value,
            normalized: e.normalized,
            span: e.span,
            confidence: e.confidence,
        })));
        return {
            entities,
            coreferenceChains: data.coreference_chains,
        };
    }
    catch (error) {
        // If request fails, fall back to regex extraction
        if (fallbackExtractor) {
            console.warn(`spaCy extraction failed, falling back to regex: ${error.message}`);
            const entities = texts.map(text => fallbackExtractor(text));
            return { entities };
        }
        else {
            throw error;
        }
    }
}
/**
 * Extract entities for a single text.
 */
export async function extractEntitiesSingle(text, fallbackExtractor) {
    const result = await extractEntitiesWithSpacy([text], fallbackExtractor);
    return {
        entities: result.entities[0] || [],
        coreferenceChains: result.coreferenceChains,
    };
}
/**
 * Batch extract entities (optimized endpoint).
 */
export async function extractEntitiesBatch(texts, fallbackExtractor) {
    const available = await isSpacyAvailable();
    if (!available) {
        if (fallbackExtractor) {
            const entities = texts.map(text => fallbackExtractor(text));
            return { entities };
        }
        else {
            throw new Error('spaCy service unavailable and no fallback extractor provided');
        }
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout * texts.length); // Longer timeout for batch
        const response = await fetch(`${config.endpoint}/extract/batch`, {
            signal: controller.signal,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                texts,
                enable_coreference: config.enableCoreference,
            }),
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw new Error(`spaCy batch service returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        // Convert spaCy entities to our Entity format
        const entities = data.entities.map((spacyEntities) => spacyEntities.map(e => ({
            type: e.type,
            value: e.value,
            normalized: e.normalized,
            span: e.span,
            confidence: e.confidence,
        })));
        return {
            entities,
            coreferenceChains: data.coreference_chains,
            processingTimeMs: data.processing_time_ms,
        };
    }
    catch (error) {
        if (fallbackExtractor) {
            console.warn(`spaCy batch extraction failed, falling back to regex: ${error.message}`);
            const entities = texts.map(text => fallbackExtractor(text));
            return { entities };
        }
        else {
            throw error;
        }
    }
}
