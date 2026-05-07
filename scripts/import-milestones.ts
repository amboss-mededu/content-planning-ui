/**
 * Write milestone text from a local file into specialties.milestones in
 * PocketBase.
 *
 * Usage:
 *   npm run import-milestones -- anesthesiology anesthesiology_milestones.txt
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pbAdminClient } from './_lib/pb';

async function main() {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) {
    console.error('Usage: import-milestones -- <slug> <file>');
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const text = (await readFile(abs, 'utf8')).trim();

  const pb = await pbAdminClient();
  const row = await pb
    .collection('specialties')
    .getFirstListItem(`slug = "${slug}"`)
    .catch(() => null);
  if (!row) {
    throw new Error(
      `No specialty '${slug}' in PocketBase. Run import-board (or seed:local) first.`,
    );
  }
  await pb.collection('specialties').update(row.id, {
    milestones: text,
    lastSeededAt: Date.now(),
  });

  console.log(
    `✓ Wrote ${text.length.toLocaleString()} chars of milestones to '${slug}'.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
