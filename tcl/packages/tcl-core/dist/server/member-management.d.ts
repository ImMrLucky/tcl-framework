/**
 * Member Management Utilities
 * Handles inviting users to organizations and managing roles
 */
import { type Role } from './permissions.js';
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
/**
 * Invite a user to an organization
 * Requires: manage_members permission (owner or admin)
 */
export declare function inviteMember(inviterUserId: string, orgId: string, email: string, role: Role): Promise<InviteMemberResponse>;
/**
 * Update a member's role
 * Requires: manage_members permission (owner or admin)
 */
export declare function updateMemberRole(updaterUserId: string, orgId: string, memberUserId: string, newRole: Role): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * Remove a member from an organization
 * Requires: manage_members permission (owner or admin)
 */
export declare function removeMember(removerUserId: string, orgId: string, memberUserId: string): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * List all members of an organization
 * Requires: view permission (all members can view)
 */
export declare function listMembers(orgId: string): Promise<Array<{
    userId: string;
    email: string;
    role: Role;
    fullName?: string;
    createdAt: string;
}>>;
