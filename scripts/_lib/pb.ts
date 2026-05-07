/**
 * Shared PocketBase admin client for CLI scripts.
 *
 * Scripts run outside any Next.js request, so they need a superuser-authed
 * client to bypass per-collection access rules. This thin wrapper creates a
 * fresh `PocketBase` instance and authenticates with `_superusers`, reading
 * credentials from the environment so nothing is committed.
 *
 * Replaces `_lib/convex.ts` from the pre-migration codebase.
 */

import 'dotenv/config';
import PocketBase from 'pocketbase';

export type ScriptPbClient = PocketBase;

function require_(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set in the environment — required for scripts to talk to PocketBase. Set it in .env.local.`,
    );
  }
  return v;
}

export async function pbAdminClient(): Promise<ScriptPbClient> {
  const url = require_('POCKETBASE_URL');
  const email = require_('POCKETBASE_ADMIN_EMAIL');
  const password = require_('POCKETBASE_ADMIN_PASSWORD');
  const pb = new PocketBase(url);
  await pb.collection('_superusers').authWithPassword(email, password);
  return pb;
}

/**
 * Delete every record in `collection` matching `filter`, paged so the script
 * stays bounded under load. Returns the count removed.
 */
export async function clearCollection(
  pb: ScriptPbClient,
  collection: string,
  filter: string,
): Promise<number> {
  let removed = 0;
  while (true) {
    const page = await pb.collection(collection).getList(1, 200, { filter });
    if (page.items.length === 0) break;
    await Promise.all(page.items.map((row) => pb.collection(collection).delete(row.id)));
    removed += page.items.length;
    if (page.items.length < 200) break;
  }
  return removed;
}

/**
 * Bulk-create `rows` in `collection` with a small concurrency window. PB has
 * no native bulk-create endpoint; a moderate concurrency keeps the local
 * SQLite happy while staying much faster than serial inserts.
 */
export async function bulkCreate<T extends Record<string, unknown>>(
  pb: ScriptPbClient,
  collection: string,
  rows: T[],
  concurrency = 10,
): Promise<void> {
  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
    await Promise.all(batch.map((row) => pb.collection(collection).create(row)));
  }
}
