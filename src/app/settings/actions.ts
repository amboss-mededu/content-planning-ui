'use server';

import { revalidatePath } from 'next/cache';
import { assertArchitect } from '@/lib/auth';
import type { UserRole } from '@/lib/auth/roles';
import {
  listAllUsersWithRoles,
  setUserRoleAsAdmin,
  type TeamMember,
} from '@/lib/data/users';

/** Architect-only: full team roster with roles for the Team roles panel. */
export async function loadTeamRoles(): Promise<TeamMember[]> {
  await assertArchitect();
  return listAllUsersWithRoles();
}

/**
 * Architect-only: promote/demote a user. A role change takes effect on the
 * target's next login/token refresh (their auth cookie carries the old role
 * until then); server guards re-read the live record, so access is never wider
 * than the stored role.
 */
export async function updateUserRole(
  userId: string,
  role: UserRole,
): Promise<{ error?: string }> {
  const self = await assertArchitect();
  if (role !== 'editor' && role !== 'architect') {
    return { error: 'Unknown role.' };
  }
  // Guard against an architect demoting themselves and locking the team out of
  // the admin panel by accident.
  if (self._id === userId && role !== 'architect') {
    return { error: 'You cannot remove your own architect role.' };
  }
  try {
    await setUserRoleAsAdmin(userId, role);
    revalidatePath('/settings');
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to update role.' };
  }
}
