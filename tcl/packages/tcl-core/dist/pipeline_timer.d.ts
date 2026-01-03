/**
 * Pipeline timing instrumentation.
 * Tracks timing and counts for each stage of the validation pipeline.
 */
export interface PipelineMetrics {
    t_total: number;
    t_claim_extract: number;
    t_source_gen: number;
    t_retrieval: number;
    t_scorer_init: number;
    t_graph_build: number;
    t_nli_total: number;
    t_spectral: number;
    t_issues_build: number;
    num_claims: number;
    num_sources: number;
    num_evidence_chunks_total: number;
    num_nli_calls: number;
    num_nli_pairs_total: number;
    avg_pairs_per_batch: number;
    num_edges_support: number;
    num_edges_contra: number;
    num_edges_ground: number;
    num_issues: number;
    bottleneck: string;
}
export declare class PipelineTimer {
    private startTime;
    private stages;
    private counts;
    constructor();
    start(stage: string): void;
    end(stage: string): number;
    duration(stage: string): number;
    count(key: string, value?: number): void;
    set(key: string, value: number): void;
    get(key: string): number;
    total(): number;
    getMetrics(): PipelineMetrics;
    private findBottleneck;
    logSummary(): void;
}
export declare function startPipelineTimer(): PipelineTimer;
export declare function getPipelineTimer(): PipelineTimer | null;
