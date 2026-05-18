/**
 * One-shot clear of all mapping output for a specialty, without deleting
 * the code rows themselves. Use when reset got out of sync with a still-
 * running fire-and-forget workflow.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/clear-mappings.ts <slug>
 */

import { pbAdminClient } from './_lib/pb';

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx scripts/clear-mappings.ts <slug>');
    process.exit(1);
  }

  const pb = await pbAdminClient();
  const rows = await pb.collection('codes').getFullList({
    filter: `specialtySlug = "${slug}"`,
    fields: 'id,mappedAt',
  });
  const toClear = rows.filter((r) => Number(r.mappedAt ?? 0) > 0);
  console.log(`Clearing ${toClear.length}/${rows.length} mapped codes for "${slug}"…`);
  let cleared = 0;
  for (const r of toClear) {
    try {
      await pb.collection('codes').update(r.id, {
        mappedAt: 0,
        isInAMBOSS: null,
        coverageLevel: null,
        depthOfCoverage: null,
        notes: null,
        gaps: null,
        improvements: null,
        articlesWhereCoverageIs: null,
        existingArticleUpdates: null,
        newArticlesNeeded: null,
      });
      cleared += 1;
    } catch (e) {
      console.error(`  failed: ${r.id} — ${(e as Error).message}`);
    }
  }
  // Drop any in-flight markers too so the codes table stops pulsing.
  const inflight = await pb
    .collection('mappingsInFlight')
    .getFullList({ filter: `specialtySlug = "${slug}"` });
  await Promise.all(
    inflight.map((row) =>
      pb.collection('mappingsInFlight').delete(row.id, { requestKey: null }),
    ),
  );
  console.log(`Cleared ${cleared} codes · removed ${inflight.length} in-flight markers.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
