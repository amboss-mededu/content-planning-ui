import 'server-only';

import { connection } from 'next/server';
import { normalizeRole, type UserRole } from '@/lib/auth/roles';
import { createAdminClient } from '@/lib/pb/server';
import type { UserRecord } from '@/lib/pb/types';

export type TeamMember = {
  id: string;
  email: string;
  name?: string;
  role: UserRole;
};

/**
 * Returns verified, allowlisted users available as assignees. Uses the
 * admin client because PB's default `users` listRule blocks one
 * authenticated user from enumerating others. The returned shape is
 * the minimum needed for the assignee dropdown — we do not expose
 * PB system fields or auth tokens to the client.
 */
export async function listAssignableUsers(): Promise<
  Array<{ email: string; name?: string }>
> {
  await connection();
  const pb = await createAdminClient();
  const rows = await pb
    .collection<UserRecord>('users')
    .getFullList({ filter: 'verified = true' });
  return rows
    .map((u) => ({ email: u.email, name: u.name }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

/**
 * All users with their roles, for the architect-only "Team roles" admin panel.
 * Admin client because PB's `users` listRule blocks enumeration. Callers MUST
 * gate this behind an architect check (see settings actions).
 */
export async function listAllUsersWithRoles(): Promise<TeamMember[]> {
  await connection();
  const pb = await createAdminClient();
  const rows = await pb.collection<UserRecord>('users').getFullList();
  return rows
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: normalizeRole(u.role),
    }))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

/**
 * Set a single user's role. Admin client because PB's `users` updateRule only
 * lets a user edit their own record. Callers MUST gate behind an architect
 * check (see settings actions).
 */
export async function setUserRoleAsAdmin(userId: string, role: UserRole): Promise<void> {
  const pb = await createAdminClient();
  await pb.collection('users').update(userId, { role });
}
