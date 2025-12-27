import { Source, Claim } from "../types.js";

export type ExtractArtifactsInput = {
  question: string;
  answer: string;
  sources?: Source[];
};

export type ExtractArtifactsOutput = {
  answer: string;
  claims: Claim[];
};

export type RepairInput = {
  question: string;
  originalAnswer: string;
  claims: Claim[];
  sources?: Source[];
  failingClaimIds: string[];
  policy?: {
    requireCitations?: boolean;
    allowHedging?: boolean;
    maxAnswerChars?: number;
  };
};

export type RepairOutput = {
  repairedAnswer: string;
  notes: string[];
};

export interface LLMAdapter {
  name: string;
  extractArtifacts(input: ExtractArtifactsInput): Promise<ExtractArtifactsOutput>;
  repairOnePass(input: RepairInput): Promise<RepairOutput>;
}
