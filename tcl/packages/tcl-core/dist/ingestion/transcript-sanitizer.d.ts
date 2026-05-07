export interface TranscriptSanitizerResult {
    text: string;
    removedAnnotationLines: number;
    normalizedInlineSpeakerBoundaries: number;
    unknownSpeakerLines: number;
    diagnostics: string[];
}
export declare function sanitizeTranscriptForScoring(input: string): TranscriptSanitizerResult;
export declare function isContaminatedClaimText(text: string): boolean;
export declare function countSpeakerLabelsInClaim(text: string): number;
