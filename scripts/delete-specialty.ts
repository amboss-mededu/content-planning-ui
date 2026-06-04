/**
 * Delete a specialty ENTIRELY from PocketBase: the `specialties` row plus every
 * child row across all collections that reference it.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/delete-specialty.ts <slug>
 *
 * Unlike wipe-specialty.ts — which keeps the `specialties` row and only clears a
 * fixed list of child collections — this removes the specialty itself and walks
 * every non-system collection that has a `specialtySlug` field, plus the
 * run-scoped pipeline collections (keyed by runId). Destructive and
 * irreversible. Intended for local dev resets.
 */

import { clearCollection, pbAdminClient } from './_lib/pb';

// Pipeline child collections keyed by runId rather than specialtySlug.
const RUN_SCOPED = ['pipelineStages', 'pipelineEvents'];

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: tsx scripts/delete-specialty.ts <slug>');
    process.exit(1);
  }

  const pb = await pbAdminClient();
  const filter = `specialtySlug = "${slug}"`;
  const summary: Record<string, number> = {};

  // 1. The specialty row(s) themselves (deleted last; recorded now).
  const specialties = await pb
    .collection('specialties')
    .getFullList({ filter: `slug = "${slug}"` });
  if (specialties.length === 0) {
    console.log(`No "specialties" row for "${slug}". Clearing any orphaned child rows.`);
  } else {
    for (const s of specialties) {
      const r = s as unknown as { id: string; name?: string; source?: string };
      console.log(
        `Specialty: ${r.id} · name="${r.name ?? ''}" source="${r.source ?? ''}"`,
      );
    }
  }

  // 2. Collect pipelineRun ids before deleting them (run-scoped children need them).
  let runIds: string[] = [];
  try {
    const runs = await pb.collection('pipelineRuns').getFullList({ filter });
    runIds = runs.map((r) => r.id);
  } catch {
    // pipelineRuns may not exist; ignore.
  }

  // 3. Every non-system collection with a `specialtySlug` field.
  const collections = await pb.collections.getFullList();
  for (const col of collections) {
    const c = col as unknown as {
      name: string;
      system?: boolean;
      fields?: Array<{ name: string }>;
      schema?: Array<{ name: string }>;
    };
    if (c.system || c.name === 'specialties') continue;
    const fields = c.fields ?? c.schema ?? [];
    if (!fields.some((f) => f.name === 'specialtySlug')) continue;
    try {
      const removed = await clearCollection(pb, c.name, filter);
      if (removed > 0) summary[c.name] = removed;
    } catch (e) {
      console.warn(`  ${c.name}: skipped (${(e as Error).message})`);
    }
  }

  // 4. Run-scoped pipeline children (keyed by runId, no specialtySlug field).
  for (const name of RUN_SCOPED) {
    let removed = 0;
    for (const runId of runIds) {
      try {
        removed += await clearCollection(pb, name, `runId = "${runId}"`);
      } catch (e) {
        console.warn(`  ${name} (run ${runId}): skipped (${(e as Error).message})`);
      }
    }
    if (removed > 0) summary[name] = (summary[name] ?? 0) + removed;
  }

  // 5. Finally the specialty row(s).
  for (const s of specialties) {
    await pb.collection('specialties').delete(s.id);
  }
  if (specialties.length > 0) summary.specialties = specialties.length;

  console.log('\nDeleted:');
  const entries = Object.entries(summary).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    console.log('  (nothing — no data found for this slug)');
  } else {
    for (const [name, count] of entries) console.log(`  ${name}: ${count}`);
  }
  console.log(`\nSpecialty "${slug}" removed entirely.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
