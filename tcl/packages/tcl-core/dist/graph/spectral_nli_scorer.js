/**
 * NLI scorer that calls the Spectral Python service.
 *
 * This avoids the native onnxruntime issues in Node.js containers
 * by delegating NLI to the Python service which handles transformers natively.
 */
export class SpectralNliScorer {
    id = "spectral-nli-distilroberta-base";
    endpoint;
    timeoutMs;
    constructor(cfg = {}) {
        // Use spectral URL and add /nli/score path
        const spectralUrl = cfg.endpoint || process.env.TCL_SPECTRAL_URL || "";
        this.endpoint = spectralUrl.replace(/\/$/, "") + "/nli/score";
        this.timeoutMs = cfg.timeoutMs ?? 60000; // 60s timeout for large batches
        if (!spectralUrl) {
            console.warn("⚠️ SpectralNliScorer: No TCL_SPECTRAL_URL configured");
        }
        else {
            console.log(`🔌 SpectralNliScorer initialized: ${this.endpoint}`);
        }
        // CRITICAL: Bind methods to preserve 'this' context when passed as callbacks
        this.scoreBatch = this.scoreBatch.bind(this);
        this.entailment = this.entailment.bind(this);
        this.contradiction = this.contradiction.bind(this);
        this.grounding = this.grounding.bind(this);
    }
    async scoreBatch(pairs) {
        if (pairs.length === 0) {
            return [];
        }
        // Convert to the format the spectral service expects
        const payload = {
            pairs: pairs.map((p, i) => ({
                premise: p.a,
                hypothesis: p.b,
                key: p.key || `${i}`
            }))
        };
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await fetch(this.endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: ctrl.signal
            });
            if (!res.ok) {
                const errorText = await res.text().catch(() => "");
                throw new Error(`Spectral NLI endpoint error ${res.status}: ${errorText}`);
            }
            const data = await res.json();
            // Log diagnostic info for first batch
            if (pairs.length > 0) {
                console.log(`🔬 SpectralNliScorer batch response (${pairs.length} pairs):`);
                console.log(`   Model: ${data.model}`);
                // Show first 3 pairs with their scores
                for (let i = 0; i < Math.min(3, pairs.length); i++) {
                    const pair = pairs[i];
                    const score = data.scores[i];
                    console.log(`   [${i}] ${pair.task}: ent=${score?.entailment?.toFixed(3)}, con=${score?.contradiction?.toFixed(3)}, neu=${score?.neutral?.toFixed(3)}`);
                    console.log(`       premise: "${pair.a.substring(0, 60)}..."`);
                    console.log(`       hypothesis: "${pair.b.substring(0, 60)}..."`);
                }
                // Summary stats
                const entailments = data.scores.map(s => s.entailment || 0);
                const maxEnt = Math.max(...entailments);
                const avgEnt = entailments.reduce((a, b) => a + b, 0) / entailments.length;
                console.log(`   Stats: maxEntailment=${maxEnt.toFixed(3)}, avgEntailment=${avgEnt.toFixed(3)}`);
            }
            // Map results back to BatchScore format based on task
            return pairs.map((pair, i) => {
                const nliScore = data.scores[i];
                if (!nliScore) {
                    return { key: pair.key, score: 0 };
                }
                let score = 0;
                let quote;
                switch (pair.task) {
                    case "entailment":
                        score = nliScore.entailment;
                        break;
                    case "contradiction":
                        score = nliScore.contradiction;
                        break;
                    case "grounding":
                        // For grounding, we want entailment (source=a entails claim=b)
                        score = nliScore.entailment;
                        quote = pair.a.substring(0, 200); // The source text (premise)
                        break;
                    default:
                        score = 0;
                }
                return { key: pair.key, score, quote };
            });
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async entailment(premise, hypothesis) {
        const results = await this.scoreBatch([
            { task: "entailment", a: premise, b: hypothesis, key: "0" }
        ]);
        return results[0]?.score ?? 0;
    }
    async contradiction(a, b) {
        const results = await this.scoreBatch([
            { task: "contradiction", a, b, key: "0" }
        ]);
        return results[0]?.score ?? 0;
    }
    async grounding(claim, sourceText) {
        const results = await this.scoreBatch([
            { task: "grounding", a: sourceText, b: claim, key: "0" }
        ]);
        return {
            score: results[0]?.score ?? 0,
            quote: sourceText.substring(0, 200)
        };
    }
}
