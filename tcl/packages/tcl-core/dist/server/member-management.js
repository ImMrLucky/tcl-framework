/**
 * Member Management Utilities
 * Handles inviting users to organizations and managing roles
 */
import { supabaseAdmin } from './supabase.js';
import { checkUserPermission } from './supabase.js';
import { isValidRole } from './permissions.js';
/**
 * Invite a user to an organization
 * Requires: manage_members permission (owner or admin)
 */
export async function inviteMember(inviterUserId, orgId, email, role) {
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
    }
    else {
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
        // TODO: Send invitation email via Supabase Auth or your email service
        // For now, the user will receive a confirmation email from Supabase
        return {
            success: true,
            message: 'User created and invited to organization. They will receive an email to set their password.',
            userId: newUser.user.id,
            memberId: `${orgId}-${newUser.user.id}`
        };
    }
}
/**
 * Update a member's role
 * Requires: manage_members permission (owner or admin)
 */
export async function updateMemberRole(updaterUserId, orgId, memberUserId, newRole) {
    if (!supabaseAdmin) {
        return { success: false, message: 'Supabase not configured' };
    }
    // Check if updater has permission
    const canManage = await checkUserPermission(updaterUserId, orgId, 'manage_members');
    if (!canManage) {
        return { success: false, message: 'Insufficient permissions to update member roles' };
    }
    // Validate role
    if (!isValidRole(newRole)) {
        return { success: false, message: `Invalid role: ${newRole}` };
    }
    // Prevent removing the last owner
    if (newRole !== 'owner') {
        const { data: owners } = await supabaseAdmin
            .from('org_members')
            .select('user_id')
            .eq('org_id', orgId)
            .eq('role', 'owner');
        if (owners && owners.length === 1 && owners[0].user_id === memberUserId) {
            return { success: false, message: 'Cannot remove the last owner from an organization' };
        }
    }
    // Update role
    const { error } = await supabaseAdmin
        .from('org_members')
        .update({ role: newRole })
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
export async function removeMember(removerUserId, orgId, memberUserId) {
    if (!supabaseAdmin) {
        return { success: false, message: 'Supabase not configured' };
    }
    // Check if remover has permission
    const canManage = await checkUserPermission(removerUserId, orgId, 'manage_members');
    if (!canManage) {
        return { success: false, message: 'Insufficient permissions to remove members' };
    }
    // Prevent removing the last owner
    const { data: owners } = await supabaseAdmin
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('role', 'owner');
    if (owners && owners.length === 1 && owners[0].user_id === memberUserId) {
        return { success: false, message: 'Cannot remove the last owner from an organization' };
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
export async function listMembers(orgId) {
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
    return data.map((m) => ({
        userId: m.user_id,
        email: m.profiles?.email || '',
        role: m.role,
        fullName: m.profiles?.full_name || undefined,
        createdAt: m.created_at
    }));
}
