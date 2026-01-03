/**
 * Local NLI scorer using transformers.js
 * Downloads model on first run, caches locally
 * No API keys needed, works out of box
 *
 * CRITICAL: This scorer must correctly map NLI labels (LABEL_0/1/2) to semantic labels
 * (ENTAILMENT/NEUTRAL/CONTRADICTION) using the model's id2label config.
 */
// Softmax helper for logits
function softmax(logits) {
    const max = Math.max(...logits);
    const exp = logits.map(x => Math.exp(x - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(x => x / sum);
}
/**
 * Map a raw label (like "LABEL_0", "LABEL_1", "LABEL_2" or direct labels)
 * to normalized semantic labels using id2label mapping.
 *
 * CRITICAL: This fixes the issue where LABEL_0/1/2 were not being mapped
 * to ENTAILMENT/NEUTRAL/CONTRADICTION, causing all NLI scores to be 0.
 */
function normalizeLabel(rawLabel, id2label) {
    // Already a semantic label?
    const upper = rawLabel.toUpperCase();
    if (upper === "ENTAILMENT" || upper === "CONTRADICTION" || upper === "NEUTRAL") {
        return upper;
    }
    // Check for partial matches
    if (upper.includes("ENTAIL"))
        return "ENTAILMENT";
    if (upper.includes("CONTRAD"))
        return "CONTRADICTION";
    if (upper.includes("NEUTRAL"))
        return "NEUTRAL";
    // Try to extract index from LABEL_X format
    const labelMatch = rawLabel.match(/LABEL[_\-]?(\d+)/i);
    if (labelMatch && id2label) {
        const idx = labelMatch[1];
        const mappedLabel = id2label[idx];
        if (mappedLabel) {
            const normalizedMapped = mappedLabel.toUpperCase();
            if (normalizedMapped.includes("ENTAIL"))
                return "ENTAILMENT";
            if (normalizedMapped.includes("CONTRAD"))
                return "CONTRADICTION";
            if (normalizedMapped.includes("NEUTRAL"))
                return "NEUTRAL";
            return normalizedMapped;
        }
    }
    // Fallback: return as-is (will likely not match any task)
    return upper;
}
/**
 * Standard MNLI label ordering (most models follow this):
 * 0 = CONTRADICTION, 1 = NEUTRAL, 2 = ENTAILMENT
 *
 * But roberta-large-mnli uses:
 * 0 = CONTRADICTION, 1 = NEUTRAL, 2 = ENTAILMENT
 *
 * deberta-v3 and bart-large-mnli use:
 * 0 = ENTAILMENT, 1 = NEUTRAL, 2 = CONTRADICTION
 *
 * This function creates a fallback id2label for common models.
 */
function getDefaultId2Label(modelName) {
    const name = modelName.toLowerCase();
    // roberta-large-mnli, distilbart-mnli, etc.
    if (name.includes("roberta") || name.includes("distilbart")) {
        return { "0": "CONTRADICTION", "1": "NEUTRAL", "2": "ENTAILMENT" };
    }
    // deberta and bart-large-mnli
    if (name.includes("deberta") || name.includes("bart-large-mnli")) {
        return { "0": "ENTAILMENT", "1": "NEUTRAL", "2": "CONTRADICTION" };
    }
    // Default: assume standard MNLI ordering
    return { "0": "CONTRADICTION", "1": "NEUTRAL", "2": "ENTAILMENT" };
}
export class TransformersNliScorer {
    id;
    model = null;
    modelName;
    cacheDir;
    labelMap = {}; // Expose label map for debug
    labelMapInitialized = false;
    constructor(cfg) {
        // Default to roberta-large-mnli (best for NLI tasks, specifically trained for MNLI)
        // Can override with TCL_LOCAL_NLI_MODEL env var or pass modelName
        // roberta-large-mnli is trained on Multi-Genre Natural Language Inference dataset
        this.modelName = cfg.modelName || process.env.TCL_LOCAL_NLI_MODEL || "Xenova/roberta-large-mnli";
        this.cacheDir = cfg.cacheDir || ".tcl_models";
        this.id = `transformers-${this.modelName.split("/").pop()}`;
        // Initialize with default label map based on model name
        this.labelMap = getDefaultId2Label(this.modelName);
        // Bind methods to preserve 'this' context
        this.loadModel = this.loadModel.bind(this);
        this.scoreBatch = this.scoreBatch.bind(this);
        this.entailment = this.entailment.bind(this);
        this.contradiction = this.contradiction.bind(this);
        this.grounding = this.grounding.bind(this);
    }
    async loadModel() {
        if (this.model)
            return this.model;
        try {
            // CRITICAL: Set environment variables BEFORE import to force WASM-only mode
            // This prevents onnxruntime-node native library from being loaded (causes errors in containers)
            if (typeof process !== 'undefined' && process.env) {
                // Force WASM backend
                process.env.TRANSFORMERS_BACKEND = 'wasm';
                process.env.USE_WASM = '1';
                // Disable native onnxruntime
                process.env.ONNXRUNTIME_EXECUTION_PROVIDERS = '';
                process.env.ONNX_DISABLE_NATIVE = '1';
            }
            // Dynamic import to avoid bundling transformers.js if not used
            const transformersModule = await import("@xenova/transformers");
            const { pipeline, env } = transformersModule;
            // CRITICAL: Force WASM backend configuration BEFORE loading any model
            // This must be done before pipeline() is called
            if (env) {
                // Disable local model check (always download from hub)
                env.allowLocalModels = false;
                // Force WASM backend
                if (env.backends) {
                    // Disable ONNX native backend entirely
                    if (env.backends.onnx) {
                        // Use WASM exclusively
                        env.backends.onnx.wasm = env.backends.onnx.wasm || {};
                        env.backends.onnx.wasm.proxy = false;
                        env.backends.onnx.wasm.numThreads = 1;
                    }
                }
                // Set cache directory
                env.cacheDir = this.cacheDir;
            }
            console.log(`Loading NLI model: ${this.modelName} (WASM-only mode, may take a minute on first run)...`);
            // For MNLI models (like roberta-large-mnli), use text-classification pipeline
            // MNLI models are specifically trained for Natural Language Inference tasks
            // They expect premise-hypothesis pairs and return entailment/contradiction/neutral
            const isMnliModel = this.modelName.includes("mnli");
            const pipelineType = isMnliModel ? "text-classification" : "zero-shot-classification";
            this.model = await pipeline(pipelineType, this.modelName, {
                quantized: true, // Use quantized model (smaller, faster)
                cache_dir: this.cacheDir
            });
            // Extract label map from model if available (for MNLI models)
            // CRITICAL: This mapping is required to convert LABEL_0/1/2 to semantic labels
            let extractedLabelMap = null;
            // Try multiple paths to find id2label
            const configPaths = [
                this.model?.model?.config?.id2label,
                this.model?.processor?.tokenizer?.model?.config?.id2label,
                this.model?.tokenizer?.model?.config?.id2label,
                this.model?.config?.id2label
            ];
            for (const path of configPaths) {
                if (path && typeof path === 'object') {
                    extractedLabelMap = path;
                    break;
                }
            }
            if (extractedLabelMap) {
                this.labelMap = extractedLabelMap;
                this.labelMapInitialized = true;
                console.log(`✅ Label map extracted from model config:`, this.labelMap);
            }
            else {
                // Use default based on model name
                console.log(`⚠️ Could not extract label map from model, using default for ${this.modelName}:`, this.labelMap);
            }
            // Validate label map has expected values
            const labelValues = Object.values(this.labelMap).map(v => v.toUpperCase());
            const hasEntailment = labelValues.some(v => v.includes("ENTAIL"));
            const hasContradiction = labelValues.some(v => v.includes("CONTRAD"));
            if (!hasEntailment || !hasContradiction) {
                console.error(`❌ CRITICAL: Label map is missing ENTAILMENT or CONTRADICTION!`);
                console.error(`   Label map: ${JSON.stringify(this.labelMap)}`);
                console.error(`   This will cause NLI scoring to fail silently.`);
                throw new Error(`Invalid label map for NLI model: missing ENTAILMENT or CONTRADICTION. Got: ${JSON.stringify(this.labelMap)}`);
            }
            console.log(`✅ NLI model loaded: ${this.modelName}`);
            console.log(`   Label map: ${JSON.stringify(this.labelMap)}`);
            return this.model;
        }
        catch (error) {
            console.error(`Failed to load transformers model:`, error);
            throw new Error(`Failed to load NLI model: ${error.message}`);
        }
    }
    async scoreBatch(pairs) {
        // Load model first and store reference
        const model = await this.loadModel();
        if (!model) {
            throw new Error("Failed to load NLI model");
        }
        const scores = await Promise.all(pairs.map(async (pair) => {
            const { task, a, b, key } = pair;
            try {
                // Format labels based on task
                let labels;
                if (task === "entailment") {
                    labels = ["entailment", "neutral", "contradiction"];
                }
                else if (task === "contradiction") {
                    labels = ["contradiction", "neutral", "entailment"];
                }
                else if (task === "grounding") {
                    labels = ["entailment", "neutral", "contradiction"];
                }
                else {
                    return { key, score: 0.0 };
                }
                // Format input based on model type
                const isMnliModel = this.modelName.includes("mnli");
                let result;
                if (isMnliModel) {
                    // For MNLI models, use premise-hypothesis pair format
                    // text-classification pipeline expects: { text: premise, text_pair: hypothesis }
                    result = await model({ text: a, text_pair: b });
                }
                else {
                    // For zero-shot models, use formatted text with labels
                    let input;
                    if (task === "entailment") {
                        input = `${a}. Therefore, ${b}`;
                    }
                    else if (task === "contradiction") {
                        input = `${a}. However, ${b} contradicts this.`;
                    }
                    else {
                        input = `${a}. This is supported by: ${b}`;
                    }
                    result = await model(input, labels);
                }
                // Extract score based on result format
                let score = 0.0;
                if (isMnliModel) {
                    // Handle different result formats from transformers.js
                    if (Array.isArray(result)) {
                        result = result[0];
                    }
                    let semanticLabel = "";
                    let prob = 0.0;
                    if (result.label !== undefined) {
                        // CRITICAL FIX: Map raw label (LABEL_0, LABEL_1, LABEL_2) to semantic label
                        const rawLabel = String(result.label);
                        semanticLabel = normalizeLabel(rawLabel, this.labelMap);
                        prob = result.score || 0.0;
                        // Debug: log label mapping for first few pairs
                        const pairIndex = pairs.indexOf(pair);
                        if (pairIndex < 3) {
                            console.log(`  [LabelMap] Raw="${rawLabel}" → Semantic="${semanticLabel}" (id2label: ${JSON.stringify(this.labelMap)})`);
                        }
                    }
                    else if (result.logits) {
                        // Logits format - compute probabilities and extract correct one
                        const logits = Array.isArray(result.logits) ? result.logits : Object.values(result.logits);
                        const probs = softmax(logits);
                        // Build label->prob map using id2label
                        const labelProb = {};
                        for (let i = 0; i < probs.length; i++) {
                            const mappedLabel = normalizeLabel(this.labelMap[String(i)] || `LABEL_${i}`, this.labelMap);
                            labelProb[mappedLabel] = probs[i];
                        }
                        // Extract probabilities
                        const entailProb = labelProb["ENTAILMENT"] ?? 0;
                        const contraProb = labelProb["CONTRADICTION"] ?? 0;
                        const neutralProb = labelProb["NEUTRAL"] ?? 0;
                        // Use the appropriate probability based on task
                        if (task === "entailment" || task === "grounding") {
                            prob = entailProb;
                            semanticLabel = "ENTAILMENT";
                        }
                        else if (task === "contradiction") {
                            prob = contraProb;
                            semanticLabel = "CONTRADICTION";
                        }
                        // For grounding, also consider neutral as partial support
                        if (task === "grounding") {
                            prob = entailProb + neutralProb * 0.3;
                        }
                        const pairIndex = pairs.indexOf(pair);
                        if (pairIndex < 3) {
                            console.log(`  [Logits] Entail=${entailProb.toFixed(3)}, Contra=${contraProb.toFixed(3)}, Neutral=${neutralProb.toFixed(3)}`);
                        }
                    }
                    // Map semantic label to score based on task
                    if (task === "entailment" && semanticLabel === "ENTAILMENT") {
                        score = prob;
                    }
                    else if (task === "contradiction" && semanticLabel === "CONTRADICTION") {
                        score = prob;
                    }
                    else if (task === "grounding") {
                        if (semanticLabel === "ENTAILMENT") {
                            score = prob;
                        }
                        else if (semanticLabel === "NEUTRAL") {
                            score = prob * 0.4; // Neutral is weaker support
                        }
                    }
                    else {
                        // Label doesn't match task - but DON'T return 0 if we have logits!
                        // For multi-class output, we want the probability of the CORRECT class, not 0
                        // This was the bug: when label=NEUTRAL but task=entailment, we returned 0
                        // But we should return the entailment probability from logits
                        // If we got here from label path (not logits), we need to recalculate
                        if (result.logits) {
                            // Already handled above
                        }
                        else if (result.label !== undefined) {
                            // Model returned different label than task - that's fine, score = 0 is correct
                            // (e.g., task=entailment but model says NEUTRAL → entailment score = 0)
                            const pairIndex = pairs.indexOf(pair);
                            if (pairIndex < 3) {
                                console.log(`  [MNLI] Task=${task} but semanticLabel=${semanticLabel}, prob=${prob.toFixed(3)} → score=0.0 (label mismatch)`);
                            }
                        }
                    }
                }
                else {
                    // Zero-shot returns: { labels: string[], scores: number[] }
                    const labelIndex = result.labels?.indexOf(labels[0]) ?? -1;
                    score = labelIndex >= 0 && result.scores?.[labelIndex] !== undefined
                        ? result.scores[labelIndex]
                        : 0.0;
                }
                // Enhanced debug logging
                const pairIndex = pairs.indexOf(pair);
                if (pairIndex < 5 || Math.random() < 0.05) {
                    const rawLabel = result.label || 'N/A';
                    const rawProb = result.score || 0.0;
                    console.log(`[NLI] ${task} #${pairIndex}: score=${score.toFixed(3)} | raw_label="${rawLabel}" → mapped | raw_prob=${typeof rawProb === 'number' ? rawProb.toFixed(3) : rawProb}`);
                    console.log(`      A: "${a.substring(0, 50)}..."`);
                    console.log(`      B: "${b.substring(0, 50)}..."`);
                }
                const finalScore = Math.max(0, Math.min(1, score));
                // CRITICAL: Warn if we get zero scores - this indicates mapping failure
                if (pairIndex < 5 && finalScore === 0.0) {
                    const rawLabel = result.label || 'unknown';
                    console.warn(`  ⚠️ Zero score for ${task} (raw_label=${rawLabel}) - check label mapping!`);
                }
                return { key, score: finalScore };
            }
            catch (error) {
                console.error(`Error scoring pair ${key}:`, error);
                // DON'T silently return 0 - throw so caller knows something went wrong
                throw new Error(`NLI scoring failed for pair: ${error.message}`);
            }
        }));
        return scores;
    }
    async entailment(premise, hypothesis) {
        const out = await this.scoreBatch([{ task: "entailment", a: premise, b: hypothesis, key: "0" }]);
        return Number(out[0]?.score ?? 0);
    }
    async contradiction(a, b) {
        const out = await this.scoreBatch([{ task: "contradiction", a, b, key: "0" }]);
        return Number(out[0]?.score ?? 0);
    }
    async grounding(claim, sourceText) {
        const out = await this.scoreBatch([{ task: "grounding", a: claim, b: sourceText, key: "0" }]);
        return { score: Number(out[0]?.score ?? 0) };
    }
}
