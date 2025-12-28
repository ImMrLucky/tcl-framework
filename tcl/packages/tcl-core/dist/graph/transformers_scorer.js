/**
 * Local NLI scorer using transformers.js
 * Downloads model on first run, caches locally
 * No API keys needed, works out of box
 */
export class TransformersNliScorer {
    id;
    model = null;
    modelName;
    cacheDir;
    constructor(cfg) {
        // Use a model specifically trained for NLI (Natural Language Inference)
        // roberta-base-mnli is trained on MultiNLI dataset and works well for entailment/contradiction
        this.modelName = cfg.modelName || "Xenova/roberta-base-mnli";
        this.cacheDir = cfg.cacheDir || ".tcl_models";
        this.id = `transformers-${this.modelName.split("/").pop()}`;
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
            // Dynamic import to avoid bundling transformers.js if not used
            const { pipeline } = await import("@xenova/transformers");
            console.log(`Loading NLI model: ${this.modelName} (this may take a minute on first run)...`);
            // For NLI models like roberta-base-mnli, we can use zero-shot-classification
            // which works well for entailment/contradiction tasks
            // Alternative: could use "text-classification" but zero-shot is more flexible
            this.model = await pipeline("zero-shot-classification", this.modelName, {
                quantized: true, // Use quantized model (smaller, faster)
                cache_dir: this.cacheDir
            });
            console.log(`✅ NLI model loaded: ${this.modelName}`);
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
                // Format input for NLI model
                // For roberta-base-mnli and similar NLI models, use premise/hypothesis format
                let input;
                if (task === "entailment") {
                    // Premise: a, Hypothesis: b
                    input = `${a} ${b}`;
                }
                else if (task === "contradiction") {
                    // Two statements to check for contradiction
                    input = `${a} ${b}`;
                }
                else {
                    // Grounding: claim and source
                    input = `${a} ${b}`;
                }
                // Run inference using the loaded model
                const result = await model(input, labels);
                // Extract score for the relevant label (first label in array)
                // Result format: { labels: string[], scores: number[] }
                const labelIndex = result.labels?.indexOf(labels[0]) ?? -1;
                const score = labelIndex >= 0 && result.scores?.[labelIndex] !== undefined
                    ? result.scores[labelIndex]
                    : 0.0;
                // Debug logging for troubleshooting (log first score of each batch)
                if (pairs.indexOf(pair) === 0) {
                    console.log(`[TransformersNliScorer] ${task} sample: "${a.substring(0, 50)}..." -> "${b.substring(0, 50)}..." | score=${score.toFixed(3)}`);
                }
                return { key, score: Math.max(0, Math.min(1, score)) };
            }
            catch (error) {
                console.error(`Error scoring pair ${key}:`, error);
                return { key, score: 0.0 };
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
