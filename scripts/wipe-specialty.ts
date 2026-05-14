/**
 * One-shot wipe of all per-specialty data for a given slug.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/wipe-specialty.ts <slug>
 *
 * Use this to clean up a specialty that ended up in a degenerate state
 * (e.g. extracted codes whose mapping signal got corrupted before the
 * mappedAt migration landed). The `specialties` row itself is left in
 * place — only its child rows across the per-specialty collections are
 * deleted.
 */

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
  'articleReviews',
  'sectionReviews',
  'articleBacklog',
  'consolidationCategoryReviews',
];

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx scripts/wipe-specialty.ts <slug>');
    process.exit(1);
  }

  const pb = await pbAdminClient();
  const filter = `specialtySlug = "${slug}"`;
  for (const collection of PER_SPECIALTY) {
    try {
      const removed = await clearCollection(pb, collection, filter);
      if (removed > 0) {
        console.log(`  ${collection}: ${removed}`);
      }
    } catch (e) {
      console.warn(`  ${collection}: skipped (${(e as Error).message})`);
    }
  }
  console.log(`Done wiping per-specialty data for "${slug}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
