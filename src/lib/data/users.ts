import 'server-only';

import { connection } from 'next/server';
import { createAdminClient } from '@/lib/pb/server';
import type { UserRecord } from '@/lib/pb/types';

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
