/**
 * Pipeline timing instrumentation.
 * Tracks timing and counts for each stage of the validation pipeline.
 */
export class PipelineTimer {
    startTime;
    stages = new Map();
    counts = new Map();
    constructor() {
        this.startTime = Date.now();
    }
    start(stage) {
        this.stages.set(stage, { start: Date.now() });
    }
    end(stage) {
        const s = this.stages.get(stage);
        if (s) {
            s.end = Date.now();
            return s.end - s.start;
        }
        return 0;
    }
    duration(stage) {
        const s = this.stages.get(stage);
        if (!s)
            return 0;
        return (s.end ?? Date.now()) - s.start;
    }
    count(key, value = 1) {
        this.counts.set(key, (this.counts.get(key) ?? 0) + value);
    }
    set(key, value) {
        this.counts.set(key, value);
    }
    get(key) {
        return this.counts.get(key) ?? 0;
    }
    total() {
        return Date.now() - this.startTime;
    }
    getMetrics() {
        const metrics = {
            t_total: this.total(),
            t_claim_extract: this.duration('claim_extract'),
            t_source_gen: this.duration('source_gen'),
            t_retrieval: this.duration('retrieval'),
            t_scorer_init: this.duration('scorer_init'),
            t_graph_build: this.duration('graph_build'),
            t_nli_total: this.duration('nli_total'),
            t_spectral: this.duration('spectral'),
            t_issues_build: this.duration('issues_build'),
            num_claims: this.get('num_claims'),
            num_sources: this.get('num_sources'),
            num_evidence_chunks_total: this.get('num_evidence_chunks'),
            num_nli_calls: this.get('num_nli_calls'),
            num_nli_pairs_total: this.get('num_nli_pairs'),
            avg_pairs_per_batch: this.get('num_nli_calls') > 0
                ? Math.round(this.get('num_nli_pairs') / this.get('num_nli_calls'))
                : 0,
            num_edges_support: this.get('edges_support'),
            num_edges_contra: this.get('edges_contra'),
            num_edges_ground: this.get('edges_ground'),
            num_issues: this.get('num_issues'),
            bottleneck: this.findBottleneck()
        };
        return metrics;
    }
    findBottleneck() {
        const stages = [
            { name: 'claim_extract', time: this.duration('claim_extract') },
            { name: 'source_gen', time: this.duration('source_gen') },
            { name: 'retrieval', time: this.duration('retrieval') },
            { name: 'scorer_init', time: this.duration('scorer_init') },
            { name: 'graph_build', time: this.duration('graph_build') },
            { name: 'nli_total', time: this.duration('nli_total') },
            { name: 'spectral', time: this.duration('spectral') },
            { name: 'issues_build', time: this.duration('issues_build') },
        ];
        stages.sort((a, b) => b.time - a.time);
        return stages[0]?.name || 'unknown';
    }
    logSummary() {
        const m = this.getMetrics();
        console.log('\n' + '='.repeat(60));
        console.log('📊 PIPELINE PERFORMANCE SUMMARY');
        console.log('='.repeat(60));
        console.log(`⏱️  TOTAL TIME: ${m.t_total}ms (${(m.t_total / 1000).toFixed(1)}s)`);
        console.log('');
        console.log('Stage Breakdown:');
        console.log(`  claim_extract:  ${m.t_claim_extract}ms`);
        console.log(`  source_gen:     ${m.t_source_gen}ms`);
        console.log(`  retrieval:      ${m.t_retrieval}ms`);
        console.log(`  scorer_init:    ${m.t_scorer_init}ms`);
        console.log(`  graph_build:    ${m.t_graph_build}ms (includes NLI)`);
        console.log(`  ├─ nli_total:   ${m.t_nli_total}ms`);
        console.log(`  spectral:       ${m.t_spectral}ms`);
        console.log(`  issues_build:   ${m.t_issues_build}ms`);
        console.log('');
        console.log('Counts:');
        console.log(`  claims:         ${m.num_claims}`);
        console.log(`  sources:        ${m.num_sources}`);
        console.log(`  evidence_hits:  ${m.num_evidence_chunks_total}`);
        console.log(`  nli_calls:      ${m.num_nli_calls} ⚠️ (should be < 20)`);
        console.log(`  nli_pairs:      ${m.num_nli_pairs_total}`);
        console.log(`  avg_batch_size: ${m.avg_pairs_per_batch}`);
        console.log('');
        console.log('Graph:');
        console.log(`  support_edges:  ${m.num_edges_support}`);
        console.log(`  contra_edges:   ${m.num_edges_contra}`);
        console.log(`  ground_edges:   ${m.num_edges_ground}`);
        console.log('');
        console.log(`🔥 BOTTLENECK: ${m.bottleneck}`);
        // Performance warnings
        if (m.num_nli_calls > 50) {
            console.log(`\n⚠️  WARNING: ${m.num_nli_calls} NLI calls is too many!`);
            console.log('   This is likely causing the slowdown.');
            console.log('   Solution: Increase batch size or reduce pairs.');
        }
        if (m.t_nli_total > 60000) {
            console.log(`\n⚠️  WARNING: NLI took ${(m.t_nli_total / 1000).toFixed(1)}s!`);
            console.log('   Pairs scored: ' + m.num_nli_pairs_total);
            console.log(`   Time per pair: ${(m.t_nli_total / Math.max(1, m.num_nli_pairs_total)).toFixed(0)}ms`);
        }
        console.log('='.repeat(60) + '\n');
    }
}
// Singleton for current request
let currentTimer = null;
export function startPipelineTimer() {
    currentTimer = new PipelineTimer();
    return currentTimer;
}
export function getPipelineTimer() {
    return currentTimer;
}
