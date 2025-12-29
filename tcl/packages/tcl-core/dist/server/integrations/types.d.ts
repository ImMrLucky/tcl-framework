/**
 * Integration Layer Types
 * Decoupled from TCL Core - can be used independently
 */
export type IntegrationType = 'webhook_ingest' | 'webhook_export' | 'slack_alert' | 'teams_alert' | 's3_drop' | 'zendesk' | 'salesforce' | 'dropbox' | 'amazon_connect';
export type ArtifactType = 'transcript_text' | 'chat_messages' | 'email_thread' | 'audio_recording' | 'attachment' | 'evidence_doc';
export type Channel = 'call' | 'chat' | 'email' | 'other';
export type Environment = 'sandbox' | 'production';
export interface ConversationArtifact {
    type: ArtifactType;
    text?: string;
    messages?: ChatMessage[];
    storage_ref?: StorageReference;
    content_type?: string;
    filename?: string;
}
export interface ChatMessage {
    ts: string;
    author: string;
    text: string;
    meta?: Record<string, any>;
}
export interface StorageReference {
    provider: 's3' | 'dropbox' | 'gcs' | 'azure';
    bucket?: string;
    key?: string;
    path?: string;
    url?: string;
    [key: string]: any;
}
export interface WebhookIngestPayload {
    external_id: string;
    channel: Channel;
    title?: string;
    artifacts: ConversationArtifact[];
    meta?: {
        agent_id?: string;
        queue?: string;
        started_at?: string;
        ended_at?: string;
        [key: string]: any;
    };
    auto_start_evaluation?: boolean;
    rubric_id?: string;
}
export interface RealtimeSessionStart {
    channel: Channel;
    meta?: Record<string, any>;
}
export interface RealtimeChunk {
    type: 'chat_messages' | 'transcript_text';
    messages?: ChatMessage[];
    text?: string;
}
export interface RealtimeFinalize {
    auto_start_evaluation?: boolean;
    rubric_id?: string;
}
export interface IntegrationConfig {
    integration_type: IntegrationType;
    name: string;
    config: Record<string, any>;
    secrets?: Record<string, string>;
    is_active?: boolean;
    is_beta?: boolean;
}
export interface DeliveryAttempt {
    integration_id: string;
    evaluation_id: string;
    payload: Record<string, any>;
    attempt_number: number;
    status: 'pending' | 'success' | 'failed' | 'retrying';
    error_message?: string;
    next_retry_at?: string;
}
export interface EvidenceSourceConfig {
    source_type: 's3' | 'dropbox' | 'upload' | 'api' | 'webhook';
    name: string;
    config: Record<string, any>;
}
export interface EvidenceArtifact {
    filename: string;
    content_type: string;
    storage_ref?: StorageReference;
    extracted_text?: string;
    extracted_json?: Record<string, any>;
}
