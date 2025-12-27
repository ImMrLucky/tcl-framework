import { Claim, Source, ValidateOutput } from "./types.js";
import { LLMAdapter } from "./adapters/llm_adapter.js";
export declare function collectFailingClaimIds(report: ValidateOutput["report"]): string[];
export declare function repairOnce(params: {
    adapter: LLMAdapter;
    question: string;
    originalAnswer: string;
    claims: Claim[];
    sources?: Source[];
    failingClaimIds: string[];
    requireCitations: boolean;
}): Promise<{
    repairedAnswer: string;
    notes: string[];
}>;
