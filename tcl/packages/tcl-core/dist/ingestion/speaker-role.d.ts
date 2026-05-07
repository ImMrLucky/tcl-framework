export type SpeakerRole = "agent" | "customer" | "supervisor" | "bot" | "system" | "unknown";
export interface SpeakerContext {
    salesCall?: boolean;
    explicitRole?: SpeakerRole;
}
export interface SpeakerMappingResult {
    role: SpeakerRole;
    confidence: number;
    mappingDecision: string;
    rawSpeaker: string;
}
export declare function mapSpeakerToRole(rawSpeaker: string, context?: SpeakerContext): SpeakerMappingResult;
export declare function speakerRoleToDisplay(role: SpeakerRole): "Agent" | "Customer" | "Supervisor" | "Bot" | "System" | "Unknown";
export declare function isRecognizedTranscriptSpeaker(rawSpeaker: string): boolean;
