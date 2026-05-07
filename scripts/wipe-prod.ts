/**
 * One-shot production wipe. Clears every PocketBase data collection.
 *
 * Usage:
 *   npx dotenv -e .env.production.local -- tsx scripts/wipe-prod.ts
 *
 * Per-specialty data goes first so per-collection indexes stay valid while
 * specialty rows are still around for the wipe of any orphaned children.
 * Then the global tables (sources, AMBOSS catalog, pipeline*).
 *
 * Skips `users` (auth identities) and `userApiKeys` — those belong to the
 * humans, not the seed.
 */

import type PocketBase from 'pocketbase';
import { clearCollection, pbAdminClient } from './_lib/pb';

const PER_SPECIALTY = [
  'codes',
  'codeCategories',
  'consolidatedArticles',
  'newArticleSuggestions',
  'articleUpdateSuggestions',
  'consolidatedSections',
  'icd10Codes',
  'hcupCodes',
  'abimCodes',
  'orphaCodes',
  'mappingsInFlight',
  'extractedCodes',
];

const GLOBAL = ['pipelineEvents', 'pipelineStages', 'pipelineRuns'];
const CATALOG = ['ambossArticles', 'ambossSections', 'codeSources', 'milestoneSources'];

async function deleteAll(pb: PocketBase, collection: string): Promise<number> {
  let removed = 0;
  while (true) {
    const page = await pb.collection(collection).getList(1, 200);
    if (page.items.length === 0) break;
    await Promise.all(page.items.map((row) => pb.collection(collection).delete(row.id)));
    removed += page.items.length;
    if (page.items.length < 200) break;
  }
  return removed;
}

async function main() {
  const pb = await pbAdminClient();

  const specialties = await pb.collection('specialties').getFullList({ fields: 'slug' });
  console.log(`▶ wiping per-specialty data for ${specialties.length} specialties …`);
  for (const s of specialties) {
    const slug = (s as unknown as { slug: string }).slug;
    const filter = `specialtySlug = "${slug}"`;
    let total = 0;
    for (const col of PER_SPECIALTY) {
      total += await clearCollection(pb, col, filter);
    }
    console.log(`  ✓ ${slug}: removed ${total} rows`);
  }

  console.log('▶ wiping global pipeline tables …');
  for (const col of GLOBAL) {
    const removed = await deleteAll(pb, col);
    console.log(`  ✓ ${col}: ${removed}`);
  }

  console.log('▶ wiping catalog/registry tables …');
  for (const col of CATALOG) {
    const removed = await deleteAll(pb, col);
    console.log(`  ✓ ${col}: ${removed}`);
  }

  console.log('▶ wiping specialties …');
  const removed = await deleteAll(pb, 'specialties');
  console.log(`  ✓ specialties: ${removed}`);

  console.log('done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
