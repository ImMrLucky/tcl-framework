/**
 * Integration Connections Management
 * Handles connection configuration for cloud storage and batch upload integrations
 */
import express from 'express';
export type IntegrationType = 'S3' | 'GDRIVE' | 'DROPBOX' | 'SHAREPOINT' | 'BATCH_UPLOAD';
export type IntegrationStatus = 'DISCONNECTED' | 'CONNECTED' | 'ERROR';
export interface IntegrationConnection {
    id: string;
    orgId: string;
    type: IntegrationType;
    status: IntegrationStatus;
    config: Record<string, any>;
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    lastSyncAt?: string;
    comingSoon?: boolean;
}
export interface IntegrationTypeInfo {
    type: IntegrationType;
    name: string;
    description: string;
    comingSoon: boolean;
    icon?: string;
}
export declare const INTEGRATION_TYPES: IntegrationTypeInfo[];
export declare function setupIntegrationConnectionsRoutes(app: express.Application): void;
