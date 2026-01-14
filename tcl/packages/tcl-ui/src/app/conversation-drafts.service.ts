/**
 * Conversation Drafts Service
 * Handles draft conversation operations: create, list, transcribe, delete
 */

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

export interface ConversationDraft {
  id: string;
  orgId: string;
  projectId?: string;
  env: string;
  title: string;
  draftStatus: 'DRAFT_AUDIO_UPLOADED' | 'TRANSCRIPTION_QUEUED' | 'TRANSCRIBING' | 'TRANSCRIPT_READY' | 'TRANSCRIPTION_FAILED' | 'EVALUATED';
  audioAssetId?: string;
  transcriptAssetId?: string;
  transcriptionError?: string;
  evaluationId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export interface CreateDraftResponse {
  draft: {
    id: string;
    status: string;
    title: string;
    updatedAt: string;
    audioAssetId: string;
  };
}

export interface TranscribeResponse {
  success: boolean;
  message: string;
  conversationId: string;
  status: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConversationDraftsService {
  private get apiBase(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return `${apiUrl}/api`;
      }
    }
    return '/api';
  }

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  /**
   * Create a draft conversation with audio
   */
  createAudioDraft(audioAssetId: string, title?: string, projectId?: string): Observable<CreateDraftResponse> {
    return this.http.post<CreateDraftResponse>(`${this.apiBase}/conversations/drafts/audio`, {
      audioAssetId,
      title,
      projectId,
    });
  }

  /**
   * Start transcription for a draft conversation
   */
  transcribeDraft(conversationId: string): Observable<TranscribeResponse> {
    return this.http.post<TranscribeResponse>(`${this.apiBase}/conversations/${conversationId}/transcribe`, {});
  }

  /**
   * List draft conversations
   */
  listDrafts(projectId?: string, limit: number = 50, offset: number = 0): Observable<{ drafts: ConversationDraft[]; total: number }> {
    let params = new HttpParams()
      .set('limit', limit.toString())
      .set('offset', offset.toString());
    
    if (projectId) {
      params = params.set('projectId', projectId);
    }

    return this.http.get<{ drafts: ConversationDraft[]; total: number }>(`${this.apiBase}/conversations/drafts`, {
      params,
    });
  }

  /**
   * Get conversation details (for polling status)
   */
  getConversation(conversationId: string): Observable<{ conversation: ConversationDraft }> {
    return this.http.get<{ conversation: ConversationDraft }>(`${this.apiBase}/conversations/${conversationId}`);
  }

  /**
   * Delete a draft conversation
   */
  deleteDraft(conversationId: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.apiBase}/conversations/${conversationId}`);
  }

  /**
   * Run evaluation for a conversation with ready transcript
   */
  runEvaluation(conversationId: string): Observable<{ success: boolean; evaluationId: string; conversationId: string }> {
    return this.http.post<{ success: boolean; evaluationId: string; conversationId: string }>(
      `${this.apiBase}/conversations/${conversationId}/evaluate`,
      {}
    );
  }
}

