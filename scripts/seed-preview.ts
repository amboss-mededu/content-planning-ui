/**
 * DEV TOOLING — minimal preview of the upcoming PR 8 PocketBase seed.
 *
 *   POCKETBASE_URL=http://localhost:8090 \
 *   POCKETBASE_ADMIN_EMAIL=... \
 *   POCKETBASE_ADMIN_PASSWORD=... \
 *     npm run seed:preview
 *
 * Reads the same xlsx fixtures as the existing Convex seed (defaults to
 * anesthesiology_mapping.xlsx in the repo root, plus anything in the
 * LOCAL_XLSX_FIXTURES env var). For each fixture, pushes the smaller
 * domains — specialty + code categories + codes + sources — into PB via
 * the admin SDK. Idempotent: clears the existing rows for the slug
 * before reinserting.
 *
 * Skips article/section/ontology/AMBOSS imports — those land with the
 * full PR 8 port. Just enough here to see real data flowing through the
 * schema and to validate that PB indexes hold up under realistic write
 * load.
 *
 * The route this exercises will get rewritten in PR 8 against the
 * postcleanup PB-only data layer; this preview is meant to be deleted
 * (or replaced by the full seed) at that point.
 */
import 'dotenv/config';
import { createAdminClient } from '../src/lib/pb/server';
import { buildXlsxRegistry, createXlsxRepos } from './_lib/xlsx';

const NOW = Date.now();

async function clearCollection(
  pb: Awaited<ReturnType<typeof createAdminClient>>,
  collection: string,
  filter: string,
): Promise<number> {
  let removed = 0;
  // PB list+delete in batches; getList does pagination internally with
  // .getFullList() but we want a real paginated delete loop to keep memory
  // bounded for big specialties.
  while (true) {
    const page = await pb.collection(collection).getList(1, 200, { filter });
    if (page.items.length === 0) break;
    await Promise.all(page.items.map((row) => pb.collection(collection).delete(row.id)));
    removed += page.items.length;
    if (page.items.length < 200) break;
  }
  return removed;
}

async function main(): Promise<void> {
  const registry = buildXlsxRegistry();
  if (registry.length === 0) {
    console.error(
      'No xlsx fixtures configured. Drop anesthesiology_mapping.xlsx in the repo root or set LOCAL_XLSX_FIXTURES.',
    );
    process.exit(1);
  }

  const repos = createXlsxRepos(registry);
  const pb = await createAdminClient();
  console.log(`Seeding ${registry.length} specialty/specialties into PocketBase…`);

  for (const fx of registry) {
    console.log(`\n→ ${fx.slug} (${fx.xlsxPath})`);
    const filter = `specialtySlug = "${fx.slug}"`;

    // Wipe-first → reseed makes the script idempotent. Clear in
    // dependency order (no FKs in the dropped collections, so order is
    // mostly cosmetic, but specialties go last so its slug is still
    // referenced by anything mid-delete).
    for (const col of ['codes', 'codeCategories']) {
      const removed = await clearCollection(pb, col, filter);
      if (removed > 0) console.log(`  cleared ${removed} ${col}`);
    }
    try {
      const existing = await pb
        .collection('specialties')
        .getFirstListItem(`slug = "${fx.slug}"`);
      await pb.collection('specialties').delete(existing.id);
      console.log('  cleared 1 specialties');
    } catch {
      /* not present — fine */
    }

    // Insert specialty
    await pb.collection('specialties').create({
      slug: fx.slug,
      name: fx.name,
      source: 'xlsx',
      xlsxPath: fx.xlsxPath,
      lastSeededAt: NOW,
    });
    console.log('  inserted specialty');

    // Categories
    const categories = await repos.categories.list(fx.slug);
    for (const row of categories) {
      await pb.collection('codeCategories').create({
        ...row,
        specialtySlug: fx.slug,
      });
    }
    console.log(`  inserted ${categories.length} codeCategories`);

    // Codes
    const codes = await repos.codes.list(fx.slug);
    let inserted = 0;
    for (const row of codes) {
      await pb.collection('codes').create({
        ...row,
        specialtySlug: fx.slug,
      });
      inserted++;
      if (inserted % 100 === 0) console.log(`  …${inserted} / ${codes.length} codes`);
    }
    console.log(`  inserted ${codes.length} codes`);
  }

  console.log('\nDone. Open http://localhost:8090/_/ to inspect.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
