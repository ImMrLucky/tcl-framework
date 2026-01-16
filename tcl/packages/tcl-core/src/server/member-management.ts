/**
 * Member Management Utilities
 * Handles inviting users to organizations and managing roles
 */

import { supabaseAdmin } from './supabase.js';
import { getUserRole, checkUserPermission } from './supabase.js';
import { isValidRole, type Role } from './permissions.js';

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
export async function inviteMember(
  inviterUserId: string,
  orgId: string,
  email: string,
  role: Role
): Promise<InviteMemberResponse> {
  if (!supabaseAdmin) {
    return { success: false, message: 'Supabase not configured' };
  }

  // Check if inviter has permission to manage members
  const canManage = await checkUserPermission(inviterUserId, orgId, 'manage_members');
  if (!canManage) {
    return { success: false, message: 'Insufficient permissions to invite members' };
  }

  // Validate role
  if (!isValidRole(role)) {
    return { success: false, message: `Invalid role: ${role}` };
  }

  // Check if user already exists in auth.users
  const { data: existingUsers, error: userError } = await supabaseAdmin.auth.admin.listUsers();
  
  if (userError) {
    return { success: false, message: `Failed to check existing users: ${userError.message}` };
  }

  const existingUser = existingUsers.users.find(u => u.email === email);

  if (existingUser) {
    // User exists - check if already a member
    const { data: existingMember } = await supabaseAdmin
      .from('org_members')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', existingUser.id)
      .maybeSingle();

    if (existingMember) {
      // Update role if different
      if (existingMember.role !== role) {
        const { error: updateError } = await supabaseAdmin
          .from('org_members')
          .update({ role })
          .eq('org_id', orgId)
          .eq('user_id', existingUser.id);

        if (updateError) {
          return { success: false, message: `Failed to update member role: ${updateError.message}` };
        }
      }

      return {
        success: true,
        message: 'User is already a member. Role updated if needed.',
        userId: existingUser.id,
        memberId: `${orgId}-${existingUser.id}`
      };
    }

    // User exists but not a member - add them
    const { data: newMember, error: insertError } = await supabaseAdmin
      .from('org_members')
      .insert({
        org_id: orgId,
        user_id: existingUser.id,
        role
      })
      .select()
      .single();

    if (insertError) {
      return { success: false, message: `Failed to add member: ${insertError.message}` };
    }

    return {
      success: true,
      message: 'User added to organization',
      userId: existingUser.id,
      memberId: `${orgId}-${existingUser.id}`
    };
  } else {
    // User doesn't exist - create invitation
    // For now, we'll create the user and send them an email
    // In production, you might want to use Supabase's invitation system
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false, // They'll need to confirm via email
      user_metadata: {
        invited_by: inviterUserId,
        invited_to_org: orgId
      }
    });

    if (createError) {
      return { success: false, message: `Failed to create user: ${createError.message}` };
    }

    // Create profile
    await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUser.user.id,
        email: newUser.user.email || email
      }, {
        onConflict: 'id'
      });

    // Add to org_members
    const { data: newMember, error: memberError } = await supabaseAdmin
      .from('org_members')
      .insert({
        org_id: orgId,
        user_id: newUser.user.id,
        role
      })
      .select()
      .single();

    if (memberError) {
      return { success: false, message: `Failed to add member: ${memberError.message}` };
    }

    // Send invitation email with signup link
    // Use PROTECTQA_URL for production (ProtectQA.com), fallback to FRONTEND_URL or default
    const frontendUrl = process.env.PROTECTQA_URL || process.env.FRONTEND_URL || 'https://ProtectQA.com';
    const signupUrl = `${frontendUrl}/login?invite=true&email=${encodeURIComponent(email)}`;
    
    // Use Supabase's inviteUserByEmail which sends a proper invitation email
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: {
          invited_by: inviterUserId,
          invited_to_org: orgId,
          role: role
        },
        redirectTo: signupUrl
      }
    );

    if (inviteError) {
      console.error('Failed to send invitation email:', inviteError);
      // Still return success since user was created, but log the email error
      return {
        success: true,
        message: 'User created and added to organization. Email invitation may have failed - please contact them directly.',
        userId: newUser.user.id,
        memberId: `${orgId}-${newUser.user.id}`
      };
    }

    return {
      success: true,
      message: 'User invited successfully. They will receive an email with a signup link.',
      userId: newUser.user.id,
      memberId: `${orgId}-${newUser.user.id}`
    };
  }
}

/**
 * Update a member's role
 * Requires: manage_members permission (owner or admin)
 */
export async function updateMemberRole(
  updaterUserId: string,
  orgId: string,
  memberUserId: string,
  newRole: Role
): Promise<{ success: boolean; message: string }> {
  if (!supabaseAdmin) {
    return { success: false, message: 'Supabase not configured' };
  }

  // Check if updater has permission
  const canManage = await checkUserPermission(updaterUserId, orgId, 'manage_members');
  if (!canManage) {
    return { success: false, message: 'Insufficient permissions to update member roles' };
  }

  // Validate role (normalize to uppercase for database)
  const normalizedRole = newRole.toUpperCase() as 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER';
  const validRoles = ['OWNER', 'ADMIN', 'MANAGER', 'ANALYST', 'VIEWER'];
  if (!validRoles.includes(normalizedRole)) {
    return { success: false, message: `Invalid role: ${newRole}` };
  }

  // Prevent demoting the last OWNER
  // Note: Role type is lowercase ('owner'), but DB stores uppercase ('OWNER')
  if (normalizedRole !== 'OWNER') {
    const { data: owners } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'OWNER');

    if (owners && owners.length === 1 && owners[0].user_id === memberUserId) {
      return { success: false, message: 'Cannot demote the last owner from an organization' };
    }
  }

  // Prevent demoting/removing the last ADMIN (if they're currently ADMIN)
  const { data: currentMember } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', memberUserId)
    .single();

  // Note: DB stores uppercase roles, normalizedRole is already uppercase
  if (currentMember?.role === 'ADMIN' && normalizedRole !== 'ADMIN' && normalizedRole !== 'OWNER') {
    // Check if this is the last ADMIN (excluding OWNERs who can also act as admins)
    const { data: admins } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'ADMIN');

    if (admins && admins.length === 1 && admins[0].user_id === memberUserId) {
      return { success: false, message: 'Cannot demote the last admin. An organization must have at least one admin or owner.' };
    }
  }

  // Update role (use normalized uppercase)
  const { error } = await supabaseAdmin
    .from('org_members')
    .update({ role: normalizedRole })
    .eq('org_id', orgId)
    .eq('user_id', memberUserId);

  if (error) {
    return { success: false, message: `Failed to update role: ${error.message}` };
  }

  return { success: true, message: 'Member role updated successfully' };
}

/**
 * Remove a member from an organization
 * Requires: manage_members permission (owner or admin)
 */
export async function removeMember(
  removerUserId: string,
  orgId: string,
  memberUserId: string
): Promise<{ success: boolean; message: string }> {
  if (!supabaseAdmin) {
    return { success: false, message: 'Supabase not configured' };
  }

  // Check if remover has permission
  const canManage = await checkUserPermission(removerUserId, orgId, 'manage_members');
  if (!canManage) {
    return { success: false, message: 'Insufficient permissions to remove members' };
  }

  // Get current member role
  const { data: currentMember } = await supabaseAdmin
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', memberUserId)
    .single();

  if (!currentMember) {
    return { success: false, message: 'Member not found' };
  }

  // Prevent removing the last OWNER
  if (currentMember.role === 'OWNER') {
    const { data: owners } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'OWNER');

    if (owners && owners.length === 1 && owners[0].user_id === memberUserId) {
      return { success: false, message: 'Cannot remove the last owner from an organization' };
    }
  }

  // Prevent removing the last ADMIN
  if (currentMember.role === 'ADMIN') {
    const { data: admins } = await supabaseAdmin
      .from('org_members')
      .select('user_id')
      .eq('org_id', orgId)
      .eq('role', 'ADMIN');

    if (admins && admins.length === 1 && admins[0].user_id === memberUserId) {
      return { success: false, message: 'Cannot remove the last admin. An organization must have at least one admin or owner.' };
    }
  }

  // Remove member
  const { error } = await supabaseAdmin
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', memberUserId);

  if (error) {
    return { success: false, message: `Failed to remove member: ${error.message}` };
  }

  return { success: true, message: 'Member removed successfully' };
}

/**
 * List all members of an organization
 * Requires: view permission (all members can view)
 */
export async function listMembers(orgId: string): Promise<Array<{
  userId: string;
  email: string;
  role: Role;
  fullName?: string;
  createdAt: string;
}>> {
  if (!supabaseAdmin) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from('org_members')
    .select(`
      user_id,
      role,
      created_at,
      profiles (
        email,
        full_name
      )
    `)
    .eq('org_id', orgId)
    .order('created_at', { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((m: any) => ({
    userId: m.user_id,
    email: m.profiles?.email || '',
    role: m.role as Role,
    fullName: m.profiles?.full_name || undefined,
    createdAt: m.created_at
  }));
}

