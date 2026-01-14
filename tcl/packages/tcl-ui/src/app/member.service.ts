import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type Role = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';

export interface Member {
  userId: string;
  email: string;
  role: Role;
  fullName?: string;
  createdAt: string;
}

export interface InviteMemberRequest {
  email: string;
  role: Role;
}

export interface InviteMemberResponse {
  success: boolean;
  message: string;
  userId?: string;
  memberId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class MemberService {
  private get apiBase(): string {
    if (typeof window !== 'undefined') {
      const apiUrl = (window as any).__TCL_API_URL;
      if (apiUrl) {
        return apiUrl;
      }
    }
    return '/api';
  }

  constructor(private http: HttpClient) {}

  /**
   * Get current user ID from auth service
   */
  private getCurrentUserId(): string | null {
    // This will be set by the component that has access to AuthService
    return null;
  }

  /**
   * List all members of an organization
   */
  listMembers(orgId: string, userId: string): Observable<{ members: Member[] }> {
    return this.http.get<{ members: Member[] }>(`${this.apiBase}/orgs/${orgId}/members`, {
      params: { userId }
    });
  }

  /**
   * Invite a member to an organization
   */
  inviteMember(orgId: string, userId: string, email: string, role: Role): Observable<InviteMemberResponse> {
    return this.http.post<InviteMemberResponse>(`${this.apiBase}/orgs/${orgId}/members/invite`, {
      email,
      role,
      userId
    });
  }

  /**
   * Update a member's role
   */
  updateMemberRole(orgId: string, userId: string, memberUserId: string, role: Role): Observable<{ success: boolean; message: string }> {
    return this.http.patch<{ success: boolean; message: string }>(
      `${this.apiBase}/orgs/${orgId}/members/${memberUserId}`,
      { role, userId }
    );
  }

  /**
   * Remove a member from an organization
   */
  removeMember(orgId: string, userId: string, memberUserId: string): Observable<{ success: boolean; message: string }> {
    return this.http.delete<{ success: boolean; message: string }>(
      `${this.apiBase}/orgs/${orgId}/members/${memberUserId}`,
      { params: { userId } }
    );
  }

  /**
   * Get user's organizations
   */
  getUserOrgs(userId: string): Observable<{ orgs: Array<{ id: string; name: string; slug: string; role: string }> }> {
    return this.http.post<{ orgs: Array<{ id: string; name: string; slug: string; role: string }> }>(
      `${this.apiBase}/me/orgs`,
      { userId }
    );
  }
}

