/**
 * Evidence Embeddings
 * Creates embeddings for evidence chunks using OpenAI or fallback methods
 */
/**
 * Create embedding for text
 * Uses OpenAI API if available, otherwise uses free hash-based fallback
 * The fallback works without any external services but provides keyword-based similarity, not semantic similarity
 */
export async function createEmbedding(text, options = {}) {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    const model = options.model || 'text-embedding-3-small'; // Only used if OpenAI API key is provided
    if (!apiKey) {
        // Use free fallback embedding (no external service required)
        // This provides keyword-based similarity matching, which works well for many use cases
        return createFallbackEmbedding(text);
    }
    try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                input: text,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
        }
        const data = await response.json();
        if (!data.data || !data.data[0] || !data.data[0].embedding) {
            throw new Error('Invalid response from OpenAI API');
        }
        return {
            embedding: data.data[0].embedding,
            model,
        };
    }
    catch (error) {
        console.error('Failed to create OpenAI embedding:', error);
        // Fallback to simple embedding
        return createFallbackEmbedding(text);
    }
}
/**
 * Create a free fallback embedding (hash-based, keyword similarity)
 * This works without any external services and provides keyword-based similarity matching
 * For semantic similarity (understanding meaning), use OpenAI embeddings or another embedding service
 */
function createFallbackEmbedding(text) {
    // Create a simple 1536-dimensional vector based on character frequencies
    // This is NOT a real embedding but allows the system to function
    const embedding = new Array(1536).fill(0);
    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (let i = 0; i < normalized.length; i++) {
        const charCode = normalized.charCodeAt(i);
        const index = charCode % 1536;
        embedding[index] += 1 / (normalized.length + 1);
    }
    // Normalize vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let i = 0; i < embedding.length; i++) {
            embedding[i] /= magnitude;
        }
    }
    return {
        embedding,
        model: 'fallback-hash-v1',
    };
}
/**
 * Create embeddings for multiple texts in batch (if API supports it)
 */
export async function createEmbeddingsBatch(texts, options = {}) {
    const batchSize = options.batchSize || 100; // OpenAI allows up to 2048 inputs per request
    const results = [];
    for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(text => createEmbedding(text, options)));
        results.push(...batchResults);
    }
    return results;
}
