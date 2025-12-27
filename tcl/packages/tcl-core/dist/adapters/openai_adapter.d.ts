import { LLMAdapter, ExtractArtifactsInput, ExtractArtifactsOutput, RepairInput, RepairOutput } from "./llm_adapter.js";
type OpenAIAdapterConfig = {
    apiKey: string;
    model: string;
    baseUrl?: string;
};
export declare class OpenAIAdapter implements LLMAdapter {
    name: string;
    private apiKey;
    private model;
    private baseUrl;
    constructor(cfg: OpenAIAdapterConfig);
    extractArtifacts(input: ExtractArtifactsInput): Promise<ExtractArtifactsOutput>;
    repairOnePass(input: RepairInput): Promise<RepairOutput>;
}
export {};
