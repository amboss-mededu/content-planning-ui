/**
 * Refresh the local AMBOSS article/section catalog used by the mapping
 * workflow to validate cited IDs.
 *
 *   npm run refresh-amboss-library -- path/to/export.json
 *   npm run refresh-amboss-library -- path/to/export.json --prune
 *
 * Expected JSON shape:
 *
 *   {
 *     "articles": [{"id": "TyX6e00", "title": "...", "contentBase": "US"?}],
 *     "sections": [{"id": "EmW8hN0", "articleId": "TyX6e00", "title": "..."}]
 *   }
 *
 * Upserts are idempotent. `--prune` deletes PB rows whose `updatedAt` is
 * older than this run's timestamp (i.e. anything not in the current export).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type PocketBase from 'pocketbase';
import { pbAdminClient } from './_lib/pb';

type RawArticle = { id: string; title: string; contentBase?: string };
type RawSection = { id: string; articleId: string; title: string };
type ExportShape = { articles: RawArticle[]; sections: RawSection[] };

const UPSERT_CONCURRENCY = 25;

function readExport(path: string): ExportShape {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('articles' in parsed) ||
    !('sections' in parsed)
  ) {
    throw new Error(`export file at ${path} is missing 'articles' or 'sections' keys`);
  }
  const exp = parsed as ExportShape;
  if (!Array.isArray(exp.articles) || !Array.isArray(exp.sections)) {
    throw new Error('articles/sections must be arrays');
  }
  return exp;
}

async function pooled<T>(
  rows: T[],
  concurrency: number,
  fn: (row: T) => Promise<unknown>,
) {
  for (let i = 0; i < rows.length; i += concurrency) {
    await Promise.all(rows.slice(i, i + concurrency).map(fn));
  }
}

/**
 * Upsert by natural key. PB has no native upsert; getFirstListItem-then-
 * update/create is the idiomatic shape. We swallow 404 from the lookup so
 * the create path takes over for new keys.
 */
async function upsert(
  pb: PocketBase,
  collection: string,
  filter: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const existing = await pb
    .collection(collection)
    .getFirstListItem(filter)
    .catch(() => null);
  if (existing) {
    await pb.collection(collection).update(existing.id, payload);
  } else {
    await pb.collection(collection).create(payload);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const prune = args.includes('--prune');
  const pathArg = args.find((a) => !a.startsWith('--'));
  if (!pathArg) {
    console.error(
      'usage: npm run refresh-amboss-library -- path/to/export.json [--prune]',
    );
    process.exit(1);
  }
  const absPath = resolve(process.cwd(), pathArg);
  console.log(`[refresh] reading ${absPath}`);
  const exp = readExport(absPath);
  console.log(
    `[refresh] ${exp.articles.length} articles, ${exp.sections.length} sections`,
  );

  const pb = await pbAdminClient();
  const updatedAt = Date.now();

  let n = 0;
  await pooled(exp.articles, UPSERT_CONCURRENCY, async (a) => {
    await upsert(pb, 'ambossArticles', `articleId = "${a.id}"`, {
      articleId: a.id,
      title: a.title,
      contentBase: a.contentBase,
      updatedAt,
    });
    if (++n % 500 === 0) console.log(`[refresh]   ${n} articles`);
  });

  n = 0;
  await pooled(exp.sections, UPSERT_CONCURRENCY, async (s) => {
    await upsert(pb, 'ambossSections', `sectionId = "${s.id}"`, {
      sectionId: s.id,
      articleId: s.articleId,
      title: s.title,
      updatedAt,
    });
    if (++n % 500 === 0) console.log(`[refresh]   ${n} sections`);
  });

  if (prune) {
    let pruned = 0;
    for (const collection of ['ambossArticles', 'ambossSections']) {
      const stale = await pb.collection(collection).getFullList({
        filter: `updatedAt < ${updatedAt}`,
        fields: 'id',
      });
      await pooled(stale, UPSERT_CONCURRENCY, (row) =>
        pb.collection(collection).delete(row.id),
      );
      pruned += stale.length;
    }
    console.log(`[refresh] pruned ${pruned} stale rows`);
  }

  console.log('[refresh] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
