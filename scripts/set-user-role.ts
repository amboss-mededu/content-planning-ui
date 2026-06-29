/**
 * One-off: set a user's role (architect | editor).
 *
 *   dotenv -e .env.local -- tsx scripts/set-user-role.ts <email> <role>
 *
 * Promotes/demotes an EXISTING user record. The CONTENT_ARCHITECT_ALLOWLIST env
 * only applies at first sign-up, so already-registered users (like the main
 * account) must be updated here or in the PocketBase admin UI.
 */

import { pbAdminClient } from './_lib/pb';

const VALID_ROLES = ['architect', 'editor'] as const;
type Role = (typeof VALID_ROLES)[number];

async function main(): Promise<void> {
  const [email, role] = process.argv.slice(2);
  if (!email || !role) {
    throw new Error('Usage: set-user-role.ts <email> <architect|editor>');
  }
  if (!VALID_ROLES.includes(role as Role)) {
    throw new Error(`Role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  const pb = await pbAdminClient();

  const user = await pb
    .collection('users')
    .getFirstListItem(`email = "${email.toLowerCase()}"`)
    .catch(() => null);
  if (!user) {
    throw new Error(`No user found with email ${email}. Have they signed in at least once?`);
  }

  await pb.collection('users').update(user.id, { role });
  const updated = await pb.collection('users').getOne(user.id);
  console.log(`✓ ${email} → role=${updated.role}`);
  if (updated.role !== role) {
    throw new Error(
      `Role did not persist (got "${updated.role}"). The "role" field may be ` +
        `missing — restart PocketBase so migration 1782000000_users_role.js applies.`,
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
