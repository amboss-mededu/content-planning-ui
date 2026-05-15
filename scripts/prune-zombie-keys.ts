/**
 * Prune zombie consumer rows whose stable key never resolved during the
 * 1779200000 backfill.
 *
 * Background: the stable-keys migration backfilled `articleKey` /
 * `sectionKey` / `recordKey` on consumer collections by looking up the
 * legacy `articleRecordId` / `sectionRecordId` / `recordId` in the
 * matching producer. Rows whose producer was already gone keep an empty
 * key — they're invisible in the UI (the data layer filters them out)
 * but still take up rows in the DB. This script enumerates them and,
 * with `--apply`, deletes them.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/prune-zombie-keys.ts          # dry-run
 *   npx dotenv -e .env.local -- tsx scripts/prune-zombie-keys.ts --apply  # delete
 */

import { pbAdminClient, type ScriptPbClient } from './_lib/pb';

type TargetCollection = {
  collection: string;
  keyField: 'articleKey' | 'sectionKey' | 'recordKey';
};

const TARGETS: TargetCollection[] = [
  { collection: 'articleReviews', keyField: 'articleKey' },
  { collection: 'articleBacklog', keyField: 'articleKey' },
  { collection: 'sectionReviews', keyField: 'sectionKey' },
  { collection: 'reviewComments', keyField: 'recordKey' },
  { collection: 'articleSources', keyField: 'articleKey' },
];

async function countAndOptionallyDelete(
  pb: ScriptPbClient,
  target: TargetCollection,
  apply: boolean,
): Promise<{ collection: string; total: number; zombies: number; deleted: number }> {
  const totalList = await pb.collection(target.collection).getList(1, 1, {
    fields: 'id',
  });
  const total = totalList.totalItems;

  // Empty-string is the PB default for text fields, so `keyField = ""`
  // is the correct filter — null doesn't apply.
  const filter = `${target.keyField} = ""`;
  const zombieList = await pb.collection(target.collection).getList(1, 1, {
    filter,
    fields: 'id',
  });
  const zombies = zombieList.totalItems;

  let deleted = 0;
  if (apply && zombies > 0) {
    while (true) {
      const page = await pb
        .collection(target.collection)
        .getList(1, 200, { filter, fields: 'id' });
      if (page.items.length === 0) break;
      await Promise.all(
        page.items.map((row) => pb.collection(target.collection).delete(row.id)),
      );
      deleted += page.items.length;
      if (page.items.length < 200) break;
    }
  }

  return { collection: target.collection, total, zombies, deleted };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const pb = await pbAdminClient();

  console.log(apply ? '[apply] deleting zombies' : '[dry-run] counting zombies');
  console.log('');

  const results: Array<{
    collection: string;
    total: number;
    zombies: number;
    deleted: number;
  }> = [];
  let failures = 0;
  for (const target of TARGETS) {
    try {
      const r = await countAndOptionallyDelete(pb, target, apply);
      results.push(r);
      const action = apply ? `→ deleted ${r.deleted}` : '(dry-run)';
      console.log(
        `${r.collection.padEnd(20)}  total=${String(r.total).padStart(5)}  zombies=${String(r.zombies).padStart(5)}  ${action}`,
      );
    } catch (e) {
      failures++;
      console.log(
        `${target.collection.padEnd(20)}  ERROR: ${e instanceof Error ? e.message : String(e)}`,
      );
      console.log(
        '  (If the column was just added, restart PB so it picks up the schema.)',
      );
    }
  }

  console.log('');
  const totalZombies = results.reduce((acc, r) => acc + r.zombies, 0);
  const totalDeleted = results.reduce((acc, r) => acc + r.deleted, 0);
  if (!apply) {
    console.log(`Total zombies: ${totalZombies}. Re-run with --apply to delete.`);
  } else {
    console.log(`Deleted ${totalDeleted} zombie rows.`);
  }
  if (failures > 0) {
    console.log(`(${failures} collection(s) skipped due to errors above.)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
